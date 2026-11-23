// Dev helper: re-scrapes the newest videos of one tracked TikTok account by URL and prints every
// snapshot, to compare the precision of the per-video mode with the profile listing.
//   pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/dev/precision-check.ts <handle>
import { and, desc, eq } from "drizzle-orm"

import { db } from "../../db"
import { accounts, postSnapshots, posts } from "../../db/schema"
import { ingestRun } from "../../lib/ingest/ingest-run"
import { startScrape } from "../../lib/ingest/start-run"

async function main() {
  const handle = process.argv[2] ?? "tiktok"
  const rows = await db
    .select({ id: posts.id, platformPostId: posts.platformPostId, url: posts.url })
    .from(posts)
    .innerJoin(accounts, eq(accounts.id, posts.accountId))
    .where(and(eq(accounts.handle, handle), eq(posts.platform, "tiktok")))
    .orderBy(desc(posts.postedAt))
    .limit(2)
  if (rows.length === 0) throw new Error(`No TikTok videos tracked for @${handle}`)

  const run = await startScrape({
    platform: "tiktok",
    kind: "metrics",
    trigger: "manual",
    triggeredBy: null,
    now: new Date(),
    posts: rows,
  })
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const result = await ingestRun(run.id)
    if (result.state !== "running") {
      console.log("ingest:", JSON.stringify(result))
      break
    }
  }
  for (const row of rows) {
    const snapshots = await db
      .select({ kind: postSnapshots.kind, views: postSnapshots.views, likes: postSnapshots.likes })
      .from(postSnapshots)
      .where(eq(postSnapshots.postId, row.id))
      .orderBy(postSnapshots.capturedAt)
    console.log(row.platformPostId, snapshots.map((s) => `${s.kind}: views=${s.views} likes=${s.likes}`).join("  |  "))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
