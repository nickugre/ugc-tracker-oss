import { VideoIcon } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Suspense } from "react"

import { PlatformBadge, SparkBadge } from "@/components/badges"
import { BarList } from "@/components/charts/bar-list"
import { ViewsChart } from "@/components/charts/views-chart"
import { OverviewFilters } from "@/components/overview/overview-filters"
import { TopVideosMetric } from "@/components/overview/top-videos-metric"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { env } from "@/lib/env"
import { formatCompact, formatDate, formatNumber, formatPercent, formatRelative, PLATFORM_LABELS } from "@/lib/format"
import { formatCents } from "@/lib/money/cents"
import { listAccounts } from "@/lib/queries/accounts"
import { listCampaignOptions } from "@/lib/queries/campaigns"
import { listCreatorOptions } from "@/lib/queries/creators"
import { getOverview } from "@/lib/queries/overview"
import { loadOverviewParams, TOP_ENGAGEMENT_MIN_VIEWS } from "@/lib/search-params/overview"

export const metadata: Metadata = { title: "Overview" }

// A headline number. Proportional figures on purpose: tabular digits look loose at this size.
function Kpi({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: string
  hint?: string
  href?: string
}) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </>
  )
  const className = "flex flex-col gap-1 rounded-lg border p-4"
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:bg-muted/40`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  // A control for this panel only, shown at the right of its header.
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    // min-w-0: a grid item otherwise grows to fit its longest caption and the page scrolls sideways.
    <section className={`flex min-w-0 flex-col gap-4 rounded-lg border p-5 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Thumb({ path }: { path: string | null }) {
  const src = path ? `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbnails/${path}` : null
  return (
    <span className="relative flex h-10 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
      {src ? (
        <Image src={src} alt="" fill sizes="32px" className="object-cover" />
      ) : (
        <VideoIcon className="size-3.5 text-muted-foreground/60" />
      )}
    </span>
  )
}

export default async function OverviewPage(props: PageProps<"/">) {
  const params = await loadOverviewParams(props.searchParams)
  const now = new Date()
  const [overview, campaigns, creators, accounts] = await Promise.all([
    getOverview(params, now),
    listCampaignOptions(),
    listCreatorOptions(),
    listAccounts(),
  ])
  const { kpis } = overview
  const byEngagement = params.top === "engagement"
  const monthName = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
  // Every month since the first campaign began, newest first.
  const firstMonth = campaigns.map((c) => c.startDate.slice(0, 7)).sort()[0] ?? now.toISOString().slice(0, 7)
  const months: { id: string; name: string }[] = []
  for (
    let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    cursor.toISOString().slice(0, 7) >= firstMonth && months.length < 36;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1))
  ) {
    const id = cursor.toISOString().slice(0, 7)
    months.push({ id, name: monthName(`${id}-01`) })
  }
  const selectedMonth = overview.range.month ? monthName(overview.range.month) : null
  // Reads naturally after "posted", "gained" and so on.
  const inRange = selectedMonth
    ? `in ${selectedMonth}`
    : !overview.range.fixedStart
    ? `in the last ${overview.range.days} days`
    : overview.range.ended
      ? `from ${formatDate(overview.range.from)} to ${formatDate(new Date(overview.range.to.getTime() - 86_400_000))}`
      : `since ${formatDate(overview.range.from)}`

  return (
    <>
      <PageHeader title="Overview" description="Views, open windows and what is ready to pay" />
      <PageBody>
        <Suspense>
          <OverviewFilters
            months={months}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
            creators={creators.map((c) => ({ id: c.id, name: c.name }))}
            accounts={accounts.map((a) => ({ id: a.id, name: `@${a.handle} · ${PLATFORM_LABELS[a.platform]}` }))}
          />
        </Suspense>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Total views"
            value={formatCompact(kpis.totalViews)}
            hint={`${formatNumber(kpis.posts)} videos posted ${inRange}`}
          />
          <Kpi
            label="Views in open windows"
            value={formatCompact(kpis.openWindowViews)}
            hint={`${formatNumber(kpis.openWindowPosts)} videos still counting`}
            href="/videos?status=open"
          />
          <Kpi
            label="Locked payable views"
            value={formatCompact(kpis.lockedPayableViews)}
            hint="Organic, window closed, not paid yet"
            href="/videos?status=locked"
          />
          <Kpi
            label="Estimated bonuses"
            value={formatCents(kpis.estimatedBonusCents)}
            hint={selectedMonth ? `${selectedMonth} cycle` : "Current cycle, live preview"}
            href="/payouts"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Views gained while tracked"
            value={formatCompact(kpis.viewsInPeriod)}
            hint={`Day by day ${inRange}; views from before tracking began are not in it`}
          />
          <Kpi
            label="Videos ready to pay"
            value={formatNumber(kpis.readyToPay)}
            hint="Locked, no open issues"
            href="/payouts"
          />
          <Kpi
            label="Held for a later cycle"
            value={formatNumber(kpis.heldForNextCycle)}
            hint={selectedMonth ? `Window ends after ${selectedMonth}` : "Window ends after the current cycle"}
          />
          <Kpi
            label="Need review"
            value={formatNumber(kpis.lockedNeedingReview)}
            hint="Locked videos with an open flag"
            href="/videos?flag=review"
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <Panel
            title="Views gained per day"
            description={`All tracked videos in scope, ${inRange} (UTC days)`}
            className="lg:col-span-2"
          >
            <ViewsChart points={overview.series} timeZone="UTC" unit="views" dateOnly />
          </Panel>
          <Panel title="Videos per platform" description={`Posted ${inRange}`}>
            <BarList
              unit="videos"
              items={overview.byPlatform.map((p) => ({
                key: p.platform,
                label: PLATFORM_LABELS[p.platform],
                value: p.posts,
              }))}
            />
          </Panel>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel
            title="Top videos"
            description={
              byEngagement
                ? `By engagement rate, videos with ${formatCompact(TOP_ENGAGEMENT_MIN_VIEWS)}+ views posted ${inRange}`
                : `By current views, posted ${inRange}`
            }
            action={
              <Suspense>
                <TopVideosMetric />
              </Suspense>
            }
          >
            <BarList
              unit="views"
              emptyText={
                byEngagement
                  ? `No videos with ${formatCompact(TOP_ENGAGEMENT_MIN_VIEWS)}+ views in this period.`
                  : undefined
              }
              items={overview.topVideos.map((v) => ({
                key: v.id,
                label: v.caption || "No caption",
                media: <Thumb path={v.thumbnailPath} />,
                href: `/videos?video=${v.id}`,
                // Ranked by engagement, the view count moves next to the handle so it stays in sight.
                ...(byEngagement
                  ? {
                      sublabel: `@${v.handle} · ${formatCompact(v.views)} views`,
                      value: v.engagementRate ?? 0,
                      valueLabel: formatPercent(v.engagementRate),
                      title: `${formatPercent(v.engagementRate, 2)} engagement on ${formatNumber(v.views)} views`,
                    }
                  : { sublabel: `@${v.handle}`, value: v.views }),
              }))}
            />
          </Panel>
          <Panel title="Creator leaderboard" description={`Views on videos posted ${inRange}`}>
            <BarList
              unit="views"
              items={overview.leaderboard.map((c) => ({
                key: c.id,
                label: c.name,
                sublabel: `${c.posts} videos`,
                value: c.views,
                href: `/creators/${c.id}`,
              }))}
            />
          </Panel>
        </div>

        <Panel
          title="Windows closing in the next 48 hours"
          description="Last chance for these videos to reach a higher tier. They lock automatically when the window ends."
        >
          {overview.closing.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No windows close in the next 48 hours.
            </p>
          ) : (
            <div className="-mx-5 -mb-5 overflow-hidden border-t">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-5">Video</TableHead>
                    <TableHead>Creator</TableHead>
                    <TableHead>Closes</TableHead>
                    <TableHead className="text-right">Organic views</TableHead>
                    <TableHead className="text-right">24h</TableHead>
                    <TableHead>Tier now</TableHead>
                    <TableHead className="pr-5 text-right">To next tier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.closing.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell className="max-w-72 pl-5">
                        <Link href={`/videos?video=${post.id}`} className="flex items-center gap-2 hover:underline">
                          <PlatformBadge platform={post.platform} showLabel={false} />
                          <span className="truncate font-medium">{post.caption || "No caption"}</span>
                          {post.isSpark ? <SparkBadge /> : null}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{post.creatorName ?? "—"}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {formatRelative(post.windowEndsAt, now)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" title={formatNumber(post.organic)}>
                        {formatCompact(post.organic)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {post.velocity ? `+${formatCompact(post.velocity)}` : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {post.currentTier
                          ? `${formatCompact(post.currentTier.views)} · ${formatCents(post.currentTier.amountCents)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="pr-5 text-right text-muted-foreground tabular-nums">
                        {post.toNextTier != null && post.nextTier
                          ? `${formatCompact(post.toNextTier)} to ${formatCompact(post.nextTier.views)}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </PageBody>
    </>
  )
}
