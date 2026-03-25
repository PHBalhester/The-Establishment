# Phase 69: Devnet Ecosystem Relaunch - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Build all 6 programs (AMM, Tax, Epoch, Staking, Transfer Hook, Conversion Vault), deploy as a fresh devnet ecosystem, initialize the full protocol state, update the frontend + crank runner, and validate everything end-to-end. This is the operational deployment of all DBS changes (PROFIT pool removal + vault addition).

</domain>

<decisions>
## Implementation Decisions

### Deploy Sequencing
- **Fresh deploy** — new program keypairs, new mints, new pools, new ALT. No in-place upgrades. Cleanest state, no legacy baggage.
- **Build all 6 programs at once** — `anchor build` for the full workspace. DBS phases 1-7 already validated incremental compilation. This is the "ship it" phase.
- **Fully scripted initialization** — single `npx tsx scripts/deploy/initialize.ts` runs all 13 steps. Fails fast on any error. Re-runnable with idempotent checks. No manual checkpoints.
- **Stop crank, deploy, restart** — pause Railway crank runner, do the fresh deploy, update crank config for new addresses, restart. Brief downtime acceptable on devnet.
- **Keep it simple for devnet** — direct keypair deploy + init script. Mainnet deployment rehearsal (Squads multisig, bytecode verification, staged authority) is a separate future phase.

### Data Migration & State
- **All existing devnet state abandoned** — old mints, old pools, old staking positions, old ALT. Fresh start.
- **SOL pool liquidity: 2.5 SOL per pool** — CRIME/SOL gets 290M CRIME + 2.5 SOL. FRAUD/SOL gets 290M FRAUD + 2.5 SOL. Conserves devnet SOL.
- **Vault seeding: 250M CRIME + 250M FRAUD + 20M PROFIT** — all 20M PROFIT goes to vault. No pre-seeded StakeVault. Users convert CRIME/FRAUD to PROFIT via vault, then stake. Staking rewards are SOL yield, not PROFIT emissions.
- **All three mints get MetadataPointer extension** — CRIME, FRAUD, and PROFIT. On-chain metadata includes: token name, symbol, and URI linking to x.com.
- **Token distribution summary:**
  - CRIME: 1B total → 460M bonding curve + 290M SOL pool + 250M vault
  - FRAUD: 1B total → 460M bonding curve + 290M SOL pool + 250M vault
  - PROFIT: 20M total → 20M vault (100%)

### Validation Strategy
- **Full regression suite** — no shortcuts. Rust tests (~280+), TypeScript build, integration tests on local validator, E2E scripts on devnet, manual spot checks.
- **Full bidirectional arb loop validation** — test both SOL→CRIME→PROFIT→FRAUD→SOL AND SOL→FRAUD→PROFIT→CRIME→SOL. Plus all 4 vault conversion directions (CRIME↔PROFIT, FRAUD↔PROFIT).
- **Crank: start and watch logs** — start Railway crank immediately after deploy, monitor logs for the first few epochs. No manual epoch pre-testing.
- **Frontend updated in this phase** — update shared/constants.ts with new addresses, rebuild, redeploy to Railway. Full stack validation including the live web app.

### Claude's Discretion
- Exact program deploy ordering (which of the 6 goes first)
- Whether to generate new program keypairs or reuse existing ones
- ALT address composition (which addresses to include)
- Specific E2E test script modifications for vault paths
- Crank runner config changes for new program IDs

</decisions>

<specifics>
## Specific Ideas

- "We should probably practice with how we're gonna deploy to mainnet" — user wants the devnet deploy to inform mainnet process, but mainnet rehearsal itself is deferred
- "Devnet has loads more than 30 SOL now" — SOL budget is not a constraint
- "If we pre-staked PROFIT who would earn the rewards?" — confirms no pre-seeded StakeVault; all PROFIT distributed through vault conversion
- All 3 mints should have metadata with "the token name and a link to x.com"

</specifics>

<deferred>
## Deferred Ideas

- **Mainnet deployment rehearsal** — Squads multisig flow, bytecode verification, staged authority handoff, tiered timelock. Separate phase.
- **Bonding curve execution** — the 460M allocation per IP token. Not activated in devnet relaunch.

</deferred>

---

*Phase: 69-devnet-ecosystem-relaunch*
*Context gathered: 2026-02-26*
