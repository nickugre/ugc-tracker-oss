import type { Platform } from "@/db/schema/enums"

const PROFILES_PER_RUN = 25
const NEW_POST_BUFFER = 8
const MAX_PER_PROFILE = 100

// A backfill asks for far more per profile than a routine run, so its runs are kept small: one
// wrong input cannot cost more than a couple of dollars.
const BACKFILL_PROFILES_PER_RUN = 5
const BACKFILL_MIN_PER_PROFILE = 30
// Generous on purpose: creators on a quota post one to two videos a day.
const BACKFILL_POSTS_PER_DAY = 3

const DAY_MS = 86_400_000

export type PlanAccount = {
  id: string
  platform: Platform
  handle: string
  url: string
  trackFrom: string | null
  windowDays: number | null
  openPosts: number
  backfillPending: boolean
}

export type DiscoveryPlan = {
  platform: Platform
  backfill: boolean
  accounts: PlanAccount[]
  limitPerProfile: number
  newerThan: Date
}

// Nothing older than the window can still be tracked (two days of slack for timezones).
const windowHorizon = (a: PlanAccount, now: Date) => new Date(now.getTime() - ((a.windowDays ?? 14) + 2) * DAY_MS)

// How far back a backfill looks: the account's tracking date when it has one. `track_from` is a
// local date in the campaign's timezone, so a day of slack is added; ingest applies the exact cut.
const backfillHorizon = (a: PlanAccount, now: Date) =>
  a.trackFrom ? new Date(new Date(`${a.trackFrom}T00:00:00Z`).getTime() - DAY_MS) : windowHorizon(a, now)

function chunks<T>(items: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Turns a set of accounts into Apify runs. The actors take a single "results per profile" number
// per run, so accounts that need a deep first scrape get runs of their own: mixed into the
// routine run they would make every profile in it as expensive as the backfill.
//
// Routine: "open videos + a buffer" per profile, which finds new videos and refreshes every video
// still inside its window with the same results.
// Backfill: a new account has no open videos, and "0 + buffer" only ever returned its 8 newest
// posts (pinned ones included). Its first run is sized by how far back `track_from` reaches.
export function planDiscoveryRuns(tracked: PlanAccount[], now: Date): DiscoveryPlan[] {
  const plans: DiscoveryPlan[] = []
  for (const platform of [...new Set(tracked.map((a) => a.platform))]) {
    const group = tracked.filter((a) => a.platform === platform)

    for (const batch of chunks(group.filter((a) => !a.backfillPending), PROFILES_PER_RUN)) {
      plans.push({
        platform,
        backfill: false,
        accounts: batch,
        // One limit per run, sized for the busiest profile.
        limitPerProfile: Math.min(MAX_PER_PROFILE, Math.max(...batch.map((a) => a.openPosts)) + NEW_POST_BUFFER),
        newerThan: new Date(Math.min(...batch.map((a) => windowHorizon(a, now).getTime()))),
      })
    }

    for (const batch of chunks(group.filter((a) => a.backfillPending), BACKFILL_PROFILES_PER_RUN)) {
      const newerThan = new Date(Math.min(...batch.map((a) => backfillHorizon(a, now).getTime())))
      const days = Math.ceil((now.getTime() - newerThan.getTime()) / DAY_MS)
      plans.push({
        platform,
        backfill: true,
        accounts: batch,
        limitPerProfile: Math.min(
          MAX_PER_PROFILE,
          Math.max(
            BACKFILL_MIN_PER_PROFILE,
            days * BACKFILL_POSTS_PER_DAY + NEW_POST_BUFFER,
            Math.max(...batch.map((a) => a.openPosts)) + NEW_POST_BUFFER
          )
        ),
        newerThan,
      })
    }
  }
  return plans
}
