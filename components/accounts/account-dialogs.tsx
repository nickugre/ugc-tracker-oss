"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { SimpleSelect } from "@/components/form/simple-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DeleteButton } from "@/components/form/delete-button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { LIVE_PLATFORMS, PLATFORMS, type Platform } from "@/db/schema/enums"
import { createAccount, deleteAccount, setAccountTracking, updateAccountLinks } from "@/lib/actions/accounts"
import { PLATFORM_LABELS } from "@/lib/format"
import { parseAccountHandle } from "@/lib/validation/account"

type Option = { id: string; name: string }

const PLATFORM_OPTIONS = PLATFORMS.map((p) => ({
  value: p,
  label: LIVE_PLATFORMS.includes(p) ? PLATFORM_LABELS[p] : `${PLATFORM_LABELS[p]} (scraping soon)`,
}))

function LinkFields({
  creators,
  campaigns,
  creatorId,
  campaignId,
  trackFrom,
  onChange,
}: {
  creators: Option[]
  campaigns: Option[]
  creatorId: string | null
  campaignId: string | null
  trackFrom: string | null
  onChange: (patch: { creatorId?: string | null; campaignId?: string | null; trackFrom?: string | null }) => void
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="account-creator">Creator</FieldLabel>
          <SimpleSelect
            id="account-creator"
            value={creatorId}
            onValueChange={(x) => onChange({ creatorId: x })}
            options={creators.map((c) => ({ value: c.id, label: c.name }))}
            noneLabel="No creator"
            placeholder="No creator"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="account-campaign">Campaign</FieldLabel>
          <SimpleSelect
            id="account-campaign"
            value={campaignId}
            onValueChange={(x) => onChange({ campaignId: x })}
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            noneLabel="No campaign"
            placeholder="No campaign"
          />
        </Field>
      </div>
      <Field className="max-w-[220px]">
        <FieldLabel htmlFor="account-track-from">Track videos from</FieldLabel>
        <Input
          id="account-track-from"
          type="date"
          value={trackFrom ?? ""}
          onChange={(e) => onChange({ trackFrom: e.target.value || null })}
        />
        <FieldDescription>Empty = the campaign start date. Older videos are ignored.</FieldDescription>
      </Field>
    </>
  )
}

export function AddAccountDialog({
  creators,
  campaigns,
  trigger,
}: {
  creators: Option[]
  campaigns: Option[]
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [platform, setPlatform] = useState<Platform>("tiktok")
  const [handleOrUrl, setHandleOrUrl] = useState("")
  const [links, setLinks] = useState<{ creatorId: string | null; campaignId: string | null; trackFrom: string | null }>({
    creatorId: null,
    campaignId: null,
    trackFrom: null,
  })
  const [error, setError] = useState<string | null>(null)

  const parsed = handleOrUrl.trim() ? parseAccountHandle(platform, handleOrUrl) : null

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createAccount({ platform, handleOrUrl, ...links, trackingEnabled: true })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success("Account added")
      setError(null)
      setHandleOrUrl("")
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Add account</DialogTitle>
            <DialogDescription>
              A social handle to track. New videos on it are attributed to the linked creator and
              campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <Field>
              <FieldLabel htmlFor="account-platform">Platform</FieldLabel>
              <SimpleSelect
                id="account-platform"
                value={platform}
                onValueChange={(x) => x && setPlatform(x)}
                options={PLATFORM_OPTIONS}
              />
            </Field>
            <Field data-invalid={Boolean(parsed && !parsed.ok)}>
              <FieldLabel htmlFor="account-handle">Handle or profile URL</FieldLabel>
              <Input
                id="account-handle"
                value={handleOrUrl}
                onChange={(e) => setHandleOrUrl(e.target.value)}
                placeholder="@brandname"
                autoFocus
                required
                aria-invalid={Boolean(parsed && !parsed.ok)}
              />
              {parsed?.ok ? <FieldDescription>{parsed.url}</FieldDescription> : null}
              {parsed && !parsed.ok ? <FieldError>{parsed.error}</FieldError> : null}
            </Field>
          </div>
          <LinkFields
            creators={creators}
            campaigns={campaigns}
            {...links}
            onChange={(patch) => setLinks((current) => ({ ...current, ...patch }))}
          />
          {error ? <FieldError>{error}</FieldError> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending || !parsed?.ok}>
              {pending ? "Adding…" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditAccountLinksDialog({
  account,
  creators,
  campaigns,
  trigger,
}: {
  account: {
    id: string
    handle: string
    creatorId: string | null
    campaignId: string | null
    trackFrom: string | null
    postCount: number
  }
  creators: Option[]
  campaigns: Option[]
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [links, setLinks] = useState({
    creatorId: account.creatorId,
    campaignId: account.campaignId,
    trackFrom: account.trackFrom,
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateAccountLinks({ id: account.id, ...links })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Account updated")
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>@{account.handle}</DialogTitle>
            <DialogDescription>
              Videos already tracked keep their creator and campaign. The new link applies to videos
              discovered from now on.
            </DialogDescription>
          </DialogHeader>
          <LinkFields
            creators={creators}
            campaigns={campaigns}
            {...links}
            onChange={(patch) => setLinks((current) => ({ ...current, ...patch }))}
          />
          <DialogFooter className="sm:justify-between">
            <DeleteButton
              label="Delete account…"
              title={`Delete @${account.handle}?`}
              description={
                account.postCount > 0
                  ? `This permanently deletes the account and its ${account.postCount} ${account.postCount === 1 ? "video" : "videos"} with their view history and thumbnails. Videos that are part of a payout can never be deleted. To only stop scraping, turn tracking off instead.`
                  : "This permanently deletes the account. It has no videos."
              }
              confirmText={`@${account.handle}`}
              successMessage={`@${account.handle} deleted`}
              action={(confirm) => deleteAccount({ id: account.id, confirm })}
              onDeleted={() => setOpen(false)}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TrackingSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition()
  const [checked, setChecked] = useState(enabled)

  return (
    <Switch
      size="sm"
      checked={checked}
      disabled={pending}
      aria-label="Tracking"
      onCheckedChange={(next) => {
        setChecked(next)
        startTransition(async () => {
          const result = await setAccountTracking({ id, enabled: next })
          if (!result.ok) {
            setChecked(!next)
            toast.error(result.error)
          }
        })
      }}
    />
  )
}
