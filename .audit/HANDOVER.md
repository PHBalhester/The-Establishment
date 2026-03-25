# SOS Audit Handover — Audit #3

**Previous Audit:** #2 (2026-03-07/08) @ `f891646`
**Current HEAD:** `dc063ec`
**Generated:** 2026-03-21

---

## Delta Summary

| Category | Count |
|----------|-------|
| Modified | 66 |
| New | 32 |
| Deleted | 0 |
| Unchanged | 0 |

**Note:** All 98 Rust files in `programs/` were touched since the last audit. 32 new files are predominantly BOK test suites + admin transfer instructions. 66 modified files span all 7 programs.

### New Production Files (Security-Relevant)

| File | Description |
|------|-------------|
| `amm/src/instructions/transfer_admin.rs` | AMM admin transfer instruction |
| `bonding_curve/src/instructions/burn_bc_admin.rs` | BC admin burn |
| `bonding_curve/src/instructions/initialize_bc_admin.rs` | BC admin initialization |
| `bonding_curve/src/instructions/transfer_bc_admin.rs` | BC admin transfer |
| `epoch-program/src/helpers/carnage_execution.rs` | Extracted carnage execution logic (~906 lines) |
| `transfer-hook/src/instructions/transfer_authority.rs` | Hook authority transfer |
| `tests/cross-crate/src/lib.rs` | Cross-program layout verification |

### Modified High-Risk Files

| File | Change Magnitude |
|------|-----------------|
| `bonding_curve/src/constants.rs` | MAJOR (122 lines) |
| `bonding_curve/src/math.rs` | MAJOR (214 lines) |
| `epoch-program/src/instructions/execute_carnage.rs` | MAJOR (~790 lines removed — extracted to helper) |
| `epoch-program/src/instructions/execute_carnage_atomic.rs` | MAJOR (~798 lines removed — extracted to helper) |
| `epoch-program/src/instructions/trigger_epoch_transition.rs` | MAJOR (67 lines) |
| `tax-program/src/helpers/pool_reader.rs` | MAJOR (45 lines) |
| `tax-program/src/instructions/swap_sol_sell.rs` | MAJOR (34 lines) |
| `staking/src/instructions/claim.rs` | MAJOR (18 lines — rent fix) |
| `transfer-hook/src/instructions/initialize_authority.rs` | MAJOR (12 lines — front-run fix) |

---

## Previous Findings Digest

### CONFIRMED Vulnerabilities (from Audit #2)

| ID | Severity | Finding | Verification Status | Affected Files | Delta Tag |
|----|----------|---------|---------------------|----------------|-----------|
| H001/H002/H010 | CRITICAL | BC authority gap — atomic SOL theft | FIXED (BcAdminConfig PDA) | bonding_curve/instructions/*.rs | RECHECK |
| H007 | CRITICAL | Transfer Hook init front-running | FIXED (ProgramData gate) | transfer-hook/instructions/initialize_authority.rs | RECHECK |
| S006 | CRITICAL | Combined deployment attack (Hook+BC) | FIXED (both sub-findings fixed) | transfer-hook + bonding_curve | RECHECK |
| H008 | HIGH | Sell path AMM min=0 sandwich | MITIGATED (50% floor) | tax-program/instructions/swap_sol_sell.rs | RECHECK |
| H012/S003 | HIGH | Staking escrow rent depletion | FIXED (rent_exempt_min) | staking/instructions/claim.rs | RECHECK |
| H036 | HIGH | Init front-running (Staking+Carnage) | FIXED (ProgramData gates) | staking, epoch init | RECHECK |
| S005 | HIGH | No emergency pause | NOT_FIXED (by design) | All programs | RECHECK |
| S007 | HIGH | No cross-program layout tests | FIXED (cross-crate tests) | tests/cross-crate/ | RECHECK |
| H011 | MEDIUM | EpochState cross-program layout corruption | FIXED (cross-crate tests) | tax-program/state/epoch_state_reader.rs | RECHECK |
| H018 | MEDIUM | Mainnet Pubkey::default() placeholders | FIXED (compile_error!) | tax, bc, vault constants.rs | RECHECK |
| H049 | MEDIUM | Cross-program upgrade cascade | NOT_FIXED (structural) | All programs | RECHECK |
| H058 | MEDIUM | CPI depth at 4/4 limit | NOT_FIXED (structural) | epoch/execute_carnage_atomic.rs | RECHECK |
| H003 | MEDIUM | BC initialize_curve front-running | FIXED (admin gate) | bonding_curve/instructions/initialize_curve.rs | RECHECK |
| H005 | LOW | BC close_token_vault rent extraction | FIXED (admin gate) | bonding_curve/instructions/close_token_vault.rs | RECHECK |
| H021 | LOW | Epoch init front-running | FIXED (ProgramData gate) | epoch/instructions/initialize_epoch_state.rs | RECHECK |
| H031 | LOW | Dual-curve grief (economically constrained) | ACCEPTED | bonding_curve/instructions/sell.rs | RECHECK |
| H048 | LOW | taxes_confirmed unchecked by Tax | ACCEPTED | tax-program/instructions/swap_sol_buy.rs | RECHECK |
| H077 | LOW | Unchecked as u64 cast | ACCEPTED | bonding_curve/src/math.rs | RECHECK |
| H014 | INFO | Buy path 50% output floor | ACCEPTED | tax-program/instructions/swap_sol_buy.rs | RECHECK |

**Note:** All files are MODIFIED since last audit, so every finding gets RECHECK tag.

### Carnage Hotfix (2026-03-16, post-audit)

Commit `3f927b0`: Fixed always-CRIME carnage targeting bug. `partition_hook_accounts` refactored for dual-mint atomic bundling. Verified with 18-combination test matrix. Zero regressions found in verification. **This new code needs fresh audit coverage.**

---

## Previous False Positive Log

All target files were MODIFIED since last audit — none of these dismissals can be carried forward automatically. Investigators should re-evaluate if the hypothesis is regenerated.

| ID | Description | Original File | Dismissal Reason |
|----|-------------|---------------|------------------|
| H004 | Epoch overflow via u64 accumulator | epoch state | u64 won't overflow in protocol lifetime |
| H006 | Tax bypass via direct AMM call | amm/swap_sol_pool | seeds::program constraint prevents |
| H032 | Oracle staleness | epoch/consume_randomness | Switchboard has built-in staleness checks |
| H042 | Tax math rounding exploitable | tax-program/tax_math | u128 intermediate prevents |
| H045 | Pool state manipulation via realloc | amm/state/pool | No realloc in code |
| H051 | Sandwich via AMM bypass | tax-program/swap_sol_buy | Sandwich protection present |
| H072 | Conversion vault ratio manipulation | conversion-vault | Fixed 100:1 ratio, no oracle |
| H073 | Hook whitelist bypass via proxy | transfer-hook | Token-2022 enforces hook on all transfers |
| H099 | False positive — terminology confusion | N/A | Not a bug |

---

## Architecture Snapshot (from Audit #2)

### Trust Boundaries
1. **CPI-Gated (Tier 1):** 4 PDA authority chains — Tax→AMM, Tax→Staking, Epoch→Staking, Epoch→Tax (all verified secure)
2. **Upgrade Authority Gated (Tier 2):** AMM AdminConfig (model pattern)
3. **Stored Authority (Tier 3):** Transfer Hook Authority (was front-runnable, now fixed)
4. **BC Admin (Tier 4, was BROKEN):** Fixed with BcAdminConfig PDA pattern — needs RECHECK
5. **Permissionless (Tier 5):** State/timing-gated instructions (epoch transitions, carnage)
6. **No Authority (Tier 6):** Conversion Vault, one-shot inits

### Key Invariants
1. Constant-product AMM: `k = reserve_a × reserve_b` preserved across swaps
2. Staking rewards: Synthetix model — `earned = staked × (cumulative_current - cumulative_at_stake)`
3. Tax distribution: 71% staking, 24% carnage, 5% treasury — enforced in tax_math.rs
4. Bonding curve: Linear price `y = mx + b`, SOL proceeds locked until graduation
5. Mint authorities burned — no further token minting possible
6. Transfer hook enforces whitelist on ALL CRIME/FRAUD transfers
7. VRF-derived epoch tax rates bounded [1%, 14%]
8. Carnage trigger probability: ~4.3% per epoch
9. PROFIT conversion: fixed 100:1 ratio, no oracle dependency
10. Cross-program IDs: 15 hardcoded references, sync'd by `sync-program-ids.ts`

### Critical Data Flows
- **Swap:** User → Tax Program → (CPI) AMM::swap → (CPI) Hook::execute → Staking::deposit_rewards
- **Epoch:** Crank → trigger_epoch_transition → VRF request → consume_randomness → carnage window
- **Carnage:** Crank → execute_carnage_atomic → Tax::swap_exempt → AMM → Hook (4-level CPI chain)
- **Graduation:** BC authority → prepare_transition → withdraw_graduated_sol → seed AMM pools

---

## Audit Lineage

| # | Date | Git Ref | Confirmed | Potential | Files | Notes |
|---|------|---------|-----------|-----------|-------|-------|
| 1 | 2026-02-22 | `be95eba` | 15 | 11 | 99 | Initial audit — 5 programs |
| 2 | 2026-03-07 | `f891646` | 19 | 1 | 129 | +2 programs (BC, Vault), 71 files changed |
| 3 | 2026-03-21 | `dc063ec` | — | — | — | Current audit — admin transfers, carnage refactor |
