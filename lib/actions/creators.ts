"use server"

import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { creators, payoutLines, posts } from "@/db/schema"
import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { audit } from "@/lib/audit"
import { creatorInputSchema } from "@/lib/validation/creator"

const saveSchema = z.object({ id: z.uuid().nullable(), input: creatorInputSchema })

export async function saveCreator(payload: unknown) {
  return authedAction(saveSchema, payload, async ({ id, input }, user) => {
    const saved = await db.transaction(async (tx) => {
      if (!id) {
        const [created] = await tx.insert(creators).values(input).returning()
        await audit(tx, {
          actor: user,
          action: "creator.create",
          entityType: "creator",
          entityId: created.id,
          after: input,
        })
        return created
      }
      const [before] = await tx.select().from(creators).where(eq(creators.id, id)).limit(1)
      if (!before) throw new ActionError("This creator no longer exists.")
      const [updated] = await tx.update(creators).set(input).where(eq(creators.id, id)).returning()
      await audit(tx, {
        actor: user,
        action: "creator.update",
        entityType: "creator",
        entityId: id,
        before,
        after: input,
      })
      return updated
    })
    revalidatePath("/", "layout")
    return { id: saved.id }
  })
}

// Only creators without any history can be deleted; everyone else is set to "ended" instead so
// past posts and payouts keep pointing at a real person.
// Only for creators without history (added by mistake, test data). Payout lines also protect
// themselves with ON DELETE RESTRICT.
export async function deleteCreator(payload: unknown) {
  return authedAction(z.object({ id: z.uuid(), confirm: z.string() }), payload, async ({ id, confirm }, user) => {
    await db.transaction(async (tx) => {
      const [creator] = await tx.select({ name: creators.name }).from(creators).where(eq(creators.id, id)).limit(1)
      if (!creator) throw new ActionError("This creator no longer exists.")
      if (confirm.trim().toLowerCase() !== creator.name.trim().toLowerCase()) {
        throw new ActionError("Type the creator's name to confirm.")
      }
      const [postUsage] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(eq(posts.creatorId, id))
      const [lineUsage] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(payoutLines)
        .where(eq(payoutLines.creatorId, id))
      if (postUsage.n > 0 || lineUsage.n > 0) {
        throw new ActionError(
          "This creator has videos or payouts. Delete their test accounts first, or set their status to Ended instead."
        )
      }
      const [before] = await tx.delete(creators).where(eq(creators.id, id)).returning()
      if (!before) return
      await audit(tx, {
        actor: user,
        action: "creator.delete",
        entityType: "creator",
        entityId: id,
        before,
      })
    })
    revalidatePath("/", "layout")
  })
}
