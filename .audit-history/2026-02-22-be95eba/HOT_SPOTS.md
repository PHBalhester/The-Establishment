# Hot-Spots Map (Pre-Phase 1 Static Scan)

Generated: 2026-02-22
Source: Grep pattern catalog (12 categories, 53 patterns) + Semgrep custom Solana/Anchor rules

## Summary
- Total grep patterns found: ~280
- Total semgrep findings: ~160
- HIGH risk locations: ~120
- MEDIUM risk locations: ~160
- Files with matches: 34 (production code, excluding tests)
- Semgrep: Available (solana-anchor.yaml custom rules)

---

## Hot-Spots by File (sorted by risk density)

### programs/epoch-program/src/instructions/execute_carnage_atomic.rs — Risk: CRITICAL (45+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 78-179 | PC-002 | 13x AccountInfo<'info> (raw, untyped CPI passthrough) | HIGH | Account Validation |
| 73-178 | PC-003 | 15x /// CHECK: comments (review each justification) | HIGH | Account Validation |
| 245-264 | PF-005 | remaining_accounts partition for dual transfer hooks | HIGH | CPI & External Calls |
| 256 | semgrep | remaining_accounts * HOOK_ACCOUNTS_PER_MINT (unchecked mul) | HIGH | Arithmetic |
| 423-433 | PA-001/002 | u128 arithmetic → as u64 casts (slippage calc) | HIGH | Arithmetic |
| 428,433 | PA-001 | .ok_or(Overflow)? as u64 (checked then cast) | HIGH | Arithmetic |
| 452 | semgrep | unchecked addition (total_buy_amount) | HIGH | Arithmetic |
| 550-911 | PF-002 | 5x invoke_signed (CPI to Tax, AMM, Token-2022) | HIGH | CPI & External Calls |
| 968-1012 | PB-001 | 3x .unwrap() in test code (slippage floor tests) | MEDIUM | Error Handling |
| 1012 | semgrep | unchecked multiplication in test | MEDIUM | Arithmetic |
| 50 | PD-001 | Signer<'info> caller | MEDIUM | Access Control |
| 59-163 | PD-003 | 10x constraint = (epoch_state, carnage_state, vaults, mints) | MEDIUM | Access Control |
| 188 | PF-003 | Program<'info, System> only system program typed | MEDIUM | CPI |

### programs/epoch-program/src/instructions/execute_carnage.rs — Risk: CRITICAL (40+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 74-183 | PC-002 | 13x AccountInfo<'info> (raw CPI passthrough) | HIGH | Account Validation |
| 69-168 | PC-003 | 15x /// CHECK: comments | HIGH | Account Validation |
| 253-272 | PF-005 | remaining_accounts partition (dual hooks) | HIGH | CPI & External Calls |
| 264 | semgrep | remaining_accounts * HOOK_ACCOUNTS_PER_MINT (unchecked mul) | HIGH | Arithmetic |
| 430-440 | PA-001/002 | u128 → u64 slippage calculation | HIGH | Arithmetic |
| 458 | semgrep | unchecked addition | HIGH | Arithmetic |
| 556-926 | PF-002 | 6x invoke_signed | HIGH | CPI & External Calls |
| 960-974 | semgrep | unwrap + dangerous cast + unchecked mul in tests | MEDIUM | Arithmetic |

### programs/staking/src/instructions/update_cumulative.rs — Risk: HIGH (20+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 146-236 | PB-001 | 10x .unwrap() in reward calculation path | HIGH | Error Handling |
| 146-236 | semgrep | 10x sos-unwrap-in-program (production instruction handler!) | HIGH | Error Handling |
| 216 | PB-001 | checked_div result .unwrap() (div by zero → panic) | HIGH | Arithmetic |

### programs/staking/src/helpers/math.rs — Risk: HIGH (25+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 46 | semgrep | dangerous cast (as u64) | HIGH | Arithmetic |
| 50 | PA-001 | DivisionByZero? as u64 | HIGH | Arithmetic |
| 254-410 | semgrep | 10x unchecked multiplication in reward calc | HIGH | Arithmetic |
| 254,398 | semgrep | unchecked subtraction | HIGH | Arithmetic |
| 504,515 | PA-001 | as u64 casts in proptest helpers | MEDIUM | Arithmetic |
| 207-597 | PB-001 | 20+ .unwrap() calls (mostly test code) | MEDIUM | Error Handling |

### programs/tax-program/src/instructions/swap_sol_sell.rs — Risk: HIGH (18+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 173,211 | PF-005 | remaining_accounts forwarding for hooks | HIGH | CPI |
| 215 | PF-002 | invoke_signed swap CPI | HIGH | CPI |
| 282,444 | PF-001 | 2x raw invoke() (WSOL creation) | HIGH | CPI |
| 304-386 | PF-002 | 5x invoke_signed (tax distribution) | HIGH | CPI |
| 575,586 | PD-003 | constraint = true (always-true placeholder!) | HIGH | Access Control |
| 495 | PD-001 | Signer<'info> user | MEDIUM | Access Control |
| 626 | PF-003 | Program<'info, System> | MEDIUM | CPI |

### programs/tax-program/src/instructions/swap_sol_buy.rs — Risk: HIGH (10+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 242,287 | PF-005 | remaining_accounts forwarding | HIGH | CPI |
| 436,447 | PD-003 | constraint = true (always-true placeholder!) | HIGH | Access Control |
| 472 | PF-003 | Program<'info, System> | MEDIUM | CPI |

### programs/tax-program/src/helpers/tax_math.rs — Risk: HIGH (15+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 41-42 | PA-002 | amount_lamports as u128, tax_bps as u128 | HIGH | Arithmetic |
| 87 | PA-002 | total_tax as u128 | HIGH | Arithmetic |
| 148-149 | PA-002 | reserve_out/in as u128 (AMM floor calc) | HIGH | Arithmetic |
| 158 | PA-001 | floor as u64 (u128 → u64 truncation) | HIGH | Arithmetic |
| 158 | semgrep | dangerous cast | HIGH | Arithmetic |
| 279,312,375,411 | PB-001 | 4x .unwrap() in test code | MEDIUM | Error Handling |
| 313 | semgrep | 2x unchecked addition in test | MEDIUM | Arithmetic |

### programs/tax-program/src/instructions/swap_profit_buy.rs — Risk: HIGH (10+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 141-144 | PF-005 | remaining_accounts forwarding (dual hooks) | HIGH | CPI |
| 180 | PF-005 | remaining_accounts 2nd forwarding | HIGH | CPI |
| 188 | PF-002 | invoke_signed AMM CPI | HIGH | CPI |
| 222-225 | PA-002/001 | u128 fee calc → as u64 | HIGH | Arithmetic |
| 225 | semgrep | dangerous cast | HIGH | Arithmetic |
| 265 | PD-001 | Signer<'info> user | MEDIUM | Access Control |

### programs/tax-program/src/instructions/swap_profit_sell.rs — Risk: HIGH (10+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 136,172 | PF-005 | remaining_accounts forwarding (dual hooks) | HIGH | CPI |
| 214-217 | PA-002/001 | u128 fee calc → as u64 | HIGH | Arithmetic |
| 217 | semgrep | dangerous cast | HIGH | Arithmetic |
| 257 | PD-001 | Signer<'info> user | MEDIUM | Access Control |

### programs/epoch-program/src/instructions/trigger_epoch_transition.rs — Risk: HIGH (15+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 12 | PJ-002 | switchboard_on_demand import | HIGH | Oracle |
| 57 | PC-002 | AccountInfo<'info> randomness_account | HIGH | Account Validation |
| 55 | PC-003 | /// CHECK: Owner validated via SWITCHBOARD_PROGRAM_ID | HIGH | Account Validation |
| 81 | PA-004 | as u32 (slot → epoch, potential truncation) | HIGH | Arithmetic |
| 81 | semgrep | dangerous cast | HIGH | Arithmetic |
| 99 | semgrep | unchecked add + mul (epoch boundary calc) | HIGH | Arithmetic |
| 131-241 | PL-001 | 10x Clock::get/clock.slot usage | MEDIUM | Timing |
| 158-170 | PJ-004 | staleness check on VRF randomness | MEDIUM | Oracle |
| 200 | PF-002 | invoke_signed (bounty payment) | MEDIUM | CPI |

### programs/tax-program/src/instructions/swap_exempt.rs — Risk: HIGH (8+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 93-142 | PF-005 | 2x remaining_accounts forwarding loops | HIGH | CPI |
| 111 | CRITICAL | MINIMUM_OUTPUT: u64 = 0 (no slippage protection!) | HIGH | Token & Economic |
| 150 | PF-002 | invoke_signed AMM CPI | HIGH | CPI |
| 198 | PD-001 | Signer<'info> carnage_authority | MEDIUM | Access Control |

### programs/epoch-program/src/state/epoch_state.rs — Risk: MEDIUM (20+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 158 | semgrep | unchecked addition | MEDIUM | Arithmetic |
| 168 | semgrep | 20x unchecked addition (struct field defaults in tests) | MEDIUM | Arithmetic |

### programs/epoch-program/src/state/carnage_fund_state.rs — Risk: MEDIUM (15+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 38 | PA-005 | self as u8 (enum cast) | MEDIUM | Arithmetic |
| 38 | semgrep | dangerous cast | MEDIUM | Arithmetic |
| 139,155 | semgrep | 12x unchecked addition (struct defaults) | MEDIUM | Arithmetic |

### programs/staking/src/state/stake_pool.rs — Risk: MEDIUM (8+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 70 | semgrep | 8x unchecked addition (struct field defaults) | MEDIUM | Arithmetic |

### programs/staking/src/state/user_stake.rs — Risk: MEDIUM (8+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 23 | PD-004 | pub owner: Pubkey | MEDIUM | Access Control |
| 69 | semgrep | 8x unchecked addition (struct defaults) | MEDIUM | Arithmetic |

### programs/transfer-hook/src/instructions/transfer_hook.rs — Risk: HIGH (8+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 3-4 | PI-001 | spl_token_2022 imports | HIGH | Token-2022 |
| 36 | PC-001 | UncheckedAccount<'info> owner | HIGH | Account Validation |
| 44-54 | PC-001 | 3x UncheckedAccount (meta_list, wl_source, wl_dest) | HIGH | Account Validation |
| 122-126 | PI-001 | mint.owner == spl_token_2022::id() check | MEDIUM | Token-2022 |

### programs/transfer-hook/src/instructions/initialize_extra_account_meta_list.rs — Risk: MEDIUM (6+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 79 | PA-001 | account_size as u64 | HIGH | Arithmetic |
| 79 | semgrep | dangerous cast | HIGH | Arithmetic |
| 103-104 | PI-001 | spl_token_2022 extension parsing | MEDIUM | Token-2022 |
| 148 | PC-001 | UncheckedAccount<'info> extra_account_meta_list | MEDIUM | Account Validation |

### programs/amm/src/helpers/math.rs — Risk: MEDIUM (4+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 55 | PA-001 | output as u64 (documented in fn signature) | HIGH | Arithmetic |
| 249,267 | PB-001 | .unwrap() in tests only | MEDIUM | Error Handling |

### programs/amm/src/helpers/transfers.rs — Risk: MEDIUM (4+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 18 | Comment | Documents Anchor CPI doesn't forward remaining_accounts | HIGH | CPI |
| 145,183,185 | PF-004 | CpiContext::new / new_with_signer | MEDIUM | CPI |

### programs/amm/src/instructions/swap_sol_pool.rs — Risk: MEDIUM (6+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 248,275,300 | semgrep | 3x remaining_accounts (hook forwarding) | HIGH | CPI |
| 336 | PA-005 | direction as u8 | MEDIUM | Arithmetic |
| 380-381 | PD-003 | constraint = pool.initialized, !pool.locked | MEDIUM | State Machine |

### programs/amm/src/instructions/swap_profit_pool.rs — Risk: MEDIUM (4+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| semgrep | 2x remaining_accounts forwarding | HIGH | CPI |
| 261 | PA-005 | direction as u8 | MEDIUM | Arithmetic |

### programs/epoch-program/src/instructions/consume_randomness.rs — Risk: HIGH (12+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 12 | PJ-002 | switchboard_on_demand import | HIGH | Oracle |
| 50 | PC-002 | AccountInfo<'info> randomness_account | HIGH | Account Validation |
| 86-117 | PJ-004 | stale Carnage auto-expiry check | MEDIUM | Oracle |
| 242 | PF-002 | invoke_signed (staking CPI) | HIGH | CPI |
| 335 | PJ-002 | Switchboard 32 bytes → 8 bytes extraction | MEDIUM | Oracle |
| 391 | PB-001 | .unwrap() on checked_add (deadline calc) | HIGH | Error Handling |
| 391 | semgrep | sos-unwrap-in-program | HIGH | Error Handling |

### programs/epoch-program/src/instructions/retry_epoch_vrf.rs — Risk: MEDIUM (5+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 10 | PJ-002 | switchboard_on_demand import | HIGH | Oracle |
| 35 | PC-002 | AccountInfo<'info> randomness_account | HIGH | Account Validation |
| 31 | PD-003 | constraint = epoch_state.initialized | MEDIUM | Access Control |

### programs/epoch-program/src/constants.rs — Risk: MEDIUM (10+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 46,49 | PJ-002 | SWITCHBOARD_PROGRAM_ID (feature-flagged) | HIGH | Oracle |
| 58,61 | PG-004 | SLOTS_PER_EPOCH (feature-flagged 750/4500) | MEDIUM | Timing |
| 81 | PG-004 | TRIGGER_BOUNTY_LAMPORTS = 1_000_000 | MEDIUM | Token & Economic |
| 127,132 | PG-004 | CARNAGE_SLIPPAGE_BPS 8500/7500 | MEDIUM | Token & Economic |
| 151 | PG-004 | MAX_CARNAGE_SWAP_LAMPORTS = 1T | MEDIUM | Token & Economic |
| 186 | PA-006 | try_into().unwrap() | MEDIUM | Arithmetic |
| 297 | semgrep | unchecked subtraction | MEDIUM | Arithmetic |

### programs/tax-program/src/constants.rs — Risk: MEDIUM (8+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 30 | PG-004 | MICRO_TAX_THRESHOLD = 4 | MEDIUM | Token & Economic |
| 40 | PG-004 | MINIMUM_OUTPUT_FLOOR_BPS = 5000 (50%) | MEDIUM | Token & Economic |
| 51-159 | PB-001 | 5x Pubkey::from_str().unwrap() (constant init) | MEDIUM | Error Handling |
| 51-159 | semgrep | 5x sos-unwrap-in-program | MEDIUM | Error Handling |
| 233 | PA-006 | try_into().unwrap() | MEDIUM | Arithmetic |

### programs/staking/src/instructions/stake.rs — Risk: MEDIUM (3+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 44 | PE-001 | init_if_needed (reinitialization risk) | MEDIUM | Account Validation |
| 140 | semgrep | remaining_accounts | HIGH | CPI |

### programs/epoch-program/src/instructions/force_carnage.rs — Risk: MEDIUM (3+ patterns)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 19 | PG-003 | DEVNET_ADMIN hardcoded pubkey | MEDIUM | Access Control |
| 28 | PD-003 | constraint = authority.key() == DEVNET_ADMIN | MEDIUM | Access Control |
| 30 | PD-001 | Signer<'info> authority | MEDIUM | Access Control |
| 52 | PL-001 | Clock::get() | MEDIUM | Timing |

### programs/fake-tax-program/src/lib.rs — Risk: MEDIUM (test program)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 79 | semgrep | sos-raw-invoke-signed | HIGH | CPI |
| 53,70 | semgrep | remaining_accounts | HIGH | CPI |
| 89,94 | PC-001 | UncheckedAccount (amm_program, swap_authority) | HIGH | Account Validation |

### programs/mock-tax-program/src/lib.rs — Risk: MEDIUM (test program)
| Line | Pattern ID | Pattern | Risk | Focus Area |
|------|-----------|---------|------|------------|
| 94 | semgrep | sos-raw-invoke-signed | HIGH | CPI |
| 69,87 | semgrep | remaining_accounts | HIGH | CPI |
| 105,110 | PC-001 | UncheckedAccount (amm_program, swap_authority) | HIGH | Account Validation |

---

## Hot-Spots by Focus Area

### Access Control & Account Validation
- programs/epoch-program/src/instructions/execute_carnage_atomic.rs: 13x AccountInfo (raw CPI passthrough), 15x /// CHECK:
- programs/epoch-program/src/instructions/execute_carnage.rs: 13x AccountInfo, 15x /// CHECK:
- programs/transfer-hook/src/instructions/transfer_hook.rs: 4x UncheckedAccount
- programs/tax-program/src/instructions/swap_sol_sell.rs:575,586: `constraint = true` (always-true!)
- programs/tax-program/src/instructions/swap_sol_buy.rs:436,447: `constraint = true` (always-true!)
- programs/staking/src/instructions/stake.rs:44: init_if_needed
- AMM has_one usage: only 2 locations (initialize_pool, burn_admin)
- No #[access_control] decorators found anywhere
- No emergency pause mechanism found

### Arithmetic Safety
- **Type casts (HIGH):** 21x `as u64` in production, 30x `as u128`, 1x `as u32`
- **Truncation risk:** tax_math.rs:158 `floor as u64`, swap_profit_buy/sell `.as u64` after u128 calc
- **Unchecked ops (semgrep):** ~40x unchecked addition, ~15x unchecked multiplication, ~3x unchecked subtraction
- **Most checked:** AMM math uses `Option<T>` returns throughout
- **Most risky:** staking/update_cumulative.rs has 10x .unwrap() in production instruction handler

### CPI & External Calls
- 3x raw `invoke()` (all in swap_sol_sell.rs for WSOL)
- 20x `invoke_signed()` across Tax, Epoch, AMM programs
- 20x `remaining_accounts` forwarding (critical for transfer hook)
- CPI depth at Solana 4-level limit on execute_carnage_atomic path
- mock/fake tax programs use raw invoke_signed without program ID validation (test-only)

### Token & Economic
- Token-2022 usage: 20+ files reference spl_token_2022
- Transfer hook: active on all CRIME/FRAUD/PROFIT transfers
- swap_exempt.rs:111: `MINIMUM_OUTPUT = 0` (Carnage accepts ANY market execution)
- Slippage floors: 85% atomic (8500 BPS), 75% fallback (7500 BPS)
- Tax distribution: 75/24/1 split (staking/carnage/treasury)
- MAX_CARNAGE_SWAP_LAMPORTS = 1,000 SOL cap

### Oracle & External Data
- Switchboard On-Demand VRF: 4 files (trigger, consume, retry, constants)
- Feature-flagged program IDs (devnet vs mainnet)
- Staleness checks present: seed_slot validation, VRF_TIMEOUT_SLOTS = 300
- Anti-reroll: pending_randomness_account binding prevents oracle replay

### State Machine & Error Handling
- No `close =` constraints found (no account closure)
- No emergency pause mechanism
- No enum State/Status definitions found (states tracked via bool flags)
- force_carnage: devnet-only admin override (MUST REMOVE for mainnet)
- `.unwrap()` in production: ~10 in update_cumulative.rs, 1 in consume_randomness.rs, 5 in constants

### Timing & Ordering
- 20+ Clock::get() usages across epoch management
- Slot-based timing: SLOTS_PER_EPOCH, VRF_TIMEOUT_SLOTS, CARNAGE_DEADLINE_SLOTS, CARNAGE_LOCK_SLOTS
- Slippage protection present on all user-facing swaps
- Carnage swap_exempt has MINIMUM_OUTPUT = 0 (intentional per spec)

### Upgrade & Admin
- AMM admin: initialize_admin uses ProgramData upgrade_authority (good)
- AMM burn_admin: irreversible admin removal
- Transfer hook burn_authority: irreversible whitelist freeze
- No timelock on parameter changes
- Hardcoded program IDs: 6x declare_id!, 8x pubkey!, matched across programs

---

## Semgrep Rule Summary

| Rule ID | Count | Severity | Description |
|---------|-------|----------|-------------|
| sos-remaining-accounts | ~25 | WARNING | Untyped dynamic account passing |
| sos-unchecked-arithmetic-add | ~40 | WARNING | Unchecked addition (many in struct defaults) |
| sos-unchecked-arithmetic-mul | ~15 | WARNING | Unchecked multiplication |
| sos-unchecked-arithmetic-sub | ~3 | WARNING | Unchecked subtraction |
| sos-dangerous-cast | ~20 | WARNING | Type casts that may truncate/change sign |
| sos-unwrap-in-program | ~25 | WARNING | .unwrap() panics in handlers |
| sos-raw-invoke-signed | 2 | WARNING | Raw CPI without program validation (test programs) |

**Note:** Many semgrep `unchecked-add` findings are in `#[account]` struct Default impls (field = 0 + 0) — these are largely false positives from struct initialization macros. The real arithmetic risk is in instruction handlers and math helpers.
