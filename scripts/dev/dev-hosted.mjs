// `pnpm dev:hosted`: the dev server on the PRODUCTION database and sign-in. Everything changed
// or deleted through it is real.
//
// The settings come from .env.hosted. They are loaded here and not with `node --env-file`,
// because `next dev` restarts itself and Node refuses that flag in NODE_OPTIONS. Variables that
// are already set win over .env.local, which Next.js loads afterwards.
import { spawn } from "node:child_process"

process.loadEnvFile(".env.hosted")

// Never the public URL: with it, Apify would send its webhooks to the deployed app, and a scrape
// started here would be ingested there, by whatever version is deployed. On localhost webhooks
// are off and the page that started the scrape collects it.
process.env.APP_URL = "http://localhost:3000"

console.log(`\n  PRODUCTION DATA: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host}\n`)

const next = spawn("next", ["dev"], { stdio: "inherit" })
next.on("exit", (code) => process.exit(code ?? 0))
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => next.kill(signal))
