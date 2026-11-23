import { BanknoteIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { ToneBadge } from "@/components/badges"
import { cycleLabel } from "@/components/payouts/cycle-view"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireUser } from "@/lib/auth/dal"
import { formatDate } from "@/lib/format"
import { formatCents } from "@/lib/money/cents"
import { getCycleView, listStoredCycles } from "@/lib/payouts/service"
import { listCampaignOptions } from "@/lib/queries/campaigns"

export const metadata: Metadata = { title: "Payouts" }

export default async function PayoutsPage() {
  await requireUser()
  const now = new Date()
  const campaigns = (await listCampaignOptions()).filter((c) => c.status !== "draft")
  const [current, stored] = await Promise.all([
    Promise.all(campaigns.map((c) => getCycleView(c.id, null, now))),
    listStoredCycles(),
  ])
  const views = current.filter((v) => v !== null)

  return (
    <>
      <PageHeader title="Payouts" description="Base and bonus per creator, cycle by cycle" />
      <PageBody>
        {views.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BanknoteIcon />
              </EmptyMedia>
              <EmptyTitle>No active campaigns</EmptyTitle>
              <EmptyDescription>Payouts are computed per campaign. Activate a campaign to see its current cycle.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-tight">Current cycle</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {views.map((view) => (
                <Link
                  key={view.campaign.id}
                  href={`/payouts/${view.campaign.id}`}
                  className="flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{view.campaign.name}</span>
                    <ToneBadge tone={view.status === "preview" ? "blue" : view.status === "paid" ? "green" : "amber"}>
                      {view.status === "preview" ? "Live preview" : view.status === "paid" ? "Paid" : "Finalized"}
                    </ToneBadge>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-2xl font-semibold tracking-tight">{formatCents(view.totals.totalCents)}</p>
                      <p className="text-xs text-muted-foreground">
                        {cycleLabel(view)} · {view.lines.length} creators · payday {formatDate(view.payday)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {view.blocked.length ? (
                        <p className="font-medium text-orange-700">{view.blocked.length} need attention</p>
                      ) : null}
                      <p>{view.held.length} still in window</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {stored.length ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-tight">Finalized cycles</h2>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Cycle</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Creators</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Finalized</TableHead>
                    <TableHead>Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stored.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        <Link href={`/payouts/${c.campaignId}?period=${c.periodStart}`} className="hover:underline">
                          {formatDate(c.periodStart)} – {formatDate(c.periodEnd)}
                        </Link>
                      </TableCell>
                      <TableCell>{c.campaignName}</TableCell>
                      <TableCell>
                        <ToneBadge tone={c.status === "paid" ? "green" : "amber"}>
                          {c.status === "paid" ? "Paid" : "Not paid"}
                        </ToneBadge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.lineCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(c.totalCents)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(c.finalizedAt, c.campaignTimezone)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(c.paidAt, c.campaignTimezone)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}
      </PageBody>
    </>
  )
}
