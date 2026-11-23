import type { Metadata } from "next"

import { CampaignForm } from "@/components/campaigns/campaign-form"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { requireUser } from "@/lib/auth/dal"
import { todayInTimeZone } from "@/lib/format"
import { defaultCampaignInput } from "@/lib/validation/campaign"

export const metadata: Metadata = { title: "New campaign" }

export default async function NewCampaignPage() {
  await requireUser()
  const defaults = defaultCampaignInput(todayInTimeZone("America/New_York", new Date()))

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Starts from the standard contract: $1,000 for 60 videos on TikTok and Instagram, with the 20K – 1M ladder"
      />
      <PageBody>
        <CampaignForm campaignId={null} defaultValues={defaults} />
      </PageBody>
    </>
  )
}
