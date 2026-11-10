CREATE TABLE "proactive_intervention_scan_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"after_user_id" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proactive_intervention_scan_cursor_check_1" CHECK (name='opportunities'),
	CONSTRAINT "proactive_intervention_scan_cursor_check_2" CHECK (after_user_id>=0)
);
