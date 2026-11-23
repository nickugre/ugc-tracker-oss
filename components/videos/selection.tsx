"use client"

import { ChevronDownIcon, XIcon } from "lucide-react"
import { createContext, useContext, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { ReasonDialog } from "@/components/form/reason-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  bulkAssignCampaign,
  bulkAssignCreator,
  bulkLockAtCurrentViews,
  bulkMarkPaid,
  bulkSetExcluded,
} from "@/lib/actions/posts"
import type { ActionResult } from "@/lib/actions/safe-action"

type Selection = {
  selected: Set<string>
  toggle: (id: string, on: boolean) => void
  setMany: (ids: string[], on: boolean) => void
  clear: () => void
}

const SelectionContext = createContext<Selection | null>(null)

export function useSelection() {
  const context = useContext(SelectionContext)
  if (!context) throw new Error("Selection components must be inside <SelectionProvider>")
  return context
}

// The table itself is server-rendered; only the checkboxes and the bulk bar are client code.
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const value = useMemo<Selection>(
    () => ({
      selected,
      toggle: (id, on) =>
        setSelected((current) => {
          const next = new Set(current)
          if (on) next.add(id)
          else next.delete(id)
          return next
        }),
      setMany: (ids, on) =>
        setSelected((current) => {
          const next = new Set(current)
          ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
          return next
        }),
      clear: () => setSelected(new Set()),
    }),
    [selected]
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection()
  return (
    <Checkbox
      checked={selected.has(id)}
      onCheckedChange={(on) => toggle(id, Boolean(on))}
      aria-label={`Select ${label}`}
    />
  )
}

export function HeaderCheckbox({ ids }: { ids: string[] }) {
  const { selected, setMany } = useSelection()
  const count = ids.filter((id) => selected.has(id)).length
  return (
    <Checkbox
      checked={count > 0 && count === ids.length}
      indeterminate={count > 0 && count < ids.length}
      onCheckedChange={(on) => setMany(ids, Boolean(on))}
      aria-label="Select all videos on this page"
    />
  )
}

type Option = { id: string; name: string }
type BulkResult = ActionResult<{ updated: number; skipped: number }>

export function BulkBar({ campaigns, creators }: { campaigns: Option[]; creators: Option[] }) {
  const { selected, clear } = useSelection()
  const [pending, startTransition] = useTransition()
  const [dialog, setDialog] = useState<"exclude" | "paid" | "lock" | null>(null)
  const ids = [...selected]

  if (ids.length === 0) return null

  function run(action: () => Promise<BulkResult>, verb: string) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const { updated, skipped } = result.data
      toast.success(
        `${updated} ${updated === 1 ? "video" : "videos"} ${verb}` +
          (skipped ? ` · ${skipped} skipped (already paid or not eligible)` : "")
      )
      setDialog(null)
      clear()
    })
  }

  return (
    <>
      <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border bg-background px-2 py-1.5 shadow-lg">
        <span className="px-2 text-sm font-medium tabular-nums">{ids.length} selected</span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
            Assign campaign
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 min-w-52">
            {campaigns.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => run(() => bulkAssignCampaign({ ids, campaignId: c.id }), `moved to ${c.name}`)}
              >
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
            Assign creator
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 min-w-52">
            {creators.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => run(() => bulkAssignCreator({ ids, creatorId: c.id }), `assigned to ${c.name}`)}
              >
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("exclude")}>
          Exclude
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => bulkSetExcluded({ ids, excluded: false }), "included again")}
        >
          Include
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("lock")}>
          Lock at current views
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("paid")}>
          Mark paid
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={clear}>
          <XIcon />
        </Button>
      </div>

      <ReasonDialog
        open={dialog === "exclude"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Exclude ${ids.length} ${ids.length === 1 ? "video" : "videos"} from payout`}
        description="Excluded videos count toward neither the base quota nor bonuses. You can include them again later."
        confirmLabel="Exclude"
        destructive
        pending={pending}
        onConfirm={(reason) => run(() => bulkSetExcluded({ ids, excluded: true, reason }), "excluded")}
      />
      <ReasonDialog
        open={dialog === "lock"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Lock ${ids.length} ${ids.length === 1 ? "video" : "videos"} at current views`}
        description="For videos found after their window had closed (Needs review: late discovery). Today's view count becomes the locked count, which can only be higher than the real count at window close. Every other video in the selection is left alone."
        confirmLabel="Lock at current views"
        pending={pending}
        onConfirm={(reason) => run(() => bulkLockAtCurrentViews({ ids, reason }), "locked at current views")}
      />
      <ReasonDialog
        open={dialog === "paid"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Mark ${ids.length} ${ids.length === 1 ? "video" : "videos"} as paid`}
        description="Use this only for videos settled outside a payout cycle. Only locked videos without open issues are changed; normal payouts mark their videos paid automatically."
        confirmLabel="Mark paid"
        pending={pending}
        onConfirm={(reason) => run(() => bulkMarkPaid({ ids, reason }), "marked paid")}
      />
    </>
  )
}
