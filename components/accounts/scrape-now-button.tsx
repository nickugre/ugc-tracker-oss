"use client"

import { RefreshCwIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { scrapeNow } from "@/lib/actions/scrape"

type Phase = "idle" | "starting" | "running" | "ingesting"

const LABEL: Record<Phase, string> = {
  idle: "Scrape now",
  starting: "Starting…",
  running: "Scraping…",
  ingesting: "Saving…",
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Starts a scrape and follows it to the end by polling the run endpoint (a plain GET route, not
// a Server Action, because actions are queued one at a time per client). The same endpoint
// ingests the results once Apify is done, which is why this also works on localhost.
export function ScrapeNowButton({ accountId, handle, disabled }: { accountId: string; handle: string; disabled?: boolean }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("idle")

  async function start() {
    setPhase("starting")
    const result = await scrapeNow({ accountIds: [accountId] })
    if (!result.ok) {
      toast.error(result.error)
      setPhase("idle")
      return
    }
    setPhase("running")
    try {
      for (const run of result.data.runs) {
        // Up to ~10 minutes; runs for a single profile usually finish within one.
        for (let attempt = 0; attempt < 200; attempt++) {
          await sleep(3000)
          const response = await fetch(`/api/scrape-runs/${run.id}`, { cache: "no-store" })
          const status = (await response.json()) as {
            state: string
            postsCreated: number
            snapshotsCreated: number
            error: string | null
          }
          if (status.state === "busy") setPhase("ingesting")
          if (status.state === "ingested") {
            toast.success(
              `@${handle}: ${status.postsCreated} new ${status.postsCreated === 1 ? "video" : "videos"}, ${status.snapshotsCreated} snapshots`
            )
            break
          }
          if (status.state === "failed") {
            toast.error(`@${handle}: ${status.error ?? "the scrape failed"}`)
            break
          }
        }
      }
    } catch {
      toast.error("Lost contact with the scrape. It keeps running and will be picked up within the hour.")
    }
    setPhase("idle")
    router.refresh()
  }

  return (
    <Button size="sm" variant="outline" disabled={disabled || phase !== "idle"} onClick={start}>
      <RefreshCwIcon className={phase === "idle" ? undefined : "animate-spin"} />
      {LABEL[phase]}
    </Button>
  )
}
