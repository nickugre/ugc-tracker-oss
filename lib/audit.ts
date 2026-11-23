import "server-only"

import type { Db, Tx } from "@/db"
import { auditLog } from "@/db/schema"

export type AuditActor = { id: string; email: string } | null

export type AuditEntry = {
  // null = the system (scheduled jobs).
  actor: AuditActor
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  reason?: string | null
}

// Writes one audit row. Pass the transaction handle so the record commits or rolls back
// together with the change it describes.
export async function audit(executor: Db | Tx, entry: AuditEntry | AuditEntry[]) {
  const entries = Array.isArray(entry) ? entry : [entry]
  if (entries.length === 0) return
  await executor.insert(auditLog).values(
    entries.map((e) => ({
      actorId: e.actor?.id ?? null,
      actorEmail: e.actor?.email ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason ?? null,
    }))
  )
}
