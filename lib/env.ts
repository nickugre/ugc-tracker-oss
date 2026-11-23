import { z } from "zod"

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url().default("http://localhost:3000"),
  CRON_SECRET: z.string().min(16),

  APIFY_TOKEN: optional,
  APIFY_WEBHOOK_SECRET: optional,
  APIFY_TIKTOK_ACTOR: z.string().default("clockworks/tiktok-scraper"),
  APIFY_INSTAGRAM_ACTOR: z.string().default("apify/instagram-reel-scraper"),
  APIFY_TIKTOK_COMMENTS_ACTOR: z.string().default("clockworks/tiktok-comments-scraper"),
  APIFY_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(5),

  TIKTOK_ADS_ACCESS_TOKEN: optional,
  // Comma-separated advertiser ids.
  TIKTOK_ADS_ADVERTISER_IDS: optional,
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

// Parsed lazily so that `next build` can import server modules without the runtime env present.
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      throw new Error(`Invalid environment variables:\n  ${problems.join("\n  ")}`)
    }
    cached = parsed.data
  }
  return cached
}
