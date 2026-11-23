"use client"

import { cn } from "cn"
import { useQueryStates } from "nuqs"
import { useTransition } from "react"

import { SimpleSelect } from "@/components/form/simple-select"
import { SPARK_RANGES, sparkParsers } from "@/lib/search-params/spark"

const RANGE_LABELS = { "7d": "7 days", "14d": "14 days", "30d": "30 days", "90d": "90 days" } as const

// Posted-within range, then the creator: spark codes are asked for creator by creator, so
// picking one and copying their links is the usual way through this page.
export function SparkFilters({ creators }: { creators: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition()
  const [params, setParams] = useQueryStates(sparkParsers, { shallow: false, startTransition })

  return (
    <div className="flex flex-wrap items-center gap-2 data-[pending=true]:opacity-70" data-pending={pending}>
      <div className="flex rounded-lg border p-0.5" role="group" aria-label="Posted in the last">
        {SPARK_RANGES.map((range) => (
          <button
            key={range}
            type="button"
            aria-pressed={params.range === range}
            onClick={() => setParams({ range })}
            className={cn(
              "rounded-md px-2.5 py-1 text-[0.8rem] text-muted-foreground transition-colors hover:text-foreground",
              params.range === range && "bg-muted font-medium text-foreground"
            )}
          >
            {RANGE_LABELS[range]}
          </button>
        ))}
      </div>
      <SimpleSelect
        size="sm"
        className="w-44"
        value={params.creator}
        onValueChange={(creator) => setParams({ creator })}
        options={creators.map((c) => ({ value: c.id, label: c.name }))}
        noneLabel="All creators"
        placeholder="All creators"
      />
    </div>
  )
}
