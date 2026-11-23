import { createLoader, parseAsArrayOf, parseAsString, parseAsStringLiteral } from "nuqs/server"

import { DISPLAY_STATUSES, PLATFORMS } from "@/db/schema/enums"

// "campaign" runs from the campaign's start date until today (or its end date): the selected
// campaign, or every active one when none is selected. "all" reaches back to the first video in
// scope, which can be earlier than the campaign start when older videos were imported.
export const RANGE_PRESETS = ["7d", "30d", "90d", "campaign", "all"] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export const RANGE_DAYS: Record<Exclude<RangePreset, "campaign" | "all">, number> = { "7d": 7, "30d": 30, "90d": 90 }

// A calendar month (YYYY-MM) in the campaign's time zone, the same boundary a monthly payout cycle
// uses. When set it replaces the range preset, and the "what is ready to pay" numbers follow it too.
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

// What the "Top videos" panel ranks by.
export const TOP_VIDEO_METRICS = ["views", "engagement"] as const
export type TopVideoMetric = (typeof TOP_VIDEO_METRICS)[number]

// A handful of views makes any engagement rate look huge, so the engagement ranking only
// considers videos with at least this many.
export const TOP_ENGAGEMENT_MIN_VIEWS = 1000

// URL state of the Overview page. Every KPI, chart and table below the filter row is computed
// from the same slice, so the numbers always agree with each other.
export const overviewParsers = {
  range: parseAsStringLiteral(RANGE_PRESETS).withDefault("30d"),
  month: parseAsString,
  campaign: parseAsString,
  creator: parseAsString,
  account: parseAsString,
  platform: parseAsArrayOf(parseAsStringLiteral(PLATFORMS)).withDefault([]),
  status: parseAsArrayOf(parseAsStringLiteral(DISPLAY_STATUSES)).withDefault([]),
  top: parseAsStringLiteral(TOP_VIDEO_METRICS).withDefault("views"),
}

export const loadOverviewParams = createLoader(overviewParsers)
export type OverviewParams = Awaited<ReturnType<typeof loadOverviewParams>>
