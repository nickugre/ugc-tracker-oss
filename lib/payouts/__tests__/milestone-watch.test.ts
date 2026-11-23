import { describe, expect, it } from "vitest"

import { getCycleByStart } from "../cycles"
import { milestoneWatch, type WatchInput, type WatchPost } from "../milestone-watch"
import type { Milestone } from "../types"

const LADDER: Milestone[] = [
  { views: 20_000, amountCents: 2_000 },
  { views: 50_000, amountCents: 5_000 },
  { views: 100_000, amountCents: 10_000 },
]
const cycle = getCycleByStart("monthly", "America/New_York", 1, "2026-09-01")
const NOW = new Date("2026-09-21T14:00:00Z")
const DAY = 86_400_000

let seq = 0
function post(patch: Partial<WatchPost> & { posted: string }): WatchPost {
  seq++
  const postedAt = new Date(`${patch.posted}T12:00:00Z`)
  return {
    id: `p${seq}`,
    platform: "tiktok",
    caption: `video ${seq}`,
    creatorId: "c1",
    creatorName: "Alex",
    postedAt,
    windowEndsAt: new Date(postedAt.getTime() + 14 * DAY),
    status: "open",
    needsReview: false,
    reviewReason: null,
    lockedViews: null,
    paidViews: null,
    payableViews: null,
    currentViews: 0,
    ...patch,
  }
}
const locked = (views: number, patch: Partial<WatchPost> & { posted: string }) =>
  post({ status: "locked", lockedViews: views, payableViews: views, currentViews: views, ...patch })

function watch(posts: WatchPost[], patch: Partial<WatchInput> = {}) {
  return milestoneWatch({
    posts,
    milestones: LADDER,
    cycle,
    now: NOW,
    winners: [],
    ...patch,
  })
}

describe("milestoneWatch", () => {
  it("names the locked video that sets the bonus and the ones it outranks", () => {
    const best = locked(66_000, { posted: "2026-09-02" })
    const second = locked(44_000, { posted: "2026-09-03" })
    const rows = watch([second, best], { winners: [{ postId: best.id, amountCents: 5_000 }] })
    expect(rows.map((r) => [r.id, r.state, r.tier?.views, r.amountCents])).toEqual([
      [best.id, "pays", 50_000, 5_000],
      [second.id, "outranked", 20_000, 0],
    ])
  })

  it("pays every video with a tier when the campaign pays per video", () => {
    const a = locked(66_000, { posted: "2026-09-02" })
    const b = locked(44_000, { posted: "2026-09-03" })
    const rows = watch([a, b], {
      winners: [
        { postId: a.id, amountCents: 5_000 },
        { postId: b.id, amountCents: 2_000 },
      ],
    })
    expect(rows.map((r) => r.state)).toEqual(["pays", "pays"])
  })

  it("uses today's views for a video that is not locked, and says why it does not count yet", () => {
    const review = post({ posted: "2026-08-24", currentViews: 66_914, needsReview: true, reviewReason: "late_discovery" })
    const closing = post({ posted: "2026-09-10", currentViews: 44_000 })
    const nextMonth = post({ posted: "2026-09-20", currentViews: 25_000 })
    const awaiting = post({ posted: "2026-09-05", currentViews: 21_000 })
    const rows = watch([review, closing, nextMonth, awaiting])
    expect(Object.fromEntries(rows.map((r) => [r.id, r.state]))).toEqual({
      [review.id]: "needs_review",
      [closing.id]: "open_window",
      [nextMonth.id]: "rolls_over",
      [awaiting.id]: "not_locked",
    })
    expect(rows.every((r) => !r.isLocked && r.amountCents === 0)).toBe(true)
    // What it would be worth if it counted, so the decision is visible.
    expect(rows.find((r) => r.id === review.id)?.potentialCents).toBe(5_000)
  })

  it("subtracts paid views from an unlocked video", () => {
    const boosted = post({ posted: "2026-09-10", currentViews: 30_000, paidViews: 15_000 })
    const [row] = watch([boosted])
    expect(row.views).toBe(15_000)
    expect(row.tier).toBeNull()
    expect(row.state).toBe("open_window")
  })

  it("lists near misses with what is missing, and hides everything else", () => {
    const close = post({ posted: "2026-09-10", currentViews: 19_200 })
    const far = post({ posted: "2026-09-10", currentViews: 9_000 })
    const rows = watch([close, far])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: close.id, tier: null, nextTier: LADDER[0], shortBy: 800 })
  })

  it("shows how far a video is from the next tier up", () => {
    const [row] = watch([locked(44_000, { posted: "2026-09-02" })], { winners: [{ postId: "p-other", amountCents: 0 }] })
    expect(row.nextTier?.views).toBe(50_000)
    expect(row.shortBy).toBe(6_000)
  })

  it("keeps creators apart and sorts each by views", () => {
    const a1 = locked(30_000, { posted: "2026-09-02", creatorId: "a", creatorName: "Ana" })
    const a2 = locked(90_000, { posted: "2026-09-03", creatorId: "a", creatorName: "Ana" })
    const b1 = locked(25_000, { posted: "2026-09-02", creatorId: "b", creatorName: "Bea" })
    const rows = watch([a1, b1, a2], {
      winners: [
        { postId: a2.id, amountCents: 5_000 },
        { postId: b1.id, amountCents: 2_000 },
      ],
    })
    expect(rows.map((r) => [r.creatorName, r.id, r.state])).toEqual([
      ["Ana", a2.id, "pays"],
      ["Ana", a1.id, "outranked"],
      ["Bea", b1.id, "pays"],
    ])
  })

  it("ignores videos posted after the cycle and returns nothing without a ladder", () => {
    const later = post({ posted: "2026-10-02", currentViews: 80_000 })
    expect(watch([later])).toEqual([])
    expect(watch([locked(80_000, { posted: "2026-09-02" })], { milestones: [] })).toEqual([])
  })
})
