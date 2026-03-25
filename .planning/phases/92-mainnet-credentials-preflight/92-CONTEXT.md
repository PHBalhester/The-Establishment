# Phase 92: Mainnet Credentials & Preflight - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Mainnet deployment has its own isolated credentials, environment config, and preflight safety checks -- nothing shared with devnet. Fresh deployer wallet, separate API keys for all services, env var inventory audit, and a preflight gate in the deploy pipeline that catches dangerous mistakes before any on-chain operations. Requirements: INFRA-08 through INFRA-12, INFRA-14.

</domain>

<decisions>
## Implementation Decisions

### Wallet Strategy
- Generate mainnet deployer wallet via `solana-keygen new`
- Store keypair JSON in `~/mainnet-keys/deployer.json` (outside repo, absolute path in .env.mainnet as `DEPLOYER_KEYPAIR`)
- Seed phrase written down on paper, stored physically separate from computer
- Wallet funded AFTER Phase 98 calculates exact SOL budget (budget + small buffer)
- Vanity mint keypairs already exist at `keypairs/mainnet-*-mint.json` (gitignored)

### Service Credentials
- **Helius**: Same Helius account, new separate API key for mainnet. Separate rate limits and billing visibility
- **Sentry**: Same Sentry project, environment tag ("devnet" vs "mainnet") for separation. Zero-dep sentry.ts already supports env tag in envelope
- **Railway**: Separate Railway service for mainnet frontend. Own URL, own Postgres, own logs. Devnet service stays up for testing
- **Webhooks**: Separate webhook endpoint on mainnet Railway service (/api/webhooks/helius). Different WEBHOOK_SECRET env var. Helius mainnet webhook points to mainnet Railway URL. Complete isolation

### Preflight Checks
- Integrated as Phase 0 in deploy-all.sh (not standalone) -- runs automatically, can't be skipped
- Checks performed before any on-chain operations:
  1. Git staging scan for keypair files (`git diff --cached` for .json in keypairs/ or keypair patterns)
  2. All required env vars present (full inventory from codebase audit)
  3. Deployer balance >= MAINNET_MIN_BALANCE (dynamic value set after Phase 98 budget calculation)
  4. Program binary SHA256 hashes match expected hashes from last verified build
- Pipeline exits with clear error on any preflight failure

### Env File Structure
- Root: `.env.devnet` (committed) + `.env.mainnet` (gitignored) -- crank runner shares these
- Frontend: `app/.env.devnet` + `app/.env.mainnet` -- Railway picks the right file via env vars
- Local dev: `app/.env.local` points to devnet (unchanged)
- `.env.devnet` stays committed to git (devnet credentials are non-sensitive, enables immediate contributor setup)
- Phase 92 performs full codebase audit of all env var references to build complete .env.mainnet with CHANGE_ME placeholders -- nothing missed
- Crank-specific vars (CARNAGE_WSOL_PUBKEY) added to root .env.{cluster} files

### Claude's Discretion
- Exact preflight error message formatting and exit codes
- How binary hash expectations are stored and compared (hash file vs deployment.json field)
- Order of preflight checks
- Which env vars are classified as required vs optional

</decisions>

<specifics>
## Specific Ideas

- Funding happens after Phase 98 -- not before. Phase 98 calculates exact budget with line items, then we add a buffer
- Preflight as Phase 0 in deploy-all.sh is non-negotiable -- discipline-dependent standalone scripts get forgotten
- Full env var inventory must be built by scanning actual code, not from memory -- catches vars we forgot about

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `deploy-all.sh`: Already has Phase 0 (mint keypairs) -- preflight becomes new Phase 0, existing phases shift
- `.env.devnet` / `.env.mainnet`: Already exist from Phase 91 with HELIUS_API_KEY, CLUSTER_URL, COMMITMENT, pool seed vars
- `.gitignore`: Already excludes `.env.mainnet`, `keypairs/mainnet-*`
- `app/lib/sentry.ts`: Zero-dep Sentry with fetch() envelope API -- supports environment tag natively
- `app/app/api/webhooks/helius/route.ts`: Webhook receiver -- needs WEBHOOK_SECRET env var
- `scripts/deploy/verify.ts`: Deep verification script from Phase 91 -- can validate deployer balance

### Established Patterns
- deploy-all.sh uses `set -e` with phased execution and cluster argument
- `.env.{cluster}` sourced at pipeline start with `set -a && source .env.{cluster} && set +a`
- All sensitive mainnet files gitignored, devnet files committed
- Vanity mint keypairs at `keypairs/mainnet-*-mint.json` already gitignored

### Integration Points
- deploy-all.sh Phase 0 (preflight) gates all subsequent phases
- .env.mainnet referenced by deploy-all.sh, initialize.ts, crank runner
- app/.env.mainnet referenced by Railway mainnet service
- DEPLOYER_KEYPAIR path used by `solana` CLI commands and Anchor deploy
- MAINNET_MIN_BALANCE set by Phase 98 (dependency -- use placeholder until then)

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 92-mainnet-credentials-preflight*
*Context gathered: 2026-03-12*
