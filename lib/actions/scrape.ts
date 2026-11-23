"use server"

import { z } from "zod"

import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { ApifyError } from "@/lib/apify/client"
import { scrapeAccountsNow } from "@/lib/jobs/daily-sync"
import { NotImplementedError } from "@/lib/scrapers/types"

// Starts a scrape for the given accounts and returns the run ids; the button then polls
// /api/scrape-runs/[id] until each run has been ingested.
export async function scrapeNow(payload: unknown) {
  const schema = z.object({ accountIds: z.array(z.uuid()).min(1).max(50) })
  return authedAction(schema, payload, async ({ accountIds }, user) => {
    try {
      return { runs: await scrapeAccountsNow(accountIds, user.id, new Date()) }
    } catch (error) {
      if (error instanceof NotImplementedError || error instanceof ApifyError) {
        throw new ActionError(error.message)
      }
      throw error
    }
  })
}
