import "server-only"

import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm"

import { db, type Db, type Tx } from "@/db"
import { outerRef } from "@/db/outer-ref"
import {
  campaignCreators,
  campaigns,
  creators,
  payoutAdjustments,
  payoutCycles,
  payoutItems,
  payoutLines,
  posts,
} from "@/db/schema"

import { getCycle, getCycleByStart, paydayFor, previousCycle, startOfLocalDay, type Cycle } from "./cycles"
import {
  computeCreatorPayout,
  ENGINE_VERSION,
  type CreatorPayout,
  type EnginePost,
} from "./engine"
import { baseTermsFor, type BaseTerms } from "./base-breakdown"
import { milestoneWatch, type WatchRow } from "./milestone-watch"
import { applyCreatorOverrides, campaignRowToRules } from "./rules"
import type { CampaignRules } from "./types"

type Executor = Db | Tx
type CampaignRow = typeof campaigns.$inferSelect

export type PreviewPost = {
  id: string
  platform: EnginePost["platform"]
  caption: string | null
  postedAt: Date
  windowEndsAt: Date
  lockedViews: number | null
  paidViews: number | null
  payableViews: number | null
  currentViews: number
}

export type PreviewLine = {
  creatorId: string
  creatorName: string
  payout: CreatorPayout
  hasOverrides: boolean
  // The creator's own base terms for this cycle (after overrides). null on lines that were
  // finalized before these were stored; the campaign's terms explain those.
  baseTerms: BaseTerms | null
  // Late posts from the previous (already finalized) cycle that are settled for base here.
  latePosts: number
  bonusPosts: PreviewPost[]
  adjustments: { id: string; amountCents: number; reason: string }[]
  // Set once the cycle is finalized.
  lineId: string | null
  status: "unpaid" | "paid" | null
  paymentRef: string | null
}

export type AttentionPost = PreviewPost & {
  creatorName: string | null
  reason: "open_window" | "rolls_over" | "not_locked" | "needs_review"
  reviewReason: string | null
}

export type CycleView = {
  campaign: Pick<
    CampaignRow,
    "id" | "name" | "timezone" | "currency" | "cycleType" | "weekStartsOn" | "paydayRule" | "startDate" | "endDate"
  >
  cycle: Cycle
  // The campaign terms the lines were computed with, before any per-creator override: the frozen
  // snapshot once the cycle is finalized, the live campaign otherwise.
  rules: CampaignRules
  payday: string
  // preview = computed live; finalized / paid = read back from the stored cycle.
  status: "preview" | "finalized" | "paid"
  cycleId: string | null
  canFinalize: boolean
  finalizeFrom: Date
  lines: PreviewLine[]
  totals: { baseCents: number; bonusCents: number; adjustmentsCents: number; totalCents: number }
  // Closed windows that still need a lock or a review: they block finalizing.
  blocked: AttentionPost[]
  // Open windows: they are paid in a later cycle.
  held: AttentionPost[]
  // Live preview only: every video at or near a milestone, and why it does or does not pay.
  milestones: WatchRow[]
}

const postColumns = {
  id: posts.id,
  platform: posts.platform,
  caption: posts.caption,
  postedAt: posts.postedAt,
  windowEndsAt: posts.windowEndsAt,
  lockedViews: posts.lockedViews,
  paidViews: sql<number | null>`coalesce(${posts.paidViewsManual}, ${posts.paidViewsSynced})`,
  payableViews: posts.payableViews,
  currentViews: posts.currentViews,
  creatorId: posts.creatorId,
  needsReview: posts.needsReview,
  reviewReason: posts.reviewReason,
  status: posts.status,
}

function toEnginePost(p: { id: string; platform: EnginePost["platform"]; postedAt: Date; payableViews: number | null }): EnginePost {
  return { id: p.id, platform: p.platform, postedAt: p.postedAt, payableViews: p.payableViews ?? 0 }
}

async function loadCampaign(executor: Executor, campaignId: string) {
  const [campaign] = await executor.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  return campaign ?? null
}

function cycleFor(campaign: CampaignRow, periodStart: string | null, now: Date): Cycle {
  return periodStart
    ? getCycleByStart(campaign.cycleType, campaign.timezone, campaign.weekStartsOn, periodStart)
    : getCycle(campaign.cycleType, campaign.timezone, campaign.weekStartsOn, now)
}

async function storedCycle(executor: Executor, campaign: CampaignRow, cycle: Cycle) {
  const [row] = await executor
    .select()
    .from(payoutCycles)
    .where(
      and(
        eq(payoutCycles.campaignId, campaign.id),
        eq(payoutCycles.cycleType, cycle.cycleType),
        eq(payoutCycles.periodStart, cycle.periodStart)
      )
    )
    .limit(1)
  return row ?? null
}

// Everything the engine needs for one campaign cycle, computed from the live tables.
async function computeLive(executor: Executor, campaign: CampaignRow, cycle: Cycle) {
  const rules: CampaignRules = campaignRowToRules(campaign)
  const previous = previousCycle(cycle, campaign.weekStartsOn)
  const previousStored = await storedCycle(executor, campaign, previous)

  const inCampaign = and(eq(posts.campaignId, campaign.id), eq(posts.isExcluded, false))

  // Base: posts published in this cycle. If the previous cycle was finalized on its last day,
  // anything posted in its final hours was missed there, so it is picked up here.
  const publishedRange = previousStored
    ? and(gte(posts.postedAt, previous.startsAt), lt(posts.postedAt, cycle.endsAt))
    : and(gte(posts.postedAt, cycle.startsAt), lt(posts.postedAt, cycle.endsAt))

  const [published, bonus, assigned, adjustments, priorMilestones] = await Promise.all([
    executor
      .select(postColumns)
      .from(posts)
      .where(and(inCampaign, publishedRange, isNull(posts.baseCycleId))),
    executor
      .select(postColumns)
      .from(posts)
      .where(
        and(
          inCampaign,
          eq(posts.status, "locked"),
          eq(posts.needsReview, false),
          isNull(posts.bonusCycleId),
          lte(posts.windowEndsAt, cycle.endsAt)
        )
      )
      .orderBy(asc(posts.postedAt)),
    executor
      .select({
        creatorId: creators.id,
        name: creators.name,
        baseAmountCents: campaignCreators.baseAmountCentsOverride,
        quotaCount: campaignCreators.quotaCountOverride,
        cycleBonusCapCents: campaignCreators.cycleCapCentsOverride,
      })
      .from(campaignCreators)
      .innerJoin(creators, eq(creators.id, campaignCreators.creatorId))
      .where(eq(campaignCreators.campaignId, campaign.id))
      .orderBy(asc(creators.name)),
    executor
      .select()
      .from(payoutAdjustments)
      .where(
        and(
          eq(payoutAdjustments.campaignId, campaign.id),
          eq(payoutAdjustments.cycleType, cycle.cycleType),
          eq(payoutAdjustments.periodStart, cycle.periodStart),
          isNull(payoutAdjustments.cycleId)
        )
      ),
    executor
      .select({
        creatorId: payoutLines.creatorId,
        cents: sql<number>`coalesce(sum((${payoutLines.breakdown}->>'milestoneCents')::int), 0)::int`,
      })
      .from(payoutLines)
      .innerJoin(payoutCycles, eq(payoutCycles.id, payoutLines.cycleId))
      .where(and(eq(payoutCycles.campaignId, campaign.id), lt(payoutCycles.periodStart, cycle.periodStart)))
      .groupBy(payoutLines.creatorId),
  ])

  // Creators assigned to the campaign, plus anyone who has posts in play but is not assigned.
  const names = new Map(assigned.map((a) => [a.creatorId, a.name]))
  const unassignedIds = [...published, ...bonus]
    .map((p) => p.creatorId)
    .filter((id): id is string => Boolean(id) && !names.has(id as string))
  if (unassignedIds.length) {
    const extra = await executor
      .select({ id: creators.id, name: creators.name })
      .from(creators)
      .where(inArray(creators.id, [...new Set(unassignedIds)]))
    extra.forEach((c) => names.set(c.id, c.name))
  }

  const lines: PreviewLine[] = [...names.entries()].map(([creatorId, creatorName]) => {
    const terms = assigned.find((a) => a.creatorId === creatorId)
    const creatorRules = applyCreatorOverrides(rules, {
      baseAmountCents: terms?.baseAmountCents ?? null,
      quotaCount: terms?.quotaCount ?? null,
      cycleBonusCapCents: terms?.cycleBonusCapCents ?? null,
    })
    const mine = published.filter((p) => p.creatorId === creatorId)
    const myBonus = bonus.filter((p) => p.creatorId === creatorId)
    const myAdjustments = adjustments.filter((a) => a.creatorId === creatorId)
    const payout = computeCreatorPayout({
      rules: creatorRules,
      cycle,
      publishedPosts: mine.map(toEnginePost),
      bonusPosts: myBonus.map(toEnginePost),
      priorMilestonePaidCents: priorMilestones.find((p) => p.creatorId === creatorId)?.cents ?? 0,
      adjustmentsCents: myAdjustments.reduce((sum, a) => sum + a.amountCents, 0),
    })
    return {
      creatorId,
      creatorName,
      payout,
      hasOverrides: Boolean(terms && (terms.baseAmountCents ?? terms.quotaCount ?? terms.cycleBonusCapCents) != null),
      baseTerms: baseTermsFor(creatorRules, cycle.days),
      latePosts: mine.filter((p) => p.postedAt < cycle.startsAt).length,
      bonusPosts: myBonus,
      adjustments: myAdjustments.map((a) => ({ id: a.id, amountCents: a.amountCents, reason: a.reason })),
      lineId: null,
      status: null,
      paymentRef: null,
    }
  })

  return { rules, lines, adjustmentIds: adjustments.map((a) => a.id) }
}

function sumTotals(lines: PreviewLine[]) {
  return lines.reduce(
    (t, l) => ({
      baseCents: t.baseCents + l.payout.baseCents,
      bonusCents: t.bonusCents + l.payout.bonusCents,
      adjustmentsCents: t.adjustmentsCents + l.payout.adjustmentsCents,
      totalCents: t.totalCents + l.payout.totalCents,
    }),
    { baseCents: 0, bonusCents: 0, adjustmentsCents: 0, totalCents: 0 }
  )
}

// Posts that are not part of this cycle's bonus pool yet, and why.
async function attentionPosts(executor: Executor, campaign: CampaignRow, cycle: Cycle, now: Date) {
  const rows = await executor
    .select({ ...postColumns, creatorName: creators.name })
    .from(posts)
    .leftJoin(creators, eq(creators.id, posts.creatorId))
    .where(
      and(
        eq(posts.campaignId, campaign.id),
        eq(posts.isExcluded, false),
        isNull(posts.bonusCycleId),
        ne(posts.status, "paid"),
        or(eq(posts.status, "open"), eq(posts.needsReview, true))
      )
    )
    .orderBy(asc(posts.windowEndsAt))

  const blocked: AttentionPost[] = []
  const held: AttentionPost[] = []
  for (const p of rows) {
    if (p.postedAt >= cycle.endsAt) continue
    const closedInCycle = p.windowEndsAt <= cycle.endsAt
    if (p.status === "open" && (!closedInCycle || p.windowEndsAt > now)) {
      held.push({ ...p, reason: closedInCycle ? "open_window" : "rolls_over" })
    } else if (closedInCycle) {
      blocked.push({ ...p, reason: p.needsReview ? "needs_review" : "not_locked" })
    }
  }
  return { blocked, held }
}

// Videos of the campaign that are not settled yet, for the milestone overview of a live preview.
async function milestoneRows(
  executor: Executor,
  campaign: CampaignRow,
  cycle: Cycle,
  rules: CampaignRules,
  lines: PreviewLine[],
  now: Date
) {
  if (rules.bonus.type !== "milestone" && rules.bonus.type !== "hybrid") return []
  const rows = await executor
    .select({ ...postColumns, creatorName: creators.name })
    .from(posts)
    .leftJoin(creators, eq(creators.id, posts.creatorId))
    .where(
      and(
        eq(posts.campaignId, campaign.id),
        eq(posts.isExcluded, false),
        isNull(posts.bonusCycleId),
        ne(posts.status, "paid"),
        lt(posts.postedAt, cycle.endsAt)
      )
    )
  return milestoneWatch({
    posts: rows,
    milestones: rules.bonus.milestones,
    cycle,
    now,
    winners: lines.flatMap((line) => line.payout.bonusItems),
  })
}

// Reads a finalized cycle back from its stored lines and items (never recomputed).
async function readStored(executor: Executor, cycleId: string): Promise<PreviewLine[]> {
  const [lines, items, adjustments] = await Promise.all([
    executor
      .select({ line: payoutLines, creatorName: creators.name })
      .from(payoutLines)
      .innerJoin(creators, eq(creators.id, payoutLines.creatorId))
      .where(eq(payoutLines.cycleId, cycleId))
      .orderBy(asc(creators.name)),
    executor
      .select({
        lineId: payoutItems.lineId,
        id: posts.id,
        platform: posts.platform,
        caption: posts.caption,
        postedAt: posts.postedAt,
        windowEndsAt: posts.windowEndsAt,
        lockedViews: payoutItems.lockedViews,
        paidViews: payoutItems.paidViews,
        payableViews: payoutItems.payableViews,
        currentViews: posts.currentViews,
      })
      .from(payoutItems)
      .innerJoin(posts, eq(posts.id, payoutItems.postId))
      .where(and(eq(payoutItems.cycleId, cycleId), eq(payoutItems.kind, "bonus")))
      .orderBy(asc(posts.postedAt)),
    executor.select().from(payoutAdjustments).where(eq(payoutAdjustments.cycleId, cycleId)),
  ])

  return lines.map(({ line, creatorName }) => ({
    creatorId: line.creatorId,
    creatorName,
    payout: (line.breakdown as { payout: CreatorPayout }).payout,
    hasOverrides: Boolean((line.breakdown as { hasOverrides?: boolean }).hasOverrides),
    baseTerms: (line.breakdown as { baseTerms?: BaseTerms }).baseTerms ?? null,
    latePosts: (line.breakdown as { latePosts?: number }).latePosts ?? 0,
    bonusPosts: items.filter((i) => i.lineId === line.id),
    adjustments: adjustments
      .filter((a) => a.creatorId === line.creatorId)
      .map((a) => ({ id: a.id, amountCents: a.amountCents, reason: a.reason })),
    lineId: line.id,
    status: line.status,
    paymentRef: line.paymentRef,
  }))
}

export async function getCycleView(
  campaignId: string,
  periodStart: string | null,
  now: Date,
  executor: Executor = db
): Promise<CycleView | null> {
  const campaign = await loadCampaign(executor, campaignId)
  if (!campaign) return null
  const cycle = cycleFor(campaign, periodStart, now)
  const stored = await storedCycle(executor, campaign, cycle)
  const finalizeFrom = startOfLocalDay(cycle.periodEnd, cycle.timezone)
  const { blocked, held } = await attentionPosts(executor, campaign, cycle, now)

  const { lines, rules } = stored
    ? { lines: await readStored(executor, stored.id), rules: stored.rulesSnapshot as CampaignRules }
    : await computeLive(executor, campaign, cycle)

  return {
    campaign,
    cycle,
    rules,
    payday: paydayFor(cycle, campaign.paydayRule),
    status: stored ? stored.status : "preview",
    cycleId: stored?.id ?? null,
    canFinalize: !stored && now >= finalizeFrom,
    finalizeFrom,
    lines,
    totals: stored
      ? {
          baseCents: stored.baseCents,
          bonusCents: stored.bonusCents,
          adjustmentsCents: stored.adjustmentsCents,
          totalCents: stored.totalCents,
        }
      : sumTotals(lines),
    blocked: stored ? [] : blocked,
    held,
    milestones: stored ? [] : await milestoneRows(executor, campaign, cycle, rules, lines, now),
  }
}

export class PayoutError extends Error {}

// Settles a cycle: re-runs the engine inside the transaction and freezes the result.
export async function finalizeCycle(
  tx: Tx,
  input: { campaignId: string; periodStart: string; rollUnresolved: boolean; userId: string | null; now: Date }
) {
  const campaign = await loadCampaign(tx, input.campaignId)
  if (!campaign) throw new PayoutError("This campaign no longer exists.")
  const cycle = cycleFor(campaign, input.periodStart, input.now)
  if (await storedCycle(tx, campaign, cycle)) throw new PayoutError("This cycle is already finalized.")
  if (input.now < startOfLocalDay(cycle.periodEnd, cycle.timezone)) {
    throw new PayoutError("A cycle can be finalized from its last day onward.")
  }

  const { blocked } = await attentionPosts(tx, campaign, cycle, input.now)
  if (blocked.length && !input.rollUnresolved) {
    throw new PayoutError(
      `${blocked.length} ${blocked.length === 1 ? "video has" : "videos have"} a closed window but no usable lock. Resolve them, or choose to roll them into the next cycle.`
    )
  }

  const { rules, lines, adjustmentIds } = await computeLive(tx, campaign, cycle)
  const payable = lines.filter(
    (l) => l.payout.totalCents !== 0 || l.payout.postsPublished > 0 || l.bonusPosts.length > 0
  )
  const totals = sumTotals(payable)

  const [stored] = await tx
    .insert(payoutCycles)
    .values({
      campaignId: campaign.id,
      cycleType: cycle.cycleType,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      timezone: cycle.timezone,
      status: "finalized",
      rulesSnapshot: rules,
      engineVersion: ENGINE_VERSION,
      ...totals,
      finalizedBy: input.userId,
    })
    .returning()

  for (const line of payable) {
    const p = line.payout
    const [row] = await tx
      .insert(payoutLines)
      .values({
        cycleId: stored.id,
        creatorId: line.creatorId,
        baseCents: p.baseCents,
        bonusCents: p.bonusCents,
        adjustmentsCents: p.adjustmentsCents,
        capReductionCents: p.capReductionCents,
        totalCents: p.totalCents,
        postsPublished: p.postsPublished,
        postsDelivered: p.postsDelivered,
        quota: p.quota,
        milestoneTierViews: p.tier?.views ?? null,
        milestoneTierAmountCents: p.tier?.amountCents ?? null,
        bestPostId: p.bestPostId,
        breakdown: {
          payout: p,
          hasOverrides: line.hasOverrides,
          baseTerms: line.baseTerms,
          latePosts: line.latePosts,
          milestoneCents: p.bonusItems.reduce((sum, item) => sum + item.milestoneCents, 0),
        },
      })
      .returning({ id: payoutLines.id })

    const byId = new Map(line.bonusPosts.map((post) => [post.id, post]))
    const items = [
      ...p.basePostIds.map((postId) => ({
        cycleId: stored.id,
        lineId: row.id,
        creatorId: line.creatorId,
        postId,
        kind: "base" as const,
        amountCents: 0,
      })),
      // Every post in the pool is settled, including the $0 ones, so it can never compete for a
      // milestone again in a later cycle.
      ...p.bonusItems.map((item) => ({
        cycleId: stored.id,
        lineId: row.id,
        creatorId: line.creatorId,
        postId: item.postId,
        kind: "bonus" as const,
        lockedViews: byId.get(item.postId)?.lockedViews ?? null,
        paidViews: byId.get(item.postId)?.paidViews ?? null,
        payableViews: item.payableViews,
        amountCents: item.amountCents,
        detail: item,
      })),
    ]
    for (let i = 0; i < items.length; i += 500) await tx.insert(payoutItems).values(items.slice(i, i + 500))

    if (p.basePostIds.length) {
      await tx.update(posts).set({ baseCycleId: stored.id }).where(inArray(posts.id, p.basePostIds))
    }
    const bonusIds = p.bonusItems.map((item) => item.postId)
    if (bonusIds.length) {
      await tx.update(posts).set({ bonusCycleId: stored.id }).where(inArray(posts.id, bonusIds))
    }
  }

  if (adjustmentIds.length) {
    await tx
      .update(payoutAdjustments)
      .set({ cycleId: stored.id })
      .where(inArray(payoutAdjustments.id, adjustmentIds))
  }

  return { cycleId: stored.id, totals, lines: payable.length, rolled: blocked.length }
}

// Marks one creator's line (or, with no lineId, the whole cycle) as paid and flips the settled
// videos to `paid`. The cycle itself becomes `paid` once every line is.
export async function markPaid(
  tx: Tx,
  input: { cycleId: string; lineId: string | null; paymentRef: string | null; userId: string | null; now: Date }
) {
  const [cycle] = await tx.select().from(payoutCycles).where(eq(payoutCycles.id, input.cycleId)).limit(1)
  if (!cycle) throw new PayoutError("This cycle no longer exists.")

  const target = and(
    eq(payoutLines.cycleId, cycle.id),
    eq(payoutLines.status, "unpaid"),
    input.lineId ? eq(payoutLines.id, input.lineId) : undefined
  )
  const paidLines = await tx
    .update(payoutLines)
    .set({ status: "paid", paidAt: input.now, paymentRef: input.paymentRef })
    .where(target)
    .returning({ id: payoutLines.id, creatorId: payoutLines.creatorId })
  if (!paidLines.length) throw new PayoutError("There is nothing left to mark as paid.")

  await tx
    .update(posts)
    .set({ status: "paid", paidAt: input.now })
    .where(
      and(
        eq(posts.bonusCycleId, cycle.id),
        inArray(
          posts.creatorId,
          paidLines.map((l) => l.creatorId)
        )
      )
    )

  const [{ unpaid }] = await tx
    .select({ unpaid: sql<number>`count(*)::int` })
    .from(payoutLines)
    .where(and(eq(payoutLines.cycleId, cycle.id), eq(payoutLines.status, "unpaid")))
  if (unpaid === 0) {
    await tx
      .update(payoutCycles)
      .set({ status: "paid", paidAt: input.now, paidBy: input.userId, paymentNote: input.paymentRef })
      .where(eq(payoutCycles.id, cycle.id))
  }
  return { paidLines: paidLines.length, cyclePaid: unpaid === 0 }
}

// Undoes a finalize so the cycle can be corrected. Not possible once any line is paid.
export async function reopenCycle(tx: Tx, cycleId: string) {
  const [cycle] = await tx.select().from(payoutCycles).where(eq(payoutCycles.id, cycleId)).limit(1)
  if (!cycle) throw new PayoutError("This cycle no longer exists.")
  const [{ paid }] = await tx
    .select({ paid: sql<number>`count(*)::int` })
    .from(payoutLines)
    .where(and(eq(payoutLines.cycleId, cycleId), eq(payoutLines.status, "paid")))
  if (cycle.status === "paid" || paid > 0) {
    throw new PayoutError("Part of this cycle is already paid, so it can no longer be reopened.")
  }
  // Lines and items cascade; posts.base/bonus_cycle_id and adjustments.cycle_id are set null.
  await tx.delete(payoutCycles).where(eq(payoutCycles.id, cycleId))
  return cycle
}

export async function listStoredCycles(campaignId?: string) {
  return db
    .select({
      id: payoutCycles.id,
      campaignId: payoutCycles.campaignId,
      campaignName: campaigns.name,
      campaignTimezone: campaigns.timezone,
      cycleType: payoutCycles.cycleType,
      periodStart: payoutCycles.periodStart,
      periodEnd: payoutCycles.periodEnd,
      status: payoutCycles.status,
      totalCents: payoutCycles.totalCents,
      finalizedAt: payoutCycles.finalizedAt,
      paidAt: payoutCycles.paidAt,
      lineCount: sql<number>`(select count(*)::int from ${payoutLines} l where l.cycle_id = ${outerRef(payoutCycles.id)})`,
    })
    .from(payoutCycles)
    .innerJoin(campaigns, eq(campaigns.id, payoutCycles.campaignId))
    .where(campaignId ? eq(payoutCycles.campaignId, campaignId) : undefined)
    .orderBy(sql`${payoutCycles.periodStart} desc`, asc(campaigns.name))
}
