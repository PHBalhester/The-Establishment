# ARCHITECTURE.md — Unified Security Architecture

**Audit ID:** sos-001-20260222-be95eba
**Synthesized from:** 9 Phase 1 context analyses (avg quality: 84.6/100)
**Protocol:** Dr Fraudsworth's Finance Factory
**Ecosystem:** Solana / Anchor 0.32.1 / Token-2022
**Generated:** 2026-02-22

---

## 1. Protocol Overview

Dr Fraudsworth is a **5-program Solana DeFi protocol** implementing a novel faction-based tokenomic system. Users choose between two competing factions (CRIME and FRAUD), buy faction tokens with SOL, and earn yield through a shared PROFIT token distributed via staking. A VRF-driven "Carnage" mechanism periodically redistributes value between factions based on randomness.

**Programs (all non-upgradeable after deployment):**

| # | Program | ID Prefix | Purpose |
|---|---------|-----------|---------|
| 1 | AMM | 5ANTHFtg | Constant-product swap pools (SOL/CRIME, SOL/FRAUD, CRIME/PROFIT, FRAUD/PROFIT) |
| 2 | Tax Program | DRjNCjt4 | User-facing entry point. Wraps AMM swaps with 15% tax + redistribution |
| 3 | Epoch Program | G6dmJTdC | VRF-driven epoch transitions, tax rate randomization, Carnage triggering |
| 4 | Transfer Hook | CmNyuLdM | Token-2022 hook enforcing whitelist on CRIME/FRAUD/PROFIT transfers |
| 5 | Staking | EZFeU613 | Synthetix-style cumulative reward-per-token staking for PROFIT distribution |

**Token Architecture:**
- **CRIME** (F65o4z) — Token-2022, transfer hook, faction A
- **FRAUD** (83gSRt) — Token-2022, transfer hook, faction B
- **PROFIT** (8y7Mat) — Token-2022, transfer hook, shared yield token
- All 3 mints have TransferHook extension pointing to the Hook program
- WSOL used as intermediary for SOL pool interactions

---

## 2. Trust Model & Authority Map

### 2.1 PDA Authority Chains (All 4 Verified MATCH Across Programs)

```
┌─────────────────────────────────────────────────────────────┐
│                    PDA AUTHORITY CHAINS                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  swap_authority    seeds=["swap_authority"]  program=TAX      │
│  ├── Tax Program derives it                                   │
│  └── AMM validates via seeds::program = TAX_PROGRAM_ID        │
│                                                               │
│  carnage_signer   seeds=["carnage_signer"]  program=EPOCH     │
│  ├── Epoch Program derives it                                 │
│  └── Tax Program validates via seeds::program = EPOCH_PID     │
│                                                               │
│  tax_authority    seeds=["tax_authority"]   program=TAX        │
│  ├── Tax Program derives it                                   │
│  └── Staking validates via seeds::program = TAX_PROGRAM_ID    │
│                                                               │
│  staking_authority seeds=["staking_authority"] program=EPOCH   │
│  ├── Epoch Program derives it                                 │
│  └── Staking validates via seeds::program = EPOCH_PID         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Trust Boundaries

```
User ──────► Tax Program (entry point) ──► AMM (swaps)
                    │                          │
                    ├──► Staking (deposits)     │
                    │                          ▼
Epoch Program ─────┼──► Tax Program (carnage) ──► AMM (carnage swaps)
     │             │
     └─────────────┴──► Staking (epoch rewards)

Token-2022 Runtime ──► Transfer Hook (whitelist check on every transfer)
```

### 2.3 Admin Capability Map

| Program | Admin Actions | Post-Deploy |
|---------|--------------|-------------|
| AMM | Create pools, add liquidity, set pool to "burnable" | Pool creation only at init; burnable flag is one-way |
| Tax Program | Update treasury address | Treasury update only (devnet placeholder exists) |
| Transfer Hook | Add/remove whitelist entries | Whitelist management only |
| Epoch Program | `force_carnage` (devnet only), `retry_epoch_vrf` | Autonomous after VRF init |
| Staking | None post-init | Fully autonomous |

**Deploy-and-Lock Model:** All 5 programs are deployed as non-upgradeable. Admin capabilities are intentionally minimal and narrowly scoped.

### 2.4 Maximum Damage Assessment (Key Compromise)

| Scenario | Impact |
|----------|--------|
| Admin key compromised | Can update treasury (redirect tax revenue), modify whitelist, force carnage (devnet). Cannot drain pools, cannot modify program logic. |
| Epoch authority compromised | Can trigger carnage off-schedule. Cannot manipulate VRF outcome (Switchboard signs). |
| All keys compromised | Tax revenue redirect + off-schedule carnage. Pool funds and staked tokens remain safe (PDA-controlled). |

---

## 3. Cross-Program Invocation (CPI) Graph

### 3.1 CPI Call Chains

```
Tax::swap_buy_sol       → AMM::swap (via swap_authority PDA)          depth=2
Tax::swap_sell_sol      → AMM::swap (via swap_authority PDA)          depth=2
Tax::swap_profit_buy    → AMM::swap (via swap_authority PDA)          depth=2
Tax::swap_profit_sell   → AMM::swap (via swap_authority PDA)          depth=2
Tax::deposit_tax        → Staking::deposit_rewards (via tax_authority) depth=2
Tax::execute_carnage    → AMM::swap × 2-3 (via carnage_signer PDA)   depth=2-3
Epoch::trigger_epoch    → Tax::execute_carnage (via carnage_signer)   depth=3
                          → AMM::swap × 2-3                           depth=4 ← MAX
Epoch::trigger_epoch    → Staking::distribute (via staking_authority)  depth=3

Token-2022 (runtime)    → Hook::execute (on every transfer_checked)    depth=N/A (runtime)
```

**Critical:** Maximum CPI depth reaches **4** on the Carnage execution path (Epoch → Tax → AMM → Token-2022 transfer_checked). This is exactly at Solana's CPI depth limit. Any additional nesting would break it.

### 3.2 CPI Validation

- All CPI targets validated via **hardcoded address constraints** (no dynamic program ID)
- All post-CPI state reads use `.reload()` to prevent stale data
- Transfer hook CPI uses manual `transfer_checked_with_hook` helper (Anchor SPL's `transfer_checked` does NOT forward remaining_accounts)

---

## 4. Instruction Map (Entry Points)

### Tax Program (User-Facing)
| Instruction | Auth | Modifies State | CPI |
|------------|------|----------------|-----|
| `swap_buy_sol` | User (signer) | Pool reserves, user token account | AMM::swap |
| `swap_sell_sol` | User (signer) | Pool reserves, user SOL account | AMM::swap |
| `swap_profit_buy` | User (signer) | PROFIT pool reserves | AMM::swap |
| `swap_profit_sell` | User (signer) | PROFIT pool reserves | AMM::swap |
| `stake` | User (signer) | Staking position | Staking::stake |
| `unstake` | User (signer) | Staking position | Staking::unstake |
| `claim_rewards` | User (signer) | Reward distribution | Staking::claim |
| `execute_carnage` | carnage_signer PDA | Pool reserves, mint supply | AMM::swap ×N |

### AMM Program
| Instruction | Auth | Modifies State |
|------------|------|----------------|
| `initialize_pool` | Admin | Creates PoolState |
| `swap` | swap_authority / carnage_signer PDA | Pool reserves |
| `add_liquidity` | Admin | Pool reserves |

### Epoch Program
| Instruction | Auth | Modifies State | CPI |
|------------|------|----------------|-----|
| `initialize_epoch` | Admin | EpochState | None |
| `trigger_epoch_transition` | Permissionless (bounty) | EpochState, tax rates | Tax, Staking |
| `commit_vrf` | Permissionless | VRF state | Switchboard |
| `reveal_vrf` | Permissionless | VRF result | Switchboard |
| `consume_randomness` | Internal | Tax rates, carnage decision | None |
| `retry_epoch_vrf` | Admin | VRF state (recovery) | Switchboard |
| `force_carnage` | Admin (devnet only) | Carnage trigger | Tax |

### Transfer Hook
| Instruction | Auth | Modifies State |
|------------|------|----------------|
| `initialize` | Admin | Hook config |
| `add_to_whitelist` | Admin | Whitelist entries |
| `remove_from_whitelist` | Admin | Whitelist entries |
| `execute` | Token-2022 runtime | None (read-only check) |

### Staking
| Instruction | Auth | Modifies State |
|------------|------|----------------|
| `initialize_pool` | Admin | StakePool |
| `stake` | tax_authority PDA | UserStake, StakePool |
| `unstake` | tax_authority PDA | UserStake, StakePool |
| `claim_rewards` | tax_authority PDA | UserStake, reward accounts |
| `deposit_rewards` | tax_authority PDA | StakePool reward state |
| `distribute_epoch_rewards` | staking_authority PDA | StakePool |

---

## 5. Token Flow Model

### 5.1 SOL Buy Path
```
User SOL → Tax Program (15% tax extracted) → 85% to AMM swap → Faction token to User
                │
                └─ 15% tax split: 5% Treasury, 5% Staking Rewards, 5% Carnage Fund
```

### 5.2 SOL Sell Path
```
User Faction Token → Tax Program (15% tax extracted) → 85% to AMM swap → SOL to User
                │
                └─ 15% tax split: 5% Treasury, 5% Staking Rewards, 5% Carnage Fund
```

### 5.3 PROFIT Buy/Sell
```
User Faction Token ↔ PROFIT Token (via faction/PROFIT pool)
Tax applied same as SOL paths (15% split)
```

### 5.4 Carnage Execution
```
Carnage Fund (WSOL) → Buy losing faction token → Burn portion → Sell remainder for winning token
         │                                                              │
         └─ Slippage floor: 85% (buy), 75% (sell)                     └─ Winning token bought
```

### 5.5 Staking Rewards
```
Tax deposits (5% of all trades) → StakePool → Distributed pro-rata to stakers
Epoch rewards (PROFIT minting)  → StakePool → Distributed pro-rata to stakers
```

### 5.6 Transfer Hook (All Transfers)
```
Any CRIME/FRAUD/PROFIT transfer → Token-2022 → Hook::execute
                                                    │
                                                    ├─ Source whitelisted? → Allow
                                                    ├─ Dest whitelisted? → Allow
                                                    └─ Neither? → REJECT
```

Hook accounts per mint = **4** (extra_account_meta_list, whitelist_source, whitelist_dest, hook_program).

---

## 6. Critical Invariants (Consolidated)

### AMM Invariants
| ID | Invariant | Status |
|----|-----------|--------|
| INV-K | `reserve_a * reserve_b >= k` (k-invariant, post-swap) | Verified |
| INV-AMM-FEE | 30 bps fee deducted before swap computation | Verified |
| INV-AMM-ZERO | Zero-amount swaps rejected | Verified |
| INV-AMM-DRAIN | Cannot swap for more than reserve (output < reserve) | Verified |
| INV-AMM-REENT | Reentrancy guard via `pool.locked` boolean with CEI ordering | Verified |

### Tax Invariants
| ID | Invariant | Status |
|----|-----------|--------|
| INV-TAX-SPLIT | Tax = 5% treasury + 5% staking + 5% carnage (exact, checked_add) | Verified |
| INV-TAX-RATE | Tax rate in [500, 2500] bps (5%-25%), set by VRF | Verified |
| INV-TAX-MIN | Minimum output enforced via user-supplied `min_amount_out` | Verified |

### Staking Invariants
| ID | Invariant | Status |
|----|-----------|--------|
| INV-STK-CONS | Sum of user_staked == pool.total_staked | Verified |
| INV-STK-RWRD | Reward distribution uses cumulative reward_per_token with PRECISION=1e18 | Verified |
| INV-STK-ZERO | Zero-amount stake/unstake rejected | Verified |
| INV-STK-CP | Checkpoint on stake/unstake prevents flash-loan reward siphoning | Verified |

### Epoch/VRF Invariants
| ID | Invariant | Status |
|----|-----------|--------|
| INV-VRF-ONCE | Each randomness consumed exactly once (consumed flag + slot check) | Verified |
| INV-VRF-FRESH | Randomness slot must be within current epoch window | Verified |
| INV-EPOCH-SEQ | Epoch number strictly monotonic (epoch_number = previous + 1) | Verified |
| INV-CARN-LOCK | Carnage can only execute within [lock_slot, lock_slot + deadline] window | Verified |
| INV-CARN-ONCE | Carnage executes at most once per epoch (boolean flag) | Verified |

### Transfer Hook Invariants
| ID | Invariant | Status |
|----|-----------|--------|
| INV-WL-GATE | Every non-whitelisted transfer rejected | Verified |
| INV-WL-ADMIN | Only admin can modify whitelist | Verified |

---

## 7. Cross-Cutting Concerns (Deduplicated)

### 7.1 CRITICAL — Bounty Rent-Exempt Bug (KNOWN)

**Flagged by:** 6/9 agents (State Machine, Arithmetic, Timing, Economic, CPI, Upgrade/Admin)
**Location:** `epoch_program/trigger_epoch_transition`
**Issue:** Checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` but doesn't subtract rent-exempt minimum (~890,880 lamports). After transferring the bounty, the vault account can drop below the rent floor, causing the Solana runtime to reject the transaction.
**Status:** Known issue, documented in project TODO.

### 7.2 HIGH — `constraint = true` Placeholder Constraints

**Flagged by:** 4/9 agents (Access Control, CPI, Token Economic, Upgrade/Admin)
**Locations:** Multiple account validation structs across programs
**Issue:** Several account constraints use `constraint = true` as a placeholder. While currently not exploitable because other validation exists (PDA seeds, program ownership), they represent missing defense-in-depth. If surrounding validation changes, these become bypass vectors.
**Risk:** Medium currently, HIGH if any refactoring occurs.

### 7.3 HIGH — Mainnet Treasury/Mint Placeholders

**Flagged by:** 4/9 agents (Access Control, Token Economic, Upgrade/Admin, State Machine)
**Locations:** Tax program treasury address, mint initialization
**Issue:** Devnet placeholder addresses for treasury. The `update_treasury` admin instruction exists but represents a critical deployment step that must not be forgotten. Token mints also lack MetadataPointer extension.

### 7.4 HIGH — `force_carnage` Devnet Backdoor

**Flagged by:** 4/9 agents (Access Control, Upgrade/Admin, Oracle, Timing)
**Location:** `epoch_program/force_carnage`
**Issue:** Allows admin to trigger carnage outside the normal VRF flow. Intended for devnet testing only. Must be removed or feature-gated before mainnet. Currently requires admin signature.

### 7.5 MEDIUM — Integer Truncation Chains (`as u32` / `as u64`)

**Flagged by:** 3/9 agents (Arithmetic, Timing, Oracle)
**Locations:** VRF modulo operations, epoch slot calculations, pool reserve casts
**Issue:** Several `as u64` and `as u32` casts are unchecked. While current value ranges make overflow unlikely, these represent latent truncation bugs. Most critical: VRF byte-to-u64 conversion for tax rate computation.

### 7.6 MEDIUM — No Emergency Pause Mechanism

**Flagged by:** 3/9 agents (Access Control, Upgrade/Admin, State Machine)
**Issue:** No global circuit-breaker to freeze all operations in case of exploit detection. Programs are non-upgradeable, so a pause flag would need to be part of the existing state.

### 7.7 MEDIUM — No Admin Key Rotation

**Flagged by:** 2/9 agents (Access Control, Upgrade/Admin)
**Issue:** Admin authority is a single keypair with no rotation mechanism. If compromised, there's no recovery path. Multisig recommended for mainnet.

### 7.8 MEDIUM — Initialization Front-Running

**Flagged by:** 2/9 agents (Access Control, Upgrade/Admin)
**Locations:** Pool initialization, epoch initialization, staking pool initialization
**Issue:** `initialize_*` instructions can be front-run to claim admin authority. Mitigated by deploying in a single atomic-like transaction bundle, but not structurally enforced.

### 7.9 MEDIUM — Tax Rate Timing Gap

**Flagged by:** 2/9 agents (Timing, Economic)
**Location:** VRF reveal to consume_randomness
**Issue:** Between VRF reveal and consumption, the new tax rate is publicly visible but not yet applied. Sophisticated users could sandwich the rate change to trade at the old (lower) rate.

### 7.10 MEDIUM — PROFIT Routing Tax Arbitrage

**Flagged by:** 1/9 agents (Economic Model) — cross-validated
**Issue:** Users can route through PROFIT to effectively reduce taxation when combined with strategic timing. PROFIT routing reduces effective per-hop taxation compared to direct paths.

### 7.11 MEDIUM — Dust Swap Tax Bypass

**Flagged by:** 1/9 agents (Economic Model) — confirmed by Arithmetic
**Issue:** Tax calculation uses integer division. For sufficiently small swaps, `amount * tax_rate / 10000` rounds to zero, allowing zero-tax trades. Protocol-favoring floor rounding means dust amounts produce zero tax.

---

## 8. Risk Heat Map

```
                    LIKELIHOOD
              Low      Med      High
         +---------+---------+---------+
  HIGH   | Admin   | Bounty  |         |
IMPACT   | key     | rent    |         |
         | compro- | bug     |         |
         | mise    | (KNOWN) |         |
         +---------+---------+---------+
  MED    | Init    | Tax     | Dust    |
IMPACT   | front-  | timing  | tax     |
         | run     | gap     | bypass  |
         |         | PROFIT  |         |
         |         | routing |         |
         +---------+---------+---------+
  LOW    | VRF     | No      | constr- |
IMPACT   | modulo  | pause   | aint=   |
         | bias    | mech.   | true    |
         +---------+---------+---------+
```

### Subsystem Risk Ranking

| Rank | Subsystem | Risk Level | Reason |
|------|-----------|------------|--------|
| 1 | Epoch Program | HIGH | VRF complexity, bounty bug, force_carnage, max CPI depth |
| 2 | Tax Program | HIGH | User-facing entry point, tax calculation edge cases, treasury placeholder |
| 3 | AMM | MEDIUM | Constant-product math well-tested, but canonical ordering complexity |
| 4 | Staking | MEDIUM | Synthetix pattern is battle-tested, but u128 precision edge cases |
| 5 | Transfer Hook | LOW | Simple whitelist check, minimal state, read-only execution |

---

## 9. Novel Architectural Observations

These patterns are unique to this protocol and unlikely to have direct precedent in the exploit pattern database:

1. **Dual-Faction Token Economics:** Two competing tokens with VRF-driven redistribution is novel. Attack surface includes cross-faction arbitrage that doesn't exist in single-token protocols.

2. **Carnage as Market Maker:** The protocol itself acts as a market participant (buying, burning, selling tokens) rather than just facilitating trades. This creates a unique MEV surface where Carnage timing/direction is partially predictable from VRF state.

3. **4-Deep CPI Chain at Solana Limit:** The Carnage execution path (Epoch to Tax to AMM to Token-2022) is exactly at the 4-level CPI depth limit. This is architecturally fragile — any future nesting would break it.

4. **Transfer Hook as Universal Gate:** All three custom tokens use the same hook program for whitelist enforcement. A single whitelist misconfiguration could lock or unlock all three tokens simultaneously.

5. **Boolean State Machine for VRF:** The epoch VRF lifecycle uses individual boolean flags (`vrf_committed`, `vrf_revealed`, `randomness_consumed`) instead of an enum. While currently guarded, this permits theoretically impossible states (e.g., consumed but not revealed).

6. **Slot-Only Timing with No Timestamps:** The protocol correctly uses slot numbers exclusively (never `Clock::unix_timestamp`), which is best practice but means all timing windows are validator-dependent.

7. **Protocol-Owned Liquidity with No LP Tokens:** AMM pools have no LP token mechanism — liquidity is admin-seeded and protocol-owned. This eliminates LP extraction attacks but creates dependency on admin for liquidity management.

8. **PROFIT as Cross-Faction Bridge:** PROFIT is the only token that can be exchanged for either faction, creating a routing graph that doesn't exist in typical AMM protocols.

---

## 10. Consolidated Findings Summary

### By Severity (Deduplicated)

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 1 | Bounty rent-exempt bug (KNOWN) |
| HIGH | 4 | constraint=true, mainnet placeholders, force_carnage, init front-running |
| MEDIUM | 7 | Integer truncation, no pause, no key rotation, tax timing gap, PROFIT routing, dust bypass, hardcoded byte offsets |
| LOW | 12 | Single VRF oracle, VRF timeout window, no defense-in-depth on staking transfer, modulo bias, boolean state machine, lock_slot bypass, various info items |
| INFO | ~20 | Architectural observations, style notes, documentation gaps |

### By Subsystem

| Subsystem | CRIT | HIGH | MED | LOW | INFO |
|-----------|------|------|-----|-----|------|
| Epoch | 1 | 1 | 2 | 3 | 4 |
| Tax | 0 | 2 | 3 | 2 | 3 |
| AMM | 0 | 1 | 1 | 2 | 4 |
| Staking | 0 | 0 | 1 | 2 | 3 |
| Hook | 0 | 0 | 0 | 3 | 6 |

---

## 11. Key Attack Surfaces for Strategy Generation

Based on the architecture synthesis, the following attack surfaces warrant deep investigation:

1. **Epoch/VRF Lifecycle** — Complex state machine at max CPI depth with known bounty bug
2. **Tax Calculation Edge Cases** — Integer rounding, dust bypass, rate timing gap
3. **Carnage Execution** — Protocol as market participant, slippage protection, dual-pool interactions
4. **Cross-Faction Routing** — PROFIT bridge enables arbitrage paths not possible in simple AMM
5. **Canonical Mint Ordering** — `is_reversed` detection correctness under all pool configurations
6. **Whitelist Completeness** — Any path that moves tokens without passing through the hook
7. **PDA Authority Chain Confusion** — Wrong program deriving authority for cross-program calls
8. **Staking Reward Precision** — u128 arithmetic at PRECISION=1e18 boundary conditions
9. **Admin Capability Scope Creep** — Treasury update + whitelist + force_carnage combined power
10. **Token-2022 Extension Interactions** — Transfer hook + non-transferable edge cases

---

*This document synthesizes findings from 9 parallel context analyses totaling ~312KB of output. All invariants have been cross-verified across analyzing agents. Findings are deduplicated — each unique issue appears once at its highest assessed severity.*
