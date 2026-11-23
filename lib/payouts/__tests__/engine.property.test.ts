import { describe, expect, it } from "vitest"

import { type CreatorPayout, type CreatorPayoutInput, type EnginePost, computeCreatorPayout } from "../engine"
import type { CampaignRules, Platform } from "../types"
import { AUGUST, AUGUST_WEEK, CONTRACT_MILESTONES, prng } from "./fixtures"

type Random = ReturnType<typeof prng>

const PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube", "facebook", "snapchat"]

// Tier boundaries and their neighbours turn up far more often than they would by chance.
const INTERESTING_VIEWS = [
  0, 1, 499, 500, 9_999, 10_000, 10_001, 19_999, 20_000, 49_999, 50_000, 99_999, 100_000, 499_999,
  500_000, 999_999, 1_000_000, 1_200_000, 250_000_000,
]

function randomCap(random: Random, max: number): number | null {
  if (random.chance(0.4)) return null
  return random.chance(0.15) ? 0 : random.int(0, max)
}

function randomRules(random: Random): CampaignRules {
  const cycleType = random.pick(["weekly", "monthly"] as const)
  const milestones = random.chance(0.2)
    ? []
    : random.chance(0.5)
      ? CONTRACT_MILESTONES.map((m) => ({ ...m }))
      : Array.from({ length: random.int(1, 6) }, () => ({
          views: random.int(1, 2_000_000),
          amountCents: random.int(0, 200_000),
        }))
  return {
    cycleType,
    timezone: "America/New_York",
    weekStartsOn: 1,
    platforms: random.shuffle(PLATFORMS).slice(0, random.int(0, 3)),
    quota: {
      count: random.chance(0.25) ? null : random.int(0, 90),
      period: random.pick(["week", "month"] as const),
      scope: random.pick(["per_platform", "total", "best_platform"] as const),
    },
    base: {
      type: random.pick(["none", "per_video", "weekly_retainer", "monthly_retainer"] as const),
      amountCents: random.chance(0.1) ? 0 : random.int(1, 300_000),
      prorate: random.chance(0.6),
    },
    bonus: {
      type: random.pick(["none", "cpm", "milestone", "hybrid"] as const),
      cpmRateCents: random.chance(0.2) ? null : random.int(0, 2_000),
      minViews: random.chance(0.4) ? null : random.pick([0, 1, 10_000, 20_000, 123_457]),
      minViewsMode: random.pick(["qualify", "excess"] as const),
      milestones,
      milestoneScope: random.pick(["creator_cycle_best", "creator_campaign_lifetime", "per_video"] as const),
    },
    caps: {
      perVideoBonusCents: randomCap(random, 150_000),
      perCreatorCycleBonusCents: randomCap(random, 300_000),
      perCreatorCycleTotalCents: randomCap(random, 400_000),
    },
  }
}

function randomPosts(random: Random, tag: string, count: number, from: number): EnginePost[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${tag}-${String(i).padStart(3, "0")}`,
    platform: random.pick(PLATFORMS),
    // Coarse timestamps, so ties on postedAt really happen.
    postedAt: new Date(from + random.int(0, 40) * 43_200_000),
    payableViews: random.chance(0.5) ? random.pick(INTERESTING_VIEWS) : random.int(0, 3_000_000),
  }))
}

function randomInput(random: Random): CreatorPayoutInput {
  const rules = randomRules(random)
  const cycle = rules.cycleType === "monthly" ? AUGUST : AUGUST_WEEK
  return {
    rules,
    cycle,
    publishedPosts: random.chance(0.1) ? [] : randomPosts(random, "pub", random.int(0, 150), cycle.startsAt.getTime()),
    bonusPosts: random.chance(0.15) ? [] : randomPosts(random, "bon", random.int(0, 40), cycle.startsAt.getTime() - 20 * 86_400_000),
    priorMilestonePaidCents: random.chance(0.5) ? 0 : random.int(0, 150_000),
    adjustmentsCents: random.chance(0.5) ? 0 : random.int(-80_000, 80_000),
  }
}

// Every number anywhere in the payout, with its path.
function numbersIn(value: unknown, path = "payout"): [string, number][] {
  if (typeof value === "number") return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((item, i) => numbersIn(item, `${path}[${i}]`))
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => numbersIn(item, `${path}.${key}`))
  }
  return []
}

const sum = (values: (number | undefined)[]) => values.reduce<number>((total, v) => total + (v ?? 0), 0)

const byPostId = (payout: CreatorPayout) =>
  [...payout.bonusItems].sort((a, b) => (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0))

describe("computeCreatorPayout, on 300 pseudo-random inputs", () => {
  const random = prng(20_260_921)
  const cases = Array.from({ length: 300 }, () => randomInput(random))

  it("covers the whole rule space", () => {
    const seen = (pick: (input: CreatorPayoutInput) => string) => new Set(cases.map(pick)).size
    expect(seen((c) => c.rules.base.type)).toBe(4)
    expect(seen((c) => c.rules.bonus.type)).toBe(4)
    expect(seen((c) => c.rules.bonus.milestoneScope)).toBe(3)
    expect(seen((c) => `${c.rules.quota.scope}/${c.rules.quota.period}/${c.rules.cycleType}`)).toBe(12)
    expect(cases.some((c) => c.bonusPosts.length === 0)).toBe(true)
    expect(cases.some((c) => c.publishedPosts.length === 0)).toBe(true)
  })

  it("only ever produces finite integers", () => {
    for (const input of cases) {
      for (const [path, value] of numbersIn(computeCreatorPayout(input))) {
        expect(Number.isSafeInteger(value), `${path} = ${value}`).toBe(true)
      }
    }
  })

  it("keeps the money identities", () => {
    for (const input of cases) {
      const payout = computeCreatorPayout(input)
      expect(payout.totalCents).toBe(payout.baseCents + payout.bonusCents + payout.adjustmentsCents)
      expect(payout.adjustmentsCents).toBe(input.adjustmentsCents)
      expect(sum(payout.bonusItems.map((item) => item.amountCents))).toBe(payout.bonusBeforeCapsCents)
      expect(payout.bonusCents).toBeLessThanOrEqual(payout.bonusBeforeCapsCents)
      expect(payout.baseCents).toBeGreaterThanOrEqual(0)
      expect(payout.bonusCents).toBeGreaterThanOrEqual(0)
      expect(payout.capReductionCents).toBeGreaterThanOrEqual(0)
      for (const item of payout.bonusItems) {
        expect(item.cpmCents).toBeGreaterThanOrEqual(0)
        expect(item.milestoneCents).toBeGreaterThanOrEqual(0)
        expect(item.amountCents).toBeGreaterThanOrEqual(0)
        expect(item.amountCents).toBeLessThanOrEqual(item.cpmCents + item.milestoneCents)
      }
    }
  })

  it("respects every cap, and capReductionCents is exactly what the caps removed", () => {
    const noCaps = { perVideoBonusCents: null, perCreatorCycleBonusCents: null, perCreatorCycleTotalCents: null }
    for (const input of cases) {
      const { caps } = input.rules
      const payout = computeCreatorPayout(input)
      if (caps.perVideoBonusCents !== null) {
        for (const item of payout.bonusItems) expect(item.amountCents).toBeLessThanOrEqual(caps.perVideoBonusCents)
      }
      if (caps.perCreatorCycleBonusCents !== null) {
        expect(payout.bonusCents).toBeLessThanOrEqual(caps.perCreatorCycleBonusCents)
      }
      if (caps.perCreatorCycleTotalCents !== null) {
        expect(payout.baseCents + payout.bonusCents).toBeLessThanOrEqual(caps.perCreatorCycleTotalCents)
      }

      const uncapped = computeCreatorPayout({ ...input, rules: { ...input.rules, caps: noCaps } })
      expect(uncapped.capReductionCents).toBe(0)
      expect(uncapped.bonusCents).toBe(sum(payout.bonusItems.map((item) => item.cpmCents + item.milestoneCents)))
      expect(uncapped.baseCents + uncapped.bonusCents - payout.capReductionCents).toBe(
        payout.baseCents + payout.bonusCents
      )
      // The base is only ever reduced by the total cap, and only once the bonus is gone.
      if (payout.baseCents < uncapped.baseCents) {
        expect(payout.bonusCents).toBe(0)
        expect(payout.baseCents).toBe(caps.perCreatorCycleTotalCents)
      }
    }
  })

  it("never pays a retainer above its amount, and counts delivery consistently", () => {
    for (const input of cases) {
      const { rules } = input
      const payout = computeCreatorPayout(input)
      if (rules.base.type === "weekly_retainer" || rules.base.type === "monthly_retainer") {
        expect(payout.baseCents).toBeLessThanOrEqual(rules.base.amountCents)
      }
      if (rules.base.type === "none") expect(payout.baseCents).toBe(0)

      expect(payout.postsPublished).toBe(input.publishedPosts.length)
      expect(payout.postsDelivered).toBeLessThanOrEqual(payout.postsPublished)
      expect(payout.postsDelivered).toBeGreaterThanOrEqual(0)
      if (payout.quota !== null) expect(payout.postsDelivered).toBeLessThanOrEqual(payout.quota)
      if (rules.quota.scope === "best_platform") {
        expect(Math.max(0, ...Object.values(payout.deliveredByPlatform))).toBe(payout.postsDelivered)
      } else {
        expect(sum(Object.values(payout.deliveredByPlatform))).toBe(payout.postsDelivered)
      }
      expect(sum(Object.values(payout.publishedByPlatform))).toBe(payout.postsPublished)
      for (const platform of PLATFORMS) {
        expect(payout.deliveredByPlatform[platform] ?? 0).toBeLessThanOrEqual(payout.publishedByPlatform[platform] ?? 0)
      }
      if (rules.quota.scope !== "total") {
        expect(Object.keys(payout.deliveredByPlatform).sort()).toEqual([...rules.platforms].sort())
      }
    }
  })

  it("settles every post exactly once and marks exactly one best post", () => {
    for (const input of cases) {
      const payout = computeCreatorPayout(input)
      expect(payout.basePostIds).toEqual(input.publishedPosts.map((p) => p.id))
      expect(payout.bonusItems.map((item) => item.postId)).toEqual(input.bonusPosts.map((p) => p.id))
      expect(payout.bonusItems.map((item) => item.payableViews)).toEqual(input.bonusPosts.map((p) => p.payableViews))

      const best = payout.bonusItems.filter((item) => item.isBest)
      expect(best).toHaveLength(input.bonusPosts.length > 0 ? 1 : 0)
      expect(payout.bestPostId).toBe(best[0]?.postId ?? null)
      if (best[0]) {
        expect(best[0].payableViews).toBe(Math.max(...input.bonusPosts.map((p) => p.payableViews)))
      }

      const usesMilestones = input.rules.bonus.type === "milestone" || input.rules.bonus.type === "hybrid"
      if (!usesMilestones) {
        expect(payout.tier).toBeNull()
        expect(payout.bonusItems.every((item) => item.milestoneCents === 0)).toBe(true)
      } else if (input.rules.bonus.milestoneScope !== "per_video") {
        // Non-stacking scopes: nobody but the best post earns a milestone.
        expect(payout.bonusItems.filter((item) => item.milestoneCents > 0 && !item.isBest)).toEqual([])
      }
      if (input.rules.bonus.type === "none") expect(payout.bonusBeforeCapsCents).toBe(0)
    }
  })

  it("gives the same answer for the same posts in any order", () => {
    for (const input of cases.slice(0, 120)) {
      const expected = computeCreatorPayout(input)
      const shuffled = computeCreatorPayout({
        ...input,
        publishedPosts: random.shuffle(input.publishedPosts),
        bonusPosts: random.shuffle(input.bonusPosts),
      })
      expect(byPostId(shuffled)).toEqual(byPostId(expected))
      expect([...shuffled.basePostIds].sort()).toEqual([...expected.basePostIds].sort())
      expect({ ...shuffled, bonusItems: [], basePostIds: [] }).toEqual({ ...expected, bonusItems: [], basePostIds: [] })
    }
  })

  it("is repeatable", () => {
    for (const input of cases.slice(0, 50)) {
      expect(computeCreatorPayout(structuredClone(input))).toEqual(computeCreatorPayout(input))
    }
  })
})
