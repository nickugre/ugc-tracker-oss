import "server-only"

import { eq, inArray, sql } from "drizzle-orm"

import { db } from "@/db"
import { accounts, postComments, posts, type scrapeRuns } from "@/db/schema"
import { getDatasetItems } from "@/lib/apify/client"
import { adapterFor } from "@/lib/scrapers/registry"
import type { NormalizedComment } from "@/lib/scrapers/types"

// Stores the comments of a finished `comments` run. Called by ingestRun() once it has claimed the
// run, so it shares that function's idempotency; every write is an upsert on (post, comment id).
export async function ingestComments(run: typeof scrapeRuns.$inferSelect, datasetId: string, finishedAt: Date) {
  const adapter = adapterFor(run.platform).comments
  if (!adapter) throw new Error(`No comments adapter for ${run.platform}`)

  const rawItems = await getDatasetItems(datasetId)
  const normalized = rawItems.map((item) => adapter.normalize(item))
  const unparsed = normalized.filter((n) => n === null).length
  // Same guard as for videos: if most items no longer look like comments, the actor changed.
  if (rawItems.length > 0 && unparsed / rawItems.length > 0.5) {
    throw new Error(`schema_drift: ${unparsed} of ${rawItems.length} comments could not be read`)
  }
  const found = normalized.filter((n): n is NormalizedComment => n !== null && n !== "skip")

  const requested = run.requestedPostIds?.length
    ? await db
        .select({ id: posts.id, platformPostId: posts.platformPostId, handle: accounts.handle })
        .from(posts)
        .innerJoin(accounts, eq(accounts.id, posts.accountId))
        .where(inArray(posts.id, run.requestedPostIds))
    : []
  const byPlatformId = new Map(requested.map((p) => [p.platformPostId, p]))

  // A comment listed twice would make the upsert below fail ("cannot affect row a second time").
  const seen = new Set<string>()
  const rows = found.flatMap((comment) => {
    const post = byPlatformId.get(comment.platformPostId)
    // The creator's own "link in bio!" says nothing about the audience.
    if (!post || comment.authorHandle === post.handle) return []
    const key = `${post.id}:${comment.platformCommentId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        postId: post.id,
        platformCommentId: comment.platformCommentId,
        text: comment.text,
        authorHandle: comment.authorHandle,
        likes: comment.likes,
        replies: comment.replies,
        postedAt: comment.postedAt,
        fetchedAt: finishedAt,
        sourceRunId: run.id,
      },
    ]
  })

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(postComments)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [postComments.postId, postComments.platformCommentId],
        set: {
          text: sql`excluded.text`,
          likes: sql`excluded.likes`,
          replies: sql`excluded.replies`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      })
  }

  return { items: rawItems.length, stored: rows.length, errors: unparsed }
}
