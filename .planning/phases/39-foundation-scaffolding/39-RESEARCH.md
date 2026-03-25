# Phase 39: Foundation + Scaffolding - Research

**Researched:** 2026-02-15
**Domain:** Next.js monorepo scaffolding, Anchor browser integration, Drizzle ORM schema
**Confidence:** HIGH (all core claims verified via official docs)

## Summary

Phase 39 establishes the technical foundation for every subsequent frontend phase. The research covers five domains: (1) Next.js project scaffolding with App Router and Tailwind CSS v4, (2) shared code extraction as a monorepo workspace, (3) IDL sync from Anchor build output, (4) Anchor Program loading in the browser with Buffer polyfill, and (5) Drizzle ORM schema definition for indexer tables.

The most significant finding is that **Next.js is now at version 16.1.6** with **Turbopack as the default bundler**. Turbopack does NOT support webpack plugins or `resolve.fallback` -- the old pattern for polyfilling Node.js built-ins like Buffer. However, Next.js 16 provides `instrumentation-client.ts` (introduced v15.3) as the official mechanism for loading polyfills before React hydration, and `turbopack.resolveAlias` for silencing Node.js module imports in the browser. This combination replaces the webpack `ProvidePlugin + resolve.fallback` pattern that all older Solana/Anchor tutorials use.

Tailwind CSS v4 is a clean-break from v3 -- no `tailwind.config.js`, just `@import "tailwindcss"` in CSS with `@tailwindcss/postcss` as the PostCSS plugin. Drizzle ORM v0.45.x provides a lightweight, type-safe schema definition that works well for the indexer tables needed later.

**Primary recommendation:** Use Next.js 16 with Turbopack (default), polyfill Buffer via `instrumentation-client.ts`, use `turbopack.resolveAlias` to stub Node.js modules that Anchor/web3.js transitively import, and use npm workspaces for the `shared/` package.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.1.x | App framework (App Router, RSC, Turbopack) | Official current release, Turbopack stable, zero-config Tailwind/TS |
| `react` / `react-dom` | 19.x | UI library | Required by Next.js 16 |
| `tailwindcss` | 4.x | Utility-first CSS | Default in create-next-app, CSS-first config, no JS config file |
| `@tailwindcss/postcss` | 4.x | PostCSS plugin for Tailwind v4 | Required for Tailwind v4 integration |
| `@coral-xyz/anchor` | 0.32.1 | Anchor client (IDL parsing, Program, account deserialization) | Already in project, matches on-chain programs |
| `@solana/web3.js` | 1.x | Solana RPC client (Connection, PublicKey, Transaction) | Already in project, wallet-adapter requires v1 |
| `drizzle-orm` | 0.45.x | Type-safe ORM for schema definition | Lightweight, TS-native, no runtime overhead for schema-only |
| `drizzle-kit` | latest | Migration tooling (future use, schema generation) | Companion to drizzle-orm |
| `buffer` | 6.x | Browser polyfill for Node.js Buffer | Required by @coral-xyz/anchor and @solana/web3.js in browser |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@solana/wallet-adapter-react` | 0.15.x | React wallet connection hooks | Phase 40 (wallet integration), but scaffold may include provider shell |
| `@solana/wallet-adapter-react-ui` | 0.9.x | Pre-built wallet UI components | Phase 40 |
| `pg` | latest | PostgreSQL driver (node-postgres) | Phase 44 (when DB is deployed), not needed for schema-only |
| `postcss` | latest | CSS processing | Required by @tailwindcss/postcss |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Turbopack (default) | Webpack (`--webpack` flag) | Webpack has full Node polyfill ecosystem but is 2-5x slower; Turbopack's `resolveAlias` + `instrumentation-client.ts` handles our needs |
| Drizzle ORM | Prisma | Prisma requires a running DB for schema introspection; Drizzle allows schema-only definition without any DB connection |
| npm workspaces | Turborepo/Nx | Overkill for 2-package monorepo; npm workspaces are native and zero-config |
| `@solana/web3.js` v1 | `@solana/kit` (v2) | v2 is the official future but wallet-adapter requires v1; stay on v1 for compatibility |

**Installation (app/ directory):**
```bash
npx create-next-app@latest app --yes
# Default: TypeScript, ESLint, Tailwind CSS, App Router, Turbopack, @/* alias

# Then add Solana/Anchor dependencies:
cd app
npm install @coral-xyz/anchor @solana/web3.js buffer
npm install -D drizzle-orm drizzle-kit
```

## Architecture Patterns

### Recommended Project Structure
```
dr-fraudsworth/                   # Existing monorepo root
├── programs/                     # Anchor Rust programs (existing)
├── target/idl/                   # Anchor build output (existing)
├── tests/                        # Integration tests (existing)
├── scripts/                      # Deploy/e2e scripts (existing)
├── shared/                       # NEW: shared constants package
│   ├── package.json              # name: "@dr-fraudsworth/shared"
│   ├── tsconfig.json
│   ├── index.ts                  # barrel export
│   ├── constants.ts              # PDA seeds, program IDs, token decimals, fees
│   ├── types.ts                  # shared TypeScript types
│   └── programs.ts               # program ID PublicKey objects
├── app/                          # NEW: Next.js 16 frontend
│   ├── package.json              # depends on "@dr-fraudsworth/shared"
│   ├── next.config.ts
│   ├── postcss.config.mjs
│   ├── tsconfig.json
│   ├── instrumentation-client.ts # Buffer polyfill
│   ├── app/
│   │   ├── layout.tsx            # Root layout with providers
│   │   └── page.tsx              # Home page (proof of life)
│   ├── lib/
│   │   ├── anchor.ts             # Program factory (IDL + Connection)
│   │   ├── connection.ts         # RPC connection singleton
│   │   └── empty.ts              # Empty module for resolveAlias stubs
│   ├── idl/                      # IDL JSON files (copied at build time)
│   │   ├── amm.json
│   │   ├── epoch_program.json
│   │   ├── staking.json
│   │   ├── tax_program.json
│   │   └── transfer_hook.json
│   └── db/
│       └── schema.ts             # Drizzle ORM schema (candles, events)
├── package.json                  # Root: workspaces config
└── tsconfig.json                 # Existing root tsconfig (tests/scripts)
```

### Pattern 1: Buffer Polyfill via instrumentation-client.ts
**What:** Next.js 16 provides `instrumentation-client.ts` as the official mechanism for client-side polyfills. This file runs after the HTML document loads but BEFORE React hydration, making it the correct place to set `globalThis.Buffer`.
**When to use:** Always, for any Solana dApp using @coral-xyz/anchor or @solana/web3.js in the browser.
**Why:** Turbopack does not support webpack's `ProvidePlugin` or `resolve.fallback`. The old pattern of configuring webpack to auto-inject Buffer globally does not work.
**Example:**
```typescript
// app/instrumentation-client.ts
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
import { Buffer } from "buffer";
globalThis.Buffer = Buffer;
```

### Pattern 2: Turbopack resolveAlias for Node.js Module Stubs
**What:** @coral-xyz/anchor and @solana/web3.js transitively import Node.js modules (fs, crypto, stream, etc.) that don't exist in browsers. Turbopack's `resolveAlias` maps these to empty stubs for browser bundles.
**When to use:** When Turbopack errors with "Module not found: Can't resolve 'fs'" or similar.
**Why:** Replaces webpack's `resolve.fallback: { fs: false }` pattern.
**Example:**
```typescript
// app/next.config.ts
// Source: https://nextjs.org/docs/app/guides/upgrading/version-16#resolve-alias-fallback
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@dr-fraudsworth/shared"],
  turbopack: {
    resolveAlias: {
      // Stub Node.js modules that Anchor/web3.js import but don't use in browser
      fs: { browser: "./lib/empty.ts" },
      net: { browser: "./lib/empty.ts" },
      tls: { browser: "./lib/empty.ts" },
    },
  },
};
export default nextConfig;
```

```typescript
// app/lib/empty.ts
export default {};
```

### Pattern 3: IDL Sync Pre-Build Script
**What:** A script copies IDL JSON files from `target/idl/` to `app/idl/` before the Next.js build. Only the 5 production programs (not mock/stub programs).
**When to use:** Before `npm run dev` and `npm run build` in the app directory.
**Why:** IDL files are build artifacts (gitignored in `target/`). The app needs them as importable JSON. Copying at build time keeps the app decoupled from the Anchor build directory.
**Example:**
```json
// app/package.json scripts
{
  "scripts": {
    "prebuild": "node scripts/sync-idl.mjs",
    "predev": "node scripts/sync-idl.mjs",
    "dev": "next dev",
    "build": "next build"
  }
}
```

```javascript
// app/scripts/sync-idl.mjs
import { cpSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SOURCE = join(ROOT, "target", "idl");
const DEST = join(__dirname, "..", "idl");

const PROGRAMS = ["amm", "epoch_program", "staking", "tax_program", "transfer_hook"];

mkdirSync(DEST, { recursive: true });
for (const name of PROGRAMS) {
  cpSync(join(SOURCE, `${name}.json`), join(DEST, `${name}.json`));
  console.log(`Synced ${name}.json`);
}
```

### Pattern 4: Anchor Program Factory (Read-Only)
**What:** Create Anchor `Program` objects using imported IDL JSON and a devnet Connection. No wallet required for reading account data.
**When to use:** For read-only operations (account deserialization, PDA derivation). Wallet-dependent operations come in Phase 40+.
**Example:**
```typescript
// app/lib/anchor.ts
// Source: https://www.anchor-lang.com/docs/clients/typescript
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

import ammIdl from "@/idl/amm.json";
import epochIdl from "@/idl/epoch_program.json";
import stakingIdl from "@/idl/staking.json";
import taxIdl from "@/idl/tax_program.json";
import hookIdl from "@/idl/transfer_hook.json";

import type { Amm } from "@/idl/types/amm";
import type { EpochProgram } from "@/idl/types/epoch_program";
import type { Staking } from "@/idl/types/staking";
import type { TaxProgram } from "@/idl/types/tax_program";
import type { TransferHook } from "@/idl/types/transfer_hook";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function getAmmProgram(connection?: Connection): Program<Amm> {
  return new Program(ammIdl as Amm, { connection: connection ?? getConnection() });
}

// ... similar for other programs
```

### Pattern 5: npm Workspaces for Shared Package
**What:** Use npm workspaces to link `shared/` as an importable package within the monorepo. The root `package.json` declares workspaces; `app/` declares `shared/` as a dependency.
**When to use:** For sharing constants between `app/` and (eventually) `scripts/`.
**Why:** No build step needed. TypeScript resolves through `transpilePackages`. No publishing or linking ceremony.
**Example:**
```json
// Root package.json (add workspaces field)
{
  "workspaces": ["shared", "app"]
}
```

```json
// shared/package.json
{
  "name": "@dr-fraudsworth/shared",
  "version": "0.0.1",
  "main": "index.ts",
  "types": "index.ts"
}
```

```json
// app/package.json (add dependency)
{
  "dependencies": {
    "@dr-fraudsworth/shared": "*"
  }
}
```

```typescript
// app/next.config.ts (add transpilePackages)
transpilePackages: ["@dr-fraudsworth/shared"],
```

### Pattern 6: Drizzle Schema-Only Definition
**What:** Define Drizzle ORM table schemas in TypeScript without connecting to a database. Schema files are pure TypeScript that export table definitions.
**When to use:** Phase 39 defines schema only. Phase 44 connects to Postgres and runs migrations.
**Example:**
```typescript
// app/db/schema.ts
import {
  pgTable, text, integer, bigint, real,
  timestamp, boolean, varchar, index, uniqueIndex
} from "drizzle-orm/pg-core";

export const swapEvents = pgTable("swap_events", {
  txSignature: varchar("tx_signature", { length: 128 }).primaryKey(),
  pool: varchar("pool", { length: 64 }).notNull(),
  direction: varchar("direction", { length: 4 }).notNull(), // "buy" | "sell"
  solAmount: bigint("sol_amount", { mode: "number" }).notNull(),
  tokenAmount: bigint("token_amount", { mode: "number" }).notNull(),
  price: real("price").notNull(),
  taxAmount: bigint("tax_amount", { mode: "number" }).notNull(),
  lpFee: bigint("lp_fee", { mode: "number" }).notNull(),
  slippage: real("slippage"),
  userWallet: varchar("user_wallet", { length: 64 }).notNull(),
  epochNumber: integer("epoch_number").notNull(),
  timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
}, (table) => [
  index("swap_events_pool_idx").on(table.pool),
  index("swap_events_epoch_idx").on(table.epochNumber),
  index("swap_events_timestamp_idx").on(table.timestamp),
  index("swap_events_user_idx").on(table.userWallet),
]);
```

### Anti-Patterns to Avoid
- **Webpack config in Next.js 16:** Do NOT add a `webpack()` function to `next.config.ts`. Turbopack ignores it and `next build` will fail with a migration warning. Use `turbopack.resolveAlias` instead.
- **`window.Buffer = Buffer` in layout.tsx:** Do NOT set Buffer in a React component. It runs too late (after hydration). Use `instrumentation-client.ts` which runs BEFORE hydration.
- **Importing from `tests/` or `scripts/`:** Do NOT make `app/` import from `tests/integration/helpers/constants.ts`. Create `shared/` as the single source of truth consumed by `app/`. Scripts and tests stay untouched per CONTEXT.md decisions.
- **`"type": "module"` in root package.json:** The existing test/script infrastructure uses CommonJS (`require`, `ts-mocha`). Adding `"type": "module"` to root would break everything. Keep the root as CommonJS; `app/` handles ESM internally via Next.js.
- **IDL files committed to git in `app/idl/`:** IDLs are derived artifacts. Add `app/idl/` to `.gitignore` and sync at build time. This prevents stale IDLs from diverging from program builds.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Buffer in browser | Manual script tag injection | `instrumentation-client.ts` + `buffer` package | Official Next.js mechanism, runs before hydration |
| Node.js module stubs | Custom webpack plugin | `turbopack.resolveAlias` with empty module | Built into Turbopack, zero dependencies |
| Monorepo linking | `npm link` or symlinks | npm workspaces | Auto-links on install, no manual ceremony |
| Local package transpilation | Custom babel config | `transpilePackages` in next.config.ts | Built into Next.js, works with Turbopack |
| IDL type generation | Manual TypeScript interfaces | Anchor's `target/types/*.ts` | Auto-generated, type-safe, matches IDL exactly |
| CSS configuration | `tailwind.config.js` + directives | `@import "tailwindcss"` (v4 CSS-first) | Tailwind v4 eliminates JS config entirely |
| DB schema management | Raw SQL DDL files | Drizzle ORM pgTable definitions | Type-safe, generates migrations, queryable |

**Key insight:** The Solana/Anchor browser integration landscape is full of outdated tutorials using webpack 4/5 patterns. Next.js 16 with Turbopack requires a different approach -- `instrumentation-client.ts` for polyfills and `resolveAlias` for module stubs. Do not follow any tutorial that adds `webpack()` to `next.config.js`.

## Common Pitfalls

### Pitfall 1: "Buffer is not defined" at Runtime
**What goes wrong:** Anchor and web3.js use `Buffer` extensively. In the browser, `Buffer` doesn't exist natively. The app loads, React hydrates, and then any Anchor operation throws `ReferenceError: Buffer is not defined`.
**Why it happens:** Turbopack doesn't auto-polyfill Node.js globals like webpack 4 did.
**How to avoid:** Create `app/instrumentation-client.ts` with `import { Buffer } from "buffer"; globalThis.Buffer = Buffer;`. This file runs before React hydration.
**Warning signs:** Runtime error in browser console, not a build error. The build succeeds but the app crashes.

### Pitfall 2: "Module not found: Can't resolve 'fs'" During Build
**What goes wrong:** @coral-xyz/anchor or its dependencies import `fs`, `net`, `tls`, `crypto` -- Node.js modules that don't exist in the browser bundle.
**Why it happens:** These are server-only modules that some libraries import conditionally. Turbopack resolves all imports eagerly and fails if it can't find them.
**How to avoid:** Add `turbopack.resolveAlias` entries mapping each problematic module to `{ browser: "./lib/empty.ts" }`. Start with `fs`, `net`, `tls` and add more as build errors surface.
**Warning signs:** Build error (not runtime). Turbopack will name the exact module it can't resolve.

### Pitfall 3: Stale IDL Files After Program Changes
**What goes wrong:** Program code is updated and rebuilt with `anchor build`, but the app still uses old IDL files. Account deserialization silently returns wrong data or fails.
**Why it happens:** IDL files in `app/idl/` are copies, not symlinks. They don't auto-update.
**How to avoid:** IDL sync script runs on `predev` and `prebuild` hooks. Document that `anchor build` must precede `npm run dev`. Consider adding a timestamp check or hash comparison.
**Warning signs:** Deserialized account data has unexpected fields or values. Anchor "cannot find instruction" errors.

### Pitfall 4: npm Workspaces + Turbopack Root Detection
**What goes wrong:** When using npm workspaces, Turbopack's root detection may not correctly resolve the monorepo root, causing module resolution failures for the `shared/` package.
**Why it happens:** Turbopack detects root by looking for lockfiles. In a workspace setup, the lockfile is at the monorepo root but `next dev` runs from `app/`.
**How to avoid:** If module resolution fails, explicitly set `turbopack.root` in `next.config.ts` to `path.join(__dirname, "..")` (the monorepo root). Also ensure `transpilePackages: ["@dr-fraudsworth/shared"]` is set.
**Warning signs:** "Module not found" for `@dr-fraudsworth/shared` imports.

### Pitfall 5: Root package.json "type": "module" Breaks Existing Tests
**What goes wrong:** Adding `"type": "module"` to root `package.json` to support ESM imports breaks `ts-mocha`, `ts-node`, and all existing test infrastructure which uses CommonJS.
**Why it happens:** `ts-mocha` uses `require()` internally and doesn't support ESM natively.
**How to avoid:** Do NOT add `"type": "module"` to root. Each workspace (`app/`, `shared/`) manages its own module system. Next.js handles ESM internally. The `shared/` package should export `.ts` files directly (transpiled by Next.js via `transpilePackages`).
**Warning signs:** "require is not defined" or "Cannot use import statement outside a module" in test output.

### Pitfall 6: Tailwind v4 Config Confusion
**What goes wrong:** Developer creates a `tailwind.config.js` file (v3 pattern) which conflicts with v4's CSS-first approach, or uses `@tailwind base; @tailwind components; @tailwind utilities;` directives which are v3 syntax.
**Why it happens:** Most online tutorials still reference Tailwind v3 patterns.
**How to avoid:** Use only `@import "tailwindcss"` in `globals.css`. No `tailwind.config.js` file. Configuration is done via `@theme` directives in CSS if needed. Use `@tailwindcss/postcss` as the PostCSS plugin (not the old `tailwindcss` PostCSS plugin).
**Warning signs:** "Cannot find configuration" errors, or styles not applying.

## Code Examples

### Complete next.config.ts for Solana dApp
```typescript
// app/next.config.ts
// Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack
// Source: https://nextjs.org/docs/app/guides/upgrading/version-16#resolve-alias-fallback
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the shared workspace package
  transpilePackages: ["@dr-fraudsworth/shared"],

  turbopack: {
    resolveAlias: {
      // Stub Node.js modules that Anchor/web3.js transitively import
      // These are not used in the browser but cause build failures
      fs: { browser: "./lib/empty.ts" },
      net: { browser: "./lib/empty.ts" },
      tls: { browser: "./lib/empty.ts" },
    },
  },
};

export default nextConfig;
```

### Complete instrumentation-client.ts
```typescript
// app/instrumentation-client.ts
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
// Runs BEFORE React hydration -- sets up Buffer polyfill for Solana libraries
import { Buffer } from "buffer";
globalThis.Buffer = Buffer;
```

### Proof-of-Life: Deserialize Account from Devnet
```typescript
// app/app/page.tsx (simplified proof of concept)
"use client";

import { useEffect, useState } from "react";
import { getAmmProgram, getConnection } from "@/lib/anchor";
import { PROGRAM_IDS } from "@dr-fraudsworth/shared";

export default function Home() {
  const [epochNumber, setEpochNumber] = useState<number | null>(null);

  useEffect(() => {
    async function fetchEpochState() {
      const connection = getConnection();
      // Example: fetch and deserialize an account
      const program = getAmmProgram(connection);
      const adminConfig = await program.account.adminConfig.fetch(
        "9ShRRky3q77BuwF8yzmUY2k5dk8WeZXhxMieWyhoy1JK"
      );
      console.log("Admin config:", adminConfig);
    }
    fetchEpochState();
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Dr. Fraudsworth</h1>
        <p className="mt-4 text-gray-500">Foundation scaffold - proof of life</p>
      </div>
    </main>
  );
}
```

### Shared Constants Package
```typescript
// shared/constants.ts
// Source of truth for PDA seeds, program IDs, and protocol constants
// Mirrors: programs/*/src/constants.rs

import { PublicKey } from "@solana/web3.js";

// =============================================================================
// Program IDs (from Anchor.toml [programs.devnet])
// =============================================================================
export const PROGRAM_IDS = {
  AMM: new PublicKey("zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa"),
  TRANSFER_HOOK: new PublicKey("9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ"),
  TAX_PROGRAM: new PublicKey("FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu"),
  EPOCH_PROGRAM: new PublicKey("AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod"),
  STAKING: new PublicKey("Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi"),
} as const;

// =============================================================================
// Mint Addresses (from pda-manifest.json)
// =============================================================================
export const MINTS = {
  CRIME: new PublicKey("6PyHbyUvxo5f6vKHpXWgy5HaFTCfMSDeXo9EQyKQqp7R"),
  FRAUD: new PublicKey("Bo9upPkGSYyAfaUBkxakHzbCxB9vWDKp23zPhzKZfiw2"),
  PROFIT: new PublicKey("J4CzJ5zgAV1dVLFtR3ZrvAMik6oZYQaTt9fKxeFvNvZP"),
} as const;

// =============================================================================
// Token Constants
// =============================================================================
export const TOKEN_DECIMALS = 6;
export const MINIMUM_STAKE = 1_000_000; // 1 PROFIT in base units

// =============================================================================
// Pool Fee Constants (bps)
// =============================================================================
export const SOL_POOL_FEE_BPS = 100;    // 1.0%
export const PROFIT_POOL_FEE_BPS = 50;  // 0.5%

// =============================================================================
// PDA Seeds (must match on-chain constants.rs exactly)
// =============================================================================
export const SEEDS = {
  // Staking
  STAKE_POOL: Buffer.from("stake_pool"),
  ESCROW_VAULT: Buffer.from("escrow_vault"),
  STAKE_VAULT: Buffer.from("stake_vault"),
  USER_STAKE: Buffer.from("user_stake"),

  // Transfer Hook
  WHITELIST_AUTHORITY: Buffer.from("authority"),
  WHITELIST_ENTRY: Buffer.from("whitelist"),
  EXTRA_ACCOUNT_META: Buffer.from("extra-account-metas"),

  // AMM
  ADMIN: Buffer.from("admin"),
  POOL: Buffer.from("pool"),
  VAULT: Buffer.from("vault"),
  VAULT_A: Buffer.from("a"),
  VAULT_B: Buffer.from("b"),
  SWAP_AUTHORITY: Buffer.from("swap_authority"),

  // Tax
  TAX_AUTHORITY: Buffer.from("tax_authority"),

  // Epoch
  EPOCH_STATE: Buffer.from("epoch_state"),
  CARNAGE_FUND: Buffer.from("carnage_fund"),
  CARNAGE_SOL_VAULT: Buffer.from("carnage_sol_vault"),
  CARNAGE_CRIME_VAULT: Buffer.from("carnage_crime_vault"),
  CARNAGE_FRAUD_VAULT: Buffer.from("carnage_fraud_vault"),
  CARNAGE_SIGNER: Buffer.from("carnage_signer"),
  STAKING_AUTHORITY: Buffer.from("staking_authority"),
} as const;
```

### Drizzle Schema for All 4 Event Tables
```typescript
// app/db/schema.ts
import {
  pgTable, varchar, integer, bigint, real,
  timestamp, boolean, text, index, uniqueIndex, jsonb
} from "drizzle-orm/pg-core";

// =============================================================================
// Swap Events -- rich data per CONTEXT.md decision
// =============================================================================
export const swapEvents = pgTable("swap_events", {
  txSignature: varchar("tx_signature", { length: 128 }).primaryKey(),
  pool: varchar("pool", { length: 64 }).notNull(),       // pool PDA address
  direction: varchar("direction", { length: 4 }).notNull(), // "buy" | "sell"
  solAmount: bigint("sol_amount", { mode: "number" }).notNull(),
  tokenAmount: bigint("token_amount", { mode: "number" }).notNull(),
  price: real("price").notNull(),                         // token price in SOL
  taxAmount: bigint("tax_amount", { mode: "number" }).notNull(),
  lpFee: bigint("lp_fee", { mode: "number" }).notNull(),
  slippage: real("slippage"),
  userWallet: varchar("user_wallet", { length: 64 }).notNull(),
  epochNumber: integer("epoch_number").notNull(),
  timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
}, (table) => [
  index("swap_pool_idx").on(table.pool),
  index("swap_epoch_idx").on(table.epochNumber),
  index("swap_time_idx").on(table.timestamp),
  index("swap_user_idx").on(table.userWallet),
]);

// =============================================================================
// Candle Data -- OHLCV for all 4 pool pairs at multiple resolutions
// =============================================================================
export const candles = pgTable("candles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  pool: varchar("pool", { length: 64 }).notNull(),       // pool PDA address
  resolution: varchar("resolution", { length: 4 }).notNull(), // "1m","5m","15m","1h","4h","1d"
  openTime: timestamp("open_time", { mode: "date" }).notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: bigint("volume", { mode: "number" }).notNull(), // in lamports
  tradeCount: integer("trade_count").notNull().default(0),
}, (table) => [
  uniqueIndex("candle_unique_idx").on(table.pool, table.resolution, table.openTime),
  index("candle_pool_res_idx").on(table.pool, table.resolution),
  index("candle_time_idx").on(table.openTime),
]);

// =============================================================================
// Epoch Events -- snapshot of state at each epoch transition
// =============================================================================
export const epochEvents = pgTable("epoch_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  epochNumber: integer("epoch_number").notNull(),
  txSignature: varchar("tx_signature", { length: 128 }).notNull(),
  cheapSide: varchar("cheap_side", { length: 8 }).notNull(), // "crime" | "fraud"
  crimeBuyTax: integer("crime_buy_tax").notNull(),   // bps
  crimeSellTax: integer("crime_sell_tax").notNull(),  // bps
  fraudBuyTax: integer("fraud_buy_tax").notNull(),    // bps
  fraudSellTax: integer("fraud_sell_tax").notNull(),   // bps
  stakingRewardDeposited: bigint("staking_reward_deposited", { mode: "number" }),
  carnageFundBalance: bigint("carnage_fund_balance", { mode: "number" }),
  timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
}, (table) => [
  uniqueIndex("epoch_number_idx").on(table.epochNumber),
  index("epoch_time_idx").on(table.timestamp),
]);

// =============================================================================
// Carnage Events -- full execution trace
// =============================================================================
export const carnageEvents = pgTable("carnage_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  epochNumber: integer("epoch_number").notNull(),
  txSignature: varchar("tx_signature", { length: 128 }).notNull(),
  crimeBurned: bigint("crime_burned", { mode: "number" }).notNull(),
  fraudBurned: bigint("fraud_burned", { mode: "number" }).notNull(),
  solUsedForBuy: bigint("sol_used_for_buy", { mode: "number" }).notNull(),
  crimeBought: bigint("crime_bought", { mode: "number" }),
  fraudBought: bigint("fraud_bought", { mode: "number" }),
  carnageSolBefore: bigint("carnage_sol_before", { mode: "number" }),
  carnageSolAfter: bigint("carnage_sol_after", { mode: "number" }),
  path: varchar("path", { length: 32 }),  // "BuyOnly" | "Burn" | "BurnAndSell"
  targetToken: varchar("target_token", { length: 8 }), // "CRIME" | "FRAUD"
  timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
}, (table) => [
  uniqueIndex("carnage_epoch_idx").on(table.epochNumber),
  index("carnage_time_idx").on(table.timestamp),
]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Webpack 5 + `resolve.fallback` + `ProvidePlugin` for Buffer | Turbopack + `instrumentation-client.ts` + `resolveAlias` | Next.js 16 (2025) | All Solana/Anchor webpack tutorials are outdated; must use new pattern |
| `tailwind.config.js` + `@tailwind` directives | `@import "tailwindcss"` + CSS-first `@theme` | Tailwind v4 (2025) | No config file needed; automatic content detection |
| `experimental.turbo` config key | Top-level `turbopack` config key | Next.js 16.0.0 | Old key removed; must migrate |
| Anchor `Program(idl, programId, provider)` constructor | `new Program(idl, { connection })` for read-only | Anchor v0.30+ | Provider/wallet optional for read-only usage |
| `next-transpile-modules` package | Built-in `transpilePackages` | Next.js 13+ | No external package needed |
| Drizzle `serial` type | `integer().generatedAlwaysAsIdentity()` | PostgreSQL 10+ / Drizzle ORM best practice | Identity columns preferred over serial |

**Deprecated/outdated:**
- `experimental.turbo` config: Removed in Next.js 16. Use `turbopack` at top level.
- `tailwind.config.js`: Not needed with Tailwind v4. CSS-first configuration.
- `@tailwind base; @tailwind components; @tailwind utilities;`: v3 syntax. Use `@import "tailwindcss"`.
- `experimental.fallbackNodePolyfills`: Listed as "planned" for Turbopack, not yet implemented. Use `resolveAlias` instead.
- `next-transpile-modules`: Replaced by built-in `transpilePackages`.

## Open Questions

1. **Exact set of Node.js modules needing resolveAlias stubs**
   - What we know: `fs`, `net`, `tls` are commonly needed. `crypto` may be needed depending on @solana/web3.js usage path.
   - What's unclear: The exact list depends on which code paths Turbopack traces through @coral-xyz/anchor's dependency tree. May need additional stubs for `stream`, `zlib`, `http`, `https`.
   - Recommendation: Start with `fs`, `net`, `tls`. Add more as Turbopack build errors surface. This is iterative -- each new "Module not found" error tells you exactly which module to stub.

2. **Anchor IDL type imports in browser**
   - What we know: Anchor generates TypeScript types in `target/types/*.ts`. These can be imported for type safety.
   - What's unclear: Whether the generated type files import Anchor in a way that triggers additional Node.js module resolution issues. The IDL JSON files are pure data (safe), but the `.ts` type files may import from `@coral-xyz/anchor` which could create circular resolution.
   - Recommendation: Copy both `.json` IDL files and `.ts` type files in the sync script. If type files cause issues, fall back to `as` type assertions on the JSON imports.

3. **npm workspace hoisting with existing node_modules**
   - What we know: The project has a flat `node_modules/` at root with `@coral-xyz/anchor` etc. Adding workspaces will change hoisting behavior.
   - What's unclear: Whether `app/`'s different dependency versions (e.g., React 19 vs none in root) will cause conflicts during workspace hoisting. The root `package.json` currently has `@coral-xyz/anchor ^0.32.1` and the app would also need it.
   - Recommendation: When adding `workspaces` to root `package.json`, run a clean `rm -rf node_modules package-lock.json && npm install` to let npm recalculate hoisting. The shared dependencies (Anchor, web3.js) should hoist to root. App-specific deps (React, Next.js) stay in `app/node_modules/`.

4. **shared/ package: Buffer.from() calls without polyfill**
   - What we know: `shared/constants.ts` uses `Buffer.from()` for PDA seeds. This works in Node.js (scripts/tests) but needs the polyfill in the browser.
   - What's unclear: Whether `Buffer.from()` in `shared/` will resolve correctly when imported by `app/` given that `instrumentation-client.ts` sets `globalThis.Buffer` before hydration but possibly after module evaluation.
   - Recommendation: Since `shared/` is transpiled by Next.js (via `transpilePackages`), and `instrumentation-client.ts` runs before hydration, this should work for runtime usage. However, if there are import-time (module evaluation) issues, an alternative is to use `Uint8Array` / `TextEncoder` for seed encoding in the shared package, avoiding Buffer entirely.

## Sources

### Primary (HIGH confidence)
- Next.js 16.1.6 official docs -- installation, Turbopack config, transpilePackages, instrumentation-client
  - https://nextjs.org/docs/getting-started/installation (doc-version: 16.1.6)
  - https://nextjs.org/docs/app/api-reference/turbopack (doc-version: 16.1.6)
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack (doc-version: 16.1.6)
  - https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client (doc-version: 16.1.6)
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages (doc-version: 16.1.6)
  - https://nextjs.org/docs/app/guides/upgrading/version-16
- Anchor TypeScript client docs
  - https://www.anchor-lang.com/docs/clients/typescript
- Tailwind CSS v4 official Next.js guide
  - https://tailwindcss.com/docs/guides/nextjs
- Drizzle ORM official docs
  - https://orm.drizzle.team/docs/get-started/postgresql-new
  - https://orm.drizzle.team/docs/column-types/pg
  - https://orm.drizzle.team/docs/indexes-constraints
- Solana developer guides
  - https://solana.com/developers/guides/wallets/add-solana-wallet-adapter-to-nextjs
  - https://solana.com/developers/guides/advanced/idls

### Secondary (MEDIUM confidence)
- Next.js GitHub discussions -- Turbopack resolve fallback patterns
  - https://github.com/vercel/next.js/discussions/84809
  - https://github.com/vercel/next.js/discussions/72001
- Solana anchor-web3js-nextjs template (official Solana developers)
  - https://github.com/solana-developers/anchor-web3js-nextjs
- Next.js 16 blog post
  - https://nextjs.org/blog/next-16

### Tertiary (LOW confidence)
- Community article on Next.js Turbopack WASM integration (pattern validation)
  - https://rikublock.dev/docs/tutorials/nextjs-turbo-wasm/
- Buffer polyfill article (general browser polyfill patterns)
  - https://medium.com/@kayaweb3/why-your-node-js-buffer-dependent-packages-stopped-working-in-the-browser

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified via official docs fetched 2026-02-15
- Architecture: HIGH -- patterns verified against Next.js 16.1.6 docs and Turbopack config reference
- Pitfalls: HIGH -- Buffer/polyfill issues confirmed via multiple official sources and GitHub discussions
- Drizzle schema: MEDIUM -- schema patterns from official docs, but exact column types for Solana amounts (bigint vs numeric) may need adjustment during implementation
- npm workspaces interaction: MEDIUM -- standard pattern but exact hoisting behavior with existing project deps needs validation during implementation

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days -- stable ecosystem, Next.js 16 is current major)
