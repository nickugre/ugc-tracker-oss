import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

// Append-only record of every money-relevant action (a database trigger blocks UPDATE/DELETE).
// actorId null means the system (scheduled jobs).
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_log_created_idx").on(t.createdAt),
  ]
).enableRLS()
