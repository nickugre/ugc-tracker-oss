import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { describe, expect, it } from "vitest"

import { outerRef } from "../outer-ref"
import { accounts, campaigns, creators } from "../schema"

const db = drizzle.mock()

describe("outerRef", () => {
  it("documents the trap: a plain column loses its table name in a query without joins", () => {
    const query = db
      .select({ n: sql`(select count(*) from ${accounts} a where a.creator_id = ${creators.id})` })
      .from(creators)
      .toSQL()
    // Inside the subquery this bare "id" is accounts.id, so the count is always 0.
    expect(query.sql).toContain('a.creator_id = "id"')
  })

  it("names the outer table in a query without joins", () => {
    const query = db
      .select({ n: sql`(select count(*) from ${accounts} a where a.creator_id = ${outerRef(creators.id)})` })
      .from(creators)
      .toSQL()
    expect(query.sql).toContain('a.creator_id = "creators"."id"')
  })

  it("renders the same in a query with joins", () => {
    const query = db
      .select({ n: sql`(select count(*) from ${accounts} a where a.creator_id = ${outerRef(creators.id)})` })
      .from(creators)
      .leftJoin(campaigns, eq(campaigns.id, creators.id))
      .toSQL()
    expect(query.sql).toContain('a.creator_id = "creators"."id"')
  })
})
