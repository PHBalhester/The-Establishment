---
phase: 45-railway-deployment-polish
plan: 01
status: complete
started: 2026-02-18
completed: 2026-02-18
---

## Summary: Railway Config + Migrations + Health Check

### What Was Built

Railway deployment infrastructure for the Next.js monorepo frontend:

1. **railway.toml** -- Nixpacks builder config with workspace-aware build/start commands, preDeployCommand for auto-migrations, /api/health healthcheck with 120s timeout, ON_FAILURE restart policy
2. **app/db/migrate.ts** -- Programmatic Drizzle migration runner using drizzle-orm/postgres-js/migrator, single-connection client, path.resolve for working-directory-independent migration folder resolution
3. **app/db/migrations/** -- Initial SQL migration with CREATE TABLE for swap_events, candles, epoch_events, carnage_events + 11 indexes
4. **app/app/api/health/route.ts** -- Health check verifying Postgres (SELECT 1) and Solana RPC (getSlot), returns 200 ok / 503 degraded
5. **tsx** added to app dependencies for TypeScript migration execution in production

### Deployment Discoveries

Several issues discovered and fixed during first Railway deployment:

| Issue | Fix | Commit |
|-------|-----|--------|
| npm workspace package not found when Root Directory = app/ | Switched to repo root with `--workspace app` commands | 917ad51 |
| Railpack auto-detected Rust from Cargo.toml | Switched to NIXPACKS builder + nixpacks.toml with `providers = ["node"]` | b491ce8 |
| Nixpacks defaulted to Node 18 (needs >=20) | Added .node-version file with `22` | bc9cab2 |
| IDL files gitignored, not available in Railway build | Un-gitignored app/idl/, committed JSON + type files | bc9cab2, e473263 |
| SSR prerendering failed (React not defined in Privy deps) | Added `export const dynamic = "force-dynamic"` to layout | c157a97 |
| Migration couldn't find meta/_journal.json (cwd mismatch) | Used `path.resolve(__dirname, "migrations")` instead of relative path | adff1a2 |

### Commits

- 7ccd694 -- feat(45-01): railway.toml, migrate.ts, health endpoint, tsx dep
- 48036e7 -- feat(45-01): generate initial Drizzle migration files
- 917ad51 -- fix(45-01): use workspace commands for monorepo Railway deploy
- b491ce8 -- fix(45-01): switch to NIXPACKS builder with Node.js provider
- a8777bb -- fix(45-01): require Node >= 22 for Nixpacks build
- bc9cab2 -- fix(45-01): Node 22 via .node-version, commit IDL JSON files
- e473263 -- fix(45-01): commit IDL type declarations for Railway build
- d0cae55 -- fix(45-01): add explicit React import to layout for SSR prerender
- c157a97 -- fix(45-01): force-dynamic rendering to skip SSR prerender
- adff1a2 -- fix(45-01): resolve migrations folder relative to script location

### Verification

- Health check at https://dr-fraudsworth-production.up.railway.app/api/health returns `{"status":"ok","checks":{"postgres":true,"solanaRpc":true}}`
- All 4 database tables created via Drizzle migrations
- Railway auto-deploys on git push to main

### Deviations

- **NIXPACKS instead of RAILPACK**: Plan specified RAILPACK but Cargo.toml at repo root caused Rust auto-detection. NIXPACKS with explicit Node provider was the fix.
- **Root Directory empty instead of app/**: npm workspaces require the root package.json to resolve @dr-fraudsworth/shared. Commands use `--workspace app` flag instead.
- **force-dynamic on layout**: Not in original plan but required for production build (SSR prerendering fails with Privy/Solana client libs).
- **IDL files committed**: Originally gitignored as build artifacts, now committed since Railway has no anchor build step.
