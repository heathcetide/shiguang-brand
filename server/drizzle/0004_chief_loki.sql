DROP INDEX "idx_cooking_queue_active_recipe";--> statement-breakpoint
ALTER TABLE "cooking_queue_items" ADD COLUMN "source_plan_item_id" text;--> statement-breakpoint
UPDATE cooking_queue_items q SET source_plan_item_id = (
  SELECT MIN(i.id) FROM meal_plan_items i WHERE i.queue_item_id=q.id AND i.user_id=q.user_id
    AND i.deleted_at IS NULL AND i.status='queued')
  WHERE q.deleted_at IS NULL AND q.status IN ('waiting','preparing','ready','cooking');--> statement-breakpoint
UPDATE meal_plan_items i SET queue_item_id=NULL, status='planned', version=version+1, updated_at=CURRENT_TIMESTAMP
  WHERE i.deleted_at IS NULL AND i.status='queued' AND EXISTS (
    SELECT 1 FROM cooking_queue_items q WHERE q.id=i.queue_item_id AND q.user_id=i.user_id
      AND q.source_plan_item_id IS NOT NULL AND q.source_plan_item_id<>i.id);--> statement-breakpoint
UPDATE cooking_queue_items q SET recipe_snapshot_json=q.recipe_snapshot_json || jsonb_build_object(
  'ingredients',i.ingredients_json,'planItemId',i.id,'plannedDate',i.planned_date),
  version=q.version+1, updated_at=CURRENT_TIMESTAMP
  FROM meal_plan_items i WHERE i.id=q.source_plan_item_id AND i.user_id=q.user_id;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cooking_queue_active_plan_item" ON "cooking_queue_items" USING btree ("user_id","source_plan_item_id") WHERE source_plan_item_id IS NOT NULL AND deleted_at IS NULL AND status IN ('waiting','preparing','ready','cooking');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cooking_queue_active_recipe" ON "cooking_queue_items" USING btree ("user_id","recipe_id") WHERE source_plan_item_id IS NULL AND deleted_at IS NULL AND status IN ('waiting','preparing','ready','cooking');