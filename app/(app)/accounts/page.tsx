import { AtSignIcon, PencilIcon, PlusIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import {
  AddAccountDialog,
  EditAccountLinksDialog,
  TrackingSwitch,
} from "@/components/accounts/account-dialogs"
import { ScrapeNowButton } from "@/components/accounts/scrape-now-button"
import { PlatformBadge, ToneBadge } from "@/components/badges"
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
import { LIVE_PLATFORMS } from "@/db/schema/enums"
import { PLATFORM_LABELS, formatCompact, formatDate, formatRelative } from "@/lib/format"
import { listAccounts, type AccountListRow } from "@/lib/queries/accounts"
import { listCampaignOptions } from "@/lib/queries/campaigns"
import { listCreatorOptions } from "@/lib/queries/creators"

export const metadata: Metadata = { title: "Accounts" }

function ScrapeState({ account, now }: { account: AccountListRow; now: Date }) {
  if (account.scrapeStatus === "error") {
    return (
      <span title={account.scrapeError ?? undefined}>
        <ToneBadge tone="red">Error</ToneBadge>
      </span>
    )
  }
  if (account.scrapeStatus === "running" || account.scrapeStatus === "queued") {
    return <ToneBadge tone="blue">Scraping…</ToneBadge>
  }
  if (!account.lastScrapedAt) return <span className="text-muted-foreground">Never</span>
  return <span className="text-muted-foreground">{formatRelative(account.lastScrapedAt, now)}</span>
}

export default async function AccountsPage() {
  const [accounts, creators, campaigns] = await Promise.all([
    listAccounts(),
    listCreatorOptions(),
    listCampaignOptions(),
  ])
  const now = new Date()
  const creatorOptions = creators.map((c) => ({ id: c.id, name: c.name }))
  const campaignOptions = campaigns.map((c) => ({ id: c.id, name: c.name }))

  return (
    <>
      <PageHeader title="Accounts" description="Tracked social handles and their scrape status">
        <AddAccountDialog
          creators={creatorOptions}
          campaigns={campaignOptions}
          trigger={
            <Button size="sm">
              <PlusIcon />
              Add account
            </Button>
          }
        />
      </PageHeader>
      <PageBody>
        {accounts.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AtSignIcon />
              </EmptyMedia>
              <EmptyTitle>No accounts tracked yet</EmptyTitle>
              <EmptyDescription>
                Add the TikTok and Instagram handles your creators post on. New videos are discovered
                every 24 hours.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Account</TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Followers</TableHead>
                  <TableHead className="text-right">Videos</TableHead>
                  <TableHead>Tracking from</TableHead>
                  <TableHead>Last scrape</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <PlatformBadge platform={a.platform} showLabel={false} />
                        <a href={a.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          @{a.handle}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      {a.creatorId ? (
                        <Link href={`/creators/${a.creatorId}`} className="hover:underline">
                          {a.creatorName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.campaignId ? (
                        <Link href={`/campaigns/${a.campaignId}`} className="hover:underline">
                          {a.campaignName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCompact(a.followerCount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.postCount}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(a.trackFrom)}</TableCell>
                    <TableCell>
                      <ScrapeState account={a} now={now} />
                    </TableCell>
                    <TableCell>
                      <TrackingSwitch id={a.id} enabled={a.trackingEnabled} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <ScrapeNowButton
                          accountId={a.id}
                          handle={a.handle}
                          disabled={!LIVE_PLATFORMS.includes(a.platform) || !a.trackingEnabled}
                        />
                      <EditAccountLinksDialog
                        account={{
                          id: a.id,
                          handle: a.handle,
                          creatorId: a.creatorId,
                          campaignId: a.campaignId,
                          trackFrom: a.trackFrom,
                          postCount: a.postCount,
                        }}
                        creators={creatorOptions}
                        campaigns={campaignOptions}
                        trigger={
                          <Button size="icon-sm" variant="ghost" aria-label={`Edit @${a.handle} on ${PLATFORM_LABELS[a.platform]}`}>
                            <PencilIcon />
                          </Button>
                        }
                      />
                      </div>
                    </TableCell>
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
