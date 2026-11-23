import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { posts } from "./posts"
import { scrapeRuns } from "./runs"

// Comment text of promising videos, read so the Spark page can tell which videos make people ask
// about the app. Only the top comments of a few videos are fetched (see lib/jobs/comment-sync.ts).
// Whether a comment counts as an "app comment" is decided when the page is read, against the
// current keyword list, so editing the keywords never leaves stale flags behind.
export const postComments = pgTable(
  "post_comments",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    platformCommentId: text("platform_comment_id").notNull(),
    text: text("text").notNull(),
    // Lowercase, without "@".
    authorHandle: text("author_handle"),
    likes: bigint("likes", { mode: "number" }),
    replies: integer("replies"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    sourceRunId: uuid("source_run_id").references(() => scrapeRuns.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("post_comments_post_comment_uq").on(t.postId, t.platformCommentId),
    index("post_comments_post_idx").on(t.postId),
  ]
).enableRLS()

// One row at most. Until somebody saves the form in Settings there is no row and the defaults in
// lib/spark/settings.ts apply.
export const sparkSettings = pgTable(
  "spark_settings",
  {
    id: boolean("id").primaryKey().default(true),
    keywords: text("keywords").array().notNull(),
    // A ratio: 0.1 = 10%.
    minEngagement: doublePrecision("min_engagement").notNull(),
    minViews: integer("min_views").notNull(),
    minAppComments: integer("min_app_comments").notNull(),
    // What reading comments may cost per calendar month (UTC), inside the overall Apify budget.
    commentsBudgetUsd: doublePrecision("comments_budget_usd").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [check("spark_settings_single_row", sql`${t.id}`)]
).enableRLS()
