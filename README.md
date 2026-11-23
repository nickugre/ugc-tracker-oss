# UGC Tracker

A self-hosted tool for running a UGC creator program: it tracks the videos your creators post on TikTok and Instagram, counts the views each video gets inside its pay window, and works out what you owe each creator.

**track accounts → ingest videos (Apify) → snapshot views inside each video's window → lock views at window close → compute cycle payouts → mark paid.**

You run your own copy, on your own accounts. Your creators, view counts and payouts live in your own database and nobody else can see them, including the authors of this project.

Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui (Base UI) · Supabase (Postgres + Auth + Storage) · Drizzle · Apify · TikTok Marketing API.

> **No warranty.** This tool calculates money you pay to people. Check its numbers against your own contracts before you rely on them. See [LICENSE](LICENSE).

## What you need

| Account | What it is for | Cost to start |
|---|---|---|
| [GitHub](https://github.com) | Holds your copy of the code | Free |
| [Supabase](https://supabase.com) | The database, sign-in and thumbnail storage | Free plan works |
| [Vercel](https://vercel.com) | Runs the app on the internet | Free for personal use, Pro for a company |
| [Apify](https://apify.com) | Reads public view counts from TikTok and Instagram | $5 of free usage a month, then about $6 per creator per month |

On your computer: [Node.js](https://nodejs.org) 20 or newer, [pnpm](https://pnpm.io/installation), [git](https://git-scm.com) and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

## Set up your own copy

Allow about an hour the first time. Every command is typed in a terminal, inside the project folder.

### 1. Get the code

On this repository's GitHub page press **Use this template → Create a new repository**, name it, and choose **Private**. That gives you your own copy. Then download it:

```bash
git clone https://github.com/YOUR-USERNAME/ugc-tracker-oss.git
cd ugc-tracker-oss
pnpm install
```

### 2. Create the database

1. On supabase.com create a new project. Choose a strong database password and save it in a password manager.
2. Copy the project's **reference id** (Project Settings → General; 20 letters).
3. Create the tables:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push          # lists the migrations and asks before applying them
```

### 3. Write down your settings

Copy the template to a file named `.env.hosted`. Git ignores this file; it must never be committed or shared.

```bash
cp .env.example .env.hosted
```

Fill it in:

| Setting | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API (`https://YOUR-PROJECT-REF.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → publishable key |
| `SUPABASE_SECRET_KEY` | Same page → secret key. Full access to your database: treat it like a password |
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler** (port 6543), with your database password in it |
| `DATABASE_URL_SESSION` | Same dialog → **Session pooler** (port 5432). Add this line yourself; setup scripts use it |
| `APP_URL` | Your app's public address from step 4, for example `https://your-app.vercel.app` |
| `CRON_SECRET` | Make one up: run `openssl rand -hex 24` and paste the result |
| `APIFY_TOKEN` | Apify → Settings → API & Integrations |
| `APIFY_WEBHOOK_SECRET` | Run `openssl rand -hex 24` again and paste the second result |
| `APIFY_MONTHLY_BUDGET_USD` | The most the app may spend on Apify per month. Scraping pauses at this limit |

The two TikTok Ads settings are optional. Leave them empty unless you run Spark Ads and want paid views subtracted automatically.

### 4. Put the app online

1. On vercel.com choose **Add New → Project** and import your new repository.
2. Under **Environment Variables** add every line of `.env.hosted` except `DATABASE_URL_SESSION`, for the **Production** environment only. That way preview builds of other branches cannot reach your real database.
3. In Project Settings → Functions, pick the region closest to your Supabase project.
4. Deploy. Vercel shows the app's address. If it differs from the `APP_URL` you entered, correct `APP_URL` in Vercel and in `.env.hosted`, then redeploy.
5. Keep Deployment Protection on **Standard Protection**: the production address has to be reachable by your team, by the scheduler and by Apify.

### 5. Lock down sign-in

The app is invite-only. In Supabase → Authentication:

1. **Sign In / Providers:** turn off **Allow new users to sign up**.
2. **URL Configuration:** set **Site URL** to your `APP_URL` and add `YOUR-APP-URL/**` to the redirect URLs.
3. **Sign In / Providers → Email:** set **Email OTP Expiration** to `86400` seconds, so invite links last a day and not an hour.

(Alternatively, put your project ref and URL into the `[remotes.production]` block at the end of `supabase/config.toml` and run `supabase config push`. On the Supabase Free plan without custom SMTP, first remove the two `[auth.email.template.*]` tables from the file, or the push is rejected.)

### 6. Create your login and start the scheduler

```bash
pnpm user:create:hosted you@example.com 'a-strong-password' "Your Name"
pnpm cron:install
```

`cron:install` stores the app URL and `CRON_SECRET` in Supabase Vault, creates the scheduled jobs (daily sync at 06:00 UTC, an hourly job that locks finished view windows, a daily TikTok Ads sync) and makes one real call to prove the database can reach the app. Run it again whenever you change the URL or the secret. Results appear in Settings → Scheduled jobs.

### 7. First steps in the app

1. Open your app's address and sign in.
2. **Settings → Spark suggestions:** add your brand name and the ways people misspell it to the keyword list.
3. **Campaigns → New:** enter your own contract terms. The pre-filled numbers are only an example.
4. Add your creators and their TikTok / Instagram accounts, then press **Scrape now**.
5. Invite teammates from **Settings → Team**.

## Keeping it safe

- **Everyone you invite sees everything.** There is one shared workspace: every signed-in person can see and edit all creators and payouts. Invite only your own team. To share the tool with another company, give them this repository so they can set up their own copy.
- **Never commit or share `.env.hosted` or `.env.local`.** `SUPABASE_SECRET_KEY` and `DATABASE_URL` give full access to your data. If one leaks (pasted in a chat, shown in a screenshot), create a new key or database password in Supabase and update Vercel.
- **Keep sign-ups off** (step 5). A stranger who signs up still cannot get in, because the app also requires a team profile that only an invite creates, but there is no reason to leave the door open.
- **Tables are closed to the public API.** Row Level Security is on for every table with no policies, so the publishable key cannot read or write them. The app talks to the database from the server only. Keep it that way when you add tables.
- **Thumbnails are public.** Video cover images are stored in a public bucket. They are covers of public videos; do not upload anything private there.
- **Back up before you depend on it.** The Supabase Free plan has no backups and pauses a project after a week without activity. Move to Pro before the database is the only record of what you owe people.
- **Set a budget.** `APIFY_MONTHLY_BUDGET_USD` caps what the app spends on scraping. Also set a spending limit in Apify itself.

## Running it

- **Updates:** a `git push` to your repository's `main` branch makes Vercel build and release the new version in about a minute.
- **Database changes:** edit `db/schema/*`, run `pnpm db:generate`, try it locally, then `supabase db push`.
- **Invites:** Supabase's built-in mailer only delivers to members of your Supabase organization (and a few emails per hour), so for everyone else the app shows a one-time link to pass on by chat. "Sign-in link" in the same table does the job of a password-reset email. Links work once, last 24 hours, and are only redeemed when the person presses Continue, so chat previews cannot use them up. Anyone signed in can change their password at `/set-password`.
- **Real emails (optional):** add custom SMTP (for example Resend) under Supabase → Authentication → Emails. After that `supabase config push` also applies the two templates in `supabase/templates/`.
- **Costs.** Supabase Free: 500 MB database (a snapshot row is about 0.3 KB, so that is years) and 1 GB storage (about 16,000 thumbnails). Vercel Hobby is for non-commercial use; a company tool belongs on Pro. Apify Free is capped at $5 a month; expect about **$6 per creator per month** (2 posts a day on TikTok + Instagram, 14-day window) and raise `APIFY_MONTHLY_BUDGET_USD` to match. At the limit the daily sync and comment reading pause. Only the daily sync scrapes routinely; the hourly job scrapes a single video when the daily sync missed it at its window end, and everything else is a button (Scrape now, Read comments now).
- **TikTok Ads (optional):** set `TIKTOK_ADS_ACCESS_TOKEN` and `TIKTOK_ADS_ADVERTISER_IDS` (comma-separated) in Vercel to subtract Spark views automatically.

## Developing locally

You need a Docker runtime (Docker Desktop, Colima or similar) in addition to the tools above.

```bash
supabase start               # local Postgres, Auth, Storage, mail inbox
pnpm install
cp .env.example .env.local   # then fill it in: `supabase status -o env` prints the URL and keys
pnpm db:migrate              # apply the SQL in supabase/migrations
pnpm db:seed                 # demo data: 2 campaigns, 8 creators, ~180 videos, a paid cycle
pnpm user:create you@example.com 'a-strong-password' "Your Name"
pnpm dev                     # http://localhost:3000
```

Local URLs: app `localhost:3000` · Supabase Studio `localhost:54323` · invite / reset emails `localhost:54324`.

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` | Dev server / production build |
| `pnpm dev:hosted` | Dev server on the **production** database and sign-in (reads `.env.hosted`). Everything you change or delete is real. `APP_URL` stays `localhost`, so Apify webhooks stay off and a scrape is collected by the page that started it: keep it open. Stop `pnpm dev` first, only one dev server can run at a time |
| `pnpm test` | Unit tests: payout engine, lock maths, cycles, money, scrape planning (286 tests) |
| `pnpm lint` / `pnpm typecheck` | ESLint / route types + `tsc` |
| `pnpm db:generate` | After editing `db/schema/*`: write a new SQL migration |
| `pnpm db:migrate` / `pnpm db:reset` | Apply new migrations / rebuild the local database from scratch |
| `pnpm db:seed` | Replace all data with demo data (refuses non-local databases) |
| `pnpm user:create <email> <password> [name]` | Create the first login (the app is invite-only) |
| `pnpm job <daily-sync \| window-close \| tiktok-ads-sync \| comment-sync>` | Run a scheduled job once (`comment-sync` is the last step of `daily-sync`, on its own for trying it out) |
| `pnpm user:create:hosted <email> <password> [name]` | The same, against production (reads `.env.hosted`) |
| `pnpm cron:install` | Install or update the scheduler in the production database, then test it |
| `node scripts/dev/e2e-prod-check.mjs <url> <email> <password>` | Read-only check of a deployed instance: signs in and opens every page |
| `node --env-file=.env.local scripts/dev/e2e-invite.mjs <email> <password>` | Browser test of invite and sign-in links (local stack) |
| `pnpm exec tsx --conditions=react-server --env-file=.env.hosted scripts/dev/data-check.ts` | Read-only audit of production: every stored video against the Apify dataset it came from (views, likes, dates, account, campaign, window), plus what the payout engine makes of the current cycle |
| `node --env-file=.env.local scripts/dev/e2e-lists.mjs <email> <password>` | Read-only browser check that the counts on the Creators and Campaigns lists match the database |
| `node --env-file=.env.local scripts/dev/e2e-calendar.mjs <email> <password>` | Browser check that every Calendar cell and "Posted" total matches the database, with one creator moved to another time zone and back (local only) |
| `node --env-file=.env.local scripts/dev/e2e-video-filters.mjs <email> <password>` | Read-only browser check that the Videos date and metric filters (URL and popovers) return the same totals as the database |
| `node --env-file=.env.local scripts/dev/e2e-smoke.mjs <email> <password>` | Browser test of the main flows (uses installed Chrome). Run `pnpm db:seed` first: it pays the seeded cycle, so it passes once per seed |
| `node --env-file=.env.local scripts/dev/e2e-delete.mjs <email> <password>` | Browser test of deleting: test data goes, anything in a payout refuses (local only) |
| `pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/dev/e2e-comments.ts <tiktok video url>` | Reads one real video's comments through Apify and shows which ones count as "about the app" (local only, costs up to ~4¢) |


## How the money works

- **View window.** Organic views count for `window days` (default 14) from `posted_at`. The window can be overridden per video (e.g. 30 days) while the video is still open.
- **Lock.** The daily sync after the window has ended brings one more view count, and the hourly job **interpolates to the exact end time** between the snapshots before and after it (at most a day apart). If a daily sync passes without the video, the hourly job scrapes that video on its own so it still locks on time. Only when that finds nothing either (deleted, private) is it locked from its last count and flagged for review. Raw snapshots are kept forever as evidence. A lock can be undone until the video is part of a payout.
- **Paid views.** `payable = locked − paid views inside the window`. Paid views come from the TikTok Ads sync (Spark Ads, matched by `tiktok_item_id`) or are typed in on the video (Promote, other platforms). A manual number always wins.
- **Base pay** counts videos *published* in the cycle, pro-rated against the quota. With a per-platform quota, extra posts on one platform do not make up for a shortfall on another.
- **Bonuses** count videos whose *window closed* by the end of the cycle, that are locked, not excluded and not flagged. Videos still in their window roll to a later cycle. Every video in a finalized cycle is settled, so it can never be paid twice (the database enforces this with a unique index).
- **Milestones** default to *best single video per creator per cycle, highest tier only* (non-stacking). Campaign-lifetime and per-video (stacking) are selectable per campaign, as are CPM and hybrid.
- **Cycle states.** Live preview → Finalized (amounts frozen, can be reopened) → Paid (immutable). Preview and finalize run the same engine (`lib/payouts/engine.ts`).
- Every lock, exclusion, adjustment and payout is written to an append-only audit log with the person who did it.
- **Deleting** is for mistakes and test data. An account can be deleted together with its videos, view history and thumbnails (Accounts → pencil → Delete account…); creators and campaigns only while they have no videos or payouts. Anything that is part of a payout can never be deleted: the app refuses and the database blocks it (`ON DELETE RESTRICT`). To stop scraping without deleting, turn tracking off.

## Spark suggestions

The Spark page lists TikTok videos worth boosting: 1,000+ views and either 10%+ engagement or at least one comment about the app ("what app is this?", "link?", "downloaded it"). Videos already boosted are left out. "Copy video links" copies the ticked videos (or all listed), grouped by creator, ready to send when asking for spark codes.

- **Comments are read automatically, within a budget.** The daily sync reads the top 30 comments of at most 10 promising videos a day (`clockworks/tiktok-comments-scraper`, ~0.125¢ per comment, so ~4¢ per video) and re-reads a video once its comment count has doubled. It stops at the monthly comment budget (default $1.50) and at the overall Apify budget. "Read comments now" on a video skips both limits.
- **"About the app" is a keyword list** (Settings → Spark suggestions), matched on whole words, ignoring case and punctuation, and applied when the page is shown, so editing it takes effect immediately. The creator's own comments are ignored.

## Where things live

```
app/(app)/…            pages: Overview, Videos, Spark, Calendar, Payouts, Creators, Accounts, Campaigns, Settings
app/api/cron/*         scheduled jobs (Bearer CRON_SECRET) · app/api/webhooks/apify · app/api/scrape-runs/[id]
db/schema/*            Drizzle schema = source of truth → supabase/migrations/*.sql
lib/payouts/*          pure payout engine, cycles, rules (+ service.ts: preview / finalize / mark paid)
lib/windows/*          window + lock maths (pure) · lib/money/cents.ts
lib/scrapers/*         one adapter per platform (TikTok, Instagram live; others stubbed)
lib/ingest/*           start a run, idempotent ingestion, thumbnails · lib/jobs/* the three jobs
lib/actions/*          Server Actions (each checks the session and writes the audit log)
lib/queries/*          read queries · lib/search-params/* URL filter state
lib/spark/*            which videos are worth sparking: keyword matching + ranking (pure) · settings
```

## Known limits

- **TikTok counts are rounded by the scraper** above 10,000 (e.g. `169,800`), in both profile and per-video mode; Instagram counts are exact. Below one million the error is at most ±50 views, which only matters within a hair of a milestone. Above one million TikTok shows two digits (`1.2M`), which is coarse for CPM campaigns. A different actor, or TikTok's official API for brand-owned accounts, can be swapped in behind `lib/scrapers/tiktok.ts`.
- Instagram does not expose saves, and shares are a paid Apify add-on that the daily sync does not buy, so Instagram engagement leaves out shares. Follower counts are not part of reel results.
- YouTube, Facebook and Snapchat can be selected in a campaign but are not scraped yet.
- In-app TikTok Promote is not linked to a post in the Ads API, so its paid views are entered by hand.
- Apify adds up a run's charges a little after the run ends. A fresh run can show only its start fee ($0.001) in Settings; the hourly job corrects the cost within the hour.

## License

[MIT](LICENSE). Free to use and change, with no warranty.
