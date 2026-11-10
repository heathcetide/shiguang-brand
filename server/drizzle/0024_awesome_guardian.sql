CREATE TABLE "prepared_meal_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"plan_id" text NOT NULL,
	"target_meal_id" text NOT NULL,
	"prepared_meal_id" text NOT NULL,
	"servings" double precision NOT NULL,
	"remaining_servings" double precision NOT NULL,
	"planned_date" text NOT NULL,
	"meal_type" text NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "prepared_meal_allocations_plan_id_target_meal_id_prepared_meal_id_key" UNIQUE("plan_id","target_meal_id","prepared_meal_id"),
	CONSTRAINT "prepared_meal_allocations_check_1" CHECK (servings >= 0),
	CONSTRAINT "prepared_meal_allocations_check_2" CHECK (remaining_servings >= 0 AND remaining_servings <= servings),
	CONSTRAINT "prepared_meal_allocations_check_3" CHECK (status IN ('active','conflict','released','settled'))
);
--> statement-breakpoint
ALTER TABLE "prepared_meal_allocations" ADD CONSTRAINT "prepared_meal_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_meal_allocations" ADD CONSTRAINT "prepared_meal_allocations_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prepared_allocations_user_batch" ON "prepared_meal_allocations" USING btree ("user_id","prepared_meal_id","status");--> statement-breakpoint
INSERT INTO prepared_meal_allocations(id,user_id,plan_id,target_meal_id,prepared_meal_id,servings,remaining_servings,planned_date,meal_type,status,source_json)
SELECT p.id||':'||(m.value->>'id')||':'||(a.value->>'preparedMealId'),p.user_id,p.id,
  m.value->>'id',a.value->>'preparedMealId',GREATEST(0,COALESCE((a.value->>'servings')::double precision,0)),GREATEST(0,COALESCE((a.value->>'servings')::double precision,0)),
  COALESCE(m.value->>'date',''),COALESCE(m.value->>'mealType',''),
  CASE WHEN b.id IS NULL OR (a.value->>'servings')::double precision<=0 OR b.is_reserved OR b.version<>(a.value->>'version')::integer THEN 'conflict' ELSE 'active' END,a.value
FROM meal_plans p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.constraints_json->'currentCookingDraft'->'meals',p.constraints_json->'savedCookingDraft'->'draft'->'meals','[]'::jsonb)) m(value)
CROSS JOIN LATERAL jsonb_array_elements(m.value->'allocations') a(value)
LEFT JOIN prepared_meals b ON b.id=a.value->>'preparedMealId' AND b.user_id=p.user_id
WHERE p.status='active' AND p.deleted_at IS NULL;
--> statement-breakpoint
UPDATE prepared_meal_allocations target SET status='conflict' WHERE EXISTS (
 SELECT 1 FROM prepared_meal_allocations a LEFT JOIN prepared_meals b ON b.id=a.prepared_meal_id AND b.user_id=a.user_id
 WHERE a.user_id=target.user_id AND a.prepared_meal_id=target.prepared_meal_id
 GROUP BY a.user_id,a.prepared_meal_id HAVING SUM(a.remaining_servings)>COALESCE(MAX(b.remaining_servings),0)+0.000001
);
