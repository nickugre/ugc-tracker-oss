import "server-only"

import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm"

import { db } from "@/db"
import { accounts, scrapeRuns, type Platform } from "@/db/schema"
import { getRun, startActorRun, webhookUrlFor } from "@/lib/apify/client"
import { env } from "@/lib/env"
import { adapterFor } from "@/lib/scrapers/registry"
import { NotImplementedError, type AccountRef, type ActorCall, type PostRef } from "@/lib/scrapers/types"

export class BudgetExceededError extends Error {}

// Apify's minimum for the per-run spending cap.
const MIN_RUN_CAP_USD = 0.5

// What Apify has charged this calendar month (UTC), from our own run log.
export async function monthToDateSpendUsd(now: Date) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${scrapeRuns.costUsd}), 0)::float8` })
    .from(scrapeRuns)
    .where(gte(scrapeRuns.startedAt, monthStart))
  return row.usd
}

// Apify finishes adding up a run's charges a little after the run ends, and the webhook usually
// gets here first: the cost read during ingestion is often just the start fee. The hourly job
// re-reads recent runs so the spend meter and the budget guard work with the real numbers.
export async function refreshRunCosts(now: Date, lookbackMs = 3 * 3_600_000) {
  const recent = await db
    .select({ id: scrapeRuns.id, apifyRunId: scrapeRuns.apifyRunId, costUsd: scrapeRuns.costUsd })
    .from(scrapeRuns)
    .where(and(isNotNull(scrapeRuns.apifyRunId), gte(scrapeRuns.startedAt, new Date(now.getTime() - lookbackMs))))
  let updated = 0
  for (const run of recent) {
    try {
      const cost = (await getRun(run.apifyRunId!)).usageTotalUsd
      if (cost == null || cost === run.costUsd) continue
      await db.update(scrapeRuns).set({ costUsd: cost }).where(eq(scrapeRuns.id, run.id))
      updated++
    } catch {
      // Apify unreachable: the next hourly run tries again.
    }
  }
  return updated
}

type StartInput = {
  platform: Platform
  trigger: "cron" | "manual" | "sweep"
  triggeredBy: string | null
  now: Date
} & (
  | {
      kind: "discovery" | "manual" | "backfill"
      accounts: (AccountRef & { id: string })[]
      limitPerProfile: number
      newerThan: Date | null
    }
  | { kind: "metrics" | "window_close" | "manual"; posts: (PostRef & { id: string })[] }
  // Comment text instead of metrics (the Spark page); see lib/jobs/comment-sync.ts.
  | { kind: "comments"; commentsOf: (PostRef & { id: string })[]; perPost: number }
)

// Starts one Apify run and records it. The run finishes on Apify's side; its results come back
// through the webhook, the status poller or the hourly sweeper (see ingest-run.ts).
export async function startScrape(input: StartInput) {
  const adapter = adapterFor(input.platform)
  const e = env()

  // Routine scraping stops when the monthly budget is used up. The scrape at window close is
  // never blocked: without it a video cannot be locked accurately, and that is the number we pay on.
  if (input.trigger === "cron" && input.kind !== "window_close") {
    const spent = await monthToDateSpendUsd(input.now)
    if (spent >= e.APIFY_MONTHLY_BUDGET_USD) {
      throw new BudgetExceededError(
        `Apify budget reached: $${spent.toFixed(2)} of $${e.APIFY_MONTHLY_BUDGET_USD.toFixed(2)} this month.`
      )
    }
  }

  if ("commentsOf" in input && !adapter.comments) {
    throw new NotImplementedError(`Reading ${input.platform} comments is not available yet.`)
  }
  const call: ActorCall =
    "accounts" in input
      ? adapter.discovery(input.accounts, {
          limitPerProfile: input.limitPerProfile,
          newerThan: input.newerThan,
        })
      : "commentsOf" in input
        ? adapter.comments!.call(input.commentsOf, { perPost: input.perPost })
        : adapter.metrics(input.posts, { atWindowClose: input.kind === "window_close" })
  const pricePerItemUsd = "commentsOf" in input ? adapter.comments!.pricePerCommentUsd : adapter.pricePerResultUsd
  const requestedPosts = "posts" in input ? input.posts : "commentsOf" in input ? input.commentsOf : null

  const [run] = await db
    .insert(scrapeRuns)
    .values({
      platform: input.platform,
      actorId: call.actorId,
      kind: input.kind,
      trigger: input.trigger,
      triggeredBy: input.triggeredBy,
      status: "queued",
      input: call.input,
      requestedAccountIds: "accounts" in input ? input.accounts.map((a) => a.id) : null,
      requestedPostIds: requestedPosts ? requestedPosts.map((p) => p.id) : null,
      startedAt: input.now,
    })
    .returning()

  try {
    const apifyRun = await startActorRun(call.actorId, call.input, {
      maxItems: Math.max(1, call.maxItems),
      // Twice the expected price, so a wrong input can never run up a bill. Apify rejects caps
      // below $0.50; `maxItems` is what really bounds the cost of a small run.
      maxTotalChargeUsd: Math.max(MIN_RUN_CAP_USD, call.maxItems * pricePerItemUsd * 2 + 0.01),
      webhookUrl: webhookUrlFor(run.id),
      idempotencyKey: run.id,
    })
    await db
      .update(scrapeRuns)
      .set({ apifyRunId: apifyRun.id, apifyDatasetId: apifyRun.defaultDatasetId, status: "running" })
      .where(eq(scrapeRuns.id, run.id))
    if ("accounts" in input) {
      await db
        .update(accounts)
        .set({ scrapeStatus: "running" })
        .where(
          inArray(
            accounts.id,
            input.accounts.map((a) => a.id)
          )
        )
    }
    return { id: run.id, apifyRunId: apifyRun.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(scrapeRuns)
      .set({ status: "failed", error: message.slice(0, 500) })
      .where(eq(scrapeRuns.id, run.id))
    throw error
  }
}
