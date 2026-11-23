import { describe, expect, it } from "vitest"

import type { campaigns } from "@/db/schema/core"

import {
  type CampaignRulesRow,
  applyCreatorOverrides,
  assertValidRules,
  campaignRowToRules,
  expectedQuota,
  normalizeMilestones,
  quotaPerPlatform,
  tierFor,
} from "../rules"
import type { CampaignRules } from "../types"
import { CONTRACT_MILESTONES, contractRules } from "./fixtures"

// Compile-time only: a real Drizzle campaign row must stay assignable to the structural row type
// (rules.ts deliberately does not import the schema). Fails `tsc` if a column is renamed.
type CampaignRow = typeof campaigns.$inferSelect
const acceptsRealRow = (row: CampaignRow): CampaignRulesRow => row
void acceptsRealRow

function contractRow(patch: Partial<CampaignRulesRow> = {}): CampaignRulesRow {
  return {
    cycleType: "monthly",
    timezone: "America/New_York",
    weekStartsOn: 1,
    platforms: ["tiktok", "instagram"],
    quotaCount: 60,
    quotaPeriod: "month",
    quotaScope: "per_platform",
    baseType: "monthly_retainer",
    baseAmountCents: 100_000,
    prorateBase: true,
    bonusType: "milestone",
    cpmRateCents: null,
    minViewsForBonus: null,
    cpmMinViewsMode: "qualify",
    milestones: CONTRACT_MILESTONES,
    milestoneScope: "creator_cycle_best",
    perVideoBonusCapCents: null,
    perCreatorCycleCapCents: 100_000,
    perCreatorCycleTotalCapCents: null,
    ...patch,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

describe("campaignRowToRules", () => {
  it("maps the contract row to the contract rules", () => {
    expect(campaignRowToRules(contractRow())).toEqual(contractRules())
  })

  it("maps every column to its place", () => {
    const rules = campaignRowToRules(
      contractRow({
        cycleType: "weekly",
        timezone: "Europe/London",
        weekStartsOn: 0,
        platforms: ["youtube"],
        quotaCount: null,
        quotaPeriod: "week",
        quotaScope: "total",
        baseType: "per_video",
        baseAmountCents: 1500,
        prorateBase: false,
        bonusType: "hybrid",
        cpmRateCents: 300,
        minViewsForBonus: 10_000,
        cpmMinViewsMode: "excess",
        milestones: [{ views: 1000, amountCents: 100 }],
        milestoneScope: "per_video",
        perVideoBonusCapCents: 111,
        perCreatorCycleCapCents: 222,
        perCreatorCycleTotalCapCents: 333,
      })
    )
    expect(rules).toEqual({
      cycleType: "weekly",
      timezone: "Europe/London",
      weekStartsOn: 0,
      platforms: ["youtube"],
      quota: { count: null, period: "week", scope: "total" },
      base: { type: "per_video", amountCents: 1500, prorate: false },
      bonus: {
        type: "hybrid",
        cpmRateCents: 300,
        minViews: 10_000,
        minViewsMode: "excess",
        milestones: [{ views: 1000, amountCents: 100 }],
        milestoneScope: "per_video",
      },
      caps: { perVideoBonusCents: 111, perCreatorCycleBonusCents: 222, perCreatorCycleTotalCents: 333 },
    } satisfies CampaignRules)
  })

  it("accepts a full database row with extra columns", () => {
    const row = { ...contractRow(), id: "c1", name: "Launch", currency: "USD", defaultWindowDays: 14 }
    expect(campaignRowToRules(row)).toEqual(contractRules())
  })

  it("sorts milestones ascending and keeps the larger amount of duplicates", () => {
    const rules = campaignRowToRules(
      contractRow({
        milestones: [
          { views: 100_000, amountCents: 10_000 },
          { views: 20_000, amountCents: 1_500 },
          { views: 1_000_000, amountCents: 100_000 },
          { views: 20_000, amountCents: 2_000 },
          { views: 50_000, amountCents: 5_000 },
          { views: 20_000, amountCents: 1_000 },
        ],
      })
    )
    expect(rules.bonus.milestones).toEqual([
      { views: 20_000, amountCents: 2_000 },
      { views: 50_000, amountCents: 5_000 },
      { views: 100_000, amountCents: 10_000 },
      { views: 1_000_000, amountCents: 100_000 },
    ])
  })

  it("does not share or mutate the row's arrays", () => {
    const reversed = CONTRACT_MILESTONES.map((m) => ({ ...m })).reverse()
    const row = deepFreeze(contractRow({ milestones: reversed }))
    const rules = campaignRowToRules(row)
    expect(rules.bonus.milestones).not.toBe(row.milestones)
    expect(rules.platforms).not.toBe(row.platforms)
    expect(row.milestones[0].views).toBe(1_000_000)
  })

  it("lists each platform once", () => {
    const rules = campaignRowToRules(contractRow({ platforms: ["tiktok", "instagram", "tiktok"] }))
    expect(rules.platforms).toEqual(["tiktok", "instagram"])
  })
})

describe("normalizeMilestones", () => {
  it("is idempotent and handles an empty list", () => {
    expect(normalizeMilestones([])).toEqual([])
    const once = normalizeMilestones([...CONTRACT_MILESTONES].reverse())
    expect(once).toEqual(CONTRACT_MILESTONES)
    expect(normalizeMilestones(once)).toEqual(once)
  })
})

describe("applyCreatorOverrides", () => {
  it("applies the base amount, quota and bonus cap overrides", () => {
    const rules = applyCreatorOverrides(contractRules(), {
      baseAmountCents: 150_000,
      quotaCount: 30,
      cycleBonusCapCents: 50_000,
    })
    expect(rules.base).toEqual({ type: "monthly_retainer", amountCents: 150_000, prorate: true })
    expect(rules.quota).toEqual({ count: 30, period: "month", scope: "per_platform" })
    expect(rules.caps).toEqual({
      perVideoBonusCents: null,
      perCreatorCycleBonusCents: 50_000,
      perCreatorCycleTotalCents: null,
    })
    expect(expectedQuota(rules, 31)).toBe(60)
  })

  it("does not mutate its input and returns an independent copy", () => {
    const original = deepFreeze(contractRules())
    const snapshot = structuredClone(original)
    const result = applyCreatorOverrides(original, { baseAmountCents: 1, quotaCount: 2, cycleBonusCapCents: 3 })
    expect(original).toEqual(snapshot)
    expect(result).not.toBe(original)
    expect(result.base).not.toBe(original.base)
    expect(result.quota).not.toBe(original.quota)
    expect(result.caps).not.toBe(original.caps)
    expect(result.bonus).not.toBe(original.bonus)
    expect(result.bonus.milestones).not.toBe(original.bonus.milestones)
    expect(result.bonus.milestones[0]).not.toBe(original.bonus.milestones[0])
    expect(result.platforms).not.toBe(original.platforms)
    // Changing the copy leaves the campaign's rules alone.
    result.bonus.milestones[0].amountCents = 999
    result.platforms.push("youtube")
    expect(original).toEqual(snapshot)
  })

  it("leaves everything as it is when there are no overrides", () => {
    const rules = contractRules()
    expect(applyCreatorOverrides(rules, {})).toEqual(rules)
    expect(applyCreatorOverrides(rules, null)).toEqual(rules)
    expect(applyCreatorOverrides(rules, undefined)).toEqual(rules)
    expect(
      applyCreatorOverrides(rules, { baseAmountCents: null, quotaCount: null, cycleBonusCapCents: null })
    ).toEqual(rules)
    expect(applyCreatorOverrides(rules, { baseAmountCents: undefined })).toEqual(rules)
  })

  it("treats 0 as a real override, not as missing", () => {
    const rules = applyCreatorOverrides(contractRules(), {
      baseAmountCents: 0,
      quotaCount: 0,
      cycleBonusCapCents: 0,
    })
    expect(rules.base.amountCents).toBe(0)
    expect(rules.quota.count).toBe(0)
    expect(rules.caps.perCreatorCycleBonusCents).toBe(0)
  })

  it("can set a cap or a quota the campaign does not have", () => {
    const campaign = contractRules({ quota: { count: null }, caps: { perCreatorCycleBonusCents: null } })
    const rules = applyCreatorOverrides(campaign, { quotaCount: 10, cycleBonusCapCents: 5_000 })
    expect(rules.quota.count).toBe(10)
    expect(rules.caps.perCreatorCycleBonusCents).toBe(5_000)
  })
})

describe("tierFor", () => {
  it("has an inclusive boundary", () => {
    expect(tierFor(CONTRACT_MILESTONES, 19_999)).toBeNull()
    expect(tierFor(CONTRACT_MILESTONES, 20_000)).toEqual({ views: 20_000, amountCents: 2_000 })
    expect(tierFor(CONTRACT_MILESTONES, 20_001)).toEqual({ views: 20_000, amountCents: 2_000 })
    expect(tierFor(CONTRACT_MILESTONES, 49_999)).toEqual({ views: 20_000, amountCents: 2_000 })
    expect(tierFor(CONTRACT_MILESTONES, 50_000)).toEqual({ views: 50_000, amountCents: 5_000 })
    expect(tierFor(CONTRACT_MILESTONES, 999_999)).toEqual({ views: 500_000, amountCents: 50_000 })
    expect(tierFor(CONTRACT_MILESTONES, 1_000_000)).toEqual({ views: 1_000_000, amountCents: 100_000 })
    expect(tierFor(CONTRACT_MILESTONES, 250_000_000)).toEqual({ views: 1_000_000, amountCents: 100_000 })
  })

  it("returns null for no views or no tiers", () => {
    expect(tierFor(CONTRACT_MILESTONES, 0)).toBeNull()
    expect(tierFor([], 1_000_000)).toBeNull()
  })

  it("does not depend on the order of the tiers", () => {
    const reversed = [...CONTRACT_MILESTONES].reverse()
    for (const views of [0, 19_999, 20_000, 75_000, 100_000, 600_000, 5_000_000]) {
      expect(tierFor(reversed, views)).toEqual(tierFor(CONTRACT_MILESTONES, views))
    }
  })

  it("takes the larger amount when a view count is listed twice", () => {
    const tiers = [
      { views: 20_000, amountCents: 1_000 },
      { views: 20_000, amountCents: 2_000 },
    ]
    expect(tierFor(tiers, 25_000)?.amountCents).toBe(2_000)
    expect(tierFor([...tiers].reverse(), 25_000)?.amountCents).toBe(2_000)
  })
})

describe("expectedQuota / quotaPerPlatform", () => {
  it("is 120 posts for the contract: 60 on each of two platforms", () => {
    expect(expectedQuota(contractRules(), 31)).toBe(120)
    expect(quotaPerPlatform(contractRules(), 31)).toBe(60)
  })

  it("is null without a quota", () => {
    const rules = contractRules({ quota: { count: null } })
    expect(expectedQuota(rules, 31)).toBeNull()
    expect(quotaPerPlatform(rules, 31)).toBeNull()
  })

  it("does not multiply a total quota by the platforms", () => {
    const rules = contractRules({ quota: { count: 60, scope: "total" } })
    expect(expectedQuota(rules, 31)).toBe(60)
    expect(quotaPerPlatform(rules, 31)).toBeNull()
  })

  it("counts a cross-posted quota in videos, with the same target on each platform", () => {
    const rules = contractRules({ quota: { count: 60, scope: "best_platform" } })
    expect(expectedQuota(rules, 31)).toBe(60)
    expect(quotaPerPlatform(rules, 31)).toBe(60)
  })

  it("scales a weekly quota to the real length of a monthly cycle", () => {
    const rules = contractRules({ quota: { count: 15, period: "week", scope: "total" } })
    expect(expectedQuota(rules, 28)).toBe(60)
    expect(expectedQuota(rules, 30)).toBe(64) // 64.29
    expect(expectedQuota(rules, 31)).toBe(66) // 66.43
    const perPlatform = contractRules({ quota: { count: 7, period: "week", scope: "per_platform" } })
    expect(quotaPerPlatform(perPlatform, 31)).toBe(31)
    expect(expectedQuota(perPlatform, 31)).toBe(62)
    // 1 × 31 / 7 = 4.43 → 4 ; 5 × 31 / 7 = 22.14 → 22 ; 5 × 30 / 7 = 21.43 → 21
    expect(expectedQuota(contractRules({ quota: { count: 1, period: "week", scope: "total" } }), 31)).toBe(4)
    expect(expectedQuota(contractRules({ quota: { count: 5, period: "week", scope: "total" } }), 31)).toBe(22)
  })

  it("scales a monthly quota to a weekly cycle on a 30-day month, rounding half up", () => {
    const weekly = (count: number) =>
      contractRules({ cycleType: "weekly", quota: { count, period: "month", scope: "total" } })
    expect(expectedQuota(weekly(60), 7)).toBe(14)
    expect(expectedQuota(weekly(30), 7)).toBe(7)
    expect(expectedQuota(weekly(15), 7)).toBe(4) // 3.5 → 4
    expect(expectedQuota(weekly(2), 7)).toBe(0) // 0.47 → 0
    expect(expectedQuota(weekly(3), 7)).toBe(1) // 0.7 → 1
    const perPlatform = contractRules({ cycleType: "weekly", quota: { count: 60, period: "month" } })
    expect(quotaPerPlatform(perPlatform, 7)).toBe(14)
    expect(expectedQuota(perPlatform, 7)).toBe(28)
  })

  it("passes a weekly quota straight through a weekly cycle", () => {
    const rules = contractRules({ cycleType: "weekly", quota: { count: 5, period: "week" } })
    expect(quotaPerPlatform(rules, 7)).toBe(5)
    expect(expectedQuota(rules, 7)).toBe(10)
  })

  it("counts a campaign without platforms as one platform, and each platform once", () => {
    expect(expectedQuota(contractRules({ platforms: [] }), 31)).toBe(60)
    expect(expectedQuota(contractRules({ platforms: ["tiktok"] }), 31)).toBe(60)
    expect(expectedQuota(contractRules({ platforms: ["tiktok", "instagram", "youtube"] }), 31)).toBe(180)
    expect(expectedQuota(contractRules({ platforms: ["tiktok", "tiktok"] }), 31)).toBe(60)
  })

  it("rejects a broken quota or cycle length", () => {
    expect(() => expectedQuota(contractRules({ quota: { count: -1 } }), 31)).toThrow(RangeError)
    expect(() => expectedQuota(contractRules({ quota: { count: 1.5 } }), 31)).toThrow(RangeError)
    expect(() => expectedQuota(contractRules(), 0)).toThrow(RangeError)
    expect(() => expectedQuota(contractRules(), Number.NaN)).toThrow(RangeError)
  })
})

describe("assertValidRules", () => {
  it("accepts the contract", () => {
    expect(() => assertValidRules(contractRules())).not.toThrow()
  })

  it("rejects amounts that are not whole, non-negative numbers", () => {
    const broken: CampaignRules[] = [
      contractRules({ base: { amountCents: 1000.5 } }),
      contractRules({ base: { amountCents: -1 } }),
      contractRules({ base: { amountCents: Number.NaN } }),
      contractRules({ quota: { count: 2.5 } }),
      contractRules({ bonus: { cpmRateCents: 0.3 } }),
      contractRules({ bonus: { minViews: -10 } }),
      contractRules({ bonus: { milestones: [{ views: 20_000, amountCents: 19.99 }] } }),
      contractRules({ bonus: { milestones: [{ views: Number.NaN, amountCents: 100 }] } }),
      contractRules({ caps: { perVideoBonusCents: -5 } }),
      contractRules({ caps: { perCreatorCycleBonusCents: Number.POSITIVE_INFINITY } }),
      contractRules({ caps: { perCreatorCycleTotalCents: 0.1 } }),
    ]
    for (const rules of broken) expect(() => assertValidRules(rules)).toThrow(RangeError)
  })
})
