"use client"

import { cn } from "cn"
import { ChevronDownIcon, XIcon } from "lucide-react"
import { useQueryStates } from "nuqs"
import { useTransition } from "react"

import { SimpleSelect } from "@/components/form/simple-select"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DISPLAY_STATUSES, PLATFORMS } from "@/db/schema/enums"
import { PLATFORM_LABELS } from "@/lib/format"
import { overviewParsers, RANGE_PRESETS } from "@/lib/search-params/overview"

type Option = { id: string; name: string }

const RANGE_LABELS = { "7d": "7 days", "30d": "30 days", "90d": "90 days", campaign: "Campaign", all: "All time" } as const
const STATUS_LABELS = { open: "Open", locked: "Locked", paid: "Paid", excluded: "Excluded" } as const

function Multi<V extends string>({
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
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="font-normal" />}>
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
              onChange(checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// One filter row above everything it scopes: the date range first, then the dimensions.
export function OverviewFilters({
  months,
  campaigns,
  creators,
  accounts,
}: {
  // Newest first; `id` is YYYY-MM.
  months: Option[]
  campaigns: Option[]
  creators: Option[]
  accounts: Option[]
}) {
  const [pending, startTransition] = useTransition()
  const [params, setParams] = useQueryStates(overviewParsers, { shallow: false, startTransition })
  const active =
    Boolean(params.campaign || params.creator || params.account) ||
    params.platform.length > 0 ||
    params.status.length > 0

  return (
    <div className="flex flex-wrap items-center gap-2 data-[pending=true]:opacity-70" data-pending={pending}>
      <div className="flex rounded-lg border p-0.5" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={!params.month && params.range === preset}
            onClick={() => setParams({ range: preset, month: null })}
            className={cn(
              "rounded-md px-2.5 py-1 text-[0.8rem] text-muted-foreground transition-colors hover:text-foreground",
              !params.month && params.range === preset && "bg-muted font-medium text-foreground"
            )}
          >
            {RANGE_LABELS[preset]}
          </button>
        ))}
      </div>
      <SimpleSelect
        size="sm"
        className="w-40"
        value={params.month}
        onValueChange={(month) => setParams({ month })}
        options={months.map((m) => ({ value: m.id, label: m.name }))}
        noneLabel="Any month"
        placeholder="Month"
      />
      <SimpleSelect
        size="sm"
        className="w-44"
        value={params.campaign}
        onValueChange={(campaign) => setParams({ campaign })}
        options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
        noneLabel="All campaigns"
        placeholder="All campaigns"
      />
      <Multi
        label="Platform"
        options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
        selected={params.platform}
        onChange={(platform) => setParams({ platform })}
      />
      <SimpleSelect
        size="sm"
        className="w-40"
        value={params.creator}
        onValueChange={(creator) => setParams({ creator })}
        options={creators.map((c) => ({ value: c.id, label: c.name }))}
        noneLabel="All creators"
        placeholder="All creators"
      />
      <SimpleSelect
        size="sm"
        className="w-44"
        value={params.account}
        onValueChange={(account) => setParams({ account })}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        noneLabel="All accounts"
        placeholder="All accounts"
      />
      <Multi
        label="Status"
        options={DISPLAY_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        selected={params.status}
        onChange={(status) => setParams({ status })}
      />
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setParams({ campaign: null, creator: null, account: null, platform: [], status: [] })}
        >
          <XIcon />
          Clear
        </Button>
      ) : null}
    </div>
  )
}
