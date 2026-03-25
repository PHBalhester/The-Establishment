# Economic Model Analysis — Context 09

**Auditor:** Economic Model Analyzer Agent
**Date:** 2026-03-07
**Scope:** Full protocol economic model — AMM, Tax, Staking, Epoch/Carnage, Bonding Curve, Conversion Vault

---

<!-- CONDENSED_SUMMARY_START -->
# Economic Model — Condensed Summary

## Protocol Type & Core Mechanic
Multi-program DeFi protocol combining dual bonding curves (token price discovery + launch), a constant-product AMM (post-graduation trading), asymmetric VRF-driven taxation (1-14% buy/sell taxes per epoch), Synthetix-style staking yield (71% of tax to PROFIT stakers), and a VRF-randomized buyback-and-burn mechanism (Carnage Fund, 24% of tax). Value enters via SOL (buys), is redistributed via taxes, and exits via sells (SOL out) or burns (token supply reduction).

## Top Economic Invariants
- **INV-1: AMM k-invariant** — `k_after >= k_before` for every swap — enforced at `amm/swap_sol_pool.rs:171-173` with `verify_k_invariant()` check
- **INV-2: Tax distribution conservation** — `staking + carnage + treasury == total_tax` always — enforced at `tax_math.rs:105-107` via remainder-based treasury calculation
- **INV-3: Bonding curve solvency** — `sol_vault >= integral(0, tokens_sold)` post-sell — enforced at `bonding_curve/sell.rs:289-292` with explicit solvency assertion
- **INV-4: Staking reward conservation** — `sum(individual_claims) <= total_deposited` — enforced by floor division in `staking/math.rs:50` (Synthetix pattern)
- **INV-5: Refund proportionality** — `refund = floor(user_balance * refund_pool / total_outstanding)` — enforced at `claim_refund.rs:146-149`, shrinking denominator preserves fairness
- **INV-6: Bonding curve price monotonicity** — P(x) = P_START + slope*x is strictly increasing — enforced by linear math in `bonding_curve/math.rs`

## Flash Loan Impact (Critical)
Flash loans on Solana require protocol-level support (no native flash loans like EVM). The primary flash-loan-like vector is **atomic composition**: a single transaction can buy on the bonding curve, sell immediately, and potentially extract value from the tax asymmetry. The bonding curve has no same-slot restriction, but the 15% sell tax acts as a strong economic deterrent (~15% cost per round-trip). AMM swaps are gated through the Tax Program (no direct user access), which enforces a 50% minimum output floor, making flash-loan-style sandwich attacks uneconomical.
- **Most vulnerable operation**: Bonding curve buy+sell in same TX — 15% sell tax is the only protection — `bonding_curve/sell.rs:174-179`

## MEV & Sandwich Vulnerability
All AMM swaps are routed through the Tax Program which enforces a 50% minimum output floor (`MINIMUM_OUTPUT_FLOOR_BPS = 5000`), making sandwich attacks costly but not impossible for large trades. The sell path passes `amm_minimum: u64 = 0` to the AMM (line `swap_sol_sell.rs:147`), relying on post-CPI net_output slippage check instead. VRF-based tax rate changes create an information asymmetry window: the crank operator sees the new rates before they are public, enabling front-running of rate changes.
- **Most vulnerable operation**: Sell path with `amm_minimum=0` passed to AMM — sandwich between AMM CPI and tax deduction is not possible (atomic), but the 50% floor still allows up to 50% price impact per trade

## Value Extraction Vectors (Prioritized)
1. **VRF tax rate front-running**: When crank calls `consume_randomness`, new tax rates are set. Anyone monitoring the mempool can see the VRF result and front-run rate-favorable trades before the epoch transition confirms — estimated impact: up to 13% tax differential per trade — `epoch-program/consume_randomness.rs`
2. **Bonding curve sell tax arbitrage at graduation boundary**: When curve is near TARGET_TOKENS, the last buyer causes graduation (status=Filled, sells disabled). If the AMM pools are seeded at the end price (P_END), there is zero arbitrage opportunity by design. But if seeding differs from P_END, arbitrage window opens — `bonding_curve/constants.rs:24-25` P_END=3450 vs AMM seed ratio
3. **Carnage fund sandwich**: Carnage swaps use 75-85% slippage floors. An attacker who predicts carnage timing (VRF is unpredictable, but the commit-reveal window leaks timing) could sandwich the Carnage swap for up to 15-25% extraction — `epoch-program/constants.rs:127-132`
4. **Staking reward timing**: Deposit just before epoch finalization via `update_cumulative`, claim rewards, unstake — COOLDOWN_SECONDS mitigates but the cooldown starts at claim, not at stake — `staking/claim.rs:119`
5. **Bonding curve dust accumulation**: ceil rounding on sell tax means sellers overpay by up to 1 lamport per sell. Over millions of sells, this accumulates in the tax escrow — negligible impact — `bonding_curve/sell.rs:174-179`

## Incentive Alignment Issues
- **Crank operator**: Sees VRF randomness before publishing epoch transition. Can sequence own trades around favorable tax rate changes. Bounty (0.001 SOL) is too small to attract competitive honest operators; a single operator could delay epochs to time personal trades.
- **Bonding curve admin**: Has `prepare_transition` (graduation) and `withdraw_graduated_sol` powers. After graduation, admin can extract all remaining SOL from the vault. No timelock or multisig on withdrawal — potential rug vector post-graduation.

## Cross-Focus Handoffs
- **Token/Economic (05)**: Verify sell path `amm_minimum=0` is safe given post-CPI slippage check. Verify bonding curve `calculate_sol_for_tokens` ceil rounding does not create exploitable dust.
- **Oracle (06)**: VRF byte allocation (bytes 0-7) must be verified for independence. Modular bias in `% 4` derivation (256 is divisible by 4, so no bias — confirmed safe).
- **Timing (08)**: Epoch transition timing creates MEV window. Verify CARNAGE_LOCK_SLOTS (50) prevents front-running of atomic carnage. Verify bonding curve FAILURE_GRACE_SLOTS (150) is sufficient.
- **Access Control (01)**: Verify `withdraw_graduated_sol` has appropriate access controls. Verify `prepare_transition` requires admin signer.

## Key Risk Summary
The protocol's economic model is well-designed with multiple layers of protection: the Tax Program as a mandatory gateway prevents direct AMM access, the 50% minimum output floor limits sandwich profitability, and the Synthetix staking model with floor division ensures reward conservation. The highest economic risk is **VRF tax rate front-running by the crank operator**, who has a temporal information advantage on each epoch transition. The bonding curve economics are sound with explicit solvency assertions and 15% sell tax, but the admin's ability to `withdraw_graduated_sol` without timelock is a centralization risk. The Carnage Fund's VRF-driven buyback is economically interesting but creates predictable large swaps that sophisticated actors could sandwich despite slippage floors.
<!-- CONDENSED_SUMMARY_END -->

---

# Economic Model — Full Analysis

## Protocol Economic Summary

Dr. Fraudsworth is a dual-token memecoin yield farm on Solana. Two tokens (CRIME and FRAUD) launch via bonding curves, graduate to AMM pools, and are traded with asymmetric taxes that fund a staking yield system and a randomized buyback-and-burn mechanism.

The economic cycle works as follows: Users buy CRIME or FRAUD tokens through the Tax Program, which deducts a VRF-determined tax (1-14%), splits it three ways (71% staking, 24% carnage fund, 5% treasury), then routes the post-tax SOL to the AMM for the actual swap. Every ~5 minutes (devnet) or ~30 minutes (mainnet), a new epoch starts with fresh VRF-derived tax rates. The "cheap side" concept means one token has low buy tax / high sell tax while the other has the opposite, creating a game-theoretic dynamic where users try to buy the cheap token and sell the expensive one.

The Carnage Fund accumulates SOL from the 24% tax share and, when triggered by VRF randomness (~4.3% per epoch), executes buyback-and-burn operations on one of the two tokens. PROFIT token stakers earn the 71% share as SOL yield. The entire system is designed so that trading activity generates yield for stakers and deflationary pressure on token supply.

## Protocol Type
**Hybrid:** AMM/DEX (constant-product) + Bonding Curve (linear, pre-AMM) + Staking (Synthetix cumulative) + VRF-driven taxation + Buyback-and-burn

## Token Flow Diagram

```
                                 BONDING CURVE PHASE
                                 ====================
    User SOL -----> [Bonding Curve] ----> User gets CRIME/FRAUD tokens
                    |                      (linear price P_START to P_END)
                    v
               [SOL Vault PDA]            User sells back:
                                          Tokens -> Vault, SOL - 15% tax -> User
                                          15% tax -> [Tax Escrow PDA]

    On graduation:  [SOL Vault] ---admin---> [withdraw_graduated_sol]
                    [Tax Escrow] --permissionless--> [Carnage Fund SOL Vault]

                                 AMM TRADING PHASE
                                 =================

                        +-----------+
    User SOL ---------> | Tax Prog  | -----> [AMM Pool]
    (amount_in)         |           |         SOL/CRIME or SOL/FRAUD
                        | Buy flow: |
                        | tax from  |     Pool uses constant-product (x*y=k)
                        | INPUT     |     LP fee (50 bps) stays in pool
                        +-----------+
                        | Tax split:|
                        | 71% ----> [Staking Escrow] --> PROFIT stakers claim SOL
                        | 24% ----> [Carnage SOL Vault]
                        |  5% ----> [Treasury Wallet]
                        +-----------+

    User tokens ------> | Tax Prog  | -----> [AMM Pool]
    (sell flow)         |           |         returns WSOL to user
                        | Sell flow:|
                        | tax from  |     WSOL intermediary close-and-reinit
                        | OUTPUT    |     cycle for atomic unwrap
                        +-----------+
                        | Tax split:|
                        | (same as buy)
                        +-----------+

                                 EPOCH & CARNAGE
                                 ===============

    [Epoch Program] -- VRF --> new tax rates (1-14% buy/sell per token)
                    -- VRF --> carnage trigger (~4.3% chance)

    [Carnage Fund]  -- SOL --> Tax::swap_exempt --> AMM (buy tokens)
                    -- tokens --> burn (98% chance) or sell (2% chance)
                    -- Target: 50/50 CRIME vs FRAUD by VRF

                                 STAKING
                                 =======

    User PROFIT --> [Staking Pool] (lock tokens)
                    Each epoch: Tax deposits SOL to escrow
                    Epoch Program: update_cumulative (finalize rewards)
                    User claims: proportional SOL from escrow
                    Unstake: cooldown period, reward forfeiture

                                 CONVERSION
                                 ==========

    Old token --> [Conversion Vault] --> New token (100:1 fixed rate)
```

## Economic Invariants

### Invariant 1: AMM Constant Product (k-invariant)
- **Property:** For every swap, `reserve_in_after * reserve_out_after >= reserve_in_before * reserve_out_before`
- **Enforcement:** `amm/swap_sol_pool.rs:171-173` — explicit `verify_k_invariant()` check post-computation
- **Can be violated?** No — verified with 10K proptest iterations. The fee (50 bps) is deducted from input before output calculation, so k always increases slightly. Floor division on output also favors the pool.
- **Impact of violation:** Pool drain — attacker could extract more tokens than deposited

### Invariant 2: Tax Distribution Conservation
- **Property:** `staking_portion + carnage_portion + treasury_portion == total_tax` for every swap
- **Enforcement:** `tax_math.rs:105-107` — treasury is computed as `total_tax - staking - carnage` (remainder)
- **Can be violated?** No — remainder-based calculation mathematically guarantees the sum equals the input. Proptest with 10K iterations on u64 range confirms.
- **Impact of violation:** SOL would be created or destroyed during distribution

### Invariant 3: Bonding Curve Solvency
- **Property:** After every sell, `sol_vault.lamports() >= integral(0, tokens_sold) - rent_exempt`
- **Enforcement:** `bonding_curve/sell.rs:284-292` — explicit post-state assertion
- **Can be violated?** The assertion itself prevents violated states from persisting. But note: `sol_returned` tracks gross SOL (before tax), while the vault actually loses `sol_net + tax`. Since `tax` goes to `tax_escrow` (separate PDA), the vault balance is `sol_raised - sol_returned + rent_exempt`. The solvency check computes `expected_from_integral = calculate_sol_for_tokens(0, tokens_sold)` which should equal the vault balance if all sells exactly reverse the buys.
- **Subtle risk:** The ceil rounding on `calculate_sol_for_tokens` for buys means users slightly overpay. For sells, the same function computes gross return. The buy overpayment creates a tiny surplus in the vault, which is correct (vault is slightly over-collateralized).
- **Impact of violation:** Users cannot receive full refunds or sells fail

### Invariant 4: Staking Reward Conservation
- **Property:** No individual staker can claim more than total deposited rewards
- **Enforcement:** `staking/math.rs:46-50` — `(balance * reward_delta) / PRECISION` with floor division
- **Can be violated?** Proptest (10K iterations, 8 properties) validates this. The key protection is PRECISION=1e18 scaling with floor division — dust always stays in the protocol. Dead stake (MINIMUM_STAKE) prevents the first-depositor attack.
- **Impact of violation:** Escrow drain — stakers could extract more SOL than was deposited

### Invariant 5: Bonding Curve Refund Proportionality
- **Property:** Each refund claimer receives `floor(user_balance * refund_pool / tokens_sold)`, and the denominator shrinks for subsequent claimers
- **Enforcement:** `claim_refund.rs:146-149` — floor division with u128 intermediates; `tokens_sold -= user_balance` after transfer
- **Can be violated?** The shrinking denominator means later claimers get a slightly better rate (because earlier claimers' floor rounding left dust). This is acceptable — the final claimer gets all remaining dust.
- **Impact of violation:** Users would not receive fair refunds

### Invariant 6: Tax Rate Bounds
- **Property:** Tax rates are always in {100, 200, 300, 400, 1100, 1200, 1300, 1400} BPS
- **Enforcement:** `tax_derivation.rs:23-26` — LOW_RATES and HIGH_RATES arrays indexed by `vrf_byte % 4`
- **Can be violated?** No — the modulo 4 index into fixed arrays guarantees only valid rates. No modular bias (256 % 4 = 0).
- **Impact of violation:** Zero tax (value extraction) or 100% tax (denial of service)

## Value Extraction Analysis

### Legitimate Value Flows
| Flow | Source | Destination | Amount | Frequency |
|------|--------|-------------|--------|-----------|
| Trading tax | Swap users | Staking/Carnage/Treasury | 1-14% of swap value | Per swap |
| LP fee | Swap users | AMM pool reserves | 50 bps of input | Per swap |
| Bonding curve sell tax | Curve sellers | Tax escrow -> Carnage | 15% of gross proceeds | Per sell |
| Staking yield | Tax revenue | PROFIT stakers | 71% of tax | Per swap |
| Carnage buyback | Carnage fund | Token burns | Up to 1000 SOL per trigger | ~4.3% per epoch |
| Epoch bounty | Carnage vault | Crank operator | 0.001 SOL | Per epoch |
| Treasury | Tax revenue | Admin wallet | 5% of tax | Per swap |

### Adversarial Value Extraction Vectors
| Vector | Type | Estimated Impact | Difficulty | Mitigation |
|--------|------|-----------------|------------|------------|
| VRF tax rate front-running | MEV/Information asymmetry | Up to 13% per trade (rate delta) | Medium (requires mempool monitoring) | Commit-reveal VRF, but crank operator has timing advantage |
| Carnage sandwich | MEV/Sandwich | Up to 15-25% of carnage amount | Medium (requires VRF prediction) | 75-85% slippage floors, VRF unpredictability, lock window |
| Bonding curve buy+sell arbitrage | Flash loan / Atomic | -15% (sell tax makes it unprofitable) | Low (anyone can do it) | 15% sell tax is strong deterrent |
| Staking reward timing | Timing/Gaming | Small (one epoch's rewards) | Low | Cooldown on claim, but starts at claim not stake |
| Admin SOL withdrawal post-graduation | Centralization/Rug | All graduated SOL (~1000 SOL per curve) | Admin only | No timelock — relies on trust |
| Pool creation front-running | MEV | Pool seeding manipulation | Medium | Admin controls pool init |

## Flash Loan Impact Assessment

### Per-Instruction Analysis
| Instruction | Flash Loan Relevant? | Impact | Current Protection |
|-------------|---------------------|--------|-------------------|
| Bonding curve purchase | Yes | Buy at current price, could fill curve | MIN_PURCHASE_SOL, wallet cap (20M tokens) |
| Bonding curve sell | Yes | Sell all tokens, 15% tax loss | 15% sell tax, solvency assertion |
| AMM swap_sol_buy | No (via Tax) | Cannot bypass tax | Tax Program gateway, 50% output floor |
| AMM swap_sol_sell | No (via Tax) | Cannot bypass tax | Tax Program gateway, 50% output floor |
| Staking stake/unstake | Maybe | Stake before epoch reward, unstake after | Cooldown timer, but starts at claim |
| Staking claim | No | Requires prior staking + earned rewards | Checkpoint pattern, floor division |
| Carnage execute | No | Only callable by Epoch PDA | `seeds::program` access control |

### Bonding Curve Flash Loan Scenario
An attacker with large capital could:
1. Buy large amount on bonding curve (pushes price up along curve)
2. Immediately sell all tokens back
3. Loss: 15% sell tax on gross proceeds

The 15% sell tax makes this a guaranteed loss. However, if the attacker could somehow manipulate the curve state between buy and sell (e.g., via a separate instruction), they could extract value. The solvency assertion at `sell.rs:289` prevents this.

**Wallet cap (20M tokens = 4.3% of supply)** limits single-transaction impact on the curve. An attacker would need multiple wallets to accumulate significant curve position.

### AMM Flash Loan Scenario
Flash loans through the AMM are prevented by:
1. `seeds::program = TAX_PROGRAM_ID` — only Tax Program can call AMM swaps
2. Tax Program enforces 1-14% tax on every swap
3. 50% minimum output floor prevents sandwich-level manipulation
4. Reentrancy guard on pool state

## MEV & Ordering Analysis

### Sandwich-Vulnerable Operations
| Operation | Slippage Protected? | Deadline? | Max Extractable |
|-----------|-------------------|-----------|-----------------|
| AMM buy (via Tax) | Yes (50% floor + user min) | No | Up to 50% of expected output in extreme case |
| AMM sell (via Tax) | Yes (50% floor + user min) | No | Up to 50% of expected output in extreme case |
| Bonding curve purchase | Yes (minimum_tokens_out) | Yes (deadline_slot) | Limited by curve shape (linear, predictable) |
| Bonding curve sell | Yes (minimum_sol_out) | Yes (deadline_slot) | Limited by curve shape |
| Carnage atomic | Partial (85% floor) | Yes (300 slots) | Up to 15% of carnage amount |
| Carnage fallback | Partial (75% floor) | Yes (300 slots) | Up to 25% of carnage amount |
| Epoch transition | N/A (no value transfer) | No | Information advantage on tax rates |

### Critical: Sell Path `amm_minimum=0`
In `swap_sol_sell.rs:147`, the AMM CPI is called with `amm_minimum: u64 = 0`. This means the AMM itself will accept ANY output amount. The slippage check happens AFTER the CPI at `swap_sol_sell.rs:245`:
```rust
require!(net_output >= minimum_output, TaxError::SlippageExceeded);
```
This is safe because:
1. The buy and sell happen in the same transaction (atomic)
2. No external actor can intervene between the AMM CPI and the slippage check
3. The post-CPI balance diff correctly captures the actual output

However, the `minimum_output` in the sell path represents net output (after tax), not gross. A user who sets `minimum_output` to a reasonable value based on current rates is still protected.

### VRF Tax Rate MEV
This is the most significant MEV vector:

1. Crank operator calls `trigger_epoch_transition` which requests VRF
2. VRF result is committed, then revealed, then consumed
3. `consume_randomness` reads VRF bytes and sets new tax rates
4. Between reveal and consume (or even during the consume TX), the crank operator knows the new rates

If the new epoch makes CRIME cheap (1% buy tax, 14% sell tax) while FRAUD becomes expensive (14% buy tax, 1% sell tax), an informed actor could:
- Buy CRIME before the epoch transition (at the old higher rate)
- Wait for transition to confirm
- Sell CRIME at the new lower sell rate (1%)

The value extracted is the difference in tax rates, up to 13% of trade value.

**Current mitigation:** Switchboard commit-reveal prevents prediction of VRF outcome before the reveal step. But the crank operator who calls `commit_epoch_vrf` and `reveal_epoch_vrf` has a timing advantage — they know the result as soon as it's revealed and can submit trades in the same block.

## Incentive Analysis

### Actor Incentive Matrix
| Actor | Goal | Aligned? | Perverse Incentive Risk |
|-------|------|----------|----------------------|
| Trader | Buy cheap, sell expensive | Yes | May time trades around epoch boundaries for rate advantage |
| PROFIT Staker | Maximize SOL yield | Yes | No perverse incentive — more trading = more yield |
| Crank Operator | Earn 0.001 SOL bounty | Partially | Could delay epoch transitions to time personal trades, or front-run rate changes |
| Admin | Protocol health | Partially | Can withdraw graduated SOL without timelock. Can force carnage (devnet only) |
| Carnage Fund | Reduce token supply | Yes | VRF ensures randomness. No actor can reliably predict outcomes |
| Bonding Curve Buyer | Get tokens at good price | Yes | Early buyers get lowest price. Wallet cap prevents whale dominance |
| Refund Claimer | Recover SOL from failed curve | Yes | Floor division means early claimers get slightly less (dust). Fair by design |

### Crank Operator Risk (Detailed)
The crank operator has these capabilities:
1. Call `trigger_epoch_transition` (permissionless) — earns 0.001 SOL bounty
2. Call `commit_epoch_vrf` and `reveal_epoch_vrf` — standard Switchboard flow
3. Call `consume_randomness` — finalizes new tax rates and checks carnage

The risk: A single operator running the crank can time their own trades around epoch transitions. Since they're the first to know the new tax rates (they observe the VRF result), they have an information edge.

**Mitigation quality:** The 0.001 SOL bounty is intentionally small to attract automated bots, not manual operators. Multiple competing bots would reduce any single operator's timing advantage. However, in practice (per project memory), a single Railway-hosted crank runner exists, giving that operator monopolistic information access.

### Admin Risk (Post-Graduation)
After bonding curves graduate:
1. Admin calls `prepare_transition` to mark both curves as Graduated
2. Admin calls `withdraw_graduated_sol` to extract remaining SOL from curve vaults
3. No timelock, no multisig, no cap on withdrawal amount

This is functionally similar to the LIBRA/MELANIA rug pattern identified in the AMM attack playbook. While the graduated SOL was always intended for AMM pool seeding, the admin has discretion over timing and amount.

**Mitigation:** Programs are deployed non-upgradeable (deploy-and-lock per architecture). The admin key can only call specific functions. But `withdraw_graduated_sol` has no on-chain restriction beyond admin signer.

## Bonding Curve Economics

### Price Discovery Model
- Linear curve: P(x) = 900 + 2550 * x / 460e12 (lamports per human token)
- Start price: 0.0000009 SOL (~$0.00013 at $150 SOL)
- End price: 0.00000345 SOL (~$0.00052 at $150 SOL)
- Full curve integral: ~1000.5 SOL
- Total tokens for sale: 460M per curve (46% of 1B supply)

### Graduation Path
1. Both CRIME and FRAUD curves must fill (460M tokens sold each)
2. Admin calls `prepare_transition` — both curves marked Graduated
3. Admin withdraws SOL from curve vaults
4. AMM pools are seeded (separately, off-chain script)
5. Tax escrow distributed to Carnage Fund (permissionless)

**Risk:** Gap between graduation and AMM pool seeding. During this window:
- Users hold tokens but cannot trade
- No on-chain enforcement that AMM seeding happens
- Admin controls timing

### Refund Mechanism
If either curve fails (deadline passes without filling):
1. `mark_failed` (permissionless after deadline + grace)
2. `consolidate_for_refund` — merge tax escrow into SOL vault
3. `claim_refund` — burn tokens, receive proportional SOL

**Tax escrow consolidation** means sellers' 15% tax is returned to the refund pool. This is fair — if the project fails, tax shouldn't be kept.

**Refund math:** `floor(user_balance * refund_pool / tokens_sold)` with shrinking denominator. The last claimer gets all remaining dust. Maximum dust loss per claimer: 1 lamport.

### Arbitrage Opportunities
At graduation, the bonding curve end price is P_END = 3450 lamports/human token = 0.00000345 SOL. If AMM pools are seeded at exactly this ratio, there's no arbitrage. But the AMM pool seeding uses P_END-derived ratios (1000 SOL / 290M tokens per MEMORY), which equals 0.000003448... SOL/token — very close to P_END but not exact due to rounding. The arbitrage window is negligible (sub-lamport).

## Cross-Program Economic Coupling

### Tax Program as Economic Gateway
The Tax Program is the single entry point for all AMM trades. This creates strong coupling:
- If Tax Program is paused (e.g., invalid EpochState), all trading stops
- Tax rates from EpochState directly affect all trade economics
- The 50% output floor in Tax Program overrides user slippage settings

### Staking-Tax Coupling
Every swap deposits 71% of tax to staking escrow via CPI. The `deposit_rewards` CPI updates `pending_rewards` counter. If this CPI fails, the entire swap fails. This means staking program bugs can halt all trading.

### Epoch-Staking Coupling
`update_cumulative` is called by Epoch Program to finalize rewards. If epoch transitions stop (e.g., VRF oracle down), rewards stop accumulating. The protocol handles this gracefully — rewards stay in `pending_rewards` until the next successful transition.

### Carnage-Tax-AMM Coupling
Carnage execution chains through 4 programs: Epoch -> Tax -> AMM -> Token-2022 -> Hook. This is AT THE SOLANA CPI DEPTH LIMIT (4). Any additional CPI nesting would fail. The coupling means a bug in any of these 4 programs can block carnage execution.

## Economic Risk Observations

- **Observation 1: Single crank operator creates information monopoly.** The Railway-hosted crank runner is the only entity processing epoch transitions. This single point has timing advantage on every rate change. Recommend: incentivize competing crank operators via higher bounty.

- **Observation 2: Admin `withdraw_graduated_sol` lacks timelock.** After graduation, admin can extract ~1000 SOL per curve without delay. This is a centralization risk. Recommend: timelock + multisig on post-graduation withdrawals.

- **Observation 3: Bonding curve has no same-slot restriction.** Buy and sell can happen in the same slot/transaction. While the 15% sell tax makes arbitrage unprofitable, this could be exploited if the tax math has any edge case producing tax=0 (e.g., very small amounts where ceil rounds to 0). The current ceil formula `(sol_gross * 1500 + 9999) / 10000` ensures tax >= 1 for any `sol_gross >= 7` (since 7*1500 + 9999 = 20499 / 10000 = 2). For `sol_gross < 7`, tax could be 0-1. Minimum purchase is 0.05 SOL (50M lamports), and minimum sell proceeds would be similarly large, so this edge case is not reachable in practice.

- **Observation 4: Carnage Fund accumulation rate.** With 24% of all tax going to Carnage, and only ~4.3% chance of triggering per epoch, the fund accumulates much faster than it burns. At mainnet scale with significant trading volume, the fund could hold hundreds of SOL, creating increasingly large market-moving swaps. The MAX_CARNAGE_SWAP_LAMPORTS (1000 SOL) cap helps but large swaps still move thin-liquidity pools significantly.

- **Observation 5: Staking cooldown starts at claim, not at stake.** `last_claim_ts` is set in `claim.rs:119`. The cooldown prevents unstaking for COOLDOWN_SECONDS after claiming. But a user who stakes and never claims can unstake immediately (after general cooldown). This means reward-timing attacks are possible: stake before epoch finalization, let rewards accumulate for one epoch, then unstake without ever claiming (forfeiting rewards but avoiding cooldown). However, forfeiture returns rewards to pending_rewards for other stakers, so this is self-punishing.

- **Observation 6: Conversion vault fixed rate.** The 100:1 conversion rate is hardcoded. If token prices diverge significantly from this ratio, arbitrage between conversion and market trading becomes profitable. This is presumably by design (one-time migration).

## Cross-Reference Notes
- For Token/Economic focus (05): Verify the sell path `amm_minimum=0` safety. Check if bonding curve solvency assertion handles the rent-exempt subtraction correctly for edge cases near zero tokens_sold.
- For Oracle focus (06): VRF byte independence — bytes 0-4 are used for tax, bytes 5-7 for carnage. Verify no correlation. Check Switchboard commit-reveal timing for information leakage.
- For Timing focus (08): Epoch boundary creates MEV window. Bonding curve deadline + grace period timing. Carnage lock window (50 slots) vs deadline (300 slots) timing.
- For Access Control (01): `withdraw_graduated_sol` admin control. `prepare_transition` admin control. `force_carnage` devnet-only gate.

## Raw Notes

### Tax Rate Distribution Analysis
- 4 discrete low rates: 100, 200, 300, 400 BPS (each 25% probability via `% 4`)
- 4 discrete high rates: 1100, 1200, 1300, 1400 BPS (each 25% probability)
- 75% flip probability means the cheap side changes 3/4 of the time
- Expected tax per swap: avg(low) = 250 BPS, avg(high) = 1250 BPS
- For a random trade: 50% chance of hitting cheap side (buy low, sell high) and 50% expensive
- Expected blended rate per swap direction: (250 + 1250) / 2 = 750 BPS = 7.5%

### Bonding Curve Value Flow Accounting
- Total SOL raised if curve fills: ~1000.5 SOL (P_START=900 produces slight surplus)
- Maximum sell tax collected: 15% of all sells. If 100% of tokens are sold back: ~150 SOL
- After graduation: ~1000 SOL in vault, ~0-150 SOL in tax escrow
- Tax escrow routes to Carnage Fund on graduation
- Vault SOL routes to admin on graduation (for AMM seeding)

### Staking Math Overflow Boundaries
- PRECISION = 1e18 (u128)
- Max realistic: 1B PROFIT staked (1e15 with 6 decimals)
- Max reward_per_token per epoch: u64::MAX * 1e18 / 1 = ~1.8e37 (within u128)
- Max cumulative after 100 years: ~5.8e22 (within u128, far from 3.4e38 max)
- Safe for protocol lifetime

### AMM Pool Reserve Overflow Check
- Max reserves: u64::MAX each = ~1.8e19
- k = reserve_a * reserve_b computed in u128: (1.8e19)^2 = 3.24e38 < 3.4e38 (u128 max)
- SAFE but barely — u64::MAX * u64::MAX is within u128 by a factor of ~1.05x
- For realistic values (max ~1000 SOL = 1e12, max tokens = 1e15): k = 1e27, well within range
