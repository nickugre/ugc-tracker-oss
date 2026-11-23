import "server-only"

import { and, desc, eq, inArray, lte, sql } from "drizzle-orm"

import { db } from "@/db"
import {
  accounts,
  campaigns,
  postDailyMetrics,
  postSnapshots,
  posts,
  scrapeRuns,
} from "@/db/schema"
import { getDatasetItems, getRun, TERMINAL_STATUSES, type ApifyRun } from "@/lib/apify/client"
import { startOfLocalDay } from "@/lib/payouts/cycles"
import { adapterFor } from "@/lib/scrapers/registry"
import type { NormalizedError, NormalizedPost } from "@/lib/scrapers/types"
import { computeWindowEndsAt, DAY_MS } from "@/lib/windows/window"

import { ingestComments } from "./ingest-comments"
import { persistThumbnails } from "./thumbnails"

export type IngestResult =
  | { state: "running" }
  | { state: "already_ingested" }
  | { state: "busy" }
  | { state: "failed"; error: string }
  | { state: "ingested"; items: number; postsCreated: number; snapshotsCreated: number; errors: number }

const SNAPSHOT_KIND = {
  discovery: "discovery",
  metrics: "metrics",
  window_close: "window_close",
  manual: "manual",
  backfill: "discovery",
} as const

// A video first seen more than this long after posting arrives with its whole history in one
// number; that is not "views gained today", so its first day counts as zero in the daily rollup.
const SEEN_LATE_MS = 2 * DAY_MS

// Idempotent: safe to call from the Apify webhook, the status poller and the hourly sweeper at
// the same time. A run is claimed with a single UPDATE; a stale claim can be retaken after 10
// minutes, and every write below is an upsert keyed on (platform, post id) / (post, run).
export async function ingestRun(scrapeRunId: string): Promise<IngestResult> {
  const [existing] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, scrapeRunId)).limit(1)
  if (!existing?.apifyRunId) return { state: "failed", error: "Unknown run" }
  if (existing.ingestedAt) return { state: "already_ingested" }

  // Never trust a webhook payload: ask Apify for the run we started ourselves.
  let apifyRun: ApifyRun
  try {
    apifyRun = await getRun(existing.apifyRunId)
  } catch (error) {
    return { state: "failed", error: error instanceof Error ? error.message : String(error) }
  }
  if (!TERMINAL_STATUSES.includes(apifyRun.status)) return { state: "running" }

  const [claimed] = await db
    .update(scrapeRuns)
    .set({ status: "ingesting", ingestStartedAt: new Date(), attempt: sql`${scrapeRuns.attempt} + 1` })
    .where(
      and(
        eq(scrapeRuns.id, scrapeRunId),
        sql`${scrapeRuns.ingestedAt} is null`,
        sql`(${scrapeRuns.status} <> 'ingesting' or ${scrapeRuns.ingestStartedAt} < now() - interval '10 minutes')`
      )
    )
    .returning()
  if (!claimed) return { state: "busy" }

  const finishedAt = apifyRun.finishedAt ? new Date(apifyRun.finishedAt) : new Date()
  const requestedAccountIds = claimed.requestedAccountIds ?? []

  if (apifyRun.status !== "SUCCEEDED") {
    const status = apifyRun.status === "TIMED-OUT" ? "timed_out" : apifyRun.status === "ABORTED" ? "aborted" : "failed"
    const message = apifyRun.statusMessage ?? `Apify run ${apifyRun.status.toLowerCase()}`
    await db
      .update(scrapeRuns)
      .set({ status, error: message, apifyFinishedAt: finishedAt, ingestedAt: new Date(), costUsd: apifyRun.usageTotalUsd ?? null })
      .where(eq(scrapeRuns.id, scrapeRunId))
    if (requestedAccountIds.length) {
      await db
        .update(accounts)
        .set({
          scrapeStatus: "error",
          scrapeError: message,
          lastScrapedAt: finishedAt,
          consecutiveFailures: sql`${accounts.consecutiveFailures} + 1`,
        })
        .where(inArray(accounts.id, requestedAccountIds))
    }
    return { state: "failed", error: message }
  }

  try {
    // A comments run carries comment text, not videos: nothing below applies to it.
    if (claimed.kind === "comments") {
      const result = await ingestComments(claimed, apifyRun.defaultDatasetId, finishedAt)
      await db
        .update(scrapeRuns)
        .set({
          status: "ingested",
          apifyFinishedAt: finishedAt,
          ingestedAt: new Date(),
          itemsCount: result.items,
          postsCreated: 0,
          snapshotsCreated: 0,
          errorsCount: result.errors,
          costUsd: apifyRun.usageTotalUsd ?? null,
          error: null,
        })
        .where(eq(scrapeRuns.id, scrapeRunId))
      return { state: "ingested", items: result.items, postsCreated: 0, snapshotsCreated: 0, errors: result.errors }
    }

    const adapter = adapterFor(claimed.platform)
    const rawItems = await getDatasetItems(apifyRun.defaultDatasetId)
    const normalized = rawItems.map((item) => adapter.normalize(item))
    const unparsed = normalized.filter((n) => n === null).length

    // If most items no longer match the expected shape, the actor changed its output. Writing
    // anything would corrupt view counts, so stop and surface it instead.
    if (rawItems.length > 0 && unparsed / rawItems.length > 0.5) {
      throw new Error(`schema_drift: ${unparsed} of ${rawItems.length} items could not be read`)
    }

    const found = normalized.filter((n): n is NormalizedPost => n?.kind === "post")
    const failures = normalized.filter((n): n is NormalizedError => n?.kind === "error")

    const platformAccounts = await db
      .select({ account: accounts, campaign: campaigns })
      .from(accounts)
      .leftJoin(campaigns, eq(campaigns.id, accounts.campaignId))
      .where(eq(accounts.platform, claimed.platform))
    const byHandle = new Map(platformAccounts.map((row) => [row.account.handle, row]))

    let postsCreated = 0
    let snapshotsCreated = 0
    const needThumbnail: string[] = []
    const seenAccounts = new Map<string, NormalizedPost["author"]>()

    for (const item of found) {
      const owner = byHandle.get(item.handle)
      if (owner) seenAccounts.set(owner.account.id, item.author)

      let [post] = await db
        .select()
        .from(posts)
        .where(and(eq(posts.platform, claimed.platform), eq(posts.platformPostId, item.platformPostId)))
        .limit(1)

      if (!post) {
        // Only tracked accounts create posts, and only from their `track_from` date onward.
        if (!owner || !owner.account.trackingEnabled) continue
        const timeZone = owner.campaign?.timezone ?? "UTC"
        if (owner.account.trackFrom && item.postedAt < startOfLocalDay(owner.account.trackFrom, timeZone)) continue

        const windowDays = owner.campaign?.defaultWindowDays ?? 14
        const windowEndsAt = computeWindowEndsAt(item.postedAt, windowDays)
        const discoveredLate = windowEndsAt <= finishedAt
        const inserted = await db
          .insert(posts)
          .values({
            accountId: owner.account.id,
            platform: claimed.platform,
            platformPostId: item.platformPostId,
            url: item.url,
            caption: item.caption,
            durationSec: item.durationSec,
            postedAt: item.postedAt,
            thumbnailSourceUrl: item.thumbnailUrl,
            // The account's assignment right now becomes the post's, for good.
            creatorId: owner.account.creatorId,
            campaignId: owner.account.campaignId,
            windowDays,
            windowEndsAt,
            // No snapshot from inside the window will ever exist. The hourly job locks such a
            // video from its first snapshot; only one that looks boosted waits for a person,
            // because ad views must not be paid on blindly.
            needsReview: discoveredLate && item.sparkHint,
            reviewReason: discoveredLate && item.sparkHint ? "late_discovery" : null,
            sparkHint: item.sparkHint,
            firstSeenAt: finishedAt,
          })
          .onConflictDoNothing()
          .returning()
        if (!inserted.length) continue
        post = inserted[0]
        postsCreated++
      }

      const engagement =
        item.views > 0
          ? ((item.likes ?? 0) + (item.comments ?? 0) + (item.shares ?? 0) + (item.saves ?? 0)) / item.views
          : null
      const virality = item.views > 0 && item.shares != null ? item.shares / item.views : null

      const insertedSnapshot = await db
        .insert(postSnapshots)
        .values({
          postId: post.id,
          capturedAt: finishedAt,
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          shares: item.shares,
          saves: item.saves,
          engagementRate: engagement,
          virality,
          kind: SNAPSHOT_KIND[claimed.kind],
          sourceRunId: claimed.id,
          apifyRunId: apifyRun.id,
          viewsSource: item.viewsSource,
          raw: item.raw,
        })
        .onConflictDoNothing()
        .returning({ id: postSnapshots.id })
      if (!insertedSnapshot.length) continue
      snapshotsCreated++

      // Denormalized "latest" values only move forward in time.
      if (!post.lastSnapshotAt || post.lastSnapshotAt <= finishedAt) {
        const [dayAgo] = await db
          .select({ views: postSnapshots.views })
          .from(postSnapshots)
          .where(and(eq(postSnapshots.postId, post.id), lte(postSnapshots.capturedAt, new Date(finishedAt.getTime() - DAY_MS))))
          .orderBy(desc(postSnapshots.capturedAt))
          .limit(1)
        await db
          .update(posts)
          .set({
            currentViews: item.views,
            currentLikes: item.likes,
            currentComments: item.comments,
            // A platform that does not expose a metric must not wipe a value fetched earlier
            // (Instagram shares are only fetched at window close).
            currentShares: item.shares ?? post.currentShares,
            currentSaves: item.saves ?? post.currentSaves,
            engagementRate: engagement,
            virality: virality ?? post.virality,
            views24hDelta: dayAgo ? item.views - dayAgo.views : null,
            lastSnapshotAt: finishedAt,
            caption: item.caption ?? post.caption,
            thumbnailSourceUrl: item.thumbnailUrl ?? post.thumbnailSourceUrl,
            sparkHint: post.sparkHint || item.sparkHint,
            isAvailable: true,
            unavailableSince: null,
            missingCount: 0,
            ...(post.reviewReason === "unavailable" ? { needsReview: false, reviewReason: null } : {}),
          })
          .where(eq(posts.id, post.id))
      }

      // Daily rollup: the day's closing value, and the gain over the previous day.
      const day = finishedAt.toISOString().slice(0, 10)
      const seenLate = post.firstSeenAt.getTime() - post.postedAt.getTime() > SEEN_LATE_MS
      const [first] = seenLate
        ? await db
            .select({ views: postSnapshots.views })
            .from(postSnapshots)
            .where(eq(postSnapshots.postId, post.id))
            .orderBy(postSnapshots.capturedAt)
            .limit(1)
        : []
      const baseline = first?.views ?? 0
      await db
        .insert(postDailyMetrics)
        .values({
          postId: post.id,
          day,
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          shares: item.shares,
          saves: item.saves,
          viewsDelta: sql`greatest(0, ${item.views} - coalesce((select d.views from post_daily_metrics d where d.post_id = ${post.id} and d.day < ${day} order by d.day desc limit 1), ${baseline}))`,
        })
        .onConflictDoUpdate({
          target: [postDailyMetrics.postId, postDailyMetrics.day],
          set: {
            views: sql`excluded.views`,
            likes: sql`excluded.likes`,
            comments: sql`excluded.comments`,
            shares: sql`coalesce(excluded.shares, ${postDailyMetrics.shares})`,
            saves: sql`coalesce(excluded.saves, ${postDailyMetrics.saves})`,
            viewsDelta: sql`excluded.views_delta`,
          },
        })

      if (!post.thumbnailPath && item.thumbnailUrl) needThumbnail.push(post.id)
    }

    // A backfill that came back is done; one that failed stays pending and is tried again.
    const backfilled = (accountId: string) =>
      claimed.kind === "backfill" && requestedAccountIds.includes(accountId) ? { backfillPending: false } : {}

    // Accounts that returned data are healthy; refresh what the scrape told us about them.
    for (const [accountId, author] of seenAccounts) {
      await db
        .update(accounts)
        .set({
          scrapeStatus: "ok",
          scrapeError: null,
          consecutiveFailures: 0,
          lastScrapedAt: finishedAt,
          lastSuccessAt: finishedAt,
          ...backfilled(accountId),
          ...(author.followers != null ? { followerCount: author.followers } : {}),
          ...(author.displayName ? { displayName: author.displayName } : {}),
          ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
          ...(author.id ? { platformAccountId: author.id } : {}),
        })
        .where(eq(accounts.id, accountId))
    }
    // Requested accounts that returned nothing were still scraped successfully (no new posts).
    const quiet = requestedAccountIds.filter((id) => !seenAccounts.has(id))
    const failedHandles = new Set(failures.filter((f) => f.scope === "account").map((f) => f.handle))
    for (const accountId of quiet) {
      const row = platformAccounts.find((r) => r.account.id === accountId)
      if (!row) continue
      const failure = failures.find((f) => f.scope === "account" && f.handle === row.account.handle)
      await db
        .update(accounts)
        .set(
          failure && failedHandles.has(row.account.handle)
            ? {
                scrapeStatus: "error",
                scrapeError: `${failure.code}: ${failure.message}`.slice(0, 300),
                lastScrapedAt: finishedAt,
                consecutiveFailures: sql`${accounts.consecutiveFailures} + 1`,
              }
            : {
                scrapeStatus: "ok",
                scrapeError: null,
                lastScrapedAt: finishedAt,
                lastSuccessAt: finishedAt,
                consecutiveFailures: 0,
                ...backfilled(accountId),
              }
        )
        .where(eq(accounts.id, accountId))
    }

    // A video reported as gone twice in a row is flagged; it is never excluded automatically,
    // because whether it still gets paid is a decision for a person.
    for (const failure of failures.filter((f) => f.scope === "post" && f.url)) {
      const [gone] = await db
        .update(posts)
        .set({ missingCount: sql`${posts.missingCount} + 1` })
        .where(and(eq(posts.platform, claimed.platform), eq(posts.url, failure.url!)))
        .returning({ id: posts.id, missingCount: posts.missingCount, needsReview: posts.needsReview })
      if (gone && gone.missingCount >= 2) {
        await db
          .update(posts)
          .set({
            isAvailable: false,
            unavailableSince: sql`coalesce(${posts.unavailableSince}, ${finishedAt})`,
            ...(gone.needsReview ? {} : { needsReview: true, reviewReason: "unavailable" as const }),
          })
          .where(eq(posts.id, gone.id))
      }
    }

    await db
      .update(scrapeRuns)
      .set({
        status: "ingested",
        apifyFinishedAt: finishedAt,
        ingestedAt: new Date(),
        itemsCount: rawItems.length,
        postsCreated,
        snapshotsCreated,
        errorsCount: failures.length + unparsed,
        costUsd: apifyRun.usageTotalUsd ?? null,
        error: null,
      })
      .where(eq(scrapeRuns.id, scrapeRunId))

    await persistThumbnails(needThumbnail)

    return { state: "ingested", items: rawItems.length, postsCreated, snapshotsCreated, errors: failures.length + unparsed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(scrapeRuns)
      .set({ status: "ingest_failed", error: message.slice(0, 500), apifyFinishedAt: finishedAt })
      .where(eq(scrapeRuns.id, scrapeRunId))
    return { state: "failed", error: message }
  }
}
