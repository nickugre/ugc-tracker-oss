"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { ActionResult } from "@/lib/actions/safe-action"

const normalize = (value: string) => value.trim().replace(/^@/, "").toLowerCase()

// Permanent deletion, confirmed by typing the thing's name. The server action repeats every
// check (and refuses anything that is part of a payout); this dialog only prevents accidents.
export function DeleteButton<T>({
  label,
  title,
  description,
  confirmText,
  successMessage,
  action,
  onDeleted,
}: {
  label: string
  title: string
  description: React.ReactNode
  // What the person has to type, e.g. "@handle" or the campaign name.
  confirmText: string
  successMessage: string
  action: (confirm: string) => Promise<ActionResult<T>>
  onDeleted?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [pending, startTransition] = useTransition()
  const matches = normalize(typed) === normalize(confirmText)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setTyped("")
          setOpen(true)
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!matches) return
              startTransition(async () => {
                const result = await action(typed)
                if (!result.ok) {
                  toast.error(result.error)
                  return
                }
                toast.success(successMessage)
                setOpen(false)
                onDeleted?.()
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="confirm-delete">
                Type <span className="font-mono">{confirmText}</span> to confirm
              </FieldLabel>
              <Input
                id="confirm-delete"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches || pending}>
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
