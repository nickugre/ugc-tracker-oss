// Dev helper: checks that the counts on the Creators and Campaigns lists match the database.
// Read-only, so it can be run as often as needed (unlike e2e-smoke.mjs). It exists because these
// lists once showed 0 everywhere: their subqueries compared against the wrong table's "id".
//   node --env-file=.env.local scripts/dev/e2e-lists.mjs <email> <password>
import { chromium } from "playwright-core"
import postgres from "postgres"

const [email, password] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })

const expectedCreators = await sql`
  select c.name,
    (select count(*)::int from accounts a where a.creator_id = c.id) as accounts,
    (select count(*)::int from posts p where p.creator_id = c.id and not p.is_excluded) as videos,
    (select count(*)::int from campaign_creators cc where cc.creator_id = c.id) as campaigns
  from creators c`
const expectedCampaigns = await sql`
  select c.name,
    (select count(*)::int from campaign_creators cc where cc.campaign_id = c.id) as creators,
    (select count(*)::int from posts p where p.campaign_id = c.id) as videos
  from campaigns c`
await sql.end()

const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(15_000)

await page.goto(`${base}/login`)
await page.getByLabel("Email").fill(email)
await page.getByLabel("Password").fill(password)
await page.getByRole("button", { name: "Sign in" }).click()
await page.waitForURL(`${base}/`)

// Rows as { header: cell text }, keyed by the first column.
async function readTable(path) {
  await page.goto(`${base}${path}`)
  await page.locator("table tbody tr").first().waitFor()
  return page.evaluate(() => {
    const headers = [...document.querySelectorAll("table thead th")].map((th) => th.textContent.trim())
    return [...document.querySelectorAll("table tbody tr")].map((tr) =>
      Object.fromEntries([...tr.querySelectorAll("td")].map((td, i) => [headers[i], td.textContent.trim()]))
    )
  })
}
const digits = (text) => Number(text.replace(/[^\d]/g, ""))

const failures = []
const check = (what, shown, expected) => {
  if (shown !== expected) failures.push(`${what}: page shows ${shown}, database has ${expected}`)
}

const creatorRows = await readTable("/creators")
for (const expected of expectedCreators) {
  const row = creatorRows.find((r) => r.Creator === expected.name)
  if (!row) {
    failures.push(`creator ${expected.name} is missing from the list`)
    continue
  }
  check(`${expected.name} accounts`, digits(row.Accounts), expected.accounts)
  check(`${expected.name} videos`, digits(row.Videos), expected.videos)
  check(`${expected.name} campaigns`, row.Campaigns === "—" ? 0 : row.Campaigns.split(", ").length, expected.campaigns)
}

const campaignRows = await readTable("/campaigns")
for (const expected of expectedCampaigns) {
  const row = campaignRows.find((r) => r.Campaign.startsWith(expected.name))
  if (!row) {
    failures.push(`campaign ${expected.name} is missing from the list`)
    continue
  }
  check(`${expected.name} creators`, digits(row.Creators), expected.creators)
  check(`${expected.name} videos`, digits(row.Videos), expected.videos)
}

await browser.close()
console.log(`${expectedCreators.length} creators, ${expectedCampaigns.length} campaigns compared`)
if (failures.length) {
  console.log(failures.map((f) => `FAIL  ${f}`).join("\n"))
  process.exit(1)
}
console.log("PASS  list counts match the database")
