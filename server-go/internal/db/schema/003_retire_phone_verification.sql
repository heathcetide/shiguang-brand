-- Forward-only retirement of the removed phone verification service.
-- Account rows and legacy contact fields are deliberately preserved.
DROP TABLE IF EXISTS account_reauth_grants;
DROP TABLE IF EXISTS auth_verification_events;
DROP TABLE IF EXISTS auth_verification_challenges;
DROP TABLE IF EXISTS auth_verification_subjects;
DROP TABLE IF EXISTS auth_verification_usage_daily;
DROP TABLE IF EXISTS sms_dev_outbox;
DROP TABLE IF EXISTS sms_auth_challenges;
DROP TABLE IF EXISTS sms_events;
DROP TABLE IF EXISTS sms_logs;
DELETE FROM system_settings WHERE key LIKE 'auth.sms.%';
