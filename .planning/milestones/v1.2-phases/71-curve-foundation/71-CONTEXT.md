# Phase 71: Curve Foundation - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the 7th on-chain program: a standalone Anchor bonding curve program where users can buy tokens on two independent linear curves (CRIME + FRAUD) with deterministic pricing, per-wallet caps, and mathematically proven correctness via property testing. This phase covers program scaffold, curve math (buy only), state accounts, and comprehensive testing. Sell-back (Phase 72), graduation/refund (Phase 73), and protocol integration (Phase 74) are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Program Structure
- Standalone Anchor program (7th program, own program ID, own deploy/upgrade authority)
- Directory: `programs/bonding_curve/`
- Curve math (linear integral, quadratic solver, integer sqrt) is private to the bonding curve program in `math.rs` — no shared crate
- Rationale: No other program needs this math; extractable later if ever needed, avoids cross-crate build complexity

### Precision & Scaling
- Token decimals: 6 (matching existing CRIME/FRAUD mints)
- PRECISION constant: 1e12 (as specced in Bonding_Curve_Spec.md Section 4.4), validated by property tests for no u128 overflow
- Integer sqrt: Rust stdlib `u128::isqrt()` (Karatsuba algorithm, stabilized Rust 1.84.0, available on SBF platform-tools v1.51/rustc 1.84.1). Originally planned hand-rolled Newton's method but stdlib is strictly superior — proven correct, zero maintenance, const fn. Confirmed available on our build target.
- Rounding: Protocol-favored — `floor()` on tokens_out, `ceil()` on SOL calculations. Users get slightly fewer tokens per buy (negligible: ~0.000001 tokens/buy). Vault always has slightly MORE than expected, guaranteeing solvency.

### Initialization Flow
- Admin-only: Only the protocol admin keypair can initialize curves (matches existing pattern)
- Single instruction creates both CurveState PDAs (CRIME + FRAUD) atomically — both exist or neither
- If account limits are too tight (~13-14 accounts), fall back to "create curves" + "fund curves" as two instructions
- 48-hour deadline starts on initialization (deadline_slot set at init time)
- Token funding: Admin pre-mints tokens, then transfers 460M to each curve's token vault during init (matches existing initialize.ts pattern)

### Property Testing Scope
- **Frameworks:** Proptest + LiteSVM + Kani — no limit on testing rigor, safety is paramount
  - Proptest: Pure math property tests (integral correctness, no overflow, precision bounds)
  - LiteSVM: On-chain instruction-level property tests (random buy sequences, vault solvency across operations)
  - Kani: Formal verification of math functions where applicable (bounded model checking for overflow/underflow)
- **Iterations:** 500K Proptest iterations minimum — CI speed is secondary to correctness
- **Precision loss invariant:** `actual_tokens_out <= mathematical_exact_tokens_out` AND `mathematical_exact_tokens_out - actual_tokens_out <= MAX_PRECISION_LOSS` (bounded, protocol-favored)
- **Edge cases (exhaustive):**
  - Dust buys (1 lamport SOL input)
  - Max buys (filling entire 460M curve in one purchase)
  - Boundary buys (exactly reaching 460M — no leftover, no overflow)
  - Wallet cap enforcement (buying exactly at 20M cap, attempting to exceed)
  - Repeated tiny buys to accumulate rounding errors (100K micro-buys on same curve)
  - Zero-amount buys (must reject)
  - Two users racing to fill last tokens (concurrent fills)
  - Overflow probing: max u64 SOL input, max u128 intermediate values
- **Key invariants to prove:**
  - Vault solvency: `vault_token_balance >= TOTAL_FOR_SALE - tokens_sold` at all times
  - SOL conservation: `sol_vault_balance >= integral(0, tokens_sold)` at all times
  - Monotonic pricing: more tokens sold = higher price per token
  - Cap enforcement: no wallet can hold > 20M tokens per curve
  - No overflow: all intermediate u128 calculations stay within bounds for any valid input

### Claude's Discretion
- BPF compute budget optimization (CU limits)
- Error code numbering and message text
- Test file organization (single file vs split by concern)
- Whether to use `Box<>` for large account structs (depends on stack analysis during implementation)

</decisions>

<specifics>
## Specific Ideas

- Security is the #1 priority — "there is no such thing as not enough safety/security"
- Use percentage-based derivation in Proptest strategies (not prop_assume!) to avoid >50% rejection rates (learned from staking tests)
- The spec (Bonding_Curve_Spec.md) is the single source of truth for all math — implementation must match Section 4.1-4.4 exactly
- Admin transfer pattern for vault funding matches the existing initialize.ts flow — extend, don't reinvent

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 71-curve-foundation*
*Context gathered: 2026-03-03*
