"use client"

import { XIcon } from "lucide-react"
import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { PlatformBadge } from "@/components/badges"
import { IntegerInput, MoneyInput } from "@/components/form/number-inputs"
import { SimpleSelect } from "@/components/form/simple-select"
import { Button } from "@/components/ui/button"
import { assignCreator, saveCreatorTerms, unassignCreator } from "@/lib/actions/campaigns"
import { formatCents } from "@/lib/money/cents"
import type { CampaignAssignments as Assignments } from "@/lib/queries/campaigns"

type Defaults = {
  baseAmountCents: number
  quotaCount: number | null
  cycleCapCents: number | null
}

function CreatorTermsRow({
  campaignId,
  creator,
  defaults,
}: {
  campaignId: string
  creator: Assignments["creators"][number]
  defaults: Defaults
}) {
  const [pending, startTransition] = useTransition()
  const [base, setBase] = useState(creator.baseAmountCentsOverride)
  const [quota, setQuota] = useState(creator.quotaCountOverride)
  const [cap, setCap] = useState(creator.cycleCapCentsOverride)
  const dirty =
    base !== creator.baseAmountCentsOverride ||
    quota !== creator.quotaCountOverride ||
    cap !== creator.cycleCapCentsOverride

  function save() {
    startTransition(async () => {
      const result = await saveCreatorTerms({
        campaignId,
        creatorId: creator.creatorId,
        baseAmountCentsOverride: base,
        quotaCountOverride: quota,
        cycleCapCentsOverride: cap,
      })
      if (result.ok) toast.success(`Terms saved for ${creator.name}`)
      else toast.error(result.error)
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await unassignCreator({ campaignId, creatorId: creator.creatorId })
      if (result.ok) toast.success(`${creator.name} removed from the campaign`)
      else toast.error(result.error)
    })
  }

  return (
    <div className="grid items-center gap-3 border-b py-3 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_1fr_110px_1fr_auto]">
      <div className="min-w-0">
        <Link href={`/creators/${creator.creatorId}`} className="truncate text-sm font-medium hover:underline">
          {creator.name}
        </Link>
        <p className="text-xs text-muted-foreground">{creator.postCount} posts in this campaign</p>
      </div>
      <MoneyInput
        value={base}
        onChange={setBase}
        placeholder={defaults.baseAmountCents ? formatCents(defaults.baseAmountCents).slice(1) : "0"}
      />
      <IntegerInput
        value={quota}
        onChange={setQuota}
        min={1}
        placeholder={defaults.quotaCount ? String(defaults.quotaCount) : "—"}
      />
      <MoneyInput
        value={cap}
        onChange={setCap}
        placeholder={defaults.cycleCapCents ? formatCents(defaults.cycleCapCents).slice(1) : "No cap"}
      />
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={save}>
          Save
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={pending}
          aria-label={`Remove ${creator.name}`}
          onClick={remove}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  )
}

export function CampaignAssignments({
  campaignId,
  assignments,
  allCreators,
  defaults,
}: {
  campaignId: string
  assignments: Assignments
  allCreators: { id: string; name: string }[]
  defaults: Defaults
}) {
  const [pending, startTransition] = useTransition()
  const [toAdd, setToAdd] = useState<string | null>(null)
  const assigned = new Set(assignments.creators.map((c) => c.creatorId))
  const available = allCreators.filter((c) => !assigned.has(c.id))

  function add() {
    if (!toAdd) return
    startTransition(async () => {
      const result = await assignCreator({ campaignId, creatorId: toAdd })
      if (result.ok) setToAdd(null)
      else toast.error(result.error)
    })
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">Creators</h2>
          <p className="text-sm text-muted-foreground">
            Leave a field empty to use the campaign&apos;s terms. Fill it in when a creator negotiated
            a different deal.
          </p>
        </div>

        {assignments.creators.length ? (
          <div className="rounded-lg border px-4">
            <div className="hidden gap-3 border-b py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,1.4fr)_1fr_110px_1fr_auto]">
              <span>Creator</span>
              <span>Base override</span>
              <span>Quota override</span>
              <span>Bonus cap override</span>
              <span className="w-[92px]" />
            </div>
            {assignments.creators.map((creator) => (
              <CreatorTermsRow
                key={creator.creatorId}
                campaignId={campaignId}
                creator={creator}
                defaults={defaults}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No creators assigned yet.
          </p>
        )}

        <div className="flex max-w-md items-center gap-2">
          <SimpleSelect
            value={toAdd}
            onValueChange={setToAdd}
            options={available.map((c) => ({ value: c.id, label: c.name }))}
            placeholder={available.length ? "Add a creator…" : "All creators are assigned"}
            disabled={!available.length}
            className="flex-1"
          />
          <Button variant="outline" onClick={add} disabled={!toAdd || pending}>
            Assign
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">Accounts</h2>
          <p className="text-sm text-muted-foreground">
            Social handles whose new videos are attributed to this campaign. Link them on the{" "}
            <Link href="/accounts" className="text-foreground underline underline-offset-4">
              Accounts
            </Link>{" "}
            page.
          </p>
        </div>
        {assignments.accounts.length ? (
          <ul className="divide-y rounded-lg border">
            {assignments.accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <PlatformBadge platform={account.platform} showLabel={false} />
                <span className="font-medium">@{account.handle}</span>
                <span className="text-muted-foreground">{account.creatorName ?? "No creator"}</span>
                {account.trackingEnabled ? null : (
                  <span className="ml-auto text-xs text-muted-foreground">Tracking off</span>
                )}
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
  )
}
