---
doc_id: architecture
title: "Dr. Fraudsworth's Finance Factory — System Architecture"
wave: 1
requires: []
provides: [architecture]
status: draft
decisions_referenced: [architecture, cpi-architecture, amm-design, security, frontend, operations, token-model, account-structure, error-handling]
needs_verification: [mainnet-priority-fee-vs-bounty-economics, carnage-fallback-front-running-frequency]
---

# Dr. Fraudsworth's Finance Factory — System Architecture

## System Overview

Dr. Fraudsworth's Finance Factory is a Solana DeFi protocol built from seven on-chain Anchor/Rust programs (~32K LOC total) composed via Cross-Program Invocation (CPI), a Next.js 16 frontend (~32.3K LOC), and supporting off-chain infrastructure. The protocol implements asymmetric taxation, VRF-driven epoch transitions, Carnage buyback-and-burn events, PROFIT staking for real SOL game rewards, and a dual bonding curve launch system -- all without emissions or ponzinomics.

The system's defining architectural trait is its **CPI composition depth**. Every user swap traverses a 4-level CPI chain (Tax -> AMM -> Token-2022 -> Transfer Hook), which is the Solana runtime maximum. This depth ceiling is permanent and fully consumed -- no additional CPI calls can ever be added to any swap path.

After a tiered timelock stabilization period (2hr -> 24hr -> burn), all seven program upgrade authorities will be permanently burned via Squads multisig (2-of-3). Post-burn, the protocol is immutable, autonomous, and unkillable. There is no pause mechanism, no governance, and no admin intervention path.

**Key numbers:**
- 7 on-chain programs, 23 unique CPI call sites
- 3 tokens (CRIME, FRAUD, PROFIT) on Token-2022, plus WSOL on SPL Token
- 2 permanent, protocol-owned AMM pools (CRIME/SOL, FRAUD/SOL) plus 1 conversion vault (no LP tokens, no withdrawal)
- Dual bonding curve launch system (1 program, 2 curve instances) for initial token distribution
- 24+ PDA types (20 singleton, 4+ per-instance), 11 custom state structs
- 4 cross-program PDA gates (SwapAuthority, TaxAuthority, StakingAuthority, CarnageSigner)
- 120+ error variants across 7 programs (incl. stub)

## Architecture Diagram

```
                         ┌─────────────────────────────────────────────────────────────┐
                         │                    OFF-CHAIN LAYER                          │
                         │                                                             │
                         │  ┌──────────────────┐    ┌──────────────────┐               │
                         │  │  Next.js 16 App   │    │   Crank Bot      │               │
                         │  │  (Railway)         │    │   (Same Instance) │              │
                         │  │                    │    │                  │               │
                         │  │ - Steampunk Scene  │    │ - VRF Epoch TX   │               │
                         │  │ - Swap/Stake UI    │    │ - Carnage Exec   │               │
                         │  │ - SSE Price Feed   │    │ - Staking Update  │              │
                         │  │ - Webhook Ingest   │    │ - Permissionless  │              │
                         │  └────────┬───────────┘    └────────┬─────────┘              │
                         │           │                          │                        │
                         │  ┌────────┴──────────────────────────┴─────────┐              │
                         │  │              Helius RPC / Webhooks           │             │
                         │  │  (Single plan: RPC, DAS, Webhooks, WS)      │             │
                         │  └────────┬──────────────────────────┬─────────┘              │
                         │           │                          │                        │
                         │  ┌────────┴─────┐  ┌────────────────┴───────┐                │
                         │  │ PostgreSQL   │  │ Sentry (Zero-dep)      │                │
                         │  │ (Drizzle ORM)│  │ Errors + Crons         │                │
                         │  │ swap_events  │  │ Heartbeat              │                │
                         │  │ candles      │  └────────────────────────┘                │
                         │  │ epoch_events │                                            │
                         │  │ carnage_evts │                                            │
                         │  └──────────────┘                                            │
                         └───────────────────────────┬─────────────────────────────────┘
                                                     │
                              Solana Devnet / Mainnet │ (RPC + TX submission)
                         ┌───────────────────────────┴─────────────────────────────────┐
                         │                     ON-CHAIN LAYER                           │
                         │                                                              │
                         │  User TX                                                     │
                         │    │                                                         │
                         │    ▼                                                         │
                         │  ┌─────────────────────────────────────────────┐             │
                         │  │          TAX PROGRAM (43fZGR...)            │ ◄── DEPTH 0 │
                         │  │  "Orchestrator" — 14 CPI calls             │             │
                         │  │                                             │             │
                         │  │  swap_sol_buy    swap_sol_sell              │             │
                         │  │  swap_exempt (Carnage-only)                 │             │
                         │  │  initialize_wsol_intermediary               │             │
                         │  │                                             │             │
                         │  │  Reads: EpochState (tax rates)              │             │
                         │  │  Writes: SOL distribution (71/24/5)            │             │
                         │  │  State: NONE (stateless orchestrator)       │             │
                         │  └──┬────────────┬──────────────┬──────────────┘             │
                         │     │            │              │                             │
                         │     │ CPI        │ CPI          │ CPI                        │
                         │     │ swap       │ deposit_     │ system_program              │
                         │     │            │ rewards      │ ::transfer                  │
                         │     ▼            ▼              │ (SOL distribution)          │
                         │  ┌──────────┐ ┌──────────────┐  │                             │
                         │  │   AMM    │ │   STAKING    │  │                             │
                         │  │(5JsSA..)│ │  (12b3t..)   │  │                             │
                         │  │ DEPTH 1  │ │              │  │                             │
                         │  │          │ │ deposit_     │  │                             │
                         │  │ swap_sol │ │  rewards     │  │                             │
                         │  │          │ │ update_      │  │                             │
                         │  │ Pool     │ │  cumulative  │  │                             │
                         │  │ State ×2 │ │ stake/       │  │                             │
                         │  │          │ │  unstake/    │  │                             │
                         │  │ k=x*y    │ │  claim       │  │                             │
                         │  │ locked   │ │              │  │                             │
                         │  │          │ │ StakePool    │  │                             │
                         │  │          │ │ UserStake ×N │  │                             │
                         │  └──┬───────┘ └──────────────┘  │                             │
                         │     │                            │                             │
                         │     │ CPI transfer_checked       │                             │
                         │     ▼                            │                             │
                         │  ┌──────────────────────┐        │                             │
                         │  │  TOKEN-2022 (Solana)  │ DEPTH 2                             │
                         │  │  spl_token_2022       │                                    │
                         │  │                       │        ┌──────────────────────┐     │
                         │  │  CRIME mint (cRiM..)  │        │  SWITCHBOARD VRF     │     │
                         │  │  FRAUD mint (FraU..)  │        │  (On-Demand)         │     │
                         │  │  PROFIT mint (pRoF..) │        │                      │     │
                         │  │                       │        │  commit + reveal     │     │
                         │  │  + SPL Token (WSOL)   │        │  randomness accounts │     │
                         │  └──┬────────────────────┘        └──────────┬───────────┘     │
                         │     │                                        │                 │
                         │     │ Hook callback                          │ Read VRF bytes   │
                         │     ▼                                        ▼                 │
                         │  ┌──────────────────────┐  ┌──────────────────────────┐        │
                         │  │  TRANSFER HOOK       │  │   EPOCH PROGRAM          │        │
                         │  │  (CmNy..) DEPTH 3    │  │   (G6dm..)               │        │
                         │  │                      │  │                          │        │
                         │  │  Terminal node:       │  │  trigger_epoch_          │        │
                         │  │  ZERO outbound CPIs   │  │   transition            │        │
                         │  │                      │  │  consume_randomness      │        │
                         │  │  Whitelist check:     │  │  retry_epoch_vrf        │        │
                         │  │  src OR dst must be   │  │  execute_carnage_       │        │
                         │  │  whitelisted          │  │   atomic                │        │
                         │  │                      │  │  execute_carnage         │        │
                         │  │  WhitelistAuthority   │  │  expire_carnage         │        │
                         │  │  WhitelistEntry ×14   │  │  initialize_*           │        │
                         │  │  ExtraAccountMeta ×3  │  │  force_carnage (devnet) │        │
                         │  │                      │  │                          │        │
                         │  │  Blocks invalid       │  │  EpochState (singleton) │        │
                         │  │  transfers with       │  │  CarnageFundState       │        │
                         │  │  atomic revert        │  │  Carnage vaults (SOL,   │        │
                         │  └──────────────────────┘  │   CRIME, FRAUD)          │        │
                         │                             │                          │        │
                         │                             │  CPI → Tax::swap_exempt  │        │
                         │                             │  CPI → Staking::         │        │
                         │                             │   update_cumulative      │        │
                         │                             └──────────────────────────┘        │
                         │                                                                │
                         └────────────────────────────────────────────────────────────────┘

  LEGEND:
    ──────►  CPI call direction
    DEPTH N  CPI depth level (Solana max = 4)
    ×N       Per-instance accounts (N instances)
```

### CPI Call Graph (Directed Acyclic)

```
  ┌──────────────┐
  │ EPOCH PROGRAM │
  └──┬─────┬──────┘
     │     │
     │     │  CPI: swap_exempt (Carnage buys/sells)
     │     ▼
     │  ┌─────────────┐     CPI: swap_sol_pool
     │  │ TAX PROGRAM  │────────────────────────────────────────────┐
     │  └──┬───────────┘                                           │
     │     │                                                        ▼
     │     │  CPI: deposit_rewards                            ┌──────────┐
     │     ▼                                                   │   AMM    │
     │  ┌──────────────┐                                       └──┬───────┘
     │  │   STAKING    │                                          │
     │  └──────────────┘                                          │
     │                                CPI: transfer_checked       │
     │  CPI: update_cumulative                                    ▼
     └──────────────────────────────────────────────────┐  ┌──────────────┐
                                                         │  │  TOKEN-2022  │
                                                         │  └──┬───────────┘
                                                         │     │
                                                         │     │  Hook callback
                                                         │     ▼
                                                         │  ┌──────────────────┐
                                                         │  │  TRANSFER HOOK   │
                                                         │  │  (terminal node) │
                                                         │  └──────────────────┘
                                                         │
                                                         └──► STAKING
                                                              (update_cumulative)
```

**Acyclic guarantee:** Transfer Hook makes zero outbound CPIs (terminal). Token-2022 only calls Hook. AMM only calls Token-2022. Tax calls AMM + System + Staking::deposit_rewards. Epoch calls Tax::swap_exempt + Staking::update_cumulative. No downstream program ever CPIs back upstream. Reentrancy is structurally impossible.

**Note:** The Conversion Vault and Bonding Curve programs are leaf nodes (call Token-2022 `transfer_checked` only, receive no CPIs from other protocol programs) and do not appear in the CPI graph.

For safe upgrade ordering and CPI dependency analysis, see [upgrade-cascade.md](upgrade-cascade.md).

## Components

### 1. AMM Program (amm)
**Program ID (Mainnet):** `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR`
**Role:** Pure constant-product swap primitive (k = x * y). Tax-agnostic -- contains zero knowledge of epochs, taxes, Carnage, or rewards. Manages two protocol-owned SOL liquidity pools (CRIME/SOL, FRAUD/SOL) with PDA-owned vaults. Previously managed four pools including CRIME/PROFIT and FRAUD/PROFIT, now replaced by the Conversion Vault.
**Technology:** Anchor/Rust. Fork of `arrayappy/solana-uniswap-v2` (Apache-2.0), heavily modified: stripped LP tokens, flash loans, TWAP, router, governance; added Token-2022 + hook support, dual-hook pattern, PDA access control, reentrancy guard, AdminConfig, PoolType enum, property-tested math.
**State:** AdminConfig (singleton), PoolState (x2 instances), Vault token accounts (x4)
**Instructions:** `initialize_admin`, `burn_admin`, `initialize_pool`, `swap_sol_pool`
**Communicates with:** Token-2022 (transfer_checked CPI for token transfers), Transfer Hook (invoked by Token-2022 during transfers)
**LOC:** ~1,200 (including tests)

### 2. Tax Program (tax_program)
**Program ID (Mainnet):** `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj`
**Role:** Swap orchestrator. All user-facing swap entry points live here. Reads current tax rates from EpochState, calculates tax, distributes SOL three ways (71% staking escrow, 24% Carnage fund, 5% treasury), then CPIs into AMM for the actual swap execution. Enforces a 50% minimum output floor (MINIMUM_OUTPUT_FLOOR_BPS = 5000) as protocol-level slippage protection.
**Technology:** Anchor/Rust. Stateless orchestrator -- stores no state of its own. Reads EpochState cross-program for current tax rates.
**State:** None (reads EpochState from Epoch Program). Owns a WSOL Intermediary PDA for sell-path wrapping.
**Instructions:** `swap_sol_buy`, `swap_sol_sell`, `swap_exempt`, `initialize_wsol_intermediary` (previously included `swap_profit_buy`, `swap_profit_sell` -- now replaced by Conversion Vault)
**Communicates with:** AMM (swap CPI), Staking (deposit_rewards CPI for 71% rewards portion), System Program (SOL transfers for tax distribution), Epoch Program (reads EpochState for tax rates)
**Key design:** Tax is the protocol's entry point for all trades. The AMM is only callable by Tax (PDA-gated via SwapAuthority). `swap_exempt` is restricted to Carnage signer PDA -- no other caller can perform tax-free swaps.

### 3. Epoch Program (epoch_program)
**Program ID (Mainnet):** `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2`
**Role:** VRF-driven epoch state machine and Carnage Fund executor. Manages 30-minute epoch transitions via Switchboard on-demand VRF, determines tax rate randomization (75% flip probability, 1-4% low / 11-14% high), triggers Carnage buyback-and-burn events (~4.3% probability per epoch, ~2/day average), and finalizes staking rewards. When Carnage triggers: 98% Burn path, 2% Sell path (VRF byte 6 < `CARNAGE_SELL_THRESHOLD` (5) = Sell, else Burn). Target token is 50/50 CRIME/FRAUD (VRF byte 7).
**Technology:** Anchor/Rust. Integrates Switchboard on-demand VRF via a 3-transaction flow: (1) create randomness account, (2) commit + trigger_epoch_transition, (3) reveal + consume_randomness. Timeout recovery via retry_epoch_vrf after 300 slots (~2 min).
**State:** EpochState (172 bytes, singleton -- timing, tax config, VRF state, Carnage state, 64-byte reserved padding for future schema evolution [Phase 80 DEF-03]), CarnageFundState (147 bytes, singleton -- vaults, holdings, lifetime stats), Carnage SOL/CRIME/FRAUD vaults
**Instructions:** `initialize_epoch_state`, `trigger_epoch_transition`, `consume_randomness`, `retry_epoch_vrf`, `initialize_carnage_fund`, `execute_carnage_atomic`, `execute_carnage`, `expire_carnage`, `force_carnage` (devnet-only, feature-gated)
**Communicates with:** Tax Program (swap_exempt CPI for Carnage buys/sells), Staking (update_cumulative CPI to finalize epoch rewards), Switchboard VRF (reads randomness accounts), Token-2022 (burn CPI for Carnage token destruction), System Program (SOL transfers for crank bounties)

### 4. Staking Program (staking)
**Program ID (Mainnet):** `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH`
**Role:** PROFIT token staking for SOL game rewards. Users stake PROFIT to earn pro-rata share of the 71% tax revenue portion. Uses the Synthetix/Quarry cumulative reward-per-token pattern. 12-hour cooldown after claiming before unstake is allowed (users who have never claimed can unstake immediately). Unstaking forfeits pending rewards to remaining stakers. Separate claim instruction, flash-loan resistant (stake/unstake same epoch = zero rewards).
**Technology:** Anchor/Rust. Dead stake of 1 PROFIT (MINIMUM_STAKE) at initialization prevents first-depositor attack. Rewards use u128 precision with 1e18 scaling.
**State:** StakePool (62 bytes, singleton -- total_staked, rewards_per_token_stored, pending_rewards), UserStake (per-user, persists forever even at zero balance), EscrowVault (SOL PDA for reward claims), StakeVault (PROFIT PDA for staked tokens)
**Instructions:** `initialize_stake_pool`, `stake`, `unstake`, `claim`, `deposit_rewards` (Tax CPI-gated), `update_cumulative` (Epoch CPI-gated)
**Communicates with:** Token-2022 (transfer_checked for PROFIT stake/unstake via manual hook helper), System Program (SOL transfers for reward claims). Receives CPIs from Tax (deposit_rewards) and Epoch (update_cumulative).

### 5. Transfer Hook Program (transfer_hook)
**Program ID (Mainnet):** `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd`
**Role:** Token transfer gatekeeper. Validates that every CRIME, FRAUD, and PROFIT transfer has at least one whitelisted party (source or destination). Blocks direct wallet-to-wallet transfers -- all trading must go through AMM pools. Terminal CPI node (makes zero outbound CPIs).
**Technology:** Anchor/Rust. Implements SPL Transfer Hook Interface (spl_transfer_hook_interface). Uses ExtraAccountMetaList PDA pattern for Token-2022 integration. 14 whitelisted addresses (all protocol-controlled PDAs/vaults).
**State:** WhitelistAuthority (singleton, burned post-setup), WhitelistEntry (x14 per-address), ExtraAccountMetaList (x3 per-mint)
**Instructions:** `initialize_authority`, `add_whitelist_entry`, `burn_authority`, `initialize_extra_account_meta_list`, `transfer_hook` (callback from Token-2022)
**Communicates with:** None outbound. Invoked by Token-2022 during `transfer_checked` calls. 4 extra accounts per mint passed as remaining_accounts: ExtraAccountMetaList PDA, whitelist_source PDA, whitelist_destination PDA, hook program ID.

### 6. Conversion Vault Program (conversion_vault)
**Program ID (Mainnet):** `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ`
**Role:** Fixed-rate token conversion between CRIME/FRAUD and PROFIT at a deterministic 100:1 ratio. Replaces the previous PROFIT AMM pools. Zero slippage, zero fees, no bonding curve. Users convert faction tokens (CRIME or FRAUD) to PROFIT for staking, or convert PROFIT back to faction tokens.
**Technology:** Anchor/Rust. Leaf node -- calls Token-2022 `transfer_checked` only, receives no CPIs from other protocol programs. One-shot initialization (no admin key stored). Hardcoded mints (feature-gated for devnet/mainnet).
**State:** VaultConfig (singleton -- conversion_rate, bump), Vault token accounts (x3: vault_crime, vault_fraud, vault_profit)
**Instructions:** `initialize`, `convert`
**Communicates with:** Token-2022 (transfer_checked CPI for token transfers). Transfer Hook invoked by Token-2022 during transfers. No inbound CPIs from other protocol programs.
**Security properties:** No admin key, one-shot initialization, PDA-derived token accounts, hardcoded mints, Squads upgrade authority (pre-burn).

### 7. Bonding Curve Program (bonding_curve)
**Program ID (Mainnet):** `DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV` (closed post-graduation)
**Role:** Dual linear bonding curve launch system for initial CRIME and FRAUD token distribution. Each curve sells 460M tokens (46% of supply) along a linear price path from 0.00000045 SOL/token to 0.000001725 SOL/token, raising 500 SOL per token. Supports sell-back with 15% tax escrow, per-wallet cap of 20M tokens via ATA balance reads, 48-hour deadline, and atomic dual-curve graduation (both curves must fill for pool seeding to proceed). Added in v1.2.
**Technology:** Anchor/Rust. Quadratic closed-form solver for linear integral pricing. Compile-time assertions validate P_END > P_START and u128/u64 supply consistency (Phase 81 CTG-03). BcAdminConfig PDA gates all admin instructions with ProgramData upgrade authority validation (Phase 78). Remaining_accounts count validated as exactly 4 for Transfer Hook CPI (Phase 80 DEF-05). Partial fill assertion prevents overcharge (Phase 79 FIN-04). Partner_mint stored in CurveState for cross-curve validation (Phase 79 FIN-05).
**State:** BcAdminConfig (singleton -- authority PDA for admin gating), CurveState (x2 instances -- per-token curve state, 232 bytes), Token vaults (x2), SOL vaults (x2), Tax escrow PDAs (x2, 0-byte SOL-only)
**Instructions:** `initialize_bc_admin`, `burn_bc_admin`, `initialize_curve`, `fund_curve`, `start_curve`, `purchase`, `sell`, `mark_failed`, `consolidate_for_refund`, `claim_refund`, `prepare_transition`, `finalize_transition`, `distribute_tax_escrow`, `withdraw_graduated_sol`, `close_token_vault`
**Communicates with:** Token-2022 (transfer_checked for token distribution, burn for refunds). Transfer Hook invoked by Token-2022 during transfers. No CPI to other protocol programs -- leaf node like Conversion Vault.
**Security properties:** BcAdminConfig PDA with ProgramData validation (Phase 78), partner_mint validation prevents cross-curve attacks (Phase 79), escrow_consolidated flag prevents premature refunds, compile-time const assertions (Phase 81).

### 8. Frontend Application
**Role:** Single interactive steampunk factory scene (Next.js 16). Users click illustrated elements (control panel, bubbling tube, cauldron, etc.) to open modal interfaces for swapping, staking, viewing Carnage, and settings. Desktop-first.
**Technology:** Next.js 16 with Turbopack, React hooks (no Redux/Zustand), Solana wallet-adapter (Phantom/Backpack/Solflare), Helius RPC (WebSocket for prices, polling for state), PostgreSQL via Drizzle ORM, zero-dependency Sentry integration.
**Key components:**
- 7 clickable hotspots mapping to 6 modals (Swap/Chart combined)
- Trading terminal: candlestick chart + swap interface + epoch tax display
- Staking modal: stake/unstake/claim with APY display
- Carnage modal: view-only (fund balance, burn totals, recent events)
- API routes: `/api/candles`, `/api/health`, `/api/sse`, `/api/webhooks`
- Database tables: swap_events, candles, epoch_events, carnage_events
**Communicates with:** Solana via Helius RPC, Switchboard SDK (VRF for crank), PostgreSQL (event indexing), Sentry (error/uptime monitoring)

### 9. Crank Bot (Overnight Runner)
**Role:** Permissionless off-chain process that drives epoch transitions, VRF flows, Carnage execution, and staking reward finalization. No on-chain privileges -- any wallet can perform these operations.
**Technology:** TypeScript (overnight-runner.ts), runs as background process on same Railway instance as frontend. Built-in per-epoch try/catch, graceful shutdown (SIGINT/SIGTERM), Sentry Crons heartbeat.
**Operations per epoch:**
1. Create Switchboard randomness account (TX 1)
2. Bundle commitIx + trigger_epoch_transition (TX 2)
3. Bundle revealIx + consume_randomness (TX 3)
4. If Carnage triggered: execute_carnage_atomic (TX 3 or TX 4)
5. update_cumulative (finalize staking rewards)
**Communicates with:** Solana via Helius RPC, Switchboard SDK, Sentry

### 10. Docs Site
**Role:** Separate Nextra 4 documentation site with 16 content pages covering protocol overview, gameplay mechanics, earning guide, security model, and reference material. Pagefind search.
**Technology:** Nextra 4 + Next.js 15, deployed separately (Vercel).
**Communicates with:** Static content, no runtime dependencies.

## Communication Patterns

### Cross-Program CPI Calls

| From | To | Instruction | PDA Gate | Direction/Purpose | CPI Depth |
|------|----|-------------|----------|-------------------|-----------|
| Tax | AMM | `swap_sol_pool` | SwapAuthority (Tax seeds, validated by AMM) | Taxed SOL pool swaps | 0 -> 1 |
| Tax | Staking | `deposit_rewards` | TaxAuthority (Tax seeds, validated by Staking) | 71% tax SOL to escrow | 0 -> 1 |
| Tax | System | `transfer` | N/A (system) | SOL: 24% Carnage, 5% treasury | 0 -> 1 |
| AMM | Token-2022 | `transfer_checked` | Pool PDA signer | Token transfers in/out of vaults | 1 -> 2 |
| AMM | SPL Token | `transfer_checked` | Pool PDA signer | WSOL transfers (SOL pools) | 1 -> 2 |
| Token-2022 | Transfer Hook | `transfer_hook` | N/A (runtime callback) | Whitelist validation | 2 -> 3 |
| Epoch | Tax | `swap_exempt` | CarnageSigner (Epoch seeds, validated by Tax) | Carnage tax-free swaps | 0 -> 1 |
| Epoch | Staking | `update_cumulative` | StakingAuthority (Epoch seeds, validated by Staking) | Finalize epoch rewards | 0 -> 1 |
| Epoch | Token-2022 | `burn` | Carnage vault PDA signer | Carnage token destruction | 0 -> 1 |
| Epoch | System | `transfer` | Carnage SOL vault signer | Crank bounty (0.001 SOL) | 0 -> 1 |
| Staking | Token-2022 | `transfer_checked` | StakeVault/StakePool PDA signer | PROFIT stake/unstake | 0 -> 1 |
| Staking | System | `transfer` | EscrowVault PDA signer | SOL reward claims | 0 -> 1 |

### Full Swap CPI Depth Chains

```
USER SWAP (Buy SOL -> Token):
  Depth 0: Tax::swap_sol_buy
  Depth 1: AMM::swap_sol_pool
  Depth 2: Token-2022::transfer_checked (token output to user)
  Depth 3: TransferHook::transfer_hook (whitelist validation)
  ── DEPTH 4 REACHED (Solana max) ──

USER SWAP (Sell Token -> SOL):
  Depth 0: Tax::swap_sol_sell
  Depth 1: AMM::swap_sol_pool
  Depth 2: Token-2022::transfer_checked (token input from user)
  Depth 3: TransferHook::transfer_hook (whitelist validation)
  ── DEPTH 4 REACHED ──

CARNAGE SWAP:
  Depth 0: Epoch::execute_carnage_atomic
    (SOL wrapping at depth 0 BEFORE entering swap chain)
  Depth 1: Tax::swap_exempt
  Depth 2: AMM::swap_sol_pool
  Depth 3: Token-2022::transfer_checked
  Depth 4: TransferHook::transfer_hook
  ── DEPTH 4 REACHED ──

VAULT CONVERSION (no CPI depth -- direct user call):
  Depth 0: Vault::convert
  Depth 1: Token-2022::transfer_checked (input: CRIME/FRAUD to vault)
  Depth 2: TransferHook::transfer_hook (whitelist validation)
  Depth 1: Token-2022::transfer_checked (output: PROFIT from vault)
  Depth 2: TransferHook::transfer_hook (whitelist validation)
  ── MAX DEPTH 2 (leaf node, no CPI chain) ──

(Historical: Previously used PROFIT POOL SWAP paths via Tax::swap_profit_buy/sell -> AMM::swap_profit_pool, now replaced by conversion vault)
```

### PDA-Gated Access Control

| PDA Name | Seeds | Derived From (Program) | Validated By (Program) | Purpose |
|----------|-------|------------------------|------------------------|---------|
| SwapAuthority | `["swap_authority"]` | Tax Program | AMM | Only Tax can invoke AMM swaps |
| CarnageSigner | `["carnage_signer"]` | Epoch Program | Tax Program | Only Epoch can invoke swap_exempt |
| TaxAuthority | `["tax_authority"]` | Tax Program | Staking | Only Tax can deposit staking rewards |
| StakingAuthority | `["staking_authority"]` | Epoch Program | Staking | Only Epoch can finalize epoch rewards |

Each gate uses Anchor's `seeds::program` constraint. Only the owning program can produce a valid PDA signature for its seeds -- cryptographically enforced by ed25519.

### Off-Chain Communication

| From | To | Protocol | Pattern | Purpose |
|------|----|----------|---------|---------|
| Frontend | Helius | HTTPS/WSS | RPC calls + WebSocket subscriptions | Read chain state, submit TX |
| Frontend | PostgreSQL | TCP | Drizzle ORM queries | Read indexed events, candle data |
| Frontend | Sentry | HTTPS POST | Raw envelope (no SDK) | Error reporting |
| Crank Bot | Helius | HTTPS | RPC calls | Submit epoch/Carnage/staking TX |
| Crank Bot | Switchboard | HTTPS | SDK (create/commit/reveal) | VRF randomness flow |
| Crank Bot | Sentry | HTTPS POST | Crons check-in + errors | Heartbeat monitoring |
| Helius | Frontend | HTTPS POST | Webhook push | Swap/Carnage event indexing |
| Frontend | Jupiter Price API | HTTPS | REST API | SOL/USD price feed |

## Data Flow

### Flow 1: SOL Buy Swap (User buys CRIME with SOL)

```
User Wallet                Tax Program              AMM                Token-2022        Hook
    │                          │                      │                    │               │
    │  swap_sol_buy(amount,    │                      │                    │               │
    │   min_output, is_crime)  │                      │                    │               │
    │─────────────────────────►│                      │                    │               │
    │                          │                      │                    │               │
    │                          │ 1. Read EpochState   │                    │               │
    │                          │    (tax rates)       │                    │               │
    │                          │                      │                    │               │
    │                          │ 2. Calculate tax:    │                    │               │
    │                          │    tax = amount *    │                    │               │
    │                          │    crime_buy_tax_bps │                    │               │
    │                          │    / 10000           │                    │               │
    │                          │                      │                    │               │
    │                          │ 3. Distribute tax:   │                    │               │
    │                          │    71% → Staking     │                    │               │
    │                          │     (deposit_rewards)│                    │               │
    │                          │    24% → Carnage     │                    │               │
    │                          │     (sys transfer)   │                    │               │
    │                          │    5% → Treasury     │                    │               │
    │                          │     (sys transfer)   │                    │               │
    │                          │                      │                    │               │
    │                          │ 4. Check 50% output  │                    │               │
    │                          │    floor (slippage   │                    │               │
    │                          │    protection)       │                    │               │
    │                          │                      │                    │               │
    │                          │ 5. CPI: swap_sol_pool│                    │               │
    │                          │────────────────────►│                    │               │
    │                          │                      │ 6. Deduct LP fee  │               │
    │                          │                      │    (100 bps)      │               │
    │                          │                      │ 7. Calculate      │               │
    │                          │                      │    output via     │               │
    │                          │                      │    k = x * y      │               │
    │                          │                      │ 8. Verify         │               │
    │                          │                      │    k_after >=     │               │
    │                          │                      │    k_before       │               │
    │                          │                      │                    │               │
    │                          │                      │ 9. Transfer SOL in │               │
    │                          │                      │    (SPL Token)     │               │
    │                          │                      │                    │               │
    │                          │                      │ 10. Transfer token │               │
    │                          │                      │     out (T22)      │               │
    │                          │                      │────────────────►│               │
    │                          │                      │                    │ 11. Hook      │
    │                          │                      │                    │  callback     │
    │                          │                      │                    │──────────────►│
    │                          │                      │                    │               │
    │                          │                      │                    │ 12. Check     │
    │                          │                      │                    │  whitelist:   │
    │                          │                      │                    │  vault OR     │
    │                          │                      │                    │  user must    │
    │                          │                      │                    │  be listed    │
    │                          │                      │                    │◄──────────────│
    │                          │                      │                    │               │
    │                          │                      │ 13. Update reserves│               │
    │                          │                      │ 14. Emit SwapEvent │               │
    │◄─────────────────────────┼──────────────────────│                    │               │
    │  Tokens received                                                                    │
```

### Flow 2: SOL Sell Swap (User sells CRIME for SOL)

1. User calls `Tax::swap_sol_sell(amount_in, minimum_output, is_crime=true)`
2. Tax reads EpochState for `crime_sell_tax_bps`
3. Tax CPIs `AMM::swap_sol_pool` with full token amount (BtoA direction)
4. AMM deducts 100 bps LP fee, calculates SOL output via constant-product
5. AMM transfers CRIME from user to vault via Token-2022 (triggers Hook whitelist check)
6. AMM transfers WSOL from vault to Tax's WSOL Intermediary via SPL Token (no hook -- WSOL is SPL Token)
7. Tax calculates tax on the gross SOL output: `tax = gross_output * sell_tax_bps / 10000`
8. Tax distributes tax: 71% Staking (deposit_rewards CPI), 24% Carnage (system transfer), 5% treasury
9. Tax transfers net SOL (gross - tax) to user
10. Tax enforces `minimum_output` check against the net amount
11. **Sell path requires ALT + v0 VersionedTransaction** (23 named + 8 remaining accounts exceeds 1232-byte TX limit)

### Flow 3: Carnage Execution (Atomic Path)

1. Crank bot detects Carnage triggered during `consume_randomness` (VRF bytes -> ~4.3% probability)
2. EpochState is updated: `carnage_pending = true`, target token set, action determined (BuyOnly, Burn, or Sell)
3. Crank bundles `execute_carnage_atomic` in same TX as consume_randomness (MEV protection -- zero front-running window)
4. **If holdings exist and action = Burn:**
   - Epoch burns held tokens via Token-2022::burn (does NOT trigger transfer hooks)
   - Epoch wraps SOL at depth 0 (system_program::transfer + sync_native) BEFORE swap chain
   - Epoch CPIs Tax::swap_exempt -> AMM::swap_sol_pool -> Token-2022 -> Hook (depth 4)
   - Target tokens purchased and stored in Carnage vault
5. **If holdings exist and action = Sell:**
   - Epoch CPIs Tax::swap_exempt (sell held tokens for SOL)
   - SOL proceeds combined with existing Carnage SOL
   - Epoch CPIs Tax::swap_exempt (buy target tokens with combined SOL)
   - Both sell and buy paths hit depth 4
6. **If no holdings (BuyOnly):**
   - Epoch wraps SOL at depth 0
   - Single Tax::swap_exempt CPI to buy target tokens
7. Swap amount capped at MAX_CARNAGE_SWAP_LAMPORTS (1000 SOL)
8. CarnageFundState updated: lifetime counters incremented, holdings cleared/set
9. CarnageExecuted event emitted

### Flow 4: VRF Epoch Transition

```
Crank Bot          Switchboard        Epoch Program      Tax/AMM/Staking
    │                  │                    │                    │
    │ 1. Create        │                    │                    │
    │  randomness acct │                    │                    │
    │─────────────────►│                    │                    │
    │                  │                    │                    │
    │ 2. Bundle:       │                    │                    │
    │  commitIx +      │                    │                    │
    │  trigger_epoch   │                    │                    │
    │─────────────────►│                    │                    │
    │                  │                    │                    │
    │                  │ 3. Validate epoch  │                    │
    │                  │  boundary reached  │                    │
    │                  │  (30 min / 750     │                    │
    │                  │   devnet slots)    │                    │
    │                  │                    │                    │
    │                  │ 4. Bind randomness │                    │
    │                  │  account (anti-    │                    │
    │                  │  reroll)           │                    │
    │                  │                    │                    │
    │                  │ 5. Pay 0.001 SOL   │                    │
    │                  │  bounty to crank   │                    │
    │                  │                    │                    │
    │ (wait ~3 slots   │                    │                    │
    │  for oracle      │                    │                    │
    │  reveal)         │                    │                    │
    │                  │                    │                    │
    │ 6. Bundle:       │                    │                    │
    │  revealIx +      │                    │                    │
    │  consume_        │                    │                    │
    │  randomness      │                    │                    │
    │─────────────────►│                    │                    │
    │                  │ 7. Verify same     │                    │
    │                  │  randomness acct   │                    │
    │                  │  (anti-reroll)     │                    │
    │                  │                    │                    │
    │                  │ 8. Read 6 VRF      │                    │
    │                  │  bytes → derive:   │                    │
    │                  │  - cheap_side      │                    │
    │                  │    (75% flip)      │                    │
    │                  │  - low_tax_bps     │                    │
    │                  │    (100-400)       │                    │
    │                  │  - high_tax_bps    │                    │
    │                  │    (1100-1400)     │                    │
    │                  │  - carnage?        │                    │
    │                  │    (~4.3%)         │                    │
    │                  │                    │                    │
    │                  │ 9. If Carnage:     │                    │
    │                  │  set pending +     │                    │
    │                  │  execute_carnage_  │                    │
    │                  │  atomic            │                    │
    │                  │────────────────────────────────────────►│
    │                  │                    │                    │
    │                  │ 10. CPI:           │                    │
    │                  │  update_cumulative │                    │
    │                  │────────────────────────────────────────►│
    │                  │                    │  Staking finalizes │
    │                  │                    │  epoch rewards     │
    │◄─────────────────┼────────────────────┤                    │
    │  TX confirmed                                              │
```

**Timeout recovery:** If the Switchboard oracle fails to reveal within 300 slots (~2 min), anyone can call `retry_epoch_vrf` with a fresh randomness account to restart the VRF process. The fresh account may be assigned to a different (working) oracle. Gateway rotation does NOT work -- each randomness account is assigned to a specific oracle, and alternative gateways serve different oracles whose signatures fail on-chain (error 0x1780).

### Flow 5: PROFIT Staking

1. **Stake:** User calls `Staking::stake(amount)`. Transfers PROFIT from user to StakeVault via Token-2022 (hooks validate vault is whitelisted). Updates UserStake checkpoint (`reward_per_token_paid`, `pending_reward`). Increments StakePool.total_staked.
2. **Reward accumulation:** Each taxed swap triggers `Tax::deposit_rewards` CPI to Staking, incrementing `StakePool.pending_rewards` with 71% of the SOL tax.
3. **Epoch finalization:** Crank calls `Epoch::update_cumulative` CPI to Staking. Moves pending_rewards into cumulative `rewards_per_token_stored` using: `delta = pending_rewards * 1e18 / total_staked`. Monotonically increasing.
4. **Claim:** User calls `Staking::claim`. Calculates `earned = staked_balance * (rewards_per_token_stored - user.reward_per_token_paid) / 1e18 + user.pending_reward`. Transfers SOL from EscrowVault to user.
5. **Unstake:** User calls `Staking::unstake(amount)`. Forfeits pending rewards to remaining stakers (added to `pool.pending_rewards`). Transfers PROFIT from StakeVault to user. Requires 12-hour cooldown after last claim (`last_claim_ts`); users who have never claimed can unstake immediately. UserStake persists forever (even at zero balance).
6. **Flash-loan resistance:** Stake and unstake in the same epoch produces zero rewards because update_cumulative has not yet been called with new rewards.

## Infrastructure

### Hosting

| Service | Provider | Plan | Purpose |
|---------|----------|------|---------|
| Frontend + Crank Bot | Railway | Hobby ($7/mo base) | Next.js app + background crank process, single container |
| Database | Railway | Included (PostgreSQL addon) | Indexed swap/epoch/carnage events, OHLCV candles |
| Documentation Site | Vercel | Free | Nextra 4 static docs (16 pages, Pagefind search) |
| RPC / Webhooks | Helius | Free tier -> Developer ($49) at ~600 DAU | All RPC, WebSocket, webhook, DAS API |
| Error Monitoring | Sentry | Free tier (5K errors/mo) | Zero-dependency: raw HTTP POST envelopes |
| VRF Oracle | Switchboard | On-demand (per-use) | VRF randomness for epoch transitions |

### Environments

| Environment | Purpose | URL/Endpoint | Cluster |
|-------------|---------|-------------|---------|
| Localnet | Unit + integration tests | localhost:8899 | solana-test-validator |
| Devnet | Continuous validation, e2e | Helius devnet RPC | Solana devnet |
| Mainnet | Production (post-launch) | Helius mainnet RPC | Solana mainnet-beta |
| Railway (App) | Frontend + crank hosting | dr-fraudsworth-production.up.railway.app | N/A |
| Vercel (Docs) | Documentation site | TBD | N/A |

### Program IDs (Mainnet)

Source of truth: `deployments/mainnet.json`

| Program | ID | LOC (approx) |
|---------|----|-------------|
| AMM | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` | ~1,200 |
| Tax Program | `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj` | ~3,500 |
| Epoch Program | `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2` | ~5,000 |
| Staking | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` | ~2,500 |
| Transfer Hook | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` | ~1,500 |
| Conversion Vault | `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` | ~500 |
| Bonding Curve | `DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV` (closed) | ~6,000 |

### Token Mints (Mainnet)

| Token | Mint Address | Token Program | Decimals | Supply |
|-------|-------------|---------------|----------|--------|
| CRIME | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` | Token-2022 | 6 | 1,000,000,000 |
| FRAUD | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` | Token-2022 | 6 | 1,000,000,000 |
| PROFIT | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` | Token-2022 | 6 | 20,000,000 (20M) |
| WSOL | `So11111111111111111111111111111111111111112` | SPL Token | 9 | N/A (wrapped) |

### Address Lookup Table (ALT)

**Mainnet ALT:** `7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h`

The ALT is required for the Sell swap path, which has 23 named accounts + 8 remaining_accounts (4 hook accounts per Token-2022 mint), exceeding Solana's 1232-byte legacy transaction limit. The ALT is client-side only -- no program changes required. Sell transactions use v0 VersionedTransaction format.

**v0 TX considerations:**
- Devnet simulation rejects v0 TX with "Blockhash not found" -- must use `skipPreflight: true`
- After v0 TX with skipPreflight, wait 2 seconds before reading state (RPC propagation delay)
- Check `confirmation.value.err` because failed TXs are still "confirmed" on Solana

### CI/CD

| Stage | Tool | Trigger | What Runs |
|-------|------|---------|-----------|
| Fast | `cargo test` | Push to main | Unit tests, proptest (math.rs: 22 unit + 3 properties x 10K iterations) |
| Medium | LiteSVM | Push to main | CPI integration tests |
| Slow | `anchor test` | Push to main | Full validator: staking (28 tests), token-flow (12), security (24) |
| Live | Manual | Developer-initiated | Devnet e2e validation, carnage-hunter, overnight runner |

Build command: `anchor build` then `anchor build -p epoch_program -- --features devnet` (without devnet feature, epoch_program compiles with mainnet Switchboard PID causing ConstraintOwner errors).

Deployment: `scripts/deploy/deploy-all.sh` (build + deploy all 7 programs in 4 phases), `scripts/deploy/initialize.ts` (initialize all PDAs, pools, whitelist, vault). See [deployment-sequence.md](deployment-sequence.md) and [upgrade-cascade.md](upgrade-cascade.md) for safe upgrade ordering.

## Key Architectural Decisions

| # | Decision | Choice | Alternatives Considered | Rationale |
|---|----------|--------|------------------------|-----------|
| A1 | Program decomposition | 6 separate programs composed via CPI (5 original + Conversion Vault) | Monolith (infeasible: BPF size), 4 programs (AMM+Tax merged) | Token-2022 hook must be separate program. ~29.2K LOC exceeds monolith limits. Independent upgrade/freeze per program. Vault is a leaf node (no CPI integration with other programs). |
| A2 | Post-mainnet lifecycle | Full immutability -- burn all 6 upgrade authorities | Selective upgradeability, governance-controlled upgrades | Ultimate trust signal. No centralization vector. Protocol either thrives or dies on deployed code. |
| A3 | Upgrade transition | Tiered timelock: 2hr -> 24hr -> burn (2-4 weeks) | Immediate burn (too risky), permanent timelock (centralization) | Safety runway for critical bugs. Users can monitor for pending upgrades and exit. |
| A4 | Multisig | Squads 2-of-3 for upgrade authority | Single keypair, custom timelock program | Squads is OtterSec-verified. On-chain timelock enforcement. 2-of-3 prevents single-point-of-failure. |
| A5 | Emergency response | No pause mechanism | Global pause flag, rate limiting | Centralization vector. Post-burn: users exit, no intervention. |
| A6 | AMM design | Tax-agnostic pure swap primitive (forked from solana-uniswap-v2) | Embedded tax awareness, custom AMM | Separation of concerns. AMM auditable against standard Uniswap V2 behavior without protocol tax complexity. |
| A7 | CPI depth management | Depth-4 permanent ceiling, all budget consumed | Merge AMM+Tax (saves one hop, couples concerns) | Hard Solana runtime constraint. No roadmap items need more depth. |
| A8 | Token-2022 hook forwarding | Manual `transfer_checked_with_hook` CPI helper | Anchor SPL helpers, patching Anchor | Anchor doesn't forward remaining_accounts. Manual helper appends hook accounts to both ix.accounts and account_infos. |
| A9 | Reentrancy protection | Structural (acyclic DAG) + AMM guard (defense-in-depth) | Guards on all programs | DAG makes reentrancy impossible. AMM guard is conventional, harmless, cheap. |
| A10 | LP fee model | Fixed: 100 bps for SOL pools. PROFIT conversion uses deterministic 100:1 vault (no bonding curve, no fees). | Adjustable fees, protocol fee extraction | No LP tokens = no one to distribute to. SOL pools only get deeper via compounding fees. PROFIT pools replaced by fixed-rate vault for predictable conversion. |
| A11 | Sell path TX size | ALT + v0 VersionedTransaction | Account compression (insufficient savings) | 23 + 8 accounts exceed 1232 bytes. ALT is client-side only. 46 protocol addresses cached. |
| A12 | (Historical -- PROFIT pools replaced by conversion vault) PROFIT pool hook ordering | Client sends `[input_hooks(4), output_hooks(4)]`, AMM splits at midpoint | Fixed `[A, B]` ordering (requires on-chain reordering) | Buy(AtoB) = `[A,B]`, Sell(BtoA) = `[B,A]`. Wrong ordering causes error 3005. No longer applicable -- vault uses standard Token-2022 transfers. |
| A13 | State management (frontend) | React hooks only (no Redux/Zustand) | Zustand, Redux Toolkit | Modal-based UI = self-contained state per modal. No complex cross-modal state identified. DashboardGrid pattern sufficient. |
| A14 | Monitoring | Zero-dependency Sentry (raw HTTP POST) + Crons heartbeat | @sentry/* packages, Discord webhooks, Datadog | @sentry/* breaks Turbopack SSR (patches webpack internals). Raw fetch works in both browser and Node.js. |
| A15 | RPC provider | Single Helius plan (all traffic) | Split providers, QuickNode, Alchemy | Helius free tier sufficient through ~600 DAU. Native Solana features (DAS, webhooks, WS). |

## Constraints

### Hard Constraints (Solana Runtime)

| Constraint | Limit | Impact |
|------------|-------|--------|
| CPI depth | 4 levels maximum | Every swap path hits the ceiling. No additional CPI calls possible on any swap path. |
| Transaction size | 1232 bytes (legacy) | Sell path exceeds limit. Requires ALT + v0 VersionedTransaction. |
| BPF loader size | ~1.4MB per program | Combined ~29.2K LOC would exceed as monolith. Forces multi-program architecture. |
| Compute budget | 200K CU default / 1.4M max | Heaviest path: swap_sol_sell(FRAUD) at 122,586 CU (61% of 200K). No scaling risk. |
| Account data size | 10MB max per account | No impact -- largest account (PoolState) is 232 bytes. |
| Stack frame | 4KB per frame | BPF stack overflow fix: Box state accounts + downgrade CPI passthroughs to AccountInfo for large instruction structs (20+ accounts). |

### Architectural Constraints (Self-Imposed)

| Constraint | Rule | Rationale |
|------------|------|-----------|
| Immutability | All programs frozen post-burn. No migrations, no versioning. | Trust model. Account layouts are final. |
| No LP tokens | Liquidity is permanent and unwithdrawable | Rug-pull prevention. Pools only grow deeper via compounding fees. |
| No pause | No `is_paused` flag in any program | Decentralization over intervention. |
| No admin keys (post-burn) | AMM admin + whitelist authority both burned before upgrade authority burn | Eliminates admin key compromise vector. |
| Tax-agnostic AMM | AMM has zero knowledge of protocol economics | Auditability. Swap math verifiable against Uniswap V2 independently. |
| Stateless Tax Program | Tax reads EpochState, stores nothing | Minimizes state surface area. Tax logic changes don't require migrations. |
| No unified error catalog | Each program's `errors.rs` is source of truth. Client-side mapping for user display. | Programs are immutable. Off-chain presentation can update freely. |
| Token-2022 only via `transfer_checked` | Never plain `transfer` for CRIME/FRAUD/PROFIT | Ensures hooks always fire. Multi-layer validation. |
| Canonical mint ordering | `mint_a.key() < mint_b.key()` enforced on-chain | Exactly one pool PDA per mint pair. No duplicate pools. |
| UserStake persists forever | Never closed, even at zero balance | Simplicity. No re-initialization edge cases. ~0.00114 SOL rent per user. |

### Operational Constraints

| Constraint | Detail | Mitigation |
|------------|--------|------------|
| Crank liveness | Crank death = stale tax rates, delayed rewards, expired Carnage | Graceful degradation. No funds locked. Permissionless recovery. 0.001 SOL bounty incentivizes third-party cranking. |
| VRF oracle dependency | Switchboard oracle failure = stuck epoch | Timeout recovery after 300 slots. Fresh randomness may get different (working) oracle. Gateway rotation does NOT work. |
| Devnet SOL budget | Faucet rate-limits aggressively | Use 0.5 SOL WSOL budget + 0.003 SOL swaps. User setup needs only 0.05 SOL. |
| RPC credit budget | Frontend polling was burning ~75K credits/day | 91% reduction planned: webhook migration, network-aware intervals, dev-mode guard. Target: ~6.5K credits/day. |
| `force_carnage` devnet-only | `#[cfg(feature = "devnet")]` -- MUST be absent from mainnet build | Tracked in mainnet checklist. Mainnet build omits `--features devnet`. |

<!-- Resolved: Tax::swap_sol_buy deducts tax from SOL input first, then AMM applies LP fee. This is the correct execution order. Overview doc phrasing referred to the conceptual model. -->

<!-- Resolved: SLOTS_PER_EPOCH is feature-gated: 750 (devnet) vs 4500 (mainnet) via #[cfg(feature = "devnet")]. Tracked in mainnet-checklist.md. -->

<!-- Resolved: PoolState INIT_SPACE in pool.rs is authoritative. The 223-byte figure in D2 notes was a draft calculation error. -->

---

*Generated by Grand Library (Wave 1). Decisions referenced: architecture (5), cpi-architecture (6), amm-design (8), security (14), frontend (12), operations (7), token-model (10), account-structure (4), error-handling (9). Total: 75 decisions synthesized.*
