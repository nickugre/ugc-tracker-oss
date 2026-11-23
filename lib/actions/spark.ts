"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { sparkSettings } from "@/db/schema"
import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { ApifyError } from "@/lib/apify/client"
import { audit } from "@/lib/audit"
import { readCommentsNow as startCommentsRead } from "@/lib/jobs/comment-sync"
import { NotImplementedError } from "@/lib/scrapers/types"
import { parseKeywords } from "@/lib/spark/keywords"
import { getSparkRules } from "@/lib/spark/settings"

// The form sends what the person typed: keywords as text, engagement as a percentage.
const settingsSchema = z.object({
  keywordsText: z.string().max(8000),
  minEngagementPercent: z.number("Enter a percentage").min(0).max(100),
  minViews: z.number("Enter a number of views").int().min(0).max(100_000_000),
  minAppComments: z.number("Enter a number of comments").int().min(1, "At least 1").max(50),
  commentsBudgetUsd: z.number("Enter an amount").min(0).max(1000),
})

export async function saveSparkSettings(payload: unknown) {
  return authedAction(settingsSchema, payload, async (input, user) => {
    const keywords = parseKeywords(input.keywordsText)
    if (keywords.length === 0) throw new ActionError("Add at least one keyword.")

    const before = await getSparkRules()
    const values = {
      keywords,
      minEngagement: input.minEngagementPercent / 100,
      minViews: input.minViews,
      minAppComments: input.minAppComments,
      commentsBudgetUsd: input.commentsBudgetUsd,
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(sparkSettings)
        .values({ id: true, ...values, updatedBy: user.id })
        .onConflictDoUpdate({ target: sparkSettings.id, set: { ...values, updatedBy: user.id, updatedAt: new Date() } })
      await audit(tx, {
        actor: user,
        action: "spark.settings_update",
        entityType: "spark_settings",
        entityId: "spark",
        before,
        after: values,
      })
    })
    revalidatePath("/", "layout")
    return { keywords: keywords.length }
  })
}

// Reads one video's comments right away and returns the run id; the button then polls
// /api/scrape-runs/[id] until the comments are stored (see components/spark/read-comments-button.tsx).
export async function readCommentsNow(payload: unknown) {
  const schema = z.object({ postId: z.uuid() })
  return authedAction(schema, payload, async ({ postId }, user) => {
    try {
      const run = await startCommentsRead(postId, user.id, new Date())
      if (!run) throw new ActionError("This video no longer exists.")
      return { runId: run.id }
    } catch (error) {
      if (error instanceof NotImplementedError || error instanceof ApifyError) {
        throw new ActionError(error.message)
      }
      throw error
    }
  })
}
