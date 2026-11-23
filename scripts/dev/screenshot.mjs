// Dev helper: signs in with the real Supabase library, then screenshots app pages with the
// locally installed Chrome (no browser download needed).
//   node --env-file=.env.local scripts/dev/screenshot.mjs <email> <password> <outDir> /path [/path…]
import { createServerClient } from "@supabase/ssr"
import { chromium } from "playwright-core"

const [email, password, outDir, ...paths] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"

const jar = new Map()
const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((c) => jar.set(c.name, c.value)),
    },
  }
)
if (email !== "-") {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

const browser = await chromium.launch({ channel: "chrome", headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: process.env.SHOT_COLOR_SCHEME ?? "light",
})
await context.addCookies(
  [...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), url: base }))
)
const page = await context.newPage()
const problems = []
page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`))
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))

for (const path of paths) {
  await page.goto(base + path, { waitUntil: "networkidle" })
  const file = `${outDir}/${path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`
  await page.screenshot({ path: file, fullPage: false })
  console.log(path, "→", file)
}
console.log(problems.length ? "console problems:\n" + problems.join("\n") : "no console errors or warnings")
await browser.close()
