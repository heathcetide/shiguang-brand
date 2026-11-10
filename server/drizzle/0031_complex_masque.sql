CREATE TABLE "email_auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"session_version" integer,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"recovery_hash" text,
	"recovery_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_auth_challenges_recovery_hash_key" UNIQUE("recovery_hash"),
	CONSTRAINT "email_auth_challenges_check_1" CHECK (purpose IN ('email_verify','email_recovery')),
	CONSTRAINT "email_auth_challenges_check_2" CHECK (status IN ('pending','sent','verified','consumed','failed'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_auth_challenges" ADD CONSTRAINT "email_auth_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_auth_user" ON "email_auth_challenges" USING btree ("user_id","expires_at");