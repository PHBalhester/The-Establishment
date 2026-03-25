---
doc_id: project-overview
title: "Dr. Fraudsworth's Finance Factory — Project Overview"
wave: 1
requires: []
provides: [project-overview]
status: draft
decisions_referenced: [architecture, token-model, account-structure, cpi-architecture, amm-design, security, frontend, operations, error-handling, testing]
needs_verification: [carnage-fallback-front-running-frequency, mainnet-priority-fee-vs-bounty-economics]
---

# Dr. Fraudsworth's Finance Factory — Project Overview

## What Is This?

Dr. Fraudsworth's Finance Factory is a Solana DeFi protocol that generates real SOL game rewards from trading friction — not from token emissions, inflationary rewards, or ponzinomics. The protocol uses a three-token system (CRIME, FRAUD, and PROFIT) with asymmetric taxation, a soft peg between CRIME and FRAUD maintained via a conversion vault (100:1 fixed rate), and a VRF-driven chaos mechanism called "Carnage" that burns tokens and creates large arbitrage opportunities. Together, these mechanics produce a self-sustaining volume floor: arbitrage bots correct price dislocations after each epoch transition and Carnage event, paying taxes that fund game rewards for PROFIT stakers. When organic trading dries up, mechanical arbitrage keeps the system alive at lower APYs rather than death-spiraling.

The protocol is built as seven Anchor/Rust programs (~32K LOC) composed via cross-program invocation (CPI), with a Next.js 16 frontend (~32.3K LOC), PostgreSQL backend (Drizzle ORM), Solana wallet-adapter (Phantom/Backpack/Solflare), and Helius webhooks for off-chain indexing. All seven programs are designed for full immutability — upgrade authorities will be burned after a tiered timelock period on mainnet (2 hours at launch, extended to 24 hours, then burned permanently after 2-4 weeks). There is no emergency pause, no governance, no admin intervention post-burn. The protocol either thrives on its deployed code or it doesn't.

What makes this different from every other rewards protocol is the anti-ponzi thesis: rewards come from real economic friction (taxes on swaps), not from minting new tokens. The system has three mechanical volume drivers — tax regime flips (75% chance every 30-minute epoch), Carnage events (~2 per day), and the persistent soft-peg arbitrage loop — that sustain baseline trading activity even without organic users. The team holds zero tokens; the only team revenue is a 5% treasury cut from trading taxes, used exclusively for infrastructure and marketing. All liquidity is permanent and protocol-owned, with LP fees compounding into pool reserves forever.

## Target Users

| User Type | Description | Primary Goals |
|-----------|-------------|---------------|
| **Reward Holders** | DeFi users who acquire PROFIT by first buying CRIME or FRAUD, then converting through the conversion vault (100:1 fixed rate), and staking PROFIT for SOL game rewards. | Earn real SOL game rewards proportional to staked PROFIT. Claim permissionlessly at any time. 12-hour cooldown after claiming before unstake is allowed. Unstaking forfeits pending rewards to remaining stakers. |
| **Arbitrage Bots** | Automated traders that monitor epoch transitions (every 30 minutes) and Carnage events (~2/day) to exploit price dislocations across the two SOL pools. | Profit from the spread between the old and new soft peg after tax regime flips. Execute the canonical SOL -> (Tax+AMM) -> cheap side -> (Vault) -> PROFIT -> (Vault) -> expensive side -> (Tax+AMM) -> SOL loop. |
| **Speculators/Traders** | Users who trade CRIME and FRAUD tokens on the SOL pools, responding to tax regime changes and Carnage-induced volatility. | Capitalize on directional moves, tax asymmetry, and Carnage-driven price shocks. |
| **Crank Bot Operators** | Permissionless operators (anyone with a Solana wallet) who trigger epoch transitions and VRF requests. The team runs one instance; anyone can run additional ones. | Earn 0.001 SOL bounty per epoch transition. Keep the protocol's epoch clock advancing. |

## Scope

### In Scope (v1)

- **Seven on-chain programs** (all Anchor/Rust, all targeting full immutability):
  - **AMM Program** — Constant-product swap engine forked from `arrayappy/solana-uniswap-v2`, stripped of LP tokens/flash loans/TWAP, with Token-2022 hook support and PDA-gated access control added
  - **Tax Program** — Orchestrates all taxed swaps via CPI to AMM. Reads epoch state for current tax rates, calculates and distributes tax (71% staking rewards / 24% Carnage fund / 5% treasury), enforces 50% minimum output floor
  - **Epoch Program** — VRF-driven state machine using Switchboard on-demand VRF. 30-minute epochs, 75% chance of tax regime flip, 1/24 chance of Carnage trigger. Includes Carnage execution (buy+burn or buy+sell rebalancing)
  - **Staking Program** — PROFIT staking with cumulative SOL rewards distribution. Deposit, withdraw, claim SOL. 12-hour cooldown after claiming before unstake; pending rewards forfeited on unstake. Dead stake (1 PROFIT at init) ensures division-by-zero safety.
  - **Transfer Hook Program** — Token-2022 transfer hook enforcing whitelist validation. Only protocol-controlled PDAs (pool vaults, escrows) are whitelisted. Blocks all wallet-to-wallet transfers of CRIME/FRAUD/PROFIT.
  - **Conversion Vault** — Fixed-rate 100:1 conversion between faction tokens (CRIME/FRAUD) and PROFIT. Leaf-node program (calls Token-2022 only). No admin key, one-shot initialization, PDA-derived token accounts.
  - **Bonding Curve Program** — Dual linear bonding curve launch system for CRIME and FRAUD initial distribution. 460M tokens per curve, linear pricing from 0.00000045 to 0.000001725 SOL/token, 500 SOL raised per token. Supports sell-back with 15% tax escrow, per-wallet cap of 20M tokens, 48-hour deadline, atomic dual-curve graduation. BcAdminConfig PDA for authority hardening (Phase 78).
- **Two permanent SOL liquidity pools** (CRIME/SOL, FRAUD/SOL) plus a conversion vault for PROFIT (100:1 fixed rate)
- **Frontend**: Single interactive steampunk factory scene (Next.js 16, desktop-first) with 7 clickable hotspots opening 6 modals (trading terminal, staking, Carnage viewer, wallet, how-it-works, settings)
- **Separate documentation site**: Nextra 4 + Next.js 15, 16 content pages, Pagefind search
- **Crank bot**: Permissionless epoch cranker running on Railway alongside frontend, monitored by Sentry errors + Crons heartbeat
- **Bonding curve launch**: Linear bonding curve for CRIME and FRAUD (46% of supply), raising 500 SOL per token (1,000 SOL total), 48-hour deadline, per-wallet cap of 20M tokens
- **Authority governance**: All upgrade authorities and admin PDAs transferred to Squads 2-of-3 multisig (1-hour timelock). Mint authorities burned. Progressive burn schedule: timelock extension -> external audit -> individual authority burns with owner confirmation.
- **Continuous devnet operation and mainnet deployment**

### Out of Scope

- **Bonding curve program** — Separate from the six core programs; has its own scope and timeline
- **Governance/DAO** — No governance mechanism. The protocol is fully autonomous post-burn with no parameter changes possible.
- **Mobile app** — The steampunk factory scene is landscape-oriented and desktop-first. Mobile strategy is TBD (options: rotate-to-landscape, simplified layout, or defer entirely).
- **Cross-chain bridges** — Single-chain Solana protocol only
- **LP tokens / removable liquidity** — All liquidity is permanent and protocol-owned. No withdrawal mechanism exists or will exist.
- **Token emissions / inflationary rewards** — All rewards funded by real trading friction
- **External professional audit** — Initial development used SVK tooling (Stronghold of Security, Dinh's Bulwark, Book of Knowledge). OtterSec verification is being pursued for the open-source release (Phase 104).
- **Bug bounty program** — Not planned for devnet or mainnet

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Program architecture** | Six separate Anchor programs composed via CPI (depth-4 chains at Solana's maximum) | Token-2022 requires Transfer Hook as separate program. Combined ~29.2K LOC exceeds BPF size limits as monolith. Independent upgrade/freeze capability per program. Conversion Vault is a leaf node (no CPI integration with other programs). |
| **Full immutability** | All 6 programs burn upgrade authority after 2-4 weeks on mainnet | Ultimate trust signal. No admin can ever change the protocol. Users can verify code and know it's permanent. |
| **Tiered timelock before burn** | Squads multisig (2-of-3) with 2hr -> 24hr -> burn schedule | On-chain timelock enforcement via Squads (OtterSec-audited). Safety runway for critical bugs in early mainnet hours. |
| **No emergency pause** | No `is_paused` flag, no kill switch, no governance intervention | Decentralisation over intervention. Post-burn, the only response to an exploit is for users to exit. |
| **Three-token duality** | CRIME + FRAUD as mirrored IP tokens, PROFIT as reward-bearing bridge | Soft peg requires two sides with asymmetric tax friction. PROFIT bridges the arb path via the conversion vault (100:1 fixed rate, zero fees). "You can't have PROFIT without CRIME or FRAUD." |
| **Fixed supplies, all mints burned** | 1B CRIME, 1B FRAUD, 20M PROFIT (6 decimals, Token-2022) | No inflation. Mint authority burned at initialization. 20M PROFIT at 100:1 ratio against IP tokens via conversion vault. |
| **Zero team token allocation** | 100% to bonding curve (46%) + pool seeding (54%) | Maximum trust. Team earns only through 5% treasury tax split on trading volume. |
| **Tax distribution 71/24/5** | 71% staking rewards, 24% Carnage fund, 5% treasury | Hardcoded on-chain. 71% provides strong rewards incentive. 24% funds chaos/deflation. 5% covers ops and crank incentives without being extractive. |
| **Tax-agnostic AMM** | AMM is a pure swap primitive; all economic complexity in Tax Program | AMM can be audited against standard Uniswap V2 behavior independently. Tax changes never require re-auditing swap math. |
| **AMM fork source** | `arrayappy/solana-uniswap-v2` (Apache-2.0), stripped and extended | Small, auditable base. Kept constant-product formula + PDA vaults. Removed LP tokens, flash loans, TWAP, router. Added Token-2022 hooks, PDA access control, reentrancy guard, rich events. |
| **Permanent protocol-owned liquidity** | No LP tokens. Nobody can ever withdraw liquidity. LP fees (1% for SOL pools) compound forever. Conversion vault charges zero fees. | Strongest trust signal. Pools grow monotonically deeper over time. Combined with burned mints and burned upgrade authority, the protocol is truly unkillable. |
| **Transfer hook enforcement** | All CRIME/FRAUD/PROFIT transfers must go through whitelisted protocol PDAs. No wallet-to-wallet transfers. | Forces all trading through AMM (taxes always apply). No OTC, no gifting, no airdrops. Sybil attacks on rewards are economically irrational. |
| **Switchboard VRF with timeout recovery** | On-demand VRF, 300-slot timeout, fresh randomness on retry (not gateway rotation) | Gateway rotation does not work (different oracle, signature fails). Timeout recovery creates fresh randomness which may get a different working oracle. |
| **Acyclic CPI graph** | Entry -> Tax -> AMM -> Token-2022 -> Hook (terminal). No cycles possible. | Reentrancy is structurally impossible by construction. AMM retains a reentrancy guard as defense-in-depth only. |
| **Manual CPI for Token-2022 hooks** | Custom `transfer_checked_with_hook` helper using raw `invoke_signed` | Anchor's `transfer_checked` does not forward `remaining_accounts`. Token-2022 hooks require 4 extra accounts per mint (meta list, whitelist source, whitelist dest, hook program). |
| **Sandwich resistance** | Dual-layer slippage (user-specified + 50% protocol floor) + asymmetric tax poison pill | 18% round-trip tax cost (e.g., 4% buy + 14% sell) makes most sandwiches uneconomical. No flash loans in AMM further limits attack amplification. |
| **Single interactive frontend** | Steampunk factory scene, all modals, no page navigation | Distinctive UX. Factory metaphor maps abstract DeFi to tangible elements (cauldron = Carnage, bubbling tube = rewards, control panel = trading). |
| **Hook-based state management** | React hooks per feature (useSwap, useStaking, usePoolPrices), no Redux/Zustand | Modal-based UI means each modal is self-contained. No complex cross-modal state needed. |
| **Property-tested swap math** | Pure `math.rs` module with zero Anchor imports, 22 unit tests + 3 proptest properties (30K iterations) | Pure functions are easiest to verify. Property testing (k-invariant preservation, output bounds, fee monotonicity) provides stronger guarantees than example-based testing. |
| **Minimal on-chain state** | No analytics counters beyond what's deployed. All stats derived off-chain via Helius webhooks/RPC indexing. | Less state = less bug surface, less compute, less rent. Off-chain derivation is infinitely flexible and can change post-burn. |
| **Infrastructure** | Railway (frontend + crank), Helius (single RPC plan), Sentry (zero-dependency), ~$8/mo at launch | Scales to ~$550/mo at 10K DAU. All @sentry/* npm packages break Turbopack, so Sentry uses raw HTTP POSTs. |

## Success Criteria

1. **Self-sustaining volume floor**: Mechanical arbitrage (tax flips, Carnage events, soft-peg arb) generates measurable baseline trading volume with zero organic users. The system degrades gracefully to lower APYs rather than death-spiraling.

2. **Real SOL game rewards**: PROFIT stakers earn SOL game rewards funded exclusively by trading taxes. No emissions, no inflation. Rewards are proportional to trading volume and staked PROFIT, verifiable on-chain.

3. **Full immutability path**: All six program upgrade authorities are held by a Squads 2-of-3 multisig with on-chain timelock enforcement. Mint authorities are permanently burned. Authorities will be burned progressively after external audit and stability confirmation, achieving full protocol immutability.

4. **Pre-mainnet testing checkpoint passes**: All Rust tests green (`cargo test --workspace`), all 4 TS integration suites green (90 test cases), all 24 security attack simulations pass, devnet continuous runner completes N epochs without error, Carnage hunter fires successfully, SVK audit findings addressed.

5. **Crank liveness and graceful degradation**: Crank bot runs continuously with Sentry heartbeat monitoring. If crank dies: swaps continue with stale rates, staking works, rewards accumulate safely, Carnage auto-expires after 300 slots. No funds are ever locked. Protocol degrades gracefully.

6. **Operational cost sustainability**: Infrastructure runs under $10/month at launch. The 5% treasury tax split covers ongoing costs. The 0.001 SOL crank bounty sustains gas costs under normal conditions.
<!-- RECONCILIATION_FLAG: Mainnet priority fee economics vs 0.001 SOL bounty needs validation under real congestion. If priority fees consistently exceed bounty, CRANK_BOUNTY_LAMPORTS may need adjustment before authority burn. -->

7. **Bonding curve launch completes**: Both CRIME and FRAUD curves fill (500 SOL each) or both fail (atomic launch). Full proceeds seed SOL pools with price continuity from curve end price to pool start price.

## Glossary

| Term | Definition |
|------|-----------|
| **CRIME** | One of two "IP tokens" (1B fixed supply, Token-2022). Subject to asymmetric taxes on SOL pool trades. Mirrors FRAUD with opposite tax friction. |
| **FRAUD** | The second IP token (1B fixed supply, Token-2022). Mirrors CRIME. When CRIME has low buy tax, FRAUD has high buy tax, and vice versa. |
| **PROFIT** | The reward-bearing bridge token (20M fixed supply, Token-2022). Acquired only by converting CRIME or FRAUD through the conversion vault at 100:1 fixed rate. Must be staked to earn SOL game rewards. |
| **Cheap Side** | The IP token currently favored by the tax regime. It has a low buy tax and a high sell tax. Flips with 75% probability each epoch. |
| **Expensive Side** | The IP token currently disfavored. Has a high buy tax and a low sell tax. The opposite of the cheap side. |
| **Epoch** | A 30-minute period. At each boundary, Switchboard VRF determines the new tax regime (75% flip chance) and samples new tax magnitudes (low: 1-4%, high: 11-14%). Carnage has a 1/24 chance of triggering. |
| **Tax Regime** | The global set of four tax rates (CRIME buy, CRIME sell, FRAUD buy, FRAUD sell) derived from which token is the cheap side. All four rates flip together or not at all. |
| **Carnage** | A protocol-automated chaos mechanism funded by 24% of trading taxes. When triggered (1/24 chance per epoch), spends its entire SOL balance to market-buy CRIME or FRAUD. 98% of the time, the purchased tokens are burned (deflationary). 2% of the time, they're sold to the opposite side (rebalancing). |
| **Soft Peg** | The price relationship between CRIME and FRAUD maintained through the conversion vault (100:1 fixed rate) and tax asymmetry. Directional friction differentials create arb opportunities that bots correct, keeping prices loosely coupled. |
| **Arbitrage Loop** | The canonical route: SOL -> (Tax+AMM) -> cheap side -> (Vault) -> PROFIT -> (Vault) -> expensive side -> (Tax+AMM) -> SOL. Exploits the tax differential after each epoch flip via the conversion vault's fixed 100:1 rate. |
| **Crank Bot** | A permissionless off-chain process that triggers epoch transitions, VRF requests, and Carnage execution. Has no on-chain privileges — anyone can run one. Earns 0.001 SOL bounty per epoch. |
| **Transfer Hook** | Token-2022 extension that validates every CRIME/FRAUD/PROFIT transfer against a whitelist. Only protocol-owned PDAs (pool vaults, escrows) are whitelisted. Blocks all wallet-to-wallet transfers. |
| **Whitelist** | The set of 13 protocol-controlled PDA addresses authorized to send/receive CRIME, FRAUD, and PROFIT (4 SOL pool vaults, 3 conversion vault token accounts, StakeVault, 2 Carnage vaults, 3 admin token accounts). Authority transferred to Squads multisig (retained for future flexibility, not yet burned). |
| **CPI (Cross-Program Invocation)** | Solana's mechanism for programs to call other programs. The protocol's swap path hits the depth-4 maximum: Tax -> AMM -> Token-2022 -> Transfer Hook. |
| **PDA (Program Derived Address)** | Deterministic addresses derived from program seeds. Used for pool vaults, authority PDAs, and cross-program access control (`seeds::program` ensures only the intended program can produce a valid signer). |
| **Swap Authority** | A PDA derived from the Tax Program that the AMM validates as the only authorized swap caller. Ensures swaps can only happen through the tax orchestration layer. |
| **Swap Exempt** | A Tax Program instruction exclusively available to the Carnage signer PDA (from the Epoch Program). Allows Carnage to execute AMM swaps without paying tax. LP fees still apply. |
| **Constant Product (k = x * y)** | The AMM pricing formula. For any swap, `k_after >= k_before` must hold. Output can never equal or exceed the output reserve. Property-tested with 30K iterations. |
| **LP Fee** | A fee retained inside pool reserves on every swap (1% for SOL pools). Compounds permanently, making pools deeper over time. Distinct from tax, which is extracted from the pool. Conversion vault charges zero fees. |
| **Squads Multisig** | A 2-of-3 Squads Protocol multisig that holds upgrade authority during the tiered timelock period before burn. Provides on-chain timelock enforcement (not just a promise). |
| **Tiered Timelock** | The graduated delay on program upgrades: 2 hours at launch, 24 hours after 48-72 hours, then upgrade authority burned completely after 2-4 weeks. |
| **VRF (Verifiable Random Function)** | Switchboard on-demand VRF provides cryptographically verifiable randomness for epoch transitions (regime flip decisions, tax magnitude sampling, Carnage targeting). |
| **ALT (Address Lookup Table)** | Protocol-wide Solana Address Lookup Table (48 addresses) used with v0 VersionedTransactions to fit the Sell path (23 named + 8 remaining accounts) within the 1232-byte TX size limit. |
| **Graceful Degradation** | The protocol's failure mode by design. If the crank bot dies, trading continues with stale tax rates, staking and rewards accumulation work normally, and Carnage auto-expires. No funds are ever locked. The system simply runs at reduced efficiency until cranking resumes. |
| **SVK** | Security Verification Kit — the tooling suite (Stronghold of Security, Dinh's Bulwark, Book of Knowledge) used for security auditing in lieu of an external professional audit firm. |
