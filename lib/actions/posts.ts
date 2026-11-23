"use server"

import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db, type Tx } from "@/db"
import { campaigns, creators, postSnapshots, posts } from "@/db/schema"
import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { audit } from "@/lib/audit"
import type { CurrentUser } from "@/lib/auth/dal"
import { computeLockedViews, POST_CLOSE_WITHIN_MS } from "@/lib/windows/lock"
import { computeWindowEndsAt } from "@/lib/windows/window"

const idList = z.array(z.uuid()).min(1).max(5000)
const reason = z.string().trim().min(3, "Add a short reason").max(500)

// A post that was settled in a payout cycle (or marked paid) is frozen: changing it could
// silently disagree with money that already went out.
const notSettled = and(ne(posts.status, "paid"), isNull(posts.bonusCycleId), isNull(posts.baseCycleId))

async function loadPost(tx: Tx, id: string) {
  const [post] = await tx.select().from(posts).where(eq(posts.id, id)).limit(1)
  if (!post) throw new ActionError("This video no longer exists.")
  return post
}

function assertEditable(post: typeof posts.$inferSelect) {
  if (post.status === "paid" || post.bonusCycleId) {
    throw new ActionError("This video is already part of a payout and can no longer be changed.")
  }
}

function done() {
  revalidatePath("/", "layout")
}

// ── Bulk actions ─────────────────────────────────────────────────────────────────────────────

export async function bulkAssignCampaign(payload: unknown) {
  const schema = z.object({ ids: idList, campaignId: z.uuid() })
  return authedAction(schema, payload, async ({ ids, campaignId }, user) => {
    const result = await db.transaction(async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
      if (!campaign) throw new ActionError("That campaign no longer exists.")

      const updated = await tx
        .update(posts)
        .set({ campaignId, assignmentSource: "manual" })
        .where(and(inArray(posts.id, ids), notSettled))
        .returning({ id: posts.id })
      const updatedIds = updated.map((r) => r.id)

      // Open posts without their own override follow the new campaign's default window.
      if (updatedIds.length) {
        const days = campaign.defaultWindowDays
        await tx
          .update(posts)
          .set({
            windowDays: days,
            windowEndsAt: sql`${posts.postedAt} + (${days * 86400} * interval '1 second')`,
          })
          .where(
            and(inArray(posts.id, updatedIds), eq(posts.status, "open"), eq(posts.windowOverridden, false))
          )
      }
      await audit(
        tx,
        updatedIds.map((id) => ({
          actor: user,
          action: "post.assign_campaign",
          entityType: "post",
          entityId: id,
          after: { campaignId },
        }))
      )
      return { updated: updatedIds.length, skipped: ids.length - updatedIds.length }
    })
    done()
    return result
  })
}

export async function bulkAssignCreator(payload: unknown) {
  const schema = z.object({ ids: idList, creatorId: z.uuid() })
  return authedAction(schema, payload, async ({ ids, creatorId }, user) => {
    const result = await db.transaction(async (tx) => {
      const [creator] = await tx
        .select({ id: creators.id })
        .from(creators)
        .where(eq(creators.id, creatorId))
        .limit(1)
      if (!creator) throw new ActionError("That creator no longer exists.")

      const updated = await tx
        .update(posts)
        .set({ creatorId, assignmentSource: "manual" })
        .where(and(inArray(posts.id, ids), notSettled))
        .returning({ id: posts.id })
      await audit(
        tx,
        updated.map((r) => ({
          actor: user,
          action: "post.assign_creator",
          entityType: "post",
          entityId: r.id,
          after: { creatorId },
        }))
      )
      return { updated: updated.length, skipped: ids.length - updated.length }
    })
    done()
    return result
  })
}

// "These are boosted now", from the Spark page: they leave the suggestions and show under
// "Sparked". Paid views are entered per video (or come from the Ads sync) as before.
export async function bulkMarkSparked(payload: unknown) {
  return authedAction(z.object({ ids: idList }), payload, async ({ ids }, user) => {
    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(posts)
        .set({ isSpark: true, sparkSource: "manual" })
        .where(and(inArray(posts.id, ids), notSettled, eq(posts.isSpark, false)))
        .returning({ id: posts.id })
      await audit(
        tx,
        updated.map((r) => ({
          actor: user,
          action: "post.spark",
          entityType: "post",
          entityId: r.id,
          before: { isSpark: false },
          after: { isSpark: true, sparkSource: "manual" },
        }))
      )
      return { updated: updated.length, skipped: ids.length - updated.length }
    })
    done()
    return result
  })
}

export async function bulkSetExcluded(payload: unknown) {
  const schema = z
    .object({ ids: idList, excluded: z.boolean(), reason: z.string().trim().max(500).optional() })
    .refine((v) => !v.excluded || (v.reason ?? "").length >= 3, {
      message: "Say why these videos are excluded",
      path: ["reason"],
    })
  return authedAction(schema, payload, async ({ ids, excluded, reason: why }, user) => {
    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(posts)
        .set(
          excluded
            ? { isExcluded: true, excludedReason: why ?? null, excludedBy: user.id, excludedAt: new Date() }
            : { isExcluded: false, excludedReason: null, excludedBy: null, excludedAt: null }
        )
        .where(and(inArray(posts.id, ids), notSettled, eq(posts.isExcluded, !excluded)))
        .returning({ id: posts.id })
      await audit(
        tx,
        updated.map((r) => ({
          actor: user,
          action: excluded ? "post.exclude" : "post.include",
          entityType: "post",
          entityId: r.id,
          reason: why ?? null,
        }))
      )
      return { updated: updated.length, skipped: ids.length - updated.length }
    })
    done()
    return result
  })
}

// For videos found after their window had closed: there is no in-window snapshot to lock from,
// so the count we have now is accepted as the locked count. It can only be too high, never too
// low, which is why it is limited to exactly those videos; every other closed window is locked
// more accurately by the hourly job.
export async function bulkLockAtCurrentViews(payload: unknown) {
  const schema = z.object({ ids: idList, reason })
  return authedAction(schema, payload, async ({ ids, reason: why }, user) => {
    const result = await db.transaction(async (tx) => {
      const now = new Date()
      const updated = await tx
        .update(posts)
        .set({
          status: "locked",
          lockHold: false,
          lockedViews: sql`${posts.currentViews}`,
          lockedAt: now,
          lockedBy: user.id,
          lockMethod: "manual",
          lockDetails: { note: `Current views accepted: ${why}` },
          needsReview: false,
          reviewReason: null,
        })
        .where(
          and(
            inArray(posts.id, ids),
            // Same rule as assertEditable: a lock only feeds the bonus, so a video whose base
            // pay was settled in an earlier cycle can still be locked.
            isNull(posts.bonusCycleId),
            eq(posts.status, "open"),
            eq(posts.needsReview, true),
            eq(posts.reviewReason, "late_discovery"),
            lte(posts.windowEndsAt, now),
            isNotNull(posts.lastSnapshotAt)
          )
        )
        .returning({ id: posts.id, lockedViews: posts.lockedViews })
      await audit(
        tx,
        updated.map((r) => ({
          actor: user,
          action: "post.lock_manual",
          entityType: "post",
          entityId: r.id,
          after: { lockedViews: r.lockedViews, source: "current_views" },
          reason: why,
        }))
      )
      return { updated: updated.length, skipped: ids.length - updated.length }
    })
    done()
    return result
  })
}

// Marks videos as paid outside of a payout cycle (e.g. settled before this tool existed).
// Normal payouts flip this status themselves when a cycle is marked paid.
export async function bulkMarkPaid(payload: unknown) {
  const schema = z.object({ ids: idList, reason })
  return authedAction(schema, payload, async ({ ids, reason: why }, user) => {
    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(posts)
        .set({ status: "paid", paidAt: new Date() })
        .where(
          and(
            inArray(posts.id, ids),
            eq(posts.status, "locked"),
            eq(posts.isExcluded, false),
            eq(posts.needsReview, false),
            isNull(posts.bonusCycleId)
          )
        )
        .returning({ id: posts.id })
      await audit(
        tx,
        updated.map((r) => ({
          actor: user,
          action: "post.mark_paid_manual",
          entityType: "post",
          entityId: r.id,
          reason: why,
        }))
      )
      return { updated: updated.length, skipped: ids.length - updated.length }
    })
    done()
    return result
  })
}

// ── Single-video actions ─────────────────────────────────────────────────────────────────────

async function lockFromSnapshots(tx: Tx, post: typeof posts.$inferSelect, user: CurrentUser) {
  const snapshots = await tx
    .select({ id: postSnapshots.id, capturedAt: postSnapshots.capturedAt, views: postSnapshots.views })
    .from(postSnapshots)
    .where(eq(postSnapshots.postId, post.id))
    .orderBy(asc(postSnapshots.capturedAt))

  // A person asked for the lock, so the fallbacks are acceptable: the last in-window snapshot,
  // or the first one there is for a video that was found after its window had ended.
  const lock = computeLockedViews(snapshots, post.windowEndsAt, {
    allowLastBefore: true,
    allowFirstAfter: true,
    // The same allowance the hourly job gives: the after-end count comes from the next daily sync.
    lateAfterMs: POST_CLOSE_WITHIN_MS,
  })
  if (!lock.ok) throw new ActionError("There are no snapshots for this video yet.")
  await tx
    .update(posts)
    .set({
      status: "locked",
      lockHold: false,
      lockedViews: lock.lockedViews,
      lockedAt: new Date(),
      lockedBy: user.id,
      lockMethod: lock.method,
      lockDetails: lock.details,
      needsReview: lock.needsReview,
      reviewReason: lock.reviewReason,
    })
    .where(eq(posts.id, post.id))
  return lock
}

export async function lockPost(payload: unknown) {
  return authedAction(z.object({ id: z.uuid() }), payload, async ({ id }, user) => {
    await db.transaction(async (tx) => {
      const post = await loadPost(tx, id)
      assertEditable(post)
      if (post.status !== "open") throw new ActionError("This video is already locked.")
      if (post.windowEndsAt > new Date()) {
        throw new ActionError("The view window is still open. Shorten the window first to lock early.")
      }
      const lock = await lockFromSnapshots(tx, post, user)
      await audit(tx, {
        actor: user,
        action: "post.lock",
        entityType: "post",
        entityId: id,
        after: { lockedViews: lock.lockedViews, method: lock.method },
      })
    })
    done()
  })
}

export async function unlockPost(payload: unknown) {
  const schema = z.object({ id: z.uuid(), reason })
  return authedAction(schema, payload, async ({ id, reason: why }, user) => {
    await db.transaction(async (tx) => {
      const post = await loadPost(tx, id)
      assertEditable(post)
      if (post.status !== "locked") throw new ActionError("Only a locked video can be unlocked.")
      await tx
        .update(posts)
        .set({
          status: "open",
          // Keeps the hourly job from re-locking it before someone has dealt with it.
          lockHold: true,
          lockedViews: null,
          lockedAt: null,
          lockedBy: null,
          lockMethod: null,
          lockDetails: null,
        })
        .where(eq(posts.id, id))
      await audit(tx, {
        actor: user,
        action: "post.unlock",
        entityType: "post",
        entityId: id,
        before: { lockedViews: post.lockedViews, method: post.lockMethod },
        reason: why,
      })
    })
    done()
  })
}

export async function setManualLock(payload: unknown) {
  const schema = z.object({ id: z.uuid(), views: z.number().int().min(0).max(10_000_000_000), reason })
  return authedAction(schema, payload, async ({ id, views, reason: why }, user) => {
    await db.transaction(async (tx) => {
      const post = await loadPost(tx, id)
      assertEditable(post)
      await tx
        .update(posts)
        .set({
          status: "locked",
          lockHold: false,
          lockedViews: views,
          lockedAt: new Date(),
          lockedBy: user.id,
          lockMethod: "manual",
          lockDetails: { note: why },
          needsReview: false,
          reviewReason: null,
        })
        .where(eq(posts.id, id))
      await audit(tx, {
        actor: user,
        action: "post.lock_manual",
        entityType: "post",
        entityId: id,
        before: { lockedViews: post.lockedViews, method: post.lockMethod },
        after: { lockedViews: views },
        reason: why,
      })
    })
    done()
  })
}

// days = null puts the video back on its campaign's default window.
export async function setWindowDays(payload: unknown) {
  const schema = z.object({ id: z.uuid(), days: z.number().int().min(1).max(365).nullable() })
  return authedAction(schema, payload, async ({ id, days }, user) => {
    await db.transaction(async (tx) => {
      const post = await loadPost(tx, id)
      assertEditable(post)
      if (post.status !== "open") {
        throw new ActionError("Unlock the video first; a locked view count belongs to its window.")
      }
      let effective = days
      if (effective === null) {
        const [campaign] = post.campaignId
          ? await tx
              .select({ days: campaigns.defaultWindowDays })
              .from(campaigns)
              .where(eq(campaigns.id, post.campaignId))
              .limit(1)
          : []
        effective = campaign?.days ?? 14
      }
      const windowEndsAt = computeWindowEndsAt(post.postedAt, effective)
      await tx
        .update(posts)
        .set({ windowDays: effective, windowOverridden: days !== null, windowEndsAt, lockHold: false })
        .where(eq(posts.id, id))
      await audit(tx, {
        actor: user,
        action: "post.window",
        entityType: "post",
        entityId: id,
        before: { windowDays: post.windowDays, windowEndsAt: post.windowEndsAt },
        after: { windowDays: effective, windowEndsAt, overridden: days !== null },
      })
    })
    done()
  })
}

export async function saveSpark(payload: unknown) {
  const schema = z.object({
    id: z.uuid(),
    isSpark: z.boolean(),
    sparkStartedAt: z.iso.datetime({ offset: true }).nullable(),
    paidViewsManual: z.number().int().min(0).max(10_000_000_000).nullable(),
  })
  return authedAction(schema, payload, async (input, user) => {
    await db.transaction(async (tx) => {
      const post = await loadPost(tx, input.id)
      assertEditable(post)
      const values = {
        isSpark: input.isSpark,
        sparkSource: input.isSpark ? (post.sparkSource ?? ("manual" as const)) : null,
        sparkStartedAt: input.isSpark && input.sparkStartedAt ? new Date(input.sparkStartedAt) : null,
        paidViewsManual: input.isSpark ? input.paidViewsManual : null,
      }
      const resolvesReview = post.reviewReason === "spark_no_paid_data" && values.paidViewsManual != null
      await tx
        .update(posts)
        .set({ ...values, ...(resolvesReview ? { needsReview: false, reviewReason: null } : {}) })
        .where(eq(posts.id, input.id))
      await audit(tx, {
        actor: user,
        action: "post.spark",
        entityType: "post",
        entityId: input.id,
        before: {
          isSpark: post.isSpark,
          sparkStartedAt: post.sparkStartedAt,
          paidViewsManual: post.paidViewsManual,
        },
        after: values,
      })
    })
    done()
  })
}

export async function savePostNotes(payload: unknown) {
  const schema = z.object({ id: z.uuid(), notes: z.string().trim().max(4000) })
  return authedAction(schema, payload, async ({ id, notes }) => {
    await db.update(posts).set({ notes: notes || null }).where(eq(posts.id, id))
    done()
  })
}

export async function resolveReview(payload: unknown) {
  const schema = z.object({ id: z.uuid(), reason })
  return authedAction(schema, payload, async ({ id, reason: why }, user) => {
    await db.transaction(async (tx) => {
      const post = await loadPost(tx, id)
      if (!post.needsReview) return
      await tx.update(posts).set({ needsReview: false, reviewReason: null }).where(eq(posts.id, id))
      await audit(tx, {
        actor: user,
        action: "post.review_resolved",
        entityType: "post",
        entityId: id,
        before: { reviewReason: post.reviewReason },
        reason: why,
      })
    })
    done()
  })
}
