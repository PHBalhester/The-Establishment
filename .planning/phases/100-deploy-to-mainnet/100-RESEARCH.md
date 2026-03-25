# Phase 100: Deploy to Mainnet - Research

**Researched:** 2026-03-15
**Domain:** Solana mainnet deployment execution (7 Anchor/Rust programs, 3 Token-2022 mints, bonding curves, Squads governance)
**Confidence:** HIGH

## Summary

Phase 100 is the actual execution of the 8-stage deployment checklist (Docs/mainnet-deploy-checklist.md) on Solana mainnet-beta. Unlike prior phases which built infrastructure and scripts, this phase is purely operational -- running existing, validated scripts against mainnet with real SOL.

The deployment pipeline is fully scripted (stage-0 through stage-7), validated by a fresh devnet deploy (Phase 98-03), and documented with GO/NO-GO gates between each stage. The CONTEXT.md decisions lock the timing strategy: Stages 0-4 pre-deployed 3-5 days before launch, Stage 5 at launch moment, Stage 6 after community fills curves (up to 48hr), Stage 7 after 24-48hr trading stability.

The primary risks are NOT technical (scripts work, pipeline is proven) but operational: mainnet transaction confirmation under congestion, mainnet priority fee calibration, the Squads signer setup with 1 file keypair + 1 Phantom + 1 Ledger, and the irreversible nature of each stage after Stage 5.

**Primary recommendation:** Plan this phase as a sequential checklist execution with explicit joint review checkpoints, pre-deploy verification, and decision gates -- NOT as code development tasks.

## Standard Stack

The entire deployment uses existing project tooling. No new libraries or tools needed.

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Solana CLI | 3.x | Program deploy, account inspection, balance checks | Project-standard, validated in Phase 98-03 |
| Anchor CLI | 0.32.x | Program build (build.sh orchestrator) | Project-standard |
| @sqds/multisig | Latest | Squads 2-of-3 multisig creation + authority transfer | Already used in Phase 97 |
| Helius RPC | Mainnet plan | Mainnet RPC endpoint, priority fee API, webhooks | Already configured in Phase 92 |
| Railway | Production | Frontend hosting (web), crank runner, Postgres | Already configured (Phase 98.1 provisions mainnet services) |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| UptimeRobot | Frontend + API health monitoring | Post-launch monitoring (Phase 98.1 sets up) |
| Sentry | Error tracking (zero-dependency lib/sentry.ts) | Active during all stages |
| Squads App (app.squads.so) | Ledger/Phantom approval of governance proposals | Stage 7 and post-launch |

### Alternatives Considered

None. The stack is locked by prior phases and CONTEXT.md decisions.

**Installation:**
No new packages. All dependencies are already installed.

## Architecture Patterns

### Deployment Pipeline Architecture

The 8-stage pipeline is the architecture. Each stage is an independently-runnable bash script with built-in prerequisites checks and GO/NO-GO gates.

```
Stage 0 (Preflight)     ─── read-only checks, 0 SOL
Stage 1 (Build)          ─── local compilation, 0 SOL
Stage 2 (Deploy 6 Core) ─── 6 programs deployed, ~20.79 SOL
Stage 3 (Initialize)     ─── mints, PDAs, config, ~0.1 SOL
Stage 4 (Infrastructure) ─── ALT, constants, IDLs, ~0.01 SOL
  ═══ JOINT REVIEW CHECKPOINT ═══  (3-5 days before launch)
  ═══ GAME-DAY DECISION POINT ═══
Stage 5 (LAUNCH)         ─── BC deploy + curves live, ~4.72 SOL
  ═══ FILL PERIOD (up to 48hr) ═══
Stage 6 (Graduation)     ─── pools, crank, trading, ~0.05 SOL
  ═══ STABILITY WINDOW (24-48hr) ═══
Stage 7 (Governance)     ─── Squads multisig, ~0.05 SOL
```

### Pattern 1: Pre-Deploy / Launch Separation

**What:** Stages 0-4 deploy all infrastructure days before launch. Only Stage 5 runs at launch time.
**Why:** Minimizes launch-day pressure. Pre-deployed programs sit inert until bonding curves activate.
**Anti-sniper:** Bonding curve program is deliberately withheld from Stage 2 -- deployed at Stage 5 to minimize bytecode analysis window for snipers.

### Pattern 2: Checkpoint/Resume Idempotency

**What:** All critical scripts (initialize.ts, graduate.ts) save progress to state files and skip completed steps on re-run.
**Why:** Mainnet transactions cost real SOL. If a script fails mid-way, re-running picks up where it left off without re-doing expensive operations.

### Pattern 3: Joint Review Checkpoint

**What:** After Stages 0-4, both team members review every deployed program, mint, PDA, ALT, and frontend connection before proceeding.
**Why:** Irreversibility increases dramatically after Stage 5. This is the last safe checkpoint.

### Pattern 4: Signer Architecture (Mainnet)

**What:** 1 file keypair (script proposer) + 1 Phantom browser wallet + 1 Ledger hardware wallet.
**Why:** File keypair runs setup-squads.ts and transfer-authority.ts to propose transactions. Phantom and Ledger approve via Squads web UI (app.squads.so). No CLI Ledger integration needed.

**Critical note from CONTEXT.md:** setup-squads.ts currently auto-generates devnet keypairs. For mainnet, it must be modified to accept pubkeys as arguments (for the Phantom and Ledger signers whose private keys are NOT file-based).

### Anti-Patterns to Avoid

- **Rushing Stage 5:** The CONTEXT.md explicitly says launch timing is a "game-day decision." Do not feel pressured to launch on a specific day if Stages 0-4 reveal issues.
- **Skipping the joint review:** Both team members must verify Stages 0-4 output together before proceeding.
- **Automating graduation:** graduate.ts is run manually after confirming both curves filled. No automation.
- **Transferring authority too early:** Deployer retains hot-fix capability during the critical 24-48hr window.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Priority fee estimation | Custom fee logic | Helius `getPriorityFeeEstimate` API | Already integrated in `/api/rpc` proxy. The API returns tier-based recommendations (min/low/medium/high/veryHigh). Use medium for standard ops, high for time-critical. |
| Transaction confirmation | Custom retry loops | Solana CLI `--max-sign-attempts` flag + `confirmOrThrow` helper | CLI handles blockhash retry. TypeScript scripts use existing `confirmOrThrow` pattern. |
| Multisig governance UI | Custom approval dashboard | Squads App (app.squads.so) | Phantom and Ledger approve directly through the Squads web interface. |
| Monitoring dashboard | Custom monitoring | UptimeRobot + Sentry + Helius dashboard | Already planned in Phase 98.1. |
| Curve fill monitoring | Custom alerting scripts | Frontend launch page gauges + UptimeRobot (CONTEXT.md decision) | User explicitly decided against custom alerting scripts. |

## Common Pitfalls

These are the 15 documented pitfalls from the validated checklist (Docs/mainnet-deploy-checklist.md), plus mainnet-specific additions.

### Pitfall 1: Forgetting to Source .env.mainnet

**What goes wrong:** Scripts use test defaults (10 SOL / 10K tokens for pool seeding). Pools CANNOT be re-seeded.
**Why it happens:** Running scripts without `set -a && source .env.mainnet && set +a` first.
**How to avoid:** Stage scripts auto-source the env file based on cluster argument. Always use stage scripts, never raw commands.
**Warning signs:** Pool seed amounts look suspiciously small.

### Pitfall 2: .env.mainnet Still Has CHANGE_ME Placeholders

**What goes wrong:** deploy-all.sh or stage scripts fail with missing variables.
**Why it happens:** .env.mainnet template has 8 CHANGE_ME_MAINNET placeholders that must be replaced before deployment.
**How to avoid:** Stage 0 checks for CHANGE_ME. Joint review checkpoint must verify all values populated.
**Current state:** .env.mainnet still has CHANGE_ME_MAINNET for: HELIUS_API_KEY, CLUSTER_URL, SOL_POOL_SEED_SOL_OVERRIDE, SOL_POOL_SEED_TOKEN_OVERRIDE, TREASURY_PUBKEY, WALLET_KEYPAIR, CARNAGE_WSOL_PUBKEY, PDA_MANIFEST, WEBHOOK_URL, HELIUS_WEBHOOK_SECRET.

### Pitfall 3: Building Without Mint Keypairs

**What goes wrong:** Programs compile with stale/placeholder mint addresses, causing `InvalidMintPair (6002)`.
**Why it happens:** 4 feature-flagged programs (vault, tax, epoch, bonding_curve) compile mint addresses into the binary.
**How to avoid:** Stage 0 copies mainnet vanity mint keypairs to `scripts/deploy/mint-keypairs/` before build. Vanity keypairs already exist.
**Verification:** Binary address cross-check in Stage 1 catches this.

### Pitfall 4: Using --devnet Flag for Mainnet Build

**What goes wrong:** Mainnet binary uses devnet Switchboard PID, devnet SLOTS_PER_EPOCH (750 instead of 4500), devnet treasury address.
**How to avoid:** `build.sh` without `--devnet` is the correct mainnet command. Stage 1 script handles this.

### Pitfall 5: Stale IDLs in Frontend

**What goes wrong:** Frontend sends transactions with wrong account layouts or program addresses.
**How to avoid:** Stage 4 explicitly syncs IDLs from `target/idl/` to `app/idl/`.

### Pitfall 6: Whitelist Authority Burn Timing

**What goes wrong:** Burning whitelist authority BEFORE whitelisting pool vaults permanently blocks all pool transfers.
**How to avoid:** graduate.ts Step 13 (burn) is LAST, after Step 9 (whitelist pool vaults). Do not reorder.

### Pitfall 7: Mainnet Priority Fees Too Low

**What goes wrong:** Transactions don't land during congestion.
**Why it happens:** Devnet doesn't need priority fees. Mainnet does.
**How to avoid:** Stage scripts use `--with-compute-unit-price 1` for program deploys (low priority, not time-critical during pre-deploy). For launch-day Stage 5, consider higher priority (e.g., 50000 micro-lamports) to ensure bonding curve deploys immediately.
**Recommendation:** Before Stage 5, check current priority fee levels via `solana fees --url mainnet-beta` or Helius API. Adjust `--with-compute-unit-price` accordingly.

### Pitfall 8: Devnet Addresses Baked Into Mainnet Binaries

**What goes wrong:** Feature-flagged programs contain devnet mint addresses.
**How to avoid:** Stage 1 includes binary address cross-check that greps .so files for devnet addresses.

### Pitfall 9: CARNAGE_WSOL_PUBKEY Missing on Railway

**What goes wrong:** Crank crashes with `ENOENT: no such file or directory`.
**How to avoid:** Set CARNAGE_WSOL_PUBKEY env var on Railway from `deployments/mainnet.json`.

### Pitfall 10: setup-squads.ts Signer Configuration for Mainnet

**What goes wrong:** Script auto-generates file keypairs, but mainnet needs 1 file + 1 Phantom pubkey + 1 Ledger pubkey.
**Why it happens:** Devnet script generates all 3 keypairs from files. Mainnet signers include non-file wallets.
**How to avoid:** Modify setup-squads.ts to accept pubkeys as arguments for non-file signers (Phantom and Ledger).
**Status:** Script needs modification for mainnet signer architecture per CONTEXT.md decisions.

### Pitfall 11: Insufficient SOL Balance

**What goes wrong:** Deploy fails mid-way, leaving partially deployed programs.
**How to avoid:** Budget is ~32 SOL (26.9 + 20% contingency). Stage 0 checks for minimum balance.
**Recommendation:** Fund deployer wallet with 35 SOL to be safe.

### Pitfall 12: Squads TX Creator Must Be Member

**What goes wrong:** Error 6005 (NotAMember) when creating vault transactions.
**How to avoid:** Use a signer keypair (the file keypair) as creator, not the deployer wallet (which is NOT a multisig member).

### Pitfall 13: skipPreflight Silent TX Failures

**What goes wrong:** Transactions appear "confirmed" but actually failed.
**How to avoid:** All scripts use `confirmOrThrow` helper that checks `confirmation.value.err`.

### Pitfall 14: Mainnet RPC Propagation Delay

**What goes wrong:** State reads return stale data immediately after a transaction.
**How to avoid:** Wait 2-3 seconds before reading state after writes. Scripts use appropriate delays.

### Pitfall 15: BorshCoder snake_case

**What goes wrong:** camelCase silently encodes zero bytes for pubkey fields, causing authority burns instead of transfers.
**How to avoid:** Already fixed in transfer-authority.ts (Phase 97). Verify script hasn't regressed.

### Pitfall 16 (NEW): Mainnet Commitment Level

**What goes wrong:** Using `confirmed` commitment instead of `finalized` for critical writes could cause state inconsistencies.
**How to avoid:** .env.mainnet uses `COMMITMENT=finalized` by default. This is correct for mainnet -- all state-changing operations should wait for finalization. Only switch to `confirmed` for read-only queries if latency matters.

## Code Examples

No new code needed. All scripts exist and are validated.

### Running Stage 0-4 (Pre-Deploy)

```bash
# Source env and run full pre-deploy pipeline
./scripts/deploy/deploy-all.sh mainnet
```

### Running Stage 5 (Launch)

```bash
# THE PUBLIC LAUNCH MOMENT
# Requires typing "LAUNCH" to confirm
./scripts/deploy/stage-5-launch.sh mainnet
```

### Running Stage 6 (Graduation)

```bash
# After both curves fill. Requires typing "GRADUATE"
./scripts/deploy/stage-6-graduation.sh mainnet
```

### Running Stage 7 (Governance)

```bash
# After 24-48hr trading stability. Requires typing "TRANSFER"
./scripts/deploy/stage-7-governance.sh mainnet
```

### Priority Fee Check Before Launch

```bash
# Check current mainnet priority fee levels
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana fees --url mainnet-beta
```

### Modifying setup-squads.ts for Mainnet Signers

The script currently loads signers from file keypairs (lines 42-46). For mainnet, it needs modification to accept pubkeys for non-file signers:

```typescript
// Current (devnet): auto-generates 3 file keypairs
const SIGNER_KEYPAIR_PATHS = [
  path.join(KEYPAIRS_DIR, "squads-signer-1.json"),  // mainnet: file keypair (proposer)
  path.join(KEYPAIRS_DIR, "squads-signer-2.json"),  // mainnet: Phantom pubkey
  path.join(KEYPAIRS_DIR, "squads-signer-3.json"),  // mainnet: Ledger pubkey
];

// Needed for mainnet: accept pubkeys directly for signers 2 & 3
// since their private keys are in browser wallet and Ledger respectively
```

## State of the Art

| Area | Current State | Impact |
|------|--------------|--------|
| Solana CLI v3 | `solana program show` no longer outputs "Executable" field | Fixed in stage scripts (Phase 98-03); use "Program Id" instead |
| `declare -A` bash arrays | Not compatible with zsh | Fixed in stage scripts (Phase 98-03); use colon-delimited arrays |
| Solana priority fees | `--with-compute-unit-price` in micro-lamports per CU | Stage scripts use 1 for pre-deploy, may need 50000+ for launch-day |
| `--max-sign-attempts` | Retries with new blockhashes if TX expires | Use for program deploys under congestion |
| `--use-rpc` | Routes deploys through stake-weighted RPC for better reliability | Consider for mainnet program deploys via Helius |

## Open Questions

### 1. setup-squads.ts Mainnet Signer Modification

- **What we know:** Script currently auto-generates file keypairs. CONTEXT.md decided: 1 file keypair + 1 Phantom + 1 Ledger.
- **What's unclear:** Exact code changes needed. The script uses `Keypair.fromSecretKey()` which won't work for Phantom/Ledger where only pubkeys are available.
- **Recommendation:** Modify to accept pubkeys via env vars or CLI args for signers 2 and 3. Only signer 1 (file keypair, the script proposer) needs the private key in the script. The multisig creation just needs all 3 public keys -- no private keys needed for member registration.

### 2. Pool Seed SOL Override Values

- **What we know:** .env.mainnet has `SOL_POOL_SEED_SOL_OVERRIDE=CHANGE_ME_MAINNET` and `SOL_POOL_SEED_TOKEN_OVERRIDE=CHANGE_ME_MAINNET`.
- **What's unclear:** Whether these are still needed. graduate.ts uses dynamic balance-delta tracking for pool seeding (no hardcoded SOL amount).
- **Recommendation:** These env vars serve as emergency overrides. They should be set to the expected values from bonding curve fills (~500 SOL per pool, 290M tokens per pool) but graduate.ts will use actual on-chain balances if the override is unset. Clarify during joint review.

### 3. Mainnet TREASURY_PUBKEY

- **What we know:** On devnet, treasury = deployer wallet. On mainnet, this should be the Squads vault PDA.
- **What's unclear:** Squads vault PDA is only known after setup-squads.ts runs (Stage 7), but TREASURY_PUBKEY is needed during Stage 3 (initialize). The treasury is a destination for the 5% tax split.
- **Recommendation:** Use the deployer wallet as initial treasury. After Squads setup, update treasury via admin config if needed. Or, run setup-squads.ts first (before Stage 3) to get the vault PDA, then use that as treasury. This needs discussion during planning.

### 4. Priority Fee Level for Stage 5

- **What we know:** Stage 5 uses `--with-compute-unit-price 1` (very low).
- **What's unclear:** Whether this is sufficient on mainnet during potential launch-day congestion.
- **Recommendation:** Check priority fees immediately before Stage 5. Use medium-to-high tier. Budget ~0.1 SOL for priority fees during launch.

## Sources

### Primary (HIGH confidence)

- `Docs/mainnet-deploy-checklist.md` -- Validated checklist, executed on devnet (Phase 98-03)
- `Docs/mainnet-governance.md` -- Step-by-step governance procedure
- `.planning/phases/100-deploy-to-mainnet/100-CONTEXT.md` -- User decisions constraining this phase
- All 8 stage scripts (`scripts/deploy/stage-{0..7}-*.sh`) -- Inspected directly
- `scripts/deploy/deploy-all.sh` -- Orchestrator script
- `scripts/graduation/graduate.ts` -- Graduation orchestrator
- `scripts/deploy/setup-squads.ts` -- Squads setup script
- `.env.mainnet` -- Mainnet environment template

### Secondary (MEDIUM confidence)

- [Solana Deploying Programs docs](https://solana.com/docs/programs/deploying) -- CLI flags, deployment best practices
- [Helius Priority Fee API](https://www.helius.dev/docs/priority-fee-api) -- Priority fee estimation tiers
- [QuickNode Priority Fee Guide](https://www.quicknode.com/guides/solana-development/transactions/how-to-use-priority-fees) -- Priority fee strategy

### Tertiary (LOW confidence)

- None. All findings verified against project code or official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- entirely existing project tooling, no new dependencies
- Architecture: HIGH -- 8-stage pipeline validated by Phase 98-03 devnet deploy
- Pitfalls: HIGH -- 15 pitfalls documented from real deployment experience, plus 1 mainnet-specific addition
- Signer setup: MEDIUM -- CONTEXT.md decisions are clear, but setup-squads.ts code changes not yet validated

**Research date:** 2026-03-15
**Valid until:** No expiration -- this is execution research for existing, validated infrastructure
