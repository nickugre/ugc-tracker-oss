"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { campaignCreators, campaigns, payoutCycles, posts } from "@/db/schema"
import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { audit } from "@/lib/audit"
import { campaignCreatorTermsSchema, campaignInputSchema } from "@/lib/validation/campaign"

const saveSchema = z.object({ id: z.uuid().nullable(), input: campaignInputSchema })

export async function saveCampaign(payload: unknown) {
  return authedAction(saveSchema, payload, async ({ id, input }, user) => {
    const values = { ...input, milestones: [...input.milestones].sort((a, b) => a.views - b.views) }

    const saved = await db.transaction(async (tx) => {
      if (!id) {
        const [created] = await tx.insert(campaigns).values(values).returning()
        await audit(tx, {
          actor: user,
          action: "campaign.create",
          entityType: "campaign",
          entityId: created.id,
          after: values,
        })
        return created
      }

      const [before] = await tx.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
      if (!before) throw new ActionError("This campaign no longer exists.")

      const [updated] = await tx.update(campaigns).set(values).where(eq(campaigns.id, id)).returning()

      // A new default window applies to posts that are still open and were never overridden
      // individually. Locked and paid posts keep the window they were settled with.
      let rewindowed = 0
      if (before.defaultWindowDays !== values.defaultWindowDays) {
        const days = values.defaultWindowDays
        const changed = await tx
          .update(posts)
          .set({
            windowDays: days,
            windowEndsAt: sql`${posts.postedAt} + (${days * 86400} * interval '1 second')`,
          })
          .where(
            and(
              eq(posts.campaignId, id),
              eq(posts.status, "open"),
              eq(posts.windowOverridden, false)
            )
          )
          .returning({ id: posts.id })
        rewindowed = changed.length
      }

      await audit(tx, {
        actor: user,
        action: "campaign.update",
        entityType: "campaign",
        entityId: id,
        before,
        after: { ...values, openPostsRewindowed: rewindowed },
      })
      return updated
    })

    revalidatePath("/", "layout")
    return { id: saved.id }
  })
}

const assignSchema = z.object({ campaignId: z.uuid(), creatorId: z.uuid() })

export async function assignCreator(payload: unknown) {
  return authedAction(assignSchema, payload, async ({ campaignId, creatorId }, user) => {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(campaignCreators)
        .values({ campaignId, creatorId })
        .onConflictDoNothing()
        .returning()
      if (inserted.length) {
        await audit(tx, {
          actor: user,
          action: "campaign.assign_creator",
          entityType: "campaign",
          entityId: campaignId,
          after: { creatorId },
        })
      }
    })
    revalidatePath("/", "layout")
  })
}

export async function unassignCreator(payload: unknown) {
  return authedAction(assignSchema, payload, async ({ campaignId, creatorId }, user) => {
    await db.transaction(async (tx) => {
      await tx
        .delete(campaignCreators)
        .where(
          and(eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId))
        )
      await audit(tx, {
        actor: user,
        action: "campaign.unassign_creator",
        entityType: "campaign",
        entityId: campaignId,
        before: { creatorId },
      })
    })
    revalidatePath("/", "layout")
  })
}

// Per-creator overrides of the campaign terms (null = use the campaign default).
export async function saveCreatorTerms(payload: unknown) {
  return authedAction(campaignCreatorTermsSchema, payload, async (terms, user) => {
    const { campaignId, creatorId, ...overrides } = terms
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(campaignCreators)
        .where(
          and(eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId))
        )
        .limit(1)
      if (!before) throw new ActionError("This creator is not assigned to the campaign.")

      await tx
        .update(campaignCreators)
        .set(overrides)
        .where(
          and(eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId))
        )
      await audit(tx, {
        actor: user,
        action: "campaign.creator_terms",
        entityType: "campaign",
        entityId: campaignId,
        before,
        after: { creatorId, ...overrides },
      })
    })
    revalidatePath("/", "layout")
  })
}


// Only for campaigns without history (created by mistake, test data). Creator assignments go
// with it, accounts are unlinked. Payout cycles also protect themselves with ON DELETE RESTRICT.
export async function deleteCampaign(payload: unknown) {
  return authedAction(z.object({ id: z.uuid(), confirm: z.string() }), payload, async ({ id, confirm }, user) => {
    await db.transaction(async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
      if (!campaign) throw new ActionError("This campaign no longer exists.")
      if (confirm.trim().toLowerCase() !== campaign.name.trim().toLowerCase()) {
        throw new ActionError("Type the campaign's name to confirm.")
      }
      const [videoUsage] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(eq(posts.campaignId, id))
      const [cycleUsage] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(payoutCycles)
        .where(eq(payoutCycles.campaignId, id))
      if (videoUsage.n > 0 || cycleUsage.n > 0) {
        throw new ActionError(
          "This campaign has videos or payouts. Delete its test accounts first, or set its status to Ended instead."
        )
      }
      await tx.delete(campaigns).where(eq(campaigns.id, id))
      await audit(tx, {
        actor: user,
        action: "campaign.delete",
        entityType: "campaign",
        entityId: id,
        before: campaign,
      })
    })
    revalidatePath("/", "layout")
  })
}
