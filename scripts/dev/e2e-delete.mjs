// Dev helper: proves deletion end to end against the LOCAL seeded stack: what may be deleted
// (mistakes, test data: accounts with their videos and thumbnails, empty creators and campaigns)
// and what must refuse (anything that is part of a payout).
//   node --env-file=.env.local scripts/dev/e2e-delete.mjs <email> <password>
import { createClient } from "@supabase/supabase-js"
import { chromium } from "playwright-core"
import postgres from "postgres"

const [email, password] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("This test writes rows directly and only runs against the local database.")
  process.exit(1)
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const results = []
const step = async (name, fn) => {
  try {
    await fn()
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name} — ${String(error.message ?? error).split("\n")[0]}`)
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const stamp = Date.now().toString(36)
const handle = `e2edel${stamp}`
const thumbPath = `posts/tiktok/e2e-${stamp}.jpg`
const campaignName = `E2E Delete ${stamp}`
const creatorName = `E2E Delete Creator ${stamp}`

// A throwaway account with three open videos, view history and one stored thumbnail.
const [account] = await sql`
  insert into accounts (platform, handle, url) values ('tiktok', ${handle}, ${`https://www.tiktok.com/@${handle}`}) returning id`
const posted = new Date(Date.now() - 3 * 86_400_000)
const ends = new Date(posted.getTime() + 14 * 86_400_000)
const postIds = []
for (let i = 0; i < 3; i++) {
  const [post] = await sql`
    insert into posts (account_id, platform, platform_post_id, url, posted_at, window_days, window_ends_at, thumbnail_path)
    values (${account.id}, 'tiktok', ${`e2e-${stamp}-${i}`}, ${`https://www.tiktok.com/@${handle}/video/${i}`}, ${posted}, 14, ${ends}, ${i === 0 ? thumbPath : null})
    returning id`
  postIds.push(post.id)
  await sql`insert into post_snapshots (post_id, captured_at, views, kind) values (${post.id}, now(), ${1000 * (i + 1)}, 'manual')`
}
const upload = await supabase.storage.from("thumbnails").upload(thumbPath, Buffer.from("e2e"), { contentType: "image/jpeg", upsert: true })
if (upload.error) throw upload.error

const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
page.setDefaultTimeout(15_000)
const problems = []
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))

async function confirmDelete(text) {
  const dialog = page.getByRole("dialog").last()
  const submit = dialog.getByRole("button", { name: "Delete permanently" })
  assert(await submit.isDisabled(), "delete must be disabled until the name is typed")
  await dialog.getByRole("textbox").fill(text)
  await submit.click()
}

await step("sign in", async () => {
  await page.goto(`${base}/login`)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(`${base}/`)
})

await step("an account whose videos were paid refuses to be deleted", async () => {
  const [paid] = await sql`
    select a.handle, a.platform from accounts a join posts p on p.account_id = a.id
    where p.status = 'paid' and a.platform = 'tiktok' group by a.handle, a.platform limit 1`
  assert(paid, "the seed should contain an account with paid videos")
  const before = await sql`select count(*)::int n from posts p join accounts a on a.id = p.account_id where a.handle = ${paid.handle} and a.platform = 'tiktok'`
  await page.goto(`${base}/accounts`)
  await page.getByRole("button", { name: `Edit @${paid.handle} on TikTok`, exact: true }).click()
  await page.getByRole("button", { name: "Delete account…" }).click()
  await confirmDelete(`@${paid.handle}`)
  await page.getByText(/are part of a payout, so it cannot be deleted/).waitFor()
  const after = await sql`select count(*)::int n from posts p join accounts a on a.id = p.account_id where a.handle = ${paid.handle} and a.platform = 'tiktok'`
  assert(after[0].n === before[0].n && after[0].n > 0, "videos of a paid account must be untouched")
})

await step("the wrong name keeps the delete button disabled", async () => {
  await page.goto(`${base}/accounts`)
  await page.getByRole("button", { name: `Edit @${handle} on TikTok`, exact: true }).click()
  await page.getByRole("button", { name: "Delete account…" }).click()
  const dialog = page.getByRole("dialog").last()
  await dialog.getByText("its 3 videos").waitFor()
  await dialog.getByRole("textbox").fill("@something-else")
  assert(await dialog.getByRole("button", { name: "Delete permanently" }).isDisabled(), "must stay disabled")
})

await step("deleting a test account removes its videos, view history and stored thumbnail", async () => {
  const dialog = page.getByRole("dialog").last()
  await dialog.getByRole("textbox").fill(`@${handle}`)
  await dialog.getByRole("button", { name: "Delete permanently" }).click()
  await page.getByText(`@${handle} deleted`).waitFor()
  const [left] = await sql`
    select (select count(*)::int from accounts where id = ${account.id}) accounts,
           (select count(*)::int from posts where id in ${sql(postIds)}) posts,
           (select count(*)::int from post_snapshots where post_id in ${sql(postIds)}) snapshots`
  assert(left.accounts === 0 && left.posts === 0 && left.snapshots === 0, JSON.stringify(left))
  const { data } = await supabase.storage.from("thumbnails").list("posts/tiktok", { search: `e2e-${stamp}` })
  assert((data ?? []).length === 0, "the thumbnail should be gone from Storage")
  const [log] = await sql`select after from audit_log where action = 'account.delete' and entity_id = ${account.id}`
  assert(log?.after?.deletedVideos === 3, `audit entry missing or wrong: ${JSON.stringify(log)}`)
})

await step("a campaign with payouts refuses to be deleted", async () => {
  const [used] = await sql`select c.id, c.name from campaigns c join payout_cycles pc on pc.campaign_id = c.id limit 1`
  await page.goto(`${base}/campaigns/${used.id}`)
  await page.getByRole("button", { name: "Delete campaign…" }).click()
  await confirmDelete(used.name)
  await page.getByText(/This campaign has videos or payouts/).waitFor()
  const [still] = await sql`select count(*)::int n from campaigns where id = ${used.id}`
  assert(still.n === 1, "campaign must still exist")
})

await step("an empty test campaign can be deleted", async () => {
  await page.goto(`${base}/campaigns/new`)
  await page.getByLabel("Name").fill(campaignName)
  await page.getByRole("button", { name: "Create campaign" }).click()
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/)
  await page.getByRole("button", { name: "Delete campaign…" }).click()
  await confirmDelete(campaignName)
  await page.waitForURL(`${base}/campaigns`)
  const [gone] = await sql`select count(*)::int n from campaigns where name = ${campaignName}`
  assert(gone.n === 0, "campaign should be gone")
})

await step("a creator with videos refuses, an empty test creator can be deleted", async () => {
  const [busy] = await sql`select c.id, c.name from creators c join posts p on p.creator_id = c.id group by c.id, c.name limit 1`
  await page.goto(`${base}/creators/${busy.id}`)
  await page.getByRole("button", { name: /Edit/ }).first().click()
  await page.getByRole("button", { name: "Delete creator…" }).click()
  await confirmDelete(busy.name)
  await page.getByText(/This creator has videos or payouts/).waitFor()

  const [fresh] = await sql`insert into creators (name) values (${creatorName}) returning id`
  await page.goto(`${base}/creators/${fresh.id}`)
  await page.getByRole("button", { name: /Edit/ }).first().click()
  await page.getByRole("button", { name: "Delete creator…" }).click()
  await confirmDelete(creatorName)
  await page.waitForURL(`${base}/creators`)
  const [gone] = await sql`select count(*)::int n from creators where id = ${fresh.id}`
  assert(gone.n === 0, "creator should be gone")
})

await browser.close()
await sql.end()
console.log(results.join("\n"))
console.log(problems.length ? `\nBrowser problems:\n${problems.join("\n")}` : "\nNo browser errors.")
process.exit(results.some((r) => r.startsWith("FAIL")) || problems.length ? 1 : 0)
