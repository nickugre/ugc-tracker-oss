ALTER TYPE "public"."scrape_kind" ADD VALUE 'backfill';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "backfill_pending" boolean DEFAULT true NOT NULL;