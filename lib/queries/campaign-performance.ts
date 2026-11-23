import "server-only"

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm"

import { db } from "@/db"
import { campaigns, creators, payoutCycles, payoutLines, posts, tiktokAdDailyStats, tiktokAds } from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"
import { addDays, getCycle, getCycleByStart, nextCycle, startOfLocalDay, type Cycle } from "@/lib/payouts/cycles"
import { cycleSpendCents, performanceFigures, type PerformancePost } from "@/lib/payouts/performance"
import { normalizeMilestones } from "@/lib/payouts/rules"
import { getCycleView } from "@/lib/payouts/service"

// A cycle that was never finalized is recomputed by the payout engine on every load. Normally
// that is the current cycle and at most the one before it.
const MAX_LIVE_CYCLES = 12
// Bounds the walk from the campaign start to today (weekly cycles for close to eight years).
const MAX_GRID_CYCLES = 400

type CycleSpendRow = {
  periodStart: string
  periodEnd: string
  cycleType: Cycle["cycleType"]
  startsAt: Date
  endsAt: Date
  // preview = the newest cycle that is still open; unfinalized = an older one nobody settled yet.
  status: "paid" | "finalized" | "preview" | "unfinalized"
  baseCents: number
  bonusCents: number
  adjustmentsCents: number
  spendCents: number
  byCreator: Map<string, number>
}

// What a campaign cost and what it got for it, from its start date until today (or its end date):
// the same period and the same videos as the Overview's "Campaign" period, minus excluded videos.
// Spend is what the creators are paid: finalized cycles as stored, plus the live preview of the
// cycles that are still open, so it always adds up to what the Payouts page shows.
export async function getCampaignPerformance(campaignId: string, now: Date) {
  await requireUser()
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  if (!campaign) return null

  const from = startOfLocalDay(campaign.startDate, campaign.timezone)
  const campaignEnd = campaign.endDate ? startOfLocalDay(addDays(campaign.endDate, 1), campaign.timezone) : null
  const inPeriod = and(
    eq(posts.campaignId, campaignId),
    eq(posts.isExcluded, false),
    gte(posts.postedAt, from),
    campaignEnd ? lt(posts.postedAt, campaignEnd) : undefined
  )

  const [videos, storedCycles, storedLines, [ads]] = await Promise.all([
    db
      .select({
        postedAt: posts.postedAt,
        creatorId: posts.creatorId,
        views: posts.currentViews,
        organicViews: sql<number>`greatest(0, ${posts.currentViews} - coalesce(${posts.paidViewsManual}, ${posts.paidViewsSynced}, 0))::float8`,
        engagements: sql<number>`(coalesce(${posts.currentLikes}, 0) + coalesce(${posts.currentComments}, 0) + coalesce(${posts.currentShares}, 0) + coalesce(${posts.currentSaves}, 0))::float8`,
      })
      .from(posts)
      .where(inPeriod),
    db.select().from(payoutCycles).where(eq(payoutCycles.campaignId, campaignId)).orderBy(asc(payoutCycles.startsAt)),
    db
      .select({ cycleId: payoutLines.cycleId, creatorId: payoutLines.creatorId, totalCents: payoutLines.totalCents })
      .from(payoutLines)
      .innerJoin(payoutCycles, eq(payoutCycles.id, payoutLines.cycleId))
      .where(eq(payoutCycles.campaignId, campaignId)),
    // Spark ads that ran on these videos, as far as the TikTok Ads sync knows them.
    db
      .select({
        spend: sql<number>`coalesce(sum(${tiktokAdDailyStats.spend}), 0)::float8`,
        views: sql<number>`coalesce(sum(${tiktokAdDailyStats.videoViews}), 0)::float8`,
      })
      .from(tiktokAdDailyStats)
      .innerJoin(tiktokAds, eq(tiktokAds.adId, tiktokAdDailyStats.adId))
      .innerJoin(posts, eq(posts.id, tiktokAds.postId))
      .where(inPeriod),
  ])

  const rows: CycleSpendRow[] = storedCycles.map((c) => ({
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    cycleType: c.cycleType,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    status: c.status === "paid" ? "paid" : "finalized",
    baseCents: c.baseCents,
    bonusCents: c.bonusCents,
    adjustmentsCents: c.adjustmentsCents,
    spendCents: cycleSpendCents(c, { stored: true, newestPreview: false, insideCampaignDates: true }),
    byCreator: new Map(storedLines.filter((l) => l.cycleId === c.id).map((l) => [l.creatorId, l.totalCents])),
  }))

  // Every cycle from the campaign start until today that is not stored is still open.
  const isStored = new Set(storedCycles.map((c) => `${c.cycleType}:${c.periodStart}`))
  const open: Cycle[] = []
  if (from <= now) {
    const current = getCycle(campaign.cycleType, campaign.timezone, campaign.weekStartsOn, now)
    let cycle = getCycleByStart(campaign.cycleType, campaign.timezone, campaign.weekStartsOn, campaign.startDate)
    for (let i = 0; i < MAX_GRID_CYCLES && cycle.startsAt <= current.startsAt; i++) {
      if (!isStored.has(`${cycle.cycleType}:${cycle.periodStart}`)) open.push(cycle)
      cycle = nextCycle(cycle, campaign.weekStartsOn)
    }
  }
  const live = open.slice(-MAX_LIVE_CYCLES)
  const previews = await Promise.all(live.map((cycle) => getCycleView(campaignId, cycle.periodStart, now)))
  previews.forEach((view, i) => {
    if (!view) return
    const newestPreview = i === previews.length - 1
    const insideCampaignDates = !campaignEnd || view.cycle.startsAt < campaignEnd
    const spendOf = (payout: { baseCents: number; bonusCents: number; adjustmentsCents: number }) =>
      cycleSpendCents(payout, { stored: false, newestPreview, insideCampaignDates })
    rows.push({
      periodStart: view.cycle.periodStart,
      periodEnd: view.cycle.periodEnd,
      cycleType: view.cycle.cycleType,
      startsAt: view.cycle.startsAt,
      endsAt: view.cycle.endsAt,
      status: newestPreview ? "preview" : "unfinalized",
      baseCents: insideCampaignDates ? view.totals.baseCents : 0,
      bonusCents: newestPreview ? view.totals.bonusCents : 0,
      adjustmentsCents: view.totals.adjustmentsCents,
      spendCents: spendOf(view.totals),
      byCreator: new Map(view.lines.map((line) => [line.creatorId, spendOf(line.payout)])),
    })
  })
  rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const sum = (pick: (row: CycleSpendRow) => number) => rows.reduce((total, row) => total + pick(row), 0)
  const spendByCreator = new Map<string, number>()
  for (const row of rows) {
    for (const [creatorId, cents] of row.byCreator) {
      spendByCreator.set(creatorId, (spendByCreator.get(creatorId) ?? 0) + cents)
    }
  }

  const videoPosts: PerformancePost[] = videos
  const creatorIds = [
    ...new Set([...spendByCreator.keys(), ...videos.map((v) => v.creatorId).filter((id): id is string => id !== null)]),
  ]
  const names = creatorIds.length
    ? await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, creatorIds))
    : []

  const byCreator = names
    .map((creator) => ({
      creatorId: creator.id,
      name: creator.name,
      ...performanceFigures(
        videoPosts.filter((v) => v.creatorId === creator.id),
        spendByCreator.get(creator.id) ?? 0
      ),
    }))
    .sort((a, b) => b.organicViews - a.organicViews || a.name.localeCompare(b.name))

  // Milestones are judged on a video's own organic views, so the first rung doubles as a plain
  // "did this video take off" line.
  const usesMilestones = campaign.bonusType === "milestone" || campaign.bonusType === "hybrid"
  const firstTier = usesMilestones ? (normalizeMilestones(campaign.milestones ?? [])[0] ?? null) : null

  const totalViews = videos.reduce((total, v) => total + v.views, 0)
  const adSpendCents = Math.round(ads.spend * 100)
  const spendCents = sum((row) => row.spendCents)

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      currency: campaign.currency,
      timezone: campaign.timezone,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
    },
    period: { from, to: campaignEnd && campaignEnd < now ? campaignEnd : now, ended: Boolean(campaignEnd && campaignEnd < now) },
    totals: performanceFigures(videoPosts, spendCents),
    spend: {
      baseCents: sum((row) => row.baseCents),
      bonusCents: sum((row) => row.bonusCents),
      adjustmentsCents: sum((row) => row.adjustmentsCents),
      // Frozen in finalized cycles, against what the open cycles add as a live estimate.
      settledCents: sum((row) => (row.status === "paid" || row.status === "finalized" ? row.spendCents : 0)),
      estimatedCents: sum((row) => (row.status === "preview" || row.status === "unfinalized" ? row.spendCents : 0)),
    },
    firstTier: firstTier
      ? { views: firstTier.views, reached: videos.filter((v) => v.organicViews >= firstTier.views).length }
      : null,
    // Only once the Ads sync has found spend on these videos. Paid views entered by hand carry
    // no spend, so they cannot show up here.
    ads:
      adSpendCents > 0
        ? {
            spendCents: adSpendCents,
            paidViews: ads.views,
            paidCpmCents: ads.views > 0 ? (adSpendCents * 1000) / ads.views : null,
            // Everything spent on these videos over every view they got.
            blendedCpmCents: totalViews > 0 ? ((spendCents + adSpendCents) * 1000) / totalViews : null,
            totalViews,
          }
        : null,
    // A cycle's videos are the ones posted in it. Its spend also holds the bonuses of videos whose
    // window closed in it, and those were often posted in the cycle before.
    cycles: rows
      .map((row) => ({
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        cycleType: row.cycleType,
        status: row.status,
        ...performanceFigures(
          videoPosts.filter((v) => v.postedAt >= row.startsAt && v.postedAt < row.endsAt),
          row.spendCents
        ),
      }))
      // A past cycle in which nothing was posted and nothing is owed has nothing to show.
      .filter((row) => row.status !== "unfinalized" || row.videos > 0 || row.spendCents !== 0),
    creators: byCreator,
    // Videos of the campaign that are not linked to a creator: they have views but nobody is paid.
    unassignedVideos: videos.filter((v) => v.creatorId === null).length,
    // Open cycles older than the ones recomputed above; their base pay is missing from the spend.
    skippedOpenCycles: open.length - live.length,
  }
}

export type CampaignPerformance = NonNullable<Awaited<ReturnType<typeof getCampaignPerformance>>>
