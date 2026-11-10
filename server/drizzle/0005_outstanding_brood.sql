CREATE TABLE "prepared_meal_intake_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"event_id" text NOT NULL,
	"original_diet_record_id" integer NOT NULL,
	"mode" text NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepared_meal_intake_corrections_event_id_key" UNIQUE("event_id"),
	CONSTRAINT "prepared_meal_intake_corrections_user_id_original_diet_record_id_key" UNIQUE("user_id","original_diet_record_id"),
	CONSTRAINT "prepared_meal_intake_corrections_check_1" CHECK (mode IN ('undo_eating','delete_intake'))
);
--> statement-breakpoint
ALTER TABLE "prepared_meal_intake_corrections" ADD CONSTRAINT "prepared_meal_intake_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meal_intake_corrections" ADD CONSTRAINT "prepared_meal_intake_corrections_event_id_prepared_meal_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."prepared_meal_events"("id") ON DELETE cascade ON UPDATE no action;