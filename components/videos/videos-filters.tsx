"use client"

import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react"
import { useQueryStates } from "nuqs"
import { useEffect, useState, useTransition } from "react"

import { SimpleSelect } from "@/components/form/simple-select"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { MetricsFilter, type MetricRanges } from "@/components/videos/metrics-filter"
import { PostedFilter } from "@/components/videos/posted-filter"
import { DISPLAY_STATUSES, PLATFORMS } from "@/db/schema/enums"
import { PLATFORM_LABELS } from "@/lib/format"
import { VIDEO_METRICS, videosParsers } from "@/lib/search-params/videos"

type Option = { id: string; name: string }

const NO_METRICS = Object.fromEntries(VIDEO_METRICS.map((metric) => [metric, null])) as MetricRanges

const STATUS_LABELS: Record<(typeof DISPLAY_STATUSES)[number], string> = {
  open: "Open",
  locked: "Locked",
  paid: "Paid",
  excluded: "Excluded",
}

function MultiFilter<V extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: V; label: string }[]
  selected: V[]
  onChange: (next: V[]) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="font-normal" />}
      >
        {label}
        {selected.length ? (
          <span className="rounded bg-muted px-1 text-xs font-medium tabular-nums">{selected.length}</span>
        ) : null}
        <ChevronDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            closeOnClick={false}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...selected, option.value] : selected.filter((v) => v !== option.value)
              )
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function VideosFilters({
  campaigns,
  creators,
}: {
  campaigns: Option[]
  creators: Option[]
}) {
  const [pending, startTransition] = useTransition()
  // shallow: false → the URL change re-runs the server page, which re-queries with the filters.
  const [params, setParams] = useQueryStates(videosParsers, { shallow: false, startTransition })
  const [search, setSearch] = useState(params.q)

  // Debounce typing so the list is not re-queried on every keystroke.
  useEffect(() => {
    if (search === params.q) return
    const timer = setTimeout(() => setParams({ q: search, page: 1 }), 300)
    return () => clearTimeout(timer)
  }, [search, params.q, setParams])

  const metrics = Object.fromEntries(VIDEO_METRICS.map((metric) => [metric, params[metric]])) as MetricRanges
  const active =
    Boolean(params.q) ||
    params.status.length > 0 ||
    params.platform.length > 0 ||
    Boolean(params.campaign || params.creator || params.account || params.flag || params.from || params.to) ||
    VIDEO_METRICS.some((metric) => params[metric])

  return (
    <div
      className="flex flex-wrap items-center gap-2 data-[pending=true]:opacity-70"
      data-pending={pending}
    >
      <InputGroup className="h-7 w-56">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Caption, handle or creator"
          aria-label="Search videos"
        />
      </InputGroup>
      <MultiFilter
        label="Status"
        options={DISPLAY_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        selected={params.status}
        onChange={(status) => setParams({ status, page: 1 })}
      />
      <MultiFilter
        label="Platform"
        options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
        selected={params.platform}
        onChange={(platform) => setParams({ platform, page: 1 })}
      />
      <SimpleSelect
        size="sm"
        className="w-44"
        value={params.campaign}
        onValueChange={(campaign) => setParams({ campaign, page: 1 })}
        options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
        noneLabel="All campaigns"
        placeholder="All campaigns"
      />
      <SimpleSelect
        size="sm"
        className="w-40"
        value={params.creator}
        onValueChange={(creator) => setParams({ creator, page: 1 })}
        options={creators.map((c) => ({ value: c.id, label: c.name }))}
        noneLabel="All creators"
        placeholder="All creators"
      />
      <SimpleSelect
        size="sm"
        className="w-36"
        value={params.flag}
        onValueChange={(flag) => setParams({ flag, page: 1 })}
        options={[
          { value: "closing", label: "Closing in 48h" },
          { value: "review", label: "Needs review" },
          { value: "spark", label: "Spark / paid" },
        ]}
        noneLabel="Any flag"
        placeholder="Any flag"
      />
      <PostedFilter
        from={params.from}
        to={params.to}
        onChange={({ from, to }) => setParams({ from, to, page: 1 })}
      />
      <MetricsFilter value={metrics} onChange={(next) => setParams({ ...next, page: 1 })} />
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            setSearch("")
            setParams({
              q: "",
              status: [],
              platform: [],
              campaign: null,
              creator: null,
              account: null,
              flag: null,
              from: null,
              to: null,
              ...NO_METRICS,
              page: 1,
            })
          }}
        >
          <XIcon />
          Clear
        </Button>
      ) : null}
    </div>
  )
}
