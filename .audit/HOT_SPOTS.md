# HOT_SPOTS.md — Stronghold of Security Static Pre-Scan

**Generated:** 2026-03-21
**Scope:** `programs/` (119 source files, 35 test files — 154 total .rs files; target/ excluded)
**Semgrep:** Not available (no `solana-anchor.yaml` rules file found)

---

## 1. Summary

| Category | Count |
|---|---|
| Total pattern matches (HIGH + MEDIUM) | ~480 (across all patterns) |
| HIGH risk pattern hits (source files only) | ~140 |
| MEDIUM risk pattern hits (source files only) | ~100 |
| Files with at least one HIGH pattern | 28 |
| Files with at least one MEDIUM pattern | 42 |
| Programs scanned | 9 (amm, bonding_curve, conversion-vault, epoch-program, fake-tax-program, mock-tax-program, staking, stub-staking, tax-program, transfer-hook) |

**Highest-density files (by HIGH pattern count, source only):**
1. `epoch-program/src/helpers/carnage_execution.rs` — invoke_signed ×5, remaining_accounts ×2, as u64 ×1, token ops ×3
2. `tax-program/src/instructions/swap_sol_sell.rs` — invoke_signed ×8, invoke ×2, remaining_accounts ×3, as u64 ×1
3. `tax-program/src/instructions/swap_sol_buy.rs` — invoke_signed ×4, remaining_accounts ×2, as u64 ×2
4. `epoch-program/src/instructions/consume_randomness.rs` — invoke_signed ×1, remaining_accounts ×1, try_borrow_data ×1, owner-check pattern ×1
5. `bonding_curve/src/instructions/purchase.rs` — init_if_needed, remaining_accounts ×2, invoke_signed ×1, as u128→u64 ×2
6. `bonding_curve/src/math.rs` — as u64 ×30+ (test-heavy file; many are in #[test] contexts, but the real function at lines 242-273 has naked casts)
7. `staking/src/helpers/math.rs` — as u64 ×6 (all in checked-math proptest, but unwrap_or(0) on security-relevant paths ×6)
8. `epoch-program/src/instructions/execute_carnage_atomic.rs` — remaining_accounts ×1, as u64 ×3 (unwrap().as u64 pattern)
9. `epoch-program/src/instructions/trigger_epoch_transition.rs` — try_borrow_data ×1, remaining_accounts ×1, invoke_signed ×1
10. `bonding_curve/src/instructions/distribute_tax_escrow.rs` — direct lamport manipulation ×2, UncheckedAccount ×2

---

## 2. By File (Risk Density Order — Source Files Only)

### epoch-program/src/helpers/carnage_execution.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 513, 567, 586, 806, 889 | `invoke_signed(` — 5 calls, building instructions manually | HIGH | CPI |
| 401–452 | `ctx.remaining_accounts` partitioned for hook accounts — no on-chain length validation beyond >= check | HIGH | CPI |
| 505 | `carnage_state_info` used as burn authority — authority derived from PDA address passed in `AccountMeta` | HIGH | TOKEN |
| 497 | Raw burn instruction data built manually (`vec![8u8]` + amount bytes) — no SPL helpers | HIGH | CPI |
| 422, 433, 442 | Remaining accounts slicing with numeric offsets; wrong layout from client = wrong hook accounts | MEDIUM | STATE |
| 470 | `carnage_state.held_token` matched as raw u8 (1/2/other) without exhaustive enum | MEDIUM | STATE |

---

### tax-program/src/instructions/swap_sol_sell.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 235 | `invoke_signed(&swap_ix, &account_infos, ...)` — AMM CPI with manually-built account list | HIGH | CPI |
| 302, 324, 339, 377, 390, 406, 438, 464 | `invoke_signed` / `invoke` ×8 additional calls (system transfers, close_account, create_account, InitializeAccount3) | HIGH | CPI |
| 231 | `for acc in ctx.remaining_accounts.iter()` — all remaining_accounts appended to CPI without validation | HIGH | CPI |
| 151 | `tax_bps as u64` — cast from derived rate (u32/u16 field) to u64 without bounds check | HIGH | ARITH |
| 243–245 | `wsol_after.checked_sub(wsol_before)` — balance diff pattern; relies on account reload after CPI; TOCTOU if reload fails silently | MEDIUM | STATE |
| 289–299 | SPL Token Transfer instruction built manually with raw discriminator byte `3u8` | MEDIUM | CPI |

---

### tax-program/src/instructions/swap_sol_buy.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 128, 166, 180, 197 | `invoke_signed(` ×4 — system transfers (staking, carnage, treasury, wrap) | HIGH | CPI |
| 304 | `invoke_signed(` — AMM swap CPI with manually-built instruction | HIGH | CPI |
| 242, 287 | `for account in ctx.remaining_accounts.iter()` — remaining_accounts forwarded to CPI without owner/key checks | HIGH | CPI |
| 106 | `read_pool_reserves(&ctx.accounts.pool)` — reads AMM state from raw bytes; byte offsets (137/145) hardcoded | HIGH | ARITH |
| 83–84 | `calculate_tax` result used directly — overflow guard exists (ok_or), but relies on caller `is_crime` flag (not verified on-chain) | MEDIUM | ARITH |
| 455 | `address = treasury_pubkey()` constraint — mainnet `treasury_pubkey()` returns devnet wallet in non-devnet non-localnet build (confirmed below) | HIGH | ADMIN |

---

### epoch-program/src/instructions/consume_randomness.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 52 | `owner = SWITCHBOARD_PROGRAM_ID` — randomness account owner constraint; correct per spec | LOW (correct) | ORACLE |
| 155 | `randomness_account.key() == epoch_state.pending_randomness_account` — anti-reroll check enforced | LOW (correct) | ORACLE |
| 165 | `try_borrow_data()` on randomness AccountInfo — raw byte parse, safe via SDK `RandomnessAccountData::parse` | MEDIUM | ORACLE |
| 65 | `stake_pool: AccountInfo<'info>` with `#[account(mut)]` — no `owner` or `seeds` constraint on stake_pool in ConsumeRandomness; Staking Program CPI validates it, but Epoch Program doesn't independently | HIGH | ACCESS |
| 80 | `carnage_state: Option<Account<...>>` — optional account; skip of Carnage check if not provided; anyone can omit it | MEDIUM | STATE |

---

### bonding_curve/src/instructions/purchase.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 40 | `init_if_needed` on `user_token_account` — standard ATA pattern; Anchor verifies discriminator, mitigates reinitialization | MEDIUM | STATE |
| 214 | `ctx.remaining_accounts.len() == 4` — exact length check required; revert if wrong (good) | LOW (correct) | CPI |
| 248, 263 | `for account_info in ctx.remaining_accounts` — hook accounts passed through; no owner checks on individual accounts | HIGH | CPI |
| 268 | `invoke_signed` for transfer_checked — manually built instruction | HIGH | CPI |

---

### bonding_curve/src/math.rs (production functions, ignoring test helpers)
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 242 | `/ (total_outstanding as u128)) as u64` — ProportionalRefund: truncating cast after u128 division; if result > u64::MAX, silently wraps | HIGH | ARITH |
| 247–249 | `calculate_proportional_refund`: result of u128 integer division cast to u64 via `u64::try_from(result).ok()` — returns None on overflow (OK), but caller must handle None | MEDIUM | ARITH |
| 273 | `(TOTAL_FOR_SALE * (P_START + P_END) / (2 * TOKEN_DECIMAL_FACTOR)) as u64` — const eval cast; safe only because constants are known to fit | LOW | ARITH |
| 225 | `u64::try_from(price).unwrap_or(u64::MAX)` — silently saturates spot price to MAX rather than error | MEDIUM | ARITH |
| 222 | `.unwrap_or(0)` on checked division — zero-price fallback; could mask very large current_sold values | MEDIUM | ARITH |

---

### staking/src/helpers/math.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 534, 536 | `checked_mul(...).unwrap_or(u128::MAX); checked_div(...).unwrap_or(0) as u64` — overflow sentinel u128::MAX passed through; then division result cast without try_from | HIGH | ARITH |
| 620, 622 | Same pattern repeated — second proptest variant | HIGH | ARITH |
| 654, 656 | Same pattern — third variant | HIGH | ARITH |
| 696–703 | Same pattern — fourth variant (user_a / user_b) | HIGH | ARITH |
| 84 | `user.last_update_slot = Clock::get()?.slot` in helper math function — slot timestamp used for reward timing | MEDIUM | TIMING |

**Note:** These are inside `#[cfg(test)] proptest!` blocks. However, the `unwrap_or(0) as u64` pattern for the PRODUCTION `update_rewards` path at lines ~46-50 should be verified separately to confirm checked arithmetic is used there too.

---

### epoch-program/src/instructions/execute_carnage_atomic.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 255, 272, 284 | `.unwrap() as u64` — after `checked_mul(...).and_then(checked_div(...))` chain; if chain returns None, `.unwrap()` panics on-chain | HIGH | ARITH |
| 296 | `(expected as u128 * CARNAGE_SLIPPAGE_BPS_ATOMIC as u128 / 10_000) as u64` — truncating cast from u128; safe only if result ≤ u64::MAX | MEDIUM | ARITH |
| 234 | `ctx.remaining_accounts` — slicing without length guard before partition call | MEDIUM | CPI |

---

### epoch-program/src/instructions/execute_carnage.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 265 | `.unwrap() as u64` — same pattern as atomic; panics if None | HIGH | ARITH |
| 275–276 | Dual slippage floor computations using raw `as u64` cast | MEDIUM | ARITH |
| 239 | `ctx.remaining_accounts` forwarded without length guard | MEDIUM | CPI |

---

### bonding_curve/src/instructions/distribute_tax_escrow.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 91–92 | Direct lamport manipulation: `**escrow.try_borrow_mut_lamports()? -= transferable` and `+= transferable` | HIGH | STATE |
| 43, 56 | `UncheckedAccount` — tax_escrow and carnage_fund; constrained by seeds/derivation (OK) | MEDIUM | ACCESS |
| 50–53 | `Pubkey::find_program_address(...)` inside constraint — recomputes PDA on every call; expensive but correct | MEDIUM | STATE |

---

### epoch-program/src/instructions/trigger_epoch_transition.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 168 | `try_borrow_data()` on randomness AccountInfo — raw data access on external oracle account | MEDIUM | ORACLE |
| 174 | `saturating_sub(randomness_data.seed_slot)` — freshness check; saturation means underflow returns 0, passing the `< MAX_RANDOMNESS_STALENESS` check | MEDIUM | TIMING |
| 185 | `randomness_data.get_value(clock.slot).is_ok()` — if already revealed, reject; correct anti-reroll | LOW | ORACLE |
| 221 | `invoke_signed` — bounty payment CPI | HIGH | CPI |

---

### tax-program/src/constants.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 146–148 | `treasury_pubkey()` non-devnet/non-localnet build returns devnet wallet address `8kPzh...` — this is the **deployer/devnet wallet**, NOT the mainnet treasury (`3ihhw...` per memory) | CRITICAL | ADMIN |
| 133 | Comment says "MAINNET: Replace Pubkey::default()..." but the actual non-feature default is NOT Pubkey::default(); it's the devnet wallet | HIGH | ADMIN |

---

### bonding_curve/src/instructions/sell.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 219 | `ctx.remaining_accounts.len() == 4` — exact check required (good) | LOW | CPI |
| 242, 257 | `for account_info in ctx.remaining_accounts` — hook accounts forwarded without individual validation | HIGH | CPI |
| 262 | `invoke` (not invoke_signed) for transfer_checked — seller is signer; correct | LOW | CPI |
| 320 | `vault_balance >= expected_from_integral.saturating_sub(rent_exempt_min as u64)` — saturation on u64 cast; rent_exempt_min is Rent value (fits in u64) | LOW | ARITH |

---

### bonding_curve/src/instructions/fund_curve.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 103, 118 | `for account_info in ctx.remaining_accounts` — hook accounts forwarded | HIGH | CPI |
| 123 | `invoke(` — transfer_checked CPI | HIGH | CPI |

---

### staking/src/instructions/stake.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 44 | `init_if_needed` on UserStake — standard; guarded by owner check at line 106 | MEDIUM | STATE |
| 106 | `user.owner == Pubkey::default()` — new user detection via zero pubkey; safe because Anchor init sets all fields | LOW | STATE |
| 141 | `ctx.remaining_accounts` — hook accounts for token transfer | HIGH | CPI |

---

### staking/src/instructions/unstake.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 127–129 | `unix_timestamp.checked_sub(last_claim_ts).unwrap_or(0)` — clock reversal treated as "no time elapsed" (cooldown bypassed on rollback) | MEDIUM | TIMING |
| 205 | `ctx.remaining_accounts` — hook accounts | HIGH | CPI |

---

### epoch-program/src/instructions/force_carnage.rs (devnet-only)
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 19 | `const DEVNET_ADMIN: Pubkey = pubkey!("8kPzh...")` — hardcoded authority | MEDIUM | ADMIN |
| 28 | `constraint = authority.key() == DEVNET_ADMIN` — gated correctly via `#[cfg(feature = "devnet")]` | LOW (correct) | ADMIN |

---

### conversion-vault/src/instructions/convert.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 140 | `let remaining = ctx.remaining_accounts` — hook accounts for vault conversion | HIGH | CPI |

---

### staking/src/instructions/initialize_stake_pool.rs
| Line | Pattern | Risk | Focus |
|---|---|---|---|
| 143 | `ctx.remaining_accounts` — hook accounts during pool init | MEDIUM | CPI |
| 48 | `CHECK: PDA owned by system program` — SOL-only vault; seeds constrain it | LOW | ACCESS |

---

## 3. By Focus Area

### ACCESS — Signer checks, has_one, constraint, seeds, bump, owner

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `epoch-program/src/instructions/consume_randomness.rs` | 65–66 | `stake_pool` is `AccountInfo<'info>` with only `#[account(mut)]`; no owner or seeds constraint at Epoch level — validated downstream in Staking CPI | HIGH |
| `tax-program/src/instructions/swap_sol_buy.rs` | 388, 419, 430, 441 | Multiple `CHECK:` accounts delegating validation to downstream CPIs (pool, staking accounts) | MEDIUM |
| `tax-program/src/instructions/swap_sol_sell.rs` | 547, 578, 589, 600 | Same delegation pattern as buy | MEDIUM |
| `bonding_curve/src/instructions/distribute_tax_escrow.rs` | 43, 56 | `UncheckedAccount` for SOL vaults — seeds/derivation constraints present | LOW |
| `staking/src/instructions/claim.rs` | 54 | `CHECK: PDA owned by this program` on staking vault — seeds constrained | LOW |

### ARITH — Unchecked arithmetic, casts, overflow/underflow

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `epoch-program/src/instructions/execute_carnage_atomic.rs` | 255, 272, 284 | `.unwrap() as u64` after `checked_mul/div` chain — panics if None at runtime | HIGH |
| `epoch-program/src/instructions/execute_carnage.rs` | 265 | Same `.unwrap() as u64` pattern | HIGH |
| `bonding_curve/src/math.rs` | 242 | `/ (total_outstanding as u128)) as u64` — truncating u128→u64 in refund calc | HIGH |
| `tax-program/src/instructions/swap_sol_sell.rs` | 151 | `tax_bps as u64` — widening cast, safe but unguarded | MEDIUM |
| `bonding_curve/src/math.rs` | 225 | `unwrap_or(u64::MAX)` silently saturates spot price | MEDIUM |
| `bonding_curve/src/math.rs` | 222 | `unwrap_or(0)` on integral division — zero fallback masks errors | MEDIUM |
| `epoch-program/src/instructions/execute_carnage_atomic.rs` | 296 | `as u64` truncation on u128 slippage floor | MEDIUM |
| `epoch-program/src/instructions/execute_carnage.rs` | 275–276 | `as u64` truncation on slippage floor computations | MEDIUM |
| `bonding_curve/src/math.rs` | 273 | `as u64` on const — safe by construction | LOW |
| `staking/src/helpers/math.rs` | 534–703 | `unwrap_or(u128::MAX); ... unwrap_or(0) as u64` in proptest blocks | LOW (test-only) |

### STATE — State transitions, account close, realloc, init

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `bonding_curve/src/instructions/distribute_tax_escrow.rs` | 91–92 | Direct lamport mutation on `UncheckedAccount` — valid pattern but bypasses Anchor balance checks | HIGH |
| `bonding_curve/src/instructions/sell.rs` | 73 | Direct lamport add to user wallet (system-owned) — valid by Solana rules | MEDIUM |
| `epoch-program/src/helpers/carnage_execution.rs` | 470–481 | `held_token` matched as raw u8; no enforcement that values stay in {0,1,2} | MEDIUM |
| `epoch-program/src/instructions/consume_randomness.rs` | 80 | `carnage_state: Option<Account>` — allows callers to skip Carnage trigger check | MEDIUM |
| `bonding_curve/src/instructions/purchase.rs` | 40 | `init_if_needed` on user ATA — Anchor discriminator check prevents true reinitialization | LOW |
| `staking/src/instructions/stake.rs` | 44 | `init_if_needed` on UserStake — guarded by owner==default check | LOW |

### CPI — invoke, invoke_signed, program_id checks

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `tax-program/src/instructions/swap_sol_sell.rs` | 235, 302, 324, 339, 377, 390, 406, 438, 464 | 9 raw CPI calls — program IDs validated via constants, not account constraints | HIGH |
| `epoch-program/src/helpers/carnage_execution.rs` | 513, 567, 586, 806, 889 | 5 raw `invoke_signed` calls including manual burn instruction construction | HIGH |
| `tax-program/src/instructions/swap_sol_buy.rs` | 128, 166, 180, 197, 304 | 5 raw `invoke_signed` — system transfers + AMM CPI | HIGH |
| `epoch-program/src/instructions/trigger_epoch_transition.rs` | 221 | `invoke_signed` for bounty transfer | HIGH |
| `epoch-program/src/instructions/consume_randomness.rs` | 255 | `invoke_signed` to Staking Program | HIGH |
| `bonding_curve/src/instructions/purchase.rs` | 268 | `invoke_signed` for Token-2022 transfer_checked | HIGH |
| `amm/src/helpers/transfers.rs` | 119 | `invoke_signed` for SPL token transfer | HIGH |
| `conversion-vault/src/helpers/hook_helper.rs` | 83 | `invoke_signed` for Token-2022 transfer with hook | HIGH |
| `staking/src/helpers/transfer.rs` | 83 | `invoke_signed` for SPL transfer | HIGH |
| All invoke_signed sites | various | **Program ID validation:** All are validated via hardcoded constants or Anchor `address =` constraints on the program account. No bare unvalidated `program_id` fields found. | MEDIUM |
| `tax-program/src/instructions/swap_sol_sell.rs` | 289–299 | SPL Token Transfer built with raw byte `3u8` discriminator — fragile if SPL instruction layout changes | MEDIUM |
| `epoch-program/src/helpers/carnage_execution.rs` | 497 | Burn instruction built with raw byte `8u8` discriminator | MEDIUM |

### TOKEN — transfer, mint_to, burn, token_program, associated_token

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `epoch-program/src/helpers/carnage_execution.rs` | 500–508 | Burn authority is `carnage_state` PDA — passed as `AccountMeta::new_readonly(..., true)` (is_signer=true); signed via `invoke_signed` with carnage_state seeds; correct but non-standard | HIGH |
| `bonding_curve/src/instructions/sell.rs` | 242–257 | Token-2022 transfer hook accounts iterated from remaining_accounts — no per-account owner checks | HIGH |
| `bonding_curve/src/instructions/purchase.rs` | 248–263 | Same pattern as sell | HIGH |
| `staking/src/instructions/stake.rs` | 141 | Hook accounts from remaining_accounts — delegated to Token-2022 | MEDIUM |
| `staking/src/instructions/unstake.rs` | 205 | Hook accounts from remaining_accounts | MEDIUM |
| All `mint_to` / `burn` calls | — | All Token operations go through Anchor's `CpiContext` or explicit `invoke_signed`; authorities are PDA-controlled | LOW |

### ORACLE — Switchboard, VRF, randomness

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `epoch-program/src/instructions/trigger_epoch_transition.rs` | 168, 174 | `try_borrow_data()` + `RandomnessAccountData::parse()` on external oracle account; `saturating_sub` on freshness check | MEDIUM |
| `epoch-program/src/instructions/retry_epoch_vrf.rs` | 78, 83 | Same `try_borrow_data` + `saturating_sub` freshness pattern | MEDIUM |
| `epoch-program/src/instructions/consume_randomness.rs` | 52 | `owner = SWITCHBOARD_PROGRAM_ID` constraint present — prevents fake randomness injection | LOW (correct) |
| `epoch-program/src/instructions/consume_randomness.rs` | 155 | `randomness_account.key() == pending_randomness_account` — anti-reroll enforced | LOW (correct) |
| `epoch-program/src/instructions/trigger_epoch_transition.rs` | 174 | **Freshness underflow:** `clock.slot.saturating_sub(seed_slot)` returns 0 if clock < seed_slot (future-dated oracle); 0 passes `< MAX_RANDOMNESS_STALENESS`; attacker with future-dated seed passes freshness | HIGH |

### ADMIN — upgrade, authority, admin, set_authority

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `tax-program/src/constants.rs` | 146–148 | `treasury_pubkey()` in production (non-devnet, non-localnet) returns `8kPzh...` (devnet deployer wallet), NOT the mainnet treasury `3ihhw...`. Tax revenue on mainnet goes to devnet wallet, not dedicated treasury. | CRITICAL |
| All programs | varies | `program_data.upgrade_authority_address == Some(authority.key())` — upgrade authority check on all initialize_admin/initialize_ instructions; correct pattern | LOW (correct) |
| `bonding_curve/src/instructions/burn_bc_admin.rs` | 21 | `admin_config.authority = Pubkey::default()` — burns admin; constrained by current authority signer | LOW |
| `amm/src/instructions/burn_admin.rs` | 22 | Same pattern | LOW |
| `epoch-program/src/instructions/force_carnage.rs` | 19 | Hardcoded `DEVNET_ADMIN` pubkey — feature-gated, correct | LOW |

### TIMING — clock, slot, timestamp, deadline, expiry

| File | Line(s) | Issue | Risk |
|---|---|---|---|
| `epoch-program/src/instructions/trigger_epoch_transition.rs` | 174 | `saturating_sub` for freshness — future-dated seed_slot passes freshness (see ORACLE above) | HIGH |
| `staking/src/instructions/unstake.rs` | 127–129 | `unix_timestamp.checked_sub(last_claim_ts).unwrap_or(0)` — clock regression or manipulation yields 0 elapsed, bypassing cooldown | MEDIUM |
| `bonding_curve/src/instructions/mark_failed.rs` | 55–61 | `clock.slot > failure_eligible_slot` — strictly-greater-than; race window of 1 slot where mark_failed may be called slightly early | LOW |
| `bonding_curve/src/instructions/purchase.rs` | 109 | `clock.slot <= curve.deadline_slot` — deadline uses slot, not timestamp; appropriate for permissionless bonding curve | LOW |
| `staking/src/instructions/claim.rs` | 129 | `last_claim_ts = clock.unix_timestamp` — timestamp recorded; used for cooldown | LOW |

---

## 4. Notable Findings Requiring Manual Review

### CRITICAL: Treasury Pubkey Mismatch (ADMIN / HIGH)
**File:** `programs/tax-program/src/constants.rs` lines 146–148

The `#[cfg(not(any(feature = "devnet", feature = "localnet")))]` branch (the mainnet production build) returns:
```rust
Pubkey::from_str("8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4").unwrap()
```
This is the **devnet deployer wallet**, not the mainnet treasury (`3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv` per project memory). All buy/sell tax revenue on mainnet would flow to the deployer key rather than the dedicated treasury. The comment at line 133 says "Replace Pubkey::default()" but the actual default is NOT Pubkey::default().

### HIGH: `.unwrap() as u64` on checked arithmetic chain
**Files:**
- `epoch-program/src/instructions/execute_carnage_atomic.rs` lines 255, 272, 284
- `epoch-program/src/instructions/execute_carnage.rs` line 265

Pattern: `(expected as u128).checked_mul(BPS).and_then(|n| n.checked_div(10_000)).unwrap() as u64`

The `.unwrap()` will **panic on-chain** if the checked chain returns `None`. With `expected` as u64 and BPS ≤ 10_000, the u128 intermediate cannot overflow (`u64::MAX × 10_000 < u128::MAX`), so the `.unwrap()` is practically safe — but it is not proven by a bound check and would panic rather than returning a clean error.

### HIGH: VRF Freshness Underflow (TIMING / ORACLE)
**File:** `epoch-program/src/instructions/trigger_epoch_transition.rs` line 174

`let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);`

If `seed_slot > clock.slot` (oracle reports a future seed slot), `saturating_sub` returns 0, which is less than `MAX_RANDOMNESS_STALENESS`, so the freshness check **passes**. An oracle that produces a future-dated seed_slot (even by 1 slot) bypasses the freshness window. This is a secondary trust assumption on Switchboard correctness, but worth confirming whether MAX_RANDOMNESS_STALENESS is ≤ 1 in which case 0 == "just created" and this is safe.

### HIGH: Optional CarnageState in ConsumeRandomness (STATE)
**File:** `epoch-program/src/instructions/consume_randomness.rs` line 80

`carnage_state: Option<Account<'info, CarnageFundState>>`

Anyone calling `consume_randomness` can omit `carnage_state`, causing the Carnage trigger check to be **silently skipped**. If Carnage was triggered by VRF randomness but the caller omits carnage_state, taxes update but Carnage is never queued. This may be by design ("backward compatibility") but creates a griefing vector where a MEV actor calls `consume_randomness` without carnage_state to skip Carnage triggering.

### HIGH: Remaining Accounts — No Per-Account Owner Checks
**Files:** All hook-account forwarding sites (purchase.rs, sell.rs, fund_curve.rs, swap_sol_buy.rs, swap_sol_sell.rs, execute_carnage.rs, execute_carnage_atomic.rs, staking stake/unstake)

`remaining_accounts` are passed through to Token-2022 CPIs without individual account owner validation. The `extra_account_meta_list` PDA derivation is validated inside Token-2022 itself (and the Transfer Hook program). This is standard Solana practice, but a sophisticated attacker could craft accounts with matching addresses but wrong owners if the hook program doesn't validate owners independently. Confirm Transfer Hook's `transfer_hook` instruction validates account ownership.

### MEDIUM: `stake_pool` Unconstrained in ConsumeRandomness
**File:** `epoch-program/src/instructions/consume_randomness.rs` line 65–66

```rust
#[account(mut)]
pub stake_pool: AccountInfo<'info>,
```
There is no `owner` constraint on `stake_pool` at the Epoch program level. The `update_cumulative` CPI to Staking Program validates it via its own account constraints, so it's protected — but a caller passing a fake account would succeed at the Epoch level and fail at the Staking CPI level. This is defense-in-depth gap only, not exploitable given Staking validates its own PDAs.

### MEDIUM: Manual Instruction Discriminators
**Files:** `swap_sol_sell.rs` line 297 (`3u8` = SPL Transfer), `carnage_execution.rs` line 497 (`8u8` = SPL Burn)

Raw byte discriminators for SPL Token instructions are hardcoded. These match the current SPL Token layout, but if SPL Token were to change instruction encoding (extremely unlikely but possible), these would silently send wrong instructions. Prefer using the SPL Token SDK helpers.

---

## 5. Patterns Confirmed Present but Correctly Handled

| Pattern | Where | Mitigation |
|---|---|---|
| `try_borrow_data()` on randomness | trigger/retry/consume | SDK `RandomnessAccountData::parse()` validates structure |
| `init_if_needed` | purchase.rs, stake.rs | Anchor discriminator check prevents reinitialization |
| `close = ` | Not found in source files | No closeable accounts that could be re-initialized |
| `realloc` | Not found | Not used |
| `unsafe {}` | Not found | Zero unsafe blocks |
| Program ID hardcoding | constants.rs | All cross-program IDs are in `constants.rs` and validated via `address =` constraints |
| Burn-to-default | burn_bc_admin.rs, burn_admin.rs | Constrained by current authority signer |
| Switchboard owner check | consume_randomness.rs:52 | `owner = SWITCHBOARD_PROGRAM_ID` constraint |
| Anti-reroll | consume_randomness.rs:155 | Exact pubkey match enforced |
| `force_carnage` devnet gate | epoch-program | `#[cfg(feature = "devnet")]` — not in mainnet IDL (verified by test at lib.rs:274-292) |

---

## 6. Recommended Audit Focus Order

1. **CRITICAL** — `tax-program/src/constants.rs:146–148`: Treasury pubkey in mainnet build
2. **HIGH** — `execute_carnage_atomic.rs:255,272,284` and `execute_carnage.rs:265`: `.unwrap() as u64`
3. **HIGH** — `trigger_epoch_transition.rs:174`: VRF freshness `saturating_sub` underflow
4. **HIGH** — `consume_randomness.rs:80`: Optional carnage_state skip vector
5. **HIGH** — All `remaining_accounts` hook forwarding: per-account owner validation
6. **HIGH** — `consume_randomness.rs:65`: `stake_pool` unconstrained at Epoch level
7. **MEDIUM** — `swap_sol_sell.rs:289–299` and `carnage_execution.rs:497`: raw discriminator bytes
8. **MEDIUM** — `staking/unstake.rs:127–129`: cooldown bypass on clock regression
9. **MEDIUM** — `carnage_execution.rs:470–481`: `held_token` raw u8 matching
10. **MEDIUM** — `bonding_curve/math.rs:225`: `unwrap_or(u64::MAX)` spot price saturation
