import { defineConfig } from "drizzle-kit"

// Drizzle is the schema source of truth, but it only *generates* SQL. The Supabase CLI applies
// the files (`supabase migration up` locally, `supabase db push` for the hosted project), so
// migrations are written in Supabase's timestamped naming into supabase/migrations.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./supabase/migrations",
  migrations: { prefix: "supabase" },
  schemaFilter: ["public"],
})
