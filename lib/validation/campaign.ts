import { z } from "zod"

import { PLATFORMS } from "@/db/schema/enums"
import { isValidTimeZone } from "@/lib/time-zones"

const cents = z.number().int().min(0).max(100_000_000)
const nullableCents = cents.nullable()

export const milestoneSchema = z.object({
  views: z.number().int().positive("Views must be above 0").max(10_000_000_000),
  amountCents: cents,
})

// One schema for the campaign form and for the server action that saves it. Money is integer
// cents everywhere; the form's MoneyInput converts what the user types.
export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1, "Give the campaign a name").max(120),
    status: z.enum(["draft", "active", "ended"]),
    startDate: z.iso.date("Pick a start date"),
    endDate: z.iso.date().nullable(),
    timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
    platforms: z.array(z.enum(PLATFORMS)).min(1, "Enable at least one platform"),

    quotaCount: z.number().int().positive().max(10_000).nullable(),
    quotaPeriod: z.enum(["week", "month"]),
    quotaScope: z.enum(["per_platform", "total", "best_platform"]),

    defaultWindowDays: z.number().int().min(1).max(365),

    baseType: z.enum(["none", "per_video", "weekly_retainer", "monthly_retainer"]),
    baseAmountCents: cents,
    prorateBase: z.boolean(),

    bonusType: z.enum(["none", "cpm", "milestone", "hybrid"]),
    cpmRateCents: nullableCents,
    minViewsForBonus: z.number().int().min(0).nullable(),
    cpmMinViewsMode: z.enum(["qualify", "excess"]),
    milestones: z.array(milestoneSchema).max(12),
    milestoneScope: z.enum(["creator_cycle_best", "creator_campaign_lifetime", "per_video"]),
    perVideoBonusCapCents: nullableCents,
    perCreatorCycleCapCents: nullableCents,
    perCreatorCycleTotalCapCents: nullableCents,
    usageRightsNote: z.string().trim().max(2000).nullable(),

    cycleType: z.enum(["weekly", "monthly"]),
    weekStartsOn: z.number().int().min(0).max(6),
    paydayRule: z.enum(["last_day_of_month", "end_of_cycle"]),
    currency: z.literal("USD"),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before the start date" })
    }
    if (v.baseType === "weekly_retainer" && v.cycleType !== "weekly") {
      ctx.addIssue({
        code: "custom",
        path: ["cycleType"],
        message: "A weekly retainer needs a weekly payout cycle",
      })
    }
    if (v.baseType === "monthly_retainer" && v.cycleType !== "monthly") {
      ctx.addIssue({
        code: "custom",
        path: ["cycleType"],
        message: "A monthly retainer needs a monthly payout cycle",
      })
    }
    if (v.baseType !== "none" && v.baseAmountCents <= 0) {
      ctx.addIssue({ code: "custom", path: ["baseAmountCents"], message: "Enter the base amount" })
    }
    const isRetainer = v.baseType === "weekly_retainer" || v.baseType === "monthly_retainer"
    if (isRetainer && v.prorateBase && !v.quotaCount) {
      ctx.addIssue({
        code: "custom",
        path: ["quotaCount"],
        message: "Set a posting quota so the base can be pro-rated",
      })
    }
    const usesCpm = v.bonusType === "cpm" || v.bonusType === "hybrid"
    if (usesCpm && !v.cpmRateCents) {
      ctx.addIssue({ code: "custom", path: ["cpmRateCents"], message: "Enter the CPM rate" })
    }
    const usesMilestones = v.bonusType === "milestone" || v.bonusType === "hybrid"
    if (usesMilestones && v.milestones.length === 0) {
      ctx.addIssue({ code: "custom", path: ["milestones"], message: "Add at least one milestone" })
    }
    const seen = new Set<number>()
    v.milestones.forEach((m, i) => {
      if (seen.has(m.views)) {
        ctx.addIssue({
          code: "custom",
          path: ["milestones", i, "views"],
          message: "Two milestones have the same view count",
        })
      }
      seen.add(m.views)
    })
  })

export type CampaignInput = z.infer<typeof campaignInputSchema>

export const CONTRACT_MILESTONES = [
  { views: 20_000, amountCents: 2_000 },
  { views: 50_000, amountCents: 5_000 },
  { views: 100_000, amountCents: 10_000 },
  { views: 500_000, amountCents: 50_000 },
  { views: 1_000_000, amountCents: 100_000 },
]

export const DEFAULT_USAGE_RIGHTS =
  "Organic posting on the brand account is included. Spark Ads rights are included on brand-owned accounts. Views from Spark, Promote or any paid boost are not payable."

// A new campaign starts from a typical contract so you only adjust what differs.
export function defaultCampaignInput(today: string): CampaignInput {
  return {
    name: "",
    status: "draft",
    startDate: today,
    endDate: null,
    timezone: "America/New_York",
    platforms: ["tiktok", "instagram"],
    quotaCount: 60,
    quotaPeriod: "month",
    quotaScope: "per_platform",
    defaultWindowDays: 14,
    baseType: "monthly_retainer",
    baseAmountCents: 100_000,
    prorateBase: true,
    bonusType: "milestone",
    cpmRateCents: null,
    minViewsForBonus: null,
    cpmMinViewsMode: "qualify",
    milestones: CONTRACT_MILESTONES,
    milestoneScope: "creator_cycle_best",
    perVideoBonusCapCents: null,
    perCreatorCycleCapCents: 100_000,
    perCreatorCycleTotalCapCents: null,
    usageRightsNote: DEFAULT_USAGE_RIGHTS,
    cycleType: "monthly",
    weekStartsOn: 1,
    paydayRule: "last_day_of_month",
    currency: "USD",
  }
}

export const campaignCreatorTermsSchema = z.object({
  campaignId: z.uuid(),
  creatorId: z.uuid(),
  baseAmountCentsOverride: nullableCents,
  quotaCountOverride: z.number().int().positive().max(10_000).nullable(),
  cycleCapCentsOverride: nullableCents,
})
export type CampaignCreatorTerms = z.infer<typeof campaignCreatorTermsSchema>
