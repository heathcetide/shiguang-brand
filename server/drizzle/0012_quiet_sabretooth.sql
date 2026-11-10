ALTER TABLE "household_members" ADD COLUMN "dining_shared" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "household_members" ADD COLUMN "dining_preferences_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "household_members" ADD COLUMN "dining_version" integer DEFAULT 1 NOT NULL;