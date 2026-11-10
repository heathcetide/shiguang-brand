CREATE TABLE "plan_maintenance_job_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_maintenance_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"rule_version" text NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_maintenance_jobs_check_1" CHECK (status IN ('queued','running','completed','failed'))
);
--> statement-breakpoint
ALTER TABLE "plan_maintenance_job_events" ADD CONSTRAINT "plan_maintenance_job_events_event_id_plan_maintenance_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."plan_maintenance_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_maintenance_job_events" ADD CONSTRAINT "plan_maintenance_job_events_job_id_plan_maintenance_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."plan_maintenance_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_maintenance_jobs" ADD CONSTRAINT "plan_maintenance_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plan_maintenance_job_events_job" ON "plan_maintenance_job_events" USING btree ("job_id","event_id");--> statement-breakpoint
CREATE INDEX "idx_plan_maintenance_jobs_due" ON "plan_maintenance_jobs" USING btree ("status","available_at","lease_expires_at");