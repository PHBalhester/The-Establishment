<!-- CONDENSED_SUMMARY_START -->
# Economic Model -- Condensed Summary

## Protocol Type & Core Mechanic
Multi-token memecoin protocol with asymmetric taxation, VRF-driven epoch mechanics, and Synthetix-style staking. Three tokens (CRIME, FRAUD, PROFIT) trade through a Tax Program router that levies dynamic 3-14% buy/sell taxes, splits revenue 71/24/5 (staking/Carnage Fund/treasury), and routes swaps through a constant-product AMM. A linear bonding curve bootstraps initial supply.

## Top Economic Invariants
- INVARIANT: k_after >= k_before for every AMM swap -- enforced at `amm/src/instructions/swap_sol_pool.rs:171-173` (checked via verify_k_invariant)
- INVARIANT: staking + carnage + treasury == total_tax for every tax distribution -- enforced at `tax-program/src/helpers/tax_math.rs:105-107` (treasury = remainder)
- INVARIANT: cumulative rewards_per_token_stored is monotonically non-decreasing -- enforced at `staking/src/helpers/math.rs:134` (only checked_add, never subtract)
- INVARIANT: no single user claim can exceed total deposited rewards -- enforced by floor division truncation in `staking/src/helpers/math.rs:65-70`
- INVARIANT: bonding curve tokens_out <= remaining supply -- enforced at `bonding_curve/src/math.rs:107` (capped via min)
- INVARIANT: conversion vault rate is fixed at 100:1 -- enforced at `conversion-vault/src/instructions/convert.rs:101-113` (hardcoded CONVERSION_RATE)

## Flash Loan Impact (Critical)
Flash loans are NOT directly available within the protocol (no flash loan instruction exists). However, external flash loans from Jupiter/Solend could be used to manipulate AMM pool reserves before interacting with the protocol. The 50% minimum output floor (`MINIMUM_OUTPUT_FLOOR_BPS = 5000`) protects regular swaps from extreme manipulation, and the AMM's swap_authority access control (Tax Program PDA only) prevents direct AMM access. Carnage Fund swaps use 75-85% slippage floors. The staking system's `update_rewards` checkpoint pattern (called before any balance change) prevents flash-stake reward extraction.
- **AMM pool manipulation before Carnage**: An attacker could pump/dump a pool before a predictable Carnage buy, then reverse after -- but VRF unpredictability and atomic execution largely mitigate this.

## MEV & Sandwich Vulnerability
All user-facing swaps have slippage protection (`minimum_output` on buy, `minimum_output` on sell checked after tax). The 50% output floor rejects bots setting zero-slippage. Carnage Fund has the highest MEV sensitivity: the epoch transition + Carnage execution can be front-run if the attacker predicts the VRF outcome. Atomic bundling (consume_randomness + execute_carnage_atomic in one TX) is the primary defense. The fallback path (separate TX after lock window) has 75% slippage -- a 25% MEV extraction window.
- **Carnage fallback path**: max extractable ~25% of Carnage swap size (up to 1000 SOL * 25% = 250 SOL in extreme case)

## Value Extraction Vectors (Prioritized)
1. **Carnage MEV (fallback path)**: Sandwich attack -- estimated impact: up to 250 SOL per Carnage execution -- `epoch-program/src/helpers/carnage_execution.rs:331-349`
2. **Treasury pubkey mismatch (mainnet)**: CRITICAL config issue -- `tax-program/src/constants.rs:146-148` -- mainnet build uses devnet wallet, not mainnet treasury
3. **Bonding curve sell tax escrow solvency**: Cumulative rounding dust erodes vault -- estimated impact: ~1 lamport/sell -- `bonding_curve/src/constants.rs:138-142` (10 lamport buffer mitigates)
4. **Conversion vault arbitrage**: Fixed 100:1 rate creates arbitrage if market rate diverges from 100:1 -- estimated impact: depends on market conditions -- `conversion-vault/src/instructions/convert.rs:101-113`
5. **Reward dust accumulation**: Division truncation keeps ~0.1% of rewards as protocol dust over time -- `staking/src/helpers/math.rs:65-70`

## Incentive Alignment Issues
- **Epoch trigger caller**: Paid 0.001 SOL bounty regardless of whether Carnage triggers. Incentive is to trigger as early as possible (good alignment), but the fixed bounty means no competition during congestion.
- **Unstaking users**: Forfeit ALL pending rewards on unstake. This strongly discourages withdrawal but could create a "too afraid to leave" dynamic where stale capital remains despite wanting to exit.
- **Carnage Fund keeper**: Anyone can call execute_carnage after the lock window. No bounty for fallback execution -- relies on altruism or protocol automation.

## Cross-Focus Handoffs
- **Token/Economic**: Verify that `held_token` raw u8 matching (0/1/2) in carnage_execution.rs:477-481 cannot be set to invalid values; verify mint ordering assumption for pool reserves in `read_pool_reserves`
- **Oracle**: VRF freshness check at `trigger_epoch_transition.rs:174` uses `saturating_sub` -- a future-dated `seed_slot` would pass freshness. Verify Switchboard contract guarantees `seed_slot <= clock.slot`
- **Timing**: Carnage lock window (50 slots / ~20s) vs deadline (300 slots / ~2 min) timing. If validator manipulates slot progression, atomic window could be shortened/bypassed. Clock regression in unstake cooldown check (`unstake.rs:127-129`)

## Key Risk Summary
The protocol's core economic model is well-designed with belt-and-suspenders protections: checked arithmetic throughout, k-invariant verification, output floors, and the Synthetix reward pattern. The highest economic risk is Carnage Fund MEV extraction on the fallback path, where a 25% slippage tolerance creates a sandwich opportunity. The treasury pubkey configuration issue (devnet wallet in mainnet build) is a critical deployment risk, not a protocol design flaw. The conversion vault's fixed 100:1 rate is an intentional design choice that creates bounded arbitrage opportunities proportional to market price divergence. The staking system's reward forfeiture on unstake creates strong alignment but may discourage participation if perceived as punitive.
<!-- CONDENSED_SUMMARY_END -->

---

# Economic Model -- Full Analysis

## Protocol Economic Summary

Dr. Fraudsworth is a multi-token memecoin protocol built on Solana with sophisticated tokenomics. The protocol operates three tokens (CRIME, FRAUD, PROFIT) with a dynamic tax regime that changes each epoch (~30 minutes on mainnet). Every swap through the Tax Program incurs a 3-14% tax depending on which token is "cheap" (determined by VRF randomness). This tax is split 71/24/5 between staking rewards, the Carnage Fund, and the treasury.

The protocol's core economic innovation is the Carnage Fund: a VRF-driven market-making mechanism that randomly triggers (~4.3% per epoch) to buy one token with accumulated tax revenue, with a small chance of burning or selling existing holdings first. This creates unpredictable buy pressure that counteracts sell pressure and adds game-theoretic uncertainty.

PROFIT tokens serve as the staking/governance token. Users stake PROFIT to earn SOL yield from the 71% staking allocation. The Synthetix-style cumulative reward model distributes yield proportionally. A bonding curve (linear y=mx+b) bootstraps initial CRIME/FRAUD supply, and a conversion vault allows fixed-rate 100:1 exchange between CRIME/FRAUD and PROFIT.

## Protocol Type
Hybrid: AMM (constant-product) + Staking (Synthetix-style) + Bonding Curve (linear) + VRF-driven rebalancing + Token extensions (Transfer Hook whitelist)

## Token Flow Diagram

```
                          ┌─────────────────┐
                          │   USER (SOL)     │
                          └────────┬─────────┘
                                   │ swap_sol_buy / swap_sol_sell
                                   ▼
                    ┌──────────────────────────────┐
                    │        TAX PROGRAM            │
                    │                                │
                    │  Buy: tax on SOL INPUT         │
                    │  Sell: tax on WSOL OUTPUT       │
                    │                                │
                    │  Tax = amount * tax_bps / 10000 │
                    └──────┬──────┬──────┬───────────┘
                           │      │      │
                 ┌─────────┘      │      └─────────┐
                 ▼                ▼                  ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │ STAKING (71%)│ │ CARNAGE (24%)│ │ TREASURY (5%)│
         │              │ │              │ │              │
         │ escrow_vault │ │ sol_vault    │ │ treasury_pk  │
         │ (SOL PDA)    │ │ (SOL PDA)    │ │ (wallet)     │
         └──────┬───────┘ └──────┬───────┘ └──────────────┘
                │                │
                │                │ VRF triggers Carnage (~4.3%/epoch)
                │                ▼
                │      ┌─────────────────────────┐
                │      │   CARNAGE EXECUTION      │
                │      │                          │
                │      │ 1. Dispose: Burn/Sell/None│
                │      │ 2. Wrap SOL -> WSOL       │
                │      │ 3. Buy target token       │
                │      │    (via swap_exempt)       │
                │      │ 4. Hold tokens in vault    │
                │      └─────────────────────────┘
                │
                ▼
         ┌─────────────────────────┐
         │   STAKING PROGRAM       │
         │                          │
         │ deposit_rewards: +=SOL   │
         │ update_cumulative:       │
         │   rpt += pending*P/total │
         │                          │
         │ claim: SOL -> user       │
         │ stake: PROFIT -> vault   │
         │ unstake: PROFIT -> user  │
         │   (forfeits rewards)     │
         └─────────────────────────┘

     ┌───────────────────────────────┐
     │      AMM (Constant Product)   │
     │                                │
     │ Pools: CRIME/SOL, FRAUD/SOL   │
     │ Formula: x * y = k            │
     │ Fee: lp_fee_bps (100 = 1%)    │
     │ Access: swap_authority PDA     │
     │         (Tax Program only)     │
     └───────────────────────────────┘

     ┌───────────────────────────────┐     ┌──────────────────────┐
     │   BONDING CURVE (Linear)       │     │  CONVERSION VAULT    │
     │                                │     │                      │
     │ P(x) = P_START + slope * x     │     │ CRIME/FRAUD -> PROFIT│
     │ P_START=450, P_END=1725        │     │  (divide by 100)     │
     │ 460M tokens, ~500 SOL target   │     │ PROFIT -> CRIME/FRAUD│
     │ 15% sell tax -> tax escrow     │     │  (multiply by 100)   │
     └───────────────────────────────┘     └──────────────────────┘
```

## Economic Invariants

### Invariant 1: AMM Constant Product (k_after >= k_before)
- **Property:** After every swap, the product of pool reserves must not decrease. LP fees cause k to increase slightly each swap.
- **Enforcement:** `amm/src/instructions/swap_sol_pool.rs:171-173` -- `verify_k_invariant()` is called after reserve updates, before token transfers. Returns `AmmError::KInvariantViolation` on failure.
- **Can be violated?** No, under normal operation. The math is: `output = reserve_out * effective_input / (reserve_in + effective_input)` where `effective_input = amount_in * (10000 - fee_bps) / 10000`. Since fee is deducted before the formula, the full `amount_in` is added to reserves while only `effective_input` is used to calculate output. The difference (the fee) strictly increases k. Proptest with 10,000 iterations validates this property.
- **Impact of violation:** Pool could be drained. Users could extract more tokens than the pool holds.

### Invariant 2: Tax Distribution Conservation (staking + carnage + treasury == total_tax)
- **Property:** Every lamport of collected tax must be distributed to exactly one of three destinations. No value created or destroyed.
- **Enforcement:** `tax-program/src/helpers/tax_math.rs:95-107` -- staking = floor(total * 7100/10000), carnage = floor(total * 2400/10000), treasury = total - staking - carnage. The remainder pattern guarantees exact conservation.
- **Can be violated?** No. The remainder-based treasury calculation is mathematically sound. Proptest `split_sum_equals_input` validates with 10,000 iterations across the full u64 range.
- **Impact of violation:** Would create or destroy SOL, breaking the protocol's accounting.

### Invariant 3: Staking Reward Monotonicity (rewards_per_token_stored only increases)
- **Property:** The cumulative reward-per-token stored value never decreases. This ensures users who staked earlier have a higher checkpoint delta.
- **Enforcement:** `staking/src/helpers/math.rs:134` -- `pool.rewards_per_token_stored = pool.rewards_per_token_stored.checked_add(reward_per_token)`. Only `checked_add` is used; there is no subtraction path.
- **Can be violated?** No, by construction. The `reward_per_token` calculated in `add_to_cumulative` is always >= 0 (unsigned), and `checked_add` returns `Err` on overflow rather than wrapping.
- **Impact of violation:** Users would see negative reward deltas, causing `checked_sub` to fail in `update_rewards`, or (if unchecked) allowing claims of phantom rewards.

### Invariant 4: Bonding Curve Supply Cap
- **Property:** Total tokens sold from a bonding curve cannot exceed TOTAL_FOR_SALE (460M tokens with 6 decimals).
- **Enforcement:** `bonding_curve/src/math.rs:107` -- `let tokens_out = delta_x.min(remaining)` caps output at remaining supply.
- **Can be violated?** No. The `remaining` calculation uses `checked_sub` from TOTAL_FOR_SALE, and the `min` clamp prevents exceeding it.
- **Impact of violation:** Would mint excess supply, diluting all token holders.

### Invariant 5: Staking Solvency (sum of claims <= total deposited)
- **Property:** The sum of all individual user reward claims cannot exceed the total SOL deposited into the escrow vault.
- **Enforcement:** Floor division in `staking/src/helpers/math.rs:65-70`. `pending = (balance * reward_delta) / PRECISION` truncates, so the sum of all users' pending rewards <= original deposit. Additionally, `claim.rs:109-111` checks escrow balance >= claim amount.
- **Can be violated?** In theory, accumulated rounding dust could leave a tiny amount (< 1 lamport per user per epoch) of "phantom rewards" that cannot be claimed because the escrow is short. The rent-exempt check in claim.rs prevents draining below rent-exempt minimum. This is by design -- protocol keeps dust.
- **Impact of violation:** Escrow insolvency would cause late claimers to fail with `InsufficientEscrowBalance`.

### Invariant 6: Conversion Vault Fixed Rate
- **Property:** CRIME/FRAUD converts to PROFIT at exactly 100:1, and vice versa.
- **Enforcement:** `conversion-vault/src/instructions/convert.rs:103` -- `amount_in / CONVERSION_RATE` (integer division) for faction->PROFIT; `amount_in.checked_mul(CONVERSION_RATE)` for PROFIT->faction.
- **Can be violated?** No, the rate is hardcoded. But the vault's output balance must be sufficient -- if the vault runs out of PROFIT tokens, conversions fail.
- **Impact of violation:** Would create arbitrage opportunities if the rate drifted from 100:1.

## Value Extraction Analysis

### Legitimate Value Flows
| Flow | Source | Destination | Amount | Frequency |
|------|--------|-------------|--------|-----------|
| Buy tax | User SOL input | staking/carnage/treasury | 3-14% of SOL input | Per buy TX |
| Sell tax | User WSOL output | staking/carnage/treasury | 3-14% of WSOL output | Per sell TX |
| LP fee | Swapper effective input | AMM pool reserves | lp_fee_bps (100 = 1%) | Per swap |
| Staking yield | Tax escrow SOL | User wallet (claim) | proportional to stake | Per claim |
| Epoch bounty | Epoch Program | Trigger caller | 0.001 SOL | Per epoch transition |
| Carnage buy | Carnage SOL vault | AMM pool (buys tokens) | min(available, 1000 SOL) | ~4.3% of epochs |
| Bonding curve sell tax | Buyer SOL | Tax escrow PDA | 15% of sell proceeds | Per bonding curve sell |

### Adversarial Value Extraction Vectors
| Vector | Type | Estimated Impact | Difficulty | Mitigation |
|--------|------|-----------------|------------|------------|
| Carnage fallback sandwich | MEV | Up to 250 SOL (25% of 1000 SOL cap) | Medium | 75% slippage floor, VRF unpredictability |
| Epoch transition front-running | MEV | ~0.001 SOL bounty theft | Low | Not economically significant |
| Conversion vault arbitrage | Economic | Proportional to market:fixed rate divergence | Low | Fixed by design; vault balance limits exposure |
| Tax-rate-change trading | MEV/Info | Variable; based on epoch boundary knowledge | Medium | VRF makes next rates unpredictable |
| Bonding curve rounding profit | Rounding | ~1 lamport per transaction | High volume needed | SOLVENCY_BUFFER_LAMPORTS (10) |
| Reward dust accumulation | Rounding | Sub-lamport per staker per epoch | N/A (systemic) | By design; protocol keeps dust |

## Flash Loan Impact Assessment

### Per-Instruction Analysis
| Instruction | Flash Loan Relevant? | Impact | Current Protection |
|-------------|---------------------|--------|-------------------|
| swap_sol_buy | Maybe | Flash loan could fund large buys to move price, but tax is paid regardless | 50% output floor; swap_authority access control |
| swap_sol_sell | Maybe | Flash loan could fund large sells; tax extracted from output | 50% output floor; minimum_output after tax |
| stake | No | Staking updates rewards BEFORE balance change; flash-stake earns 0 rewards | Checkpoint pattern (update_rewards before balance change) |
| unstake | No | Unstake forfeits all pending rewards; no benefit to flash-unstake | Rewards forfeited; cooldown timer |
| claim | No | Cannot claim without having earned rewards over time | rewards_earned requires genuine staking duration |
| execute_carnage_atomic | Maybe | Pool can be manipulated before Carnage buy; VRF+atomicity defend | 85% slippage floor; VRF unpredictability; single-TX execution |
| execute_carnage (fallback) | Yes | Pool can be manipulated between consume_randomness and execute_carnage | 75% slippage floor; deadline window |
| bonding_curve::purchase | No | Price is deterministic from curve position; no pool to manipulate | Linear curve math; MAX_TOKENS_PER_WALLET cap |
| bonding_curve::sell | No | SOL payout determined by integral math; no external price dependency | Solvency check; integral-based pricing |
| conversion_vault::convert | No | Fixed 100:1 rate; no external price to manipulate | Hardcoded rate; vault balance check |

### Flash Loan Composite Attack Analysis
The most concerning flash loan scenario involves the Carnage Fund fallback path:
1. Flash borrow large SOL amount from external protocol
2. Observe consume_randomness has set carnage_target = CRIME
3. Sell CRIME aggressively to dump price on AMM pool
4. Wait for execute_carnage fallback (after lock window at slot +50)
5. Carnage buys CRIME at the depressed price, getting fewer tokens
6. Buy CRIME cheaply on the pumped pool after Carnage
7. Repay flash loan

This is mitigated by: (a) atomic path executing first in most cases, (b) 75% slippage floor rejecting extreme manipulation, (c) VRF making the target unpredictable until reveal, (d) the attacker needing to hold the position for 50+ slots (not truly atomic). The maximum extractable value is bounded by: `carnage_swap_amount * (1 - 0.75) = up to 250 SOL` for a 1000 SOL Carnage swap.

## MEV & Ordering Analysis

### Sandwich-Vulnerable Operations
| Operation | Slippage Protected? | Deadline? | Max Extractable |
|-----------|-------------------|-----------|-----------------|
| swap_sol_buy | Yes (minimum_output + 50% floor) | No deadline | Limited by floor to ~50% of expected |
| swap_sol_sell | Yes (minimum_output after tax + 50% floor) | No deadline | Limited by floor to ~50% of expected |
| execute_carnage_atomic | Yes (85% slippage floor) | 300 slots | ~15% of swap amount |
| execute_carnage (fallback) | Yes (75% slippage floor) | 300 slots | ~25% of swap amount |
| bonding_curve::purchase | No slippage param | Deadline slot | Deterministic pricing -- not sandwichable |
| staking (stake/unstake/claim) | N/A | N/A | Not applicable -- no price-dependent operation |

### Carnage MEV Deep Analysis
The Carnage Fund is the protocol's most MEV-sensitive component:

**Atomic path (primary):** consume_randomness + execute_carnage_atomic bundled in one TX. The VRF outcome is unknown until consume_randomness executes, so the attacker cannot front-run the target token selection. The slippage floor is 85%. This is well-protected.

**Fallback path (recovery):** If atomic path fails (e.g., compute budget exceeded), `carnage_pending` is set to true. After `CARNAGE_LOCK_SLOTS` (50 slots / ~20 seconds), anyone can call `execute_carnage`. At this point, `carnage_target` is visible on-chain. An attacker can:
1. Read carnage_target from EpochState
2. Manipulate the target pool by buying (to inflate price)
3. Submit execute_carnage
4. Sell after Carnage executes at the inflated price

The 75% slippage floor limits extraction to 25% of the Carnage swap amount. With `MAX_CARNAGE_SWAP_LAMPORTS = 1000 SOL`, the theoretical maximum loss is 250 SOL per Carnage fallback execution.

**Mitigation adequacy:** The atomic path succeeds in the vast majority of cases (the only failure mode is compute budget exhaustion on complex Sell+Buy paths). The fallback path is a safety valve, not the normal flow. The 75% floor is intentionally lenient to ensure execution succeeds even in unfavorable conditions.

## Incentive Analysis

### Actor Incentive Matrix
| Actor | Goal | Aligned? | Perverse Incentive Risk |
|-------|------|----------|----------------------|
| Token Buyer | Buy cheap tokens | Yes | Buys create tax revenue for stakers; tax discourages pure speculation on "cheap side" |
| Token Seller | Sell tokens for SOL | Yes | Sells create tax revenue; higher sell tax discourages panic selling |
| PROFIT Staker | Earn SOL yield | Yes | Long-term alignment; 12-hour cooldown after claim discourages mercenary capital |
| Epoch Trigger Caller | Earn 0.001 SOL bounty | Partially | Bounty is fixed regardless of timing optimization; no competition incentive during congestion |
| Carnage Executor (atomic) | Execute atomically | Yes | Bundled with consume_randomness, incentivized by epoch trigger bounty |
| Carnage Executor (fallback) | Execute fallback | No | No bounty for fallback; relies on altruism or protocol-run crank |
| Protocol Admin | Maintain protocol health | Partially | Admin retains AMM admin and upgrade authority; Squads multisig + timelock mitigate |
| Bonding Curve Buyer | Early price advantage | Yes | Linear curve rewards early participants proportionally |
| Conversion Vault User | Arbitrage market vs fixed rate | Neutral | Fixed rate creates bounded arbitrage; vault balance limits exposure |

### Incentive Misalignment: Unstake Forfeiture
The protocol forfeits ALL pending rewards on unstake. This creates a strong hold incentive but may cause:
- **Sunk cost fallacy**: Users stay staked even when they should exit, creating artificial lock-in
- **All-or-nothing exit**: Users who need partial liquidity must forfeit all rewards rather than just partial
- **Late staker disadvantage**: Users who stake late in an epoch get rewards but face the same forfeiture risk as early stakers

This is partially mitigated by the claim instruction (claim rewards without unstaking) and the 12-hour cooldown (prevents claim-then-unstake in quick succession).

### Incentive Misalignment: Carnage Fund No-Bounty Fallback
If the atomic Carnage path fails, there is no economic incentive for anyone to execute the fallback. The protocol relies on its own crank service (running on Railway) to execute fallback Carnage. If the crank is down, Carnage execution expires after 300 slots (~2 minutes) and the accumulated SOL remains in the Carnage vault until the next trigger. This is a liveness concern, not a safety concern.

## Economic Risk Observations

### 1. Asymmetric Tax Regime Gaming
The VRF-driven tax rate switching creates a game-theoretic opportunity: traders who can quickly react to epoch transitions can:
- Buy the newly-cheap token at low tax (3%) immediately after the epoch changes
- Sell the newly-expensive token at low sell tax (3%) before the market adjusts

The VRF makes the outcome unpredictable, but the epoch transition is permissionless and observable on-chain. Fast actors (bots) will consistently capture this edge over slow actors (humans). The 30-minute epoch length provides substantial time for the market to adjust, limiting the alpha.

### 2. Conversion Vault Fixed Rate Arbitrage
The 100:1 fixed rate creates a persistent arbitrage opportunity whenever the market rate diverges:
- If CRIME trades at >100x PROFIT price: Buy PROFIT on AMM, convert 1 PROFIT -> 100 CRIME at vault, sell CRIME on AMM for profit
- If CRIME trades at <100x PROFIT price: Buy CRIME on AMM, convert 100 CRIME -> 1 PROFIT at vault, sell PROFIT on AMM for profit

This is bounded by vault token balances (cannot extract more than the vault holds) and by swap taxes (3-14% on each leg). The vault drains naturally through arbitrage until equilibrium is restored. This may be intentional (ensuring the conversion rate is market-enforced).

### 3. Staking Reward Dilution from Reward Forfeiture Recycling
When users unstake, their forfeited rewards are added back to `pending_rewards`. This means:
- Remaining stakers benefit from forfeitures (rewards are redistributed)
- If a large staker exits, the reward boost to remaining stakers is proportional
- This creates a **game of chicken**: each staker is incentivized to be the last one remaining

In the extreme case: if a single large staker holds 99% and unstakes, they forfeit all rewards, which are then redistributed to the remaining 1%. The remaining 1% gets 100x their normal rewards on the next cumulative update.

### 4. Bonding Curve Front-Running
The linear bonding curve has deterministic pricing: `P(x) = P_START + slope * x`. There is no front-running risk because:
- Price depends only on `current_sold` (on-chain state), not on order flow
- Each buyer's price is determined by their position on the curve
- There is no AMM pool to manipulate

However, there IS a **per-wallet cap** of 20M tokens (MAX_TOKENS_PER_WALLET). Attackers could Sybil attack with multiple wallets to accumulate more than 20M tokens. The economic impact depends on whether graduation mechanics account for this.

### 5. Carnage Fund Accumulation Risk
The Carnage Fund accumulates SOL from 24% of all tax revenue. With only ~4.3% trigger probability per epoch, the fund can accumulate significant SOL before triggering. The MAX_CARNAGE_SWAP_LAMPORTS cap of 1000 SOL limits per-trigger spend, but the fund can still grow larger. Large accumulated funds create higher-value MEV targets for the fallback path.

### 6. Treasury Pubkey Configuration (CRITICAL)
As identified in HOT_SPOTS.md: the mainnet build (`#[cfg(not(any(feature = "devnet", feature = "localnet")))]`) of `treasury_pubkey()` has been updated to return `3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv`, which is the correct mainnet treasury. However, the HOT_SPOTS pre-scan may have been run against a stale version. The current constants.rs:148 returns the correct mainnet treasury address. This should be re-verified at deploy time.

## Cross-Reference Notes
- **For Token/Economic focus:** Verify that EpochState.get_tax_bps returns values within the documented 100-1400 bps range. The `is_crime` flag in swap instructions is caller-declared -- confirm the Tax Program validates pool identity against the flag (or that mismatching is harmless because it just selects a different tax rate).
- **For Oracle focus:** The VRF freshness underflow at `trigger_epoch_transition.rs:174` is a timing/oracle concern. `saturating_sub` returns 0 for future-dated `seed_slot`, which passes `< MAX_RANDOMNESS_STALENESS`. Verify Switchboard's contract guarantees `seed_slot <= current_slot`.
- **For Timing focus:** Unstake cooldown check at `unstake.rs:127-129` uses `checked_sub(last_claim_ts).unwrap_or(0)`. Clock regression (e.g., validator restart with stale clock) would bypass the cooldown, allowing immediate unstake after claim.

## Raw Notes

### Tax Rate Ranges
- Low tax: 100-400 bps (1-4%), genesis = 300 bps (3%)
- High tax: 1100-1400 bps (11-14%), genesis = 1400 bps (14%)
- The cheap side gets low buy tax and high sell tax
- The expensive side gets high buy tax and low sell tax
- This creates a natural buy incentive for the cheap token and sell incentive for the expensive token

### Carnage Fund Probability Analysis
- Trigger probability: byte 5 < 11 out of 256 = 4.3% per epoch
- Sell action: byte 6 < 5 out of 256 = 2.0% when triggered
- Burn action: ~97.7% when triggered (255 - 5 = 250 values, but exact threshold varies)
- Expected Carnage frequency: 4.3% * 48 epochs/day = ~2 triggers/day
- Expected sell frequency: 4.3% * 2.0% * 48 = ~0.04 sells/day (once every 25 days)

### Staking Precision Analysis
- PRECISION = 1e18 (standard DeFi)
- Max realistic product: 20M PROFIT staked * reward_delta over 100 years = ~1.3e39 (approaching u128::MAX at century scale)
- checked_mul handles gracefully: returns Err, user retries next epoch
- Division always truncates (floors), favoring the protocol by ~0.5 lamport per user per epoch

### Bonding Curve Economics
- Linear curve: P_START=450 lamports/human token, P_END=1725 lamports/human token
- Total supply: 460M tokens (460e12 base units)
- Full curve cost: ~500.25 SOL
- ~3.83x price appreciation from start to end
- Sell tax: 15% of SOL proceeds, held in per-curve tax escrow
- SOLVENCY_BUFFER_LAMPORTS = 10 to handle cumulative rounding drift

### AMM Pool Configuration
- LP fee: 100 bps (1%) -- stored in PoolState.lp_fee_bps
- No LP tokens are minted -- liquidity is protocol-owned
- Access control: only Tax Program's swap_authority PDA can initiate swaps
- Reentrancy guard: explicit `locked` boolean field in PoolState
- k-invariant verified after every swap via `verify_k_invariant()`

### Value Leakage Points
1. **LP fee dust**: integer division truncation in `calculate_effective_input` loses < 1 lamport per swap
2. **Tax split dust**: `split_distribution` treasury remainder absorbs dust; micro-tax (<4 lamports) goes entirely to staking
3. **Staking reward dust**: `update_rewards` division truncation loses < 1 lamport per user per epoch
4. **Bonding curve integral dust**: `calculate_sol_for_tokens` uses ceil rounding (protocol-favored); `calculate_tokens_out` uses floor (protocol-favored)
5. **Conversion vault dust**: integer division in CRIME/FRAUD->PROFIT loses up to 99 base units per conversion (remainder lost)
