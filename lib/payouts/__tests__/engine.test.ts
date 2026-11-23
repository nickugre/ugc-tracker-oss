import { describe, expect, it } from "vitest"

import {
  type CreatorPayoutInput,
  ENGINE_VERSION,
  computeCreatorPayout,
  computeCyclePayout,
} from "../engine"
import { applyCreatorOverrides } from "../rules"
import {
  AUGUST,
  AUGUST_WEEK,
  JULY,
  type RulesPatch,
  contractRules,
  payoutInput,
  post,
  posts,
} from "./fixtures"

const fullDelivery = () => [...posts("tiktok", 60), ...posts("instagram", 60)]

describe("the real contract", () => {
  it("pays the full retainer plus one milestone for full delivery and a 120K best video", () => {
    const payout = computeCreatorPayout(
      payoutInput({ publishedPosts: fullDelivery(), bonusPosts: [post("best", 120_000)] })
    )
    expect(payout.baseCents).toBe(100_000)
    expect(payout.bonusCents).toBe(10_000)
    expect(payout.totalCents).toBe(110_000)
    expect(payout).toMatchObject({
      bonusBeforeCapsCents: 10_000,
      capReductionCents: 0,
      adjustmentsCents: 0,
      postsPublished: 120,
      postsDelivered: 120,
      quota: 120,
      deliveredByPlatform: { tiktok: 60, instagram: 60 },
      publishedByPlatform: { tiktok: 60, instagram: 60 },
      bestPostId: "best",
      tier: { views: 100_000, amountCents: 10_000 },
    })
    expect(payout.bonusItems).toEqual([
      {
        postId: "best",
        payableViews: 120_000,
        cpmCents: 0,
        milestoneCents: 10_000,
        amountCents: 10_000,
        tierViews: 100_000,
        isBest: true,
      },
    ])
    expect(payout.basePostIds).toHaveLength(120)
  })

  it("pro-rates the retainer by delivered posts, rounding half up", () => {
    const base = (tiktok: number, instagram: number) =>
      computeCreatorPayout(
        payoutInput({ publishedPosts: [...posts("tiktok", tiktok), ...posts("instagram", instagram)] })
      ).baseCents
    expect(base(58, 60)).toBe(98_333) // 100000 × 118 / 120 = 98333.33
    expect(base(52, 60)).toBe(93_333) // 100000 × 112 / 120 = 93333.33
    expect(base(59, 60)).toBe(99_167) // 99166.67
    expect(base(60, 60)).toBe(100_000)
    expect(base(1, 0)).toBe(833) // 833.33
    expect(base(0, 0)).toBe(0)
  })

  it("clamps each platform on its own: extra Instagram posts do not make up for missing TikToks", () => {
    const payout = computeCreatorPayout(
      payoutInput({ publishedPosts: [...posts("instagram", 70), ...posts("tiktok", 50)] })
    )
    expect(payout.postsPublished).toBe(120)
    expect(payout.postsDelivered).toBe(110)
    expect(payout.baseCents).toBe(91_667) // 100000 × 110 / 120 = 91666.67
    expect(payout.deliveredByPlatform).toEqual({ tiktok: 50, instagram: 60 })
    expect(payout.publishedByPlatform).toEqual({ tiktok: 50, instagram: 70 })
  })

  it("never pays more than the retainer however much is posted", () => {
    const payout = computeCreatorPayout(
      payoutInput({ publishedPosts: [...posts("instagram", 200), ...posts("tiktok", 200)] })
    )
    expect(payout.postsDelivered).toBe(120)
    expect(payout.baseCents).toBe(100_000)
  })

  it("does not stack milestones: two videos over 100K still earn one $100 bonus", () => {
    const bonusPosts = [
      post("small", 30_000),
      post("second", 140_000),
      post("top", 480_000),
      post("zero", 0),
    ]
    const payout = computeCreatorPayout(payoutInput({ publishedPosts: fullDelivery(), bonusPosts }))
    expect(payout.bonusCents).toBe(10_000)
    expect(payout.bestPostId).toBe("top")
    expect(payout.tier).toEqual({ views: 100_000, amountCents: 10_000 })

    // Every bonus post gets an item, $0 ones included: they are settled and cannot compete again.
    expect(payout.bonusItems).toHaveLength(bonusPosts.length)
    expect(payout.bonusItems.map((item) => item.postId)).toEqual(["small", "second", "top", "zero"])
    const best = payout.bonusItems.filter((item) => item.isBest)
    const paid = payout.bonusItems.filter((item) => item.amountCents !== 0)
    expect(best).toHaveLength(1)
    expect(paid).toHaveLength(1)
    expect(paid[0]).toBe(best[0])
    expect(best[0]).toMatchObject({ postId: "top", amountCents: 10_000, tierViews: 100_000 })
    expect(payout.bonusItems.find((item) => item.postId === "second")).toMatchObject({
      milestoneCents: 0,
      amountCents: 0,
      tierViews: null,
      isBest: false,
    })
  })

  it("tops out at $1,000 bonus and $2,000 in total", () => {
    const payout = computeCreatorPayout(
      payoutInput({ publishedPosts: fullDelivery(), bonusPosts: [post("viral", 1_200_000)] })
    )
    expect(payout.bonusCents).toBe(100_000)
    expect(payout.tier).toEqual({ views: 1_000_000, amountCents: 100_000 })
    expect(payout.totalCents).toBe(200_000)

    const many = computeCreatorPayout(
      payoutInput({
        publishedPosts: [...posts("tiktok", 90), ...posts("instagram", 90)],
        bonusPosts: posts("tiktok", 25, { views: 40_000_000, tag: "viral", from: "2026-07-20T00:00:00Z" }),
      })
    )
    expect(many.totalCents).toBe(200_000)
  })

  it("has an inclusive milestone boundary", () => {
    const bonus = (views: number) =>
      computeCreatorPayout(payoutInput({ bonusPosts: [post("p", views)] })).bonusCents
    expect(bonus(19_999)).toBe(0)
    expect(bonus(20_000)).toBe(2_000)
    expect(bonus(49_999)).toBe(2_000)
    expect(bonus(50_000)).toBe(5_000)
    expect(bonus(99_999)).toBe(5_000)
    expect(bonus(100_000)).toBe(10_000)
    expect(bonus(499_999)).toBe(10_000)
    expect(bonus(500_000)).toBe(50_000)
    expect(bonus(999_999)).toBe(50_000)
    expect(bonus(1_000_000)).toBe(100_000)
    expect(bonus(0)).toBe(0)
  })

  it("counts a post for base pay in the cycle it was published and for the bonus in the cycle its window closed", () => {
    // Published in August with a huge view count, but its window is still open: base only.
    const openInAugust = post("august-open", 900_000, { postedAt: "2026-08-25T14:00:00Z" })
    // Published in July, window closed in August: bonus only.
    const fromJuly = post("july-closed", 60_000, { postedAt: "2026-07-22T14:00:00Z" })
    expect(fromJuly.postedAt.getTime()).toBeLessThan(AUGUST.startsAt.getTime())
    expect(fromJuly.postedAt.getTime()).toBeGreaterThanOrEqual(JULY.startsAt.getTime())

    const published = [...posts("tiktok", 59), openInAugust, ...posts("instagram", 60)]
    const payout = computeCreatorPayout(
      payoutInput({ publishedPosts: published, bonusPosts: [fromJuly] })
    )
    expect(payout.postsPublished).toBe(120)
    expect(payout.baseCents).toBe(100_000)
    expect(payout.basePostIds).toContain("august-open")
    expect(payout.basePostIds).not.toContain("july-closed")

    expect(payout.bonusCents).toBe(5_000)
    expect(payout.bestPostId).toBe("july-closed")
    expect(payout.bonusItems.map((item) => item.postId)).toEqual(["july-closed"])

    // Without the July post there is no bonus at all, whatever the open post's views are.
    const withoutJuly = computeCreatorPayout(payoutInput({ publishedPosts: published }))
    expect(withoutJuly).toMatchObject({ baseCents: 100_000, bonusCents: 0, bestPostId: null, tier: null })
    // And the July post alone earns the bonus but no base pay.
    const onlyJuly = computeCreatorPayout(payoutInput({ bonusPosts: [fromJuly] }))
    expect(onlyJuly).toMatchObject({ baseCents: 0, bonusCents: 5_000, totalCents: 5_000, postsPublished: 0 })
  })

  it("can settle the same post for base and bonus in one cycle", () => {
    const quick = post("quick", 25_000, { postedAt: "2026-08-02T14:00:00Z" })
    const payout = computeCreatorPayout(payoutInput({ publishedPosts: [quick], bonusPosts: [quick] }))
    expect(payout.basePostIds).toEqual(["quick"])
    expect(payout.bonusItems.map((item) => item.postId)).toEqual(["quick"])
    expect(payout).toMatchObject({ baseCents: 833, bonusCents: 2_000, totalCents: 2_833 })
  })
})

describe("best post", () => {
  const rules = contractRules()

  it("is the one with the most payable views", () => {
    const payout = computeCreatorPayout(
      payoutInput({ rules, bonusPosts: [post("a", 50_000), post("b", 70_000), post("c", 69_999)] })
    )
    expect(payout.bestPostId).toBe("b")
  })

  it("breaks a tie on views by the earliest post", () => {
    const payout = computeCreatorPayout(
      payoutInput({
        rules,
        bonusPosts: [
          post("a", 70_000, { postedAt: "2026-07-21T00:00:00Z" }),
          post("z", 70_000, { postedAt: "2026-07-20T00:00:00Z" }),
          post("m", 70_000, { postedAt: "2026-07-22T00:00:00Z" }),
        ],
      })
    )
    expect(payout.bestPostId).toBe("z")
  })

  it("breaks a full tie by the smallest id, compared as plain strings", () => {
    const at = { postedAt: "2026-07-20T00:00:00Z" }
    const payout = computeCreatorPayout(
      payoutInput({ rules, bonusPosts: [post("b", 70_000, at), post("B", 70_000, at), post("a", 70_000, at), post("10", 70_000, at), post("9", 70_000, at)] })
    )
    // Code-unit order: "10" < "9" < "B" < "a" < "b".
    expect(payout.bestPostId).toBe("10")
    expect(payout.bonusItems.filter((item) => item.isBest)).toHaveLength(1)
    expect(payout.bonusCents).toBe(5_000)
  })

  it("does not depend on the order of the input", () => {
    const bonusPosts = [
      post("p1", 70_000, { postedAt: "2026-07-21T00:00:00Z" }),
      post("p2", 70_000, { postedAt: "2026-07-20T00:00:00Z" }),
      post("p3", 70_000, { postedAt: "2026-07-20T00:00:00Z" }),
      post("p4", 10, { postedAt: "2026-07-01T00:00:00Z" }),
    ]
    const orders = [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]]
    for (const order of orders) {
      const payout = computeCreatorPayout(payoutInput({ rules, bonusPosts: order.map((i) => bonusPosts[i]) }))
      expect(payout.bestPostId).toBe("p2")
      expect(payout.bonusCents).toBe(5_000)
      // Items follow the input order.
      expect(payout.bonusItems.map((item) => item.postId)).toEqual(order.map((i) => bonusPosts[i].id))
    }
  })

  it("is null when there are no bonus posts", () => {
    const payout = computeCreatorPayout(payoutInput({ rules, publishedPosts: fullDelivery() }))
    expect(payout).toMatchObject({ bestPostId: null, tier: null, bonusCents: 0, bonusItems: [] })
  })
})

describe("milestone scopes", () => {
  it("creator_campaign_lifetime tops up what earlier cycles already paid", () => {
    const rules = contractRules({ bonus: { milestoneScope: "creator_campaign_lifetime" } })

    const first = computeCreatorPayout(
      payoutInput({ rules, bonusPosts: [post("v1", 25_000)], priorMilestonePaidCents: 0 })
    )
    expect(first.bonusCents).toBe(2_000)

    // $100 paid before, now a 500K video: $500 tier - $100 = $400.
    const second = computeCreatorPayout(
      payoutInput({ rules, bonusPosts: [post("v2", 600_000), post("v3", 450_000)], priorMilestonePaidCents: 10_000 })
    )
    expect(second.bonusCents).toBe(40_000)
    expect(second.tier).toEqual({ views: 500_000, amountCents: 50_000 })
    expect(second.bonusItems).toEqual([
      { postId: "v2", payableViews: 600_000, cpmCents: 0, milestoneCents: 40_000, amountCents: 40_000, tierViews: 500_000, isBest: true },
      { postId: "v3", payableViews: 450_000, cpmCents: 0, milestoneCents: 0, amountCents: 0, tierViews: null, isBest: false },
    ])

    // Later a 100K video, with $500 already paid: nothing more, and nothing is clawed back.
    const third = computeCreatorPayout(
      payoutInput({ rules, bonusPosts: [post("v4", 100_000)], priorMilestonePaidCents: 50_000 })
    )
    expect(third.bonusCents).toBe(0)
    expect(third.totalCents).toBe(0)
    expect(third.tier).toEqual({ views: 100_000, amountCents: 10_000 })
    expect(third.bonusItems[0]).toMatchObject({ milestoneCents: 0, amountCents: 0, tierViews: 100_000, isBest: true })

    // The same tier again pays nothing; the next tier pays the difference.
    const again = computeCreatorPayout(
      payoutInput({ rules, bonusPosts: [post("v5", 700_000)], priorMilestonePaidCents: 50_000 })
    )
    expect(again.bonusCents).toBe(0)
    const million = computeCreatorPayout(
      payoutInput({ rules, bonusPosts: [post("v6", 1_000_000)], priorMilestonePaidCents: 50_000 })
    )
    expect(million.bonusCents).toBe(50_000)
  })

  it("creator_campaign_lifetime pays nothing without bonus posts or below the first tier", () => {
    const rules = contractRules({ bonus: { milestoneScope: "creator_campaign_lifetime" } })
    expect(computeCreatorPayout(payoutInput({ rules, priorMilestonePaidCents: 0 })).bonusCents).toBe(0)
    const low = computeCreatorPayout(payoutInput({ rules, bonusPosts: [post("v", 19_999)] }))
    expect(low).toMatchObject({ bonusCents: 0, tier: null, bestPostId: "v" })
  })

  it("creator_cycle_best ignores what earlier cycles paid", () => {
    const payout = computeCreatorPayout(
      payoutInput({ bonusPosts: [post("v", 100_000)], priorMilestonePaidCents: 50_000 })
    )
    expect(payout.bonusCents).toBe(10_000)
  })

  it("per_video stacks every video's tier, then the creator cap applies", () => {
    const rules = contractRules({ bonus: { milestoneScope: "per_video" } })
    const payout = computeCreatorPayout(
      payoutInput({
        rules,
        bonusPosts: [post("v20", 20_000), post("v50", 50_000), post("v1m", 1_000_000), post("v0", 5_000)],
      })
    )
    expect(payout.bonusItems.map((item) => item.amountCents)).toEqual([2_000, 5_000, 100_000, 0])
    expect(payout.bonusItems.map((item) => item.tierViews)).toEqual([20_000, 50_000, 1_000_000, null])
    expect(payout.bonusBeforeCapsCents).toBe(107_000)
    expect(payout.bonusCents).toBe(100_000)
    expect(payout.capReductionCents).toBe(7_000)
    expect(payout.totalCents).toBe(100_000)
    expect(payout.bestPostId).toBe("v1m")
    expect(payout.tier).toEqual({ views: 1_000_000, amountCents: 100_000 })

    const uncapped = computeCreatorPayout(
      payoutInput({
        rules: contractRules({ bonus: { milestoneScope: "per_video" }, caps: { perCreatorCycleBonusCents: null } }),
        bonusPosts: [post("v20", 20_000), post("v50", 50_000), post("v1m", 1_000_000)],
      })
    )
    expect(uncapped).toMatchObject({ bonusCents: 107_000, capReductionCents: 0 })
  })
})

describe("CPM", () => {
  const cpmRules = (mode: "qualify" | "excess", minViews: number | null = 10_000) =>
    contractRules({
      bonus: { type: "cpm", cpmRateCents: 300, minViews, minViewsMode: mode },
      caps: { perCreatorCycleBonusCents: null },
    })
  const cpm = (rules: ReturnType<typeof cpmRules>, views: number) =>
    computeCreatorPayout(payoutInput({ rules, bonusPosts: [post("p", views)] })).bonusCents

  it("qualify: nothing below the minimum, then every view pays", () => {
    const rules = cpmRules("qualify")
    expect(cpm(rules, 9_999)).toBe(0)
    expect(cpm(rules, 10_000)).toBe(3_000)
    expect(cpm(rules, 12_345)).toBe(3_704) // 3703.5 → 3704
    expect(cpm(rules, 1_000_000)).toBe(300_000)
  })

  it("excess: only the views above the minimum pay", () => {
    const rules = cpmRules("excess")
    expect(cpm(rules, 9_999)).toBe(0)
    expect(cpm(rules, 10_000)).toBe(0)
    expect(cpm(rules, 12_345)).toBe(704) // 2345 × 0.3 = 703.5 → 704
    expect(cpm(rules, 1_010_000)).toBe(300_000)
  })

  it("pays every view when there is no minimum, in either mode", () => {
    expect(cpm(cpmRules("qualify", null), 5_000)).toBe(1_500)
    expect(cpm(cpmRules("excess", null), 5_000)).toBe(1_500)
    expect(cpm(cpmRules("qualify", 0), 5_000)).toBe(1_500)
    expect(cpm(cpmRules("excess", 0), 0)).toBe(0)
  })

  it("rounds half a cent up and works in integers only", () => {
    const rules = contractRules({ bonus: { type: "cpm", cpmRateCents: 1 }, caps: { perCreatorCycleBonusCents: null } })
    expect(cpm(rules, 499)).toBe(0)
    expect(cpm(rules, 500)).toBe(1)
    expect(cpm(rules, 1_499)).toBe(1)
    expect(cpm(rules, 1_500)).toBe(2)
    const odd = contractRules({ bonus: { type: "cpm", cpmRateCents: 333 }, caps: { perCreatorCycleBonusCents: null } })
    expect(cpm(odd, 1_234_567)).toBe(411_111) // 411110.811
    // 0.1 + 0.2 style traps: 3 × 35 / 1000 = 0.105 → 0 ; 5 × 300 / 1000 = 1.5 → 2
    expect(cpm(contractRules({ bonus: { type: "cpm", cpmRateCents: 35 } }), 3)).toBe(0)
    expect(cpm(contractRules({ bonus: { type: "cpm", cpmRateCents: 300 } }), 5)).toBe(2)
  })

  it("pays CPM on every bonus post and ignores the milestones", () => {
    const payout = computeCreatorPayout(
      payoutInput({ rules: cpmRules("qualify"), bonusPosts: [post("a", 100_000), post("b", 50_000), post("c", 9_000)] })
    )
    expect(payout.bonusItems.map((item) => item.cpmCents)).toEqual([30_000, 15_000, 0])
    expect(payout.bonusItems.every((item) => item.milestoneCents === 0 && item.tierViews === null)).toBe(true)
    expect(payout.bonusCents).toBe(45_000)
    expect(payout.tier).toBeNull()
    expect(payout.bestPostId).toBe("a")
  })

  it("pays nothing when no rate is set", () => {
    const rules = contractRules({ bonus: { type: "cpm", cpmRateCents: null } })
    expect(cpm(rules, 1_000_000)).toBe(0)
  })

  it("does not apply the CPM minimum to milestones", () => {
    const rules = contractRules({ bonus: { type: "hybrid", cpmRateCents: 300, minViews: 60_000 } })
    const payout = computeCreatorPayout(payoutInput({ rules, bonusPosts: [post("p", 50_000)] }))
    expect(payout.bonusItems[0]).toMatchObject({ cpmCents: 0, milestoneCents: 5_000, amountCents: 5_000 })
  })
})

describe("bonus types", () => {
  const bonusPosts = [post("a", 100_000), post("b", 50_000)]

  it("none pays no bonus but still settles every post", () => {
    const rules = contractRules({ bonus: { type: "none", cpmRateCents: 300 } })
    const payout = computeCreatorPayout(payoutInput({ rules, bonusPosts }))
    expect(payout.bonusCents).toBe(0)
    expect(payout.bonusItems).toHaveLength(2)
    expect(payout.bonusItems.every((item) => item.amountCents === 0 && item.cpmCents === 0)).toBe(true)
    expect(payout.tier).toBeNull()
  })

  it("hybrid adds CPM and milestone per post", () => {
    const rules = contractRules({
      bonus: { type: "hybrid", cpmRateCents: 300 },
      caps: { perCreatorCycleBonusCents: null },
    })
    const payout = computeCreatorPayout(payoutInput({ rules, bonusPosts }))
    // Best-video milestone: only "a" earns a tier; both earn CPM.
    expect(payout.bonusItems).toEqual([
      { postId: "a", payableViews: 100_000, cpmCents: 30_000, milestoneCents: 10_000, amountCents: 40_000, tierViews: 100_000, isBest: true },
      { postId: "b", payableViews: 50_000, cpmCents: 15_000, milestoneCents: 0, amountCents: 15_000, tierViews: null, isBest: false },
    ])
    expect(payout.bonusCents).toBe(55_000)
  })

  it("milestone ignores a CPM rate that happens to be set", () => {
    const rules = contractRules({ bonus: { type: "milestone", cpmRateCents: 300 } })
    const payout = computeCreatorPayout(payoutInput({ rules, bonusPosts }))
    expect(payout.bonusCents).toBe(10_000)
    expect(payout.bonusItems.every((item) => item.cpmCents === 0)).toBe(true)
  })
})

describe("caps", () => {
  // Hybrid, per-video milestones, $3 CPM:
  //   A, 1,000,000 views: 300,000 CPM + 100,000 milestone = 400,000
  //   B,    50,000 views:  15,000 CPM +   5,000 milestone =  20,000
  type Caps = NonNullable<RulesPatch["caps"]>
  const hybrid = (caps: Caps) =>
    contractRules({
      bonus: { type: "hybrid", cpmRateCents: 300, milestoneScope: "per_video" },
      caps: { perCreatorCycleBonusCents: null, ...caps },
    })
  const bonusPosts = [post("A", 1_000_000), post("B", 50_000)]
  const run = (caps: Caps, adjustmentsCents = 0) =>
    computeCreatorPayout(
      payoutInput({ rules: hybrid(caps), publishedPosts: fullDelivery(), bonusPosts, adjustmentsCents })
    )

  it("pays everything when there are no caps", () => {
    const payout = run({})
    expect(payout).toMatchObject({
      baseCents: 100_000,
      bonusBeforeCapsCents: 420_000,
      bonusCents: 420_000,
      capReductionCents: 0,
      totalCents: 520_000,
    })
  })

  it("1. caps each video's CPM + milestone together", () => {
    const payout = run({ perVideoBonusCents: 150_000 })
    expect(payout.bonusItems).toEqual([
      { postId: "A", payableViews: 1_000_000, cpmCents: 300_000, milestoneCents: 100_000, amountCents: 150_000, tierViews: 1_000_000, isBest: true },
      { postId: "B", payableViews: 50_000, cpmCents: 15_000, milestoneCents: 5_000, amountCents: 20_000, tierViews: 50_000, isBest: false },
    ])
    expect(payout.bonusBeforeCapsCents).toBe(170_000)
    expect(payout.bonusCents).toBe(170_000)
    expect(payout.capReductionCents).toBe(250_000)
  })

  it("2. then caps the creator's bonus for the cycle, leaving the items as they were", () => {
    const payout = run({ perVideoBonusCents: 150_000, perCreatorCycleBonusCents: 120_000 })
    expect(payout.bonusItems.map((item) => item.amountCents)).toEqual([150_000, 20_000])
    expect(payout.bonusBeforeCapsCents).toBe(170_000)
    expect(payout.bonusCents).toBe(120_000)
    expect(payout.baseCents).toBe(100_000)
    expect(payout.capReductionCents).toBe(250_000 + 50_000)
    expect(payout.totalCents).toBe(220_000)
  })

  it("3. then caps base + bonus, taking from the bonus first", () => {
    const payout = run({
      perVideoBonusCents: 150_000,
      perCreatorCycleBonusCents: 120_000,
      perCreatorCycleTotalCents: 180_000,
    })
    expect(payout.baseCents).toBe(100_000)
    expect(payout.bonusCents).toBe(80_000)
    expect(payout.bonusBeforeCapsCents).toBe(170_000)
    expect(payout.bonusItems.map((item) => item.amountCents)).toEqual([150_000, 20_000])
    expect(payout.capReductionCents).toBe(250_000 + 50_000 + 40_000)
    expect(payout.totalCents).toBe(180_000)
  })

  it("3. only touches the base when the base alone is over the total cap", () => {
    const atBase = run({ perCreatorCycleTotalCents: 100_000 })
    expect(atBase).toMatchObject({ baseCents: 100_000, bonusCents: 0, totalCents: 100_000, capReductionCents: 420_000 })

    const belowBase = run({ perCreatorCycleTotalCents: 60_000 })
    expect(belowBase).toMatchObject({ baseCents: 60_000, bonusCents: 0, totalCents: 60_000, capReductionCents: 460_000 })

    const zero = run({ perCreatorCycleTotalCents: 0 })
    expect(zero).toMatchObject({ baseCents: 0, bonusCents: 0, totalCents: 0, capReductionCents: 520_000 })
  })

  it("leaves a total under the cap alone", () => {
    const payout = run({ perCreatorCycleBonusCents: 50_000, perCreatorCycleTotalCents: 150_000 })
    expect(payout).toMatchObject({ baseCents: 100_000, bonusCents: 50_000, totalCents: 150_000 })
  })

  it("4. adds adjustments after the caps and never caps them", () => {
    const caps = { perVideoBonusCents: 150_000, perCreatorCycleBonusCents: 120_000, perCreatorCycleTotalCents: 180_000 }
    const plus = run(caps, 50_000)
    expect(plus).toMatchObject({ baseCents: 100_000, bonusCents: 80_000, adjustmentsCents: 50_000, totalCents: 230_000 })
    const minus = run(caps, -30_000)
    expect(minus).toMatchObject({ baseCents: 100_000, bonusCents: 80_000, adjustmentsCents: -30_000, totalCents: 150_000 })
    expect(minus.capReductionCents).toBe(plus.capReductionCents)
  })

  it("lets a clawback take the total below zero", () => {
    const payout = computeCreatorPayout(payoutInput({ adjustmentsCents: -2_500 }))
    expect(payout).toMatchObject({ baseCents: 0, bonusCents: 0, adjustmentsCents: -2_500, totalCents: -2_500 })
  })

  it("treats a cap of 0 as 'no bonus', not as 'no cap'", () => {
    const payout = computeCreatorPayout(
      payoutInput({ rules: contractRules({ caps: { perCreatorCycleBonusCents: 0 } }), bonusPosts: [post("p", 1_000_000)] })
    )
    expect(payout).toMatchObject({ bonusBeforeCapsCents: 100_000, bonusCents: 0, capReductionCents: 100_000 })
    const perVideo = computeCreatorPayout(
      payoutInput({ rules: contractRules({ caps: { perVideoBonusCents: 0 } }), bonusPosts: [post("p", 1_000_000)] })
    )
    expect(perVideo).toMatchObject({ bonusBeforeCapsCents: 0, bonusCents: 0, capReductionCents: 100_000 })
    expect(perVideo.bonusItems[0]).toMatchObject({ milestoneCents: 100_000, amountCents: 0 })
  })
})

describe("base pay", () => {
  const perVideo = (count: number | null) =>
    contractRules({ base: { type: "per_video", amountCents: 1_500, prorate: false }, quota: { count } })

  it("per_video pays each delivered post, up to the quota on each platform", () => {
    const published = [...posts("instagram", 70), ...posts("tiktok", 50)]
    const payout = computeCreatorPayout(payoutInput({ rules: perVideo(60), publishedPosts: published }))
    expect(payout.postsDelivered).toBe(110)
    expect(payout.baseCents).toBe(165_000)
  })

  it("per_video without a quota pays every published post", () => {
    const published = [...posts("instagram", 70), ...posts("tiktok", 50)]
    const payout = computeCreatorPayout(payoutInput({ rules: perVideo(null), publishedPosts: published }))
    expect(payout.quota).toBeNull()
    expect(payout.postsDelivered).toBe(120)
    expect(payout.baseCents).toBe(180_000)
    expect(payout.deliveredByPlatform).toEqual({ tiktok: 50, instagram: 70 })
  })

  it("per_video ignores the prorate flag", () => {
    const rules = contractRules({ base: { type: "per_video", amountCents: 1_500, prorate: true } })
    const payout = computeCreatorPayout(payoutInput({ rules, publishedPosts: posts("tiktok", 10) }))
    expect(payout.baseCents).toBe(15_000)
  })

  it("a retainer that is not pro-rated is paid in full, even for zero posts", () => {
    const rules = contractRules({ base: { prorate: false } })
    expect(computeCreatorPayout(payoutInput({ rules, publishedPosts: posts("tiktok", 10) })).baseCents).toBe(100_000)
    expect(computeCreatorPayout(payoutInput({ rules })).baseCents).toBe(100_000)
  })

  it("a pro-rated retainer without a quota is paid in full", () => {
    const rules = contractRules({ quota: { count: null } })
    expect(computeCreatorPayout(payoutInput({ rules, publishedPosts: posts("tiktok", 3) })).baseCents).toBe(100_000)
    expect(computeCreatorPayout(payoutInput({ rules })).baseCents).toBe(100_000)
    // A quota of 0 gives nothing to pro-rate against either.
    const zeroQuota = contractRules({ quota: { count: 0 } })
    expect(computeCreatorPayout(payoutInput({ rules: zeroQuota })).baseCents).toBe(100_000)
  })

  it("a pro-rated retainer pays 0 for zero posts", () => {
    expect(computeCreatorPayout(payoutInput()).baseCents).toBe(0)
  })

  it("base type none pays no base", () => {
    const rules = contractRules({ base: { type: "none", amountCents: 100_000 } })
    const payout = computeCreatorPayout(payoutInput({ rules, publishedPosts: fullDelivery() }))
    expect(payout.baseCents).toBe(0)
    expect(payout.postsDelivered).toBe(120)
  })

  it("never produces NaN or a fraction for an empty cycle, whatever the terms", () => {
    const variants = [
      contractRules(),
      contractRules({ quota: { count: null } }),
      contractRules({ quota: { count: 0 } }),
      contractRules({ quota: { count: 0, scope: "total" } }),
      contractRules({ platforms: [] }),
      contractRules({ base: { type: "per_video", amountCents: 1_500 } }),
      contractRules({ base: { type: "none" } }),
      contractRules({ bonus: { type: "hybrid", cpmRateCents: 300, milestoneScope: "creator_campaign_lifetime" } }),
      contractRules({ bonus: { type: "cpm", cpmRateCents: null, milestones: [] } }),
      contractRules({ caps: { perVideoBonusCents: 0, perCreatorCycleBonusCents: 0, perCreatorCycleTotalCents: 0 } }),
    ]
    for (const rules of variants) {
      const payout = computeCreatorPayout(payoutInput({ rules }))
      for (const key of ["baseCents", "bonusCents", "bonusBeforeCapsCents", "capReductionCents", "adjustmentsCents", "totalCents", "postsPublished", "postsDelivered"] as const) {
        expect(Number.isSafeInteger(payout[key]), `${key} = ${payout[key]}`).toBe(true)
      }
      expect(payout.bonusCents).toBe(0)
      expect(payout.bonusItems).toEqual([])
      expect(payout.basePostIds).toEqual([])
    }
  })

  it("pro-rates a weekly retainer against a monthly quota converted to the week", () => {
    // 60 a month per platform → 14 a week per platform → 28 in total.
    const rules = contractRules({ cycleType: "weekly", base: { type: "weekly_retainer", amountCents: 25_000 } })
    const from = "2026-08-10T14:00:00Z"
    const payout = computeCreatorPayout(
      payoutInput({
        rules,
        cycle: AUGUST_WEEK,
        publishedPosts: [...posts("tiktok", 20, { from }), ...posts("instagram", 6, { from })],
      })
    )
    expect(payout.quota).toBe(28)
    expect(payout.postsDelivered).toBe(20) // 14 + 6
    expect(payout.baseCents).toBe(17_857) // 25000 × 20 / 28 = 17857.14
  })
})

describe("delivery", () => {
  it("per_platform ignores posts on a platform the campaign has not enabled", () => {
    const published = [...posts("tiktok", 60), ...posts("instagram", 50), ...posts("youtube", 30)]
    const payout = computeCreatorPayout(payoutInput({ publishedPosts: published }))
    expect(payout.postsPublished).toBe(140)
    expect(payout.postsDelivered).toBe(110)
    expect(payout.baseCents).toBe(91_667)
    expect(payout.deliveredByPlatform).toEqual({ tiktok: 60, instagram: 50 })
    expect(payout.publishedByPlatform).toEqual({ tiktok: 60, instagram: 50, youtube: 30 })
    // Still settled for base, so they can never be counted in a later cycle.
    expect(payout.basePostIds).toHaveLength(140)

    const noQuota = computeCreatorPayout(
      payoutInput({ rules: contractRules({ quota: { count: null } }), publishedPosts: published })
    )
    expect(noQuota.postsDelivered).toBe(110)
  })

  it("lists every enabled platform, even with no posts", () => {
    const payout = computeCreatorPayout(payoutInput({ publishedPosts: posts("instagram", 5) }))
    expect(payout.deliveredByPlatform).toEqual({ tiktok: 0, instagram: 5 })
    expect(payout.publishedByPlatform).toEqual({ tiktok: 0, instagram: 5 })
  })

  it("delivers nothing per platform when no platform is enabled", () => {
    const payout = computeCreatorPayout(
      payoutInput({ rules: contractRules({ platforms: [] }), publishedPosts: posts("tiktok", 10) })
    )
    expect(payout).toMatchObject({ postsPublished: 10, postsDelivered: 0, baseCents: 0, quota: 60 })
  })

  it("total scope clamps the overall count and lets platforms offset each other", () => {
    const rules = contractRules({ quota: { count: 120, scope: "total" } })
    const under = computeCreatorPayout(
      payoutInput({ rules, publishedPosts: [...posts("instagram", 70), ...posts("tiktok", 40)] })
    )
    expect(under).toMatchObject({ quota: 120, postsDelivered: 110, baseCents: 91_667 })
    expect(under.deliveredByPlatform).toEqual({ tiktok: 40, instagram: 70 })

    const exact = computeCreatorPayout(
      payoutInput({ rules, publishedPosts: [...posts("instagram", 70), ...posts("tiktok", 50)] })
    )
    expect(exact).toMatchObject({ postsDelivered: 120, baseCents: 100_000 })
  })

  it("total scope over quota: the earliest posts are the delivered ones", () => {
    const rules = contractRules({ quota: { count: 100, scope: "total" } })
    // 80 Instagram posts from 3 Aug, then 50 TikTok posts from 20 Aug.
    const published = [
      ...posts("tiktok", 50, { from: "2026-08-20T00:00:00Z" }),
      ...posts("instagram", 80, { from: "2026-08-03T00:00:00Z" }),
    ]
    const payout = computeCreatorPayout(payoutInput({ rules, publishedPosts: published }))
    expect(payout).toMatchObject({ postsPublished: 130, postsDelivered: 100, baseCents: 100_000 })
    expect(payout.deliveredByPlatform).toEqual({ tiktok: 20, instagram: 80 })
    expect(payout.publishedByPlatform).toEqual({ tiktok: 50, instagram: 80 })
  })

  it("best_platform scope: the platform with the most posts sets the count", () => {
    const rules = contractRules({ quota: { count: 60, scope: "best_platform" } })
    const full = computeCreatorPayout(
      payoutInput({ rules, publishedPosts: [...posts("tiktok", 60), ...posts("instagram", 50)] })
    )
    expect(full).toMatchObject({ quota: 60, postsPublished: 110, postsDelivered: 60, baseCents: 100_000 })
    expect(full.deliveredByPlatform).toEqual({ tiktok: 60, instagram: 50 })

    // 1000 × 56 / 60 = 933.33, where per platform pays 1000 × 96 / 120 = 800.
    const short = computeCreatorPayout(
      payoutInput({ rules, publishedPosts: [...posts("tiktok", 40), ...posts("instagram", 56)] })
    )
    expect(short).toMatchObject({ postsDelivered: 56, baseCents: 93_333 })
  })

  it("best_platform scope clamps each platform at the quota and ignores platforms not enabled", () => {
    const rules = contractRules({ quota: { count: 60, scope: "best_platform" } })
    const payout = computeCreatorPayout(
      payoutInput({ rules, publishedPosts: [...posts("tiktok", 75), ...posts("instagram", 10), ...posts("youtube", 90)] })
    )
    expect(payout).toMatchObject({ postsPublished: 175, postsDelivered: 60, baseCents: 100_000 })
    expect(payout.deliveredByPlatform).toEqual({ tiktok: 60, instagram: 10 })

    const onlyOff = computeCreatorPayout(payoutInput({ rules, publishedPosts: posts("youtube", 30) }))
    expect(onlyOff).toMatchObject({ postsDelivered: 0, baseCents: 0 })
  })

  it("best_platform scope pays a per-video base once per video, not once per platform", () => {
    const rules = contractRules({
      quota: { count: 60, scope: "best_platform" },
      base: { type: "per_video", amountCents: 1_500 },
    })
    const payout = computeCreatorPayout(
      payoutInput({ rules, publishedPosts: [...posts("tiktok", 20), ...posts("instagram", 18)] })
    )
    expect(payout).toMatchObject({ postsDelivered: 20, baseCents: 30_000 })
  })
})

describe("creator overrides", () => {
  it("change the payout without touching the campaign's rules", () => {
    const campaign = contractRules()
    const rules = applyCreatorOverrides(campaign, {
      baseAmountCents: 150_000,
      quotaCount: 30,
      cycleBonusCapCents: 40_000,
    })
    const payout = computeCreatorPayout(
      payoutInput({
        rules,
        publishedPosts: [...posts("tiktok", 30), ...posts("instagram", 15)],
        bonusPosts: [post("v", 700_000)],
      })
    )
    expect(payout.quota).toBe(60)
    expect(payout.postsDelivered).toBe(45)
    expect(payout.baseCents).toBe(112_500) // 150000 × 45 / 60
    expect(payout.bonusBeforeCapsCents).toBe(50_000)
    expect(payout.bonusCents).toBe(40_000)
    expect(campaign).toEqual(contractRules())
  })
})

describe("input validation", () => {
  it("refuses a post that appears twice (a fanned-out join would pay it twice)", () => {
    const twice = [post("dup", 100_000), post("other", 5), post("dup", 100_000)]
    expect(() => computeCreatorPayout(payoutInput({ bonusPosts: twice }))).toThrow(/dup twice/)
    expect(() => computeCreatorPayout(payoutInput({ publishedPosts: twice }))).toThrow(RangeError)
  })

  it("refuses views that are not whole, non-negative numbers", () => {
    for (const views of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => computeCreatorPayout(payoutInput({ bonusPosts: [post("p", views)] }))).toThrow(RangeError)
    }
    expect(() =>
      computeCreatorPayout(payoutInput({ bonusPosts: [post("p", null as unknown as number)] }))
    ).toThrow(RangeError)
    // Published posts are only counted: their views are never read.
    expect(() =>
      computeCreatorPayout(payoutInput({ publishedPosts: [post("p", null as unknown as number)] }))
    ).not.toThrow()
  })

  it("refuses invalid dates, ids, adjustments and prior payments", () => {
    const badDate = { ...post("p", 10), postedAt: new Date(Number.NaN) }
    expect(() => computeCreatorPayout(payoutInput({ bonusPosts: [badDate] }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ publishedPosts: [badDate] }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ bonusPosts: [post("", 10)] }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ adjustmentsCents: 10.5 }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ adjustmentsCents: Number.NaN }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ priorMilestonePaidCents: -1 }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ priorMilestonePaidCents: 0.5 }))).toThrow(RangeError)
  })

  it("refuses rules with fractional or negative amounts", () => {
    expect(() => computeCreatorPayout(payoutInput({ rules: contractRules({ base: { amountCents: 999.99 } }) }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ rules: contractRules({ caps: { perCreatorCycleBonusCents: -1 } }) }))).toThrow(RangeError)
    expect(() => computeCreatorPayout(payoutInput({ rules: contractRules({ bonus: { cpmRateCents: 2.5 } }) }))).toThrow(RangeError)
  })

  it("refuses a cycle of the wrong type for the rules", () => {
    expect(() => computeCreatorPayout(payoutInput({ cycle: AUGUST_WEEK }))).toThrow(/weekly/)
  })

  it("refuses unknown enum values instead of paying by accident", () => {
    const rules = contractRules()
    const bonusPosts = [post("p", 100_000)]
    const bad = (patch: (r: typeof rules) => void) => {
      const copy = structuredClone(rules)
      patch(copy)
      return () => computeCreatorPayout(payoutInput({ rules: copy, bonusPosts, publishedPosts: posts("tiktok", 1) }))
    }
    expect(bad((r) => void (r.base.type = "hourly" as "none"))).toThrow(RangeError)
    expect(bad((r) => void (r.bonus.type = "lottery" as "none"))).toThrow(RangeError)
    expect(bad((r) => void (r.bonus.milestoneScope = "galaxy" as "per_video"))).toThrow(RangeError)
    expect(bad((r) => void (r.quota.scope = "some" as "total"))).toThrow(RangeError)
    expect(
      bad((r) => {
        r.bonus.type = "cpm"
        r.bonus.cpmRateCents = 300
        r.bonus.minViewsMode = "maybe" as "qualify"
      })
    ).toThrow(RangeError)
  })

  it("refuses amounts too large to stay exact", () => {
    const rules = contractRules({ bonus: { type: "cpm", cpmRateCents: 9_000_000_000 }, caps: { perCreatorCycleBonusCents: null } })
    expect(() => computeCreatorPayout(payoutInput({ rules, bonusPosts: [post("p", 9_000_000_000)] }))).toThrow(RangeError)
  })
})

describe("computeCyclePayout", () => {
  it("returns one line per creator, in order, with the cycle totals", () => {
    const result = computeCyclePayout([
      {
        creatorId: "creator-b",
        input: payoutInput({ publishedPosts: fullDelivery(), bonusPosts: [post("b1", 120_000)], adjustmentsCents: 2_500 }),
      },
      {
        creatorId: "creator-a",
        input: payoutInput({
          publishedPosts: [...posts("tiktok", 58), ...posts("instagram", 60)],
          bonusPosts: [post("a1", 19_999)],
          adjustmentsCents: -1_000,
        }),
      },
      { creatorId: "creator-c", input: payoutInput() },
    ])
    expect(result.lines.map((line) => line.creatorId)).toEqual(["creator-b", "creator-a", "creator-c"])
    expect(result.lines.map((line) => line.payout.totalCents)).toEqual([112_500, 97_333, 0])
    expect(result.totals).toEqual({
      baseCents: 198_333,
      bonusCents: 10_000,
      adjustmentsCents: 1_500,
      totalCents: 209_833,
    })
  })

  it("is empty for no creators", () => {
    expect(computeCyclePayout([])).toEqual({
      lines: [],
      totals: { baseCents: 0, bonusCents: 0, adjustmentsCents: 0, totalCents: 0 },
    })
  })

  it("refuses the same creator twice", () => {
    const line = { creatorId: "creator-a", input: payoutInput() }
    expect(() => computeCyclePayout([line, line])).toThrow(RangeError)
  })
})

describe("engine", () => {
  it("has a version to store with finalized cycles", () => {
    expect(ENGINE_VERSION).toBe(1)
  })

  it("does not mutate its input", () => {
    const input = payoutInput({
      publishedPosts: [...posts("instagram", 70), ...posts("tiktok", 50)],
      bonusPosts: [post("a", 5), post("b", 900_000), post("c", 20_000)],
      adjustmentsCents: 100,
    })
    const snapshot = structuredClone(input)
    computeCreatorPayout(input)
    expect(input).toEqual(snapshot)
  })

  it("is deterministic", () => {
    const input = (): CreatorPayoutInput =>
      payoutInput({
        rules: contractRules({ bonus: { type: "hybrid", cpmRateCents: 250, milestoneScope: "per_video" } }),
        publishedPosts: [...posts("instagram", 33), ...posts("tiktok", 61)],
        bonusPosts: [post("a", 123_456), post("b", 999_999), post("c", 20_000)],
        adjustmentsCents: -777,
      })
    expect(computeCreatorPayout(input())).toEqual(computeCreatorPayout(input()))
  })
})

// Keeps the contract cases above honest if someone edits the fixture.
describe("fixture", () => {
  it("is the real contract", () => {
    expect(contractRules()).toEqual({
      cycleType: "monthly",
      timezone: "America/New_York",
      weekStartsOn: 1,
      platforms: ["tiktok", "instagram"],
      quota: { count: 60, period: "month", scope: "per_platform" },
      base: { type: "monthly_retainer", amountCents: 100_000, prorate: true },
      bonus: {
        type: "milestone",
        cpmRateCents: null,
        minViews: null,
        minViewsMode: "qualify",
        milestones: [
          { views: 20_000, amountCents: 2_000 },
          { views: 50_000, amountCents: 5_000 },
          { views: 100_000, amountCents: 10_000 },
          { views: 500_000, amountCents: 50_000 },
          { views: 1_000_000, amountCents: 100_000 },
        ],
        milestoneScope: "creator_cycle_best",
      },
      caps: { perVideoBonusCents: null, perCreatorCycleBonusCents: 100_000, perCreatorCycleTotalCents: null },
    })
    expect(AUGUST).toMatchObject({ cycleType: "monthly", periodStart: "2026-08-01", periodEnd: "2026-08-31", days: 31 })
  })
})
