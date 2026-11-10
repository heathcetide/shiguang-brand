ALTER TABLE "household_shopping_items" ADD COLUMN "source_plan_item_id" text;--> statement-breakpoint
ALTER TABLE "household_shopping_items" ADD COLUMN "source_demand_key" text;--> statement-breakpoint
ALTER TABLE "household_shopping_items" ADD COLUMN "source_generated_version" integer;--> statement-breakpoint
ALTER TABLE "household_shopping_items" ADD CONSTRAINT "household_shopping_items_source_plan_item_id_meal_plan_items_id_fk" FOREIGN KEY ("source_plan_item_id") REFERENCES "public"."meal_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_household_shopping_plan_demand" ON "household_shopping_items" USING btree ("source_plan_item_id","source_demand_key") WHERE source_plan_item_id IS NOT NULL;