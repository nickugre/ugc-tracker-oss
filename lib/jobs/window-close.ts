import "server-only"

import { and, asc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm"

import { db } from "@/db"
import { postSnapshots, posts, scrapeRuns, type Platform } from "@/db/schema"
import { audit } from "@/lib/audit"
import { ingestRun } from "@/lib/ingest/ingest-run"
import { refreshRunCosts, startScrape } from "@/lib/ingest/start-run"
import { adapterFor } from "@/lib/scrapers/registry"
import { computeLockedViews, POST_CLOSE_WITHIN_MS } from "@/lib/windows/lock"

const HOUR_MS = 3_600_000
const URLS_PER_RUN = 100
// A daily sync has certainly run by now (they are 24 hours apart). If the count from after the
// window's end is still missing, that sync failed or skipped the video: ask for this video alone.
// Early enough that the answer still arrives inside POST_CLOSE_WITHIN_MS.
const RESCUE_AFTER_MS = 25 * HOUR_MS
// A video is asked for again only after this long, so at most four times before the fallback.
const RESCUE_RETRY_MS = 6 * HOUR_MS
// Two daily syncs and the rescue scrapes without the video (deleted, private): lock from the
// last in-window snapshot instead, flagged for review.
const FALLBACK_AFTER_MS = 50 * HOUR_MS

// Hourly. 1) Recover runs whose webhook never arrived and refresh their costs. 2) Lock every
// closed window that has a snapshot from after its end; the daily sync provides that snapshot,
// since it refreshes every video that is not locked yet. 3) Scrape the few videos the daily sync
// should have covered and did not, so they can be locked on time too; this costs nothing while
// the daily sync works. 4) Fall back to the last in-window snapshot when even that brings nothing.
export async function windowClose(now: Date) {
  const summary = { swept: 0, costsRefreshed: 0, locked: 0, fallbackLocked: 0, lateLocked: 0, needsPerson: 0, rescueScrapes: 0, errors: [] as string[] }

  // 1) Sweep.
  const stale = await db
    .select({ id: scrapeRuns.id })
    .from(scrapeRuns)
    .where(
      and(
        isNull(scrapeRuns.ingestedAt),
        inArray(scrapeRuns.status, ["running", "succeeded", "ingest_failed", "ingesting"]),
        lt(scrapeRuns.startedAt, new Date(now.getTime() - 10 * 60_000)),
        gte(scrapeRuns.startedAt, new Date(now.getTime() - 3 * 24 * HOUR_MS)),
        lte(scrapeRuns.attempt, 5)
      )
    )
  for (const run of stale) {
    const result = await ingestRun(run.id)
    if (result.state === "ingested") summary.swept++
  }
  summary.costsRefreshed = await refreshRunCosts(now)

  // 2) + 4) Lock.
  const closed = await db
    .select()
    .from(posts)
    .where(and(eq(posts.status, "open"), eq(posts.lockHold, false), lte(posts.windowEndsAt, now)))
    .orderBy(asc(posts.windowEndsAt))
    .limit(2000)

  const awaiting: typeof closed = []
  for (const post of closed) {
    const snapshots = await db
      .select({ id: postSnapshots.id, capturedAt: postSnapshots.capturedAt, views: postSnapshots.views })
      .from(postSnapshots)
      .where(eq(postSnapshots.postId, post.id))
      .orderBy(asc(postSnapshots.capturedAt))

    const overdue = now.getTime() - post.windowEndsAt.getTime() > FALLBACK_AFTER_MS
    // A video found after its window had ended is locked from its first snapshot, unless it
    // looks boosted and there is nothing to subtract: ad views must not be paid on blindly.
    const boostedBlind =
      (post.isSpark || post.sparkHint) && post.paidViewsManual == null && post.paidViewsSynced == null
    const lock = computeLockedViews(snapshots, post.windowEndsAt, {
      allowLastBefore: overdue || !post.isAvailable,
      allowFirstAfter: !boostedBlind,
      lateAfterMs: POST_CLOSE_WITHIN_MS,
    })

    if (!lock.ok) {
      // "awaiting_post_close_snapshot": the next daily sync brings it, or step 3 asks for it.
      if (lock.reason === "awaiting_post_close_snapshot") {
        awaiting.push(post)
        continue
      }
      if (!post.needsReview) {
        // Found late and possibly boosted (or no data at all): a person has to set the number.
        await db
          .update(posts)
          .set({ needsReview: true, reviewReason: "late_discovery" })
          .where(eq(posts.id, post.id))
        summary.needsPerson++
      }
      continue
    }

    await db.transaction(async (tx) => {
      // Re-check inside the transaction so a manual action in the meantime always wins.
      const [locked] = await tx
        .update(posts)
        .set({
          status: "locked",
          lockedViews: lock.lockedViews,
          lockedAt: now,
          lockedBy: null,
          lockMethod: lock.method,
          lockDetails: lock.details,
          // The flag said "a person has to set the number"; now there is one.
          ...(lock.method === "first_after" && post.reviewReason === "late_discovery"
            ? { needsReview: false, reviewReason: null }
            : {}),
          ...(lock.needsReview && !post.needsReview
            ? { needsReview: true, reviewReason: lock.reviewReason }
            : {}),
          // Boosted inside the window but nothing to subtract yet: do not pay on it blindly.
          ...(post.isSpark && post.paidViewsManual == null && post.paidViewsSynced == null && !post.needsReview
            ? { needsReview: true, reviewReason: "spark_no_paid_data" as const }
            : {}),
        })
        .where(and(eq(posts.id, post.id), eq(posts.status, "open"), eq(posts.lockHold, false)))
        .returning({ id: posts.id })
      if (!locked) return
      await audit(tx, {
        actor: null,
        action: "post.lock",
        entityType: "post",
        entityId: post.id,
        after: { lockedViews: lock.lockedViews, method: lock.method },
      })
      if (lock.method === "last_before") summary.fallbackLocked++
      else if (lock.method === "first_after") summary.lateLocked++
      else summary.locked++
    })
  }

  // 3) Rescue scrapes for videos the daily sync left without a post-close snapshot.
  const overdueForSync = awaiting.filter((p) => now.getTime() - p.windowEndsAt.getTime() > RESCUE_AFTER_MS)
  if (overdueForSync.length > 0) {
    const recent = await db
      .select({ ids: scrapeRuns.requestedPostIds })
      .from(scrapeRuns)
      .where(
        and(
          eq(scrapeRuns.kind, "window_close"),
          gte(scrapeRuns.startedAt, new Date(now.getTime() - RESCUE_RETRY_MS))
        )
      )
    const alreadyAsked = new Set(recent.flatMap((r) => r.ids ?? []))
    const toScrape = overdueForSync.filter((p) => !alreadyAsked.has(p.id))

    for (const platform of [...new Set(toScrape.map((p) => p.platform))] as Platform[]) {
      if (!adapterFor(platform).enabled) continue
      const group = toScrape.filter((p) => p.platform === platform)
      for (let i = 0; i < group.length; i += URLS_PER_RUN) {
        try {
          await startScrape({
            platform,
            kind: "window_close",
            trigger: "cron",
            triggeredBy: null,
            now,
            posts: group.slice(i, i + URLS_PER_RUN).map((p) => ({ id: p.id, platformPostId: p.platformPostId, url: p.url })),
          })
          summary.rescueScrapes++
        } catch (error) {
          summary.errors.push(`${platform}: ${error instanceof Error ? error.message : error}`)
        }
      }
    }
  }

  return summary
}
