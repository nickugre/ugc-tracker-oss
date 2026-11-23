// Creates (or re-activates) a team member who can sign in. The app is invite-only, so this is
// how the very first user gets in; after that, invite people from Settings → Team.
//
//   pnpm user:create you@example.com 'a-strong-password' "Your Name"

import { createClient } from "@supabase/supabase-js"

import { db } from "../db"
import { profiles } from "../db/schema"

async function main() {
  const [email, password, ...nameParts] = process.argv.slice(2)
  const fullName = nameParts.join(" ").trim() || null

  if (!email || !password) {
    console.error('Usage: pnpm user:create <email> <password> ["Full Name"]')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error("The password must be at least 8 characters.")
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.local).")
    process.exit(1)
  }

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let userId: string
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) {
    // Already registered: find the user and reset the password instead.
    const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existing = list.data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (!existing) throw created.error
    const updated = await supabase.auth.admin.updateUserById(existing.id, { password })
    if (updated.error) throw updated.error
    userId = existing.id
    console.log(`Updated the password for existing user ${email}.`)
  } else {
    userId = created.data.user.id
    console.log(`Created user ${email}.`)
  }

  await db
    .insert(profiles)
    .values({ id: userId, email, fullName, role: "admin", isActive: true })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { email, isActive: true, ...(fullName ? { fullName } : {}) },
    })

  console.log("Profile is active. You can sign in now.")
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
