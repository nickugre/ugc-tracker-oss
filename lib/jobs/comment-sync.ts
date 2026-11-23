import "server-only"

import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import { accounts, postComments, posts, scrapeRuns } from "@/db/schema"
import { BudgetExceededError, startScrape } from "@/lib/ingest/start-run"
import { adapterFor } from "@/lib/scrapers/registry"
import { getSparkRules } from "@/lib/spark/settings"
import { SPARK_PLATFORM } from "@/lib/spark/suggest"

import { COMMENTS_PER_POST, MAX_POSTS_PER_DAY, MIN_COMMENTS_TO_READ, planCommentReads } from "./comment-plan"

const DAY_MS = 86_400_000
// "Today" and "not again within a day", measured with slack: the daily sync starts a few seconds
// later or earlier each day, and yesterday's run must never count as today's.
const SAME_DAY_MS = 20 * 3_600_000
// Older videos are not suggested on the Spark page either.
const LOOKBACK_DAYS = 30
// First read, one re-read when the comments have doubled, one spare for a read that came back empty.
const MAX_CHECKS = 3

// What reading comments has cost this calendar month (UTC). A run that has not reported its cost
// yet counts at its worst case, so a run still in progress cannot be spent twice.
export async function commentsSpendUsd(now: Date) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const worstCasePerPost = COMMENTS_PER_POST * (adapterFor(SPARK_PLATFORM).comments?.pricePerCommentUsd ?? 0)
  const [row] = await db
    .select({
      usd: sql<number>`coalesce(sum(case
        when ${scrapeRuns.costUsd} is not null then ${scrapeRuns.costUsd}
        when ${scrapeRuns.status} in ('queued', 'running', 'succeeded', 'ingesting')
          then coalesce(array_length(${scrapeRuns.requestedPostIds}, 1), 0) * ${worstCasePerPost}::float8
        else 0 end), 0)::float8`,
    })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.kind, "comments"), gte(scrapeRuns.startedAt, monthStart)))
  return row.usd
}

// A started read is remembered on the video right away, not when its results arrive: a run that
// fails on Apify's side must not be asked for again an hour later.
async function markChecked(postIds: string[], now: Date) {
  await db
    .update(posts)
    .set({
      commentsCheckedAt: now,
      commentsCheckedCount: sql`coalesce(${posts.currentComments}, 0)`,
      commentsChecks: sql`${posts.commentsChecks} + 1`,
    })
    .where(inArray(posts.id, postIds))
}

// Part of the daily sync. Reads the top comments of videos that could end up on the Spark page:
// enough views, a few comments, not boosted yet. Each video is read once, and once more when its
// comment count has doubled. Stops at the month's comment budget (Settings → Spark suggestions)
// and, like every routine scrape, at the overall Apify budget.
export async function commentSync(now: Date) {
  const summary = { candidates: 0, requested: 0, spentUsd: 0, budgetUsd: 0, skipped: null as string | null }
  const adapter = adapterFor(SPARK_PLATFORM).comments
  if (!adapter) return summary

  const rules = await getSparkRules()
  summary.budgetUsd = rules.commentsBudgetUsd
  summary.spentUsd = await commentsSpendUsd(now)

  const [today] = await db
    .select({ posts: sql<number>`coalesce(sum(array_length(${scrapeRuns.requestedPostIds}, 1)), 0)::int` })
    .from(scrapeRuns)
    .where(
      and(
        eq(scrapeRuns.kind, "comments"),
        eq(scrapeRuns.trigger, "cron"),
        gte(scrapeRuns.startedAt, new Date(now.getTime() - SAME_DAY_MS))
      )
    )

  const hasComments = sql`exists (select 1 from ${postComments} c where c.post_id = ${outerRef(posts.id)})`
  const candidates = await db
    .select({
      id: posts.id,
      platformPostId: posts.platformPostId,
      url: posts.url,
      currentComments: sql<number>`coalesce(${posts.currentComments}, 0)::float8`,
    })
    .from(posts)
    .innerJoin(accounts, eq(accounts.id, posts.accountId))
    .where(
      and(
        eq(posts.platform, SPARK_PLATFORM),
        eq(accounts.trackingEnabled, true),
        eq(posts.isExcluded, false),
        eq(posts.isAvailable, true),
        // Already boosted: nothing left to decide.
        eq(posts.isSpark, false),
        eq(posts.sparkHint, false),
        gte(posts.currentViews, rules.minViews),
        gte(posts.currentComments, MIN_COMMENTS_TO_READ),
        gte(posts.postedAt, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)),
        or(
          eq(posts.commentsChecks, 0),
          and(
            lt(posts.commentsChecks, MAX_CHECKS),
            lt(posts.commentsCheckedAt, new Date(now.getTime() - SAME_DAY_MS)),
            or(
              sql`not ${hasComments}`,
              sql`${posts.currentComments} >= greatest(2 * ${posts.commentsCheckedCount}, ${posts.commentsCheckedCount} + 10)`
            )
          )
        )
      )
    )
    .orderBy(desc(posts.currentComments), desc(posts.currentViews))
    .limit(50)
  summary.candidates = candidates.length

  const plan = planCommentReads(candidates, {
    remainingBudgetUsd: rules.commentsBudgetUsd - summary.spentUsd,
    remainingToday: MAX_POSTS_PER_DAY - today.posts,
    pricePerCommentUsd: adapter.pricePerCommentUsd,
  })
  if (plan.posts.length === 0) {
    if (candidates.length) {
      summary.skipped = today.posts >= MAX_POSTS_PER_DAY ? "daily limit reached" : "comment budget reached"
    }
    return summary
  }

  try {
    await startScrape({
      platform: SPARK_PLATFORM,
      kind: "comments",
      trigger: "cron",
      triggeredBy: null,
      now,
      commentsOf: plan.posts,
      perPost: COMMENTS_PER_POST,
    })
  } catch (error) {
    if (!(error instanceof BudgetExceededError)) throw error
    summary.skipped = error.message
    return summary
  }
  await markChecked(plan.posts.map((p) => p.id), now)
  summary.requested = plan.posts.length
  return summary
}

// "Read comments now" on a video, started by a person: no daily limit and no budget check, it
// is one video and they asked for it.
export async function readCommentsNow(postId: string, userId: string | null, now: Date) {
  const [post] = await db
    .select({ id: posts.id, platform: posts.platform, platformPostId: posts.platformPostId, url: posts.url })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1)
  if (!post) return null

  const run = await startScrape({
    platform: post.platform,
    kind: "comments",
    trigger: "manual",
    triggeredBy: userId,
    now,
    commentsOf: [post],
    perPost: COMMENTS_PER_POST,
  })
  await markChecked([post.id], now)
  return run
}
