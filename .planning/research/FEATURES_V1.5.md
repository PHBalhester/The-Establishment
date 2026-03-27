# Feature Landscape: v1.5 Protocol Expansion

**Domain:** Solana DeFi protocol expansion (Jupiter integration, USDC pools, crank hardening, vault convert-all)
**Researched:** 2026-03-25
**Milestone context:** Subsequent milestone on a live mainnet protocol (Dr. Fraudsworth's Finance Factory)

---

## Table Stakes

Features users/ecosystem participants expect. Missing = protocol feels incomplete or isolated.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Vault Convert-All (sentinel value)** | Multi-hop SOL<->PROFIT swaps currently leak intermediate tokens, triggering Blowfish "malicious" warnings in Phantom/Backpack. Blocks large trades entirely. | Low | On-chain Vault upgrade via Squads | Fully spec'd in Docs/vault-convert-all-proposal.md. `amount_in == 0` sentinel reads on-chain balance. ~2hr on-chain, ~1hr client. MUST ship first -- it's a UX-breaking bug on mainnet right now. |
| **Crank gateway resilience** | Current crank fails silently when Switchboard gateway is down. Epoch advancement stalls, taxes freeze, protocol looks dead. | Low-Med | Switchboard SDK, crank runner on Railway | Already has retry logic + VRF timeout recovery. Needs: health monitoring, alerting, auto-restart, possibly ORAO VRF as backup oracle. |
| **IDL publication for external integrators** | External arb bots and aggregators need published IDLs to build transactions. Already have external-arb-bot-spec.md but IDLs need to be discoverable. | Low | Anchor IDLs already generated | Upload IDLs to on-chain IDL accounts (standard Anchor practice) or publish to a known location. |

## Differentiators

Features that set the protocol apart. Not expected by users, but create significant value.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Jupiter AMM adapter** | Routes Jupiter's aggregator traffic through Dr. Fraudsworth's pools. Massive volume increase, discoverability, and legitimacy. Every Jupiter swap that touches CRIME/FRAUD/PROFIT pays taxes -> staking yield. | High | Jupiter team approval + new Swap enum variant OR passthrough variant, Tax Program wrapping, off-chain Amm trait impl | This is the highest-value differentiator. See detailed analysis below. |
| **USDC pool pairs** | CRIME/USDC + FRAUD/USDC pools alongside existing SOL pools. Reduces SOL price dependency, attracts stablecoin traders, deeper arbitrage opportunities. | High | New pool initialization, possibly parallel Tax Program paths, USDC is native SPL (not T22) so transfer hook interactions differ | Reason AMM admin authority was retained. See detailed analysis below. |
| **Protocol-owned arbitrage** | Protocol captures epoch spreads instead of external bots. SOL profit stays in Carnage Fund. Volume multiplier for staking rewards. | High | On-chain Epoch + Vault changes, AMM changes for Approach B | Fully spec'd in Docs/protocol-arb-spec.md. Deferred until 2-4 weeks of live mainnet data. |
| **Switchboard VRF failover to ORAO** | If Switchboard goes down entirely, fall back to ORAO Network's VRF. True oracle redundancy. | Very High | Second oracle integration, on-chain feature flag, dual verification paths | ORAO is the only other Solana VRF provider. Adds significant complexity. Likely overkill unless Switchboard proves unreliable. |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Custom Jupiter on-chain program** | Jupiter routes through YOUR existing on-chain programs. The adapter is an off-chain Rust SDK that tells Jupiter how to build transactions against your existing instructions. Do NOT build a separate "Jupiter swap" instruction. | Implement the `Amm` trait in a standalone Rust crate that generates instructions for Tax Program's existing swap_sol_buy/sell/swap_profit_buy/sell. |
| **Multi-token pool (3+ assets per pool)** | Constant-product AMMs with 3+ tokens have thin liquidity per pair, complex math, and worse price execution. Saber abandoned this approach for 2-pools + router. | Keep independent 2-token pools. Use the existing routing engine to create transitive paths (SOL->CRIME->USDC via two pools). |
| **Permissionless pool creation** | Letting anyone create pools dilutes liquidity and opens attack vectors (fake token pools, rug pulls). The protocol is a curated ecosystem. | Admin-only pool creation via Squads multisig. New pools (USDC pairs) are protocol decisions. |
| **Removing taxes for Jupiter routes** | Tempting to waive taxes to attract Jupiter volume. Destroys the protocol's value proposition -- taxes ARE the yield source. | Keep taxes on ALL routes. Jupiter users see the effective price including tax. The tax IS the product. |
| **Gateway rotation for VRF** | Each randomness account is assigned to a specific oracle. Alternative gateways serve different oracles whose signatures fail on-chain (error 0x1780). | Retry the assigned oracle's default gateway. If down, use VRF timeout recovery with fresh randomness (may get a different working oracle). Already implemented in vrf-flow.ts. |
| **Burning authorities for "decentralization theater"** | Premature authority burns prevent critical bug fixes. The protocol has timelocked Squads governance -- that IS the decentralization. | Keep authorities behind Squads multisig with progressive timelock extension. Burn only after external audit + explicit owner confirmation. |

---

## Detailed Feature Analysis

### 1. Jupiter AMM Adapter

**Confidence: MEDIUM** (based on official Jupiter docs + docs.rs, but passthrough variant status unverified)

#### What It Actually Is

A Jupiter integration consists of TWO parts:

**Part A: Off-chain Amm trait implementation (Rust crate)**
This is what YOU build. It implements Jupiter's `Amm` trait from the `jupiter-amm-interface` crate (v0.6.1, 87 Swap variants currently listed). The 10 required methods:

| Method | Purpose | Dr. Fraudsworth Mapping |
|--------|---------|------------------------|
| `from_keyed_account` | Deserialize pool state from account data | Read PoolState PDA for each pool |
| `label` | Human-readable name | `"Dr. Fraudsworth"` |
| `program_id` | On-chain program | Tax Program (`43fZ...`) -- NOT AMM directly, because all swaps go through Tax |
| `key` | Pool/market address | PoolState PDA pubkey |
| `get_reserve_mints` | Tradeable token mints | `[mint_a, mint_b]` from PoolState |
| `get_accounts_to_update` | Accounts needed for quoting | PoolState + EpochState (for dynamic tax rates) |
| `update` | Refresh internal state | Deserialize reserves + current tax rates |
| `quote` | Calculate swap output | Replicate AMM math + tax deduction in Rust |
| `get_swap_and_account_metas` | Build swap instruction | Generate Tax Program CPI instruction with all accounts |
| `clone_amm` | Cloneable instance | Standard `Box::new(self.clone())` |

**Critical constraint:** NO network calls allowed in the implementation. Jupiter batches and caches all account fetches. Your `update()` receives cached data, your `quote()` must compute purely from that cached state.

**Part B: Swap enum variant in Jupiter's codebase**
Jupiter must add a new variant to their `Swap` enum (currently 87 variants). This is done by the Jupiter team after accepting your integration. Alternatively, there is a proposal for a generic "passthrough" variant that would let custom AMMs execute without a dedicated enum variant -- status of this proposal is unclear (LOW confidence).

#### The Tax Program Wrapping Problem

This is the hardest part. Jupiter expects to call a single program with a standard swap instruction. Dr. Fraudsworth's swaps go through the Tax Program, which CPI-calls the AMM. The adapter must:

1. Generate instructions for `swap_sol_buy`, `swap_sol_sell`, `swap_profit_buy`, or `swap_profit_sell` on the Tax Program
2. Include ALL required accounts (23+ accounts for some paths, plus transfer hook remaining_accounts)
3. Handle the `has_dynamic_accounts` flag (set to `true`) because transfer hook accounts vary

The quote must replicate:
- AMM constant-product math (100 bps fee for SOL pools, 50 bps for PROFIT pools)
- Tax deduction (dynamic rates from EpochState: 100-400 bps buy, 1100-1400 bps sell)
- Tax distribution (75/24/1 split) -- though Jupiter only cares about the user's net output

#### Integration Requirements (from Jupiter docs)

1. **Code health** -- maintainable, quality codebase (already have OtterSec verified builds)
2. **Security audit** -- required (already have 5 audits)
3. **Traction** -- evidence of market demand and active user adoption (need mainnet volume data)
4. **Team/Backers** -- reputation verification
5. **Forkable SDK** -- Jupiter requires ability to fork your SDK for maintenance

#### Listing Timeline Estimate

Jupiter reviews are not instant. Expect:
- SDK development: 2-3 weeks (replicating tax + AMM math, building account resolution)
- Jupiter review process: 2-8 weeks (based on community reports, LOW confidence)
- Testing on Jupiter staging: 1-2 weeks
- Total: 1-3 months from start to live routing

#### Precedent: How Other Protocols Handle Tax-Wrapping

Several protocols in the Swap enum use wrapped instruction patterns similar to Dr. Fraudsworth's Tax Program wrapping:
- `PumpWrappedBuy` / `PumpWrappedSell` (v3, v4 variants) -- Pump.fun wraps buys/sells
- `MoonshotWrappedBuy` / `MoonshotWrappedSell` -- Moonshot wraps buys/sells
- `BoopdotfunWrappedBuy` / `BoopdotfunWrappedSell` -- Boop wraps buys/sells

These show Jupiter already handles the "wrapper program invokes underlying AMM" pattern. Dr. Fraudsworth's Tax Program follows the same architectural pattern. This is encouraging -- the integration model is proven.

#### Sources

- [Jupiter DEX Integration Guide](https://dev.jup.ag/docs/routing/dex-integration) -- official requirements
- [jupiter-amm-interface on docs.rs](https://docs.rs/jupiter-amm-interface/latest/jupiter_amm_interface/) -- trait definition, Swap enum (87 variants)
- [rust-amm-implementation](https://github.com/jup-ag/rust-amm-implementation) -- reference implementation using SPL Token Swap
- [Passthrough swap variant proposal](https://discuss.jup.ag/t/proposal-add-a-generic-passthrough-swap-variant-for-custom-amm-execution/40039) -- may simplify on-chain integration (status unclear)

---

### 2. USDC Pool Pairs

**Confidence: MEDIUM** (architecture is clear from existing codebase, USDC-specific details need verification)

#### How Other Protocols Handle Multi-Denomination Pools

The standard pattern on Solana (Raydium, Orca, Meteora) is simple: **independent 2-token pools with router-based discovery**. There is no special "multi-denomination" architecture. Each pool (CRIME/SOL, CRIME/USDC) is a separate, independent pool with its own liquidity. Routers (Jupiter, internal routing engines) discover paths between pools.

Saber specifically evaluated multi-token pools (3+ assets) and rejected them in favor of 2-pools + transitive routing. The reasoning: liquidity in multi-token pools is "duplicated and wasted" across shared pairs.

#### What USDC Pools Mean for Dr. Fraudsworth

New pools:
- CRIME/USDC (PoolState PDA with CRIME mint + USDC mint)
- FRAUD/USDC (PoolState PDA with FRAUD mint + USDC mint)

Key differences from SOL pools:

| Aspect | SOL Pools | USDC Pools |
|--------|-----------|------------|
| Quote token | WSOL (Token-2022 compatible) | USDC (native SPL token) |
| Transfer hooks | CRIME/FRAUD hooks on T22 side, no hooks on WSOL | CRIME/FRAUD hooks on T22 side, no hooks on USDC |
| Tax denomination | Tax collected in SOL (WSOL) | Tax collected in USDC |
| Tax distribution | 75% staking (SOL), 24% carnage (SOL), 1% treasury (SOL) | Needs decision: collect in USDC or swap to SOL? |
| Pool seeding | Protocol seeds with SOL + tokens | Protocol seeds with USDC + tokens |
| AMM fee | 100 bps | 100 bps (same constant-product math) |

#### Critical Design Decisions

1. **Tax denomination**: If USDC pools collect tax in USDC, the staking escrow, carnage vault, and treasury need USDC token accounts. This fragments yield (stakers get SOL from SOL pools, USDC from USDC pools). Alternative: auto-swap tax USDC to SOL via a DEX (adds complexity + slippage). **Recommendation: Collect in USDC, distribute USDC yield separately.** Stakers earn both SOL and USDC yield.

2. **Carnage Fund denomination**: Carnage currently operates in SOL. USDC pools would need Carnage to hold and execute in USDC too, or convert. **Recommendation: Defer Carnage USDC execution. Accumulate USDC taxes but only run Carnage on SOL pools initially.**

3. **Program changes**: The AMM already supports any mint pair (it's generic). The Tax Program has hardcoded instruction variants (`swap_sol_buy`, `swap_sol_sell`). Need new variants (`swap_usdc_buy`, `swap_usdc_sell`) or a generic `swap_quote_buy`/`swap_quote_sell` that accepts the quote token as a parameter. **Recommendation: Generic approach -- avoids instruction proliferation when adding future quote tokens.**

4. **Routing engine**: The existing routing engine discovers paths through 4 pools. Adding 2 more pools creates new routes (e.g., SOL -> CRIME -> USDC, or USDC -> FRAUD -> PROFIT). The route engine needs pool discovery by mint pair, not hardcoded pool addresses.

5. **Liquidity bootstrapping**: New USDC pools start with zero liquidity. Need a seeding strategy. The bonding curve launch mechanism was for SOL pools -- USDC pools might launch directly as AMM pools with admin-seeded liquidity.

#### Sources

- [Saber 2Pool architecture rationale](https://medium.com/@viza_saber/solana-amm-design-multi-token-pools-and-2pools-2a0b70efd3b3) -- why 2-token pools beat multi-token pools
- Existing AMM codebase (generic pool architecture confirmed)
- MEMORY.md: "USDC pool pairs -- CRIME/USDC + FRAUD/USDC as future expansion. Parallel program stack, same PROFIT stakers. Reason AMM admin is retained."

---

### 3. Switchboard Gateway / Crank Hardening

**Confidence: HIGH** (based on existing codebase + battle-tested crank operation)

#### Current State

The crank runner (`scripts/vrf/lib/vrf-flow.ts`) already handles:
- Retry on default gateway with exponential backoff
- VRF timeout recovery (300 slots, fresh randomness account)
- Rent reclamation for stale randomness accounts

What it does NOT handle:
- **Monitoring/alerting** -- no external notification when VRF fails repeatedly
- **Gateway health checks** -- no proactive detection of gateway degradation
- **Metrics** -- no tracking of success rates, latency, failure patterns
- **Auto-restart** -- Railway process must be manually restarted if crank crashes

#### Switchboard Gateway Architecture

**Confidence: LOW** (Switchboard docs return 404 on several endpoints, architecture details sparse)

What we know:
- Switchboard uses a "Crossbar" API (`api.switchboard.xyz`) as the gateway layer
- Each randomness account is assigned to a specific oracle during commit
- Gateway rotation does NOT work (confirmed in our codebase -- different oracles serve different signatures, on-chain verification fails with 0x1780)
- Switchboard operates ~20 independent oracle nodes on mainnet
- The gateway itself (`api.switchboard.xyz`) is centralized infrastructure -- if it goes down, all Switchboard VRF users are affected

#### Hardening Recommendations

| Enhancement | Complexity | Value |
|-------------|------------|-------|
| Health endpoint monitoring (ping gateway every N seconds) | Low | Detect outages before they stall epochs |
| Discord/Telegram webhook alerts on VRF failure | Low | Team gets notified immediately |
| Metrics dashboard (success rate, latency, epoch duration) | Medium | Pattern detection, capacity planning |
| Graceful degradation mode (freeze tax rates at last-known values) | Medium | Protocol continues operating during VRF outage |
| ORAO VRF as backup oracle | Very High | True redundancy, but massive on-chain + off-chain work |

**Recommendation:** Health monitoring + alerting first (low complexity, high value). Graceful degradation second. ORAO backup only if Switchboard proves unreliable over months of operation.

#### Sources

- Existing codebase: `scripts/vrf/lib/vrf-flow.ts` (gateway retry + timeout recovery)
- MEMORY.md: "VRF gateway rotation DOES NOT WORK"
- [Switchboard documentation](https://docs.switchboard.xyz/) (limited detail on gateway architecture)
- [ORAO Network Solana VRF](https://github.com/orao-network/solana-vrf) (alternative VRF provider)

---

### 4. Vault Convert-All (Sentinel Value Pattern)

**Confidence: HIGH** (fully spec'd, small diff, well-understood pattern)

#### Pattern Precedent in Solana DeFi

The "sentinel value for full balance" pattern is used across Solana DeFi:

| Protocol/Standard | Sentinel | Meaning |
|-------------------|----------|---------|
| SPL Token `CloseAccount` | N/A (implicit) | Transfers remaining SOL rent to destination, balance must be 0 |
| Various DeFi protocols | `u64::MAX` | "Use my entire balance minus rent-exempt minimum" |
| Jupiter limit orders | `0` for certain params | "Use entire input balance" |
| Dr. Fraudsworth (proposed) | `amount_in == 0` | "Convert entire input token balance" |

Using `0` as the sentinel is cleaner than `u64::MAX` because:
- `0` is already rejected by the existing `ZeroAmount` check, so it is a free sentinel with zero backwards-compatibility risk
- It is self-documenting: "amount 0 = use balance"
- It avoids confusion with `u64::MAX` which could be mistaken for an actual (enormous) amount

#### Implementation Details

Already fully documented in `Docs/vault-convert-all-proposal.md`. Key additions:
- New `minimum_output: u64` parameter on `convert` instruction (on-chain slippage guard)
- New `VaultError::SlippageExceeded` error variant
- Breaking instruction signature change (`convert(amount_in)` -> `convert(amount_in, minimum_output)`)

**Zero-downtime migration option:** Add `convert_v2(amount_in, minimum_output)` alongside existing `convert(amount_in)`. Old clients use `convert`, new clients use `convert_v2`. Deprecate `convert` later.

#### Sources

- `Docs/vault-convert-all-proposal.md` (complete specification)
- SPL Token Program instruction set

---

## Feature Dependencies

```
Vault Convert-All ──(no deps)──> Can ship immediately
                                  Unblocks: clean multi-hop swaps

Crank Hardening ──(no deps)──> Can ship immediately
                                Unblocks: reliable epoch advancement

Jupiter Adapter ──(depends on)──> Vault Convert-All (clean multi-hop needed)
                ──(depends on)──> Published IDLs
                ──(depends on)──> Sufficient mainnet volume for Jupiter traction requirement
                ──(depends on)──> Jupiter team review (external dependency, weeks)

USDC Pools ──(depends on)──> Tax Program generalization (generic quote token)
           ──(depends on)──> Routing engine pool discovery
           ──(depends on)──> USDC liquidity sourcing
           ──(partially depends on)──> Jupiter Adapter (USDC pools should be routable)

Protocol Arb ──(depends on)──> 2-4 weeks live mainnet data
             ──(depends on)──> Vault convert-all (for efficient arb routing)
```

---

## MVP Recommendation

For this milestone, prioritize in this order:

### Must Ship (table stakes fixes)

1. **Vault Convert-All** -- Fixes a live mainnet UX-breaking bug. Small diff, fully spec'd. Ship first.
2. **Crank Health Monitoring + Alerting** -- Protocol reliability. Low complexity, prevents silent failures.

### Should Ship (high-value differentiators)

3. **Jupiter AMM Adapter SDK** -- Begin development. The SDK can be built and tested independently of Jupiter's review process. Submit for review once ready.
4. **IDL Publication** -- Required for Jupiter and external integrators. Low effort.

### Defer to Next Milestone

5. **USDC Pool Pairs** -- High complexity, requires Tax Program generalization, liquidity sourcing, and multiple design decisions. Ship after Jupiter integration proves the routing model works.
6. **Protocol-Owned Arbitrage** -- Spec'd and ready but needs live data first. Also benefits from vault convert-all shipping first.
7. **ORAO VRF Backup** -- Only if Switchboard proves unreliable. Do not build speculatively.

---

## Sources

- [Jupiter DEX Integration Guide](https://dev.jup.ag/docs/routing/dex-integration)
- [jupiter-amm-interface crate (v0.6.1)](https://docs.rs/jupiter-amm-interface/latest/jupiter_amm_interface/)
- [Jupiter Swap enum (87 variants)](https://docs.rs/jupiter-amm-interface/latest/jupiter_amm_interface/enum.Swap.html)
- [rust-amm-implementation reference](https://github.com/jup-ag/rust-amm-implementation)
- [Passthrough swap variant proposal](https://discuss.jup.ag/t/proposal-add-a-generic-passthrough-swap-variant-for-custom-amm-execution/40039)
- [Saber 2Pool architecture](https://medium.com/@viza_saber/solana-amm-design-multi-token-pools-and-2pools-2a0b70efd3b3)
- [Switchboard documentation](https://docs.switchboard.xyz/)
- [ORAO Network Solana VRF](https://github.com/orao-network/solana-vrf)
- `Docs/vault-convert-all-proposal.md` (internal)
- `Docs/protocol-arb-spec.md` (internal)
- `Docs/external-arb-bot-spec.md` (internal)
- `scripts/vrf/lib/vrf-flow.ts` (internal -- gateway retry implementation)
