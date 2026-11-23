import { divRoundHalfUp } from "@/lib/money/cents"

import type { Cycle } from "./cycles"
import { assertValidRules, expectedQuota, quotaPerPlatform, tierFor } from "./rules"
import type { CampaignRules, Milestone, Platform } from "./types"

// Stored with every finalized cycle. Bump it whenever a change could alter an amount, so an old
// cycle can always be told apart from one computed by the new rules.
export const ENGINE_VERSION = 1

// payableViews already has paid (ad) views subtracted.
export type EnginePost = { id: string; platform: Platform; postedAt: Date; payableViews: number }

export type CreatorPayoutInput = {
  // Already merged with the creator's overrides.
  rules: CampaignRules
  cycle: Cycle
  // Posts PUBLISHED inside the cycle (not excluded) → base pay and quota. payableViews may be 0.
  publishedPosts: EnginePost[]
  // Posts whose window closed by the cycle end: locked, not excluded, not flagged for review,
  // never bonus-settled before. Often published in an earlier cycle.
  bonusPosts: EnginePost[]
  // Milestone bonus already paid to this creator in this campaign in earlier cycles. Only used
  // by the creator_campaign_lifetime scope.
  priorMilestonePaidCents: number
  // Manual +/- corrections. Added after the caps and never capped.
  adjustmentsCents: number
}

export type BonusItem = {
  postId: string
  payableViews: number
  // What the post earned before any cap.
  cpmCents: number
  milestoneCents: number
  // cpmCents + milestoneCents after the per-video cap. Creator-level cap reductions are NOT
  // spread across items.
  amountCents: number
  tierViews: number | null
  isBest: boolean
}

export type CreatorPayout = {
  baseCents: number
  // After every cap.
  bonusCents: number
  // Σ bonusItems.amountCents: after the per-video cap, before the two creator-level caps.
  bonusBeforeCapsCents: number
  // Everything the three caps removed, from the bonus and (total cap only) from the base.
  capReductionCents: number
  adjustmentsCents: number
  totalCents: number
  postsPublished: number
  postsDelivered: number
  quota: number | null
  // What counts on each platform. Adds up to postsDelivered, except with the best_platform quota,
  // where postsDelivered is the largest of them.
  deliveredByPlatform: Partial<Record<Platform, number>>
  publishedByPlatform: Partial<Record<Platform, number>>
  bestPostId: string | null
  tier: Milestone | null
  // ONE item for EVERY bonus post, in input order, including $0 ones: they are all settled, so
  // none of them can compete again in a later cycle.
  bonusItems: BonusItem[]
  // Every published post id, in input order. Each is settled for base pay exactly once.
  basePostIds: string[]
}

function assertInteger(value: number, name: string, allowNegative = false) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new RangeError(
      `${name} must be ${allowNegative ? "an" : "a non-negative"} integer, got ${value}`
    )
  }
}

// A join that fans out (post × snapshot, post × ad) is the classic way to pay a post twice.
// The payout_items unique indexes would stop the second row, but not the inflated line total.
function assertPosts(posts: EnginePost[], name: string, withViews: boolean) {
  if (!Array.isArray(posts)) throw new RangeError(`${name} must be an array`)
  const seen = new Set<string>()
  for (const post of posts) {
    if (typeof post.id !== "string" || post.id === "") {
      throw new RangeError(`${name} contains a post without an id`)
    }
    if (seen.has(post.id)) throw new RangeError(`${name} contains post ${post.id} twice`)
    seen.add(post.id)
    if (!(post.postedAt instanceof Date) || Number.isNaN(post.postedAt.getTime())) {
      throw new RangeError(`${name}: post ${post.id} has an invalid postedAt`)
    }
    if (withViews) assertInteger(post.payableViews, `${name}: payableViews of post ${post.id}`)
  }
}

function assertValidInput(input: CreatorPayoutInput) {
  assertValidRules(input.rules)
  if (input.cycle.cycleType !== input.rules.cycleType) {
    throw new RangeError(
      `The cycle is ${input.cycle.cycleType} but the rules are for a ${input.rules.cycleType} cycle`
    )
  }
  // Published posts only count; their views are never read.
  assertPosts(input.publishedPosts, "publishedPosts", false)
  assertPosts(input.bonusPosts, "bonusPosts", true)
  assertInteger(input.priorMilestonePaidCents, "priorMilestonePaidCents")
  assertInteger(input.adjustmentsCents, "adjustmentsCents", true)
}

function compareIds(a: string, b: string): number {
  // Code-unit order. localeCompare would depend on the runtime's locale data.
  return a < b ? -1 : a > b ? 1 : 0
}

function compareOldestFirst(a: EnginePost, b: EnginePost): number {
  return a.postedAt.getTime() - b.postedAt.getTime() || compareIds(a.id, b.id)
}

// Most payable views, then the earliest post, then the smallest id. A total order, so the best
// post never depends on the order the posts were passed in.
function compareBestFirst(a: EnginePost, b: EnginePost): number {
  if (a.payableViews !== b.payableViews) return a.payableViews > b.payableViews ? -1 : 1
  return compareOldestFirst(a, b)
}

function countByPlatform(posts: EnginePost[], seed: Platform[]): Partial<Record<Platform, number>> {
  const counts: Partial<Record<Platform, number>> = {}
  for (const platform of seed) counts[platform] = 0
  for (const post of posts) counts[post.platform] = (counts[post.platform] ?? 0) + 1
  return counts
}

type Delivery = {
  delivered: number
  quota: number | null
  deliveredByPlatform: Partial<Record<Platform, number>>
  publishedByPlatform: Partial<Record<Platform, number>>
}

function countDelivery(rules: CampaignRules, cycle: Cycle, published: EnginePost[]): Delivery {
  const enabled = [...new Set(rules.platforms)]
  const quota = expectedQuota(rules, cycle.days)
  const publishedByPlatform = countByPlatform(published, enabled)

  if (rules.quota.scope === "per_platform" || rules.quota.scope === "best_platform") {
    // Each enabled platform is clamped on its own. Per platform, the counts add up, so extra posts
    // on one platform never make up for a shortfall on another. Best platform, the largest count is
    // the number of videos delivered. Posts on a platform the campaign has not enabled do not count.
    const perPlatform = quotaPerPlatform(rules, cycle.days)
    const best = rules.quota.scope === "best_platform"
    const deliveredByPlatform: Partial<Record<Platform, number>> = {}
    let delivered = 0
    for (const platform of enabled) {
      const count = publishedByPlatform[platform] ?? 0
      const counted = perPlatform === null ? count : Math.min(count, perPlatform)
      deliveredByPlatform[platform] = counted
      delivered = best ? Math.max(delivered, counted) : delivered + counted
    }
    return { delivered, quota, deliveredByPlatform, publishedByPlatform }
  }

  if (rules.quota.scope === "total") {
    if (quota === null || published.length <= quota) {
      return {
        delivered: published.length,
        quota,
        deliveredByPlatform: { ...publishedByPlatform },
        publishedByPlatform,
      }
    }
    // Over quota: the earliest posts are the ones that filled it. This only decides how the
    // delivered count splits by platform; the amount depends on the count alone.
    const counted = [...published].sort(compareOldestFirst).slice(0, quota)
    return {
      delivered: quota,
      quota,
      deliveredByPlatform: countByPlatform(counted, enabled),
      publishedByPlatform,
    }
  }

  throw new RangeError(`Unknown quota scope "${String(rules.quota.scope)}"`)
}

export function computeBase(
  rules: Pick<CampaignRules, "base">,
  delivered: number,
  quota: number | null
): number {
  const { type, amountCents, prorate } = rules.base
  switch (type) {
    case "none":
      return 0
    case "per_video":
      return amountCents * delivered
    case "weekly_retainer":
    case "monthly_retainer":
      // Without a positive quota there is nothing to pro-rate against: the retainer is paid in
      // full. One multiplication, then one exact division; delivered never exceeds the quota,
      // and the clamp keeps the result at or below the retainer whatever happens.
      if (!prorate || quota === null || quota <= 0) return amountCents
      return Math.min(amountCents, divRoundHalfUp(amountCents * delivered, quota))
    default:
      throw new RangeError(`Unknown base type "${String(type)}"`)
  }
}

function cpmFor(rules: CampaignRules, payableViews: number): number {
  const { cpmRateCents, minViews, minViewsMode } = rules.bonus
  if (cpmRateCents === null) return 0
  if (minViews !== null && payableViews < minViews) return 0
  let billable: number
  switch (minViewsMode) {
    case "qualify":
      billable = payableViews
      break
    case "excess":
      billable = payableViews - (minViews ?? 0)
      break
    default:
      throw new RangeError(`Unknown minimum-views mode "${String(minViewsMode)}"`)
  }
  // floor((billable × rate + 500) / 1000): half a cent rounds up, in integer maths only.
  return divRoundHalfUp(billable * cpmRateCents, 1000)
}

export function computeCreatorPayout(input: CreatorPayoutInput): CreatorPayout {
  assertValidInput(input)
  const { rules, cycle, publishedPosts, bonusPosts, priorMilestonePaidCents, adjustmentsCents } =
    input

  const { delivered, quota, deliveredByPlatform, publishedByPlatform } = countDelivery(
    rules,
    cycle,
    publishedPosts
  )
  const baseBeforeCaps = computeBase(rules, delivered, quota)

  const usesCpm = rules.bonus.type === "cpm" || rules.bonus.type === "hybrid"
  const usesMilestones = rules.bonus.type === "milestone" || rules.bonus.type === "hybrid"
  if (!usesCpm && !usesMilestones && rules.bonus.type !== "none") {
    throw new RangeError(`Unknown bonus type "${String(rules.bonus.type)}"`)
  }

  const best = bonusPosts.length > 0 ? [...bonusPosts].sort(compareBestFirst)[0] : null
  const bestTier = best && usesMilestones ? tierFor(rules.bonus.milestones, best.payableViews) : null

  const milestoneFor = (post: EnginePost): { cents: number; tier: Milestone | null } => {
    if (!usesMilestones) return { cents: 0, tier: null }
    switch (rules.bonus.milestoneScope) {
      case "per_video": {
        const tier = tierFor(rules.bonus.milestones, post.payableViews)
        return { cents: tier?.amountCents ?? 0, tier }
      }
      case "creator_cycle_best":
        // Non-stacking: only the single best post earns its tier.
        if (post !== best || bestTier === null) return { cents: 0, tier: null }
        return { cents: bestTier.amountCents, tier: bestTier }
      case "creator_campaign_lifetime":
        // A creator is paid each tier once per campaign: the best post tops up what earlier
        // cycles already paid, and never claws anything back.
        if (post !== best || bestTier === null) return { cents: 0, tier: null }
        return {
          cents: Math.max(0, bestTier.amountCents - priorMilestonePaidCents),
          tier: bestTier,
        }
      default:
        throw new RangeError(`Unknown milestone scope "${String(rules.bonus.milestoneScope)}"`)
    }
  }

  // Cap 1: per video.
  const perVideoCap = rules.caps.perVideoBonusCents
  let bonusUncapped = 0
  const bonusItems = bonusPosts.map((post): BonusItem => {
    const cpmCents = usesCpm ? cpmFor(rules, post.payableViews) : 0
    const milestone = milestoneFor(post)
    const earned = cpmCents + milestone.cents
    bonusUncapped += earned
    return {
      postId: post.id,
      payableViews: post.payableViews,
      cpmCents,
      milestoneCents: milestone.cents,
      amountCents: perVideoCap === null ? earned : Math.min(earned, perVideoCap),
      tierViews: milestone.tier?.views ?? null,
      isBest: post === best,
    }
  })
  const bonusBeforeCapsCents = bonusItems.reduce((sum, item) => sum + item.amountCents, 0)

  // Cap 2: the creator's bonus for the cycle.
  const bonusCap = rules.caps.perCreatorCycleBonusCents
  let bonusCents = bonusCap === null ? bonusBeforeCapsCents : Math.min(bonusBeforeCapsCents, bonusCap)

  // Cap 3: base + bonus together. The bonus gives way first; the base is only touched when it
  // exceeds the cap on its own.
  let baseCents = baseBeforeCaps
  const totalCap = rules.caps.perCreatorCycleTotalCents
  if (totalCap !== null && baseCents + bonusCents > totalCap) {
    const excess = baseCents + bonusCents - totalCap
    const fromBonus = Math.min(bonusCents, excess)
    bonusCents -= fromBonus
    baseCents -= excess - fromBonus
  }

  const payout: CreatorPayout = {
    baseCents,
    bonusCents,
    bonusBeforeCapsCents,
    capReductionCents: baseBeforeCaps + bonusUncapped - (baseCents + bonusCents),
    adjustmentsCents,
    // Adjustments come last and are never capped.
    totalCents: baseCents + bonusCents + adjustmentsCents,
    postsPublished: publishedPosts.length,
    postsDelivered: delivered,
    quota,
    deliveredByPlatform,
    publishedByPlatform,
    bestPostId: best?.id ?? null,
    tier: bestTier,
    bonusItems,
    basePostIds: publishedPosts.map((post) => post.id),
  }
  assertIntegerAmounts(payout)
  return payout
}

// Last line of defence: an amount that is not a whole number of cents (NaN, a float, or an
// integer too large to be exact) must never leave the engine.
function assertIntegerAmounts(payout: CreatorPayout) {
  const amounts: Record<string, number> = {
    baseCents: payout.baseCents,
    bonusCents: payout.bonusCents,
    bonusBeforeCapsCents: payout.bonusBeforeCapsCents,
    capReductionCents: payout.capReductionCents,
    adjustmentsCents: payout.adjustmentsCents,
    totalCents: payout.totalCents,
    postsDelivered: payout.postsDelivered,
  }
  payout.bonusItems.forEach((item, i) => {
    amounts[`bonusItems[${i}].cpmCents`] = item.cpmCents
    amounts[`bonusItems[${i}].milestoneCents`] = item.milestoneCents
    amounts[`bonusItems[${i}].amountCents`] = item.amountCents
  })
  for (const [name, value] of Object.entries(amounts)) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Payout engine produced a non-integer ${name}: ${value}`)
    }
  }
}

export type CyclePayout = {
  lines: { creatorId: string; payout: CreatorPayout }[]
  totals: { baseCents: number; bonusCents: number; adjustmentsCents: number; totalCents: number }
}

// One line per creator, in input order, plus the cycle totals.
export function computeCyclePayout(
  creators: { creatorId: string; input: CreatorPayoutInput }[]
): CyclePayout {
  const seen = new Set<string>()
  const totals = { baseCents: 0, bonusCents: 0, adjustmentsCents: 0, totalCents: 0 }
  const lines = creators.map(({ creatorId, input }) => {
    if (seen.has(creatorId)) throw new RangeError(`Creator ${creatorId} appears twice in the cycle`)
    seen.add(creatorId)
    const payout = computeCreatorPayout(input)
    totals.baseCents += payout.baseCents
    totals.bonusCents += payout.bonusCents
    totals.adjustmentsCents += payout.adjustmentsCents
    totals.totalCents += payout.totalCents
    return { creatorId, payout }
  })
  return { lines, totals }
}
