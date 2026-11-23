import { z } from "zod"

import { env } from "@/lib/env"

import { tiktokComments } from "./tiktok-comments"
import type { NormalizedItem, PlatformAdapter } from "./types"

// Output of `clockworks/tiktok-scraper` (field names verified against the actor's declared
// dataset schema). Only what we use is validated; everything else passes through untouched.
const itemSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  text: z.string().nullish(),
  createTime: z.number().nullish(),
  createTimeISO: z.string().nullish(),
  webVideoUrl: z.string().url(),
  playCount: z.number().nonnegative(),
  diggCount: z.number().nullish(),
  shareCount: z.number().nullish(),
  commentCount: z.number().nullish(),
  collectCount: z.number().nullish(),
  isAd: z.boolean().nullish(),
  isSponsored: z.boolean().nullish(),
  videoMeta: z
    .looseObject({
      duration: z.number().nullish(),
      coverUrl: z.string().nullish(),
      originalCoverUrl: z.string().nullish(),
    })
    .nullish(),
  authorMeta: z.looseObject({
    id: z.union([z.string(), z.number()]).transform(String).nullish(),
    name: z.string(),
    nickName: z.string().nullish(),
    fans: z.number().nullish(),
    avatar: z.string().nullish(),
  }),
})

const errorSchema = z.looseObject({
  error: z.string(),
  errorCode: z.string().nullish(),
  url: z.string().nullish(),
  input: z.string().nullish(),
})

const ACCOUNT_ERRORS = new Set(["PROFILE_PRIVATE", "PROFILE_EMPTY", "NOT_FOUND"])
const POST_ERRORS = new Set(["POST_NOT_FOUND_OR_PRIVATE", "POST_SENSITIVE"])

const count = (n: number | null | undefined) => (n == null ? null : Math.max(0, Math.round(n)))

export const tiktokAdapter: PlatformAdapter = {
  platform: "tiktok",
  enabled: true,
  pricePerResultUsd: 0.0037,
  comments: tiktokComments,

  discovery(accounts, { limitPerProfile }) {
    return {
      actorId: env().APIFY_TIKTOK_ACTOR,
      input: {
        profiles: accounts.map((a) => a.handle),
        // The actor's default is 1, so this must always be set. No date filter on purpose: on
        // this actor it is a charged add-on; posts older than `track_from` are dropped at ingest.
        resultsPerPage: limitPerProfile,
        profileSorting: "latest",
        profileScrapeSections: ["videos"],
        excludePinnedPosts: false,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSubtitles: false,
        shouldDownloadSlideshowImages: false,
        shouldDownloadAvatars: false,
      },
      maxItems: accounts.length * limitPerProfile,
    }
  },

  metrics(posts) {
    return {
      actorId: env().APIFY_TIKTOK_ACTOR,
      input: {
        postURLs: posts.map((p) => p.url),
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSubtitles: false,
        shouldDownloadSlideshowImages: false,
      },
      maxItems: posts.length,
    }
  },

  normalize(item): NormalizedItem | null {
    const failure = errorSchema.safeParse(item)
    if (failure.success && !(item as { id?: unknown }).id) {
      const code = failure.data.errorCode ?? "UNKNOWN"
      return {
        kind: "error",
        scope: POST_ERRORS.has(code) ? "post" : ACCOUNT_ERRORS.has(code) ? "account" : "other",
        code,
        message: failure.data.error,
        url: failure.data.url ?? null,
        handle: failure.data.input?.replace(/^@/, "").toLowerCase() ?? null,
      }
    }

    const parsed = itemSchema.safeParse(item)
    if (!parsed.success) return null
    const v = parsed.data
    const postedAt = v.createTimeISO
      ? new Date(v.createTimeISO)
      : v.createTime
        ? new Date(v.createTime * 1000)
        : null
    if (!postedAt || Number.isNaN(postedAt.getTime())) return null

    return {
      kind: "post",
      platformPostId: v.id,
      url: v.webVideoUrl,
      handle: v.authorMeta.name.toLowerCase(),
      caption: v.text?.trim() || null,
      postedAt,
      durationSec: count(v.videoMeta?.duration),
      thumbnailUrl: v.videoMeta?.coverUrl ?? v.videoMeta?.originalCoverUrl ?? null,
      views: Math.round(v.playCount),
      viewsSource: "playCount",
      likes: count(v.diggCount),
      comments: count(v.commentCount),
      shares: count(v.shareCount),
      saves: count(v.collectCount),
      sparkHint: Boolean(v.isAd || v.isSponsored),
      author: {
        id: v.authorMeta.id ?? null,
        displayName: v.authorMeta.nickName ?? null,
        followers: count(v.authorMeta.fans),
        avatarUrl: v.authorMeta.avatar ?? null,
      },
      raw: {
        playCount: v.playCount,
        diggCount: v.diggCount,
        shareCount: v.shareCount,
        commentCount: v.commentCount,
        collectCount: v.collectCount,
        isAd: v.isAd,
        isSponsored: v.isSponsored,
      },
    }
  },
}
