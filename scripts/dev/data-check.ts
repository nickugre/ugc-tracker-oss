// Read-only: compares every stored video with what Apify returned for the run it came from, and
// prints what the payout engine makes of the current cycle. Nothing is written.
//   tsx --conditions=react-server --env-file=.env.hosted scripts/dev/data-check.ts
import { and, desc, eq, isNotNull } from "drizzle-orm"

import { db } from "@/db"
import { accounts, campaigns, posts, postSnapshots, scrapeRuns } from "@/db/schema"
import { getDatasetItems } from "@/lib/apify/client"
import { startOfLocalDay } from "@/lib/payouts/cycles"
import { getCycleView } from "@/lib/payouts/service"
import { adapterFor } from "@/lib/scrapers/registry"

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

async function main() {
  console.log("database:", new URL(process.env.DATABASE_URL!).host)
  const now = new Date()

  // ---- 1) Stored videos against the Apify datasets they came from -------------------------
  const runs = await db
    .select()
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.status, "ingested"), isNotNull(scrapeRuns.apifyDatasetId)))
    .orderBy(desc(scrapeRuns.startedAt))
  const allAccounts = await db
    .select({ account: accounts, campaign: campaigns })
    .from(accounts)
    .leftJoin(campaigns, eq(campaigns.id, accounts.campaignId))
  const stored = await db.select().from(posts)
  const storedByKey = new Map(stored.map((p) => [`${p.platform}:${p.platformPostId}`, p]))
  const seen = new Set<string>()

  for (const run of runs) {
    const owners = allAccounts.filter((a) => run.requestedAccountIds?.includes(a.account.id))
    if (!owners.length) continue // accounts deleted since
    const adapter = adapterFor(run.platform)
    const items = (await getDatasetItems(run.apifyDatasetId!)).map((i) => adapter.normalize(i))
    const found = items.flatMap((i) => (i?.kind === "post" ? [i] : []))
    const unreadable = items.filter((i) => i === null).length

    let expected = 0
    let tooOld = 0
    const problems: string[] = []
    for (const item of found) {
      const owner = owners.find((o) => o.account.handle === item.handle)
      if (!owner) {
        problems.push(`item from @${item.handle}, not an account of this run`)
        continue
      }
      const cut = owner.account.trackFrom
        ? startOfLocalDay(owner.account.trackFrom, owner.campaign?.timezone ?? "UTC")
        : null
      if (cut && item.postedAt < cut) {
        tooOld++
        if (storedByKey.has(`${run.platform}:${item.platformPostId}`)) problems.push(`${item.url} is older than track_from but stored`)
        continue
      }
      expected++
      const key = `${run.platform}:${item.platformPostId}`
      const post = storedByKey.get(key)
      if (!post) {
        problems.push(`${item.url} is missing from the database`)
        continue
      }
      seen.add(key)
      const [snapshot] = await db
        .select()
        .from(postSnapshots)
        .where(and(eq(postSnapshots.postId, post.id), eq(postSnapshots.sourceRunId, run.id)))
        .limit(1)
      if (!snapshot) problems.push(`${item.url} has no snapshot from this run`)
      else if (snapshot.views !== item.views) problems.push(`${item.url} views ${snapshot.views} ≠ Apify ${item.views}`)
      else if (snapshot.likes !== item.likes) problems.push(`${item.url} likes ${snapshot.likes} ≠ Apify ${item.likes}`)
      if (post.postedAt.getTime() !== item.postedAt.getTime()) problems.push(`${item.url} posted_at differs`)
      if (post.accountId !== owner.account.id) problems.push(`${item.url} is attached to another account`)
      if (post.campaignId !== owner.account.campaignId) problems.push(`${item.url} has another campaign`)
      if (post.creatorId !== owner.account.creatorId) problems.push(`${item.url} has another creator`)
      const windowMs = post.windowEndsAt.getTime() - post.postedAt.getTime()
      if (windowMs !== post.windowDays * 86_400_000) problems.push(`${item.url} window is not ${post.windowDays} days`)
    }
    console.log(
      `\n${run.platform} ${run.kind} run: Apify returned ${items.length} items, ${unreadable} unreadable, ` +
        `${tooOld} older than the tracking date, ${expected} expected in the database`
    )
    console.log(problems.length ? problems.map((p) => `  PROBLEM ${p}`).join("\n") : "  every expected video is stored with identical numbers")
  }
  const orphans = stored.filter((p) => !seen.has(`${p.platform}:${p.platformPostId}`))
  console.log(`\nstored videos: ${stored.length}; not traceable to an Apify run: ${orphans.length}`)

  // TikTok's scraper rounds large counts the way the app displays them (12.3K, 1.2M).
  const rounded = stored.filter((p) => p.platform === "tiktok" && (p.currentViews ?? 0) >= 10_000)
  console.log(
    `TikTok videos above 10K views (display-rounded by the scraper): ${rounded.length}: ` +
      rounded.map((p) => p.currentViews).sort((a, b) => b! - a!).join(", ")
  )

  // ---- 2) What the payout engine makes of the current cycle --------------------------------
  for (const { id, name } of await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns)) {
    const view = await getCycleView(id, null, now)
    if (!view) continue
    console.log(`\n=== ${name}: cycle ${view.cycle.periodStart} → ${view.cycle.periodEnd} (${view.status}), payday ${view.payday}`)
    for (const line of view.lines) {
      const p = line.payout
      console.log(
        `${line.creatorName}: base ${usd(p.baseCents)} (delivered ${p.postsDelivered}/${p.quota}, published ${JSON.stringify(p.publishedByPlatform)}, counted ${JSON.stringify(p.deliveredByPlatform)})` +
          ` + bonus ${usd(p.bonusCents)} (tier ${p.tier ? p.tier.views : "none"}, ${line.bonusPosts.length} locked videos) = ${usd(p.totalCents)}`
      )
    }
    console.log(`totals: base ${usd(view.totals.baseCents)} bonus ${usd(view.totals.bonusCents)} total ${usd(view.totals.totalCents)}`)
    const tally = (list: typeof view.blocked) =>
      Object.entries(list.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.reason]: (acc[p.reason] ?? 0) + 1 }), {}))
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "none"
    console.log(`blocking finalize: ${view.blocked.length} (${tally(view.blocked)}); held for a later cycle: ${view.held.length} (${tally(view.held)})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
