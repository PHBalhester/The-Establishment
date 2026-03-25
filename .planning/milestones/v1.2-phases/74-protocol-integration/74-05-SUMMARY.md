---
phase: 74-protocol-integration
plan: 05
status: complete
commits:
  - 780a759: "feat(74-05): add comprehensive bonding curve lifecycle integration test"
  - 5425b33: "fix(74-05): fix failure path clock advancing for lifecycle test"
---

# Summary: Comprehensive Bonding Curve Lifecycle Integration Test

## What was built

A comprehensive localnet integration test (`tests/integration/lifecycle.test.ts`, ~2050 lines) that exercises the full bonding curve lifecycle across all 12 instructions within the 7-program protocol stack.

## Test Results: 21 passing (9 minutes)

### Happy Path: Graduation (15 tests)
- Buy tokens from CRIME curve (1 SOL -> ~1.1M CRIME tokens)
- Sell tokens back with 15% tax deduction
- Enforce per-wallet cap (20M tokens) - WalletCapExceeded
- Enforce minimum purchase (0.05 SOL) - BelowMinimum
- Enforce slippage protection - SlippageExceeded
- Reject graduation with only one curve filled
- Fill CRIME curve (~1006 SOL raised, ~200 buy TXs)
- Reject sells on Filled curve - CurveNotActiveForSell
- Fill FRAUD curve (~1005 SOL raised)
- Graduate both curves via prepare_transition
- Reject purchases on Graduated curve - CurveNotActive
- Withdraw SOL from graduated vaults (~2010 SOL)
- Idempotent second withdraw (no-op)
- Close empty token vaults (recovering rent)
- Distribute tax escrow to carnage fund

### Failure Path: Refund (5 tests)
- Mark curves as Failed after deadline + grace period
- Consolidate tax escrow for refunds
- Reject second consolidation - EscrowAlreadyConsolidated
- Claim proportional refund (tokens burned, SOL returned)
- Reject refund with no tokens - NothingToBurn

### Edge Cases (1 test)
- Partial fill at curve boundary

## Key Technical Decisions

1. **Clock advancing**: Fire-and-forget `sendRawTransaction` with unique lamport amounts per TX to prevent validator deduplication. Batch size 50, 300ms pause between batches. Advances ~2-3 slots/sec.

2. **Localnet feature gate**: Program built with `--features localnet` which sets DEADLINE_SLOTS=500 (vs 432,000 mainnet) and bypasses mint address checks in initialize_curve.

3. **Transfer Hook integration**: All token transfers include 4 remaining_accounts (extraMeta, wlSource, wlDest, hookProgramId). Whitelist entries created for all token accounts.

4. **Separate curve pairs**: Happy path and failure path use independent mint/curve pairs to avoid state interference.

## Deviations from plan

- **Clock advancing approach**: Plan suggested `warp_to_slot` or `BanksClient` but localnet test validator doesn't support clock manipulation. Used batched fire-and-forget transfers instead.
- **AMM pool verification**: Post-graduation AMM pool seeding was not tested as it requires the full graduation orchestration script (74-04) which is a separate deployment concern, not a program instruction test.
