# Vault Convert-All: On-Chain Fix for Intermediate Token Leakage

**Date:** 2026-03-25
**Status:** Proposal
**Severity:** High (UX-breaking — triggers wallet "malicious" warnings on large trades)
**Affected routes:** All multi-hop SOL<->PROFIT swaps (2-hop and 4-step split)

---

## 1. Executive Summary

Multi-hop swaps through the Conversion Vault leak intermediate CRIME/FRAUD tokens into users' wallets. This leak causes wallet security providers (Blowfish, used by Phantom and Backpack) to flag large trades as "unfair trade of assets" and block them. The root cause is a fundamental mismatch: the client must predict the AMM's exact output at build time, but pool reserves can shift between quoting and execution. The only robust fix is an on-chain change to the Conversion Vault program.

---

## 2. Problem Statement

### 2.1 The Token Leak

In a multi-hop SOL -> PROFIT swap:

```
Step 1 (AMM):   SOL  --> CRIME    (output varies with pool reserves)
Step 2 (Vault): CRIME --> PROFIT  (fixed 100:1 rate, deterministic)
```

The client builds both steps into a single atomic transaction. Step 2's `amount_in` parameter must be set at build time, but the client doesn't know step 1's exact on-chain output. Two approaches have been tried:

| Approach | What happens | Result |
|----------|-------------|--------|
| Use step 1's **full expected output** | If AMM underproduces (reserves shifted), vault tries to convert more CRIME than exists | **TX fails** with Custom:6017 (attempted once, reverted in commit 7b37522) |
| Use step 1's **slippage-adjusted minimum** | AMM produces more than the minimum; vault only converts the minimum | **~slippage% of CRIME leaks** into user's wallet (current behavior) |

Neither approach is correct. The fundamental issue: **the client cannot know the exact AMM output at build time, but the vault requires an exact `amount_in` parameter.**

### 2.2 Leak Proportionality

The leaked amount scales with:
- **User's slippage setting**: 1% slippage = ~1% leak, 5% slippage = ~5% leak
- **Swap size**: larger swaps produce more intermediate tokens, so the absolute leak is larger
- **Price impact**: high-impact trades often use higher slippage settings, compounding the leak

### 2.3 Wallet Security Flags (the UX-breaking symptom)

Wallet providers (Phantom, Backpack) use Blowfish to simulate transactions before signing. When Blowfish simulates a large multi-hop swap, it sees:

```
User sends:    40 SOL
User receives: X PROFIT + Y CRIME (leaked intermediate)
```

For large trades, Blowfish determines this is an **"unfair trade of assets, without adequate compensation"** and blocks the transaction:

![Backpack blocking screenshot — "Transaction blocked! Unfair trade of assets, without adequate compensation to the owner's account. Carries a risk of substantial financial loss."](screenshot on record with dev team)

**Observed thresholds:**
- 0.05 SOL swap: simulates correctly, shows CRIME leak, no flag
- 4 SOL swap: simulates correctly, shows CRIME leak, no flag
- 40 SOL swap (8% price impact): **BLOCKED** — "unfair trade"

The likely mechanism: Blowfish cannot price custom Token-2022 tokens (CRIME, FRAUD, PROFIT) via its standard oracle. When the simulation shows the user sending a known-value asset (SOL) and receiving only unpriced tokens, it evaluates the trade as a net loss. The leaked intermediate tokens add additional unpriced token balance changes, making the apparent trade look worse than it is.

### 2.4 Split Sell Failure (secondary symptom, now client-patched)

The same root cause caused split PROFIT -> SOL sells to fail entirely. In a 4-step split sell `[vault1, sell1, vault2, sell2]`, the old client-side chaining logic passed step 2's SOL output into step 3's vault convert (wrong token denomination), causing "insufficient funds" failures. This was patched client-side (commit 42932d8) with split leg boundary detection, but the underlying leak remains.

---

## 3. Affected Flows

| Route | Steps | Leak location | Impact |
|-------|-------|--------------|--------|
| SOL -> CRIME -> PROFIT | AMM buy, vault convert | CRIME leaks after AMM buy | Wallet flag on large trades |
| SOL -> FRAUD -> PROFIT | AMM buy, vault convert | FRAUD leaks after AMM buy | Wallet flag on large trades |
| PROFIT -> CRIME -> SOL | Vault convert, AMM sell | CRIME leaks after vault convert | Wallet flag on large trades |
| PROFIT -> FRAUD -> SOL | Vault convert, AMM sell | FRAUD leaks after vault convert | Wallet flag on large trades |
| SOL -> PROFIT (split) | 2x AMM buy, 2x vault convert | Both CRIME and FRAUD leak | Wallet flag + previously failed |
| PROFIT -> SOL (split) | 2x vault convert, 2x AMM sell | Both CRIME and FRAUD leak | Wallet flag + previously failed |

**Not affected:** Direct swaps (SOL<->CRIME, SOL<->FRAUD, CRIME<->PROFIT, FRAUD<->PROFIT) — single-hop, no intermediate tokens.

---

## 4. Prior Fix Attempts (Client-Side)

### 4.1 Full Expected Output (reverted)

**Commit:** 7b37522
**Approach:** Set step 2's `amount_in = step 1's outputAmount` (full expected, no slippage reduction).
**Result:** Custom:6017 errors when pool reserves shifted between quote and execution. The vault tried to convert more tokens than the AMM actually produced. Reverted.
**Why it failed:** AMM output is non-deterministic — depends on pool state at execution time, not quote time.

### 4.2 Slippage-Adjusted Minimum (current)

**Commit:** 42932d8
**Approach:** Set step 2's `amount_in = step 1's minimumOutput` (slippage-adjusted). Added split leg boundary detection to fix the sell-direction crash.
**Result:** Transactions succeed but leak ~slippage% of intermediate tokens. Wallet security flags large trades.
**Why it's insufficient:** The leak is proportional to slippage and unavoidable without on-chain changes.

### 4.3 Why No Client-Side Fix Is Possible

The core tension:
- **Too high** (`outputAmount`): TX fails if AMM underproduces
- **Too low** (`minimumOutput`): tokens leak if AMM produces expected amount
- **Just right**: unknowable at client build time — only the on-chain runtime knows the actual AMM output

The vault's `convert` instruction requires an exact `amount_in` parameter from the client. No client-side value can be simultaneously safe (never fails) and precise (never leaks). **The fix must happen on-chain.**

---

## 5. Proposed On-Chain Fix: Convert-All Mode

### 5.1 Design

Add a "convert all" mode to the Conversion Vault's existing `convert` instruction using a sentinel value:

**When `amount_in == 0`:** The vault reads the user's input token account balance on-chain and converts the **entire balance**.

This is safe because:
- `amount_in == 0` is already rejected by the existing `ZeroAmount` error, so it's a free sentinel with no backwards-compatibility risk
- The vault still enforces `minimum_output` (user's slippage protection)
- Old clients sending `amount_in > 0` continue to work unchanged
- New clients send `amount_in = 0` for multi-hop routes

### 5.2 On-Chain Changes

**File:** `programs/conversion-vault/src/instructions/convert.rs`

```rust
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Convert<'info>>,
    amount_in: u64,
    minimum_output: u64,  // NEW: on-chain slippage guard
) -> Result<()> {
    // --- Convert-all mode: read user's actual balance ---
    let effective_amount = if amount_in == 0 {
        let balance = ctx.accounts.user_input_account.amount;
        require!(balance > 0, VaultError::ZeroAmount);
        balance
    } else {
        amount_in
    };

    // --- Compute output (validates mint pair, dust) ---
    let amount_out = compute_output(
        &ctx.accounts.input_mint.key(),
        &ctx.accounts.output_mint.key(),
        effective_amount,
    )?;

    // --- Enforce minimum output (slippage protection) ---
    require!(
        amount_out >= minimum_output,
        VaultError::SlippageExceeded
    );

    // --- Transfer input: user -> vault ---
    // ... (unchanged, uses effective_amount instead of amount_in)

    // --- Transfer output: vault -> user ---
    // ... (unchanged, uses amount_out)
}
```

**Key changes:**
1. `amount_in == 0` → read `user_input_account.amount` as effective input
2. New `minimum_output` parameter for on-chain slippage protection
3. New `VaultError::SlippageExceeded` error variant
4. All existing `amount_in > 0` behavior unchanged

### 5.3 Client Changes

**File:** `app/lib/swap/multi-hop-builder.ts`

For vault convert steps in multi-hop routes, pass `amount_in = 0`:

```typescript
// In buildStepTransaction, when building vault convert:
const amountIn = isMultiHopVaultStep ? 0 : step.inputAmount;
const minimumOutput = step.minimumOutput; // passed as on-chain guard
```

The `previousMinimumOutput` chaining logic for vault steps becomes unnecessary — the vault reads the actual balance, whatever the AMM produced.

**File:** `app/lib/swap/swap-builders.ts`

`buildVaultConvertTransaction` gains a `minimumOutput` parameter passed to the instruction. For direct vault converts (1-hop), `amount_in` is still the exact amount.

### 5.4 Instruction Signature Change

```
// Before:
convert(amount_in: u64)

// After:
convert(amount_in: u64, minimum_output: u64)
```

This is a **breaking change** to the instruction interface. All callers must be updated simultaneously:
- Client (multi-hop builder + swap builders)
- E2E test scripts
- Any external integrations (none currently)

**Migration strategy:** Deploy program upgrade first (accepts new signature), then deploy client update. During the gap, the old client's calls will fail because the instruction data length doesn't match. Coordinate both deploys within the same maintenance window.

Alternatively, add `minimum_output` as an optional parameter using Anchor's `#[instruction]` attribute or a separate `convert_v2` instruction for zero-downtime migration.

---

## 6. What This Fixes

| Issue | Before | After |
|-------|--------|-------|
| Intermediate token leak | ~slippage% of CRIME/FRAUD left in wallet | Zero — vault converts entire balance |
| Wallet "malicious" flag on large trades | Blocked by Blowfish for large swaps | Clean simulation: -SOL, +PROFIT only |
| Split sell insufficient funds | Patched client-side (fragile) | Eliminated — vault reads actual balance |
| `previousMinimumOutput` vs `outputAmount` tension | Permanent tradeoff (fail vs leak) | Resolved — vault handles it on-chain |
| User confusion about unexpected tokens | Users see CRIME/FRAUD they didn't buy | No unexpected tokens |

---

## 7. Edge Cases & Safety

| Scenario | Behavior |
|----------|----------|
| `amount_in = 0`, user balance = 0 | `ZeroAmount` error (same as today) |
| `amount_in = 0`, dust amount (< 100 for faction->PROFIT) | `OutputTooSmall` error (same as today) |
| `amount_in > 0` (legacy call) | Exact behavior unchanged — backwards compatible |
| `minimum_output` not met | `SlippageExceeded` error — TX reverts, user loses nothing |
| Vault output reserves insufficient | Transfer fails — TX reverts, user loses nothing |
| User calls convert_all outside multi-hop | Converts their entire balance — valid use case, no harm |

---

## 8. Testing Plan

### 8.1 LiteSVM Unit Tests
- Convert-all with exact expected balance (happy path)
- Convert-all with balance > 0 but below dust threshold (OutputTooSmall)
- Convert-all with zero balance (ZeroAmount)
- Convert-all with minimum_output enforcement (SlippageExceeded when reserves shift)
- Legacy convert with `amount_in > 0` still works
- Both directions: CRIME/FRAUD -> PROFIT and PROFIT -> CRIME/FRAUD

### 8.2 Integration Tests
- Full multi-hop SOL -> PROFIT via buildAtomicRoute with convert-all
- Full multi-hop PROFIT -> SOL via buildAtomicRoute with convert-all
- Split route SOL -> PROFIT (4-step) with convert-all on both vault steps
- Split route PROFIT -> SOL (4-step) with convert-all on both vault steps
- Direct vault convert (1-hop) still uses exact amount_in

### 8.3 Wallet Simulation Verification
- Simulate large (40+ SOL) multi-hop swap on devnet
- Verify wallet preview shows ONLY: -SOL, +PROFIT (no intermediate CRIME/FRAUD)
- Verify no Blowfish "unfair trade" warning

---

## 9. Deployment Sequence

1. **Build** vault program with convert-all changes
2. **Test** on devnet with fresh deploy
3. **Verify** wallet simulation on devnet (no malicious flag)
4. **Upgrade** mainnet vault program via Squads multisig (timelocked)
5. **Deploy** client update to Railway (coordinated with program upgrade)
6. **Verify** mainnet wallet simulation for large trades

---

## 10. Timeline Estimate

- On-chain changes: ~2 hours (small diff to convert.rs + error.rs)
- Client changes: ~1 hour (multi-hop-builder.ts + swap-builders.ts)
- LiteSVM tests: ~2 hours
- Integration tests: ~2 hours
- Devnet deploy + verification: ~1 hour
- Mainnet upgrade (Squads): ~1 hour (plus timelock wait)

---

## 11. Related Issues

| Issue | File | Status |
|-------|------|--------|
| Split sell leg boundary | `.planning/debug/resolved/sol-profit-intermediate-tokens.md` | Resolved (client-side, commit 42932d8) |
| Sign-then-send Phantom flag | `.planning/debug/phantom-simulation-warning.md` | Resolved (useProtocolWallet.ts cluster switch) |
| Full output 6017 regression | `.planning/debug/multi-hop-6017-phantom-regression.md` | Reverted (commit 7b37522) — superseded by this proposal |

---

## 12. Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-03-24 | Used `previousMinimumOutput` chaining | Safe: AMM guarantees minimum output. Tradeoff: ~slippage% leak. |
| 2026-03-25 | Reverted `step.outputAmount` chaining | Caused Custom:6017 when AMM underproduced. |
| 2026-03-25 | Added split leg boundary detection | Fixed split sell crash. Leak remains. |
| 2026-03-25 | Proposed on-chain convert-all | Only fix that eliminates leak without risking TX failures. |
