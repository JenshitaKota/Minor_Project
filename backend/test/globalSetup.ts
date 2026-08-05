import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { execSync } from "child_process";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

const TEST_DB_PORT = 5434;
const TEST_DATA_DIR = path.join(__dirname, "..", ".pgdata-test");
const RUNTIME_CONFIG_PATH = path.join(__dirname, "runtime.json");
const TEST_DATABASE_URL = `postgresql://postgres:postgres@localhost:${TEST_DB_PORT}/pharma_integrity_test?schema=public`;

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
  await pg.createDatabase("pharma_integrity_test");

  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });

  const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const passwordHash = await bcrypt.hash("demo1234", 10);
  await Promise.all([
    prisma.user.create({ data: { email: "test-admin@pharmachain.test", name: "Test Admin", role: "ADMIN", passwordHash } }),
    prisma.user.create({ data: { email: "test-operator@pharmachain.test", name: "Test Operator", role: "OPERATOR", passwordHash } }),
    prisma.user.create({ data: { email: "test-qa@pharmachain.test", name: "Test QA", role: "QA_MANAGER", passwordHash } }),
    prisma.user.create({ data: { email: "test-auditor@pharmachain.test", name: "Test Auditor", role: "AUDITOR", passwordHash } }),
  ]);
  await prisma.$disconnect();

  fs.writeFileSync(
    RUNTIME_CONFIG_PATH,
    JSON.stringify({
      DATABASE_URL: TEST_DATABASE_URL,
      RPC_URL: process.env.RPC_URL,
      CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
      QA_ATTESTOR_PRIVATE_KEY: process.env.QA_ATTESTOR_PRIVATE_KEY,
      AUDITOR_ATTESTOR_PRIVATE_KEY: process.env.AUDITOR_ATTESTOR_PRIVATE_KEY,
      JWT_SECRET: "test_secret_do_not_use_in_prod",
    })
  );

  return async () => {
    await pg.stop();
    // Windows can hold the data dir's file handles briefly after the process exits;
    // next run's setup already wipes this directory before reuse, so leave it be here.
    fs.rmSync(RUNTIME_CONFIG_PATH, { force: true });
  };
}
