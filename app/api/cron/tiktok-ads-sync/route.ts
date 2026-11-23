import { after, NextResponse, type NextRequest } from "next/server"

import { isAuthorizedCron } from "@/lib/cron/auth"
import { tiktokAdsSync } from "@/lib/jobs/tiktok-ads-sync"
import { runJob } from "@/lib/jobs/run-job"

export const maxDuration = 300

// Schedulers give up waiting after a few seconds (pg_net: 10s), so the job is acknowledged at
// once and runs after the response. Its result lands in job_runs (Settings → Scheduled jobs).
// Add ?wait=1 to run it inline and get the summary back, e.g. from curl.
async function handle(request: NextRequest) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const work = () => runJob("tiktok-ads-sync", 15, () => tiktokAdsSync(new Date()))

  if (request.nextUrl.searchParams.get("wait") === "1") {
    try {
      return NextResponse.json(await work())
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Job failed" },
        { status: 500 }
      )
    }
  }

  after(async () => {
    // Failures are recorded in job_runs by runJob itself.
    await work().catch(() => undefined)
  })
  return NextResponse.json({ accepted: true }, { status: 202 })
}

// GET for Vercel Cron, POST for Supabase Cron (pg_net).
export { handle as GET, handle as POST }
