"use client"

import { cn } from "cn"
import { useQueryStates } from "nuqs"
import { useTransition } from "react"

import { overviewParsers, TOP_VIDEO_METRICS } from "@/lib/search-params/overview"

const LABELS = { views: "Views", engagement: "Engagement" } as const

// Switches what the "Top videos" panel ranks by. Lives in the URL with the other Overview
// filters, so a shared link opens on the same ranking.
export function TopVideosMetric() {
  const [pending, startTransition] = useTransition()
  const [params, setParams] = useQueryStates(overviewParsers, { shallow: false, startTransition })

  return (
    <div
      className="flex shrink-0 rounded-lg border p-0.5 data-[pending=true]:opacity-70"
      role="group"
      aria-label="Rank top videos by"
      data-pending={pending}
    >
      {TOP_VIDEO_METRICS.map((metric) => (
        <button
          key={metric}
          type="button"
          aria-pressed={params.top === metric}
          onClick={() => setParams({ top: metric })}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
            params.top === metric && "bg-muted font-medium text-foreground"
          )}
        >
          {LABELS[metric]}
        </button>
      ))}
    </div>
  )
}
