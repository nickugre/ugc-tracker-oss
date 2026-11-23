// Which videos get their comments read in one go. Pure, so the money rules can be tested.

// The top comments are where "what app is this?" ends up; more would cost more and add little.
export const COMMENTS_PER_POST = 30
// A video with a couple of comments has nothing to read yet.
export const MIN_COMMENTS_TO_READ = 3
// Bounds the first day after the feature is switched on, when every recent video is a candidate.
export const MAX_POSTS_PER_DAY = 10

export type CommentCandidate = { id: string; currentComments: number }

// Candidates arrive most-commented first. Apify charges per comment returned, so a video costs
// at most `min(its comments, COMMENTS_PER_POST)` comments; videos are taken in order while both
// the day's allowance and the month's comment budget last.
export function planCommentReads<T extends CommentCandidate>(
  candidates: T[],
  limits: { remainingBudgetUsd: number; remainingToday: number; pricePerCommentUsd: number }
): { posts: T[]; estimatedUsd: number } {
  const picked: T[] = []
  let estimatedUsd = 0
  for (const candidate of candidates) {
    if (picked.length >= limits.remainingToday) break
    const cost = Math.min(candidate.currentComments, COMMENTS_PER_POST) * limits.pricePerCommentUsd
    if (estimatedUsd + cost > limits.remainingBudgetUsd) continue
    picked.push(candidate)
    estimatedUsd += cost
  }
  return { posts: picked, estimatedUsd }
}
