# Phase 72: Sell-Back + Tax Escrow - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the sell instruction for the bonding curve program: users sell tokens back to the curve, receive SOL minus 15% tax routed to a separate escrow PDA. Sells disabled when Filled. SOL vault solvency invariant holds across all buy/sell sequences. Property tests verify correctness at 1M+ iterations with multi-user scenarios.

This phase adds the sell instruction and tax escrow transfer logic to the existing bonding curve program (built in Phase 71). Graduation, refund, protocol integration, and frontend are out of scope (Phases 73-75).

</domain>

<decisions>
## Implementation Decisions

### Sell Rounding & Tax Precision
- **Reuse existing `calculate_sol_for_tokens` (ceil rounding) for reverse integral** -- same function for buy cost and sell return. One codebase, one proof. The spec explicitly says "the sell uses the same linear integral as the buy formula" (Section 4.5). 15% tax makes the ~1 lamport rounding difference irrelevant for solvency.
- **Tax rounds up (ceil):** `tax = (SOL_gross * SELL_TAX_BPS + (BPS_DENOMINATOR - 1)) / BPS_DENOMINATOR`. Protocol-favored on both the integral and the tax deduction.
- **Net = gross - ceil_tax:** Simple subtraction. Max 1 lamport variance absorbed by the 15% buffer.
- **SELL_TAX_BPS = 1500** named constant in constants.rs (already exists). Basis points pattern, self-documenting, referenced by property tests.

### On-Chain Solvency Defense
- **Runtime solvency assertion after every sell** -- `require!(sol_vault.lamports() >= expected_from_integral)`. If the math has a bug, the sell reverts rather than draining the vault. Defense-in-depth.
- **Claude's Discretion:** Whether the solvency formula accounts for rent-exempt minimum, and whether buys also get a solvency check (buys monotonically increase vault, so checking is redundant but harmless).
- **Claude's Discretion:** Error variant for solvency violation (dedicated `VaultInsolvency` vs reuse existing error).

### Property Testing Scope
- **1M+ iterations minimum** for buy/sell mixed sequence property tests. If best practices warrant more, do more. Security > time and effort.
- **All Phase 71 invariants preserved** (no overflow, monotonic pricing, vault solvency, cap enforcement) PLUS complete sell-specific invariant set:
  - Round-trip loss: buy then sell returns <= original SOL minus 15% tax
  - Vault solvency across mixed buy/sell sequences
  - Tax escrow accumulation correctness (sum of all sell taxes)
  - tokens_sold decreases correctly on sell
  - tokens_returned cumulative counter accuracy
  - No profitable round-trips regardless of curve position
  - Cap enforcement through sell/rebuy cycles
- **Both single-user and multi-user tests:** Single-user for pure math properties, multi-user (2-5 wallets) for integration-level interleaving scenarios.
- **Best tool for each situation:** Kani for provable bounds (reverse integral no-overflow, tax calculation bounds), Proptest for fuzz coverage at 1M+ iterations, LiteSVM for on-chain integration with real accounts and transfers. Use both when applicable.

### Sell Edge-Case Behavior
- **No minimum sell amount** -- if someone wants to sell 1 token, let them. Gas cost alone deters dust sells.
- **No special handling for full balance sells** -- participant_count stays unchanged (it represents "wallets that ever bought," not "current holders"). Not modified on sells.
- **Claude's Discretion:** How to handle sells that would reduce vault below rent-exempt minimum (reject vs cap output at available amount).

</decisions>

<specifics>
## Specific Ideas

- Security is the #1 priority -- "there is no such thing as not enough safety/security"
- The spec (Bonding_Curve_Spec.md Section 4.5, 8.6) is the single source of truth for sell mechanics -- implementation must match exactly
- Existing `calculate_sol_for_tokens` already documents itself as the reverse integral for sells (line 125-127 of math.rs)
- CurveState already has all sell-related fields: `tokens_returned`, `sol_returned`, `tax_collected`, `tax_escrow` (Pubkey)
- All error codes for sell already defined in error.rs: `CurveNotActiveForSell`, `InsufficientTokenBalance`, `ZeroAmount`, `SlippageExceeded`
- SELL_TAX_BPS and BPS_DENOMINATOR already exist in constants.rs
- Transfer Hook handling for sell (tokens from user wallet to curve token vault) must follow the same manual `invoke_signed` pattern as purchase instruction (remaining_accounts for Transfer Hook)
- MIN_PURCHASE_SOL (0.05 SOL) stays for buys -- user noted it was in spec but hadn't been explicitly discussed; leaving it for now

</specifics>

<deferred>
## Deferred Ideas

- Review MIN_PURCHASE_SOL necessity -- user questioned why a minimum buy exists. Currently specced (Section 6.2) and implemented. Revisit in a future polish phase.

</deferred>

---

*Phase: 72-sell-back-tax-escrow*
*Context gathered: 2026-03-04*
