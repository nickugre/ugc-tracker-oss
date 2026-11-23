import "server-only"

import { asc, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import { accounts, campaigns, creators, posts } from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"

export async function listAccounts() {
  await requireUser()
  return db
    .select({
      id: accounts.id,
      platform: accounts.platform,
      handle: accounts.handle,
      url: accounts.url,
      displayName: accounts.displayName,
      followerCount: accounts.followerCount,
      creatorId: accounts.creatorId,
      creatorName: creators.name,
      campaignId: accounts.campaignId,
      campaignName: campaigns.name,
      trackingEnabled: accounts.trackingEnabled,
      trackFrom: accounts.trackFrom,
      lastScrapedAt: accounts.lastScrapedAt,
      scrapeStatus: accounts.scrapeStatus,
      scrapeError: accounts.scrapeError,
      postCount: sql<number>`(select count(*)::int from ${posts} p where p.account_id = ${outerRef(accounts.id)})`,
    })
    .from(accounts)
    .leftJoin(creators, eq(creators.id, accounts.creatorId))
    .leftJoin(campaigns, eq(campaigns.id, accounts.campaignId))
    .orderBy(asc(accounts.platform), asc(accounts.handle))
}

export type AccountListRow = Awaited<ReturnType<typeof listAccounts>>[number]
