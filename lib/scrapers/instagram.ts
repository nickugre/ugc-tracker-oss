import { z } from "zod"

import { env } from "@/lib/env"

import type { NormalizedItem, PlatformAdapter } from "./types"

// Output of `apify/instagram-reel-scraper` (field names verified against the actor's declared
// dataset schema).
const itemSchema = z.looseObject({
  shortCode: z.string().min(1),
  caption: z.string().nullish(),
  timestamp: z.string(),
  ownerUsername: z.string(),
  ownerId: z.union([z.string(), z.number()]).transform(String).nullish(),
  ownerFullName: z.string().nullish(),
  displayUrl: z.string().nullish(),
  videoDuration: z.number().nullish(),
  videoPlayCount: z.number().nullish(),
  igPlayCount: z.number().nullish(),
  fbPlayCount: z.number().nullish(),
  videoViewCount: z.number().nullish(),
  likesCount: z.number().nullish(),
  commentsCount: z.number().nullish(),
  sharesCount: z.number().nullish(),
})

const errorSchema = z.looseObject({
  error: z.string(),
  errorDescription: z.string().nullish(),
  inputUrl: z.string().nullish(),
  url: z.string().nullish(),
})

// Which raw field counts as "views". Instagram's public number is plays; `videoViewCount` is the
// older, much smaller metric. Order matters: the first field present wins. All candidates are
// stored on the snapshot, so switching this later never loses information.
const VIEW_FIELDS = ["videoPlayCount", "igPlayCount", "videoViewCount"] as const

const count = (n: number | null | undefined) => (n == null || n < 0 ? null : Math.round(n))

export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",
  enabled: true,
  pricePerResultUsd: 0.0026,

  discovery(accounts, { limitPerProfile, newerThan }) {
    return {
      actorId: env().APIFY_INSTAGRAM_ACTOR,
      input: {
        username: accounts.map((a) => a.handle),
        resultsLimit: limitPerProfile,
        // Free on this actor, so only reels we could still track are fetched (and paid for).
        ...(newerThan ? { onlyPostsNewerThan: newerThan.toISOString().slice(0, 10) } : {}),
        skipPinnedPosts: false,
        skipTrialReels: true,
      },
      maxItems: accounts.length * limitPerProfile,
    }
  },

  metrics(posts, { atWindowClose }) {
    return {
      actorId: env().APIFY_INSTAGRAM_ACTOR,
      input: {
        // The `username` field also accepts direct reel URLs.
        username: posts.map((p) => p.url),
        // Shares are a paid add-on, so they are only fetched once, for the final numbers.
        includeSharesCount: atWindowClose,
      },
      maxItems: posts.length,
    }
  },

  normalize(item): NormalizedItem | null {
    const failure = errorSchema.safeParse(item)
    if (failure.success && !(item as { shortCode?: unknown }).shortCode) {
      const url = failure.data.inputUrl ?? failure.data.url ?? null
      const isReel = Boolean(url && /\/(reel|p)\//.test(url))
      return {
        kind: "error",
        scope: isReel ? "post" : url ? "account" : "other",
        code: failure.data.error,
        message: failure.data.errorDescription ?? failure.data.error,
        url,
        handle: !isReel && url ? (url.split("/").filter(Boolean).pop()?.toLowerCase() ?? null) : null,
      }
    }

    const parsed = itemSchema.safeParse(item)
    if (!parsed.success) return null
    const v = parsed.data
    const postedAt = new Date(v.timestamp)
    if (Number.isNaN(postedAt.getTime())) return null

    const viewsSource = VIEW_FIELDS.find((field) => typeof v[field] === "number" && v[field]! >= 0)
    if (!viewsSource) return null

    return {
      kind: "post",
      platformPostId: v.shortCode,
      // The actor returns /p/<code>/; the reel form is the canonical link.
      url: `https://www.instagram.com/reel/${v.shortCode}/`,
      handle: v.ownerUsername.toLowerCase(),
      caption: v.caption?.trim() || null,
      postedAt,
      durationSec: count(v.videoDuration),
      thumbnailUrl: v.displayUrl ?? null,
      views: Math.round(v[viewsSource]!),
      viewsSource,
      // -1 means the creator hid the like count.
      likes: count(v.likesCount),
      comments: count(v.commentsCount),
      shares: count(v.sharesCount),
      // Saves are not public on Instagram.
      saves: null,
      sparkHint: false,
      author: {
        id: v.ownerId ?? null,
        displayName: v.ownerFullName ?? null,
        // Not part of reel items.
        followers: null,
        avatarUrl: null,
      },
      raw: {
        videoPlayCount: v.videoPlayCount,
        igPlayCount: v.igPlayCount,
        fbPlayCount: v.fbPlayCount,
        videoViewCount: v.videoViewCount,
        likesCount: v.likesCount,
        commentsCount: v.commentsCount,
        sharesCount: v.sharesCount,
      },
    }
  },
}
