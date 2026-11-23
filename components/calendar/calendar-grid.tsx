import { cn } from "cn"
import Link from "next/link"
import { createSerializer } from "nuqs/server"

import { PlatformBadge, ToneBadge } from "@/components/badges"
import type { DayCell, DayState } from "@/lib/calendar/grid"
import { PLATFORM_LABELS, formatDate, formatNumber } from "@/lib/format"
import type { CalendarRow, CalendarTrack, CalendarView } from "@/lib/queries/calendar"
import { calendarParsers, type CalendarParams } from "@/lib/search-params/calendar"
import { timeZoneLabel } from "@/lib/time-zones"

const serialize = createSerializer(calendarParsers)

// Same soft tints as the status badges: the colour says how the day went, the number how many.
const CELL_STYLES: Record<DayState, string> = {
  off: "text-muted-foreground/60",
  pending: "border border-dashed border-zinc-300 text-muted-foreground",
  missed: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/15",
  below: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  hit: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  idle: "text-muted-foreground/50",
  posted: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-500/15",
}

const STATE_LABELS: Record<DayState, string> = {
  off: "Nothing expected",
  pending: "Not fully scraped yet",
  missed: "Missed",
  below: "Below target",
  hit: "On target",
  idle: "No post",
  posted: "Posted",
}

const weekdayLetter = new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" })
const asUtc = (day: string) => new Date(`${day}T00:00:00Z`)

function cellText(cell: DayCell) {
  if (cell.count > 0) return String(cell.count)
  if (cell.state === "missed") return "0"
  return cell.state === "idle" ? "·" : ""
}

function Cell({
  cell,
  row,
  track,
  params,
}: {
  cell: DayCell
  row: CalendarRow
  track: CalendarTrack
  params: CalendarParams
}) {
  const selected =
    params.creator === row.creatorId && params.day === cell.day && (params.platform ?? null) === track.platform
  const title = [
    formatDate(cell.day),
    track.platform ? PLATFORM_LABELS[track.platform] : null,
    track.perDay !== null && cell.state !== "off"
      ? `${cell.count} of ${track.perDay} ${track.perDay === 1 ? "post" : "posts"}`
      : `${cell.count} ${cell.count === 1 ? "post" : "posts"}`,
    STATE_LABELS[cell.state],
  ]
    .filter(Boolean)
    .join(" · ")
  const className = cn(
    "flex h-7 w-6 items-center justify-center rounded-md text-xs font-medium tabular-nums",
    CELL_STYLES[cell.state],
    selected && "ring-2 ring-foreground ring-inset"
  )

  // Only a day with videos has something to open.
  if (cell.count === 0) {
    return (
      <span className={className} title={title}>
        {cellText(cell)}
      </span>
    )
  }
  return (
    <Link
      href={serialize("/calendar", { ...params, creator: row.creatorId, day: cell.day, platform: track.platform })}
      scroll={false}
      // A month of cells per creator: prefetching every one of them would flood the server.
      prefetch={false}
      className={cn(className, "hover:brightness-95")}
      title={title}
    >
      {cellText(cell)}
    </Link>
  )
}

function TrackTotals({ track, ended, edge }: { track: CalendarTrack; ended: boolean; edge: string }) {
  const done = track.left === 0
  // Needing more than the normal daily target means the creator is behind.
  const behind = track.pace !== null && track.perDay !== null && track.pace > track.perDay
  return (
    <>
      <td className={cn("px-2.5 text-right whitespace-nowrap tabular-nums", edge)}>
        <span className="font-medium">{formatNumber(track.posted)}</span>
        <span className="text-muted-foreground"> / {track.quota ?? "—"}</span>
      </td>
      <td className={cn("text-right whitespace-nowrap tabular-nums", ended ? "pr-4 pl-2.5" : "px-2.5", edge)}>
        {track.left === null ? (
          <span className="text-muted-foreground">—</span>
        ) : done ? (
          <span className="text-emerald-700">Done</span>
        ) : (
          <span className={cn("font-medium", ended && "text-red-700")}>{formatNumber(track.left)}</span>
        )}
      </td>
      {ended ? null : (
        <td className={cn("pr-4 pl-2.5 text-right whitespace-nowrap tabular-nums text-muted-foreground", edge)}>
          {track.pace === null || done ? (
            "—"
          ) : (
            <span className={behind ? "font-medium text-amber-700" : undefined}>{track.pace.toFixed(1)} / day</span>
          )}
        </td>
      )}
    </>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Summary({ view }: { view: CalendarView }) {
  const { totals, cycle } = view
  if (!totals) return null
  const daysLeft = view.ended ? 0 : view.days.filter((day) => day >= view.today).length
  const pace = totals.left > 0 && daysLeft > 0 ? totals.left / daysLeft : null
  return (
    <div className={cn("grid gap-3", view.ended ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
      <Tile
        label="Posted this cycle"
        value={`${formatNumber(totals.delivered)} / ${formatNumber(totals.quota)}`}
        hint="Counted the same way as base pay on Payouts"
      />
      <Tile
        label={view.ended ? "Not delivered" : "Left to post"}
        value={formatNumber(totals.left)}
        hint={
          view.ended
            ? `The cycle ended ${formatDate(cycle.periodEnd)}`
            : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left, until ${formatDate(cycle.periodEnd)}`
        }
      />
      {view.ended ? null : (
        <Tile
          label="Pace needed"
          value={pace === null ? "—" : `${pace.toFixed(1)} / day`}
          hint={pace === null ? "Every quota is filled" : "All creators together"}
        />
      )}
    </div>
  )
}

const LEGEND: { state: DayState; sample: string; label: string }[] = [
  { state: "hit", sample: "2", label: "On target" },
  { state: "below", sample: "1", label: "Below target" },
  { state: "missed", sample: "0", label: "Missed" },
  { state: "pending", sample: "", label: "Waiting for the next scrape" },
]

export function CalendarGrid({ view, params }: { view: CalendarView; params: CalendarParams }) {
  // Two pinned columns, so a day scrolled into view still says whose it is and on which platform.
  // The first has a fixed width because the second is offset by exactly that much.
  const sticky = "sticky left-0 z-10 w-40 max-w-40 min-w-40 bg-background"
  const stickyLabel = "sticky left-40 z-10 bg-background"
  // bg-muted/40 as a solid colour: the sticky header cell must hide the days scrolling under it.
  const head = "border-b bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]"

  return (
    <div className="flex flex-col gap-4">
      <Summary view={view} />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className={cn(sticky, head, "px-4 py-2 text-left font-medium")}>Creator</th>
              <th className={cn(stickyLabel, head)} />
              {view.days.map((day) => (
                <th key={day} className={cn(head, "px-px py-1.5 font-normal")}>
                  <span
                    className={cn(
                      "flex w-6 flex-col items-center leading-tight",
                      day === view.today && "font-semibold text-foreground"
                    )}
                  >
                    <span className="text-[10px]">{weekdayLetter.format(asUtc(day))}</span>
                    <span className="tabular-nums">{asUtc(day).getUTCDate()}</span>
                  </span>
                </th>
              ))}
              <th className={cn(head, "px-2.5 text-right font-medium")}>Posted</th>
              {view.ended ? (
                <th className={cn(head, "pr-4 pl-2.5 text-right font-medium")}>Short</th>
              ) : (
                <>
                  <th className={cn(head, "px-2.5 text-right font-medium")}>Left</th>
                  <th className={cn(head, "pr-4 pl-2.5 text-right font-medium")}>Pace</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, rowIndex) =>
              row.tracks.map((track, index) => {
                // One line under each creator's block of tracks; the table's own border closes the last.
                const divider = rowIndex < view.rows.length - 1 ? "border-b" : ""
                const edge = index === row.tracks.length - 1 ? divider : ""
                const empty = track.note === "no_account" && track.cells.every((cell) => cell.count === 0)
                return (
                  <tr key={`${row.creatorId}:${track.platform ?? "all"}`}>
                    {index === 0 ? (
                      <td
                        rowSpan={row.tracks.length}
                        className={cn(sticky, "px-4 py-2 align-top", divider)}
                      >
                        <Link href={`/creators/${row.creatorId}`} className="block truncate font-medium hover:underline">
                          {row.creatorName}
                        </Link>
                        <span className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                          {row.status !== "active" ? <ToneBadge className="capitalize">{row.status}</ToneBadge> : null}
                          {row.timezone !== view.campaign.timezone ? timeZoneLabel(row.timezone) : null}
                        </span>
                      </td>
                    ) : null}
                    <td className={cn(stickyLabel, "py-1 pr-2 pl-1", edge)}>
                      {track.platform ? (
                        <PlatformBadge platform={track.platform} showLabel={false} />
                      ) : (
                        <span className="text-xs text-muted-foreground">All</span>
                      )}
                    </td>
                    {empty ? (
                      <td colSpan={view.days.length} className={cn("px-2 text-xs text-muted-foreground", edge)}>
                        No {track.platform ? `${PLATFORM_LABELS[track.platform]} ` : ""}account linked to this
                        campaign, so there is nothing to count yet.
                      </td>
                    ) : (
                      track.cells.map((cell) => (
                        <td key={cell.day} className={cn("px-px py-1", edge)}>
                          <Cell cell={cell} row={row} track={track} params={params} />
                        </td>
                      ))
                    )}
                    <TrackTotals track={track} ended={view.ended} edge={edge} />
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {LEGEND.map((item) => (
          <span key={item.state} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded text-[11px] font-medium tabular-nums",
                CELL_STYLES[item.state]
              )}
            >
              {item.sample}
            </span>
            {item.label}
          </span>
        ))}
        <span className="basis-full sm:ml-auto sm:basis-auto">
          Days follow each creator&apos;s own time zone; Posted and Left follow the payout cycle (
          {timeZoneLabel(view.campaign.timezone)}).
        </span>
      </div>
    </div>
  )
}
