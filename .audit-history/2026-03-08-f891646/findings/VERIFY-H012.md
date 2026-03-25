# Verification: H012/S003 - Staking Escrow Rent Depletion

**Original Severity:** HIGH (RECURRENT -- unfixed across 2 prior audits)
**Verification Status:** FIXED

## Changes Found

### 1. Staking claim.rs (lines 101-121)

The claim handler now reserves the rent-exempt minimum before transferring rewards:

```rust
let rent = Rent::get()?;
let rent_exempt_min = rent.minimum_balance(0);
let available = escrow_balance.checked_sub(rent_exempt_min).unwrap_or(0);
```

If `available < rewards_to_claim`, the instruction emits an `EscrowInsufficientAttempt` event and returns `InsufficientEscrowBalance` error. This prevents the escrow PDA from being drained below its rent-exempt threshold.

### 2. Epoch trigger_epoch_transition.rs (lines 204-243)

The bounty payment also now reserves rent-exempt minimum:

```rust
let rent = Rent::get()?;
let rent_exempt_min = rent.minimum_balance(0);
let bounty_threshold = TRIGGER_BOUNTY_LAMPORTS.checked_add(rent_exempt_min)?;
```

If `vault_balance < bounty_threshold`, the bounty is skipped (set to 0) rather than draining the vault. This is a graceful degradation -- epoch transitions still work, the triggerer just doesn't get paid.

### 3. deposit_rewards.rs -- Escrow owner check

The recommendation also called for an owner check in `deposit_rewards.rs`. The escrow_vault account uses PDA seeds constraint (`seeds = [ESCROW_VAULT_SEED], bump`) which validates the address derivation. However, there is no explicit `owner` check (e.g., verifying `escrow_vault.owner == program_id`).

**Assessment:** The PDA seeds constraint is sufficient here because:
- The escrow_vault is only used for `lamports()` read (balance reconciliation, line 100)
- The PDA address is deterministic from the staking program -- no other program can derive the same address with these seeds
- No lamport transfer occurs in this instruction (SOL was already transferred by Tax Program before CPI)

An explicit owner check would be defense-in-depth but is not exploitable without it.

## Verification Analysis

The fix is correct and complete for the critical vulnerability:

1. **Rent reservation uses `minimum_balance(0)`:** Correct for a PDA with 0 data bytes (system-owned SOL vault).
2. **`checked_sub().unwrap_or(0)`:** Handles the edge case where escrow balance is already below rent-exempt (returns 0 available, blocking all claims).
3. **Event emission before error:** `EscrowInsufficientAttempt` event provides observability for monitoring systems to detect low-escrow conditions.
4. **CEI pattern preserved:** State updates (lines 126-141) still happen before the lamport transfer (lines 150-162).
5. **Bounty rent fix:** Carnage vault uses the same pattern, preventing the vault PDA garbage collection that was noted in project memory as a mitigated-but-unpatched bug.

## Regression Check

- No regressions identified.
- The `Rent::get()` syscall adds ~100 CU per call, negligible.
- Claims that would drain escrow below rent-exempt now fail with a clear error instead of silently destroying the PDA. This is strictly better behavior.
- The bounty graceful degradation (skip instead of fail) ensures epoch transitions are never blocked by low vault balance.
