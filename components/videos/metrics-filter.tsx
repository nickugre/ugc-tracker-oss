"use client"

import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { amountToText, parseAmount, parsePercent } from "@/lib/amount-input"
import { VIDEO_METRICS, type NumberRange, type VideoMetric } from "@/lib/search-params/videos"

export type MetricRanges = Record<VideoMetric, NumberRange | null>

const METRIC_LABELS: Record<VideoMetric, string> = {
  views: "Views",
  views24h: "Views, last 24h",
  engagement: "Engagement %",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
}

type Draft = Record<VideoMetric, { min: string; max: string }>

const parseBound = (metric: VideoMetric, text: string) =>
  metric === "engagement" ? parsePercent(text) : parseAmount(text)

const boundToText = (metric: VideoMetric, n: number | null) =>
  metric === "engagement" ? (n == null ? "" : String(n)) : amountToText(n)

function toDraft(value: MetricRanges) {
  return Object.fromEntries(
    VIDEO_METRICS.map((metric) => [
      metric,
      {
        min: boundToText(metric, value[metric]?.min ?? null),
        max: boundToText(metric, value[metric]?.max ?? null),
      },
    ])
  ) as Draft
}

export function MetricsFilter({
  value,
  onChange,
}: {
  value: MetricRanges
  onChange: (next: MetricRanges) => void
}) {
  const [open, setOpen] = useState(false)
  // What is typed in the popover. It only reaches the URL on Apply, so a half-typed number
  // never re-queries the list.
  const [draft, setDraft] = useState(() => toDraft(value))
  const activeCount = VIDEO_METRICS.filter((metric) => value[metric]).length

  const invalid = (metric: VideoMetric, bound: "min" | "max") =>
    Number.isNaN(parseBound(metric, draft[metric][bound]))
  const anyInvalid = VIDEO_METRICS.some((metric) => invalid(metric, "min") || invalid(metric, "max"))

  function apply() {
    if (anyInvalid) return
    const next = {} as MetricRanges
    for (const metric of VIDEO_METRICS) {
      let min = parseBound(metric, draft[metric].min)
      let max = parseBound(metric, draft[metric].max)
      // "50k – 10k" can only mean the range between the two.
      if (min != null && max != null && min > max) [min, max] = [max, min]
      next[metric] = min == null && max == null ? null : { min, max }
    }
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(toDraft(value))
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" className="font-normal" />}>
        <SlidersHorizontalIcon className="text-muted-foreground" />
        Metrics
        {activeCount ? (
          <span className="rounded bg-muted px-1 text-xs font-medium tabular-nums">{activeCount}</span>
        ) : null}
        <ChevronDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-x-2 gap-y-1.5">
            {VIDEO_METRICS.map((metric) => (
              <div key={metric} className="contents">
                <span className="text-[13px]">{METRIC_LABELS[metric]}</span>
                {(["min", "max"] as const).map((bound) => (
                  <Input
                    key={bound}
                    className="h-7 px-2 text-[13px] tabular-nums md:text-[13px]"
                    inputMode="decimal"
                    placeholder={bound === "min" ? "Min" : "Max"}
                    aria-label={`${METRIC_LABELS[metric]}, ${bound === "min" ? "minimum" : "maximum"}`}
                    aria-invalid={invalid(metric, bound) || undefined}
                    value={draft[metric][bound]}
                    onChange={(event) =>
                      setDraft({ ...draft, [metric]: { ...draft[metric], [bound]: event.target.value } })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Shorthand works: 10k, 1.5m. Leave a side empty for no limit.</p>
          <div className="flex justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setDraft(toDraft({} as MetricRanges))}
            >
              Reset
            </Button>
            <Button type="submit" size="sm" disabled={anyInvalid}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
