# Phase 9 Plan 02: Pool Initialization Integration Tests Summary

13 litesvm integration tests validating all Phase 9 requirements: 4 pool configurations (2 mixed, 2 pure T22), admin access control, canonical ordering, duplicate prevention, zero seed rejection, token program mismatch, and event emission. Type bridge between Anchor Pubkey and litesvm Address via byte conversion.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1-2 | Test infrastructure, helpers, and full integration test suite | cae7831 | programs/amm/Cargo.toml, programs/amm/tests/test_pool_initialization.rs |

## What Was Built

### Test Infrastructure (Cargo.toml)
- litesvm 0.9.1 as dev-dependency for in-process Solana VM testing
- Modular Solana 3.x crates (solana-address, solana-keypair, solana-message, solana-transaction, solana-account, solana-instruction) for litesvm type compatibility
- SPL Token 8.0 and Token-2022 8.0 for mint/account creation
- sha2 for Anchor discriminator computation

### Type Bridge (Solana 2.x <-> 3.x)
- `addr(Pubkey) -> Address`: Convert Anchor Pubkey to litesvm Address via bytes
- `pk(Address) -> Pubkey`: Convert litesvm Address to Anchor Pubkey
- `kp_pubkey(Keypair) -> Pubkey`: Convert litesvm Keypair to Anchor Pubkey
- Both types are `[u8; 32]` wrappers, conversion is zero-copy via `to_bytes()`/`from()`

### Upgradeable BPF Program Deployment
- Manual construction of BPF Loader Upgradeable account layout:
  - Program account: UpgradeableLoaderState::Program (tag=2, 36 bytes)
  - ProgramData account: UpgradeableLoaderState::ProgramData (tag=3, 45-byte header + ELF)
- Key insight: ProgramData must be set BEFORE Program account because litesvm's set_account triggers load_program which reads ProgramData
- Enables testing the upgrade authority constraint in initialize_admin

### Reusable Test Helpers
- `setup_svm_with_upgradeable_program()`: Deploy AMM with known upgrade authority
- `create_spl_mint()` / `create_t22_mint()`: Create mints via SystemProgram + InitializeMint2
- `create_token_account()`: Create token accounts via SystemProgram + InitializeAccount3
- `mint_tokens()`: Mint tokens via MintTo instruction
- `build_initialize_admin_ix()` / `build_initialize_pool_ix()`: Build Anchor instructions with discriminator
- `setup_pool_test(PoolConfig)`: High-level context builder (deploy, admin, mints, accounts, funding)
- `read_pool_state()` / `read_token_balance()` / `read_token_owner()`: Account data parsers

### Integration Tests (13 total)

**Happy Path (7 tests):**
1. `test_initialize_admin_success` -- AdminConfig PDA created with correct admin + bump
2. `test_initialize_mixed_pool` -- Full verification: pool type, mints, vaults, reserves, bumps, authority, balances
3. `test_initialize_pure_t22_pool` -- PureT22Pool type, both token programs = T22
4. `test_initialize_mixed_pool_second_config` -- Different amounts, MixedPool type
5. `test_initialize_pure_t22_pool_second_config` -- Different amounts, PureT22Pool type
6. `test_pool_initialized_event` -- Transaction logs contain "Pool initialized" message

**Negative Tests (7 tests):**
7. `test_initialize_admin_non_upgrade_authority_rejected` -- Imposter cannot create AdminConfig
8. `test_initialize_pool_non_admin_rejected` -- Fake admin rejected by has_one constraint
9. `test_duplicate_pool_rejected` -- PDA collision prevents second pool with same mints
10. `test_non_canonical_order_rejected` -- mint_b > mint_a fails MintsNotCanonicallyOrdered
11. `test_duplicate_mints_rejected` -- Same mint as both sides fails DuplicateMints
12. `test_zero_seed_amount_rejected` -- Zero amount_a fails ZeroSeedAmount
13. `test_token_program_mismatch_rejected` -- Wrong token program for mint fails constraint

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Use litesvm directly instead of anchor-litesvm | anchor-litesvm 0.3.0 depends on anchor-lang 1.0.0-rc.2, incompatible with our 0.32.1 |
| Build type bridge via byte conversion | Anchor uses solana_program::Pubkey (2.x), litesvm uses solana_address::Address (3.x); both are [u8; 32] |
| Manual BPF Loader Upgradeable account setup | litesvm's add_program uses bpf_loader (non-upgradeable), but initialize_admin needs ProgramData constraint |
| ProgramData set before Program account | litesvm's set_account on executable accounts triggers load_program which reads ProgramData |
| Raw instruction bytes for SPL operations | Avoids pulling in additional crate versions; instructions are stable byte layouts |
| Combined Task 1+2 into single commit | Both tasks modify the same files; infrastructure is inseparable from tests |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] anchor-litesvm incompatible with Anchor 0.32.1**
- **Found during:** Task 1 dependency investigation
- **Issue:** anchor-litesvm 0.3.0 requires anchor-lang 1.0.0-rc.2, spl-token 9.0; our project uses anchor-lang 0.32.1, spl-token 8.0
- **Fix:** Used litesvm directly with modular Solana 3.x crates + manual instruction building
- **Files modified:** programs/amm/Cargo.toml

**2. [Rule 3 - Blocking] Type mismatch between Solana 2.x Pubkey and litesvm's Solana 3.x Address**
- **Found during:** Task 1 first compilation attempt
- **Issue:** litesvm 0.9.1 expects `solana_address::Address`, Anchor provides `solana_program::pubkey::Pubkey` -- different types
- **Fix:** Created byte-based conversion functions (addr, pk, kp_pubkey)
- **Files modified:** programs/amm/tests/test_pool_initialization.rs

**3. [Rule 1 - Bug] litesvm set_account order dependency for upgradeable programs**
- **Found during:** Task 1 all tests failing with MissingAccount
- **Issue:** Setting executable Program account before ProgramData causes load_program to fail looking up nonexistent ProgramData
- **Fix:** Set ProgramData account first, then Program account
- **Files modified:** programs/amm/tests/test_pool_initialization.rs

## Verification Results

1. `cargo test -p amm` passes ALL 39 tests (26 math + 13 pool initialization)
2. Happy path: All 4 pool configurations initialize successfully
3. Pool state fields correct for each pool type (MixedPool vs PureT22Pool)
4. Vault token accounts have pool PDA as authority
5. Vault balances match seed amounts
6. Admin gate: non-upgrade-authority cannot create AdminConfig
7. Admin gate: non-admin cannot create pools
8. Duplicate pool creation fails (PDA collision)
9. Non-canonical mint ordering fails
10. Zero seed amounts fail
11. Token program mismatch fails
12. PoolInitializedEvent emission verified via transaction logs

## Files Created

| File | Purpose |
|------|---------|
| programs/amm/tests/test_pool_initialization.rs | 1291-line integration test suite with reusable litesvm helpers |

## Files Modified

| File | Changes |
|------|---------|
| programs/amm/Cargo.toml | Added litesvm, modular Solana crates, SPL crates, sha2 as dev-dependencies |
| Cargo.lock | Updated with new dependency graph |

## Next Phase Readiness

Phase 10 (Token Routing) can proceed:
- Test infrastructure (litesvm helpers) is reusable for Phase 10+ tests
- All Phase 9 requirements validated
- Pool initialization proven correct for both mixed and pure T22 pools
- Research flag confirmed: litesvm API adaptation needed (documented in deviations)

## Metrics

- **Duration:** 10min
- **Completed:** 2026-02-04
- **Tasks:** 2/2 (combined into single commit due to shared file)
- **Lines added:** ~1291 (test file) + ~10 (Cargo.toml)
- **Test count:** 13 integration tests + 26 existing math tests = 39 total
