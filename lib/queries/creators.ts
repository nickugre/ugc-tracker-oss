import "server-only"

import { asc, eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { outerRef } from "@/db/outer-ref"
import { accounts, campaignCreators, campaigns, creators, payoutLines, posts } from "@/db/schema"
import { requireUser } from "@/lib/auth/dal"

export async function listCreators() {
  await requireUser()
  return db
    .select({
      id: creators.id,
      name: creators.name,
      email: creators.email,
      contactHandle: creators.contactHandle,
      country: creators.country,
      status: creators.status,
      accountCount: sql<number>`(select count(*)::int from ${accounts} a where a.creator_id = ${outerRef(creators.id)})`,
      campaignNames: sql<string[]>`coalesce((select array_agg(c.name order by c.name) from ${campaignCreators} cc join ${campaigns} c on c.id = cc.campaign_id where cc.creator_id = ${outerRef(creators.id)}), '{}')`,
      postCount: sql<number>`(select count(*)::int from ${posts} p where p.creator_id = ${outerRef(creators.id)} and not p.is_excluded)`,
      totalViews: sql<number>`coalesce((select sum(p.current_views)::bigint from ${posts} p where p.creator_id = ${outerRef(creators.id)} and not p.is_excluded), 0)::float8`,
      paidCents: sql<number>`coalesce((select sum(l.total_cents)::int from ${payoutLines} l where l.creator_id = ${outerRef(creators.id)} and l.status = 'paid'), 0)`,
      unpaidCents: sql<number>`coalesce((select sum(l.total_cents)::int from ${payoutLines} l where l.creator_id = ${outerRef(creators.id)} and l.status = 'unpaid'), 0)`,
    })
    .from(creators)
    .orderBy(
      sql`case ${creators.status} when 'active' then 0 when 'paused' then 1 else 2 end`,
      asc(creators.name)
    )
}

export type CreatorListRow = Awaited<ReturnType<typeof listCreators>>[number]

export async function getCreator(id: string) {
  await requireUser()
  const [row] = await db.select().from(creators).where(eq(creators.id, id)).limit(1)
  return row ?? null
}

export type CreatorRow = NonNullable<Awaited<ReturnType<typeof getCreator>>>

export async function listCreatorOptions() {
  await requireUser()
  return db
    .select({ id: creators.id, name: creators.name, status: creators.status })
    .from(creators)
    .orderBy(asc(creators.name))
}

export async function getCreatorLinks(creatorId: string) {
  await requireUser()
  const [creatorCampaigns, creatorAccounts] = await Promise.all([
    db
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
      .from(campaignCreators)
      .innerJoin(campaigns, eq(campaigns.id, campaignCreators.campaignId))
      .where(eq(campaignCreators.creatorId, creatorId))
      .orderBy(asc(campaigns.name)),
    db
      .select({
        id: accounts.id,
        platform: accounts.platform,
        handle: accounts.handle,
        url: accounts.url,
        followerCount: accounts.followerCount,
        campaignName: campaigns.name,
        trackingEnabled: accounts.trackingEnabled,
      })
      .from(accounts)
      .leftJoin(campaigns, eq(campaigns.id, accounts.campaignId))
      .where(eq(accounts.creatorId, creatorId))
      .orderBy(asc(accounts.platform), asc(accounts.handle)),
  ])
  return { campaigns: creatorCampaigns, accounts: creatorAccounts }
}
