# Phase 81: Compile-Time Guards - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Build fails at compile time when mainnet placeholder pubkeys or devnet-only features are misconfigured. Three requirements (CTG-01, CTG-02, CTG-03) across Tax, Bonding Curve, Conversion Vault, and Epoch programs. No new features — purely build-time safety gates.

</domain>

<decisions>
## Implementation Decisions

### Mainnet Placeholder Guards (CTG-01)
- Replace `Pubkey::default()` returns with `compile_error!()` on the mainnet path (`#[cfg(not(any(feature = "devnet", feature = "localnet")))]`)
- Affected programs and functions:
  - **Tax Program:** `treasury_pubkey()`
  - **Bonding Curve:** `crime_mint()`, `fraud_mint()`, `epoch_program_id()`
  - **Conversion Vault:** `crime_mint()`, `fraud_mint()`, `profit_mint()`
- `compile_error!()` message should clearly state what's missing (e.g., "Set mainnet CRIME mint address before building for mainnet")
- Localnet paths (`Pubkey::default()`) are NOT guarded — localnet legitimately uses runtime-generated addresses

### Feature Tier Alignment (CTG-01 prerequisite)
- **Align Conv. Vault and Tax Program to 3-tier** feature system (devnet / localnet / mainnet) matching Bonding Curve's existing pattern
- Conv. Vault currently 2-tier (devnet / not-devnet) — add localnet paths returning `Pubkey::default()`
- Tax Program `treasury_pubkey()` currently 2-tier — add localnet path returning `Pubkey::default()`
- After alignment, all three programs have consistent feature gating: devnet (real addresses), localnet (Pubkey::default), mainnet (compile_error!)

### force_carnage Gating (CTG-02)
- Existing `#[cfg(feature = "devnet")]` triple-gate (module, re-export, instruction) is ALREADY the compile-time guard — it's satisfied
- force_carnage literally doesn't exist in non-devnet builds — no compile_error!() needed (you can't call what doesn't exist)
- **Add IDL verification test:** Rust unit test in epoch-program that confirms force_carnage is excluded from non-devnet builds (regression safety)
- Test checks the generated instruction list or IDL JSON doesn't contain force_carnage when built without devnet feature

### Bonding Curve Const Assertions (CTG-03)
- Add grouped const assertions block at bottom of bonding_curve/src/constants.rs
- Required assertions:
  - `P_END > P_START` (curve goes up, not down)
  - `TOTAL_FOR_SALE > 0` (non-zero supply)
  - `TARGET_TOKENS == TOTAL_FOR_SALE as u64` (u128 and u64 versions match)
- Bonding Curve only — Tax/Staking/AMM BPS constants are well-established, no need to expand scope
- Pattern: `const _: () = assert!(...)` (same as Phase 80 DEF-08 struct layout assertions)

### Claude's Discretion
- Exact compile_error!() message wording for each placeholder
- How to structure the IDL verification test (parse JSON vs check instruction enum)
- Whether localnet paths for Conv. Vault and Tax need any specific address or just Pubkey::default()
- Test structure for const assertions (unit test that exercises the constants, or just the const assert)

</decisions>

<specifics>
## Specific Ideas

- Phase 80 established `const _: () = assert!(...)` pattern for struct sizes — reuse same pattern for curve math
- Existing 3-tier feature system in BC is the template for Conv. Vault and Tax alignment
- IDL verification test is a regression check — catches accidental cfg gate removal, not testing the Rust compiler

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- Bonding Curve `constants.rs`: Already has 3-tier `#[cfg]` pattern (devnet/localnet/mainnet) — template for Conv. Vault and Tax
- Phase 80's `const _: () = assert!(std::mem::size_of::<EpochState>() == EXPECTED_SIZE)` — same pattern for curve math assertions
- Epoch Program `instructions/mod.rs` lines 7-8, 18-19: Reference `#[cfg(feature = "devnet")]` triple-gate implementation

### Established Patterns
- `#[cfg(feature = "devnet")]` / `#[cfg(feature = "localnet")]` / `#[cfg(not(any(...)))]` for 3-tier feature gating
- `compile_error!("message")` macro for build-time failure with descriptive message
- `const _: () = assert!(expr)` for zero-cost compile-time validation

### Integration Points
- Tax Program `constants.rs` line 140: `treasury_pubkey()` not-devnet path → compile_error!()
- Bonding Curve `constants.rs` lines 135-139, 152-155, 176-180: Three mainnet placeholder functions → compile_error!()
- Conversion Vault `constants.rs` lines 31-34, 42-44, 52-54: Three not-devnet functions → add localnet tier + compile_error!()
- Bonding Curve `constants.rs` bottom: New const assertions block
- Epoch Program tests: New IDL verification test

</code_context>

<deferred>
## Deferred Ideas

- Cross-program BPS const assertions (Tax, Staking, AMM) — constants are stable, not needed now
- Enforcement limit assertions (MAX_TOKENS_PER_WALLET < TARGET_TOKENS, MIN_PURCHASE_SOL > 0) — nice-to-have but not in scope
- Removing localnet feature tier entirely (consolidating to 2-tier) — would simplify but break local testing

</deferred>

---

*Phase: 81-compile-time-guards*
*Context gathered: 2026-03-08*
