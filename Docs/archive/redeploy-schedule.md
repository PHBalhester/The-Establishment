# Full Devnet Redeploy Schedule

**Created:** 2026-02-27
**Purpose:** Complete fresh deploy of ALL programs, mints, pools, vault, staking, whitelist, ALT. No reused keypairs. No legacy state. Clean slate.

**Why this exists:** Phase 69 originally specified "new program keypairs, new mints, new pools, new ALT. No in-place upgrades." That instruction was overridden, causing cascading issues (stale staking PDAs, chicken-and-egg token problems). This schedule ensures a correct full redeploy.

---

## CODE BUG: Must Fix BEFORE Running initialize.ts

**`scripts/deploy/initialize.ts` line 114:**
```typescript
const VAULT_SEED_PROFIT = 20_000_000_000_000; // 20M PROFIT — THIS IS 100% OF TOTAL SUPPLY
```

**`scripts/deploy/initialize.ts` line 108:**
```typescript
PROFIT: 20_000_000_000_000, // 20M * 10^6
```

**Problem:** `VAULT_SEED_PROFIT` equals `TOTAL_SUPPLY` for PROFIT. Step 10 transfers ALL 20M PROFIT to the vault, then burns mint authority. Step 13 (InitializeStakePool) needs `MINIMUM_STAKE` (1 PROFIT = 1,000,000 raw) from the admin account — but admin has 0.

**Fix (line 114):** Change to:
```typescript
const VAULT_SEED_PROFIT = 20_000_000_000_000 - 1_000_000; // 20M PROFIT minus 1 PROFIT for dead stake
```

This leaves exactly 1 PROFIT in the admin account for the dead stake transfer in Step 13. Without this fix, StakePool initialization will fail with insufficient funds — the exact same chicken-and-egg problem we hit before.

---

## Revert Partial Changes (Do This FIRST)

Before anything else, revert the partial staking-only changes from the failed attempt:

```bash
# These files were partially modified and need to go back to Phase 69-03 state
# (or will be overwritten entirely during Phase 2 of this schedule)
git checkout -- programs/staking/src/lib.rs
git checkout -- programs/tax-program/src/constants.rs
git checkout -- programs/tax-program/tests/test_swap_sol_buy.rs
git checkout -- programs/tax-program/tests/test_swap_sol_sell.rs
git checkout -- programs/epoch-program/src/constants.rs
git checkout -- shared/constants.ts
git checkout -- Anchor.toml

# Remove the partial keypair files
rm -f keypairs/staking-keypair-old.json
```

---

## Pre-Flight Checklist

Before starting, confirm:

- [ ] Railway crank runner is **stopped**
- [ ] All code changes are committed (clean git status)
- [ ] Devnet wallet has sufficient SOL (`solana balance keypairs/devnet-wallet.json --url devnet` — need ~30 SOL)
- [ ] No other processes are using the devnet programs

---

## Phase 0: Clean Slate

Delete ALL deployment artifacts. Nothing survives.

```bash
# Delete ALL program keypairs
rm -f keypairs/amm-keypair.json
rm -f keypairs/transfer-hook-keypair.json
rm -f keypairs/tax-program-keypair.json
rm -f keypairs/epoch-program.json
rm -f keypairs/staking-keypair.json
rm -f keypairs/staking-keypair-old.json
rm -f keypairs/vault-keypair.json

# Delete ALL mint keypairs
rm -rf scripts/deploy/mint-keypairs/

# Delete deployment artifacts
rm -f keypairs/carnage-wsol.json
rm -f scripts/deploy/alt-address.json
rm -f scripts/deploy/pda-manifest.json
rm -f scripts/deploy/deployment-report.md
```

**Verify:** `ls keypairs/` should show only `devnet-wallet.json` and test keypairs (`StUbofRk*.json`, `fake-tax-keypair.json`, `mock-tax-keypair.json`).

---

## Phase 1: Generate ALL Keypairs

Generate 6 program keypairs + 3 mint keypairs. All addresses are known before any building.

```bash
# Program keypairs
solana-keygen new --no-bip39-passphrase --silent -o keypairs/amm-keypair.json
solana-keygen new --no-bip39-passphrase --silent -o keypairs/transfer-hook-keypair.json
solana-keygen new --no-bip39-passphrase --silent -o keypairs/tax-program-keypair.json
solana-keygen new --no-bip39-passphrase --silent -o keypairs/epoch-program.json
solana-keygen new --no-bip39-passphrase --silent -o keypairs/staking-keypair.json
solana-keygen new --no-bip39-passphrase --silent -o keypairs/vault-keypair.json

# Mint keypairs
mkdir -p scripts/deploy/mint-keypairs
solana-keygen new --no-bip39-passphrase --silent -o scripts/deploy/mint-keypairs/crime-mint.json
solana-keygen new --no-bip39-passphrase --silent -o scripts/deploy/mint-keypairs/fraud-mint.json
solana-keygen new --no-bip39-passphrase --silent -o scripts/deploy/mint-keypairs/profit-mint.json
```

**Record all public keys:**

```bash
echo "=== NEW PROGRAM IDs ==="
echo "AMM:       $(solana-keygen pubkey keypairs/amm-keypair.json)"
echo "Hook:      $(solana-keygen pubkey keypairs/transfer-hook-keypair.json)"
echo "Tax:       $(solana-keygen pubkey keypairs/tax-program-keypair.json)"
echo "Epoch:     $(solana-keygen pubkey keypairs/epoch-program.json)"
echo "Staking:   $(solana-keygen pubkey keypairs/staking-keypair.json)"
echo "Vault:     $(solana-keygen pubkey keypairs/vault-keypair.json)"

echo "=== NEW MINT ADDRESSES ==="
echo "CRIME:     $(solana-keygen pubkey scripts/deploy/mint-keypairs/crime-mint.json)"
echo "FRAUD:     $(solana-keygen pubkey scripts/deploy/mint-keypairs/fraud-mint.json)"
echo "PROFIT:    $(solana-keygen pubkey scripts/deploy/mint-keypairs/profit-mint.json)"
```

**Save output** — these addresses drive every subsequent step.

---

## Phase 2: Update ALL Source Code

Every hardcoded address in the codebase must be updated. Grouped by file.

### 2a. Program declare_id! (6 files)

Each program's lib.rs must declare its own new ID.

| File | Line | What to update |
|------|------|----------------|
| `programs/amm/src/lib.rs` | ~1 | `declare_id!("NEW_AMM_ID")` |
| `programs/transfer-hook/src/lib.rs` | ~1 | `declare_id!("NEW_HOOK_ID")` |
| `programs/tax-program/src/lib.rs` | ~1 | `declare_id!("NEW_TAX_ID")` |
| `programs/epoch-program/src/lib.rs` | ~1 | `declare_id!("NEW_EPOCH_ID")` |
| `programs/staking/src/lib.rs` | ~34 | `declare_id!("NEW_STAKING_ID")` |
| `programs/conversion-vault/src/lib.rs` | ~1 | `declare_id!("NEW_VAULT_ID")` |

### 2b. Cross-Program References (4 files, 9 functions)

Programs that CPI into other programs hardcode the target program ID.

**Auto-patched by `build.sh` (via `patch-mint-addresses.ts`):**
These 2 functions are automatically patched from keypair files — no manual edit needed:

| File | Function | Patched from keypair |
|------|----------|---------------------|
| `programs/tax-program/src/constants.rs` | `epoch_program_id()` (line ~51) | `keypairs/epoch-program.json` |
| `programs/tax-program/src/constants.rs` | `staking_program_id()` (line ~127) | `keypairs/staking-keypair.json` |

**MANUAL edits required (7 functions):**
`patch-mint-addresses.ts` does NOT load AMM/Tax/Hook keypairs, so these must be edited by hand:

| File | Function | Update to |
|------|----------|-----------|
| `programs/amm/src/constants.rs` | `TAX_PROGRAM_ID` (line ~10, uses `pubkey!`) | NEW_TAX_ID |
| `programs/tax-program/src/constants.rs` | `amm_program_id()` (line ~100) | NEW_AMM_ID |
| `programs/epoch-program/src/constants.rs` | `amm_program_id()` (line ~26) | NEW_AMM_ID |
| `programs/epoch-program/src/constants.rs` | `tax_program_id()` (line ~18) | NEW_TAX_ID |
| `programs/epoch-program/src/constants.rs` | `staking_program_id()` (line ~34) | NEW_STAKING_ID |
| `programs/staking/src/constants.rs` | `tax_program_id()` (line ~87) | NEW_TAX_ID |
| `programs/staking/src/constants.rs` | `epoch_program_id()` (line ~102) | NEW_EPOCH_ID |

### 2c. Mint Addresses + Treasury (auto-patched by build.sh)

These are **feature-gated** (`#[cfg(feature = "devnet")]`) and auto-patched by `patch-mint-addresses.ts`:
- `programs/conversion-vault/src/constants.rs` — `crime_mint()`, `fraud_mint()`, `profit_mint()`
- `programs/tax-program/src/constants.rs` — `treasury_pubkey()` (patched from `TREASURY_PUBKEY` env var or devnet wallet fallback)

**`build.sh --devnet` patches these automatically** from `scripts/deploy/mint-keypairs/` and `keypairs/`. No manual edit needed.

### 2d. Test Files, Test Stubs, Verification Scripts (7 files)

Test files, stubs, and verification scripts that hardcode program IDs:

| File | What to update |
|------|----------------|
| `programs/tax-program/tests/test_swap_sol_buy.rs` | `staking_program_id()` function |
| `programs/tax-program/tests/test_swap_sol_sell.rs` | `staking_program_id()` function |
| `programs/amm/tests/test_cpi_access_control.rs` | TAX_PROGRAM_ID reference (if hardcoded) |
| `programs/epoch-program/src/constants.rs` | Test assertions for program IDs |
| `programs/tax-program/src/constants.rs` | Test assertions for program IDs |
| `programs/stub-staking/src/lib.rs` | Epoch Program ID reference (~line 39) |
| `scripts/verify-program-ids.ts` | `expectedDeclareId` for mock_tax_program (~line 101) — must match NEW_TAX_ID or verification fails |

### 2e. Hardcoded Addresses in Frontend/Scripts/Tests (6 files)

These files bypass `shared/constants.ts` and hardcode addresses directly. Must be fixed to import from shared constants.

| File | Lines | What's hardcoded | Fix |
|------|-------|------------------|-----|
| `app/lib/event-parser.ts` | ~29-33 | `TAX_PROGRAM_ID`, `EPOCH_PROGRAM_ID` as `new PublicKey("...")` | Import `PROGRAM_IDS` from `shared/constants.ts` |
| `scripts/backfill-candles.ts` | ~51, 56-57 | Tax Program ID + pool addresses hardcoded | Import from `shared/constants.ts` → `PROGRAM_IDS`, `DEVNET_POOLS` |
| `scripts/webhook-manage.ts` | ~36-37 | Tax + Epoch program IDs in `ACCOUNT_ADDRESSES` array | Import `PROGRAM_IDS` from `shared/constants.ts` |
| `scripts/prepare-carnage-state.ts` | ~34 | `EPOCH_PROGRAM_ID` as `new PublicKey("...")` | Import `PROGRAM_IDS` from `shared/constants.ts` |
| `tests/devnet-vrf.ts` | ~42 | `EPOCH_PROGRAM_ID` as `new PublicKey("...")` | Import from `shared/constants.ts` |
| `tests/cross-program-integration.ts` | ~68, 71 | Tax + Epoch program IDs hardcoded | Import from `shared/constants.ts` |

### 2f. Anchor.toml

Update both `[programs.devnet]` and `[programs.localnet]` sections with all 6 new program IDs.

### 2g. Frontend Constants (Phase 6 — after deployment)

`shared/constants.ts` — update after deployment and PDA generation. See Phase 6 for full list of sections.

---

## Phase 3: Build

**Single-pass build.** Since all keypairs exist, `build.sh --devnet` can patch mint addresses and build everything in one go.

```bash
./scripts/deploy/build.sh --devnet
```

This will:
1. Run `patch-mint-addresses.ts` → auto-patches vault mints, tax→epoch, tax→staking, treasury
2. Run `anchor build` for all 9 programs (6 real + 3 test)
3. Run `anchor build -p epoch_program -- --features devnet` (+ tax_program, conversion_vault)
4. Verify all 6 .so artifacts exist
5. Run `verify-program-ids.ts` → checks declare_id consistency + 5 cross-refs

**Expected output:** `29/29 checks passed` (or similar)

**IMPORTANT:** `verify-program-ids.ts` checks only 5 of the 9 cross-refs. It does NOT verify:
- `tax-program → amm_program_id()`
- `epoch-program → amm_program_id()`
- `epoch-program → tax_program_id()`
- `epoch-program → staking_program_id()`

**After build, manually verify these 4** by grepping the source:
```bash
grep -n 'from_str\|pubkey!' programs/epoch-program/src/constants.rs
grep -n 'amm_program_id' programs/tax-program/src/constants.rs
```
Cross-check each address against the keypair pubkeys from Phase 1.

**Then run Rust tests:**
```bash
cargo test --workspace
```

**Expected:** ~280 tests, 0 failures.

---

## Phase 4: Deploy ALL 6 Programs

Deploy order doesn't matter (programs are independent at deploy time). But deploy all 6:

```bash
CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=<KEY>

solana program deploy target/deploy/amm.so --program-id keypairs/amm-keypair.json --url $CLUSTER_URL --keypair keypairs/devnet-wallet.json --with-compute-unit-price 75000
solana program deploy target/deploy/transfer_hook.so --program-id keypairs/transfer-hook-keypair.json --url $CLUSTER_URL --keypair keypairs/devnet-wallet.json --with-compute-unit-price 75000
solana program deploy target/deploy/tax_program.so --program-id keypairs/tax-program-keypair.json --url $CLUSTER_URL --keypair keypairs/devnet-wallet.json --with-compute-unit-price 75000
solana program deploy target/deploy/epoch_program.so --program-id keypairs/epoch-program.json --url $CLUSTER_URL --keypair keypairs/devnet-wallet.json --with-compute-unit-price 75000
solana program deploy target/deploy/staking.so --program-id keypairs/staking-keypair.json --url $CLUSTER_URL --keypair keypairs/devnet-wallet.json --with-compute-unit-price 75000
solana program deploy target/deploy/conversion_vault.so --program-id keypairs/vault-keypair.json --url $CLUSTER_URL --keypair keypairs/devnet-wallet.json --with-compute-unit-price 75000
```

**Verify each deploy succeeds** — record the Program Id and Signature for each.

---

## Phase 5: Initialize Protocol

**PREREQUISITE:** The `VAULT_SEED_PROFIT` bug fix (see "CODE BUG" section above) MUST be applied before running this. Otherwise StakePool init will fail.

Run `initialize.ts` which executes all 17 steps in order:

```bash
CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=<KEY> npx tsx scripts/deploy/initialize.ts
```

**Critical ordering within initialize.ts (17 steps):**

Note: Step numbers below match the ACTUAL `log.step()` numbers in the code (what you'll see in console output). Step 1 creates all 3 mints as sub-operations of a single step.

| Code Step | What | Why it must be this order |
|-----------|------|--------------------------|
| 1 | Create all 3 mints (CRIME, FRAUD, PROFIT) with Token-2022 + MetadataPointer | Mints must exist before any token accounts |
| 2 | Initialize WhitelistAuthority | Must exist before any whitelist entries |
| 3 | Initialize ExtraAccountMetaList for each mint (3 sub-ops) | Hook must be configured before any transfers |
| 4 | Initialize AMM AdminConfig | Must exist before pool creation |
| 5 | Create admin token accounts + mint full supply | Admin needs tokens for seeding. **Mint authority still active here.** |
| 6 | Whitelist admin Token-2022 accounts | Admin accounts must be whitelisted before transfers |
| 7 | Initialize 2 SOL pools (CRIME/SOL, FRAUD/SOL) + seed liquidity (2 sub-ops) | Transfers tokens from admin to pool vaults |
| 8 | Initialize Conversion Vault | Creates VaultConfig PDA |
| 9 | Whitelist vault token accounts | Vault accounts must be whitelisted before seeding |
| 10 | Seed vault (250M CRIME + 250M FRAUD + ~20M PROFIT) + **burn mint authorities** | Transfers tokens to vault. **Mint authority burned AFTER seeding.** |
| 11 | Whitelist pool vault addresses | Pool vaults need whitelisting for swaps |
| 12 | Initialize EpochState | Creates singleton epoch tracker |
| 13 | Initialize StakePool + stake_vault + escrow_vault + dead stake | **Requires admin to have PROFIT tokens.** Admin must hold MINIMUM_STAKE (1 PROFIT) at this point. |
| 14 | Whitelist StakeVault | stake_vault must be whitelisted for PROFIT transfers (stake/unstake) |
| 15 | Initialize Carnage Fund + WSOL + Intermediary | Creates carnage accounts |
| 16 | Fund Carnage SOL + whitelist carnage vaults | Carnage vaults need whitelisting |
| 17 | Generate PDA manifest | Outputs `pda-manifest.json` with all addresses |

**CRITICAL: Step ordering for dead stake**
- Step 5 mints PROFIT to admin (20M total)
- Step 10 seeds vault with PROFIT but must leave MINIMUM_STAKE (1 PROFIT = 1,000,000 raw) in admin account
- Step 13 transfers MINIMUM_STAKE from admin to stake_vault
- **If step 10 transfers ALL PROFIT to vault, step 13 fails** (chicken-and-egg we hit before)

**Verify:** `initialize.ts` must ensure admin retains MINIMUM_STAKE PROFIT before burning mint authority.

**CRITICAL: Source .env BEFORE running initialize.ts**
```bash
set -a && source .env && set +a && npx tsx scripts/deploy/initialize.ts
```
Pool seed liquidity amounts are controlled by env vars `SOL_POOL_SEED_SOL_OVERRIDE` (2.5 SOL = 2,500,000,000 lamports) and `SOL_POOL_SEED_TOKEN_OVERRIDE` (290M tokens = 290,000,000,000,000 raw). Without sourcing `.env`, the script falls back to **test defaults** (10 SOL / 10,000 tokens) which are completely wrong for devnet/mainnet. Pools cannot be re-seeded — the only fix is a full redeploy. This mistake cost ~50 SOL on the Phase 69 deploy.

---

## Phase 6: Generate PDA Manifest + Update Frontend

After initialization, all on-chain accounts exist. Generate the PDA manifest:

```bash
npx tsx scripts/deploy/lib/pda-manifest.ts
```

This outputs `scripts/deploy/pda-manifest.json` with all derived PDA addresses.

**Then update `shared/constants.ts`:**

| Section | Source | What changes |
|---------|--------|-------------|
| `PROGRAM_IDS` | Keypair pubkeys | All 6 program IDs |
| `MINTS` | Mint keypair pubkeys | All 3 mint addresses |
| `DEVNET_POOLS` | pda-manifest.json | 2 pool addresses |
| `DEVNET_POOL_CONFIGS` | pda-manifest.json | Pool details + vault addresses |
| `DEVNET_PDAS` | pda-manifest.json | Core PDA addresses |
| `DEVNET_PDAS_EXTENDED` | pda-manifest.json | All PDA addresses (incl. staking, vault, epoch) |

---

## Phase 7: Sync IDLs

Copy fresh IDLs from build output to frontend:

```bash
for name in amm epoch_program staking tax_program transfer_hook conversion_vault; do
  cp "target/idl/${name}.json" "app/idl/${name}.json"
  cp "target/types/${name}.ts" "app/idl/types/${name}.ts"
done
```

**Verify:** Each IDL's `"address"` field matches the new program ID.

---

## Phase 8: Create Address Lookup Table

```bash
npx tsx scripts/e2e/lib/alt-helper.ts
```

Creates a new ALT with all protocol addresses. Saves to `scripts/deploy/alt-address.json`.

Update **both** of these with the new ALT address:
- `shared/programs.ts` → `DEVNET_ALT` (line ~13, this is where the ALT PublicKey is exported)
- `shared/constants.ts` → if it re-exports or references the ALT

---

## Phase 9: Build Frontend

```bash
npm run build
```

Confirms Next.js compiles with all new addresses. If this fails, there's a stale reference somewhere.

---

## Phase 10: Run E2E Validation

```bash
CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=<KEY> npx tsx scripts/e2e/devnet-e2e-validation.ts
```

Tests all swap directions + vault conversions. Generates `Docs/E2E_Devnet_Test_Report.md`.

---

## Phase 11: Update Crank + Railway

### 11a. Push to main (triggers Railway frontend deploy)
```bash
git push origin main
```

### 11b. Update Railway crank env vars
- `PDA_MANIFEST` = full contents of `scripts/deploy/pda-manifest.json`
- `CARNAGE_WSOL_PUBKEY` = pubkey from `keypairs/carnage-wsol.json` (run: `node -e "const {Keypair}=require('@solana/web3.js');const sk=JSON.parse(require('fs').readFileSync('keypairs/carnage-wsol.json','utf8'));console.log(Keypair.fromSecretKey(Uint8Array.from(sk)).publicKey.toBase58())"`)

> **CRITICAL (Phase 69 lesson):** `CARNAGE_WSOL_PUBKEY` env var is **REQUIRED** on Railway. The crank reads this pubkey at two points: ALT loading (alt-helper.ts) and Carnage execution (carnage-flow.ts). Both fall back to reading `keypairs/carnage-wsol.json` from disk, which **does not exist on Railway** — the file is generated during `initialize.ts` and is not committed to git. Without the env var, the crank starts but crashes on the first Carnage trigger. General rule: **any local file the crank reads must have an env var fallback for Railway.**

### 11c. Restart crank runner
- Watch logs for 2-3 minutes
- Confirm "Epoch X: waiting for boundary" messages
- Confirm NO "account not found" errors
- **Confirm Carnage execution works** — wait for a Carnage trigger or check cycle 3+ logs for "carnage" entries without ENOENT errors

---

## Phase 12: Manual Verification

- [ ] Visit Railway URL, connect wallet
- [ ] Small SOL -> CRIME swap works
- [ ] Small SOL -> FRAUD swap works
- [ ] CRIME -> PROFIT vault conversion works
- [ ] PROFIT staking works (stake, check pending rewards)
- [ ] Epoch countdown timer visible
- [ ] Crank advancing epochs in Railway logs

---

## Cross-Program Dependency Graph

For reference — which programs reference which at compile time:

```
AMM ──references──> Tax Program (TAX_PROGRAM_ID in constants)

Tax Program ──references──> AMM (amm_program_id)
            ──references──> Epoch (epoch_program_id)
            ──references──> Staking (staking_program_id)

Epoch Program ──references──> AMM (amm_program_id)
              ──references──> Tax (tax_program_id)
              ──references──> Staking (staking_program_id)

Staking ──references──> Tax (tax_program_id)
        ──references──> Epoch (epoch_program_id)

Transfer Hook ──references──> (none)
Conversion Vault ──references──> (none, mints are feature-gated)
```

**Implication:** AMM, Tax, Epoch, and Staking form a cycle of cross-references. ALL FOUR must be updated together. Hook and Vault are independent.

---

## Files Modified Summary

| # | File | What changes |
|---|------|-------------|
| 1 | `programs/amm/src/lib.rs` | declare_id |
| 2 | `programs/amm/src/constants.rs` | TAX_PROGRAM_ID |
| 3 | `programs/transfer-hook/src/lib.rs` | declare_id |
| 4 | `programs/tax-program/src/lib.rs` | declare_id |
| 5 | `programs/tax-program/src/constants.rs` | amm_program_id, epoch_program_id, staking_program_id + test assertions |
| 6 | `programs/epoch-program/src/lib.rs` | declare_id |
| 7 | `programs/epoch-program/src/constants.rs` | amm_program_id, tax_program_id, staking_program_id + test assertions |
| 8 | `programs/staking/src/lib.rs` | declare_id |
| 9 | `programs/staking/src/constants.rs` | tax_program_id, epoch_program_id |
| 10 | `programs/conversion-vault/src/lib.rs` | declare_id |
| 11 | `programs/conversion-vault/src/constants.rs` | mint addresses (auto-patched by build.sh) |
| 12 | `programs/tax-program/tests/test_swap_sol_buy.rs` | staking_program_id mock |
| 13 | `programs/tax-program/tests/test_swap_sol_sell.rs` | staking_program_id mock |
| 14 | `Anchor.toml` | All program IDs (devnet + localnet sections) |
| 15 | `shared/constants.ts` | PROGRAM_IDS, MINTS, PDAS, POOLS, ALT |
| 16 | `app/idl/*.json` | Auto-synced from target/idl/ |
| 17 | `app/idl/types/*.ts` | Auto-synced from target/types/ |
| 18 | `app/lib/event-parser.ts` | Fix hardcoded TAX + EPOCH program IDs → import from shared/constants |
| 19 | `scripts/backfill-candles.ts` | Fix hardcoded Tax ID + pool addresses → import from shared/constants |
| 20 | `scripts/webhook-manage.ts` | Fix hardcoded TAX + EPOCH program IDs → import from shared/constants |
| 21 | `scripts/prepare-carnage-state.ts` | Fix hardcoded EPOCH program ID → import from shared/constants |
| 22 | `tests/devnet-vrf.ts` | Fix hardcoded EPOCH program ID → import from shared/constants |
| 23 | `tests/cross-program-integration.ts` | Fix hardcoded TAX + EPOCH program IDs → import from shared/constants |
| 24 | `programs/stub-staking/src/lib.rs` | Update Epoch Program ID reference |
| 25 | `shared/programs.ts` | Update DEVNET_ALT address (after Phase 8) |
| 26 | `scripts/deploy/initialize.ts` | **FIX BUG:** VAULT_SEED_PROFIT must subtract MINIMUM_STAKE |
| 27 | `scripts/verify-program-ids.ts` | Update mock_tax_program expectedDeclareId to match new Tax ID |

---

## Mainnet Checklist Updates

After this redeploy, add these items to `Docs/mainnet-checklist.md`:

1. **Singleton PDAs with baked-in mints:** When redeploying with new mints, singleton PDAs (like stake_vault) that have mint addresses baked into their token account data MUST be closed and recreated. Reusing program keypairs does NOT refresh PDA account data.

2. **Whitelist authority burn:** `initialize.ts` burns MINT authorities but does NOT burn the WHITELIST authority. On mainnet, the whitelist authority MUST be burned as the final step after all whitelist entries are confirmed. Add explicit step to initialize.ts.

3. **Dead stake bootstrapping:** `initialize_stake_pool` requires MINIMUM_STAKE PROFIT from admin. The admin must retain PROFIT tokens BEFORE mint authority is burned. Verify initialize.ts step ordering preserves this.

4. **Full redeploy = no two-pass:** When ALL keypairs are regenerated, all addresses are known upfront. One build, one deploy, one initialize. Two-pass is only needed when reusing program keypairs with new mints.

---

*This schedule is the SINGLE SOURCE OF TRUTH for the redeploy. Follow it exactly, in order, step by step.*
