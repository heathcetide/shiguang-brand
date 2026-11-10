CREATE TABLE "household_meal_reservations" (
	"meal_id" text NOT NULL,
	"membership_id" integer NOT NULL,
	"servings" double precision NOT NULL,
	CONSTRAINT "household_meal_reservations_pkey" PRIMARY KEY("meal_id","membership_id"),
	CONSTRAINT "household_meal_reservations_check_1" CHECK (servings > 0)
);
--> statement-breakpoint
ALTER TABLE "household_meal_events" ADD COLUMN "reserved_servings_used" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "household_meal_reservations" ADD CONSTRAINT "household_meal_reservations_meal_id_household_meal_batches_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."household_meal_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_meal_reservations" ADD CONSTRAINT "household_meal_reservations_membership_id_household_members_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;