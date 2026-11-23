"use client"

import { MessageSquareTextIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { readCommentsNow } from "@/lib/actions/spark"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Reads one video's comments on request and follows the run to its end, the same way as
// "Scrape now" (components/accounts/scrape-now-button.tsx): the polled endpoint also stores the
// results, so it works on localhost too.
export function ReadCommentsButton({ postId, again }: { postId: string; again: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    const result = await readCommentsNow({ postId })
    if (!result.ok) {
      toast.error(result.error)
      setBusy(false)
      return
    }
    try {
      // Up to ~5 minutes; a single video usually takes well under one.
      for (let attempt = 0; attempt < 100; attempt++) {
        await sleep(3000)
        const response = await fetch(`/api/scrape-runs/${result.data.runId}`, { cache: "no-store" })
        const status = (await response.json()) as { state: string; error: string | null }
        if (status.state === "ingested") {
          toast.success("Comments read")
          break
        }
        if (status.state === "failed") {
          toast.error(status.error ?? "The comments could not be read")
          break
        }
      }
    } catch {
      toast.error("Lost contact with the run. It keeps going and will be picked up within the hour.")
    }
    setBusy(false)
    router.refresh()
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={start}>
      <MessageSquareTextIcon />
      {busy ? "Reading…" : again ? "Read again" : "Read comments now"}
    </Button>
  )
}
