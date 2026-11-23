import "server-only"

import { eq, inArray, sql } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import { accounts, campaigns, posts, type Platform } from "@/db/schema"
import { BudgetExceededError, startScrape } from "@/lib/ingest/start-run"
import { adapterFor } from "@/lib/scrapers/registry"

import { commentSync } from "./comment-sync"
import { planDiscoveryRuns } from "./scrape-plan"

const planColumns = {
  id: accounts.id,
  platform: accounts.platform,
  handle: accounts.handle,
  url: accounts.url,
  trackFrom: accounts.trackFrom,
  backfillPending: accounts.backfillPending,
  // How far back the run must reach: the campaign's window, or longer when a video that is not
  // locked yet has a custom window. It needs one more scrape after its end to be locked, and
  // Instagram's date filter would otherwise leave it out.
  windowDays: sql<number>`greatest(coalesce(${campaigns.defaultWindowDays}, 14), coalesce((select max(p.window_days) from ${posts} p where p.account_id = ${outerRef(accounts.id)} and p.status = 'open'), 0))::int`,
  openPosts: sql<number>`(select count(*)::int from ${posts} p where p.account_id = ${outerRef(accounts.id)} and p.status = 'open')`,
}

// Once a day, and the only routine scraping there is (the hourly job scrapes a video only when
// this sync missed it after its window ended; everything else is started by a person).
// One discovery run per platform with all tracked profiles batched together. The run asks for
// "open videos + a buffer" per profile, so the same results that reveal new videos also refresh
// the metrics of every video that is not locked yet, including those whose window has just ended:
// that post-close count is what the hourly job locks with. Locked and paid videos are never
// re-scraped. Accounts that were just added or re-linked get a deeper run of their own (see
// scrape-plan.ts). Last, the comments of promising videos are read for the Spark page.
export async function dailySync(now: Date, triggeredBy: string | null = null) {
  const tracked = await db
    .select(planColumns)
    .from(accounts)
    .leftJoin(campaigns, eq(campaigns.id, accounts.campaignId))
    .where(eq(accounts.trackingEnabled, true))

  const summary: Record<string, unknown> = { accounts: tracked.length, runs: 0, backfills: 0, commentReads: 0, skipped: [] as string[] }
  const skipped = summary.skipped as string[]

  const enabled = tracked.filter((a) => adapterFor(a.platform).enabled)
  for (const platform of new Set(tracked.filter((a) => !enabled.includes(a)).map((a) => a.platform))) {
    skipped.push(`${platform}: no scraper yet`)
  }

  for (const plan of planDiscoveryRuns(enabled, now)) {
    try {
      await startScrape({
        platform: plan.platform,
        kind: plan.backfill ? "backfill" : "discovery",
        trigger: triggeredBy ? "manual" : "cron",
        triggeredBy,
        now,
        accounts: plan.accounts,
        limitPerProfile: plan.limitPerProfile,
        newerThan: plan.newerThan,
      })
      summary.runs = (summary.runs as number) + 1
      if (plan.backfill) summary.backfills = (summary.backfills as number) + 1
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        skipped.push(error.message)
        return summary
      }
      skipped.push(`${plan.platform}: ${error instanceof Error ? error.message : error}`)
    }
  }

  // It chooses from the comment counts the app already has (yesterday's run), since the runs
  // started above take a few minutes to come back. Its own limits apply; a failure here must not
  // hide that the scrapes above were started.
  try {
    const comments = await commentSync(now)
    summary.commentReads = comments.requested
    if (comments.skipped) skipped.push(`comments: ${comments.skipped}`)
  } catch (error) {
    skipped.push(`comments: ${error instanceof Error ? error.message : error}`)
  }
  return summary
}

// "Scrape now" for a few accounts, started by a person.
export async function scrapeAccountsNow(accountIds: string[], userId: string, now: Date) {
  const rows = await db
    .select(planColumns)
    .from(accounts)
    .leftJoin(campaigns, eq(campaigns.id, accounts.campaignId))
    .where(inArray(accounts.id, accountIds))

  const runs: { id: string; platform: Platform }[] = []
  for (const plan of planDiscoveryRuns(rows, now)) {
    const run = await startScrape({
      platform: plan.platform,
      kind: plan.backfill ? "backfill" : "manual",
      trigger: "manual",
      triggeredBy: userId,
      now,
      accounts: plan.accounts,
      limitPerProfile: plan.limitPerProfile,
      newerThan: plan.newerThan,
    })
    runs.push({ id: run.id, platform: plan.platform })
  }
  return runs
}
