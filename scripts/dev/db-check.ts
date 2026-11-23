// Prints what the database behind DATABASE_URL looks like. Read-only.
//   tsx --env-file=.env.hosted scripts/dev/db-check.ts
import postgres from "postgres"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const sql = postgres(url, { prepare: false, max: 1 })
  const [{ version }] = await sql`select version()`
  const tables = await sql`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 1`
  const buckets = await sql`select id, public from storage.buckets`
  const extensions = await sql`select extname from pg_extension where extname in ('pg_cron', 'pg_net', 'supabase_vault') order by 1`
  console.log(version.split(" ").slice(0, 2).join(" "), "on", new URL(url).host)
  console.log(`${tables.length} tables, RLS on all: ${tables.every((t) => t.rls)}`)
  console.log("buckets:", buckets.map((b) => `${b.id}${b.public ? " (public)" : ""}`).join(", ") || "none")
  console.log("extensions:", extensions.map((e) => e.extname).join(", ") || "none")
  await sql.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
