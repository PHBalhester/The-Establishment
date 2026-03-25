# Verification: HIGH-003 (H036) - Init Front-Running: Staking + Carnage Fund

**Original Severity:** HIGH (NEW)

**Verification Status:** FIXED (with note on mint validation)

## Changes Found

### Staking: `programs/staking/src/instructions/initialize_stake_pool.rs` (lines 88-98)

ProgramData upgrade-authority gate added:

- `program: Program<'info, crate::program::Staking>` with `programdata_address()` constraint (line 89-92)
- `program_data: Account<'info, ProgramData>` with `upgrade_authority_address == Some(authority.key())` constraint (lines 95-98)

### Carnage Fund: `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` (lines 129-139)

ProgramData upgrade-authority gate added:

- `program: Program<'info, crate::program::EpochProgram>` with `programdata_address()` constraint (lines 130-133)
- `program_data: Account<'info, ProgramData>` with `upgrade_authority_address == Some(authority.key())` constraint (lines 136-138)

### Mint Validation

The original finding recommended "mint validation constraints" in addition to ProgramData gating.

- **Staking:** `profit_mint` is accepted as `InterfaceAccount<'info, Mint>` with no hardcoded address constraint. However, since the ProgramData authority gate restricts initialization to the deployer, a wrong-mint attack is no longer possible via front-running. The deployer is trusted to pass the correct mint.
- **Carnage Fund:** `crime_mint` and `fraud_mint` are similarly accepted without hardcoded address constraints.
- **Contrast with Conversion Vault:** The Vault program does hardcode mint addresses via `constants::crime_mint()`, `constants::fraud_mint()`, `constants::profit_mint()` with compile-time feature-gated constraints. This is a defense-in-depth measure that Staking and Epoch do not replicate.

**Assessment:** The primary vulnerability (front-running by unauthorized parties) is fully fixed. The lack of hardcoded mint validation is a minor defense-in-depth gap -- the deployer (upgrade authority) is inherently trusted, so passing a wrong mint would be a deployment error, not an attack vector. The fix is sufficient for the stated threat model.

## Verification Analysis

- **Front-running eliminated:** Only the program's upgrade authority can call either init instruction. An attacker cannot bind to wrong mints or capture control.
- **PDA idempotency:** Both instructions use `#[account(init, ...)]` with PDA seeds, preventing re-initialization.
- **Handler logic unchanged:** Both handlers' business logic is unmodified -- only the account validation struct has new fields.

## Regression Check

- No regressions detected.
- Both instructions now require two additional accounts (`program` and `program_data`), which is a breaking change for client code (expected and correct).
