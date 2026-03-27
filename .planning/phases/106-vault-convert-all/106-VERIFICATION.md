---
phase: 106-vault-convert-all
verified: 2026-03-26T20:35:43Z
status: human_needed
score: 5/6 must-haves verified
gaps:
human_verification:
  - test: "Large multi-hop swap (40+ SOL) Blowfish wallet preview"
    expected: "Phantom wallet preview shows ONLY -SOL and +PROFIT (no CRIME/FRAUD intermediaries). Blowfish simulation allows transaction with no 'malicious' or 'unfair trade' warning."
    why_human: "Blowfish simulation infrastructure does not operate on devnet — this can only be verified on mainnet after the program upgrade. The structural mechanism (convert-all mode eliminating intermediate tokens) is verified working via 8/8 devnet routes. Verification deferred by user approval at 106-04 checkpoint. Must be confirmed before public announcement."
---

# Phase 106: Vault Convert-All Verification Report

**Phase Goal:** Add convert_v2 on-chain instruction with convert-all sentinel mode, update all client swap builders, security audit, and deploy + test on devnet
**Verified:** 2026-03-26T20:35:43Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | convert_v2 instruction exists with (amount_in: u64, minimum_output: u64) | VERIFIED | `programs/conversion-vault/src/instructions/convert_v2.rs` — 86 lines, `lib.rs` registers it; IDL shows `convert_v2` with `amount_in` + `minimum_output` args |
| 2 | amount_in=0 reads user_input_account.amount on-chain (convert-all mode) | VERIFIED | `convert_v2.rs` lines 23-29: `if amount_in == 0 { let balance = ctx.accounts.user_input_account.amount; require!(balance > 0, VaultError::ZeroAmount); balance }` |
| 3 | minimum_output enforced on-chain with SlippageExceeded (6006) | VERIFIED | `convert_v2.rs` line 47: `require!(amount_out >= minimum_output, VaultError::SlippageExceeded)`. `error.rs` shows SlippageExceeded at 6006, InvalidOwner at 6007 — appended after MathOverflow (6005), preserving 6000-6005 stability |
| 4 | All client vault convert paths use convertV2 (not legacy convert) | VERIFIED | `swap-builders.ts` line 535: `.convertV2(new BN(amountInBaseUnits), new BN(minimumOutput))`. No `vaultProgram.methods.convert(` calls remain in production app code. `useSwap.ts` passes `minimumOutput: quote.minimumOutput` correctly. Multi-hop builder uses `isMultiHopStep`/`useConvertAll` flag with `effectiveAmountIn = isMultiHopStep ? 0 : step.inputAmount` |
| 5 | Split route SOL<->PROFIT works without intermediate token leakage | VERIFIED | Split-route greedy consumption bug found and fixed (commit `a11d9b8`). `isFirstStepInLeg` guard ensures vault steps at leg boundaries use exact amounts; only post-AMM vault steps use convert-all mode. 8/8 routes verified on devnet by user including 4-step splits |
| 6 | 40+ SOL multi-hop simulates cleanly in Phantom without Blowfish warning | NEEDS HUMAN | Mechanism is implemented and devnet routes pass with zero intermediate tokens. Blowfish preview verification requires mainnet — devnet simulation unreliable for this test. Deferred by user approval at 106-04 checkpoint |

**Score:** 5/6 truths verified (1 needs human on mainnet)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/conversion-vault/src/instructions/convert_v2.rs` | Handler with sentinel, owner check, slippage guard | VERIFIED | 86 lines, substantive, all 3 functional sections present |
| `programs/conversion-vault/src/error.rs` | SlippageExceeded (6006) and InvalidOwner (6007) | VERIFIED | Appended after MathOverflow (6005), non-breaking ordering confirmed |
| `programs/conversion-vault/src/lib.rs` | convert_v2 registered alongside convert | VERIFIED | Lines 55-61: `pub fn convert_v2` dispatches to `instructions::convert_v2::handler` |
| `programs/conversion-vault/src/instructions/mod.rs` | `pub mod convert_v2` added | VERIFIED | Line 3: `pub mod convert_v2` — no glob re-export to avoid handler name collision |
| `programs/conversion-vault/tests/bok_proptest_vault.rs` | INV-CV-009 through INV-CV-013 | VERIFIED | All 5 new invariants present and substantive (lines 218-363) |
| `app/idl/conversion_vault.json` | Both convert and convertV2 in IDL | VERIFIED | `convert_v2` at line 115, `amount_in`+`minimum_output` args at lines 215/219, SlippageExceeded=6006, InvalidOwner=6007 at lines 460-467 |
| `app/idl/types/conversion_vault.ts` | TypeScript types for convertV2 | VERIFIED | 504 lines, `convertV2` method with `minimumOutput` at line 225 |
| `app/lib/swap/swap-builders.ts` | buildVaultConvertTransaction calls convertV2 | VERIFIED | Line 535: `.convertV2(new BN(amountInBaseUnits), new BN(minimumOutput))`, `minimumOutput` destructured and forwarded |
| `app/lib/swap/multi-hop-builder.ts` | Multi-hop vault steps use convert-all mode | VERIFIED | `useConvertAll` logic at lines 373-374; `effectiveAmountIn = isMultiHopStep ? 0 : step.inputAmount` at line 143 |
| `app/lib/swap/error-map.ts` | VAULT_ERRORS map (8 entries, 6000-6007) | VERIFIED | `VAULT_ERRORS` constant present, includes 6006 (SlippageExceeded) and 6007 (InvalidOwner), `SWAP_ERROR_MAP` includes `vault` key, `parseSwapError` detects vault program ID |
| `.audit/findings/VAULT-CONVERT-V2.md` | SOS audit report — CLEARED | VERIFIED | 359 lines, covers all 8 checklist items, Final Verdict: CLEARED at line 341, 0 findings at any severity |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib.rs` | `convert_v2.rs` | instruction dispatch | WIRED | `instructions::convert_v2::handler(ctx, amount_in, minimum_output)` |
| `convert_v2.rs` | `convert.rs` | shared Convert struct + compute functions | WIRED | `use crate::instructions::convert::Convert`, `compute_output`/`compute_output_with_mints` imported with `#[cfg]` feature gates |
| `convert_v2.rs` | `error.rs` | new error variants | WIRED | `VaultError::InvalidOwner`, `VaultError::SlippageExceeded` referenced |
| `swap-builders.ts` | IDL `conversion_vault.json` | Anchor program methods | WIRED | `.convertV2(...)` call matches IDL instruction name; IDL contains `convert_v2` at line 115 |
| `multi-hop-builder.ts` | `swap-builders.ts` | buildVaultConvertTransaction call | WIRED | `buildStepTransaction` calls `buildVaultConvertTransaction` with `effectiveAmountIn` (0 or exact) |
| `useSwap.ts` | `swap-builders.ts` | direct vault convert path | WIRED | Line 716: `buildVaultConvertTransaction({..., minimumOutput: quote.minimumOutput, ...})` |
| `multi-hop-builder.ts` | devnet vault program | `useConvertAll` → `effectiveAmountIn=0` | WIRED | Devnet upgrade confirmed at slot 448438513, program ID `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` unchanged |

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| VAULT-01: convert_v2 with amount_in=0 sentinel | SATISFIED | Instruction exists, sentinel logic verified in handler |
| VAULT-02: minimum_output slippage protection | SATISFIED | `require!(amount_out >= minimum_output, VaultError::SlippageExceeded)` |
| VAULT-03: Existing convert unchanged | SATISFIED | convert.rs unmodified (174 lines, stable); IDL still contains `convert`; shared `Convert<'info>` struct unchanged per SOS audit |
| VAULT-04: Multi-hop builder passes amount_in=0 | SATISFIED | `useConvertAll` flag, `effectiveAmountIn = isMultiHopStep ? 0 : step.inputAmount` |
| VAULT-05: 40+ SOL swaps clean Blowfish preview | NEEDS HUMAN | Mechanism implemented and devnet routes verified. Blowfish preview requires mainnet — deferred by user. |
| VAULT-06: Split route works without intermediate leakage | SATISFIED | Split-route greedy consumption fix (`a11d9b8`) verified by user on devnet — 4-step routes pass with zero leftover |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned `convert_v2.rs`, `error.rs`, `lib.rs`, `swap-builders.ts`, `multi-hop-builder.ts`, `error-map.ts` — no TODO/FIXME/placeholder/empty returns found.

### Human Verification Required

### 1. Blowfish Wallet Preview — Large Multi-Hop (VAULT-05)

**Test:** After mainnet program upgrade via Squads, execute a SOL->PROFIT swap using 40+ SOL (or the largest available mainnet balance). In Phantom wallet, review the transaction preview before signing.

**Expected:** Phantom's preview shows only "-SOL" and "+PROFIT" as balance changes. No CRIME or FRAUD token entries appear. Blowfish security scanner does not flag the transaction as "malicious", "risky", or "unfair trade".

**Why human:** Blowfish simulation infrastructure does not operate on devnet. Devnet wallet previews do not invoke the Blowfish security layer. This verification requires the real mainnet deployment with Blowfish's production scanner active. The structural mechanism (convert-all mode eliminating intermediate token balances) is implemented and verified working via 8/8 devnet routes — the question is whether Blowfish's preview engine correctly reflects zero intermediate balance changes.

**Repeat in Backpack** if user has Backpack installed with mainnet balance.

### Gaps Summary

No gaps blocking the phase's devnet deliverables. VAULT-05 (Blowfish preview) is a mainnet-only verification that requires the follow-up mainnet upgrade phase. The mechanism to pass this verification is fully implemented and proven correct on devnet. The structural precondition (convert-all mode → zero intermediate token deltas → clean wallet preview) is sound.

All 7 commits verified in git history:
- `ba922cd` — convert_v2 instruction + error variants
- `34d015e` — BOK proptest INV-CV-009 through INV-CV-013
- `07e491b` — swap-builders.ts → convertV2
- `ebbcee1` — multi-hop convert-all mode + vault error map
- `4a72cb0` — SOS audit CLEARED
- `8976cdd` — devnet in-place upgrade
- `a11d9b8` — split-route greedy consumption fix

---

_Verified: 2026-03-26T20:35:43Z_
_Verifier: Claude (gsd-verifier)_
