import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { db } from "@/db"
import { scrapeRuns } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth/dal"
import { ingestRun } from "@/lib/ingest/ingest-run"

export const maxDuration = 300

// Polled by the "Scrape now" button. While the run is still going on Apify this only reports the
// status; once it has finished, the same call ingests the results. That is what makes scraping
// work on localhost, where Apify's webhook cannot reach us.
export async function GET(_request: Request, context: RouteContext<"/api/scrape-runs/[id]">) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params

  const result = await ingestRun(id)
  const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, id)).limit(1)
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    state: result.state === "already_ingested" ? (run.status === "ingested" ? "ingested" : "failed") : result.state,
    status: run.status,
    postsCreated: run.postsCreated ?? 0,
    snapshotsCreated: run.snapshotsCreated ?? 0,
    error: run.error,
  })
}
