import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ToneBadge } from "@/components/badges"
import { CampaignAssignments } from "@/components/campaigns/campaign-assignments"
import { CampaignDelete } from "@/components/campaigns/campaign-delete"
import { CampaignForm } from "@/components/campaigns/campaign-form"
import { CampaignPerformance } from "@/components/campaigns/campaign-performance"
import { CycleView } from "@/components/payouts/cycle-view"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { TabNav } from "@/components/shell/tab-nav"
import { getCycleView } from "@/lib/payouts/service"
import { getCampaignPerformance } from "@/lib/queries/campaign-performance"
import { getCampaign, getCampaignAssignments } from "@/lib/queries/campaigns"
import { listCreatorOptions } from "@/lib/queries/creators"
import type { CampaignInput } from "@/lib/validation/campaign"

export const metadata: Metadata = { title: "Campaign" }

const TABS = ["settings", "people", "payout", "performance"] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function CampaignPage(props: PageProps<"/campaigns/[id]">) {
  const { id } = await props.params
  const { tab, period } = await props.searchParams
  const active = TABS.find((t) => t === tab) ?? "settings"

  const campaign = await getCampaign(id)
  if (!campaign) notFound()

  const now = new Date()
  const [assignments, creatorOptions, cycleView, performance] = await Promise.all([
    getCampaignAssignments(id),
    active === "people" ? listCreatorOptions() : Promise.resolve([]),
    active === "payout"
      ? getCycleView(id, typeof period === "string" && ISO_DATE.test(period) ? period : null, now)
      : Promise.resolve(null),
    active === "performance" ? getCampaignPerformance(id, now) : Promise.resolve(null),
  ])

  const formValues: CampaignInput = {
    name: campaign.name,
    status: campaign.status,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    timezone: campaign.timezone,
    platforms: campaign.platforms,
    quotaCount: campaign.quotaCount,
    quotaPeriod: campaign.quotaPeriod,
    quotaScope: campaign.quotaScope,
    defaultWindowDays: campaign.defaultWindowDays,
    baseType: campaign.baseType,
    baseAmountCents: campaign.baseAmountCents,
    prorateBase: campaign.prorateBase,
    bonusType: campaign.bonusType,
    cpmRateCents: campaign.cpmRateCents,
    minViewsForBonus: campaign.minViewsForBonus,
    cpmMinViewsMode: campaign.cpmMinViewsMode,
    milestones: campaign.milestones,
    milestoneScope: campaign.milestoneScope,
    perVideoBonusCapCents: campaign.perVideoBonusCapCents,
    perCreatorCycleCapCents: campaign.perCreatorCycleCapCents,
    perCreatorCycleTotalCapCents: campaign.perCreatorCycleTotalCapCents,
    usageRightsNote: campaign.usageRightsNote,
    cycleType: campaign.cycleType,
    weekStartsOn: campaign.weekStartsOn,
    paydayRule: campaign.paydayRule,
    currency: "USD",
  }

  return (
    <>
      <PageHeader title={campaign.name} description="Campaign">
        <ToneBadge tone={campaign.status === "active" ? "green" : "neutral"} className="capitalize">
          {campaign.status}
        </ToneBadge>
      </PageHeader>
      <PageBody>
        <TabNav
          basePath={`/campaigns/${id}`}
          active={active}
          tabs={[
            { value: "settings", label: "Settings" },
            { value: "people", label: "Creators & accounts", count: assignments.creators.length },
            { value: "payout", label: "Payout preview" },
            { value: "performance", label: "Performance" },
          ]}
        />
        {active === "settings" ? (
          <>
            <CampaignForm key={campaign.updatedAt.toISOString()} campaignId={id} defaultValues={formValues} />
            <CampaignDelete campaignId={id} name={campaign.name} />
          </>
        ) : null}
        {active === "people" ? (
          <CampaignAssignments
            campaignId={id}
            assignments={assignments}
            allCreators={creatorOptions.map((c) => ({ id: c.id, name: c.name }))}
            defaults={{
              baseAmountCents: campaign.baseAmountCents,
              quotaCount: campaign.quotaCount,
              cycleCapCents: campaign.perCreatorCycleCapCents,
            }}
          />
        ) : null}
        {active === "payout" && cycleView ? (
          <CycleView view={cycleView} basePath={`/campaigns/${id}?tab=payout`} now={now} />
        ) : null}
        {active === "performance" && performance ? <CampaignPerformance performance={performance} /> : null}
      </PageBody>
    </>
  )
}
