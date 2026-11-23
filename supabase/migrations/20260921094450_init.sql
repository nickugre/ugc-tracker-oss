CREATE TYPE "public"."base_type" AS ENUM('none', 'per_video', 'weekly_retainer', 'monthly_retainer');--> statement-breakpoint
CREATE TYPE "public"."bonus_type" AS ENUM('none', 'cpm', 'milestone', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."cpm_min_views_mode" AS ENUM('qualify', 'excess');--> statement-breakpoint
CREATE TYPE "public"."creator_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('finalized', 'paid');--> statement-breakpoint
CREATE TYPE "public"."cycle_type" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lock_method" AS ENUM('exact', 'interpolated', 'last_before', 'manual');--> statement-breakpoint
CREATE TYPE "public"."milestone_scope" AS ENUM('creator_cycle_best', 'creator_campaign_lifetime', 'per_video');--> statement-breakpoint
CREATE TYPE "public"."paid_view_source" AS ENUM('api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."payday_rule" AS ENUM('last_day_of_month', 'end_of_cycle');--> statement-breakpoint
CREATE TYPE "public"."payout_item_kind" AS ENUM('base', 'bonus');--> statement-breakpoint
CREATE TYPE "public"."payout_line_status" AS ENUM('unpaid', 'paid');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('tiktok', 'instagram', 'youtube', 'facebook', 'snapchat');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('open', 'locked', 'paid');--> statement-breakpoint
CREATE TYPE "public"."quota_period" AS ENUM('week', 'month');--> statement-breakpoint
CREATE TYPE "public"."quota_scope" AS ENUM('per_platform', 'total');--> statement-breakpoint
CREATE TYPE "public"."review_reason" AS ENUM('late_discovery', 'unavailable', 'views_decreased', 'lock_fallback', 'spark_no_paid_data', 'paid_views_changed_after_payment');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'timed_out', 'aborted', 'ingesting', 'ingested', 'ingest_failed');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('cron', 'manual', 'sweep');--> statement-breakpoint
CREATE TYPE "public"."scrape_kind" AS ENUM('discovery', 'metrics', 'window_close', 'manual');--> statement-breakpoint
CREATE TYPE "public"."scrape_status" AS ENUM('idle', 'queued', 'running', 'ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."snapshot_kind" AS ENUM('discovery', 'metrics', 'window_close', 'manual', 'seed');--> statement-breakpoint
CREATE TYPE "public"."spark_source" AS ENUM('manual', 'ads_api');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"handle" text NOT NULL,
	"url" text NOT NULL,
	"platform_account_id" text,
	"display_name" text,
	"avatar_url" text,
	"follower_count" integer,
	"creator_id" uuid,
	"campaign_id" uuid,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"track_from" date,
	"last_scraped_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"scrape_status" "scrape_status" DEFAULT 'idle' NOT NULL,
	"scrape_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_creators" (
	"campaign_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"start_date" date,
	"end_date" date,
	"base_amount_cents_override" integer,
	"quota_count_override" integer,
	"cycle_cap_cents_override" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_creators_campaign_id_creator_id_pk" PRIMARY KEY("campaign_id","creator_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_creators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"platforms" "platform"[] DEFAULT '{}'::platform[] NOT NULL,
	"quota_count" integer,
	"quota_period" "quota_period" DEFAULT 'month' NOT NULL,
	"quota_scope" "quota_scope" DEFAULT 'per_platform' NOT NULL,
	"default_window_days" integer DEFAULT 14 NOT NULL,
	"base_type" "base_type" DEFAULT 'none' NOT NULL,
	"base_amount_cents" integer DEFAULT 0 NOT NULL,
	"prorate_base" boolean DEFAULT true NOT NULL,
	"bonus_type" "bonus_type" DEFAULT 'none' NOT NULL,
	"cpm_rate_cents" integer,
	"min_views_for_bonus" integer,
	"cpm_min_views_mode" "cpm_min_views_mode" DEFAULT 'qualify' NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"milestone_scope" "milestone_scope" DEFAULT 'creator_cycle_best' NOT NULL,
	"per_video_bonus_cap_cents" integer,
	"per_creator_cycle_cap_cents" integer,
	"per_creator_cycle_total_cap_cents" integer,
	"usage_rights_note" text,
	"cycle_type" "cycle_type" DEFAULT 'monthly' NOT NULL,
	"week_starts_on" smallint DEFAULT 1 NOT NULL,
	"payday_rule" "payday_rule" DEFAULT 'last_day_of_month' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"contact_handle" text,
	"country" text,
	"payment_details" text,
	"status" "creator_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_locks" (
	"job" text PRIMARY KEY NOT NULL,
	"locked_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job" text NOT NULL,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"actor_id" text NOT NULL,
	"kind" "scrape_kind" NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"triggered_by" uuid,
	"apify_run_id" text,
	"apify_dataset_id" text,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb,
	"requested_account_ids" uuid[],
	"requested_post_ids" uuid[],
	"items_count" integer,
	"posts_created" integer,
	"snapshots_created" integer,
	"errors_count" integer,
	"error" text,
	"cost_usd" double precision,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"apify_finished_at" timestamp with time zone,
	"ingest_started_at" timestamp with time zone,
	"ingested_at" timestamp with time zone,
	CONSTRAINT "scrape_runs_apify_run_id_unique" UNIQUE("apify_run_id")
);
--> statement-breakpoint
ALTER TABLE "scrape_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payout_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cycle_type" "cycle_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"status" "cycle_status" DEFAULT 'finalized' NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"engine_version" integer DEFAULT 1 NOT NULL,
	"base_cents" integer DEFAULT 0 NOT NULL,
	"bonus_cents" integer DEFAULT 0 NOT NULL,
	"adjustments_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"payment_note" text
);
--> statement-breakpoint
ALTER TABLE "payout_cycles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_daily_metrics" (
	"post_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" bigint NOT NULL,
	"likes" bigint,
	"comments" bigint,
	"shares" bigint,
	"saves" bigint,
	"views_delta" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "post_daily_metrics_post_id_day_pk" PRIMARY KEY("post_id","day")
);
--> statement-breakpoint
ALTER TABLE "post_daily_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "post_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"post_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"views" bigint NOT NULL,
	"likes" bigint,
	"comments" bigint,
	"shares" bigint,
	"saves" bigint,
	"engagement_rate" double precision,
	"virality" double precision,
	"kind" "snapshot_kind" NOT NULL,
	"source_run_id" uuid,
	"apify_run_id" text,
	"views_source" text,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "post_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_post_id" text NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"duration_sec" integer,
	"posted_at" timestamp with time zone NOT NULL,
	"thumbnail_source_url" text,
	"thumbnail_path" text,
	"creator_id" uuid,
	"campaign_id" uuid,
	"assignment_source" text DEFAULT 'auto' NOT NULL,
	"window_days" integer NOT NULL,
	"window_overridden" boolean DEFAULT false NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"status" "post_status" DEFAULT 'open' NOT NULL,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"excluded_reason" text,
	"excluded_by" uuid,
	"excluded_at" timestamp with time zone,
	"display_status" text GENERATED ALWAYS AS (case when is_excluded then 'excluded' when status = 'open' then 'open' when status = 'locked' then 'locked' else 'paid' end) STORED,
	"lock_hold" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" "review_reason",
	"is_available" boolean DEFAULT true NOT NULL,
	"unavailable_since" timestamp with time zone,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"current_views" bigint DEFAULT 0 NOT NULL,
	"current_likes" bigint,
	"current_comments" bigint,
	"current_shares" bigint,
	"current_saves" bigint,
	"engagement_rate" double precision,
	"virality" double precision,
	"views_24h_delta" bigint,
	"last_snapshot_at" timestamp with time zone,
	"locked_views" bigint,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"lock_method" "lock_method",
	"lock_details" jsonb,
	"is_spark" boolean DEFAULT false NOT NULL,
	"spark_hint" boolean DEFAULT false NOT NULL,
	"spark_source" "spark_source",
	"spark_started_at" timestamp with time zone,
	"paid_views_manual" bigint,
	"paid_views_synced" bigint,
	"payable_views" bigint GENERATED ALWAYS AS (case when locked_views is null then null else greatest(0, locked_views - coalesce(paid_views_manual, paid_views_synced, 0)) end) STORED,
	"base_cycle_id" uuid,
	"bonus_cycle_id" uuid,
	"paid_at" timestamp with time zone,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_window_matches_days" CHECK (extract(epoch from (window_ends_at - posted_at)) = window_days * 86400)
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payout_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"cycle_type" "cycle_type" NOT NULL,
	"period_start" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"cycle_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"kind" "payout_item_kind" NOT NULL,
	"locked_views" bigint,
	"paid_views" bigint,
	"payable_views" bigint,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "payout_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payout_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"base_cents" integer DEFAULT 0 NOT NULL,
	"bonus_cents" integer DEFAULT 0 NOT NULL,
	"adjustments_cents" integer DEFAULT 0 NOT NULL,
	"cap_reduction_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"posts_published" integer DEFAULT 0 NOT NULL,
	"posts_delivered" integer DEFAULT 0 NOT NULL,
	"quota" integer,
	"milestone_tier_views" bigint,
	"milestone_tier_amount_cents" integer,
	"best_post_id" uuid,
	"breakdown" jsonb,
	"status" "payout_line_status" DEFAULT 'unpaid' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_ref" text
);
--> statement-breakpoint
ALTER TABLE "payout_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tiktok_ad_daily_stats" (
	"ad_id" text NOT NULL,
	"stat_date" date NOT NULL,
	"advertiser_timezone" text DEFAULT 'UTC' NOT NULL,
	"video_views" bigint DEFAULT 0 NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiktok_ad_daily_stats_ad_id_stat_date_pk" PRIMARY KEY("ad_id","stat_date")
);
--> statement-breakpoint
ALTER TABLE "tiktok_ad_daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tiktok_ads" (
	"ad_id" text PRIMARY KEY NOT NULL,
	"advertiser_id" text NOT NULL,
	"ad_name" text,
	"tiktok_item_id" text,
	"identity_type" text,
	"identity_id" text,
	"post_id" uuid,
	"ad_create_time" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tiktok_ads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creators_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_creators" ADD CONSTRAINT "campaign_creators_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_cycles" ADD CONSTRAINT "payout_cycles_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_daily_metrics" ADD CONSTRAINT "post_daily_metrics_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_snapshots" ADD CONSTRAINT "post_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_snapshots" ADD CONSTRAINT "post_snapshots_source_run_id_scrape_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_base_cycle_id_payout_cycles_id_fk" FOREIGN KEY ("base_cycle_id") REFERENCES "public"."payout_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_bonus_cycle_id_payout_cycles_id_fk" FOREIGN KEY ("bonus_cycle_id") REFERENCES "public"."payout_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_cycle_id_payout_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."payout_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_cycle_id_payout_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."payout_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_line_id_payout_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payout_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_cycle_id_payout_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."payout_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_ad_daily_stats" ADD CONSTRAINT "tiktok_ad_daily_stats_ad_id_tiktok_ads_ad_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."tiktok_ads"("ad_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_ads" ADD CONSTRAINT "tiktok_ads_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_platform_handle_uq" ON "accounts" USING btree ("platform","handle");--> statement-breakpoint
CREATE INDEX "accounts_creator_idx" ON "accounts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "accounts_campaign_idx" ON "accounts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_creators_creator_idx" ON "campaign_creators" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "creators_name_idx" ON "creators" USING btree ("name");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_status_idx" ON "scrape_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_started_idx" ON "scrape_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_cycles_campaign_period_uq" ON "payout_cycles" USING btree ("campaign_id","cycle_type","period_start");--> statement-breakpoint
CREATE INDEX "post_daily_metrics_day_idx" ON "post_daily_metrics" USING btree ("day");--> statement-breakpoint
CREATE INDEX "post_snapshots_post_captured_idx" ON "post_snapshots" USING btree ("post_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_snapshots_post_run_uq" ON "post_snapshots" USING btree ("post_id","source_run_id") WHERE source_run_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_platform_post_uq" ON "posts" USING btree ("platform","platform_post_id");--> statement-breakpoint
CREATE INDEX "posts_campaign_status_idx" ON "posts" USING btree ("campaign_id","display_status");--> statement-breakpoint
CREATE INDEX "posts_creator_posted_idx" ON "posts" USING btree ("creator_id","posted_at");--> statement-breakpoint
CREATE INDEX "posts_account_posted_idx" ON "posts" USING btree ("account_id","posted_at");--> statement-breakpoint
CREATE INDEX "posts_posted_idx" ON "posts" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "posts_open_window_idx" ON "posts" USING btree ("window_ends_at") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "posts_bonus_cycle_idx" ON "posts" USING btree ("bonus_cycle_id");--> statement-breakpoint
CREATE INDEX "payout_adjustments_period_idx" ON "payout_adjustments" USING btree ("campaign_id","period_start","creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_cycle_post_kind_uq" ON "payout_items" USING btree ("cycle_id","post_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_post_bonus_once_uq" ON "payout_items" USING btree ("post_id") WHERE kind = 'bonus';--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_post_base_once_uq" ON "payout_items" USING btree ("post_id") WHERE kind = 'base';--> statement-breakpoint
CREATE INDEX "payout_items_line_idx" ON "payout_items" USING btree ("line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_lines_cycle_creator_uq" ON "payout_lines" USING btree ("cycle_id","creator_id");--> statement-breakpoint
CREATE INDEX "payout_lines_creator_idx" ON "payout_lines" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "tiktok_ads_item_idx" ON "tiktok_ads" USING btree ("tiktok_item_id");--> statement-breakpoint
CREATE INDEX "tiktok_ads_post_idx" ON "tiktok_ads" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");