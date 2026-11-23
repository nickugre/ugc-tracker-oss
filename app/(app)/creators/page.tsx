import { PlusIcon, UsersIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { ToneBadge } from "@/components/badges"
import { CreatorDialog } from "@/components/creators/creator-dialog"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
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
import { formatCompact, formatNumber } from "@/lib/format"
import { formatCents } from "@/lib/money/cents"
import { listCreators } from "@/lib/queries/creators"

export const metadata: Metadata = { title: "Creators" }

const STATUS_TONE = { active: "green", paused: "amber", ended: "neutral" } as const

export default async function CreatorsPage() {
  const creators = await listCreators()

  return (
    <>
      <PageHeader title="Creators" description="The people you hire, their accounts and earnings">
        <CreatorDialog
          trigger={
            <Button size="sm">
              <PlusIcon />
              Add creator
            </Button>
          }
        />
      </PageHeader>
      <PageBody>
        {creators.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No creators yet</EmptyTitle>
              <EmptyDescription>
                Add the people you hire, then link their social accounts and assign them to a
                campaign.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Creator</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Campaigns</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="text-right">Videos</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead className="text-right">Paid all time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creators.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/creators/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.email ?? c.contactHandle ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.country ?? "—"}</TableCell>
                    <TableCell>
                      <ToneBadge tone={STATUS_TONE[c.status]} className="capitalize">
                        {c.status}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {c.campaignNames.length ? c.campaignNames.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.accountCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.postCount)}</TableCell>
                    <TableCell className="text-right tabular-nums" title={formatNumber(c.totalViews)}>
                      {formatCompact(c.totalViews)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.unpaidCents ? (
                        <span className="font-medium text-amber-700">{formatCents(c.unpaidCents)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(c.paidCents)}</TableCell>
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
