// Read-only check of a deployed instance: signs in and opens every page, failing on error
// pages, failed requests and browser console errors. Changes nothing, so it is safe to run
// against production.
//   node scripts/dev/e2e-prod-check.mjs https://your-app.vercel.app <email> <password> [screenshot-dir]
import { chromium } from "playwright-core"

const [base, email, password, shots] = process.argv.slice(2)
if (!base || !email || !password) {
  console.error("Usage: node scripts/dev/e2e-prod-check.mjs <base-url> <email> <password> [screenshot-dir]")
  process.exit(1)
}

const pages = [
  ["/", "Views → payouts"],
  ["/videos", "Videos"],
  ["/calendar", "Calendar"],
  ["/payouts", "Payouts"],
  ["/creators", "Creators"],
  ["/accounts", "Accounts"],
  ["/campaigns", "Campaigns"],
  ["/campaigns/new", "Create campaign"],
  ["/settings", "Team"],
]

const browser = await chromium.launch({ channel: "chrome", headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(30_000)
const problems = []
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`))
page.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`))

const results = []
try {
  const started = Date.now()
  await page.goto(`${base}/login`)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(`${base}/`)
  results.push(`PASS  sign in (${Date.now() - started} ms)`)
} catch (error) {
  results.push(`FAIL  sign in — ${String(error.message).split("\n")[0]}`)
}

for (const [path, marker] of pages) {
  const started = Date.now()
  try {
    const response = await page.goto(`${base}${path}`)
    if (!response || response.status() !== 200) throw new Error(`status ${response?.status()}`)
    await page.getByText(marker, { exact: false }).first().waitFor()
    const body = await page.locator("body").innerText()
    if (/Application error|Something went wrong|Internal Server Error/i.test(body)) throw new Error("error page shown")
    if (shots) await page.screenshot({ path: `${shots}/prod${path === "/" ? "-overview" : path.replaceAll("/", "-")}.png` })
    results.push(`PASS  ${path.padEnd(16)} ${Date.now() - started} ms`)
  } catch (error) {
    results.push(`FAIL  ${path.padEnd(16)} ${String(error.message).split("\n")[0]}`)
  }
}

await browser.close()
console.log(results.join("\n"))
console.log(problems.length ? `\nBrowser problems:\n${[...new Set(problems)].join("\n")}` : "\nNo browser errors.")
process.exit(results.some((r) => r.startsWith("FAIL")) || problems.length ? 1 : 0)
