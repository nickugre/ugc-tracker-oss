import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react"
import Link from "next/link"

import { PlatformBadge, ToneBadge } from "@/components/badges"
import {
  AdjustmentButton,
  FinalizeButton,
  MarkPaidButton,
  RemoveAdjustmentButton,
  ReopenButton,
} from "@/components/payouts/cycle-actions"
import { buttonVariants } from "@/components/ui/button"
import { formatCompact, formatDate, formatNumber } from "@/lib/format"
import { formatCents } from "@/lib/money/cents"
import { nextCycle, previousCycle } from "@/lib/payouts/cycles"
import { baseTermsFor, explainBase, type BaseBreakdown } from "@/lib/payouts/base-breakdown"
import type { WatchRow } from "@/lib/payouts/milestone-watch"
import type { AttentionPost, CycleView as CycleViewData, PreviewLine } from "@/lib/payouts/service"

const STATUS = {
  preview: { label: "Live preview", tone: "blue" },
  finalized: { label: "Finalized · not paid", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
} as const

export function cycleLabel(view: Pick<CycleViewData, "cycle">) {
  const { cycle } = view
  if (cycle.cycleType === "monthly") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${cycle.periodStart}T00:00:00Z`)
    )
  }
  return `${formatDate(cycle.periodStart)} – ${formatDate(cycle.periodEnd)}`
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Line({ line, view }: { line: PreviewLine; view: CycleViewData }) {
  const p = line.payout
  const best = line.bonusPosts.find((post) => post.id === p.bestPostId)
  const short = p.quota != null && p.postsDelivered < p.quota

  return (
    <details className="group border-b last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-muted/40 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1.4fr_1fr_1fr_104px]">
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <span className="truncate font-medium">{line.creatorName}</span>
          {line.hasOverrides ? <ToneBadge>Custom terms</ToneBadge> : null}
        </span>
        <span className="tabular-nums">
          <span className={short ? "font-medium text-amber-700" : undefined}>{p.postsDelivered}</span>
          <span className="text-muted-foreground"> / {p.quota ?? "—"} posts</span>
        </span>
        <span className="tabular-nums">{formatCents(p.baseCents)}</span>
        <span className="tabular-nums text-muted-foreground">
          {p.tier
            ? `${formatCompact(best?.payableViews ?? p.tier.views)} views → ${formatCompact(p.tier.views)} tier`
            : line.bonusPosts.length
              ? `${line.bonusPosts.length} closed, no tier`
              : "No closed videos"}
        </span>
        <span className="tabular-nums">{formatCents(p.bonusCents)}</span>
        <span className="font-semibold tabular-nums">{formatCents(p.totalCents)}</span>
        <span className="flex items-center justify-end gap-2" data-no-toggle>
          {line.status === "paid" ? <ToneBadge tone="green">Paid</ToneBadge> : null}
          {line.status === "unpaid" && line.lineId && view.cycleId ? (
            <MarkPaidButton
              cycleId={view.cycleId}
              lineId={line.lineId}
              label="Mark paid"
              amountCents={p.totalCents}
              who={line.creatorName}
              variant="outline"
            />
          ) : null}
        </span>
      </summary>

      <div className="flex flex-col gap-4 bg-muted/20 px-4 py-4 pl-10 text-sm">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Published / delivered</dt>
            <dd className="tabular-nums">
              {p.postsPublished} / {p.postsDelivered}
              {line.latePosts ? ` (incl. ${line.latePosts} late from last cycle)` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">By platform</dt>
            <dd className="flex flex-wrap gap-x-3 tabular-nums">
              {Object.entries(p.publishedByPlatform).map(([platform, count]) => (
                <span key={platform}>
                  {platform}: {count}
                </span>
              ))}
              {Object.keys(p.publishedByPlatform).length === 0 ? "—" : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Removed by caps</dt>
            <dd className="tabular-nums">{p.capReductionCents ? formatCents(p.capReductionCents) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Adjustments</dt>
            <dd className="tabular-nums">{p.adjustmentsCents ? formatCents(p.adjustmentsCents) : "—"}</dd>
          </div>
        </dl>

        {line.adjustments.length ? (
          <ul className="flex flex-col gap-1">
            {line.adjustments.map((a) => (
              <li key={a.id} className="flex items-center gap-3">
                <span className="font-medium tabular-nums">{formatCents(a.amountCents)}</span>
                <span className="text-muted-foreground">{a.reason}</span>
                {view.status === "preview" ? <RemoveAdjustmentButton id={a.id} /> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {line.bonusPosts.length ? (
          <div className="overflow-hidden rounded-lg border bg-background">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Closed video</th>
                  <th className="px-3 py-2 font-medium">Window ended</th>
                  <th className="px-3 py-2 text-right font-medium">Locked</th>
                  <th className="px-3 py-2 text-right font-medium">Paid views</th>
                  <th className="px-3 py-2 text-right font-medium">Payable</th>
                  <th className="px-3 py-2 text-right font-medium">Bonus</th>
                </tr>
              </thead>
              <tbody>
                {line.bonusPosts.map((post) => {
                  const item = p.bonusItems.find((i) => i.postId === post.id)
                  return (
                    <tr key={post.id} className="border-b last:border-b-0">
                      <td className="max-w-64 px-3 py-2">
                        <Link href={`/videos?video=${post.id}`} className="flex items-center gap-2 hover:underline">
                          <PlatformBadge platform={post.platform} showLabel={false} />
                          <span className="truncate">{post.caption || "No caption"}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {formatDate(post.windowEndsAt, view.cycle.timezone)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(post.lockedViews)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {post.paidViews ? `−${formatNumber(post.paidViews)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(post.payableViews)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item?.amountCents ? (
                          <span className="font-medium">{formatCents(item.amountCents)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  )
}

function AttentionList({ posts, timeZone }: { posts: AttentionPost[]; timeZone: string }) {
  return (
    <ul className="divide-y rounded-lg border">
      {posts.map((post) => (
        <li key={post.id} className="flex items-center gap-3 px-4 py-2 text-sm">
          <PlatformBadge platform={post.platform} showLabel={false} />
          <Link href={`/videos?video=${post.id}`} className="min-w-0 flex-1 truncate hover:underline">
            {post.caption || "No caption"}
          </Link>
          <span className="hidden text-muted-foreground sm:inline">{post.creatorName ?? "No creator"}</span>
          <span className="tabular-nums text-muted-foreground">{formatCompact(post.currentViews)} views</span>
          <span className="w-44 text-right text-xs text-muted-foreground">
            {post.reason === "needs_review"
              ? `Needs review: ${(post.reviewReason ?? "").replaceAll("_", " ")}`
              : post.reason === "not_locked"
                ? "Window closed, not locked yet"
                : `Window ends ${formatDate(post.windowEndsAt, timeZone)}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

function baseTermsText(base: BaseBreakdown) {
  const amount = formatCents(base.amountCents)
  const perPlatform = base.platforms[0]?.quota ?? null
  switch (base.kind) {
    case "prorated_retainer":
      if (base.bestPlatformCounts) {
        return `${amount} retainer for ${formatNumber(base.quota)} videos, each posted on every platform, paid in proportion to what was published. The platform with the most videos sets the count, so 60 on one platform and 50 on another count as 60.`
      }
      return perPlatform != null
        ? `${amount} retainer for ${formatNumber(perPlatform)} videos on each platform (${formatNumber(base.quota)} in total), paid in proportion to what was published. Extra videos on one platform do not make up for another.`
        : `${amount} retainer for ${formatNumber(base.quota)} videos, paid in proportion to what was published.`
    case "fixed_retainer":
      return `${amount} retainer, paid in full whatever the number of videos.`
    case "per_video":
      return base.quota != null ? `${amount} per video, for up to ${formatNumber(base.quota)} videos.` : `${amount} per video.`
    case "none":
      return "This campaign has no base pay."
  }
}

function baseFormula(base: BaseBreakdown) {
  const amount = formatCents(base.amountCents)
  if (base.kind === "prorated_retainer") {
    return `${amount} × ${formatNumber(base.counted)} ÷ ${formatNumber(base.quota)} = ${formatCents(base.earnedCents)}`
  }
  if (base.kind === "per_video") return `${amount} × ${formatNumber(base.counted)} = ${formatCents(base.earnedCents)}`
  return formatCents(base.earnedCents)
}

// Why the base is what it is: what each creator published, what counts, and the sum.
function BaseList({ view }: { view: CycleViewData }) {
  const rows = view.lines.map((line) => ({
    line,
    // A line finalized before base terms were stored falls back to the campaign's terms, which
    // is only right for a creator without terms of their own.
    base: explainBase(line.baseTerms ?? baseTermsFor(view.rules, view.cycle.days), line.payout),
    termsKnown: line.baseTerms !== null || !line.hasOverrides,
  }))
  if (!rows.length || rows.every((r) => r.base.kind === "none")) return null

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-tight">Base pay</h3>
        <p className="text-sm text-muted-foreground">
          Counts the videos published in this cycle, by the day they were posted. Views play no part in it.
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {rows.map(({ line, base, termsKnown }) => (
          <li key={line.creatorId} className="flex flex-col gap-2 px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{line.creatorName}</span>
              <span className="font-medium tabular-nums">{formatCents(base.paidCents)}</span>
            </div>
            <p className="text-muted-foreground">
              {termsKnown
                ? baseTermsText(base)
                : "Paid on this creator's own terms, which were not recorded with this cycle. The amount was fixed when it was finalized."}
            </p>
            {base.kind !== "none" ? (
              <>
                <div className="flex flex-wrap gap-x-8 gap-y-1 tabular-nums">
                  {base.platforms.map((p) => (
                    <span key={p.platform} className="flex items-center gap-2">
                      <PlatformBadge platform={p.platform} />
                      <span>
                        {formatNumber(p.counted)}
                        {p.quota != null ? ` of ${formatNumber(p.quota)}` : ""} count
                      </span>
                      <span className="text-muted-foreground">
                        {p.published > p.counted ? `${formatNumber(p.published)} published · ` : ""}
                        {base.bestPlatformCounts
                          ? p.counted > 0 && p.counted === base.counted
                            ? "sets the count"
                            : ""
                          : p.missing
                            ? `${formatNumber(p.missing)} to go`
                            : p.quota != null
                              ? "quota reached"
                              : ""}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="tabular-nums">
                  {termsKnown ? baseFormula(base) : `${formatNumber(base.counted)} videos counted`}
                  <span className="text-muted-foreground">
                    {termsKnown && base.paidCents < base.earnedCents
                      ? ` · reduced to ${formatCents(base.paidCents)} by the campaign's total cap`
                      : ""}
                    {termsKnown && base.missing
                      ? ` · ${formatNumber(base.missing)} more for the full ${formatCents(base.amountCents)}`
                      : ""}
                    {line.latePosts ? ` · includes ${formatNumber(line.latePosts)} posted at the end of the previous cycle` : ""}
                  </span>
                </p>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

const SCOPE_TEXT = {
  per_video: "Every video is paid for the tier it reaches.",
  creator_cycle_best: "Tiers do not stack: only each creator's best video of the cycle is paid.",
  creator_campaign_lifetime: "Each tier is paid once per creator for the whole campaign, on their best video.",
} as const

function watchReason(row: WatchRow, timeZone: string) {
  const worth = row.potentialCents ? formatCents(row.potentialCents) : null
  switch (row.state) {
    case "pays":
      return `Pays ${formatCents(row.amountCents)}`
    case "outranked":
      return "Not paid: a better video sets the tier"
    case "no_tier":
      return "Locked below the first tier"
    case "needs_review":
      return worth ? `Not counted until reviewed · would be ${worth}` : "Not counted until reviewed"
    case "not_locked":
      return "Window closed, waiting for the lock"
    case "open_window":
      return `Locks ${formatDate(row.windowEndsAt, timeZone)}${worth ? ` · ${worth} so far` : ""}`
    case "rolls_over":
      return `Counts next cycle · window ends ${formatDate(row.windowEndsAt, timeZone)}`
  }
}

// Why the bonus is what it is: every video at or near a tier, and whether it counts.
function MilestoneList({ view }: { view: CycleViewData }) {
  const { milestones: ladder, milestoneScope } = view.rules.bonus
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-tight">Milestones</h3>
        <p className="text-sm text-muted-foreground">
          {ladder.map((t) => `${formatCompact(t.views)} → ${formatCents(t.amountCents)}`).join(" · ")}.{" "}
          {SCOPE_TEXT[milestoneScope]} Views are payable views once a video is locked, today&apos;s views until then.
        </p>
      </div>
      {view.milestones.length ? (
        <ul className="divide-y rounded-lg border">
          {view.milestones.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <PlatformBadge platform={row.platform} showLabel={false} />
              <Link href={`/videos?video=${row.id}`} className="min-w-0 flex-1 basis-40 truncate hover:underline">
                {row.caption || "No caption"}
              </Link>
              <span className="hidden text-muted-foreground lg:inline">{row.creatorName ?? "No creator"}</span>
              <span className="w-28 text-right tabular-nums" title={row.isLocked ? "Payable views (locked)" : "Views today, not locked yet"}>
                {formatNumber(row.views)}
                <span className="text-muted-foreground">{row.isLocked ? " locked" : " today"}</span>
              </span>
              <span className="w-32">
                {row.tier ? (
                  <ToneBadge tone={row.state === "pays" ? "green" : "neutral"}>
                    {formatCompact(row.tier.views)} tier · {formatCents(row.tier.amountCents)}
                  </ToneBadge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {formatNumber(row.shortBy)} short of {formatCompact(row.nextTier?.views)}
                  </span>
                )}
              </span>
              <span
                className={`w-64 text-right text-xs ${row.state === "pays" ? "font-medium text-emerald-700" : "text-muted-foreground"}`}
              >
                {watchReason(row, view.cycle.timezone)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No video is at or near the first tier yet.
        </p>
      )}
    </section>
  )
}

// One payout cycle of one campaign: a live preview until it is finalized, then the frozen result.
export function CycleView({ view, basePath, now }: { view: CycleViewData; basePath: string; now: Date }) {
  const { cycle, campaign } = view
  const previous = previousCycle(cycle, campaign.weekStartsOn)
  const next = nextCycle(cycle, campaign.weekStartsOn)
  const status = STATUS[view.status]
  const unpaid = view.lines.filter((l) => l.status === "unpaid")
  const finalizeFromLabel = formatDate(cycle.periodEnd)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={`${basePath}${basePath.includes("?") ? "&" : "?"}period=${previous.periodStart}`}
            className={buttonVariants({ variant: "outline", size: "icon-sm" })}
            aria-label="Previous cycle"
          >
            <ChevronLeftIcon />
          </Link>
          <Link
            href={`${basePath}${basePath.includes("?") ? "&" : "?"}period=${next.periodStart}`}
            aria-disabled={next.startsAt > now}
            className={`${buttonVariants({ variant: "outline", size: "icon-sm" })} ${next.startsAt > now ? "pointer-events-none opacity-40" : ""}`}
            aria-label="Next cycle"
          >
            <ChevronRightIcon />
          </Link>
        </div>
        <h2 className="text-base font-semibold tracking-tight">{cycleLabel(view)}</h2>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        <span className="text-sm text-muted-foreground">Payday {formatDate(view.payday)}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a
            href={`/api/payouts/export?campaign=${campaign.id}&period=${cycle.periodStart}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <DownloadIcon />
            CSV
          </a>
          {view.status === "preview" ? (
            <>
              <AdjustmentButton
                campaignId={campaign.id}
                cycleType={cycle.cycleType}
                periodStart={cycle.periodStart}
                creators={view.lines.map((l) => ({ id: l.creatorId, name: l.creatorName }))}
              />
              <FinalizeButton
                campaignId={campaign.id}
                periodStart={cycle.periodStart}
                totalCents={view.totals.totalCents}
                lineCount={view.lines.length}
                blockedCount={view.blocked.length}
                canFinalize={view.canFinalize}
                finalizeFromLabel={finalizeFromLabel}
              />
            </>
          ) : null}
          {view.status === "finalized" && view.cycleId ? (
            <>
              {unpaid.length === view.lines.length ? <ReopenButton cycleId={view.cycleId} /> : null}
              <MarkPaidButton
                cycleId={view.cycleId}
                label={unpaid.length === view.lines.length ? "Mark all paid" : `Mark remaining ${unpaid.length} paid`}
                amountCents={unpaid.reduce((sum, l) => sum + l.payout.totalCents, 0)}
                who={`${unpaid.length} creators`}
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={view.status === "paid" ? "Total paid" : "Total to pay"}
          value={formatCents(view.totals.totalCents)}
          hint={`${view.lines.length} ${view.lines.length === 1 ? "creator" : "creators"}`}
        />
        <Tile label="Base" value={formatCents(view.totals.baseCents)} hint="Posts published in the cycle" />
        <Tile label="Bonuses" value={formatCents(view.totals.bonusCents)} hint="Videos whose window has closed" />
        <Tile label="Adjustments" value={formatCents(view.totals.adjustmentsCents)} hint="Manual corrections, after caps" />
      </div>

      <BaseList view={view} />

      {view.status === "preview" && view.rules.bonus.milestones.length ? <MilestoneList view={view} /> : null}

      {view.blocked.length ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-orange-900">
              {view.blocked.length} {view.blocked.length === 1 ? "video needs" : "videos need"} attention before
              finalizing
            </h3>
            <Link
              href={`/videos?flag=review&campaign=${campaign.id}`}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Select them in Videos to lock or exclude in bulk
            </Link>
          </div>
          <AttentionList posts={view.blocked} timeZone={cycle.timezone} />
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        {view.lines.length ? (
          <div className="overflow-hidden rounded-lg border">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_1fr_1fr_1.4fr_1fr_1fr_104px] gap-x-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span className="pl-5">Creator</span>
              <span>Delivered</span>
              <span>Base</span>
              <span>Best closed video</span>
              <span>Bonus</span>
              <span>Total</span>
              <span />
            </div>
            {view.lines.map((line) => (
              <Line key={line.creatorId} line={line} view={view} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing to pay in this cycle. Assign creators to the campaign and track their accounts.
          </p>
        )}
      </section>

      {view.held.length ? (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold tracking-tight">
            <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
            {view.held.length} {view.held.length === 1 ? "video" : "videos"} still in {view.held.length === 1 ? "its" : "their"} view window
            <span className="font-normal text-muted-foreground">— paid in a later cycle</span>
          </summary>
          <div className="mt-3">
            <AttentionList posts={view.held} timeZone={cycle.timezone} />
          </div>
        </details>
      ) : null}
    </div>
  )
}
