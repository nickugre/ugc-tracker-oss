import { sql } from "drizzle-orm"
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { campaigns, creators } from "./core"
import { cycleTypeEnum, payoutItemKindEnum, payoutLineStatusEnum } from "./enums"
import { payoutCycles } from "./payout-cycles"
import { posts } from "./posts"

// One line per creator per finalized cycle.
export const payoutLines = pgTable(
  "payout_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => payoutCycles.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "restrict" }),
    baseCents: integer("base_cents").notNull().default(0),
    bonusCents: integer("bonus_cents").notNull().default(0),
    adjustmentsCents: integer("adjustments_cents").notNull().default(0),
    capReductionCents: integer("cap_reduction_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    postsPublished: integer("posts_published").notNull().default(0),
    postsDelivered: integer("posts_delivered").notNull().default(0),
    quota: integer("quota"),
    milestoneTierViews: bigint("milestone_tier_views", { mode: "number" }),
    milestoneTierAmountCents: integer("milestone_tier_amount_cents"),
    bestPostId: uuid("best_post_id"),
    breakdown: jsonb("breakdown"),
    status: payoutLineStatusEnum("status").notNull().default("unpaid"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentRef: text("payment_ref"),
  },
  (t) => [
    uniqueIndex("payout_lines_cycle_creator_uq").on(t.cycleId, t.creatorId),
    index("payout_lines_creator_idx").on(t.creatorId),
  ]
).enableRLS()

// Per-post settlement records. The partial unique indexes are the database-level guarantee that
// a post is never settled twice for base pay or twice for a bonus.
export const payoutItems = pgTable(
  "payout_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => payoutCycles.id, { onDelete: "cascade" }),
    lineId: uuid("line_id")
      .notNull()
      .references(() => payoutLines.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "restrict" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "restrict" }),
    kind: payoutItemKindEnum("kind").notNull(),
    lockedViews: bigint("locked_views", { mode: "number" }),
    paidViews: bigint("paid_views", { mode: "number" }),
    payableViews: bigint("payable_views", { mode: "number" }),
    amountCents: integer("amount_cents").notNull().default(0),
    detail: jsonb("detail"),
  },
  (t) => [
    uniqueIndex("payout_items_cycle_post_kind_uq").on(t.cycleId, t.postId, t.kind),
    uniqueIndex("payout_items_post_bonus_once_uq")
      .on(t.postId)
      .where(sql`kind = 'bonus'`),
    uniqueIndex("payout_items_post_base_once_uq")
      .on(t.postId)
      .where(sql`kind = 'base'`),
    index("payout_items_line_idx").on(t.lineId),
  ]
).enableRLS()

// Manual +/- corrections for a creator in a period. Attached to the cycle when it is finalized.
export const payoutAdjustments = pgTable(
  "payout_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    cycleType: cycleTypeEnum("cycle_type").notNull(),
    periodStart: date("period_start").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by"),
    cycleId: uuid("cycle_id").references(() => payoutCycles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payout_adjustments_period_idx").on(t.campaignId, t.periodStart, t.creatorId)]
).enableRLS()
