import "server-only"

import { asc, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import { accounts, campaignCreators, campaigns, creators, posts } from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"

export async function listCampaigns() {
  await requireUser()
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      platforms: campaigns.platforms,
      baseType: campaigns.baseType,
      baseAmountCents: campaigns.baseAmountCents,
      bonusType: campaigns.bonusType,
      cycleType: campaigns.cycleType,
      defaultWindowDays: campaigns.defaultWindowDays,
      creatorCount: sql<number>`(select count(*)::int from ${campaignCreators} cc where cc.campaign_id = ${outerRef(campaigns.id)})`,
      accountCount: sql<number>`(select count(*)::int from ${accounts} a where a.campaign_id = ${outerRef(campaigns.id)})`,
      postCount: sql<number>`(select count(*)::int from ${posts} p where p.campaign_id = ${outerRef(campaigns.id)})`,
    })
    .from(campaigns)
    .orderBy(
      sql`case ${campaigns.status} when 'active' then 0 when 'draft' then 1 else 2 end`,
      asc(campaigns.name)
    )
}

export type CampaignListRow = Awaited<ReturnType<typeof listCampaigns>>[number]

export async function getCampaign(id: string) {
  await requireUser()
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
  return row ?? null
}

export type CampaignRow = NonNullable<Awaited<ReturnType<typeof getCampaign>>>

export async function listCampaignOptions() {
  await requireUser()
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      startDate: campaigns.startDate,
    })
    .from(campaigns)
    .orderBy(asc(campaigns.name))
}

// Creators assigned to a campaign with their override terms, plus the accounts linked to it.
export async function getCampaignAssignments(campaignId: string) {
  await requireUser()
  const [assigned, linkedAccounts] = await Promise.all([
    db
      .select({
        creatorId: creators.id,
        name: creators.name,
        status: creators.status,
        baseAmountCentsOverride: campaignCreators.baseAmountCentsOverride,
        quotaCountOverride: campaignCreators.quotaCountOverride,
        cycleCapCentsOverride: campaignCreators.cycleCapCentsOverride,
        postCount: sql<number>`(select count(*)::int from ${posts} p where p.campaign_id = ${outerRef(campaignCreators.campaignId)} and p.creator_id = ${outerRef(creators.id)})`,
      })
      .from(campaignCreators)
      .innerJoin(creators, eq(creators.id, campaignCreators.creatorId))
      .where(eq(campaignCreators.campaignId, campaignId))
      .orderBy(asc(creators.name)),
    db
      .select({
        id: accounts.id,
        platform: accounts.platform,
        handle: accounts.handle,
        creatorId: accounts.creatorId,
        creatorName: creators.name,
        trackingEnabled: accounts.trackingEnabled,
      })
      .from(accounts)
      .leftJoin(creators, eq(creators.id, accounts.creatorId))
      .where(eq(accounts.campaignId, campaignId))
      .orderBy(asc(accounts.platform), asc(accounts.handle)),
  ])
  return { creators: assigned, accounts: linkedAccounts }
}

export type CampaignAssignments = Awaited<ReturnType<typeof getCampaignAssignments>>
