"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useSelection } from "@/components/videos/selection"
import { formatLinksForCopy, type LinkRow } from "@/lib/spark/links"

// Copies the links of the ticked videos, or of every listed video when none is ticked. Several
// creators' links are grouped under their names (lib/spark/links.ts).
export function CopyLinksButton({ rows }: { rows: (LinkRow & { id: string })[] }) {
  const { selected } = useSelection()
  const [copied, setCopied] = useState(false)
  const picked = rows.filter((row) => selected.has(row.id))
  const toCopy = picked.length ? picked : rows

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatLinksForCopy(toCopy))
      toast.success(`${toCopy.length} ${toCopy.length === 1 ? "link" : "links"} copied`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy. Your browser blocked access to the clipboard.")
    }
  }

  return (
    <Button size="sm" onClick={copy} disabled={rows.length === 0}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {picked.length ? `Copy ${picked.length} video ${picked.length === 1 ? "link" : "links"}` : "Copy video links"}
    </Button>
  )
}
