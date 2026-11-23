import "server-only"

import { createClient } from "@supabase/supabase-js"

import { env } from "@/lib/env"

// Secret-key client for server-side admin work only: inviting users and uploading thumbnails
// to Storage. Never import this from a Client Component.
export function createAdminClient() {
  const e = env()
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
