# Phase 106: Vault Convert-All - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can convert their full token balance in a single transaction without intermediate token leakage or wallet security warnings. Adds `convert_v2` instruction with sentinel value (amount_in=0) for on-chain balance reading and minimum_output slippage protection. Existing `convert` instruction stays unchanged. All 6 multi-hop routes (SOL<->PROFIT via CRIME/FRAUD, both split and 2-hop) must simulate cleanly in wallet previews.

Detailed proposal: Docs/vault-convert-all-proposal.md

</domain>

<decisions>
## Implementation Decisions

### Instruction Strategy
- **New `convert_v2` instruction** added alongside existing `convert` (not modifying `convert` in-place)
- Old `convert` stays unchanged forever — no deprecation log, no modifications
- Future phase will remove `convert` once all callers migrated
- `convert_v2` **reuses the existing `Convert<'info>` accounts struct** — no new struct needed
- `convert_v2` signature: `convert_v2(amount_in: u64, minimum_output: u64)`
- `amount_in == 0` → sentinel for "read user's on-chain balance" (convert-all mode)
- `amount_in > 0` → exact amount (same as old convert behavior + slippage guard)

### Safety Guards
- **Owner check**: `convert_v2` validates `user_input_account.owner == user.key()` — explicit check, new `VaultError::InvalidOwner` error
- **minimum_output enforced in ALL directions** — even deterministic PROFIT->faction. Uniform behavior, simpler client code
- **minimum_output=0 allowed** — effectively disables slippage check (compute_output already prevents zero-output via OutputTooSmall)
- **Emit log in convert-all mode**: `msg!("convert_v2: effective_amount={}, output={}", effective_amount, amount_out)` for debugging and indexing

### Client Integration
- **ALL client paths switch to convert_v2** — direct converts AND multi-hop both use convert_v2
- Direct converts: `convert_v2(exact_amount, exact_expected_output)` — exact minimum, no tolerance
- Multi-hop intermediate steps: `convert_v2(0, minimum_derived_from_amm_min)` — convert-all mode
- Multi-hop minimum_output: derive from AMM step's minimumOutput, apply vault rate (÷100 or ×100). Tightest safe floor.

### Deployment Sequencing
- **Devnet: upgrade existing live deploy** (don't fresh deploy — mirrors real mainnet upgrade path)
- **Devnet: direct deployer wallet** (not Squads — already proved Squads works in Phase 97)
- **Mainnet: program first, client later** — zero-downtime since convert_v2 is additive. Old convert keeps working during the gap.
- **Crank keeps running during mainnet upgrade** — crank has zero interaction with conversion vault
- Squads 2-of-3 with 1hr timelock for mainnet program upgrade

### Testing & Verification (Mainnet-Grade)
- **SOS re-audit: diff-only** — audit convert_v2.rs, error.rs changes, lib.rs registration. Cross-reference with existing convert.rs
- **BOK: extend existing bok_proptest_vault.rs** — add convert_v2 property tests alongside existing convert tests
- **BOK properties to test**: effective_amount == balance when amount_in=0, minimum_output enforcement, owner check, edge cases, convert_v2(exact) == convert(exact) equivalence
- **Wallet simulation: manual devnet test matrix** — all 6 affected routes at multiple sizes (0.05, 4, 40 SOL) in Phantom AND Backpack. Screenshot wallet previews. Verify no intermediate token leakage, no Blowfish warnings.
- **Mainnet smoke test after upgrade**: small multi-hop (0.05 SOL), medium multi-hop (1-2 SOL), reverse direction, direct convert regression — in Phantom

### Claude's Discretion
- Exact file organization for convert_v2 handler (same file vs separate convert_v2.rs)
- LiteSVM test structure and helper reuse
- Anchor instruction attribute patterns
- Error message wording for new error variants

</decisions>

<specifics>
## Specific Ideas

- "Now we are on mainnet not a single stone gets left unturned prior to making the mainnet upgrade"
- User wants BOK proptest, SOS audit, and full wallet simulation before ANY mainnet upgrade
- Upgrading existing devnet deploy (not fresh deploy) to mirror mainnet upgrade path
- Proposal doc (Docs/vault-convert-all-proposal.md) has detailed edge case table (Section 7) and test plan (Section 8)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Convert<'info>` struct (programs/conversion-vault/src/instructions/convert.rs:10-54): Reuse directly for convert_v2
- `compute_output` / `compute_output_with_mints` (convert.rs:60-114): Core math shared between convert and convert_v2
- `helpers::hook_helper::transfer_t22_checked`: Transfer helper used by both convert and convert_v2
- `bok_proptest_vault.rs`: Existing proptest suite to extend with convert_v2 properties
- `test_vault.rs` / `test_edge_cases.rs`: Existing test files with LiteSVM infrastructure

### Established Patterns
- Localnet/production feature flag split: `#[cfg(feature = "localnet")]` for mint address resolution
- Hook accounts split at midpoint: `remaining.split_at(mid)` for input/output hooks
- PDA signing: `vault_config.bump` with `VAULT_CONFIG_SEED`
- Token-2022 transfers via `transfer_t22_checked` with hook passthrough

### Integration Points
- `app/lib/swap/multi-hop-builder.ts`: Must update vault step construction to pass amount_in=0 + minimum_output
- `app/lib/swap/swap-builders.ts`: `buildVaultConvertTransaction` gains minimum_output param, switches to convert_v2
- `programs/conversion-vault/src/lib.rs`: Register new `convert_v2` instruction
- `programs/conversion-vault/src/error.rs`: Add `SlippageExceeded` and `InvalidOwner` error variants

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 106-vault-convert-all*
*Context gathered: 2026-03-26*
