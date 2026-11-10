CREATE TABLE "account_reauth_grants" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"phone" text NOT NULL,
	"session_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_reauth_grants_check_1" CHECK (purpose IN ('password_update','account_delete'))
);
--> statement-breakpoint
CREATE TABLE "onboarding_event_receipts" (
	"user_id" integer NOT NULL,
	"request_key" text NOT NULL,
	CONSTRAINT "onboarding_event_receipts_pkey" PRIMARY KEY("user_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "user_onboarding" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"selected_task" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"step" text DEFAULT 'choose_task' NOT NULL,
	"dismissed" integer DEFAULT 0 NOT NULL,
	"started_at" text,
	"completed_at" text,
	"completion_resource_id" text,
	"baseline_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" text,
	"last_request_key" text,
	"last_request_fingerprint" text
);
--> statement-breakpoint
ALTER TABLE "user_health_profiles" ALTER COLUMN "gender" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ALTER COLUMN "health_goal" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ALTER COLUMN "activity_level" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ALTER COLUMN "dietary_preference" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "daily_calories_target" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "auth_verification_challenges" ADD COLUMN "reauth_user_id" integer;--> statement-breakpoint
ALTER TABLE "auth_verification_challenges" ADD COLUMN "reauth_session_version" integer;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ADD COLUMN "profile_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ADD COLUMN "nutrition_target_source" text DEFAULT 'unset' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ADD COLUMN "nutrition_target_legacy_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ADD COLUMN "nutrition_target_version" integer;--> statement-breakpoint
ALTER TABLE "user_health_profiles" ADD COLUMN "safety_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_reauth_grants" ADD CONSTRAINT "account_reauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_event_receipts" ADD CONSTRAINT "onboarding_event_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_reauth_user" ON "account_reauth_grants" USING btree ("user_id","expires_at");--> statement-breakpoint
ALTER TABLE "auth_verification_challenges" ADD CONSTRAINT "auth_verification_challenges_reauth_user_id_users_id_fk" FOREIGN KEY ("reauth_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Preserve both historical inputs before choosing the canonical target. A legacy
-- default (including 2000) must never be mistaken for an explicitly confirmed goal.
INSERT INTO user_health_profiles(user_id)
SELECT id FROM users WHERE daily_calories_target IS NOT NULL
ON CONFLICT(user_id) DO NOTHING;
--> statement-breakpoint
UPDATE user_health_profiles AS p SET
  nutrition_target_legacy_json = jsonb_build_object('daily_calories_target', u.daily_calories_target, 'nutrition_targets', COALESCE(p.nutrition_targets_json, '{}'::jsonb)),
  nutrition_targets_json = COALESCE(p.nutrition_targets_json, '{}'::jsonb) ||
    CASE WHEN COALESCE(NULLIF(p.nutrition_targets_json->'calories_kcal', 'null'::jsonb), to_jsonb(u.daily_calories_target)) IS NOT NULL
      THEN jsonb_build_object('calories_kcal', COALESCE(NULLIF(p.nutrition_targets_json->'calories_kcal', 'null'::jsonb), to_jsonb(u.daily_calories_target)))
      ELSE '{}'::jsonb END,
  nutrition_target_source = CASE WHEN COALESCE(NULLIF(p.nutrition_targets_json->'calories_kcal', 'null'::jsonb), to_jsonb(u.daily_calories_target)) IS NULL THEN 'unset' ELSE 'legacy_unconfirmed' END,
  nutrition_target_version = NULL,
  safety_status = CASE WHEN
    (CASE WHEN jsonb_typeof(p.allergies_json)='array' THEN jsonb_array_length(p.allergies_json)>0 ELSE false END) OR
    (CASE WHEN jsonb_typeof(p.dietary_restrictions_json)='array' THEN jsonb_array_length(p.dietary_restrictions_json)>0 ELSE false END) OR
    (CASE WHEN jsonb_typeof(p.medical_conditions_json)='array' THEN jsonb_array_length(p.medical_conditions_json)>0 ELSE false END) OR
    length(trim(COALESCE(p.medications,'')))>0 THEN 'provided' ELSE 'unknown' END
FROM users u WHERE u.id=p.user_id;
--> statement-breakpoint
UPDATE users u SET daily_calories_target=(p.nutrition_targets_json->>'calories_kcal')::numeric
FROM user_health_profiles p WHERE p.user_id=u.id;
