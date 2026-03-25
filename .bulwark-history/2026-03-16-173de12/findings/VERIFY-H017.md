# VERIFY-H017: Staking Escrow Rent Depletion
**Status:** PARTIALLY_FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

### On-chain guard (FIXED)
The staking program's claim instruction (`programs/staking/src/instructions/claim.rs:101-120`) correctly reserves the rent-exempt minimum before allowing any claim:

```rust
let escrow_balance = ctx.accounts.escrow_vault.lamports();
let rent_exempt_min = rent.minimum_balance(0);
let available = escrow_balance.checked_sub(rent_exempt_min)...
```

If `available < total_rewards`, the instruction emits `EscrowInsufficientAttempt` and returns `InsufficientEscrowBalance`. This prevents claims from draining the escrow below rent-exempt minimum.

### Crank monitoring (NOT FIXED)
`scripts/crank/crank-runner.ts` monitors and tops up the **Carnage SOL vault** (lines 413-448) but has zero references to the staking escrow. Searching for "staking_escrow", "escrow_vault", or "StakingEscrow" in the crank directory yields no matches.

The crank monitors:
- Wallet balance (line 403) — warning only
- Carnage vault balance (line 415) — auto top-up

The crank does NOT monitor:
- Staking escrow balance — no check, no top-up, no warning

### Risk assessment
The on-chain guard means the escrow cannot be drained below rent-exempt minimum by claims. However, if the escrow runs low (above rent-exempt but below pending rewards), `deposit_rewards` CPI from the epoch program could fail, causing the crank to error on epoch transitions. The circuit breaker (H019) would halt the crank after 5 consecutive failures, but the root cause would not be automatically remediated.

## Assessment
**No change from round 2.** The on-chain rent-exempt guard is solid and prevents the catastrophic scenario (escrow account closure). The crank-side monitoring gap remains: there is no code to check staking escrow balance or top it up, analogous to the carnage vault monitoring at lines 413-448. Adding a similar balance check + top-up for the staking escrow PDA would close this finding completely.
