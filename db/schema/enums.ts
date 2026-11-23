import { pgEnum } from "drizzle-orm/pg-core"

export const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook", "snapchat"] as const
export type Platform = (typeof PLATFORMS)[number]
// Platforms with a live scraper adapter; the rest are selectable but stubbed.
export const LIVE_PLATFORMS: readonly Platform[] = ["tiktok", "instagram"]

export const platformEnum = pgEnum("platform", PLATFORMS)

export const creatorStatusEnum = pgEnum("creator_status", ["active", "paused", "ended"])
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "active", "ended"])

export const quotaPeriodEnum = pgEnum("quota_period", ["week", "month"])
export const quotaScopeEnum = pgEnum("quota_scope", ["per_platform", "total", "best_platform"])
export const baseTypeEnum = pgEnum("base_type", [
  "none",
  "per_video",
  "weekly_retainer",
  "monthly_retainer",
])
export const bonusTypeEnum = pgEnum("bonus_type", ["none", "cpm", "milestone", "hybrid"])
// qualify: once a video reaches the minimum, all its views pay. excess: only views above it pay.
export const cpmMinViewsModeEnum = pgEnum("cpm_min_views_mode", ["qualify", "excess"])
export const milestoneScopeEnum = pgEnum("milestone_scope", [
  "creator_cycle_best",
  "creator_campaign_lifetime",
  "per_video",
])
export const cycleTypeEnum = pgEnum("cycle_type", ["weekly", "monthly"])
export const paydayRuleEnum = pgEnum("payday_rule", ["last_day_of_month", "end_of_cycle"])

export const scrapeStatusEnum = pgEnum("scrape_status", ["idle", "queued", "running", "ok", "error"])

// Lifecycle only. "excluded" is a separate flag so that re-including a post loses nothing;
// the UI status (open / locked / paid / excluded) is the generated posts.display_status column.
export const POST_STATUSES = ["open", "locked", "paid"] as const
export type PostStatus = (typeof POST_STATUSES)[number]
export const postStatusEnum = pgEnum("post_status", POST_STATUSES)

export const DISPLAY_STATUSES = ["open", "locked", "paid", "excluded"] as const
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number]

export const REVIEW_REASONS = [
  "late_discovery",
  "unavailable",
  "views_decreased",
  "lock_fallback",
  "spark_no_paid_data",
  "paid_views_changed_after_payment",
] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]
export const reviewReasonEnum = pgEnum("review_reason", REVIEW_REASONS)

export const lockMethodEnum = pgEnum("lock_method", [
  "exact",
  "interpolated",
  "last_before",
  "manual",
  "first_after",
])
export const sparkSourceEnum = pgEnum("spark_source", ["manual", "ads_api"])

export const snapshotKindEnum = pgEnum("snapshot_kind", [
  "discovery",
  "metrics",
  "window_close",
  "manual",
  "seed",
])

export const scrapeKindEnum = pgEnum("scrape_kind", [
  "discovery",
  "metrics",
  "window_close",
  "manual",
  "backfill",
  // Comment text of a few videos, for the Spark page. Produces comments, not snapshots.
  "comments",
])
export const runTriggerEnum = pgEnum("run_trigger", ["cron", "manual", "sweep"])
export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "aborted",
  "ingesting",
  "ingested",
  "ingest_failed",
])

export const paidViewSourceEnum = pgEnum("paid_view_source", ["api", "manual"])

export const cycleStatusEnum = pgEnum("cycle_status", ["finalized", "paid"])
export const payoutLineStatusEnum = pgEnum("payout_line_status", ["unpaid", "paid"])
export const payoutItemKindEnum = pgEnum("payout_item_kind", ["base", "bonus"])

export const jobStatusEnum = pgEnum("job_status", ["running", "succeeded", "failed"])
