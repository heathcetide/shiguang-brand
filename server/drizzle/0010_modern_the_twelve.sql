CREATE TABLE "plan_maintenance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"source_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "plan_maintenance_events_user_id_event_type_source_id_key" UNIQUE("user_id","event_type","source_id")
);
--> statement-breakpoint
ALTER TABLE "plan_maintenance_events" ADD CONSTRAINT "plan_maintenance_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plan_maintenance_events_pending" ON "plan_maintenance_events" USING btree ("processed_at","user_id","created_at","id");