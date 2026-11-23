import type { Platform } from "@/db/schema/enums"

import { DEFAULT_KEYWORDS, keywordMatcher } from "./keywords"

// Spark codes are a TikTok feature, so only TikTok videos are suggested and have comments read.
export const SPARK_PLATFORM = "tiktok" satisfies Platform

// The rule behind "Spark these videos". A video is worth boosting when people react to it far
// more than usual (engagement), or when its comments ask about the app, which is the clearest
// sign that it converts. The second reason is enough on its own: a video with a modest
// engagement rate whose comments say "what app is this?" still belongs on the list.
export type SparkRules = {
  keywords: string[]
  // Ratio, 0.1 = 10%.
  minEngagement: number
  // Below this a rate means little: 10% of 80 views is eight people.
  minViews: number
  minAppComments: number
  commentsBudgetUsd: number
}

export const DEFAULT_SPARK_RULES: SparkRules = {
  keywords: DEFAULT_KEYWORDS,
  minEngagement: 0.1,
  minViews: 1000,
  // One is enough: videos at this scale get a handful of comments (one with 20K views can have six,
  // one of them "what app is this"), and the page quotes the comment so a false alarm is obvious.
  minAppComments: 1,
  commentsBudgetUsd: 1.5,
}

export type SparkReason = "engagement" | "app_comments"

export type SparkCandidate = { id: string; views: number; engagementRate: number | null }
export type SparkComment = { text: string; likes: number | null }
export type AppComment = SparkComment & { keywords: string[] }

export type SparkSuggestion<T extends SparkCandidate> = T & {
  reasons: SparkReason[]
  // Comments that matched a keyword, most liked first.
  appComments: AppComment[]
  // How many of the video's comments have been read at all (0 = not read yet).
  commentsRead: number
}

export function rankSuggestions<T extends SparkCandidate>(
  candidates: T[],
  commentsByPost: Map<string, SparkComment[]>,
  rules: SparkRules
): SparkSuggestion<T>[] {
  const match = keywordMatcher(rules.keywords)
  const suggestions: SparkSuggestion<T>[] = []

  for (const candidate of candidates) {
    if (candidate.views < rules.minViews) continue
    const comments = commentsByPost.get(candidate.id) ?? []
    const appComments = comments
      .map((comment) => ({ ...comment, keywords: match(comment.text) }))
      .filter((comment) => comment.keywords.length > 0)
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))

    const reasons: SparkReason[] = []
    if (candidate.engagementRate != null && candidate.engagementRate >= rules.minEngagement) reasons.push("engagement")
    if (appComments.length >= Math.max(1, rules.minAppComments)) reasons.push("app_comments")
    if (reasons.length === 0) continue

    suggestions.push({ ...candidate, reasons, appComments, commentsRead: comments.length })
  }

  // Both reasons first, then the videos people ask about most, then by engagement.
  return suggestions.sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      b.appComments.length - a.appComments.length ||
      (b.engagementRate ?? 0) - (a.engagementRate ?? 0) ||
      b.views - a.views
  )
}
