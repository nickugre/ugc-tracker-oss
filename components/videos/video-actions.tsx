"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { IntegerInput } from "@/components/form/number-inputs"
import { ReasonDialog } from "@/components/form/reason-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { DisplayStatus } from "@/db/schema/enums"
import {
  bulkSetExcluded,
  lockPost,
  resolveReview,
  savePostNotes,
  saveSpark,
  setManualLock,
  setWindowDays,
  unlockPost,
} from "@/lib/actions/posts"
import type { ActionResult } from "@/lib/actions/safe-action"

export type VideoActionsPost = {
  id: string
  displayStatus: DisplayStatus
  status: "open" | "locked" | "paid"
  isExcluded: boolean
  isSettled: boolean
  windowClosed: boolean
  windowDays: number
  windowOverridden: boolean
  campaignWindowDays: number | null
  needsReview: boolean
  lockedViews: number | null
  currentViews: number
  isSpark: boolean
  sparkHint: boolean
  sparkSource: "manual" | "ads_api" | null
  // Local datetime string (YYYY-MM-DDTHH:mm) in the browser's zone is built on the client.
  sparkStartedAtIso: string | null
  paidViewsManual: number | null
  paidViewsSynced: number | null
  notes: string
}

function toLocalInput(iso: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

export function VideoActions({ post }: { post: VideoActionsPost }) {
  const [pending, startTransition] = useTransition()
  const [dialog, setDialog] = useState<"unlock" | "manual" | "exclude" | "review" | null>(null)
  const [manualViews, setManualViews] = useState<number | null>(post.lockedViews ?? post.currentViews)
  const [days, setDays] = useState<number | null>(post.windowDays)
  const [isSpark, setIsSpark] = useState(post.isSpark)
  const [sparkStart, setSparkStart] = useState(() => toLocalInput(post.sparkStartedAtIso))
  const [paidViews, setPaidViews] = useState<number | null>(post.paidViewsManual)
  const [notes, setNotes] = useState(post.notes)
  const frozen = post.isSettled

  function run(action: () => Promise<ActionResult<unknown>>, message: string) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(message)
      setDialog(null)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {frozen ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          This video is part of a payout, so its numbers can no longer be changed.
        </p>
      ) : null}

      <Panel title="Lock">
        <div className="flex flex-wrap gap-2">
          {post.status === "open" ? (
            <Button
              size="sm"
              disabled={pending || frozen || !post.windowClosed}
              onClick={() => run(() => lockPost({ id: post.id }), "Views locked")}
            >
              Lock now
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={pending || frozen} onClick={() => setDialog("unlock")}>
              Unlock
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={pending || frozen} onClick={() => setDialog("manual")}>
            Set locked views manually
          </Button>
          {post.needsReview ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setDialog("review")}>
              Mark reviewed
            </Button>
          ) : null}
        </div>
        {post.status === "open" && !post.windowClosed ? (
          <p className="text-xs text-muted-foreground">
            The window is still open. It locks automatically after the first daily sync once it has closed (within a day).
          </p>
        ) : null}
      </Panel>

      <Panel title="View window">
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-28">
            <FieldLabel htmlFor="window-days">Days</FieldLabel>
            <IntegerInput id="window-days" min={1} value={days} onChange={setDays} disabled={frozen || post.status !== "open"} />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || frozen || post.status !== "open" || !days || days === post.windowDays}
            onClick={() => run(() => setWindowDays({ id: post.id, days }), "Window updated")}
          >
            Apply
          </Button>
          {post.windowOverridden ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || frozen || post.status !== "open"}
              onClick={() => {
                setDays(post.campaignWindowDays ?? 14)
                run(() => setWindowDays({ id: post.id, days: null }), "Back to the campaign default")
              }}
            >
              Use campaign default ({post.campaignWindowDays ?? 14}d)
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {post.status === "open"
            ? post.windowOverridden
              ? "This video has its own window."
              : "Using the campaign default. Set e.g. 30 to count views for longer."
            : "Unlock the video to change its window."}
        </p>
      </Panel>

      <Panel title="Spark and paid views">
        <Field orientation="horizontal">
          <Switch id="is-spark" checked={isSpark} onCheckedChange={setIsSpark} disabled={frozen} />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="is-spark">Boosted with Spark, Promote or another paid push</FieldLabel>
            {post.sparkHint && !post.isSpark ? (
              <FieldDescription>The scraper saw an ad marker on this video.</FieldDescription>
            ) : null}
          </div>
        </Field>
        {isSpark ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="spark-start">Boost started</FieldLabel>
              <Input id="spark-start" type="datetime-local" value={sparkStart} onChange={(e) => setSparkStart(e.target.value)} disabled={frozen} />
            </Field>
            <Field>
              <FieldLabel htmlFor="paid-views">Paid views inside the window</FieldLabel>
              <IntegerInput
                id="paid-views"
                value={paidViews}
                onChange={setPaidViews}
                disabled={frozen}
                placeholder={post.paidViewsSynced != null ? `${post.paidViewsSynced.toLocaleString("en-US")} from TikTok Ads` : "0"}
              />
              <FieldDescription>
                {post.paidViewsSynced != null
                  ? "Leave empty to use the number synced from TikTok Ads. A value typed here wins."
                  : "Subtracted from the locked views to get payable views."}
              </FieldDescription>
            </Field>
          </div>
        ) : null}
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || frozen}
            onClick={() =>
              run(
                () =>
                  saveSpark({
                    id: post.id,
                    isSpark,
                    sparkStartedAt: isSpark && sparkStart ? new Date(sparkStart).toISOString() : null,
                    paidViewsManual: isSpark ? paidViews : null,
                  }),
                "Paid views saved"
              )
            }
          >
            Save
          </Button>
        </div>
      </Panel>

      <Panel title="Payout">
        <div className="flex flex-wrap items-center gap-2">
          {post.isExcluded ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || frozen}
              onClick={() => run(() => bulkSetExcluded({ ids: [post.id], excluded: false }), "Included again")}
            >
              Include in payout again
            </Button>
          ) : (
            <Button size="sm" variant="destructive" disabled={pending || frozen} onClick={() => setDialog("exclude")}>
              Exclude from payout
            </Button>
          )}
        </div>
      </Panel>

      <Panel title="Notes">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the next person should know" />
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || notes === post.notes}
            onClick={() => run(() => savePostNotes({ id: post.id, notes }), "Notes saved")}
          >
            Save notes
          </Button>
        </div>
      </Panel>

      <ReasonDialog
        open={dialog === "unlock"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Unlock this video"
        description="The locked view count is cleared and the video goes back to Open. It stays unlocked until someone locks it again."
        confirmLabel="Unlock"
        pending={pending}
        onConfirm={(reason) => run(() => unlockPost({ id: post.id, reason }), "Video unlocked")}
      />
      <ReasonDialog
        open={dialog === "manual"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Set locked views manually"
        description="Use this when the automatic lock is not possible or not right, for example a video discovered after its window ended."
        confirmLabel="Lock with this number"
        pending={pending}
        onConfirm={(reason) =>
          manualViews != null && run(() => setManualLock({ id: post.id, views: manualViews, reason }), "Views locked manually")
        }
      >
        <Field>
          <FieldLabel htmlFor="manual-views">Views at window close</FieldLabel>
          <IntegerInput id="manual-views" value={manualViews} onChange={setManualViews} />
        </Field>
      </ReasonDialog>
      <ReasonDialog
        open={dialog === "exclude"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Exclude from payout"
        description="The video counts toward neither the base quota nor bonuses. You can include it again later."
        confirmLabel="Exclude"
        destructive
        pending={pending}
        onConfirm={(reason) => run(() => bulkSetExcluded({ ids: [post.id], excluded: true, reason }), "Video excluded")}
      />
      <ReasonDialog
        open={dialog === "review"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Mark as reviewed"
        description="Clears the needs-review flag so the video can be paid. Say what you checked."
        confirmLabel="Mark reviewed"
        pending={pending}
        onConfirm={(reason) => run(() => resolveReview({ id: post.id, reason }), "Marked as reviewed")}
      />
    </div>
  )
}
