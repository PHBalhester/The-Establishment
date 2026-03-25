# 09 - Economic Model Analysis

**Focus:** Complete economic system modeling -- token flows, value cycles, invariants, flash loan impact, MEV sensitivity, incentive alignment, and value extraction paths.

**Auditor:** Stronghold of Security (SOS)
**Date:** 2026-02-22
**Scope:** All 5 production programs (AMM, Tax, Epoch, Transfer Hook, Staking)

---

<!-- CONDENSED_SUMMARY_START -->

## Condensed Summary (~8KB)

### Protocol Economic Architecture

Dr Fraudsworth is a dual-memecoin yield farm built on 4 AMM pools (CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT), a VRF-driven epoch system with dynamic tax rates, and a staking program distributing SOL yield. The core economic loop is:

1. **Users trade CRIME/FRAUD against SOL** -- 1-14% tax collected per swap
2. **Tax split 75/24/1** -- 75% to staking escrow, 24% to Carnage Fund, 1% to treasury
3. **Stakers earn SOL yield** by locking PROFIT tokens (pro-rata, checkpoint-based)
4. **Carnage Fund** executes VRF-triggered market operations (~4.3% per epoch): buy, burn (98%), or sell (2%)
5. **PROFIT routing** (CRIME/FRAUD to PROFIT) is untaxed -- only 0.5% LP fee

### Key Economic Parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| SOL pool LP fee | 1.0% (100 bps) | AMM constants.rs |
| PROFIT pool LP fee | 0.5% (50 bps) | AMM constants.rs |
| Buy tax range | 1-4% (cheap) / 11-14% (expensive) | Epoch tax_derivation.rs |
| Sell tax range | 11-14% (cheap) / 1-4% (expensive) | Epoch tax_derivation.rs |
| Tax split | 75% staking / 24% carnage / 1% treasury | Tax constants.rs |
| Min output floor | 50% of expected (5000 bps) | Tax constants.rs |
| Carnage trigger probability | ~4.3% per epoch (11/256) | Epoch constants.rs |
| Carnage burn probability | 98% when triggered | Epoch constants.rs |
| Carnage sell probability | 2% when triggered | Epoch constants.rs |
| Max carnage swap | 1000 SOL | Epoch constants.rs |
| Carnage slippage floor (atomic) | 85% (8500 bps) | Epoch constants.rs |
| Epoch length | 750 slots devnet / 4500 slots mainnet (~30 min) | Epoch constants.rs |
| MINIMUM_STAKE | 1 PROFIT (1,000,000 units) | Staking constants.rs |
| Epoch trigger bounty | 0.001 SOL | Epoch constants.rs |

### Value Flow Diagram

```
User SOL ----[buy tax: 1-14%]----> Tax Program
  |                                    |
  | (post-tax SOL)                     |--> 75% --> Staking Escrow --> Stakers (claim SOL)
  v                                    |--> 24% --> Carnage Fund Vault
  AMM (CRIME/SOL or FRAUD/SOL)         |--> 1%  --> Treasury
  |
  v
User receives CRIME/FRAUD tokens
  |
  |---[sell: 1-14% tax on output]--> Tax Program (same split)
  |---[swap to PROFIT: untaxed, 0.5% LP fee only]--> AMM (PROFIT pools)
  |---[stake PROFIT]--> Staking Program --> earn SOL yield

Carnage Fund:
  VRF triggers (~4.3%) --> buy CRIME or FRAUD (50/50)
                       --> burn held tokens (98%) or sell (2%)
                       --> max 1000 SOL per operation
```

### Critical Invariants Verified

1. **Tax split conservation**: `staking + carnage + treasury == total_tax` -- VERIFIED via remainder pattern (treasury = total - staking - carnage)
2. **k-invariant maintenance**: `k_after >= k_before` -- VERIFIED via u128 arithmetic with post-swap check
3. **Staking reward conservation**: no user can claim more than deposited -- VERIFIED via checkpoint pattern + truncation-favoring-protocol
4. **Flash loan resistance**: same-epoch stake/unstake = zero rewards -- VERIFIED via checkpoint delta = 0
5. **Carnage fund bounded**: MAX_CARNAGE_SWAP_LAMPORTS = 1000 SOL -- VERIFIED
6. **LP fee always collected**: fee deducted before output calc -- VERIFIED but dust bypass possible (see findings)

### Key Findings Summary

| ID | Severity | Finding |
|----|----------|---------|
| ECON-01 | MEDIUM | Dust swap tax bypass via integer truncation |
| ECON-02 | MEDIUM | PROFIT routing tax arbitrage path |
| ECON-03 | LOW | Sell path passes minimum_amount_out=0 to AMM |
| ECON-04 | INFO | Asymmetric tax creates directional MEV opportunities |
| ECON-05 | INFO | Carnage 50% buy target creates predictable demand |
| ECON-06 | LOW | Staking dust loss from truncation accumulates |
| ECON-07 | CRITICAL (KNOWN) | Bounty rent-exempt bug (already in MEMORY.md TODO) |

### Cross-Focus Handoffs

- **To 01-access-control**: swap_exempt requires Epoch Program PDA -- verify CPI chain cannot be bypassed
- **To 02-arithmetic**: Verify dust amount tax bypass boundaries (calculate_tax with small inputs)
- **To 03-state-machine**: Epoch boundary timing with VRF -- verify tax rate cannot be gamed by delaying reveal
- **To 04-cpi-external**: CPI depth 4 on Carnage path -- verify no additional calls possible
- **To 05-token-economic**: Transfer hook cost analysis -- does hook overhead affect small trade viability?

<!-- CONDENSED_SUMMARY_END -->

---

## Full Analysis

### 1. Token Flow Mapping

#### 1.1 Buy Flow (SOL -> CRIME/FRAUD)

**File**: `programs/tax-program/src/instructions/swap_sol_buy.rs`

```
User provides: amount_in (SOL)
  1. Read tax_bps from EpochState (dynamic: 1-14%)
  2. tax_amount = amount_in * tax_bps / 10_000
  3. sol_to_swap = amount_in - tax_amount
  4. Enforce output floor: minimum_output >= 50% of expected AMM output
  5. Split tax: (staking=75%, carnage=24%, treasury=remainder)
  6. Transfer tax portions via system_instruction::transfer from user
  7. CPI deposit_rewards to Staking Program (notifies of new yield)
  8. CPI swap_sol_pool to AMM with sol_to_swap
  9. User receives CRIME/FRAUD tokens
```

**Key observation**: Tax is deducted from INPUT before the swap. The user pays `amount_in` SOL but only `sol_to_swap` enters the AMM. This means the effective price impact includes both the tax and the swap slippage.

**Effective cost to buy**: `tax_rate + LP_fee + price_impact`. For a 14% sell-side tax (expensive), buying 1 SOL worth means only 0.86 SOL enters the pool, then 1% LP fee, then constant-product slippage.

#### 1.2 Sell Flow (CRIME/FRAUD -> SOL)

**File**: `programs/tax-program/src/instructions/swap_sol_sell.rs`

```
User provides: amount_in (CRIME/FRAUD tokens)
  1. Read tax_bps from EpochState
  2. Record user's WSOL balance before swap
  3. Enforce output floor: minimum_output >= 50% of expected AMM output
  4. CPI swap_sol_pool to AMM (full amount_in, direction=BtoA)
  5. AMM passes minimum_amount_out = 0 (!)
  6. gross_output = wsol_after - wsol_before
  7. tax_amount = gross_output * sell_tax_bps / 10_000
  8. net_output = gross_output - tax_amount
  9. Verify net_output >= minimum_output (post-tax slippage check)
  10. Transfer tax WSOL from user -> intermediary -> close -> distribute
  11. User retains net_output WSOL
```

**Key observation**: Tax is deducted from OUTPUT after the swap. The AMM receives the full token amount, producing gross WSOL output. Tax is then extracted from that output.

**FINDING ECON-03 (LOW)**: The AMM CPI passes `minimum_amount_out = 0` (line 147-148 of swap_sol_sell.rs). While the Tax Program enforces its own slippage check post-tax (line 245: `net_output >= minimum_output`), the AMM itself has no slippage protection during the sell CPI. This creates a brief window where the AMM swap could execute at an arbitrarily bad price. The post-CPI check catches it, but the compute is wasted. More importantly, this means the 50% output floor check at the beginning (SEC-10) is comparing against pre-swap reserves, while the actual slippage check happens post-swap on actual output. If pool reserves change between the floor check and the CPI (e.g., another TX in the same block), the floor check becomes stale.

#### 1.3 PROFIT Buy (CRIME/FRAUD -> PROFIT, Untaxed)

**File**: `programs/tax-program/src/instructions/swap_profit_buy.rs`

```
User provides: amount_in (CRIME/FRAUD), minimum_output
  1. Detect canonical mint ordering (is_reversed)
  2. Enforce 50% output floor
  3. CPI swap_profit_pool to AMM (0.5% LP fee only)
  4. User receives PROFIT tokens
  -- NO TAX COLLECTED --
```

**FINDING ECON-02 (MEDIUM)**: The PROFIT routing path creates a tax arbitrage opportunity. Consider:

1. User buys CRIME with SOL (pays buy tax, e.g., 2%)
2. User swaps CRIME -> PROFIT (untaxed, 0.5% LP fee)
3. User swaps PROFIT -> FRAUD (untaxed, 0.5% LP fee)
4. User sells FRAUD for SOL (pays sell tax, e.g., 2%)

Compared to directly buying and selling the same token (4% round-trip for cheap side), this cross-faction routing pays the same 4% round-trip tax but gains exposure to the OTHER faction token. However, the more interesting arbitrage is:

- If CRIME is "cheap" (low buy tax 1-4%, high sell tax 11-14%) and FRAUD is "expensive" (high buy tax 11-14%, low sell tax 1-4%):
- Buy CRIME cheaply (2% tax) -> swap to PROFIT (0.5%) -> swap to FRAUD (0.5%) -> Sell FRAUD cheaply (2% tax)
- Total cost: 2% + 0.5% + 0.5% + 2% = **5%** round-trip
- Direct buy CRIME then sell CRIME: 2% + 13% = **15%** round-trip
- Direct buy FRAUD then sell FRAUD: 13% + 2% = **15%** round-trip

**Impact**: The PROFIT bridge reduces the effective tax by routing through the cross-faction path. This is likely **intentional by design** (PROFIT has utility as a routing token), but it means the protocol's effective tax revenue on cross-faction arbitrage is ~5% instead of the designed 15%. The tax revenue loss depends on how much volume routes through PROFIT pools vs SOL pools.

#### 1.4 Tax-Exempt Swap (Carnage Fund)

**File**: `programs/tax-program/src/instructions/swap_exempt.rs`

The Carnage Fund performs tax-exempt swaps via a dedicated instruction. Access is restricted to the `carnage_signer` PDA from the Epoch Program (`seeds::program = epoch_program_id()`). No slippage protection (`minimum_out = 0`).

**Security**: The `carnage_authority` constraint uses `seeds::program` which ensures only the Epoch Program can produce a valid signer. This is the strongest form of cross-program access control in Anchor.

#### 1.5 Staking Yield Distribution

**File**: `programs/staking/src/helpers/math.rs`, `programs/staking/src/instructions/stake.rs`

```
Yield Flow:
  Tax Program collects tax -> 75% portion transferred to escrow_vault
  -> CPI deposit_rewards updates StakePool.pending_rewards
  -> At epoch end, Epoch Program calls update_cumulative
  -> pending_rewards * PRECISION / total_staked -> rewards_per_token_stored
  -> Users call claim/unstake -> pending = balance * delta / PRECISION
```

The Synthetix/Quarry cumulative reward pattern ensures:
- Pro-rata distribution proportional to staked balance
- No snapshot gaming (rewards accumulate continuously)
- Flash loan resistant (stake and unstake in same epoch = zero delta)

### 2. Invariant Analysis

#### 2.1 Constant-Product Formula (k-invariant)

**File**: `programs/amm/src/helpers/math.rs`

The AMM enforces `k_after >= k_before` where `k = reserve_in * reserve_out` (computed in u128).

**Verification**:
- `calculate_effective_input`: deducts LP fee first (`amount * (10_000 - fee_bps) / 10_000`)
- `calculate_swap_output`: `reserve_out * effective_input / (reserve_in + effective_input)`
- `verify_k_invariant`: post-swap reserves checked
- Integer truncation in output calculation means k strictly increases (protocol keeps dust)

**Result**: k-invariant holds. Verified by 10,000 proptest iterations across realistic and edge-case reserve sizes.

#### 2.2 Tax Split Conservation

**File**: `programs/tax-program/src/helpers/tax_math.rs`

```rust
staking = floor(total * 75 / 100)
carnage = floor(total * 24 / 100)
treasury = total - staking - carnage  // remainder absorbs dust
```

**Invariant**: `staking + carnage + treasury == total_tax` -- always holds because treasury is computed as remainder.

**Micro-tax edge case**: Below 4 lamports, all tax goes to staking (avoids splitting dust across three destinations). This is a conscious design choice.

**FINDING ECON-01 (MEDIUM)**: For small amounts, `calculate_tax` can produce zero tax:
- `calculate_tax(10, 400)` = `10 * 400 / 10_000` = `0` (integer truncation)
- A user swapping 10 lamports at 4% tax pays ZERO tax
- The threshold where tax becomes non-zero: `amount >= 10_000 / tax_bps`
  - At 1% (100 bps): amounts < 100 lamports = zero tax
  - At 14% (1400 bps): amounts < ~8 lamports = zero tax

**Impact**: An attacker making many tiny swaps could bypass taxes entirely. However, each swap costs ~5000 lamports in transaction fees on Solana, so bypassing a few lamports of tax is economically irrational. The Solana base fee serves as a natural defense. **No practical attack vector**, but worth documenting.

#### 2.3 Staking Reward Conservation

**File**: `programs/staking/src/helpers/math.rs`

The cumulative reward-per-token pattern guarantees:
- `user_reward = balance * (global_cumulative - user_checkpoint) / PRECISION`
- Division truncates (floors), favoring the protocol
- Sum of all user rewards <= total deposited rewards (verified by proptest)

**Dead stake**: 1 PROFIT (1,000,000 base units) locked at initialization prevents the first-depositor attack. An attacker would need to donate >1,000,000 SOL to the escrow to shift the reward-per-token significantly, which is economically infeasible.

**FINDING ECON-06 (LOW)**: Truncation dust accumulates over time. For a pool with 1B PROFIT staked and 1 lamport of rewards per epoch:
- `reward_per_token = 1 * 1e18 / 1e15 = 1e3`
- A user with 1 token: `1 * 1e3 / 1e18 = 0` (truncated)
- A user with 1M tokens: `1e6 * 1e3 / 1e18 = 0` (still truncated!)
- Only a user with the full 1B stake gets the 1 lamport

This dust is effectively lost to the protocol. Over thousands of epochs, this could accumulate to measurable amounts. Not exploitable, but creates a small systematic under-distribution of rewards to small stakers.

#### 2.4 Carnage Fund Bounds

**File**: `programs/epoch-program/src/constants.rs`, `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`

- `MAX_CARNAGE_SWAP_LAMPORTS = 1_000_000_000_000` (1000 SOL)
- Rent-exempt minimum subtracted before calculating available SOL
- 85% slippage floor on atomic path, 75% on fallback
- Carnage execution is permissionless when `carnage_pending = true`

**FINDING ECON-07 (CRITICAL, KNOWN)**: The bounty payment in `trigger_epoch_transition` checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` but does not account for rent-exempt minimum. This is already documented in MEMORY.md TODO. After bounty transfer, the vault can drop below rent floor (~890,880 lamports), causing runtime rejection on the next transaction that tries to read the vault.

### 3. Value Extraction Vectors

#### 3.1 Flash Loan Analysis

**Solana does not have native flash loans** like Ethereum. However, the equivalent concern is same-transaction manipulation:

**AMM Flash Loan (deposit + swap + withdraw)**:
- The AMM has NO LP tokens and NO deposit/withdraw functionality. It is a pure swap-only CPMM with admin-seeded liquidity.
- **Result**: Flash loan pool draining is **structurally impossible**. There is no mechanism to add or remove liquidity after initialization.

**Staking Flash Loan (stake + claim + unstake)**:
- Stake calls `update_rewards` BEFORE balance change, setting `user.rewards_per_token_paid = pool.rewards_per_token_stored`
- If user stakes and then immediately unstakes in the same transaction, `reward_delta = 0` because the checkpoint was just set
- **Result**: Flash loan staking attack produces **zero rewards**. Verified.

#### 3.2 Sandwich MEV Analysis

**User swaps through Tax Program** which enforces:
1. A 50% minimum output floor (SEC-10): `minimum_output >= 50% of expected_output`
2. User-specified `minimum_output` slippage parameter

**Attack scenario**: MEV bot front-runs a buy to push price up, user buys at inflated price, bot back-runs to sell.

**Mitigations**:
- The 50% output floor means the maximum extractable value is capped at ~50% of the trade size
- This is a very generous floor. Most legitimate users set much tighter slippage (1-5%)
- The floor primarily catches bots/bad frontends that send `minimum_output = 0`

**FINDING ECON-04 (INFO)**: The asymmetric tax regime creates directional MEV opportunities. When CRIME is "cheap" (2% buy, 13% sell), a sandwich attacker who can observe pending CRIME buy transactions knows:
- Front-running the buy is profitable (push price up before the buy)
- The user's effective cost is already 2% + slippage, so tight slippage settings limit extraction
- But the 50% floor is loose enough that a sophisticated attacker could extract significant value from users who use the default floor

**Carnage MEV**: Carnage execution is VRF-driven and atomic, making it unpredictable. However:
- Carnage passes `minimum_output = 0` to the AMM via `swap_exempt`
- The 85% slippage floor in the Epoch Program catches extreme manipulation
- Carnage execution is permissionless -- anyone can call `execute_carnage_atomic`
- A sophisticated attacker could observe `carnage_pending = true` and sandwich the execution

**FINDING ECON-05 (INFO)**: Carnage buys are 50/50 CRIME/FRAUD based on VRF byte 7. Over many epochs, this creates predictable aggregate demand for both tokens. A patient attacker who accumulates position in both tokens before epochs has a statistical edge, but the 4.3% trigger probability and VRF unpredictability make this impractical.

#### 3.3 Tax Arbitrage via PROFIT Routing

As detailed in section 1.3 (ECON-02), the PROFIT bridge reduces effective round-trip tax from ~15% to ~5% for cross-faction routing. This is the most significant economic finding.

**Quantified impact**: If 50% of volume routes through PROFIT pools to minimize tax:
- Expected tax revenue per $1M volume at 15% effective: $150,000
- Actual tax revenue with 50% PROFIT routing: $100,000 (33% reduction)
- 75% of this reduction affects staking yield directly

**Mitigation options** (for protocol team consideration):
1. Add a small tax on PROFIT pool swaps (e.g., 1-2%)
2. Increase PROFIT pool LP fee (e.g., to 2%)
3. Accept the routing as a feature (PROFIT utility)

#### 3.4 VRF Manipulation

**Switchboard On-Demand VRF** properties:
- Anti-reroll protection: randomness account bound to EpochState at trigger time
- VRF timeout recovery: 300-slot window before fresh randomness allowed
- Oracle is assigned per-randomness-account, not chooseable by caller

**Attack surface**: An attacker who controls a Switchboard oracle could influence the VRF output to:
- Set favorable tax rates (cheap buy on their preferred token)
- Trigger or suppress Carnage events
- Choose Carnage buy targets

**Mitigation**: Switchboard's on-demand VRF uses commit-reveal with on-chain verification. The oracle cannot choose the output -- it must produce a valid signature over the seed. Oracle manipulation requires compromising the oracle's signing key, which is outside the protocol's threat model.

**Timing attack**: A validator who is also an attacker could delay processing `consume_randomness` to wait for favorable VRF outcomes. However, the anti-reroll protection binds the specific randomness account at trigger time, so the attacker cannot try multiple randomness sources. They can only delay revealing a single committed randomness, which doesn't change the outcome.

#### 3.5 Pool Manipulation via Carnage

**Scenario**: Attacker fronts a large buy right before Carnage execution.

1. Observe `carnage_pending = true` on-chain (public state)
2. VRF byte 7 determines target (CRIME or FRAUD) -- this is revealed in `consume_randomness`
3. Buy the target token to push price up
4. Carnage executes buy at inflated price (receives fewer tokens)
5. Sell the target token for profit

**Protection**:
- Carnage has 85% slippage floor, so extreme manipulation is rejected
- The attacker's profit = (price_increase * carnage_buy_amount) - their own slippage
- With max 1000 SOL Carnage buy, the attacker needs substantial capital to move the price meaningfully
- The protocol's thin liquidity (memecoin) makes this more feasible but also limits the Carnage buy impact

**Risk assessment**: MEDIUM for mainnet with thin liquidity. The 85% floor provides reasonable protection, but a sophisticated attacker with capital could extract a few percent of each Carnage buy.

### 4. Incentive Alignment Analysis

#### 4.1 Hold vs Trade Incentives

The tax model creates a strong **hold incentive** for the cheap-side token:
- Cheap-side buy tax: 1-4% (low barrier to entry)
- Cheap-side sell tax: 11-14% (high barrier to exit)
- This asymmetry locks users into positions -- selling is expensive

**PROFIT staking** reinforces holding:
- Users buy CRIME/FRAUD -> swap to PROFIT (untaxed) -> stake for SOL yield
- This creates permanent demand for PROFIT while reducing CRIME/FRAUD sell pressure
- The yield rate depends on trading volume, creating a positive feedback loop:
  - More trading = more tax = more yield = more staking = more PROFIT demand

#### 4.2 Tax Model Sustainability

**The fundamental tension**: High taxes reduce trading volume, which reduces yield, which reduces staking incentive, which reduces PROFIT demand.

**Equilibrium analysis**:
- At current tax rates (1-14%), the effective round-trip cost for a speculative trade is 2-28%
- This is extremely high compared to traditional DEXes (0.3-1%)
- Volume will be dominated by:
  1. New entrants buying in (one-way, paying buy tax only)
  2. PROFIT routing (reduced tax)
  3. Arbitrage between CRIME/FRAUD when cheap side flips

**Sustainability concern**: If volume drops below a threshold, staking yield becomes insufficient to justify holding PROFIT. This creates a negative spiral:
- Low volume -> low yield -> PROFIT sells -> lower PROFIT price -> less staking -> less holding incentive -> more selling -> lower volume

**Mitigating factor**: The Carnage Fund acts as a buyer of last resort (~4.3% of epochs), creating floor demand for CRIME/FRAUD tokens. Burns (98% of Carnage actions) permanently reduce supply, which supports price.

#### 4.3 Carnage Perverse Incentives

**FINDING ECON-05 (continued)**: The Carnage mechanism creates interesting game theory:

1. **Burn bias (98%)**: Most Carnage events burn tokens, reducing supply. This is deflationary and supports price. Token holders benefit from Carnage.

2. **Sell rarity (2%)**: Very rarely, Carnage sells its holdings. This creates downward price pressure. But the rarity makes it a "black swan" event rather than a predictable threat.

3. **Predictable demand**: After a buy, Carnage holds tokens until the next trigger. If the next trigger is Burn (98%), those tokens are permanently destroyed. This creates a known "pending burn" that sophisticated traders can factor into pricing.

4. **No direct manipulation incentive**: Since VRF determines all Carnage parameters, no individual can influence outcomes. This is well-designed.

#### 4.4 Reward Distribution Fairness

The Synthetix cumulative pattern distributes rewards purely by stake weight and time:
- A user with 10% of total stake earns 10% of rewards
- Rewards are finalized per-epoch by the Epoch Program
- No snapshot gaming possible (checkpoint prevents it)

**Concern**: Large stakers have an outsized influence on yield. A whale with 90% of stake captures 90% of all trading tax revenue. This is mathematically correct but may create centralizing dynamics.

### 5. Token-2022 Economic Impact

#### 5.1 Transfer Hook Cost

Every CRIME/FRAUD/PROFIT transfer invokes the Transfer Hook program, which:
1. Resolves ExtraAccountMetaList (4 accounts per mint)
2. Validates at least one party (source or destination) is whitelisted
3. Adds CPI depth to the transfer

**Economic impact**:
- Each hook invocation costs ~5,000-10,000 compute units
- For PROFIT pool swaps (dual hook): ~20,000 extra CU
- This is marginal compared to the ~200,000 CU total for a swap
- **No significant economic barrier** to trading

#### 5.2 Whitelist Model

The whitelist requires at least one party (source OR destination) to be whitelisted. Currently whitelisted addresses include:
- AMM pool vaults (for swaps)
- Staking program vaults (for staking)
- Carnage vaults (for Carnage operations)

**Bottleneck risk**: If a user's token account is NOT whitelisted and they try to transfer to another non-whitelisted user, the transfer fails. This means **peer-to-peer transfers of CRIME/FRAUD/PROFIT are blocked** unless at least one party is whitelisted.

**Economic implication**: All token movement must flow through protocol-sanctioned paths (swap, stake, unstake). This prevents OTC trading and direct transfers, which could be used to bypass taxes. This is a deliberate design choice that strengthens the tax model.

### 6. Flash Loan Resistance (Detailed)

#### 6.1 AMM Flash Loan Resistance

**Structure**: The AMM is swap-only with no LP tokens and no deposit/withdraw functionality. Pool initialization is admin-gated (`has_one = admin` constraint). After initialization, liquidity is permanent.

**Analysis**: This is the strongest possible flash loan resistance for an AMM -- there is literally no mechanism to add or remove liquidity. The only way to extract value is through swaps, which are bounded by the constant-product formula and k-invariant.

**Reentrancy**: The `pool.locked` boolean prevents concurrent swaps on the same pool within a single transaction.

#### 6.2 Staking Flash Loan Resistance

**Checkpoint pattern**: `update_rewards` is called BEFORE any balance change. The user's `rewards_per_token_paid` is set to the current `rewards_per_token_stored`.

**Same-transaction attack**:
1. Attacker stakes X PROFIT tokens
2. `user.rewards_per_token_paid = pool.rewards_per_token_stored` (checkpoint set)
3. Attacker calls claim
4. `reward_delta = pool.rewards_per_token_stored - user.rewards_per_token_paid = 0`
5. `pending = balance * 0 / PRECISION = 0`
6. **Zero rewards**

**Cross-epoch attack**: Even if an attacker stakes just before `update_cumulative` and unstakes just after:
1. Stake before epoch end: checkpoint = cumulative_before
2. `update_cumulative` adds new rewards: cumulative increases by `pending * PRECISION / total_staked`
3. Unstake: reward_delta = new_rewards_per_token
4. pending = balance * delta / PRECISION

This IS legitimate -- the attacker earned rewards proportional to their share during that epoch. This is the intended behavior. The protection is that they had to hold PROFIT tokens for the full epoch (30 minutes on mainnet), which has opportunity cost and price risk.

#### 6.3 Cross-Program Flash Loan Resistance

**Scenario**: Can an attacker combine operations across programs in a single transaction to extract value?

1. **Swap + Stake + Claim**: Buy PROFIT via CRIME->PROFIT swap, stake, claim. But claim yields 0 (same-epoch checkpoint). No exploit.

2. **Manipulate price + Carnage sandwich**: Front-run Carnage with large swap to move price, Carnage executes at bad price, back-run. This IS possible but bounded by the 85% slippage floor.

3. **Tax rate gaming**: Delay `consume_randomness` to choose when tax rates update. The anti-reroll protection prevents trying multiple VRF outcomes. The attacker can only delay, not change, the outcome.

### 7. Detailed Attack Scenarios with Cost/Profit Analysis

#### 7.1 Dust Tax Bypass Attack (ECON-01)

**Attack**: Make thousands of swaps with amounts below the tax truncation threshold.

**Cost analysis**:
- Minimum profitable swap: ~100 lamports at 1% tax (threshold where tax = 1 lamport)
- Solana base fee: ~5000 lamports per transaction
- Net loss: 5000 - 1 = 4999 lamports per swap
- **Conclusion**: Economically impossible. Solana's base fee exceeds any possible tax savings.

#### 7.2 PROFIT Routing Arbitrage (ECON-02)

**Attack**: Route all trades through PROFIT pools to minimize tax.

**Cost analysis** (for $1000 trade, cheap side):
- Direct route: 2% buy + 13% sell = $150 total tax
- PROFIT route: 2% buy CRIME + 0.5% CRIME->PROFIT + 0.5% PROFIT->FRAUD + 2% sell FRAUD = $50 total tax
- Savings: $100 per $1000 traded
- Additional LP fee cost: $5 (0.5% x 2 hops)
- Additional slippage: variable (dependent on PROFIT pool depth)
- **Net savings: ~$95 per $1000 for cross-faction routing**

**Impact on protocol**: If widely adopted, reduces effective tax from ~7.5% average to ~2.5% average for cross-faction routes. This directly reduces staking yield by up to 67%.

#### 7.3 Carnage Sandwich Attack

**Attack**: Sandwich Carnage execution.

**Cost analysis** (for 100 SOL Carnage buy):
- Attacker needs to observe `carnage_pending = true` and `carnage_target`
- Front-run: buy ~200 SOL worth of target token (push price up ~20% in thin pool)
- Carnage buys at inflated price (receives ~17% fewer tokens, within 85% floor)
- Back-run: sell tokens (push price back down)
- **Attacker profit**: ~15% of Carnage buy * slippage = ~1.5 SOL
- **Attacker cost**: LP fees on 200 SOL buy + sell = ~4 SOL
- **Net loss**: ~2.5 SOL per Carnage event
- **Conclusion**: Not profitable at 100 SOL scale. Becomes marginal at 1000 SOL max scale.

**At max scale (1000 SOL Carnage buy)**:
- Attacker needs ~2000 SOL to push price 20%
- Attacker profit: ~15 SOL from sandwich
- Attacker cost: ~40 SOL in LP fees
- **Still net negative**

The 85% slippage floor combined with the 1% LP fee makes Carnage sandwiching unprofitable in most scenarios.

#### 7.4 Staking Reward Sniping

**Attack**: Stake large amount of PROFIT right before `update_cumulative`, claim, unstake.

**Cost analysis**:
- Must hold PROFIT tokens (price risk for at least one epoch = ~30 min mainnet)
- PROFIT token must be acquired (buy tax on CRIME/FRAUD + LP fee on PROFIT swap)
- Rewards are proportional to stake share during the epoch
- If total_staked = 1M PROFIT and attacker stakes 1M PROFIT:
  - Attacker captures 50% of epoch rewards
  - But holds 1M PROFIT with price risk for 30 minutes
  - Opportunity cost of capital is significant
- **Conclusion**: This is just... staking. There's no exploit; the attacker earns proportional rewards for proportional risk.

### 8. Economic Sustainability Model

#### 8.1 Revenue Model

Protocol revenue comes from trading tax:
- 75% to stakers (SOL yield)
- 24% to Carnage Fund (market operations)
- 1% to treasury (protocol revenue)

**Break-even analysis for staking**:
If total staked PROFIT = $1M equivalent, daily trading volume needed for 10% APY:
- Annual yield needed: $100,000
- Daily yield needed: $274
- Daily staking revenue (75% of tax): $274
- Daily total tax needed: $365
- At average 7.5% tax rate: Daily volume = $365 / 0.075 = **$4,867/day**

This is a relatively low volume requirement, suggesting the yield model is sustainable if there is any meaningful trading activity.

#### 8.2 Carnage Fund Accumulation

The Carnage Fund receives 24% of all tax revenue. Over time, this accumulates SOL that is deployed in ~4.3% of epochs.

**Accumulation rate**: At $10,000 daily volume and 7.5% average tax:
- Daily tax: $750
- Daily Carnage accumulation: $180
- Monthly Carnage fund growth: ~$5,400
- Carnage triggers per month: ~48 epochs/day * 30 * 4.3% = ~62 triggers
- Average Carnage spend per trigger: $87

The fund grows faster than it spends in most scenarios, building a significant war chest over time. This creates increasing buy pressure and burn pressure on CRIME/FRAUD tokens.

#### 8.3 Token Supply Dynamics

**Deflationary mechanism**: 98% of Carnage events burn tokens.
- Expected monthly burns at equilibrium: ~61 burn events * avg_buy_amount
- This permanently reduces CRIME/FRAUD supply
- Combined with tax-induced holding incentive, creates supply squeeze

**Inflationary pressure**: None. There is no token minting after initial supply.

### 9. Summary of Economic Model Health

**Strengths**:
1. Flash loan resistant by design (no LP tokens, checkpoint-based staking)
2. VRF-driven unpredictability for Carnage and tax rates
3. Strong access control on all value-moving operations
4. Comprehensive arithmetic safety (u128, checked ops, proptests)
5. Tax split conservation guaranteed by remainder pattern
6. Dead stake prevents first-depositor attack

**Weaknesses**:
1. PROFIT routing reduces effective tax (ECON-02) -- potentially significant revenue impact
2. High sell tax (11-14%) may deter legitimate trading, reducing volume
3. Carnage passes minimum_output=0 to AMM (ECON-03) -- relies on post-CPI slippage check
4. 50% output floor is very generous -- could be tightened for better MEV protection
5. Known rent-exempt bug in bounty payment (ECON-07)

**Overall Assessment**: The economic model is well-designed for a memecoin/yield farm. The primary risk is the PROFIT routing tax arbitrage, which could significantly reduce protocol revenue if widely adopted. The flash loan and MEV protections are robust for the protocol's risk profile.

---

### Cross-Focus Handoff Details

**To 01-access-control (swap_exempt bypass)**:
- Verify that `carnage_authority` PDA validation cannot be spoofed
- Verify that no other instruction can produce a valid carnage_signer
- File: `programs/tax-program/src/instructions/swap_exempt.rs`, lines 193-198

**To 02-arithmetic (dust boundary)**:
- Verify `calculate_tax` truncation boundaries for all tax rate values
- Verify `calculate_effective_input` for amounts < fee_bps (produces 0 effective input)
- File: `programs/tax-program/src/helpers/tax_math.rs`, line 34-53
- File: `programs/amm/src/helpers/math.rs`, line 36-40

**To 03-state-machine (VRF timing)**:
- Verify epoch boundary cannot be gamed by delaying trigger
- Verify anti-reroll protection in consume_randomness
- File: `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`
- File: `programs/epoch-program/src/instructions/consume_randomness.rs`

**To 04-cpi-external (CPI depth)**:
- Verify execute_carnage_atomic CPI chain is exactly 4 levels
- Verify no additional CPI calls on this path
- File: `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`

**To 05-token-economic (whitelist coverage)**:
- Verify all protocol vaults are whitelisted
- Verify no legitimate transfer path is blocked by whitelist
- File: `programs/transfer-hook/src/instructions/transfer_hook.rs`
