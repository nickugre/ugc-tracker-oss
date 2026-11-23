import { describe, expect, it } from "vitest"

import { DAY_MS, computeWindowEndsAt, hoursUntilClose, isWindowClosed } from "../window"

describe("computeWindowEndsAt", () => {
  it("adds exactly windowDays × 24 hours", () => {
    const postedAt = new Date("2026-08-01T15:30:12.345Z")
    const endsAt = computeWindowEndsAt(postedAt, 14)
    expect(endsAt.toISOString()).toBe("2026-08-15T15:30:12.345Z")
    expect(endsAt.getTime() - postedAt.getTime()).toBe(14 * DAY_MS)
  })

  it("satisfies the database check constraint for every allowed window", () => {
    const postedAt = new Date("2026-02-27T23:59:59.999Z")
    for (let days = 1; days <= 365; days++) {
      const seconds = (computeWindowEndsAt(postedAt, days).getTime() - postedAt.getTime()) / 1000
      expect(seconds).toBe(days * 86_400)
    }
  })

  it("is a fixed duration, so it does not follow the wall clock across a DST change", () => {
    // 10:00 in New York on 1 March 2026 (EST). Fourteen 24h periods later it is 11:00 EDT.
    const endsAt = computeWindowEndsAt(new Date("2026-03-01T15:00:00Z"), 14)
    expect(endsAt.toISOString()).toBe("2026-03-15T15:00:00.000Z")
  })

  it("does not mutate its input and returns a plain Date", () => {
    const postedAt = new Date("2026-08-01T00:00:00Z")
    const endsAt = computeWindowEndsAt(postedAt, 1)
    expect(postedAt.toISOString()).toBe("2026-08-01T00:00:00.000Z")
    expect(endsAt).toBeInstanceOf(Date)
    expect(endsAt).not.toBe(postedAt)
  })

  it("throws a RangeError unless windowDays is an integer from 1 to 365", () => {
    const postedAt = new Date("2026-08-01T00:00:00Z")
    for (const bad of [0, -1, 366, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeWindowEndsAt(postedAt, bad)).toThrow(RangeError)
    }
    expect(() => computeWindowEndsAt(postedAt, "14" as unknown as number)).toThrow(RangeError)
    expect(computeWindowEndsAt(postedAt, 1).toISOString()).toBe("2026-08-02T00:00:00.000Z")
    expect(computeWindowEndsAt(postedAt, 365).toISOString()).toBe("2027-08-01T00:00:00.000Z")
  })

  it("throws on an invalid postedAt", () => {
    expect(() => computeWindowEndsAt(new Date("nope"), 14)).toThrow(RangeError)
  })
})

describe("isWindowClosed", () => {
  const endsAt = new Date("2026-08-15T12:00:00Z")

  it("is closed from the end instant onwards", () => {
    expect(isWindowClosed(endsAt, new Date("2026-08-15T11:59:59.999Z"))).toBe(false)
    expect(isWindowClosed(endsAt, new Date("2026-08-15T12:00:00.000Z"))).toBe(true)
    expect(isWindowClosed(endsAt, new Date("2026-08-15T12:00:00.001Z"))).toBe(true)
  })

  it("throws on an invalid date instead of reporting an open window", () => {
    expect(() => isWindowClosed(new Date(Number.NaN), new Date(0))).toThrow(RangeError)
    expect(() => isWindowClosed(endsAt, new Date(Number.NaN))).toThrow(RangeError)
  })
})

describe("hoursUntilClose", () => {
  const endsAt = new Date("2026-08-15T12:00:00Z")

  it("is positive before the end, zero at it and negative after it", () => {
    expect(hoursUntilClose(endsAt, new Date("2026-08-15T07:00:00Z"))).toBe(5)
    expect(hoursUntilClose(endsAt, new Date("2026-08-15T11:30:00Z"))).toBe(0.5)
    expect(hoursUntilClose(endsAt, endsAt)).toBe(0)
    expect(hoursUntilClose(endsAt, new Date("2026-08-16T12:00:00Z"))).toBe(-24)
  })
})
