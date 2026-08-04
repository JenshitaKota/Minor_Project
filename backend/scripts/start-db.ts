import EmbeddedPostgres from "embedded-postgres";
import path from "path";

const DB_NAME = "pharma_integrity";
const DATA_DIR = path.join(__dirname, "..", ".pgdata");

const PORT = 5433;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

async function main() {
  const fs = await import("fs");
  const alreadyInitialised = fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));

  if (!alreadyInitialised) {
    console.log("Initialising local Postgres data directory...");
    await pg.initialise();
  }

  await pg.start();
  console.log(`Postgres running on postgresql://postgres:postgres@localhost:${PORT}`);

  if (!alreadyInitialised) {
    await pg.createDatabase(DB_NAME);
    console.log(`Created database "${DB_NAME}"`);
  }

  console.log("Press Ctrl+C to stop.");
}

process.on("SIGINT", async () => {
  console.log("\nStopping Postgres...");
  await pg.stop();
  process.exit(0);
});

main().catch((error) => {
  console.error("Failed to start local Postgres:", error);
  process.exit(1);
});
