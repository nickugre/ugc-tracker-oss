import type { Platform } from "@/db/schema/enums"

import type { Cycle } from "./cycles"
import { normalizeMilestones, tierFor } from "./rules"
import type { Milestone } from "./types"

// A video this close to the first tier is worth showing as a near miss.
const NEAR_MISS = 0.75

export type WatchPost = {
  id: string
  platform: Platform
  caption: string | null
  creatorId: string | null
  creatorName: string | null
  postedAt: Date
  windowEndsAt: Date
  status: "open" | "locked" | "paid"
  needsReview: boolean
  reviewReason: string | null
  lockedViews: number | null
  paidViews: number | null
  payableViews: number | null
  currentViews: number
}

export type WatchState =
  // In this cycle's bonus pool and earning money.
  | "pays"
  // In the pool with a tier of its own, but the bonus went to a better video (non-stacking).
  | "outranked"
  // In the pool, below the first tier.
  | "no_tier"
  // Not in the pool yet, and why.
  | "needs_review"
  | "not_locked"
  | "open_window"
  | "rolls_over"

export type WatchRow = WatchPost & {
  // Payable views once locked; until then today's views minus known paid views.
  views: number
  isLocked: boolean
  tier: Milestone | null
  nextTier: Milestone | null
  shortBy: number | null
  state: WatchState
  // What this video adds to this cycle's payout, and what its tier is worth on paper.
  amountCents: number
  potentialCents: number
}

export type WatchInput = {
  posts: WatchPost[]
  milestones: readonly Milestone[]
  cycle: Cycle
  now: Date
  // Bonus items the engine actually paid in this cycle, so this view can never disagree with it.
  winners: { postId: string; amountCents: number }[]
}

// Every video at or near a milestone, with the reason it does or does not earn a bonus in this
// cycle. Explains the engine's result; it never computes money of its own.
export function milestoneWatch({ posts, milestones, cycle, now, winners }: WatchInput): WatchRow[] {
  const ladder = normalizeMilestones(milestones)
  if (ladder.length === 0) return []
  const paid = new Map(winners.filter((w) => w.amountCents > 0).map((w) => [w.postId, w.amountCents]))
  const floor = ladder[0].views * NEAR_MISS

  const rows: WatchRow[] = []
  for (const post of posts) {
    if (post.postedAt >= cycle.endsAt) continue
    const isLocked = post.status !== "open" && post.payableViews != null
    const views = isLocked ? post.payableViews! : Math.max(0, post.currentViews - (post.paidViews ?? 0))
    if (views < floor) continue

    const tier = tierFor(ladder, views)
    const nextTier = ladder.find((t) => t.views > views) ?? null
    const closesInCycle = post.windowEndsAt <= cycle.endsAt

    let state: WatchState
    if (post.needsReview) state = "needs_review"
    else if (!closesInCycle) state = "rolls_over"
    else if (!isLocked) state = post.windowEndsAt > now ? "open_window" : "not_locked"
    else if (paid.has(post.id)) state = "pays"
    else state = tier ? "outranked" : "no_tier"

    rows.push({
      ...post,
      views,
      isLocked,
      tier,
      nextTier,
      shortBy: nextTier ? nextTier.views - views : null,
      state,
      amountCents: paid.get(post.id) ?? 0,
      potentialCents: tier?.amountCents ?? 0,
    })
  }

  return rows.sort(
    (a, b) =>
      (a.creatorName ?? "").localeCompare(b.creatorName ?? "") || b.views - a.views || a.id.localeCompare(b.id)
  )
}
