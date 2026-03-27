/**
 * Drizzle ORM Database Connection (Lazy Singleton)
 *
 * Establishes a Postgres connection using postgres.js (the Drizzle-recommended
 * driver for Node.js/serverless). postgres.js has no native bindings, works in
 * serverless/edge environments, and supports automatic connection pooling.
 *
 * The globalThis singleton pattern survives Next.js hot reloads in development.
 * Without this, each HMR cycle creates a new connection pool, eventually
 * exhausting Postgres connection limits.
 *
 * Connection is lazy: the Postgres client is only created when `db` is first
 * accessed (not at module evaluation time). This allows Next.js production
 * builds to succeed without DATABASE_URL -- API routes only connect at
 * request time, not during the build's page-data collection phase.
 *
 * Requires DATABASE_URL environment variable at runtime (set in .env.local
 * for local dev or in Railway environment for production).
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Singleton pattern: globalThis cache survives Next.js hot reloads in dev.
// Without this, each HMR cycle creates a new connection pool, exhausting
// Postgres connections (Railway free tier has a 10-connection limit).
const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined;
  drizzleDb: PostgresJsDatabase<typeof schema> | undefined;
};

/**
 * Lazily create the Postgres client and Drizzle ORM instance.
 * Throws at call time (not import time) if DATABASE_URL is missing.
 */
function getDb(): PostgresJsDatabase<typeof schema> {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required. " +
        "Set it in .env.local for local dev or Railway environment for production.",
    );
  }

  // H011: Enforce TLS for database connections in production.
  // Prevents credential sniffing and data interception on the wire.
  // Railway Postgres supports TLS; we enforce it via the `ssl` option.
  const isProductionDb = process.env.NODE_ENV === "production";
  const sslConfig = isProductionDb ? { ssl: "require" as const } : {};

  // postgres.js client: max 10 connections (Railway free tier limit).
  // connect_timeout: 5s prevents pool slot exhaustion if Postgres is unreachable.
  const client =
    globalForDb.pgClient ?? postgres(connectionString, { max: 10, connect_timeout: 5, ...sslConfig });

  // Warn if non-production connects to a remote host without TLS (VH-L002).
  // Credentials and queries may transmit in plaintext over the network.
  if (!isProductionDb) {
    try {
      const dbUrl = new URL(connectionString);
      const host = dbUrl.hostname;
      if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
        console.warn(
          `[db] WARNING: Non-production DB connection to remote host "${host}" without TLS. ` +
          "Credentials may transmit in plaintext. Set NODE_ENV=production or use localhost (VH-L002)."
        );
      }
    } catch {
      // URL parse failure — handled elsewhere
    }
  }

  if (process.env.NODE_ENV !== "production") {
    globalForDb.pgClient = client;
  }

  const instance = drizzle(client, { schema });
  globalForDb.drizzleDb = instance;
  return instance;
}

/**
 * Drizzle ORM client with full schema typing.
 *
 * Uses a Proxy to defer connection creation until first property access.
 * This makes `import { db } from "./connection"` safe at build time --
 * the Postgres connection is only established when a query method is called.
 */
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const realDb = getDb();
      const value = Reflect.get(realDb, prop, receiver);
      // Bind methods so `this` is the real db instance
      return typeof value === "function" ? value.bind(realDb) : value;
    },
  },
);
