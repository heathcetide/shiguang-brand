CREATE TABLE "household_meal_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"created_by_user_id" integer,
	"membership_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"food_name" text NOT NULL,
	"produced_servings" double precision NOT NULL,
	"remaining_servings" double precision NOT NULL,
	"inventory_json" jsonb NOT NULL,
	"nutrition_per_serving_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_meal_batches_household_id_idempotency_key_key" UNIQUE("household_id","idempotency_key"),
	CONSTRAINT "household_meal_batches_check_1" CHECK (produced_servings > 0),
	CONSTRAINT "household_meal_batches_check_2" CHECK (remaining_servings >= 0 AND remaining_servings <= produced_servings)
);
--> statement-breakpoint
ALTER TABLE "household_meal_batches" ADD CONSTRAINT "household_meal_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_meal_batches" ADD CONSTRAINT "household_meal_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_household_meal_batches_household" ON "household_meal_batches" USING btree ("household_id","created_at","id");