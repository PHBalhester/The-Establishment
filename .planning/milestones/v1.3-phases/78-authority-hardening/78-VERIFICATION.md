---
phase: 78-authority-hardening
verified: 2026-03-08T10:30:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 78: Authority Hardening Verification Report

**Phase Goal:** Harden all 7 programs so only the deployer (ProgramData upgrade authority) can initialize, and add BcAdminConfig PDA for bonding curve admin gating. Document authority map.
**Verified:** 2026-03-08
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BcAdminConfig PDA stores authority pubkey and is initialized via ProgramData upgrade authority check | VERIFIED | `programs/bonding_curve/src/state.rs` has `BcAdminConfig { authority: Pubkey, bump: u8 }`. `initialize_bc_admin.rs` has `program_data.upgrade_authority_address == Some(authority.key())` constraint. |
| 2 | All 6 admin instructions require has_one = authority on BcAdminConfig | VERIFIED | grep confirms `has_one = authority @ CurveError::Unauthorized` in: initialize_curve.rs, fund_curve.rs, start_curve.rs, prepare_transition.rs, withdraw_graduated_sol.rs, close_token_vault.rs. All 6 also have `admin_config: Account<BcAdminConfig>`. |
| 3 | burn_bc_admin sets authority to Pubkey::default(), permanently disabling admin | VERIFIED | `burn_bc_admin.rs:21` has `admin_config.authority = Pubkey::default()`. Constraint `has_one = authority` prevents further calls since nobody can sign as default pubkey. |
| 4 | Transfer Hook initialize_authority rejects non-upgrade-authority callers | VERIFIED | `initialize_authority.rs:53` has `program_data.upgrade_authority_address == Some(signer.key())` and `:47` has `program.programdata_address()? == Some(program_data.key())`. |
| 5 | Staking, Epoch (x2), Conversion Vault, Tax Program init instructions all gated | VERIFIED | All 5 files confirmed with both `programdata_address()? == Some(program_data.key())` and `upgrade_authority_address == Some(<signer>.key())` constraints. |
| 6 | Authority map documented in PROJECT.md | VERIFIED | `.planning/PROJECT.md` contains 10-row Authority Map table covering all 7 programs (7 upgrade + 3 admin PDAs), lifecycle strategy (Squads 2-of-3 multisig), and no-emergency-pause rationale. |
| 7 | Programs compile with authority changes | VERIFIED | Summary reports `anchor build` succeeded for all programs, devnet feature builds for bonding_curve/epoch/tax/vault all passed. 51/53 tests pass (2 pre-existing proptest regressions unrelated to authority changes). |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/bonding_curve/src/state.rs` | BcAdminConfig struct | VERIFIED | 273 lines, has `pub struct BcAdminConfig` with authority + bump fields, #[account] and InitSpace derives |
| `programs/bonding_curve/src/instructions/initialize_bc_admin.rs` | ProgramData check on init | VERIFIED | 59 lines, full two-part ProgramData constraint, init PDA with seeds=[BC_ADMIN_SEED] |
| `programs/bonding_curve/src/instructions/burn_bc_admin.rs` | Irreversible admin burn | VERIFIED | 44 lines, sets authority to Pubkey::default(), has_one constraint prevents re-entry |
| `programs/bonding_curve/src/constants.rs` | BC_ADMIN_SEED constant | VERIFIED | `pub const BC_ADMIN_SEED: &[u8] = b"bc_admin";` present |
| `programs/bonding_curve/src/error.rs` | Unauthorized variant | VERIFIED | `#[msg("Unauthorized: caller is not the admin")] Unauthorized` |
| `programs/bonding_curve/src/instructions/mod.rs` | Exports for new instructions | VERIFIED | Both `pub mod initialize_bc_admin` and `pub mod burn_bc_admin` with `pub use` re-exports |
| `programs/bonding_curve/src/lib.rs` | Entrypoints for new instructions | VERIFIED | `initialize_bc_admin` and `burn_bc_admin` public functions in #[program] mod |
| `programs/transfer-hook/src/instructions/initialize_authority.rs` | ProgramData constraint | VERIFIED | Two-part constraint present |
| `programs/staking/src/instructions/initialize_stake_pool.rs` | ProgramData constraint | VERIFIED | Two-part constraint present |
| `programs/epoch-program/src/instructions/initialize_epoch_state.rs` | ProgramData constraint | VERIFIED | Two-part constraint present |
| `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` | ProgramData constraint | VERIFIED | Two-part constraint present |
| `programs/conversion-vault/src/instructions/initialize.rs` | ProgramData constraint | VERIFIED | Two-part constraint present |
| `programs/tax-program/src/instructions/initialize_wsol_intermediary.rs` | ProgramData constraint | VERIFIED | Two-part constraint present |
| `.planning/PROJECT.md` | Authority map table | VERIFIED | 10-row table with lifecycle strategy and burn plan |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| initialize_bc_admin | ProgramData | `programdata_address()? == Some(program_data.key())` + `upgrade_authority_address == Some(authority.key())` | WIRED | Both constraints present, authority is Signer |
| initialize_curve | BcAdminConfig | `has_one = authority @ CurveError::Unauthorized` | WIRED | admin_config account with seeds + bump + has_one |
| fund_curve | BcAdminConfig | `has_one = authority @ CurveError::Unauthorized` | WIRED | Same pattern |
| start_curve | BcAdminConfig | `has_one = authority @ CurveError::Unauthorized` | WIRED | Same pattern |
| prepare_transition | BcAdminConfig | `has_one = authority @ CurveError::Unauthorized` | WIRED | Same pattern |
| withdraw_graduated_sol | BcAdminConfig | `has_one = authority @ CurveError::Unauthorized` | WIRED | Same pattern |
| close_token_vault | BcAdminConfig | `has_one = authority @ CurveError::Unauthorized` | WIRED | Same pattern |
| burn_bc_admin | BcAdminConfig | `has_one = authority`, sets to default | WIRED | Irreversible burn |
| 6 init instructions (5 programs) | ProgramData | Anchor constraint pair | WIRED | All 6 confirmed with grep across programs/ |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|---------|
| AUTH-01 | SATISFIED | BcAdminConfig PDA + all 6 admin instructions gated + burn instruction |
| AUTH-02 | SATISFIED | Transfer Hook initialize_authority has ProgramData constraint |
| AUTH-03 | SATISFIED | Staking initialize_stake_pool has ProgramData constraint |
| AUTH-04 | SATISFIED | Epoch initialize_epoch_state has ProgramData constraint |
| AUTH-05 | SATISFIED | Epoch initialize_carnage_fund has ProgramData constraint |
| AUTH-06 | SATISFIED | Conversion Vault initialize has ProgramData constraint |
| AUTH-07 | SATISFIED | Authority map table (10 entries) + lifecycle strategy in PROJECT.md |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns detected in any modified files |

### Human Verification Required

### 1. Devnet Deployment Regression

**Test:** After next devnet redeploy, verify that initialize.ts passes ProgramData accounts to all init instructions and the protocol initializes successfully.
**Expected:** All programs initialize without "ConstraintRaw" errors. The deployer wallet must be the upgrade authority.
**Why human:** Deploy scripts need updating to pass new ProgramData accounts -- this is a client-side change that can only be verified at deploy time.

### Gaps Summary

No gaps found. All 7 AUTH requirements are fully satisfied in the codebase:

- AUTH-01: BcAdminConfig PDA created with 6 admin instructions gated via has_one constraint, plus irreversible burn instruction
- AUTH-02 through AUTH-06: All 6 initialization instructions across 5 non-BC programs have the two-part ProgramData upgrade authority constraint
- AUTH-07: Authority map with 10 entries documented in PROJECT.md including lifecycle strategy and burn plan

The Tax Program's `initialize_wsol_intermediary` was also hardened for consistency (bonus, not required by any AUTH requirement).

Note: The deploy scripts (initialize.ts) will need to be updated to pass ProgramData accounts when these init instructions are called on next redeploy. This is flagged for human verification at deploy time but does not block the phase goal.

---

_Verified: 2026-03-08_
_Verifier: Claude (gsd-verifier)_
