// Installs (or updates) the scheduler in the hosted database: runs supabase/cron.sql with the
// app URL and CRON_SECRET from the environment, then calls the hourly job once to prove that
// the database can reach the app.
//
//   pnpm cron:install            (reads .env.hosted)

import { readFileSync } from "node:fs"
import path from "node:path"

import postgres from "postgres"

const APP_URL_PLACEHOLDER = "https://YOUR-APP.vercel.app"
const SECRET_PLACEHOLDER = "PASTE-YOUR-CRON_SECRET-HERE"

const literal = (value: string) => value.replaceAll("'", "''")

async function main() {
  const appUrl = process.env.APP_URL?.replace(/\/$/, "")
  const cronSecret = process.env.CRON_SECRET
  // Prefer a normal session; the transaction pooler works too for this script.
  const databaseUrl = process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL
  if (!appUrl?.startsWith("https://")) throw new Error("APP_URL must be the public https URL of the deployed app.")
  if (!cronSecret) throw new Error("CRON_SECRET is not set.")
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.")

  const template = readFileSync(path.join(process.cwd(), "supabase", "cron.sql"), "utf8")
  if (!template.includes(APP_URL_PLACEHOLDER) || !template.includes(SECRET_PLACEHOLDER)) {
    throw new Error("supabase/cron.sql no longer contains the placeholders this script fills in.")
  }
  const script = template
    .replace(APP_URL_PLACEHOLDER, literal(appUrl))
    .replace(SECRET_PLACEHOLDER, literal(cronSecret))

  const sql = postgres(databaseUrl, { prepare: false, max: 1, onnotice: () => {} })
  try {
    await sql.unsafe(script)
    const jobs = await sql`select jobname, schedule, active from cron.job where jobname like 'ugc-%' order by jobname`
    console.log(`Scheduler installed on ${new URL(databaseUrl).host} for ${appUrl}`)
    for (const job of jobs) console.log(`  ${job.jobname.padEnd(22)} ${job.schedule.padEnd(12)} ${job.active ? "active" : "OFF"}`)

    // One real call, the same way pg_cron will make it.
    const [{ id }] = await sql`select public.ugc_call_job('/api/cron/window-close') as id`
    let status: number | null = null
    let detail = ""
    for (let attempt = 0; attempt < 20 && status === null; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const [row] = await sql`select status_code, error_msg, timed_out from net._http_response where id = ${id}`
      if (row) {
        status = row.status_code
        detail = row.timed_out ? "timed out" : (row.error_msg ?? "")
      }
    }
    if (status !== null && status >= 200 && status < 300) {
      console.log(`Test call to /api/cron/window-close answered ${status}. The database can reach the app.`)
    } else {
      console.error(`Test call failed: status ${status ?? "none"} ${detail}. Check APP_URL and that CRON_SECRET matches the Vercel env var.`)
      process.exitCode = 1
    }
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
