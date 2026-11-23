// Dev helper: checks the Calendar page against the database for every campaign's current cycle.
//   · the day cells: posts per creator, platform and LOCAL day (the creator's own time zone)
//   · "Posted": posts inside the payout cycle, which is cut in the CAMPAIGN time zone
// To exercise the time zone path it moves the first creator to Asia/Tokyo through the Edit dialog
// and puts them back afterwards, so local data ends up unchanged. Local database only.
//   node --env-file=.env.local scripts/dev/e2e-calendar.mjs <email> <password>
import { chromium } from "playwright-core"
import postgres from "postgres"

const [email, password] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("This check edits a creator, so it only runs against the local database.")
}
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
  if (shown !== expected) failures.push(`${what}: page shows ${shown}, database has ${expected}`)
}

async function setTimeZone(creatorId, label) {
  await page.goto(`${base}/creators/${creatorId}`)
  await page.getByRole("button", { name: "Edit" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Time zone").click()
  await page.getByRole("option", { name: label, exact: true }).click()
  await dialog.getByRole("button", { name: "Save changes" }).click()
  await dialog.waitFor({ state: "hidden" })
}

// One entry per track row: { creator, track: "TT" | "IG" | "All", days: { "Sep 3, 2026": 2 }, posted }.
async function readGrid(campaignId) {
  await page.goto(`${base}/calendar?campaign=${campaignId}`)
  await page.locator("table tbody tr").first().waitFor()
  return page.evaluate(() => {
    const rows = []
    let creator = null
    for (const tr of document.querySelectorAll("table tbody tr")) {
      const cells = [...tr.querySelectorAll("td")]
      if (cells[0].hasAttribute("rowspan")) creator = cells.shift().querySelector("a").textContent.trim()
      const track = cells.shift().textContent.trim()
      const days = {}
      for (const td of cells) {
        const title = td.firstElementChild?.getAttribute("title")
        const match = title?.match(/· (\d+)(?: of \d+)? posts?/)
        if (match) days[title.split(" · ")[0]] = Number(match[1])
      }
      const posted = Number(cells.at(-3).textContent.split("/")[0].replace(/[^\d]/g, ""))
      rows.push({ creator, track, days, posted })
    }
    return rows
  })
}

const SHORT = { tiktok: "TT", instagram: "IG", youtube: "YT", facebook: "FB", snapchat: "SC" }
const dayTitle = (day) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(day)

const [moved] = await sql`
  select c.id, c.name, c.timezone from creators c
  join campaign_creators cc on cc.creator_id = c.id
  where c.status = 'active' order by c.name limit 1`

try {
  await setTimeZone(moved.id, "Asia/Tokyo")
  const [{ timezone }] = await sql`select timezone from creators where id = ${moved.id}`
  check(`${moved.name} time zone after saving`, timezone, "Asia/Tokyo")

  for (const campaign of await sql`select id, name, timezone, quota_scope from campaigns where cycle_type = 'monthly'`) {
    const grid = await readGrid(campaign.id)
    const perPlatform = campaign.quota_scope !== "total"

    const cellCounts = await sql`
      select c.name as creator, p.platform,
        (p.posted_at at time zone coalesce(c.timezone, ${campaign.timezone}))::date as day, count(*)::int as n
      from posts p join creators c on c.id = p.creator_id
      where p.campaign_id = ${campaign.id} and not p.is_excluded
      group by 1, 2, 3`
    const cycleCounts = await sql`
      select c.name as creator, p.platform, count(*)::int as n
      from posts p join creators c on c.id = p.creator_id
      where p.campaign_id = ${campaign.id} and not p.is_excluded and p.base_cycle_id is null
        and date_trunc('month', p.posted_at at time zone ${campaign.timezone})
          = date_trunc('month', now() at time zone ${campaign.timezone})
      group by 1, 2`

    for (const row of grid) {
      const mine = (r) => r.creator === row.creator && (!perPlatform || SHORT[r.platform] === row.track)
      const what = `${campaign.name} · ${row.creator} · ${row.track}`
      check(`${what} · Posted`, row.posted, cycleCounts.filter(mine).reduce((sum, r) => sum + r.n, 0))

      const expectedDays = {}
      for (const r of cellCounts.filter(mine)) {
        const key = dayTitle(r.day)
        expectedDays[key] = (expectedDays[key] ?? 0) + r.n
      }
      for (const [day, shown] of Object.entries(row.days)) check(`${what} · ${day}`, shown, expectedDays[day] ?? 0)
    }
    console.log(`${campaign.name}: ${grid.length} rows read`)
  }
} finally {
  await setTimeZone(moved.id, moved.timezone ? moved.timezone.replaceAll("_", " ") : "Same as campaign")
  const [{ timezone }] = await sql`select timezone from creators where id = ${moved.id}`
  check(`${moved.name} time zone after restoring`, timezone, moved.timezone)
  await sql.end()
  await browser.close()
}

if (failures.length) {
  console.error(`${failures.length} of ${checks} checks failed:\n` + failures.join("\n"))
  process.exit(1)
}
console.log(`All ${checks} checks passed.`)
