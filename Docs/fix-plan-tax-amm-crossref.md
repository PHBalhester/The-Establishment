# Fix Plan: Tax Program AMM Cross-Reference (Devnet SOL Swaps)

**Date:** 2026-03-23
**Status:** DRAFT — awaiting owner approval
**Risk to mainnet:** None (devnet-only operation)

---

## Problem

`programs/tax-program/src/constants.rs` → `amm_program_id()` returns the **mainnet** AMM ID (`5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR`), but the Phase 102 devnet AMM is `J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5`. Every SOL swap fails with `TaxError::InvalidAmmProgram`.

## Why It Happened

The build pipeline has **two** cross-reference patchers:

| Patcher | What it patches in Tax Program | AMM ID? |
|---------|-------------------------------|---------|
| `sync-program-ids.ts` | Nothing in tax-program (uses `Pubkey::from_str()`, patcher only matches `pubkey!()`) | **NO** |
| `patch-mint-addresses.ts` | `epoch_program_id`, `staking_program_id`, `treasury_pubkey` | **NO — missing** |

Both patchers skip `amm_program_id()` in the Tax Program. Epoch and staking got correct devnet IDs because `patch-mint-addresses.ts` handles those, but AMM was never added.

## Current State

```
programs/tax-program/src/constants.rs:
  epoch_program_id()   → E1u6fM9...  ✓ CORRECT (devnet, patched by patch-mint-addresses.ts)
  staking_program_id() → DrFg87b...  ✓ CORRECT (devnet, patched by patch-mint-addresses.ts)
  amm_program_id()     → 5JsSAL3...  ✗ WRONG (mainnet, never patched)
  treasury_pubkey()    → 8kPzhQ...   ✓ CORRECT (devnet wallet, feature-gated)
```

---

## Fix Plan

### Part 1: Immediate Fix (devnet SOL swaps)

**What:** Patch the AMM ID, rebuild tax program only, upgrade on devnet.

**Step 1 — Patch `amm_program_id()` in constants.rs**

```rust
// In programs/tax-program/src/constants.rs, change amm_program_id():
// FROM: Pubkey::from_str("5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR")
// TO:   Pubkey::from_str("J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5")
```

**Step 2 — Rebuild ONLY the tax program with --devnet**

```bash
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
anchor build -p tax_program -- --features devnet
```

This does NOT rebuild any other program. No keypairs are touched. No declare_id! changes.

**Step 3 — Upgrade the tax program on devnet**

```bash
solana program deploy target/deploy/tax_program.so \
  --program-id keypairs/tax-program-keypair.json \
  --keypair keypairs/devnet-wallet.json \
  --url devnet \
  --with-compute-unit-price 1
```

Note: `keypairs/tax-program-keypair.json` is the Phase 102 devnet keypair (`FGgidfhN...`). The mainnet keypair is safely backed up at `keypairs/mainnet-tax-program-program.json`.

**Step 4 — Verify SOL swaps work**

Test a SOL→CRIME swap on the frontend or via script.

### Part 2: Systemic Fix (prevent recurrence)

**What:** Add `amm_program_id` to `patch-mint-addresses.ts` so future builds automatically patch it.

`patch-mint-addresses.ts` already patches `epoch_program_id` and `staking_program_id` in the Tax Program using `Pubkey::from_str()` pattern matching. Adding `amm_program_id` is a one-line addition to the same patch list.

This is lower priority — can be done after devnet testing is unblocked.

---

## Mainnet Safety Analysis

| Concern | Status | Why it's safe |
|---------|--------|---------------|
| `deployments/mainnet.json` modified? | **NO** | Not touched by any step |
| Mainnet program keypairs affected? | **NO** | Backed up at `keypairs/mainnet-*-program.json`, untouched |
| Mainnet program binaries affected? | **NO** | We're only deploying to devnet (`--url devnet`) |
| Phase 100 Stages 5-7 affected? | **NO** | Appendix E restoration procedure restores mainnet keypairs and triggers a full rebuild. The `amm_program_id` in tax constants will be patched to mainnet AMM by `patch-mint-addresses.ts` (once Part 2 is done) or manually before mainnet build |
| Other programs recompiled? | **NO** | Only `anchor build -p tax_program` |
| `declare_id!` macros changed? | **NO** | We skip `sync-program-ids.ts` entirely |
| `Anchor.toml` changed? | **NO** | No changes needed |
| `shared/constants.ts` changed? | **NO** | Frontend constants unaffected |

### Pre-mainnet checklist addition

When resuming Phase 100, the Appendix E restoration must also verify:
- `amm_program_id()` in tax-program/constants.rs matches the mainnet AMM ID (`5JsSAL3k...`)
- After Part 2 systemic fix, this happens automatically via `patch-mint-addresses.ts`
- Before Part 2, it must be verified manually

---

## Estimated Cost

- SOL: ~0.01 SOL (upgrade TX fee, no re-rent since program buffer already exists at 1.2x)
- Time: ~5 minutes
- Risk: Minimal — single program upgrade on devnet, no mainnet involvement

---

## Decision Required

Approve this plan? If yes, I'll execute Parts 1 and 2.
