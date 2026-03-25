# Phase 30: Program ID Fixes - Research

**Researched:** 2026-02-09
**Domain:** Anchor program ID management, cross-program references, build consistency
**Confidence:** HIGH

## Summary

Phase 30 is a configuration-only phase: fix all cross-program ID references so the 5 production programs (AMM, Transfer Hook, Tax, Epoch, Staking) correctly reference each other. The codebase has a well-structured but currently inconsistent set of program ID references across three layers: `declare_id!` macros, `target/deploy/*.json` keypairs, and `keypairs/*.json` files. The critical blocker is the Tax Program's `epoch_program_id()` placeholder, but the full audit reveals deeper issues including missing keypairs and mismatches between `target/deploy/` and the `keypairs/` directory.

Research found that the codebase has **three separate sources of program identity** that need reconciliation: (1) `declare_id!` macros in each program's `lib.rs`, (2) `target/deploy/*-keypair.json` files that Anchor uses for deployment, and (3) `keypairs/*.json` files committed to the repo. These three sources currently disagree for several programs. The decision to make `keypairs/` the source of truth means we must copy the correct keypairs into `target/deploy/`, update `declare_id!` macros, and sync all cross-program references.

**Primary recommendation:** Establish `keypairs/` as the canonical source of truth. For each of the 5 production programs, ensure a keypair exists in `keypairs/`, copy it to `target/deploy/<program_name>-keypair.json`, run `anchor keys sync` to update `declare_id!` macros, then manually update all cross-program ID reference functions. Build a TypeScript verification script that derives public keys from keypairs and checks them against every reference point.

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Anchor CLI | 0.32.1 | `anchor keys list`, `anchor keys sync`, `anchor build` | Already installed; `keys sync` auto-updates `declare_id!` macros |
| Solana CLI | (installed) | `solana-keygen pubkey` to derive public keys from keypairs | Authoritative keypair -> pubkey derivation |
| TypeScript/Node | (installed) | Verification script | Project already uses TS for tests; `@solana/web3.js` available |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `@solana/web3.js` | (in package.json) | Keypair.fromSecretKey() for pubkey derivation in script | Verification script needs to read keypair JSON and derive pubkeys |
| `chalk` or ANSI codes | any | Colored terminal output for pass/fail table | User decision: colored human-readable output |
| `fs` / `path` (Node built-in) | N/A | File reading for keypairs, source files, Anchor.toml | Script needs to read all reference points |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TypeScript script | Shell script (bash) | Shell is simpler but harder to parse TOML, Rust source, and produce structured JSON output. TS is better because the project already has TS infrastructure and `@solana/web3.js` for keypair derivation |
| Manual ID updates | `anchor keys sync` only | `anchor keys sync` only updates `declare_id!` macros, NOT cross-program ID references in `constants.rs` files. Manual updates are still required for cross-program refs |

## Architecture Patterns

### Source of Truth Flow

```
keypairs/*.json  (SOURCE OF TRUTH - committed to repo)
      |
      v  (copy to target/deploy/ before build)
target/deploy/*-keypair.json  (Anchor's working directory)
      |
      v  (anchor keys sync)
declare_id!("...") in each lib.rs
      |
      v  (manual update)
Cross-program references in constants.rs files
      |
      v  (anchor build)
target/deploy/*.so  (built binaries)
      |
      v  (verification script)
All references validated consistent
```

### Current State Audit (CRITICAL)

**Production Programs - declare_id! vs Keypairs:**

| Program | declare_id! | target/deploy keypair | keypairs/ file | Status |
|---------|------------|----------------------|----------------|--------|
| AMM | `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` | `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` | **MISSING** | Need to copy from target/deploy or generate |
| Transfer Hook | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | OK |
| Tax Program | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | **TAXr5uS1... (MISMATCH)** + **taXaejVk... (MISMATCH)** | Neither keypairs/ file matches! |
| Epoch Program | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | **HdXeALpi... (MISMATCH)** | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | keypairs/ is correct, target/deploy is wrong |
| Staking | `StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF` | **G1rqChKE... (MISMATCH)** | **MISSING** | Need keypair that matches declare_id! |

**Test/Helper Programs:**

| Program | declare_id! | target/deploy keypair | keypairs/ file | Status |
|---------|------------|----------------------|----------------|--------|
| Mock Tax | `9irnHg1ddyLeeDTcuXYMa8Zby7uafL5PpkZ7LPfzzNw9` | `9irnHg1ddyLeeDTcuXYMa8Zby7uafL5PpkZ7LPfzzNw9` | **J5CK3BiY... (MISMATCH)** | target/deploy is correct |
| Fake Tax | `7i38TDxugSPSV9ciUNTbnEeBps5C5xiQSSY7kNG65YnJ` | `7i38TDxugSPSV9ciUNTbnEeBps5C5xiQSSY7kNG65YnJ` | **EbN9johT... (MISMATCH)** | target/deploy is correct |
| Stub Staking | `StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU` | **FenuJSSK... (MISMATCH)** | `StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU` | keypairs/ is correct |

### Cross-Program ID Reference Map

Every location where one program references another program's ID:

| Source File | Reference | Current Value | Expected Value | Status |
|-------------|-----------|---------------|----------------|--------|
| `tax-program/src/constants.rs:48` | `epoch_program_id()` | `EpochProgram1111111111111111111111111111111` | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | **PLACEHOLDER - BROKEN** |
| `tax-program/src/constants.rs:102` | `staking_program_id()` | `StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF` | `StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF` | OK |
| `staking/src/constants.rs:87` | `tax_program_id()` | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | OK |
| `staking/src/constants.rs:102` | `epoch_program_id()` | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | OK |
| `amm/src/constants.rs:10` | `TAX_PROGRAM_ID` | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | OK |
| `stub-staking/src/lib.rs:39` | `epoch_program_id()` | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | OK |

### Cross-Program Seed Reference Map

Shared PDA seeds that must match across programs:

| Seed | Programs Using It | Value | Status |
|------|-------------------|-------|--------|
| `SWAP_AUTHORITY_SEED` | AMM, Tax, Mock Tax, Fake Tax | `b"swap_authority"` | OK - all match |
| `EPOCH_STATE_SEED` | Epoch, Tax | `b"epoch_state"` | OK - both match |
| `CARNAGE_SIGNER_SEED` | Epoch, Tax | `b"carnage_signer"` | OK - both match |
| `STAKING_AUTHORITY_SEED` | Epoch, Staking, Stub Staking | `b"staking_authority"` | OK - all match |
| `TAX_AUTHORITY_SEED` | Tax, Staking | `b"tax_authority"` | OK - both match |
| `STAKE_POOL_SEED` | Staking, Tax, Stub Staking | `b"stake_pool"` | OK - all match |
| `DEPOSIT_REWARDS_DISCRIMINATOR` | Tax, Staking | `[52, 249, 112, 72, 206, 161, 196, 1]` | OK - both match (sha256 verified in tests) |
| `UPDATE_CUMULATIVE_DISCRIMINATOR` | Epoch | `[0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71]` | OK - sha256 verified in tests |

### Test Files with Hardcoded Program IDs

These Rust test files reference program IDs directly and need updating if IDs change:

| File | IDs Referenced | Issue |
|------|---------------|-------|
| `amm/tests/test_cpi_access_control.rs:48` | `BDwTJT4966CGcMP4HQS1QAp72MSF6nszhAD7M1V9xTNx` (AMM) | **WRONG** - doesn't match declare_id! |
| `amm/tests/test_cpi_access_control.rs:56` | `J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W` (Mock Tax) | **WRONG** - doesn't match declare_id! |
| `amm/tests/test_cpi_access_control.rs:64` | `EbN9johTcjch29b4kBU5N5Ked2skJnahKGViMWg5Y7GP` (Fake Tax) | **WRONG** - doesn't match declare_id! |
| `amm/tests/test_swap_sol_pool.rs:44` | `BDwTJT4966CGcMP4HQS1QAp72MSF6nszhAD7M1V9xTNx` (AMM) | **WRONG** - doesn't match declare_id! |
| `amm/tests/test_swap_profit_pool.rs:42` | `BDwTJT4966CGcMP4HQS1QAp72MSF6nszhAD7M1V9xTNx` (AMM) | **WRONG** - doesn't match declare_id! |
| `amm/tests/test_pool_initialization.rs:42` | `BDwTJT4966CGcMP4HQS1QAp72MSF6nszhAD7M1V9xTNx` (AMM) | **WRONG** - doesn't match declare_id! |
| `amm/tests/test_transfer_routing.rs:52` | `BDwTJT4966CGcMP4HQS1QAp72MSF6nszhAD7M1V9xTNx` (AMM) | **WRONG** - doesn't match declare_id! |
| `tax-program/tests/test_swap_sol_buy.rs:76` | `EpochProgram1111111111111111111111111111111` | Uses placeholder (matches current constants.rs, will break after fix) |
| `tax-program/tests/test_swap_sol_sell.rs:74` | `EpochProgram1111111111111111111111111111111` | Same placeholder issue |
| `tax-program/tests/test_swap_exempt.rs:55` | `EpochProgram1111111111111111111111111111111` | Same placeholder issue |

**NOTE about AMM test IDs:** The AMM tests use `BDwTJT4966CGcMP4HQS1QAp72MSF6nszhAD7M1V9xTNx` for AMM program ID and `J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W` / `EbN9johTcjch29b4kBU5N5Ked2skJnahKGViMWg5Y7GP` for Mock/Fake Tax. These are OLD IDs from a previous build. They match the keypairs in `keypairs/` (mock-tax-keypair.json and fake-tax-keypair.json) but NOT the current `declare_id!` macros. Since these are LiteSVM tests that deploy from `.so` files, they need to match whatever keypair the programs are deployed with in the test. This is a separate concern from production IDs.

### Pattern: How Anchor Links Keypairs to Programs

```
1. `anchor build` compiles programs and stores .so in target/deploy/
2. Anchor looks for target/deploy/<program_name>-keypair.json
   - If missing, Anchor generates a NEW random keypair
   - The program_name comes from the [programs.localnet] section in Anchor.toml
3. `anchor keys list` shows pubkeys derived from target/deploy/ keypairs
4. `anchor keys sync` updates declare_id! in each lib.rs to match target/deploy/ keypair
5. `anchor deploy` uses target/deploy/ keypair as the program address
6. `anchor deploy --program-keypair <path>` overrides with a specific keypair file
```

### Pattern: Reconciling keypairs/ with target/deploy/

Since `keypairs/` is the source of truth (user decision), the workflow is:

```bash
# For each production program:
cp keypairs/<program>-keypair.json target/deploy/<anchor_name>-keypair.json
anchor keys sync -p <program_name>
# Then manually update cross-program refs in constants.rs
anchor build
```

### Recommended Anchor.toml Structure

```toml
[programs.localnet]
amm = "<ID from keypairs/>"
epoch_program = "<ID from keypairs/>"
transfer_hook = "<ID from keypairs/>"
tax_program = "<ID from keypairs/>"
staking = "<ID from keypairs/>"
# Test programs
stub_staking = "<ID>"
mock_tax_program = "<ID>"
fake_tax_program = "<ID>"

[programs.devnet]
amm = "<same ID as localnet - same keypair, different cluster>"
epoch_program = "<same>"
transfer_hook = "<same>"
tax_program = "<same>"
staking = "<same>"
```

**Key insight from Anchor docs:** The program IDs in `[programs.devnet]` should be the SAME as `[programs.localnet]` because the same keypair is used for deployment. The cluster section just tells Anchor which cluster to deploy to; the program address comes from the keypair.

### Anti-Patterns to Avoid

- **Using `anchor keys sync` without copying correct keypairs first:** `anchor keys sync` reads from `target/deploy/`, so if those keypairs are wrong (as they currently are for epoch_program, staking, stub_staking), it will write the WRONG IDs into `declare_id!` macros.
- **Updating declare_id! manually without updating target/deploy/ keypair:** The program will build with one ID but deploy with a different one if the keypair doesn't match.
- **Forgetting cross-program references after changing IDs:** `anchor keys sync` only touches `declare_id!` macros. It does NOT update `constants.rs` functions like `epoch_program_id()`, `staking_program_id()`, `tax_program_id()`, or `TAX_PROGRAM_ID`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deriving pubkey from keypair JSON | Manual base58 encoding | `@solana/web3.js` `Keypair.fromSecretKey()` then `.publicKey.toBase58()` | Keypair JSON is a 64-byte array (32 secret + 32 public); web3.js handles this correctly |
| Updating declare_id! macros | Manual find-and-replace | `anchor keys sync` | Anchor knows the exact macro format and handles it atomically |
| TOML parsing in verification script | Regex | `@iarna/toml` or `toml` npm package | TOML has edge cases (multiline strings, comments) that regex misses |

**Key insight:** The verification script needs to parse 3 file types: keypair JSON (trivial), Rust source (regex for `declare_id!`, `pubkey!`, `from_str`), and TOML. Use a proper TOML parser; regex for Rust patterns is acceptable since the patterns are well-defined.

## Common Pitfalls

### Pitfall 1: Keypair / declare_id! / Anchor.toml Triple Mismatch
**What goes wrong:** Program deploys to address X (from keypair) but code references address Y (from declare_id!) and Anchor.toml lists address Z. The program is unreachable or CPI calls fail silently.
**Why it happens:** Three separate places store "the program's ID" and they can drift independently.
**How to avoid:** Single workflow: keypairs/ -> copy to target/deploy/ -> anchor keys sync -> update constants.rs -> anchor build -> verify script. Never skip steps.
**Warning signs:** `anchor keys list` shows different IDs than `declare_id!` macros. Tests pass on localnet but fail on devnet.

### Pitfall 2: Stale Test IDs After Production ID Changes
**What goes wrong:** Rust integration tests (`test_cpi_access_control.rs`, etc.) hardcode program IDs. After updating production IDs, tests deploy programs at the old addresses, causing all CPI tests to fail.
**Why it happens:** LiteSVM tests use `deploy_upgradeable_program()` with hardcoded IDs. These must match the compiled `.so` files' embedded `declare_id!`.
**How to avoid:** Update test IDs in the same commit as `declare_id!` changes. The verification script should also check test files.
**Warning signs:** Tests that passed before now fail with "program not found" or "seeds constraint violated" errors.

### Pitfall 3: Tax Program epoch_program_id() Placeholder Causes Silent CPI Failures
**What goes wrong:** `epoch_program_id()` returns `EpochProgram1111111111111111111111111111111`. Any PDA derived using this ID (carnage_signer, epoch_state) will be incorrect. `swap_exempt` rejects all Carnage execution. The Tax Program test files also use this placeholder, so tests appear to "pass" while the production code is broken.
**Why it happens:** Placeholder was intentionally added during Phase 20 before Epoch Program existed. Now the Epoch Program exists with `declare_id!("AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod")` but the placeholder was never updated.
**How to avoid:** Fix the placeholder first, update test files to match, verify with the script.
**Warning signs:** Any CPI from Epoch Program -> Tax Program's `swap_exempt` will fail with "seeds constraint violated".

### Pitfall 4: Missing Keypairs for AMM and Staking
**What goes wrong:** The `keypairs/` directory is the designated source of truth, but AMM and Staking have no keypair files there. For AMM, the `target/deploy/amm-keypair.json` matches `declare_id!` so it can be copied. For Staking, the `target/deploy/staking-keypair.json` does NOT match `declare_id!`, and no keypair matching `StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF` exists anywhere visible.
**Why it happens:** Different programs were set up at different times, some with vanity keypairs (StakF..., taXae...) generated externally, some by Anchor's auto-generation.
**How to avoid:** Before starting ID fixes, locate or regenerate all missing keypairs. For Staking, need to determine: was a vanity keypair generated elsewhere? If the keypair for `StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF` is lost, a new keypair must be generated and ALL references updated.
**Warning signs:** Can't deploy a program because no keypair matches the `declare_id!`.

### Pitfall 5: Anchor.toml IDs vs Actual IDs
**What goes wrong:** Anchor.toml `[programs.localnet]` lists IDs that don't match actual keypairs. `anchor test` loads programs at the wrong addresses.
**Why it happens:** Anchor.toml was updated independently of keypair changes.
**How to avoid:** Verification script checks Anchor.toml against keypair-derived IDs.

## Code Examples

### Verification Script - Keypair to Pubkey Derivation

```typescript
// Source: @solana/web3.js documentation
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";

function getPublicKeyFromKeypairFile(path: string): string {
  const keypairData = JSON.parse(fs.readFileSync(path, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  return keypair.publicKey.toBase58();
}
```

### Verification Script - Extracting declare_id! from Rust Source

```typescript
// Pattern: declare_id!("BASE58_STRING");
function extractDeclareId(filePath: string): string | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/declare_id!\("([A-Za-z0-9]+)"\)/);
  return match ? match[1] : null;
}
```

### Verification Script - Extracting Cross-Program ID References

```typescript
// Pattern 1: pubkey!("BASE58") - used in staking/src/constants.rs
// Pattern 2: Pubkey::from_str("BASE58").unwrap() - used in tax-program/src/constants.rs
// Pattern 3: pub const TAX_PROGRAM_ID: Pubkey = pubkey!("BASE58") - used in amm/src/constants.rs

function extractProgramIdRefs(filePath: string): Array<{name: string, value: string, line: number}> {
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const refs: Array<{name: string, value: string, line: number}> = [];

  for (let i = 0; i < lines.length; i++) {
    // pubkey!("...")
    const pubkeyMatch = lines[i].match(/pubkey!\("([A-Za-z0-9]+)"\)/);
    if (pubkeyMatch) {
      refs.push({ name: `line ${i+1}`, value: pubkeyMatch[1], line: i+1 });
    }
    // Pubkey::from_str("...").unwrap()
    const fromStrMatch = lines[i].match(/Pubkey::from_str\("([A-Za-z0-9]+)"\)/);
    if (fromStrMatch) {
      refs.push({ name: `line ${i+1}`, value: fromStrMatch[1], line: i+1 });
    }
  }
  return refs;
}
```

### Anchor Keys Sync Workflow

```bash
# Source: Anchor CLI --help, verified with anchor 0.32.1

# Step 1: Copy correct keypairs to target/deploy/
cp keypairs/epoch-program.json target/deploy/epoch_program-keypair.json

# Step 2: Sync declare_id! macros
anchor keys sync -p epoch_program

# Step 3: Verify
anchor keys list  # Should now show correct ID
```

### Anchor.toml Devnet Section

```toml
# Source: Anchor.toml reference docs (anchor-lang.com)
# IDs are the same across clusters - the keypair determines the address
[programs.devnet]
amm = "zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa"
epoch_program = "AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod"
transfer_hook = "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ"
tax_program = "FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu"
staking = "StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `anchor keys sync` only updates `declare_id!` | Still true in Anchor 0.32.1 | N/A | Cross-program refs in constants.rs must be manually maintained |
| `anchor deploy` always uses `target/deploy/` keypair | `--program-keypair` flag available | Anchor 0.28+ | Can deploy with keypairs from any path |
| `anchor build` regenerates missing keypairs | Still true in 0.32.1 | N/A | Must copy keypairs to target/deploy/ BEFORE building |

## Open Questions

### 1. Missing Staking Keypair
- **What we know:** `declare_id!("StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF")` is a vanity address (starts with "StakF"). The `target/deploy/staking-keypair.json` derives to `G1rqChKEPv5vJfEt2durESayRo2XUTK3RojFEJBofuU4` which does NOT match. No file in `keypairs/` matches either.
- **What's unclear:** Was a vanity keypair generated externally? If so, where is it stored? Is it on a different machine or branch?
- **Recommendation:** Ask the user if they have the staking vanity keypair saved elsewhere. If lost, we must generate a new one (vanity or random), update ALL references (declare_id!, cross-program constants in Tax, Epoch, Anchor.toml), and rebuild everything. This would be the biggest change in Phase 30.

### 2. Missing AMM Keypair in keypairs/
- **What we know:** `target/deploy/amm-keypair.json` derives to `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` which matches `declare_id!`. This keypair just needs to be copied to `keypairs/`.
- **What's unclear:** Nothing - straightforward copy.
- **Recommendation:** Copy `target/deploy/amm-keypair.json` -> `keypairs/amm-keypair.json`.

### 3. Stale Keypairs in keypairs/ (Tax Program)
- **What we know:** `keypairs/` has two Tax Program keypairs (`tax-program-keypair.json` -> TAXr5..., `taXaejVk...json` -> taXaej...) but NEITHER matches the current `declare_id!("FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu")`. The correct keypair is in `target/deploy/tax_program-keypair.json`.
- **Recommendation:** Copy `target/deploy/tax_program-keypair.json` -> `keypairs/tax-program-keypair.json` (overwrite). Remove or archive the stale `taXaejVk...json`. The vanity keypairs were likely from an earlier attempt.

### 4. Test File ID Updates Scope
- **What we know:** AMM LiteSVM tests use OLD program IDs (`BDwTJT4966...` for AMM, `J5CK3BiY...` for Mock Tax, `EbN9johT...` for Fake Tax). These are stale from an earlier build. Separately, Tax Program tests use the epoch placeholder.
- **What's unclear:** Should AMM test IDs match `declare_id!` or should they match `keypairs/mock-tax-keypair.json`? In LiteSVM tests, the `.so` binary embeds the `declare_id!`, so test helpers must use the same ID as `declare_id!`. This means tests need to use the CURRENT `declare_id!` values.
- **Recommendation:** Update all test helper functions to match current `declare_id!` values. This is straightforward find-and-replace.

### 5. AMM constants.rs TAX_PROGRAM_ID for CPI Tests
- **What we know:** AMM's `TAX_PROGRAM_ID` is `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` (Tax Program). But in `test_cpi_access_control.rs`, the `mock_tax_program_id()` returns `J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W` which is the OLD Mock Tax ID. The CPI tests rely on AMM's `TAX_PROGRAM_ID` matching the Mock Tax Program's actual deployed ID in test. This is a test architecture concern.
- **Recommendation:** The AMM constants.rs `TAX_PROGRAM_ID` should be the REAL Tax Program ID (production). For CPI tests, the Mock Tax Program and AMM's `TAX_PROGRAM_ID` are used differently -- the Mock Tax tests use LiteSVM which loads programs at specific addresses. The CPI tests may need a different approach (deploy Mock Tax at the address AMM expects). This needs careful handling during implementation.

## Sources

### Primary (HIGH confidence)
- **Codebase audit** - Direct inspection of all 8 programs' source code, keypair files, Anchor.toml, and test files
- **`anchor keys list` output** - Authoritative mapping of target/deploy/ keypairs to program names
- **`solana-keygen pubkey` output** - Authoritative pubkey derivation from all keypair files
- **Anchor CLI 0.32.1 `--help`** - Verified `keys sync`, `keys list`, `deploy --program-keypair` commands
- **Anchor.toml reference** (https://www.anchor-lang.com/docs/references/anchor-toml) - Official TOML structure documentation

### Secondary (MEDIUM confidence)
- **Anchor deploy workflow** (multiple web sources agree) - `target/deploy/` keypairs are used for deployment; `--program-keypair` can override; IDs should be same across cluster sections
- **anchor keys sync behavior** (Anchor CLI help + web sources) - Only updates `declare_id!` macros, not cross-program references

### Tertiary (LOW confidence)
- None - all findings verified against codebase or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools are already installed and verified working
- Architecture: HIGH - Based on direct codebase inspection, every file audited
- Pitfalls: HIGH - Found through actual mismatches in codebase, not hypothetical
- Cross-program refs: HIGH - Every reference traced and status verified
- Missing keypairs: MEDIUM - Staking keypair status depends on user knowledge

**Research date:** 2026-02-09
**Valid until:** Indefinite (configuration/tooling audit - only changes when code changes)
