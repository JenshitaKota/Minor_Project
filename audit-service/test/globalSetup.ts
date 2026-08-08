import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { execSync } from "child_process";
import { Client } from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

const TEST_DB_PORT = 5436;
const TEST_DATA_DIR = path.join(__dirname, "..", ".pgdata-test");
const RUNTIME_CONFIG_PATH = path.join(__dirname, "runtime.json");
const TEST_DB_NAME = "pharma_integrity_audit_test";
const SUPERUSER_DATABASE_URL = `postgresql://postgres:postgres@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}?schema=public`;
const AUDIT_READONLY_DATABASE_URL = `postgresql://audit_readonly_test:audit_readonly_test@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}?schema=public`;

async function assertChainReachable(rpcUrl: string) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
  }).catch(() => null);

  if (!res || !res.ok) {
    throw new Error(
      `Cannot reach the local chain at ${rpcUrl}. Tests reuse the dev Hardhat node - ` +
        `start it with "npx hardhat node" in contracts/ before running tests.`
    );
  }
}

export default async function setup() {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });

  await assertChainReachable(process.env.RPC_URL!);

  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  const pg = new EmbeddedPostgres({
    databaseDir: TEST_DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: TEST_DB_PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(TEST_DB_NAME);

  // Migrations live in the backend package - this service reads the same schema
  // (see scripts/sync-schema.js) but never owns migrating it; reuse the backend's
  // migration history to build an identical test database.
  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, "..", "..", "backend"),
    env: { ...process.env, DATABASE_URL: SUPERUSER_DATABASE_URL },
    stdio: "inherit",
  });

  // Mirrors scripts/create-audit-role.sql against the test database - this is the
  // actual guarantee under test: the role the app connects with in tests must be as
  // genuinely read-only as production's.
  const admin = new Client({ connectionString: SUPERUSER_DATABASE_URL });
  await admin.connect();
  await admin.query("CREATE ROLE audit_readonly_test LOGIN PASSWORD 'audit_readonly_test'");
  await admin.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO audit_readonly_test`);
  await admin.query("GRANT USAGE ON SCHEMA public TO audit_readonly_test");
  await admin.query('GRANT SELECT ON "User", "ManufacturingRecord", "EquipmentCalibration" TO audit_readonly_test');
  await admin.end();

  const seedAdapter = new PrismaPg({ connectionString: SUPERUSER_DATABASE_URL });
  const seedPrisma = new PrismaClient({ adapter: seedAdapter });

  const passwordHash = await bcrypt.hash("demo1234", 10);
  await Promise.all([
    seedPrisma.user.create({ data: { email: "test-admin@pharmachain.test", name: "Test Admin", role: "ADMIN", passwordHash } }),
    seedPrisma.user.create({ data: { email: "test-operator@pharmachain.test", name: "Test Operator", role: "OPERATOR", passwordHash } }),
    seedPrisma.user.create({ data: { email: "test-auditor@pharmachain.test", name: "Test Auditor", role: "AUDITOR", passwordHash } }),
  ]);
  await seedPrisma.$disconnect();

  fs.writeFileSync(
    RUNTIME_CONFIG_PATH,
    JSON.stringify({
      AUDIT_DATABASE_URL: AUDIT_READONLY_DATABASE_URL,
      AUDIT_JWT_SECRET: "test_audit_secret_do_not_use_in_prod",
      RPC_URL: process.env.RPC_URL,
      CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
      AUDITOR_ATTESTOR_PRIVATE_KEY: process.env.AUDITOR_ATTESTOR_PRIVATE_KEY,
      // Test-only fixtures, not read by the app itself: lets tests act as a
      // superuser (insert fixture rows the read-only app connection cannot write)
      // and as the QA attestor (propose an on-chain package for tests to co-sign,
      // without needing the whole main backend running).
      TEST_SUPERUSER_DATABASE_URL: SUPERUSER_DATABASE_URL,
      TEST_QA_PRIVATE_KEY: process.env.TEST_QA_PRIVATE_KEY,
    })
  );

  return async () => {
    await pg.stop();
    fs.rmSync(RUNTIME_CONFIG_PATH, { force: true });
  };
}
