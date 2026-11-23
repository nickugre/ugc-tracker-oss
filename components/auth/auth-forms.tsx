"use client"

import Link from "next/link"
import { useActionState, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  adoptLinkSession,
  confirmLink,
  requestPasswordReset,
  setPassword,
  signIn,
  type FormState,
} from "@/lib/auth/actions"

const initial: FormState = {}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, initial)

  return (
    <form action={action} className="flex flex-col gap-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link
              href="/login/reset"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        {state.error ? <FieldError>{state.error}</FieldError> : null}
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial)

  return (
    <form action={action} className="flex flex-col gap-5">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        {state.error ? <FieldError>{state.error}</FieldError> : null}
        {state.message ? <p className="text-sm text-muted-foreground">{state.message}</p> : null}
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  )
}

export function ConfirmLinkForm({ tokenHash, type, next }: { tokenHash: string; type: string; next?: string }) {
  const [state, action, pending] = useActionState(confirmLink, initial)

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? <FieldError>{state.error}</FieldError> : null}
      <Button type="submit" size="lg" disabled={pending} autoFocus>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  )
}

const subscribeToNothing = () => () => {}

function LinkProblem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      <Link href="/login" className="text-sm underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </div>
  )
}

// For links from Supabase's own email templates: Supabase verifies the token itself and appends
// the result to our URL as a fragment, which only the browser can read. Success looks like
// #access_token=…&refresh_token=…, failure like #error_description=….
export function LinkSessionForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(adoptLinkSession, initial)
  const hash = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.hash,
    () => null
  )

  if (hash === null) return <p className="text-sm text-muted-foreground">Checking your link…</p>

  const params = new URLSearchParams(hash.replace(/^#/, ""))
  const accessToken = params.get("access_token")
  const refreshToken = params.get("refresh_token")

  if (params.get("error") || params.get("error_description")) {
    return (
      <LinkProblem title="This link is no longer valid">
        Links work once and expire after 24 hours. Ask for a new one.
      </LinkProblem>
    )
  }
  if (!accessToken || !refreshToken) {
    return (
      <LinkProblem title="This link is not complete">
        Open the link exactly as you received it, or ask for a new one.
      </LinkProblem>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Continue to UGC Tracker</h1>
        <p className="text-sm text-muted-foreground">Continue to choose your password.</p>
      </div>
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="access_token" value={accessToken} />
        <input type="hidden" name="refresh_token" value={refreshToken} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {state.error ? <FieldError>{state.error}</FieldError> : null}
        <Button type="submit" size="lg" disabled={pending} autoFocus>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </form>
    </div>
  )
}

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, initial)

  return (
    <form action={action} className="flex flex-col gap-5">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirm">Repeat password</FieldLabel>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        {state.error ? <FieldError>{state.error}</FieldError> : null}
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  )
}
