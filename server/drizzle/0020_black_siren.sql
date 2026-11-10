CREATE TABLE "core_loop_actor_classifications" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"classified_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_loop_actor_classifications_check_1" CHECK (kind IN ('real','demo','test','automation','unknown'))
);
--> statement-breakpoint
CREATE TABLE "core_loop_metric_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"environment" text,
	"enabled" integer DEFAULT 0 NOT NULL,
	"coverage_start" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_loop_metric_settings_check_1" CHECK (id=1)
);
--> statement-breakpoint
ALTER TABLE "core_loop_actor_classifications" ADD CONSTRAINT "core_loop_actor_classifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_loop_actor_classifications" ADD CONSTRAINT "core_loop_actor_classifications_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;