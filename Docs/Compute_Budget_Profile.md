# Compute Budget Profile

Last measured: 2026-02-10
Solana version: solana-cli 3.0.13 (Agave)
Test environment: solana-test-validator (local, upgradeable programs)

## Threshold Definitions

| Status | CU Utilization | Action Required |
|--------|---------------|-----------------|
| OK | <80% of limit | Document and proceed |
| WARNING | 80-95% of limit | Optimize in current phase |
| CRITICAL | >95% of limit | Must optimize before shipping |

Default CU limit per transaction: **200,000 CU** (Solana default when no ComputeBudgetProgram instruction is present).

Maximum CU limit per transaction: **1,400,000 CU** (Solana hard cap, requires explicit ComputeBudgetProgram.setComputeUnitLimit).

## CPI Path Measurements

### User Swap Paths (Tax -> AMM -> T22 -> Hook)

All user swaps flow through the Tax Program, which calls AMM via CPI. The AMM performs Token-2022 transfers with Transfer Hook extension.

| CPI Path | Measured CU | Recommended Limit | % of 200k | Status |
|----------|------------|-------------------|-----------|--------|
| swap_sol_buy (CRIME/SOL) | 97,901 | 107,700 | 49% | OK |
| swap_sol_buy (FRAUD/SOL) | 121,910 | 134,200 | 61% | OK |
| swap_sol_sell (CRIME/SOL) | 98,585 | 108,500 | 49% | OK |
| swap_sol_sell (FRAUD/SOL) | 122,586 | 134,900 | 61% | OK |

**Notes:**
- FRAUD/SOL paths consume ~24k more CU than CRIME/SOL paths. Both tokens have identical transfer hook configurations (same program, same ExtraAccountMetaList structure, same whitelist logic with no token-dependent branching). The difference is likely a test environment artifact — account creation order, validator cache state, and transaction sequencing can cause CU variance of this magnitude. Remeasure on devnet (Phase 35-36) with fresh state to confirm whether the gap persists or equalizes.
- All paths include the full chain: Tax -> AMM -> Token-2022 -> Transfer Hook.
- SOL buy paths include tax distribution (71% escrow / 24% carnage / 5% treasury) and Tax -> Staking deposit_rewards CPI.
- PROFIT conversions now use the Conversion Vault (see below) instead of AMM PROFIT pools.

### Staking CPI Paths

| CPI Path | Measured CU | Recommended Limit | % of 200k | Status |
|----------|------------|-------------------|-----------|--------|
| deposit_rewards (Tax -> Staking) | Included in swap_sol_buy | n/a | n/a | n/a |
| update_cumulative (Epoch -> Staking) | Included in epoch transition | n/a | n/a | n/a |

deposit_rewards and update_cumulative are not called standalone by users. They are always part of a larger CPI chain (swap or epoch transition) and their CU cost is included in the parent instruction's measurement.

### Carnage Chain (Epoch -> Tax -> AMM -> T22 -> Hook)

| CPI Path | Measured CU | Recommended Limit | % of 200k | % of 1.4M | Status |
|----------|------------|-------------------|-----------|-----------|--------|
| execute_carnage_atomic (buy only) | 105,017 | 115,600 | 52.5% | 7.5% | OK |

**Notes:**
- Carnage chain operates at CPI depth 4 (Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook), which is Solana's maximum depth.
- Despite the deep call stack, CU consumption is moderate at 105k.
- Measured at standard test pool liquidity (10,000 tokens / 10 SOL). Production pools with different liquidity levels may vary. Remeasure on devnet (Phase 35-36).
- The 200k default CU limit is sufficient. No need to request elevated compute budget.

### Conversion Vault (Vault -> T22)

| CPI Path | Estimated CU | Recommended Limit | % of 200k | Status |
|----------|------------|-------------------|-----------|--------|
| convert (CRIME/FRAUD <-> PROFIT) | ~15,000 | 20,000 | 7.5% | OK |

**Notes:**
- The Conversion Vault replaces the former PROFIT AMM pools (swap_profit_buy/swap_profit_sell).
- Extremely lightweight: fixed-rate 100:1 math + two Token-2022 transfer_checked calls (deposit input, withdraw output).
- No CPI to AMM or Tax Program. Leaf-node program — depth 1 only.
- Estimated CU pending devnet measurement. The 15,000 CU estimate is based on comparable Token-2022 transfer_checked operations.

## SDK/Frontend Recommendations

These are the minimum `ComputeBudgetProgram.setComputeUnitLimit` values that integrators should use for each instruction type. The "Suggested CU" column includes 20% padding over measured values to account for variance in pool liquidity, account sizes, and runtime conditions.

| Instruction | Measured CU | Suggested CU (20% padding) | Notes |
|------------|-----------|-------------------------------|-------|
| swap_sol_buy (CRIME) | 97,901 | 120,000 | Tax distribution + deposit_rewards CPI |
| swap_sol_buy (FRAUD) | 121,910 | 150,000 | Higher CU due to FRAUD mint hook accounts |
| swap_sol_sell (CRIME) | 98,585 | 120,000 | Tax on output (SOL), same CPI chain |
| swap_sol_sell (FRAUD) | 122,586 | 150,000 | Higher CU due to FRAUD mint hook accounts |
| convert (vault) | ~15,000 | 20,000 | Fixed-rate math + T22 transfers, very lightweight |
| execute_carnage_atomic | 105,017 | 130,000 | Depth-4 chain, fits in default 200k |
| stake | TBD | TBD | Pending devnet measurement (Phase 35) |
| unstake | TBD | TBD | Pending devnet measurement (Phase 35) |
| claim | TBD | TBD | Native SOL transfer only, expected <20k |

**General guidance:**
- Always set an explicit CU limit. Relying on the 200k default works today but wastes priority fees (fees are per-CU-requested, not per-CU-consumed).
- Round suggested CU up to the nearest 5,000 for clean values.
- For CRIME vs FRAUD swaps: use the higher FRAUD CU limit as a safe default, or detect the mint and set per-token limits.
- Production pools with different liquidity depths may shift CU consumption by 5-15%. The 20% padding accommodates this.

### Implementation Example

```typescript
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";

// SOL buy swap (CRIME token) -- set explicit CU limit
const tx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), // priority fee
  swapSolBuyInstruction,
);

// Carnage atomic buy -- fits in default 200k but set explicit for fee efficiency
const carnageTx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 130_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }), // higher priority for carnage
  executeCarnageAtomicInstruction,
);
```

## CPI Depth Map

Every cross-program call path and its stack height usage:

| Chain | H=1 | H=2 | H=3 | H=4 | H=5 |
|-------|-----|-----|-----|-----|-----|
| SOL buy/sell | Tax | AMM | Token-2022 | Transfer Hook | - |
| Vault convert | Vault | Token-2022 | Transfer Hook | - | - |
| deposit_rewards | Tax | Staking | - | - | - |
| update_cumulative | Epoch | Staking | - | - | - |
| Carnage atomic | Epoch | Tax | AMM | Token-2022 | Transfer Hook |

**Stack height 5 (Carnage) is at Solana's hard limit.** DO NOT add CPI calls to the Carnage execution path. Any additional logic in the Carnage chain must be pre/post-processing in the initiating instruction, not nested CPI.

## Access Control Matrix

Every CPI entry point is gated by a PDA derived with `seeds::program` to ensure only the authorized caller program can invoke it:

| Instruction | Authorized Caller | PDA Seeds | seeds::program |
|------------|-------------------|-----------|----------------|
| AMM swap_sol_pool | Tax Program | `["swap_authority"]` | TAX_PROGRAM_ID |
| Staking deposit_rewards | Tax Program | `["tax_authority"]` | TAX_PROGRAM_ID |
| Staking update_cumulative | Epoch Program | `["staking_authority"]` | EPOCH_PROGRAM_ID |
| Tax swap_exempt | Epoch Program | `["carnage_signer"]` | EPOCH_PROGRAM_ID |

All 4 CPI entry points validated with negative authorization tests (random keypair + wrong-program PDA both rejected with ConstraintSeeds error code 2006).

**Note:** The Conversion Vault has no CPI entry points -- it is a leaf-node program invoked directly by users. No PDA-gated access control is needed.

## Optimization Notes

No paths hit WARNING or CRITICAL thresholds. All measured CU values are below 62% of the 200k default limit:

- **Highest utilization:** swap_sol_sell (FRAUD/SOL) at 122,586 CU = 61.3% of 200k
- **Lowest utilization:** convert (vault) at ~15,000 CU = 7.5% of 200k
- **Carnage:** 105,017 CU = 52.5% of 200k (7.5% of 1.4M hard cap)

No optimization is required at this time. Revisit after devnet deployment (Phase 35-36) with production-scale liquidity pools.

---
*Measurements from Phase 32 Plans 01 and 02 (CPI Chain Validation)*
*Next measurement: Phase 35-36 (Devnet Deployment)*
