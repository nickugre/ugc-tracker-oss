import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { campaigns } from "./core"
import { cycleStatusEnum, cycleTypeEnum } from "./enums"

// Only finalized cycles are stored; the current cycle is always a live preview computed by the
// payout engine. `rulesSnapshot` freezes the campaign terms the cycle was settled with.
export const payoutCycles = pgTable(
  "payout_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    cycleType: cycleTypeEnum("cycle_type").notNull(),
    // Calendar dates in the campaign timezone; periodEnd is the last day of the cycle.
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    // The same boundaries as instants; endsAt is exclusive.
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    status: cycleStatusEnum("status").notNull().default("finalized"),
    rulesSnapshot: jsonb("rules_snapshot").notNull(),
    engineVersion: integer("engine_version").notNull().default(1),
    baseCents: integer("base_cents").notNull().default(0),
    bonusCents: integer("bonus_cents").notNull().default(0),
    adjustmentsCents: integer("adjustments_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedBy: uuid("finalized_by"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidBy: uuid("paid_by"),
    paymentNote: text("payment_note"),
  },
  (t) => [
    uniqueIndex("payout_cycles_campaign_period_uq").on(t.campaignId, t.cycleType, t.periodStart),
  ]
).enableRLS()
