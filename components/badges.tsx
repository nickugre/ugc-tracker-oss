import { cn } from "cn"
import { TriangleAlertIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DisplayStatus, Platform } from "@/db/schema/enums"
import { PLATFORM_LABELS, PLATFORM_SHORT } from "@/lib/format"

const pill =
  "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset"

// Soft tints: the status is readable at a glance without shouting.
const STATUS_STYLES: Record<DisplayStatus, string> = {
  open: "bg-blue-50 text-blue-700 ring-blue-600/15",
  locked: "bg-amber-50 text-amber-800 ring-amber-600/20",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  excluded: "bg-zinc-100 text-zinc-500 ring-zinc-500/15",
}

const STATUS_LABELS: Record<DisplayStatus, string> = {
  open: "Open",
  locked: "Locked",
  paid: "Paid",
  excluded: "Excluded",
}

// What each status means for the money, shown on hover.
export const STATUS_HELP: Record<DisplayStatus, string> = {
  open: "Still counting. The video is inside its view window (14 days unless changed), or the window has just ended and the final count is being fetched. It locks by itself; nothing is payable yet.",
  locked:
    "The view window is over and the count is frozen. This locked number, minus any paid views, is what the bonus is calculated on. Waiting for a payout.",
  paid: "Part of a payout that was marked as paid. Its numbers can no longer be changed.",
  excluded:
    "Left out by a person: it counts toward neither the base quota nor bonuses. It can be included again from the video's page.",
}

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <Tooltip>
      {/* A span, not a button: a click still reaches the row and opens the video. */}
      <TooltipTrigger render={<span className={cn(pill, "cursor-help", STATUS_STYLES[status], className)} />}>
        <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
        {STATUS_LABELS[status]}
      </TooltipTrigger>
      <TooltipContent className="block max-w-72 leading-relaxed">{STATUS_HELP[status]}</TooltipContent>
    </Tooltip>
  )
}

const TONES = {
  neutral: "bg-zinc-100 text-zinc-600 ring-zinc-500/15",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
} as const

export function ToneBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof TONES
  className?: string
  children: React.ReactNode
}) {
  return <span className={cn(pill, TONES[tone], className)}>{children}</span>
}

export function PlatformBadge({
  platform,
  showLabel = true,
}: {
  platform: Platform
  showLabel?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span
        className="flex h-4.5 min-w-6 items-center justify-center rounded bg-zinc-100 px-1 text-[10px] font-semibold tracking-wide text-zinc-600"
        title={PLATFORM_LABELS[platform]}
      >
        {PLATFORM_SHORT[platform]}
      </span>
      {showLabel ? PLATFORM_LABELS[platform] : null}
    </span>
  )
}

// Why a video is waiting for a person. Also shown in full on the video's page.
export const REVIEW_TEXT: Record<string, string> = {
  late_discovery:
    "Found after its window had closed, and it carries an ad marker, so it was not locked automatically. Enter the paid views under Spark (or leave Spark off if it was never boosted), then press Lock now.",
  unavailable: "The video could not be found on the last scrapes. It may be deleted or private.",
  views_decreased: "The platform removed views between two scrapes around the window end.",
  lock_fallback: "No count from soon after the window end. Locked from the last count before it, or estimated with a count that came late.",
  spark_no_paid_data: "Boosted inside the window, but there are no paid-view numbers to subtract yet.",
  paid_views_changed_after_payment: "TikTok restated paid views after this video was paid.",
}

export function NeedsReviewIcon({ reason }: { reason?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
        <TriangleAlertIcon className="size-3.5 text-orange-500" aria-label="Needs review" />
      </TooltipTrigger>
      <TooltipContent className="block max-w-72 leading-relaxed">
        <span className="font-medium">Needs review, not paid until someone has looked. </span>
        {(reason && REVIEW_TEXT[reason]) ?? ""}
      </TooltipContent>
    </Tooltip>
  )
}

export function SparkBadge() {
  return <ToneBadge tone="violet">Spark</ToneBadge>
}
