import "server-only"

import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import { accounts, campaigns, creators, postComments, posts } from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"
import { commentsSpendUsd } from "@/lib/jobs/comment-sync"
import { SPARK_RANGE_DAYS, type SparkParams } from "@/lib/search-params/spark"
import { getSparkRules } from "@/lib/spark/settings"
import { rankSuggestions, SPARK_PLATFORM, type SparkComment } from "@/lib/spark/suggest"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 86_400_000

const hasComments = sql<boolean>`exists (select 1 from ${postComments} c where c.post_id = ${outerRef(posts.id)})`

// Everything the Spark page shows. Which comments count as "about the app" is decided here, on
// read, against the current keyword list (lib/spark/suggest.ts holds the rule itself).
export async function getSparkPage(params: SparkParams, now: Date) {
  await requireUser()
  const rules = await getSparkRules()
  const since = new Date(now.getTime() - SPARK_RANGE_DAYS[params.range] * DAY_MS)

  // Videos that can be suggested at all: TikTok, recent, enough views, still up, counted, and not
  // boosted already (flagged as Spark by a person, the Ads sync, or the ad marker on the video).
  const inScope = and(
    eq(posts.platform, SPARK_PLATFORM),
    eq(posts.isExcluded, false),
    eq(posts.isAvailable, true),
    eq(posts.isSpark, false),
    eq(posts.sparkHint, false),
    gte(posts.currentViews, rules.minViews),
    gte(posts.postedAt, since),
    params.creator && UUID.test(params.creator) ? eq(posts.creatorId, params.creator) : undefined
  )

  // Boosted already, whenever they were posted: marked by a person, found by the Ads sync, or
  // carrying TikTok's ad marker. Shown under "Sparked" so the two lists never overlap.
  const boosted = and(
    eq(posts.platform, SPARK_PLATFORM),
    eq(posts.isExcluded, false),
    or(eq(posts.isSpark, true), eq(posts.sparkHint, true)),
    params.creator && UUID.test(params.creator) ? eq(posts.creatorId, params.creator) : undefined
  )

  const [candidates, [scope], spentUsd, sparked] = await Promise.all([
    db
      .select({
        id: posts.id,
        url: posts.url,
        caption: posts.caption,
        thumbnailPath: posts.thumbnailPath,
        postedAt: posts.postedAt,
        views: posts.currentViews,
        views24hDelta: posts.views24hDelta,
        engagementRate: posts.engagementRate,
        currentComments: posts.currentComments,
        commentsChecks: posts.commentsChecks,
        accountHandle: accounts.handle,
        creatorName: creators.name,
        timezone: campaigns.timezone,
      })
      .from(posts)
      .innerJoin(accounts, eq(accounts.id, posts.accountId))
      .leftJoin(creators, eq(creators.id, posts.creatorId))
      .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
      // Only these two can qualify; the keyword check itself happens in rankSuggestions.
      .where(and(inScope, or(gte(posts.engagementRate, rules.minEngagement), hasComments)))
      .orderBy(desc(posts.currentViews))
      .limit(500),
    db
      .select({
        videos: sql<number>`count(*)::int`,
        commentsRead: sql<number>`count(*) filter (where ${hasComments})::int`,
      })
      .from(posts)
      .where(inScope),
    commentsSpendUsd(now),
    db
      .select({
        id: posts.id,
        url: posts.url,
        caption: posts.caption,
        thumbnailPath: posts.thumbnailPath,
        postedAt: posts.postedAt,
        views: posts.currentViews,
        paidViews: sql<number | null>`coalesce(${posts.paidViewsManual}, ${posts.paidViewsSynced})::float8`,
        isSpark: posts.isSpark,
        sparkSource: posts.sparkSource,
        accountHandle: accounts.handle,
        creatorName: creators.name,
        timezone: campaigns.timezone,
      })
      .from(posts)
      .innerJoin(accounts, eq(accounts.id, posts.accountId))
      .leftJoin(creators, eq(creators.id, posts.creatorId))
      .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
      .where(boosted)
      .orderBy(desc(posts.postedAt))
      .limit(200),
  ])

  const commentsByPost = new Map<string, SparkComment[]>()
  if (candidates.length) {
    const rows = await db
      .select({ postId: postComments.postId, text: postComments.text, likes: postComments.likes })
      .from(postComments)
      .where(
        inArray(
          postComments.postId,
          candidates.map((c) => c.id)
        )
      )
    for (const row of rows) {
      commentsByPost.set(row.postId, [...(commentsByPost.get(row.postId) ?? []), { text: row.text, likes: row.likes }])
    }
  }

  return {
    rules,
    suggestions: rankSuggestions(candidates, commentsByPost, rules),
    sparked,
    scope: { videos: scope.videos, commentsRead: scope.commentsRead, days: SPARK_RANGE_DAYS[params.range] },
    comments: { spentUsd, budgetUsd: rules.commentsBudgetUsd },
  }
}

export type SparkPage = Awaited<ReturnType<typeof getSparkPage>>
export type SparkRow = SparkPage["suggestions"][number]
export type SparkedRow = SparkPage["sparked"][number]
