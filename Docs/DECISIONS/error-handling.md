---
topic: "Error Handling & Edge Cases"
topic_slug: "error-handling"
status: complete
interview_date: 2026-02-20
decisions_count: 9
provides: ["error-handling-decisions"]
requires: ["cpi-architecture-decisions", "security-decisions", "operations-decisions"]
verification_items: []
---

# Error Handling & Edge Cases — Decisions

## Summary
Error handling follows a distributed, defense-in-depth pattern. No unified error catalog — each program's `errors.rs` + frontend error maps are sufficient. CPI errors propagate raw (no wrapping), with client-side mapping handling user presentation. All critical edge cases (zero amounts, concurrent operations, rounding, overflow, empty funds, crank downtime) are handled gracefully in code and should be documented for operators.

## Decisions

### D1: No Unified Error Catalog
**Choice:** Keep the distributed approach — each program's `errors.rs` with doc comments is the source of truth, frontend error maps translate for users. No single cross-program error catalog document.
**Rationale:** Programs are immutable post-burn, so error variants are frozen forever. The GL draft phase can synthesize from the 6 individual `errors.rs` files when writing the Error Handling Playbook. A separate catalog would be redundant maintenance.
**Alternatives considered:** Unified error catalog document mapping all 94 variants with triggers, user messages, and recovery actions.
**Affects docs:** [error-handling-playbook]

### D2: Client-Side Error Mapping Over On-Chain CPI Wrapping
**Choice:** Errors from depth-4 CPI chains propagate raw — the innermost program's error code surfaces to the client. The frontend's `parseSwapError` / `parseStakingError` functions handle user-facing translation by checking program IDs.
**Rationale:** For an immutable protocol, keeping error presentation flexible (off-chain) while on-chain logic stays simple is the right trade-off. Client-side maps can be updated anytime without touching frozen programs. On-chain wrapping would hide original error codes and add code complexity at every CPI call site.
**Alternatives considered:** Wrapping CPI errors at each level to add call-site context (e.g., Tax returning "SwapOutputTransferFailed" instead of raw Hook error).
**Affects docs:** [error-handling-playbook, cpi-interface-contract]

### D3: No Frontend Maps for Epoch/Hook Errors
**Choice:** Epoch Program (29 variants) and Transfer Hook (14 variants) errors are not mapped in the frontend. The existing generic fallback in `parseSwapError` handles unrecognized errors with a generic "Transaction failed" message.
**Rationale:** Epoch errors are exclusively crank-bot territory (VRF, Carnage execution). Transfer Hook errors should never reach users — the whitelist is configured during pool initialization and the protocol controls which accounts interact. The generic fallback is sufficient for the "should-never-happen" case.
**Alternatives considered:** Adding defensive error maps for all 43 Epoch + Hook variants.
**Affects docs:** [error-handling-playbook, frontend-spec]

### D4: Zero-Amount Swap Protection Is Sufficient
**Choice:** Current defense-in-depth approach (AMM rejects amount=0, Tax rejects post-tax-zero, transfer helpers reject zero transfers) is complete. No additional validation needed.
**Rationale:** Verified in code — `require!(amount_in > 0, AmmError::ZeroAmount)` at AMM entry points, `require!(sol_to_swap > 0, TaxError::InsufficientInput)` after tax deduction in Tax, and `require!(amount > 0, AmmError::ZeroAmount)` in transfer helpers. Three independent layers.
**Affects docs:** [error-handling-playbook, security-model]

### D5: Concurrent Carnage + User Swap Relies on Solana Runtime Serialization
**Choice:** No application-level locking between Carnage execution and user swaps. Both write to the same pool accounts, and Solana's runtime automatically serializes transactions that touch the same writable accounts within a slot.
**Rationale:** Verified that both paths share mutable pool state, pool vaults, and the Carnage SOL vault. Solana's account-level write locks handle ordering. Slippage floors (50% user, 75% Carnage fallback) protect against compounding price impact. Adding explicit locks would create deadlock risk with no safety benefit.
**Affects docs:** [security-model, error-handling-playbook]

### D6: Staking Epoch Race Condition Is Non-Existent
**Choice:** No additional guards needed for stake/unstake during epoch transitions.
**Rationale:** Stake/unstake never read epoch state — yield calculation uses the checkpoint pattern (`rewards_per_token_stored` cumulative, monotonically increasing). Users' checkpoints are frozen at their last interaction. The `update_cumulative` instruction uses epoch numbers only as anti-replay, not for yield math. Plus the dead stake (1 PROFIT at init) ensures `total_staked > 0` always.
**Affects docs:** [security-model, error-handling-playbook]

### D7: Pool Draining Protected by Constant-Product Invariant
**Choice:** No minimum reserve threshold needed. The CPMM formula and k-invariant check are sufficient.
**Rationale:** `output = reserve_out * input / (reserve_in + input)` — output can mathematically never equal reserve_out. The `verify_k_invariant` check (`k_after >= k_before`) rejects any swap that would drain a pool. Proptest validates "output never exceeds reserve_out" over 10,000 iterations. `ZeroSwapOutput` catches dust attacks at the boundary.
**Affects docs:** [security-model, liquidity-slippage-analysis]

### D8: Document Carnage Empty-Vault as Expected Behavior
**Choice:** The Error Handling Playbook should explicitly document that Carnage executing with an empty SOL vault is a graceful no-op, not a failure. `execute_buy_swap` and `execute_sell_swap` both return `Ok(())` when amount = 0.
**Rationale:** State still updates (target switches, triggers increment), and the system self-corrects as tax fees refill the vault. The defined-but-unused `InsufficientCarnageSol` error confirms the design intent was graceful degradation. Operators need to know this is expected — otherwise empty Carnage logs look like bugs.
**Affects docs:** [error-handling-playbook, operational-runbook, oracle-failure-playbook]

### D9: Document Crank Catch-Up Procedure for Extended Downtime
**Choice:** The Operational Runbook should include a "recovering from extended downtime" section covering: permissionless epoch advancement, sequential VRF flow (3 TX per epoch), staking reward accumulation during downtime, Carnage deadline auto-expiry, and estimated recovery costs.
**Rationale:** The code handles everything gracefully — rewards accumulate in `pending_rewards`, Carnage deadlines auto-expire after 300 slots, epoch math is slot-based with no time-dependent breaks. But an operator needs to understand that catching up 100 missed epochs requires ~300 transactions and that staking yield is delayed (not lost) until catch-up completes.
**Affects docs:** [operational-runbook, error-handling-playbook, oracle-failure-playbook]

## Open Questions
None — all edge cases investigated and resolved.

## Raw Notes
- 94 total error variants across 6 programs (AMM: 18, Tax: 19, Staking: 11, Hook: 14, Epoch: 29, Stub: 3)
- All use Anchor auto-assignment starting at 6000, disambiguated by program ID client-side
- Tax rounding: treasury absorbs remainder via `total_tax - floor(75%) - floor(24%)`, guaranteed invariant
- Cumulative reward overflow: u128 with 35x headroom over 10-year worst case, checked arithmetic throughout
- Compute budget: heaviest path is swap_sol_sell(FRAUD) at 122,586 CU (61% of 200K default), no scaling risks
- FRAUD token consistently uses ~24K more CU than CRIME — assessed as test environment artifact (account creation order, validator cache state). Both tokens have identical hook configurations. Flagged for devnet remeasurement in Compute_Budget_Profile.md
