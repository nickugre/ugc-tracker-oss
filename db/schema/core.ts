import { sql } from "drizzle-orm"
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { authUsers } from "drizzle-orm/supabase"

import {
  baseTypeEnum,
  bonusTypeEnum,
  campaignStatusEnum,
  cpmMinViewsModeEnum,
  creatorStatusEnum,
  cycleTypeEnum,
  milestoneScopeEnum,
  paydayRuleEnum,
  platformEnum,
  quotaPeriodEnum,
  quotaScopeEnum,
  scrapeStatusEnum,
} from "./enums"

export type Milestone = { views: number; amountCents: number }

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

// Team members. A row is inserted by the invite action (or scripts/create-admin.ts); a Supabase
// auth user without an active profile cannot use the app.
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  fullName: text("full_name"),
  role: text("role").notNull().default("admin"),
  isActive: boolean("is_active").notNull().default(true),
  invitedBy: uuid("invited_by"),
  ...timestamps,
}).enableRLS()

export const creators = pgTable(
  "creators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    contactHandle: text("contact_handle"),
    country: text("country"),
    // IANA zone the creator's posting days are counted in on the Calendar; null = the campaign's
    // zone. Payout cycles never use it: they are always cut in the campaign zone.
    timezone: text("timezone"),
    paymentDetails: text("payment_details"),
    status: creatorStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("creators_name_idx").on(t.name)]
).enableRLS()

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  timezone: text("timezone").notNull().default("UTC"),
  platforms: platformEnum("platforms")
    .array()
    .notNull()
    .default(sql`'{}'::platform[]`),

  // Posting quota. With scope per_platform the count applies to each enabled platform.
  // (The cost of one video is derived: the per-video rate, or the retainer ÷ quota.)
  quotaCount: integer("quota_count"),
  quotaPeriod: quotaPeriodEnum("quota_period").notNull().default("month"),
  quotaScope: quotaScopeEnum("quota_scope").notNull().default("per_platform"),

  defaultWindowDays: integer("default_window_days").notNull().default(14),

  baseType: baseTypeEnum("base_type").notNull().default("none"),
  baseAmountCents: integer("base_amount_cents").notNull().default(0),
  prorateBase: boolean("prorate_base").notNull().default(true),

  bonusType: bonusTypeEnum("bonus_type").notNull().default("none"),
  cpmRateCents: integer("cpm_rate_cents"),
  minViewsForBonus: integer("min_views_for_bonus"),
  cpmMinViewsMode: cpmMinViewsModeEnum("cpm_min_views_mode").notNull().default("qualify"),
  milestones: jsonb("milestones").$type<Milestone[]>().notNull().default([]),
  milestoneScope: milestoneScopeEnum("milestone_scope").notNull().default("creator_cycle_best"),
  perVideoBonusCapCents: integer("per_video_bonus_cap_cents"),
  // Cap on a creator's bonus for one cycle, and optionally on base + bonus together.
  perCreatorCycleCapCents: integer("per_creator_cycle_cap_cents"),
  perCreatorCycleTotalCapCents: integer("per_creator_cycle_total_cap_cents"),
  usageRightsNote: text("usage_rights_note"),

  cycleType: cycleTypeEnum("cycle_type").notNull().default("monthly"),
  // 0 = Sunday … 6 = Saturday. Used by weekly cycles.
  weekStartsOn: smallint("week_starts_on").notNull().default(1),
  paydayRule: paydayRuleEnum("payday_rule").notNull().default("last_day_of_month"),
  currency: text("currency").notNull().default("USD"),
  ...timestamps,
}).enableRLS()

// Creator ↔ campaign assignment, with optional per-creator overrides of the campaign terms.
export const campaignCreators = pgTable(
  "campaign_creators",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    baseAmountCentsOverride: integer("base_amount_cents_override"),
    quotaCountOverride: integer("quota_count_override"),
    cycleCapCentsOverride: integer("cycle_cap_cents_override"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.creatorId] }),
    index("campaign_creators_creator_idx").on(t.creatorId),
  ]
).enableRLS()

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: platformEnum("platform").notNull(),
    // Stored lowercase, without a leading "@".
    handle: text("handle").notNull(),
    url: text("url").notNull(),
    platformAccountId: text("platform_account_id"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    followerCount: integer("follower_count"),
    creatorId: uuid("creator_id").references(() => creators.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    trackingEnabled: boolean("tracking_enabled").notNull().default(true),
    // Posts published before this date are ignored at ingest.
    trackFrom: date("track_from"),
    // The next scrape reaches back to `track_from` instead of only looking for new posts. Set for
    // new accounts and whenever the link changes; cleared once a backfill run has been ingested.
    backfillPending: boolean("backfill_pending").notNull().default(true),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    scrapeStatus: scrapeStatusEnum("scrape_status").notNull().default("idle"),
    scrapeError: text("scrape_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("accounts_platform_handle_uq").on(t.platform, t.handle),
    index("accounts_creator_idx").on(t.creatorId),
    index("accounts_campaign_idx").on(t.campaignId),
  ]
).enableRLS()
