"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { MoneyInput } from "@/components/form/number-inputs"
import { ReasonDialog } from "@/components/form/reason-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SimpleSelect } from "@/components/form/simple-select"
import {
  addAdjustment,
  deleteAdjustment,
  finalizeCycleAction,
  markPaidAction,
  reopenCycleAction,
} from "@/lib/actions/payouts"
import type { ActionResult } from "@/lib/actions/safe-action"
import { formatCents } from "@/lib/money/cents"

function useRun() {
  const [pending, startTransition] = useTransition()
  const run = (action: () => Promise<ActionResult<unknown>>, message: string, after?: () => void) =>
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(message)
      after?.()
    })
  return { pending, run }
}

export function FinalizeButton({
  campaignId,
  periodStart,
  totalCents,
  lineCount,
  blockedCount,
  canFinalize,
  finalizeFromLabel,
}: {
  campaignId: string
  periodStart: string
  totalCents: number
  lineCount: number
  blockedCount: number
  canFinalize: boolean
  finalizeFromLabel: string
}) {
  const { pending, run } = useRun()
  const [open, setOpen] = useState(false)
  const [roll, setRoll] = useState(false)

  if (!canFinalize) {
    return (
      <Button size="sm" disabled title={`Can be finalized from ${finalizeFromLabel}`}>
        Finalize from {finalizeFromLabel}
      </Button>
    )
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Finalize cycle
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finalize {formatCents(totalCents)} for {lineCount} creators</DialogTitle>
            <DialogDescription>
              The amounts are frozen exactly as shown and every video in this cycle is settled, so it
              cannot be paid twice. You can reopen the cycle until the first creator is marked paid.
            </DialogDescription>
          </DialogHeader>
          {blockedCount ? (
            <label className="flex items-start gap-2.5 rounded-lg bg-orange-50 p-3 text-sm text-orange-900 ring-1 ring-orange-600/15 ring-inset">
              <Checkbox checked={roll} onCheckedChange={(next) => setRoll(Boolean(next))} className="mt-0.5" />
              <span>
                {blockedCount} {blockedCount === 1 ? "video has" : "videos have"} a closed window but no
                usable lock. Finalize anyway and roll {blockedCount === 1 ? "it" : "them"} into the next
                cycle.
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || (blockedCount > 0 && !roll)}
              onClick={() =>
                run(
                  () => finalizeCycleAction({ campaignId, periodStart, rollUnresolved: roll }),
                  "Cycle finalized",
                  () => setOpen(false)
                )
              }
            >
              {pending ? "Finalizing…" : "Finalize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function MarkPaidButton({
  cycleId,
  lineId = null,
  label,
  amountCents,
  who,
  variant = "default",
}: {
  cycleId: string
  lineId?: string | null
  label: string
  amountCents: number
  who: string
  variant?: "default" | "outline"
}) {
  const { pending, run } = useRun()
  const [open, setOpen] = useState(false)
  const [ref, setRef] = useState("")

  return (
    <>
      <Button
        size="sm"
        variant={variant}
        onClick={(event) => {
          // The button can sit inside a <summary>; do not toggle the row when it is clicked.
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark {formatCents(amountCents)} as paid</DialogTitle>
            <DialogDescription>
              {who}. The settled videos switch to Paid and can no longer be changed.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="payment-ref">Payment reference</FieldLabel>
            <Input id="payment-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Wise transfer ID, PayPal batch…" />
            <FieldDescription>Optional, but it makes disputes easy to settle later.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => markPaidAction({ cycleId, lineId, paymentRef: ref.trim() || null }),
                  "Marked as paid",
                  () => setOpen(false)
                )
              }
            >
              {pending ? "Saving…" : "Mark paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ReopenButton({ cycleId }: { cycleId: string }) {
  const { pending, run } = useRun()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Reopen
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Reopen this cycle"
        description="The frozen amounts are discarded and the cycle goes back to a live preview. Nothing has been paid yet, so no money is affected."
        confirmLabel="Reopen"
        destructive
        pending={pending}
        onConfirm={(reason) => run(() => reopenCycleAction({ cycleId, reason }), "Cycle reopened", () => setOpen(false))}
      />
    </>
  )
}

export function AdjustmentButton({
  campaignId,
  cycleType,
  periodStart,
  creators,
}: {
  campaignId: string
  cycleType: "weekly" | "monthly"
  periodStart: string
  creators: { id: string; name: string }[]
}) {
  const { pending, run } = useRun()
  const [open, setOpen] = useState(false)
  const [creatorId, setCreatorId] = useState<string | null>(null)
  const [sign, setSign] = useState<"add" | "subtract">("add")
  const [cents, setCents] = useState<number | null>(null)

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add adjustment
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Add a manual adjustment"
        description="A one-off correction for this cycle, added after all caps. Use it for things the rules do not cover."
        confirmLabel="Add adjustment"
        pending={pending}
        onConfirm={(reason) => {
          if (!creatorId || !cents) {
            toast.error("Pick a creator and enter an amount")
            return
          }
          run(
            () =>
              addAdjustment({
                campaignId,
                creatorId,
                cycleType,
                periodStart,
                amountCents: sign === "add" ? cents : -cents,
                reason,
              }),
            "Adjustment added",
            () => {
              setOpen(false)
              setCents(null)
            }
          )
        }}
      >
        <Field>
          <FieldLabel htmlFor="adjust-creator">Creator</FieldLabel>
          <SimpleSelect
            id="adjust-creator"
            value={creatorId}
            onValueChange={setCreatorId}
            options={creators.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Choose a creator"
          />
        </Field>
        <div className="grid grid-cols-[130px_1fr] gap-3">
          <Field>
            <FieldLabel htmlFor="adjust-sign">Type</FieldLabel>
            <SimpleSelect
              id="adjust-sign"
              value={sign}
              onValueChange={(x) => x && setSign(x)}
              options={[
                { value: "add", label: "Add" },
                { value: "subtract", label: "Subtract" },
              ]}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="adjust-amount">Amount</FieldLabel>
            <MoneyInput id="adjust-amount" value={cents} onChange={setCents} />
          </Field>
        </div>
      </ReasonDialog>
    </>
  )
}

export function RemoveAdjustmentButton({ id }: { id: string }) {
  const { pending, run } = useRun()
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
      onClick={() => run(() => deleteAdjustment({ id }), "Adjustment removed")}
    >
      Remove
    </button>
  )
}
