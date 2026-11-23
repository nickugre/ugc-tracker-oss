import { MegaphoneIcon, PlusIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { PlatformBadge, ToneBadge } from "@/components/badges"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
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
import { formatDate } from "@/lib/format"
import { formatCents } from "@/lib/money/cents"
import { listCampaigns, type CampaignListRow } from "@/lib/queries/campaigns"

export const metadata: Metadata = { title: "Campaigns" }

const STATUS_TONE = { active: "green", draft: "neutral", ended: "neutral" } as const
const BASE_LABEL: Record<CampaignListRow["baseType"], string> = {
  none: "No base",
  per_video: "per video",
  weekly_retainer: "per week",
  monthly_retainer: "per month",
}
const BONUS_LABEL: Record<CampaignListRow["bonusType"], string> = {
  none: "No bonus",
  cpm: "CPM",
  milestone: "Milestones",
  hybrid: "CPM + milestones",
}

export default async function CampaignsPage() {
  const campaigns = await listCampaigns()

  return (
    <>
      <PageHeader title="Campaigns" description="Pay rules, platforms and assigned creators">
        <Link href="/campaigns/new" className={buttonVariants({ size: "sm" })}>
          <PlusIcon />
          New campaign
        </Link>
      </PageHeader>
      <PageBody>
        {campaigns.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MegaphoneIcon />
              </EmptyMedia>
              <EmptyTitle>No campaigns yet</EmptyTitle>
              <EmptyDescription>
                A campaign holds the pay rules: base, bonus ladder, view window and payout cycle.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link href="/campaigns/new" className={buttonVariants({ size: "sm" })}>
                Create the first campaign
              </Link>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Platforms</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>Bonus</TableHead>
                  <TableHead className="text-right">Window</TableHead>
                  <TableHead className="text-right">Creators</TableHead>
                  <TableHead className="text-right">Videos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {/* A campaign with videos opens on how it is doing; an empty one on its settings. */}
                      <Link
                        href={c.postCount > 0 ? `/campaigns/${c.id}?tab=performance` : `/campaigns/${c.id}`}
                        className="hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={STATUS_TONE[c.status]} className="capitalize">
                        {c.status}
                      </ToneBadge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {c.platforms.map((p) => (
                          <PlatformBadge key={p} platform={p} showLabel={false} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(c.startDate)} – {c.endDate ? formatDate(c.endDate) : "ongoing"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {c.baseType === "none"
                        ? BASE_LABEL.none
                        : `${formatCents(c.baseAmountCents)} ${BASE_LABEL[c.baseType]}`}
                    </TableCell>
                    <TableCell>{BONUS_LABEL[c.bonusType]}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.defaultWindowDays}d</TableCell>
                    <TableCell className="text-right tabular-nums">{c.creatorCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.postCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  )
}
