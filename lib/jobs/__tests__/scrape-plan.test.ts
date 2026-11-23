import { describe, expect, it } from "vitest"

import { planDiscoveryRuns, type PlanAccount } from "../scrape-plan"

const NOW = new Date("2026-09-21T12:00:00Z")
const DAY = 86_400_000

let seq = 0
function account(patch: Partial<PlanAccount> = {}): PlanAccount {
  seq++
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    platform: "tiktok",
    handle: `creator${seq}`,
    url: `https://www.tiktok.com/@creator${seq}`,
    trackFrom: null,
    windowDays: 14,
    openPosts: 0,
    backfillPending: false,
    ...patch,
  }
}

describe("planDiscoveryRuns", () => {
  it("asks for the open videos plus a buffer on a routine scrape", () => {
    const [plan, ...rest] = planDiscoveryRuns([account({ openPosts: 12 }), account({ openPosts: 3 })], NOW)
    expect(rest).toHaveLength(0)
    expect(plan.backfill).toBe(false)
    // One limit per run, sized for the busiest profile.
    expect(plan.limitPerProfile).toBe(20)
    expect(plan.newerThan).toEqual(new Date(NOW.getTime() - 16 * DAY))
  })

  it("reaches back to the tracking date on the first scrape of an account", () => {
    const [plan] = planDiscoveryRuns([account({ backfillPending: true, trackFrom: "2026-08-21" })], NOW)
    expect(plan.backfill).toBe(true)
    // The bug this replaces: a new account has 0 open videos, so it only ever got 8.
    expect(plan.limitPerProfile).toBe(100)
    // A day of slack: `track_from` is a local date in the campaign's timezone.
    expect(plan.newerThan).toEqual(new Date("2026-08-20T00:00:00Z"))
  })

  it("sizes a short backfill by how far back it has to look", () => {
    // 8 days back at 3 posts a day, plus the usual buffer.
    const [week] = planDiscoveryRuns([account({ backfillPending: true, trackFrom: "2026-09-15" })], NOW)
    expect(week.limitPerProfile).toBe(3 * 8 + 8)
    // Pinned posts take slots too, so even a tracking date of yesterday gets a sensible minimum.
    const [yesterday] = planDiscoveryRuns([account({ backfillPending: true, trackFrom: "2026-09-20" })], NOW)
    expect(yesterday.limitPerProfile).toBe(30)
  })

  it("covers the tracking window when an account has no tracking date", () => {
    const [plan] = planDiscoveryRuns([account({ backfillPending: true, windowDays: 30 })], NOW)
    expect(plan.backfill).toBe(true)
    expect(plan.newerThan).toEqual(new Date(NOW.getTime() - 32 * DAY))
    expect(plan.limitPerProfile).toBe(100)
  })

  it("never lets a new account make the routine run deep for everyone", () => {
    const routine = [account({ openPosts: 4 }), account({ openPosts: 6 })]
    const fresh = account({ backfillPending: true, trackFrom: "2026-08-21" })
    const plans = planDiscoveryRuns([...routine, fresh], NOW)
    expect(plans).toHaveLength(2)
    expect(plans[0]).toMatchObject({ backfill: false, limitPerProfile: 14 })
    expect(plans[0].accounts.map((a) => a.id)).toEqual(routine.map((a) => a.id))
    expect(plans[1]).toMatchObject({ backfill: true, limitPerProfile: 100 })
    expect(plans[1].accounts.map((a) => a.id)).toEqual([fresh.id])
  })

  it("uses the earliest date and the deepest limit of a backfill batch", () => {
    const [plan] = planDiscoveryRuns(
      [
        account({ backfillPending: true, trackFrom: "2026-09-15" }),
        account({ backfillPending: true, trackFrom: "2026-09-01" }),
      ],
      NOW
    )
    expect(plan.newerThan).toEqual(new Date("2026-08-31T00:00:00Z"))
    expect(plan.limitPerProfile).toBe(3 * 22 + 8)
  })

  it("keeps platforms apart and splits large groups", () => {
    const tiktok = Array.from({ length: 26 }, () => account())
    const instagram = [account({ platform: "instagram" })]
    const backfills = Array.from({ length: 6 }, () => account({ backfillPending: true }))
    const plans = planDiscoveryRuns([...tiktok, ...instagram, ...backfills], NOW)
    expect(plans.map((p) => [p.platform, p.backfill, p.accounts.length])).toEqual([
      ["tiktok", false, 25],
      ["tiktok", false, 1],
      ["tiktok", true, 5],
      ["tiktok", true, 1],
      ["instagram", false, 1],
    ])
  })

  it("never asks for more than the cap", () => {
    const [routine] = planDiscoveryRuns([account({ openPosts: 400 })], NOW)
    const [backfill] = planDiscoveryRuns([account({ backfillPending: true, trackFrom: "2025-01-01" })], NOW)
    expect(routine.limitPerProfile).toBe(100)
    expect(backfill.limitPerProfile).toBe(100)
  })
})
