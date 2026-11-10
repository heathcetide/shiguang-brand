DROP TABLE "account_reauth_grants" CASCADE;--> statement-breakpoint
DROP TABLE "auth_verification_challenges" CASCADE;--> statement-breakpoint
DROP TABLE "auth_verification_events" CASCADE;--> statement-breakpoint
DROP TABLE "auth_verification_subjects" CASCADE;--> statement-breakpoint
DROP TABLE "auth_verification_usage_daily" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "sms_dev_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "sms_auth_challenges";--> statement-breakpoint
DROP TABLE IF EXISTS "sms_events";--> statement-breakpoint
DROP TABLE IF EXISTS "sms_logs";--> statement-breakpoint
DELETE FROM "system_settings" WHERE "key" LIKE 'auth.sms.%';