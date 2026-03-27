# Dr. Fraudsworth’s Finance Factory

*A gamified financial experiment by an eccentric financial scientist*

---

## Overview

A three-token system designed to generate **persistent trading volume and SOL-denominated yield** through a closed-loop market structure.  
The system avoids ponzinomics by ensuring that yield is funded **exclusively by real trading friction** rather than emissions.

The protocol consists of asymmetric taxes, a soft peg, and a controlled chaos mechanism (“Carnage”) that together create a self-correcting equilibrium between arbitrageurs and yield holders.

---

## Token Structure

**Three tokens**
- **CRIME**
- **FRAUD**
- **PROFIT** (yield-bearing)

**Four permanent liquidity pools**
- CRIME / SOL  
- FRAUD / SOL  
- CRIME / PROFIT  
- FRAUD / PROFIT  

All pools are protocol-owned and permanent.

All tokens are **Token-2022 assets with transfer hooks**.

> **Important: WSOL Exception**
> While CRIME, FRAUD, and PROFIT are Token-2022 assets with transfer hooks, the protocol uses WSOL (wrapped SOL) in SOL-paired pools. WSOL is the original SPL Token program asset (spl-token), NOT Token-2022, and does not support transfer hooks.
>
> This means:
> - CRIME/SOL and FRAUD/SOL pools have asymmetric token programs
> - Transfer hooks only apply to the CRIME/FRAUD side of SOL-paired swaps
> - WSOL transfers use spl-token::transfer, not spl-token-2022::transfer_checked
>
> See [Token_Program_Reference.md](./Token_Program_Reference.md) for the complete token program matrix.

---

## Transfer Restrictions

Transfer hooks enforce that CRIME, FRAUD, and PROFIT may only be:
- Held in a user wallet, or
- Transferred to / from whitelisted pool vaults

Direct wallet-to-wallet transfers are not permitted.

Implications:
- All movement routes through pools (fees and taxes always apply)
- No OTC transfers, gifting, or airdrops
- Sybil attacks on yield are economically irrational
- Tokens cannot be lost to invalid transfers

Whitelist permissions are **burned at initialization** and cannot be modified.

---

## Fee & Tax Structure

### SOL Pools (CRIME/SOL, FRAUD/SOL)

- **1% LP fee** (always applied, compounds into liquidity)
- **Variable tax applied in SOL**
- Taxes apply on both buys and sells
- LP fee is applied **before** tax

### PROFIT Pools (CRIME/PROFIT, FRAUD/PROFIT)

- **0.5% LP fee**
- **No taxes**

---

## Tax Regime Model (Critical)

The protocol operates under a **single global tax regime per epoch**.

- At any epoch, exactly **one IP token is the “cheap side”**
- Cheap side:
  - Low buy tax
  - High sell tax
- Expensive side:
  - High buy tax
  - Low sell tax
- All four SOL-pool taxes are **derived from this regime**
- Taxes **do not roll independently**

### Tax Bands

- **Low tax:** 1–4%  
- **High tax:** 11–14%  
- Zero tax is never possible  
- Values are sampled uniformly within each band

### Regime Flip

- Each epoch has a **75% probability** of flipping the cheap side
- All four taxes flip together or not at all
- Prevents degenerate states that remove arbitrage incentives

---

## Epoch System

Epoch length: **30 minutes**

At each epoch boundary:

1. Switchboard VRF is requested
2. On callback:
   - Tax regime flip decision is made
   - Low/high tax magnitudes are resampled
3. A new epoch configuration becomes active
4. Carnage Fund trigger is evaluated (1/24 chance)

---

## Soft Peg Mechanism

CRIME and FRAUD are softly pegged to each other **through PROFIT**.

At launch:
- 50m PROFIT total supply (fixed forever)
- 25m PROFIT paired with CRIME
- 25m PROFIT paired with FRAUD

### Peg Definition

The effective peg is defined by the **marginal AMM price including LP fees and excluding taxes**.

Taxes act as directional friction, not price.

### Directional Friction

- CRIME → FRAUD friction  
  = CRIME sell tax + FRAUD buy tax + PROFIT LP fees

- FRAUD → CRIME friction  
  = FRAUD sell tax + CRIME buy tax + PROFIT LP fees

The direction with lower friction is the **cheap path**, creating an arbitrage opportunity.

---

## Arbitrage Loop

Canonical route:

SOL → IP → PROFIT → IP → SOL

Fees incurred:
- 1% LP fee on SOL pools
- Buy/sell taxes depending on direction
- 0.5% LP fee on each PROFIT hop

Arbitrageurs compete to move price from the old peg to the new peg after each epoch transition.

Arbitrage is assumed to be **atomic** in optimal conditions.

---

## PROFIT Yield

PROFIT is the yield-bearing asset. **Users must stake PROFIT to earn yield.**

### Yield Source
- **75% of all SOL taxes collected per epoch**

### Eligibility
- **Only staked PROFIT earns yield**
- Holding PROFIT without staking does not earn yield
- PROFIT held in pool vaults is excluded

### Staking Model

Yield is distributed via **staking-based cumulative rewards**.

- Users stake PROFIT to begin earning
- Yield accumulates pro-rata to staked balance
- Users claim SOL permissionlessly at any time
- Claims never expire
- Instant unstake (no lockup period)
- Claimant pays transaction fees

**See `Docs/New_Yield_System_Spec.md` for complete staking system specification.**

---

## Carnage Fund

A protocol-controlled mechanism that injects chaos, deflation, and volatility.

### Funding
- **24% of all taxes**, held in SOL

### Trigger
- 1/24 chance per epoch (~2× per day on average)

### Execution

- Entire SOL balance is used to market-buy CRIME or FRAUD
- Purchased tokens are held by the Carnage Fund

Subsequent triggers:
- **98% chance:** burn held IP tokens
- **2% chance:** sell held IP tokens → accumulate SOL → rebuy opposite side

### Properties
- Deflationary for CRIME/FRAUD
- Violently destabilizes the peg
- Creates large, temporary arbitrage windows
- Carnage Fund is tax-exempt (LP fees still apply)

---

## Launch Mechanics

### PROFIT Pools
- Seeded directly with minted PROFIT and IP tokens

### SOL Pools
- Seeded via bonding curve:
  - 750m IP tokens allocated to curve
  - 460m sold, raising 1000 SOL
  - 290m paired with 1000 SOL to form pool
  - 250m reserved for PROFIT pools

Bonding curve buyers are fully subject to all protocol mechanics.

---

## Participants

### Yield Holders
- Acquire PROFIT via pools
- **Stake PROFIT** to earn yield
- Claim SOL yield

### Arbitrage Bots
- Monitor epoch transitions
- Execute full loop trades
- Generate the tax revenue that funds yield

**Symbiosis:**  
Arbitrage creates yield. Yield provides exit liquidity. Neither functions without the other.

---

## Governance & Ownership

- All liquidity is protocol-owned
- No LP withdrawal possible
- No admin intervention post-deployment
- Update authority may exist temporarily for audits, then burned

---

## Protocol Invariants

The following invariants MUST always hold. These are the protocol's fundamental guarantees. Violation of any core invariant indicates a critical bug.

### Core Invariants

| # | Invariant | Description | Authoritative Source |
|---|-----------|-------------|---------------------|
| 1 | **AMM Constant Product** | `k_after >= k_before` for all swaps | AMM_Implementation.md Section 8.2 |
| 2 | **Tax Distribution** | `yield + carnage + treasury == 100%` (75+24+1) | Tax_Pool_Logic_Spec.md Section 4 |
| 3 | **Epoch Monotonicity** | Epoch number only increases, never decreases | Epoch_State_Machine_Spec.md Section 6.2 |
| 4 | **Escrow Solvency** | `staking_escrow >= sum(pending_rewards)` | New_Yield_System_Spec.md Section 9.5 |
| 5 | **Whitelist Immutability** | Whitelist cannot change after authority burn | Transfer_Hook_Spec.md |
| 6 | **Total Supply Accounting** | `sum(balances) == total_supply` per token | Token program enforcement |
| 7 | **No Negative Balances** | All token amounts are non-negative | Rust u64 type enforcement |

### Protocol-Specific Guarantees

| Guarantee | Description |
|-----------|-------------|
| **Single Tax Regime** | Only one set of tax rates active at any time |
| **No Admin Functions** | After authority burn, no privileged operations exist |
| **Permanent Liquidity** | Pool liquidity cannot be removed (no LP tokens) |
| **SOL Never Lost** | Carnage SOL retained if execution fails; never burned |
| **Cumulative Only Increases** | Yield cumulative index never decreases |

### Invariant Failure Modes

This section documents what happens if each invariant is violated and how violations are detected or prevented.

| Invariant | Violation Type | Detection | Consequence | Prevention |
|-----------|---------------|-----------|-------------|------------|
| AMM k | Implementation bug | Pre-swap check in code | Transaction reverts | Checked_math crate, tests |
| Tax split != 100% | Code bug | N/A (compile-time constant) | Undefined behavior | Constants defined in code |
| Epoch decrease | Impossible | u32 type enforces | N/A | Rust type system |
| Escrow insolvency | Drain or bug | On-claim balance check | Claims fail | Deposit-before-update pattern |
| Whitelist change post-burn | Impossible | Authority = null | Cannot modify | One-way burn |
| Total supply mismatch | Token program bug | Off-chain monitoring | Major incident | Trust in Solana runtime |
| Negative balance | Impossible | u64 type enforces | N/A | Rust type system |

**Security-Critical Invariants:**

The following invariants, if violated, represent CRITICAL security failures:

1. **Escrow Solvency** - If `escrow_balance < sum(pending_rewards)`:
   - Users cannot claim earned rewards
   - Detection: First failed claim transaction
   - Recovery: Manual investigation required (should be impossible by design)

2. **Whitelist Immutability** - If whitelist could be modified post-burn:
   - Attacker could add own address to whitelist
   - Detection: On-chain authority check
   - Recovery: None (authority is burned -- modification impossible)

**Non-Critical Invariants:**

These invariants affect correctness but not security:

1. **Tax Split** - If percentages don't sum to 100%:
   - Tokens could be lost or created per-swap
   - Detection: Audit/testing only
   - Prevention: Compile-time constant enforcement

2. **AMM k** - If k decreases:
   - LPs lose value (but there are no LPs -- liquidity is permanent)
   - Detection: Per-swap assertion
   - Prevention: Checked math, tests

**Invariant Monitoring Recommendations:**

For production deployment, monitor:
- [ ] Escrow balance vs total pending rewards (daily reconciliation)
- [ ] Carnage burn totals vs mint supply deltas
- [ ] No unexpected authority changes (should be impossible but verify)

### Total Supply Accounting

The protocol maintains strict supply conservation for all tokens.

**Fundamental Guarantee:**
```
sum(all_token_balances) == total_supply
```

This is enforced at the Token-2022 and SPL Token program level for every transfer.

**Token-Specific Details:**

| Token | Initial Supply | Can Change? | How |
|-------|---------------|-------------|-----|
| CRIME | Fixed at mint | Decreases only | Carnage burns |
| FRAUD | Fixed at mint | Decreases only | Carnage burns |
| PROFIT | Fixed at mint | No | No burn mechanism |
| WSOL | N/A (wrapped) | N/A | 1:1 with SOL |

**Carnage Burns (Exception to Conservation):**

Carnage intentionally burns CRIME and FRAUD tokens, reducing their total supply:

```
total_supply_after = total_supply_before - burned_amount
sum(balances_after) = sum(balances_before) - burned_amount
```

This is tracked in `CarnageFundState`:
- `total_crime_burned: u64`
- `total_fraud_burned: u64`

**Verification:**
At any point: `total_supply == initial_supply - total_X_burned`

**Auditor Note:**
Token programs enforce balance conservation automatically. The protocol cannot create tokens out of thin air. The only way supply decreases is through explicit burns via Carnage, which are logged and tracked. See Carnage_Fund_Spec.md for details.

See individual specification documents for detailed invariant enforcement mechanisms.

---

## Notes

- No single document is authoritative
- Any conflict discovered during implementation must be resolved explicitly and reflected across documentation before code is merged
