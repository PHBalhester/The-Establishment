# Phase 98: Mainnet Checklist - Research

**Researched:** 2026-03-15
**Domain:** Deployment pipeline refactoring, operational checklists, SOL budget estimation
**Confidence:** HIGH

## Summary

This phase produces an exhaustive mainnet deployment checklist organized into 8 stages (Stage 0-7), refactors the existing monolithic `deploy-all.sh` into independently-runnable stage scripts, calculates a detailed SOL budget for mainnet deployment, and validates the checklist by executing it as a fresh devnet deploy.

The standard approach is to decompose the existing working pipeline into atomic stages with verification gates, embed the 15+ hard-won deployment pitfalls as inline WARNING boxes at the exact steps where they could occur, and ensure every single checklist item has a verification command with expected output. The existing `deploy-all.sh` (815 lines) already handles preflight, build, deploy, init, constants, ALT, and verify -- the refactoring splits this into standalone scripts while preserving all existing safety gates.

**Primary recommendation:** The checklist document and stage scripts are the same thing -- the checklist references the scripts, and the scripts embody the procedure. Build the checklist document first as the specification, then extract stage scripts from it, then validate by running a fresh devnet deploy using only the checklist/scripts.

## Standard Stack

This phase is primarily a documentation and scripting phase. No new libraries are needed.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Bash scripts | N/A | Stage scripts (`stage-N-*.sh`) | Same as existing `deploy-all.sh` pattern |
| TypeScript (tsx) | N/A | Complex init/verify steps | Same as existing `initialize.ts`, `verify.ts` |
| `solana` CLI | v3.0.x (Agave) | Program deploy, rent calc, balance checks | Already in project toolchain |
| `anchor` CLI | 0.32.x | Program builds | Already in project toolchain |
| Markdown | N/A | Checklist document | `Docs/mainnet-deploy-checklist.md` |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `jq` | system | JSON parsing in bash scripts | Parsing deployment.json, hash manifests |
| `shasum -a 256` | macOS | Binary hash verification | Preflight hash check (macOS compat, not sha256sum) |
| `awk` | system | Float comparison in bash | Balance check threshold (more reliable than bc on macOS) |

### Alternatives Considered
None -- this phase uses exclusively existing tools and patterns.

## Architecture Patterns

### Recommended Project Structure

The stage scripts live alongside the existing deploy scripts:

```
scripts/deploy/
├── deploy-all.sh           # Existing monolithic (kept for backward compat, calls stages)
├── stage-0-preflight.sh    # Toolchain, env, wallet, keypair verification
├── stage-1-build.sh        # Build all 7 programs, hash generation
├── stage-2-deploy.sh       # Deploy 7 programs to cluster
├── stage-3-initialize.sh   # Init mints, PDAs, vault, epoch, staking, curves
├── stage-4-infra.sh        # ALT, generate-constants, IDL sync, frontend deploy
├── stage-5-launch.sh       # Init bonding curves, open launch page (PUBLIC MOMENT)
├── stage-6-graduation.sh   # Post-curve-fill: pools, whitelist, crank, burn auth
├── stage-7-governance.sh   # Squads multisig, authority transfer, monitoring
├── build.sh                # Existing (called by stage-1)
├── deploy.sh               # Existing (called by stage-2)
├── initialize.ts           # Existing (called by stage-3)
├── verify.ts               # Existing (called by stage-2, stage-3)
├── generate-constants.ts   # Existing (called by stage-4)
├── create-alt.ts           # Existing (called by stage-4)
├── setup-squads.ts         # Existing (called by stage-7)
├── transfer-authority.ts   # Existing (called by stage-7)
├── verify-authority.ts     # Existing (called by stage-7)
└── generate-hashes.sh      # Existing (called by stage-1)

Docs/
└── mainnet-deploy-checklist.md   # The checklist (replaces old Docs/mainnet-checklist.md)
```

### Pattern 1: Stage Script Structure

**What:** Each stage script is self-contained with prerequisites check, action execution, verification, and GO/NO-GO gate.
**When to use:** Every stage follows this pattern.
**Example:**
```bash
#!/bin/bash
# Stage N: [Name]
# Prerequisites: Stage N-1 completed
# Estimated time: X minutes
# Estimated cost: Y SOL
set -e

# Source environment
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

CLUSTER="${1:-}"
if [ -z "$CLUSTER" ]; then echo "Usage: ./stage-N-*.sh <devnet|mainnet>"; exit 1; fi

# Source cluster env
set -a && source ".env.${CLUSTER}" && set +a

echo "========================================="
echo "  Stage N: [Name]"
echo "========================================="

# ---- Prerequisites Check ----
echo "[Pre] Checking prerequisites..."
# verify prior stage outputs exist

# ---- Actions ----
echo "[1/X] Action description..."
# action command

# ---- Verification ----
echo "[Verify] Checking results..."
# verification command with expected output

# ---- GO/NO-GO Gate ----
echo ""
echo "========================================="
echo "  Stage N COMPLETE"
echo "========================================="
echo ""
echo "  Verification Results:"
echo "    [x] Check 1: [result]"
echo "    [x] Check 2: [result]"
echo ""
echo "  PROCEED TO STAGE N+1? Review above, then run:"
echo "    ./scripts/deploy/stage-$(( N + 1 ))-*.sh ${CLUSTER}"
echo ""
```

### Pattern 2: Verification Command Format in Checklist

**What:** Every checklist item has action, verify command, and expected output.
**When to use:** Every item in the checklist document.
**Example in markdown:**
```markdown
### 2.1 Deploy AMM Program

**Action:**
```bash
solana program deploy target/deploy/amm.so \
  --program-id keypairs/amm-keypair.json \
  --keypair $WALLET --url $CLUSTER_URL \
  --with-compute-unit-price 50000
```

**Verify:**
```bash
solana program show $(solana-keygen pubkey keypairs/amm-keypair.json) --url $CLUSTER_URL --keypair $WALLET
```

**Expected:**
```
Program Id: 5JsS...
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: [address]
Authority: [deployer pubkey]
Executable: true
```

> WARNING (Pitfall #2): Solana CLI v3 requires --keypair flag for `solana program show`. Without it, "No default signer found" error.
```

### Pattern 3: Inline WARNING Boxes for Pitfalls

**What:** Phase 95 deployment pitfalls placed at the exact step where each could occur.
**When to use:** At every step that has a known pitfall from prior deploy experience.
**Example:**
```markdown
> **WARNING (Pitfall #1 - Source .env):** Always `set -a && source .env.${CLUSTER} && set +a` BEFORE running initialize.ts. Pool seed amounts are env vars. Missing this uses test defaults. Pools CANNOT be re-seeded -- requires full redeploy. This mistake cost ~50 SOL on Phase 69.
```

### Anti-Patterns to Avoid

- **Monolithic pipeline without manual gates:** The old `deploy-all.sh` runs everything in sequence with no pause points. For mainnet, each stage must complete and be verified before proceeding.
- **Verification at the end only:** Running verify.ts only after all steps is too late. Each stage has its own verification.
- **Pitfalls in an appendix:** The 15 pitfalls must be at the exact step where they can occur. A separate section means operators won't see them when they matter.
- **Trust-based items:** "Deploy the program" without a verification command is forbidden. Every action must have `Verify:` and `Expected:`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Program rent calculation | Manual math | `solana rent <bytes>` CLI command | Handles metadata overhead, always accurate |
| Binary hash verification | Custom script | Existing `generate-hashes.sh` + preflight check in `deploy-all.sh` | Already battle-tested |
| PDA derivation | Manual byte math | `solana-keygen pubkey` + existing derive functions | Canonical derivation already in codebase |
| Deployment JSON generation | Manual editing | `initialize.ts` Step 27b auto-generates `deployments/{cluster}.json` | Single source of truth pattern |
| Constants generation | Manual editing of shared/constants.ts | `generate-constants.ts` | Only writer of constants.ts |
| ALT creation | Manual instructions | `create-alt.ts` | Handles extend + dedup |
| Authority transfer | Manual CLI calls | `transfer-authority.ts` | Transfers all 10 authorities atomically |

**Key insight:** The project already has all the deployment scripts built and battle-tested across Phases 91-97. The checklist is an orchestration layer on top of existing scripts, not a replacement.

## Common Pitfalls

These are the actual deployment pitfalls discovered during Phases 69, 94, 95, 96, and 97. They are the core content of the checklist's WARNING boxes.

### Pitfall 1: Missing .env Source Before initialize.ts
**What goes wrong:** Pool seed liquidity uses test defaults (10 SOL / 10K tokens) instead of production values
**Why it happens:** `initialize.ts` reads env vars for pool seed amounts; forgetting `set -a && source .env.${CLUSTER} && set +a` before running means vars are unset
**How to avoid:** Stage scripts source .env automatically; checklist has WARNING box at Step 3
**Warning signs:** Pool has 10 SOL instead of expected amount; token amounts are 10,000 instead of 290M
**Cost:** ~50 SOL wasted on Phase 69

### Pitfall 2: Solana CLI v3 --keypair Required
**What goes wrong:** `solana program show` fails with "No default signer found"
**Why it happens:** CLI v3 changed behavior, requires explicit --keypair flag
**How to avoid:** All verification commands in checklist include --keypair $WALLET
**Warning signs:** Error message about "No default signer found"

### Pitfall 3: Build Without Mint Keypairs
**What goes wrong:** Programs compile with stale/placeholder mint addresses baked in
**Why it happens:** build.sh step [0b/4] patches mint addresses from keypairs; no keypairs = stale addresses
**How to avoid:** Stage 0 generates mint keypairs BEFORE Stage 1 build
**Warning signs:** `InvalidMintPair (6002)` error during vault initialization

### Pitfall 4: Feature-Flagged Build Split
**What goes wrong:** `anchor build` fails because tax_program mainnet path has `compile_error!`
**Why it happens:** 4 programs (tax, epoch, vault, bonding_curve) have devnet/mainnet feature flags
**How to avoid:** build.sh already handles this -- non-flagged first, then flagged with features
**Warning signs:** Compile error about "Set mainnet treasury address"

### Pitfall 5: IDL Sync After Deploy
**What goes wrong:** Frontend sends transactions with wrong program addresses or account layouts
**Why it happens:** `app/idl/` files are stale from a previous deploy; `anchor build` updates `target/idl/` but not `app/idl/`
**How to avoid:** Stage 4 (Infrastructure) explicitly copies IDLs: `cp target/idl/*.json app/idl/ && cp target/types/*.ts app/idl/types/`
**Warning signs:** Transactions fail with constraint errors; IDL address field doesn't match deployed program

### Pitfall 6: Whitelist Authority Burn Timing
**What goes wrong:** Cannot whitelist pool vault addresses after graduation
**Why it happens:** Pool vaults are created during graduation (not init), but whitelist authority was burned during init
**How to avoid:** Whitelist authority burn moved to graduation Step 13 (after pool vault whitelisting)
**Warning signs:** "WhitelistAuthority already burned" error when trying to whitelist pool vaults

### Pitfall 7: Carnage WSOL Account Owner Mismatch
**What goes wrong:** Error 6026 (InvalidCarnageWsolOwner) on every epoch advancement
**Why it happens:** Fresh deploy changes Epoch Program ID, which changes CarnageSigner PDA; old WSOL account has wrong PDA as token owner; idempotency guard checked existence but not ownership
**How to avoid:** initialize.ts now validates WSOL account owner field, not just existence
**Warning signs:** Custom error 6026 on crank startup after fresh deploy

### Pitfall 8: Devnet Addresses in Mainnet Binaries
**What goes wrong:** Feature-flagged programs have devnet mint addresses compiled in
**Why it happens:** Building for mainnet without mainnet mint keypairs
**How to avoid:** deploy-all.sh Phase 1.5 greps .so binaries for devnet.json addresses
**Warning signs:** Binary address verification fails in preflight

### Pitfall 9: CARNAGE_WSOL_PUBKEY Missing on Railway
**What goes wrong:** Crank crashes with ENOENT reading keypairs/carnage-wsol.json
**Why it happens:** Railway doesn't have the keypairs/ directory; env var fallback must be set
**How to avoid:** Set CARNAGE_WSOL_PUBKEY env var on Railway after initialization
**Warning signs:** ENOENT error in crank logs referencing carnage-wsol.json

### Pitfall 10: Partial Deploy + Running Crank
**What goes wrong:** Crank errors on partially deployed programs
**Why it happens:** Crank tries to advance epochs using programs that may be in mid-deploy state
**How to avoid:** Stop crank before deploying; restart after full verification
**Warning signs:** Instruction errors from crank during deploy window

### Pitfall 11: Solana CLI Path With Spaces
**What goes wrong:** `solana program deploy --program-id` fails with "unrecognized signer source"
**Why it happens:** Project dir "Dr Fraudsworth" has a space; Solana CLI doesn't handle it
**How to avoid:** Symlink workaround: `ln -sf "$PWD" ~/.dr-fraudsworth-link`; use symlink path for CLI calls
**Warning signs:** "unrecognized signer source" error on deploy

### Pitfall 12: Squads TX Creator Must Be Member
**What goes wrong:** Error 6005 (NotAMember) when creating vault transactions
**Why it happens:** Deployer wallet is fee payer but not a multisig member; Squads requires member as creator
**How to avoid:** Use signer keypair (not deployer) as creator in vault TX creation
**Warning signs:** Squads error 6005 during governance setup

### Pitfall 13: skipPreflight Silent TX Failures
**What goes wrong:** Transaction confirmed as "success" but actually failed
**Why it happens:** `skipPreflight: true` confirms failed TXs; confirmation.value.err not checked
**How to avoid:** Use confirmOrThrow helper that checks confirmation.value.err
**Warning signs:** Subsequent steps fail because prior TX silently errored

### Pitfall 14: RPC Propagation Delay After Upgrade
**What goes wrong:** Reading ProgramData immediately after upgrade returns stale state
**Why it happens:** RPC node hasn't propagated the state change yet
**How to avoid:** Wait 2-3 seconds after state-changing operations; use retry loop for verification
**Warning signs:** last_deploy_slot unchanged after successful upgrade TX

### Pitfall 15: BorshCoder snake_case vs camelCase
**What goes wrong:** Anchor instruction args silently encode zero bytes for pubkey fields
**Why it happens:** BorshCoder IDL encoding expects snake_case field names; camelCase silently produces zeros
**How to avoid:** Always use snake_case in Anchor instruction argument objects
**Warning signs:** Pubkey fields are Pubkey::default() (all zeros) in on-chain accounts

## SOL Budget Estimation

### Program Deploy Costs (from actual binary sizes)

| Program | Binary Size | Estimated Rent (SOL) |
|---------|-------------|---------------------|
| amm.so | 422,944 bytes | ~2.95 |
| bonding_curve.so | 564,424 bytes | ~3.93 |
| conversion_vault.so | 374,824 bytes | ~2.61 |
| epoch_program.so | 518,824 bytes | ~3.61 |
| staking.so | 425,440 bytes | ~2.96 |
| tax_program.so | 406,792 bytes | ~2.83 |
| transfer_hook.so | 340,416 bytes | ~2.37 |
| **Subtotal** | **3,053,664 bytes** | **~21.26** |

**Note:** These are devnet binary sizes. Mainnet binaries (without `--features devnet`) may differ slightly. The `solana rent <bytes>` command gives exact values. The 1x program size cost (not 2x) applies to current Solana mainnet. Each program also has ~45 bytes of program account + ProgramData header overhead.

### Mint Creation Costs

| Mint | Extensions | Estimated Size | Estimated Rent (SOL) |
|------|------------|---------------|---------------------|
| CRIME | Token-2022 + TransferHook + MetadataPointer + TokenMetadata | ~500 bytes | ~0.004 |
| FRAUD | Token-2022 + TransferHook + MetadataPointer + TokenMetadata | ~500 bytes | ~0.004 |
| PROFIT | Token-2022 + TransferHook + MetadataPointer + TokenMetadata | ~500 bytes | ~0.004 |
| **Subtotal** | | | **~0.012** |

### PDA Account Costs

| Account Category | Count | Avg Size | Estimated Total Rent (SOL) |
|-----------------|-------|----------|---------------------------|
| AdminConfig (AMM) | 1 | ~200 bytes | ~0.003 |
| WhitelistAuthority | 1 | ~100 bytes | ~0.002 |
| WhitelistEntry | ~15 | ~100 bytes each | ~0.015 |
| ExtraAccountMetaList (per mint) | 3 | ~200 bytes each | ~0.005 |
| EpochState | 1 | ~400 bytes | ~0.005 |
| StakePool | 1 | ~300 bytes | ~0.004 |
| EscrowVault | 1 | System account | ~0.001 |
| StakeVault | 1 | Token account | ~0.003 |
| CarnageFund | 1 | ~300 bytes | ~0.004 |
| CarnageSolVault | 1 | System account | ~0.001 |
| CarnageCrimeVault | 1 | Token account | ~0.003 |
| CarnageFraudVault | 1 | Token account | ~0.003 |
| CarnageSigner PDA | 1 | Derived (no rent) | 0 |
| CarnageWSOL | 1 | Token account | ~0.003 |
| WsolIntermediary | 1 | Token account | ~0.003 |
| VaultConfig | 1 | ~200 bytes | ~0.003 |
| VaultCrime/Fraud/Profit | 3 | Token accounts | ~0.009 |
| BcAdminConfig | 1 | ~200 bytes | ~0.003 |
| CurveState (x2) | 2 | ~300 bytes each | ~0.005 |
| CurveTokenVault (x2) | 2 | Token accounts | ~0.006 |
| CurveSolVault (x2) | 2 | System accounts | ~0.002 |
| CurveTaxEscrow (x2) | 2 | System accounts | ~0.002 |
| Admin token accounts (x3) | 3 | Token-2022 accounts | ~0.006 |
| **Subtotal** | **~45 accounts** | | **~0.09** |

### Pool Creation Costs (Post-Graduation)

| Pool | SOL Seed | Token Seed | Pool PDA Rent | Vault Rent | Total |
|------|----------|------------|---------------|------------|-------|
| CRIME/SOL | Dynamic (~500 SOL from curves) | 290M CRIME | ~0.005 | ~0.006 | ~0.011 |
| FRAUD/SOL | Dynamic (~500 SOL from curves) | 290M FRAUD | ~0.005 | ~0.006 | ~0.011 |
| **Subtotal** | | | | | **~0.022** |

**Note:** Pool SOL seed comes from bonding curve proceeds (community buyers), not deployer wallet. The ~0.022 SOL is just the account creation rent.

### Infrastructure Costs

| Item | Estimated Cost (SOL) | Notes |
|------|---------------------|-------|
| Address Lookup Table creation | ~0.003 | + ~0.001 per extend TX |
| ALT extend (55 addresses, ~3 TXs) | ~0.005 | 256 addresses per extend max |
| Transaction fees (deploy + init) | ~0.05 | ~50 transactions at ~0.001 SOL each |
| Priority fees (mainnet) | ~0.10 | Higher priority for landing |
| **Subtotal** | | **~0.16** |

### Operational Funding

| Item | Estimated Cost (SOL) | Notes |
|------|---------------------|-------|
| Crank wallet funding | 5.0 | ~0.05 SOL/day, covers months of operation |
| Carnage SOL vault seed | 0.1 | Initial fund for carnage buy operations |
| Squads multisig creation | ~0.01 | Account rent for multisig + vault |
| **Subtotal** | | **~5.11** |

### Budget Summary

| Category | Cost (SOL) |
|----------|-----------|
| Program deployments (7) | ~21.26 |
| Mint creation (3) | ~0.01 |
| PDA accounts (~45) | ~0.09 |
| Pool creation (2) | ~0.02 |
| Infrastructure (ALT, TXs) | ~0.16 |
| Operational (crank, carnage, squads) | ~5.11 |
| **Subtotal** | **~26.65** |
| **+20% contingency** | **~5.33** |
| **TOTAL (deployer wallet needed)** | **~32.0 SOL** |

**Separate from deployer cost (community-funded):**
| Item | SOL |
|------|-----|
| Bonding curve fills (2x ~500 SOL) | ~1000 SOL |

**IMPORTANT:** Run `solana rent <bytes>` for each program binary to get exact costs before mainnet deploy. The estimates above use the 6,960 lamports/byte formula but the CLI accounts for metadata overhead accurately.

## Code Examples

### Stage Script Skeleton (Verified Pattern from deploy-all.sh)

```bash
#!/bin/bash
# =============================================================================
# Stage N: [Description]
# Prerequisites: Stage N-1 complete
# =============================================================================
set -e

source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

cd "$(dirname "$0")/../.."

CLUSTER="${1:-}"
if [ -z "$CLUSTER" ] || { [ "$CLUSTER" != "devnet" ] && [ "$CLUSTER" != "mainnet" ]; }; then
  echo "Usage: ./scripts/deploy/stage-N-name.sh <devnet|mainnet>"
  exit 1
fi

ENV_FILE=".env.${CLUSTER}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export CLUSTER
export WALLET="${WALLET:-keypairs/devnet-wallet.json}"

echo ""
echo "========================================="
echo "  Stage N: [Name] ($CLUSTER)"
echo "========================================="
echo ""

# [Stage actions with inline verification]

echo ""
echo "========================================="
echo "  Stage N COMPLETE"
echo "========================================="
```

### Checklist Item Format (Markdown)

```markdown
### N.M [Action Name]

**Action:**
```bash
[exact command to run]
```

**Verify:**
```bash
[verification command]
```

**Expected output:**
```
[what the operator should see]
```

- [ ] Verified -- output matches expected

> **WARNING:** [Pitfall description if applicable]
```

### GO/NO-GO Gate Format (Markdown)

```markdown
## Stage N GO/NO-GO Gate

- [ ] N.1 [Check description]: [expected result]
- [ ] N.2 [Check description]: [expected result]
- [ ] N.3 [Check description]: [expected result]

**All checks pass?**
- [ ] **PROCEED TO STAGE N+1**

> If ANY check fails, STOP. Do not proceed. Fix the issue before continuing.
> Contact: [emergency procedure]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `deploy-all.sh` runs everything in one shot | Stage scripts with manual verification gates | Phase 98 (this phase) | Enables pre-deploying days before launch |
| Old `Docs/mainnet-checklist.md` (v0.8 era) | Complete replacement with stage-based checklist | Phase 98 | Old checklist is stale and incomplete |
| 2x program size cost for deploy | 1x program size (Solana feature) | 2025 | Halves deploy cost from ~42 SOL to ~21 SOL |
| Pools created during init | Pools created during graduation | Phase 95 fix | Graduation uses actual curve SOL, not hardcoded amounts |
| Whitelist auth burn during init | Burn during graduation (after pool vault whitelisting) | Phase 95 fix | Prevents being locked out of whitelisting |

## Existing Scripts Inventory

All scripts needed for the checklist already exist. The stage scripts wrap these:

| Script | Called By | What It Does |
|--------|-----------|-------------|
| `build.sh` | Stage 1 | Sync IDs, patch mints, compile, verify artifacts |
| `deploy.sh` | Stage 2 | Deploy 7 programs to cluster |
| `initialize.ts` | Stage 3 | 27-step idempotent initialization |
| `generate-constants.ts` | Stage 4 | Write shared/constants.ts from deployment.json |
| `create-alt.ts` | Stage 4 | Create/extend Address Lookup Table |
| `verify.ts` | Stage 2, 3, 6 | 36-check on-chain verification |
| `generate-hashes.sh` | Stage 1 | SHA256 hash manifest for binaries |
| `graduate.ts` | Stage 6 | 13-step graduation (pools, whitelist, burn) |
| `setup-squads.ts` | Stage 7 | Create 2-of-3 Squads multisig |
| `transfer-authority.ts` | Stage 7 | Transfer all authorities to Squads vault |
| `verify-authority.ts` | Stage 7 | Verify all 11 authority checks |
| `test-upgrade.ts` | Stage 7 | Prove upgrade round-trip through Squads |

## Stage-to-Requirement Mapping

| Requirement | Satisfied By |
|-------------|-------------|
| CHECK-01 | Checklist document covers all 8 stages (0-7) |
| CHECK-02 | Every item has Verify + Expected output |
| CHECK-03 | Fresh devnet deploy validates checklist (Wave 3) |
| CHECK-04 | SOL budget table with line items + 20% contingency |

## Open Questions

### 1. Exact Program Deploy Costs on Mainnet
- **What we know:** Devnet binary sizes give ~21.26 SOL estimate; mainnet binaries may differ slightly
- **What's unclear:** Mainnet build (no --features devnet) may produce different binary sizes
- **Recommendation:** Run `solana rent $(wc -c < target/deploy/program.so | tr -d ' ')` after mainnet build for exact costs; update budget table before deploy

### 2. Priority Fee Levels for Mainnet Deploy
- **What we know:** Devnet uses `--with-compute-unit-price 1`; mainnet needs higher for reliable landing
- **What's unclear:** Optimal priority fee for program deploy on mainnet-beta
- **Recommendation:** Use `--with-compute-unit-price 50000` for mainnet deploys (same as partial deploy pattern); budget 0.10 SOL for priority fees across all TXs

### 3. Devnet SOL Availability for Validation Deploy
- **What we know:** Devnet faucet rate-limits aggressively; fresh deploy needs ~30 SOL
- **What's unclear:** Whether faucet will have sufficient SOL when we're ready for validation
- **Recommendation:** Start accumulating devnet SOL before the validation deploy; may need to wait for faucet replenishment as noted in CONTEXT.md

### 4. Mainnet Mint Keypairs Handling
- **What we know:** Vanity mint keypairs exist at `keypairs/mainnet-*-mint.json` (git-ignored)
- **What's unclear:** Whether the stage scripts need special handling for mainnet vs devnet mint keypairs
- **Recommendation:** Stage 0 checks for mainnet vanity keypairs and copies them to `scripts/deploy/mint-keypairs/` directory (the canonical location build.sh reads)

## Deployment Timing Strategy

The 8-stage architecture enables a specific mainnet launch strategy from the CONTEXT.md:

1. **Days before launch:** Complete Stages 0-4 (preflight, build, deploy, init, infra)
2. **Launch moment:** Execute Stage 5 only (init curves + open launch page) -- takes ~2 minutes
3. **Fill period:** Monitor curves filling (Stage 5.5 monitoring sub-checklist)
4. **After both curves fill:** Execute Stage 6 (graduation -- pools, whitelist, crank, burn)
5. **After trading stable:** Execute Stage 7 (governance -- Squads, authority transfer)

This minimizes launch-day risk by completing all complex operations in advance.

## Sources

### Primary (HIGH confidence)
- `scripts/deploy/deploy-all.sh` -- 815-line existing pipeline, verified working across Phase 91-97
- `scripts/deploy/initialize.ts` -- 27-step idempotent initialization, verified on Phase 95
- `scripts/deploy/verify.ts` -- 36-check verification script, verified on Phase 95
- `scripts/graduation/graduate.ts` -- 13-step graduation, verified on Phase 95
- `deployments/devnet.json` -- Current canonical deployment state
- `.env.mainnet` -- Mainnet env template with all required variables

### Secondary (MEDIUM confidence)
- [Solana Deploying Programs docs](https://solana.com/docs/programs/deploying) -- Confirmed 1x program size cost
- [Solana Rent docs](https://solana.com/developers/cookbook/accounts/calculate-rent) -- 6,960 lamports/byte formula
- Phase 95 summaries (95-01-SUMMARY.md, 95-02-SUMMARY.md) -- Deploy pipeline pitfalls

### Tertiary (LOW confidence)
- SOL budget exact figures -- Based on devnet binary sizes; mainnet binaries may differ. Use `solana rent` for exact.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All tools already exist in the project
- Architecture: HIGH -- Stage script pattern derived from working deploy-all.sh
- Pitfalls: HIGH -- All 15 pitfalls from actual deployment experience (Phases 69, 94, 95, 96, 97)
- SOL budget: MEDIUM -- Estimates based on devnet binary sizes; exact costs require mainnet build
- Checklist structure: HIGH -- Requirements and CONTEXT.md are very specific about format

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable -- no expected changes to Solana deployment mechanics)
