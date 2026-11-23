"use server"

import { and, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { payoutAdjustments } from "@/db/schema"
import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { audit } from "@/lib/audit"
import { finalizeCycle, markPaid, PayoutError, reopenCycle } from "@/lib/payouts/service"

const reason = z.string().trim().min(3, "Add a short reason").max(500)

// PayoutError carries a message meant for the user; anything else stays a generic failure.
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof PayoutError) throw new ActionError(error.message)
    throw error
  }
}

export async function finalizeCycleAction(payload: unknown) {
  const schema = z.object({
    campaignId: z.uuid(),
    periodStart: z.iso.date(),
    rollUnresolved: z.boolean(),
  })
  return authedAction(schema, payload, async (input, user) => {
    const result = await run(() =>
      db.transaction(async (tx) => {
        const settled = await finalizeCycle(tx, { ...input, userId: user.id, now: new Date() })
        await audit(tx, {
          actor: user,
          action: "payout.finalize",
          entityType: "payout_cycle",
          entityId: settled.cycleId,
          after: { ...input, totals: settled.totals, lines: settled.lines, rolled: settled.rolled },
        })
        return settled
      })
    )
    revalidatePath("/", "layout")
    return result
  })
}

export async function markPaidAction(payload: unknown) {
  const schema = z.object({
    cycleId: z.uuid(),
    lineId: z.uuid().nullable(),
    paymentRef: z.string().trim().max(200).nullable(),
  })
  return authedAction(schema, payload, async (input, user) => {
    const result = await run(() =>
      db.transaction(async (tx) => {
        const paid = await markPaid(tx, { ...input, userId: user.id, now: new Date() })
        await audit(tx, {
          actor: user,
          action: input.lineId ? "payout.line_paid" : "payout.cycle_paid",
          entityType: "payout_cycle",
          entityId: input.cycleId,
          after: { ...input, ...paid },
        })
        return paid
      })
    )
    revalidatePath("/", "layout")
    return result
  })
}

export async function reopenCycleAction(payload: unknown) {
  const schema = z.object({ cycleId: z.uuid(), reason })
  return authedAction(schema, payload, async ({ cycleId, reason: why }, user) => {
    await run(() =>
      db.transaction(async (tx) => {
        const cycle = await reopenCycle(tx, cycleId)
        await audit(tx, {
          actor: user,
          action: "payout.reopen",
          entityType: "payout_cycle",
          entityId: cycleId,
          before: { periodStart: cycle.periodStart, totalCents: cycle.totalCents },
          reason: why,
        })
      })
    )
    revalidatePath("/", "layout")
  })
}

export async function addAdjustment(payload: unknown) {
  const schema = z.object({
    campaignId: z.uuid(),
    creatorId: z.uuid(),
    cycleType: z.enum(["weekly", "monthly"]),
    periodStart: z.iso.date(),
    amountCents: z
      .number()
      .int()
      .min(-10_000_000)
      .max(10_000_000)
      .refine((v) => v !== 0, "Enter an amount"),
    reason,
  })
  return authedAction(schema, payload, async (input, user) => {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(payoutAdjustments)
        .values({ ...input, createdBy: user.id })
        .returning({ id: payoutAdjustments.id })
      await audit(tx, {
        actor: user,
        action: "payout.adjustment_add",
        entityType: "payout_adjustment",
        entityId: row.id,
        after: input,
        reason: input.reason,
      })
    })
    revalidatePath("/", "layout")
  })
}

export async function deleteAdjustment(payload: unknown) {
  return authedAction(z.object({ id: z.uuid() }), payload, async ({ id }, user) => {
    await db.transaction(async (tx) => {
      // Only adjustments that are not part of a finalized cycle can be removed.
      const [removed] = await tx
        .delete(payoutAdjustments)
        .where(and(eq(payoutAdjustments.id, id), isNull(payoutAdjustments.cycleId)))
        .returning()
      if (!removed) throw new ActionError("This adjustment is part of a finalized cycle.")
      await audit(tx, {
        actor: user,
        action: "payout.adjustment_delete",
        entityType: "payout_adjustment",
        entityId: id,
        before: removed,
      })
    })
    revalidatePath("/", "layout")
  })
}
