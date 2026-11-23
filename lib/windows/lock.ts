import { addDays, startOfLocalDay } from "@/lib/payouts/cycles"

export type SnapshotPoint = { id: number; capturedAt: Date; views: number }

export type LockMethod = "exact" | "interpolated" | "last_before" | "first_after"

type SnapshotRef = { snapshotId: number; capturedAt: string; views: number }

export type LockResult =
  | {
      ok: true
      lockedViews: number
      method: LockMethod
      needsReview: boolean
      reviewReason: "lock_fallback" | "views_decreased" | null
      // The snapshots the number was derived from: the evidence behind the locked count.
      details: { before?: SnapshotRef; after?: SnapshotRef; fraction?: number }
    }
  | { ok: false; reason: "no_snapshots" | "only_after" | "awaiting_post_close_snapshot" }

export type LockOptions = {
  // Lock from the last in-window snapshot when no post-close snapshot will ever arrive
  // (the post was deleted, the account went private). Always flagged for review.
  allowLastBefore?: boolean
  // Lock a post that was found after its window had ended from the first snapshot there is.
  // Nothing in-window exists for such a post and nothing ever will; the first reading is the
  // closest to the real number and can only be too high. The caller leaves this off for boosted
  // posts without paid-view data, which must not be paid on blindly.
  allowFirstAfter?: boolean
  // Flag an interpolation whose in-window snapshot is older than this. Off unless given.
  staleBeforeMs?: number
  // Flag an interpolation whose post-close snapshot came later than this. Default 6 hours.
  lateAfterMs?: number
}

const DEFAULT_LATE_AFTER_MS = 6 * 3_600_000

// Scraping is daily only (to keep Apify costs down): the count from after a window's end comes
// from the next daily sync, up to a day later. That is normal, not a reason for review. Both the
// hourly job and "Lock now" pass this as `lateAfterMs`.
export const POST_CLOSE_WITHIN_MS = 30 * 3_600_000

// No BigInt literals: the TypeScript target is below ES2020.
const ZERO = BigInt(0)
const ONE = BigInt(1)
const TWO = BigInt(2)

function validTime(date: Date, name: string): number {
  const time = date instanceof Date ? date.getTime() : Number.NaN
  if (Number.isNaN(time)) throw new RangeError(`${name} is not a valid date`)
  return time
}

function assertViews(views: number, name: string) {
  if (!Number.isSafeInteger(views) || views < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${views}`)
  }
}

function assertThreshold(value: number, name: string) {
  // `x > NaN` is always false, so a bad threshold would silently switch the check off.
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number of milliseconds, got ${value}`)
  }
}

function toRef(snapshot: SnapshotPoint): SnapshotRef {
  return {
    snapshotId: snapshot.id,
    capturedAt: snapshot.capturedAt.toISOString(),
    views: snapshot.views,
  }
}

// floor(v0 + (v1 - v0) × elapsed / span). In BigInt because a view delta times a millisecond span
// can pass 2^53, and a float quotient that lands a hair under a whole number would floor to one
// view too few: enough to miss a milestone that sits exactly on the boundary.
function interpolateFloor(v0: number, v1: number, elapsed: number, span: number): number {
  const numerator = BigInt(v1 - v0) * BigInt(elapsed)
  const denominator = BigInt(span)
  let quotient = numerator / denominator
  // BigInt division truncates toward zero; views that went DOWN need a true floor.
  if (numerator < ZERO && numerator % denominator !== ZERO) quotient -= ONE
  return v0 + Number(quotient)
}

// Decides the view count a post had at the moment its window closed. Snapshots may arrive in
// any order; they are ranked by capturedAt, then id.
export function computeLockedViews(
  snapshots: SnapshotPoint[],
  windowEndsAt: Date,
  opts: LockOptions = {}
): LockResult {
  const end = validTime(windowEndsAt, "windowEndsAt")
  const lateAfterMs = opts.lateAfterMs ?? DEFAULT_LATE_AFTER_MS
  const staleBeforeMs = opts.staleBeforeMs ?? Number.POSITIVE_INFINITY
  assertThreshold(lateAfterMs, "lateAfterMs")
  assertThreshold(staleBeforeMs, "staleBeforeMs")

  for (const snapshot of snapshots) {
    if (!Number.isSafeInteger(snapshot.id)) {
      throw new RangeError(`snapshot id must be an integer, got ${snapshot.id}`)
    }
    validTime(snapshot.capturedAt, `capturedAt of snapshot ${snapshot.id}`)
    assertViews(snapshot.views, `views of snapshot ${snapshot.id}`)
  }
  if (snapshots.length === 0) return { ok: false, reason: "no_snapshots" }

  const sorted = [...snapshots].sort(
    (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime() || a.id - b.id
  )

  // before: the last snapshot strictly inside the window. after: the first one strictly past
  // its end. Of several snapshots taken at exactly the end, the highest id (the latest row) wins.
  let before: SnapshotPoint | undefined
  let exact: SnapshotPoint | undefined
  let after: SnapshotPoint | undefined
  for (const snapshot of sorted) {
    const time = snapshot.capturedAt.getTime()
    if (time < end) before = snapshot
    else if (time === end) exact = snapshot
    else {
      after = snapshot
      break
    }
  }

  if (exact) {
    return {
      ok: true,
      lockedViews: exact.views,
      method: "exact",
      needsReview: false,
      reviewReason: null,
      // A snapshot at the end instant is a post-close one (the window is [postedAt, end)).
      details: { after: toRef(exact) },
    }
  }

  if (before && after) {
    const t0 = before.capturedAt.getTime()
    const t1 = after.capturedAt.getTime()
    const lo = Math.min(before.views, after.views)
    const hi = Math.max(before.views, after.views)
    const interpolated = interpolateFloor(before.views, after.views, end - t0, t1 - t0)

    // A drop means the platform removed views, which makes a straight line between the two
    // points doubtful; it outranks the timing flags because it is the more specific finding.
    const viewsDecreased = after.views < before.views
    const fallback = t1 - end > lateAfterMs || end - t0 > staleBeforeMs
    return {
      ok: true,
      lockedViews: Math.min(Math.max(interpolated, lo), hi),
      method: "interpolated",
      needsReview: viewsDecreased || fallback,
      reviewReason: viewsDecreased ? "views_decreased" : fallback ? "lock_fallback" : null,
      details: { before: toRef(before), after: toRef(after), fraction: (end - t0) / (t1 - t0) },
    }
  }

  if (before) {
    // The hourly job keeps waiting for the post-close scrape unless told that none will come.
    if (!opts.allowLastBefore) return { ok: false, reason: "awaiting_post_close_snapshot" }
    return {
      ok: true,
      lockedViews: before.views,
      method: "last_before",
      needsReview: true,
      reviewReason: "lock_fallback",
      details: { before: toRef(before) },
    }
  }

  // Discovered after its window had already ended: there is nothing in-window to anchor on.
  if (after && opts.allowFirstAfter) {
    return {
      ok: true,
      lockedViews: after.views,
      method: "first_after",
      needsReview: false,
      reviewReason: null,
      details: { after: toRef(after) },
    }
  }
  return { ok: false, reason: "only_after" }
}

// Paid (ad) views that fall inside the window [postedAt, windowEndsAt). The ads API only reports
// whole calendar days in the advertiser's time zone, so a day that straddles a window boundary
// counts for the fraction of that day that lies inside the window. Day lengths are measured from
// the two local-midnight instants, because a DST day lasts 23 or 25 hours.
//
// The sum is kept as an exact fraction and rounded once (half up, like Math.round), so the
// result does not depend on the order of `days` and an exact .5 can never be lost to float
// error. Rows sharing a statDate (several ads on one post) are simply added up.
export function paidViewsInWindow(
  days: { statDate: string; views: number }[],
  postedAt: Date,
  windowEndsAt: Date,
  advertiserTimeZone: string
): number {
  const windowStart = validTime(postedAt, "postedAt")
  const windowEnd = validTime(windowEndsAt, "windowEndsAt")
  if (windowEnd <= windowStart) throw new RangeError("windowEndsAt must be after postedAt")

  const dayStarts = new Map<string, number>()
  const startOf = (day: string) => {
    let time = dayStarts.get(day)
    if (time === undefined) {
      time = startOfLocalDay(day, advertiserTimeZone).getTime()
      dayStarts.set(day, time)
    }
    return time
  }

  // Σ views × overlapMs, grouped by day length: only a few lengths ever occur (23, 24, 25 hours),
  // so the common denominator below stays tiny.
  const weightedByLength = new Map<number, bigint>()
  for (const { statDate, views } of days) {
    assertViews(views, `paid views on ${statDate}`)
    const dayStart = startOf(statDate)
    const dayEnd = startOf(addDays(statDate, 1))
    const overlap = Math.min(dayEnd, windowEnd) - Math.max(dayStart, windowStart)
    if (overlap <= 0 || views === 0) continue
    const length = dayEnd - dayStart
    const weighted = BigInt(views) * BigInt(overlap)
    weightedByLength.set(length, (weightedByLength.get(length) ?? ZERO) + weighted)
  }

  let numerator = ZERO
  let denominator = ONE
  for (const [length, weighted] of weightedByLength) {
    numerator = numerator * BigInt(length) + weighted * denominator
    denominator *= BigInt(length)
  }
  return Number((numerator * TWO + denominator) / (denominator * TWO))
}
