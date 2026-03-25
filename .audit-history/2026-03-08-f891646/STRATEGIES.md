# Attack Strategies — Dr Fraudsworth Protocol

**Audit ID:** sos-002-20260307-f891646
**Generated:** 2026-03-07
**Source:** ARCHITECTURE.md synthesis + 9 context auditors + 8 verification agents + HANDOVER.md
**Tier:** Deep (100-150 strategies)

---

## Summary

| Priority | Count | Description |
|----------|-------|-------------|
| Tier 1 (CRITICAL) | 28 | Investigate first — highest potential impact |
| Tier 2 (HIGH) | 42 | Investigate second |
| Tier 3 (MEDIUM-LOW) | 62 | Investigate last |
| **Total** | **132** | |

| Origin | Count |
|--------|-------|
| RECHECK (previous confirmed) | 14 |
| RECHECK (previous potential) | 11 |
| Novel | 34 |
| KB (exploit patterns) | 48 |
| Playbook | 25 |

Novel: 34/132 = 25.8% (exceeds 20% requirement)

---

## Tier 1 — CRITICAL Priority (28)

### H001 — Bonding Curve Authority: withdraw_graduated_sol Theft
- **Category:** Access Control, Upgrade/Admin
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (multiple audit #1 + 5 agents in audit #2)
- **Hypothesis:** Any signer can call `withdraw_graduated_sol` and receive ~1000 SOL per graduated curve with zero on-chain identity verification.
- **Attack Vector:** Attacker calls `withdraw_graduated_sol` with themselves as `authority` signer. The instruction has no `has_one`, no ProgramData check, no stored admin comparison.
- **Target Code:** `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs`
- **Potential Impact:** CRITICAL — ~2000 SOL total theft (both curves). Direct fund loss.
- **Historical Precedent:** EP-001 (Missing signer authorization), Mango Markets unauthorized withdrawal
- **Requires:** [access-control-findings, upgrade-admin-findings]
- **Investigation Approach:** Read the instruction accounts struct. Verify if `authority` has any constraint beyond `Signer`. Check if PDA seeds or `has_one` are used. Test with an arbitrary wallet.

### H002 — Bonding Curve Authority: prepare_transition Forced Graduation
- **Category:** Access Control, State Machine
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK + Novel
- **Hypothesis:** Attacker forces premature curve graduation via `prepare_transition` to manipulate token pricing or trigger `withdraw_graduated_sol`.
- **Attack Vector:** Call `prepare_transition` as any signer once curve reaches Filled state. Bundle with immediate `withdraw_graduated_sol` in same TX.
- **Target Code:** `programs/bonding_curve/src/instructions/prepare_transition.rs`
- **Potential Impact:** CRITICAL — Premature graduation + SOL theft in atomic bundle.
- **Historical Precedent:** EP-001 + EP-042 (state transition manipulation)
- **Requires:** [access-control-findings, state-machine-findings]
- **Investigation Approach:** Verify state gate on prepare_transition. Check if Filled check is sufficient or if additional authority is needed. Test atomic bundle.

### H003 — Bonding Curve Authority: initialize_curve Impersonation
- **Category:** Access Control
- **Estimated Priority:** Tier 1
- **Origin:** KB (EP-001)
- **Hypothesis:** Attacker creates a fraudulent curve for an existing token mint, potentially stealing funds from users who buy.
- **Attack Vector:** Call `initialize_curve` with attacker as authority. If PDA seeds only use token_mint and no authority check, curve_state PDA is unique per mint — attacker can only create if official hasn't yet.
- **Target Code:** `programs/bonding_curve/src/instructions/initialize_curve.rs`
- **Potential Impact:** CRITICAL if front-runnable — users send SOL to attacker-controlled curve.
- **Historical Precedent:** EP-001, EP-058 (initialization front-running)
- **Requires:** [access-control-findings]
- **Investigation Approach:** Check CurveState PDA seeds. If `init` constraint uses `[b"curve", token_mint]` only, verify if front-running is possible. Check if authority is stored.

### H004 — Bonding Curve Authority: start_curve Premature Activation
- **Category:** Access Control, Timing
- **Estimated Priority:** Tier 1
- **Origin:** KB (EP-001)
- **Hypothesis:** Attacker starts a curve before it's properly funded, allowing purchases at incorrect prices.
- **Attack Vector:** Call `start_curve` with any signer. If curve is Initialized but not fully funded, purchases begin at wrong price.
- **Target Code:** `programs/bonding_curve/src/instructions/start_curve.rs`
- **Potential Impact:** HIGH-CRITICAL — Token pricing manipulation.
- **Historical Precedent:** EP-001
- **Requires:** [access-control-findings, state-machine-findings]
- **Investigation Approach:** Check state gate requirements beyond authority. Verify fund_curve enforces sufficient supply before start_curve succeeds.

### H005 — Bonding Curve Authority: close_token_vault Rent Extraction
- **Category:** Access Control
- **Estimated Priority:** Tier 1
- **Origin:** KB (EP-001)
- **Hypothesis:** Attacker closes token vault to extract rent lamports and potentially strand remaining tokens.
- **Attack Vector:** Call `close_token_vault` as any signer on a graduated curve. Receives rent-exempt lamports.
- **Target Code:** `programs/bonding_curve/src/instructions/close_token_vault.rs`
- **Potential Impact:** MEDIUM-HIGH — Rent extraction + potential DoS on refund path.
- **Historical Precedent:** EP-001, EP-017 (account closure attacks)
- **Requires:** [access-control-findings, token-economic-findings]
- **Investigation Approach:** Verify state constraints. Check if vault closure affects refund ability. Calculate rent-exempt amounts.

### H006 — Bonding Curve Authority: fund_curve Token Injection
- **Category:** Access Control, Token/Economic
- **Estimated Priority:** Tier 1
- **Origin:** KB (EP-001)
- **Hypothesis:** Attacker injects tokens into curve or modifies funding parameters by calling fund_curve.
- **Attack Vector:** Call `fund_curve` with unexpected token amounts. Could over-fund to manipulate price curve or drain attacker's own tokens into protocol.
- **Target Code:** `programs/bonding_curve/src/instructions/fund_curve.rs`
- **Potential Impact:** MEDIUM — Price manipulation if curve math depends on initial supply.
- **Historical Precedent:** EP-001
- **Requires:** [access-control-findings, arithmetic-findings]
- **Investigation Approach:** Check if fund_curve has idempotency guards or amount caps. Verify state transition from Initialized -> Funded.

### H007 — Transfer Hook Init Front-Running: Authority Ransom
- **Category:** Access Control
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (S005 — NOT FIXED)
- **Hypothesis:** Attacker front-runs `initialize_authority` to capture whitelist control, then ransoms the protocol by refusing to whitelist required accounts.
- **Attack Vector:** Monitor mempool for deploy TX. Submit `initialize_authority` TX with attacker address before legitimate deploy completes.
- **Target Code:** `programs/transfer-hook/src/lib.rs` (initialize_authority instruction)
- **Potential Impact:** CRITICAL — All CRIME/FRAUD transfers brick until attacker cooperates. Protocol DOA.
- **Historical Precedent:** EP-058 (initialization front-running), Wormhole init exploit
- **Requires:** [access-control-findings, upgrade-admin-findings]
- **Investigation Approach:** Verify first-caller-wins pattern. Check if `init` constraint on WhitelistAuthority PDA has any authority validation. Confirm S005 still NOT FIXED.

### H008 — Sell Path AMM minimum_amount_out=0 Sandwich
- **Category:** Timing, CPI, Token/Economic
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (S010 — PARTIAL), 3 agents flagged
- **Hypothesis:** Tax Program passes `minimum_amount_out=0` to AMM on sell path. Despite 50% output floor, gap between 50% floor and user's actual minimum is extractable via MEV.
- **Attack Vector:** Sandwich sell TX: front-run to move price, victim gets between 50%-100% of expected, attacker back-runs to profit. The 50% floor limits max extraction to ~50% per TX.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_sell.rs` (CPI call to AMM)
- **Potential Impact:** HIGH — Up to 50% value extraction per sell transaction.
- **Historical Precedent:** EP-015 (slippage manipulation), numerous DEX sandwich attacks
- **Requires:** [timing-findings, cpi-findings, token-economic-findings]
- **Investigation Approach:** Trace sell flow: user minimum -> tax computation -> AMM CPI call. Verify minimum_amount_out passed to AMM. Calculate extractable range between floor and user minimum.

### H009 — Pool Reserve Read Without Owner Check (Carnage)
- **Category:** CPI, Oracle
- **Estimated Priority:** Tier 1
- **Origin:** KB (EP-024), 2 agents flagged
- **Hypothesis:** `execute_carnage` reads pool reserves at byte offsets 137-153 without verifying the account is owned by AMM program. Spoofed account → invalid slippage floor → value extraction.
- **Attack Vector:** Pass a fake AccountInfo with inflated reserves at the correct byte offsets. Slippage floor calculation uses inflated values, while real swap executes against actual (lower) pool.
- **Target Code:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`, `programs/tax-program/src/helpers/pool_reader.rs`
- **Potential Impact:** HIGH — Carnage fund value extracted via spoofed slippage.
- **Historical Precedent:** EP-024 (account substitution), EP-056 (raw byte read exploitation)
- **Requires:** [cpi-findings, oracle-findings]
- **Investigation Approach:** Check if pool AccountInfo has `owner` constraint in accounts struct. Verify `read_pool_reserves` validates account ownership. Check remaining_accounts vs named accounts.

### H010 — Graduation MEV Bundle: Atomic Theft
- **Category:** Access Control, Timing, State Machine
- **Estimated Priority:** Tier 1
- **Origin:** Novel (ARCHITECTURE.md novel observation #1)
- **Hypothesis:** Attacker bundles `prepare_transition` + 2x `withdraw_graduated_sol` (CRIME + FRAUD) in a single TX to atomically steal ~2000 SOL.
- **Attack Vector:** Monitor both curves approaching Filled. Bundle: (1) prepare_transition for CRIME, (2) withdraw_graduated_sol for CRIME, (3) prepare_transition for FRAUD, (4) withdraw_graduated_sol for FRAUD. All in one TX if instruction limit allows.
- **Target Code:** `programs/bonding_curve/src/instructions/prepare_transition.rs`, `withdraw_graduated_sol.rs`
- **Potential Impact:** CRITICAL — ~2000 SOL atomic theft.
- **Historical Precedent:** Novel — specific to dual bonding curve graduation
- **Requires:** [access-control-findings, timing-findings, state-machine-findings]
- **Investigation Approach:** Verify instruction count fits in single TX (compute budget). Check if prepare_transition outputs Graduated state that same-TX withdraw_graduated_sol can consume.

### H011 — EpochState Cross-Program Layout Corruption
- **Category:** CPI, State Machine, Arithmetic
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H060), 4 agents flagged
- **Hypothesis:** Tax Program's EpochState mirror struct reads stale or misaligned byte offsets, producing wrong tax rates or reserve values after any Epoch Program layout change.
- **Attack Vector:** Not active attack — triggered by protocol upgrades. But if exploited: wrong tax rates applied, potentially zero tax (full value extraction) or max tax (user loss).
- **Target Code:** `programs/tax-program/src/helpers/pool_reader.rs`, epoch_state mirror in tax program
- **Potential Impact:** HIGH — Silent data corruption → wrong tax rates, broken slippage floors.
- **Historical Precedent:** EP-056 (struct layout coupling), multiple cross-program deserialization bugs
- **Requires:** [cpi-findings, arithmetic-findings, state-machine-findings]
- **Investigation Approach:** Compare EpochState struct field order/sizes between epoch-program and tax-program mirror. Check byte offsets match current layout. Verify after pool.rs modifications.

### H012 — Staking Escrow Rent Depletion (PDA Destruction)
- **Category:** Token/Economic, Staking
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (S001 — NOT FIXED)
- **Hypothesis:** Last reward claimer drains escrow below rent-exempt minimum, destroying the PDA. Next `deposit_rewards` CPI fails, halting all tax distribution.
- **Attack Vector:** Claim rewards until escrow balance equals rent-exempt + dust. Claim final dust to push below minimum. Solana runtime garbage-collects the account.
- **Target Code:** `programs/staking/src/instructions/claim.rs`
- **Potential Impact:** HIGH — All swap tax distribution permanently halted. Protocol revenue stops.
- **Historical Precedent:** EP-017 (rent-exempt accounting), EP-069 (escrow drainage)
- **Requires:** [token-economic-findings, staking-findings]
- **Investigation Approach:** Check claim.rs for rent-exempt minimum guard. Verify if `transfer` allows draining below rent minimum. Calculate minimum escrow to trigger failure.

### H013 — Buy Path Tax Math: Did Fix for H041 Actually Work?
- **Category:** Arithmetic
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H041)
- **Hypothesis:** Previous finding H041 flagged incorrect tax fee calculation. The fix uses u128 correctly now, but verify no regression in the modified code.
- **Attack Vector:** If tax math still has precision errors, could undertax (protocol revenue loss) or overtax (user loss).
- **Target Code:** `programs/tax-program/src/helpers/tax_math.rs`, `swap_sol_buy.rs`
- **Potential Impact:** HIGH — Incorrect tax collection.
- **Historical Precedent:** H041 (previous audit)
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Read current tax_math.rs. Verify u128 intermediate calculations. Check for truncation in final `as u64` cast. Proptest coverage status.

### H014 — Slippage Bypass on Buy Path
- **Category:** Timing, Token/Economic
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (S010)
- **Hypothesis:** Buy path slippage protection may be insufficient or bypassable. Previous S010 was partially mitigated with 50% floor.
- **Attack Vector:** Sandwich attack on buy path. Check if 50% output floor applies on buy side or only sell side.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs`
- **Potential Impact:** HIGH — Up to 50% value extraction on buys.
- **Historical Precedent:** S010, EP-015
- **Requires:** [timing-findings, token-economic-findings]
- **Investigation Approach:** Trace buy flow. Identify where minimum_amount_out is checked. Compare buy vs sell path protections.

### H015 — Carnage Two-Account Oracle Manipulation
- **Category:** CPI, Oracle
- **Estimated Priority:** Tier 1
- **Origin:** Novel (ARCHITECTURE.md novel observation #2)
- **Hypothesis:** Provide fake pool AccountInfo for slippage check (inflated reserves) while real pool used for CPI swap. Slippage floor becomes ineffective.
- **Attack Vector:** If pool state for slippage read and pool state for CPI swap are separate account parameters, pass spoofed read account + real swap account.
- **Target Code:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- **Potential Impact:** HIGH — Carnage fund value extraction.
- **Historical Precedent:** Novel — dual-account oracle spoofing
- **Requires:** [cpi-findings, oracle-findings]
- **Investigation Approach:** Check if same pool account is used for both slippage read and CPI swap. Verify account identity between the two operations.

### H016 — Cross-Epoch Tax Arbitrage via VRF Observation
- **Category:** Oracle, Economic Model, Timing
- **Estimated Priority:** Tier 1
- **Origin:** Novel (ARCHITECTURE.md novel observation #3)
- **Hypothesis:** Attacker monitors Switchboard reveal TX, predicts new tax rates, executes trades at old (favorable) rates before `consume_randomness` lands.
- **Attack Vector:** Observer sees VRF reveal bytes on-chain. Computes what new tax rate will be. If new rate is higher, buys at old (lower) rate. If lower, waits. Front-runs consume_randomness.
- **Target Code:** `programs/epoch-program/src/instructions/consume_randomness.rs`, `programs/tax-program/src/instructions/swap_sol_buy.rs`
- **Potential Impact:** MEDIUM-HIGH — Tax rate arbitrage per epoch transition.
- **Historical Precedent:** Novel — unique to per-epoch asymmetric tax design
- **Requires:** [oracle-findings, economic-model-findings, timing-findings]
- **Investigation Approach:** Check if VRF reveal bytes are visible before consume_randomness processes them. Determine if old rates still apply during VRF pending state.

### H017 — Conversion Vault Whitelist Dependency
- **Category:** Access Control, Token/Economic
- **Estimated Priority:** Tier 1
- **Origin:** Novel (ARCHITECTURE.md assumption A-8)
- **Hypothesis:** If conversion vault accounts aren't whitelisted before transfer hook authority is burned, all vault conversions permanently brick.
- **Attack Vector:** Not an active attack — deployment ordering failure. But if exploited by front-running authority capture (S005), attacker can selectively whitelist.
- **Target Code:** `programs/conversion-vault/src/instructions/convert.rs`, transfer-hook whitelist
- **Potential Impact:** CRITICAL — Permanent bricking of CRIME/FRAUD <-> PROFIT conversion.
- **Historical Precedent:** Novel — interaction between whitelist and authority burn
- **Requires:** [access-control-findings, token-economic-findings]
- **Investigation Approach:** Check deployment scripts for whitelist ordering. Verify vault token accounts are in whitelist. Check if authority burn is irreversible.

### H018 — Mainnet Pubkey::default() Placeholders
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK, 3 agents flagged
- **Hypothesis:** 8+ `Pubkey::default()` placeholders across 3 programs will cause mainnet failures or security holes if not replaced.
- **Attack Vector:** If mainnet-deployed with Pubkey::default(), hardcoded addresses resolve to 1111..1111 (system program). Swaps to wrong addresses, constraint failures, or fund loss.
- **Target Code:** Tax Program, Bonding Curve, Conversion Vault constants.rs files
- **Potential Impact:** CRITICAL — Protocol non-functional or funds sent to system program.
- **Historical Precedent:** EP-033 (hardcoded address errors)
- **Requires:** [upgrade-admin-findings]
- **Investigation Approach:** Grep for `Pubkey::default()` or `"11111111111111111111111111111111"` in non-test Rust source. Catalog all instances. Verify replacement mechanism exists.

### H019 — AMM Slippage Check Ordering (H043 Recheck)
- **Category:** Arithmetic, Timing
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H043 — observation shifted)
- **Hypothesis:** AMM slippage check ordering is correct, but caller (Tax Program) passes wrong minimum. Verify the shifted observation.
- **Attack Vector:** If Tax passes pre-tax amount as minimum to AMM but AMM receives post-tax amount, slippage check is ineffective.
- **Target Code:** `programs/amm/src/instructions/swap_sol_pool.rs`, Tax Program CPI calls
- **Potential Impact:** HIGH — Slippage protection bypass.
- **Historical Precedent:** H043
- **Requires:** [arithmetic-findings, timing-findings]
- **Investigation Approach:** Trace minimum_amount_out from user input through Tax to AMM CPI. Verify what amount is checked against what.

### H020 — No Emergency Pause Mechanism
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK, 3 agents flagged
- **Hypothesis:** Zero pause/freeze/emergency mechanisms across all 7 programs. If exploit discovered post-launch, no circuit breaker exists.
- **Attack Vector:** Post-launch exploit scenario: attacker discovers and exploits vulnerability. Protocol team has no way to halt operations except program upgrade (which requires full rebuild + deploy).
- **Target Code:** All 7 programs (AMM, Tax, Epoch, Staking, BC, Vault, Hook)
- **Potential Impact:** HIGH — Extended exploitation window during incident response.
- **Historical Precedent:** EP-048 (no pause mechanism), numerous DeFi exploits where pause would have limited damage
- **Requires:** [upgrade-admin-findings]
- **Investigation Approach:** Verify no pause flag exists in any program state. Check if program upgrade is feasible as emergency response. Document response time requirements.

### H021 — Epoch Init Front-Running (H057 Recheck)
- **Category:** Access Control
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H057 — NOT FIXED)
- **Hypothesis:** `initialize_epoch_state` accepts any signer with no authority check. Front-runner could initialize with malicious parameters.
- **Attack Vector:** Front-run epoch state initialization to set invalid initial values. Impact depends on what parameters are user-controlled vs hardcoded.
- **Target Code:** `programs/epoch-program/src/instructions/initialize_epoch_state.rs`
- **Potential Impact:** MEDIUM-HIGH — Depends on initializable parameters.
- **Historical Precedent:** H057, EP-058
- **Requires:** [access-control-findings]
- **Investigation Approach:** Read initialize_epoch_state instruction. Check which fields are caller-provided vs hardcoded. Assess impact of malicious initialization.

### H022 — Pool State Byte Offset Stability (A-5 Recheck)
- **Category:** CPI, Arithmetic
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (assumption A-5), verification NEEDS_RECHECK
- **Hypothesis:** Pool.rs was MODIFIED since audit #1. Byte offsets 137-153 used for reserve reads may no longer be correct.
- **Attack Vector:** If offsets shifted, pool_reader.rs reads wrong fields as reserves. Slippage calculations use garbage data.
- **Target Code:** `programs/amm/src/state/pool.rs`, `programs/tax-program/src/helpers/pool_reader.rs`
- **Potential Impact:** HIGH — Wrong slippage calculations, potential value extraction.
- **Historical Precedent:** EP-056
- **Requires:** [cpi-findings, arithmetic-findings]
- **Investigation Approach:** Calculate current PoolState layout byte-by-byte. Verify offsets 137-153 still correspond to reserve_a and reserve_b. Compare with pool_reader.rs constants.

### H023 — Unauthorized Pool Creation (H125 Recheck)
- **Category:** Access Control
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H125 — FIXED)
- **Hypothesis:** Verify that the `has_one admin` constraint fix for pool creation actually works.
- **Attack Vector:** Attempt to create pool without admin authorization.
- **Target Code:** `programs/amm/src/instructions/initialize_pool.rs`
- **Potential Impact:** MEDIUM — Unauthorized pool creation.
- **Historical Precedent:** H125
- **Requires:** [access-control-findings]
- **Investigation Approach:** Verify has_one constraint on AdminConfig in initialize_pool accounts struct.

### H024 — Bonding Curve Sell Tax u64 Precision
- **Category:** Arithmetic
- **Estimated Priority:** Tier 1
- **Origin:** KB (EP-003), audit #2 arithmetic agent
- **Hypothesis:** Bonding curve sell tax uses u64 (not u128 like other calculations). For large values, multiplication overflow possible.
- **Attack Vector:** Purchase maximum tokens then sell. If sell tax computation overflows u64, could wrap to small value → near-zero tax.
- **Target Code:** `programs/bonding_curve/src/instructions/sell.rs`
- **Potential Impact:** HIGH — Tax evasion on bonding curve sells.
- **Historical Precedent:** EP-003 (integer overflow), EP-005 (precision loss)
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check sell tax calculation. Determine max possible product of (amount * tax_bps). Verify if it exceeds u64::MAX. Check for checked_mul.

### H025 — Mint Authority Burn Verification (H113 Recheck)
- **Category:** Token/Economic
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H113 — RESOLVED)
- **Hypothesis:** Verify mint authority burn in initialize.ts actually executes and is irreversible.
- **Attack Vector:** If mint authority not burned or burn TX can be replayed, infinite token minting possible.
- **Target Code:** `scripts/deploy/initialize.ts` (burn_authority call)
- **Potential Impact:** CRITICAL — Infinite token supply.
- **Historical Precedent:** H113
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check initialize.ts for set_authority to None for all 3 mints. Verify on devnet that mint authorities are actually None.

### H026 — Bounty Rent-Exempt Gap (H001 Recheck)
- **Category:** Token/Economic, Timing
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H001 — PARTIALLY MITIGATED)
- **Hypothesis:** `trigger_epoch_transition` bounty transfer may still drain vault below rent-exempt minimum despite partial mitigation.
- **Attack Vector:** Repeated epoch transitions drain carnage vault lamports via bounty payments until below rent minimum.
- **Target Code:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`
- **Potential Impact:** MEDIUM — Epoch transition mechanism breaks.
- **Historical Precedent:** H001
- **Requires:** [token-economic-findings, timing-findings]
- **Investigation Approach:** Check current bounty logic. Verify "skip when insufficient" guard. Calculate if edge case still allows draining below rent.

### H027 — EpochState No Padding (H060 Expanded)
- **Category:** State Machine, Upgrade/Admin
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H060 — STILL PRESENT + EXPANDED)
- **Hypothesis:** EpochState at exactly 100 bytes with no padding. Any field addition requires migration or breaks all cross-program reads.
- **Attack Vector:** Not direct attack — architectural fragility. But forces zero-downtime migration if any field added.
- **Target Code:** `programs/epoch-program/src/state/epoch_state.rs`
- **Potential Impact:** MEDIUM — Schema evolution blocked without migration.
- **Historical Precedent:** H060, EP-056
- **Requires:** [state-machine-findings, upgrade-admin-findings]
- **Investigation Approach:** Verify current EpochState size. Check if any padding exists. Document impact on all cross-program readers.

### H028 — Epoch Transition Timing (H064 Recheck)
- **Category:** Timing
- **Estimated Priority:** Tier 1
- **Origin:** RECHECK (H064 — MAINTAINED AT MEDIUM)
- **Hypothesis:** Epoch transition timing logic may have edge cases around slot boundaries or concurrent transitions.
- **Attack Vector:** Trigger epoch transition at exact boundary slot. Check for off-by-one in epoch length calculation.
- **Target Code:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`
- **Potential Impact:** MEDIUM — Double transition or skipped epoch.
- **Historical Precedent:** H064
- **Requires:** [timing-findings]
- **Investigation Approach:** Read epoch transition timing logic. Check slot comparisons for off-by-one. Verify concurrent transition prevention.

---

## Tier 2 — HIGH Priority (42)

### H029 — Carnage Fallback Path MEV Sandwich
- **Category:** Timing, Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-015), 3 agents flagged
- **Hypothesis:** After 50-slot atomic lock expires, `execute_carnage` fallback path is sandwichable. 75-85% slippage floor still leaves 15-25% extractable.
- **Attack Vector:** Wait for lock expiry. Sandwich the fallback carnage TX: front-run to skew pool, carnage executes at floor price, back-run to profit.
- **Target Code:** `programs/epoch-program/src/instructions/execute_carnage.rs`
- **Potential Impact:** MEDIUM-HIGH — 15-25% of carnage fund value extracted per event.
- **Historical Precedent:** EP-015, numerous DEX sandwich attacks
- **Requires:** [timing-findings, token-economic-findings]
- **Investigation Approach:** Check fallback path slippage parameters. Calculate maximum extractable value at 75% floor. Determine if atomic path mitigates.

### H030 — VRF Predictability Window
- **Category:** Oracle, Timing
- **Estimated Priority:** Tier 2
- **Origin:** Novel (ARCHITECTURE.md novel observation #6)
- **Hypothesis:** VRF reveal bytes are public on Switchboard before `consume_randomness` processes them. MEV bot front-runs carnage swaps.
- **Attack Vector:** Monitor Switchboard for VRF reveal TX. Determine if carnage will trigger (4.3% chance). If yes, front-run carnage swap.
- **Target Code:** `programs/epoch-program/src/instructions/consume_randomness.rs`
- **Potential Impact:** MEDIUM — Front-run carnage swaps.
- **Historical Precedent:** Novel — VRF reveal timing window
- **Requires:** [oracle-findings, timing-findings]
- **Investigation Approach:** Check VRF commit-reveal timing. Determine if reveal bytes are visible before consume_randomness. Calculate front-running window in slots.

### H031 — Dual-Curve Grief Attack
- **Category:** State Machine, Timing
- **Estimated Priority:** Tier 2
- **Origin:** Novel (ARCHITECTURE.md novel observation #4)
- **Hypothesis:** Strategically prevent one curve from filling (sell near deadline) to force both curves into refund mode. Costs only gas.
- **Attack Vector:** Buy tokens on both curves. Near deadline, sell significant amount from one curve to prevent it from reaching Filled. If both must graduate together, the other curve also fails.
- **Target Code:** `programs/bonding_curve/src/instructions/sell.rs`, `mark_failed.rs`
- **Potential Impact:** MEDIUM-HIGH — Protocol launch DoS. All curve buyers must claim refunds.
- **Historical Precedent:** Novel — dual-curve interaction grief
- **Requires:** [state-machine-findings, timing-findings]
- **Investigation Approach:** Check if curves are independent or coupled. Verify if one failing forces the other to fail. Calculate cost to prevent filling.

### H032 — WSOL Intermediary DoS Vector
- **Category:** CPI, Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** Novel (ARCHITECTURE.md novel observation #7)
- **Hypothesis:** If swap_authority PDA lamports drained below rent-exempt for intermediary recreation, all sell operations halt.
- **Attack Vector:** If intermediary WSOL account created with init_if_needed each sell, and swap_authority PDA funds the rent, draining the PDA halts sells.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_sell.rs`, `initialize_wsol_intermediary.rs`
- **Potential Impact:** MEDIUM-HIGH — All sell operations DoS'd.
- **Historical Precedent:** Novel — WSOL intermediary as DoS vector
- **Requires:** [cpi-findings, token-economic-findings]
- **Investigation Approach:** Check how WSOL intermediary account is created/funded. Verify if swap_authority PDA can be drained. Check rent source.

### H033 — Staking First-Depositor Attack
- **Category:** Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-069)
- **Hypothesis:** First staker deposits 1 wei, gets rewards, dilutes second staker. Mitigated by dead stake — verify.
- **Attack Vector:** Deposit 1 lamport of PROFIT, wait for reward distribution, claim disproportionate share.
- **Target Code:** `programs/staking/src/instructions/stake.rs`
- **Potential Impact:** MEDIUM — Reward theft from other stakers.
- **Historical Precedent:** EP-069, ERC-4626 first depositor attacks
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Verify dead stake implementation. Check minimum stake enforcement. Calculate attack profitability with dead stake present.

### H034 — Conversion Vault Truncation Loss
- **Category:** Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-005), token-economic agent
- **Hypothesis:** 100:1 conversion ratio with integer division loses value for non-round amounts. Repeated small conversions maximize loss.
- **Attack Vector:** Convert 99 CRIME → 0 PROFIT (100% loss). Protocol keeps the 99 CRIME dust.
- **Target Code:** `programs/conversion-vault/src/instructions/convert.rs`
- **Potential Impact:** LOW-MEDIUM — User value loss on small conversions.
- **Historical Precedent:** EP-005 (rounding exploitation)
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check conversion math. Verify minimum amount validation. Calculate truncation loss scenarios.

### H035 — Tax Split BPS Mismatch
- **Category:** Arithmetic, Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-005), token-economic agent
- **Hypothesis:** Comments say 75/24/1 but code uses 71/24/5 (treasury/staking/carnage). Verify intended percentages.
- **Attack Vector:** Not direct attack — but if percentages don't sum to 100% or if treasury remainder calculation is wrong, funds lost.
- **Target Code:** `programs/tax-program/src/constants.rs`, `helpers/tax_math.rs`
- **Potential Impact:** MEDIUM — Incorrect fund distribution.
- **Historical Precedent:** EP-005
- **Requires:** [arithmetic-findings, token-economic-findings]
- **Investigation Approach:** Read constants.rs for BPS values. Verify they sum correctly. Check treasury = remainder pattern. Confirm 71+24+5=100.

### H036 — Init Front-Running: General (H003 Recheck)
- **Category:** Access Control
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H003 — POTENTIAL)
- **Hypothesis:** 5 programs use open initialization (any signer). Besides transfer hook (H007), check others.
- **Attack Vector:** Front-run initialization of epoch state, stake pool, carnage fund, vault config, or WSOL intermediary.
- **Target Code:** All initialization instructions across 5 programs
- **Potential Impact:** MEDIUM per program — varies by what parameters are settable.
- **Historical Precedent:** H003, EP-058
- **Requires:** [access-control-findings]
- **Investigation Approach:** Enumerate all init instructions. Check which accept arbitrary parameters vs hardcoded. Rank by impact if front-run.

### H037 — force_carnage Devnet Gate (H004 Recheck)
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H004 — POTENTIAL)
- **Hypothesis:** force_carnage is cfg(devnet)-gated. Verify gate works and instruction doesn't compile into mainnet binary.
- **Attack Vector:** If cfg gate fails, any admin can force carnage on mainnet. If DEVNET_ADMIN is compromised, devnet attacked.
- **Target Code:** `programs/epoch-program/src/instructions/force_carnage.rs`
- **Potential Impact:** MEDIUM — Forced carnage execution (24% of treasury drained to buy/burn).
- **Historical Precedent:** H004, EP-048 (debug functions in production)
- **Requires:** [upgrade-admin-findings]
- **Investigation Approach:** Verify #[cfg(feature = "devnet")] on force_carnage. Check Cargo.toml features. Build without devnet and verify instruction absent.

### H038 — Carnage Atomic Execution (H010 Recheck)
- **Category:** State Machine, Timing
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H010 — POTENTIAL)
- **Hypothesis:** `execute_carnage_atomic` has a 50-slot lock window. Verify lock implementation prevents concurrent execution.
- **Attack Vector:** Submit two execute_carnage_atomic TXs in same block/slot. If lock check has TOCTOU, double execution possible.
- **Target Code:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- **Potential Impact:** HIGH — Double carnage execution (double fund drainage).
- **Historical Precedent:** H010, EP-012 (reentrancy/double execution)
- **Requires:** [state-machine-findings, timing-findings]
- **Investigation Approach:** Check lock flag set/check ordering. Verify atomicity within Solana runtime (single-threaded per account).

### H039 — Admin Privilege Escalation (H037 Recheck)
- **Category:** Access Control, Upgrade/Admin
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H037 — POTENTIAL)
- **Hypothesis:** Check if AMM admin or any admin role can escalate to affect other programs.
- **Attack Vector:** AMM admin could potentially influence Tax Program behavior via pool state manipulation.
- **Target Code:** `programs/amm/src/instructions/initialize_pool.rs`, admin-gated instructions
- **Potential Impact:** MEDIUM — Cross-program privilege escalation.
- **Historical Precedent:** H037, EP-001
- **Requires:** [access-control-findings, upgrade-admin-findings]
- **Investigation Approach:** Map all admin capabilities. Check if any admin action can cascade to affect other programs.

### H040 — PoolState Struct Manipulation (H067 Recheck)
- **Category:** State Machine
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H067 — POTENTIAL)
- **Hypothesis:** Pool.rs was modified. Check if struct changes affect security properties.
- **Attack Vector:** If PoolState gained or lost fields, size changed, which shifts byte offsets for raw reads.
- **Target Code:** `programs/amm/src/state/pool.rs`
- **Potential Impact:** HIGH — Cascading byte offset errors.
- **Historical Precedent:** H067, EP-056
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Diff pool.rs from audit #1 to current. Calculate byte offsets. Verify cross-program readers updated.

### H041 — Staking Reward Precision Loss (H075 Recheck)
- **Category:** Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H075 — POTENTIAL)
- **Hypothesis:** Staking PRECISION=1e18 but reward computation may lose precision for small deposits or large reward pools.
- **Attack Vector:** Stake 1 token, accumulate rewards over many epochs. Check if rounding consistently favors protocol or user.
- **Target Code:** `programs/staking/src/helpers/math.rs`
- **Potential Impact:** MEDIUM — Reward under/over-payment.
- **Historical Precedent:** H075, EP-005
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check reward_per_token computation. Verify PRECISION prevents loss for minimum stake. Check rounding direction.

### H042 — Tax Math Rounding (H084 Recheck)
- **Category:** Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H084 — POTENTIAL)
- **Hypothesis:** Tax computation rounding may leak value or create dust accumulation.
- **Attack Vector:** Execute many small swaps. If rounding always favors user, protocol loses value. If always favors protocol, users overtaxed.
- **Target Code:** `programs/tax-program/src/helpers/tax_math.rs`
- **Potential Impact:** LOW-MEDIUM — Value leakage over time.
- **Historical Precedent:** H084, EP-005
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check floor/ceil usage in tax math. Verify remainder handling. Proptest coverage status for edge cases.

### H043 — Pool Reserve Overflow (H092 Recheck)
- **Category:** Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H092 — POTENTIAL)
- **Hypothesis:** Pool reserves stored as u64. Check if reserve * reserve (for k invariant) can overflow u128 during verification.
- **Attack Vector:** Deposit maximum reserve amounts. If k-invariant check uses u64 multiplication, overflow wraps to small value.
- **Target Code:** `programs/amm/src/instructions/swap_sol_pool.rs` (verify_k_invariant)
- **Potential Impact:** HIGH — k-invariant check bypassed via overflow.
- **Historical Precedent:** H092, EP-003
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check verify_k_invariant implementation. Verify u128 intermediate for k computation. Max value analysis for u64 reserves.

### H044 — Whitelist Entry State (H104 Recheck)
- **Category:** State Machine
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H104 — POTENTIAL)
- **Hypothesis:** WhitelistEntry is existence-based. Check if account can be closed and recreated, or if deletion removes transfer ability.
- **Attack Vector:** If whitelist entries can be removed, authority could revoke transfer ability for specific accounts.
- **Target Code:** `programs/transfer-hook/src/lib.rs` (add_whitelist_entry, transfer_hook)
- **Potential Impact:** MEDIUM — Selective transfer censorship.
- **Historical Precedent:** H104
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check if remove_whitelist_entry exists. Verify transfer_hook checks entry existence. Check if authority can censor.

### H045 — Pool Creation Authority Delegation (H124 Recheck)
- **Category:** Access Control
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H124 — POTENTIAL)
- **Hypothesis:** Can AMM admin delegate pool creation to another address?
- **Attack Vector:** If admin can update AdminConfig.admin to a new address, original admin loses control but new admin gains it.
- **Target Code:** `programs/amm/src/instructions/initialize_admin.rs`, AdminConfig
- **Potential Impact:** LOW-MEDIUM — Admin key rotation.
- **Historical Precedent:** H124
- **Requires:** [access-control-findings]
- **Investigation Approach:** Check if AdminConfig.admin field can be updated after initialization. Verify if burn_admin is the only admin modification.

### H046 — Bonding Curve Quadratic Math Overflow
- **Category:** Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-003)
- **Hypothesis:** Bonding curve uses quadratic formula with u128. Check if discriminant computation can overflow u128.
- **Attack Vector:** Purchase at extreme price points where quadratic discriminant b^2 - 4ac overflows u128.
- **Target Code:** `programs/bonding_curve/src/helpers/curve_math.rs`
- **Potential Impact:** HIGH — Incorrect token amount calculation, potential value extraction.
- **Historical Precedent:** EP-003 (integer overflow)
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check discriminant calculation bounds. Verify checked_mul/checked_add. Proptest coverage for edge values.

### H047 — Bonding Curve Integral Solvency
- **Category:** Arithmetic, Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-005)
- **Hypothesis:** BC vault must hold >= integral(0, tokens_sold) SOL for refund solvency. Check if sell operations can violate this.
- **Attack Vector:** Buy-sell-buy-sell cycles. Each sell removes SOL. Check if cumulative rounding errors erode vault below integral.
- **Target Code:** `programs/bonding_curve/src/instructions/sell.rs`, `purchase.rs`
- **Potential Impact:** HIGH — Refund insolvency.
- **Historical Precedent:** EP-005, EP-069
- **Requires:** [arithmetic-findings, token-economic-findings]
- **Investigation Approach:** Check post-sell solvency assertion. Verify proptest coverage (500K iterations noted). Review rounding direction.

### H048 — taxes_confirmed Unchecked by Tax Program
- **Category:** Oracle, State Machine
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-024), design choice documented
- **Hypothesis:** Tax Program doesn't check `taxes_confirmed` flag on EpochState. Swaps use stale rates during VRF window.
- **Attack Vector:** During VRF pending window, execute swaps at known (old) tax rate. If new rate would be higher, this is favorable.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs`, EpochState read
- **Potential Impact:** MEDIUM — Stale tax rate exploitation.
- **Historical Precedent:** EP-024 (oracle staleness)
- **Requires:** [oracle-findings, state-machine-findings]
- **Investigation Approach:** Verify this is documented design choice. Check if taxes_confirmed is read at all. Assess economic impact of stale rates.

### H049 — Cross-Program Upgrade Cascade
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 2
- **Origin:** Novel (ARCHITECTURE.md novel observation #8)
- **Hypothesis:** Fixing one program requires rebuilding all programs that reference its ID. Multi-step non-atomic upgrade creates inconsistency window.
- **Attack Vector:** During upgrade, program A references old ID of program B. Window of inconsistency allows CPI to old (potentially exploitable) version.
- **Target Code:** All cross-program ID references
- **Potential Impact:** MEDIUM — Upgrade-time exploit window.
- **Historical Precedent:** Novel — multi-program upgrade cascade
- **Requires:** [upgrade-admin-findings]
- **Investigation Approach:** Map all cross-program ID references. Determine upgrade ordering requirements. Assess inconsistency window.

### H050 — remaining_accounts Forwarding Without Validation
- **Category:** CPI
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-024)
- **Hypothesis:** Tax Program forwards remaining_accounts to AMM without application-level validation. Could inject unexpected accounts.
- **Attack Vector:** Pass extra accounts in remaining_accounts that change AMM behavior or token-2022 hook behavior.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs` (remaining_accounts)
- **Potential Impact:** MEDIUM — Unexpected account injection.
- **Historical Precedent:** EP-024 (account injection)
- **Requires:** [cpi-findings]
- **Investigation Approach:** Check how remaining_accounts are partitioned and forwarded. Verify AMM validates the accounts it receives.

### H051 — Bonding Curve Purchase Price Manipulation
- **Category:** Token/Economic, Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-069)
- **Hypothesis:** Linear bonding curve price = a * tokens_sold + b. Large purchase moves price significantly. Check if price impact is properly quoted.
- **Attack Vector:** Front-run legitimate buyer: buy to move price up, victim buys at higher price, attacker sells at profit.
- **Target Code:** `programs/bonding_curve/src/instructions/purchase.rs`
- **Potential Impact:** MEDIUM — MEV extraction on bonding curve.
- **Historical Precedent:** EP-015, bonding curve sandwich attacks
- **Requires:** [token-economic-findings, arithmetic-findings]
- **Investigation Approach:** Check if purchase has minimum_tokens_out parameter. Verify price impact calculation. Check for sandwich protection.

### H052 — Bonding Curve Sell During Active State
- **Category:** State Machine
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-042)
- **Hypothesis:** Can users sell during Active state? If sell removes SOL from vault and curve tracks tokens_sold, does tokens_sold decrease correctly?
- **Attack Vector:** Buy-sell cycles to manipulate tokens_sold counter or SOL vault balance.
- **Target Code:** `programs/bonding_curve/src/instructions/sell.rs`
- **Potential Impact:** MEDIUM — Price manipulation or insolvency.
- **Historical Precedent:** EP-042 (state transition manipulation)
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check sell state constraint. Verify tokens_sold decrements correctly. Check vault balance tracking.

### H053 — Staking unstake During Pending Rewards
- **Category:** Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-069)
- **Hypothesis:** User unstakes immediately after deposit_rewards to capture rewards with minimal stake duration.
- **Attack Vector:** Flash-stake: deposit large amount of PROFIT just before reward deposit, claim immediately after.
- **Target Code:** `programs/staking/src/instructions/unstake.rs`, `deposit_rewards.rs`
- **Potential Impact:** MEDIUM — Reward theft from long-term stakers.
- **Historical Precedent:** EP-069 (flash deposit attacks)
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check if Synthetix cumulative model prevents flash-stake. Verify reward checkpoint updates on stake/unstake.

### H054 — AMM k-Invariant Verification Bypass
- **Category:** Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-003)
- **Hypothesis:** verify_k_invariant checks k_after >= k_before. If calculation wraps or uses wrong precision, check could pass incorrectly.
- **Attack Vector:** Craft swap amounts where overflow in k computation makes k_after appear >= k_before despite actual decrease.
- **Target Code:** `programs/amm/src/instructions/swap_sol_pool.rs` (verify_k_invariant)
- **Potential Impact:** CRITICAL if bypassable — pool drain.
- **Historical Precedent:** EP-003, Curve Finance k-invariant bug
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check k computation for overflow. Verify u128 intermediates. Review proptest coverage (10K iterations).

### H055 — Epoch State Field Constraints (H106 Recheck)
- **Category:** State Machine
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H106 — PARTIALLY ADDRESSED)
- **Hypothesis:** Epoch state fields have comments but no range constraints. Values outside expected ranges could cause issues.
- **Attack Vector:** If epoch_length or tax rates stored outside expected ranges, downstream calculations fail.
- **Target Code:** `programs/epoch-program/src/state/epoch_state.rs`
- **Potential Impact:** LOW-MEDIUM — Unexpected behavior from invalid state values.
- **Historical Precedent:** H106
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check if state fields have validation on write. Verify lookup table constrains tax rates to [100-1400] BPS.

### H056 — Consume Randomness Edge Cases (H090 Recheck)
- **Category:** Oracle
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H090 — ADDRESSED with auto-expire)
- **Hypothesis:** Consume randomness auto-expire mechanism added. Verify edge cases around expiry boundary.
- **Attack Vector:** Submit consume_randomness at exact expiry slot. Check for off-by-one.
- **Target Code:** `programs/epoch-program/src/instructions/consume_randomness.rs`
- **Potential Impact:** LOW — Edge case in expiry logic.
- **Historical Precedent:** H090
- **Requires:** [oracle-findings]
- **Investigation Approach:** Check expiry slot comparison. Verify >= vs > in slot check.

### H057 — Epoch Constants Tuning (H119 Recheck)
- **Category:** Economic Model
- **Estimated Priority:** Tier 2
- **Origin:** RECHECK (H119 — NO NEW CONCERNS)
- **Hypothesis:** Verify epoch constants are reasonable for mainnet. Check epoch length, bounty amount, VRF timeout.
- **Attack Vector:** If epoch too short, VRF can't complete. If bounty too large, vault drains fast.
- **Target Code:** `programs/epoch-program/src/constants.rs`
- **Potential Impact:** LOW — Operational issues from poor tuning.
- **Historical Precedent:** H119
- **Requires:** [economic-model-findings]
- **Investigation Approach:** Read constants. Verify epoch_length > VRF_timeout. Check bounty vs expected vault balance.

### H058 — CPI Depth at Solana Limit
- **Category:** CPI
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-024)
- **Hypothesis:** CPI depth reaches exactly Solana's 4-level limit. Any additional CPI call in the chain would fail.
- **Attack Vector:** If token-2022 transfer hook adds a CPI level, max depth could be exceeded on some paths.
- **Target Code:** Full CPI chain: User -> Tax -> AMM -> Token-2022 -> Transfer Hook
- **Potential Impact:** MEDIUM — Transaction failures on certain paths.
- **Historical Precedent:** EP-024 (CPI depth issues)
- **Requires:** [cpi-findings]
- **Investigation Approach:** Map all CPI chains. Count depth levels. Verify transfer hook doesn't add depth beyond limit.

### H059 — Carnage Fund: held_token Selection Logic
- **Category:** Token/Economic, State Machine
- **Estimated Priority:** Tier 2
- **Origin:** Novel
- **Hypothesis:** CarnageFundState tracks held_token and held_amount. Logic selecting which token to buy/sell may have edge cases when both tokens are held.
- **Attack Vector:** Manipulate which token is "held" in carnage fund to force suboptimal buy/burn execution.
- **Target Code:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- **Potential Impact:** MEDIUM — Suboptimal carnage execution, value loss.
- **Historical Precedent:** Novel — dual-token carnage fund management
- **Requires:** [token-economic-findings, state-machine-findings]
- **Investigation Approach:** Check held_token selection logic. Verify state transitions when both tokens need processing.

### H060 — Bonding Curve mark_failed Timing
- **Category:** State Machine, Timing
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-042)
- **Hypothesis:** `mark_failed` is permissionless with deadline check. Verify deadline is correctly set and can't be manipulated.
- **Attack Vector:** If deadline_slot not properly initialized or can be modified, attacker forces premature failure.
- **Target Code:** `programs/bonding_curve/src/instructions/mark_failed.rs`
- **Potential Impact:** MEDIUM-HIGH — Forced curve failure, users must claim refunds.
- **Historical Precedent:** EP-042
- **Requires:** [state-machine-findings, timing-findings]
- **Investigation Approach:** Check deadline_slot initialization in start_curve. Verify it's immutable after set. Check slot comparison in mark_failed.

### H061 — Bonding Curve claim_refund Proportionality
- **Category:** Arithmetic, Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-005)
- **Hypothesis:** Refund uses floor division with shrinking denominator. Last claimer may get more or less than proportional share.
- **Attack Vector:** If denominator shrinks as users claim, later claimers' shares could be proportionally different.
- **Target Code:** `programs/bonding_curve/src/instructions/claim_refund.rs`
- **Potential Impact:** MEDIUM — Unfair refund distribution.
- **Historical Precedent:** EP-005, EP-069 (proportional distribution bugs)
- **Requires:** [arithmetic-findings, token-economic-findings]
- **Investigation Approach:** Check refund formula. Verify denominator handling. Check for dust accumulation or last-claimer advantage.

### H062 — Transfer Hook: Extra Account Meta List Initialization
- **Category:** CPI, Access Control
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-058)
- **Hypothesis:** `initialize_extra_account_meta_list` is partially analyzed. Any signer can call. If meta list configured incorrectly, transfers fail.
- **Attack Vector:** Front-run meta list initialization with wrong account configurations.
- **Target Code:** `programs/transfer-hook/src/lib.rs` (initialize_extra_account_meta_list)
- **Potential Impact:** MEDIUM-HIGH — Transfer hook fails for all transfers.
- **Historical Precedent:** EP-058
- **Requires:** [cpi-findings, access-control-findings]
- **Investigation Approach:** Check if meta list is PDA-based (one per mint). Verify initialization parameters. Check if re-initialization possible.

### H063 — Staking update_cumulative Timing
- **Category:** Timing
- **Estimated Priority:** Tier 2
- **Origin:** Playbook (staking attacks)
- **Hypothesis:** `update_cumulative` called by Epoch Program updates rewards_per_token_stored. If called at wrong time relative to deposit_rewards, rewards distributed incorrectly.
- **Attack Vector:** If update_cumulative and deposit_rewards can be called in wrong order, reward accounting broken.
- **Target Code:** `programs/staking/src/instructions/update_cumulative.rs`, `deposit_rewards.rs`
- **Potential Impact:** MEDIUM — Reward accounting errors.
- **Historical Precedent:** Synthetix reward timing bugs
- **Requires:** [timing-findings]
- **Investigation Approach:** Verify calling order constraints. Check if epoch transition enforces update_cumulative before next deposit_rewards.

### H064 — AMM Pool Locked State
- **Category:** State Machine
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-042)
- **Hypothesis:** PoolState has `locked` field. Check what locks a pool and if lock can be abused to DoS trading.
- **Attack Vector:** If admin or any condition can lock a pool, trading halts.
- **Target Code:** `programs/amm/src/state/pool.rs` (locked field)
- **Potential Impact:** MEDIUM — Trading DoS.
- **Historical Precedent:** EP-042
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check when `locked` is set/cleared. Verify only legitimate conditions trigger lock.

### H065 — VRF Anti-Reroll Bypass
- **Category:** Oracle
- **Estimated Priority:** Tier 2
- **Origin:** Playbook (oracle attacks)
- **Hypothesis:** VRF anti-reroll uses `pending_randomness_account` binding. Check if binding can be circumvented.
- **Attack Vector:** Create new randomness account, ignore unfavorable result, retry with different account.
- **Target Code:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`, `consume_randomness.rs`
- **Potential Impact:** HIGH — Favorable tax rate selection.
- **Historical Precedent:** VRF anti-reroll bypasses
- **Requires:** [oracle-findings]
- **Investigation Approach:** Verify randomness account stored in EpochState. Check if consume_randomness validates same account. Check if retry creates new binding.

### H066 — Tax Rate Lookup Table Bounds
- **Category:** Arithmetic, Oracle
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-003)
- **Hypothesis:** Tax rates use discrete lookup tables. VRF byte % 4 selects index. Verify table has exactly 4 entries and all values in [100-1400] BPS.
- **Attack Vector:** If table has fewer entries, index out of bounds → panic. If values outside range, extreme tax rates.
- **Target Code:** `programs/epoch-program/src/constants.rs` (tax rate tables)
- **Potential Impact:** MEDIUM — Program crash or extreme taxes.
- **Historical Precedent:** EP-003 (bounds errors)
- **Requires:** [arithmetic-findings, oracle-findings]
- **Investigation Approach:** Read lookup tables. Verify array lengths. Check all values are within expected range.

### H067 — Bonding Curve distribute_tax_escrow
- **Category:** Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-069)
- **Hypothesis:** `distribute_tax_escrow` is permissionless after graduation. Verify correct distribution and that it can't be called multiple times.
- **Attack Vector:** Call distribute_tax_escrow multiple times to over-distribute. Or call before all taxes collected.
- **Target Code:** `programs/bonding_curve/src/instructions/distribute_tax_escrow.rs`
- **Potential Impact:** MEDIUM — Over-distribution or premature distribution.
- **Historical Precedent:** EP-069
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check state guard (graduated only). Verify one-shot execution. Check escrow amount calculation.

### H068 — Bonding Curve consolidate_for_refund
- **Category:** Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-069)
- **Hypothesis:** `consolidate_for_refund` is permissionless after failure. Verify it correctly consolidates and doesn't lose funds.
- **Attack Vector:** Call consolidate_for_refund to manipulate refund pool. Or prevent consolidation to block refunds.
- **Target Code:** `programs/bonding_curve/src/instructions/consolidate_for_refund.rs`
- **Potential Impact:** MEDIUM — Refund manipulation.
- **Historical Precedent:** EP-069
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check state guard (failed only). Verify consolidation math. Check if blocking is possible.

### H069 — VRF Byte Interpretation Uniformity
- **Category:** Oracle, Arithmetic
- **Estimated Priority:** Tier 2
- **Origin:** KB (EP-005)
- **Hypothesis:** VRF byte interpretation uses `% 4` on u8. This is slightly biased (256 not divisible by 4... actually it is: 256/4=64). Verify uniformity.
- **Attack Vector:** If % operation is biased, certain tax rates occur more frequently. Not directly exploitable but may affect economic model.
- **Target Code:** `programs/epoch-program/src/instructions/consume_randomness.rs`
- **Potential Impact:** LOW — Slight tax rate bias.
- **Historical Precedent:** EP-005
- **Requires:** [oracle-findings]
- **Investigation Approach:** Verify 256 % 4 == 0 (it does — uniform). Check if other modular operations exist. Verify byte selection from VRF output.

### H070 — Crank Operator Information Monopoly
- **Category:** Economic Model
- **Estimated Priority:** Tier 2
- **Origin:** Novel (economic model agent)
- **Hypothesis:** Single crank operator sees VRF results, epoch transitions, and tax rates before the public. Information advantage enables front-running.
- **Attack Vector:** Crank operator monitors own TXs. Sees new tax rates before they're public. Trades accordingly.
- **Target Code:** Crank infrastructure (off-chain), `trigger_epoch_transition`, `consume_randomness`
- **Potential Impact:** MEDIUM — Information asymmetry exploitation.
- **Historical Precedent:** Novel — crank operator privilege
- **Requires:** [economic-model-findings]
- **Investigation Approach:** Check if crank TXs reveal rates before finality. Assess crank operator's ability to front-run own TXs.

---

## Tier 3 — MEDIUM-LOW Priority (62)

### H071 — No Timelock on Admin Actions
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (admin security)
- **Hypothesis:** No timelock on any admin operation. Admin key compromise = immediate damage.
- **Target Code:** All admin-gated instructions
- **Potential Impact:** MEDIUM — Immediate admin key exploitation.
- **Historical Precedent:** Standard DeFi best practice
- **Requires:** [upgrade-admin-findings]
- **Investigation Approach:** Verify no timelock pattern exists. Document which admin actions have immediate effect.

### H072 — Bonding Curve 15% Sell Tax Flash Loan Prevention
- **Category:** Economic Model
- **Estimated Priority:** Tier 3
- **Origin:** Novel (economic model agent)
- **Hypothesis:** 15% sell tax prevents flash-loan arbitrage on bonding curve. Verify tax is always applied and can't be bypassed.
- **Target Code:** `programs/bonding_curve/src/instructions/sell.rs`
- **Potential Impact:** LOW if tax works — flash loan unprofitable.
- **Historical Precedent:** Novel
- **Requires:** [economic-model-findings]
- **Investigation Approach:** Verify sell tax application is unconditional. Calculate break-even for flash loan given 15% tax.

### H073 — Conversion Vault: convert Reentrancy
- **Category:** CPI
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-012)
- **Hypothesis:** Conversion vault `convert` performs token transfers. Check for reentrancy via transfer hook callback.
- **Attack Vector:** Transfer hook could re-enter conversion vault during convert execution.
- **Target Code:** `programs/conversion-vault/src/instructions/convert.rs`
- **Potential Impact:** LOW — Anchor reentrancy guard should prevent.
- **Historical Precedent:** EP-012
- **Requires:** [cpi-findings]
- **Investigation Approach:** Check if Anchor reentrancy guard is enabled. Verify token transfer ordering (CEI pattern).

### H074 — AMM burn_admin Irreversibility
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** `burn_admin` is irreversible. Verify it can't be called accidentally and that it truly removes admin capability.
- **Target Code:** `programs/amm/src/instructions/burn_admin.rs`
- **Potential Impact:** LOW — Operational concern, not security.
- **Historical Precedent:** Standard
- **Requires:** [upgrade-admin-findings]
- **Investigation Approach:** Verify burn_admin sets admin to None or zero address. Check that no instruction recreates admin.

### H075 — Bonding Curve: purchase with 0 SOL
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-003)
- **Hypothesis:** Purchase with 0 SOL input. Check if tokens are minted for zero payment.
- **Target Code:** `programs/bonding_curve/src/instructions/purchase.rs`
- **Potential Impact:** HIGH if exploitable — free tokens.
- **Historical Precedent:** EP-003 (zero amount edge cases)
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check minimum amount validation. Verify curve math returns 0 tokens for 0 SOL.

### H076 — Bonding Curve: sell with 0 tokens
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-003)
- **Hypothesis:** Sell 0 tokens. Check if SOL is returned for zero token input.
- **Target Code:** `programs/bonding_curve/src/instructions/sell.rs`
- **Potential Impact:** HIGH if exploitable — free SOL.
- **Historical Precedent:** EP-003
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check minimum amount validation. Verify curve math returns 0 SOL for 0 tokens.

### H077 — Multiple `as u64` Unchecked Casts
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-003), arithmetic agent
- **Hypothesis:** Multiple `as u64` casts throughout codebase without `try_from`. Silent truncation could corrupt values.
- **Target Code:** Multiple files — tax_math.rs, curve_math.rs, pool_reader.rs
- **Potential Impact:** MEDIUM — Value truncation on large amounts.
- **Historical Precedent:** EP-003
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Grep for `as u64` in non-test code. For each, verify the source value fits in u64. Catalog high-risk casts.

### H078 — AMM Fee BPS Consistency
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (AMM)
- **Hypothesis:** AMM fee_bps stored in PoolState. Check if fee is applied consistently on buy and sell.
- **Target Code:** `programs/amm/src/instructions/swap_sol_pool.rs`
- **Potential Impact:** LOW — Fee asymmetry.
- **Historical Precedent:** Standard AMM check
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Read swap_sol_pool fee application. Verify same BPS used for both directions.

### H079 — AMM Reserve Ordering (mint_a < mint_b)
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (AMM), canonical ordering fix from Phase 52.1
- **Hypothesis:** AMM enforces mint_a < mint_b canonical ordering. Verify this is always checked and can't be bypassed.
- **Target Code:** `programs/amm/src/instructions/initialize_pool.rs`
- **Potential Impact:** LOW — Pool creation with wrong ordering.
- **Historical Precedent:** Phase 52.1 bug (MEMORY.md)
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check initialize_pool for mint ordering constraint. Verify PDA seeds enforce ordering.

### H080 — Bonding Curve State Transition Ordering
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-042)
- **Hypothesis:** Bonding curve has 6 states: Initialized->Active->Filled->Graduated or Active->Failed. Verify no skip-state transitions.
- **Target Code:** All bonding curve instructions (state constraints)
- **Potential Impact:** MEDIUM — State bypass.
- **Historical Precedent:** EP-042
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Map all state transitions. Verify each instruction checks current state before transitioning.

### H081 — Transfer Hook: Whitelist Check Bypass
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** Transfer hook checks whitelist for both source and destination. Check if either check can be bypassed.
- **Target Code:** `programs/transfer-hook/src/lib.rs` (transfer_hook instruction)
- **Potential Impact:** HIGH if bypassable — unrestricted token transfers.
- **Historical Precedent:** Token-2022 hook bypass patterns
- **Requires:** [access-control-findings]
- **Investigation Approach:** Read transfer_hook logic. Verify both accounts checked. Check for fallback paths that skip checks.

### H082 — Epoch Skipping Handling
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-042), state machine agent
- **Hypothesis:** If no one triggers epoch transition for multiple epochs, the skip logic must handle correctly.
- **Target Code:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`
- **Potential Impact:** LOW — Operational (handled per agent report).
- **Historical Precedent:** EP-042
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check epoch skip detection. Verify VRF is still requested for skipped epochs.

### H083 — Staking: claim Without Unstaking
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (staking)
- **Hypothesis:** Users can claim rewards without unstaking. Verify claim doesn't affect staked balance or create accounting issues.
- **Target Code:** `programs/staking/src/instructions/claim.rs`
- **Potential Impact:** LOW — Expected behavior, verify correctness.
- **Historical Precedent:** Standard staking pattern
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Verify claim only transfers earned rewards. Check rewards_earned reset after claim.

### H084 — Staking: Double Claim Prevention
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-069)
- **Hypothesis:** Can a user claim rewards twice for the same epoch? Checkpoint mechanism should prevent.
- **Target Code:** `programs/staking/src/instructions/claim.rs`
- **Potential Impact:** HIGH if exploitable — double reward payout.
- **Historical Precedent:** EP-069
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Verify checkpoint (rewards_per_token_paid) updates on claim. Check that repeated claim returns 0.

### H085 — Token-2022 Transfer Fee Interaction
- **Category:** CPI, Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** CRIME/FRAUD use Token-2022 with hooks. Check if any transfer fee extension is configured that could affect balances.
- **Target Code:** Token mint configuration (initialize.ts)
- **Potential Impact:** LOW — Unexpected fee deduction if configured.
- **Historical Precedent:** Token-2022 fee extension bugs
- **Requires:** [cpi-findings, token-economic-findings]
- **Investigation Approach:** Check mint extensions. Verify no TransferFeeConfig is set. Only MetadataPointer + TransferHook should be configured.

### H086 — Bonding Curve: Deadline Slot vs Clock
- **Category:** Timing
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-042)
- **Hypothesis:** Bonding curve uses deadline_slot for timing. Verify Clock sysvar is used (not block timestamp which can be manipulated by validators).
- **Target Code:** `programs/bonding_curve/src/instructions/mark_failed.rs`, `purchase.rs`
- **Potential Impact:** LOW — Slot-based timing is standard on Solana.
- **Historical Precedent:** EP-042 (timestamp vs slot)
- **Requires:** [timing-findings]
- **Investigation Approach:** Verify Clock::get() slot comparison. Check no clock timestamp manipulation vector.

### H087 — AMM Initialization: Pool Seeding
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (AMM)
- **Hypothesis:** Pool seeding amounts set initial price. If seeded incorrectly, initial price is wrong.
- **Target Code:** `programs/amm/src/instructions/initialize_pool.rs`, deploy scripts
- **Potential Impact:** LOW — Operational concern (pool seeding is deployment-time).
- **Historical Precedent:** Standard AMM
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check pool seeding in initialize.ts. Verify SOL/token ratio matches intended price.

### H088 — Staking: init_if_needed on UserStake
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-058)
- **Hypothesis:** `stake` uses init_if_needed for UserStake PDA. Check for reinitialization vulnerability.
- **Target Code:** `programs/staking/src/instructions/stake.rs`
- **Potential Impact:** LOW — init_if_needed is safe with PDA (same seeds always produce same account).
- **Historical Precedent:** EP-058 (init_if_needed concerns)
- **Requires:** [access-control-findings]
- **Investigation Approach:** Verify PDA seeds include user pubkey. Confirm init_if_needed can't create duplicate accounts.

### H089 — AMM: swap_sol_pool CPI-only Access
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** `swap_sol_pool` is restricted to Tax Program CPI. Verify no direct invocation possible.
- **Target Code:** `programs/amm/src/instructions/swap_sol_pool.rs` (swap_authority seeds::program)
- **Potential Impact:** HIGH if bypassable — direct AMM access bypasses tax.
- **Historical Precedent:** Standard CPI gate pattern
- **Requires:** [access-control-findings]
- **Investigation Approach:** Verify seeds::program constraint on swap_authority. Confirm Tax Program ID is checked.

### H090 — Bonding Curve: Token Mint Validation
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-024)
- **Hypothesis:** Check if bonding curve validates that the token mint passed matches the curve's token_mint.
- **Target Code:** `programs/bonding_curve/src/instructions/purchase.rs` (accounts struct)
- **Potential Impact:** MEDIUM — Wrong token minted if not validated.
- **Historical Precedent:** EP-024 (account substitution)
- **Requires:** [access-control-findings]
- **Investigation Approach:** Check has_one or seeds constraint linking token_mint to curve_state.

### H091 — Tax Program: SOL Wrapping/Unwrapping
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (AMM)
- **Hypothesis:** Tax Program wraps SOL to WSOL for AMM swap. Check for value loss during wrap/unwrap.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs`, `swap_sol_sell.rs`
- **Potential Impact:** LOW — Dust loss on wrap/unwrap.
- **Historical Precedent:** WSOL handling bugs
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check WSOL sync_native and close_account handling. Verify no SOL leakage.

### H092 — Carnage: expire_carnage State Cleanup
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-042)
- **Hypothesis:** `expire_carnage` is permissionless after deadline. Verify state is properly cleaned up and no funds are stuck.
- **Target Code:** `programs/epoch-program/src/instructions/expire_carnage.rs`
- **Potential Impact:** LOW-MEDIUM — Stuck funds in carnage state.
- **Historical Precedent:** EP-042
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check state transition on expire. Verify fund accounting on expiry.

### H093 — Bonding Curve: Token Vault PDA Derivation
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-024)
- **Hypothesis:** Token vault PDA seeds must uniquely identify the vault per curve. Check for seed collision.
- **Target Code:** `programs/bonding_curve/src/instructions/` (vault account derivation)
- **Potential Impact:** LOW — PDA collision unlikely with unique seeds.
- **Historical Precedent:** EP-024
- **Requires:** [access-control-findings]
- **Investigation Approach:** Check vault PDA seeds. Verify uniqueness includes curve/mint identifier.

### H094 — Staking: deposit_rewards Zero Amount
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-003)
- **Hypothesis:** If deposit_rewards called with 0 amount, rewards_per_token_stored unchanged. Verify no division by zero.
- **Target Code:** `programs/staking/src/instructions/deposit_rewards.rs`
- **Potential Impact:** LOW — Should be no-op.
- **Historical Precedent:** EP-003
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check 0-amount handling. Verify no div-by-zero when total_staked is 0.

### H095 — AMM: Pool with Same Token Both Sides
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-042)
- **Hypothesis:** Check if initialize_pool prevents creating pool where mint_a == mint_b.
- **Target Code:** `programs/amm/src/instructions/initialize_pool.rs`
- **Potential Impact:** LOW — Same-token pool would be useless but potentially exploitable.
- **Historical Precedent:** EP-042
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check if mint_a != mint_b is enforced. Verify canonical ordering prevents this.

### H096 — Conversion Vault: Reverse Conversion Rate
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** Conversion is 100:1 CRIME/FRAUD -> PROFIT. Check if reverse conversion (PROFIT -> CRIME/FRAUD) is at 1:100 rate. Verify no rate manipulation.
- **Target Code:** `programs/conversion-vault/src/instructions/convert.rs`
- **Potential Impact:** LOW-MEDIUM — Rate manipulation or wrong direction.
- **Historical Precedent:** Novel
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check conversion direction logic. Verify rate is hardcoded. Check for bidirectional support.

### H097 — Staking: unstake Authority Check
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (staking)
- **Hypothesis:** `unstake` must verify caller owns the UserStake PDA. Check has_one or seeds constraint.
- **Target Code:** `programs/staking/src/instructions/unstake.rs`
- **Potential Impact:** HIGH if bypassable — steal others' staked tokens.
- **Historical Precedent:** Standard staking check
- **Requires:** [access-control-findings]
- **Investigation Approach:** Verify has_one owner or PDA seeds include signer. Confirm unstake transfers to correct recipient.

### H098 — Tax Program: EpochState Deserialization Safety
- **Category:** CPI
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-056)
- **Hypothesis:** Tax Program deserializes EpochState from Epoch Program account. If deserialization is unchecked, malformed data could crash or produce wrong values.
- **Target Code:** `programs/tax-program/src/helpers/` (EpochState mirror)
- **Potential Impact:** MEDIUM — Wrong tax rates from malformed data.
- **Historical Precedent:** EP-056
- **Requires:** [cpi-findings]
- **Investigation Approach:** Check deserialization method (Anchor account loader vs raw bytes). Verify owner check on EpochState account.

### H099 — Bonding Curve: Linear vs Quadratic Mismatch
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** Architecture says "linear price curves" but arithmetic agent mentions "quadratic formula." Verify which is correct and consistent.
- **Target Code:** `programs/bonding_curve/src/helpers/curve_math.rs`
- **Potential Impact:** LOW — Documentation vs implementation mismatch.
- **Historical Precedent:** Novel
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Read curve_math.rs. Determine if price is linear (y = ax + b, area is quadratic) or quadratic. Verify consistency.

### H100 — Epoch Program: Switchboard Version Pinning
- **Category:** Oracle
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (oracle)
- **Hypothesis:** Switchboard pinned at v0.11.3. Check for known vulnerabilities in this version.
- **Target Code:** `Cargo.toml` (Switchboard dependency)
- **Potential Impact:** LOW — Dependency vulnerability.
- **Historical Precedent:** Standard dependency check
- **Requires:** [oracle-findings]
- **Investigation Approach:** Check Switchboard version in Cargo.toml. Review changelog for security fixes after v0.11.3.

### H101 — AMM: compute_swap_output Precision
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (AMM)
- **Hypothesis:** AMM swap output computation may lose precision for small amounts. Check rounding direction.
- **Target Code:** `programs/amm/src/instructions/swap_sol_pool.rs`
- **Potential Impact:** LOW — Dust-level precision loss.
- **Historical Precedent:** Standard AMM concern
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check u128 intermediates in swap calculation. Verify floor division favors pool (not trader).

### H102 — Bonding Curve: SOL Vault Balance Tracking
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-069)
- **Hypothesis:** Does bonding curve track SOL raised in state AND in vault balance? If only vault, rent-exempt minimum affects available balance.
- **Target Code:** `programs/bonding_curve/src/state/curve_state.rs`, `purchase.rs`
- **Potential Impact:** MEDIUM — Accounting mismatch between state and vault.
- **Historical Precedent:** EP-069
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check sol_raised field vs vault lamports. Verify purchase increments both consistently.

### H103 — Tax Program: Treasury Address Validation
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** Tax distribution sends treasury portion to a configured address. Check if address is validated.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs` (treasury transfer)
- **Potential Impact:** MEDIUM — Funds sent to wrong address.
- **Historical Precedent:** Standard admin address check
- **Requires:** [access-control-findings]
- **Investigation Approach:** Check treasury address source. Verify it's a hardcoded constant or properly stored PDA field.

### H104 — Bonding Curve: Concurrent Purchase Race
- **Category:** Timing
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-042)
- **Hypothesis:** Two users purchase simultaneously near curve Filled threshold. Check if both TXs can succeed and over-fill the curve.
- **Target Code:** `programs/bonding_curve/src/instructions/purchase.rs`
- **Potential Impact:** MEDIUM — Over-filling could affect price or solvency.
- **Historical Precedent:** EP-042
- **Requires:** [timing-findings]
- **Investigation Approach:** Check Solana runtime account locking. Verify CurveState exclusive write prevents concurrent updates.

### H105 — Carnage Fund: Insufficient Balance for Swap
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** If carnage fund has very small balance, swap might fail or return 0 tokens. Check minimum amount handling.
- **Target Code:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- **Potential Impact:** LOW — Failed carnage execution (no fund loss).
- **Historical Precedent:** Novel
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check minimum swap amount validation. Verify behavior when swap output rounds to 0.

### H106 — Transfer Hook: Authority Burn Completeness
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** `burn_authority` sets authority to None. Verify no other instruction can set a new authority.
- **Target Code:** `programs/transfer-hook/src/lib.rs` (burn_authority)
- **Potential Impact:** LOW — Authority permanence.
- **Historical Precedent:** Standard
- **Requires:** [upgrade-admin-findings]
- **Investigation Approach:** Check all instructions that modify WhitelistAuthority. Verify burn is truly irreversible.

### H107 — Staking: UserStake Account Size
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-056)
- **Hypothesis:** UserStake account may need more space if fields are added. Check if current size is sufficient.
- **Target Code:** `programs/staking/src/state/user_stake.rs`
- **Potential Impact:** LOW — Account reallocation needed on upgrade.
- **Historical Precedent:** EP-056
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check UserStake account space allocation. Verify no padding for future fields.

### H108 — Bonding Curve: CurveState Account Size (192 bytes)
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-056)
- **Hypothesis:** CurveState is 192 bytes. Check if all fields fit and serialization is correct.
- **Target Code:** `programs/bonding_curve/src/state/curve_state.rs`
- **Potential Impact:** LOW — Serialization errors.
- **Historical Precedent:** EP-056
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Calculate field sizes. Verify 192 bytes is sufficient. Check Anchor space macro.

### H109 — Tax Program: Swap with Locked Pool
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (AMM)
- **Hypothesis:** If AMM pool is locked, Tax Program CPI swap fails. Check if Tax handles this gracefully.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs` (CPI error handling)
- **Potential Impact:** LOW — User TX reverts with unclear error.
- **Historical Precedent:** Standard
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Check AMM pool lock check in swap. Verify Tax Program doesn't swallow CPI errors.

### H110 — Conversion Vault: Token Account Ownership
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-024)
- **Hypothesis:** Conversion vault's token accounts must be owned by vault PDA. Check if accounts can be substituted.
- **Target Code:** `programs/conversion-vault/src/instructions/convert.rs`
- **Potential Impact:** MEDIUM — Token substitution.
- **Historical Precedent:** EP-024
- **Requires:** [access-control-findings]
- **Investigation Approach:** Verify token account constraints in accounts struct. Check for has_one or seeds linking accounts to vault.

### H111 — Epoch Program: VRF Timeout Recovery
- **Category:** Oracle, Timing
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (oracle)
- **Hypothesis:** `retry_epoch_vrf` handles VRF timeout after 300 slots. Verify retry creates proper new binding and doesn't leak state.
- **Target Code:** `programs/epoch-program/src/instructions/retry_epoch_vrf.rs`
- **Potential Impact:** LOW — VRF recovery correctness.
- **Historical Precedent:** VRF timeout patterns
- **Requires:** [oracle-findings, timing-findings]
- **Investigation Approach:** Check timeout slot comparison. Verify new randomness account binding replaces old. Check state cleanup.

### H112 — AMM: Pool Fee Range Validation
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** Pool fee_bps should be bounded. Check if extreme values (0 or 10000) are prevented.
- **Target Code:** `programs/amm/src/instructions/initialize_pool.rs`
- **Potential Impact:** LOW — Operational (admin controls fee).
- **Historical Precedent:** Standard
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check fee_bps validation in pool initialization.

### H113 — Staking: Zero Stake Edge Case
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-003)
- **Hypothesis:** If total_staked == 0 when deposit_rewards is called, reward_per_token division by zero.
- **Target Code:** `programs/staking/src/instructions/deposit_rewards.rs`, math.rs
- **Potential Impact:** MEDIUM — Program crash or stuck rewards.
- **Historical Precedent:** EP-003 (division by zero)
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check if deposit_rewards handles total_staked == 0. Verify dead stake prevents this.

### H114 — Bonding Curve: Purchase Near Maximum Supply
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-003)
- **Hypothesis:** Purchase near maximum token supply. Check if curve handles last-token-purchase edge case.
- **Target Code:** `programs/bonding_curve/src/instructions/purchase.rs`
- **Potential Impact:** LOW — Edge case at curve completion.
- **Historical Precedent:** EP-003
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Check remaining supply handling. Verify partial fill logic when purchase exceeds remaining.

### H115 — Tax Program: Swap Exempt Path Validation
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-001)
- **Hypothesis:** `swap_exempt` bypasses tax for carnage. Verify only Epoch Program can call (seeds::program gate).
- **Target Code:** `programs/tax-program/src/instructions/swap_exempt.rs`
- **Potential Impact:** HIGH if bypassable — tax-free swaps.
- **Historical Precedent:** EP-001
- **Requires:** [access-control-findings]
- **Investigation Approach:** Verify carnage_signer PDA seeds::program constraint. Confirm Epoch Program ID checked.

### H116 — Bonding Curve: SOL Vault Rent Accounting
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** SOL vault PDA has rent-exempt minimum. Does sol_raised include rent? If not, withdrawable amount is wrong.
- **Target Code:** `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs`
- **Potential Impact:** MEDIUM — Over/under-withdrawal by rent-exempt amount.
- **Historical Precedent:** Novel
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check if withdraw_graduated_sol accounts for rent-exempt minimum. Verify vault balance vs sol_raised accounting.

### H117 — Carnage: Dual Pool Execution Order
- **Category:** Token/Economic, Timing
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** Carnage operates on both CRIME and FRAUD pools. Execution order may create arbitrage between pools.
- **Target Code:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- **Potential Impact:** LOW-MEDIUM — Inter-pool arbitrage during carnage.
- **Historical Precedent:** Novel — dual-pool atomic execution
- **Requires:** [token-economic-findings, timing-findings]
- **Investigation Approach:** Check execution order of pool operations. Verify if price impact from first pool affects second.

### H118 — Bonding Curve: Refund After Partial Sales
- **Category:** Token/Economic, Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** If curve fails after many buy/sell cycles, refund pool balance may differ from expected integral due to accumulated sell taxes.
- **Target Code:** `programs/bonding_curve/src/instructions/claim_refund.rs`
- **Potential Impact:** MEDIUM — Under-funded refund pool.
- **Historical Precedent:** Novel
- **Requires:** [token-economic-findings, arithmetic-findings]
- **Investigation Approach:** Check if sell taxes are escrowed separately from refund pool. Verify refund math accounts for taxed withdrawals.

### H119 — Epoch Program: CarnageFundState Size (139 bytes)
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-056)
- **Hypothesis:** CarnageFundState at 139 bytes, no padding. Schema evolution concerns similar to EpochState.
- **Target Code:** `programs/epoch-program/src/state/carnage_fund_state.rs`
- **Potential Impact:** LOW — Schema evolution limitation.
- **Historical Precedent:** EP-056
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Verify current size. Check for padding. Document evolution constraints.

### H120 — Tax Program: Buy Path Output Floor
- **Category:** Timing, Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** Buy path has 50% output floor similar to sell. Verify floor is applied correctly and consistently.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs`
- **Potential Impact:** LOW — Floor verification.
- **Historical Precedent:** S010 fix
- **Requires:** [timing-findings, token-economic-findings]
- **Investigation Approach:** Check output floor calculation on buy path. Verify 50% is applied to pre-tax or post-tax amount.

### H121 — Conversion Vault: VaultConfig Bump-Only
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** VaultConfig stores only bump. No admin, no parameters. Verify this is intentional and doesn't limit functionality.
- **Target Code:** `programs/conversion-vault/src/state/` (VaultConfig)
- **Potential Impact:** LOW — Design choice verification.
- **Historical Precedent:** Novel
- **Requires:** [access-control-findings]
- **Investigation Approach:** Read VaultConfig struct. Verify bump is used correctly for PDA signing.

### H122 — Staking: Reward Distribution During Unstake
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (staking)
- **Hypothesis:** When user unstakes, pending rewards should be distributed. Check if unstake triggers reward calculation.
- **Target Code:** `programs/staking/src/instructions/unstake.rs`
- **Potential Impact:** MEDIUM if not handled — Lost rewards on unstake.
- **Historical Precedent:** Standard staking pattern
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check if unstake calls internal claim or update function. Verify rewards_earned calculated before balance change.

### H123 — AMM: PDA Signer for Token Transfers
- **Category:** CPI
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** AMM uses PDA as signer for token transfers from pool vaults. Verify PDA seeds match across all uses.
- **Target Code:** `programs/amm/src/instructions/swap_sol_pool.rs` (invoke_signed)
- **Potential Impact:** LOW — PDA derivation consistency.
- **Historical Precedent:** Standard
- **Requires:** [cpi-findings]
- **Investigation Approach:** Check PDA seeds for pool authority. Verify consistent across swap, init, and close operations.

### H124 — Bonding Curve: Token Supply After Graduation
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** After graduation, remaining tokens in vault are distributed. Verify no tokens are lost or extra tokens created.
- **Target Code:** `programs/bonding_curve/src/instructions/prepare_transition.rs`
- **Potential Impact:** MEDIUM — Token supply mismatch.
- **Historical Precedent:** Novel
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check prepare_transition token accounting. Verify tokens_sold + remaining = total supply allocated to curve.

### H125 — Tax Program: Compute Budget Exhaustion
- **Category:** Timing
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** Tax Program's full CPI chain (Tax -> AMM -> Token-2022 -> Hook) may exhaust compute budget for complex transactions.
- **Target Code:** Full swap path
- **Potential Impact:** LOW — Transaction failure (no fund loss).
- **Historical Precedent:** Compute budget issues common on Solana
- **Requires:** [timing-findings]
- **Investigation Approach:** Check compute budget profile. Verify CU usage is within 200K or request increased budget.

### H126 — Staking: StakePool Singleton Collision in Tests
- **Category:** State Machine
- **Estimated Priority:** Tier 3
- **Origin:** Novel (from MEMORY.md)
- **Hypothesis:** StakePool PDA is singleton. If tests don't isolate, PDA collision. Verify production code is unaffected.
- **Target Code:** `programs/staking/src/state/stake_pool.rs`
- **Potential Impact:** LOW — Test-only concern, but verify prod seeds.
- **Historical Precedent:** MEMORY.md note
- **Requires:** [state-machine-findings]
- **Investigation Approach:** Verify StakePool PDA seeds are correct. Confirm singleton is by design.

### H127 — Bonding Curve: PRECISION Mismatch (1e12 vs 1e18)
- **Category:** Arithmetic
- **Estimated Priority:** Tier 3
- **Origin:** Novel (arithmetic agent noted discrepancy)
- **Hypothesis:** Bonding curve uses PRECISION=1e12, staking uses PRECISION=1e18. If any calculation crosses program boundary, precision mismatch could cause errors.
- **Target Code:** `programs/bonding_curve/src/constants.rs`, `programs/staking/src/constants.rs`
- **Potential Impact:** LOW — Programs don't share precision across CPI currently.
- **Historical Precedent:** Novel
- **Requires:** [arithmetic-findings]
- **Investigation Approach:** Verify PRECISION constants are used only within their respective programs. Check no cross-program precision sharing.

### H128 — Conversion Vault: Double Initialize Prevention
- **Category:** Access Control
- **Estimated Priority:** Tier 3
- **Origin:** KB (EP-058)
- **Hypothesis:** VaultConfig is one-shot init. Verify PDA `init` constraint prevents re-initialization.
- **Target Code:** `programs/conversion-vault/src/instructions/initialize.rs`
- **Potential Impact:** LOW — Anchor's init prevents duplicate PDA creation.
- **Historical Precedent:** EP-058
- **Requires:** [access-control-findings]
- **Investigation Approach:** Verify `init` (not `init_if_needed`) on VaultConfig PDA. Confirm second init attempt fails.

### H129 — Epoch Program: Multiple VRF Requests
- **Category:** Oracle
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (oracle)
- **Hypothesis:** Can multiple VRF requests be pending simultaneously? Check if state machine prevents this.
- **Target Code:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`
- **Potential Impact:** MEDIUM — Multiple pending VRF → inconsistent state.
- **Historical Precedent:** VRF anti-reroll patterns
- **Requires:** [oracle-findings]
- **Investigation Approach:** Check EpochState VRF pending flag. Verify trigger_epoch_transition checks no pending VRF.

### H130 — Tax Program: Event Emission Correctness
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook
- **Hypothesis:** Tax events emit amounts. If emitted amounts differ from actual transfers, off-chain tracking is wrong.
- **Target Code:** `programs/tax-program/src/events.rs`, swap instructions
- **Potential Impact:** LOW — Off-chain only. No on-chain impact.
- **Historical Precedent:** Standard
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Compare emitted amounts with actual transfer amounts. Verify consistency.

### H131 — Bonding Curve: Token-2022 Hook Interaction During Purchase
- **Category:** CPI
- **Estimated Priority:** Tier 3
- **Origin:** Novel
- **Hypothesis:** Bonding curve purchase mints or transfers Token-2022 tokens with hook. Verify hook accounts are properly passed.
- **Target Code:** `programs/bonding_curve/src/instructions/purchase.rs`
- **Potential Impact:** MEDIUM — Transfer fails if hook accounts missing.
- **Historical Precedent:** Transfer hook integration issues (MEMORY.md)
- **Requires:** [cpi-findings]
- **Investigation Approach:** Check if purchase uses transfer_checked with hook. Verify remaining_accounts include hook accounts.

### H132 — Staking: Dead Stake Initialization
- **Category:** Token/Economic
- **Estimated Priority:** Tier 3
- **Origin:** Playbook (staking)
- **Hypothesis:** Dead stake prevents first-depositor attack. Verify dead stake is created during initialization and can't be removed.
- **Target Code:** `programs/staking/src/instructions/initialize_stake_pool.rs`
- **Potential Impact:** LOW — Verify mitigation exists.
- **Historical Precedent:** ERC-4626 first depositor mitigation
- **Requires:** [token-economic-findings]
- **Investigation Approach:** Check initialize_stake_pool for dead stake creation. Verify initial total_staked > 0 or minimum stake enforcement.

---

## Supplemental Strategies

### S001 — BC Authority Fix: ProgramData Pattern Completeness
- **Category:** Access Control, Upgrade/Admin
- **Estimated Priority:** Tier 2
- **Origin:** Supplemental (H001, H002, H005 CONFIRMED)
- **Hypothesis:** If ProgramData authority pattern is added to BC, verify it covers ALL 6 instructions and that the PDA derivation matches AMM's proven pattern exactly.
- **Target Code:** All 6 BC admin instructions
- **Requires:** [access-control-findings, upgrade-admin-findings]

### S002 — Sell Path Gross Minimum Computation Correctness
- **Category:** Arithmetic, Timing
- **Estimated Priority:** Tier 2
- **Origin:** Supplemental (H008, H019 CONFIRMED)
- **Hypothesis:** The recommended fix (gross_min = minimum_output * 10000 / (10000 - tax_bps)) may itself have edge cases with rounding or extreme tax rates.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_sell.rs`
- **Requires:** [arithmetic-findings, timing-findings]

### S003 — Staking Escrow: deposit_rewards Failure Cascade
- **Category:** Token/Economic, CPI
- **Estimated Priority:** Tier 2
- **Origin:** Supplemental (H012 CONFIRMED)
- **Hypothesis:** If staking escrow is destroyed (H012), does the Tax Program's deposit_rewards CPI fail gracefully or brick all swaps?
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_buy.rs` (deposit_rewards CPI), `programs/staking/src/instructions/deposit_rewards.rs`
- **Requires:** [token-economic-findings, cpi-findings]

### S004 — Pubkey::default() Compile Guard Implementation
- **Category:** Upgrade/Admin
- **Estimated Priority:** Tier 2
- **Origin:** Supplemental (H018 CONFIRMED)
- **Hypothesis:** Verify that `compile_error!()` or equivalent guards can be added without breaking devnet builds.
- **Target Code:** Tax/BC/Vault constants.rs
- **Requires:** [upgrade-admin-findings]

### S005 — Emergency Pause: Program Upgrade as Last Resort Timing
- **Category:** Upgrade/Admin, Timing
- **Estimated Priority:** Tier 2
- **Origin:** Supplemental (H020 CONFIRMED)
- **Hypothesis:** How fast can a single-program emergency upgrade be deployed? Map the minimum steps and time.
- **Target Code:** deploy-all.sh, Anchor build pipeline
- **Requires:** [upgrade-admin-findings]

### S006 — BC Authority + Hook Init: Combined Deployment Attack
- **Category:** Access Control
- **Estimated Priority:** Tier 1
- **Origin:** Supplemental (H001+H007 CONFIRMED)
- **Hypothesis:** Attacker combines H007 (hook authority capture) with H001 (BC SOL theft) in a coordinated mainnet deployment attack. Captures hook authority AND steals graduated SOL.
- **Target Code:** Transfer hook init + BC withdraw
- **Requires:** [access-control-findings]

### S007 — Cross-Program Layout Test Coverage
- **Category:** CPI, State Machine
- **Estimated Priority:** Tier 2
- **Origin:** Supplemental (H011, H022, H027 CONFIRMED)
- **Hypothesis:** No cross-program layout tests exist. A single shared test could prevent the historical V3 failure from recurring.
- **Target Code:** Tests directory
- **Requires:** [cpi-findings, state-machine-findings]

### S008 — Sell Path Output Floor TOCTOU
- **Category:** Timing, Token/Economic
- **Estimated Priority:** Tier 2
- **Origin:** Supplemental (H019 CONFIRMED — noted TOCTOU in output floor)
- **Hypothesis:** The 50% output floor reads pool reserves via pool_reader.rs BEFORE the CPI. A front-runner in the same block can manipulate reserves between the read and the swap, lowering the effective floor.
- **Target Code:** `programs/tax-program/src/instructions/swap_sol_sell.rs`, `pool_reader.rs`
- **Requires:** [timing-findings, token-economic-findings]

### S009 — Bonding Curve Authority: distribute_tax_escrow Theft
- **Category:** Access Control, Token/Economic
- **Estimated Priority:** Tier 1
- **Origin:** Supplemental (H001 pattern — not yet investigated for this instruction)
- **Hypothesis:** `distribute_tax_escrow` has the same bare-signer authority pattern. If tax escrow contains SOL, attacker directs it to themselves.
- **Target Code:** `programs/bonding_curve/src/instructions/distribute_tax_escrow.rs`
- **Requires:** [access-control-findings, token-economic-findings]

### S010 — Bonding Curve Authority: consolidate_for_refund Hijack
- **Category:** Access Control, Token/Economic
- **Estimated Priority:** Tier 1
- **Origin:** Supplemental (H001 pattern)
- **Hypothesis:** `consolidate_for_refund` may direct refund SOL to the attacker instead of the refund pool.
- **Target Code:** `programs/bonding_curve/src/instructions/consolidate_for_refund.rs`
- **Requires:** [access-control-findings, token-economic-findings]

---

## Strategy Index by Target

| Program | Strategies |
|---------|------------|
| Bonding Curve | H001-H006, H010, H024, H031, H046-H047, H051-H052, H060-H061, H067-H068, H072, H075-H076, H080, H086, H090, H093, H099, H102, H104, H108, H114, H116, H118, H124, H127, H131 |
| Tax Program | H008, H011, H013-H014, H019, H022, H035, H042, H048, H050, H077, H091, H098, H103, H109, H115, H120, H125, H130 |
| AMM | H009, H019, H023, H029, H040, H043, H045, H054, H064, H078-H079, H087, H089, H095, H101, H112, H123 |
| Epoch Program | H009, H011, H015-H016, H021, H026-H028, H030, H037-H038, H049, H055-H057, H065-H066, H070, H082, H092, H100, H111, H117, H119, H129 |
| Staking | H012, H033, H041, H053, H063, H083-H084, H088, H094, H097, H107, H113, H122, H126, H132 |
| Transfer Hook | H007, H036, H044, H062, H081, H085, H106 |
| Conversion Vault | H017, H034, H073, H096, H110, H121, H128 |
| Cross-Program | H011, H018, H020, H049, H058, H071, H077 |

## Strategy Index by Focus Area

| Focus Area | Strategies |
|-----------|------------|
| Access Control | H001-H007, H010, H021, H023, H036, H039, H045, H062, H081, H088-H090, H093, H097, H103, H106, H110, H115, H121, H128 |
| Arithmetic | H013, H024, H034-H035, H041-H043, H046-H047, H054, H066, H069, H075-H078, H094, H096, H099, H101, H112-H114, H127 |
| State Machine | H002, H004, H011, H027, H031, H040, H044, H048, H052, H055, H059-H060, H064, H079-H080, H082, H092, H095, H107-H109, H119, H126, H129 |
| CPI/External | H008-H009, H015, H032, H050, H058, H062, H073, H085, H098, H123, H131 |
| Token/Economic | H005-H006, H012, H014, H017, H025-H026, H029, H033-H035, H047, H051, H053, H059, H061, H067-H068, H072, H083-H085, H087, H091, H096, H102, H105, H116-H118, H120, H122, H124, H130, H132 |
| Oracle/Data | H009, H015-H016, H030, H048, H056, H065-H066, H069-H070, H100, H111, H129 |
| Upgrade/Admin | H003, H007, H018, H020-H021, H027, H037, H039, H049, H071, H074, H106 |
| Timing/Ordering | H002, H004, H008, H010, H016, H026, H028-H032, H038, H060, H063, H082, H086, H104, H111, H117, H125 |
| Economic Model | H016, H033, H048, H051, H053, H057, H070, H072 |
