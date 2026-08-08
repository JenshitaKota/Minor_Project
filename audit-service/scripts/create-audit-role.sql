-- Creates a genuinely least-privilege Postgres role for the audit service: SELECT
-- only on the three tables it actually reads (User, ManufacturingRecord,
-- EquipmentCalibration), no INSERT/UPDATE/DELETE grant on anything. This is what
-- makes "the audit service never writes to Postgres" an enforced database-level
-- guarantee rather than merely an application-level convention - even a fully
-- compromised audit-service process, using these credentials, cannot mutate a row.
--
-- Run manually against the database the backend already migrates (same instance,
-- same DATABASE_URL host/port/db name), same as DATABASE_URL itself is configured
-- manually. Replace 'change_me' with a real password and set AUDIT_DATABASE_URL to
-- match before starting the audit service.
--
-- Run again (harmlessly) after any Prisma migration that changes these three tables'
-- columns - GRANT SELECT does not need to be reapplied for column changes, only for
-- entirely new tables the audit service should read.

CREATE ROLE audit_readonly LOGIN PASSWORD 'change_me';
GRANT CONNECT ON DATABASE pharma_integrity TO audit_readonly;
GRANT USAGE ON SCHEMA public TO audit_readonly;
GRANT SELECT ON "User", "ManufacturingRecord", "EquipmentCalibration" TO audit_readonly;
