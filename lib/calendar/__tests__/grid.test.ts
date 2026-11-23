import { describe, expect, it } from "vitest"

import { buildCells, countByLocalDay, daysBetween, pacePerDay, postingTarget, type CellsInput } from "../grid"

const NY = "America/New_York"

describe("postingTarget", () => {
  it("turns the contract's 60 posts a month into 2 a day, in a 30- and a 31-day month", () => {
    expect(postingTarget(60, 30)).toEqual({ perDay: 2, everyDay: true })
    expect(postingTarget(60, 31)).toEqual({ perDay: 2, everyDay: true })
    expect(postingTarget(60, 28)).toEqual({ perDay: 2, everyDay: true })
  })

  it("never asks for less than one post on a day, and marks a sparse quota as not daily", () => {
    expect(postingTarget(12, 30)).toEqual({ perDay: 1, everyDay: false })
    expect(postingTarget(30, 30)).toEqual({ perDay: 1, everyDay: true })
  })

  it("has no target without a quota, or with a quota overridden to 0", () => {
    expect(postingTarget(null, 30)).toBeNull()
    expect(postingTarget(0, 30)).toBeNull()
  })

  it("refuses a cycle without days", () => {
    expect(() => postingTarget(60, 0)).toThrow(RangeError)
  })
})

describe("countByLocalDay", () => {
  it("counts a 21:00 New York post on the New York day, although it is already tomorrow in UTC", () => {
    const counts = countByLocalDay(
      [new Date("2026-09-04T01:00:00Z"), new Date("2026-09-03T15:00:00Z"), new Date("2026-09-04T15:00:00Z")],
      NY
    )
    expect(counts).toEqual(
      new Map([
        ["2026-09-03", 2],
        ["2026-09-04", 1],
      ])
    )
  })

  it("puts the same instants on different days for a creator in Tbilisi", () => {
    const counts = countByLocalDay([new Date("2026-09-03T21:00:00Z")], "Asia/Tbilisi")
    expect(counts).toEqual(new Map([["2026-09-04", 1]]))
  })
})

describe("buildCells", () => {
  const base: CellsInput = {
    days: daysBetween("2026-09-01", "2026-09-07"),
    counts: new Map([
      ["2026-09-02", 2],
      ["2026-09-03", 1],
      ["2026-09-05", 3],
      ["2026-09-06", 1],
    ]),
    target: { perDay: 2, everyDay: true },
    activeFrom: "2026-09-02",
    activeTo: null,
    // Last scraped some time on the 5th: the 4th and everything before it is final.
    judgedBefore: "2026-09-05",
    today: "2026-09-06",
  }
  const states = (input: CellsInput) => buildCells(input).map((cell) => cell.state)

  it("judges finished days, waits on unfinished ones and leaves the rest blank", () => {
    expect(states(base)).toEqual([
      "off", // before the creator started
      "hit",
      "below",
      "missed",
      "hit", // not fully scraped, but the target is already reached
      "pending", // 1 of 2 so far today
      "off", // tomorrow
    ])
    expect(buildCells(base).map((cell) => cell.count)).toEqual([0, 2, 1, 0, 3, 1, 0])
  })

  it("judges nothing before the first successful scrape", () => {
    expect(states({ ...base, judgedBefore: null })).toEqual([
      "off",
      "hit",
      "pending",
      "pending",
      "hit",
      "pending",
      "off",
    ])
  })

  it("stops expecting posts after the creator's end date", () => {
    expect(states({ ...base, activeTo: "2026-09-03" }).slice(3)).toEqual(["off", "off", "off", "off"])
  })

  it("does not call an empty day missed when the quota is less than a post a day", () => {
    const sparse = states({ ...base, target: { perDay: 1, everyDay: false } })
    expect(sparse).toEqual(["off", "hit", "hit", "idle", "hit", "hit", "off"])
  })

  it("only reports counts when there is no quota", () => {
    expect(states({ ...base, target: null })).toEqual([
      "off",
      "posted",
      "posted",
      "idle",
      "posted",
      "posted",
      "off",
    ])
  })
})

describe("daysBetween", () => {
  it("lists every day of a month, across a DST change", () => {
    const november = daysBetween("2026-11-01", "2026-11-30")
    expect(november).toHaveLength(30)
    expect(november[0]).toBe("2026-11-01")
    expect(november[29]).toBe("2026-11-30")
  })

  it("is empty when the range is backwards and refuses anything that is not a date", () => {
    expect(daysBetween("2026-09-02", "2026-09-01")).toEqual([])
    expect(() => daysBetween("soon", "2026-09-01")).toThrow(RangeError)
  })
})

describe("pacePerDay", () => {
  const cycle = { periodStart: "2026-09-01", periodEnd: "2026-09-30" }

  it("spreads what is left over the days that remain, today included", () => {
    expect(pacePerDay(19, "2026-09-21", cycle)).toBeCloseTo(1.9)
    expect(pacePerDay(4, "2026-09-30", cycle)).toBe(4)
  })

  it("uses the whole cycle before it starts and gives up after it ends", () => {
    expect(pacePerDay(60, "2026-08-25", cycle)).toBe(2)
    expect(pacePerDay(19, "2026-10-01", cycle)).toBeNull()
  })

  it("is 0 when nothing is left and null without a quota", () => {
    expect(pacePerDay(0, "2026-09-21", cycle)).toBe(0)
    expect(pacePerDay(null, "2026-09-21", cycle)).toBeNull()
  })
})
