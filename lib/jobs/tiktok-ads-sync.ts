import "server-only"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import { posts, tiktokAdDailyStats, tiktokAds } from "@/db/schema"
import { audit } from "@/lib/audit"
import { startOfLocalDay } from "@/lib/payouts/cycles"
import {
  fetchAdDailyStats,
  fetchAds,
  fetchAdvertiserTimeZone,
  tiktokAdsConfig,
} from "@/lib/tiktok-ads/client"
import { paidViewsInWindow } from "@/lib/windows/lock"

const DAY_MS = 86_400_000
// The longest range TikTok accepts for a report broken down by day.
const LOOKBACK_DAYS = 30

// Daily. Pulls paid video views per Spark ad, maps each ad to the organic post it promotes, and
// stores how many paid views fall inside that post's window, so payable = locked − paid.
export async function tiktokAdsSync(now: Date) {
  const config = tiktokAdsConfig()
  if (!config) return { skipped: "TikTok Ads credentials are not configured" }

  const end = now.toISOString().slice(0, 10)
  const start = new Date(now.getTime() - (LOOKBACK_DAYS - 1) * DAY_MS).toISOString().slice(0, 10)
  const summary = { advertisers: config.advertiserIds.length, statRows: 0, adsMapped: 0, postsUpdated: 0, flagged: 0 }

  for (const advertiserId of config.advertiserIds) {
    const timeZone = await fetchAdvertiserTimeZone(config.token, advertiserId)
    const stats = await fetchAdDailyStats(config.token, advertiserId, start, end)
    summary.statRows += stats.length
    if (stats.length === 0) continue

    const adIds = [...new Set(stats.map((s) => s.adId))]
    const known = await db.select({ adId: tiktokAds.adId }).from(tiktokAds).where(inArray(tiktokAds.adId, adIds))
    const unknown = adIds.filter((id) => !known.some((k) => k.adId === id))
    if (unknown.length) {
      const ads = await fetchAds(config.token, advertiserId, unknown)
      if (ads.length) {
        await db
          .insert(tiktokAds)
          .values(
            ads.map((ad) => ({
              adId: ad.adId,
              advertiserId,
              adName: ad.adName,
              tiktokItemId: ad.tiktokItemId,
              identityType: ad.identityType,
              identityId: ad.identityId,
              adCreateTime: ad.createTime ? new Date(`${ad.createTime.replace(" ", "T")}Z`) : null,
            }))
          )
          .onConflictDoNothing()
      }
    }

    // Link ads to posts we track (also picks up posts ingested after the ad was first seen).
    const linked = await db.execute(sql`
      update tiktok_ads a set post_id = p.id, updated_at = now()
      from posts p
      where a.post_id is null and a.tiktok_item_id is not null
        and p.platform = 'tiktok' and p.platform_post_id = a.tiktok_item_id
      returning a.ad_id
    `)
    summary.adsMapped += linked.length

    const mapped = await db
      .select({ adId: tiktokAds.adId })
      .from(tiktokAds)
      .where(inArray(tiktokAds.adId, adIds))
    const mappedIds = new Set(mapped.map((m) => m.adId))
    const rows = stats.filter((s) => mappedIds.has(s.adId))
    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(tiktokAdDailyStats)
        .values(rows.slice(i, i + 500).map((s) => ({ ...s, advertiserTimezone: timeZone })))
        // TikTok restates recent days, so the latest numbers always win.
        .onConflictDoUpdate({
          target: [tiktokAdDailyStats.adId, tiktokAdDailyStats.statDate],
          set: {
            videoViews: sql`excluded.video_views`,
            impressions: sql`excluded.impressions`,
            spend: sql`excluded.spend`,
            advertiserTimezone: sql`excluded.advertiser_timezone`,
            syncedAt: sql`now()`,
          },
        })
    }
  }

  // Recompute paid views inside the window for every post that has ads.
  const promoted = await db
    .select({ post: posts })
    .from(posts)
    .where(sql`exists (select 1 from tiktok_ads a where a.post_id = ${outerRef(posts.id)})`)

  for (const { post } of promoted) {
    const daily = await db
      .select({
        statDate: tiktokAdDailyStats.statDate,
        views: sql<number>`sum(${tiktokAdDailyStats.videoViews})::float8`,
        timeZone: sql<string>`max(${tiktokAdDailyStats.advertiserTimezone})`,
      })
      .from(tiktokAdDailyStats)
      .innerJoin(tiktokAds, eq(tiktokAds.adId, tiktokAdDailyStats.adId))
      .where(eq(tiktokAds.postId, post.id))
      .groupBy(tiktokAdDailyStats.statDate)
      .orderBy(tiktokAdDailyStats.statDate)
    const withViews = daily.filter((d) => d.views > 0)
    if (withViews.length === 0) continue

    const timeZone = withViews[0].timeZone
    const paid = paidViewsInWindow(withViews, post.postedAt, post.windowEndsAt, timeZone)
    if (paid === post.paidViewsSynced && post.isSpark) continue

    const settled = post.status === "paid" || post.bonusCycleId != null
    if (settled) {
      // Money already went out on the old number: never rewrite it, only raise a flag.
      if (!post.needsReview) {
        await db
          .update(posts)
          .set({ needsReview: true, reviewReason: "paid_views_changed_after_payment" })
          .where(eq(posts.id, post.id))
        summary.flagged++
      }
      continue
    }

    await db.transaction(async (tx) => {
      await tx
        .update(posts)
        .set({
          isSpark: true,
          sparkSource: post.sparkSource ?? "ads_api",
          sparkStartedAt: post.sparkStartedAt ?? startOfLocalDay(withViews[0].statDate, timeZone),
          paidViewsSynced: paid,
          ...(post.reviewReason === "spark_no_paid_data" ? { needsReview: false, reviewReason: null } : {}),
        })
        .where(and(eq(posts.id, post.id), isNull(posts.bonusCycleId)))
      await audit(tx, {
        actor: null,
        action: "post.paid_views_synced",
        entityType: "post",
        entityId: post.id,
        before: { paidViewsSynced: post.paidViewsSynced },
        after: { paidViewsSynced: paid },
      })
    })
    summary.postsUpdated++
  }

  return summary
}
