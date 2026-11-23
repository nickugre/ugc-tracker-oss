"use server"

import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { z } from "zod"

import { db } from "@/db"
import { profiles } from "@/db/schema"
import { env } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export type FormState = { error?: string; message?: string }

// Only allow same-site relative redirects after login.
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : ""
  return value.startsWith("/") && !value.startsWith("//") ? value : "/"
}

const credentials = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
})

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error || !data.user) return { error: "Wrong email or password." }

  const [profile] = await db
    .select({ isActive: profiles.isActive })
    .from(profiles)
    .where(eq(profiles.id, data.user.id))
    .limit(1)
  if (!profile?.isActive) {
    await supabase.auth.signOut()
    return { error: "This account does not have access. Ask an admin to invite you." }
  }

  redirect(safeNext(formData.get("next")))
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = z.email("Enter a valid email address").safeParse(formData.get("email"))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${env().APP_URL}/auth/confirm?next=/set-password`,
  })
  // Same answer whether or not the address exists, so the form cannot be used to probe accounts.
  return {
    message:
      "If that address has an account, a reset link is on its way. No email after a few minutes? Ask a teammate for a sign-in link (Settings → Team).",
  }
}

const LINK_EXPIRED = "This link is no longer valid. Links work once and expire after 24 hours. Ask for a new one."

const confirmInput = z.object({
  tokenHash: z.string().min(1),
  type: z.enum(["invite", "recovery", "signup", "magiclink", "email", "email_change"]),
})

// Redeems the one-time token of an invite or reset link (see app/(auth)/auth/confirm).
export async function confirmLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = confirmInput.safeParse({
    tokenHash: formData.get("token_hash"),
    type: formData.get("type"),
  })
  if (!parsed.success) return { error: LINK_EXPIRED }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    type: parsed.data.type,
    token_hash: parsed.data.tokenHash,
  })
  if (error) return { error: LINK_EXPIRED }

  redirect(safeNext(formData.get("next")))
}

// Supabase's own email templates (the only ones allowed on the Free plan without custom SMTP)
// verify the token on Supabase's side and hand the session over in the URL fragment. The confirm
// page reads the fragment in the browser and posts the tokens here to turn them into cookies.
export async function adoptLinkSession(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ accessToken: z.string().min(20), refreshToken: z.string().min(6) })
    .safeParse({
      accessToken: formData.get("access_token"),
      refreshToken: formData.get("refresh_token"),
    })
  if (!parsed.success) return { error: LINK_EXPIRED }

  const supabase = await createClient()
  const { error } = await supabase.auth.setSession({
    access_token: parsed.data.accessToken,
    refresh_token: parsed.data.refreshToken,
  })
  if (error) return { error: LINK_EXPIRED }

  redirect(safeNext(formData.get("next")))
}

const newPassword = z
  .object({
    password: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords do not match" })

// Reached from an invite or reset link, after confirmLink has established the session.
export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPassword.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return { error: "This link has expired. Ask for a new one." }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  redirect("/")
}
