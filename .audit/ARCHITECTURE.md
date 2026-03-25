# Unified Architectural Understanding

**Project:** Dr. Fraudsworth's Finance Factory
**Generated:** 2026-03-21
**Source:** Stronghold of Security Phase 2 Synthesis (Audit #3)
**Synthesized from:** 9 parallel context auditors (access-control, arithmetic, state-machine, cpi-external, token-economic, oracle-data, upgrade-admin, timing-ordering, economic-model)

---

## Executive Summary

Dr. Fraudsworth is a 7-program Solana/Anchor protocol implementing a multi-token memecoin ecosystem with asymmetric taxation, VRF-driven epoch mechanics, and Synthetix-style staking. Three tokens (CRIME, FRAUD, PROFIT) trade through a Tax Program router that levies dynamic 3-14% taxes per swap, splits revenue 71/24/5 (staking/Carnage Fund/treasury), and routes swaps through a constant-product AMM. A linear bonding curve bootstraps initial supply, and a conversion vault provides fixed-rate 100:1 exchange between faction tokens and PROFIT.

The protocol's distinguishing feature is the Carnage Fund: a VRF-driven market-making mechanism that randomly triggers (~4.3% per epoch) to buy tokens, occasionally burning or selling existing holdings. This creates unpredictable buy pressure counteracting natural sell pressure. Tax rates flip each epoch based on Switchboard VRF randomness, creating an asymmetric game where the "cheap" token has low buy tax (3%) and high sell tax (14%).

From a security perspective, the protocol's most critical surfaces are: (1) the 4-level CPI chain for Carnage execution at Solana's hard limit, (2) the optional `carnage_state` account that enables permanent Carnage suppression, (3) cross-program byte-offset reads of AMM PoolState without version negotiation, (4) the Carnage fallback path's 25% MEV extraction window, and (5) the build pipeline dependency for cross-program ID synchronization.

---

## System Overview

### Core Components

| Component | Purpose | Location | Security Role |
|-----------|---------|----------|---------------|
| Tax Program | Swap router with dynamic taxation | `programs/tax-program/` | Entry point for all user swaps; validates EpochState, enforces slippage floors, distributes tax |
| AMM | Constant-product swap engine | `programs/amm/` | Executes swaps; gated by Tax Program's swap_authority PDA only |
| Epoch Program | VRF-driven epoch management + Carnage | `programs/epoch-program/` | Controls tax rate changes, Carnage Fund execution, epoch lifecycle |
| Staking Program | Synthetix-style PROFIT staking for SOL yield | `programs/staking/` | Distributes 71% of tax revenue to PROFIT stakers |
| Bonding Curve | Linear price curve for initial token distribution | `programs/bonding_curve/` | Bootstraps CRIME/FRAUD supply, 15% sell tax |
| Transfer Hook | Token-2022 whitelist enforcement | `programs/transfer-hook/` | Ensures all CRIME/FRAUD transfers touch whitelisted accounts |
| Conversion Vault | Fixed-rate token conversion | `programs/conversion-vault/` | 100:1 exchange between CRIME/FRAUD and PROFIT |

### Data Flow Diagram

```
                          +------------------+
                          |   USER (SOL)     |
                          +--------+---------+
                                   | swap_sol_buy / swap_sol_sell
                                   v
                    +--------------------------------+
                    |        TAX PROGRAM              |
                    | EpochState validation (owner)   |
                    | Tax: 3-14% (VRF-derived)        |
                    | 50% output floor enforcement    |
                    +------+-------+-------+---------+
                           |       |       |
                  +--------+  +----+----+  +--------+
                  v           v          v
          +------------+ +----------+ +----------+
          |STAKING 71% | |CARNAGE24%| |TREASURY5%|
          | escrow PDA | |sol_vault | |wallet    |
          +-----+------+ +----+-----+ +----------+
                |              |
                |              | VRF triggers (~4.3%/epoch)
                |              v
                |     +---------------------+
                |     | CARNAGE EXECUTION   |     CPI DEPTH: 4/4
                |     | Epoch -> Tax        |     (HARD LIMIT)
                |     | -> AMM -> T22       |
                |     | -> Transfer Hook    |
                |     +---------------------+
                v
          +--------------------+
          | STAKING PROGRAM    |
          | Synthetix rewards  |
          | Dead stake: 1 PROFIT|
          | Cooldown: 12h      |
          +--------------------+

    +-------------------+     +------------------+
    | AMM (x * y = k)   |     | BONDING CURVE    |
    | CRIME/SOL pool    |     | Linear: y=mx+b   |
    | FRAUD/SOL pool    |     | 460M tokens       |
    | 1% LP fee         |     | ~500 SOL target   |
    | Locked bool guard |     | 15% sell tax      |
    +-------------------+     +------------------+

    +-------------------+     +------------------+
    | TRANSFER HOOK     |     | CONVERSION VAULT |
    | T22 whitelist     |     | 100:1 fixed rate |
    | src OR dst check  |     | No oracle needed |
    +-------------------+     +------------------+
```

---

## Trust Model

### Actors

| Actor | Trust Level | Capabilities | Entry Points |
|-------|-------------|--------------|--------------|
| User (Swapper) | UNTRUSTED | Buy/sell tokens via Tax Program | swap_sol_buy, swap_sol_sell |
| User (Staker) | UNTRUSTED | Stake/unstake PROFIT, claim rewards | stake, unstake, claim |
| User (BC Buyer/Seller) | UNTRUSTED | Purchase/sell on bonding curve | purchase, sell, claim_refund |
| Crank Operator | UNTRUSTED | Trigger epoch transitions, execute Carnage | trigger_epoch_transition, consume_randomness, execute_carnage_* |
| Admin (Deployer) | TRUSTED | Initialize protocol, transfer/burn authorities, withdraw graduated SOL | initialize_*, transfer_admin, burn_admin, withdraw_graduated_sol |
| Switchboard Oracle | SEMI-TRUSTED | Provide VRF randomness | External — validated by program owner check |
| Token-2022 Runtime | TRUSTED | Enforce transfer hook on all CRIME/FRAUD transfers | External — Solana runtime guarantee |

### Trust Boundaries

```
+---------------------------------------------------------------+
|                    UNTRUSTED ZONE                               |
|    - All user inputs (amounts, minimum_output, is_crime)       |
|    - All remaining_accounts (hook accounts from client)         |
|    - Crank operator (liveness only, not correctness)           |
|    - Switchboard seed_slot honesty (UNVALIDATED on-chain)      |
+---------------------------------------------------------------+
|                    VALIDATION LAYER                              |
|    - Anchor constraints (#[account(...)], has_one, seeds)      |
|    - 50% output floor (MINIMUM_OUTPUT_FLOOR_BPS = 5000)        |
|    - EpochState owner check (tax-program reads epoch-program)  |
|    - PDA-derived CPI authorization (seeds::program)            |
|    - Transfer Hook whitelist check (src OR dst)                |
+---------------------------------------------------------------+
|                    TRUSTED ZONE                                  |
|    - Cross-program PDA signers (4 chains)                      |
|    - AMM internal state (reentrancy guard + k-invariant)       |
|    - Staking checkpoint pattern (update before balance change) |
|    - Anchor init (prevents re-initialization)                  |
+---------------------------------------------------------------+
|                    IMPLICIT TRUST (UNVALIDATED)                  |
|    - Build pipeline (sync-program-ids.ts, patch-mint-addresses)|
|    - AMM PoolState byte offsets (137/145) stable across upgrades|
|    - Cross-program discriminator bytes matching target programs |
|    - Switchboard oracle availability for epoch progression     |
+---------------------------------------------------------------+
```

---

## State Management

### Critical State Variables

| State | Location | Modified By | Read By | Invariants |
|-------|----------|-------------|---------|------------|
| EpochState | `epoch-program/state` | trigger_epoch, consume_randomness | Tax buy/sell (cross-program), Carnage | epoch monotonically increasing, vrf_pending exclusive |
| PoolState (AMM) | `amm/state` | swap_sol_pool | Tax (raw byte read), Epoch (raw byte read) | k_after >= k_before, locked during swap |
| StakePool | `staking/state` | deposit_rewards, update_cumulative, stake, unstake, claim | claim, stake, unstake | total_staked >= MINIMUM_STAKE, rpt monotonic |
| UserStakeInfo | `staking/state` | stake, unstake, claim, update_rewards | claim, unstake | earned = balance * (rpt - checkpoint) |
| CurveState | `bonding_curve/state` | purchase, sell, start_curve, prepare_transition, mark_failed | purchase, sell, claim_refund | status transitions forward-only |
| AdminConfig | `amm/state`, `bonding_curve/state` | transfer_admin, burn_admin | admin-gated instructions | admin modifiable only by current admin |
| WhitelistAuthority | `transfer-hook/state` | transfer_authority, burn_authority | transfer_hook handler | None = burned (permanent) |
| CarnageState | `epoch-program/state` (within EpochState) | consume_randomness, execute_carnage_*, expire_carnage | execute_carnage_*, expire_carnage | pending implies exactly one active Carnage |

### State Lifecycle: Epoch

```
IDLE (awaiting epoch boundary)
  │ trigger_epoch_transition (commit VRF)
  v
VRF_PENDING (randomness requested)
  │ consume_randomness (reveal VRF, derive taxes)
  │  ├── Carnage NOT triggered (96% probability)
  │  │   └── IDLE (new epoch active)
  │  └── Carnage TRIGGERED (4.3%)
  │       └── CARNAGE_PENDING
  │            ├── LOCK WINDOW (0-50 slots): atomic execution only
  │            ├── FALLBACK WINDOW (50-300 slots): permissionless
  │            └── EXPIRED (>300 slots): auto-expire on next consume
  │
  │ retry_epoch_vrf (if oracle fails, after 300 slots)
  v
IDLE (retry with fresh randomness)
```

### State Lifecycle: Bonding Curve

```
INITIALIZED ──(start_curve)──> ACTIVE
     │                            │
     │                    ├── purchase/sell
     │                    │
     │                    ├──(supply filled)──> FILLED
     │                    │                        │
     │                    │              ├──(prepare_transition)──> GRADUATED
     │                    │              │
     │                    │              └──(partner failed)──> claim_refund
     │                    │
     │                    └──(deadline + grace)──> FAILED ──> claim_refund
```

---

## Key Mechanisms

### Mechanism 1: Tax-Routed AMM Swaps

**Purpose:** All token swaps go through Tax Program which enforces dynamic taxation before routing to AMM.

**How it works:**
1. User calls `swap_sol_buy` or `swap_sol_sell` on Tax Program
2. Tax Program reads EpochState (cross-program, validates owner == epoch_program_id)
3. Tax rate determined by `is_crime` flag + EpochState.cheap_side + tax rate fields
4. Buy path: tax deducted from SOL input before AMM CPI
5. Sell path: tax deducted from WSOL output after AMM CPI
6. Tax split: 71% → staking escrow, 24% → Carnage vault, 5% → treasury
7. 50% minimum output floor enforced on user's minimum_output parameter

**Key files:**
- `tax-program/src/instructions/swap_sol_buy.rs`: Buy path
- `tax-program/src/instructions/swap_sol_sell.rs`: Sell path
- `tax-program/src/helpers/tax_math.rs`: Tax calculation and distribution split
- `amm/src/instructions/swap_sol_pool.rs`: AMM execution

**Security considerations:**
- swap_authority PDA (Tax→AMM) is the sole gatekeeper — only Tax Program can initiate swaps
- 50% output floor prevents zero-slippage sandwich attacks
- EpochState owner check prevents fake tax rates
- remaining_accounts forwarded without per-account validation (delegated to T22)

### Mechanism 2: VRF-Driven Epoch Transitions + Carnage

**Purpose:** Randomize tax rates each epoch and trigger market-making Carnage Fund events.

**How it works:**
1. Crank calls `trigger_epoch_transition` — commits Switchboard VRF randomness account
2. Crank bundles Switchboard revealIx + `consume_randomness` — derives tax rates from VRF bytes
3. If VRF byte[5] < 11 (~4.3%), Carnage triggers
4. Atomic path: consume_randomness + execute_carnage_atomic in single TX (85% slippage floor)
5. Fallback path: after 50-slot lock window, anyone can call execute_carnage (75% slippage floor)
6. Carnage executes via: Epoch → Tax::swap_exempt → AMM::swap → T22::transfer → Hook (4-level CPI)

**Key files:**
- `epoch-program/src/instructions/trigger_epoch_transition.rs`: VRF commit
- `epoch-program/src/instructions/consume_randomness.rs`: VRF reveal + tax derivation
- `epoch-program/src/helpers/carnage_execution.rs`: Carnage swap logic (~906 lines)
- `epoch-program/src/helpers/carnage.rs`: VRF byte interpretation for Carnage decisions
- `epoch-program/src/helpers/tax_derivation.rs`: VRF byte interpretation for tax rates

**Security considerations:**
- CPI depth at exactly 4/4 Solana hard limit — zero margin
- Optional `carnage_state` enables Carnage skip griefing
- Fallback path has 25% MEV extraction window (75% slippage floor)
- Anti-reroll binding prevents VRF manipulation
- VRF freshness uses `saturating_sub` — future-dated seed_slot passes

### Mechanism 3: Synthetix-Style Staking

**Purpose:** Distribute 71% of tax revenue to PROFIT stakers proportionally.

**How it works:**
1. Tax Program calls `deposit_rewards` via CPI (authorized by tax_authority PDA)
2. Epoch Program calls `update_cumulative` at epoch transition (authorized by staking_authority PDA)
3. `update_rewards` checkpoint called BEFORE any balance change (flash-loan protection)
4. Reward formula: `earned = staked_balance * (current_rpt - checkpoint_rpt) / PRECISION`
5. Dead stake (1 PROFIT locked at init) prevents first-depositor attack
6. Claims transfer SOL from escrow via direct lamport manipulation with rent-exempt guard

**Key files:**
- `staking/src/helpers/math.rs`: Reward calculation with u128/PRECISION=1e18
- `staking/src/instructions/claim.rs`: SOL claim with rent-exempt check
- `staking/src/instructions/stake.rs`: Stake PROFIT
- `staking/src/instructions/unstake.rs`: Unstake (forfeits all pending rewards)

**Security considerations:**
- Checkpoint-before-balance-change prevents flash-stake attacks
- Dead stake prevents first-depositor inflation attack
- Reward forfeiture on unstake creates strong hold incentive
- 12h cooldown between claim and unstake
- Escrow rent-exempt minimum prevents drain below rent

### Mechanism 4: Cross-Program Raw Byte Reads

**Purpose:** Tax Program and Epoch Program read AMM PoolState reserves without circular crate dependency.

**How it works:**
1. Tax Program's `pool_reader.rs` reads bytes [137..145] and [145..153] from PoolState
2. Epoch Program's `carnage_execution.rs` reads same offsets for slippage calculation
3. Tax Program validates pool account owner == amm_program_id()
4. Epoch Program does NOT validate pool owner at function level (mitigated by Anchor struct constraints)

**Key files:**
- `tax-program/src/helpers/pool_reader.rs:79-88`
- `epoch-program/src/helpers/carnage_execution.rs:825-851`

**Security considerations:**
- No version check or struct hash — if AMM PoolState layout changes, silent data corruption
- Cross-crate tests validate current layout but not future upgrades
- Different owner validation patterns (Tax vs Epoch) create defense-in-depth gap

---

## External Dependencies

### CPI Targets

| Program | Purpose | Validation | Trust Level |
|---------|---------|------------|-------------|
| Token-2022 | Token transfers for CRIME/FRAUD | `Interface<TokenInterface>` | HIGH (Solana runtime) |
| SPL Token | WSOL operations | `Program<Token>` | HIGH (Solana runtime) |
| System Program | SOL transfers, account creation | `Program<System>` | HIGH (Solana runtime) |
| Associated Token Program | ATA creation | `Program<AssociatedToken>` | HIGH (Solana runtime) |
| Switchboard On-Demand | VRF randomness | `owner = SWITCHBOARD_PROGRAM_ID` | SEMI-TRUSTED (single oracle) |

### Oracles/External Data

| Source | Data Type | Usage | Validation |
|--------|-----------|-------|------------|
| Switchboard VRF | Random bytes (32 bytes) | Tax rate derivation (bytes 0-4), Carnage decisions (bytes 5-7) | Owner check, freshness <= 1 slot, anti-reroll binding |
| AMM Pool Reserves | Token reserves (u64 pair) | Slippage floor calculation for Tax swaps and Carnage | Raw byte read at offsets 137/145; Tax validates owner, Epoch does not |

---

## Access Control Summary

### Permission Matrix

| Operation | Anonymous | User | Admin | Upgrade Authority |
|-----------|-----------|------|-------|-------------------|
| swap_sol_buy / swap_sol_sell | - | Yes (own funds) | - | - |
| stake / unstake / claim | - | Yes (own stake) | - | - |
| purchase / sell (BC) | - | Yes (own funds) | - | - |
| convert (Vault) | - | Yes (own tokens) | - | - |
| trigger_epoch_transition | Yes | Yes | Yes | Yes |
| consume_randomness | Yes | Yes | Yes | Yes |
| execute_carnage_* | Yes (after lock) | Yes | Yes | Yes |
| expire_carnage | Yes (after deadline) | Yes | Yes | Yes |
| mark_failed (BC) | Yes (after deadline+grace) | Yes | Yes | Yes |
| start_curve | - | - | Yes (BC admin) | - |
| prepare_transition | - | - | Yes (BC admin) | - |
| withdraw_graduated_sol | - | - | Yes (BC admin) | - |
| transfer_admin | - | - | Yes (current admin) | - |
| burn_admin | - | - | Yes (current admin) | - |
| initialize_* | - | - | - | Yes |
| whitelist management | - | - | Yes (WL authority) | - |

### Authority Distribution (13 total at Stage 7)

| Authority | Type | Current State | Planned |
|-----------|------|---------------|---------|
| AMM upgrade authority | BPFLoaderUpgradeable | Deployer wallet | Squads 2-of-3 |
| Tax upgrade authority | BPFLoaderUpgradeable | Deployer wallet | Squads 2-of-3 |
| Epoch upgrade authority | BPFLoaderUpgradeable | Deployer wallet | Squads 2-of-3 |
| Staking upgrade authority | BPFLoaderUpgradeable | Deployer wallet | Squads 2-of-3 |
| BC upgrade authority | BPFLoaderUpgradeable | Deployer wallet | Squads 2-of-3 |
| Hook upgrade authority | BPFLoaderUpgradeable | Deployer wallet | Squads 2-of-3 |
| Vault upgrade authority | BPFLoaderUpgradeable | Deployer wallet | Squads 2-of-3 |
| AMM AdminConfig.admin | PDA-stored key | Deployer wallet | Squads (NOT burned) |
| BC BcAdminConfig.authority | PDA-stored key | Deployer wallet | Squads |
| Whitelist authority | PDA-stored Option | Deployer wallet | Squads (NOT burned) |
| CRIME metadata update auth | Metaplex | Deployer wallet | Squads |
| FRAUD metadata update auth | Metaplex | Deployer wallet | Squads |
| PROFIT metadata update auth | Metaplex | Deployer wallet | Squads |

---

## Economic Model

### Value Flows

```
User SOL ──(buy tax 3-14%)──> Tax Distribution
                                  │
                    ┌─────────────┼─────────────┐
                    v             v             v
             Staking 71%   Carnage 24%   Treasury 5%
             (escrow PDA)  (sol vault)   (wallet)
                    │             │
                    v             v
             PROFIT stakers  VRF-triggered buy
             claim SOL       (~4.3%/epoch)
                              max 1000 SOL/trigger

User tokens ──(sell tax 3-14%)──> Same distribution
```

### Fee Structure

| Fee Type | Rate | Collection Point | Destination |
|----------|------|------------------|-------------|
| Buy tax | 3-14% BPS (VRF-derived) | Tax Program, SOL input | 71/24/5 split |
| Sell tax | 3-14% BPS (VRF-derived) | Tax Program, WSOL output | 71/24/5 split |
| AMM LP fee | 1% (100 BPS) | AMM swap | Retained in pool reserves |
| BC sell tax | 15% fixed | Bonding curve sell | Tax escrow PDA |
| Epoch trigger bounty | 0.001 SOL fixed | Epoch transition | Crank caller |
| Conversion dust | Up to 99 base units | Conversion vault | Lost (truncation) |

### Economic Invariants

1. **k_after >= k_before** — AMM constant product preserved across all swaps (`swap_sol_pool.rs:171-173`)
2. **staking + carnage + treasury == total_tax** — remainder-to-treasury conservation (`tax_math.rs:105-107`)
3. **rewards_per_token_stored monotonically non-decreasing** — only checked_add, never subtract (`math.rs:134`)
4. **bonding curve tokens_out <= remaining supply** — capped via min (`math.rs:107`)
5. **conversion rate = 100:1 fixed** — hardcoded CONVERSION_RATE (`convert.rs:101-113`)
6. **sum of claims <= total deposited rewards** — floor division truncation (`math.rs:65-70`)
7. **swap output < reserve_out** — constant-product formula prevents pool drain (`amm/math.rs:73-75`)
8. **user wallet cap <= 50 SOL cumulative** on bonding curve (`purchase.rs:135-141`)

---

## High-Complexity Areas

### Area 1: Carnage Execution Path (4-Level CPI Chain)

**Identified by:** CPI, Token/Economic, Timing, Economic Model, Access Control, State Machine (6/9 agents)

**Why complex:**
- Exactly at Solana's 4-level CPI hard limit (Epoch → Tax → AMM → T22 → Hook)
- Optional `carnage_state` creates griefing vector
- Fallback path has 25% MEV extraction window
- Dual-mint partition logic for atomic bundling (recent refactor)
- VRF unpredictability is primary defense but not absolute

**Key code:** `epoch-program/src/helpers/carnage_execution.rs:1-906`, `consume_randomness.rs:76-80`

### Area 2: Cross-Program Raw Byte Reads

**Identified by:** Arithmetic, CPI, Token/Economic, Oracle (4/9 agents)

**Why complex:**
- Two programs (Tax, Epoch) independently hardcode AMM PoolState byte offsets
- No version negotiation, no struct hash, no compile-time enforcement across crates
- Cross-crate tests exist but only validate current layout
- An AMM upgrade changing field order would cause silent data corruption in tax/slippage calculations

**Key code:** `pool_reader.rs:79-88`, `carnage_execution.rs:825-851`

### Area 3: Build-Time ID Synchronization

**Identified by:** CPI, Upgrade/Admin (2/9 agents)

**Why complex:**
- 7 programs reference each other's IDs via hardcoded constants
- `sync-program-ids.ts` and `patch-mint-addresses.ts` patch source at build time
- Git-committed source does NOT reflect deployed binary
- Current source shows cluster contamination: Tax has mainnet AMM ID, others have devnet
- A naive `anchor build` without `build.sh` produces incompatible programs

**Key code:** `scripts/deploy/build.sh:85-99`, all `constants.rs` files

---

## Cross-Cutting Concerns

### Patterns Used Across Codebase

| Pattern | Usage Count | Locations | Consistency |
|---------|-------------|-----------|-------------|
| Upgrade authority gating (init) | 7 | All initialize_* instructions | Consistent |
| PDA-based CPI authorization | 4 chains | Tax→AMM, Tax→Staking, Epoch→Staking, Epoch→Tax | Consistent |
| Checked arithmetic | All math | All helpers/math.rs files | Consistent (except BC sell tax u64-only) |
| Anchor init (prevents re-init) | All inits | All programs | Consistent |
| Raw byte CPI discriminators | 6+ | Tax constants, Epoch constants | Consistent but fragile |
| Admin config PDA pattern | 2 | AMM AdminConfig, BC BcAdminConfig | Consistent |
| Direct lamport manipulation | 2 | Staking claim, epoch bounty | Consistent |
| remaining_accounts forwarding | 8+ sites | Tax, Epoch, BC, Staking | Inconsistent (BC validates len==4, others don't) |

### Shared Assumptions

1. **AMM PoolState byte offsets (137/145) are stable** — Relied upon by Tax Program AND Epoch Program. NOT enforced.
2. **Build pipeline always runs before deployment** — Relied upon by ALL 7 programs for cross-program ID consistency. NOT enforced on-chain.
3. **Switchboard oracle provides honest seed_slot** — Relied upon by Epoch Program VRF freshness check. NOT validated (saturating_sub masks future dates).
4. **Token-2022 correctly validates hook accounts** — Relied upon by ALL programs that forward remaining_accounts. Delegated to T22 runtime.
5. **Cross-program instruction discriminators match target programs** — Relied upon by Tax (DEPOSIT_REWARDS_DISCRIMINATOR) and Epoch (UPDATE_CUMULATIVE_DISCRIMINATOR, SWAP_EXEMPT_DISCRIMINATOR). Constants tests exist but runtime mismatch causes silent CPI failure.

---

## Attack Surface Summary

### Entry Points by Risk

| Risk Level | Entry Point | Why This Risk |
|------------|-------------|---------------|
| CRITICAL | `consume_randomness` | Optional carnage_state enables permanent Carnage suppression |
| CRITICAL | `execute_carnage` (fallback) | 25% MEV extraction window, minimum_output=0 at AMM level |
| HIGH | `swap_sol_sell` | Complex WSOL intermediary flow, sell-side tax after AMM swap |
| HIGH | `swap_exempt` | Carnage CPI entry point; passes minimum_output=0 to AMM |
| HIGH | `trigger_epoch_transition` | VRF freshness check uses saturating_sub |
| MEDIUM | `purchase` / `sell` (BC) | Bonding curve math, Sybil wallet cap |
| MEDIUM | `claim` / `unstake` | Lamport manipulation, cooldown timing |
| LOW | `convert` (Vault) | Fixed rate, bounded by vault balance |

### Known Constraints (Protections Observed)

- **50% output floor**: `MINIMUM_OUTPUT_FLOOR_BPS = 5000` prevents zero-slippage sandwich (`swap_sol_buy.rs:106-111`)
- **k-invariant verification**: Post-swap check prevents pool drain (`swap_sol_pool.rs:171-173`)
- **Anti-reroll binding**: Randomness account bound at commit, verified at reveal (`consume_randomness.rs:154-157`)
- **Dead stake**: 1 PROFIT locked at init prevents first-depositor attack (`initialize_stake_pool.rs`)
- **Checkpoint-before-balance-change**: Prevents flash-stake reward extraction (`stake.rs:118`, `unstake.rs`)
- **Upgrade authority gating**: All inits require deployer key (`initialize_*.rs`)
- **Reentrancy guard**: AMM pool.locked prevents same-account re-entry (`swap_sol_pool.rs:84`)
- **Anchor init constraint**: Prevents all re-initialization attacks
- **Cross-crate layout tests**: Round-trip + DATA_LEN assertion (`tests/cross-crate/src/lib.rs`)
- **Feature-gated devnet instructions**: force_carnage excluded from non-devnet builds

### Open Questions

1. Should `carnage_state` be mandatory in `consume_randomness` to prevent Carnage skip griefing?
2. Is the cross-program byte-offset pattern sustainable, or should it be replaced with a versioned interface?
3. What is the plan for CPI depth when Agave 3.0 raises the limit to 8 — can additional security checks be added?
4. Should two-step authority transfer (propose + accept) replace single-step to prevent accidental loss?

---

## Appendix: Focus Area Cross-References

### Where Focus Areas Intersected

| Focus A | Focus B | Intersection Point | Notes |
|---------|---------|-------------------|-------|
| Access Control | State Machine | Optional carnage_state | Both flag griefing risk; #1 finding for both |
| Access Control | CPI | stake_pool unconstrained at Epoch | Defense-in-depth gap; Staking CPI validates downstream |
| Arithmetic | CPI | Pool reader byte offsets | Both flag silent corruption risk on AMM upgrade |
| Token/Economic | Timing | Carnage fallback MEV | Both quantify 25% extraction window |
| Oracle | Timing | VRF freshness saturating_sub | Both flag future-dated seed_slot bypass |
| Upgrade/Admin | CPI | Build-time ID synchronization | Both flag deployment integrity risk |
| Economic Model | Token/Economic | Conversion vault arbitrage | Both note bounded by vault balance and swap taxes |
| State Machine | Timing | Epoch skip behavior | Both note reward forfeiture during gaps |

### Tensions Between Observations

| Area | Observation A | Observation B | Resolution |
|------|---------------|---------------|------------|
| Carnage slippage | 85% atomic floor (Token/Economic) | minimum_output=0 at AMM level (CPI, Timing) | Both true — Epoch enforces post-swap, AMM has no guard |
| Treasury pubkey | HOT_SPOTS flagged CRITICAL (pre-scan) | Access Control + Upgrade confirm FIXED | Pre-scan was stale; current code has correct mainnet address |
| Pool owner check | Epoch omits function-level check (Oracle) | Anchor struct constraints enforce owner (CPI) | Defense-in-depth gap — mitigated but not eliminated |

---

**This document synthesizes findings from 9 parallel context audits.**
**Use this as the foundation for attack strategy generation.**
