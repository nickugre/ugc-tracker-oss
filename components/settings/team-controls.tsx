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
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { createAccessLink, inviteUser, setUserActive } from "@/lib/actions/team"

type SharedLink = { email: string; url: string; reason: "invite" | "access" }

// Shows a one-time link to pass on by hand (chat, SMS) when email is not an option.
function LinkDialog({ link, onClose }: { link: SharedLink | null; onClose: () => void }) {
  return (
    <Dialog open={link !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send this link to {link?.email}</DialogTitle>
          <DialogDescription>
            {link?.reason === "invite"
              ? "The invite email could not be sent, so pass the link on yourself. "
              : null}
            It signs them in and asks for a new password. It works once and expires after 24 hours.
          </DialogDescription>
        </DialogHeader>
        <Input
          readOnly
          value={link?.url ?? ""}
          aria-label="One-time link"
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button
            type="button"
            onClick={async () => {
              if (!link) return
              try {
                await navigator.clipboard.writeText(link.url)
                toast.success("Link copied")
              } catch {
                toast.error("Could not copy. Select the link and copy it by hand.")
              }
            }}
          >
            Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function InviteForm() {
  const [pending, startTransition] = useTransition()
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [link, setLink] = useState<SharedLink | null>(null)

  return (
    <>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          startTransition(async () => {
            const result = await inviteUser({ email, fullName })
            if (!result.ok) {
              toast.error(result.error)
              return
            }
            if (result.data.inviteLink) {
              setLink({ email, url: result.data.inviteLink, reason: "invite" })
            } else {
              toast.success(`Invite sent to ${email}`)
            }
            setEmail("")
            setFullName("")
          })
        }}
      >
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          aria-label="Email"
          className="w-64"
        />
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Name (optional)"
          aria-label="Name"
          className="w-48"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invite"}
        </Button>
      </form>
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </>
  )
}

export function AccessLinkButton({ id, email, disabled }: { id: string; email: string; disabled?: boolean }) {
  const [pending, startTransition] = useTransition()
  const [link, setLink] = useState<SharedLink | null>(null)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createAccessLink({ id })
            if (!result.ok) {
              toast.error(result.error)
              return
            }
            setLink({ email, url: result.data.link, reason: "access" })
          })
        }
      >
        {pending ? "Creating…" : "Sign-in link"}
      </Button>
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </>
  )
}

export function AccessSwitch({ id, active, disabled }: { id: string; active: boolean; disabled?: boolean }) {
  const [pending, startTransition] = useTransition()
  const [checked, setChecked] = useState(active)
  return (
    <Switch
      size="sm"
      checked={checked}
      disabled={disabled || pending}
      aria-label="Has access"
      onCheckedChange={(next) => {
        setChecked(next)
        startTransition(async () => {
          const result = await setUserActive({ id, active: next })
          if (!result.ok) {
            setChecked(!next)
            toast.error(result.error)
          }
        })
      }}
    />
  )
}
