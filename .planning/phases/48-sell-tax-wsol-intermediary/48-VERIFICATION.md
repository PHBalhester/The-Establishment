---
phase: 48-sell-tax-wsol-intermediary
verified: 2026-02-19T23:11:16Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 48: Sell Tax WSOL Intermediary Verification Report

**Phase Goal:** Users can sell CRIME/FRAUD tokens regardless of their native SOL balance -- sell tax is deducted from the WSOL swap output, not from the user's native SOL

**Verified:** 2026-02-19T23:11:16Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The sell handler deducts tax from the WSOL swap output (not from user's native SOL) by transferring tax WSOL to a protocol intermediary, closing it to unwrap, distributing native SOL, then reinitializing the intermediary | ✓ VERIFIED | swap_sol_sell.rs lines 244-429 implement full transfer-close-distribute-reinit cycle. No `system_instruction::transfer` from `ctx.accounts.user` remains (verified 0 occurrences). All tax distribution comes from `swap_authority` after WSOL unwrap. |
| 2 | A user with 0.001 SOL native balance can execute a sell swap without the transaction reverting due to insufficient native SOL | ✓ VERIFIED | Tax extraction happens via SPL Token transfer from user's WSOL ATA (line 247-268), not via system transfer from native SOL. User only needs enough SOL for TX fees (~0.0005 SOL). |
| 3 | Tax distribution (75/24/1 split to staking_escrow, carnage_vault, treasury) still arrives as native SOL in the correct destination accounts | ✓ VERIFIED | Lines 296-377 distribute native SOL from swap_authority to all 3 destinations via `system_instruction::transfer` with `invoke_signed`. Close account (line 273-290) unwraps WSOL to native SOL in swap_authority before distribution. |
| 4 | The InsufficientOutput error rejects sells where tax >= gross output | ✓ VERIFIED | Line 221 has `require!(net_output > 0, TaxError::InsufficientOutput)` guard. Error variant exists in errors.rs line 73-76. Guard executes BEFORE distribution. |
| 5 | The WSOL intermediary can be initialized via initialize_wsol_intermediary instruction before the first sell | ✓ VERIFIED | initialize_wsol_intermediary.rs exists with complete handler (lines 31-86) and accounts struct (lines 94-126). Exported in mod.rs (line 3, 10) and entry point in lib.rs (lines 101-105). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `programs/tax-program/src/constants.rs` | ✓ VERIFIED | WSOL_INTERMEDIARY_SEED constant exists (line 58-62), get_wsol_intermediary_pda() helper exists (lines 153-161), unit test exists (lines 228-231) |
| `programs/tax-program/src/errors.rs` | ✓ VERIFIED | InsufficientOutput error variant exists (lines 73-76) with correct error message |
| `programs/tax-program/src/instructions/swap_sol_sell.rs` | ✓ VERIFIED | 611 lines, substantive implementation. Contains wsol_intermediary in accounts struct (lines 576-589), implements transfer-close-distribute-reinit pattern (lines 232-429), no system transfers from user remain |
| `programs/tax-program/src/instructions/initialize_wsol_intermediary.rs` | ✓ VERIFIED | 127 lines, complete implementation. Creates WSOL intermediary PDA via create_account + InitializeAccount3. Handler (lines 31-86), accounts struct (lines 94-126) |
| `programs/tax-program/src/instructions/mod.rs` | ✓ VERIFIED | Exports initialize_wsol_intermediary module (line 3) and re-exports symbols (line 10) |
| `programs/tax-program/src/lib.rs` | ✓ VERIFIED | Entry point for initialize_wsol_intermediary instruction exists (lines 101-105), delegates to handler |
| `shared/constants.ts` | ✓ VERIFIED | WsolIntermediary PDA exists in DEVNET_PDAS_EXTENDED (line 339) with address 7deHc12ccjzhfjv9uwRsAcj3dCySGSsDrkNAm4sfN5eV |
| `app/lib/swap/swap-builders.ts` | ✓ VERIFIED | buildSolSellTransaction passes wsolIntermediary in accountsStrict (line 396), compute units set to 250_000 (line 318) |
| `scripts/deploy/initialize.ts` | ✓ VERIFIED | Step 19 calls initializeWsolIntermediary (lines 1050-1051), TOTAL_STEPS = 20 (line 70) |
| `scripts/e2e/lib/alt-helper.ts` | ✓ VERIFIED | WsolIntermediary included in protocol ALT with backward-compat guard (lines 112-114) |
| `scripts/deploy/pda-manifest.json` | ✓ VERIFIED | WsolIntermediary address exists in pdas section (line 24) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| swap_sol_sell.rs | constants.rs | WSOL_INTERMEDIARY_SEED import | ✓ WIRED | Import exists (line 32), seed used in PDA derivation (line 382) and account constraint (line 586) |
| swap_sol_sell.rs | errors.rs | InsufficientOutput error | ✓ WIRED | Error imported via `crate::errors::TaxError` (line 34), used in guard (line 221) |
| initialize_wsol_intermediary.rs | constants.rs | WSOL_INTERMEDIARY_SEED and SWAP_AUTHORITY_SEED imports | ✓ WIRED | Both seeds imported (line 18), used in PDA derivation (lines 37-40, 110-113) |
| lib.rs | initialize_wsol_intermediary.rs | Instruction entry point delegation | ✓ WIRED | Entry point exists (lines 101-105), delegates to `instructions::initialize_wsol_intermediary::handler` |
| swap-builders.ts | constants.ts | DEVNET_PDAS_EXTENDED.WsolIntermediary import | ✓ WIRED | Constant imported (checked via usage), used in accountsStrict (line 396) |
| alt-helper.ts | pda-manifest.json | manifest.pdas.WsolIntermediary | ✓ WIRED | Manifest loaded, WsolIntermediary address added to ALT (line 113) |
| initialize.ts | Tax Program IDL | initializeWsolIntermediary instruction | ✓ WIRED | Tax program loaded from IDL, method called (line 1051) |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| FIX-01 (Sell tax deducted from WSOL output) | ✓ SATISFIED | N/A — all 5 truths verified, transfer-close-distribute-reinit pattern implemented |

### Anti-Patterns Found

No anti-patterns detected. Scan results:
- 0 TODO/FIXME/placeholder comments in modified Rust files
- 0 console.log-only implementations in client-side files
- 0 empty return statements in handlers
- All error handling uses proper `Result<()>` returns

### IDL Verification

✓ `target/idl/tax_program.json` exists (43KB, modified 2026-02-19T22:58)
✓ `app/idl/tax_program.json` exists (43KB, modified 2026-02-19T23:05)
✓ IDL contains `initialize_wsol_intermediary` instruction (verified by grep)
✓ IDL contains `wsol_intermediary` account in `swap_sol_sell` instruction (verified by grep)
✓ IDL synced between target/ and app/ directories

### Structural Integrity

**On-chain changes (Plan 01):**
- ✓ WSOL_INTERMEDIARY_SEED constant: 17 bytes, value `b"wsol_intermediary"`
- ✓ get_wsol_intermediary_pda() helper: returns (Pubkey, u8) tuple
- ✓ InsufficientOutput error: custom error with clear message
- ✓ swap_sol_sell handler: 611 lines, implements 8-step flow per spec
- ✓ SwapSolSell accounts struct: 21 named accounts (was 20, +1 for wsol_intermediary)
- ✓ initialize_wsol_intermediary instruction: complete with handler and accounts struct
- ✓ No system_instruction::transfer from user remains in sell handler (verified 0 occurrences)

**Client-side changes (Plan 02):**
- ✓ WsolIntermediary PDA: 7deHc12ccjzhfjv9uwRsAcj3dCySGSsDrkNAm4sfN5eV (derived from Tax Program)
- ✓ Sell compute units: 250,000 (increased from 200,000)
- ✓ Protocol ALT: includes WsolIntermediary address
- ✓ Deploy script: Step 19 initializes intermediary, TOTAL_STEPS = 20

---

## Verification Summary

Phase 48 goal **ACHIEVED**. All must-haves verified:

1. ✓ **Transfer-close-distribute-reinit pattern implemented** — Tax deducted from WSOL output, not native SOL
2. ✓ **Low SOL balance support** — Only TX fees required, not tax amount
3. ✓ **Tax distribution preserved** — 75/24/1 split arrives as native SOL
4. ✓ **InsufficientOutput guard** — Rejects sells where tax >= gross output
5. ✓ **Initialization instruction exists** — Admin can create intermediary before first sell

**On-chain:** swap_sol_sell rewritten with 21-account struct, initialize_wsol_intermediary instruction created, constants and errors added.

**Client-side:** WsolIntermediary PDA in constants, swap-builders updated with new account, deploy script has Step 19 init, ALT includes new address.

**Integration:** IDL synced, all key links wired, no anti-patterns detected.

Phase ready for deployment. Next: Phase 49 (Protocol Safety & Events) or Phase 51 (Program Rebuild & Devnet Deploy).

---

_Verified: 2026-02-19T23:11:16Z_
_Verifier: Claude (gsd-verifier)_
