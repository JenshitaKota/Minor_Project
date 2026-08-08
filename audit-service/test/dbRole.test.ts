import { describe, it, expect } from "vitest";
import { Client } from "pg";

// This is the actual guarantee the service's architecture depends on: even if the
// audit-service process is fully compromised, the database credentials it holds
// cannot be used to write anything - only its private key can produce a valid
// co-signature, and even that only through the chain, never through the database.
describe("audit_readonly database role - the enforced half of 'never writes to Postgres'", () => {
  it("can SELECT from the tables it's granted", async () => {
    const client = new Client({ connectionString: process.env.AUDIT_DATABASE_URL });
    await client.connect();
    try {
      await expect(client.query('SELECT * FROM "User" LIMIT 1')).resolves.toBeTruthy();
    } finally {
      await client.end();
    }
  });

  it("cannot INSERT into User", async () => {
    const client = new Client({ connectionString: process.env.AUDIT_DATABASE_URL });
    await client.connect();
    try {
      await expect(
        client.query(`INSERT INTO "User" (id, email, "passwordHash", name, role) VALUES ('x','x@x.com','x','x','ADMIN')`)
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });

  it("cannot UPDATE ManufacturingRecord", async () => {
    const client = new Client({ connectionString: process.env.AUDIT_DATABASE_URL });
    await client.connect();
    try {
      await expect(client.query(`UPDATE "ManufacturingRecord" SET status = 'ANCHORED'`)).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });

  it("cannot SELECT from a table it wasn't granted (Batch)", async () => {
    const client = new Client({ connectionString: process.env.AUDIT_DATABASE_URL });
    await client.connect();
    try {
      await expect(client.query('SELECT * FROM "Batch" LIMIT 1')).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });
});
