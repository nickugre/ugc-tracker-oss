import { ExternalLinkIcon } from "lucide-react"

import { NeedsReviewIcon, PlatformBadge, REVIEW_TEXT, SparkBadge, StatusBadge } from "@/components/badges"
import { ViewsChart } from "@/components/charts/views-chart"
import { ReadCommentsButton } from "@/components/spark/read-comments-button"
import { VideoActions } from "@/components/videos/video-actions"
import { VideoPlayer } from "@/components/videos/video-player"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { DisplayStatus } from "@/db/schema/enums"
import { env } from "@/lib/env"
import { formatDateTime, formatNumber, formatPercent, formatRelative } from "@/lib/format"
import type { PostDetail } from "@/lib/queries/posts"
import { SPARK_PLATFORM } from "@/lib/spark/suggest"

const LOCK_METHOD: Record<string, string> = {
  exact: "Snapshot taken exactly at the window end",
  interpolated: "Interpolated between the snapshots around the window end",
  last_before: "Last snapshot before the window end",
  first_after: "First count the app has: the video was found after its window had ended",
  manual: "Entered manually",
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tracking-tight">{value}</dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

// What viewers wrote, with the comments about the app on top: people asking what the app is or
// where to get it is the clearest sign that a video converts (see the Spark page).
function AppComments({ detail }: { detail: PostDetail }) {
  const { post, comments } = detail
  const about = comments.filter((c) => c.keywords.length > 0)
  const rest = comments.filter((c) => c.keywords.length === 0)

  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold tracking-tight">Comments about the app</h3>
          <p className="text-xs text-muted-foreground">
            {comments.length
              ? `${about.length} of the ${comments.length} comments read ${about.length === 1 ? "matches" : "match"} a keyword from Settings.`
              : post.commentsChecks > 0
                ? "The last read brought back no comments."
                : "Not read yet. Comments are read automatically for videos that reach the Spark page's view minimum."}
          </p>
        </div>
        <ReadCommentsButton postId={post.id} again={post.commentsChecks > 0} />
      </div>
      {about.length ? (
        <ul className="flex flex-col gap-1.5">
          {about.map((c) => (
            <li key={c.id} className="rounded-lg bg-violet-50 px-3 py-2 text-sm ring-1 ring-violet-600/10 ring-inset">
              <p className="leading-snug">{c.text}</p>
              <p className="text-xs text-muted-foreground">
                {c.authorHandle ? `@${c.authorHandle} · ` : ""}
                {formatNumber(c.likes ?? 0)} {c.likes === 1 ? "like" : "likes"}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {rest.length ? (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {about.length ? `The other ${rest.length} comments` : `All ${rest.length} comments read`}
          </summary>
          <ul className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-auto">
            {rest.map((c) => (
              <li key={c.id} className="leading-snug text-muted-foreground">
                {c.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

// Rendered on the server inside the Videos page's side sheet and on /videos/[id].
export function VideoDetail({ detail, now }: { detail: PostDetail; now: Date }) {
  const { post } = detail
  const timeZone = detail.timezone ?? "UTC"
  const status = post.displayStatus as DisplayStatus
  const windowClosed = post.windowEndsAt <= now
  const paidViews = post.paidViewsManual ?? post.paidViewsSynced
  const organicNow = Math.max(0, post.currentViews - (paidViews ?? 0))
  const details = post.lockDetails

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <VideoPlayer
          platform={post.platform}
          platformPostId={post.platformPostId}
          thumbnailSrc={
            post.thumbnailPath
              ? `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbnails/${post.thumbnailPath}`
              : null
          }
        />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformBadge platform={post.platform} />
            <StatusBadge status={status} />
            {post.isSpark ? <SparkBadge /> : null}
            {post.needsReview ? <NeedsReviewIcon reason={post.reviewReason} /> : null}
          </div>
          <p className="text-sm leading-snug">{post.caption || "No caption"}</p>
          <p className="text-xs text-muted-foreground">
            @{detail.accountHandle} · {detail.creatorName ?? "No creator"} · {detail.campaignName ?? "No campaign"}
          </p>
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-brand underline-offset-4 hover:underline"
          >
            Open on {post.platform === "tiktok" ? "TikTok" : "the platform"}
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </header>

      {post.needsReview && post.reviewReason ? (
        <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900 ring-1 ring-orange-600/15 ring-inset">
          {REVIEW_TEXT[post.reviewReason] ?? "Needs review."}
        </p>
      ) : null}
      {post.isExcluded ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Excluded from payout{post.excludedReason ? `: ${post.excludedReason}` : "."}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Stat
          label="Current views"
          value={formatNumber(post.currentViews)}
          hint={post.views24hDelta != null ? `+${formatNumber(post.views24hDelta)} in 24h` : undefined}
        />
        <Stat
          label={post.lockedViews != null ? "Locked views" : "Organic so far"}
          value={formatNumber(post.lockedViews ?? organicNow)}
          hint={post.lockedViews != null ? (post.lockMethod ? LOCK_METHOD[post.lockMethod] : undefined) : "Not locked yet"}
        />
        <Stat
          label="Payable views"
          value={post.payableViews != null ? formatNumber(post.payableViews) : "—"}
          hint={paidViews ? `${formatNumber(paidViews)} paid views subtracted` : "No paid views"}
        />
        <Stat label="Posted" value={formatDateTime(post.postedAt, timeZone)} />
        <Stat
          label={`Window ends (${post.windowDays}d${post.windowOverridden ? ", custom" : ""})`}
          value={formatDateTime(post.windowEndsAt, timeZone)}
          hint={formatRelative(post.windowEndsAt, now)}
        />
        <Stat label="Engagement" value={formatPercent(post.engagementRate)} hint={`Share rate ${formatPercent(post.virality, 2)}`} />
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Views over time</h3>
        <ViewsChart
          points={detail.snapshots.map((s) => ({ t: s.capturedAt.getTime(), views: s.views }))}
          marker={{ t: post.windowEndsAt.getTime(), label: "Window end" }}
          timeZone={timeZone}
        />
        {details?.before && details.after ? (
          <p className="text-xs text-muted-foreground">
            Locked between {formatNumber(details.before.views)} ({formatDateTime(new Date(details.before.capturedAt), timeZone)}) and{" "}
            {formatNumber(details.after.views)} ({formatDateTime(new Date(details.after.capturedAt), timeZone)}),{" "}
            {Math.round((details.fraction ?? 0) * 100)}% of the way through that interval.
          </p>
        ) : null}
      </section>

      <VideoActions
        post={{
          id: post.id,
          displayStatus: status,
          status: post.status,
          isExcluded: post.isExcluded,
          isSettled: post.status === "paid" || post.bonusCycleId != null,
          windowClosed,
          windowDays: post.windowDays,
          windowOverridden: post.windowOverridden,
          campaignWindowDays: detail.campaignWindowDays,
          needsReview: post.needsReview,
          lockedViews: post.lockedViews,
          currentViews: post.currentViews,
          isSpark: post.isSpark,
          sparkHint: post.sparkHint,
          sparkSource: post.sparkSource,
          sparkStartedAtIso: post.sparkStartedAt?.toISOString() ?? null,
          paidViewsManual: post.paidViewsManual,
          paidViewsSynced: post.paidViewsSynced,
          notes: post.notes ?? "",
        }}
      />

      {post.platform === SPARK_PLATFORM ? <AppComments detail={detail} /> : null}

      {detail.paidDaily.length ? (
        <section className="flex flex-col gap-2 border-t pt-5">
          <h3 className="text-sm font-semibold tracking-tight">Paid views from TikTok Ads</h3>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Day ({detail.paidDaily[0].timezone})</TableHead>
                  <TableHead className="text-right">Paid views</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.paidDaily.map((d) => (
                  <TableRow key={d.statDate}>
                    <TableCell>{d.statDate}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(d.views)}</TableCell>
                    <TableCell className="text-right tabular-nums">${d.spend.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 border-t pt-5">
        <h3 className="text-sm font-semibold tracking-tight">Scrape history</h3>
        <div className="max-h-72 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Captured</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Likes</TableHead>
                <TableHead className="text-right">Comments</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Saves</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...detail.snapshots].reverse().map((s) => (
                <TableRow key={s.id} className={s.capturedAt > post.windowEndsAt ? "text-muted-foreground" : undefined}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(s.capturedAt, timeZone)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.likes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.comments)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.shares)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.saves)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.kind.replaceAll("_", " ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Rows after the window end are shown in gray.</p>
      </section>

      {detail.history.length ? (
        <section className="flex flex-col gap-2 border-t pt-5">
          <h3 className="text-sm font-semibold tracking-tight">Activity</h3>
          <ul className="flex flex-col gap-2">
            {detail.history.map((h) => (
              <li key={h.id} className="text-sm">
                <span className="font-medium">{h.action.replace("post.", "").replaceAll("_", " ")}</span>{" "}
                <span className="text-muted-foreground">
                  by {h.actorEmail ?? "system"} · {formatRelative(h.createdAt, now)}
                </span>
                {h.reason ? <p className="text-xs text-muted-foreground">“{h.reason}”</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
