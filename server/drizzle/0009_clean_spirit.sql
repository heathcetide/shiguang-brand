CREATE TABLE "plan_maintenance_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"time_zone" text,
	"local_time" text,
	"next_check_at" timestamp with time zone,
	"next_local_date" text,
	"last_completed_local_date" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_maintenance_settings_check_1" CHECK (NOT enabled OR (time_zone IS NOT NULL AND local_time IS NOT NULL AND next_check_at IS NOT NULL AND next_local_date IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "plan_maintenance_settings" ADD CONSTRAINT "plan_maintenance_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plan_maintenance_due" ON "plan_maintenance_settings" USING btree ("enabled","next_check_at");