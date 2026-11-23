import { formatCents } from "@/lib/money/cents"

// How well the money spent on creators turned into views. Free of any database import, like the
// engine: lib/queries/campaign-performance.ts loads the rows and this file does the arithmetic.

// One video as these figures see it. `organicViews` already has the paid (ad) views removed.
export type PerformancePost = {
  postedAt: Date
  creatorId: string | null
  organicViews: number
  // Likes + comments + shares + saves, the same sum the engagement rate of a video is built on.
  engagements: number
}

export type PerformanceFigures = {
  videos: number
  organicViews: number
  engagements: number
  spendCents: number
  // Spend per 1,000 organic views, per video and per engagement. These are ratios for display,
  // not amounts anyone is paid, so they keep their fraction of a cent. null = nothing to divide by.
  ecpmCents: number | null
  perVideoCents: number | null
  perEngagementCents: number | null
  avgViews: number | null
  // Half the videos are above it. One viral video moves the average a lot and the median barely.
  medianViews: number | null
  engagementRate: number | null
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function performanceFigures(posts: PerformancePost[], spendCents: number): PerformanceFigures {
  const organicViews = posts.reduce((sum, p) => sum + p.organicViews, 0)
  const engagements = posts.reduce((sum, p) => sum + p.engagements, 0)
  return {
    videos: posts.length,
    organicViews,
    engagements,
    spendCents,
    ecpmCents: ratio(spendCents * 1000, organicViews),
    perVideoCents: ratio(spendCents, posts.length),
    perEngagementCents: ratio(spendCents, engagements),
    avgViews: ratio(organicViews, posts.length),
    medianViews: median(posts.map((p) => p.organicViews).sort((a, b) => a - b)),
    engagementRate: ratio(engagements, organicViews),
  }
}

// What one cycle contributes to the spend. A finalized cycle counts as stored. Of the cycles that
// are still a live preview only the newest counts its bonuses: every preview pools ALL videos
// that are locked and not settled yet, so the same bonus shows up in each of them, and adding
// them up would count it once per open cycle. Base pay and adjustments belong to one cycle only.
export function cycleSpendCents(
  payout: { baseCents: number; bonusCents: number; adjustmentsCents: number },
  options: { stored: boolean; newestPreview: boolean; insideCampaignDates: boolean }
): number {
  if (options.stored) return payout.baseCents + payout.bonusCents + payout.adjustmentsCents
  // A fixed retainer would otherwise keep accruing in previews long after the campaign ended.
  const base = options.insideCampaignDates ? payout.baseCents : 0
  return base + (options.newestPreview ? payout.bonusCents : 0) + payout.adjustmentsCents
}

const smallRates = new Map<string, Intl.NumberFormat>()

// "$8.33", and under a dollar "$0.024": for a cost per engagement the third decimal is most of
// the number.
export function formatRate(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null || !Number.isFinite(cents)) return "—"
  if (Math.abs(cents) >= 100) return formatCents(Math.round(cents), currency)
  let formatter = smallRates.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    })
    smallRates.set(currency, formatter)
  }
  return formatter.format(cents === 0 ? 0 : cents / 100)
}
