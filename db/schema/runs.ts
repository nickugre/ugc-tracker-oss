import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import {
  jobStatusEnum,
  platformEnum,
  runStatusEnum,
  runTriggerEnum,
  scrapeKindEnum,
} from "./enums"

// One row per Apify actor run we started. `ingestedAt` makes ingestion idempotent: the webhook,
// the status poller and the hourly sweeper can all try to ingest the same run safely.
export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: platformEnum("platform").notNull(),
    actorId: text("actor_id").notNull(),
    kind: scrapeKindEnum("kind").notNull(),
    trigger: runTriggerEnum("trigger").notNull(),
    triggeredBy: uuid("triggered_by"),
    apifyRunId: text("apify_run_id").unique(),
    apifyDatasetId: text("apify_dataset_id"),
    status: runStatusEnum("status").notNull().default("queued"),
    input: jsonb("input"),
    requestedAccountIds: uuid("requested_account_ids").array(),
    requestedPostIds: uuid("requested_post_ids").array(),
    itemsCount: integer("items_count"),
    postsCreated: integer("posts_created"),
    snapshotsCreated: integer("snapshots_created"),
    errorsCount: integer("errors_count"),
    error: text("error"),
    costUsd: doublePrecision("cost_usd"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    apifyFinishedAt: timestamp("apify_finished_at", { withTimezone: true }),
    ingestStartedAt: timestamp("ingest_started_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }),
  },
  (t) => [
    index("scrape_runs_status_idx").on(t.status, t.startedAt),
    index("scrape_runs_started_idx").on(t.startedAt),
  ]
).enableRLS()

// Log of scheduled job executions (daily sync, window close, TikTok Ads sync).
export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    job: text("job").notNull(),
    status: jobStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summary: jsonb("summary"),
    error: text("error"),
  },
  (t) => [index("job_runs_job_idx").on(t.job, t.startedAt)]
).enableRLS()

// Lease row per job so two overlapping invocations never run the same job at once.
export const jobLocks = pgTable("job_locks", {
  job: text("job").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
}).enableRLS()
