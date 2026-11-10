CREATE TABLE "prepared_meal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"prepared_meal_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_type" text NOT NULL,
	"servings" double precision,
	"recorded_at" text NOT NULL,
	"diet_record_id" integer,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepared_meal_events_user_id_idempotency_key_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "prepared_meal_events_check_1" CHECK (event_type IN ('eat','discard','reschedule'))
);
--> statement-breakpoint
CREATE TABLE "prepared_meals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"recipe_id" integer,
	"food_name" text NOT NULL,
	"produced_servings" double precision NOT NULL,
	"remaining_servings" double precision NOT NULL,
	"nutrition_per_serving_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planned_date" text,
	"meal_type" text DEFAULT '' NOT NULL,
	"storage_location" text,
	"queue_item_id" text,
	"plan_item_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"produced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "prepared_meals_user_id_plan_item_id_key" UNIQUE("user_id","plan_item_id"),
	CONSTRAINT "prepared_meals_user_id_queue_item_id_key" UNIQUE("user_id","queue_item_id"),
	CONSTRAINT "prepared_meals_user_id_idempotency_key_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "prepared_meals_check_1" CHECK (produced_servings > 0),
	CONSTRAINT "prepared_meals_check_2" CHECK (remaining_servings >= 0 AND remaining_servings <= produced_servings)
);
--> statement-breakpoint
ALTER TABLE "prepared_meal_events" ADD CONSTRAINT "prepared_meal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meal_events" ADD CONSTRAINT "prepared_meal_events_prepared_meal_id_prepared_meals_id_fk" FOREIGN KEY ("prepared_meal_id") REFERENCES "public"."prepared_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meal_events" ADD CONSTRAINT "prepared_meal_events_diet_record_id_diet_records_id_fk" FOREIGN KEY ("diet_record_id") REFERENCES "public"."diet_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meals" ADD CONSTRAINT "prepared_meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meals" ADD CONSTRAINT "prepared_meals_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meals" ADD CONSTRAINT "prepared_meals_queue_item_id_cooking_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."cooking_queue_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meals" ADD CONSTRAINT "prepared_meals_plan_item_id_meal_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."meal_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prepared_meal_events_meal" ON "prepared_meal_events" USING btree ("prepared_meal_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prepared_meals_user_remaining" ON "prepared_meals" USING btree ("user_id","remaining_servings");