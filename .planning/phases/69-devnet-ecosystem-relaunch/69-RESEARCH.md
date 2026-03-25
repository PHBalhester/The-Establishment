# Phase 69: Devnet Ecosystem Relaunch - Research

**Researched:** 2026-02-26
**Domain:** Solana program deployment, protocol initialization, devnet lifecycle
**Confidence:** HIGH

## Summary

This phase deploys all 6 programs (AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault) as a fresh devnet ecosystem with new mint keypairs, new pools, a new ALT, and updated frontend + crank runner. All DBS changes (PROFIT pool removal, vault addition, tax split update) are already code-complete (DBS phases 1-7 done, phase 8 documentation in progress).

The deployment infrastructure is **already production-ready** from Phase 33-34. The key scripts (`build.sh`, `deploy.sh`, `initialize.ts`, `verify.ts`, `deploy-all.sh`) already support all 6 programs including the conversion vault. The primary work is: (1) deciding whether to reuse or regenerate program keypairs, (2) deleting old mint keypairs to force fresh mints, (3) updating seed liquidity amounts to match CONTEXT.md decisions, (4) updating `.env` overrides, (5) updating `shared/constants.ts` + `shared/programs.ts` with new addresses post-deploy, (6) syncing IDLs to `app/idl/`, (7) updating Railway crank runner env vars, and (8) end-to-end validation.

**Primary recommendation:** Reuse existing program keypairs (keep same 6 program IDs), delete only `scripts/deploy/mint-keypairs/` and `keypairs/carnage-wsol.json` to force new mints, and let the existing deployment pipeline handle everything. This avoids touching `declare_id!` macros, `Anchor.toml`, or any Rust code.

## Standard Stack

### Core

| Library/Tool | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Anchor CLI | 0.32.1 | Program build + IDL generation | Already installed via AVM |
| Solana CLI | Latest stable | Program deployment + cluster interaction | Standard devnet tooling |
| `scripts/deploy/deploy-all.sh` | Existing | Full build-deploy-init-verify pipeline | Already handles all 6 programs |
| `scripts/deploy/patch-mint-addresses.ts` | Existing | Patches mint addresses into Rust `constants.rs` before build | Critical for vault program devnet feature |
| `scripts/e2e/devnet-e2e-validation.ts` | Existing | E2E validation with vault conversion tests | Already includes `runVaultTests` |

### Supporting

| Library/Tool | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `scripts/e2e/lib/alt-helper.ts` | Existing | Protocol-wide ALT creation/extension | After initialization, before E2E tests |
| `scripts/crank/crank-runner.ts` | Existing | 24/7 epoch advancement | After deploy validation |
| `scripts/deploy/verify.ts` | Existing | 36+ check verification with vault checks | Post-initialization |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reuse program keypairs | Generate new keypairs | New keypairs require updating `declare_id!` in 6 `lib.rs` files, `Anchor.toml` (12 entries), `shared/constants.ts` PROGRAM_IDS, all cross-program references in `constants.rs` files, crank IDLs. Massive blast radius for zero benefit on devnet. |
| Manual deploy steps | `deploy-all.sh` | Pipeline already orchestrates build+deploy+init+verify. Manual steps add human error risk. |

## Architecture Patterns

### Recommended Deployment Sequence

```
1. Pre-flight: Ensure DBS phase 8 is complete (or accepted as non-blocking)
2. Stop crank runner on Railway
3. Delete old mint keypairs + carnage-wsol to force fresh mints
4. Update .env with correct seed liquidity overrides
5. Run deploy-all.sh --devnet (builds, deploys, initializes, verifies)
6. Delete old alt-address.json, recreate ALT
7. Update shared/constants.ts + shared/programs.ts with new addresses
8. Sync IDLs: cp target/idl/*.json app/idl/
9. npm run build (Next.js production build)
10. Deploy frontend to Railway
11. Update Railway crank env vars (PDA_MANIFEST, CARNAGE_WSOL_PUBKEY)
12. Restart crank runner, monitor first few epochs
13. Run E2E validation on devnet
14. Run bidirectional arb loop validation
```

### Pattern 1: Reuse Program Keypairs, New Mint Keypairs
**What:** Keep the same 6 program IDs (they're already in `declare_id!`, `Anchor.toml`, cross-program references), but force new mints by deleting `scripts/deploy/mint-keypairs/`.
**When to use:** Devnet relaunch where programs have code changes but no need for address changes.
**Why:** The `initialize.ts` script auto-generates new mint keypairs on first run if the directory is empty. The `build.sh` script runs `patch-mint-addresses.ts` which reads these new keypairs and patches the Rust `constants.rs` files before compilation. This means new mint addresses flow through the entire pipeline automatically.

**Critical detail:** After new mints are generated, `build.sh` MUST be called with `--devnet` to rebuild the conversion vault with the correct devnet mint addresses compiled in. The vault's `constants.rs` has feature-gated mint functions:
```rust
#[cfg(feature = "devnet")]
pub fn crime_mint() -> Pubkey {
    Pubkey::from_str("F65o4zL6imL4g1HLuaqPaUg4K2eY8EPtGw4esD99XZhR").unwrap()
}
```

### Pattern 2: PDA Manifest as Single Source of Truth
**What:** After initialization, `scripts/deploy/pda-manifest.json` contains every address. All downstream consumers (shared/constants.ts, Railway env vars, ALT helper) read from or are updated from this manifest.
**When to use:** Every fresh deploy.
**Flow:**
```
initialize.ts generates pda-manifest.json
  -> manually update shared/constants.ts (MINTS, DEVNET_PDAS, DEVNET_POOLS, DEVNET_POOL_CONFIGS)
  -> manually update shared/programs.ts (DEVNET_ALT after ALT recreation)
  -> copy pda-manifest.json content to Railway PDA_MANIFEST env var
```

### Pattern 3: Seed Liquidity Override via .env
**What:** `tests/integration/helpers/constants.ts` reads `SOL_POOL_SEED_SOL_OVERRIDE` and `SOL_POOL_SEED_TOKEN_OVERRIDE` from environment. `deploy-all.sh` sources `.env` before running initialize.ts.
**When to use:** To set devnet-specific liquidity amounts.
**Context decision values:**
```
SOL_POOL_SEED_SOL_OVERRIDE=2500000000        (2.5 SOL per pool)
SOL_POOL_SEED_TOKEN_OVERRIDE=290000000000000  (290M tokens per pool)
```
**Current .env has 25 SOL** — this needs updating to 2.5 SOL per CONTEXT.md decision.

### Anti-Patterns to Avoid
- **Generating new program keypairs:** Cascading changes to `declare_id!`, `Anchor.toml`, cross-program references, frontend constants, crank IDLs. Not worth it for devnet.
- **Manual initialization steps:** Every step in `initialize.ts` is idempotent and ordered. Running individual steps manually risks missed dependencies.
- **Deploying before `patch-mint-addresses.ts`:** The vault program will have stale/wrong mint addresses compiled in. `build.sh` runs the patch automatically — do NOT skip step 0.
- **Forgetting `--devnet` flag:** Without it, `epoch_program` and `tax_program` compile with mainnet Switchboard PID and treasury address, and `conversion_vault` compiles with `Pubkey::default()` for all mints. Results in `ConstraintOwner` errors on devnet.
- **Updating shared/constants.ts BEFORE deploy:** The addresses aren't known until after initialization. Update constants AFTER the manifest is generated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Program build + deploy | Custom shell scripts | `deploy-all.sh` | Already orchestrates all 4 phases with error handling |
| Mint patching | Manual sed/grep | `patch-mint-addresses.ts` | Regex-based patching of feature-gated Rust functions |
| ALT creation | Manual createLookupTable | `alt-helper.ts` | Handles batching (30 per extend), activation wait, caching |
| PDA derivation | Manual findProgramAddressSync | `pda-manifest.ts` | Derives all ~25 PDAs from canonical seeds |
| Transfer Hook remaining_accounts | Manual pubkey array construction | `initialize.ts` helper functions | Handles canonical ordering, hook partitioning, whitelist PDA derivation |
| Vault conversion E2E | Manual convert instruction | `runVaultTests()` in swap-flow.ts | Tests all 4 conversion directions with hook accounts |

**Key insight:** The entire deployment pipeline was built in Phases 33-34 and battle-tested across 3 prior deploys. There is zero reason to rebuild any of it.

## Common Pitfalls

### Pitfall 1: Stale Mint Addresses in Vault Program
**What goes wrong:** Conversion vault's `constants.rs` has hardcoded devnet mint addresses. If you generate new mints but don't rebuild the vault with `--devnet`, the vault will reject all mints as `InvalidMintPair`.
**Why it happens:** `build.sh` step 0 runs `patch-mint-addresses.ts` which patches the Rust source, but the `--devnet` rebuild only happens if you pass the flag.
**How to avoid:** Always use `build.sh --devnet` or `deploy-all.sh` (which should be modified to pass --devnet for devnet deploys).
**Warning signs:** `InvalidMintPair` error on vault initialization or vault conversion.

### Pitfall 2: Seed Liquidity Amount Mismatch
**What goes wrong:** CONTEXT.md says 2.5 SOL per pool, but the current `.env` has 25 SOL. If not updated, 50 SOL gets locked in pool seed liquidity instead of 5 SOL.
**Why it happens:** The `.env` override was set for the previous deployment's target amounts and wasn't updated.
**How to avoid:** Update `.env` BEFORE running deploy-all.sh. Set `SOL_POOL_SEED_SOL_OVERRIDE=2500000000` (2.5 SOL in lamports).
**Warning signs:** Wallet balance drops more than expected during initialization.

### Pitfall 3: Vault Seeding Amounts in initialize.ts vs CONTEXT.md
**What goes wrong:** `initialize.ts` has hardcoded `VAULT_SEED_CRIME = 250_000_000_000_000` (250M) which matches CONTEXT.md's mainnet target, but the deployment-sequence.md shows devnet amounts of only 10,000 CRIME / 10,000 FRAUD / 1,000 PROFIT.
**Why it happens:** `initialize.ts` was recently updated for the DBS vault redesign with production amounts. The deployment-sequence.md has different devnet amounts.
**How to avoid:** The CONTEXT.md is the authoritative decision source. It says: "Vault seeding: 250M CRIME + 250M FRAUD + 20M PROFIT" — these are the correct devnet amounts. The initialize.ts values match. The deployment-sequence.md devnet column is stale (from pre-DBS era).
**Warning signs:** None if using initialize.ts as-is.

### Pitfall 4: Mint Authority Not Burned After Seeding
**What goes wrong:** If the mint authority isn't burned, tokens can be inflated. The current `initialize.ts` Step 10 already handles this — it seeds the vault then burns mint authority in the same step.
**Why it happens:** Would only happen if someone comments out the burn section during debugging and forgets to uncomment.
**How to avoid:** Verify.ts checks `MintAuthority Burned` for all 3 mints. Run verify after initialize.
**Warning signs:** Verify.ts FAIL on "CRIME/FRAUD/PROFIT MintAuthority Burned" checks.

### Pitfall 5: Crank Runner Address Staleness
**What goes wrong:** The Railway crank runner reads addresses from `PDA_MANIFEST` env var. If not updated after fresh deploy, it reads old addresses and fails to find accounts.
**Why it happens:** Railway env vars are set manually via dashboard. The manifest changes on every fresh deploy.
**How to avoid:** Copy the new `pda-manifest.json` content to the `PDA_MANIFEST` Railway env var. Also update `CARNAGE_WSOL_PUBKEY` with the new carnage WSOL address.
**Warning signs:** Crank runner fails with "account not found" on first cycle.

### Pitfall 6: Frontend Hardcoded Addresses
**What goes wrong:** `shared/constants.ts` has 20+ hardcoded addresses (MINTS, DEVNET_PDAS, DEVNET_POOLS, DEVNET_POOL_CONFIGS, DEVNET_PDAS_EXTENDED). If any are stale, frontend transactions fail.
**Why it happens:** These are manually maintained, not auto-generated.
**How to avoid:** After deploy, systematically update every section of `shared/constants.ts` from `pda-manifest.json`. Also update `shared/programs.ts` DEVNET_ALT.
**Warning signs:** Frontend "account not found" errors on any swap/stake/claim.

### Pitfall 7: deploy-all.sh Doesn't Pass --devnet
**What goes wrong:** `deploy-all.sh` calls `build.sh` without `--devnet`. Feature-flagged programs compile with mainnet values.
**Why it happens:** `deploy-all.sh` delegates to `build.sh` on line 77: `bash scripts/deploy/build.sh` (no --devnet flag). The user must remember to pass it.
**How to avoid:** Either modify `deploy-all.sh` to detect devnet cluster URL and auto-add `--devnet`, or manually run `build.sh --devnet` before `deploy-all.sh`, or add `--devnet` to the build.sh invocation in deploy-all.sh.
**Warning signs:** `ConstraintOwner` errors on epoch transition or tax swap, `InvalidMintPair` on vault operations.

### Pitfall 8: IDL Sync After Build
**What goes wrong:** `app/idl/*.json` files (used by frontend + crank runner) contain the program address in their `address` field. If not synced after a build that changes program IDs (or even after an `anchor build` that regenerates IDLs), the frontend uses stale IDLs.
**Why it happens:** IDL sync is manual (`cp target/idl/*.json app/idl/`).
**How to avoid:** Always sync IDLs after `anchor build`. The crank runner uses `app/idl/` IDLs, so stale IDLs = wrong program addresses in the Program constructor.
**Warning signs:** Transaction simulation fails with "program mismatch" or "unrecognized instruction".

### Pitfall 9: Token Supply Mismatch
**What goes wrong:** `initialize.ts` mints 1B tokens per mint (`ADMIN_MINT_AMOUNT = 1_000_000_000_000_000`). CONTEXT.md says PROFIT total supply = 20M. But 1B is minted, then only 20M goes to vault, and mint authority is burned. The remaining 980M PROFIT sits in the admin token account forever.
**Why it happens:** Initialize.ts mints a fixed 1B for all 3 tokens for simplicity, then distributes specific amounts.
**How to avoid:** This is technically fine — the admin account balance is "unrecoverable dead supply" once mint authority is burned. But if you want clean token economics, mint only the exact amounts needed. For devnet this doesn't matter.
**Warning signs:** Token explorer shows total supply of 1B PROFIT instead of 20M. But circulating supply (vault + staked) will be correct.

**Decision needed:** Should initialize.ts mint exact supply amounts (460M+290M+250M CRIME = 1B, 20M PROFIT) or continue minting 1B of everything? For devnet, the current approach works. For mainnet, exact minting is important for tokenomics transparency.

## Code Examples

### Fresh Deploy Workflow (Devnet)

```bash
# Source environment
source "$HOME/.cargo/env"
export PATH="/Users/mlbob/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# 1. Delete old mint keypairs + carnage WSOL to force fresh generation
rm -rf scripts/deploy/mint-keypairs/
rm -f keypairs/carnage-wsol.json
rm -f scripts/deploy/alt-address.json

# 2. Update .env seed liquidity (per CONTEXT.md: 2.5 SOL per pool)
# Edit .env: SOL_POOL_SEED_SOL_OVERRIDE=2500000000

# 3. Build with devnet flag
./scripts/deploy/build.sh --devnet

# 4. Deploy all 6 programs
./scripts/deploy/deploy.sh https://api.devnet.solana.com

# 5. Initialize protocol
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/initialize.ts

# 6. Verify deployment
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/verify.ts

# 7. Recreate ALT
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/e2e/lib/alt-helper.ts

# 8. Update shared/constants.ts from pda-manifest.json
# 9. Sync IDLs: cp target/idl/*.json app/idl/
# 10. npm run build
# 11. Deploy to Railway
# 12. Update Railway env vars
# 13. Restart crank
# 14. Run E2E validation
```

### Address Update Checklist (Post-Deploy)

Files that need manual address updates after fresh deploy:

```
shared/constants.ts:
  - MINTS.CRIME, MINTS.FRAUD, MINTS.PROFIT (3 mint addresses)
  - DEVNET_PDAS (EpochState, CarnageFund, CarnageSolVault)
  - DEVNET_POOLS (CRIME_SOL.pool, FRAUD_SOL.pool)
  - DEVNET_POOL_CONFIGS (pool, vaultA, vaultB for each pool)
  - DEVNET_PDAS_EXTENDED (SwapAuthority, TaxAuthority, StakePool, EscrowVault, StakeVault, WsolIntermediary)
  - TOKEN_PROGRAM_FOR_MINT (keyed by mint base58 — must match new MINTS)

shared/programs.ts:
  - DEVNET_ALT (new ALT address after recreation)

app/idl/*.json:
  - All 6 IDL files synced from target/idl/

Railway env vars:
  - PDA_MANIFEST (full JSON content of pda-manifest.json)
  - CARNAGE_WSOL_PUBKEY (new carnage WSOL account address)
```

### Vault Conversion Validation Commands

```bash
# After deploy, test all 4 vault directions:
# (handled by runVaultTests in scripts/e2e/lib/swap-flow.ts)
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/e2e/devnet-e2e-validation.ts
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PROFIT AMM pools (4 pools total) | Conversion Vault (2 SOL pools + vault) | DBS Phase 1-7 | PROFIT price discovery replaced with fixed 100:1 rate |
| 75/24/1 tax split | 73.5/24/2.5 tax split | DBS Phase 3 | More to staking, trigger bounty replaces treasury 1% |
| 5 programs | 6 programs (+ Conversion Vault) | DBS Phase 1 | New leaf-node program, no CPI surface |
| 540M tokens per SOL pool | 290M tokens per SOL pool | DBS Phase 2 | Reduced from old 4-pool distribution |
| PROFIT supply 1B | PROFIT supply 20M effective | DBS Phase 2 | 100% goes to vault for conversion |

## Open Questions

1. **deploy-all.sh --devnet flag passthrough**
   - What we know: `deploy-all.sh` calls `build.sh` without `--devnet`. The build step needs this flag for correct compilation.
   - What's unclear: Should we modify `deploy-all.sh` to accept and pass `--devnet`, or just document that users should run `build.sh --devnet` separately before `deploy.sh`?
   - Recommendation: Modify `deploy-all.sh` to accept `--devnet` and pass it to `build.sh`. Simple one-line change.

2. **PROFIT total supply: 1B minted vs 20M distributed**
   - What we know: `initialize.ts` mints 1B of each token. Only 20M PROFIT is distributed to vault. 980M sits in admin account with burned mint authority (unrecoverable).
   - What's unclear: Is this acceptable for devnet? Should we mint only 20M PROFIT?
   - Recommendation: For devnet, accept 1B mint. The admin account balance is dead supply. For mainnet, this should be exact (mint only what's needed). Devnet is not the place to optimize this.

3. **DBS Phase 8 completion dependency**
   - What we know: DBS Phase 8 (documentation updates) is "in_progress" (execution started). It's documentation-only with zero runtime risk.
   - What's unclear: Does Phase 69 need to wait for Phase 8 completion?
   - Recommendation: Phase 8 is non-blocking. Documentation updates don't affect program builds, deployment, or validation. Deploy can proceed in parallel. However, the Phase 8 docs update to `deployment-sequence.md` should be done before or alongside Phase 69 to keep docs accurate.

4. **Seed liquidity: CONTEXT.md says 2.5 SOL but also says "290M CRIME + 2.5 SOL"**
   - What we know: CONTEXT.md decision: "SOL pool liquidity: 2.5 SOL per pool". Current .env has 25 SOL. The token amount (290M) is controlled by the separate `SOL_POOL_SEED_TOKEN_OVERRIDE`.
   - What's unclear: The 290M token amount with only 2.5 SOL creates a very low price (~0.0000000086 SOL/token). Is this intentional?
   - Recommendation: Use the CONTEXT.md values as decided. For devnet, the exact price ratio doesn't matter much — it just needs to be functional for testing. 2.5 SOL conserves devnet SOL.

5. **E2E validation: Should it include full bidirectional arb loop?**
   - What we know: `devnet-e2e-validation.ts` already has swap tests and `runVaultTests`. CONTEXT.md requires "Full bidirectional arb loop validation" — SOL-CRIME-PROFIT-FRAUD-SOL and reverse.
   - What's unclear: Does the existing E2E script cover the full bidirectional loop, or does a new test need to be added?
   - Recommendation: Check if `runSwapFlow` + `runVaultTests` together cover the full loop. If not, add a dedicated arb loop test function. This is a minor E2E script addition.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: all 6 program source directories, deploy scripts, shared constants, crank runner
- `scripts/deploy/initialize.ts` — 1284 lines, 17-step initialization with vault support
- `scripts/deploy/build.sh` — handles 6 programs, devnet feature flag, patch-mint-addresses
- `scripts/deploy/deploy.sh` — deploys all 6 programs with keypair-based addressing
- `scripts/deploy/verify.ts` — 36+ checks including vault state verification
- `shared/constants.ts` — 408 lines, all hardcoded addresses that need updating
- `programs/conversion-vault/` — fully implemented with initialize + convert instructions
- `.dbs/STATE.json` — DBS phases 1-7 complete, phase 8 in progress

### Secondary (MEDIUM confidence)
- `Docs/deployment-sequence.md` — comprehensive but some devnet seed amounts are stale (pre-DBS)
- `69-CONTEXT.md` — user decisions from discuss phase, authoritative for this deployment

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools exist and are battle-tested (3 prior deploys)
- Architecture: HIGH — deployment pipeline, initialization sequence, and verification are proven
- Pitfalls: HIGH — identified from direct codebase analysis, prior deployment experience documented in MEMORY.md
- Open questions: MEDIUM — some items need user decision (mainly cosmetic/process choices)

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable infrastructure, no external dependency changes expected)
