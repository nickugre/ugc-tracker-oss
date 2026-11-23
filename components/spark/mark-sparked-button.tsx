"use client"

import { ZapIcon } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useSelection } from "@/components/videos/selection"
import { bulkMarkSparked } from "@/lib/actions/posts"

// Moves the ticked suggestions to "Sparked". Only shown to act on ticked rows: marking every
// suggestion at once is never what is meant.
export function MarkSparkedButton({ ids }: { ids: string[] }) {
  const { selected, clear } = useSelection()
  const [pending, startTransition] = useTransition()
  const picked = ids.filter((id) => selected.has(id))

  function mark() {
    startTransition(async () => {
      const result = await bulkMarkSparked({ ids: picked })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const { updated, skipped } = result.data
      toast.success(
        `${updated} ${updated === 1 ? "video" : "videos"} marked as sparked` +
          (skipped ? `, ${skipped} skipped (already paid)` : "")
      )
      clear()
    })
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={mark}
      disabled={picked.length === 0 || pending}
      title={picked.length === 0 ? "Tick the videos you have boosted" : undefined}
    >
      <ZapIcon />
      {picked.length ? `Mark ${picked.length} as sparked` : "Mark as sparked"}
    </Button>
  )
}
