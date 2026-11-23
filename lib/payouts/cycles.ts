import { TZDate } from "@date-fns/tz"

import type { CycleType } from "./types"

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export type Cycle = {
  cycleType: CycleType
  // Calendar dates (YYYY-MM-DD) in the campaign time zone. periodEnd is the last day, inclusive.
  periodStart: string
  periodEnd: string
  // The same boundaries as instants. endsAt is exclusive.
  startsAt: Date
  endsAt: Date
  timezone: string
  // Local calendar days in the cycle: 28–31 for a month, 7 for a week.
  days: number
}

export type PaydayRule = "last_day_of_month" | "end_of_cycle"

// Calendar dates are handled as y/m/d numbers and only ever shifted through Date.UTC, which has
// no DST. Instants are derived from them at the very end (startOfLocalDay). Adding n × 24h to an
// instant is never used for calendar maths: across a DST change it lands at 23:00 or 01:00.
//
// TZDate is only used in ONE direction: instant → local calendar fields. That direction rests on
// Intl alone. The other one, new TZDate(year, month, day, zone), goes through the host's native
// Date and (as of @date-fns/tz 1.5) returns a different instant on some DST-change days depending
// on the time zone of the machine it runs on. A payout boundary must not depend on whose laptop
// computed it.

type Ymd = { year: number; month: number; day: number }

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDay(value: string): Ymd {
  const match = typeof value === "string" ? DAY_PATTERN.exec(value) : null
  if (match) {
    const ymd = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    // Date.UTC rolls 2026-02-30 over into March; a real date survives the round trip.
    if (formatDay(new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day))) === value) return ymd
  }
  throw new RangeError(`Expected a calendar date as YYYY-MM-DD, got "${value}"`)
}

// Reads the UTC fields, so it must only be given dates built with Date.UTC.
function formatDay(utcDate: Date): string {
  const year = String(utcDate.getUTCFullYear()).padStart(4, "0")
  const month = String(utcDate.getUTCMonth() + 1).padStart(2, "0")
  const day = String(utcDate.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function shiftDay({ year, month, day }: Ymd, days: number): string {
  return formatDay(new Date(Date.UTC(year, month - 1, day + days)))
}

// Pure calendar arithmetic on a YYYY-MM-DD string.
export function addDays(day: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`days must be an integer, got ${days}`)
  return shiftDay(parseDay(day), days)
}

function localDay(time: number, timeZone: string): string {
  const local = new TZDate(time, timeZone)
  return formatDay(new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate())))
}

const knownTimeZones = new Set<string>()

// Intl is the authority here, not TZDate: TZDate reports an unknown zone as an Invalid Date, and
// because of how it caches offsets it starts accepting "" as UTC once any UTC date has been
// built, which would make the outcome depend on what ran earlier in the process.
function assertTimeZone(timeZone: string) {
  if (knownTimeZones.has(timeZone)) return
  try {
    if (typeof timeZone !== "string" || timeZone.trim() === "") throw new RangeError()
    new Intl.DateTimeFormat("en-US", { timeZone })
  } catch {
    throw new RangeError(`Unknown time zone "${timeZone}"`)
  }
  knownTimeZones.add(timeZone)
}

// The calendar date (YYYY-MM-DD) an instant falls on in a time zone.
export function localDayOf(instant: Date, timeZone: string): string {
  assertTimeZone(timeZone)
  const time = instant instanceof Date ? instant.getTime() : Number.NaN
  if (Number.isNaN(time)) throw new RangeError("instant is not a valid date")
  return localDay(time, timeZone)
}

// The first instant of a calendar day in a time zone: the earliest instant whose local date is
// `day`. Usually that is local midnight, but where clocks spring forward AT midnight (Santiago,
// Cairo, Beirut, the Azores…) the day starts at 01:00, and where midnight happens twice the
// first one counts. Found by bisection on the local date, which only ever moves forward, so no
// assumption about offsets, gaps or overlaps is needed.
export function startOfLocalDay(day: string, timeZone: string): Date {
  assertTimeZone(timeZone)
  const { year, month, day: dayOfMonth } = parseDay(day)
  const utcMidnight = Date.UTC(year, month - 1, dayOfMonth)
  // UTC offsets run from -12h to +14h, so the local date is still earlier than `day` at `before`
  // and has reached it at `reached`. Both bounds have two hours to spare.
  let before = utcMidnight - 16 * HOUR_MS
  let reached = utcMidnight + 14 * HOUR_MS
  while (reached - before > 1) {
    const middle = before + Math.floor((reached - before) / 2)
    if (localDay(middle, timeZone) < day) before = middle
    else reached = middle
  }
  // Samoa had no 30 December 2011: the first date on or after it is the 31st.
  if (localDay(reached, timeZone) !== day) {
    throw new RangeError(`${day} does not exist in ${timeZone}`)
  }
  return new Date(reached)
}

function assertWeekStartsOn(weekStartsOn: number) {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new RangeError(`weekStartsOn must be an integer from 0 (Sunday) to 6, got ${weekStartsOn}`)
  }
}

// The cycle whose calendar days include `day`.
function cycleContainingDay(
  cycleType: CycleType,
  timezone: string,
  weekStartsOn: number,
  day: Ymd
): Cycle {
  assertWeekStartsOn(weekStartsOn)
  let first: Ymd
  let nextFirst: Ymd
  if (cycleType === "monthly") {
    first = { year: day.year, month: day.month, day: 1 }
    // Month 13 rolls over into January of the next year inside Date.UTC.
    nextFirst = { year: day.year, month: day.month + 1, day: 1 }
  } else if (cycleType === "weekly") {
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
    const sinceWeekStart = (weekday - weekStartsOn + 7) % 7
    first = { ...day, day: day.day - sinceWeekStart }
    nextFirst = { ...first, day: first.day + 7 }
  } else {
    throw new RangeError(`Unknown cycle type "${String(cycleType)}"`)
  }

  const periodStart = shiftDay(first, 0)
  const nextPeriodStart = shiftDay(nextFirst, 0)
  const startsAt = startOfLocalDay(periodStart, timezone)
  const endsAt = startOfLocalDay(nextPeriodStart, timezone)
  // Counted on the calendar, not from the instants: a month with a DST change is still 31 days
  // even though it lasts 31 × 24 ± 1 hours.
  const days =
    (Date.UTC(nextFirst.year, nextFirst.month - 1, nextFirst.day) -
      Date.UTC(first.year, first.month - 1, first.day)) /
    DAY_MS
  return {
    cycleType,
    periodStart,
    periodEnd: addDays(nextPeriodStart, -1),
    startsAt,
    endsAt,
    timezone,
    days,
  }
}

// The cycle containing `anchor`. Monthly: the 1st of the month 00:00 in the campaign time zone up
// to the 1st of the next month. Weekly: seven local days starting on `weekStartsOn`.
export function getCycle(
  cycleType: CycleType,
  timezone: string,
  weekStartsOn: number,
  anchor: Date
): Cycle {
  return cycleContainingDay(cycleType, timezone, weekStartsOn, parseDay(localDayOf(anchor, timezone)))
}

// Rebuilds a cycle from its stored period_start. The date is snapped to the cycle that contains
// it, so every cycle this module returns sits on the one grid defined by (cycleType,
// weekStartsOn): two cycles of a campaign are either the same or disjoint, and a post can never
// fall into two of them. For an aligned date the result starts exactly on it.
export function getCycleByStart(
  cycleType: CycleType,
  timezone: string,
  weekStartsOn: number,
  periodStart: string
): Cycle {
  assertTimeZone(timezone)
  return cycleContainingDay(cycleType, timezone, weekStartsOn, parseDay(periodStart))
}

export function previousCycle(cycle: Cycle, weekStartsOn: number): Cycle {
  const lastDayBefore = addDays(cycle.periodStart, -1)
  return getCycleByStart(cycle.cycleType, cycle.timezone, weekStartsOn, lastDayBefore)
}

export function nextCycle(cycle: Cycle, weekStartsOn: number): Cycle {
  const firstDayAfter = addDays(cycle.periodEnd, 1)
  return getCycleByStart(cycle.cycleType, cycle.timezone, weekStartsOn, firstDayAfter)
}

// startsAt <= instant < endsAt
export function isInCycle(instant: Date, cycle: Cycle): boolean {
  const time = instant instanceof Date ? instant.getTime() : Number.NaN
  if (Number.isNaN(time)) throw new RangeError("instant is not a valid date")
  return time >= cycle.startsAt.getTime() && time < cycle.endsAt.getTime()
}

// The date the cycle is paid on, as YYYY-MM-DD in the campaign time zone.
export function paydayFor(cycle: Cycle, rule: PaydayRule): string {
  if (rule === "end_of_cycle") return cycle.periodEnd
  if (rule === "last_day_of_month") {
    const { year, month } = parseDay(cycle.periodEnd)
    // Day 0 of the next month is the last day of this one.
    return formatDay(new Date(Date.UTC(year, month, 0)))
  }
  throw new RangeError(`Unknown payday rule "${String(rule)}"`)
}
