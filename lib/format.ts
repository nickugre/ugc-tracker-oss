import type { Platform } from "@/db/schema/enums"

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  snapchat: "Snapchat",
}

export const PLATFORM_SHORT: Record<Platform, string> = {
  tiktok: "TT",
  instagram: "IG",
  youtube: "YT",
  facebook: "FB",
  snapchat: "SC",
}

const integer = new Intl.NumberFormat("en-US")
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

export function formatNumber(n: number | null | undefined): string {
  return n == null ? "—" : integer.format(n)
}

// 1,234 → "1.2K". Use in dense tables; show the exact number in a title/tooltip.
export function formatCompact(n: number | null | undefined): string {
  return n == null ? "—" : compact.format(n)
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  return ratio == null || !Number.isFinite(ratio) ? "—" : `${(ratio * 100).toFixed(digits)}%`
}

export function formatDate(date: Date | string | null | undefined, timeZone = "UTC"): string {
  if (!date) return "—"
  const d = typeof date === "string" ? new Date(date.length === 10 ? `${date}T00:00:00Z` : date) : date
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: typeof date === "string" && date.length === 10 ? "UTC" : timeZone,
  }).format(d)
}

export function formatDateTime(date: Date | null | undefined, timeZone = "UTC"): string {
  if (!date) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date)
}

// "in 5h", "in 3d", "2d ago". `now` is passed in so server renders stay deterministic.
export function formatRelative(date: Date | null | undefined, now: Date): string {
  if (!date) return "—"
  const diffMs = date.getTime() - now.getTime()
  const abs = Math.abs(diffMs)
  const unit =
    abs < 3_600_000
      ? `${Math.max(1, Math.round(abs / 60_000))}m`
      : abs < 86_400_000
        ? `${Math.round(abs / 3_600_000)}h`
        : `${Math.round(abs / 86_400_000)}d`
  return diffMs >= 0 ? `in ${unit}` : `${unit} ago`
}

// Today's date as YYYY-MM-DD in a time zone.
export function todayInTimeZone(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now)
}
