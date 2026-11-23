import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accounts, campaigns, creators, timestamps } from "./core"
import {
  lockMethodEnum,
  platformEnum,
  postStatusEnum,
  reviewReasonEnum,
  snapshotKindEnum,
  sparkSourceEnum,
} from "./enums"
import { payoutCycles } from "./payout-cycles"
import { scrapeRuns } from "./runs"

export type LockDetails = {
  before?: { snapshotId: number; capturedAt: string; views: number }
  after?: { snapshotId: number; capturedAt: string; views: number }
  fraction?: number
  note?: string
}

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    platform: platformEnum("platform").notNull(),
    // TikTok video id (identical to the Ads API tiktok_item_id) / Instagram shortCode.
    platformPostId: text("platform_post_id").notNull(),
    url: text("url").notNull(),
    caption: text("caption"),
    durationSec: integer("duration_sec"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    // Platform CDN URLs expire, so the cover is copied to Storage once (thumbnailPath).
    thumbnailSourceUrl: text("thumbnail_source_url"),
    thumbnailPath: text("thumbnail_path"),

    // Snapshot of the account's assignment when the post was first ingested. Re-linking an
    // account later never rewrites these.
    creatorId: uuid("creator_id").references(() => creators.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    assignmentSource: text("assignment_source").notNull().default("auto"),

    windowDays: integer("window_days").notNull(),
    windowOverridden: boolean("window_overridden").notNull().default(false),
    windowEndsAt: timestamp("window_ends_at", { withTimezone: true }).notNull(),

    status: postStatusEnum("status").notNull().default("open"),
    isExcluded: boolean("is_excluded").notNull().default(false),
    excludedReason: text("excluded_reason"),
    excludedBy: uuid("excluded_by"),
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    displayStatus: text("display_status").generatedAlwaysAs(
      sql`case when is_excluded then 'excluded' when status = 'open' then 'open' when status = 'locked' then 'locked' else 'paid' end`
    ),
    // Set by a manual unlock so the hourly job leaves the post alone until someone locks it again.
    lockHold: boolean("lock_hold").notNull().default(false),

    needsReview: boolean("needs_review").notNull().default(false),
    reviewReason: reviewReasonEnum("review_reason"),
    isAvailable: boolean("is_available").notNull().default(true),
    unavailableSince: timestamp("unavailable_since", { withTimezone: true }),
    missingCount: integer("missing_count").notNull().default(0),

    // Latest metrics, denormalized from the newest snapshot for fast sortable tables.
    currentViews: bigint("current_views", { mode: "number" }).notNull().default(0),
    currentLikes: bigint("current_likes", { mode: "number" }),
    currentComments: bigint("current_comments", { mode: "number" }),
    currentShares: bigint("current_shares", { mode: "number" }),
    currentSaves: bigint("current_saves", { mode: "number" }),
    engagementRate: doublePrecision("engagement_rate"),
    virality: doublePrecision("virality"),
    views24hDelta: bigint("views_24h_delta", { mode: "number" }),
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),

    lockedViews: bigint("locked_views", { mode: "number" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    // null = locked by the system job.
    lockedBy: uuid("locked_by"),
    lockMethod: lockMethodEnum("lock_method"),
    lockDetails: jsonb("lock_details").$type<LockDetails>(),

    isSpark: boolean("is_spark").notNull().default(false),
    // The scraper saw isAd / isSponsored. Only a hint: it suggests the Spark flag, nothing more.
    sparkHint: boolean("spark_hint").notNull().default(false),
    sparkSource: sparkSourceEnum("spark_source"),
    sparkStartedAt: timestamp("spark_started_at", { withTimezone: true }),
    // Paid views inside the window. A manual value always wins over the Ads API sync.
    paidViewsManual: bigint("paid_views_manual", { mode: "number" }),
    paidViewsSynced: bigint("paid_views_synced", { mode: "number" }),
    payableViews: bigint("payable_views", { mode: "number" }).generatedAlwaysAs(
      sql`case when locked_views is null then null else greatest(0, locked_views - coalesce(paid_views_manual, paid_views_synced, 0)) end`
    ),

    // A post counts toward base pay in the cycle it was published in and toward the bonus in
    // the cycle its window closed in; these are often different cycles.
    baseCycleId: uuid("base_cycle_id").references(() => payoutCycles.id, { onDelete: "set null" }),
    bonusCycleId: uuid("bonus_cycle_id").references(() => payoutCycles.id, {
      onDelete: "set null",
    }),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    // Comment text is read for promising videos only (the Spark page). When it was last asked
    // for, how many comments the video had then (a re-read waits until that has doubled), and
    // how often, so a video that never returns comments is not asked for forever.
    commentsCheckedAt: timestamp("comments_checked_at", { withTimezone: true }),
    commentsCheckedCount: bigint("comments_checked_count", { mode: "number" }),
    commentsChecks: integer("comments_checks").notNull().default(0),

    notes: text("notes"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("posts_platform_post_uq").on(t.platform, t.platformPostId),
    index("posts_campaign_status_idx").on(t.campaignId, t.displayStatus),
    index("posts_creator_posted_idx").on(t.creatorId, t.postedAt),
    index("posts_account_posted_idx").on(t.accountId, t.postedAt),
    index("posts_posted_idx").on(t.postedAt),
    index("posts_open_window_idx")
      .on(t.windowEndsAt)
      .where(sql`status = 'open'`),
    index("posts_bonus_cycle_idx").on(t.bonusCycleId),
    check(
      "posts_window_matches_days",
      sql`extract(epoch from (window_ends_at - posted_at)) = window_days * 86400`
    ),
  ]
).enableRLS()

// Every scrape of a post. Kept forever: together with the Apify run id these rows are the
// evidence behind a locked view count.
export const postSnapshots = pgTable(
  "post_snapshots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    // When the scrape happened (the Apify run's finish time), not when we ingested it.
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    views: bigint("views", { mode: "number" }).notNull(),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    engagementRate: doublePrecision("engagement_rate"),
    virality: doublePrecision("virality"),
    kind: snapshotKindEnum("kind").notNull(),
    sourceRunId: uuid("source_run_id").references(() => scrapeRuns.id, { onDelete: "set null" }),
    apifyRunId: text("apify_run_id"),
    // Which raw field the views number came from, e.g. "playCount" or "videoPlayCount".
    viewsSource: text("views_source"),
    raw: jsonb("raw"),
  },
  (t) => [
    index("post_snapshots_post_captured_idx").on(t.postId, t.capturedAt),
    uniqueIndex("post_snapshots_post_run_uq")
      .on(t.postId, t.sourceRunId)
      .where(sql`source_run_id is not null`),
  ]
).enableRLS()

// One row per post per UTC day (end-of-day values + the day's view gain). Upserted at ingest so
// charts and sparklines never have to scan raw snapshots.
export const postDailyMetrics = pgTable(
  "post_daily_metrics",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    views: bigint("views", { mode: "number" }).notNull(),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    viewsDelta: bigint("views_delta", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.day] }), index("post_daily_metrics_day_idx").on(t.day)]
).enableRLS()
