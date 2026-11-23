import { describe, expect, it, vi } from "vitest"

import { tiktokComments } from "../tiktok-comments"

// Only the actor name is read from the environment.
vi.mock("@/lib/env", () => ({ env: () => ({ APIFY_TIKTOK_COMMENTS_ACTOR: "clockworks/tiktok-comments-scraper" }) }))

// Shaped like an item of `clockworks/tiktok-comments-scraper`.
const item = (patch: Record<string, unknown> = {}) => ({
  cid: "7680000000000000001",
  text: " What app is this?? ",
  createTimeISO: "2026-09-02T10:00:00.000Z",
  diggCount: 12,
  replyCommentTotal: 1,
  uid: "6700000000000000001",
  uniqueId: "SomeViewer",
  repliesToId: null,
  videoWebUrl: "https://www.tiktok.com/@creator/video/7600000000000000001",
  submittedVideoUrl: "https://www.tiktok.com/@creator/video/7600000000000000001",
  ...patch,
})

describe("tiktokComments.normalize", () => {
  it("reads a comment and ties it to its video", () => {
    expect(tiktokComments.normalize(item())).toEqual({
      kind: "comment",
      platformPostId: "7600000000000000001",
      platformCommentId: "7680000000000000001",
      text: "What app is this??",
      authorHandle: "someviewer",
      likes: 12,
      replies: 1,
      postedAt: new Date("2026-09-02T10:00:00.000Z"),
    })
  })

  it("falls back to the submitted URL for the video id", () => {
    const parsed = tiktokComments.normalize(item({ videoWebUrl: null }))
    expect(parsed).toMatchObject({ platformPostId: "7600000000000000001" })
  })

  it("skips replies and comments without text", () => {
    expect(tiktokComments.normalize(item({ repliesToId: "7680000000000000000" }))).toBe("skip")
    expect(tiktokComments.normalize(item({ text: "   " }))).toBe("skip")
    expect(tiktokComments.normalize(item({ text: null }))).toBe("skip")
  })

  it("returns null for anything that is not a comment", () => {
    expect(tiktokComments.normalize({ error: "Video not found" })).toBeNull()
    expect(tiktokComments.normalize(item({ videoWebUrl: null, submittedVideoUrl: "https://example.com" }))).toBeNull()
    expect(tiktokComments.normalize(null)).toBeNull()
  })
})

describe("tiktokComments.call", () => {
  it("asks for top-level comments only and bounds the run", () => {
    const call = tiktokComments.call(
      [
        { platformPostId: "1", url: "https://www.tiktok.com/@a/video/1" },
        { platformPostId: "2", url: "https://www.tiktok.com/@a/video/2" },
      ],
      { perPost: 30 }
    )
    expect(call.actorId).toBe("clockworks/tiktok-comments-scraper")
    expect(call.input).toMatchObject({ commentsPerPost: 30, maxRepliesPerComment: 0 })
    expect(call.maxItems).toBe(60)
  })
})
