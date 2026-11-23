import {
  createLoader,
  createParser,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

import { DISPLAY_STATUSES, PLATFORMS } from "@/db/schema/enums"

export const VIDEO_SORTS = ["posted", "window", "views", "velocity", "engagement", "payable"] as const
export type VideoSort = (typeof VIDEO_SORTS)[number]

export const VIDEO_FLAGS = ["review", "spark", "closing"] as const
export type VideoFlag = (typeof VIDEO_FLAGS)[number]

// Metrics that can be narrowed to a min–max range. `engagement` is in percent, the rest are counts.
export const VIDEO_METRICS = [
  "views",
  "views24h",
  "engagement",
  "likes",
  "comments",
  "shares",
  "saves",
] as const
export type VideoMetric = (typeof VIDEO_METRICS)[number]

export type NumberRange = { min: number | null; max: number | null }

// "1000-50000", "1000-" (at least) or "-50000" (at most). Metrics are never negative, so the
// dash is unambiguous.
const RANGE = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/
export const parseAsNumberRange = createParser<NumberRange>({
  parse(value) {
    const match = RANGE.exec(value)
    if (!match || (match[1] == null && match[2] == null)) return null
    const min = match[1] == null ? null : Number(match[1])
    const max = match[2] == null ? null : Number(match[2])
    // Beyond this a number no longer fits the bigint columns it is compared with.
    if ((min ?? 0) > Number.MAX_SAFE_INTEGER || (max ?? 0) > Number.MAX_SAFE_INTEGER) return null
    return { min, max }
  },
  serialize: ({ min, max }) => `${min ?? ""}-${max ?? ""}`,
  eq: (a, b) => a.min === b.min && a.max === b.max,
})

// One definition of the Videos page URL state, shared by the server (loader) and the client
// filter bar (useQueryStates), so a filtered view is always a shareable link.
export const videosParsers = {
  q: parseAsString.withDefault(""),
  status: parseAsArrayOf(parseAsStringLiteral(DISPLAY_STATUSES)).withDefault([]),
  platform: parseAsArrayOf(parseAsStringLiteral(PLATFORMS)).withDefault([]),
  campaign: parseAsString,
  creator: parseAsString,
  account: parseAsString,
  flag: parseAsStringLiteral(VIDEO_FLAGS),
  // Posted-date range as YYYY-MM-DD days, either end optional.
  from: parseAsString,
  to: parseAsString,
  views: parseAsNumberRange,
  views24h: parseAsNumberRange,
  engagement: parseAsNumberRange,
  likes: parseAsNumberRange,
  comments: parseAsNumberRange,
  shares: parseAsNumberRange,
  saves: parseAsNumberRange,
  sort: parseAsStringLiteral(VIDEO_SORTS).withDefault("posted"),
  dir: parseAsStringLiteral(["asc", "desc"] as const).withDefault("desc"),
  page: parseAsInteger.withDefault(1),
  // Id of the video whose detail sheet is open.
  video: parseAsString,
}

export const loadVideosParams = createLoader(videosParsers)
export type VideosParams = Awaited<ReturnType<typeof loadVideosParams>>
