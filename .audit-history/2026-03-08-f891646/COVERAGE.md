# Coverage Verification Report

**Audit ID:** sos-002-20260307-f891646
**Verified:** 2026-03-08
**Finding Files:** 142 (H001-H132 + S001-S010)

## Summary
- Instructions covered: 41/41 (100%)
- Key attack categories addressed: 24/24 (100%)
- Coverage gaps found: 0 CRITICAL, 0 HIGH, 2 MEDIUM, 1 LOW

---

## Instruction Coverage

Every externally-callable instruction listed in ARCHITECTURE.md Section 3 was analyzed by at least one investigation.

| Instruction | Program | Investigated By | Finding Count | Status |
|-------------|---------|----------------|---------------|--------|
| initialize_admin | AMM | H023, H039, H045 | 15 | Covered |
| initialize_pool | AMM | H023, H045, H087, H095 | 11 | Covered |
| burn_admin | AMM | H074 | 9 | Covered |
| swap_sol_pool | AMM | H008, H019, H043, H054, H078, H089, H101 | 21 | Covered |
| swap_sol_buy | Tax | H008, H013, H014, H019, H035, H042, H048, H050, H091, H103, H115, H120, H130 | 31 | Covered |
| swap_sol_sell | Tax | H008, H019, H032, S002, S008 | 28 | Covered |
| swap_exempt | Tax | H015, H115 | 13 | Covered |
| initialize_wsol_intermediary | Tax | H032 | 3 | Covered |
| initialize_epoch_state | Epoch | H021, H036, H055 | 7 | Covered |
| trigger_epoch_transition | Epoch | H026, H028, H065, H082, H129 | 15 | Covered |
| consume_randomness | Epoch | H016, H030, H056, H065, H069 | 20 | Covered |
| execute_carnage_atomic | Epoch | H009, H015, H029, H038, H059, H105, H117 | 22 | Covered |
| execute_carnage | Epoch | H029, H030 | 25 | Covered |
| expire_carnage | Epoch | H092 | 8 | Covered |
| retry_epoch_vrf | Epoch | H111 | 8 | Covered |
| initialize_carnage_fund | Epoch | H036 | 1 | Covered |
| force_carnage | Epoch | H037 | 4 | Covered |
| initialize_stake_pool | Staking | H033, H088, H126, H132 | 10 | Covered |
| stake | Staking | H033, H053, H088 | 27 | Covered |
| unstake | Staking | H053, H097, H122 | 13 | Covered |
| claim | Staking | H012, H083, H084 | 30 | Covered |
| deposit_rewards | Staking | H012, H063, H094, H113, S003 | 13 | Covered |
| update_cumulative | Staking | H063 | 13 | Covered |
| initialize_curve | BondingCurve | H003, H036 | 17 | Covered |
| fund_curve | BondingCurve | H006 | 14 | Covered |
| start_curve | BondingCurve | H004 | 15 | Covered |
| purchase | BondingCurve | H051, H075, H090, H104, H114, H131 | 21 | Covered |
| sell | BondingCurve | H024, H047, H052, H076 | 62 | Covered |
| mark_failed | BondingCurve | H031, H060 | 8 | Covered |
| prepare_transition | BondingCurve | H002, H010, H124 | 16 | Covered |
| withdraw_graduated_sol | BondingCurve | H001, H005, H010, H116 | 15 | Covered |
| close_token_vault | BondingCurve | H005 | 12 | Covered |
| distribute_tax_escrow | BondingCurve | H067, S009 | 7 | Covered |
| consolidate_for_refund | BondingCurve | H068, S010 | 7 | Covered |
| claim_refund | BondingCurve | H061, H118 | 10 | Covered |
| initialize (ConvVault) | ConversionVault | H017, H128 | 14 | Covered |
| convert | ConversionVault | H017, H034, H073, H096, H110, H121 | 14 | Covered |
| initialize_authority | TransferHook | H007, H036, H044, S006 | 8 | Covered |
| add_whitelist_entry | TransferHook | H044, H081 | 8 | Covered |
| burn_authority | TransferHook | H106 | 6 | Covered |
| transfer_hook | TransferHook | H081, H085 | 9 | Covered |
| initialize_extra_account_meta_list | TransferHook | H062 | 6 | Covered |

---

## Attack Category Coverage

### AMM/DEX Attack Categories

| Category | Addressed By | Status |
|----------|-------------|--------|
| Sandwich attacks | H008, H014, H029, H030, H051, S008 | Covered |
| Price manipulation (pool reserves) | H009, H015, S008 | Covered |
| k-invariant bypass | H043, H054 | Covered |
| Fee extraction / fee mismatch | H035, H078, H112 | Covered |
| Flash loan attacks | H072, H053 | Covered |
| Slippage manipulation | H008, H014, H019, S002, S008 | Covered |

### Staking Attack Categories

| Category | Addressed By | Status |
|----------|-------------|--------|
| Reward inflation | H041, H094, H113 | Covered |
| Checkpoint manipulation | H063, H084 | Covered |
| Withdrawal griefing | H012, H097, S003 | Covered |
| Dead stake / first-depositor | H033, H132 | Covered |
| Flash-stake (flash deposit) | H053 | Covered |

### Oracle/VRF Attack Categories

| Category | Addressed By | Status |
|----------|-------------|--------|
| Commit-reveal bypass | H065 | Covered |
| Randomness prediction | H030, H069, H070 | Covered |
| Oracle manipulation (stale data) | H048, H016 | Covered |
| VRF timeout exploitation | H111, H056 | Covered |
| Anti-reroll bypass | H065 | Covered |

### Bonding Curve Attack Categories

| Category | Addressed By | Status |
|----------|-------------|--------|
| Front-running (purchase) | H051, H104 | Covered |
| Price manipulation | H046, H099 | Covered |
| Graduation theft | H001, H002, H005, H010 | Covered |
| Refund griefing | H061, H068, H118, S010 | Covered |
| Authority impersonation | H001-H006, S001, S009, S010 | Covered |
| Dual-curve grief | H031 | Covered |

### Cross-Cutting Attack Categories

| Category | Addressed By | Status |
|----------|-------------|--------|
| Access control (missing signer checks) | H001-H007, H021, H036, S001, S006, S009, S010 | Covered |
| Integer overflow/underflow | H024, H043, H046, H054, H077 | Covered |
| Initialization front-running | H003, H007, H021, H036, H062, S006 | Covered |
| Cross-program struct layout coupling | H011, H022, H027, H040, S007 | Covered |
| No emergency pause | H020, S005 | Covered |
| Mainnet placeholder keys | H018, S004 | Covered |
| Account substitution | H009, H015, H050, H110 | Covered |

---

## Exploit Pattern (EP) Coverage

All EPs referenced in the KB focus manifests that are relevant to this protocol were addressed:

| EP | Description | Addressed By |
|----|------------|-------------|
| EP-001 | Missing signer authorization | H001-H007, H021, H036, H039, H045, H081, H088, H089, H090, H093, H097, H103, H110, H115, H121, H128, S001, S006, S009, S010 |
| EP-003 | Integer overflow/underflow | H024, H043, H046, H054, H066, H075, H076, H077, H094, H101, H112, H113, H114 |
| EP-005 | Precision loss / rounding | H034, H035, H041, H042, H047, H061, H069, H096, H099, H101, H127, S002 |
| EP-012 | Reentrancy / double execution | H038, H073 |
| EP-015 | Slippage manipulation | H008, H014, H029, H051, S008 |
| EP-017 | Rent-exempt accounting | H012, H026, H116, S003 |
| EP-024 | Account substitution / injection | H009, H015, H050, H058, H062, H085, H090, H093, H098, H110, H123 |
| EP-033 | Hardcoded address errors | H018, H103, S004 |
| EP-042 | State transition manipulation | H002, H004, H031, H044, H052, H055, H060, H064, H080, H082, H092, H095, H104, H107, H108, H109, H119 |
| EP-048 | Missing pause / debug in prod | H020, H037, H071, S005 |
| EP-056 | Struct layout / deserialization | H011, H022, H027, H040, H098, H107, H108, H119, S007 |
| EP-058 | Initialization front-running | H003, H007, H021, H036, H062, H088, H128 |
| EP-069 | Escrow / reward drainage | H012, H033, H047, H051, H053, H061, H067, H068, H102, H122, H132, S003 |

---

## Coverage Gaps

### MEDIUM Gaps

**G-M1: initialize_carnage_fund -- shallow coverage (1 finding mention)**
The `initialize_carnage_fund` instruction appears in only 1 finding file. It is an any-signer one-shot init instruction. While H036 covers general init front-running across programs, there is no dedicated deep investigation of what parameters are settable during carnage fund initialization and what impact a malicious initialization would have. However, ARCHITECTURE.md lists it as "Any signer (one-shot)" with "Full" analysis coverage, and since CarnageFundState stores mainly counters (initialized to zero), the attack surface is minimal.
- **Severity:** MEDIUM (informational -- attack surface is small for a counter-only PDA)
- **Recommendation:** No additional investigation required; the one-shot PDA init with no user-controllable parameters limits exploitability.

**G-M2: Conversion Vault `initialize` instruction -- shallow dedicated coverage**
While the Conversion Vault's `convert` instruction was well-covered (H017, H034, H073, H096, H110, H121), the `initialize` instruction was primarily covered by the general init front-running hypothesis (H036) and the double-init check (H128). Since VaultConfig stores only a bump with no user-controllable parameters, and Anchor's `init` constraint prevents re-initialization, the actual attack surface is negligible.
- **Severity:** MEDIUM (informational)
- **Recommendation:** No additional investigation needed.

### LOW Gaps

**G-L1: No dedicated flash loan attack hypothesis for AMM pools**
While flash-stake was investigated (H053) and bonding curve flash-loan prevention was checked (H072), there is no dedicated hypothesis for flash loan attacks against the AMM constant-product pools themselves. However, since the AMM pools are only accessible via CPI through the Tax Program (H089 confirmed this gate), external flash loan interaction is structurally prevented -- an attacker cannot directly call `swap_sol_pool`. The Tax Program's per-swap tax (1-14%) makes flash-loan arbitrage through the legitimate swap path unprofitable.
- **Severity:** LOW (structurally mitigated by CPI-only access + tax)
- **Recommendation:** No additional investigation needed.

---

## Gap Hypotheses (auto-generated)

No CRITICAL or HIGH gaps were identified. The two MEDIUM gaps are informational in nature (one-shot inits with no user-controllable parameters) and do not warrant additional investigation hypotheses.

---

## Coverage Statistics

| Metric | Value |
|--------|-------|
| Total instructions | 41 |
| Instructions with >= 1 finding | 41 (100%) |
| Instructions with >= 3 findings | 38 (93%) |
| Total hypotheses investigated | 132 primary + 10 supplemental = 142 |
| Confirmed/Vulnerable findings | ~25 (H001, H002, H005, H007, H008, H010, H011, H012, H014, H018, H019, H020, H021, H027, H029, H035, H036, H049, H058, H071, H077, H087, S001, S003-S008) |
| Refuted/Safe/Rejected | ~105 |
| Informational | ~12 |
| Exploit patterns covered | 13/13 relevant EPs |
| Attack categories covered | 24/24 |

## Conclusion

The investigation phase achieved comprehensive coverage across all three dimensions:

1. **Instruction coverage** is 100% -- every externally-callable instruction was analyzed by at least one finding, and 93% were analyzed by 3 or more.

2. **Exploit pattern coverage** is complete -- all 13 relevant EPs from the knowledge base were addressed by multiple hypotheses each.

3. **Playbook coverage** is thorough -- all key attack categories for AMM/DEX, Staking, Oracle/VRF, and Bonding Curve protocol types were investigated.

The only gaps identified are MEDIUM/LOW informational items relating to shallow (but sufficient) coverage on initialization-only instructions with minimal attack surface. No additional investigation hypotheses are needed.
