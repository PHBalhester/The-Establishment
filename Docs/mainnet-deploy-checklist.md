# Dr. Fraudsworth's Finance Factory -- Mainnet Deployment Checklist

**Version:** 1.1
**Last Updated:** 2026-03-15
**Validated:** 2026-03-15 (Phase 98 Plan 03 -- fresh devnet deploy, all stages 0-4 passed)
**Applies to:** v1.4 Pre-Mainnet milestone

---

## Overview

This document IS the mainnet deployment procedure. An operator follows it step-by-step to deploy and launch the Dr. Fraudsworth protocol on Solana mainnet-beta.

Every checklist item has three parts:
1. **Action** -- the exact command to run
2. **Verify** -- the verification command
3. **Expected** -- what the output should look like

If any verification fails, STOP. Do not proceed. Fix the issue before continuing.

### Deployment Timing Strategy

The 8-stage architecture enables pre-deploying everything days before launch:

| Stage | Name | When to Run | Reversible? |
|-------|------|-------------|-------------|
| 0 | Preflight | Days before launch | N/A (read-only) |
| 1 | Build | Days before launch | Yes (rebuild) |
| 2 | Deploy 6 Core Programs | Days before launch | Yes (redeploy) |
| 3 | Initialize Core | Days before launch | No (but idempotent) |
| 4 | Infrastructure | Days before launch | Yes (recreate ALT) |
| 5 | **Launch** (deploy BC + init curves) | **Launch moment** | **No -- curves go live** |
| 6 | Graduation | After both curves fill | No -- pools created |
| 7 | Governance | After trading is stable | No -- authority transferred |

**Stages 0-4** can be completed days in advance. Only **Stage 5** runs at launch time (~5 minutes: deploy bonding curve + whitelist + init curves). Bonding curve is deliberately withheld from Stage 2 as an anti-sniper measure. **Stage 6** runs after community fills both curves. **Stage 7** runs after trading stability is confirmed.

### Prerequisites (Before Stage 0)

- [ ] Mainnet deployer wallet created and funded (>= 32 SOL)
- [ ] Mainnet vanity mint keypairs generated (`keypairs/mainnet-{crime,fraud,profit}-mint.json`)
- [ ] `.env.mainnet` created from `.env.example` with all values populated (no `CHANGE_ME` placeholders)
- [ ] Helius mainnet RPC endpoint configured
- [ ] Railway production environment configured (Phase 98.1)
- [ ] Arweave metadata uploaded (Phase 93)
- [ ] Team coordination: all 3 Squads signers have wallets ready
- [ ] Crank deployment plan ready for Railway

---

## Stage 0: Preflight

**Can be run days before launch. Read-only checks, costs 0 SOL.**

**Automated:** `./scripts/deploy/stage-0-preflight.sh mainnet`

### 0.1 Toolchain Version Gate

**Action:**
```bash
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

solana --version
anchor --version
rustc --version
node --version
```

**Verify:**
```bash
solana --version | grep -E '^solana-cli 3\.'
anchor --version | grep -E '^anchor-cli 0\.32\.'
rustc --version | grep -oE '[0-9]+\.[0-9]+' | head -1 | awk -F. '{exit ($2 < 79)}'
node --version | grep -oE '[0-9]+' | head -1 | awk '{exit ($1 < 18)}'
```

**Expected:**
```
solana-cli 3.x.x (src:...; feat:...)
anchor-cli 0.32.x
rustc 1.79+ (or higher)
v18+ (or higher)
```

- [ ] Verified -- all toolchain versions meet minimum requirements

### 0.2 Environment Files

> **WARNING (Pitfall #1 - Source .env):** Always `set -a && source .env.mainnet && set +a` BEFORE running any initialization scripts. Pool seed amounts are env vars (`SOL_POOL_SEED_SOL_OVERRIDE`, `SOL_POOL_SEED_TOKEN_OVERRIDE`). Missing this uses test defaults (10 SOL / 10K tokens). Pools CANNOT be re-seeded -- requires full redeploy. This mistake cost ~50 SOL on Phase 69.

**Action:**
```bash
# Check .env.mainnet exists
test -f .env.mainnet && echo "EXISTS" || echo "MISSING"

# Source it and check required vars
set -a && source .env.mainnet && set +a
echo "HELIUS_API_KEY: ${HELIUS_API_KEY:+SET}"
echo "CLUSTER_URL: ${CLUSTER_URL:+SET}"
echo "COMMITMENT: ${COMMITMENT:+SET}"
echo "DEPLOYER_KEYPAIR: ${DEPLOYER_KEYPAIR:+SET}"
echo "TREASURY_PUBKEY: ${TREASURY_PUBKEY:+SET}"
echo "MAINNET_MIN_BALANCE: ${MAINNET_MIN_BALANCE:+SET}"

# DBS migration env vars (server-side SSE infrastructure)
echo "WS_SUBSCRIBER_ENABLED: ${WS_SUBSCRIBER_ENABLED:+SET}"
echo "TOKEN_SUPPLY_POLL_INTERVAL_MS: ${TOKEN_SUPPLY_POLL_INTERVAL_MS:+SET}"
echo "STAKER_COUNT_POLL_INTERVAL_MS: ${STAKER_COUNT_POLL_INTERVAL_MS:+SET}"
echo "SLOT_BROADCAST_INTERVAL_MS: ${SLOT_BROADCAST_INTERVAL_MS:+SET}"
```

**Verify:**
```bash
# No CHANGE_ME placeholders remaining
grep -c "CHANGE_ME" .env.mainnet
```

**Expected:**
```
EXISTS
HELIUS_API_KEY: SET
CLUSTER_URL: SET
COMMITMENT: SET
DEPLOYER_KEYPAIR: SET
TREASURY_PUBKEY: SET
MAINNET_MIN_BALANCE: SET
WS_SUBSCRIBER_ENABLED: SET
TOKEN_SUPPLY_POLL_INTERVAL_MS: SET
STAKER_COUNT_POLL_INTERVAL_MS: SET
SLOT_BROADCAST_INTERVAL_MS: SET
0   (no CHANGE_ME placeholders)
```

- [ ] Verified -- .env.mainnet exists with all variables populated (including DBS migration vars)

### 0.3 Wallet Verification

**Action:**
```bash
WALLET="$DEPLOYER_KEYPAIR"
solana-keygen pubkey "$WALLET"
solana balance --keypair "$WALLET" --url "$CLUSTER_URL"
```

**Verify:**
```bash
BALANCE=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" | grep -oE '[0-9]+\.?[0-9]*' | head -1)
awk "BEGIN { print ($BALANCE >= 32) ? \"SUFFICIENT\" : \"INSUFFICIENT\" }"
```

**Expected:**
```
[deployer pubkey, e.g. 23g7xmrt...59YR]
26+ SOL
SUFFICIENT
```

- [ ] Verified -- deployer wallet has >= 26 SOL

### 0.4 Keypair Safety

**Action:**
```bash
# Check no keypair files are staged in git
git diff --cached --name-only | grep -iE '(keypair|wallet|mint|deployer|mainnet).*\.json$' || echo "CLEAN"

# Check mainnet vanity mint keypairs exist
for TOKEN in crime fraud profit; do
  FILE="keypairs/mainnet-${TOKEN}-mint.json"
  if [ -f "$FILE" ]; then
    ADDR=$(solana-keygen pubkey "$FILE")
    echo "  ${TOKEN}: $ADDR"
  else
    echo "  ${TOKEN}: MISSING"
  fi
done
```

> **WARNING (Pitfall #3 - Build Without Mint Keypairs):** Programs compile with stale/placeholder mint addresses if keypairs don't exist before build. This causes `InvalidMintPair (6002)` during vault initialization. Stage 0 copies vanity keypairs to `scripts/deploy/mint-keypairs/` so build.sh can find them.

**Verify:**
```bash
# Vanity addresses should match expected patterns
solana-keygen pubkey keypairs/mainnet-crime-mint.json | grep -q "^cRiME" && echo "CRIME: OK" || echo "CRIME: WRONG PREFIX"
solana-keygen pubkey keypairs/mainnet-fraud-mint.json | grep -q "^FraUd" && echo "FRAUD: OK" || echo "FRAUD: WRONG PREFIX"
solana-keygen pubkey keypairs/mainnet-profit-mint.json | grep -q "^pRoFiT" && echo "PROFIT: OK" || echo "PROFIT: WRONG PREFIX"
```

**Expected:**
```
CLEAN
  crime: cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc
  fraud: FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5
  profit: pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR
CRIME: OK
FRAUD: OK
PROFIT: OK
```

- [ ] Verified -- no keypairs staged in git, all vanity mint keypairs present

### 0.5 RPC Connectivity

**Action:**
```bash
# Test mainnet RPC responds
curl -s -X POST "$CLUSTER_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
```

**Verify:**
```bash
curl -s -X POST "$CLUSTER_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq -r '.result'
```

**Expected:**
```
ok
```

- [ ] Verified -- Helius mainnet RPC endpoint responds

---

### Stage 0 GO/NO-GO Gate

- [x] 0.1 Toolchain versions: solana 3.0.13, anchor 0.32.1, rustc 1.93.0, node v24.1.0
- [x] 0.2 Environment files: .env.mainnet exists, all vars populated (3 CHANGE_ME remain for Stage 7)
- [x] 0.3 Wallet: deployer balance 27.7 SOL (>= 26 SOL minimum)
- [x] 0.4 Keypairs: no secrets in git staging, vanity mint keypairs present
- [x] 0.5 RPC: Helius mainnet endpoint responds healthy

**All checks pass?**
- [x] **PROCEED TO STAGE 1** (completed 2026-03-15)

> If ANY check fails, STOP. Do not proceed. Fix the issue before continuing.

---

## Stage 1: Build & Verify Binaries

**Can be done days before launch. Local compilation only, costs 0 SOL.**

**Automated:** `./scripts/deploy/stage-1-build.sh mainnet`

### 1.1 Copy Mint Keypairs to Build Location

**Action:**
```bash
# Stage 0 should have done this, but verify
mkdir -p scripts/deploy/mint-keypairs
for TOKEN in crime fraud profit; do
  cp "keypairs/mainnet-${TOKEN}-mint.json" "scripts/deploy/mint-keypairs/${TOKEN}-mint.json"
done
echo "Mint keypairs copied."
```

**Verify:**
```bash
for TOKEN in crime fraud profit; do
  ls -la "scripts/deploy/mint-keypairs/${TOKEN}-mint.json"
done
```

**Expected:**
```
-rw-------  ... scripts/deploy/mint-keypairs/crime-mint.json
-rw-------  ... scripts/deploy/mint-keypairs/fraud-mint.json
-rw-------  ... scripts/deploy/mint-keypairs/profit-mint.json
```

- [ ] Verified -- mint keypairs in build location

### 1.2 Compile All 7 Programs

> **WARNING (Pitfall #4 - Feature-Flagged Build Split):** 4 programs (tax, epoch, vault, bonding_curve) have devnet/mainnet feature flags. `build.sh` handles this automatically -- non-flagged programs first, then flagged programs without `--features devnet`. Mainnet build does NOT use `--devnet` flag.

**Action:**
```bash
# Mainnet build: no --devnet flag
./scripts/deploy/build.sh
```

**Verify:**
```bash
# All 7 .so files must exist
for PROG in amm transfer_hook tax_program epoch_program staking conversion_vault bonding_curve; do
  if [ -f "target/deploy/${PROG}.so" ]; then
    SIZE=$(wc -c < "target/deploy/${PROG}.so" | tr -d ' ')
    echo "  ${PROG}.so: ${SIZE} bytes ($(( SIZE / 1024 )) KB)"
  else
    echo "  ${PROG}.so: MISSING"
  fi
done
```

**Expected:**
```
  amm.so: ~423K bytes (~413 KB)
  transfer_hook.so: ~340K bytes (~332 KB)
  tax_program.so: ~407K bytes (~397 KB)
  epoch_program.so: ~519K bytes (~507 KB)
  staking.so: ~425K bytes (~415 KB)
  conversion_vault.so: ~375K bytes (~366 KB)
  bonding_curve.so: ~564K bytes (~551 KB)
```

- [ ] Verified -- all 7 programs compiled successfully

### 1.3 Generate Binary Hash Manifest

**Action:**
```bash
./scripts/deploy/generate-hashes.sh mainnet
```

**Verify:**
```bash
cat deployments/expected-hashes.mainnet.json | jq .
```

**Expected:**
```json
{
  "cluster": "mainnet",
  "generated": "2026-...",
  "programs": {
    "amm": "[sha256 hash]",
    "transfer_hook": "[sha256 hash]",
    "tax_program": "[sha256 hash]",
    "epoch_program": "[sha256 hash]",
    "staking": "[sha256 hash]",
    "conversion_vault": "[sha256 hash]",
    "bonding_curve": "[sha256 hash]"
  }
}
```

- [ ] Verified -- hash manifest generated with all 7 programs

### 1.4 Binary Address Cross-Validation (CRITICAL)

> **WARNING (Pitfall #8 - Devnet Addresses in Mainnet Binaries):** Feature-flagged programs compile mint addresses directly into .so binaries. Building for mainnet without mainnet mint keypairs bakes in devnet addresses. Deploying these = permanent wrong addresses in immutable code. This check greps every .so binary for known devnet addresses from `deployments/devnet.json`.

**Action:**
```bash
# Extract devnet addresses and check mainnet binaries
FLAGGED="conversion_vault tax_program epoch_program bonding_curve"
for PROG in $FLAGGED; do
  MATCHES=$(strings "target/deploy/${PROG}.so" | grep -cF "$(jq -r '.mints.crime // empty' deployments/devnet.json 2>/dev/null)" 2>/dev/null || echo "0")
  echo "  ${PROG}: ${MATCHES} devnet address matches"
done
```

**Verify:**
```bash
# stage-1-build.sh does this automatically. All counts must be 0.
echo "Manual cross-check: verify no devnet mint addresses in mainnet .so files"
```

**Expected:**
```
  conversion_vault: 0 devnet address matches
  tax_program: 0 devnet address matches
  epoch_program: 0 devnet address matches
  bonding_curve: 0 devnet address matches
```

- [ ] Verified -- no devnet addresses found in mainnet binaries

### 1.5 Record Binary Sizes for Budget Verification

**Action:**
```bash
# Calculate actual rent costs from binary sizes
echo "Program deployment cost estimates:"
for PROG in amm transfer_hook tax_program epoch_program staking conversion_vault bonding_curve; do
  SIZE=$(wc -c < "target/deploy/${PROG}.so" | tr -d ' ')
  RENT=$(solana rent "$SIZE" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "N/A")
  echo "  ${PROG}: ${SIZE} bytes -> ${RENT} SOL"
done
```

**Expected:**
```
  amm: ~423K bytes -> ~2.95 SOL
  transfer_hook: ~340K bytes -> ~2.37 SOL
  tax_program: ~407K bytes -> ~2.83 SOL
  epoch_program: ~519K bytes -> ~3.61 SOL
  staking: ~425K bytes -> ~2.96 SOL
  conversion_vault: ~375K bytes -> ~2.61 SOL
  bonding_curve: ~564K bytes -> ~3.93 SOL
  TOTAL: ~21.26 SOL
```

- [ ] Verified -- binary sizes recorded, total deploy cost confirmed within budget

---

### Stage 1 GO/NO-GO Gate

- [x] 1.1 Mint keypairs copied to build location
- [x] 1.2 All 7 programs compiled (29/29 ID checks)
- [x] 1.3 Hash manifest generated at `deployments/expected-hashes.mainnet.json`
- [x] 1.4 No devnet addresses found in mainnet binaries
- [x] 1.5 Binary sizes recorded, deployment cost within budget

**All checks pass?**
- [x] **PROCEED TO STAGE 2** (completed 2026-03-15)

> If ANY check fails, STOP. Rebuild with correct mint keypairs before continuing.

---

## Stage 2: Deploy Core Programs

**Can be done days before launch. Costs ~20.8 SOL in program rent (1.2x buffer).**

> **ANTI-SNIPER: Bonding curve is NOT deployed here.** It deploys at Stage 5 (launch time) to minimize the window for attackers to decompile bytecode and build sniping bots. No other program has a compile-time dependency on bonding_curve.

**Automated:** `./scripts/deploy/stage-2-deploy.sh mainnet`

> **WARNING (Pitfall #10 - Stop Crank Before Deploying):** Stop any running crank before deploying. Partially-deployed programs + running crank = instruction errors. The crank tries to advance epochs using programs that may be in mid-deploy state.

> **WARNING (Pitfall #11 - Solana CLI Path With Spaces):** The project directory "Dr Fraudsworth" has a space. Solana CLI may fail with "unrecognized signer source". Workaround: `ln -sf "$PWD" ~/.dr-fraudsworth-link` and use the symlink path for CLI calls.

### 2.1 Pre-Deploy Safety Checks

**Action:**
```bash
# Verify 6 core program artifacts (bonding_curve deploys at Stage 5)
for PROG in amm transfer_hook tax_program epoch_program staking conversion_vault; do
  test -f "target/deploy/${PROG}.so" && echo "  ${PROG}: OK" || echo "  ${PROG}: MISSING"
done
# Also verify bonding_curve binary exists (built but not deployed yet)
test -f "target/deploy/bonding_curve.so" && echo "  bonding_curve: OK (deploys at Stage 5)" || echo "  bonding_curve: MISSING"

# Verify deployer balance (~21 SOL for 6 programs, ~5 SOL reserved for BC at Stage 5)
solana balance --keypair "$WALLET" --url "$CLUSTER_URL"
```

**Expected:**
```
  amm: OK
  transfer_hook: OK
  tax_program: OK
  epoch_program: OK
  staking: OK
  conversion_vault: OK
  bonding_curve: OK (deploys at Stage 5)
  32+ SOL
```

- [ ] Verified -- all artifacts present, sufficient balance

> **WARNING (Pitfall #2 - Solana CLI v3 --keypair Required):** All `solana program show` and `solana program deploy` commands require explicit `--keypair` flag. Without it, CLI v3 errors with "No default signer found".

### 2.2 Deploy 6 Core Programs

> **ANTI-SNIPER NOTE:** Bonding curve is deliberately excluded here. It deploys at Stage 5 (launch time) to minimize the window for attackers to analyze the bytecode. deploy.sh handles this automatically.

**Action:**
```bash
# deploy.sh deploys 6 core programs (bonding_curve is excluded)
./scripts/deploy/deploy.sh "$CLUSTER_URL"
```

**Verify:**
```bash
# Check each of the 6 core programs on-chain
PROGRAMS="amm transfer_hook tax_program epoch_program staking conversion_vault"
KEYPAIRS=("keypairs/amm-keypair.json" "keypairs/transfer-hook-keypair.json" "keypairs/tax-program-keypair.json" "keypairs/epoch-program.json" "keypairs/staking-keypair.json" "keypairs/vault-keypair.json")

i=0
for PROG in $PROGRAMS; do
  PROG_ID=$(solana-keygen pubkey "${KEYPAIRS[$i]}")
  solana program show "$PROG_ID" --url "$CLUSTER_URL" --keypair "$WALLET"
  echo "---"
  i=$((i + 1))
done

# Confirm bonding_curve is NOT on-chain yet
BC_ID=$(solana-keygen pubkey keypairs/bonding-curve-keypair.json)
solana program show "$BC_ID" --url "$CLUSTER_URL" --keypair "$WALLET" 2>&1 | grep -q "Program Id" && echo "WARNING: bonding_curve already deployed!" || echo "OK: bonding_curve not deployed (expected -- deploys at Stage 5)"
```

**Expected (for each of the 6 programs):**
```
Program Id: [program address]
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: [address]
Authority: [deployer pubkey]
```

```
OK: bonding_curve not deployed (expected -- deploys at Stage 5)
```

- [ ] Verified -- all 6 core programs deployed, authority = deployer, bonding_curve NOT deployed

### 2.3 Run verify.ts Program Checks

**Action:**
```bash
npx tsx scripts/deploy/verify.ts 2>&1 | head -40
```

**Expected:** 6 core program checks PASS. Bonding curve check will FAIL (expected — not deployed yet).

- [ ] Verified -- 6/7 program checks pass (bonding_curve expected to fail)

---

### Stage 2 GO/NO-GO Gate

- [x] 2.1 All 7 .so artifacts present (6 deployed, 1 reserved), balance sufficient
- [x] 2.2 All 6 core programs deployed: Authority=23g7xmrt...59YR for each. Cost: 20.76 SOL
- [x] 2.3 Bonding curve confirmed NOT on-chain (anti-sniper)
- [x] 2.4 verify.ts passes for 6 core programs (BC expected fail)

**All checks pass?**
- [x] **PROCEED TO STAGE 3** (completed 2026-03-15)

> If ANY core program failed to deploy, check: balance sufficient? correct keypair? path-with-spaces issue?

---

## Stage 3: Initialize Core

**Can be done days before launch. Costs ~0.1 SOL (PDA rent + TX fees).**

**Automated:** `./scripts/deploy/stage-3-initialize.sh mainnet`

> **WARNING (Pitfall #1 - Source .env BEFORE initialize.ts):** This is the MOST CRITICAL pitfall. Pool seed amounts (`SOL_POOL_SEED_SOL_OVERRIDE`, `SOL_POOL_SEED_TOKEN_OVERRIDE`) are env vars. Missing the `set -a && source .env.mainnet && set +a` step before `initialize.ts` uses test defaults (10 SOL / 10K tokens). Pools CANNOT be re-seeded -- requires full redeploy. This mistake cost ~50 SOL on Phase 69.

> **WARNING (Pitfall #6 - DO NOT Create Pools Here):** Pools are created during graduation (Stage 6) using SOL from filled bonding curves. Creating pools at this stage with arbitrary amounts wastes SOL and creates mismatched liquidity. Also DO NOT burn whitelist authority here -- it's needed post-graduation to whitelist pool vault addresses.

### 3.1 Run initialize.ts

> **WARNING (Pitfall #7 - Carnage WSOL Account Owner Validation):** Fresh deploy changes Epoch Program ID, which changes CarnageSigner PDA. `initialize.ts` validates WSOL account owner field, not just existence. If re-running after a failed deploy, stale WSOL accounts with wrong owners are detected and recreated.

> **WARNING (Pitfall #13 - skipPreflight Silent TX Failures):** `initialize.ts` uses `confirmOrThrow` helper that checks `confirmation.value.err` after each transaction. Without this, failed TXs with `skipPreflight: true` show as "confirmed" but silently error. Subsequent steps fail with cryptic state mismatches.

**Action:**
```bash
# CRITICAL: Source .env BEFORE running
set -a && source .env.mainnet && set +a

npx tsx scripts/deploy/initialize.ts
```

**Verify:**
```bash
# Check deployment.json was created/updated
cat "deployments/mainnet.json" | jq '.mints'
```

**Expected:**
```
initialize.ts runs 23 idempotent steps:
  Step 1: Create CRIME mint (Token-2022 + TransferHook + MetadataPointer + TokenMetadata)
  Step 2: Create FRAUD mint
  Step 3: Create PROFIT mint
  Step 4-6: Mint token supply (CRIME=1B, FRAUD=1B, PROFIT=20M)
  Step 7: Initialize AMM AdminConfig
  Step 8: Initialize Whitelist Authority
  Step 9-11: Create whitelist entries
  Step 12: Initialize Transfer Hook ExtraAccountMetaLists
  Step 13: Initialize EpochState
  Step 14: Initialize StakePool + StakeVault + EscrowVault
  Step 15: Initialize CarnageFund + vaults + WSOL
  Step 16: Initialize VaultConfig + vault token accounts
  Step 17: Initialize BcAdminConfig
  ...
  deployments/mainnet.json updated with all addresses

{
  "crime": "[vanity address starting with cRiME]",
  "fraud": "[vanity address starting with FraUd]",
  "profit": "[vanity address starting with pRoFiT]"
}
```

- [ ] Verified -- initialize.ts completed all steps, deployments/mainnet.json has correct mint addresses

### 3.2 Verify Mints Created

**Action:**
```bash
# Check each mint on-chain
for TOKEN in crime fraud profit; do
  MINT=$(jq -r ".mints.${TOKEN}" deployments/mainnet.json)
  echo "=== ${TOKEN} ==="
  spl-token display "$MINT" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null || \
    solana account "$MINT" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | head -5
done
```

**Verify:**
```bash
# Mints should have Token-2022 program as owner
for TOKEN in crime fraud profit; do
  MINT=$(jq -r ".mints.${TOKEN}" deployments/mainnet.json)
  OWNER=$(solana account "$MINT" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | grep "Owner" | awk '{print $NF}')
  echo "  ${TOKEN} owner: $OWNER"
done
```

**Expected:**
```
  crime owner: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
  fraud owner: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
  profit owner: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
```

(Token-2022 program address = `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`)

- [ ] Verified -- all 3 mints created with Token-2022 program ownership

### 3.3 Verify Key PDAs Initialized

**Action:**
```bash
# Check critical PDAs exist on-chain
DEPLOYMENT="deployments/mainnet.json"
for PDA_KEY in adminConfig whitelistAuthority epochState stakePool carnageFund vaultConfig; do
  ADDR=$(jq -r ".pdas.${PDA_KEY} // .${PDA_KEY} // \"not-in-json\"" "$DEPLOYMENT")
  if [ "$ADDR" != "not-in-json" ] && [ "$ADDR" != "null" ]; then
    EXISTS=$(solana account "$ADDR" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | grep -c "Owner" || echo "0")
    echo "  ${PDA_KEY}: ${ADDR} (exists: $EXISTS)"
  else
    echo "  ${PDA_KEY}: not found in deployment.json"
  fi
done
```

**Expected:**
```
  adminConfig: [address] (exists: 1)
  whitelistAuthority: [address] (exists: 1)
  epochState: [address] (exists: 1)
  stakePool: [address] (exists: 1)
  carnageFund: [address] (exists: 1)
  vaultConfig: [address] (exists: 1)
```

- [ ] Verified -- all critical PDAs initialized on-chain

### 3.4 Verify BcAdminConfig

**Action:**
```bash
BC_ADMIN=$(jq -r '.pdas.bcAdminConfig // "not-found"' deployments/mainnet.json)
solana account "$BC_ADMIN" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | head -5
```

**Expected:**
```
Public Key: [BcAdminConfig PDA address]
Balance: [rent-exempt amount]
Owner: [bonding_curve program ID]
...
```

- [ ] Verified -- BcAdminConfig initialized with bonding curve program as owner

### 3.5 Run verify.ts Initialization Checks

**Action:**
```bash
npx tsx scripts/deploy/verify.ts 2>&1
```

**Verify:**
```bash
npx tsx scripts/deploy/verify.ts 2>&1 | grep -E "(PASS|FAIL|SKIP)"
```

**Expected:**
```
[PASS] All program checks
[PASS] All mint checks
[PASS] All PDA checks
[SKIP] Pool checks (pools not created yet -- expected at Stage 3)
...
```

- [ ] Verified -- verify.ts confirms initialization (pool checks may SKIP, that's expected)

---

### Stage 3 GO/NO-GO Gate

- [x] 3.1 initialize.ts completed (32 done, 13 skipped -- BC deferred, pools deferred)
- [x] 3.2 All 3 mints created: cRiME, FraUd, pRoFiT with Irys metadata
- [x] 3.3 All critical PDAs initialized (AdminConfig, Whitelist, Epoch, Stake, Carnage, Vault)
- [x] 3.4 BcAdminConfig DEFERRED (anti-sniper -- BC not deployed)
- [x] 3.5 verify.ts: 32/65 pass (33 expected fails: BC, pools, pool whitelists)
- [x] Pools NOT created (deferred to Stage 6)
- [x] Whitelist authority NOT burned (needed for Stage 6)
- [x] Mint authorities BURNED (CRIME, FRAUD, PROFIT)

**All checks pass?**
- [x] **PROCEED TO STAGE 4** (completed 2026-03-15)

> If initialization failed partway through, re-run. initialize.ts is idempotent and picks up where it left off.

---

## Stage 4: Infrastructure

**Can be done days before launch. Costs ~0.01 SOL (ALT creation + TX fees).**

**Automated:** `./scripts/deploy/stage-4-infra.sh mainnet`

### 4.1 Create Address Lookup Table

**Action:**
```bash
set -a && source .env.mainnet && set +a
npx tsx scripts/deploy/create-alt.ts
```

**Verify:**
```bash
# ALT address file should exist
cat scripts/deploy/alt-address.json
```

**Expected:**
```
"[ALT public key address]"
```

- [ ] Verified -- ALT created and address saved

### 4.2 Generate shared/constants.ts

**Action:**
```bash
npx tsx scripts/deploy/generate-constants.ts mainnet
```

**Verify:**
```bash
# constants.ts should have mainnet program IDs
grep "AMM_PROGRAM_ID" shared/constants.ts
grep "CRIME_MINT" shared/constants.ts
```

**Expected:**
```
export const AMM_PROGRAM_ID = new PublicKey("[mainnet AMM address]");
export const CRIME_MINT = new PublicKey("cRiME...");
```

- [ ] Verified -- shared/constants.ts generated with mainnet addresses

### 4.3 Sync IDLs to Frontend

> **WARNING (Pitfall #5 - IDL Sync After Deploy):** `anchor build` updates `target/idl/` but NOT `app/idl/`. Stale IDLs cause constraint errors and wrong account layouts. The Program constructor reads the `"address"` field from IDL JSON -- if it doesn't match the deployed program, transactions fail silently.

**Action:**
```bash
mkdir -p app/idl/types

# Copy IDL JSON files
cp target/idl/*.json app/idl/
echo "Copied $(ls target/idl/*.json | wc -l | tr -d ' ') IDL JSON files"

# Copy TypeScript type files
cp target/types/*.ts app/idl/types/
echo "Copied $(ls target/types/*.ts | wc -l | tr -d ' ') TypeScript type files"
```

**Verify:**
```bash
# IDL address field should match deployed program
AMM_IDL_ADDR=$(jq -r '.address // .metadata.address // "not-found"' app/idl/amm.json)
AMM_DEPLOYED=$(solana-keygen pubkey keypairs/amm-keypair.json)
echo "IDL address: $AMM_IDL_ADDR"
echo "Deployed:    $AMM_DEPLOYED"
[ "$AMM_IDL_ADDR" = "$AMM_DEPLOYED" ] && echo "MATCH" || echo "MISMATCH"
```

**Expected:**
```
Copied 7 IDL JSON files
Copied 7 TypeScript type files
IDL address: [AMM program ID]
Deployed:    [AMM program ID]
MATCH
```

- [ ] Verified -- IDLs synced, addresses match deployed programs

### 4.4 Verify Frontend Builds

**Action:**
```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run build 2>&1 | tail -10
```

**Verify:**
```bash
# Build should complete without errors
test -d .next && echo "BUILD OK" || echo "BUILD FAILED"
```

**Expected:**
```
...compilation output...
BUILD OK
```

- [ ] Verified -- frontend builds with new constants and IDLs

### 4.5 Deploy Frontend to Railway

This is a manual step. See Phase 98.1 for production infrastructure staging.

**Action:**
```
1. Push code with updated constants/IDLs to git
2. Railway auto-deploys from main branch
3. Or manually trigger deploy in Railway dashboard
4. Set NEXT_PUBLIC_SITE_MODE=launch on Railway (locked-down state)
5. Set NEXT_PUBLIC_CLUSTER=mainnet on Railway
6. Set NEXT_PUBLIC_RPC_URL to Helius mainnet endpoint
7. Set DBS migration env vars on Railway (server-side WebSocket subscriber):
   - WS_SUBSCRIBER_ENABLED=true
   - TOKEN_SUPPLY_POLL_INTERVAL_MS=60000
   - STAKER_COUNT_POLL_INTERVAL_MS=30000
   - SLOT_BROADCAST_INTERVAL_MS=5000
```

> **NOTE (DBS Migration):** Steps 7 are required for the server-side SSE infrastructure added by the DBS migration (Don't Break Shit). Without `WS_SUBSCRIBER_ENABLED=true`, the ws-subscriber won't start and all SSE-powered hooks (pool prices, epoch state, curve data, staking, token supply, slot, carnage) will fall back to slower RPC polling. The other 3 vars have sensible defaults but should be set explicitly for mainnet.

**Verify:**
```bash
# After Railway deploy, check site is accessible
curl -s -o /dev/null -w "%{http_code}" https://[your-domain]/
```

**Expected:**
```
200 (site accessible in launch mode)
```

- [ ] Verified -- frontend deployed to Railway in launch mode

---

### Stage 4 GO/NO-GO Gate

- [x] 4.1 ALT created: 7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h (55 addresses)
- [x] 4.2 shared/constants.ts generated from deployments/mainnet.json (508 lines)
- [x] 4.3 IDLs synced to app/idl/ (10 JSON + 10 TS type files)
- [ ] 4.4 ALT address is in deployments/mainnet.json (not null) — Phase 102 found `deploy-all.sh` may write ALT to `alt-address.json` but not to `deployment.json`, causing `new PublicKey("null")` build crash
- [ ] 4.5 Frontend builds without errors (manual step)
- [ ] 4.6 Frontend deployed to Railway in launch mode (manual step)

**All checks pass?**
- [x] **STAGES 0-4 COMPLETE** (completed 2026-03-15)

> Stages 0-4 are now complete. Everything above can sit deployed for days.
> Stage 5 is THE PUBLIC LAUNCH MOMENT. Only proceed when the team is ready.

---

## Stage 5: LAUNCH

**THIS IS THE PUBLIC LAUNCH MOMENT. After this, bonding curves are LIVE for buying.**
**Takes ~5 minutes. Costs ~4.7 SOL (bonding curve deploy) + ~0.01 SOL (curve init). Cannot be undone.**

**Automated:** `./scripts/deploy/stage-5-launch.sh mainnet`

### Anti-Sniper Strategy

The bonding curve program is deliberately NOT deployed in Stage 2 (days before launch). It deploys HERE, at launch time, to minimize the window for attackers to:
- Decompile the SBF bytecode and analyze curve parameters
- Pre-build sniping bots with correct PDAs and account layouts
- Simulate transactions against the deployed program

No other program has a compile-time dependency on bonding_curve (verified in Phase 98 audit). The bonding curve keypair exists (program ID is known for builds), but the bytecode is not on-chain until this stage.

### Pre-Launch Checklist (Final Confirmation)

Before running Stage 5, confirm:

- [x] All Stages 0-4 verified and signed off
- [x] Team is online and available for monitoring
- [x] Sentry error monitoring configured and watched
- [x] Helius RPC dashboard accessible
- [x] `graduate.ts` ready to run (not needed now, but have it ready)
- [x] Rollback plan reviewed (see Appendix B: Emergency Procedures)
- [x] Community communication prepared (announcement ready)
- [x] Deployer wallet has ~5 SOL remaining for bonding curve deploy
- [x] `NEXT_PUBLIC_CURVE_PHASE=true` set on Railway frontend service (redirects / to /launch)
- [x] Helius webhook updated with CurveState PDA addresses for real-time gauge updates

### 5.1 Deploy Bonding Curve Program

> **This is the anti-sniper step.** The bonding curve binary was built at Stage 1 but withheld from deployment until now.

**Action:**
```bash
# Deploy bonding curve with 1.2x buffer (same as core programs)
BC_KEYPAIR="keypairs/bonding-curve-keypair.json"
BC_BINARY="target/deploy/bonding_curve.so"
BC_SIZE=$(wc -c < "$BC_BINARY" | tr -d ' ')
BC_MAX_LEN=$(echo "$BC_SIZE * 1.2 / 1" | bc)

solana program deploy "$BC_BINARY" \
  --program-id "$BC_KEYPAIR" \
  --keypair "$WALLET" \
  --url "$CLUSTER_URL" \
  --with-compute-unit-price 1 \
  --max-len "$BC_MAX_LEN"
```

**Verify:**
```bash
BC_ID=$(solana-keygen pubkey keypairs/bonding-curve-keypair.json)
solana program show "$BC_ID" --url "$CLUSTER_URL" --keypair "$WALLET"
```

**Expected:**
```
Program Id: [bonding curve address]
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: [address]
Authority: [deployer pubkey]
```

- [x] Verified -- bonding curve deployed, authority = deployer (slot 408541203, TX 3tb2GwPQ...)

### 5.2 Whitelist Curve Vaults + Initialize Curves

> **WARNING (Phase 102 Lesson — BC Deploy Timing):** `initialize.ts` checks if the bonding curve program exists on-chain via `accountExists()`. If run immediately after `stage-5-launch.sh` deploys the BC program, the check may fail due to RPC propagation delay — Steps 17-25 get skipped with "Bonding curve program not deployed yet." If this happens, simply **re-run initialize.ts** — it's idempotent and will pick up the skipped steps on the second run.

**Action:**
```bash
set -a && source .env.mainnet && set +a

# initialize.ts is idempotent -- skips completed steps (1-19).
# Picks up from step 20: whitelist CRIME/FRAUD curve vaults in transfer hook,
# then steps 22-23: initialize curves. Whitelist MUST happen before funding
# because token transfers go through the Transfer Hook.
npx tsx scripts/deploy/initialize.ts

# If Steps 17-25 were skipped (check output for "DEFERRED"), re-run:
# npx tsx scripts/deploy/initialize.ts
```

**Verify:**
```bash
# Check curves exist in deployment.json
jq '.curvePdas' deployments/mainnet.json
```

**Expected:**
```
{
  "crimeCurveState": "[curve PDA address]",
  "fraudCurveState": "[curve PDA address]",
  "crimeCurveTokenVault": "[vault address]",
  "fraudCurveTokenVault": "[vault address]",
  ...
}
```

- [x] Verified -- both bonding curves initialized (Steps 17-25 completed)

### 5.3 Verify Curves Are Active

**Action:**
```bash
# Check curve state on-chain
CRIME_CURVE=$(jq -r '.curvePdas.crimeCurveState' deployments/mainnet.json)
FRAUD_CURVE=$(jq -r '.curvePdas.fraudCurveState' deployments/mainnet.json)

solana account "$CRIME_CURVE" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | head -5
echo "---"
solana account "$FRAUD_CURVE" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | head -5
```

**Expected:**
```
Public Key: [CRIME curve PDA]
Balance: [rent-exempt amount]
Owner: [bonding_curve program ID]
---
Public Key: [FRAUD curve PDA]
Balance: [rent-exempt amount]
Owner: [bonding_curve program ID]
```

- [x] Verified -- both curves active, filled, and graduated on-chain

### 5.3 Register Helius Webhook with Curve PDAs

> **Phase 102 Lesson:** Without curve PDA addresses in the Helius webhook, the frontend SSE pipeline won't deliver real-time gauge updates from other users' purchases. The `ws-subscriber.ts` WebSocket subscriptions handle this on the server side, but the Helius webhook provides redundant delivery for chart data.

**Action:**
```bash
# Update Helius webhook with all program IDs + curve state PDAs
set -a && source .env.mainnet && set +a
npx tsx scripts/deploy/webhook-manage.ts
# Or manually add CurveState PDAs to the Helius dashboard webhook config
```

- [x] Verified -- Helius webhook includes curve state PDA addresses (raw + enhanced, both URLs)

### 5.4 Set Launch Mode on Railway

**Action:**
```
1. Go to Railway dashboard
2. Set NEXT_PUBLIC_CURVE_PHASE=true (redirects / to /launch page)
3. Set NEXT_PUBLIC_SITE_MODE=launch (should already be set from Stage 4)
4. Verify the launch page is accessible
```

**Verify:**
```bash
# Check site mode (via browser or curl)
curl -s https://[your-domain]/ | grep -i "launch\|bonding\|curve" | head -5
```

**Expected:**
```
Site shows launch page with bonding curves visible and purchasable
```

- [x] Verified -- launch page accessible, curves visible to public (both filled and graduated)

---

### Stage 5 GO/NO-GO Gate

- [x] 5.1 Bonding curve program deployed with deployer authority
- [x] 5.2 Curve vaults whitelisted, both curves initialized on-chain
- [x] 5.3 Curve PDAs verified with correct program ownership
- [x] 5.4 Launch page accessible, curves visible and functional

**All checks pass?**
- [x] **CURVES ARE NOW LIVE** (launched 2026-03-24)

---

### Fill Period Monitoring (Between Stage 5 and Stage 6)

After launching, monitor the bonding curve fill progress. No deployment actions needed -- just observation and readiness.

- [x] Watch curve fill progress (frontend pressure gauges show % filled)
- [x] Monitor for buy/sell transaction errors in Sentry
- [x] Check RPC health periodically (Helius dashboard)
- [x] Ensure frontend is responsive and accessible
- [x] Have `scripts/graduation/graduate.ts` ready to run
- [x] Have rollback plan ready (see Appendix B: Emergency Procedures)
- [x] Both curves filled — CRIME: 512 SOL, FRAUD: 519 SOL

**When BOTH curves reach 100% filled (status: "Filled"):**
- [x] **PROCEED TO STAGE 6** (both filled 2026-03-24)

---

## Stage 6: Post-Graduation

**After BOTH bonding curves reach 100% capacity. Costs ~0.05 SOL in TX fees.**

**Automated:** `./scripts/deploy/stage-6-graduation.sh mainnet`

### 6.1 Verify Both Curves at 100% Capacity

**Action:**
```bash
# Read curve status from deployment.json or on-chain
CRIME_CURVE=$(jq -r '.curvePdas.crimeCurveState' deployments/mainnet.json)
FRAUD_CURVE=$(jq -r '.curvePdas.fraudCurveState' deployments/mainnet.json)

echo "CRIME curve:"
solana account "$CRIME_CURVE" --url "$CLUSTER_URL" --keypair "$WALLET" --output json 2>/dev/null | head -3
echo "FRAUD curve:"
solana account "$FRAUD_CURVE" --url "$CLUSTER_URL" --keypair "$WALLET" --output json 2>/dev/null | head -3
```

**Expected:**
```
Both curves in "Filled" status (check frontend or decode on-chain state)
```

- [x] Verified -- both CRIME and FRAUD curves at 100% capacity

### 6.2 Run graduate.ts (13-Step Graduation)

> **NOTE (Pitfall #6 - Whitelist Authority):** Whitelist authority is NO LONGER burned during graduation. Step 13 is skipped. The authority transfers to the Squads multisig at Stage 7, preserving the ability to whitelist new addresses in the future (new DEX pool integrations, partnerships, etc.). Pool vault whitelisting still happens at Step 9.

> **WARNING (Pitfall #13 - skipPreflight Silent TX Failures):** `graduate.ts` uses `confirmOrThrow` to detect silent failures. Each of the 13 steps is verified before proceeding to the next.

**Action:**
```bash
set -a && source .env.mainnet && set +a
npx tsx scripts/graduation/graduate.ts
```

**Verify:**
```bash
echo "Graduation steps:"
echo "  1.  Verify both curves Filled"
echo "  2.  prepare_transition (Filled -> Graduated) -- IRREVERSIBLE"
echo "  3.  Withdraw SOL from CRIME curve vault"
echo "  4.  Withdraw SOL from FRAUD curve vault"
echo "  5.  Close CRIME token vault"
echo "  6.  Close FRAUD token vault"
echo "  7.  Create CRIME/SOL AMM pool (290M CRIME + withdrawn SOL)"
echo "  8.  Create FRAUD/SOL AMM pool (290M FRAUD + withdrawn SOL)"
echo "  9.  Whitelist pool vault addresses"
echo "  10. Seed Conversion Vault (250M CRIME + 250M FRAUD + 20M PROFIT)"
echo "  11. Distribute CRIME tax escrow to carnage fund"
echo "  12. Distribute FRAUD tax escrow to carnage fund"
echo "  13. Skip whitelist authority burn (retained -- transfers to Squads at Stage 7)"
```

**Expected:**
```
graduate.ts completes all 13 steps without errors.
Output shows each step with TX signatures.
```

- [x] Verified -- graduation completed all 13 steps (all 9 verifications passed)

### 6.3 Verify AMM Pools Created

**Action:**
```bash
# Pools should now exist in deployment.json
jq '.pools' deployments/mainnet.json
```

**Verify:**
```bash
# Check each pool on-chain
for POOL_KEY in crimeSolPool fraudSolPool; do
  POOL=$(jq -r ".pools.${POOL_KEY} // \"not-found\"" deployments/mainnet.json)
  if [ "$POOL" != "not-found" ] && [ "$POOL" != "null" ]; then
    EXISTS=$(solana account "$POOL" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | grep -c "Owner" || echo "0")
    echo "  ${POOL_KEY}: $POOL (exists: $EXISTS)"
  fi
done
```

**Expected:**
```
  crimeSolPool: [address] (exists: 1)
  fraudSolPool: [address] (exists: 1)
```

- [x] Verified -- both AMM pools created (CRIME: 500.44 SOL + 290M tokens, FRAUD: 501.01 SOL + 290M tokens)

### 6.4 Verify Pool Vaults Whitelisted

**Action:**
```bash
# Pool vault whitelist entries should exist
npx tsx scripts/deploy/verify.ts 2>&1 | grep -i "whitelist"
```

**Expected:**
```
[PASS] Pool vault whitelist entries exist
```

- [x] Verified -- pool vault addresses whitelisted on Transfer Hook (4 vaults)

### 6.5 Verify Whitelist Authority Retained (for Squads transfer)

**Action:**
```bash
# Whitelist authority should still be held by deployer (transfers to Squads at Stage 7)
WL_AUTH=$(jq -r '.pdas.whitelistAuthority // "not-found"' deployments/mainnet.json)
echo "Whitelist Authority PDA: $WL_AUTH"
solana account "$WL_AUTH" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null | head -5
```

**Expected:**
```
Whitelist authority admin field should be deployer pubkey (NOT burned).
Authority transfers to Squads vault at Stage 7 for future flexibility
(new pool integrations, DEX listings, etc.).
```

- [x] Verified -- whitelist authority retained by deployer (will transfer to Squads at Stage 7)

### 6.6 Start Crank Runner on Railway

> **WARNING (Pitfall #9 - CARNAGE_WSOL_PUBKEY Missing on Railway):** Railway doesn't have the `keypairs/` directory. Set `CARNAGE_WSOL_PUBKEY` env var on Railway with the pubkey from `deployments/mainnet.json`. Without this, the crank crashes with `ENOENT: no such file or directory, open '/app/keypairs/carnage-wsol.json'`.

> **WARNING (Phase 102 Lesson — Stale PDA Manifest):** The `PDA_MANIFEST` env var MUST contain the manifest generated AFTER graduation (pools are included). Using a pre-graduation manifest causes `AccountOwnedByWrongProgram` (0xbbf) on every crank cycle. Always copy from `scripts/deploy/pda-manifest.json` which is regenerated by `initialize.ts` and `graduate.ts`.

**Action:**
```
1. Get CARNAGE_WSOL_PUBKEY:
   jq -r '.carnageWsol // .pdas.carnageWsol' deployments/mainnet.json

2. Set Railway env vars (crank service):
   - CARNAGE_WSOL_PUBKEY=[value from above]
   - PDA_MANIFEST=[full JSON from scripts/deploy/pda-manifest.json — MUST be post-graduation]
   - CLUSTER_URL=[mainnet Helius RPC]
   - NEXT_PUBLIC_CLUSTER=mainnet
   - WALLET_KEYPAIR=[crank wallet keypair JSON array]
   - COMMITMENT=confirmed

   Verify frontend service also has DBS env vars (should be set from Stage 4.5):
   - WS_SUBSCRIBER_ENABLED=true
   - TOKEN_SUPPLY_POLL_INTERVAL_MS=60000
   - STAKER_COUNT_POLL_INTERVAL_MS=30000
   - SLOT_BROADCAST_INTERVAL_MS=5000

3. Deploy crank runner to Railway:
   - Service: crank
   - Build: npm install
   - Start: npx tsx scripts/crank/crank-runner.ts
   - Restart: ON_FAILURE, max 10
```

> **WARNING (Pitfall #14 - RPC Propagation Delay):** After graduation state changes, wait 2-3 seconds before verifying. RPC nodes may not have propagated the state change yet.

**Verify:**
```bash
# After crank starts, watch for first successful epoch advance
# Check Railway logs for "Epoch advanced" or similar
echo "Watch Railway crank logs for first successful epoch transition"
echo "Expected: epoch advances within ~30 minutes on mainnet"
```

**Expected:**
```
Crank runner starts without errors.
First epoch transition completes successfully.
```

- [x] Verified -- crank running on Railway, Carnage triggered on Epoch 429

### 6.7 Set Live Mode on Railway

**Action:**
```
1. Go to Railway dashboard
2. Delete NEXT_PUBLIC_CURVE_PHASE (or set to false) — removes /launch redirect
3. Set NEXT_PUBLIC_SITE_MODE=live — switches to trading interface
4. Redeploy frontend service
```

**Verify:**
```bash
# Frontend should now show trading interface (not launch page)
curl -s https://[your-domain]/ | grep -i "swap\|trade\|buy\|sell" | head -5
```

**Expected:**
```
Site shows full trading interface with swap, staking, and epoch displays
```

- [x] Verified -- frontend switched to live trading mode (SITE_MODE=live, CURVE_PHASE removed)

### 6.8 Run Full verify.ts

**Action:**
```bash
npx tsx scripts/deploy/verify.ts 2>&1
```

**Verify:**
```bash
npx tsx scripts/deploy/verify.ts 2>&1 | grep -cE "FAIL"
```

**Expected:**
```
0 (zero failures -- all 36 checks pass)
```

- [ ] Verified -- full verify.ts passes all checks

---

### Stage 6 GO/NO-GO Gate

- [x] 6.1 Both curves confirmed at 100% filled (CRIME: 512 SOL, FRAUD: 519 SOL)
- [x] 6.2 graduate.ts completed all 13 steps (all 9 verifications passed)
- [x] 6.3 AMM pools created with correct liquidity (~1001 SOL total)
- [x] 6.4 Pool vaults whitelisted (4 vaults)
- [x] 6.5 Whitelist authority retained (deployer holds, transfers to Squads at Stage 7)
- [x] 6.6 Crank running on Railway, Carnage triggered Epoch 429
- [x] 6.7 Frontend switched to live trading mode
- [ ] 6.8 Full verify.ts passes (deferred — non-blocking)

**All checks pass?**
- [x] **STAGES 5-6 COMPLETE** (graduated 2026-03-24, trading live)

> Stage 7 (Squads governance transfer) to be executed after 24-48 hours of stable trading.

> Wait for trading to stabilize before proceeding to governance. The deployer retains hot-fix capability until authorities are transferred.

---

## Stage 7: Squads & Monitoring

**After trading is stable and verified. Authority transfer is IRREVERSIBLE.**

**Automated:** `./scripts/deploy/stage-7-governance.sh mainnet`

### 7.1 Create Squads 2-of-3 Multisig

> **WARNING (Pitfall #12 - Squads TX Creator Must Be Member):** When creating vault transactions in Squads, use a signer keypair (not the deployer) as the creator. Error 6005 (`NotAMember`) occurs if the deployer wallet is used as creator but isn't a multisig member.

> **WARNING (Pitfall #15 - BorshCoder snake_case vs camelCase):** Always use snake_case field names in Anchor instruction argument objects. camelCase silently encodes zero bytes for pubkey fields. This was discovered during Phase 97 -- `new_authority` (correct) vs `newAuthority` (silently encodes zero = burns authority).

**Action:**
```bash
set -a && source .env.mainnet && set +a
npx tsx scripts/deploy/setup-squads.ts
```

**Verify:**
```bash
# Squads vault PDA should be in deployment.json
jq -r '.squadsVault // "not-found"' deployments/mainnet.json
```

**Expected:**
```
[Squads vault PDA address]
```

- [x] Verified -- 2-of-3 Squads multisig created (F7axBNUg..., vault 4SMcPtix..., 3600s timelock)

### 7.2 Transfer All Authorities to Squads Vault

**Action:**
```bash
npx tsx scripts/deploy/transfer-authority.ts
```

This transfers:
- 7 program upgrade authorities (BPFLoaderUpgradeable)
- 3 admin PDA authorities (AMM AdminConfig, WhitelistAuthority, BcAdminConfig)
- 3 token metadata update authorities (CRIME, FRAUD, PROFIT mints)

**Verify:**
```bash
npx tsx scripts/deploy/verify-authority.ts
```

**Expected:**
```
[PASS] AMM upgrade authority: [squads vault PDA]
[PASS] Transfer Hook upgrade authority: [squads vault PDA]
[PASS] Tax Program upgrade authority: [squads vault PDA]
[PASS] Epoch Program upgrade authority: [squads vault PDA]
[PASS] Staking upgrade authority: [squads vault PDA]
[PASS] Conversion Vault upgrade authority: [squads vault PDA]
[PASS] Bonding Curve upgrade authority: [squads vault PDA]
[PASS] AMM AdminConfig authority: [squads vault PDA]
[PASS] WhitelistAuthority admin: [squads vault PDA]
[PASS] BcAdminConfig authority: [squads vault PDA]
[PASS] CRIME metadata update authority: [squads vault PDA]
[PASS] FRAUD metadata update authority: [squads vault PDA]
[PASS] PROFIT metadata update authority: [squads vault PDA]
All 13 authorities verified.
```

- [x] Verified -- 11/11 transferable authorities transferred to Squads vault (6 program upgrades + 2 admin PDAs + 3 metadata). BC upgrade N/A (program closed/immutable), BcAdminConfig N/A (program closed).

### 7.3 Verify Deployer Cannot Upgrade

**Action:**
```bash
# Negative test: deployer should no longer be able to upgrade
# verify-authority.ts includes this check
echo "Deployer can no longer upgrade programs unilaterally."
echo "All upgrades now require 2-of-3 multisig approval + timelock."
```

- [x] Verified -- deployer authority confirmed removed (negative test passed)

### 7.4 Set Initial Timelock

**Action:**
```bash
# Default timelock from setup-squads.ts is 300s (5 minutes)
echo "Initial timelock: 300s (5 minutes)"
echo "This allows rapid hot-fixes during the critical early period."
```

**Verify:**
```bash
# Verify timelock setting
echo "Timelock can be verified via Squads v4 UI or on-chain data"
```

**Expected:**
```
Timelock period: 300 seconds (5 minutes)
```

- [x] Verified -- initial timelock set to 3600s (1 hour; skipped 300s phase as stability already confirmed)

### 7.5 Timelock Progression Schedule

Document and follow this progression:

| Milestone | Timelock | Rationale |
|-----------|----------|-----------|
| Launch (Day 0) | 300s (5 min) | Hot-fix window for critical issues |
| +48-72 hours | 3600s (1 hr) | Initial stability confirmed |
| +1 week | 3600s (1 hr) | Or extend to 24hr if stable |
| +1 month | 86400s (24 hr) | Routine operations, no emergencies |
| +3 months | 604800s (7 days) | Community governance maturity |
| Post-audit | BURN | After external audit funded and completed |

- [x] Timelock progression schedule documented and agreed by team (see 100-04-SUMMARY.md)

---

### Stage 7 GO/NO-GO Gate

- [x] 7.1 Squads 2-of-3 multisig created with correct members
- [x] 7.2 11/11 transferable authorities transferred to Squads vault (BC program closed -- 2 N/A)
- [x] 7.3 Deployer confirmed unable to upgrade unilaterally
- [x] 7.4 Initial timelock set to 3600s (1 hour)
- [x] 7.5 Timelock progression schedule documented

**All checks pass?**
- [x] **DEPLOYMENT COMPLETE** (2026-03-25)

---

## Deployment Complete

> **🚨 POST-DEPLOYMENT AUTHORITY RULE: NO AUTHORITY MAY BE BURNED — EVER — WITHOUT EXPLICIT WRITTEN CONFIRMATION FROM THE PROJECT OWNER (mlbob). All authorities are transferred to the Squads multisig for safekeeping, NOT for burning. Any future burn requires: (1) external audit complete, (2) documented reason, (3) explicit owner confirmation per authority. See Docs/mainnet-governance.md Section 8.**

All 8 stages (0-7) have been executed and verified. The protocol is now:

- [x] **Programs deployed** -- 6 programs live on mainnet (BC closed post-graduation, rent reclaimed)
- [x] **Mints created** -- CRIME, FRAUD, PROFIT with Token-2022 extensions (mint authorities burned)
- [x] **Infrastructure ready** -- ALT, constants, IDLs, frontend (cluster-aware via NEXT_PUBLIC_CLUSTER)
- [x] **Curves graduated** -- Both bonding curves filled (CRIME 512 SOL, FRAUD 519 SOL) and graduated to AMM pools
- [x] **Trading live** -- Full swap, staking, epoch, and carnage functionality
- [x] **Governance established** -- 2-of-3 Squads multisig with 3600s timelocked upgrade authority
- [x] **Crank running** -- Epoch advancement and carnage operations on Railway

For timelocked upgrades through Squads, see: `Docs/mainnet-governance.md`

---

## Appendix A: SOL Budget

### Program Deployment Costs

Binary sizes from devnet build. Run `solana rent <bytes>` after mainnet build for exact costs.

`deploy.sh` uses `--max-len` at **1.2x binary size** (20% headroom for bug fixes and security patches). Without `--max-len`, Solana CLI defaults to 2x, which would cost ~42.5 SOL. The 1.2x buffer saves ~17 SOL while providing sufficient upgrade headroom.

If a future upgrade ever exceeds the 1.2x buffer, close the program account (reclaiming the SOL), and redeploy with a larger buffer via the Squads multisig.

**Stage 2 — 6 Core Programs:**

| Program | Binary Size | 1.2x Buffer | Estimated Rent (SOL) |
|---------|-------------|-------------|---------------------|
| amm.so | 422,944 bytes | 507,532 bytes | ~3.54 |
| conversion_vault.so | 374,824 bytes | 449,788 bytes | ~3.13 |
| epoch_program.so | 518,824 bytes | 622,588 bytes | ~4.33 |
| staking.so | 425,440 bytes | 510,528 bytes | ~3.55 |
| tax_program.so | 406,792 bytes | 488,150 bytes | ~3.40 |
| transfer_hook.so | 340,416 bytes | 408,499 bytes | ~2.84 |
| **Stage 2 Subtotal** | **2,489,240 bytes** | **2,987,085 bytes** | **~20.79** |

**Stage 5 — Bonding Curve (anti-sniper: deployed at launch time):**

| Program | Binary Size | 1.2x Buffer | Estimated Rent (SOL) |
|---------|-------------|-------------|---------------------|
| bonding_curve.so | 564,424 bytes | 677,308 bytes | ~4.72 |

| **Total (all 7 programs)** | **3,053,664 bytes** | **3,664,393 bytes** | **~25.51** |

**Note:** Each program also has ~45 bytes of ProgramData header overhead. Mainnet binaries (without `--features devnet`) may differ slightly from devnet sizes.

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

| Pool | SOL Seed | Pool PDA Rent | Vault Rent | Total |
|------|----------|---------------|------------|-------|
| CRIME/SOL | Dynamic (~500 SOL from curves) | ~0.005 | ~0.006 | ~0.011 |
| FRAUD/SOL | Dynamic (~500 SOL from curves) | ~0.005 | ~0.006 | ~0.011 |
| **Subtotal** | | | | **~0.022** |

**Note:** Pool SOL seed comes from bonding curve proceeds (community buyers), NOT from deployer wallet. The ~0.022 SOL is only the account creation rent.

### Infrastructure Costs

| Item | Estimated Cost (SOL) | Notes |
|------|---------------------|-------|
| Address Lookup Table creation | ~0.003 | Initial creation |
| ALT extend (~55 addresses, ~3 TXs) | ~0.005 | 256 addresses per extend max |
| Transaction fees (deploy + init) | ~0.05 | ~50 transactions at ~0.001 SOL each |
| Priority fees (mainnet) | ~0.10 | Higher priority for reliable TX landing |
| **Subtotal** | | **~0.16** |

### Operational Funding

| Item | Estimated Cost (SOL) | Notes |
|------|---------------------|-------|
| Crank wallet funding | 1.0 | Self-sustaining via epoch bounties after initial seed |
| Carnage SOL vault seed | 0.1 | Initial fund for carnage buy operations |
| Squads multisig creation | ~0.01 | Account rent for multisig + vault |
| **Subtotal** | | **~1.11** |

### Budget Summary

| Category | Stage | Cost (SOL) |
|----------|-------|-----------|
| Core program deployments (6, 1.2x buffer) | 2 | ~20.79 |
| Bonding curve deploy (1, 1.2x buffer, anti-sniper) | 5 | ~4.72 |
| Mint creation (3) | 3 | ~0.01 |
| PDA accounts (~45) | 3 | ~0.09 |
| Pool creation (2) | 6 | ~0.02 |
| Infrastructure (ALT, TXs) | 4 | ~0.16 |
| Operational (crank, carnage, squads) | 7 | ~1.11 |
| **Subtotal** | | **~26.90** |
| **+20% contingency** | | **~5.38** |
| **TOTAL (deployer wallet needed)** | | **~32 SOL** |

### Community-Funded (NOT Deployer Cost)

| Item | SOL |
|------|-----|
| Bonding curve fills (2x ~500 SOL) | ~1000 SOL |

This SOL comes from community buyers during the bonding curve fill period. It is NOT a deployer cost, but is documented for the full picture. The ~500 SOL per curve flows into AMM pool liquidity during graduation.

**IMPORTANT:** Run `solana rent <bytes>` for each program binary after the mainnet build to get exact costs. The estimates above use the 6,960 lamports/byte formula, but the CLI accounts for metadata overhead accurately.

---

## Appendix B: Emergency Procedures

### B.1 Rollback During Fill Period

If a critical issue is discovered during the bonding curve fill period (between Stage 5 and Stage 6):

1. **DO NOT panic.** The deployer retains full upgrade authority until Stage 7.
2. **Assess severity:**
   - UI-only bug: Fix frontend, redeploy Railway. No on-chain changes needed.
   - On-chain bug in bonding curve: Evaluate if refund path is needed.
3. **Refund path (if needed):**
   - The bonding curve program has a refund mechanism.
   - Users who bought tokens can get SOL back.
   - Admin can close curves and return SOL to buyers.
   - This is the nuclear option -- coordinate with community first.
4. **Hot-fix path:**
   - Fix the program code.
   - `anchor build` (no --devnet for mainnet).
   - `solana program deploy target/deploy/<program>.so --program-id keypairs/<keypair>.json --keypair $WALLET --url $CLUSTER_URL --with-compute-unit-price 50000`
   - Verify fix works. No authority transfer needed (deployer still has authority).

### B.2 Hot-Fix During Launch Window

The deployer retains upgrade authority until Stage 7. This is intentional for exactly this scenario.

1. **Stop the crank** (if running): Stop Railway crank service.
2. **Build the fix:**
   ```bash
   ./scripts/deploy/build.sh  # mainnet (no --devnet flag)
   ```
3. **Deploy the fix:**
   ```bash
   solana program deploy target/deploy/<program>.so \
     --program-id keypairs/<keypair>.json \
     --keypair $WALLET \
     --url $CLUSTER_URL \
     --with-compute-unit-price 50000
   ```
4. **Verify the fix:**
   ```bash
   solana program show <PROGRAM_ID> --url $CLUSTER_URL --keypair $WALLET
   # Confirm: Executable=true, Authority=deployer
   ```
5. **Restart the crank** (if it was running).

### B.3 Crank Crash Recovery

If the crank runner crashes on Railway:

1. **Check Railway logs** for the error message.
2. **Common causes:**
   - `ENOENT: keypairs/carnage-wsol.json` -- `CARNAGE_WSOL_PUBKEY` env var not set (Pitfall #9).
   - `AccountOwnedByWrongProgram (0xbbf)` -- `PDA_MANIFEST` env var is stale. Update from `scripts/deploy/pda-manifest.json`.
   - Low crank wallet balance -- fund the crank wallet with more SOL.
   - RPC rate limiting -- check Helius dashboard, wait for rate limit to reset.
   - VRF oracle timeout -- see B.4 below.
3. **Railway restart policy:** ON_FAILURE with max 10 retries handles transient failures.
4. **Manual restart:** In Railway dashboard, restart the crank service.
5. **Impact of crank downtime:** Epochs don't advance. Trading still works (swaps don't need crank). Staking rewards pause. Carnage doesn't execute. No funds at risk.

### B.4 VRF Oracle Down

If the Switchboard VRF oracle is unresponsive:

1. **Symptom:** Crank logs show repeated `0x1780` errors or timeout waiting for randomness.
2. **DO NOT rotate gateways** -- VRF gateway rotation does not work. Each randomness account is assigned to a specific oracle.
3. **Wait for VRF_TIMEOUT_SLOTS (300 slots, ~2 minutes).**
4. **Create fresh randomness:** The crank automatically handles this via `retry_epoch_vrf`.
5. **Fresh randomness may get a different (working) oracle.**
6. **If oracle is down for extended period:** Epochs pause. No funds at risk. Trading continues. Staking rewards accumulate but aren't distributed.
7. **Contact Switchboard team** via Discord if oracle is down > 1 hour.

### B.5 Railway Build Cache EBUSY

If a Railway build fails with:
```
npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'
```

This is a transient Railway infrastructure issue — the Docker build cache mount for `node_modules/.cache` is locked. **Not a code issue.**

1. **Retry the deploy** from Railway dashboard (trigger redeploy).
2. If it persists, clear the Railway build cache (Settings → Build → Clear Cache).
3. This was encountered during Phase 102 and resolved on retry.

---

## Appendix C: Validation Deploy Report (Phase 98-03)

**Date:** 2026-03-15
**Cluster:** devnet
**Stages executed:** 0-4

### Results

| Stage | Status | Notes |
|-------|--------|-------|
| 0 Preflight | PASS (9/9) | Mint keypairs auto-generated |
| 1 Build | PASS | All 7 programs compiled, 29/29 ID checks, hash manifest generated |
| 2 Deploy | PASS | 7/7 programs deployed, cost 25.54 SOL (from 37.96 to 12.42 SOL) |
| 3 Initialize | PASS | 33 steps completed, 12 skipped (pool/graduation deferred) |
| 4 Infrastructure | PASS (ALT only) | ALT created with 55 addresses |

### Program IDs (Validation Deploy)

| Program | Address |
|---------|---------|
| AMM | 9Um9n2b55UcSRdUjcJ9YW79YC1Hu2sGuis2CtfJkdiCp |
| Transfer Hook | 3tuiV5ZzHtqJzaqviNtcQnAwKS6DqN5FoTBpdZMf21NA |
| Tax Program | 7VexN52vdf1Jdot8CtnaSwptH2G9gW6pPjCo5JpNR91R |
| Epoch Program | LJ7nNLxmFixYfT7RpZ4GmZGncokc9n5NpeQWPXDdKYu |
| Staking | 4RAxWiFFn9HFJdeqpfCCF2gbNpj6Q8qm1nT29zMUphx8 |
| Conversion Vault | 2a6pe5frHpnq8yQWCDmU9yijzh91oM5xaBW2oNxSVnrr |
| Bonding Curve | CitoWhhDJCsQeijF37js9aA6xjnoEfF3JMSfu3nKmmEp |

### Bugs Found and Fixed

1. **stage-2-deploy.sh: `declare -A` zsh incompatibility** -- Associative arrays (`declare -A`) are bash 4+ only. macOS zsh fails with "invalid option". Fixed: replaced with colon-delimited string array (same pattern as deploy.sh).

2. **stage-2-deploy.sh and stage-3-initialize.sh: `grep "Executable"` fails with Solana CLI v3** -- Solana CLI v3 output format changed; `solana program show` no longer includes an "Executable" field. Fixed: check for "Program Id" instead (any program returned by `solana program show` is executable).

3. **initialize.ts: WSOL wrapping blocks fresh deploy** -- Step 5 tried to wrap ~25 SOL for pool seeding, but pool creation (Step 7) was moved to graduation in Phase 94.1. The WSOL was never used but blocked fresh deploys when balance < 25 SOL after program deployment. Fixed: WSOL wrapping skipped (graduation script creates its own WSOL from curve proceeds).

### Observations

- **Two-pass deploy NOT needed** when mint keypairs exist before build. Stage 0 creates mint keypairs, build.sh patches them into constants.rs via `patch-mint-addresses.ts` (step 0b), so programs compile with correct mint addresses on first build.
- **Devnet preflight 2 SOL minimum is misleading** -- actual deploy requires ~26 SOL. The 2 SOL check only ensures basic operations, not program deployment. The 32 SOL mainnet budget in the checklist is correct.
- **verify.ts reports 28 failures at Stage 3** -- all expected: pool-related PDAs (deferred to graduation), lazy PDAs (created on first use), ALT (contains old addresses). After ALT recreation in Stage 4, ALT failures are resolved.
- **Actual deploy cost: 25.54 SOL** (vs estimated 25.51 SOL) -- within 0.1% of the 1.2x buffer estimate.

---

## Appendix D: Post-Deploy Hotfixes

### D.1 Carnage Always-CRIME Bug (2026-03-16)

**Affected program:** Epoch Program (carnage_execution.rs)
**Upgrade slot:** 406869756
**Upgrade TX:** `AajtqRR6ZehGdmCs4CH3R9MbAdzAHRsVuZ6HM9ZERD5YdTAuEtqpvE3JdE2FCdXgiD4mohUyCMBgUCx5P1u5jk1`
**Authority at time of upgrade:** Deployer wallet (pre-Squads governance transfer)

**Bug:** Carnage Fund always targeted CRIME regardless of VRF result. FRAUD targets silently failed and retried until VRF picked CRIME. Sell-direction carnage was also broken (always fell through to fallback path).

**Root cause:** Phase 47-04 (2026-02-19) bundled `executeCarnageAtomic` into the same TX as `reveal + consume_randomness`. The client read `carnageTarget` from EpochState BEFORE TX submission, always getting the stale default value (0 = CRIME). When VRF picked FRAUD, the on-chain CPI received CRIME's Transfer Hook accounts and reverted.

**Fix applied:**
- **On-chain:** `partition_hook_accounts` accepts `target`, `held_token`, `atomic` params. Atomic path uses fixed layout `[CRIME_buy(4), FRAUD_buy(4), held_sell(4)?]` and selects correct slices by VRF-derived target.
- **Client:** `buildExecuteCarnageAtomicIx` resolves hooks for both mints + sell hooks for held token. No longer reads stale state.
- **Tests:** 14 exhaustive partition tests covering all 18 action/target/held combinations.

**Post-fix action required:** Redeploy crank on Railway with updated `carnage-flow.ts`.

---

## Appendix E: Phase 102 Devnet Redeploy — Impact on Mainnet Resumption

**Date:** 2026-03-20
**Context:** Phase 102 (full devnet lifecycle redeploy) required fresh devnet program IDs because all 7 devnet upgrade authorities were burned during Phase 97 (Squads governance testing). This replaced the program keypairs in `keypairs/` with new devnet-only keypairs.

### What Changed

| Item | Before Phase 102 | After Phase 102 | Impact |
|------|-------------------|-----------------|--------|
| `keypairs/*-keypair.json` (6 files) | Mainnet program IDs (5JsS, CiQP, 43fZ, etc.) | Fresh devnet program IDs | **Must restore before mainnet** |
| `keypairs/bonding-curve-keypair.json` | Mainnet BC ID (DpX3) | Fresh devnet BC ID | **Must restore before mainnet** |
| Rust `declare_id!` macros | Mainnet program IDs | Devnet program IDs | Restored by `sync-program-ids` |
| `Anchor.toml` program IDs | Mainnet program IDs | Devnet program IDs | Restored by `sync-program-ids` |
| Cross-program refs in Rust | Mainnet program IDs | Devnet program IDs | Restored by `sync-program-ids` |
| `shared/constants.ts` | Devnet=Phase 95 IDs, Mainnet=mainnet IDs | Devnet=Phase 102 IDs, Mainnet=mainnet IDs | Mainnet section preserved (reads from mainnet.json) |
| `deployments/devnet.json` | Phase 95 addresses | Phase 102 fresh addresses | Expected — devnet-only |
| `deployments/mainnet.json` | Mainnet addresses | **UNCHANGED** | Safe |
| `keypairs/mainnet-*-mint.json` (3 files) | Mainnet vanity mints | **UNCHANGED** | Safe |

### Mainnet Program Keypair Backups

Backed up at: `keypairs/mainnet-*-program.json` (7 files, git-ignored)

| Backup File | Program | Mainnet Address |
|-------------|---------|-----------------|
| `keypairs/mainnet-amm-program.json` | AMM | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` |
| `keypairs/mainnet-transfer-hook-program.json` | Transfer Hook | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` |
| `keypairs/mainnet-tax-program-program.json` | Tax Program | `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj` |
| `keypairs/mainnet-epoch-program.json` | Epoch Program | `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2` |
| `keypairs/mainnet-staking-program.json` | Staking | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` |
| `keypairs/mainnet-vault-program.json` | Conversion Vault | `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` |
| `keypairs/mainnet-bonding-curve-program.json` | Bonding Curve | `DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV` |

### MANDATORY Pre-Requisites Before Resuming Phase 100 (Stages 5-7)

**These steps MUST be completed before any mainnet deploy activity:**

1. **Restore mainnet program keypairs:**
   ```bash
   cp keypairs/mainnet-amm-program.json keypairs/amm-keypair.json
   cp keypairs/mainnet-transfer-hook-program.json keypairs/transfer-hook-keypair.json
   cp keypairs/mainnet-tax-program-program.json keypairs/tax-program-keypair.json
   cp keypairs/mainnet-epoch-program.json keypairs/epoch-program.json
   cp keypairs/mainnet-staking-program.json keypairs/staking-keypair.json
   cp keypairs/mainnet-vault-program.json keypairs/vault-keypair.json
   cp keypairs/mainnet-bonding-curve-program.json keypairs/bonding-curve-keypair.json
   ```

2. **Re-sync program IDs to mainnet:**
   ```bash
   ./scripts/deploy/build.sh  # runs sync-program-ids + patch-mint-addresses from keypairs/
   ```
   Verify all `declare_id!` macros match mainnet IDs before deploying.

3. **Verify mainnet.json is still correct:**
   ```bash
   cat deployments/mainnet.json | jq '.programs'
   ```
   All 7 program IDs must match the backup table above.

4. **Verify mainnet mint keypairs are intact:**
   ```bash
   solana-keygen pubkey keypairs/mainnet-crime-mint.json   # Must be cRiME...
   solana-keygen pubkey keypairs/mainnet-fraud-mint.json   # Must be FraUd...
   solana-keygen pubkey keypairs/mainnet-profit-mint.json  # Must be pRoFi...
   ```

5. **Verify mainnet treasury address in tax-program constants:**
   ```bash
   grep -A2 'cfg(not(any(feature = "devnet"' programs/tax-program/src/constants.rs | grep from_str
   # Must show: 3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv (NOT 8kPzhQ devnet wallet)
   ```
   **WARNING:** `sync-program-ids` and `patch-mint-addresses` do NOT preserve the treasury address.
   The mainnet cfg block gets overwritten during devnet redeployments. This has happened TWICE already.
   If wrong, fix in `programs/tax-program/src/constants.rs` line ~148 before building.

6. **Verify Tax Program cross-references point to mainnet IDs:**
   ```bash
   grep -A1 'fn amm_program_id' programs/tax-program/src/constants.rs
   # Must show: 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR (mainnet AMM)
   grep -A1 'fn epoch_program_id' programs/tax-program/src/constants.rs
   # Must show: 4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2 (mainnet Epoch)
   grep -A1 'fn staking_program_id' programs/tax-program/src/constants.rs
   # Must show: 12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH (mainnet Staking)
   ```
   **Context:** Phase 102 upgraded the Tax Program on devnet with devnet AMM ID
   (`J7JxmNkz...`). `patch-mint-addresses.ts` now auto-patches `amm_program_id()`
   from keypairs (added 2026-03-23), so Step 2's `build.sh` should handle this.
   But VERIFY — if the AMM ID is still the devnet one, SOL swaps will fail on mainnet.

7. **Build WITHOUT --devnet flag for mainnet:**
   ```bash
   anchor build  # NOT anchor build --features devnet
   ```

### Phase 102 Tax Program Upgrade (2026-03-23)

During Phase 102 devnet testing, the Tax Program was upgraded on devnet to fix
SOL swap failures caused by a hardcoded mainnet AMM ID in `amm_program_id()`.

**What was done:**
- Patched `programs/tax-program/src/constants.rs` → `amm_program_id()` from
  mainnet AMM (`5JsSAL3k...`) to devnet AMM (`J7JxmNkz...`)
- Rebuilt with `anchor build -p tax_program -- --features devnet`
- Upgraded on devnet: `solana program deploy ... --url devnet`
- Systemic fix: added `amm_program_id` to `patch-mint-addresses.ts` so future
  builds auto-patch from keypairs

**Mainnet impact:** None. Only devnet was touched. When restoring for mainnet
(Steps 1-7 above), `build.sh` → `patch-mint-addresses.ts` will auto-patch
`amm_program_id()` back to the mainnet AMM ID from `keypairs/amm-keypair.json`
(restored from `keypairs/mainnet-amm-program.json` in Step 1).

**If in doubt:** manually verify Step 6 above shows the mainnet AMM ID.

---

*Document version: 1.6 | Last updated: 2026-03-24 | Validated: 2026-03-23 (Phase 102 full lifecycle) | Applies to: v1.4 Pre-Mainnet*
*v1.6 changes: Phase 102 lessons added throughout — CURVE_PHASE env var (Stage 5/6), Helius webhook with curve PDAs (Stage 5), initialize.ts re-run warning (Stage 5.2), ALT null check (Stage 4), PDA_MANIFEST must be post-graduation (Stage 6.6), Railway EBUSY recovery (B.5).*
*v1.5 changes: Appendix E Step 6 added — Tax Program cross-ref verification. Tax upgrade notes for Phase 102.*
*v1.4 changes: Appendix E added — Phase 102 devnet redeploy impact and mainnet restoration checklist.*
*v1.3 changes: Whitelist authority no longer burned at graduation (retained for Squads transfer). Metadata update authorities added to Stage 7 transfer list (13 total authorities). Carnage hotfix appendix added.*
