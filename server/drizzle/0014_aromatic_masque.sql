CREATE TABLE "household_meal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"meal_id" text NOT NULL,
	"user_id" integer,
	"membership_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"servings" double precision NOT NULL,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"diet_record_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_meal_events_user_id_idempotency_key_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "household_meal_events_check_1" CHECK (servings > 0)
);
--> statement-breakpoint
ALTER TABLE "household_meal_events" ADD CONSTRAINT "household_meal_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_meal_events" ADD CONSTRAINT "household_meal_events_meal_id_household_meal_batches_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."household_meal_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_meal_events" ADD CONSTRAINT "household_meal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_meal_events" ADD CONSTRAINT "household_meal_events_diet_record_id_diet_records_id_fk" FOREIGN KEY ("diet_record_id") REFERENCES "public"."diet_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_household_meal_events_diet" ON "household_meal_events" USING btree ("diet_record_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_household_meal_events_meal" ON "household_meal_events" USING btree ("meal_id","created_at");