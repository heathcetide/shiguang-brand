CREATE TABLE "base_data_runtime_ids" (
	"collection" text NOT NULL,
	"logical_id" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" text NOT NULL,
	"imported_version" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_data_runtime_ids_pkey" PRIMARY KEY("collection","logical_id")
);
--> statement-breakpoint
ALTER TABLE "ingredients_library" ALTER COLUMN "calories_100g" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community_comments" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients_library" ADD COLUMN IF NOT EXISTS "nutrition_status" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients_library" ADD COLUMN IF NOT EXISTS "base_data_payload" jsonb;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchenware_catalog" ADD COLUMN IF NOT EXISTS "base_data_payload" jsonb;--> statement-breakpoint
ALTER TABLE "recipe_favorites" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "automatic_inventory_write_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "base_data_payload" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Adopt rc.7 staging mappings without rewriting business rows or administrator edits.
DO $$ BEGIN
  IF to_regclass('base_data.runtime_ids') IS NOT NULL THEN
    INSERT INTO public.base_data_runtime_ids(collection,logical_id,target_table,target_id,imported_version,imported_at)
      SELECT collection,logical_id,target_table,target_id,imported_version,imported_at FROM base_data.runtime_ids;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_unreviewed_base_data_cooking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.recipes WHERE id=NEW.recipe_id AND automatic_inventory_write_allowed=false) THEN
    RAISE EXCEPTION 'Recipe is reference-only; automatic inventory writes are disabled' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS base_data_recipe_cooking_guard ON public.cooking_completions;
--> statement-breakpoint
CREATE TRIGGER base_data_recipe_cooking_guard BEFORE INSERT OR UPDATE OF recipe_id ON public.cooking_completions
  FOR EACH ROW EXECUTE FUNCTION public.reject_unreviewed_base_data_cooking();

--> statement-breakpoint
CREATE TRIGGER base_data_prepared_guard BEFORE INSERT OR UPDATE OF recipe_id ON public.prepared_meals
  FOR EACH ROW EXECUTE FUNCTION public.reject_unreviewed_base_data_cooking();
