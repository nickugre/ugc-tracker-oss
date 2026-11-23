import type { Platform } from "@/db/schema/enums"

export type NormalizedPost = {
  kind: "post"
  platformPostId: string
  url: string
  // Lowercase account handle without "@".
  handle: string
  caption: string | null
  postedAt: Date
  durationSec: number | null
  thumbnailUrl: string | null
  views: number
  // Which raw field `views` came from; stored on the snapshot for disputes.
  viewsSource: string
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  // The platform marked the video as an ad. A hint only: it suggests the Spark flag.
  sparkHint: boolean
  author: {
    id: string | null
    displayName: string | null
    followers: number | null
    avatarUrl: string | null
  }
  // The count fields exactly as returned, kept small on purpose.
  raw: Record<string, unknown>
}

export type NormalizedError = {
  kind: "error"
  // not_found = deleted or private video / profile; other = everything else.
  scope: "post" | "account" | "other"
  code: string
  message: string
  url: string | null
  handle: string | null
}

export type NormalizedItem = NormalizedPost | NormalizedError

export type ActorCall = {
  actorId: string
  input: Record<string, unknown>
  // Upper bound of dataset items this call can produce (used for the run's spending cap).
  maxItems: number
}

export type AccountRef = { handle: string; url: string }
export type PostRef = { platformPostId: string; url: string }

export type NormalizedComment = {
  kind: "comment"
  // The video it was written under.
  platformPostId: string
  platformCommentId: string
  text: string
  // Lowercase handle without "@".
  authorHandle: string | null
  likes: number | null
  replies: number | null
  postedAt: Date | null
}

// Comment text of specific posts, read for the Spark page.
export interface CommentsAdapter {
  // Price of one comment in USD (free-tier price), for budget estimates and the run's cap.
  pricePerCommentUsd: number
  call(posts: PostRef[], options: { perPost: number }): ActorCall
  // "skip" = understood but of no use (a reply, a sticker without text). null = could not be
  // read at all and is counted as drift, like PlatformAdapter.normalize.
  normalize(item: unknown): NormalizedComment | "skip" | null
}

export interface PlatformAdapter {
  platform: Platform
  // False for platforms that are selectable in campaigns but not scraped yet.
  enabled: boolean
  // Rough price of one result in USD, for budget estimates (free-tier prices).
  pricePerResultUsd: number
  // Newest posts of each profile. This also refreshes metrics of every post it returns.
  discovery(accounts: AccountRef[], options: { limitPerProfile: number; newerThan: Date | null }): ActorCall
  // Fresh metrics for specific posts (gap fill and the scrape at window close).
  metrics(posts: PostRef[], options: { atWindowClose: boolean }): ActorCall
  // Never throws: anything it cannot understand comes back as null and is counted as drift.
  normalize(item: unknown): NormalizedItem | null
  // Only on platforms where reading comment text is wired up.
  comments?: CommentsAdapter
}

export class NotImplementedError extends Error {}
