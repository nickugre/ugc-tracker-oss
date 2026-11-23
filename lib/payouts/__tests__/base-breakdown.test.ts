import { describe, expect, it } from "vitest"

import { baseTermsFor, explainBase } from "../base-breakdown"
import { getCycleByStart } from "../cycles"
import { computeCreatorPayout, type EnginePost } from "../engine"
import type { CampaignRules } from "../types"

const cycle = getCycleByStart("monthly", "America/New_York", 1, "2026-09-01")

function rules(patch: Partial<CampaignRules> = {}): CampaignRules {
  return {
    cycleType: "monthly",
    timezone: "America/New_York",
    weekStartsOn: 1,
    platforms: ["tiktok", "instagram"],
    quota: { count: 60, period: "month", scope: "per_platform" },
    base: { type: "monthly_retainer", amountCents: 100_000, prorate: true },
    bonus: { type: "none", cpmRateCents: null, minViews: null, minViewsMode: "qualify", milestones: [], milestoneScope: "creator_cycle_best" },
    caps: { perVideoBonusCents: null, perCreatorCycleBonusCents: null, perCreatorCycleTotalCents: null },
    ...patch,
  }
}

let seq = 0
const posts = (platform: EnginePost["platform"], n: number): EnginePost[] =>
  Array.from({ length: n }, () => ({
    id: `p${++seq}`,
    platform,
    postedAt: new Date("2026-09-10T12:00:00Z"),
    payableViews: 0,
  }))

function explain(r: CampaignRules, published: EnginePost[]) {
  const payout = computeCreatorPayout({
    rules: r,
    cycle,
    publishedPosts: published,
    bonusPosts: [],
    priorMilestonePaidCents: 0,
    adjustmentsCents: 0,
  })
  return { payout, base: explainBase(baseTermsFor(r, cycle.days), payout) }
}

describe("explainBase", () => {
  it("explains a pro-rated retainer: the real contract", () => {
    const { payout, base } = explain(rules(), [...posts("tiktok", 38), ...posts("instagram", 40)])
    expect(payout.baseCents).toBe(65_000)
    expect(base.kind).toBe("prorated_retainer")
    expect(base.platforms).toEqual([
      { platform: "tiktok", published: 38, counted: 38, quota: 60, missing: 22 },
      { platform: "instagram", published: 40, counted: 40, quota: 60, missing: 20 },
    ])
    expect(base).toMatchObject({ amountCents: 100_000, counted: 78, quota: 120, missing: 42, earnedCents: 65_000, paidCents: 65_000 })
  })

  it("does not let extra posts on one platform make up for another", () => {
    const { base } = explain(rules(), [...posts("tiktok", 70), ...posts("instagram", 30)])
    expect(base.platforms).toEqual([
      { platform: "tiktok", published: 70, counted: 60, quota: 60, missing: 0 },
      { platform: "instagram", published: 30, counted: 30, quota: 60, missing: 30 },
    ])
    expect(base).toMatchObject({ counted: 90, quota: 120, missing: 30, earnedCents: 75_000 })
  })

  it("explains a cross-posted quota: the best platform sets the count", () => {
    const crossPosted = rules({ quota: { count: 60, period: "month", scope: "best_platform" } })
    const { payout, base } = explain(crossPosted, [...posts("tiktok", 40), ...posts("instagram", 56)])
    expect(payout.baseCents).toBe(93_333)
    expect(base.bestPlatformCounts).toBe(true)
    // Nothing is "to go" per platform: more TikToks would not change the pay.
    expect(base.platforms).toEqual([
      { platform: "tiktok", published: 40, counted: 40, quota: 60, missing: null },
      { platform: "instagram", published: 56, counted: 56, quota: 60, missing: null },
    ])
    expect(base).toMatchObject({ counted: 56, quota: 60, missing: 4, earnedCents: 93_333, paidCents: 93_333 })
  })

  it("reads terms stored before the quota scope was recorded as not cross-posted", () => {
    const { payout } = explain(rules(), [...posts("tiktok", 10), ...posts("instagram", 10)])
    const base = explainBase({ ...baseTermsFor(rules(), cycle.days), quotaScope: undefined }, payout)
    expect(base.bestPlatformCounts).toBe(false)
    expect(base.platforms.map((p) => p.missing)).toEqual([50, 50])
  })

  it("always agrees with the engine, whatever is delivered", () => {
    for (const scope of ["per_platform", "total", "best_platform"] as const) {
      for (const [t, i] of [[0, 0], [1, 0], [59, 61], [60, 60], [200, 3]] as const) {
        const r = rules({ quota: { count: 60, period: "month", scope } })
        const { payout, base } = explain(r, [...posts("tiktok", t), ...posts("instagram", i)])
        expect(base.earnedCents).toBe(payout.baseCents)
        expect(base.paidCents).toBe(payout.baseCents)
      }
    }
  })

  it("explains a retainer that is paid in full", () => {
    const { base } = explain(rules({ base: { type: "monthly_retainer", amountCents: 100_000, prorate: false } }), posts("tiktok", 3))
    expect(base).toMatchObject({ kind: "fixed_retainer", earnedCents: 100_000, paidCents: 100_000 })
  })

  it("explains pay per video, capped at the quota", () => {
    const perVideo = rules({
      base: { type: "per_video", amountCents: 1_500, prorate: false },
      quota: { count: 10, period: "month", scope: "total" },
    })
    const { base } = explain(perVideo, [...posts("tiktok", 8), ...posts("instagram", 6)])
    expect(base).toMatchObject({ kind: "per_video", amountCents: 1_500, counted: 10, quota: 10, earnedCents: 15_000 })
    // A single total quota has no per-platform target.
    expect(base.platforms.every((p) => p.quota === null && p.missing === null)).toBe(true)
  })

  it("shows when the total cap cut into the base", () => {
    const capped = rules({ caps: { perVideoBonusCents: null, perCreatorCycleBonusCents: null, perCreatorCycleTotalCents: 50_000 } })
    const { base } = explain(capped, [...posts("tiktok", 60), ...posts("instagram", 60)])
    expect(base).toMatchObject({ earnedCents: 100_000, paidCents: 50_000 })
  })

  it("says there is no base when the campaign has none", () => {
    const { base } = explain(rules({ base: { type: "none", amountCents: 0, prorate: false } }), posts("tiktok", 5))
    expect(base).toMatchObject({ kind: "none", earnedCents: 0, paidCents: 0 })
  })
})
