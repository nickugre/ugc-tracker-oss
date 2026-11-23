import Link from "next/link"

import { ToneBadge } from "@/components/badges"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCompact, formatDate, formatNumber, formatPercent } from "@/lib/format"
import { formatCents } from "@/lib/money/cents"
import { formatRate } from "@/lib/payouts/performance"
import type { CampaignPerformance as Performance } from "@/lib/queries/campaign-performance"

const CYCLE_STATUS = {
  paid: { label: "Paid", tone: "green" },
  finalized: { label: "Finalized", tone: "amber" },
  preview: { label: "Live estimate", tone: "blue" },
  unfinalized: { label: "Not finalized", tone: "neutral" },
} as const

function Tile({ label, value, hint, title }: { label: string; value: string; hint?: string; title?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4" title={title}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="overflow-hidden rounded-lg border">{children}</div>
    </section>
  )
}

function cycleName(cycle: Pick<Performance["cycles"][number], "cycleType" | "periodStart" | "periodEnd">) {
  if (cycle.cycleType === "monthly") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${cycle.periodStart}T00:00:00Z`)
    )
  }
  return `${formatDate(cycle.periodStart)} – ${formatDate(cycle.periodEnd)}`
}

export function CampaignPerformance({ performance }: { performance: Performance }) {
  const { campaign, totals, spend, ads, firstTier } = performance
  const money = (cents: number) => formatCents(cents, campaign.currency)
  const rate = (cents: number | null) => formatRate(cents, campaign.currency)
  const since = performance.period.ended
    ? `${formatDate(campaign.startDate)} – ${formatDate(campaign.endDate)}`
    : `since ${formatDate(campaign.startDate)}`

  if (totals.videos === 0 && totals.spendCents === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        No videos posted {since} yet. Spend, effective CPM and spend per video show up with the first ones.
      </p>
    )
  }

  const spendParts = [
    `${money(spend.baseCents)} base`,
    `${money(spend.bonusCents)} bonuses`,
    spend.adjustmentsCents ? `${money(spend.adjustmentsCents)} adjustments` : null,
  ].filter(Boolean)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Spend so far"
          value={money(totals.spendCents)}
          hint={spendParts.join(" · ")}
          title={`${money(spend.settledCents)} in finalized cycles, ${money(spend.estimatedCents)} estimated for the open ones`}
        />
        <Tile
          label="Effective CPM"
          value={rate(totals.ecpmCents)}
          hint="Spend per 1,000 organic views"
        />
        <Tile
          label="Spend per video"
          value={rate(totals.perVideoCents)}
          hint={`${formatNumber(totals.videos)} videos posted ${since}`}
        />
        <Tile
          label="Cost per engagement"
          value={rate(totals.perEngagementCents)}
          hint={`${formatCompact(totals.engagements)} likes, comments, shares and saves`}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Organic views"
          value={formatCompact(totals.organicViews)}
          hint="Current views, paid (ad) views left out"
          title={formatNumber(totals.organicViews)}
        />
        <Tile
          label="Views per video"
          value={formatCompact(totals.avgViews == null ? null : Math.round(totals.avgViews))}
          hint={`Average. Half the videos are above ${formatCompact(totals.medianViews == null ? null : Math.round(totals.medianViews))}`}
        />
        <Tile
          label="Engagement rate"
          value={formatPercent(totals.engagementRate)}
          hint="Engagements ÷ organic views, all videos together"
        />
        {firstTier ? (
          <Tile
            label={`Videos at ${formatCompact(firstTier.views)}+ views`}
            value={`${formatNumber(firstTier.reached)} of ${formatNumber(totals.videos)}`}
            hint={`${formatPercent(totals.videos ? firstTier.reached / totals.videos : null)} reached the first milestone`}
          />
        ) : (
          <Tile label="Videos" value={formatNumber(totals.videos)} hint={`Posted ${since}`} />
        )}
      </div>

      {ads ? (
        <Section
          title="Spark ads on these videos"
          description="From the TikTok Ads sync. Not part of the spend above, which is creator pay only."
        >
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 p-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Ad spend</dt>
              <dd className="font-medium tabular-nums">{money(ads.spendCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid views</dt>
              <dd className="font-medium tabular-nums" title={formatNumber(ads.paidViews)}>
                {formatCompact(ads.paidViews)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid CPM</dt>
              <dd className="font-medium tabular-nums">{rate(ads.paidCpmCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Blended CPM</dt>
              <dd
                className="font-medium tabular-nums"
                title={`${money(totals.spendCents + ads.spendCents)} over ${formatNumber(ads.totalViews)} views, organic and paid`}
              >
                {rate(ads.blendedCpmCents)}
              </dd>
            </div>
          </dl>
        </Section>
      ) : null}

      <Section
        title="By payout cycle"
        description="Videos and views belong to the cycle the video was posted in. Bonuses belong to the cycle the window closed in."
      >
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Cycle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Videos</TableHead>
              <TableHead className="text-right">Organic views</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Effective CPM</TableHead>
              <TableHead className="text-right">Per video</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {performance.cycles.map((cycle) => (
              <TableRow key={`${cycle.cycleType}:${cycle.periodStart}`}>
                <TableCell className="font-medium">
                  <Link
                    href={`/campaigns/${campaign.id}?tab=payout&period=${cycle.periodStart}`}
                    className="hover:underline"
                  >
                    {cycleName(cycle)}
                  </Link>
                </TableCell>
                <TableCell>
                  <ToneBadge tone={CYCLE_STATUS[cycle.status].tone}>{CYCLE_STATUS[cycle.status].label}</ToneBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(cycle.videos)}</TableCell>
                <TableCell className="text-right tabular-nums" title={formatNumber(cycle.organicViews)}>
                  {formatCompact(cycle.organicViews)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(cycle.spendCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{rate(cycle.ecpmCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{rate(cycle.perVideoCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="By creator" description={`What each creator was paid against what their videos brought in, ${since}.`}>
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Creator</TableHead>
              <TableHead className="text-right">Videos</TableHead>
              <TableHead className="text-right">Organic views</TableHead>
              <TableHead className="text-right">Views per video</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Effective CPM</TableHead>
              <TableHead className="text-right">Per video</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {performance.creators.map((creator) => (
              <TableRow key={creator.creatorId}>
                <TableCell className="font-medium">
                  <Link href={`/creators/${creator.creatorId}`} className="hover:underline">
                    {creator.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(creator.videos)}</TableCell>
                <TableCell className="text-right tabular-nums" title={formatNumber(creator.organicViews)}>
                  {formatCompact(creator.organicViews)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCompact(creator.avgViews == null ? null : Math.round(creator.avgViews))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(creator.spendCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{rate(creator.ecpmCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{rate(creator.perVideoCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <p className="text-xs text-muted-foreground">
        Spend is what the creators are paid: finalized cycles as they were settled ({money(spend.settledCents)}), plus
        the live estimate of the cycles still open ({money(spend.estimatedCents)}), the same numbers as the Payout
        preview. Videos with an open window have views but no bonus yet, so the effective CPM can still move. Excluded
        videos are left out.
        {performance.unassignedVideos
          ? ` ${formatNumber(performance.unassignedVideos)} videos are not linked to a creator: their views count in the totals, not in a creator's row.`
          : ""}
        {performance.skippedOpenCycles
          ? ` ${formatNumber(performance.skippedOpenCycles)} older cycles were never finalized and are not in the spend.`
          : ""}
      </p>
    </>
  )
}
