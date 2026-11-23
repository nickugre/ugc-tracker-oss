// Dev helper: reads the comments of one REAL TikTok video through Apify and shows what the Spark
// page would make of them. Proves the comments actor still returns what lib/scrapers/
// tiktok-comments.ts expects. Costs up to ~4 cents (30 comments). Local database only: it adds a
// throwaway account + video and removes them again; the scrape run stays as the spend record.
//   pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/dev/e2e-comments.ts <tiktok video url>
import { eq } from "drizzle-orm"

import { db } from "../../db"
import { accounts, postComments, posts, scrapeRuns } from "../../db/schema"
import { ingestRun } from "../../lib/ingest/ingest-run"
import { readCommentsNow } from "../../lib/jobs/comment-sync"
import { keywordMatcher } from "../../lib/spark/keywords"
import { getSparkRules } from "../../lib/spark/settings"
import { computeWindowEndsAt } from "../../lib/windows/window"

async function main() {
  const url = process.argv[2]
  const match = url?.match(/tiktok\.com\/@([^/]+)\/video\/(\d+)/)
  if (!match) throw new Error("Usage: e2e-comments.ts https://www.tiktok.com/@handle/video/<id>")
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("Local database only.")
  const [, handle, videoId] = match

  const postedAt = new Date(Date.now() - 86_400_000)
  const [account] = await db
    .insert(accounts)
    .values({ platform: "tiktok", handle: `e2e-comments-${Date.now()}`, url: `https://www.tiktok.com/@${handle}`, trackingEnabled: false })
    .returning()
  try {
    const [post] = await db
      .insert(posts)
      .values({
        accountId: account.id,
        platform: "tiktok",
        platformPostId: videoId,
        url,
        postedAt,
        windowDays: 14,
        windowEndsAt: computeWindowEndsAt(postedAt, 14),
      })
      .returning()

    const run = await readCommentsNow(post.id, null, new Date())
    if (!run) throw new Error("The video vanished before the run started")
    console.log("Apify run", run.apifyRunId, "started…")
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const result = await ingestRun(run.id)
      if (result.state !== "running") {
        console.log("ingest:", JSON.stringify(result))
        break
      }
    }

    const rules = await getSparkRules()
    const matcher = keywordMatcher(rules.keywords)
    const rows = await db.select().from(postComments).where(eq(postComments.postId, post.id))
    for (const row of rows.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))) {
      const keywords = matcher(row.text)
      console.log(`${keywords.length ? "APP " : "    "}♥${String(row.likes ?? 0).padStart(5)}  @${row.authorHandle}  ${row.text.slice(0, 110).replaceAll("\n", " ")}${keywords.length ? `   ← ${keywords.join(", ")}` : ""}`)
    }
    const about = rows.filter((r) => matcher(r.text).length).length
    const [checked] = await db.select().from(posts).where(eq(posts.id, post.id))
    const [stored] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, run.id))
    console.log(`\n${rows.length} comments stored, ${about} about the app (needs ${rules.minAppComments} to be suggested).`)
    console.log(`post: checks=${checked.commentsChecks} checkedAt=${checked.commentsCheckedAt?.toISOString()}`)
    console.log(`run: status=${stored.status} items=${stored.itemsCount} cost so far=$${stored.costUsd ?? "?"} (final cost arrives a few minutes later)`)
  } finally {
    // Comments go with the video (ON DELETE CASCADE).
    await db.delete(posts).where(eq(posts.accountId, account.id))
    await db.delete(accounts).where(eq(accounts.id, account.id))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
