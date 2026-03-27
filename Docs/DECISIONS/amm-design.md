---
topic: "AMM Design"
topic_slug: "amm-design"
status: complete
interview_date: 2026-02-20
decisions_count: 8
provides: ["amm-design-decisions"]
requires: ["architecture-decisions", "token-model-decisions", "cpi-architecture-decisions"]
verification_items: []
---

# AMM Design — Decisions

## Summary
The AMM is a heavily modified fork of `arrayappy/solana-uniswap-v2` that retains only the constant-product formula and PDA-owned vault concept. All liquidity management (LP tokens, add/remove liquidity), flash loans, TWAP, router, and governance were stripped. Token-2022 transfer hook support, PDA-gated access control, and Carnage swap_exempt were added. The AMM is deliberately tax-agnostic — a pure swap primitive that knows nothing about epochs, taxes, or yield. The AMM now manages 2 SOL pools only (CRIME/SOL, FRAUD/SOL) — PROFIT pools have been replaced by a fixed-rate conversion vault. See [DBS-base-profit-redesign.md](../DBS-base-profit-redesign.md).

## Decisions

### D1: Tax-Agnostic AMM — Pure Swap Primitive
**Choice:** The AMM contains zero knowledge of epochs, tax regimes, Carnage, or yield distribution. All economic complexity lives in the Tax Program, which wraps AMM swaps via CPI.
**Rationale:** Separation of concerns for auditability. AMMs are complex enough on their own — keeping the swap math isolated means it can be verified against standard Uniswap V2 behavior without understanding the protocol's tax logic. The CPI cost (~25K compute units per hop) is negligible relative to the security benefit of an independently auditable swap engine.
**Alternatives considered:** Embedding tax awareness in AMM (rejected — couples two complex systems, makes AMM harder to audit, any tax rule change requires re-auditing swap math).
**Affects docs:** [architecture, cpi-interface-contract, token-economics-model]

### D2: Fork of arrayappy/solana-uniswap-v2
**Choice:** Forked from `arrayappy/solana-uniswap-v2` (Apache-2.0). Minimal Uniswap V2-style design in Anchor with clean PDA patterns.
**Rationale:** Small, auditable codebase. Constant-product AMM is well-understood and battle-tested. Starting from a working Anchor implementation saved significant development time vs building from scratch. The fork was then substantially modified to support Token-2022, access control, and protocol-specific requirements.
**What was kept:** Constant-product formula (k = x * y), PDA-owned vaults, basic swap flow structure.
**What was removed:** LP token minting, add/remove liquidity instructions, flash loans, Factory pattern, TWAP oracle, router/multi-hop, governance, configurable fees.
**What was added:** Token-2022 + transfer hook support, dual-hook pattern for PROFIT pools [Historical — PROFIT pools removed, see D7 note], PDA-gated access control (Tax Program only), reentrancy guard, AdminConfig singleton, PoolType enum, property-tested math module, rich events (12-field SwapEvent), Carnage swap_exempt support.
**Affects docs:** [architecture, project-overview, security-model]

### D3: Fixed LP Fee Tiers — Directional Incentive
**Choice:** SOL pools: 1% (100 bps). Set at initialization, immutable.
**[Historical]** PROFIT pools originally had 0.5% (50 bps) LP fee. PROFIT AMM pools have been removed and replaced by a fixed-rate conversion vault with 0% fee. AMM now manages 2 SOL pools only (CRIME/SOL, FRAUD/SOL). See [DBS-base-profit-redesign.md](../DBS-base-profit-redesign.md).
**Rationale:** SOL pool fees are the primary entry/exit cost and the LP fee compounds into permanent liquidity depth. The conversion vault's zero-fee design further incentivises the CRIME<>FRAUD arbitrage path, which is the core peg mechanism.
**Alternatives considered:** No other fee levels were seriously evaluated. Adjustable fees were rejected — immutability post-burn means no governance overhead.
**Affects docs:** [token-economics-model, liquidity-slippage-analysis]

### D4: LP Fees Compound Into Reserves Permanently
**Choice:** LP fees are retained in SOL pool reserves. No fee extraction, no protocol fee split at the AMM level. Fees make pools deeper over time.
**[Historical]** This originally applied to all four pools (2 SOL + 2 PROFIT). PROFIT AMM pools have been removed — replaced by a fixed-rate conversion vault with zero fees. This decision now applies to the 2 SOL pools only (CRIME/SOL, FRAUD/SOL).
**Rationale:** With permanent protocol-owned liquidity and no LP tokens, there's no one to distribute AMM-level fees to. The fee simply stays in the pool, increasing reserves and reducing slippage for future swaps. This is a monotonically improving property — pools only get deeper, never shallower.
**Affects docs:** [token-economics-model, liquidity-slippage-analysis, project-overview]

### D5: No Flash Loans, No TWAP — Emergent MEV Resistance
**Choice:** Flash loans not implemented. No on-chain TWAP oracle. Price data derived off-chain from SwapEvent indexing.
**Rationale:** Neither feature was needed for the protocol's operation. However, their absence provides emergent MEV resistance: no flash loans means sandwich attackers can't borrow to amplify attacks, and no on-chain oracle means no oracle manipulation attacks. Additionally, asymmetric taxes make sandwich attacks expensive (attacker pays tax on both legs). This is a happy side effect of simplicity, not a deliberate MEV mitigation strategy.
**Alternatives considered:** Adding TWAP for on-chain price reference (rejected — no on-chain consumer needs it; off-chain indexing via events is more flexible).
**Affects docs:** [security-model, token-economics-model]

### D6: Reentrancy Guard as Defense-in-Depth
**Choice:** PoolState has a `locked: bool` field. Set to true at swap start, cleared at end. The guard can never actually trigger given the acyclic CPI graph (Transfer Hook is terminal, no program CPIs back upstream).
**Rationale:** Defense-in-depth. The reentrancy guard is conventional for AMMs and costs negligible compute. Even though reentrancy is structurally impossible in the current CPI topology, the guard protects against theoretical future changes (though post-burn, no changes are possible).
**Alternatives considered:** No guard (rejected — cheap insurance, conventional for AMMs).
**Affects docs:** [security-model, cpi-interface-contract]

### D7: Pool Seeding — Full Bonding Curve Proceeds
**Choice:** Each SOL pool is seeded with the full 1,000 SOL raised by its corresponding bonding curve. 290M tokens (29% of 1B supply) per IP token go to SOL pool seeding. The remaining 250M per IP token (25%) is pre-loaded into the conversion vault as cross-conversion buffer. The conversion vault also holds the full 20M PROFIT supply.
**[Historical]** Originally "540M tokens (54% of 1B supply) per IP token" for SOL pool seeding and "25M PROFIT each (50% of 50M)" for PROFIT pools. The vault migration changed the token allocation: 46% bonding curve, 29% SOL pool, 25% vault. PROFIT pools no longer exist.
**Rationale:** Using the full bonding curve proceeds creates price continuity — the ending bonding curve price matches the starting LP price. No SOL is held back from the pools. This maximises initial liquidity depth and provides the strongest possible launch for trading.
**Affects docs:** [token-economics-model, deployment-sequence, liquidity-slippage-analysis]

### D8: Property-Tested Swap Math
**Choice:** Swap math lives in a pure `helpers/math.rs` module with zero Anchor imports. Five functions: `calculate_effective_input`, `calculate_swap_output`, `verify_k_invariant`, `check_effective_input_nonzero`, `check_swap_output_nonzero`. All use u128 intermediate math with checked arithmetic. Tested with 22 unit tests + 3 proptest properties (30,000 iterations).
**Rationale:** Pure functions with no state dependencies are the easiest code to formally verify. Property testing (k-invariant preservation, output bounds, fee monotonicity) provides stronger guarantees than example-based testing alone. The zero-Anchor-import boundary means math can be tested without a Solana runtime.
**Affects docs:** [security-model, cpi-interface-contract, architecture]

## Open Questions
(None — all AMM design decisions are firm.)

## Raw Notes
- The AMM program is ~1,200 LOC including tests. The original fork was significantly smaller.
- PoolState is 223 bytes (INIT_SPACE) vs the 157 bytes noted in the spec — the difference is vault bumps, token program pubkeys, and the reentrancy lock field.
- [Historical] The dual-hook ordering for PROFIT pools ([INPUT hooks, OUTPUT hooks] not [side A, side B]) was a hard-won lesson that caused Transfer Hook error 3005 until corrected. PROFIT pools have since been replaced by the conversion vault, but this lesson remains relevant for any future dual-hook AMM designs.
- Mock Tax Program and Fake Tax Program exist as test support programs for access control verification — 12 dedicated CPI access control tests ensure only the real Tax Program can invoke swaps.
- Carnage's swap_exempt path through the AMM has no minimum_output parameter — it executes at market price because Carnage is protocol-internal rebalancing, not user-facing.
