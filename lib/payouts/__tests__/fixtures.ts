import { type Cycle, getCycleByStart } from "../cycles"
import type { CreatorPayoutInput, EnginePost } from "../engine"
import type { CampaignRules, Milestone, Platform } from "../types"

export const NY = "America/New_York"

export const CONTRACT_MILESTONES: Milestone[] = [
  { views: 20_000, amountCents: 2_000 },
  { views: 50_000, amountCents: 5_000 },
  { views: 100_000, amountCents: 10_000 },
  { views: 500_000, amountCents: 50_000 },
  { views: 1_000_000, amountCents: 100_000 },
]

export type RulesPatch = {
  [K in keyof CampaignRules]?: CampaignRules[K] extends unknown[] | string | number
    ? CampaignRules[K]
    : Partial<CampaignRules[K]>
}

// THE REAL CONTRACT: $1,000 monthly retainer for 60 TikTok + 60 Instagram posts, pro-rated, plus
// one non-stacking milestone bonus for the creator's best video, capped at $1,000 a month.
export function contractRules(patch: RulesPatch = {}): CampaignRules {
  return {
    cycleType: patch.cycleType ?? "monthly",
    timezone: patch.timezone ?? NY,
    weekStartsOn: patch.weekStartsOn ?? 1,
    platforms: patch.platforms ?? ["tiktok", "instagram"],
    quota: { count: 60, period: "month", scope: "per_platform", ...patch.quota },
    base: { type: "monthly_retainer", amountCents: 100_000, prorate: true, ...patch.base },
    bonus: {
      type: "milestone",
      cpmRateCents: null,
      minViews: null,
      minViewsMode: "qualify",
      milestones: CONTRACT_MILESTONES.map((m) => ({ ...m })),
      milestoneScope: "creator_cycle_best",
      ...patch.bonus,
    },
    caps: {
      perVideoBonusCents: null,
      perCreatorCycleBonusCents: 100_000,
      perCreatorCycleTotalCents: null,
      ...patch.caps,
    },
  }
}

export const JULY: Cycle = getCycleByStart("monthly", NY, 1, "2026-07-01")
export const AUGUST: Cycle = getCycleByStart("monthly", NY, 1, "2026-08-01")
export const AUGUST_WEEK: Cycle = getCycleByStart("weekly", NY, 1, "2026-08-10")

const PREFIX: Record<Platform, string> = {
  tiktok: "tt",
  instagram: "ig",
  youtube: "yt",
  facebook: "fb",
  snapchat: "sc",
}

// `count` posts on one platform, one hour apart from `from` (default: inside August 2026).
export function posts(
  platform: Platform,
  count: number,
  options: { views?: number; from?: string; tag?: string } = {}
): EnginePost[] {
  const start = new Date(options.from ?? "2026-08-03T14:00:00Z").getTime()
  return Array.from({ length: count }, (_, i) => ({
    id: `${options.tag ?? PREFIX[platform]}-${String(i + 1).padStart(3, "0")}`,
    platform,
    postedAt: new Date(start + i * 3_600_000),
    payableViews: options.views ?? 0,
  }))
}

export function post(
  id: string,
  payableViews: number,
  options: { platform?: Platform; postedAt?: string } = {}
): EnginePost {
  return {
    id,
    platform: options.platform ?? "tiktok",
    postedAt: new Date(options.postedAt ?? "2026-07-20T14:00:00Z"),
    payableViews,
  }
}

export function payoutInput(patch: Partial<CreatorPayoutInput> = {}): CreatorPayoutInput {
  return {
    rules: contractRules(),
    cycle: AUGUST,
    publishedPosts: [],
    bonusPosts: [],
    priorMilestonePaidCents: 0,
    adjustmentsCents: 0,
    ...patch,
  }
}

// Small deterministic PRNG (mulberry32) for the property-style tests: no extra dependency, and a
// failure can be replayed from the seed.
export function prng(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability,
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    },
  }
}
