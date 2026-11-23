import { getTableName, sql, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"

// A column of the outer query, for use inside a hand-written subquery. Drizzle leaves the table
// name off columns when the query has no joins, and a bare "id" inside `(select … from accounts a
// where a.creator_id = "id")` then means accounts.id: the subquery silently matches nothing.
export function outerRef(column: PgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`
}
