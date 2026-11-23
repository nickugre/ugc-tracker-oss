// The payout engine's view of a campaign's terms. Deliberately free of any database import so
// the money maths stays pure; rules.ts maps a campaign row into this shape.

export type Platform = "tiktok" | "instagram" | "youtube" | "facebook" | "snapchat"

export type Milestone = { views: number; amountCents: number }

export type CycleType = "weekly" | "monthly"
export type QuotaPeriod = "week" | "month"
// per_platform: the count on each platform, and each is clamped on its own. total: one count over all
// platforms. best_platform: each video goes up on every platform and the platform with the most
// posts sets the count, so 60 on TikTok and 50 on Instagram deliver 60 of 60.
export type QuotaScope = "per_platform" | "total" | "best_platform"
export type BaseType = "none" | "per_video" | "weekly_retainer" | "monthly_retainer"
export type BonusType = "none" | "cpm" | "milestone" | "hybrid"
export type MinViewsMode = "qualify" | "excess"
export type MilestoneScope = "creator_cycle_best" | "creator_campaign_lifetime" | "per_video"

export type CampaignRules = {
  cycleType: CycleType
  // IANA time zone the cycles are cut in.
  timezone: string
  // 0 = Sunday … 6 = Saturday. Used by weekly cycles.
  weekStartsOn: number
  // Enabled platforms.
  platforms: Platform[]
  quota: { count: number | null; period: QuotaPeriod; scope: QuotaScope }
  base: { type: BaseType; amountCents: number; prorate: boolean }
  bonus: {
    type: BonusType
    // Cents per 1,000 views.
    cpmRateCents: number | null
    minViews: number | null
    // qualify: once the minimum is reached, ALL views pay. excess: only views above it pay.
    minViewsMode: MinViewsMode
    milestones: Milestone[]
    milestoneScope: MilestoneScope
  }
  caps: {
    perVideoBonusCents: number | null
    perCreatorCycleBonusCents: number | null
    perCreatorCycleTotalCents: number | null
  }
}

// Per-creator terms from campaign_creators. null / undefined = use the campaign's value.
export type CreatorOverrides = {
  baseAmountCents?: number | null
  quotaCount?: number | null
  cycleBonusCapCents?: number | null
}
