import "server-only"

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql, type SQL } from "drizzle-orm"

import { db } from "@/db"
import { accounts, campaigns, creators, postDailyMetrics, posts } from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"
import { addDays, getCycle, getCycleByStart, startOfLocalDay } from "@/lib/payouts/cycles"
import { tierFor, normalizeMilestones } from "@/lib/payouts/rules"
import { getCycleView } from "@/lib/payouts/service"
import { MONTH_PATTERN, RANGE_DAYS, TOP_ENGAGEMENT_MIN_VIEWS, type OverviewParams } from "@/lib/search-params/overview"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 86_400_000
// Keeps the daily chart of an old program readable and its series bounded.
const MAX_RANGE_DAYS = 730

const organic = sql<number>`greatest(0, ${posts.currentViews} - coalesce(${posts.paidViewsManual}, ${posts.paidViewsSynced}, 0))`

// Filters that describe *which posts* are in scope (everything except the date range).
function scope(params: OverviewParams): SQL[] {
  const where: SQL[] = []
  if (params.campaign && UUID.test(params.campaign)) where.push(eq(posts.campaignId, params.campaign))
  if (params.creator && UUID.test(params.creator)) where.push(eq(posts.creatorId, params.creator))
  if (params.account && UUID.test(params.account)) where.push(eq(posts.accountId, params.account))
  if (params.platform.length) where.push(inArray(posts.platform, params.platform))
  if (params.status.length) where.push(inArray(posts.displayStatus, params.status))
  return where
}

export async function getOverview(params: OverviewParams, now: Date) {
  await requireUser()
  const inScope = scope(params)
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS)
  let to = tomorrow
  let days: number
  // Set when the period starts at an exact instant instead of a whole number of days back.
  let exactFrom: Date | null = null
  // A selected month: its first day, and the instant it ends (exclusive), in the time zone of the
  // selected campaign (or the first active one), the boundary a monthly payout cycle uses.
  let month: { day: string; endsAt: Date } | null = null
  if (params.month && MONTH_PATTERN.test(params.month)) {
    const selected = params.campaign && UUID.test(params.campaign) ? params.campaign : null
    const [zone] = await db
      .select({ timezone: campaigns.timezone })
      .from(campaigns)
      .where(selected ? eq(campaigns.id, selected) : eq(campaigns.status, "active"))
      .orderBy(asc(campaigns.startDate))
      .limit(1)
    const timezone = zone?.timezone ?? "UTC"
    const day = `${params.month}-01`
    const start = startOfLocalDay(day, timezone)
    // A month that has not begun has nothing to show; the preset applies instead.
    if (start < to) {
      const endsAt = startOfLocalDay(addDays(day, 32).slice(0, 7) + "-01", timezone)
      month = { day, endsAt }
      if (endsAt < to) to = endsAt
      exactFrom = start
    }
  }
  if (month) {
    days = Math.max(1, Math.ceil((to.getTime() - exactFrom!.getTime()) / DAY_MS))
  } else if (params.range === "campaign") {
    // From the start date of the selected campaign (or the earliest active one) until today; a
    // campaign that has ended stops at its end date. Dates are days in the campaign's own time
    // zone, the same boundary the payout cycles use, so both pages count the same videos.
    const selected = params.campaign && UUID.test(params.campaign) ? params.campaign : null
    const inPlay = await db
      .select({ startDate: campaigns.startDate, endDate: campaigns.endDate, timezone: campaigns.timezone })
      .from(campaigns)
      .where(selected ? eq(campaigns.id, selected) : eq(campaigns.status, "active"))
    const starts = inPlay.map((c) => startOfLocalDay(c.startDate, c.timezone).getTime())
    if (inPlay.length && inPlay.every((c) => c.endDate)) {
      const lastEnd = Math.max(...inPlay.map((c) => startOfLocalDay(addDays(c.endDate!, 1), c.timezone).getTime()))
      if (lastEnd < to.getTime()) to = new Date(lastEnd)
    }
    if (starts.length && Math.min(...starts) < to.getTime()) {
      exactFrom = new Date(Math.max(Math.min(...starts), to.getTime() - MAX_RANGE_DAYS * DAY_MS))
      days = Math.max(1, Math.ceil((to.getTime() - exactFrom.getTime()) / DAY_MS))
    } else {
      days = 30
    }
  } else if (params.range === "all") {
    // Back to the day the first video in scope was posted.
    const [first] = await db
      .select({ day: sql<string | null>`to_char(min(${posts.postedAt}) at time zone 'UTC', 'YYYY-MM-DD')` })
      .from(posts)
      .where(and(...inScope))
    const firstDay = first?.day ?? null
    const span = firstDay ? Math.round((to.getTime() - new Date(`${firstDay}T00:00:00Z`).getTime()) / DAY_MS) : 30
    days = Math.min(MAX_RANGE_DAYS, Math.max(1, span))
  } else {
    days = RANGE_DAYS[params.range]
  }
  const from = exactFrom ?? new Date(to.getTime() - days * DAY_MS)
  const fromDay = from.toISOString().slice(0, 10)
  const toDay = new Date(to.getTime() - DAY_MS).toISOString().slice(0, 10)
  const postedInRange = and(...inScope, gte(posts.postedAt, from), lt(posts.postedAt, to))
  // With a month selected, the numbers about the present (open windows, locked, ready to pay) are
  // about that month's videos too, so September and October can be told apart.
  const stateScope = month ? [...inScope, gte(posts.postedAt, from), lt(posts.postedAt, month.endsAt)] : inScope
  // The payout cycle the bonus numbers refer to: the selected month for a monthly campaign,
  // otherwise the current one.
  const cycleStartFor = (c: { cycleType: string }) => (month && c.cycleType === "monthly" ? month.day : null)

  const activeCampaigns = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, "active"),
        params.campaign && UUID.test(params.campaign) ? eq(campaigns.id, params.campaign) : undefined
      )
    )

  const [
    [counts],
    [viewsInPeriod],
    [openWindows],
    [locked],
    daily,
    byPlatform,
    topVideos,
    leaderboard,
    closingSoon,
    cycleViews,
    heldCounts,
  ] = await Promise.all([
    db
      .select({ posts: sql<number>`count(*)::int`, views: sql<number>`coalesce(sum(${organic}), 0)::float8` })
      .from(posts)
      .where(postedInRange),
    db
      .select({ views: sql<number>`coalesce(sum(${postDailyMetrics.viewsDelta}), 0)::float8` })
      .from(postDailyMetrics)
      .innerJoin(posts, eq(posts.id, postDailyMetrics.postId))
      .where(and(...inScope, gte(postDailyMetrics.day, fromDay), lte(postDailyMetrics.day, toDay))),
    db
      .select({ views: sql<number>`coalesce(sum(${organic}), 0)::float8`, posts: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(...stateScope, eq(posts.displayStatus, "open"))),
    db
      .select({
        views: sql<number>`coalesce(sum(${posts.payableViews}), 0)::float8`,
        ready: sql<number>`count(*) filter (where not ${posts.needsReview})::int`,
        review: sql<number>`count(*) filter (where ${posts.needsReview})::int`,
      })
      .from(posts)
      .where(and(...stateScope, eq(posts.displayStatus, "locked"), isNull(posts.bonusCycleId))),
    db
      .select({
        day: postDailyMetrics.day,
        views: sql<number>`sum(${postDailyMetrics.viewsDelta})::float8`,
      })
      .from(postDailyMetrics)
      .innerJoin(posts, eq(posts.id, postDailyMetrics.postId))
      .where(and(...inScope, gte(postDailyMetrics.day, fromDay), lte(postDailyMetrics.day, toDay)))
      .groupBy(postDailyMetrics.day)
      .orderBy(asc(postDailyMetrics.day)),
    db
      .select({ platform: posts.platform, posts: sql<number>`count(*)::int` })
      .from(posts)
      .where(postedInRange)
      .groupBy(posts.platform)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        id: posts.id,
        caption: posts.caption,
        platform: posts.platform,
        handle: accounts.handle,
        views: posts.currentViews,
        engagementRate: posts.engagementRate,
        thumbnailPath: posts.thumbnailPath,
      })
      .from(posts)
      .innerJoin(accounts, eq(accounts.id, posts.accountId))
      .where(
        params.top === "engagement"
          ? and(postedInRange, isNotNull(posts.engagementRate), gte(posts.currentViews, TOP_ENGAGEMENT_MIN_VIEWS))
          : postedInRange
      )
      .orderBy(params.top === "engagement" ? desc(posts.engagementRate) : desc(posts.currentViews))
      .limit(6),
    db
      .select({
        id: creators.id,
        name: creators.name,
        views: sql<number>`sum(${posts.currentViews})::float8`,
        posts: sql<number>`count(*)::int`,
      })
      .from(posts)
      .innerJoin(creators, eq(creators.id, posts.creatorId))
      .where(postedInRange)
      .groupBy(creators.id, creators.name)
      .orderBy(desc(sql`sum(${posts.currentViews})`))
      .limit(6),
    db
      .select({
        id: posts.id,
        caption: posts.caption,
        platform: posts.platform,
        handle: accounts.handle,
        creatorName: creators.name,
        campaignId: posts.campaignId,
        windowEndsAt: posts.windowEndsAt,
        views: posts.currentViews,
        organic: sql<number>`${organic}::float8`,
        velocity: posts.views24hDelta,
        isSpark: posts.isSpark,
      })
      .from(posts)
      .innerJoin(accounts, eq(accounts.id, posts.accountId))
      .leftJoin(creators, eq(creators.id, posts.creatorId))
      .where(
        and(
          ...inScope,
          eq(posts.displayStatus, "open"),
          lte(posts.windowEndsAt, new Date(now.getTime() + 2 * DAY_MS))
        )
      )
      .orderBy(asc(posts.windowEndsAt))
      .limit(25),
    // Estimated bonuses come from the same engine as the Payouts page: the live preview of each
    // active campaign's current cycle (or the selected month's cycle, finalized or not).
    Promise.all(activeCampaigns.map((c) => getCycleView(c.id, cycleStartFor(c), now))),
    // Open videos whose window ends after their campaign's current cycle: paid next cycle or later.
    Promise.all(
      activeCampaigns.map(async (c) => {
        const start = cycleStartFor(c)
        const cycle = start
          ? getCycleByStart(c.cycleType, c.timezone, c.weekStartsOn, start)
          : getCycle(c.cycleType, c.timezone, c.weekStartsOn, now)
        const [row] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(posts)
          .where(
            and(
              ...stateScope,
              eq(posts.campaignId, c.id),
              eq(posts.displayStatus, "open"),
              gte(posts.windowEndsAt, cycle.endsAt)
            )
          )
        return row.n
      })
    ),
  ])

  const estimatedBonusCents = cycleViews.reduce((sum, view) => {
    if (!view) return sum
    const lines = params.creator ? view.lines.filter((l) => l.creatorId === params.creator) : view.lines
    return sum + lines.reduce((s, l) => s + l.payout.bonusCents, 0)
  }, 0)

  // Distance to the next milestone, for campaigns that pay by milestone.
  const ladders = new Map(
    activeCampaigns
      .filter((c) => c.bonusType === "milestone" || c.bonusType === "hybrid")
      .map((c) => [c.id, normalizeMilestones(c.milestones)])
  )
  const closing = closingSoon.map((post) => {
    const ladder = post.campaignId ? ladders.get(post.campaignId) : undefined
    const next = ladder?.find((tier) => tier.views > post.organic) ?? null
    return {
      ...post,
      currentTier: ladder ? tierFor(ladder, post.organic) : null,
      nextTier: next,
      toNextTier: next ? next.views - post.organic : null,
    }
  })

  // One point per day, including days without any gain, so the line does not skip gaps.
  const byDay = new Map(daily.map((d) => [d.day, d.views]))
  const series = Array.from({ length: days }, (_, i) => {
    const t = from.getTime() + i * DAY_MS
    return { t, views: byDay.get(new Date(t).toISOString().slice(0, 10)) ?? 0 }
  })

  return {
    // `fixedStart`: the period has a start date of its own instead of "the last N days".
    range: {
      from,
      to,
      days,
      fixedStart: Boolean(month) || params.range === "all" || params.range === "campaign",
      ended: to < tomorrow,
      // First day (YYYY-MM-DD) of the selected month, when one is.
      month: month?.day ?? null,
    },
    kpis: {
      posts: counts.posts,
      // Organic views today on the videos posted in the period: independent of how long each
      // video has been tracked, unlike the daily gains below.
      totalViews: counts.views,
      viewsInPeriod: viewsInPeriod.views,
      openWindowViews: openWindows.views,
      openWindowPosts: openWindows.posts,
      lockedPayableViews: locked.views,
      readyToPay: locked.ready,
      lockedNeedingReview: locked.review,
      estimatedBonusCents,
      heldForNextCycle: heldCounts.reduce((a, b) => a + b, 0),
    },
    series,
    byPlatform,
    topVideos,
    leaderboard,
    closing,
  }
}

export type Overview = Awaited<ReturnType<typeof getOverview>>
