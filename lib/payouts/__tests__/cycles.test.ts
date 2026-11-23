import { describe, expect, it } from "vitest"

import {
  type Cycle,
  addDays,
  getCycle,
  getCycleByStart,
  isInCycle,
  localDayOf,
  nextCycle,
  paydayFor,
  previousCycle,
  startOfLocalDay,
} from "../cycles"

const HOUR = 3_600_000
const NY = "America/New_York"
const LA = "America/Los_Angeles"

const hours = (cycle: Cycle) => (cycle.endsAt.getTime() - cycle.startsAt.getTime()) / HOUR

describe("monthly cycles", () => {
  it("puts 23:30 on 31 August in Los Angeles into the AUGUST cycle, although it is September in UTC", () => {
    const anchor = new Date("2026-09-01T06:30:00Z")
    const cycle = getCycle("monthly", LA, 1, anchor)
    expect(cycle).toEqual({
      cycleType: "monthly",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      startsAt: new Date("2026-08-01T07:00:00.000Z"),
      endsAt: new Date("2026-09-01T07:00:00.000Z"),
      timezone: LA,
      days: 31,
    })
    expect(isInCycle(anchor, cycle)).toBe(true)
    // The same instant is already September for a campaign run in UTC or in New York.
    expect(getCycle("monthly", "UTC", 1, anchor).periodStart).toBe("2026-09-01")
    expect(getCycle("monthly", NY, 1, anchor).periodStart).toBe("2026-09-01")
    // Half an hour later it is September in Los Angeles too.
    expect(getCycle("monthly", LA, 1, new Date("2026-09-01T07:00:00Z")).periodStart).toBe("2026-09-01")
  })

  it("has the right instants for March 2026 in New York (clocks go forward on the 8th)", () => {
    const cycle = getCycleByStart("monthly", NY, 1, "2026-03-01")
    expect(cycle.startsAt.toISOString()).toBe("2026-03-01T05:00:00.000Z") // 00:00 EST
    expect(cycle.endsAt.toISOString()).toBe("2026-04-01T04:00:00.000Z") // 00:00 EDT
    expect(cycle.periodEnd).toBe("2026-03-31")
    expect(cycle.days).toBe(31)
    expect(hours(cycle)).toBe(31 * 24 - 1)
  })

  it("has the right instants for November 2026 in New York (clocks go back on the 1st)", () => {
    const cycle = getCycleByStart("monthly", NY, 1, "2026-11-01")
    expect(cycle.startsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z") // 00:00 EDT
    expect(cycle.endsAt.toISOString()).toBe("2026-12-01T05:00:00.000Z") // 00:00 EST
    expect(cycle.periodEnd).toBe("2026-11-30")
    expect(cycle.days).toBe(30)
    expect(hours(cycle)).toBe(30 * 24 + 1)
    // 01:30 happens twice that night; both belong to November.
    expect(isInCycle(new Date("2026-11-01T05:30:00Z"), cycle)).toBe(true)
    expect(isInCycle(new Date("2026-11-01T06:30:00Z"), cycle)).toBe(true)
  })

  it("knows the length of every month, leap years included", () => {
    const lengths = (year: number) =>
      Array.from({ length: 12 }, (_, i) =>
        getCycleByStart("monthly", NY, 1, `${year}-${String(i + 1).padStart(2, "0")}-01`).days
      )
    expect(lengths(2026)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    expect(lengths(2028)).toEqual([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    expect(getCycleByStart("monthly", NY, 1, "2028-02-01").periodEnd).toBe("2028-02-29")
  })

  it("rolls over the year", () => {
    const december = getCycle("monthly", NY, 1, new Date("2026-12-15T12:00:00Z"))
    expect(december.periodStart).toBe("2026-12-01")
    expect(december.periodEnd).toBe("2026-12-31")
    expect(december.endsAt.toISOString()).toBe("2027-01-01T05:00:00.000Z")
    expect(nextCycle(december, 1).periodStart).toBe("2027-01-01")
    expect(previousCycle(nextCycle(december, 1), 1)).toEqual(december)
  })

  it("handles zones far from UTC", () => {
    const kiritimati = getCycleByStart("monthly", "Pacific/Kiritimati", 1, "2026-08-01")
    expect(kiritimati.startsAt.toISOString()).toBe("2026-07-31T10:00:00.000Z") // UTC+14
    const kolkata = getCycleByStart("monthly", "Asia/Kolkata", 1, "2026-08-01")
    expect(kolkata.startsAt.toISOString()).toBe("2026-07-31T18:30:00.000Z") // UTC+5:30
    const honolulu = getCycleByStart("monthly", "Pacific/Honolulu", 1, "2026-08-01")
    expect(honolulu.startsAt.toISOString()).toBe("2026-08-01T10:00:00.000Z") // UTC-10
  })
})

describe("weekly cycles", () => {
  it("starts on weekStartsOn and lasts seven local days", () => {
    // 2026-08-12 is a Wednesday.
    const anchor = new Date("2026-08-12T15:00:00Z")
    const monday = getCycle("weekly", NY, 1, anchor)
    expect(monday.periodStart).toBe("2026-08-10")
    expect(monday.periodEnd).toBe("2026-08-16")
    expect(monday.startsAt.toISOString()).toBe("2026-08-10T04:00:00.000Z")
    expect(monday.endsAt.toISOString()).toBe("2026-08-17T04:00:00.000Z")
    expect(monday.days).toBe(7)

    const sunday = getCycle("weekly", NY, 0, anchor)
    expect([sunday.periodStart, sunday.periodEnd]).toEqual(["2026-08-09", "2026-08-15"])
    const saturday = getCycle("weekly", NY, 6, anchor)
    expect([saturday.periodStart, saturday.periodEnd]).toEqual(["2026-08-08", "2026-08-14"])
    const wednesday = getCycle("weekly", NY, 3, anchor)
    expect([wednesday.periodStart, wednesday.periodEnd]).toEqual(["2026-08-12", "2026-08-18"])
  })

  it("is still seven local days across the spring DST change (167 hours)", () => {
    const cycle = getCycle("weekly", NY, 1, new Date("2026-03-08T12:00:00Z"))
    expect([cycle.periodStart, cycle.periodEnd]).toEqual(["2026-03-02", "2026-03-08"])
    expect(cycle.startsAt.toISOString()).toBe("2026-03-02T05:00:00.000Z")
    expect(cycle.endsAt.toISOString()).toBe("2026-03-09T04:00:00.000Z")
    expect(cycle.days).toBe(7)
    expect(hours(cycle)).toBe(167)
  })

  it("is still seven local days across the autumn DST change (169 hours)", () => {
    const cycle = getCycleByStart("weekly", NY, 1, "2026-10-26")
    expect([cycle.periodStart, cycle.periodEnd]).toEqual(["2026-10-26", "2026-11-01"])
    expect(cycle.startsAt.toISOString()).toBe("2026-10-26T04:00:00.000Z")
    expect(cycle.endsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z")
    expect(cycle.days).toBe(7)
    expect(hours(cycle)).toBe(169)
  })

  it("spans month and year boundaries", () => {
    const cycle = getCycle("weekly", NY, 1, new Date("2027-01-01T12:00:00Z"))
    expect([cycle.periodStart, cycle.periodEnd]).toEqual(["2026-12-28", "2027-01-03"])
  })

  it("starts at 01:00 where clocks jump forward at midnight", () => {
    // Santiago, Sunday 6 September 2026: 00:00 does not exist.
    const cycle = getCycleByStart("weekly", "America/Santiago", 0, "2026-09-06")
    expect(cycle.startsAt.toISOString()).toBe("2026-09-06T04:00:00.000Z")
    expect(cycle.endsAt.toISOString()).toBe("2026-09-13T03:00:00.000Z")
    expect(hours(cycle)).toBe(167)
    // No gap and no overlap with the week before.
    expect(previousCycle(cycle, 0).endsAt).toEqual(cycle.startsAt)
    expect(localDayOf(new Date(cycle.startsAt.getTime() - 1), "America/Santiago")).toBe("2026-09-05")
  })
})

describe("previousCycle / nextCycle", () => {
  it("round-trips", () => {
    const cases = [
      ["monthly", NY, 1, "2026-03-01"],
      ["monthly", NY, 1, "2026-11-01"],
      ["monthly", LA, 1, "2026-01-01"],
      ["weekly", NY, 1, "2026-03-02"],
      ["weekly", NY, 0, "2026-11-01"],
      ["weekly", "Europe/London", 1, "2026-03-23"],
      ["weekly", "America/Santiago", 0, "2026-09-06"],
    ] as const
    for (const [cycleType, zone, weekStartsOn, periodStart] of cases) {
      const cycle = getCycleByStart(cycleType, zone, weekStartsOn, periodStart)
      expect(cycle.periodStart).toBe(periodStart)
      expect(nextCycle(previousCycle(cycle, weekStartsOn), weekStartsOn)).toEqual(cycle)
      expect(previousCycle(nextCycle(cycle, weekStartsOn), weekStartsOn)).toEqual(cycle)
    }
  })

  it("moves by exactly one period", () => {
    const march = getCycleByStart("monthly", NY, 1, "2026-03-01")
    expect(previousCycle(march, 1).periodStart).toBe("2026-02-01")
    expect(previousCycle(march, 1).days).toBe(28)
    expect(nextCycle(march, 1).periodStart).toBe("2026-04-01")

    const week = getCycleByStart("weekly", NY, 1, "2026-03-02")
    expect(previousCycle(week, 1).periodStart).toBe("2026-02-23")
    expect(nextCycle(week, 1).periodStart).toBe("2026-03-09")
  })

  it("tiles time with no gaps and no overlaps", () => {
    for (const [cycleType, steps] of [["monthly", 30], ["weekly", 120]] as const) {
      let cycle = getCycleByStart(cycleType, NY, 1, "2026-01-05")
      let totalDays = 0
      const first = cycle
      for (let i = 0; i < steps; i++) {
        const next = nextCycle(cycle, 1)
        expect(next.startsAt).toEqual(cycle.endsAt)
        expect(next.periodStart).toBe(addDays(cycle.periodEnd, 1))
        expect(cycle.startsAt.getTime()).toBeLessThan(cycle.endsAt.getTime())
        totalDays += cycle.days
        cycle = next
      }
      expect(addDays(first.periodStart, totalDays)).toBe(cycle.periodStart)
    }
  })
})

describe("getCycle", () => {
  it("always returns the cycle that contains the anchor, and rebuilds identically from periodStart", () => {
    const zones = [NY, LA, "UTC", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "America/Santiago", "Pacific/Apia"]
    let seed = 2026
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed % max
    }
    const from = Date.UTC(2025, 0, 1)
    for (let i = 0; i < 400; i++) {
      const anchor = new Date(from + next(3 * 365) * 86_400_000 + next(86_400_000))
      const zone = zones[next(zones.length)]
      const weekStartsOn = next(7)
      const cycleType = next(2) === 0 ? "weekly" : "monthly"
      const cycle = getCycle(cycleType, zone, weekStartsOn, anchor)
      expect(isInCycle(anchor, cycle)).toBe(true)
      expect(localDayOf(cycle.startsAt, zone)).toBe(cycle.periodStart)
      expect(localDayOf(new Date(cycle.endsAt.getTime() - 1), zone)).toBe(cycle.periodEnd)
      expect(getCycleByStart(cycleType, zone, weekStartsOn, cycle.periodStart)).toEqual(cycle)
      if (cycleType === "weekly") {
        expect(new Date(`${cycle.periodStart}T00:00:00Z`).getUTCDay()).toBe(weekStartsOn)
        expect(cycle.days).toBe(7)
      } else {
        expect(cycle.periodStart.endsWith("-01")).toBe(true)
      }
    }
  })

  it("returns plain Dates", () => {
    const cycle = getCycle("monthly", NY, 1, new Date("2026-08-12T15:00:00Z"))
    expect(Object.getPrototypeOf(cycle.startsAt)).toBe(Date.prototype)
    expect(Object.getPrototypeOf(cycle.endsAt)).toBe(Date.prototype)
  })

  it("rejects bad arguments", () => {
    const anchor = new Date("2026-08-12T15:00:00Z")
    expect(() => getCycle("monthly", "Mars/Olympus_Mons", 1, anchor)).toThrow(RangeError)
    // @date-fns/tz starts treating "" as UTC once a UTC date has been built; we must not.
    expect(getCycle("monthly", "UTC", 1, anchor).periodStart).toBe("2026-08-01")
    expect(() => getCycle("monthly", "", 1, anchor)).toThrow(RangeError)
    expect(() => getCycle("monthly", "  ", 1, anchor)).toThrow(RangeError)
    expect(() => getCycleByStart("monthly", "", 1, "2026-08-01")).toThrow(RangeError)
    expect(() => getCycle("monthly", NY, 1, new Date(Number.NaN))).toThrow(RangeError)
    expect(() => getCycle("weekly", NY, 7, anchor)).toThrow(RangeError)
    expect(() => getCycle("weekly", NY, -1, anchor)).toThrow(RangeError)
    expect(() => getCycle("weekly", NY, 1.5, anchor)).toThrow(RangeError)
    expect(() => getCycle("yearly" as "monthly", NY, 1, anchor)).toThrow(RangeError)
  })
})

describe("getCycleByStart", () => {
  it("snaps an off-grid date to the cycle that contains it", () => {
    expect(getCycleByStart("monthly", NY, 1, "2026-03-17")).toEqual(
      getCycleByStart("monthly", NY, 1, "2026-03-01")
    )
    // 2026-03-05 is a Thursday.
    expect(getCycleByStart("weekly", NY, 1, "2026-03-05").periodStart).toBe("2026-03-02")
    expect(getCycleByStart("weekly", NY, 0, "2026-03-05").periodStart).toBe("2026-03-01")
  })

  it("rejects anything that is not a real YYYY-MM-DD date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-3-1", "03/01/2026", "2026-03-01T00:00:00Z", "", "today"]) {
      expect(() => getCycleByStart("monthly", NY, 1, bad)).toThrow(RangeError)
    }
  })
})

describe("isInCycle", () => {
  it("includes the start instant and excludes the end instant", () => {
    const cycle = getCycleByStart("monthly", NY, 1, "2026-08-01")
    expect(isInCycle(cycle.startsAt, cycle)).toBe(true)
    expect(isInCycle(new Date(cycle.startsAt.getTime() - 1), cycle)).toBe(false)
    expect(isInCycle(new Date(cycle.endsAt.getTime() - 1), cycle)).toBe(true)
    expect(isInCycle(cycle.endsAt, cycle)).toBe(false)
    expect(isInCycle(cycle.endsAt, nextCycle(cycle, 1))).toBe(true)
    expect(() => isInCycle(new Date(Number.NaN), cycle)).toThrow(RangeError)
  })
})

describe("paydayFor", () => {
  it("pays a monthly cycle on its last day under both rules", () => {
    const august = getCycleByStart("monthly", NY, 1, "2026-08-01")
    expect(paydayFor(august, "end_of_cycle")).toBe("2026-08-31")
    expect(paydayFor(august, "last_day_of_month")).toBe("2026-08-31")
    const february = getCycleByStart("monthly", NY, 1, "2028-02-01")
    expect(paydayFor(february, "last_day_of_month")).toBe("2028-02-29")
  })

  it("pays a weekly cycle at the end of the month its last day falls in", () => {
    const week = getCycleByStart("weekly", NY, 1, "2026-03-02")
    expect(paydayFor(week, "end_of_cycle")).toBe("2026-03-08")
    expect(paydayFor(week, "last_day_of_month")).toBe("2026-03-31")

    // 26 Oct – 1 Nov: the last day is in November.
    const straddling = getCycleByStart("weekly", NY, 1, "2026-10-26")
    expect(paydayFor(straddling, "end_of_cycle")).toBe("2026-11-01")
    expect(paydayFor(straddling, "last_day_of_month")).toBe("2026-11-30")

    const newYear = getCycleByStart("weekly", NY, 1, "2026-12-28")
    expect(paydayFor(newYear, "last_day_of_month")).toBe("2027-01-31")
  })

  it("rejects an unknown rule", () => {
    const august = getCycleByStart("monthly", NY, 1, "2026-08-01")
    expect(() => paydayFor(august, "whenever" as "end_of_cycle")).toThrow(RangeError)
  })
})

describe("calendar helpers", () => {
  it("adds days on the calendar", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31")
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09")
    expect(addDays("2026-08-01", 0)).toBe("2026-08-01")
    expect(() => addDays("2026-08-01", 0.5)).toThrow(RangeError)
  })

  it("finds the local day of an instant", () => {
    expect(localDayOf(new Date("2026-09-01T06:30:00Z"), LA)).toBe("2026-08-31")
    expect(localDayOf(new Date("2026-09-01T06:30:00Z"), "Asia/Tokyo")).toBe("2026-09-01")
    expect(localDayOf(new Date("2026-12-31T23:59:59.999Z"), "Pacific/Kiritimati")).toBe("2027-01-01")
  })

  it("finds the first instant of a local day, DST or not", () => {
    expect(startOfLocalDay("2026-03-08", NY).toISOString()).toBe("2026-03-08T05:00:00.000Z")
    expect(startOfLocalDay("2026-03-09", NY).toISOString()).toBe("2026-03-09T04:00:00.000Z")
    // Midnight does not exist on these days: the day begins at 01:00 local time.
    expect(startOfLocalDay("2026-04-24", "Africa/Cairo").toISOString()).toBe("2026-04-23T22:00:00.000Z")
    expect(startOfLocalDay("2026-03-29", "Asia/Beirut").toISOString()).toBe("2026-03-28T22:00:00.000Z")
    // Midnight happens twice in Havana on 1 November: the first one starts the day.
    expect(startOfLocalDay("2026-11-01", "America/Havana").toISOString()).toBe("2026-11-01T04:00:00.000Z")
    // Half-hour DST shift.
    expect(startOfLocalDay("2026-10-04", "Australia/Lord_Howe").toISOString()).toBe("2026-10-03T13:30:00.000Z")
  })

  it("gives the same instants whatever time zone the machine runs in", (ctx) => {
    // new TZDate(y, m, d, zone) fails this: with the host in Havana it puts midnight in Anguilla
    // (no DST at all) an hour late on 8 March 2026, the day Havana's own clocks change.
    const days: [string, string][] = [
      ["2026-03-08", "America/Anguilla"],
      ["2026-03-08", "America/Havana"],
      ["2026-11-01", "America/Havana"],
      ["2026-10-25", "Atlantic/Azores"],
      ["2026-03-29", "America/Nuuk"],
      ["2026-10-25", "America/Nuuk"],
      ["2026-04-05", "America/Santiago"],
      ["2026-09-06", "America/Santiago"],
      ["2026-03-08", NY],
      ["2026-11-01", NY],
      ["2026-10-04", "Australia/Sydney"],
      ["2026-03-29", "Europe/London"],
    ]
    // Host zone → its getTimezoneOffset() in mid-January, to prove the switch took effect.
    const hosts: [string, number][] = [
      ["UTC", 0],
      ["America/Havana", 300],
      ["America/Los_Angeles", 480],
      ["Europe/London", 0],
      ["Australia/Sydney", -660],
      ["Pacific/Kiritimati", -840],
    ]
    const original = process.env.TZ
    try {
      const perHost = hosts.map(([host, januaryOffset]) => {
        process.env.TZ = host
        // Some runtimes ignore a TZ change after start-up; then there is nothing to compare.
        if (new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset() !== januaryOffset) ctx.skip()
        return [
          ...days.map(([day, zone]) => startOfLocalDay(day, zone).toISOString()),
          JSON.stringify(getCycle("monthly", NY, 1, new Date("2026-11-01T04:30:00Z"))),
          JSON.stringify(getCycle("weekly", "America/Havana", 0, new Date("2026-11-01T04:30:00Z"))),
          localDayOf(new Date("2026-03-08T04:30:00Z"), "America/Anguilla"),
        ]
      })
      for (const results of perHost) expect(results).toEqual(perHost[0])
      expect(perHost[0].slice(0, 3)).toEqual([
        "2026-03-08T04:00:00.000Z",
        "2026-03-08T05:00:00.000Z",
        "2026-11-01T04:00:00.000Z",
      ])
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it("refuses a day that never existed in the zone", () => {
    // Samoa skipped 30 December 2011 when it crossed the date line.
    expect(() => startOfLocalDay("2011-12-30", "Pacific/Apia")).toThrow(RangeError)
    expect(startOfLocalDay("2011-12-31", "Pacific/Apia").toISOString()).toBe("2011-12-30T10:00:00.000Z")
  })
})
