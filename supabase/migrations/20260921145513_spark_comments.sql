ALTER TYPE "public"."scrape_kind" ADD VALUE 'comments';--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "post_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"post_id" uuid NOT NULL,
	"platform_comment_id" text NOT NULL,
	"text" text NOT NULL,
	"author_handle" text,
	"likes" bigint,
	"replies" integer,
	"posted_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"source_run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "post_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spark_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"keywords" text[] NOT NULL,
	"min_engagement" double precision NOT NULL,
	"min_views" integer NOT NULL,
	"min_app_comments" integer NOT NULL,
	"comments_budget_usd" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "spark_settings_single_row" CHECK ("spark_settings"."id")
);
--> statement-breakpoint
ALTER TABLE "spark_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "comments_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "comments_checked_count" bigint;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "comments_checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_source_run_id_scrape_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_comments_post_comment_uq" ON "post_comments" USING btree ("post_id","platform_comment_id");--> statement-breakpoint
CREATE INDEX "post_comments_post_idx" ON "post_comments" USING btree ("post_id");