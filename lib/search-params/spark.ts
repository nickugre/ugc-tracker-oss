import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server"

// How far back the Spark page looks, by posting date. A boost works best on a video that is
// still fresh, so the default is a month and the longest is a quarter.
export const SPARK_RANGES = ["7d", "14d", "30d", "90d"] as const
export type SparkRange = (typeof SPARK_RANGES)[number]
export const SPARK_RANGE_DAYS: Record<SparkRange, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }

export const sparkParsers = {
  range: parseAsStringLiteral(SPARK_RANGES).withDefault("30d"),
  creator: parseAsString,
  // The open video panel, shared with the Videos page (components/videos/video-sheet.tsx).
  video: parseAsString,
}

export const loadSparkParams = createLoader(sparkParsers)
export type SparkParams = Awaited<ReturnType<typeof loadSparkParams>>
