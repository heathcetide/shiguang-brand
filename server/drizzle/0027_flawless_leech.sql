CREATE TABLE "diet_record_create_requests" (
	"user_id" integer NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"diet_record_id" integer,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diet_record_create_requests_pkey" PRIMARY KEY("user_id","request_key")
);
--> statement-breakpoint
ALTER TABLE "diet_record_create_requests" ADD CONSTRAINT "diet_record_create_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diet_record_create_requests" ADD CONSTRAINT "diet_record_create_requests_diet_record_id_diet_records_id_fk" FOREIGN KEY ("diet_record_id") REFERENCES "public"."diet_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_diet_create_record" ON "diet_record_create_requests" USING btree ("diet_record_id");