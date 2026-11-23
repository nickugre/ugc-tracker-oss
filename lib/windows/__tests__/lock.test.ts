import { describe, expect, it } from "vitest"

import { type SnapshotPoint, computeLockedViews, paidViewsInWindow } from "../lock"
import { computeWindowEndsAt } from "../window"

const HOUR = 3_600_000
const END = new Date("2026-08-15T12:00:00.000Z")

// A snapshot `hours` away from the window end (negative = before it).
function snap(id: number, hours: number, views: number): SnapshotPoint {
  return { id, capturedAt: new Date(END.getTime() + hours * HOUR), views }
}

describe("computeLockedViews", () => {
  it("uses a snapshot taken exactly at the window end", () => {
    const result = computeLockedViews([snap(1, -12, 900), snap(2, 0, 1000), snap(3, 5, 1200)], END)
    expect(result).toEqual({
      ok: true,
      lockedViews: 1000,
      method: "exact",
      needsReview: false,
      reviewReason: null,
      details: { after: { snapshotId: 2, capturedAt: "2026-08-15T12:00:00.000Z", views: 1000 } },
    })
  })

  it("prefers the exact snapshot even when views dropped before it", () => {
    const result = computeLockedViews([snap(1, -1, 5000), snap(2, 0, 3000)], END)
    expect(result).toMatchObject({ ok: true, method: "exact", lockedViews: 3000, needsReview: false })
  })

  it("takes the highest id when several snapshots share the end instant", () => {
    const result = computeLockedViews([snap(9, 0, 1010), snap(4, 0, 1000)], END)
    expect(result).toMatchObject({ ok: true, method: "exact", lockedViews: 1010 })
  })

  it("interpolates linearly between the snapshots around the end and floors", () => {
    // 1000 + 130 × 12/13 = 1120
    const result = computeLockedViews([snap(1, -12, 1000), snap(2, 1, 1130)], END)
    expect(result).toEqual({
      ok: true,
      lockedViews: 1120,
      method: "interpolated",
      needsReview: false,
      reviewReason: null,
      details: {
        before: { snapshotId: 1, capturedAt: "2026-08-15T00:00:00.000Z", views: 1000 },
        after: { snapshotId: 2, capturedAt: "2026-08-15T13:00:00.000Z", views: 1130 },
        fraction: 12 / 13,
      },
    })
  })

  it("floors a fractional interpolation", () => {
    // 1000 + 100 × 1/3 = 1033.33
    const result = computeLockedViews([snap(1, -1, 1000), snap(2, 2, 1100)], END)
    expect(result).toMatchObject({ ok: true, lockedViews: 1033, method: "interpolated" })
  })

  it("does not lose a view to float error when the interpolation lands on a whole number", () => {
    // 3,519 + 177,210 × 49/90 is exactly 100,000. Evaluated in floats as
    // v0 + (v1 - v0) * (49 / 90) it comes out a hair under and floors to 99,999: one view short
    // of the 100K milestone.
    expect(Math.floor(3519 + (180_729 - 3519) * (49 / 90))).toBe(99_999)
    const result = computeLockedViews([snap(1, -49, 3519), snap(2, 41, 180_729)], END)
    expect(result).toMatchObject({ ok: true, lockedViews: 100_000 })

    const small = computeLockedViews([snap(1, -1, 19_997), snap(2, 2, 20_006)], END)
    expect(small).toMatchObject({ ok: true, lockedViews: 20_000 })
  })

  it("stays exact when the view delta times the elapsed time passes 2^53", () => {
    // 9,000,000,001 views gained over 12 days: the product is about 4.7e18, far past 2^53.
    const before = snap(1, -24 * 6, 0)
    const after = snap(2, 24 * 6, 9_000_000_001)
    const result = computeLockedViews([before, after], END)
    expect(result).toMatchObject({ ok: true, lockedViews: 4_500_000_000, needsReview: true })
  })

  it("uses the closest snapshots on each side, whatever order they arrive in", () => {
    const ordered = [snap(1, -48, 100), snap(2, -12, 1000), snap(3, 1, 1130), snap(4, 30, 5000)]
    const shuffled = [ordered[3], ordered[1], ordered[0], ordered[2]]
    const expected = computeLockedViews(ordered, END)
    expect(expected).toMatchObject({ ok: true, lockedViews: 1120 })
    expect(computeLockedViews(shuffled, END)).toEqual(expected)
    // The input array is left alone.
    expect(shuffled.map((s) => s.id)).toEqual([4, 2, 1, 3])
  })

  it("breaks capturedAt ties by id", () => {
    // Two rows at the same instant before the end: the higher id is the later one.
    const result = computeLockedViews([snap(7, -2, 1500), snap(3, -2, 1000), snap(8, 2, 2000)], END)
    expect(result).toMatchObject({ ok: true, lockedViews: 1750 })
    if (result.ok) expect(result.details.before?.snapshotId).toBe(7)
  })

  it("clamps between the two snapshots and flags views_decreased when views went down", () => {
    const result = computeLockedViews([snap(1, -1, 1000), snap(2, 2, 900)], END)
    // 1000 - 100 × 1/3 = 966.67 → 966
    expect(result).toMatchObject({
      ok: true,
      lockedViews: 966,
      method: "interpolated",
      needsReview: true,
      reviewReason: "views_decreased",
    })
    if (result.ok) {
      expect(result.lockedViews).toBeGreaterThanOrEqual(900)
      expect(result.lockedViews).toBeLessThanOrEqual(1000)
    }
  })

  it("does not flag equal view counts", () => {
    const result = computeLockedViews([snap(1, -1, 1000), snap(2, 1, 1000)], END)
    expect(result).toMatchObject({ ok: true, lockedViews: 1000, needsReview: false, reviewReason: null })
  })

  it("flags lock_fallback when the post-close snapshot came late", () => {
    const onTime = computeLockedViews([snap(1, -1, 1000), snap(2, 6, 1700)], END)
    expect(onTime).toMatchObject({ ok: true, needsReview: false, reviewReason: null })

    const late = computeLockedViews(
      [snap(1, -1, 1000), { id: 2, capturedAt: new Date(END.getTime() + 6 * HOUR + 1), views: 1700 }],
      END
    )
    expect(late).toMatchObject({ ok: true, method: "interpolated", needsReview: true, reviewReason: "lock_fallback" })
  })

  it("honours a custom lateAfterMs", () => {
    const snapshots = [snap(1, -1, 1000), snap(2, 2, 1300)]
    expect(computeLockedViews(snapshots, END, { lateAfterMs: HOUR })).toMatchObject({
      needsReview: true,
      reviewReason: "lock_fallback",
    })
    expect(computeLockedViews(snapshots, END, { lateAfterMs: 2 * HOUR })).toMatchObject({
      needsReview: false,
    })
  })

  it("only checks a stale in-window snapshot when staleBeforeMs is given", () => {
    const snapshots = [snap(1, -72, 1000), snap(2, 1, 1730)]
    expect(computeLockedViews(snapshots, END)).toMatchObject({ ok: true, needsReview: false })
    expect(computeLockedViews(snapshots, END, { staleBeforeMs: 48 * HOUR })).toMatchObject({
      ok: true,
      needsReview: true,
      reviewReason: "lock_fallback",
    })
  })

  it("reports views_decreased over lock_fallback when both apply", () => {
    const result = computeLockedViews([snap(1, -1, 1000), snap(2, 30, 400)], END)
    expect(result).toMatchObject({ ok: true, needsReview: true, reviewReason: "views_decreased" })
  })

  it("keeps waiting for a post-close snapshot by default", () => {
    const result = computeLockedViews([snap(1, -30, 800), snap(2, -2, 1000)], END)
    expect(result).toEqual({ ok: false, reason: "awaiting_post_close_snapshot" })
  })

  it("falls back to the last in-window snapshot when allowed, always flagged", () => {
    const result = computeLockedViews([snap(2, -2, 1000), snap(1, -30, 800)], END, {
      allowLastBefore: true,
    })
    expect(result).toEqual({
      ok: true,
      lockedViews: 1000,
      method: "last_before",
      needsReview: true,
      reviewReason: "lock_fallback",
      details: { before: { snapshotId: 2, capturedAt: "2026-08-15T10:00:00.000Z", views: 1000 } },
    })
  })

  it("does not lock a post that only has snapshots from after the window unless told to", () => {
    const snapshots = [snap(1, 5, 9000), snap(2, 48, 12_000)]
    expect(computeLockedViews(snapshots, END)).toEqual({ ok: false, reason: "only_after" })
    expect(computeLockedViews(snapshots, END, { allowLastBefore: true })).toEqual({
      ok: false,
      reason: "only_after",
    })
  })

  it("locks a post found after its window at the earliest count there is, when allowed", () => {
    // Views only grow, so the first reading is the one closest to the number at window close.
    const snapshots = [snap(2, 48, 12_000), snap(1, 5, 9000), snap(3, 72, 15_000)]
    expect(computeLockedViews(snapshots, END, { allowFirstAfter: true })).toEqual({
      ok: true,
      lockedViews: 9000,
      method: "first_after",
      needsReview: false,
      reviewReason: null,
      details: { after: { snapshotId: 1, capturedAt: "2026-08-15T17:00:00.000Z", views: 9000 } },
    })
  })

  it("prefers every better method over first_after", () => {
    const opts = { allowFirstAfter: true }
    expect(computeLockedViews([snap(1, -2, 800), snap(2, 3, 1000)], END, opts)).toMatchObject({ method: "interpolated" })
    expect(computeLockedViews([snap(1, 0, 900), snap(2, 3, 1000)], END, opts)).toMatchObject({ method: "exact" })
    // Still inside the window's aftermath: a post-close scrape is on its way, keep waiting.
    expect(computeLockedViews([snap(1, -2, 800)], END, opts)).toEqual({
      ok: false,
      reason: "awaiting_post_close_snapshot",
    })
    expect(computeLockedViews([], END, opts)).toEqual({ ok: false, reason: "no_snapshots" })
  })

  it("reports no_snapshots for an empty list", () => {
    expect(computeLockedViews([], END)).toEqual({ ok: false, reason: "no_snapshots" })
    expect(computeLockedViews([], END, { allowLastBefore: true })).toEqual({
      ok: false,
      reason: "no_snapshots",
    })
  })

  it("always returns whole, non-negative views inside the bracketing snapshots", () => {
    let seed = 99
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed % max
    }
    for (let i = 0; i < 300; i++) {
      const before = { id: 1, capturedAt: new Date(END.getTime() - 1 - next(20 * 24 * HOUR)), views: next(5_000_000) }
      const after = { id: 2, capturedAt: new Date(END.getTime() + 1 + next(20 * 24 * HOUR)), views: next(5_000_000) }
      const result = computeLockedViews([after, before], END)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(Number.isSafeInteger(result.lockedViews)).toBe(true)
      expect(result.lockedViews).toBeGreaterThanOrEqual(Math.min(before.views, after.views))
      expect(result.lockedViews).toBeLessThanOrEqual(Math.max(before.views, after.views))
      const exact = before.views + ((after.views - before.views) * (result.details.fraction ?? 0))
      expect(Math.abs(result.lockedViews - exact)).toBeLessThanOrEqual(1.001)
    }
  })

  it("rejects corrupt input instead of locking from it", () => {
    expect(() => computeLockedViews([snap(1, -1, 1000)], new Date(Number.NaN))).toThrow(RangeError)
    expect(() => computeLockedViews([snap(1, -1, -5)], END)).toThrow(RangeError)
    expect(() => computeLockedViews([snap(1, -1, 10.5)], END)).toThrow(RangeError)
    expect(() => computeLockedViews([snap(1, -1, Number.NaN)], END)).toThrow(RangeError)
    expect(() =>
      computeLockedViews([{ id: 1, capturedAt: new Date(Number.NaN), views: 1 }], END)
    ).toThrow(RangeError)
    expect(() => computeLockedViews([snap(1, -1, 1)], END, { lateAfterMs: Number.NaN })).toThrow(RangeError)
    expect(() => computeLockedViews([snap(1, -1, 1)], END, { staleBeforeMs: -1 })).toThrow(RangeError)
  })
})

describe("paidViewsInWindow", () => {
  // Posted at noon UTC, 14-day window: 1 Aug 12:00 → 15 Aug 12:00.
  const postedAt = new Date("2026-08-01T12:00:00Z")
  const windowEndsAt = computeWindowEndsAt(postedAt, 14)

  it("counts a day fully inside the window in full", () => {
    expect(paidViewsInWindow([{ statDate: "2026-08-05", views: 300 }], postedAt, windowEndsAt, "UTC")).toBe(300)
    expect(paidViewsInWindow([{ statDate: "2026-08-02", views: 1 }], postedAt, windowEndsAt, "UTC")).toBe(1)
    expect(paidViewsInWindow([{ statDate: "2026-08-14", views: 7 }], postedAt, windowEndsAt, "UTC")).toBe(7)
  })

  it("pro-rates the boundary days by the part of the day inside the window", () => {
    // Half of 1 Aug and half of 15 Aug are inside.
    expect(paidViewsInWindow([{ statDate: "2026-08-01", views: 1000 }], postedAt, windowEndsAt, "UTC")).toBe(500)
    expect(paidViewsInWindow([{ statDate: "2026-08-15", views: 1000 }], postedAt, windowEndsAt, "UTC")).toBe(500)

    const sixPm = new Date("2026-08-01T18:00:00Z")
    const days = [{ statDate: "2026-08-01", views: 1000 }]
    expect(paidViewsInWindow(days, sixPm, computeWindowEndsAt(sixPm, 14), "UTC")).toBe(250)
  })

  it("counts nothing for days outside the window", () => {
    const days = [
      { statDate: "2026-07-31", views: 5000 },
      { statDate: "2026-08-16", views: 5000 },
      { statDate: "2025-08-05", views: 5000 },
    ]
    expect(paidViewsInWindow(days, postedAt, windowEndsAt, "UTC")).toBe(0)
    expect(paidViewsInWindow([], postedAt, windowEndsAt, "UTC")).toBe(0)
  })

  it("sums every day and rounds once, half up", () => {
    const days = [
      { statDate: "2026-07-31", views: 9999 },
      { statDate: "2026-08-01", views: 1000 }, // 500
      { statDate: "2026-08-05", views: 300 }, // 300
      { statDate: "2026-08-15", views: 101 }, // 50.5
      { statDate: "2026-08-16", views: 9999 },
    ]
    expect(paidViewsInWindow(days, postedAt, windowEndsAt, "UTC")).toBe(851)
    // Rounded once, at the end: 0.5 + 0.5 = 1. Rounding each day on its own would give 2.
    const thin = [
      { statDate: "2026-08-01", views: 1 }, // 0.5
      { statDate: "2026-08-15", views: 1 }, // 0.5
    ]
    expect(paidViewsInWindow(thin, postedAt, windowEndsAt, "UTC")).toBe(1)
  })

  it("adds up several rows for the same day (several ads on one post)", () => {
    const days = [
      { statDate: "2026-08-05", views: 300 },
      { statDate: "2026-08-05", views: 200 },
      { statDate: "2026-08-01", views: 100 },
      { statDate: "2026-08-01", views: 100 },
    ]
    expect(paidViewsInWindow(days, postedAt, windowEndsAt, "UTC")).toBe(600)
  })

  it("is exact on thirds and sixths and does not depend on the order of the rows", () => {
    // Posted at 20:00: 1/6 of the first day and 5/6 of the last day are inside.
    const evening = new Date("2026-08-01T20:00:00Z")
    const end = computeWindowEndsAt(evening, 14)
    const days = [
      { statDate: "2026-08-01", views: 4 }, // 4/6
      { statDate: "2026-08-15", views: 1 }, // 5/6  → 1.5 in total → 2
      { statDate: "2026-08-07", views: 10 },
    ]
    expect(paidViewsInWindow(days, evening, end, "UTC")).toBe(12)
    expect(paidViewsInWindow([...days].reverse(), evening, end, "UTC")).toBe(12)
    expect(paidViewsInWindow([days[1], days[2], days[0]], evening, end, "UTC")).toBe(12)
  })

  it("uses the advertiser's calendar day, not the UTC day", () => {
    // 1 Aug in Los Angeles is 07:00Z → 07:00Z the next day; the window opens at 12:00Z, so
    // 19 of its 24 hours are inside.
    const days = [{ statDate: "2026-08-01", views: 2400 }]
    expect(paidViewsInWindow(days, postedAt, windowEndsAt, "America/Los_Angeles")).toBe(1900)
    // In Tokyo 1 Aug ended at 15:00Z: only 3 hours are inside.
    expect(paidViewsInWindow(days, postedAt, windowEndsAt, "Asia/Tokyo")).toBe(300)
  })

  it("measures a 23-hour spring-forward day by its real length", () => {
    // 8 March 2026 in New York runs 05:00Z → 04:00Z: 23 hours. Posting 11.5 hours in leaves
    // exactly half of the day inside the window (a 24-hour assumption would give 479).
    const posted = new Date("2026-03-08T16:30:00Z")
    const days = [{ statDate: "2026-03-08", views: 1000 }]
    expect(paidViewsInWindow(days, posted, computeWindowEndsAt(posted, 14), "America/New_York")).toBe(500)
    // The whole short day still counts in full when the window covers it.
    const earlier = new Date("2026-03-05T00:00:00Z")
    expect(paidViewsInWindow(days, earlier, computeWindowEndsAt(earlier, 14), "America/New_York")).toBe(1000)
  })

  it("measures a 25-hour fall-back day by its real length", () => {
    // 1 November 2026 in New York runs 04:00Z → 05:00Z the next day: 25 hours.
    const posted = new Date("2026-11-01T16:30:00Z")
    const days = [{ statDate: "2026-11-01", views: 1000 }]
    expect(paidViewsInWindow(days, posted, computeWindowEndsAt(posted, 14), "America/New_York")).toBe(500)
  })

  it("handles a day that starts at 01:00 because clocks jump at midnight", () => {
    // 6 September 2026 in Santiago: 00:00 does not exist, the day runs 04:00Z → 03:00Z (23 h).
    const posted = new Date("2026-09-06T15:30:00Z")
    const days = [{ statDate: "2026-09-06", views: 1000 }]
    expect(paidViewsInWindow(days, posted, computeWindowEndsAt(posted, 14), "America/Santiago")).toBe(500)
  })

  it("rejects corrupt input", () => {
    const day = [{ statDate: "2026-08-05", views: 300 }]
    expect(() => paidViewsInWindow([{ statDate: "2026-08-05", views: -1 }], postedAt, windowEndsAt, "UTC")).toThrow(RangeError)
    expect(() => paidViewsInWindow([{ statDate: "2026-08-05", views: 1.5 }], postedAt, windowEndsAt, "UTC")).toThrow(RangeError)
    expect(() => paidViewsInWindow([{ statDate: "05/08/2026", views: 1 }], postedAt, windowEndsAt, "UTC")).toThrow(RangeError)
    expect(() => paidViewsInWindow([{ statDate: "2026-02-30", views: 1 }], postedAt, windowEndsAt, "UTC")).toThrow(RangeError)
    expect(() => paidViewsInWindow(day, postedAt, windowEndsAt, "Mars/Olympus_Mons")).toThrow(RangeError)
    expect(() => paidViewsInWindow(day, windowEndsAt, postedAt, "UTC")).toThrow(RangeError)
    expect(() => paidViewsInWindow(day, new Date(Number.NaN), windowEndsAt, "UTC")).toThrow(RangeError)
  })
})
