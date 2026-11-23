// Dev helper: adds two public accounts through the UI, presses "Scrape now" and waits for the
// real Apify runs to be ingested. Costs a few cents of Apify credit.
//   node --env-file=.env.local scripts/dev/e2e-scrape.mjs <email> <password> [tiktok|instagram]
import { chromium } from "playwright-core"

// Optional third argument limits the run to one platform handle: tiktok | instagram.
const [email, password, only] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"
const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
page.setDefaultTimeout(20_000)
const problems = []
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))

await page.goto(`${base}/login`)
await page.getByLabel("Email").fill(email)
await page.getByLabel("Password").fill(password)
await page.getByRole("button", { name: "Sign in" }).click()
await page.waitForURL(`${base}/`)

for (const [platformLabel, handle] of [["TikTok", "tiktok"], ["Instagram", "instagram"]]) {
  if (only && only !== handle) continue
  await page.goto(`${base}/accounts`)
  if (!(await page.getByRole("link", { name: `@${handle}`, exact: true }).count())) {
    await page.getByRole("button", { name: "Add account" }).click()
    const dialog = page.getByRole("dialog")
    if (platformLabel !== "TikTok") {
      await dialog.getByRole("combobox").first().click()
      await page.getByRole("option", { name: platformLabel, exact: true }).click()
    }
    await dialog.getByLabel("Handle or profile URL").fill(`@${handle}`)
    await dialog.getByRole("button", { name: "Add account" }).click()
    await page.getByText("Account added").waitFor()
  }
  const row = page.locator("tbody tr", { has: page.getByRole("link", { name: `@${handle}`, exact: true }) }).filter({ hasText: platformLabel === "TikTok" ? "TT" : "IG" })
  const started = Date.now()
  await row.getByRole("button", { name: "Scrape now" }).click()
  // Success and failure toasts both name the handle; an action error does not, so watch for both.
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: /@|Apify|wrong|failed/i })
  await toast.first().waitFor({ timeout: 420_000 })
  console.log(`${platformLabel} @${handle}: "${(await toast.first().innerText()).replace(/\s+/g, " ")}" after ${Math.round((Date.now() - started) / 1000)}s`)
}
console.log(problems.length ? problems.join("\n") : "no browser errors")
await browser.close()
