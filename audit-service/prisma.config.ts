// Points prisma generate at the audit service's own, read-only database role -
// AUDIT_DATABASE_URL, not the backend's DATABASE_URL. See scripts/sync-schema.js
// for why the schema itself is a verbatim copy of the backend's.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env["AUDIT_DATABASE_URL"],
  },
});
