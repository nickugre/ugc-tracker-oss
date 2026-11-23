import { z } from "zod"

import { env } from "@/lib/env"

import type { CommentsAdapter } from "./types"

// Output of `clockworks/tiktok-comments-scraper` (field names verified against the actor's
// declared dataset schema). Every field is nullable there, so nothing but the ids is required.
const itemSchema = z.looseObject({
  cid: z.union([z.string(), z.number()]).transform(String),
  text: z.string().nullish(),
  createTime: z.number().nullish(),
  createTimeISO: z.string().nullish(),
  diggCount: z.number().nullish(),
  replyCommentTotal: z.number().nullish(),
  uniqueId: z.string().nullish(),
  repliesToId: z.union([z.string(), z.number()]).nullish(),
  videoWebUrl: z.string().nullish(),
  submittedVideoUrl: z.string().nullish(),
})

const count = (n: number | null | undefined) => (n == null ? null : Math.max(0, Math.round(n)))

// ".../@handle/video/7600000000000000001?lang=en" → "7600000000000000001"
const videoId = (url: string | null | undefined) => url?.match(/\/video\/(\d+)/)?.[1] ?? null

export const tiktokComments: CommentsAdapter = {
  pricePerCommentUsd: 0.00125,

  call(posts, { perPost }) {
    return {
      actorId: env().APIFY_TIKTOK_COMMENTS_ACTOR,
      input: {
        postURLs: posts.map((p) => p.url),
        commentsPerPost: perPost,
        // Replies are mostly the creator answering; the question itself is the signal.
        maxRepliesPerComment: 0,
      },
      maxItems: posts.length * perPost,
    }
  },

  normalize(item) {
    const parsed = itemSchema.safeParse(item)
    if (!parsed.success) return null
    const v = parsed.data
    const platformPostId = videoId(v.videoWebUrl) ?? videoId(v.submittedVideoUrl)
    if (!platformPostId) return null

    const text = v.text?.trim()
    if (!text || v.repliesToId) return "skip"

    const postedAt = v.createTimeISO ? new Date(v.createTimeISO) : v.createTime ? new Date(v.createTime * 1000) : null
    return {
      kind: "comment",
      platformPostId,
      platformCommentId: v.cid,
      text: text.slice(0, 2000),
      authorHandle: v.uniqueId?.replace(/^@/, "").toLowerCase() ?? null,
      likes: count(v.diggCount),
      replies: count(v.replyCommentTotal),
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    }
  },
}
