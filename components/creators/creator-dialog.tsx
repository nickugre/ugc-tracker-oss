"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { DeleteButton } from "@/components/form/delete-button"
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { deleteCreator, saveCreator } from "@/lib/actions/creators"
import { TIME_ZONES, timeZoneLabel } from "@/lib/time-zones"

export type CreatorFormValues = {
  name: string
  email: string
  phone: string
  contactHandle: string
  country: string
  // "" = the campaign's time zone.
  timezone: string
  paymentDetails: string
  status: "active" | "paused" | "ended"
  notes: string
}

const EMPTY: CreatorFormValues = {
  name: "",
  email: "",
  phone: "",
  contactHandle: "",
  country: "",
  timezone: "",
  paymentDetails: "",
  status: "active",
  notes: "",
}

export function CreatorDialog({
  creatorId = null,
  initial,
  trigger,
}: {
  creatorId?: string | null
  initial?: CreatorFormValues
  trigger: React.ReactElement
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [values, setValues] = useState<CreatorFormValues>(initial ?? EMPTY)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const set = <K extends keyof CreatorFormValues>(key: K, value: CreatorFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveCreator({ id: creatorId, input: values })
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        toast.error(result.error)
        return
      }
      toast.success(creatorId ? "Creator saved" : "Creator added")
      setFieldErrors({})
      setOpen(false)
      if (!creatorId) setValues(EMPTY)
    })
  }

  const timeZones =
    values.timezone && !TIME_ZONES.includes(values.timezone) ? [values.timezone, ...TIME_ZONES] : TIME_ZONES

  const text = (key: keyof CreatorFormValues, label: string, props?: React.ComponentProps<"input">) => (
    <Field data-invalid={Boolean(fieldErrors[`input.${key}`])}>
      <FieldLabel htmlFor={`creator-${key}`}>{label}</FieldLabel>
      <Input
        id={`creator-${key}`}
        value={values[key]}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={Boolean(fieldErrors[`input.${key}`])}
        {...props}
      />
      {fieldErrors[`input.${key}`] ? <FieldError>{fieldErrors[`input.${key}`]}</FieldError> : null}
    </Field>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{creatorId ? "Edit creator" : "Add creator"}</DialogTitle>
            <DialogDescription>
              The person you hire. Link their social accounts on the Accounts page.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{text("name", "Name", { required: true, autoFocus: true })}</div>
            {text("email", "Email", { type: "email" })}
            {text("phone", "Phone")}
            {text("contactHandle", "Contact handle", { placeholder: "WhatsApp, Telegram, Discord…" })}
            {text("country", "Country")}
            <div className="sm:col-span-2">
              {text("paymentDetails", "Payment details", { placeholder: "PayPal email, Wise, bank…" })}
            </div>
            <Field>
              <FieldLabel htmlFor="creator-status">Status</FieldLabel>
              <SimpleSelect
                id="creator-status"
                value={values.status}
                onValueChange={(x) => x && set("status", x)}
                options={[
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "ended", label: "Ended" },
                ]}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="creator-timezone">Time zone</FieldLabel>
              <SimpleSelect
                id="creator-timezone"
                value={values.timezone || null}
                onValueChange={(x) => set("timezone", x ?? "")}
                options={timeZones.map((tz) => ({ value: tz, label: timeZoneLabel(tz) }))}
                noneLabel="Same as campaign"
              />
              <FieldDescription>Where their day starts and ends on the Calendar.</FieldDescription>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="creator-notes">Notes</FieldLabel>
              <Textarea
                id="creator-notes"
                rows={3}
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter className={creatorId ? "sm:justify-between" : undefined}>
            {creatorId ? (
              <DeleteButton
                label="Delete creator…"
                title={`Delete ${values.name}?`}
                description="This permanently deletes the creator. It only works while they have no videos and no payouts; otherwise set their status to Ended."
                confirmText={initial?.name ?? values.name}
                successMessage="Creator deleted"
                action={(confirm) => deleteCreator({ id: creatorId, confirm })}
                onDeleted={() => {
                  setOpen(false)
                  router.push("/creators")
                }}
              />
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : creatorId ? "Save changes" : "Add creator"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
