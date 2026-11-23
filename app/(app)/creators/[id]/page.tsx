import { PencilIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PlatformBadge, ToneBadge } from "@/components/badges"
import { CreatorDialog } from "@/components/creators/creator-dialog"
import { PageBody, PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { formatCompact } from "@/lib/format"
import { getCreator, getCreatorLinks } from "@/lib/queries/creators"
import { timeZoneLabel } from "@/lib/time-zones"

export const metadata: Metadata = { title: "Creator" }

const STATUS_TONE = { active: "green", paused: "amber", ended: "neutral" } as const

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  )
}

export default async function CreatorPage(props: PageProps<"/creators/[id]">) {
  const { id } = await props.params
  const creator = await getCreator(id)
  if (!creator) notFound()
  const links = await getCreatorLinks(id)

  return (
    <>
      <PageHeader title={creator.name} description="Creator">
        <ToneBadge tone={STATUS_TONE[creator.status]} className="capitalize">
          {creator.status}
        </ToneBadge>
        <CreatorDialog
          creatorId={creator.id}
          initial={{
            name: creator.name,
            email: creator.email ?? "",
            phone: creator.phone ?? "",
            contactHandle: creator.contactHandle ?? "",
            country: creator.country ?? "",
            timezone: creator.timezone ?? "",
            paymentDetails: creator.paymentDetails ?? "",
            status: creator.status,
            notes: creator.notes ?? "",
          }}
          trigger={
            <Button size="sm" variant="outline">
              <PencilIcon />
              Edit
            </Button>
          }
        />
      </PageHeader>
      <PageBody>
        <section className="rounded-lg border p-5">
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Email" value={creator.email} />
            <Detail label="Phone" value={creator.phone} />
            <Detail label="Contact handle" value={creator.contactHandle} />
            <Detail label="Country" value={creator.country} />
            <Detail
              label="Time zone"
              value={creator.timezone ? timeZoneLabel(creator.timezone) : "Same as campaign"}
            />
            <div className="sm:col-span-2">
              <Detail label="Payment details" value={creator.paymentDetails} />
            </div>
            <div className="sm:col-span-2">
              <Detail label="Notes" value={creator.notes} />
            </div>
          </dl>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-tight">Campaigns</h2>
            {links.campaigns.length ? (
              <ul className="divide-y rounded-lg border">
                {links.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/campaigns/${c.id}?tab=people`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-xs capitalize text-muted-foreground">{c.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Not assigned to a campaign yet.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-tight">Accounts</h2>
            {links.accounts.length ? (
              <ul className="divide-y rounded-lg border">
                {links.accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <PlatformBadge platform={a.platform} showLabel={false} />
                    <a href={a.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      @{a.handle}
                    </a>
                    <span className="text-muted-foreground">{a.campaignName ?? "No campaign"}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {a.followerCount != null ? `${formatCompact(a.followerCount)} followers` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No accounts linked yet.
              </p>
            )}
          </section>
        </div>
      </PageBody>
    </>
  )
}
