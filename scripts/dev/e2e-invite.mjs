// Dev helper: proves the invite and sign-in links end to end against the LOCAL stack, including
// the two cases that only show up in production: a link preview bot opening the link first, and
// the invite email failing to send (simulated by stopping the local mail container).
//   node --env-file=.env.local scripts/dev/e2e-invite.mjs <admin-email> <admin-password>
import { execFileSync } from "node:child_process"

import { chromium } from "playwright-core"

const [email, password] = process.argv.slice(2)
const base = process.env.APP_URL ?? "http://localhost:3000"
const mail = "http://127.0.0.1:54324"
const mailContainer = "supabase_inbucket_ugc-tracker"
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

const browser = await chromium.launch({ channel: "chrome", headless: true })
const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
admin.setDefaultTimeout(15_000)

const stamp = Date.now().toString(36)
const invitee = `e2e-mail-${stamp}@example.com`
const inviteeNoMail = `e2e-link-${stamp}@example.com`
// Every redemption sets a different password: Supabase rejects one identical to the current.
let passwordCounter = 0
const nextPassword = () => `pw-${stamp}-${++passwordCounter}-Aa`

// Walks a one-time link like a person would: open, press Continue, choose a password.
async function redeem(link, { expectInvalid = false } = {}) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  try {
    await page.goto(link)
    await page.getByRole("button", { name: "Continue" }).click()
    if (expectInvalid) {
      await page.getByText("This link is no longer valid.").waitFor()
      return
    }
    await page.waitForURL(`${base}/set-password`)
    const newPassword = nextPassword()
    await page.getByLabel("New password").fill(newPassword)
    await page.getByLabel("Repeat password").fill(newPassword)
    await page.getByRole("button", { name: "Save password" }).click()
    await page.waitForURL(`${base}/`)
    await page.getByText("Views → payouts").waitFor()
  } finally {
    await context.close()
  }
}

await step("admin signs in and opens Settings", async () => {
  await admin.goto(`${base}/login`)
  await admin.getByLabel("Email").fill(email)
  await admin.getByLabel("Password").fill(password)
  await admin.getByRole("button", { name: "Sign in" }).click()
  await admin.waitForURL(`${base}/`)
  await admin.goto(`${base}/settings`)
  await admin.getByRole("heading", { name: "Team" }).waitFor()
})

let emailedLink = ""
await step("invite by email: the email arrives with a link to /auth/confirm", async () => {
  await admin.getByLabel("Email").fill(invitee)
  await admin.getByRole("button", { name: "Send invite" }).click()
  await admin.getByText(`Invite sent to ${invitee}`).waitFor()
  for (let attempt = 0; attempt < 20 && !emailedLink; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const list = await (await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${invitee}`)}`)).json()
    const id = list.messages?.[0]?.ID
    if (!id) continue
    const message = await (await fetch(`${mail}/api/v1/message/${id}`)).json()
    emailedLink = (message.HTML.match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1] ?? "").replaceAll("&amp;", "&")
  }
  assert(emailedLink.startsWith(`${base}/auth/confirm?token_hash=`), `no confirm link in the email: ${emailedLink}`)
})

await step("a preview bot opening the link does not use it up", async () => {
  // What Slack, WhatsApp or a mail scanner does: a plain GET, no clicks.
  const response = await fetch(emailedLink, { redirect: "manual" })
  assert(response.status === 200, `expected the confirm page, got ${response.status}`)
  const html = await response.text()
  assert(html.includes("Continue"), "confirm page did not render the Continue button")
})

await step("the invited person continues, sets a password and lands in the app", async () => {
  await redeem(emailedLink)
})

await step("the same link cannot be used twice", async () => {
  await redeem(emailedLink, { expectInvalid: true })
})

let fallbackLink = ""
await step("invite when email cannot be sent: the link is shown to the inviter instead", async () => {
  execFileSync("docker", ["stop", mailContainer], { stdio: "ignore" })
  try {
    await admin.getByLabel("Email").fill(inviteeNoMail)
    await admin.getByRole("button", { name: "Send invite" }).click()
    await admin.getByText(`Send this link to ${inviteeNoMail}`).waitFor({ timeout: 30_000 })
    await admin.getByText("The invite email could not be sent").waitFor()
    fallbackLink = await admin.getByLabel("One-time link").inputValue()
    assert(fallbackLink.includes("/auth/confirm?token_hash=") && fallbackLink.includes("type=invite"), fallbackLink)
    await admin.getByRole("button", { name: "Done" }).click()
    await admin.getByRole("cell", { name: inviteeNoMail }).waitFor()
  } finally {
    execFileSync("docker", ["start", mailContainer], { stdio: "ignore" })
  }
})

await step("the handed-over invite link works", async () => {
  assert(fallbackLink, "no link from the previous step")
  await redeem(fallbackLink)
})

await step("Sign-in link for an existing teammate works (forgotten password without email)", async () => {
  await admin.goto(`${base}/settings`)
  const row = admin.getByRole("row", { name: new RegExp(invitee) })
  await row.getByRole("button", { name: "Sign-in link" }).click()
  await admin.getByText(`Send this link to ${invitee}`).waitFor()
  const link = await admin.getByLabel("One-time link").inputValue()
  assert(link.includes("type=recovery"), link)
  await admin.getByRole("button", { name: "Done" }).click()
  await redeem(link)
})

await step("a link in Supabase's default email format (session in the URL fragment) works too", async () => {
  // Hosted Free-plan projects cannot use custom email templates, so their emails carry this kind
  // of link: Supabase verifies it and redirects to /auth/confirm#access_token=…
  const { createClient } = await import("@supabase/supabase-js")
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: invitee,
    options: { redirectTo: `${base}/auth/confirm?next=/set-password` },
  })
  assert(!error, error?.message)
  assert(data.properties.action_link.includes("/auth/v1/verify"), data.properties.action_link)
  await redeem(data.properties.action_link)
})

await step("an expired default-format link says so", async () => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${base}/auth/confirm?next=/set-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`)
  await page.getByText("This link is no longer valid").waitFor()
  await context.close()
})

await step("an incomplete link explains itself instead of failing", async () => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${base}/auth/confirm`)
  await page.getByText("This link is not complete").waitFor()
  await context.close()
})

await step("clean up: remove the two test people's access", async () => {
  await admin.goto(`${base}/settings`)
  for (const address of [invitee, inviteeNoMail]) {
    const row = admin.getByRole("row", { name: new RegExp(address) })
    await row.getByRole("switch", { name: "Has access" }).click()
    await row.getByRole("button", { name: "Sign-in link" }).and(admin.locator(":disabled")).waitFor()
  }
})

await browser.close()
console.log(results.join("\n"))
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0)
