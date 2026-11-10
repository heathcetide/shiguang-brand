CREATE TABLE "meal_plan_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"plan_id" text NOT NULL,
	"item_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"before_version" integer NOT NULL,
	"after_version" integer,
	"before_json" jsonb NOT NULL,
	"after_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "meal_plan_changes_user_id_fingerprint_key" UNIQUE("user_id","fingerprint"),
	CONSTRAINT "meal_plan_changes_check_1" CHECK (status IN ('pending','applied','rejected','blocked','reverted','conflict'))
);
--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meal_plan_changes" ADD CONSTRAINT "meal_plan_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_changes" ADD CONSTRAINT "meal_plan_changes_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_changes" ADD CONSTRAINT "meal_plan_changes_item_id_meal_plan_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."meal_plan_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_meal_plan_changes_plan" ON "meal_plan_changes" USING btree ("user_id","plan_id","created_at");
--> statement-breakpoint
UPDATE meal_plan_items SET confirmed_at=created_at WHERE plan_id IN (SELECT id FROM meal_plans WHERE status='active');
