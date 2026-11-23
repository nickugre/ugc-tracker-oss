import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { CycleView } from "@/components/payouts/cycle-view"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { requireUser } from "@/lib/auth/dal"
import { getCycleView } from "@/lib/payouts/service"

export const metadata: Metadata = { title: "Payout cycle" }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function PayoutCyclePage(props: PageProps<"/payouts/[campaignId]">) {
  await requireUser()
  const { campaignId } = await props.params
  const { period } = await props.searchParams
  const periodStart = typeof period === "string" && ISO_DATE.test(period) ? period : null
  const now = new Date()

  let view
  try {
    view = await getCycleView(campaignId, periodStart, now)
  } catch {
    // An id or period that is not valid for this campaign.
    notFound()
  }
  if (!view) notFound()

  return (
    <>
      <PageHeader title={view.campaign.name} description="Payouts" />
      <PageBody>
        <CycleView view={view} basePath={`/payouts/${campaignId}`} now={now} />
      </PageBody>
    </>
  )
}
