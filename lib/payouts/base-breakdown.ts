import type { Platform } from "@/db/schema/enums"

import { computeBase, type CreatorPayout } from "./engine"
import { expectedQuota, quotaPerPlatform } from "./rules"
import type { BaseType, CampaignRules, QuotaScope } from "./types"

// The part of a creator's terms that decides the base, already converted to one payout cycle.
// Stored with a finalized line, so a frozen cycle explains itself with the terms it was paid on.
export type BaseTerms = {
  type: BaseType
  amountCents: number
  prorate: boolean
  // Posts expected in the cycle in total, and on each platform when the quota is per platform.
  quota: number | null
  quotaPerPlatform: number | null
  // Missing from lines finalized before it was stored; those are per_platform or total, which
  // quotaPerPlatform tells apart.
  quotaScope?: QuotaScope
}

export function baseTermsFor(rules: CampaignRules, cycleDays: number): BaseTerms {
  return {
    type: rules.base.type,
    amountCents: rules.base.amountCents,
    prorate: rules.base.prorate,
    quota: expectedQuota(rules, cycleDays),
    quotaPerPlatform: quotaPerPlatform(rules, cycleDays),
    quotaScope: rules.quota.scope,
  }
}

export type BaseBreakdown = {
  kind: "none" | "per_video" | "fixed_retainer" | "prorated_retainer"
  // The retainer, or the price of one video.
  amountCents: number
  // The platform with the most posts sets the count (best_platform quota).
  bestPlatformCounts: boolean
  platforms: { platform: Platform; published: number; counted: number; quota: number | null; missing: number | null }[]
  counted: number
  quota: number | null
  // Posts still to publish for the full retainer; null when there is nothing to reach.
  missing: number | null
  // What the posts earned, and what is paid after the campaign's total cap.
  earnedCents: number
  paidCents: number
}

// Where a creator's base comes from, in the engine's own numbers: the counts are the payout's,
// and the amount is computed by the same function the engine uses.
export function explainBase(terms: BaseTerms, payout: CreatorPayout): BaseBreakdown {
  const prorated =
    (terms.type === "monthly_retainer" || terms.type === "weekly_retainer") &&
    terms.prorate &&
    terms.quota !== null &&
    terms.quota > 0
  const kind =
    terms.type === "none" ? "none" : terms.type === "per_video" ? "per_video" : prorated ? "prorated_retainer" : "fixed_retainer"

  const bestPlatformCounts = terms.quotaScope === "best_platform"
  const names = new Set([...Object.keys(payout.publishedByPlatform), ...Object.keys(payout.deliveredByPlatform)])
  const platforms = ([...names] as Platform[]).map((platform) => {
    const published = payout.publishedByPlatform[platform] ?? 0
    const counted = payout.deliveredByPlatform[platform] ?? 0
    const quota = terms.quotaPerPlatform
    // With the best platform counting, a platform behind the best one is not "to go": more posts
    // there would not change the pay.
    const missing = quota === null || bestPlatformCounts ? null : Math.max(0, quota - counted)
    return { platform, published, counted, quota, missing }
  })

  return {
    kind,
    amountCents: terms.amountCents,
    bestPlatformCounts,
    platforms,
    counted: payout.postsDelivered,
    quota: terms.quota,
    missing: prorated ? Math.max(0, terms.quota! - payout.postsDelivered) : null,
    earnedCents: computeBase({ base: terms }, payout.postsDelivered, terms.quota),
    paidCents: payout.baseCents,
  }
}
