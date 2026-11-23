import "server-only"

import { asc, desc } from "drizzle-orm"

import { db } from "@/db"
import { jobRuns, profiles, scrapeRuns } from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"
import { env } from "@/lib/env"
import { monthToDateSpendUsd } from "@/lib/ingest/start-run"
import { getSparkRules } from "@/lib/spark/settings"
import { tiktokAdsConfig } from "@/lib/tiktok-ads/client"

export async function getSettings(now: Date) {
  const user = await requireUser()
  const e = env()
  const [team, runs, jobs, spentUsd, spark] = await Promise.all([
    db.select().from(profiles).orderBy(asc(profiles.email)),
    db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(25),
    db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(12),
    monthToDateSpendUsd(now),
    getSparkRules(),
  ])
  return {
    currentUserId: user.id,
    spark,
    team,
    runs,
    jobs,
    apify: {
      configured: Boolean(e.APIFY_TOKEN),
      webhooks: e.APP_URL.startsWith("https://") && Boolean(e.APIFY_WEBHOOK_SECRET),
      spentUsd,
      budgetUsd: e.APIFY_MONTHLY_BUDGET_USD,
      tiktokActor: e.APIFY_TIKTOK_ACTOR,
      instagramActor: e.APIFY_INSTAGRAM_ACTOR,
    },
    tiktokAds: { configured: Boolean(tiktokAdsConfig()), advertiserIds: e.TIKTOK_ADS_ADVERTISER_IDS ?? "" },
    appUrl: e.APP_URL,
  }
}
