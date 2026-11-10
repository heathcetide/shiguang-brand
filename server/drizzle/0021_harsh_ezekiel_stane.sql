CREATE TABLE "proactive_intervention_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"intervention_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proactive_intervention_actions_user_id_idempotency_key_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "proactive_intervention_actions_check_1" CHECK (action IN ('plan_recipe','view_alternatives','mark_consumed','mark_discarded','snooze','not_cooking_today','not_helpful'))
);
--> statement-breakpoint
CREATE TABLE "proactive_intervention_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"intervention_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"outcome_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proactive_intervention_outcomes_intervention_id_outcome_type_source_type_source_id_key" UNIQUE("intervention_id","outcome_type","source_type","source_id"),
	CONSTRAINT "proactive_intervention_outcomes_check_1" CHECK (outcome_type IN ('cooking_started','inventory_used','inventory_discarded'))
);
--> statement-breakpoint
CREATE TABLE "proactive_intervention_preferences" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"expiry_rescue" integer DEFAULT 0 NOT NULL,
	"dinner_window" integer DEFAULT 0 NOT NULL,
	"time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"quiet_start" text DEFAULT '22:00' NOT NULL,
	"quiet_end" text DEFAULT '07:00' NOT NULL,
	"dinner_time" text DEFAULT '18:00' NOT NULL,
	"dinner_lead_minutes" integer DEFAULT 60 NOT NULL,
	"daily_push_limit" integer DEFAULT 1 NOT NULL,
	"cooldown_minutes" integer DEFAULT 120 NOT NULL,
	"not_cooking_date" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proactive_intervention_preferences_check_1" CHECK (enabled IN (0,1)),
	CONSTRAINT "proactive_intervention_preferences_check_2" CHECK (expiry_rescue IN (0,1)),
	CONSTRAINT "proactive_intervention_preferences_check_3" CHECK (dinner_window IN (0,1)),
	CONSTRAINT "proactive_intervention_preferences_check_4" CHECK (dinner_lead_minutes BETWEEN 15 AND 180),
	CONSTRAINT "proactive_intervention_preferences_check_5" CHECK (daily_push_limit BETWEEN 0 AND 3),
	CONSTRAINT "proactive_intervention_preferences_check_6" CHECK (cooldown_minutes BETWEEN 60 AND 10080),
	CONSTRAINT "proactive_intervention_preferences_check_7" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "proactive_interventions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"candidate_json" jsonb NOT NULL,
	"policy_input_json" jsonb,
	"policy_version" text,
	"decision_reason" text,
	"channel" text,
	"priority" text,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"push_reserved_at" timestamp with time zone,
	"delivery_state" text DEFAULT 'none' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"notification_id" integer,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proactive_interventions_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "proactive_interventions_user_id_source_key_key" UNIQUE("user_id","source_key"),
	CONSTRAINT "proactive_interventions_check_1" CHECK (kind IN ('expiry_rescue','dinner_window')),
	CONSTRAINT "proactive_interventions_check_2" CHECK (status IN ('candidate','suppressed','inbox','sent','acted','expired')),
	CONSTRAINT "proactive_interventions_check_3" CHECK (channel IN ('push','inbox_only','suppressed')),
	CONSTRAINT "proactive_interventions_check_4" CHECK (priority IN ('normal','high')),
	CONSTRAINT "proactive_interventions_check_5" CHECK (delivery_state IN ('none','pending','sending','accepted','failed','uncertain','cancelled')),
	CONSTRAINT "proactive_interventions_check_6" CHECK (delivery_attempts >= 0),
	CONSTRAINT "proactive_interventions_check_7" CHECK (expires_at > starts_at)
);
--> statement-breakpoint
ALTER TABLE "proactive_intervention_actions" ADD CONSTRAINT "proactive_intervention_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_intervention_actions" ADD CONSTRAINT "proactive_intervention_actions_composite_fk_0" FOREIGN KEY ("intervention_id","user_id") REFERENCES "public"."proactive_interventions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_intervention_outcomes" ADD CONSTRAINT "proactive_intervention_outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_intervention_outcomes" ADD CONSTRAINT "proactive_intervention_outcomes_composite_fk_0" FOREIGN KEY ("intervention_id","user_id") REFERENCES "public"."proactive_interventions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_intervention_preferences" ADD CONSTRAINT "proactive_intervention_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_interventions" ADD CONSTRAINT "proactive_interventions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_interventions" ADD CONSTRAINT "proactive_interventions_notification_id_user_notification_inbox_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."user_notification_inbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_proactive_expiry" ON "proactive_interventions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_proactive_delivery" ON "proactive_interventions" USING btree ("delivery_state","next_attempt_at","lease_until");--> statement-breakpoint
CREATE INDEX "idx_proactive_user_quota" ON "proactive_interventions" USING btree ("user_id","push_reserved_at");