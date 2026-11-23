import type { Metadata } from "next"

import { PlatformBadge, ToneBadge } from "@/components/badges"
import { SparkSettingsForm } from "@/components/settings/spark-settings-form"
import { AccessLinkButton, AccessSwitch, InviteForm } from "@/components/settings/team-controls"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, formatNumber } from "@/lib/format"
import { getSettings } from "@/lib/queries/settings"

export const metadata: Metadata = { title: "Settings" }

const RUN_TONE = {
  queued: "neutral",
  running: "blue",
  succeeded: "blue",
  ingesting: "blue",
  ingested: "green",
  failed: "red",
  timed_out: "red",
  aborted: "red",
  ingest_failed: "red",
} as const

function Section({
  id,
  title,
  description,
  children,
}: {
  // Anchor, for links like /settings#spark.
  id?: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="grid scroll-mt-6 gap-x-10 gap-y-4 border-b pb-8 last:border-b-0 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

function Integration({
  name,
  ok,
  okText,
  missingText,
  children,
}: {
  name: string
  ok: boolean
  okText: string
  missingText: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        <ToneBadge tone={ok ? "green" : "neutral"}>{ok ? "Connected" : "Not set up"}</ToneBadge>
      </div>
      <p className="text-sm text-muted-foreground">{ok ? okText : missingText}</p>
      {children}
    </div>
  )
}

export default async function SettingsPage() {
  const now = new Date()
  const settings = await getSettings(now)
  const { apify } = settings
  const used = Math.min(100, (apify.spentUsd / apify.budgetUsd) * 100)

  return (
    <>
      <PageHeader title="Settings" description="Team, integrations, Spark suggestions and scrape runs" />
      <PageBody>
        <Section
          title="Team"
          description="Access is by invitation only. Every lock, exclusion and payout is recorded with the person who did it."
        >
          <InviteForm />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Added (UTC)</TableHead>
                  <TableHead className="w-24">Access</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.team.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.email}
                      {member.id === settings.currentUserId ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">you</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{member.fullName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(member.createdAt)}</TableCell>
                    <TableCell>
                      <AccessSwitch
                        id={member.id}
                        active={member.isActive}
                        disabled={member.id === settings.currentUserId}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {member.id === settings.currentUserId ? null : (
                        <AccessLinkButton id={member.id} email={member.email} disabled={!member.isActive} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section
          title="Integrations"
          description="Keys live in environment variables, never in the database. Change them in .env.local or in the Vercel project."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Integration
              name="Apify"
              ok={apify.configured}
              okText={`${apify.tiktokActor} and ${apify.instagramActor}. ${
                apify.webhooks
                  ? "Results arrive by webhook."
                  : "No public URL, so results are picked up by polling and the hourly job."
              }`}
              missingText="Set APIFY_TOKEN to scrape accounts."
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Spent this month</span>
                  <span className="font-medium tabular-nums">
                    ${apify.spentUsd.toFixed(2)} of ${apify.budgetUsd.toFixed(2)}
                  </span>
                </div>
                {/* Meter: the track is a lighter step of the fill's own colour. */}
                <div className={`h-1.5 w-full rounded-full ${used >= 100 ? "bg-red-100" : used >= 80 ? "bg-amber-100" : "bg-blue-100"}`}>
                  <div
                    className={`h-full rounded-full ${used >= 100 ? "bg-red-600" : used >= 80 ? "bg-amber-500" : "bg-brand"}`}
                    style={{ width: `${Math.max(2, used)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  At the limit, routine syncs pause. The scrape at window close always runs.
                </p>
              </div>
            </Integration>
            <Integration
              name="TikTok Ads"
              ok={settings.tiktokAds.configured}
              okText={`Paid Spark views are synced daily for advertiser ${settings.tiktokAds.advertiserIds} and subtracted inside each video's window.`}
              missingText="Set TIKTOK_ADS_ACCESS_TOKEN to subtract Spark views automatically. Until then, enter paid views on the video."
            />
          </div>
        </Section>

        <Section
          id="spark"
          title="Spark suggestions"
          description="What puts a video on the Spark page: strong engagement, or comments that ask about the app. The top comments of promising TikTok videos are read once a day to find them."
        >
          <SparkSettingsForm rules={settings.spark} />
        </Section>

        <Section title="Scheduled jobs" description="Called by Supabase Cron. Routine scraping happens in the daily sync (06:00 UTC). The hourly window-close check locks videos, and scrapes a video only when the daily sync missed it after its window ended. Anything else is started by hand.">
          {settings.jobs.length ? (
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Started (UTC)</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(job.startedAt)}</TableCell>
                      <TableCell className="font-medium">{job.job}</TableCell>
                      <TableCell>
                        <ToneBadge tone={job.status === "succeeded" ? "green" : job.status === "failed" ? "red" : "blue"}>
                          {job.status}
                        </ToneBadge>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">
                        {job.error ?? (job.summary ? JSON.stringify(job.summary) : "—")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No scheduled job has run yet.
            </p>
          )}
        </Section>

        <Section title="Scrape runs" description="Every Apify run this app started, newest first, with what it found and what it cost.">
          {settings.runs.length ? (
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Started (UTC)</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">New videos</TableHead>
                    <TableHead className="text-right">Snapshots</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.runs.map((run) => (
                    <TableRow key={run.id} title={run.error ?? undefined}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(run.startedAt)}</TableCell>
                      <TableCell>
                        <PlatformBadge platform={run.platform} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {run.kind.replaceAll("_", " ")} · {run.trigger}
                      </TableCell>
                      <TableCell>
                        <ToneBadge tone={RUN_TONE[run.status]}>{run.status.replaceAll("_", " ")}</ToneBadge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(run.itemsCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(run.postsCreated)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(run.snapshotsCreated)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {run.costUsd != null ? `$${run.costUsd.toFixed(3)}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No scrape has run yet. Use “Scrape now” on the Accounts page.
            </p>
          )}
        </Section>
      </PageBody>
    </>
  )
}
