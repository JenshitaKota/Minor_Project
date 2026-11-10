-- Creates a genuinely least-privilege Postgres role for the audit service: SELECT
-- only on the four tables it actually reads (User, ManufacturingRecord,
-- EquipmentCalibration, and RecordEvent - the append-only review history reviewer
-- baselines are rebuilt from), no INSERT/UPDATE/DELETE grant on anything. This is what
-- makes "the audit service never writes to Postgres" an enforced database-level
-- guarantee rather than merely an application-level convention - even a fully
-- compromised audit-service process, using these credentials, cannot mutate a row.
--
-- Run manually against the database the backend already migrates (same instance,
-- same DATABASE_URL host/port/db name), same as DATABASE_URL itself is configured
-- manually. Replace 'change_me' with a real password and set AUDIT_DATABASE_URL to
-- match before starting the audit service.
--
-- GRANT SELECT does not need to be reapplied for column changes, only for entirely
-- new tables the audit service should read. Upgrading an existing role created
-- before RecordEvent was added here: run just the final GRANT line again (CREATE
-- ROLE will error on a role that already exists).

CREATE ROLE audit_readonly LOGIN PASSWORD 'change_me';
GRANT CONNECT ON DATABASE pharma_integrity TO audit_readonly;
GRANT USAGE ON SCHEMA public TO audit_readonly;
GRANT SELECT ON "User", "ManufacturingRecord", "EquipmentCalibration", "RecordEvent" TO audit_readonly;
