"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { profiles } from "@/db/schema"
import { ActionError, authedAction } from "@/lib/actions/safe-action"
import { audit } from "@/lib/audit"
import { env } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

// Where invite and reset links land; the page redeems the one-time token and moves on to `next`.
function confirmUrl(tokenHash: string, type: "invite" | "recovery") {
  const params = new URLSearchParams({ token_hash: tokenHash, type, next: "/set-password" })
  return `${env().APP_URL}/auth/confirm?${params}`
}

// The app is invite-only: this is the only way (besides scripts/create-admin.ts) to get access.
// Supabase emails a link that lands on /auth/confirm, where the person sets a password. When the
// email cannot be sent, the same link is handed to the inviter to pass on: Supabase's built-in
// mailer only delivers to members of the Supabase organization and allows a few emails an hour.
export async function inviteUser(payload: unknown) {
  const schema = z.object({
    email: z.email("Enter a valid email address").transform((v) => v.toLowerCase()),
    fullName: z.string().trim().max(120).optional(),
  })
  return authedAction(schema, payload, async ({ email, fullName }, user) => {
    const [existing] = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1)
    if (existing?.isActive) throw new ActionError(`${email} already has access.`)

    const supabase = createAdminClient()
    let userId = existing?.id
    let inviteLink: string | null = null
    if (!userId) {
      const options = {
        redirectTo: `${env().APP_URL}/auth/confirm?next=/set-password`,
        data: fullName ? { full_name: fullName } : undefined,
      }
      const invited = await supabase.auth.admin.inviteUserByEmail(email, options)
      if (invited.data.user) {
        userId = invited.data.user.id
      } else {
        const generated = await supabase.auth.admin.generateLink({ type: "invite", email, options })
        if (generated.error || !generated.data.user) {
          throw new ActionError(invited.error?.message ?? "The invite could not be created.")
        }
        userId = generated.data.user.id
        inviteLink = confirmUrl(generated.data.properties.hashed_token, "invite")
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(profiles)
        .values({ id: userId, email, fullName: fullName || null, invitedBy: user.id })
        .onConflictDoUpdate({ target: profiles.id, set: { isActive: true } })
      await audit(tx, {
        actor: user,
        action: "team.invite",
        entityType: "profile",
        entityId: userId,
        after: { email, delivery: inviteLink ? "link" : "email" },
      })
    })
    revalidatePath("/settings")
    return { inviteLink }
  })
}

// A one-time link that signs a teammate in and lets them choose a password: for an invite that
// expired or a forgotten password when email does not reach them. It gives access to that
// person's account, so every link is recorded in the audit log with who created it.
export async function createAccessLink(payload: unknown) {
  const schema = z.object({ id: z.uuid() })
  return authedAction(schema, payload, async ({ id }, user) => {
    const [member] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    if (!member) throw new ActionError("This person no longer exists.")
    if (!member.isActive) throw new ActionError("Turn this person's access on first.")

    const supabase = createAdminClient()
    const generated = await supabase.auth.admin.generateLink({ type: "recovery", email: member.email })
    if (generated.error) throw new ActionError(generated.error.message)

    await audit(db, {
      actor: user,
      action: "team.access_link",
      entityType: "profile",
      entityId: id,
      after: { email: member.email },
    })
    return { link: confirmUrl(generated.data.properties.hashed_token, "recovery") }
  })
}

// Deactivating takes effect on the person's next request: every page and action checks the
// profile, not just the session.
export async function setUserActive(payload: unknown) {
  const schema = z.object({ id: z.uuid(), active: z.boolean() })
  return authedAction(schema, payload, async ({ id, active }, user) => {
    if (id === user.id && !active) throw new ActionError("You cannot remove your own access.")
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(profiles)
        .set({ isActive: active })
        .where(eq(profiles.id, id))
        .returning({ email: profiles.email })
      if (!row) throw new ActionError("This person no longer exists.")
      await audit(tx, {
        actor: user,
        action: active ? "team.reactivate" : "team.deactivate",
        entityType: "profile",
        entityId: id,
        after: { email: row.email },
      })
    })
    revalidatePath("/settings")
  })
}
