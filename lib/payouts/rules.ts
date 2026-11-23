import { divRoundHalfUp } from "@/lib/money/cents"

import type {
  BaseType,
  BonusType,
  CampaignRules,
  CreatorOverrides,
  CycleType,
  Milestone,
  MilestoneScope,
  MinViewsMode,
  Platform,
  QuotaPeriod,
  QuotaScope,
} from "./types"

// The slice of a `campaigns` row the engine needs. Structural on purpose: importing the Drizzle
// table would drag the database into these pure modules. A full row is assignable to it.
export type CampaignRulesRow = {
  cycleType: CycleType
  timezone: string
  weekStartsOn: number
  platforms: Platform[]
  quotaCount: number | null
  quotaPeriod: QuotaPeriod
  quotaScope: QuotaScope
  baseType: BaseType
  baseAmountCents: number
  prorateBase: boolean
  bonusType: BonusType
  cpmRateCents: number | null
  minViewsForBonus: number | null
  cpmMinViewsMode: MinViewsMode
  milestones: Milestone[]
  milestoneScope: MilestoneScope
  perVideoBonusCapCents: number | null
  perCreatorCycleCapCents: number | null
  perCreatorCycleTotalCapCents: number | null
}

// Ascending by views, one tier per view count. When two tiers share a view count the larger
// amount wins, so the result does not depend on the order they were saved in.
export function normalizeMilestones(milestones: readonly Milestone[]): Milestone[] {
  const amountByViews = new Map<number, number>()
  for (const { views, amountCents } of milestones) {
    const current = amountByViews.get(views)
    if (current === undefined || amountCents > current) amountByViews.set(views, amountCents)
  }
  return [...amountByViews.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([views, amountCents]) => ({ views, amountCents }))
}

export function campaignRowToRules(row: CampaignRulesRow): CampaignRules {
  return {
    cycleType: row.cycleType,
    timezone: row.timezone,
    weekStartsOn: row.weekStartsOn,
    // A platform listed twice must not count twice toward the quota.
    platforms: [...new Set(row.platforms ?? [])],
    quota: { count: row.quotaCount ?? null, period: row.quotaPeriod, scope: row.quotaScope },
    base: { type: row.baseType, amountCents: row.baseAmountCents, prorate: row.prorateBase },
    bonus: {
      type: row.bonusType,
      cpmRateCents: row.cpmRateCents ?? null,
      minViews: row.minViewsForBonus ?? null,
      minViewsMode: row.cpmMinViewsMode,
      milestones: normalizeMilestones(row.milestones ?? []),
      milestoneScope: row.milestoneScope,
    },
    caps: {
      perVideoBonusCents: row.perVideoBonusCapCents ?? null,
      perCreatorCycleBonusCents: row.perCreatorCycleCapCents ?? null,
      perCreatorCycleTotalCents: row.perCreatorCycleTotalCapCents ?? null,
    },
  }
}

// Returns a deep copy with the creator's non-null overrides applied. 0 is a real override
// (no base pay, no bonus); only null / undefined mean "use the campaign's value".
export function applyCreatorOverrides(
  rules: CampaignRules,
  overrides: CreatorOverrides | null | undefined
): CampaignRules {
  return {
    ...rules,
    platforms: [...rules.platforms],
    quota: { ...rules.quota, count: overrides?.quotaCount ?? rules.quota.count },
    base: { ...rules.base, amountCents: overrides?.baseAmountCents ?? rules.base.amountCents },
    bonus: { ...rules.bonus, milestones: rules.bonus.milestones.map((m) => ({ ...m })) },
    caps: {
      ...rules.caps,
      perCreatorCycleBonusCents:
        overrides?.cycleBonusCapCents ?? rules.caps.perCreatorCycleBonusCents,
    },
  }
}

// The highest tier whose threshold is reached. The boundary is inclusive: exactly 20,000 views
// earns the 20K tier, 19,999 earns nothing. Does not assume the tiers are sorted.
export function tierFor(milestones: readonly Milestone[], views: number): Milestone | null {
  let best: Milestone | null = null
  for (const tier of milestones) {
    if (tier.views > views) continue
    if (
      best === null ||
      tier.views > best.views ||
      (tier.views === best.views && tier.amountCents > best.amountCents)
    ) {
      best = tier
    }
  }
  return best
}

type QuotaRules = Pick<CampaignRules, "cycleType" | "platforms" | "quota">

// The quota count converted to one payout cycle, before the per-platform multiplication.
function quotaPerUnit(rules: QuotaRules, cycleDays: number): number | null {
  const { count, period } = rules.quota
  if (count === null) return null
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`quota.count must be a non-negative integer, got ${count}`)
  }
  if (!Number.isSafeInteger(cycleDays) || cycleDays <= 0) {
    throw new RangeError(`cycleDays must be a positive integer, got ${cycleDays}`)
  }
  if (period === "month" && rules.cycleType === "monthly") return count
  if (period === "week" && rules.cycleType === "weekly") return count
  // A weekly quota in a monthly cycle scales with the real length of that month.
  if (period === "week") return divRoundHalfUp(count * cycleDays, 7)
  // A monthly quota in a weekly cycle uses a nominal 30-day month.
  return divRoundHalfUp(count * 7, 30)
}

// Posts expected from one creator in a cycle of `cycleDays` days; null = no quota. With
// best_platform it counts videos, not posts: 60 videos cross-posted is a quota of 60.
export function expectedQuota(rules: QuotaRules, cycleDays: number): number | null {
  const perUnit = quotaPerUnit(rules, cycleDays)
  if (perUnit === null) return null
  if (rules.quota.scope !== "per_platform") return perUnit
  return perUnit * Math.max(1, new Set(rules.platforms).size)
}

// Posts expected on EACH enabled platform; null when the quota is a single total (or unset).
export function quotaPerPlatform(rules: QuotaRules, cycleDays: number): number | null {
  if (rules.quota.scope === "total") return null
  return quotaPerUnit(rules, cycleDays)
}

function assertAmount(value: number | null, path: string, nullable: boolean) {
  if (value === null && nullable) return
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${path} must be a non-negative integer${nullable ? " or null" : ""}, got ${value}`)
  }
}

// The engine refuses to compute money from terms that are not whole, non-negative numbers
// (a float cent amount, NaN from a bad parse, a negative cap). Rules normally come from integer
// columns, but a rules snapshot read back from jsonb has no such guarantee.
export function assertValidRules(rules: CampaignRules): void {
  if (!Array.isArray(rules.platforms)) throw new RangeError("rules.platforms must be an array")
  if (!Array.isArray(rules.bonus.milestones)) {
    throw new RangeError("rules.bonus.milestones must be an array")
  }
  assertAmount(rules.quota.count, "rules.quota.count", true)
  assertAmount(rules.base.amountCents, "rules.base.amountCents", false)
  assertAmount(rules.bonus.cpmRateCents, "rules.bonus.cpmRateCents", true)
  assertAmount(rules.bonus.minViews, "rules.bonus.minViews", true)
  rules.bonus.milestones.forEach((tier, i) => {
    assertAmount(tier.views, `rules.bonus.milestones[${i}].views`, false)
    assertAmount(tier.amountCents, `rules.bonus.milestones[${i}].amountCents`, false)
  })
  assertAmount(rules.caps.perVideoBonusCents, "rules.caps.perVideoBonusCents", true)
  assertAmount(rules.caps.perCreatorCycleBonusCents, "rules.caps.perCreatorCycleBonusCents", true)
  assertAmount(rules.caps.perCreatorCycleTotalCents, "rules.caps.perCreatorCycleTotalCents", true)
}
