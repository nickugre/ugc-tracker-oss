import {
  bigint,
  date,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { posts } from "./posts"

// TikTok ads that promote an organic post (Spark Ads). Several ads can point at one post, so
// paid views are always summed per post.
export const tiktokAds = pgTable(
  "tiktok_ads",
  {
    adId: text("ad_id").primaryKey(),
    advertiserId: text("advertiser_id").notNull(),
    adName: text("ad_name"),
    // The organic post's id; equals posts.platform_post_id for TikTok posts.
    tiktokItemId: text("tiktok_item_id"),
    identityType: text("identity_type"),
    identityId: text("identity_id"),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    adCreateTime: timestamp("ad_create_time", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tiktok_ads_item_idx").on(t.tiktokItemId), index("tiktok_ads_post_idx").on(t.postId)]
).enableRLS()

// Daily paid video views per ad. `statDate` is a calendar day in the ad account's time zone.
// Upserted on every sync because TikTok restates recent days.
export const tiktokAdDailyStats = pgTable(
  "tiktok_ad_daily_stats",
  {
    adId: text("ad_id")
      .notNull()
      .references(() => tiktokAds.adId, { onDelete: "cascade" }),
    statDate: date("stat_date").notNull(),
    advertiserTimezone: text("advertiser_timezone").notNull().default("UTC"),
    videoViews: bigint("video_views", { mode: "number" }).notNull().default(0),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    spend: doublePrecision("spend").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adId, t.statDate] })]
).enableRLS()
