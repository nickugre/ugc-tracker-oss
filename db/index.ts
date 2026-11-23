import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

// `prepare: false` because the hosted DATABASE_URL is Supabase's transaction pooler, which does
// not support prepared statements. The client is cached on globalThis so dev hot reloads do not
// leak connections.
const globalForDb = globalThis as unknown as { __ugcPg?: ReturnType<typeof postgres> }

const client =
  globalForDb.__ugcPg ??
  postgres(process.env.DATABASE_URL ?? "", {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  })

if (process.env.NODE_ENV !== "production") globalForDb.__ugcPg = client

export const db = drizzle(client, { schema })
export type Db = typeof db
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export { schema }
