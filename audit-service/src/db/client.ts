import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Connects via the audit_readonly role (see ../../scripts/create-audit-role.sql) - this
// process must never be able to write to the database, only read what it needs to
// independently recompute a hash and verify a same-person check.
const adapter = new PrismaPg({ connectionString: process.env.AUDIT_DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
