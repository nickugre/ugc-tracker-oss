import "server-only"

import { timingSafeEqual } from "node:crypto"

import { env } from "@/lib/env"

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// Scheduled jobs are called by Supabase Cron (pg_net, POST) or Vercel Cron (GET) with
// `Authorization: Bearer <CRON_SECRET>`. The proxy does not cover /api/cron, so this check is
// the only gate.
export function isAuthorizedCron(request: Request) {
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : ""
  return token.length > 0 && safeEqual(token, env().CRON_SECRET)
}
