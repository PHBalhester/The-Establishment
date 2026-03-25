# Cross-Program Upgrade Cascade

Operational reference for safe program upgrades. Documents the CPI dependency graph, breaking change categories, and required upgrade ordering.

**Audience:** Developers and operators performing program upgrades.

## Upgrade-at-Same-Address Commitment

All seven programs are deployed at fixed addresses. Upgrades MUST be performed at the same program address (using `solana program deploy --program-id <KEYPAIR>`). Changing a program address would break every CPI call site and PDA derivation that references the old address.

| Program | Address | Upgrade Authority |
|---------|---------|-------------------|
| AMM | `EsbMMZtyK4QuEEETj58GRf2wA5Cq1UK9ZBnnrbg6jyst` | Deployer (pre-burn) |
| Transfer Hook | `FnwnSxgieKBYogwD45KbwtpZMWsdzapg3VwkxTqiaihB` | Deployer (pre-burn) |
| Tax Program | `Eufdhhek6L1cxrYPvXAgJRVzckuzWVVBLckjNwyggViV` | Deployer (pre-burn) |
| Epoch Program | `5q1X9zGskp8WxpqHyD32vcXJ7Fy5kYJR2YsM1qFuLSeJ` | Deployer (pre-burn) |
| Staking | `HLVyXH5QophmQsTZfZS1N3ZHP8QQ476k3JsnWvrHacr8` | Deployer (pre-burn) |
| Conversion Vault | `EA1tKNmHFs4KH1V3cyZP3CD66GLLJ7Yb9cseeMxR9tv8` | Deployer (pre-burn) |
| Bonding Curve | `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1` | Deployer (pre-burn) |

## CPI Dependency Graph

Each arrow represents a direct CPI call. Programs at depth 0 are leaf nodes (no outbound CPIs to protocol programs).

```
DEPTH 0 (Leaf nodes -- no protocol CPIs)
  Transfer Hook   ── receives CPI from Token-2022 only, makes ZERO outbound CPIs
  Conversion Vault ── calls Token-2022 transfer_checked only

DEPTH 1
  AMM             ── calls Token-2022 transfer_checked (which invokes Transfer Hook)
                     No other protocol program CPIs.

DEPTH 2
  Staking         ── calls Token-2022 transfer_checked (which invokes Transfer Hook)
                     Receives CPIs from Tax (deposit_rewards) and Epoch (update_cumulative).
                     No outbound CPIs to other protocol programs.

  Tax Program     ── calls AMM::swap_sol_pool
                  ── calls Staking::deposit_rewards
                  ── calls System Program (SOL transfers)
                  ── reads Epoch Program's EpochState (owner check, no CPI)

DEPTH 3
  Epoch Program   ── calls Tax::swap_exempt (for Carnage swaps)
                  ── calls Staking::update_cumulative (epoch finalization)
                  ── calls Token-2022 burn (Carnage token burns)
                  ── calls System Program (bounty transfers)

  Bonding Curve   ── calls Token-2022 transfer_checked (which invokes Transfer Hook)
                  ── calls System Program (SOL transfers)
                     No CPIs to other protocol programs.
```

### Detailed CPI Call Sites

| Caller | Target | Instruction | Purpose |
|--------|--------|-------------|---------|
| **Tax Program** | AMM | `swap_sol_pool` | Execute swaps (buy and sell paths) |
| **Tax Program** | Staking | `deposit_rewards` | Route 71% of tax SOL to staking escrow |
| **Tax Program** | System Program | `transfer` | SOL to treasury, carnage vault |
| **Epoch Program** | Tax Program | `swap_exempt` | Tax-free Carnage swaps (buy/sell) |
| **Epoch Program** | Staking | `update_cumulative` | Finalize epoch reward distribution |
| **Epoch Program** | Token-2022 | `burn` | Burn held tokens during Carnage |
| **Epoch Program** | System Program | `transfer` | Epoch transition bounty payout |
| **AMM** | Token-2022 | `transfer_checked` | Token transfers within swaps |
| **AMM** | SPL Token | `transfer_checked` | WSOL transfers within swaps |
| **Staking** | Token-2022 | `transfer_checked` | PROFIT stake/unstake transfers |
| **Staking** | System Program | `transfer` | SOL reward claims |
| **Conversion Vault** | Token-2022 | `transfer_checked` | Token conversions (100:1 rate) |
| **Bonding Curve** | Token-2022 | `transfer_checked` | Token purchase/sell transfers |
| **Bonding Curve** | System Program | `transfer` | SOL purchase/refund transfers |
| **Token-2022** | Transfer Hook | `transfer_hook` (execute) | Whitelist validation on every transfer |

### Maximum CPI Depth

The deepest CPI chain is 4 levels (Solana's maximum):

```
Epoch::execute_carnage_atomic (0)
  -> Tax::swap_exempt (1)
    -> AMM::swap_sol_pool (2)
      -> Token-2022::transfer_checked (3)
        -> Transfer Hook::transfer_hook (4)  <-- Solana limit
```

This depth ceiling is permanent and fully consumed. No additional CPI calls can be added to any swap path.

## Breaking Change Categories

When modifying a program, assess which category the change falls into.

### Category A: Account Layout Changes (HIGH RISK)

Changes to Anchor account struct fields, sizes, or ordering. These break all existing PDAs unless migration is performed.

**Examples:**
- Adding/removing/reordering fields in state structs (PoolState, EpochState, etc.)
- Changing field types (u64 -> u128, Pubkey -> Option<Pubkey>)
- Modifying PDA seed derivation

**Mitigation:** Reserved padding bytes in EpochState (64 bytes) and CurveState allow field additions without layout breaking. All other structs require careful migration.

### Category B: Instruction Signature Changes (MEDIUM RISK)

Changes to instruction argument types, counts, or Anchor discriminators. These break all callers (both CPI and client-side).

**Examples:**
- Adding/removing instruction arguments
- Changing argument types
- Renaming instructions (changes Anchor 8-byte discriminator)

**Impact:** CPI callers use hardcoded discriminators. Tax Program hardcodes `DEPOSIT_REWARDS_DISCRIMINATOR` and `SWAP_SOL_POOL_DISCRIMINATOR`. Epoch Program hardcodes `SWAP_EXEMPT_DISCRIMINATOR` and `UPDATE_CUMULATIVE_DISCRIMINATOR`. Any discriminator change requires updating all callers simultaneously.

### Category C: Constraint Changes (LOW-MEDIUM RISK)

Changes to Anchor account constraints, validation logic, or error codes.

**Examples:**
- Tightening signer requirements
- Adding new account validation
- Changing error variants

**Impact:** May cause previously-valid transactions to fail. Client-side error handling may need updates.

### Category D: Pure Logic Changes (LOW RISK)

Changes to internal computation that don't affect interfaces.

**Examples:**
- Tax rate calculation adjustments
- Slippage formula changes
- Event emission changes

**Impact:** No CPI or client breakage, but may affect protocol economics.

## Safe Upgrade Order

When upgrading multiple programs, deploy in this order (leaf nodes first, root nodes last):

```
Phase 1 (leaf nodes -- no dependents to break):
  1. Transfer Hook
  2. Conversion Vault
  3. Bonding Curve

Phase 2 (mid-tier -- depended on by Tax/Epoch only):
  4. AMM
  5. Staking

Phase 3 (orchestrators -- depend on everything below):
  6. Tax Program

Phase 4 (root -- depends on Tax + Staking):
  7. Epoch Program
```

**Rules:**
1. Never upgrade a program while a program that CPIs into it is mid-transaction (stop the crank first).
2. If changing an instruction signature (Category B), upgrade the target program AND all callers in the same maintenance window.
3. If changing account layout (Category A), migrate existing accounts before deploying new code that reads them.
4. Test the full CPI chain after each upgrade: trigger an epoch transition + Carnage execution to exercise the deepest path.

### Pre-Upgrade Checklist

1. Stop the crank runner (prevents epoch transitions during upgrade)
2. Wait for any pending Carnage to complete or expire
3. Build with correct feature flags (`--features devnet` for devnet)
4. Deploy in the order above
5. Run `initialize.ts` if new accounts are needed (idempotent)
6. Verify via `solana program show <PROGRAM_ID>`
7. Restart the crank runner
8. Monitor first epoch transition for errors

## Future: Authority Burn Plan

**Status:** v1.4 scope -- not yet implemented.

All seven program upgrade authorities will be transferred to a 2-of-3 Squads multisig with tiered timelock enforcement before eventual permanent burn:

1. **Phase 1 (launch):** Transfer upgrade authorities to Squads 2-of-3 multisig with 2-hour timelock
2. **Phase 2 (stabilization):** Increase timelock to 24 hours after initial stability period
3. **Phase 3 (confidence):** Permanently burn all upgrade authorities via Squads

Post-burn, the protocol becomes immutable. There is no pause mechanism, no governance, and no admin intervention path. This is by design -- the protocol's value proposition depends on provable immutability.

The 2-of-3 multisig prevents single-point-of-failure key compromise during the pre-burn period. Squads is OtterSec-audited and widely used in Solana DeFi.
