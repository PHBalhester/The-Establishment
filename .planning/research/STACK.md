# Technology Stack: Frontend Tech Layer

**Project:** Dr. Fraudsworth's Finance Factory -- Frontend
**Researched:** 2026-02-15
**Overall Confidence:** MEDIUM (web verification tools unavailable during research; versions from npm registry could not be live-queried -- recommend `npm view <pkg> version` verification before installing)

---

## Context

This STACK.md covers ONLY the frontend technology layer. The on-chain protocol stack is complete and validated (see `.planning/research/STACK.md` v0.7 for that). The frontend must integrate with:

- **Anchor 0.32.1** with `@coral-xyz/anchor` 0.32.1 TS client
- **@solana/web3.js 1.98.4** (NOT v2 -- see critical constraint below)
- **@solana/spl-token 0.4.14** (Token-2022 operations)
- **5 on-chain programs** with generated IDL JSON and TypeScript types in `target/idl/` and `target/types/`
- **VersionedTransaction v0 with ALT** for sell-path transactions (23+ accounts)
- **PDA manifest** system at `scripts/deploy/pda-manifest.json`

---

## Critical Constraint: @solana/web3.js v1 Lock

**The entire frontend MUST use `@solana/web3.js` v1.x, NOT v2.x.**

The skill file at `.claude/skills/solana-dev/frontend-framework-kit.md` references `@solana/client`, `@solana/react-hooks`, and `@solana/kit`. These are all part of the **web3.js v2 ecosystem** (also called "Solana Kit" or "framework-kit"). **We cannot use any of these.**

Why:
1. `@coral-xyz/anchor` 0.32.1 depends on `@solana/web3.js` v1.x internally. Its `Program`, `Provider`, `BN`, `PublicKey`, `Transaction` types are all v1 types.
2. All 5 IDL type files in `target/types/` generate v1-compatible TypeScript.
3. All existing scripts (`swap-flow.ts`, `alt-helper.ts`, `carnage-flow.ts`, `staking-flow.ts`) use v1 APIs (`Connection`, `Transaction`, `VersionedTransaction`, `PublicKey.findProgramAddressSync`).
4. `@solana/wallet-adapter` (the established wallet connection library) works with web3.js v1.
5. Mixing v1 and v2 in the same app is not feasible -- they have incompatible `PublicKey` types, `Transaction` types, and connection abstractions.

**Verdict:** Use `@solana/wallet-adapter-*` (v1-compatible) for wallet connection. Use `@coral-xyz/anchor` 0.32.1 for transaction building. This is the same stack that 95%+ of Solana DeFi frontends use today.

**Confidence:** HIGH -- verified from installed `node_modules/@coral-xyz/anchor/package.json` showing v1 dependency chain.

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Next.js | ^15.x (verify with `npm view next version`) | React framework with SSR/SSG, API routes, App Router | Industry standard for Solana dApps. API routes serve as webhook endpoints for Helius. App Router provides clean layout composition. Static export possible for CDN deployment. Railway supports Next.js natively. |
| React | ^19.x (bundled with Next.js 15) | UI library | Comes with Next.js. Hooks model integrates well with wallet-adapter. |
| TypeScript | ^5.3+ (keep aligned with monorepo) | Type safety | Already in monorepo at ^5.3.2. Frontend tsconfig extends or parallels existing config. Critical for IDL type safety with Anchor programs. |

**Confidence:** MEDIUM for exact version numbers. Next.js 15 was released in Oct 2024; version 16 may exist by Feb 2026. Run `npm view next version` to confirm latest stable.

### Wallet Connection

| Technology | Version | Purpose | Why |
|---|---|---|---|
| @solana/wallet-adapter-react | ^0.15.x (verify) | React hooks for wallet connection | The established standard for Solana wallet integration. Provides `useWallet()`, `useConnection()`, `useAnchorWallet()` hooks. Works with web3.js v1. |
| @solana/wallet-adapter-wallets | ^0.19.x (verify) | Wallet implementations (Phantom, Solflare, Backpack, etc.) | Bundles popular wallet adapters. Import only what you need to reduce bundle size. |
| @solana/wallet-adapter-base | ^0.9.x (verify) | Base types and interfaces | Required peer dependency. Provides `WalletAdapter` interface. |
| @solana/wallet-adapter-react-ui | ^0.9.x (verify) | Pre-built wallet modal UI | Optional -- provides `<WalletMultiButton>` and `<WalletModalProvider>`. Good for initial unstyled build; replace with custom UI later. |

**Why NOT `@solana/kit` / framework-kit:** These require `@solana/web3.js` v2 which is incompatible with `@coral-xyz/anchor` 0.32.1. The wallet-adapter ecosystem is mature, well-tested, and what the existing Solana DeFi world uses.

**Confidence:** MEDIUM for exact versions. The wallet-adapter packages are actively maintained. Verify with `npm view @solana/wallet-adapter-react version`.

### Embedded Wallet (Privy)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| @privy-io/react-auth | ^2.x (verify with `npm view @privy-io/react-auth version`) | Embedded wallets + phone/email auth | Enables onboarding users who don't have Phantom/Solflare. Creates custodial wallets behind social login (phone, email, Google). Critical differentiator for memecoin audience. |

**Integration pattern with wallet-adapter:**

Privy and `@solana/wallet-adapter` serve complementary roles:
- wallet-adapter handles standard browser extension wallets (Phantom, Solflare, Backpack)
- Privy handles embedded wallets for users without extensions

The recommended pattern is:
1. Wrap the app with both `<PrivyProvider>` and `<WalletProvider>` (wallet-adapter)
2. Create a unified `useProtocolWallet()` hook that abstracts both
3. When Privy user connects, extract the Solana wallet from Privy and use it for transaction signing
4. When standard wallet connects, use wallet-adapter's `useWallet()` directly

**Confidence:** LOW for exact version and integration pattern. Privy's API may have changed significantly since training data. This needs phase-specific research with live docs at privy.io/docs before implementation.

**Critical concern:** Privy embedded wallets may have limitations with VersionedTransaction v0 (which we need for sell paths). Verify that Privy's `signTransaction` supports v0 messages before committing to this integration.

### Anchor Client (IDL Integration)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| @coral-xyz/anchor | 0.32.1 (MUST match monorepo) | Transaction building from IDL types | Already installed. Program types generated in `target/types/`. The frontend imports these types and uses `anchor.Program<T>` to build typed transactions. |

**How IDL integration works in the frontend:**

The existing pattern in `scripts/deploy/lib/connection.ts` shows exactly how to load programs from IDL:

```typescript
import { Amm } from "../../../target/types/amm";
const amm = new anchor.Program<Amm>(ammIdl, provider);
// Now amm.methods.swapSolBuy(...).accountsStrict({...}).instruction() is fully typed
```

For the frontend, the IDL JSON files from `target/idl/*.json` need to be copied or symlinked into the Next.js app. The type files from `target/types/*.ts` provide TypeScript types.

**Monorepo integration approach:**

```
dr-fraudsworth/
  programs/          # Existing Anchor programs
  target/
    idl/             # Generated IDL JSON (source of truth)
    types/           # Generated TypeScript types
  app/               # NEW: Next.js frontend
    src/
      idl/           # Copied or symlinked from target/idl/
      types/         # Copied or symlinked from target/types/
      lib/
        anchor.ts    # Program loading (adapted from scripts/deploy/lib/connection.ts)
```

**IMPORTANT:** The `@coral-xyz/anchor` version in the frontend package.json MUST be exactly 0.32.1 to match the IDL format generated by Anchor 0.32.1. Version mismatches between the CLI that generated the IDL and the client that reads it will cause silent deserialization failures.

**Confidence:** HIGH -- verified from existing `connection.ts` and `package.json`.

### Charting

| Technology | Version | Purpose | Why |
|---|---|---|---|
| lightweight-charts | ^4.x (verify with `npm view lightweight-charts version`) | TradingView-style OHLCV price charts | The standard for crypto price charts. Open source (Apache 2.0), maintained by TradingView. Small bundle (~45KB gzipped). Renders to HTML5 Canvas for performance. No React wrapper needed -- mount to a ref. |

**Integration pattern:**

```typescript
import { createChart } from 'lightweight-charts';

// In a React component with useRef + useEffect:
const chartRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  const chart = createChart(chartRef.current!, { width, height });
  const candleSeries = chart.addCandlestickSeries();
  candleSeries.setData(ohlcvData); // from Postgres via API route
  return () => chart.remove();
}, []);
```

**Data source:** OHLCV data comes from Helius webhook indexing (see below), stored in Postgres, served via Next.js API routes.

**Confidence:** MEDIUM for exact version. lightweight-charts v4 was the latest major at training cutoff. A v5 may exist.

### On-Chain Event Indexing

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Helius Webhooks (API) | N/A (REST API) | Index on-chain events into Postgres | Helius provides webhook subscriptions that POST transaction data to an endpoint when specified programs are invoked. No polling needed. We subscribe to our 5 program IDs and receive swap/epoch/staking events as they happen. |
| helius-sdk | ^1.x (verify with `npm view helius-sdk version`) | Helius API client for webhook management | TypeScript SDK for creating/managing webhooks, enhanced transactions, DAS API. Optional -- can also use raw REST API. |

**Webhook architecture:**

1. Next.js API route at `/api/webhooks/helius` receives POST from Helius
2. Parse transaction logs to extract swap amounts, prices, epoch transitions
3. Compute OHLCV candles and write to Postgres
4. Frontend fetches historical data from Postgres via API route
5. Real-time updates via WebSocket or polling (see State Management section)

**What to index:**
- AMM `swap_sol_buy` / `swap_sol_sell` events: extract amounts for price calculation
- Epoch `consume_randomness`: extract new epoch number, tax rates, cheap_side
- Staking `deposit_rewards`: extract yield amounts
- Carnage `execute_carnage_atomic`: extract rebalance details

**Alternative considered:** Geyser plugins or custom RPC websocket subscriptions. These are more complex to operate and Helius webhooks are the standard approach for Solana DeFi indexing. The existing codebase already uses Helius for RPC (as evidenced by "Helius free tier" comments in rate limiting).

**Confidence:** MEDIUM for SDK version. LOW for specific webhook payload format -- needs phase-specific research with Helius docs.

### Database

| Technology | Version | Purpose | Why |
|---|---|---|---|
| PostgreSQL | 16.x (Railway provides this) | Store OHLCV candles, indexed events, user analytics | Required for historical price charts. Helius webhooks push events; API routes compute and store candles. Railway offers managed Postgres with automatic backups. |
| Prisma | ^6.x (verify with `npm view prisma version`) | TypeScript ORM for Postgres | Type-safe database queries. Auto-generated types from schema. Migrations built-in. Industry standard for Next.js + Postgres. |

**Why Prisma over raw SQL or Drizzle:**
- Prisma has the best TypeScript integration and developer experience
- Auto-generated client from schema means compile-time type safety
- Migrations are declarative and reproducible
- Railway has first-class Prisma support

**Alternative considered:** Drizzle ORM is lighter weight and closer to SQL. Good choice if Prisma feels too heavy. Either works. Prisma recommended for its maturity and Railway integration.

**Schema outline:**

```prisma
model OhlcvCandle {
  id        Int      @id @default(autoincrement())
  pool      String   // "CRIME/SOL", "FRAUD/SOL", etc.
  interval  String   // "1m", "5m", "1h", "1d"
  openTime  DateTime
  open      Float
  high      Float
  low       Float
  close     Float
  volume    Float
  txCount   Int
  createdAt DateTime @default(now())

  @@unique([pool, interval, openTime])
  @@index([pool, interval, openTime])
}

model EpochEvent {
  id            Int      @id @default(autoincrement())
  epochNumber   Int
  cheapSide     String   // "crime" | "fraud"
  crimeBuyTax   Int      // basis points
  fraudBuyTax   Int      // basis points
  carnagePending Boolean
  slot          BigInt
  txSignature   String   @unique
  timestamp     DateTime
}
```

**Confidence:** MEDIUM for Prisma version. HIGH for Postgres choice (Railway documentation confirms managed Postgres).

### State Management

| Technology | Version | Purpose | Why |
|---|---|---|---|
| @tanstack/react-query | ^5.x (verify) | Server state management, caching, refetching | Handles all RPC data fetching: account state, balances, epoch info. Built-in caching, refetch intervals, stale-while-revalidate. Eliminates manual loading/error states. |
| zustand | ^5.x (verify) | Client-side state (UI state, transaction queue) | Lightweight store for UI-only state: selected pool, pending transactions, user preferences. Much simpler than Redux. No boilerplate. |

**Why this combination:**
- React Query handles "server state" (data from Solana RPC and Postgres API)
- Zustand handles "client state" (which pool tab is selected, is the swap modal open)
- They don't overlap or conflict
- Both are lightweight and well-typed

**What NOT to use:**
- Redux / Redux Toolkit: Overkill for this app. Massive boilerplate for no benefit.
- Jotai / Recoil: Fine alternatives to Zustand but less mainstream in the Solana ecosystem.
- `useState` everywhere: Leads to prop drilling and duplicated fetch logic. React Query solves this.

**Real-time data pattern:**

```typescript
// Poll EpochState every 30 seconds (epochs are ~5 min, no need for faster)
const { data: epochState } = useQuery({
  queryKey: ['epochState'],
  queryFn: () => fetchEpochState(connection, epochStatePda),
  refetchInterval: 30_000,
});

// Poll pool reserves every 10 seconds (for live price display)
const { data: poolReserves } = useQuery({
  queryKey: ['pool', poolName],
  queryFn: () => fetchPoolReserves(connection, poolPda),
  refetchInterval: 10_000,
});
```

**Why polling over WebSocket subscriptions:**
- Solana `connection.onAccountChange()` WebSocket subscriptions are unreliable on public/free tier RPC nodes (dropped connections, rate limits)
- Polling with React Query's `refetchInterval` is simpler, more predictable, and handles errors gracefully
- For the data we need (epoch state changes every ~5 min, prices change per swap), 10-30 second polling is more than adequate
- If using Helius paid tier with reliable WebSocket, can upgrade to subscriptions later

**Confidence:** MEDIUM for versions. HIGH for the pattern recommendation.

### Styling

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Tailwind CSS | ^4.x (verify with `npm view tailwindcss version`) | Utility-first CSS | Industry standard for React apps. Pairs well with Next.js (first-class support). Eliminates CSS file management. Co-locates styling with markup. The "functional but unstyled" milestone means layout and structure without polished visuals -- Tailwind is perfect for this because utility classes establish structure that can be refined later. |

**Why NOT component libraries (Chakra, Mantine, shadcn/ui):**
- This milestone is explicitly "functional but unstyled"
- Component libraries impose design opinions we may not want
- Tailwind gives structure without visual commitment
- If we add shadcn/ui later, it builds on Tailwind (compatible)

**Confidence:** MEDIUM for exact version. Tailwind v4 was in development at training cutoff; may or may not be the current stable. v3.4.x is safe fallback.

### Deployment

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Railway | N/A (PaaS) | Next.js hosting + Postgres | Specified in project requirements. Supports Next.js (including API routes and SSR). Managed Postgres add-on. Automatic HTTPS. GitHub deploy integration. |

**Railway deployment requirements:**

1. **Build command:** `next build` (standard)
2. **Start command:** `next start` (standard)
3. **Environment variables:**
   - `NEXT_PUBLIC_SOLANA_RPC_URL` -- Helius RPC endpoint (or public devnet for now)
   - `NEXT_PUBLIC_SOLANA_CLUSTER` -- "devnet" or "mainnet-beta"
   - `NEXT_PUBLIC_PRIVY_APP_ID` -- Privy application ID
   - `HELIUS_API_KEY` -- Server-side only, for webhook management
   - `HELIUS_WEBHOOK_SECRET` -- Server-side only, for webhook signature verification
   - `DATABASE_URL` -- Postgres connection string (Railway provides this)
4. **Postgres add-on:** Create via Railway dashboard, auto-injects `DATABASE_URL`
5. **Root directory:** Set to `app/` in Railway if monorepo (Next.js lives in `app/` subdirectory)

**Confidence:** MEDIUM. Railway's Next.js support is well-established but specific configuration may have changed.

---

## Monorepo Structure

The frontend app lives alongside the existing Anchor project. **Do NOT create a separate repository.**

```
dr-fraudsworth/                    # Existing project root
  Anchor.toml                      # Existing
  Cargo.toml                       # Existing workspace
  package.json                     # Existing (root) -- Anchor/test dependencies
  tsconfig.json                    # Existing (root) -- test/script TypeScript config
  programs/                        # Existing Anchor programs
  target/
    idl/                           # Generated IDL JSON
    types/                         # Generated TypeScript types
  tests/                           # Existing Anchor tests
  scripts/                         # Existing deployment/e2e scripts
  keypairs/                        # Existing keypairs (gitignored)
  app/                             # NEW: Next.js frontend
    package.json                   # Frontend-specific dependencies
    tsconfig.json                  # Frontend TypeScript config (separate from root)
    next.config.ts                 # Next.js configuration
    tailwind.config.ts             # Tailwind configuration
    postcss.config.mjs             # PostCSS config (Tailwind needs this)
    prisma/
      schema.prisma                # Database schema
    src/
      app/                         # Next.js App Router pages
        layout.tsx                 # Root layout with providers
        page.tsx                   # Home page
        api/
          webhooks/
            helius/
              route.ts             # Helius webhook receiver
          candles/
            route.ts               # OHLCV data API
      components/                  # React components
      hooks/                       # Custom hooks (useProtocolWallet, useSwap, etc.)
      lib/
        anchor.ts                  # Anchor program loading (adapted from scripts/deploy/lib/connection.ts)
        pda.ts                     # PDA derivation (adapted from scripts/deploy/lib/pda-manifest.ts)
        transactions/
          swap.ts                  # Swap TX building (adapted from scripts/e2e/lib/swap-flow.ts)
          stake.ts                 # Stake TX building (adapted from scripts/e2e/lib/staking-flow.ts)
          alt.ts                   # ALT/v0 TX helper (adapted from scripts/e2e/lib/alt-helper.ts)
      idl/                         # Copied from target/idl/ (build step)
      types/                       # Copied from target/types/ (build step)
      stores/                      # Zustand stores
```

**Why `app/` subdirectory instead of mixing with root:**
1. Separate `package.json` avoids dependency conflicts (Next.js wants React 19, Anchor tests don't use React at all)
2. Separate `tsconfig.json` lets the frontend use `"jsx": "react-jsx"` and `"module": "esnext"` while the root uses `"module": "commonjs"` for Anchor tests
3. Railway can point to the `app/` directory specifically
4. `anchor build` and `anchor test` are unaffected by the frontend directory

**IDL sync build step:**

Add a script to `app/package.json`:

```json
{
  "scripts": {
    "sync-idl": "cp ../target/idl/*.json src/idl/ && cp ../target/types/*.ts src/types/",
    "prebuild": "npm run sync-idl",
    "dev": "npm run sync-idl && next dev",
    "build": "next build"
  }
}
```

This ensures IDL types are always current with the latest `anchor build` output.

---

## Frontend package.json

```json
{
  "name": "dr-fraudsworth-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "sync-idl": "cp ../target/idl/*.json src/idl/ && cp ../target/types/*.ts src/types/",
    "prebuild": "npm run sync-idl",
    "dev": "npm run sync-idl && next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "db:push": "prisma db push",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",

    "@coral-xyz/anchor": "0.32.1",
    "@solana/web3.js": "^1.95.5",
    "@solana/spl-token": "^0.4.9",

    "@solana/wallet-adapter-base": "^0.9",
    "@solana/wallet-adapter-react": "^0.15",
    "@solana/wallet-adapter-react-ui": "^0.9",
    "@solana/wallet-adapter-wallets": "^0.19",

    "@privy-io/react-auth": "^2",

    "@tanstack/react-query": "^5",
    "zustand": "^5",

    "lightweight-charts": "^4",

    "@prisma/client": "^6",

    "bs58": "^5"
  },
  "devDependencies": {
    "typescript": "^5.3",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",

    "tailwindcss": "^4",
    "postcss": "^8",

    "prisma": "^6",

    "eslint": "^9",
    "eslint-config-next": "^15"
  }
}
```

**IMPORTANT VERSION NOTES:**
- `@coral-xyz/anchor` is pinned to EXACTLY 0.32.1 (no caret). This MUST match the Anchor CLI version that generated the IDLs.
- `@solana/web3.js` uses `^1.95.5` to stay on v1.x. Do NOT allow v2.x.
- All `@solana/wallet-adapter-*` versions are approximate and MUST be verified with `npm view` before installing. The wallet-adapter ecosystem may have had breaking changes.
- Privy version is LOW confidence. Check privy.io/docs for current SDK version.

---

## Frontend tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      { "name": "next" }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Key differences from root tsconfig:**
- `"module": "esnext"` instead of `"commonjs"` (Next.js uses ESM)
- `"jsx": "preserve"` (Next.js handles JSX compilation)
- `"moduleResolution": "bundler"` (Next.js bundler resolution)
- `"strict": true` (tighter than root's `"strict": false` -- better for new code)
- Path alias `@/*` for clean imports

---

## Reusable Code from Existing Scripts

The existing e2e scripts contain battle-tested patterns that the frontend should adapt (not copy-paste -- adapt for browser context):

| Existing Script | Frontend Adaptation | What Changes |
|---|---|---|
| `scripts/deploy/lib/connection.ts` | `app/src/lib/anchor.ts` | Replace file-based wallet loading with wallet-adapter's `useAnchorWallet()`. Replace file-based IDL loading with JSON import. |
| `scripts/deploy/lib/pda-manifest.ts` | `app/src/lib/pda.ts` | Keep PDA derivation logic. Remove file I/O. Export derivation functions for use in hooks. |
| `scripts/e2e/lib/swap-flow.ts` | `app/src/lib/transactions/swap.ts` | Keep instruction building. Remove logging infrastructure. Return `TransactionInstruction[]` instead of sending directly. Let wallet-adapter handle signing. |
| `scripts/e2e/lib/alt-helper.ts` | `app/src/lib/transactions/alt.ts` | Keep ALT loading and v0 message compilation. Remove ALT creation (already exists on devnet). Hardcode or fetch ALT address from config. |
| `scripts/e2e/lib/staking-flow.ts` | `app/src/lib/transactions/stake.ts` | Keep instruction building. Remove test-specific token minting. |
| `scripts/e2e/lib/carnage-flow.ts` | Not needed in frontend | Carnage is bot-operated (overnight runner), not user-initiated. Frontend only displays Carnage results. |

**Critical browser considerations:**
1. No `fs` module -- IDLs must be bundled as JSON imports
2. No `Keypair.fromSecretKey` -- wallet-adapter provides signing
3. `sendV0Transaction` pattern must be adapted to use wallet-adapter's `signTransaction` + `connection.sendRawTransaction`
4. Rate limiting (`RPC_DELAY_MS`) is less relevant in frontend (one user, not batch operations)

---

## What NOT to Add

| Technology | Why NOT |
|---|---|
| `@solana/web3.js` v2 / `@solana/kit` / `@solana/client` / `@solana/react-hooks` | Incompatible with `@coral-xyz/anchor` 0.32.1. Would require rewriting all program interaction code. The skill file `frontend-framework-kit.md` documents the v2 ecosystem but we cannot use it. |
| Redux / MobX / XState | Overkill. React Query + Zustand covers all state management needs with minimal boilerplate. |
| GraphQL / Apollo | No GraphQL API exists. Helius webhooks push data; we serve it via REST API routes. GraphQL adds complexity for no benefit. |
| Socket.io / Pusher | Unnecessary real-time infrastructure. React Query polling at 10-30s intervals is sufficient for DeFi dashboard. WebSocket subscriptions can be added later if needed. |
| Chakra UI / Mantine / Material UI | This milestone is "functional but unstyled." Component libraries impose design opinions. Tailwind provides structure without visual commitment. |
| Docker | Not needed for Railway deployment. Railway builds from source directly. Docker adds local dev complexity for no benefit in this context. |
| Turborepo / Nx / pnpm workspaces | The monorepo has only 2 packages (root + app/). A monorepo tool adds configuration overhead that isn't justified for 2 packages. Simple `npm` in each directory is sufficient. |
| Web3Auth / Magic | Privy is the chosen embedded wallet solution. Don't add competing auth solutions. |
| Jupiter SDK / Orca SDK | We have our own AMM. These are for interacting with other AMMs on Solana. Not relevant. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|---|---|---|---|
| Framework | Next.js 15 | Vite + React | Next.js provides API routes (needed for webhooks), SSR (needed for SEO/sharing), and Railway has first-class support. Vite would require a separate backend for webhook endpoints. |
| Wallet connection | @solana/wallet-adapter | Custom WalletStandard integration | wallet-adapter is the established abstraction. No need to reinvent. |
| ORM | Prisma | Drizzle ORM | Drizzle is lighter and closer to SQL, which is nice. But Prisma has better Railway integration and is more widely used in the Next.js ecosystem. Either would work. |
| Charting | lightweight-charts | recharts / Highcharts / Apache ECharts | lightweight-charts is purpose-built for financial OHLCV charts. Other charting libraries are general-purpose and don't have candlestick/volume charts as first-class features. |
| State management | React Query + Zustand | React Query + Context | Zustand is more ergonomic than Context for complex client state. Context causes unnecessary re-renders. |
| Styling | Tailwind CSS | CSS Modules / styled-components | Tailwind co-locates styling with markup, which is faster for rapid iteration. CSS Modules fragment styling across files. styled-components has runtime cost. |
| Database | Postgres (Railway) | SQLite / Turso | Postgres is the standard for production web apps. SQLite is for embedded use cases, not multi-connection web servers. |
| Hosting | Railway | Vercel / Fly.io | Railway was specified in the project requirements. Vercel would also work (excellent Next.js support) but project specifies Railway. |

---

## Version Verification Checklist

**Before installing dependencies, run these commands to get current versions:**

```bash
export PATH="/opt/homebrew/bin:$PATH"

# Core framework
npm view next version
npm view react version

# Wallet adapter
npm view @solana/wallet-adapter-react version
npm view @solana/wallet-adapter-wallets version
npm view @solana/wallet-adapter-base version
npm view @solana/wallet-adapter-react-ui version

# Privy
npm view @privy-io/react-auth version

# Data management
npm view @tanstack/react-query version
npm view zustand version

# Charting
npm view lightweight-charts version

# Database
npm view prisma version
npm view @prisma/client version

# Indexing
npm view helius-sdk version

# Styling
npm view tailwindcss version

# Verify Anchor client compatibility
npm view @coral-xyz/anchor version
```

Update the `package.json` versions above with the actual current versions before installing.

---

## Compatibility Matrix

| Package A | Version | Compatible With | Notes |
|---|---|---|---|
| @coral-xyz/anchor (TS) | 0.32.1 | @solana/web3.js 1.x | MUST stay on v1.x. v2 is incompatible. |
| @solana/wallet-adapter-react | ^0.15.x | @solana/web3.js 1.x | Uses v1 internally. |
| @solana/wallet-adapter-react | ^0.15.x | React 18 or 19 | Verify React 19 compatibility before installing. May need ^0.16+ for React 19. |
| Next.js | ^15.x | React 19 | Next.js 15 ships with React 19 support. |
| @privy-io/react-auth | ^2.x | React 18 or 19 | VERIFY React 19 compatibility. May be an issue. |
| lightweight-charts | ^4.x | React 18/19 | Framework-agnostic (canvas-based). No React dependency. |
| Prisma | ^6.x | Node.js 18+ | Railway runs Node 18+. |
| @tanstack/react-query | ^5.x | React 18 or 19 | React 19 compatible. |

**React 19 risk:** Several packages in the Solana ecosystem may not yet support React 19 (wallet-adapter, Privy). If compatibility issues arise, use Next.js 14 with React 18. This is a safe fallback. Research this during phase implementation.

**Confidence:** MEDIUM for compatibility claims. These need live verification.

---

## Sources

| Source | Confidence | What It Informed |
|---|---|---|
| `node_modules/@coral-xyz/anchor/package.json` (installed v0.32.1) | HIGH | Anchor v1 web3.js dependency lock |
| `node_modules/@solana/web3.js/package.json` (installed v1.98.4) | HIGH | Current web3.js version in monorepo |
| `node_modules/@solana/spl-token/package.json` (installed v0.4.14) | HIGH | Token program client version |
| `scripts/deploy/lib/connection.ts` (project code) | HIGH | IDL loading pattern for frontend adaptation |
| `scripts/e2e/lib/swap-flow.ts` (project code) | HIGH | Swap instruction building pattern |
| `scripts/e2e/lib/alt-helper.ts` (project code) | HIGH | VersionedTransaction v0 + ALT pattern |
| `scripts/e2e/lib/staking-flow.ts` (project code) | HIGH | Staking instruction building pattern |
| `scripts/e2e/lib/user-setup.ts` (project code) | HIGH | Token account creation pattern |
| `.claude/skills/solana-dev/frontend-framework-kit.md` (skill file) | MEDIUM | Documents v2 ecosystem (NOT usable, but informative for context) |
| `.planning/research/STACK.md` (v0.7 research) | HIGH | Existing version compatibility matrix |
| Training data: Next.js, wallet-adapter, Privy, React Query, Zustand, Tailwind, Prisma, lightweight-charts | MEDIUM | Library selection and version ranges. May be 6-18 months stale. |
| Training data: Railway deployment patterns | MEDIUM | Deployment configuration |
| Training data: Helius webhook API | LOW | Webhook architecture. Needs live docs verification. |

---

## Summary for Roadmap

**The frontend stack is straightforward and well-established in the Solana ecosystem.** The key decisions are:

1. **web3.js v1, NOT v2:** Locked by Anchor 0.32.1. This is non-negotiable. Ignore the framework-kit skill file.
2. **Reuse existing patterns:** The scripts in `scripts/e2e/lib/` contain battle-tested transaction building code. Adapt for browser context, don't rewrite from scratch.
3. **Next.js in `app/` subdirectory:** Keeps frontend isolated from Anchor build toolchain. Separate package.json and tsconfig.
4. **React Query for RPC state, Zustand for UI state:** Clean separation. No Redux complexity.
5. **Privy needs careful validation:** Embedded wallets + VersionedTransaction v0 compatibility is the highest-risk integration point. Research during implementation phase.
6. **Helius webhooks for indexing:** Standard pattern for Solana DeFi. Next.js API routes receive webhook POSTs, write to Postgres.

**Riskiest decisions:**
- Privy + v0 transaction compatibility (must verify)
- React 19 compatibility with wallet-adapter and Privy (may need React 18 fallback)
- Exact library versions (all marked as needing npm verification)

**Safest decisions:**
- Next.js as framework (industry standard)
- wallet-adapter for standard wallets (universal in Solana ecosystem)
- Tailwind for styling (no design commitment yet)
- React Query for data fetching (well-established pattern)
- Prisma + Postgres for chart data (boring technology, which is good)
