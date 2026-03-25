# Phase 80: Defense-in-Depth - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

All cross-program byte reads are ownership-verified, all u128-to-u64 casts are checked, and struct layout stability is enforced. 8 defensive fixes (DEF-01 through DEF-08) across 5 programs. No new features or capabilities — purely hardening existing code paths.

</domain>

<decisions>
## Implementation Decisions

### Reserved Padding (DEF-03)
- 64 bytes of reserved padding added to EpochState (`pub reserved: [u8; 64]`)
- Tax Program's EpochState mirror struct also gets matching 64-byte padding (must stay in sync)
- EpochState only — no other program state structs get padding (PoolState, StakePool, CurveState, AdminConfig are stable enough)
- Requires devnet redeploy (acceptable — v1.4 does full fresh deploy anyway)

### is_reversed Scope (DEF-02)
- Tax Program `pool_reader.rs` only — epoch_program inline pool readers wait for Phase 82 Carnage Refactor (code will be rewritten/deleted)
- Detection method: read pool bytes [9..41] for mint_a Pubkey, compare against NATIVE_MINT (SOL)
- If mint_a == NATIVE_MINT, reserves are (SOL, token) — no reversal needed
- If mint_a != NATIVE_MINT, reserves are reversed — swap them before returning
- SOL mint comparison chosen because Tax Program only reads SOL pools

### remaining_accounts Validation (DEF-05)
- Count check only: `require!(ctx.remaining_accounts.len() == 4, CurveError::InvalidHookAccounts)`
- Expected count = 4 (one transfer hook invocation = extra_account_meta_list, wl_source, wl_dest, hook_program)
- Applied to BOTH purchase.rs AND sell.rs (same pattern, same risk)
- No owner/PDA derivation checks — transfer hook itself validates those, count check catches most mistakes with zero CU overhead

### Error Philosophy (DEF-01 through DEF-08)
- ALL checks are hard errors — no silent degradation, no fallbacks, no skips
- Wrong pool owner (DEF-01, DEF-06)? Error. Bad cast (DEF-04)? Error. Wrong hook count (DEF-05)? Error. Invalid cheap_side (DEF-07)? Error.
- These are invariants that should NEVER be violated in normal operation — silent degradation could mask bugs
- Consistent with Phase 79's "bugs should surface as errors, not be hidden" decision

### u128-to-u64 Cast Style (DEF-04)
- Use idiomatic `u64::try_from(value).map_err(|_| error!(MathOverflow))?` pattern
- Replaces all `value as u64` truncating casts in staking, tax, and AMM math
- No manual bounds checks — try_from handles this internally

### Layout Validation (DEF-08)
- Compile-time const assertion: `const _: () = assert!(std::mem::size_of::<EpochState>() == EXPECTED_SIZE);`
- Applied to both EpochState (epoch_program) and mirror struct (tax_program)
- `#[repr(C)]` added to both structs for layout determinism
- Zero runtime cost — fails at build time if layout drifts

### Claude's Discretion
- Exact error variant names and messages for new errors (InvalidPoolOwner, MathOverflow, InvalidHookAccounts, InvalidCheapSide, etc.)
- Whether to add #[repr(C)] to both structs or just add compile-time size assertion
- Test structure for each requirement (unit vs integration)
- Exact byte offset for NATIVE_MINT comparison in pool_reader.rs

</decisions>

<specifics>
## Specific Ideas

- HOOK_ACCOUNTS_PER_MINT = 4 is an established constant (Phase 47 Carnage hardening) — reuse or reference it
- NATIVE_MINT comparison is safe because SOL mint (0x06...) is always lowest in canonical ordering (confirmed in Phase 52.1 memory)
- Phase 52.1's `is_reversed` fix in epoch_program is the pattern to port to Tax Program pool_reader

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pool_reader.rs` (tax-program/src/helpers/): Existing pool byte reader at offsets [137..145] and [145..153] — add owner check + is_reversed here
- `HOOK_ACCOUNTS_PER_MINT = 4` constant: Already defined, can be referenced for count validation
- `Token::from_u8_unchecked` in epoch-program/src/state/enums.rs: Replace with checked version + error
- Phase 52.1 `is_reversed` pattern in epoch_program execute_carnage.rs: Reference implementation to port

### Established Patterns
- CEI (Checks-Effects-Interactions) ordering — new checks go in Checks section
- `require!()` macro for constraint validation with descriptive error variants
- `#[account]` macro for Anchor state structs — adding `#[repr(C)]` alongside is compatible

### Integration Points
- Tax Program pool_reader.rs: Owner check + is_reversed (DEF-01, DEF-02)
- Staking math.rs: try_from casts (DEF-04)
- Tax Program tax_math.rs: try_from casts (DEF-04)
- AMM math.rs: try_from casts (DEF-04)
- Epoch Program epoch_state.rs: Reserved padding + #[repr(C)] (DEF-03, DEF-08)
- Tax Program epoch_state_reader.rs: Matching padding + #[repr(C)] + size assert (DEF-03, DEF-08)
- Bonding Curve purchase.rs + sell.rs: remaining_accounts count check (DEF-05)
- Epoch Program execute_carnage.rs + execute_carnage_atomic.rs: Pool owner constraint (DEF-06)
- Epoch Program consume_randomness.rs: Checked Token conversion (DEF-07)

</code_context>

<deferred>
## Deferred Ideas

- is_reversed for epoch_program inline pool readers — Phase 82 Carnage Refactor will rewrite these
- Reserved padding for other state structs (PoolState, StakePool, CurveState) — design is stable enough, not needed
- PDA derivation validation for remaining_accounts — transfer hook already validates, count check is sufficient

</deferred>

---

*Phase: 80-defense-in-depth*
*Context gathered: 2026-03-08*
