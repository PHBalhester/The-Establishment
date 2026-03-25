# VERIFY-H011: DB Without TLS
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
`app/db/connection.ts` lines 48-57 now enforce TLS in production:

```ts
const isProductionDb = process.env.NODE_ENV === "production";
const sslConfig = isProductionDb ? { ssl: "require" as const } : {};
const client = globalForDb.pgClient ?? postgres(connectionString, { max: 10, ...sslConfig });
```

The `ssl: "require"` option is passed to the postgres.js driver, which enforces TLS at the driver level rather than relying on the connection string containing `?sslmode=require`.

## Assessment
Fix is complete. In production (`NODE_ENV=production`), the driver-level `ssl: "require"` enforces TLS regardless of what the DATABASE_URL contains. Development connections intentionally skip TLS (local Postgres typically doesn't have certs). This is the correct pattern -- code-level enforcement rather than connection string reliance.
