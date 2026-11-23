import { describe, expect, it } from "vitest"

import { COMMENTS_PER_POST, planCommentReads } from "../comment-plan"

const PRICE = 0.00125
const post = (id: string, currentComments: number) => ({ id, currentComments })

describe("planCommentReads", () => {
  it("takes candidates in order until the day's allowance is used", () => {
    const plan = planCommentReads([post("a", 80), post("b", 40), post("c", 20)], {
      remainingBudgetUsd: 10,
      remainingToday: 2,
      pricePerCommentUsd: PRICE,
    })
    expect(plan.posts.map((p) => p.id)).toEqual(["a", "b"])
  })

  it("prices a video by the comments it can return, never more than the per-video limit", () => {
    const plan = planCommentReads([post("big", 5000), post("small", 4)], {
      remainingBudgetUsd: 10,
      remainingToday: 10,
      pricePerCommentUsd: PRICE,
    })
    expect(plan.estimatedUsd).toBeCloseTo((COMMENTS_PER_POST + 4) * PRICE, 10)
  })

  it("never plans past the month's comment budget, but still fits a cheaper video in", () => {
    const plan = planCommentReads([post("a", 100), post("b", 100), post("c", 5)], {
      // Room for one full video and a small one.
      remainingBudgetUsd: COMMENTS_PER_POST * PRICE + 0.01,
      remainingToday: 10,
      pricePerCommentUsd: PRICE,
    })
    expect(plan.posts.map((p) => p.id)).toEqual(["a", "c"])
    expect(plan.estimatedUsd).toBeLessThanOrEqual(COMMENTS_PER_POST * PRICE + 0.01)
  })

  it("plans nothing when the budget or the day is used up", () => {
    const limits = { remainingBudgetUsd: 1, remainingToday: 5, pricePerCommentUsd: PRICE }
    expect(planCommentReads([post("a", 50)], { ...limits, remainingBudgetUsd: 0 }).posts).toHaveLength(0)
    expect(planCommentReads([post("a", 50)], { ...limits, remainingBudgetUsd: -0.2 }).posts).toHaveLength(0)
    expect(planCommentReads([post("a", 50)], { ...limits, remainingToday: 0 }).posts).toHaveLength(0)
    expect(planCommentReads([post("a", 50)], { ...limits, remainingToday: -3 }).posts).toHaveLength(0)
  })
})
