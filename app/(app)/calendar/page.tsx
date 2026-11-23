import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, VideoIcon } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { createSerializer } from "nuqs/server"
import { Suspense } from "react"

import { PlatformBadge, StatusBadge, ToneBadge } from "@/components/badges"
import { CampaignPicker, DaySheet } from "@/components/calendar/calendar-controls"
import { CalendarGrid } from "@/components/calendar/calendar-grid"
import { cycleLabel } from "@/components/payouts/cycle-view"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { DisplayStatus } from "@/db/schema/enums"
import { env } from "@/lib/env"
import { PLATFORM_LABELS, formatCompact, formatDate, formatNumber } from "@/lib/format"
import { nextCycle, previousCycle } from "@/lib/payouts/cycles"
import { getCalendar, getCalendarDay, type CalendarDay, type CalendarDayPost } from "@/lib/queries/calendar"
import { listCampaignOptions } from "@/lib/queries/campaigns"
import { calendarParsers, loadCalendarParams } from "@/lib/search-params/calendar"
import { timeZoneLabel } from "@/lib/time-zones"

export const metadata: Metadata = { title: "Calendar" }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUS = {
  preview: { label: "Live", tone: "blue" },
  finalized: { label: "Finalized", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
} as const

const serialize = createSerializer(calendarParsers)

function DayPost({ post, timeZone }: { post: CalendarDayPost; timeZone: string }) {
  const src = post.thumbnailPath
    ? `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbnails/${post.thumbnailPath}`
    : null
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
    post.postedAt
  )
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="relative flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {src ? (
          <Image src={src} alt="" fill sizes="44px" className="object-cover" />
        ) : (
          <VideoIcon className="size-4 text-muted-foreground/60" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link href={`/videos?video=${post.id}`} className="truncate font-medium hover:underline">
          {post.caption || "No caption"}
        </Link>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PlatformBadge platform={post.platform} showLabel={false} />@{post.accountHandle} · {time}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-medium tabular-nums" title={formatNumber(post.currentViews)}>
          {formatCompact(post.currentViews)} views
        </span>
        <StatusBadge status={post.displayStatus as DisplayStatus} />
      </span>
    </li>
  )
}

function DayPosts({ day }: { day: CalendarDay }) {
  if (day.posts.length === 0) {
    return <p className="text-sm text-muted-foreground">No videos were posted on this day.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y">
        {day.posts.map((post) => (
          <DayPost key={post.id} post={post} timeZone={day.timezone} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Times in {timeZoneLabel(day.timezone)}. Excluded videos are listed but not counted on the calendar.
      </p>
    </div>
  )
}

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const params = await loadCalendarParams(props.searchParams)
  const campaigns = await listCampaignOptions()
  const now = new Date()

  if (campaigns.length === 0) {
    return (
      <>
        <PageHeader title="Calendar" description="Who posted on which day, and what is left to post" />
        <PageBody>
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDaysIcon />
              </EmptyMedia>
              <EmptyTitle>No campaign yet</EmptyTitle>
              <EmptyDescription>
                The calendar compares each creator&apos;s posts with their campaign quota.{" "}
                <Link href="/campaigns/new" className="underline underline-offset-4">
                  Create a campaign
                </Link>{" "}
                to start.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </PageBody>
      </>
    )
  }

  const campaignId =
    campaigns.find((c) => c.id === params.campaign)?.id ??
    (campaigns.find((c) => c.status === "active") ?? campaigns[0]).id
  const periodStart = params.period && ISO_DATE.test(params.period) ? params.period : null

  let view
  try {
    view = await getCalendar(campaignId, periodStart, now)
  } catch {
    // A period that is not a real date.
    notFound()
  }
  if (!view) notFound()

  const { cycle, campaign } = view
  const previous = previousCycle(cycle, campaign.weekStartsOn)
  const next = nextCycle(cycle, campaign.weekStartsOn)
  const status = STATUS[view.status]
  const base = { campaign: campaign.id, creator: null, day: null, platform: null }

  const day =
    params.creator && params.day && ISO_DATE.test(params.day)
      ? await getCalendarDay(view, { creatorId: params.creator, day: params.day, platform: params.platform })
      : null

  return (
    <>
      <PageHeader title="Calendar" description="Who posted on which day, and what is left to post" />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Link
              href={serialize("/calendar", { ...base, period: previous.periodStart })}
              className={buttonVariants({ variant: "outline", size: "icon-sm" })}
              aria-label="Previous cycle"
            >
              <ChevronLeftIcon />
            </Link>
            <Link
              href={serialize("/calendar", { ...base, period: next.periodStart })}
              aria-disabled={next.startsAt > now}
              className={`${buttonVariants({ variant: "outline", size: "icon-sm" })} ${next.startsAt > now ? "pointer-events-none opacity-40" : ""}`}
              aria-label="Next cycle"
            >
              <ChevronRightIcon />
            </Link>
          </div>
          <h2 className="text-base font-semibold tracking-tight">{cycleLabel(view)}</h2>
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
          <div className="ml-auto">
            <Suspense>
              <CampaignPicker campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} value={campaign.id} />
            </Suspense>
          </div>
        </div>

        {view.rows.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDaysIcon />
              </EmptyMedia>
              <EmptyTitle>No creators in this campaign</EmptyTitle>
              <EmptyDescription>
                Assign creators on the{" "}
                <Link href={`/campaigns/${campaign.id}?tab=people`} className="underline underline-offset-4">
                  campaign&apos;s People tab
                </Link>{" "}
                and they show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <CalendarGrid view={view} params={{ ...params, campaign: campaign.id, period: cycle.periodStart }} />
        )}
      </PageBody>

      <Suspense>
        <DaySheet
          open={Boolean(day)}
          title={day ? `${day.creatorName} · ${formatDate(day.day)}` : "Day"}
          description={
            day
              ? `${day.posts.length} ${day.posts.length === 1 ? "video" : "videos"}${day.platform ? ` on ${PLATFORM_LABELS[day.platform]}` : ""}`
              : "Videos posted on one day"
          }
        >
          {day ? <DayPosts day={day} /> : null}
        </DaySheet>
      </Suspense>
    </>
  )
}
