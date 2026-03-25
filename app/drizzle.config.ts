/**
 * Drizzle Kit Configuration
 *
 * Used by drizzle-kit to generate and apply migrations.
 * Schema points to the existing Drizzle pgTable definitions.
 *
 * Usage:
 *   npm run db:generate  -- Generate migration SQL from schema changes
 *   npm run db:migrate   -- Apply pending migrations to the database
 *   npm run db:studio    -- Open Drizzle Studio for visual database browsing
 *
 * Requires DATABASE_URL environment variable.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
