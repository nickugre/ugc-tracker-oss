import { after, NextResponse, type NextRequest } from "next/server"

import { safeEqual } from "@/lib/cron/auth"
import { env } from "@/lib/env"
import { ingestRun } from "@/lib/ingest/ingest-run"

export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Apify calls this when a run we started reaches a terminal state. The payload is never trusted:
// we only take our own run id from the URL, and ingestRun() re-reads the run from Apify with our
// token. A forged call can therefore do no more than make us re-check a run we started.
export async function POST(request: NextRequest) {
  const secret = env().APIFY_WEBHOOK_SECRET
  const token = request.nextUrl.searchParams.get("token") ?? ""
  if (!secret || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const runId = request.nextUrl.searchParams.get("run") ?? ""
  if (!UUID.test(runId)) return NextResponse.json({ error: "Bad request" }, { status: 400 })

  // Answer immediately (Apify retries slow webhooks) and ingest after the response is sent.
  after(async () => {
    await ingestRun(runId)
  })
  return NextResponse.json({ accepted: true }, { status: 202 })
}
