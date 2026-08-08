// Copies the backend's Prisma schema verbatim into this package before `prisma
// generate` runs, so the audit service's generated client can never silently drift
// from the schema the backend actually migrates against. The schema itself has no
// datasource url (see prisma.config.ts in both packages), so no rewriting is needed -
// only the config each package's CLI reads points at a different env var
// (DATABASE_URL vs AUDIT_DATABASE_URL).
const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "..", "backend", "prisma", "schema.prisma");
const dest = path.join(__dirname, "..", "prisma", "schema.prisma");

fs.copyFileSync(source, dest);
console.log(`Synced ${source} -> ${dest}`);
