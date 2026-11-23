import { describe, expect, it } from "vitest"

import { cycleSpendCents, formatRate, performanceFigures, type PerformancePost } from "../performance"

const post = (organicViews: number, engagements = 0, creatorId: string | null = "c1"): PerformancePost => ({
  postedAt: new Date("2026-09-10T12:00:00Z"),
  creatorId,
  organicViews,
  engagements,
})

describe("performanceFigures", () => {
  it("turns spend and views into effective CPM, spend per video and cost per engagement", () => {
    // $1,000 for 4 videos with 250K organic views and 10K engagements.
    const figures = performanceFigures([post(100_000, 4_000), post(100_000, 4_000), post(40_000, 1_500), post(10_000, 500)], 100_000)
    expect(figures.videos).toBe(4)
    expect(figures.organicViews).toBe(250_000)
    expect(figures.ecpmCents).toBe(400) // $4.00 per 1,000 views
    expect(figures.perVideoCents).toBe(25_000) // $250 per video
    expect(figures.perEngagementCents).toBe(10) // $0.10
    expect(figures.avgViews).toBe(62_500)
    expect(figures.medianViews).toBe(70_000)
    expect(figures.engagementRate).toBe(0.04)
  })

  it("reports nothing instead of dividing by zero", () => {
    const empty = performanceFigures([], 50_000)
    expect(empty).toMatchObject({ videos: 0, ecpmCents: null, perVideoCents: null, perEngagementCents: null, avgViews: null, medianViews: null, engagementRate: null })
    const noViews = performanceFigures([post(0)], 50_000)
    expect(noViews.ecpmCents).toBeNull()
    expect(noViews.perVideoCents).toBe(50_000)
  })

  it("takes the middle video as the median of an odd count", () => {
    expect(performanceFigures([post(5), post(1_000_000), post(20)], 0).medianViews).toBe(20)
  })
})

describe("cycleSpendCents", () => {
  const payout = { baseCents: 100_000, bonusCents: 5_000, adjustmentsCents: -1_000 }

  it("counts a finalized cycle in full", () => {
    expect(cycleSpendCents(payout, { stored: true, newestPreview: false, insideCampaignDates: true })).toBe(104_000)
  })

  it("counts the bonuses of open cycles once, in the newest preview", () => {
    const older = cycleSpendCents(payout, { stored: false, newestPreview: false, insideCampaignDates: true })
    const newest = cycleSpendCents(payout, { stored: false, newestPreview: true, insideCampaignDates: true })
    expect(older).toBe(99_000)
    expect(newest).toBe(104_000)
  })

  it("stops accruing base pay in previews after the campaign has ended", () => {
    expect(cycleSpendCents(payout, { stored: false, newestPreview: true, insideCampaignDates: false })).toBe(4_000)
  })
})

describe("formatRate", () => {
  it("keeps a third decimal under a dollar and rounds to cents above it", () => {
    expect(formatRate(2.4)).toBe("$0.024")
    expect(formatRate(67)).toBe("$0.67")
    expect(formatRate(833.33)).toBe("$8.33")
    expect(formatRate(25_000)).toBe("$250.00")
    expect(formatRate(0)).toBe("$0.00")
    expect(formatRate(null)).toBe("—")
  })
})
