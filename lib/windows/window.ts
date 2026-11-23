export const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export const MIN_WINDOW_DAYS = 1
export const MAX_WINDOW_DAYS = 365

// An Invalid Date compares false with everything, which would silently read as "still open".
function timeOf(date: Date, name: string): number {
  const time = date instanceof Date ? date.getTime() : Number.NaN
  if (Number.isNaN(time)) throw new RangeError(`${name} is not a valid date`)
  return time
}

// The view-counting window is a fixed number of 24-hour periods from the moment of posting, not
// calendar days: the posts_window_matches_days check constraint requires
// window_ends_at - posted_at to be exactly window_days × 86400 seconds, DST or not.
export function computeWindowEndsAt(postedAt: Date, windowDays: number): Date {
  if (!Number.isInteger(windowDays) || windowDays < MIN_WINDOW_DAYS || windowDays > MAX_WINDOW_DAYS) {
    throw new RangeError(
      `windowDays must be an integer from ${MIN_WINDOW_DAYS} to ${MAX_WINDOW_DAYS}, got ${windowDays}`
    )
  }
  const endsAt = new Date(timeOf(postedAt, "postedAt") + windowDays * DAY_MS)
  if (Number.isNaN(endsAt.getTime())) throw new RangeError("The window end is outside the Date range")
  return endsAt
}

// The window is [postedAt, windowEndsAt): it is closed from the end instant onwards.
export function isWindowClosed(windowEndsAt: Date, now: Date): boolean {
  return timeOf(now, "now") >= timeOf(windowEndsAt, "windowEndsAt")
}

// Fractional hours left; negative once the window has closed.
export function hoursUntilClose(windowEndsAt: Date, now: Date): number {
  return (timeOf(windowEndsAt, "windowEndsAt") - timeOf(now, "now")) / HOUR_MS
}
