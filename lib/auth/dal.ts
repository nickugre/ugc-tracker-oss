import "server-only"

import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { cache } from "react"

import { db } from "@/db"
import { profiles } from "@/db/schema"
import { createClient } from "@/lib/supabase/server"

export type CurrentUser = {
  id: string
  email: string
  fullName: string | null
  role: string
}

// The signed-in team member, or null. A valid Supabase session is not enough: the user must
// also have an active profile row, so deactivating someone locks them out immediately.
// Wrapped in React cache() so a request that calls it many times hits the database once.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return null

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1)
  if (!profile || !profile.isActive) return null

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
  }
})

// Call at the top of every page, Server Action and query that needs a signed-in user.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}
