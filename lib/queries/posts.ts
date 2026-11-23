import "server-only"

import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import {
  accounts,
  auditLog,
  campaigns,
  creators,
  postComments,
  postDailyMetrics,
  postSnapshots,
  posts,
  tiktokAdDailyStats,
  tiktokAds,
} from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"
import { VIDEO_METRICS, type VideoMetric, type VideosParams } from "@/lib/search-params/videos"
import { keywordMatcher } from "@/lib/spark/keywords"
import { getSparkRules } from "@/lib/spark/settings"

export const VIDEOS_PAGE_SIZE = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// A real calendar day: "2026-02-30" has the right shape but would fail the ::date cast.
function isDay(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Organic views so far: what would be payable if the window closed right now.
const organicNow = sql<number>`greatest(0, ${posts.currentViews} - coalesce(${posts.paidViewsManual}, ${posts.paidViewsSynced}, 0))::float8`

// The day a post went up as the table shows it: in its campaign's time zone.
const postedDay = sql`(${posts.postedAt} at time zone coalesce(${campaigns.timezone}, 'UTC'))::date`

// Engagement is typed in percent and stored as a ratio; the rest are whole-number columns.
const METRIC_FILTERS = {
  views: { column: posts.currentViews, percent: false },
  views24h: { column: posts.views24hDelta, percent: false },
  engagement: { column: posts.engagementRate, percent: true },
  likes: { column: posts.currentLikes, percent: false },
  comments: { column: posts.currentComments, percent: false },
  shares: { column: posts.currentShares, percent: false },
  saves: { column: posts.currentSaves, percent: false },
} satisfies Record<VideoMetric, unknown>

// Callers must join accounts, creators and campaigns: the search and the posted-day filter read them.
export function postFilterConditions(params: VideosParams, now: Date): SQL[] {
  const where: SQL[] = []
  if (params.status.length) where.push(inArray(posts.displayStatus, params.status))
  if (params.platform.length) where.push(inArray(posts.platform, params.platform))
  if (params.campaign && UUID.test(params.campaign)) where.push(eq(posts.campaignId, params.campaign))
  if (params.creator && UUID.test(params.creator)) where.push(eq(posts.creatorId, params.creator))
  if (params.account && UUID.test(params.account)) where.push(eq(posts.accountId, params.account))
  if (isDay(params.from)) where.push(sql`${postedDay} >= ${params.from}::date`)
  if (isDay(params.to)) where.push(sql`${postedDay} <= ${params.to}::date`)
  // A post whose metric is unknown (null) never matches a range on it.
  for (const metric of VIDEO_METRICS) {
    const range = params[metric]
    if (!range) continue
    const { column, percent } = METRIC_FILTERS[metric]
    if (range.min != null) where.push(gte(column, percent ? range.min / 100 : Math.ceil(range.min)))
    if (range.max != null) where.push(lte(column, percent ? range.max / 100 : Math.floor(range.max)))
  }
  if (params.flag === "review") where.push(eq(posts.needsReview, true))
  if (params.flag === "spark") where.push(or(eq(posts.isSpark, true), eq(posts.sparkHint, true))!)
  if (params.flag === "closing") {
    where.push(eq(posts.displayStatus, "open"))
    where.push(lte(posts.windowEndsAt, new Date(now.getTime() + 48 * 3_600_000)))
  }
  const q = params.q.trim()
  if (q) {
    const like = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    where.push(or(ilike(posts.caption, like), ilike(accounts.handle, like), ilike(creators.name, like))!)
  }
  return where
}

export async function listPosts(params: VideosParams, now: Date) {
  await requireUser()
  const where = postFilterConditions(params, now)
  const direction = params.dir === "asc" ? asc : desc
  const sortColumn = {
    posted: posts.postedAt,
    window: posts.windowEndsAt,
    views: posts.currentViews,
    velocity: posts.views24hDelta,
    engagement: posts.engagementRate,
    payable: posts.payableViews,
  }[params.sort]
  const page = Math.max(1, params.page)

  const base = db
    .select({
      id: posts.id,
      platform: posts.platform,
      url: posts.url,
      caption: posts.caption,
      thumbnailPath: posts.thumbnailPath,
      postedAt: posts.postedAt,
      windowDays: posts.windowDays,
      windowOverridden: posts.windowOverridden,
      windowEndsAt: posts.windowEndsAt,
      displayStatus: posts.displayStatus,
      needsReview: posts.needsReview,
      reviewReason: posts.reviewReason,
      isAvailable: posts.isAvailable,
      isSpark: posts.isSpark,
      sparkHint: posts.sparkHint,
      currentViews: posts.currentViews,
      views24hDelta: posts.views24hDelta,
      engagementRate: posts.engagementRate,
      lockedViews: posts.lockedViews,
      payableViews: posts.payableViews,
      organicNow,
      accountId: accounts.id,
      accountHandle: accounts.handle,
      creatorId: creators.id,
      creatorName: creators.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      timezone: campaigns.timezone,
      spark: sql<number[]>`coalesce((select array_agg(d.views order by d.day) from ${postDailyMetrics} d where d.post_id = ${outerRef(posts.id)}), '{}')`,
    })
    .from(posts)
    .innerJoin(accounts, eq(accounts.id, posts.accountId))
    .leftJoin(creators, eq(creators.id, posts.creatorId))
    .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))

  const [rows, [{ total }]] = await Promise.all([
    base
      .where(and(...where))
      .orderBy(sql`${direction(sortColumn)} nulls last`, desc(posts.id))
      .limit(VIDEOS_PAGE_SIZE)
      .offset((page - 1) * VIDEOS_PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(posts)
      .innerJoin(accounts, eq(accounts.id, posts.accountId))
      .leftJoin(creators, eq(creators.id, posts.creatorId))
      .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
      .where(and(...where)),
  ])

  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / VIDEOS_PAGE_SIZE)) }
}

export type PostListRow = Awaited<ReturnType<typeof listPosts>>["rows"][number]

// Ids of every post matching the filters, for "select all N matching" bulk actions.
export async function listMatchingPostIds(params: VideosParams, now: Date, cap = 5000) {
  await requireUser()
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(accounts, eq(accounts.id, posts.accountId))
    .leftJoin(creators, eq(creators.id, posts.creatorId))
    .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
    .where(and(...postFilterConditions(params, now)))
    .limit(cap)
  return rows.map((r) => r.id)
}

export async function getPostDetail(id: string) {
  await requireUser()
  if (!UUID.test(id)) return null

  const [post] = await db
    .select({
      post: posts,
      accountHandle: accounts.handle,
      accountUrl: accounts.url,
      creatorName: creators.name,
      campaignName: campaigns.name,
      campaignWindowDays: campaigns.defaultWindowDays,
      timezone: campaigns.timezone,
    })
    .from(posts)
    .innerJoin(accounts, eq(accounts.id, posts.accountId))
    .leftJoin(creators, eq(creators.id, posts.creatorId))
    .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
    .where(eq(posts.id, id))
    .limit(1)
  if (!post) return null

  const [snapshots, paidDaily, history, commentRows, sparkRules] = await Promise.all([
    db
      .select({
        id: postSnapshots.id,
        capturedAt: postSnapshots.capturedAt,
        views: postSnapshots.views,
        likes: postSnapshots.likes,
        comments: postSnapshots.comments,
        shares: postSnapshots.shares,
        saves: postSnapshots.saves,
        engagementRate: postSnapshots.engagementRate,
        kind: postSnapshots.kind,
        apifyRunId: postSnapshots.apifyRunId,
      })
      .from(postSnapshots)
      .where(eq(postSnapshots.postId, id))
      .orderBy(asc(postSnapshots.capturedAt)),
    db
      .select({
        statDate: tiktokAdDailyStats.statDate,
        views: sql<number>`sum(${tiktokAdDailyStats.videoViews})::float8`,
        spend: sql<number>`sum(${tiktokAdDailyStats.spend})::float8`,
        timezone: sql<string>`max(${tiktokAdDailyStats.advertiserTimezone})`,
      })
      .from(tiktokAdDailyStats)
      .innerJoin(tiktokAds, eq(tiktokAds.adId, tiktokAdDailyStats.adId))
      .where(eq(tiktokAds.postId, id))
      .groupBy(tiktokAdDailyStats.statDate)
      .orderBy(asc(tiktokAdDailyStats.statDate)),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorEmail: auditLog.actorEmail,
        reason: auditLog.reason,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "post"), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
    db
      .select({
        id: postComments.id,
        text: postComments.text,
        likes: postComments.likes,
        authorHandle: postComments.authorHandle,
      })
      .from(postComments)
      .where(eq(postComments.postId, id))
      .orderBy(sql`${postComments.likes} desc nulls last`, asc(postComments.id)),
    getSparkRules(),
  ])

  // Which of the comments read so far are about the app, against the current keyword list.
  const match = keywordMatcher(sparkRules.keywords)
  const comments = commentRows.map((c) => ({ ...c, keywords: match(c.text) }))

  return { ...post, snapshots, paidDaily, history, comments }
}

export type PostDetail = NonNullable<Awaited<ReturnType<typeof getPostDetail>>>
