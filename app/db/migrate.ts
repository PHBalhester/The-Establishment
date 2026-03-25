/**
 * Programmatic Drizzle Migration Runner
 *
 * Runs all pending SQL migrations from ./db/migrations/ against the
 * Postgres database specified by DATABASE_URL. Used by Railway's
 * preDeployCommand to apply schema changes before each deployment.
 *
 * This script uses drizzle-orm's programmatic migrator (NOT drizzle-kit),
 * so it works in the production image where devDependencies are pruned.
 *
 * Usage (via Railway preDeployCommand):
 *   npx tsx db/migrate.ts
 *
 * Exit codes:
 *   0 -- All migrations applied successfully
 *   1 -- Migration failed (halts Railway deployment)
 */

import path from "path";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error(
      "ERROR: DATABASE_URL environment variable is required for migrations.",
    );
    process.exit(1);
  }

  console.log("[migrate] Starting database migrations...");

  // Single-connection client for migrations (no pooling needed).
  // max: 1 ensures only one connection is opened, which is sufficient
  // for sequential migration execution and avoids connection exhaustion.
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "migrations") });
    console.log("[migrate] All migrations applied successfully.");
  } catch (error) {
    console.error("[migrate] Migration failed:", error);
    process.exit(1);
  } finally {
    // Close the connection so the process can exit cleanly.
    await client.end();
  }
}

runMigrations();
