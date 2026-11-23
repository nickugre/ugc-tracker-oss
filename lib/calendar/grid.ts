import { localDayOf } from "@/lib/payouts/cycles"

// Pure helpers behind the posting calendar: which local day a post belongs to and how one day of
// one creator is judged. No database and no clock in here; `today` is always passed in.

const DAY_MS = 86_400_000

// How a day reads on the grid.
//   off      outside the creator's dates, or in the future: nothing is expected
//   pending  not fully scraped yet, so a low count may still grow: never judged
//   missed   a whole day without a post, although the quota asks for one every day
//   below    posted, but fewer than the daily target
//   hit      reached the daily target
//   idle     no post, and none was due (no quota, or a quota of less than one post a day)
//   posted   posts on a track without a quota
export type DayState = "off" | "pending" | "missed" | "below" | "hit" | "idle" | "posted"

export type DayCell = { day: string; count: number; state: DayState }

export type PostingTarget = {
  // Posts that make a day count as on target.
  perDay: number
  // False for a sparse quota (fewer posts than days): a day without a post is then normal.
  everyDay: boolean
}

// 60 posts in a 30-day cycle → 2 a day. The target is a whole number because a day's count is one;
// 60 in 31 days still means 2. What rounding leaves over shows up in the "left" column instead.
export function postingTarget(quota: number | null, cycleDays: number): PostingTarget | null {
  if (quota === null || quota <= 0) return null
  if (!Number.isSafeInteger(cycleDays) || cycleDays <= 0) {
    throw new RangeError(`cycleDays must be a positive integer, got ${cycleDays}`)
  }
  return { perDay: Math.max(1, Math.round(quota / cycleDays)), everyDay: quota >= cycleDays }
}

// Posts per calendar day, in the time zone the creator lives in.
export function countByLocalDay(postedAt: readonly Date[], timeZone: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const instant of postedAt) {
    const day = localDayOf(instant, timeZone)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
}

export type CellsInput = {
  // The columns of the grid, YYYY-MM-DD, in order.
  days: readonly string[]
  counts: ReadonlyMap<string, number>
  target: PostingTarget | null
  // First and last day posts are expected on (inclusive); null = no limit on that side.
  activeFrom: string | null
  activeTo: string | null
  // Days BEFORE this one ended before the last successful scrape, so their count is final.
  // null = never scraped: nothing can be judged yet.
  judgedBefore: string | null
  // Today in the creator's time zone.
  today: string
}

export function buildCells(input: CellsInput): DayCell[] {
  const { counts, target, activeFrom, activeTo, judgedBefore, today } = input
  return input.days.map((day) => {
    const count = counts.get(day) ?? 0
    return { day, count, state: stateOf(day, count) }
  })

  // YYYY-MM-DD strings order the same way as the dates they stand for.
  function stateOf(day: string, count: number): DayState {
    if (day > today) return "off"
    if ((activeFrom !== null && day < activeFrom) || (activeTo !== null && day > activeTo)) return "off"
    if (target === null) return count > 0 ? "posted" : "idle"
    // More posts can only help, so a day that already reached the target is safe to call.
    if (count >= target.perDay) return "hit"
    if (judgedBefore === null || day >= judgedBefore) return "pending"
    if (count === 0) return target.everyDay ? "missed" : "idle"
    return "below"
  }
}

// Every calendar day from `first` to `last`, inclusive.
export function daysBetween(first: string, last: string): string[] {
  const start = Date.parse(`${first}T00:00:00Z`)
  const end = Date.parse(`${last}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new RangeError(`Expected calendar dates as YYYY-MM-DD, got "${first}" and "${last}"`)
  }
  const days: string[] = []
  for (let time = start; time <= end; time += DAY_MS) days.push(new Date(time).toISOString().slice(0, 10))
  return days
}

// Posts a day needed from `today` on to clear what is left by the end of the cycle. null once the
// cycle is over (nothing can be caught up) or when there is no quota.
export function pacePerDay(
  left: number | null,
  today: string,
  cycle: { periodStart: string; periodEnd: string }
): number | null {
  if (left === null || today > cycle.periodEnd) return null
  if (left === 0) return 0
  const from = today < cycle.periodStart ? cycle.periodStart : today
  return left / daysBetween(from, cycle.periodEnd).length
}
