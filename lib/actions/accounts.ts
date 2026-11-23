"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { accounts, campaignCreators, campaigns, posts } from "@/db/schema"
import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { audit } from "@/lib/audit"
import { createAdminClient } from "@/lib/supabase/admin"
import { accountInputSchema, accountLinkSchema, parseAccountHandle } from "@/lib/validation/account"
import type { Tx } from "@/db"

// Linking an account to a creator and a campaign implies the creator works on that campaign.
async function ensureAssignment(tx: Tx, campaignId: string | null, creatorId: string | null) {
  if (!campaignId || !creatorId) return
  await tx.insert(campaignCreators).values({ campaignId, creatorId }).onConflictDoNothing()
}

// Backfill starts at the campaign start unless a date was chosen explicitly.
async function defaultTrackFrom(tx: Tx, campaignId: string | null, trackFrom: string | null) {
  if (trackFrom || !campaignId) return trackFrom
  const [campaign] = await tx
    .select({ startDate: campaigns.startDate })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
  return campaign?.startDate ?? null
}

export async function createAccount(payload: unknown) {
  return authedAction(accountInputSchema, payload, async (input, user) => {
    const parsed = parseAccountHandle(input.platform, input.handleOrUrl)
    if (!parsed.ok) throw new ActionError(parsed.error)

    const created = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.platform, input.platform), eq(accounts.handle, parsed.handle)))
        .limit(1)
      if (existing) throw new ActionError(`@${parsed.handle} is already tracked on this platform.`)

      const values = {
        platform: input.platform,
        handle: parsed.handle,
        url: parsed.url,
        creatorId: input.creatorId,
        campaignId: input.campaignId,
        trackingEnabled: input.trackingEnabled,
        trackFrom: await defaultTrackFrom(tx, input.campaignId, input.trackFrom),
      }
      const [row] = await tx.insert(accounts).values(values).returning()
      await ensureAssignment(tx, input.campaignId, input.creatorId)
      await audit(tx, {
        actor: user,
        action: "account.create",
        entityType: "account",
        entityId: row.id,
        after: values,
      })
      return row
    })

    revalidatePath("/", "layout")
    return { id: created.id }
  })
}

// Changes who an account belongs to. Existing posts keep the creator/campaign they were ingested
// with; only posts discovered from now on use the new link.
export async function updateAccountLinks(payload: unknown) {
  return authedAction(accountLinkSchema, payload, async (input, user) => {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(accounts).where(eq(accounts.id, input.id)).limit(1)
      if (!before) throw new ActionError("This account no longer exists.")

      const values = {
        creatorId: input.creatorId,
        campaignId: input.campaignId,
        trackFrom: await defaultTrackFrom(tx, input.campaignId, input.trackFrom),
      }
      // Earlier scrapes only looked as far back as the old date, so unless tracking now starts
      // later than before, the next scrape has to reach back again.
      const startsLater = Boolean(before.trackFrom && values.trackFrom && values.trackFrom > before.trackFrom)
      const reachBack = values.trackFrom !== before.trackFrom && !startsLater
      await tx
        .update(accounts)
        .set({ ...values, ...(reachBack ? { backfillPending: true } : {}) })
        .where(eq(accounts.id, input.id))
      await ensureAssignment(tx, input.campaignId, input.creatorId)
      await audit(tx, {
        actor: user,
        action: "account.link",
        entityType: "account",
        entityId: input.id,
        before: {
          creatorId: before.creatorId,
          campaignId: before.campaignId,
          trackFrom: before.trackFrom,
        },
        after: values,
      })
    })
    revalidatePath("/", "layout")
  })
}

const trackingSchema = z.object({ id: z.uuid(), enabled: z.boolean() })

export async function setAccountTracking(payload: unknown) {
  return authedAction(trackingSchema, payload, async ({ id, enabled }, user) => {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(accounts)
        .set({ trackingEnabled: enabled })
        .where(eq(accounts.id, id))
        .returning({ id: accounts.id })
      if (!row) throw new ActionError("This account no longer exists.")
      await audit(tx, {
        actor: user,
        action: enabled ? "account.tracking_on" : "account.tracking_off",
        entityType: "account",
        entityId: id,
      })
    })
    revalidatePath("/", "layout")
  })
}

const sameName = (typed: string, actual: string) =>
  typed.trim().replace(/^@/, "").toLowerCase() === actual.trim().replace(/^@/, "").toLowerCase()

// Removes an account together with its videos, their view history and stored thumbnails: for
// accounts added by mistake and for test data. Anything that is part of a payout stays forever:
// the check below refuses, and payout_items.post_id is ON DELETE RESTRICT as a second guard.
export async function deleteAccount(payload: unknown) {
  const schema = z.object({ id: z.uuid(), confirm: z.string() })
  return authedAction(schema, payload, async ({ id, confirm }, user) => {
    const removed = await db.transaction(async (tx) => {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1)
      if (!account) throw new ActionError("This account no longer exists.")
      if (!sameName(confirm, account.handle)) throw new ActionError("Type the account's handle to confirm.")

      const videos = await tx
        .select({
          thumbnailPath: posts.thumbnailPath,
          settled: sql<boolean>`(${posts.status} = 'paid' or ${posts.baseCycleId} is not null or ${posts.bonusCycleId} is not null)`,
        })
        .from(posts)
        .where(eq(posts.accountId, id))
      const settled = videos.filter((v) => v.settled).length
      if (settled > 0) {
        throw new ActionError(
          `${settled} of this account's videos are part of a payout, so it cannot be deleted. Turn tracking off instead.`
        )
      }

      await tx.delete(posts).where(eq(posts.accountId, id))
      await tx.delete(accounts).where(eq(accounts.id, id))
      await audit(tx, {
        actor: user,
        action: "account.delete",
        entityType: "account",
        entityId: id,
        before: account,
        after: { deletedVideos: videos.length },
      })
      return { videos: videos.length, paths: videos.flatMap((v) => (v.thumbnailPath ? [v.thumbnailPath] : [])) }
    })

    // After the commit: a file left behind is harmless, a video without its row is not.
    if (removed.paths.length > 0) {
      const storage = createAdminClient().storage.from("thumbnails")
      for (let i = 0; i < removed.paths.length; i += 100) {
        const { error } = await storage.remove(removed.paths.slice(i, i + 100))
        if (error) console.error("Thumbnail cleanup failed", error.message)
      }
    }
    revalidatePath("/", "layout")
    return { deletedVideos: removed.videos }
  })
}
