import { cn } from "cn"
import { ArrowDownIcon, ArrowUpIcon, VideoIcon } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { createSerializer } from "nuqs/server"
import { Suspense } from "react"

import { NeedsReviewIcon, PlatformBadge, SparkBadge, StatusBadge } from "@/components/badges"
import { Sparkline } from "@/components/charts/sparkline"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
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
import { BulkBar, HeaderCheckbox, RowCheckbox, SelectionProvider } from "@/components/videos/selection"
import { VideoDetail } from "@/components/videos/video-detail"
import { VideoSheet } from "@/components/videos/video-sheet"
import { VideosFilters } from "@/components/videos/videos-filters"
import type { DisplayStatus } from "@/db/schema/enums"
import { env } from "@/lib/env"
import { formatCompact, formatDate, formatNumber, formatPercent, formatRelative } from "@/lib/format"
import { listCampaignOptions } from "@/lib/queries/campaigns"
import { listCreatorOptions } from "@/lib/queries/creators"
import { getPostDetail, listPosts, type PostListRow } from "@/lib/queries/posts"
import {
  loadVideosParams,
  videosParsers,
  type VideoSort,
  type VideosParams,
} from "@/lib/search-params/videos"

export const metadata: Metadata = { title: "Videos" }

const serialize = createSerializer(videosParsers)

function SortHead({
  label,
  sort,
  params,
  align = "left",
}: {
  label: string
  sort: VideoSort
  params: VideosParams
  align?: "left" | "right"
}) {
  const active = params.sort === sort
  const dir = active && params.dir === "desc" ? "asc" : "desc"
  const Arrow = params.dir === "asc" ? ArrowUpIcon : ArrowDownIcon
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <Link
        href={serialize("/videos", { ...params, sort, dir, page: 1, video: null })}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "font-semibold text-foreground"
        )}
      >
        {label}
        {active ? <Arrow className="size-3" /> : null}
      </Link>
    </TableHead>
  )
}

function Thumb({ row }: { row: PostListRow }) {
  const src = row.thumbnailPath
    ? `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbnails/${row.thumbnailPath}`
    : null
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

export default async function VideosPage(props: PageProps<"/videos">) {
  const params = await loadVideosParams(props.searchParams)
  const now = new Date()
  const [{ rows, total, page, pageCount }, campaigns, creators, detail] = await Promise.all([
    listPosts(params, now),
    listCampaignOptions(),
    listCreatorOptions(),
    params.video ? getPostDetail(params.video) : Promise.resolve(null),
  ])
  const campaignOptions = campaigns.map((c) => ({ id: c.id, name: c.name }))
  const creatorOptions = creators.map((c) => ({ id: c.id, name: c.name }))

  return (
    <>
      <PageHeader title="Videos" description="Every tracked post, its view window and payable views" />
      <PageBody>
        <Suspense>
          <VideosFilters campaigns={campaignOptions} creators={creatorOptions} />
        </Suspense>

        {rows.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <VideoIcon />
              </EmptyMedia>
              <EmptyTitle>No videos match</EmptyTitle>
              <EmptyDescription>
                Videos appear here once tracked accounts are scraped. Try clearing the filters.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SelectionProvider>
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-9">
                      <HeaderCheckbox ids={rows.map((r) => r.id)} />
                    </TableHead>
                    <TableHead>Video</TableHead>
                    <TableHead>Creator</TableHead>
                    <TableHead>Campaign</TableHead>
                    <SortHead label="Posted" sort="posted" params={params} />
                    <SortHead label="Window ends" sort="window" params={params} />
                    <TableHead>Trend</TableHead>
                    <SortHead label="Views" sort="views" params={params} align="right" />
                    <SortHead label="24h" sort="velocity" params={params} align="right" />
                    <SortHead label="Eng." sort="engagement" params={params} align="right" />
                    <SortHead label="Payable" sort="payable" params={params} align="right" />
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const timeZone = row.timezone ?? "UTC"
                    const status = row.displayStatus as DisplayStatus
                    const closingSoon =
                      status === "open" && row.windowEndsAt.getTime() - now.getTime() < 48 * 3_600_000
                    return (
                      <TableRow key={row.id} data-state={params.video === row.id ? "selected" : undefined}>
                        <TableCell>
                          <RowCheckbox id={row.id} label={row.caption ?? row.accountHandle} />
                        </TableCell>
                        <TableCell className="max-w-72">
                          <Link
                            href={serialize("/videos", { ...params, video: row.id })}
                            scroll={false}
                            className="group flex items-center gap-2.5"
                          >
                            <Thumb row={row} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium group-hover:underline">
                                {row.caption || "No caption"}
                              </span>
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <PlatformBadge platform={row.platform} showLabel={false} />@{row.accountHandle}
                              </span>
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.creatorName ?? "—"}</TableCell>
                        <TableCell className="max-w-40 truncate text-muted-foreground">
                          {row.campaignName ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(row.postedAt, timeZone)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={closingSoon ? "font-medium text-foreground" : "text-muted-foreground"}>
                            {status === "open" ? formatRelative(row.windowEndsAt, now) : formatDate(row.windowEndsAt, timeZone)}
                          </span>
                          {row.windowOverridden ? (
                            <span className="ml-1 text-xs text-muted-foreground">({row.windowDays}d)</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Sparkline values={row.spark} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums" title={formatNumber(row.currentViews)}>
                          {formatCompact(row.currentViews)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.views24hDelta ? `+${formatCompact(row.views24hDelta)}` : "—"}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums text-muted-foreground"
                          title="Likes, comments, shares and saves per view"
                        >
                          {formatPercent(row.engagementRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.payableViews != null ? (
                            <span className="font-medium" title={formatNumber(row.payableViews)}>
                              {formatCompact(row.payableViews)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground" title="Organic views so far (not locked yet)">
                              ~{formatCompact(row.organicNow)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5">
                            <StatusBadge status={status} />
                            {row.isSpark ? <SparkBadge /> : null}
                            {row.needsReview ? <NeedsReviewIcon reason={row.reviewReason} /> : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular-nums">
                {formatNumber(total)} {total === 1 ? "video" : "videos"}
                {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}
              </span>
              {pageCount > 1 ? (
                <span className="flex gap-2">
                  <Link
                    href={serialize("/videos", { ...params, page: Math.max(1, page - 1), video: null })}
                    aria-disabled={page <= 1}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}
                  >
                    Previous
                  </Link>
                  <Link
                    href={serialize("/videos", { ...params, page: Math.min(pageCount, page + 1), video: null })}
                    aria-disabled={page >= pageCount}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pageCount && "pointer-events-none opacity-50")}
                  >
                    Next
                  </Link>
                </span>
              ) : null}
            </div>

            <BulkBar campaigns={campaignOptions} creators={creatorOptions} />
          </SelectionProvider>
        )}
      </PageBody>

      <Suspense>
        <VideoSheet open={Boolean(detail)}>
          {detail ? <VideoDetail key={detail.post.updatedAt.toISOString()} detail={detail} now={now} /> : null}
        </VideoSheet>
      </Suspense>
    </>
  )
}
