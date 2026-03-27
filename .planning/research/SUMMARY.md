# Project Research Summary

**Project:** Dr. Fraudsworth v1.5 Protocol Expansion
**Domain:** Solana DeFi protocol feature expansion (live mainnet protocol)
**Researched:** 2026-03-25
**Confidence:** MEDIUM-HIGH

## Executive Summary

Dr. Fraudsworth v1.5 adds four features to a live mainnet Solana DeFi protocol: vault convert-all (fixing a UX-breaking bug), crank gateway resilience, Jupiter aggregator integration, and USDC pool pairs. The critical finding across all research is that **zero new on-chain dependencies are needed** -- all four features use the existing Anchor 0.32.1 / Token-2022 stack. The only new Rust dependency is `jupiter-amm-interface` (v0.6.1) in an isolated off-chain crate that never touches BPF compilation. This is a significant risk reduction factor for a live protocol.

The recommended approach is a strict dependency-ordered rollout: vault convert-all and crank hardening ship first (parallel, zero dependencies, low risk), followed by the Jupiter AMM adapter SDK (off-chain only, no program changes), with USDC pools deferred to the next milestone due to their high complexity and multiple unresolved design decisions (Tax Program approach, staking denomination, liquidity sourcing). The Jupiter integration is the highest-value differentiator -- protocols like Pump.fun, Moonshot, and Boop.fun already have "wrapped buy/sell" variants in Jupiter's Swap enum, proving the Tax Program wrapping pattern is compatible with Jupiter's architecture.

The top risks are: (1) the vault convert-all instruction signature change breaking live clients during the upgrade window -- mitigated by using a `convert_v2` instruction instead of modifying `convert`; (2) Jupiter's `Amm` trait forbidding network calls while the protocol needs transfer hook accounts resolved -- mitigated by pre-computing all hook accounts from deterministic PDA seeds; and (3) USDC pools requiring either a parallel Tax-USDC program or extending the existing Tax Program, both of which touch security-critical live infrastructure. The CPI depth ceiling (already maxed at 4) is a hard architectural constraint that prevents adding any new intermediate programs to the swap path.

## Key Findings

### Recommended Stack

No new on-chain dependencies. The existing Anchor 0.32.1 + Token-2022 stack handles all four features. See `.planning/research/STACK.md` for full details.

**Core additions:**
- `jupiter-amm-interface` v0.6.1: Off-chain Rust crate implementing Jupiter's `Amm` trait -- lives in `sdk/jupiter-adapter/`, completely isolated from on-chain programs. Uses Solana modular crates v3.x-4.x which are incompatible with on-chain `solana-program` 2.x, but workspace isolation handles this cleanly.
- No new JS packages, no Anchor version change, no new on-chain crates.

**What NOT to add:** `jupiter-core` (Jupiter internals), `solana-sdk` v3.x in on-chain programs (breaks BPF), Pyth/Chainlink price feeds (not needed yet), `rust_decimal` on-chain (BPF has no float, existing u128 math is correct).

### Expected Features

See `.planning/research/FEATURES_V1.5.md` for full analysis.

**Must have (table stakes):**
- **Vault Convert-All** -- Fixes live mainnet bug where multi-hop SOL-to-PROFIT swaps leak intermediate tokens, triggering Blowfish "malicious" wallet warnings. Fully spec'd, ~3hr implementation.
- **Crank Health Monitoring + Alerting** -- Protocol appears dead when Switchboard gateway fails silently. Need gateway health pings, Discord/Telegram webhooks, and metrics tracking.
- **IDL Publication** -- External arb bots and aggregators need discoverable IDLs to build transactions.

**Should have (differentiators):**
- **Jupiter AMM Adapter** -- Routes Jupiter aggregator traffic through protocol pools. Massive volume and legitimacy boost. Tax collection preserved on all routes. 1-3 month timeline including Jupiter review.
- **USDC Pool Pairs** -- CRIME/USDC + FRAUD/USDC alongside SOL pools. Reduces SOL price dependency, attracts stablecoin traders.

**Defer (next milestone+):**
- **USDC Pools** -- High complexity, requires Tax Program generalization, liquidity sourcing strategy, and 4+ design decisions. Ship after Jupiter integration proves the routing model.
- **Protocol-Owned Arbitrage** -- Spec'd and ready but needs 2-4 weeks of live mainnet trading data first.
- **ORAO VRF Backup** -- Only build if Switchboard proves unreliable over months of mainnet operation.

### Architecture Approach

The protocol's CPI architecture (Tax -> AMM -> Token-2022 -> Transfer Hook, depth 4/4) is the defining constraint. Jupiter must call the Tax Program directly -- it cannot bypass tax collection or call the AMM (PDA-gated). USDC pools work in the existing AMM (it is mint-agnostic) but the Tax Program is deeply SOL-wired and needs either extension (Approach B, risky) or a parallel Tax-USDC program (Approach A, isolated but duplicative). See `.planning/research/ARCHITECTURE_v1.5_INTEGRATION.md` for full analysis.

**Major components:**
1. **Conversion Vault (modified)** -- Add `convert_v2` instruction with sentinel value (amount_in=0) and minimum_output slippage guard. Leaf node, no CPI callers, lowest risk.
2. **Jupiter SDK (new, off-chain)** -- `sdk/jupiter-adapter/` Rust crate implementing `Amm` trait. Targets Tax Program as swap entry point. Must return 23+ accounts including transfer hook accounts, all derivable from PDA seeds without network calls.
3. **Crank Runner (modified, off-chain)** -- Health monitoring, alerting, drain mode for maintenance windows, pre-created randomness pool for faster VRF failover.

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for all 15 pitfalls with detailed prevention strategies.

1. **Instruction signature breaking change (P1)** -- Adding `minimum_output` to `convert` breaks live clients during upgrade window. Use `convert_v2` as a new instruction; deprecate `convert` later.
2. **Jupiter no-network-call constraint vs. hook accounts (P3)** -- Jupiter's `Amm` trait forbids network calls, but transfer hook accounts must be included. Pre-compute all hook accounts from deterministic PDA seeds in `from_keyed_account()` / `update()`.
3. **Jupiter account count explosion (P4)** -- Tax Program swap requires 23+ accounts including hook accounts. Exceeds base transaction limit. SDK must declare ALT dependency and return accurate `get_accounts_len()`.
4. **CPI depth ceiling (P7)** -- Already at Solana's max (depth 4). No new intermediate programs can be added to the swap path. This is permanent and non-negotiable.
5. **USDC/T22 mixed pool transfer routing (P2)** -- Canonical mint ordering may flip for USDC pools vs SOL pools. AMM stores `token_program_a/b` per pool for dynamic dispatch, but verify this is actually used in swap handler before creating pools.

## Implications for Roadmap

Based on combined research, this milestone should contain 3 phases (not 4). USDC pools should be deferred to the next milestone.

### Phase 1: Vault Convert-All + Crank Hardening

**Rationale:** Zero dependencies on each other or later phases. Vault convert-all fixes a live mainnet UX bug (highest urgency). Crank hardening improves operational reliability before any program upgrades occur. Both are low-to-medium complexity.

**Delivers:**
- `convert_v2` instruction with sentinel value and on-chain slippage guard
- Updated multi-hop builder passing amount_in=0 for vault steps
- Crank health monitoring, Discord/Telegram alerting on VRF failures
- Crank drain mode for safe maintenance windows
- Pre-created randomness pool for faster VRF failover

**Addresses:** Vault Convert-All (table stakes), Crank Gateway Resilience (table stakes)

**Avoids:** P1 (use convert_v2, not modified convert), P6 (guard effective_amount > 0 before transfer), P9 (drain mode for upgrade timing), P14 (keep crank changes off-chain)

### Phase 2: Jupiter AMM Adapter SDK

**Rationale:** Depends on vault convert-all being deployed (clean multi-hop needed for accurate quoting). No on-chain program changes required -- purely an off-chain Rust crate. Can submit to Jupiter team for review while waiting for their timeline. Highest-value differentiator.

**Delivers:**
- `sdk/jupiter-adapter/` Rust crate implementing `Amm` trait
- Accurate quoting (AMM constant-product math + dynamic tax rates from EpochState)
- Full account resolution for Tax Program swap instructions (23+ accounts)
- Transfer hook account pre-computation from PDA seeds
- Published IDLs for external integrators
- Submission to Jupiter team for Swap enum variant addition

**Uses:** `jupiter-amm-interface` v0.6.1 (off-chain only)

**Implements:** Jupiter SDK component from architecture research

**Avoids:** P3 (pre-compute hook accounts, no network calls), P4 (Tax Program as entry point, accurate account counts), P10 (cache tax rates in update(), accept approximation), P12 (base Rust math on on-chain source, not TS frontend)

### Phase 3: USDC Pool Infrastructure (DEFERRED -- next milestone)

**Rationale:** Highest complexity, most unresolved design decisions, touches the most live components. Requires: (1) owner decision on Tax approach (new program vs extend existing), (2) USDC Carnage denomination decision, (3) liquidity sourcing strategy, (4) routing engine generalization. Benefits from Jupiter SDK being ready so USDC pools are routable from day one.

**Delivers (when built):**
- CRIME/USDC and FRAUD/USDC pool initialization
- Tax-USDC program (Approach A) or Tax Program extension (Approach B)
- USDC tax-to-SOL conversion pipeline for staking rewards
- Whitelist additions for new pool vaults
- ALT extension for USDC pool accounts
- Frontend routing engine updates

**Open decisions (must resolve before implementation):**
- Approach A (new Tax-USDC program, risk-isolated, requires AMM authorized_callers) vs Approach B (extend Tax Program, no AMM changes, increases audit surface)
- USDC Carnage: SOL-denominated or USDC-denominated?
- USDC pool liquidity source (protocol treasury? external LPs?)
- Staking rewards: remain SOL-only (convert USDC taxes) or add dual denomination?

### Phase Ordering Rationale

- **Vault convert-all first** because it fixes a live bug affecting real users right now. Smallest scope, fully spec'd, can deploy in a single maintenance window.
- **Crank hardening in parallel** because it has zero dependencies, improves operational safety for subsequent program upgrades, and adds the drain mode needed to safely deploy vault changes.
- **Jupiter SDK second** because it requires no on-chain changes and has an external dependency (Jupiter team review, 2-8 weeks) that should be started early. Building it after vault convert-all ensures clean multi-hop quoting.
- **USDC pools deferred** because they have 4+ unresolved design decisions, touch the most live components (AMM + Tax + Staking + Epoch), and benefit from Jupiter SDK being ready. Shipping Jupiter first also proves the routing model before investing in USDC infrastructure.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Jupiter SDK):** Research existing Token-2022 Jupiter integrations (Fluxbeam, BERN) to verify how they handle transfer hook remaining_accounts in `get_swap_and_account_metas()`. This is the single biggest unknown. Also validate whether Jupiter's on-chain router correctly forwards remaining_accounts for T22 CPI chains.
- **Phase 3 (USDC Pools, deferred):** Needs `/gsd:research-phase` for Tax-USDC program design, AMM authorized_callers implementation, and USDC-to-SOL conversion pipeline architecture.

Phases with standard patterns (skip deep research):
- **Phase 1 (Vault Convert-All):** Fully spec'd in `Docs/vault-convert-all-proposal.md`. Sentinel value pattern is well-established. The `convert_v2` approach follows Formfunction's backwards-compatibility guide.
- **Phase 1 (Crank Hardening):** Standard operational hardening -- health checks, alerting, retry logic improvements. No novel patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new on-chain deps. Jupiter crate verified from GitHub Cargo.toml and crates.io. Workspace isolation strategy is well-understood. |
| Features | MEDIUM-HIGH | Vault and crank features are clear. Jupiter feature analysis is solid but review timeline is uncertain (2-8 week range). USDC pool design decisions are unresolved. |
| Architecture | MEDIUM-HIGH | Vault and Jupiter architecture are well-defined. USDC pool architecture has two valid approaches needing owner decision. CPI depth constraint is absolute. |
| Pitfalls | HIGH | 15 pitfalls identified with concrete prevention strategies. Critical pitfalls (P1, P3, P4) have clear mitigations. All verified from official docs + codebase analysis. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Jupiter Token-2022 remaining_accounts forwarding:** No documentation found on how Jupiter's on-chain router handles T22 transfer hook accounts in CPI chains. Need to study Fluxbeam or BERN's integration code as reference. This could block Jupiter integration if the router strips remaining_accounts.
- **Jupiter passthrough Swap variant status:** A proposal exists for a generic "passthrough" variant that would simplify integration, but its status is unclear (LOW confidence). Assume it does not exist and plan for a dedicated Swap enum variant.
- **Jupiter review timeline:** Community reports range from 2-8 weeks. No SLA or guaranteed timeline. Start SDK development early to minimize calendar impact.
- **USDC pool Tax approach decision:** Cannot proceed with USDC pool implementation until owner decides Approach A vs B. Architecture doc provides tradeoff analysis but this is a design + risk decision.
- **USDC pool liquidity source:** Business decision, not technical. Architecture is ready regardless.
- **Switchboard mainnet gateway reliability:** Devnet behavior (gateway outages, oracle assignment) may differ from mainnet. Validate during early mainnet operation before investing in ORAO backup.

## Sources

### Primary (HIGH confidence)
- [jupiter-amm-interface Cargo.toml (v0.6.1)](https://github.com/jup-ag/jupiter-amm-interface/blob/main/Cargo.toml) -- Dependency versions, Amm trait
- [Jupiter DEX Integration Guide](https://dev.jup.ag/docs/routing/dex-integration) -- Listing requirements, no-network-call constraint
- [Solana Token Extensions: Transfer Hook](https://solana.com/developers/guides/token-extensions/transfer-hook) -- ExtraAccountMetaList resolution
- [Formfunction: Backwards Compatible Program Changes](https://formfunction.medium.com/how-to-make-backwards-compatible-changes-to-a-solana-program-45015dd8ff82) -- Instruction signature breaking changes
- Project source: `programs/amm/`, `programs/tax-program/`, `programs/conversion-vault/`, `programs/transfer-hook/` -- CPI gates, PoolState, transfer routing
- `Docs/vault-convert-all-proposal.md` -- Complete vault convert-all specification
- `Docs/architecture.md` -- CPI depth analysis, program interaction map

### Secondary (MEDIUM confidence)
- [jupiter-amm-interface on docs.rs](https://docs.rs/jupiter-amm-interface/latest/jupiter_amm_interface/) -- Swap enum variants (87 listed), trait method signatures
- [Jupiter Ultra v3 coverage](https://medium.com/@Scoper/solana-defi-deep-dives-jupiter-ultra-v3-next-gen-dex-aggregator-late-2025-2cef75c97301) -- Token-2022 support confirmation
- [Saber 2Pool architecture](https://medium.com/@viza_saber/solana-amm-design-multi-token-pools-and-2pools-2a0b70efd3b3) -- Why 2-token pools beat multi-token pools
- [Switchboard documentation](https://docs.switchboard.xyz/) -- Gateway architecture (sparse)

### Tertiary (LOW confidence)
- [Jupiter passthrough Swap variant proposal](https://discuss.jup.ag/t/proposal-add-a-generic-passthrough-swap-variant-for-custom-amm-execution/40039) -- Status unclear, may simplify integration
- Jupiter review timeline estimates -- Anecdotal community reports, no official SLA

---
*Research completed: 2026-03-25*
*Ready for roadmap: yes*
