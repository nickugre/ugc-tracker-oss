import { VideoIcon, ZapIcon } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { createSerializer } from "nuqs/server"
import { Suspense } from "react"

import { ToneBadge } from "@/components/badges"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { CopyLinksButton } from "@/components/spark/copy-links-button"
import { MarkSparkedButton } from "@/components/spark/mark-sparked-button"
import { SparkFilters } from "@/components/spark/spark-filters"
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
import { HeaderCheckbox, RowCheckbox, SelectionProvider } from "@/components/videos/selection"
import { VideoDetail } from "@/components/videos/video-detail"
import { VideoSheet } from "@/components/videos/video-sheet"
import { env } from "@/lib/env"
import { formatCompact, formatDate, formatNumber, formatPercent } from "@/lib/format"
import { listCreatorOptions } from "@/lib/queries/creators"
import { getPostDetail } from "@/lib/queries/posts"
import { getSparkPage, type SparkedRow, type SparkRow } from "@/lib/queries/spark"
import { loadSparkParams, sparkParsers } from "@/lib/search-params/spark"

export const metadata: Metadata = { title: "Spark" }

const serialize = createSerializer(sparkParsers)

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

// What the comments say, in the viewers' own words: the count, then the most liked match.
function AppComments({ row }: { row: SparkRow }) {
  if (row.commentsRead === 0) {
    return (
      <span className="text-muted-foreground">
        {row.commentsChecks > 0 ? "None came back" : "Not read yet"}
      </span>
    )
  }
  const [top] = row.appComments
  return (
    <span className="flex min-w-0 flex-col">
      <span className="tabular-nums">
        <span className={row.appComments.length ? "font-medium" : "text-muted-foreground"}>
          {row.appComments.length}
        </span>
        <span className="text-muted-foreground"> of {row.commentsRead} read</span>
      </span>
      {top ? (
        <span className="truncate text-xs text-muted-foreground" title={top.text}>
          “{top.text}”
        </span>
      ) : null}
    </span>
  )
}

// How the app knows a video is boosted.
function sparkedSource(row: SparkedRow) {
  if (!row.isSpark) return "Ad marker on the video"
  return row.sparkSource === "ads_api" ? "TikTok Ads" : "Marked by hand"
}

export default async function SparkPage(props: PageProps<"/spark">) {
  const params = await loadSparkParams(props.searchParams)
  const now = new Date()
  const [spark, creators, detail] = await Promise.all([
    getSparkPage(params, now),
    listCreatorOptions(),
    params.video ? getPostDetail(params.video) : Promise.resolve(null),
  ])
  const { suggestions, sparked, rules, scope, comments } = spark
  // "10%" and "7.5%", never "8%" for 7.5.
  const minEngagement = `${Math.round(rules.minEngagement * 1000) / 10}%`

  return (
    <>
      <PageHeader title="Spark" description="Videos worth boosting, and the links to ask creators for their spark codes" />
      <PageBody>
        <SelectionProvider>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Suspense>
              <SparkFilters creators={creators.map((c) => ({ id: c.id, name: c.name }))} />
            </Suspense>
            <div className="flex items-center gap-2">
              <MarkSparkedButton ids={suggestions.map((s) => s.id)} />
              <CopyLinksButton rows={suggestions.map((s) => ({ id: s.id, url: s.url, creatorName: s.creatorName }))} />
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold tracking-tight">
                Spark these videos
                {suggestions.length ? (
                  <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{suggestions.length}</span>
                ) : null}
              </h2>
              <p className="text-xs text-muted-foreground">
                TikTok videos from the last {scope.days} days with {formatNumber(rules.minViews)}+ views and either{" "}
                {minEngagement}+ engagement or at least {rules.minAppComments}{" "}
                {rules.minAppComments === 1 ? "comment" : "comments"} about the app. Strongest first. Once a video is
                boosted, tick it and choose Mark as sparked: it moves to the list below.
              </p>
            </div>

            {suggestions.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ZapIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nothing to spark right now</EmptyTitle>
                  <EmptyDescription>
                    {scope.videos === 0
                      ? `No TikTok video from the last ${scope.days} days has reached ${formatNumber(rules.minViews)} views yet.`
                      : `None of the ${formatNumber(scope.videos)} videos in range stands out yet. Try a longer range, or lower the bar in Settings.`}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table className="text-[13px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-9">
                        <HeaderCheckbox ids={suggestions.map((s) => s.id)} />
                      </TableHead>
                      <TableHead>Video</TableHead>
                      <TableHead>Creator</TableHead>
                      <TableHead>Posted</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Eng.</TableHead>
                      <TableHead>Comments about the app</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggestions.map((row) => (
                      <TableRow key={row.id} data-state={params.video === row.id ? "selected" : undefined}>
                        <TableCell>
                          <RowCheckbox id={row.id} label={row.caption ?? row.accountHandle} />
                        </TableCell>
                        <TableCell className="max-w-72">
                          <Link
                            href={serialize("/spark", { ...params, video: row.id })}
                            scroll={false}
                            className="group flex items-center gap-2.5"
                          >
                            <Thumb path={row.thumbnailPath} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium group-hover:underline">
                                {row.caption || "No caption"}
                              </span>
                              <span className="text-xs text-muted-foreground">@{row.accountHandle}</span>
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.creatorName ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(row.postedAt, row.timezone ?? "UTC")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums" title={formatNumber(row.views)}>
                          {formatCompact(row.views)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${row.reasons.includes("engagement") ? "font-medium" : "text-muted-foreground"}`}
                          title="Likes, comments, shares and saves per view"
                        >
                          {formatPercent(row.engagementRate)}
                        </TableCell>
                        <TableCell className="max-w-64">
                          <AppComments row={row} />
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap items-center gap-1.5">
                            {row.reasons.includes("app_comments") ? <ToneBadge tone="violet">Asks about the app</ToneBadge> : null}
                            {row.reasons.includes("engagement") ? <ToneBadge tone="green">High engagement</ToneBadge> : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Comments have been read for {formatNumber(scope.commentsRead)} of {formatNumber(scope.videos)} videos in
              range (the top 30 of each, during the daily sync). Reading them has cost $
              {comments.spentUsd.toFixed(2)} of ${comments.budgetUsd.toFixed(2)} this month. The keywords and
              thresholds are under{" "}
              <Link href="/settings#spark" className="text-brand underline-offset-4 hover:underline">
                Settings
              </Link>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold tracking-tight">
                Sparked
                {sparked.length ? (
                  <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{sparked.length}</span>
                ) : null}
              </h2>
              <p className="text-xs text-muted-foreground">
                TikTok videos that are boosted already, newest first, whenever they were posted. They are never
                suggested again. To undo one, open it and switch Spark off.
              </p>
            </div>

            {sparked.length === 0 ? (
              <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                No video is marked as sparked yet.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table className="text-[13px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Video</TableHead>
                      <TableHead>Creator</TableHead>
                      <TableHead>Posted</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Paid views</TableHead>
                      <TableHead>Known from</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sparked.map((row) => (
                      <TableRow key={row.id} data-state={params.video === row.id ? "selected" : undefined}>
                        <TableCell className="max-w-72">
                          <Link
                            href={serialize("/spark", { ...params, video: row.id })}
                            scroll={false}
                            className="group flex items-center gap-2.5"
                          >
                            <Thumb path={row.thumbnailPath} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium group-hover:underline">
                                {row.caption || "No caption"}
                              </span>
                              <span className="text-xs text-muted-foreground">@{row.accountHandle}</span>
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.creatorName ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(row.postedAt, row.timezone ?? "UTC")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums" title={formatNumber(row.views)}>
                          {formatCompact(row.views)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.paidViews == null ? (
                            <span className="text-muted-foreground">Not entered</span>
                          ) : (
                            <span title={formatNumber(row.paidViews)}>{formatCompact(row.paidViews)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{sparkedSource(row)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </SelectionProvider>
      </PageBody>

      <Suspense>
        <VideoSheet open={Boolean(detail)}>
          {detail ? <VideoDetail key={detail.post.updatedAt.toISOString()} detail={detail} now={now} /> : null}
        </VideoSheet>
      </Suspense>
    </>
  )
}
