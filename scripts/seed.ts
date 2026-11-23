// Fills the LOCAL database with realistic demo data so every screen and the payout maths can be
// checked without Apify: 2 campaigns, 8 creators, 16 accounts, ~200 posts with daily snapshots on
// an S-curve, Spark'd posts with paid views, excluded / needs-review / unavailable cases, and
// posts whose window closes in the next 48 hours.
//
//   pnpm db:seed            (refuses to touch a non-local database)
//   pnpm db:seed -- --force (really run against whatever DATABASE_URL points at)

import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"

import { db } from "../db"
import {
  accounts,
  campaignCreators,
  campaigns,
  creators,
  postComments,
  postDailyMetrics,
  postSnapshots,
  posts,
  profiles,
  scrapeRuns,
  tiktokAdDailyStats,
  tiktokAds,
  type Platform,
} from "../db/schema"
import { CONTRACT_MILESTONES, DEFAULT_USAGE_RIGHTS } from "../lib/validation/campaign"
import { computeLockedViews, paidViewsInWindow } from "../lib/windows/lock"
import { computeWindowEndsAt, DAY_MS } from "../lib/windows/window"

const HOUR_MS = 3_600_000
const NOW = new Date()

// Deterministic pseudo-random numbers so every seed run produces the same shape of data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20260921)
const between = (min: number, max: number) => min + rand() * (max - min)
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)]

// Final view counts are heavy-tailed: most videos get a few thousand views, a few go viral.
function finalViews(): number {
  const r = rand()
  if (r < 0.55) return Math.round(between(800, 9_000))
  if (r < 0.82) return Math.round(between(9_000, 45_000))
  if (r < 0.94) return Math.round(between(45_000, 160_000))
  if (r < 0.985) return Math.round(between(160_000, 700_000))
  return Math.round(between(700_000, 1_600_000))
}

// Share of the final views reached `hours` after posting (fast start, long tail).
function curve(hours: number, tauHours: number) {
  return 1 - Math.exp(-Math.max(0, hours) / tauHours)
}

// Comments for the Spark page. A stream of its own, so adding them left every other seeded
// number exactly as it was.
const commentRand = mulberry32(20260922)
const APP_COMMENTS = [
  "what app is this??",
  "APP NAME PLS 🙏",
  "link?",
  "is it free?",
  "where can I get this",
  "just downloaded it, thank you!!",
  "is it on android too",
  "whats this called",
  "need the link 😭",
  "downloading rn",
]
const OTHER_COMMENTS = [
  "this is so me",
  "not me doing the exact opposite 💀",
  "love this",
  "okay but the outfit",
  "first",
  "so real",
  "saving this for later",
  "my bank account could never",
  "girl same",
  "needed to hear this today",
  "the way I gasped",
  "part 2 please",
]

const CAPTIONS = [
  "this is wild 😭 #moneytok #budgeting",
  "you really don't need all that stuff #underconsumption #savemoney",
  "how i saved $400 this month #frugalliving",
  "POV: you finally check your subscriptions #finances",
  "rent is due and i'm calm for once #lifeinyour20s",
  "the savings hack nobody told me about #genzfinance",
  "my no-spend week, day 3 #costofliving",
  "things i stopped buying in 2026 #minimalism",
]

const CREATORS = [
  { name: "Maya Collins", country: "United States", email: "maya@example.com" },
  { name: "Jordan Reyes", country: "United States", email: "jordan@example.com" },
  { name: "Aiko Tanaka", country: "Canada", email: "aiko@example.com" },
  { name: "Lena Fischer", country: "Germany", email: "lena@example.com" },
  { name: "Sam Okafor", country: "United Kingdom", email: "sam@example.com" },
  { name: "Priya Nair", country: "United States", email: "priya@example.com" },
  { name: "Diego Alvarez", country: "Mexico", email: "diego@example.com" },
  { name: "Chloe Martin", country: "France", email: "chloe@example.com" },
]

function firstOfMonthUtc(monthsAgo: number) {
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - monthsAgo, 1))
  return d.toISOString().slice(0, 10)
}

async function insertChunked<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size))
}

async function main() {
  const url = process.env.DATABASE_URL ?? ""
  const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(url)
  if (!isLocal && !process.argv.includes("--force")) {
    console.error("Refusing to seed: DATABASE_URL is not a local database. Pass --force to override.")
    process.exit(1)
  }

  console.log("Clearing existing data…")
  await db.execute(sql`
    truncate table payout_items, payout_lines, payout_adjustments, payout_cycles,
      post_comments, post_daily_metrics, post_snapshots, posts, tiktok_ad_daily_stats, tiktok_ads,
      scrape_runs, job_runs, job_locks, accounts, campaign_creators, campaigns, creators, audit_log
    restart identity cascade
  `)

  const [core, cpm] = await db
    .insert(campaigns)
    .values([
      {
        name: "Acme UGC — Core",
        status: "active",
        startDate: firstOfMonthUtc(2),
        timezone: "America/New_York",
        platforms: ["tiktok", "instagram"],
        quotaCount: 60,
        quotaPeriod: "month",
        quotaScope: "per_platform",
        defaultWindowDays: 14,
        baseType: "monthly_retainer",
        baseAmountCents: 100_000,
        prorateBase: true,
        bonusType: "milestone",
        milestones: CONTRACT_MILESTONES,
        milestoneScope: "creator_cycle_best",
        perCreatorCycleCapCents: 100_000,
        usageRightsNote: DEFAULT_USAGE_RIGHTS,
        cycleType: "monthly",
      },
      {
        name: "Acme CPM Test",
        status: "active",
        startDate: firstOfMonthUtc(1),
        timezone: "America/Los_Angeles",
        platforms: ["tiktok", "instagram"],
        quotaCount: 20,
        quotaPeriod: "month",
        quotaScope: "total",
        defaultWindowDays: 14,
        baseType: "per_video",
        baseAmountCents: 1_500,
        bonusType: "cpm",
        cpmRateCents: 300,
        minViewsForBonus: 10_000,
        cpmMinViewsMode: "qualify",
        perVideoBonusCapCents: 50_000,
        usageRightsNote: DEFAULT_USAGE_RIGHTS,
        cycleType: "monthly",
      },
    ])
    .returning()

  const creatorRows = await db
    .insert(creators)
    .values(
      CREATORS.map((c, i) => ({
        ...c,
        contactHandle: `@${c.name.split(" ")[0].toLowerCase()}`,
        paymentDetails: i % 2 === 0 ? `PayPal: ${c.email}` : `Wise: ${c.email}`,
        status: i === 7 ? ("paused" as const) : ("active" as const),
      }))
    )
    .returning()

  // Creators 0–5 work on the core contract, 6–7 on the CPM test. Jordan negotiated a higher base.
  await db.insert(campaignCreators).values(
    creatorRows.map((creator, i) => ({
      campaignId: i < 6 ? core.id : cpm.id,
      creatorId: creator.id,
      baseAmountCentsOverride: i === 1 ? 120_000 : null,
    }))
  )

  const accountValues = creatorRows.flatMap((creator, i) => {
    const slug = creator.name.split(" ")[0].toLowerCase()
    const campaign = i < 6 ? core : cpm
    return (["tiktok", "instagram"] as Platform[]).map((platform) => ({
      id: randomUUID(),
      platform,
      handle: `acme.${slug}`,
      url:
        platform === "tiktok"
          ? `https://www.tiktok.com/@acme.${slug}`
          : `https://www.instagram.com/acme.${slug}/`,
      displayName: `Acme × ${creator.name.split(" ")[0]}`,
      followerCount: Math.round(between(1_200, 85_000)),
      creatorId: creator.id,
      campaignId: campaign.id,
      trackFrom: campaign.startDate,
      trackingEnabled: i !== 7,
      lastScrapedAt: new Date(NOW.getTime() - between(1, 9) * HOUR_MS),
      lastSuccessAt: new Date(NOW.getTime() - between(1, 9) * HOUR_MS),
      windowDays: campaign.defaultWindowDays,
      postsPerDay: i < 6 ? between(0.22, 0.4) : between(0.12, 0.2),
    }))
  })
  // One account is in an error state so the Accounts page has something to show.
  await db.insert(accounts).values(
    accountValues.map((a, i) => ({
      id: a.id,
      platform: a.platform,
      handle: a.handle,
      url: a.url,
      displayName: a.displayName,
      followerCount: a.followerCount,
      creatorId: a.creatorId,
      campaignId: a.campaignId,
      trackFrom: a.trackFrom,
      backfillPending: false,
      trackingEnabled: a.trackingEnabled,
      lastScrapedAt: a.lastScrapedAt,
      lastSuccessAt: a.lastSuccessAt,
      scrapeStatus: i === 5 ? ("error" as const) : ("ok" as const),
      scrapeError: i === 5 ? "PROFILE_PRIVATE: the profile is private or does not exist" : null,
      consecutiveFailures: i === 5 ? 3 : 0,
    }))
  )

  const [seedRun] = await db
    .insert(scrapeRuns)
    .values({
      platform: "tiktok",
      actorId: "seed",
      kind: "discovery",
      trigger: "manual",
      status: "ingested",
      itemsCount: 0,
      startedAt: NOW,
      apifyFinishedAt: NOW,
      ingestedAt: NOW,
    })
    .returning()

  type PostRow = typeof posts.$inferInsert
  type SnapshotRow = typeof postSnapshots.$inferInsert
  type DailyRow = typeof postDailyMetrics.$inferInsert
  const postRows: PostRow[] = []
  const snapshotRows: SnapshotRow[] = []
  const dailyRows: DailyRow[] = []
  const adRows: (typeof tiktokAds.$inferInsert)[] = []
  const adStatRows: (typeof tiktokAdDailyStats.$inferInsert)[] = []

  let postIndex = 0
  let snapshotId = 0
  for (const account of accountValues) {
    for (let day = 44; day >= 0; day--) {
      if (rand() > account.postsPerDay) continue
      postIndex++
      const id = randomUUID()
      const postedAt = new Date(NOW.getTime() - day * DAY_MS - between(1, 20) * HOUR_MS)
      const windowEndsAt = computeWindowEndsAt(postedAt, account.windowDays)
      const closed = windowEndsAt.getTime() <= NOW.getTime()
      const isTikTok = account.platform === "tiktok"
      const platformPostId = isTikTok
        ? `76${String(10 ** 16 + postIndex * 7_919_003).slice(0, 17)}`
        : `D${(postIndex * 2_654_435_761).toString(36).toUpperCase().slice(0, 10)}`

      const special = postIndex % 41 === 0 ? "late" : postIndex % 37 === 0 ? "decreased" : null
      const isSpark = isTikTok && closed && postIndex % 23 === 0
      const organicFinal = finalViews()
      const tau = between(30, 110)
      const paidTotal = isSpark ? Math.round(between(30_000, 140_000)) : 0
      const sparkStart = new Date(postedAt.getTime() + between(2, 6) * DAY_MS)

      const viewsAt = (t: Date) => {
        const hours = (t.getTime() - postedAt.getTime()) / HOUR_MS
        const organic = organicFinal * curve(hours, tau)
        const paidHours = (t.getTime() - sparkStart.getTime()) / HOUR_MS
        const paid = paidTotal * Math.min(1, Math.max(0, paidHours / (5 * 24)))
        return Math.round(organic + paid)
      }

      // Daily scrapes at 06:00 UTC, plus a targeted scrape shortly after the window closes.
      const times: Date[] = []
      const firstScrape = new Date(postedAt)
      firstScrape.setUTCHours(6, 0, 0, 0)
      if (firstScrape <= postedAt) firstScrape.setTime(firstScrape.getTime() + DAY_MS)
      const lastDaily = Math.min(NOW.getTime(), windowEndsAt.getTime())
      for (let t = firstScrape.getTime(); t <= lastDaily; t += DAY_MS) times.push(new Date(t))
      const closeScrape = new Date(windowEndsAt.getTime() + between(20, 55) * 60_000)
      if (closed && closeScrape <= NOW) times.push(closeScrape)
      // "late": the account was added after the window ended, so only post-close data exists.
      const kept = special === "late" ? times.filter((t) => t > windowEndsAt) : times
      if (kept.length === 0) continue

      const likeRate = between(0.04, 0.12)
      const commentRate = between(0.002, 0.01)
      const shareRate = between(0.003, 0.02)
      const saveRate = between(0.005, 0.03)
      const points = kept.map((capturedAt, i) => {
        let views = viewsAt(capturedAt)
        // "decreased": the platform removed views between the last two scrapes.
        if (special === "decreased" && i === kept.length - 1) views = Math.round(views * 0.93)
        return { id: ++snapshotId, capturedAt, views }
      })
      for (const point of points) {
        const v = point.views
        const shares = isTikTok ? Math.round(v * shareRate) : null
        const saves = isTikTok ? Math.round(v * saveRate) : null
        const likes = Math.round(v * likeRate)
        const comments = Math.round(v * commentRate)
        snapshotRows.push({
          postId: id,
          capturedAt: point.capturedAt,
          views: v,
          likes,
          comments,
          shares,
          saves,
          engagementRate: v ? (likes + comments + (shares ?? 0) + (saves ?? 0)) / v : null,
          virality: v && shares != null ? shares / v : null,
          kind: point.capturedAt > windowEndsAt ? "window_close" : "seed",
          sourceRunId: null,
          viewsSource: isTikTok ? "playCount" : "videoPlayCount",
        })
      }

      // Daily rollup: last value of each UTC day + that day's gain.
      const byDay = new Map<string, number>()
      for (const p of points) byDay.set(p.capturedAt.toISOString().slice(0, 10), p.views)
      // A video first seen long after it was posted arrives with its whole history in one
      // number. That is not a gain of that day, so the first day then counts as zero.
      const seenLate = points[0].capturedAt.getTime() - postedAt.getTime() > 2 * DAY_MS
      let previous = seenLate ? points[0].views : 0
      for (const [dayKey, views] of byDay) {
        dailyRows.push({ postId: id, day: dayKey, views, viewsDelta: Math.max(0, views - previous) })
        previous = views
      }

      const last = points[points.length - 1]
      const dayAgo = points.filter((p) => p.capturedAt.getTime() <= last.capturedAt.getTime() - DAY_MS).pop()
      const lock = closed ? computeLockedViews(points, windowEndsAt) : null

      let paidViewsSynced: number | null = null
      if (isSpark) {
        const adId = `18753${String(60_000_000_000 + postIndex * 104_729)}`
        adRows.push({
          adId,
          advertiserId: "7000000000000000001",
          adName: `${pick(CAPTIONS).slice(0, 40)} _Spark`,
          tiktokItemId: platformPostId,
          identityType: "AUTH_CODE",
          postId: id,
          adCreateTime: sparkStart,
        })
        const daily: { statDate: string; views: number }[] = []
        for (let d = 0; d < 5; d++) {
          const statDate = new Date(sparkStart.getTime() + d * DAY_MS).toISOString().slice(0, 10)
          const views = Math.round(paidTotal / 5)
          daily.push({ statDate, views })
          adStatRows.push({
            adId,
            statDate,
            advertiserTimezone: "America/New_York",
            videoViews: views,
            impressions: Math.round(views * 1.004),
            spend: Math.round(views * 0.0021 * 100) / 100,
          })
        }
        paidViewsSynced = paidViewsInWindow(daily, postedAt, windowEndsAt, "America/New_York")
      }

      const lastLikes = Math.round(last.views * likeRate)
      const lastComments = Math.round(last.views * commentRate)
      const lastShares = isTikTok ? Math.round(last.views * shareRate) : null
      const lastSaves = isTikTok ? Math.round(last.views * saveRate) : null

      postRows.push({
        id,
        accountId: account.id,
        platform: account.platform,
        platformPostId,
        url: isTikTok
          ? `${account.url}/video/${platformPostId}`
          : `https://www.instagram.com/reel/${platformPostId}/`,
        caption: pick(CAPTIONS),
        durationSec: Math.round(between(12, 58)),
        postedAt,
        creatorId: account.creatorId,
        campaignId: account.campaignId,
        windowDays: account.windowDays,
        windowEndsAt,
        status: lock?.ok ? "locked" : "open",
        isExcluded: postIndex % 53 === 0,
        excludedReason: postIndex % 53 === 0 ? "Off-brief: missing product mention" : null,
        excludedAt: postIndex % 53 === 0 ? NOW : null,
        needsReview: special === "late" || Boolean(lock?.ok && lock.needsReview) || postIndex % 97 === 0,
        reviewReason:
          special === "late"
            ? "late_discovery"
            : lock?.ok && lock.reviewReason
              ? lock.reviewReason
              : postIndex % 97 === 0
                ? "unavailable"
                : null,
        isAvailable: postIndex % 97 !== 0,
        unavailableSince: postIndex % 97 === 0 ? new Date(NOW.getTime() - 2 * DAY_MS) : null,
        missingCount: postIndex % 97 === 0 ? 2 : 0,
        currentViews: last.views,
        currentLikes: lastLikes,
        currentComments: lastComments,
        currentShares: lastShares,
        currentSaves: lastSaves,
        engagementRate: last.views
          ? (lastLikes + lastComments + (lastShares ?? 0) + (lastSaves ?? 0)) / last.views
          : null,
        virality: last.views && lastShares != null ? lastShares / last.views : null,
        views24hDelta: dayAgo ? last.views - dayAgo.views : null,
        lastSnapshotAt: last.capturedAt,
        lockedViews: lock?.ok ? lock.lockedViews : null,
        lockedAt: lock?.ok ? new Date(windowEndsAt.getTime() + HOUR_MS) : null,
        lockMethod: lock?.ok ? lock.method : null,
        lockDetails: lock?.ok ? lock.details : null,
        isSpark,
        sparkHint: isSpark,
        sparkSource: isSpark ? "ads_api" : null,
        sparkStartedAt: isSpark ? sparkStart : null,
        paidViewsSynced,
        firstSeenAt: kept[0],
      })
    }
  }

  // Comments have been "read" for every other TikTok video with enough views, as the hourly job
  // would have done. One in three of those has people asking about the app.
  const commentRows: (typeof postComments.$inferInsert)[] = []
  let readIndex = 0
  for (const post of postRows) {
    if (post.platform !== "tiktok" || (post.currentViews ?? 0) < 1000 || post.isSpark) continue
    if (readIndex++ % 2 === 1) continue
    const total = Math.min(30, Math.max(3, post.currentComments ?? 0))
    const about = readIndex % 3 === 1 ? 2 + Math.floor(commentRand() * 5) : readIndex % 5 === 0 ? 1 : 0
    for (let i = 0; i < total; i++) {
      const pool = i < about ? APP_COMMENTS : OTHER_COMMENTS
      commentRows.push({
        postId: post.id!,
        platformCommentId: `77${String(10 ** 15 + commentRows.length * 104_729)}`,
        text: pool[Math.floor(commentRand() * pool.length)],
        authorHandle: `viewer${Math.floor(commentRand() * 90_000) + 10_000}`,
        likes: Math.floor(commentRand() ** 3 * 400),
        replies: 0,
        postedAt: new Date(post.postedAt.getTime() + commentRand() * 3 * DAY_MS),
        fetchedAt: NOW,
      })
    }
    post.commentsCheckedAt = NOW
    post.commentsCheckedCount = post.currentComments ?? 0
    post.commentsChecks = 1
  }

  console.log(`Inserting ${postRows.length} posts, ${snapshotRows.length} snapshots…`)
  await insertChunked(postRows, 200, (chunk) => db.insert(posts).values(chunk))
  await insertChunked(snapshotRows, 1000, (chunk) => db.insert(postSnapshots).values(chunk))
  await insertChunked(dailyRows, 1000, (chunk) => db.insert(postDailyMetrics).values(chunk))
  await insertChunked(commentRows, 1000, (chunk) => db.insert(postComments).values(chunk))
  if (adRows.length) await db.insert(tiktokAds).values(adRows)
  if (adStatRows.length) await db.insert(tiktokAdDailyStats).values(adStatRows)
  await db.execute(
    sql`update scrape_runs set items_count = ${postRows.length}, posts_created = ${postRows.length}, snapshots_created = ${snapshotRows.length} where id = ${seedRun.id}`
  )

  // Settle last month through the real payout service, so the demo has history: the core
  // campaign's cycle is finalized and paid, the CPM test's cycle is finalized but not paid yet.
  const { finalizeCycle, markPaid } = await import("../lib/payouts/service")
  const [profile] = await db.select({ id: profiles.id }).from(profiles).limit(1)
  const userId = profile?.id ?? null
  const lastMonth = firstOfMonthUtc(1)
  await db.transaction(async (tx) => {
    const settled = await finalizeCycle(tx, {
      campaignId: core.id,
      periodStart: lastMonth,
      rollUnresolved: true,
      userId,
      now: NOW,
    })
    await markPaid(tx, {
      cycleId: settled.cycleId,
      lineId: null,
      paymentRef: "Wise batch #1042 (seed)",
      userId,
      now: NOW,
    })
    console.log(`Core campaign, ${lastMonth}: finalized + paid`, settled.totals)
  })
  await db.transaction(async (tx) => {
    const settled = await finalizeCycle(tx, {
      campaignId: cpm.id,
      periodStart: lastMonth,
      rollUnresolved: true,
      userId,
      now: NOW,
    })
    console.log(`CPM test, ${lastMonth}: finalized, not paid`, settled.totals)
  })

  const summary = await db.execute<{ display_status: string; n: number }>(
    sql`select display_status, count(*)::int as n from posts group by 1 order by 1`
  )
  const closingSoon = postRows.filter(
    (p) => p.status === "open" && p.windowEndsAt.getTime() - NOW.getTime() < 2 * DAY_MS
  ).length
  console.log("Posts by status:", Object.fromEntries(summary.map((r) => [r.display_status, r.n])))
  console.log(
    `Closing within 48h: ${closingSoon} · Spark: ${adRows.length} · needs review: ${postRows.filter((p) => p.needsReview).length}`
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
