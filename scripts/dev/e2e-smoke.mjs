// Dev helper: drives the real UI in the locally installed Chrome to prove the main flows work
// end to end (forms → Server Actions → database → re-render). Run against a FRESHLY seeded local
// DB (`pnpm db:seed`): it finalizes and pays the seeded cycle, so it passes once per seed.
//   node --env-file=.env.local scripts/dev/e2e-smoke.mjs <email> <password>
import { chromium } from "playwright-core"

const [email, password] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"
const results = []
const step = async (name, fn) => {
  try {
    await fn()
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name} — ${String(error.message ?? error).split("\n")[0]}`)
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const problems = []
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`))

const stamp = Date.now().toString(36)

await step("sign in through the login form", async () => {
  await page.goto(`${base}/login`)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(`${base}/`)
  await page.getByText("Views → payouts").waitFor()
})

await step("wrong password shows an error", async () => {
  const fresh = await browser.newContext()
  const p = await fresh.newPage()
  await p.goto(`${base}/login`)
  await p.getByLabel("Email").fill(email)
  await p.getByLabel("Password").fill("not-the-password")
  await p.getByRole("button", { name: "Sign in" }).click()
  await p.getByText("Wrong email or password.").waitFor()
  await fresh.close()
})

let campaignUrl = ""
await step("create a campaign from the standard contract", async () => {
  await page.goto(`${base}/campaigns/new`)
  await page.getByLabel("Name").fill(`E2E Campaign ${stamp}`)
  await page.getByRole("button", { name: "Create campaign" }).click()
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/)
  campaignUrl = page.url()
  await page.getByRole("heading", { name: `E2E Campaign ${stamp}` }).waitFor()
})

await step("campaign form rejects an empty name", async () => {
  await page.goto(`${base}/campaigns/new`)
  await page.getByRole("button", { name: "Create campaign" }).click()
  await page.getByText("Give the campaign a name").waitFor()
})

await step("edit the campaign window and save", async () => {
  await page.goto(campaignUrl)
  const field = page.getByLabel("View window")
  await field.fill("30")
  await page.getByRole("button", { name: "Save changes" }).click()
  await page.getByText("Campaign saved").waitFor()
  await page.reload()
  if ((await page.getByLabel("View window").inputValue()) !== "30") throw new Error("window not persisted")
})

await step("add a creator", async () => {
  await page.goto(`${base}/creators`)
  await page.getByRole("button", { name: "Add creator" }).click()
  await page.getByLabel("Name").fill(`E2E Creator ${stamp}`)
  await page.getByLabel("Email").fill(`e2e-${stamp}@example.com`)
  await page.getByRole("dialog").getByRole("button", { name: "Add creator" }).click()
  await page.getByRole("link", { name: `E2E Creator ${stamp}` }).waitFor()
})

await step("assign the creator to the campaign", async () => {
  await page.goto(`${campaignUrl}?tab=people`)
  await page.getByRole("combobox").click()
  await page.getByRole("option", { name: `E2E Creator ${stamp}` }).click()
  await page.getByRole("button", { name: "Assign" }).click()
  await page.getByRole("link", { name: `E2E Creator ${stamp}` }).waitFor()
})

await step("add an account from a profile URL", async () => {
  await page.goto(`${base}/accounts`)
  await page.getByRole("button", { name: "Add account" }).click()
  await page.getByLabel("Handle or profile URL").fill(`https://www.tiktok.com/@E2E.${stamp}`)
  await page.getByText(`https://www.tiktok.com/@e2e.${stamp}`).waitFor()
  await page.getByRole("dialog").getByRole("button", { name: "Add account" }).click()
  await page.getByRole("link", { name: `@e2e.${stamp}` }).waitFor()
})

await step("filter videos by status through the URL-backed filter", async () => {
  await page.goto(`${base}/videos`)
  await page.getByRole("button", { name: "Status" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Locked" }).click()
  await page.waitForURL(/status=locked/)
  await page.keyboard.press("Escape")
  // The URL changes first; the re-rendered server table arrives a moment later.
  let open = -1
  for (let i = 0; i < 25 && open !== 0; i++) {
    await page.waitForTimeout(200)
    open = await page.locator("tbody").getByText("Open", { exact: true }).count()
  }
  if (open !== 0) throw new Error(`expected no Open rows, saw ${open}`)
  if ((await page.locator("tbody tr").count()) === 0) throw new Error("no rows at all")
})

await step("bulk exclude two videos with a reason, then include them again", async () => {
  await page.goto(`${base}/videos?status=locked`)
  const rows = page.locator("tbody tr")
  // Remember which two videos are excluded so only those are included again afterwards.
  const ids = []
  for (const i of [0, 1]) {
    const href = await rows.nth(i).getByRole("link").first().getAttribute("href")
    ids.push(new URL(href, base).searchParams.get("video"))
    await rows.nth(i).getByRole("checkbox").click()
  }
  await page.getByText("2 selected").waitFor()
  await page.getByRole("button", { name: "Exclude", exact: true }).click()
  await page.getByLabel("Reason").fill("e2e smoke test")
  await page.getByRole("dialog").getByRole("button", { name: "Exclude" }).click()
  await page.getByText("2 videos excluded").waitFor()

  await page.goto(`${base}/videos?status=excluded`)
  for (const id of ids) {
    await page.locator("tbody tr", { has: page.locator(`a[href*="${id}"]`) }).getByRole("checkbox").click()
  }
  await page.getByText("2 selected").waitFor()
  await page.getByRole("button", { name: "Include", exact: true }).click()
  await page.getByText("2 videos included again").waitFor()
})

await step("open a locked video, unlock it with a reason, lock it again", async () => {
  await page.goto(`${base}/videos?status=locked&sort=views`)
  await page.locator("tbody tr").first().getByRole("link").first().click()
  await page.waitForURL(/video=/)
  const sheet = page.getByRole("dialog")
  await sheet.getByRole("button", { name: "Unlock" }).click()
  await page.getByLabel("Reason").fill("e2e unlock")
  await page.getByRole("button", { name: "Unlock", exact: true }).last().click()
  await page.getByText("Video unlocked").waitFor()
  await sheet.getByRole("button", { name: "Lock now" }).click()
  await page.getByText("Views locked").waitFor()
})

// ── Payout flow on last month's cycle of the CPM test campaign (seeded as finalized, unpaid) ──
const lastMonth = (() => {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
})()
let payoutUrl = ""
const dollars = async () =>
  Number((await page.getByText("Total to pay").locator("..").locator("p").nth(1).innerText()).replace(/[$,]/g, ""))

await step("open the finalized cycle from the Payouts page", async () => {
  await page.goto(`${base}/payouts`)
  await page.getByRole("link", { name: /Acme CPM Test/ }).first().click()
  await page.waitForURL(/\/payouts\/[0-9a-f-]{36}/)
  payoutUrl = `${page.url().split("?")[0]}?period=${lastMonth}`
  await page.goto(payoutUrl)
  await page.getByText("Finalized · not paid").waitFor()
})

await step("reopen the cycle with a reason (back to live preview)", async () => {
  await page.getByRole("button", { name: "Reopen" }).click()
  await page.getByLabel("Reason").fill("e2e: correcting an adjustment")
  await page.getByRole("dialog").getByRole("button", { name: "Reopen" }).click()
  // exact: the dialog's description also contains the words "live preview".
  await page.getByText("Live preview", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Finalize cycle" }).waitFor()
})

await step("add a +$25 adjustment and see the total move by exactly $25", async () => {
  const before = await dollars()
  await page.getByRole("button", { name: "Add adjustment" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("combobox").first().click()
  await page.getByRole("option").first().click()
  await dialog.getByLabel("Amount").fill("25")
  await dialog.getByLabel("Reason").fill("e2e: travel reimbursement")
  await dialog.getByRole("button", { name: "Add adjustment" }).click()
  await page.getByText("Adjustment added").waitFor()
  let after = before
  for (let i = 0; i < 25 && after === before; i++) {
    await page.waitForTimeout(200)
    after = await dollars()
  }
  if (Math.round((after - before) * 100) !== 2500) throw new Error(`total moved by ${after - before}`)
})

await step("finalize the cycle", async () => {
  await page.getByRole("button", { name: "Finalize cycle" }).click()
  const dialog = page.getByRole("dialog")
  const roll = dialog.getByRole("checkbox")
  if (await roll.count()) await roll.click()
  await dialog.getByRole("button", { name: "Finalize", exact: true }).click()
  await page.getByText("Finalized · not paid").waitFor()
})

await step("finalizing twice is impossible and the CSV export works", async () => {
  if (await page.getByRole("button", { name: "Finalize cycle" }).count()) throw new Error("still finalizable")
  const response = await page.request.get(`${base}/api/payouts/export?campaign=${payoutUrl.split("/payouts/")[1].split("?")[0]}&period=${lastMonth}`)
  const body = await response.text()
  if (response.status() !== 200 || !response.headers()["content-type"].includes("text/csv")) throw new Error("bad CSV response")
  if (!body.includes("total_usd") || body.split("\r\n").length < 3) throw new Error("CSV looks empty")
})

await step("mark one creator paid, then the rest; the cycle becomes Paid", async () => {
  await page.getByRole("button", { name: "Mark paid", exact: true }).first().click()
  await page.getByLabel("Payment reference").fill("e2e-ref-1")
  await page.getByRole("dialog").getByRole("button", { name: "Mark paid" }).click()
  await page.getByText("Marked as paid").first().waitFor()
  await page.getByRole("button", { name: /Mark remaining \d+ paid/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Mark paid" }).click()
  await page.getByText("Total paid").waitFor()
  if (await page.getByRole("button", { name: "Reopen" }).count()) throw new Error("a paid cycle must not be reopenable")
})

await step("the CSV export is not reachable without a session", async () => {
  const anonymous = await browser.newContext()
  const campaign = payoutUrl.split("/payouts/")[1].split("?")[0]
  const response = await anonymous.request.get(`${base}/api/payouts/export?campaign=${campaign}&period=${lastMonth}`)
  // The proxy sends signed-out requests to /login before the route runs.
  if ((response.headers()["content-type"] ?? "").includes("text/csv")) throw new Error("CSV served without a session")
  if (!response.url().includes("/login")) throw new Error(`expected a redirect to /login, got ${response.url()}`)
  await anonymous.close()
})

console.log(results.join("\n"))
console.log(problems.length ? `\nBrowser problems:\n${problems.join("\n")}` : "\nNo browser errors.")
await browser.close()
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0)
