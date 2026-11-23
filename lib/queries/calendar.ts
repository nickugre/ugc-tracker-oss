import "server-only"

import { and, asc, eq, gte, inArray, isNotNull, lt, or } from "drizzle-orm"

import { db } from "@/db"
import { accounts, campaignCreators, creators, posts } from "@/db/schema"
import type { Platform } from "@/db/schema/enums"
import { requireUser } from "@/lib/auth/dal"
import {
  buildCells,
  countByLocalDay,
  daysBetween,
  pacePerDay,
  postingTarget,
  type DayCell,
} from "@/lib/calendar/grid"
import { addDays, localDayOf, startOfLocalDay, type Cycle } from "@/lib/payouts/cycles"
import { applyCreatorOverrides, expectedQuota } from "@/lib/payouts/rules"
import { getCycleView, type CycleView } from "@/lib/payouts/service"
import { isValidTimeZone } from "@/lib/time-zones"

// Two time zones are never more than 26 hours apart, so a creator's local days of the cycle always
// lie inside the cycle's instants widened by this much on both sides.
const ZONE_SPREAD_MS = 27 * 3_600_000

// One line of day cells. With a per-platform quota every enabled platform is its own track, because
// extra posts on one platform never make up for a shortfall on another. Otherwise: every post.
export type CalendarTrack = {
  platform: Platform | null
  cells: DayCell[]
  perDay: number | null
  // Posted / quota / left are the payout engine's numbers for the cycle (cut in the CAMPAIGN time
  // zone), so they always agree with Payouts. The cells are days in the CREATOR's time zone; around
  // midnight on the first and last day the two can differ by a post.
  posted: number
  quota: number | null
  left: number | null
  pace: number | null
  note: "no_account" | "tracking_off" | null
}

export type CalendarRow = {
  creatorId: string
  creatorName: string
  status: "active" | "paused" | "ended"
  timezone: string
  tracks: CalendarTrack[]
}

export type CalendarView = {
  campaign: CycleView["campaign"]
  cycle: Cycle
  status: CycleView["status"]
  days: string[]
  // Today in the campaign time zone.
  today: string
  ended: boolean
  rows: CalendarRow[]
  // Over every track that has a quota. Delivered is clamped per track, like base pay.
  totals: { delivered: number; quota: number; left: number } | null
}

function earliestDay(days: (string | null)[]): string | null {
  const known = days.filter((day): day is string => day !== null)
  return known.length ? known.reduce((a, b) => (a < b ? a : b)) : null
}

function latestDay(days: (string | null)[]): string | null {
  const known = days.filter((day): day is string => day !== null)
  return known.length ? known.reduce((a, b) => (a > b ? a : b)) : null
}

export async function getCalendar(
  campaignId: string,
  periodStart: string | null,
  now: Date
): Promise<CalendarView | null> {
  await requireUser()
  const view = await getCycleView(campaignId, periodStart, now)
  if (!view) return null
  const { campaign, cycle, rules } = view
  const lineCreatorIds = view.lines.map((line) => line.creatorId)

  const [people, campaignAccounts, cyclePosts] = await Promise.all([
    // Everyone assigned to the campaign, plus anyone Payouts lists without an assignment.
    db
      .select({
        id: creators.id,
        name: creators.name,
        status: creators.status,
        timezone: creators.timezone,
        startDate: campaignCreators.startDate,
        endDate: campaignCreators.endDate,
        quotaCount: campaignCreators.quotaCountOverride,
      })
      .from(creators)
      .leftJoin(
        campaignCreators,
        and(eq(campaignCreators.creatorId, creators.id), eq(campaignCreators.campaignId, campaign.id))
      )
      .where(
        or(
          isNotNull(campaignCreators.campaignId),
          lineCreatorIds.length ? inArray(creators.id, lineCreatorIds) : undefined
        )
      )
      .orderBy(asc(creators.name)),
    db
      .select({
        creatorId: accounts.creatorId,
        platform: accounts.platform,
        trackingEnabled: accounts.trackingEnabled,
        trackFrom: accounts.trackFrom,
        lastSuccessAt: accounts.lastSuccessAt,
      })
      .from(accounts)
      .where(eq(accounts.campaignId, campaign.id)),
    db
      .select({ creatorId: posts.creatorId, platform: posts.platform, postedAt: posts.postedAt })
      .from(posts)
      .where(
        and(
          eq(posts.campaignId, campaign.id),
          eq(posts.isExcluded, false),
          gte(posts.postedAt, new Date(cycle.startsAt.getTime() - ZONE_SPREAD_MS)),
          lt(posts.postedAt, new Date(cycle.endsAt.getTime() + ZONE_SPREAD_MS))
        )
      ),
  ])

  const days = daysBetween(cycle.periodStart, cycle.periodEnd)
  const today = localDayOf(now, campaign.timezone)
  // A cross-posted (best_platform) quota still expects every video on each platform.
  const perPlatform = rules.quota.scope !== "total" && rules.platforms.length > 0
  const trackPlatforms: (Platform | null)[] = perPlatform ? rules.platforms : [null]

  const rows: CalendarRow[] = []
  for (const person of people) {
    const line = view.lines.find((l) => l.creatorId === person.id)
    const timezone = person.timezone && isValidTimeZone(person.timezone) ? person.timezone : campaign.timezone
    const myPosts = cyclePosts.filter((post) => post.creatorId === person.id)
    const myAccounts = campaignAccounts.filter((account) => account.creatorId === person.id)

    // Someone who left and has nothing in this cycle would only be a row of blanks.
    if (person.status !== "active" && myPosts.length === 0 && !line?.payout.postsPublished) continue

    // A line carries the quota it was paid with. Without one (a finalized cycle skips creators who
    // posted nothing) it is worked out the way the engine would.
    const quotaAll = line
      ? line.payout.quota
      : expectedQuota(applyCreatorOverrides(rules, { quotaCount: person.quotaCount }), cycle.days)

    const tracks = trackPlatforms.map((platform): CalendarTrack => {
      const onTrack = <T extends { platform: Platform }>(items: T[]) =>
        platform ? items.filter((item) => item.platform === platform) : items
      const trackAccounts = onTrack(myAccounts)
      const watched = trackAccounts.filter((account) => account.trackingEnabled)
      // An account that is switched off still tells how far its posts are known.
      const scraped = watched.length ? watched : trackAccounts
      const lastSuccess = scraped.every((account) => account.lastSuccessAt)
        ? scraped.map((account) => account.lastSuccessAt as Date)
        : []

      const quota =
        quotaAll === null || !perPlatform || rules.quota.scope === "best_platform"
          ? quotaAll
          : quotaAll / rules.platforms.length
      const target = postingTarget(quota, cycle.days)
      const posted = line
        ? platform
          ? (line.payout.publishedByPlatform[platform] ?? 0)
          : line.payout.postsPublished
        : 0
      const left = quota === null ? null : Math.max(0, quota - posted)

      return {
        platform,
        cells: buildCells({
          days,
          counts: countByLocalDay(onTrack(myPosts).map((post) => post.postedAt), timezone),
          target,
          activeFrom: latestDay([
            campaign.startDate,
            person.startDate,
            // Posts before track_from are never ingested, so those days cannot be judged.
            trackAccounts.every((account) => account.trackFrom)
              ? earliestDay(trackAccounts.map((account) => account.trackFrom))
              : null,
          ]),
          activeTo: earliestDay([campaign.endDate, person.endDate]),
          judgedBefore: lastSuccess.length
            ? localDayOf(new Date(Math.min(...lastSuccess.map((at) => at.getTime()))), timezone)
            : null,
          today: localDayOf(now, timezone),
        }),
        perDay: target?.perDay ?? null,
        posted,
        quota,
        left,
        pace: pacePerDay(left, today, cycle),
        note: trackAccounts.length === 0 ? "no_account" : watched.length === 0 ? "tracking_off" : null,
      }
    })

    rows.push({ creatorId: person.id, creatorName: person.name, status: person.status, timezone, tracks })
  }

  // Counted the way base pay counts: with a cross-posted quota, each creator delivers as many
  // videos as their best platform holds, against one quota rather than one per platform.
  const counted =
    rules.quota.scope === "best_platform"
      ? rows.flatMap((row) => {
          const tracks = row.tracks.filter((track) => track.quota !== null)
          if (!tracks.length) return []
          const quota = tracks[0].quota as number
          const delivered = Math.max(...tracks.map((track) => Math.min(track.posted, quota)))
          return [{ delivered, quota, left: quota - delivered }]
        })
      : rows
          .flatMap((row) => row.tracks)
          .filter((track) => track.quota !== null)
          .map((track) => ({
            delivered: Math.min(track.posted, track.quota as number),
            quota: track.quota as number,
            left: track.left as number,
          }))
  const totals = counted.length
    ? counted.reduce(
        (sum, item) => ({
          delivered: sum.delivered + item.delivered,
          quota: sum.quota + item.quota,
          left: sum.left + item.left,
        }),
        { delivered: 0, quota: 0, left: 0 }
      )
    : null

  return {
    campaign,
    cycle,
    status: view.status,
    days,
    today,
    ended: now >= cycle.endsAt,
    rows,
    totals,
  }
}

export type CalendarDayPost = Awaited<ReturnType<typeof listDayPosts>>[number]

function listDayPosts(campaignId: string, creatorId: string, platform: Platform | null, from: Date, to: Date) {
  return db
    .select({
      id: posts.id,
      platform: posts.platform,
      caption: posts.caption,
      url: posts.url,
      postedAt: posts.postedAt,
      currentViews: posts.currentViews,
      thumbnailPath: posts.thumbnailPath,
      displayStatus: posts.displayStatus,
      accountHandle: accounts.handle,
    })
    .from(posts)
    .innerJoin(accounts, eq(accounts.id, posts.accountId))
    .where(
      and(
        eq(posts.campaignId, campaignId),
        eq(posts.creatorId, creatorId),
        platform ? eq(posts.platform, platform) : undefined,
        gte(posts.postedAt, from),
        lt(posts.postedAt, to)
      )
    )
    .orderBy(asc(posts.postedAt))
}

// The videos behind one cell: one creator's local day, optionally one platform. Excluded videos are
// listed too (the cell does not count them), so a lower number than expected explains itself.
export async function getCalendarDay(
  calendar: CalendarView,
  input: { creatorId: string; day: string; platform: Platform | null }
) {
  await requireUser()
  const row = calendar.rows.find((r) => r.creatorId === input.creatorId)
  if (!row || !calendar.days.includes(input.day)) return null
  const from = startOfLocalDay(input.day, row.timezone)
  const to = startOfLocalDay(addDays(input.day, 1), row.timezone)
  return {
    creatorName: row.creatorName,
    timezone: row.timezone,
    day: input.day,
    platform: input.platform,
    posts: await listDayPosts(calendar.campaign.id, row.creatorId, input.platform, from, to),
  }
}

export type CalendarDay = NonNullable<Awaited<ReturnType<typeof getCalendarDay>>>
