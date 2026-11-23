// Dev helper: checks the Videos page date and metric filters against the database. Read-only.
//   node --env-file=.env.local scripts/dev/e2e-video-filters.mjs <email> <password> [screenshot-dir]
import { chromium } from "playwright-core"
import postgres from "postgres"

const [email, password, shots] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })

const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(15_000)

await page.goto(`${base}/login`)
await page.getByLabel("Email").fill(email)
await page.getByLabel("Password").fill(password)
await page.getByRole("button", { name: "Sign in" }).click()
await page.waitForURL(`${base}/`)

const failures = []
let checks = 0
const check = (what, shown, expected) => {
  checks += 1
  if (shown !== expected) failures.push(`${what}: page shows ${shown}, expected ${expected}`)
}
const shot = (name) => (shots ? page.screenshot({ path: `${shots}/${name}.png` }) : null)

// "1,234 videos · page 1 of 3" → 1234. The empty state has no counter, so that is 0.
async function readTotal() {
  const counter = page.getByText(/^[\d,]+ videos?\b/)
  if (!(await counter.count())) return 0
  return Number((await counter.first().textContent()).match(/^[\d,]+/)[0].replaceAll(",", ""))
}

// A filter change re-renders the list a moment after the URL moves, so give the expected total
// a few seconds to appear before calling it wrong.
async function checkTotal(what, expected) {
  const deadline = Date.now() + 5000
  let shown = await readTotal()
  while (shown !== expected && Date.now() < deadline) {
    await page.waitForTimeout(100)
    shown = await readTotal()
  }
  check(what, shown, expected)
}

const day = sql`(p.posted_at at time zone coalesce(c.timezone, 'UTC'))::date`
const count = async (where) =>
  (await sql`select count(*)::int as n from posts p left join campaigns c on c.id = p.campaign_id where ${where}`)[0].n

// Pick bounds from the data so every filter has something to match and something to drop.
const [stats] = await sql`
  select
    percentile_disc(0.5) within group (order by current_views) as views,
    percentile_disc(0.5) within group (order by current_likes) as likes,
    round((percentile_disc(0.5) within group (order by engagement_rate) * 100)::numeric, 1)::float8 as engagement,
    to_char(percentile_disc(0.5) within group (order by posted_at), 'YYYY-MM-DD') as day
  from posts`
console.log("medians:", stats)

// 1. URL-driven: each filter alone, then combined.
await page.goto(`${base}/videos?views=${stats.views}-`)
await checkTotal("views ≥ median", await count(sql`p.current_views >= ${stats.views}`))

await page.goto(`${base}/videos?views=-${stats.views}`)
await checkTotal("views ≤ median", await count(sql`p.current_views <= ${stats.views}`))

await page.goto(`${base}/videos?likes=${stats.likes}-`)
await checkTotal("likes ≥ median", await count(sql`p.current_likes >= ${stats.likes}`))

await page.goto(`${base}/videos?engagement=${stats.engagement}-`)
await checkTotal("engagement ≥ median", await count(sql`p.engagement_rate >= ${stats.engagement / 100}`))

await page.goto(`${base}/videos?from=${stats.day}`)
await checkTotal("posted since median day", await count(sql`${day} >= ${stats.day}::date`))

await page.goto(`${base}/videos?to=${stats.day}`)
await checkTotal("posted until median day", await count(sql`${day} <= ${stats.day}::date`))

await page.goto(`${base}/videos?from=${stats.day}&views=${stats.views}-&engagement=-${stats.engagement}`)
await checkTotal("date + views + engagement", await count(sql`${day} >= ${stats.day}::date and p.current_views >= ${stats.views} and p.engagement_rate <= ${stats.engagement / 100}`)
)

// Hand-edited URLs must not break the page.
for (const bad of ["views=1.5-", "views=abc", "views=99999999999999999999-", "from=2026-13-45", "to=2026-02-30", "engagement=-"]) {
  const response = await page.goto(`${base}/videos?${bad}`)
  check(`status for ?${bad}`, response.status(), 200)
}

// 2. Through the UI: Metrics popover with shorthand, then sort by engagement.
await page.goto(`${base}/videos`)
await page.locator("table tbody tr").first().waitFor()
const all = await readTotal()
await page.getByRole("button", { name: /^Metrics/ }).click()
await shot("metrics-popover")
await page.getByLabel("Views, minimum").fill("1k")
await page.getByLabel("Views, maximum").fill("abc")
check("Apply disabled on junk", await page.getByRole("button", { name: "Apply" }).isDisabled(), true)
await page.getByLabel("Views, maximum").fill("")
await page.getByLabel("Engagement %, minimum").fill("2")
await page.getByLabel("Engagement %, minimum").press("Enter")
await page.waitForURL(/views=1000-/)
check("URL after Apply", new URL(page.url()).search, "?views=1000-&engagement=2-")
await checkTotal("views ≥ 1k, engagement ≥ 2%", await count(sql`p.current_views >= 1000 and p.engagement_rate >= 0.02`))
check("Metrics badge", (await page.getByRole("button", { name: /^Metrics/ }).textContent()).trim(), "Metrics2")

// Reopening shows what is applied, in shorthand.
await page.getByRole("button", { name: /^Metrics/ }).click()
check("draft reloaded", await page.getByLabel("Views, minimum").inputValue(), "1k")
await page.keyboard.press("Escape")

await page.getByRole("link", { name: "Eng." }).click()
await page.waitForURL(/sort=engagement/)
await page.waitForLoadState("networkidle")
const engagementColumn = await page.locator("table thead th").allTextContents().then((h) => h.findIndex((t) => t.trim() === "Eng."))
const shown = await page.locator(`table tbody tr td:nth-child(${engagementColumn + 1})`).allTextContents()
const values = shown.map((t) => Number.parseFloat(t))
check("sorted by engagement, high first", JSON.stringify(values), JSON.stringify([...values].sort((a, b) => b - a)))
check("every row ≥ 2%", values.every((v) => v >= 2), true)
await shot("metrics-applied")

// 3. Through the UI: Posted presets and the calendar.
await page.goto(`${base}/videos`)
await page.getByRole("button", { name: "Posted" }).click()
await shot("posted-popover")
await page.getByRole("button", { name: "Last 30 days" }).click()
await page.waitForURL(/from=/)
const from = new URL(page.url()).searchParams.get("from")
await checkTotal("Last 30 days total", await count(sql`${day} >= ${from}::date`))
check("no end date", new URL(page.url()).searchParams.get("to"), null)

await page.getByRole("button", { name: "Last month" }).click()
await page.waitForURL(/to=/)
const lastMonth = new URL(page.url()).searchParams
await checkTotal("Last month total", await count(sql`${day} between ${lastMonth.get("from")}::date and ${lastMonth.get("to")}::date`)
)
await shot("posted-last-month")

// Clear brings everything back.
await page.keyboard.press("Escape")
await page.getByRole("button", { name: "Clear" }).click()
await page.waitForURL(`${base}/videos`)
await checkTotal("after Clear", all)

await browser.close()
await sql.end()
console.log(failures.length ? `FAILED ${failures.length} of ${checks}:\n${failures.join("\n")}` : `OK: ${checks} checks`)
process.exit(failures.length ? 1 : 0)
