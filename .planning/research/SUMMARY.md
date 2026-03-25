# Project Research Summary: v1.2 Bonding Curve Launch System

**Project:** Dr. Fraudsworth's Finance Factory - Bonding Curve Launch (v1.2 milestone)
**Domain:** Solana DeFi - Bonding curve token launch with buy+sell mechanics
**Researched:** 2026-03-03
**Overall Confidence:** MEDIUM-HIGH (HIGH for integration analysis, MEDIUM for novel sell mechanics)

---

## Executive Summary

Dr. Fraudsworth v1.2 adds a bonding curve launch system as the 7th on-chain program to coordinate the initial token distribution before the protocol goes live. Unlike typical pump.fun clones (buy-only, exponential curves), this design features **dual linear curves** (CRIME + FRAUD) with **buy+sell mechanics**, a 15% sell tax, coupled graduation (both must succeed), and proportional refunds on failure. This is a novel combination with no existing forkable implementations.

**Recommended approach: Build from scratch.** All evaluated options (pump.fun clones, Strata Protocol) fail on one or more critical dimensions: Token-2022 support, Anchor 0.32.1 compatibility, dual curves, sell-back integration, or active maintenance. The bonding curve math itself is straightforward (linear integral, quadratic formula, u128 integer arithmetic at 1e12 precision). The complexity lies in the state machine (buy/sell/graduate/refund coordination) and integration with the existing 6-program protocol (Transfer Hook whitelisting, AMM pool seeding, tax escrow routing).

**Critical risks and mitigation:** (1) SOL vault insolvency from rounding errors in buy/sell cycles — mitigated by property testing round-trip invariants and always rounding against users; (2) MEV sandwich attacks on sell-back — mitigated by 15% sell tax and slippage protection; (3) Coupled graduation grief attacks — mitigated by making sell tax non-refundable on failure; (4) CPI depth exhaustion — avoided by keeping the curve as a leaf node (max depth 2, never calling through Tax Program); (5) Transfer Hook whitelist timing — curve vaults must be whitelisted BEFORE authority burn.

---

## Key Findings

### Recommended Stack (from STACK_BONDING_CURVE.md)

**Build from scratch with zero new dependencies.** The existing stack has everything needed:

**On-chain (new program):**
- anchor-lang 0.32.1 + anchor-spl 0.32.1 (token_2022 feature) — consistent with existing 6 programs
- Pure Rust u128 checked arithmetic with 1e12 precision scaling — matches AMM and Staking patterns
- Newton's method integer square root (~15 lines) — no external crate needed
- proptest 1.9 for property-based testing — already used across programs

**Frontend (launch page):**
- Zero new npm dependencies
- Existing Next.js 16.1.6, React 19.2.3, Tailwind v4.1.18 infrastructure
- Existing lightweight-charts 5.1.0 for price curve visualization
- Existing wallet-adapter, Anchor client, and data hooks

**Why no forkable implementations exist:**
- pump.fun clones: Buy-only (no sell-back), exponential curves, SPL Token (not Token-2022)
- Strata Protocol: Archived (2023), Anchor 0.25.x (two versions behind), SPL Token only, complex abstraction layers
- No implementation combines: Token-2022 + Transfer Hook + buy+sell + sell tax + dual curves + conditional tax routing + Anchor 0.32.1

**Critical finding from STACK.md:** The quadratic formula for buy calculations and the reverse integral for sell calculations must be proven correct via property testing (10K+ iterations) BEFORE any other work. Integer division rounding across buy/sell cycles can cause vault insolvency if not carefully controlled.

### Expected Features (from FEATURES_BONDING_CURVE.md)

**IMPORTANT CORRECTION:** The FEATURES researcher flagged sell-back as an anti-feature (AF-01) based on the original buy-only spec. **This is incorrect for v1.2.** The user has explicitly decided to ADD buy+sell mechanics with a 15% sell tax. Treat sell-back as a **confirmed table-stakes feature**, not an anti-feature.

**WHITELIST CLARIFICATION:** Multiple researchers flagged whitelist/Privy as a blocker. **This is not a blocker for v1.2.** The user has decided on OPEN ACCESS (no whitelist/verification for the launch). The per-wallet cap (20M tokens) provides the only sybil resistance. The `WhitelistEntry` check should be removed or no-op for v1.2.

**Table stakes (must have):**
- Dual curve progress display (side-by-side CRIME + FRAUD)
- Current price per token (SOL + USD equivalent)
- Buy interface with SOL input, token output preview, quick-select buttons (0.1, 0.5, 1, 5, 10 SOL)
- **Sell interface with token input, SOL output preview (net of 15% tax)**
- Purchase/sell preview with slippage protection
- 48-hour countdown timer (slot-based, displayed as approximate wall time)
- Transaction status feedback (reuse existing SwapStatus pattern)
- SOL raised / market cap display
- Error handling + pre-validation (minimum purchase, wallet cap, deadline)
- Refund interface (if launch fails)
- Mobile responsive layout

**Differentiators (should have):**
- Cross-curve status messaging in Doctor's voice (contextual to compound state)
- Per-wallet cap indicator (8.5M / 20M progress with mini gauge)
- Price curve visualization (linear trajectory with "you are here" marker)
- Participant count display (social proof + decentralization signal)
- Steampunk pressure gauges (circular dials with brass bezels, not flat progress bars)
- Pool seeding transparency display (exact parameters: 290M tokens + 1,000 SOL, zero arbitrage gap)
- Graduation ceremony visual (steam valves, gears turning, audio sting)

**Explicitly rejected anti-features:**
- Chat/comment section (toxic, requires moderation)
- Creator profile/editing (not a launchpad, this is a protocol launch)
- Pre-sale/insider access (zero team allocation is a core trust feature)
- Candlestick charts during curve (misleading, no market dynamics on deterministic curve)
- Leverage/margin/flash loan integration (amplifies manipulation vectors)
- Referral/affiliate system (perverse incentives, legal exposure)

### Architecture Approach (from ARCHITECTURE_BONDING_CURVE.md)

**Integration model:** The bonding curve is a **pre-protocol launch system** that runs BEFORE the main protocol goes live. It operates as a standalone program during the 48-hour sale window, then hands off to the existing 6 programs via a multi-transaction graduation ceremony.

**CPI depth analysis:** The curve is a **leaf node** calling only Token-2022 (depth 1) which triggers the Transfer Hook (depth 2). Maximum CPI depth across all paths is 2, well under Solana's limit of 4. The curve NEVER enters the Tax -> AMM -> Token-2022 -> Hook chain during operation. Graduation uses client-side orchestration (multiple independent transactions) rather than a single deep CPI chain.

**Major components:**

1. **Bonding Curve Program (7th program)** — Manages buy/sell state machine, curve math, participant tracking
   - CurveState PDA (2 instances: CRIME, FRAUD) — 183 bytes (added tax_escrow, tokens_returned, tax_collected vs original spec)
   - ParticipantState PDA (per user per curve) — 99 bytes (added tokens_sold_back, sol_received, sell_count vs original spec)
   - Token vaults (2) — Hold 460M tokens for sale per curve
   - SOL vaults (2) — Hold raised SOL from purchases
   - Tax escrow PDAs (2) — Hold 15% sell tax separately (routes to carnage on success, included in refund on failure)

2. **Client-side graduation orchestration** — Multi-TX sequence to avoid CPI depth issues
   - TX1: prepare_transition (lock curve state, transfer assets to admin)
   - TX2-3: AMM::initialize_pool for CRIME/SOL and FRAUD/SOL with seed liquidity
   - TX4: Seed conversion vault (250M CRIME + 250M FRAUD + 20M PROFIT)
   - TX5: distribute_tax_escrow to carnage fund
   - TX6: Initialize epoch, staking, carnage (protocol activation)
   - TX7: finalize_transition (mark curves as Transitioned)

3. **Frontend launch page** — New Next.js route with dual-curve UI
   - Reuses existing steampunk component kit, wallet infrastructure, and data hooks
   - New `useBondingCurve` hook for polling both CurveState accounts
   - Client-side curve math for purchase/sell previews (JavaScript number precision adequate for display)

**Critical integration points:**

- **Transfer Hook whitelist (CRITICAL):** Curve token vaults must be whitelisted BEFORE whitelist authority burn. Deployment sequence: deploy curve program -> init curve vaults -> whitelist vaults -> then burn authority. Missing this blocks ALL token transfers.

- **AMM pool seeding:** AMM's `initialize_pool` requires admin signer (not PDA), so curve cannot CPI directly. Client-side orchestration solves this without modifying the battle-tested AMM program.

- **ALT for large transactions:** Graduation transactions need Address Lookup Table for 30+ accounts. Reuse existing alt-helper.ts pattern. Add curve vault addresses to protocol-wide ALT.

### Critical Pitfalls (from PITFALLS_BONDING_CURVE.md)

**Top 5 to watch:**

1. **SOL Vault Insolvency (CRITICAL)** — Buy/sell rounding errors compound over many cycles. If buy formula and sell formula don't perfectly inverse, vault can leak SOL. **Prevention:** Always round against user on sell. Property test 10K+ buy/sell sequences. Track vault lamport balance independently. Master invariant: `vault_balance >= expected_balance - rent_exempt` at all times.

2. **MEV Sandwich Attacks (CRITICAL)** — Linear curve price is predictable. Bot can buy (price increases), user buys at higher price (gets fewer tokens), bot sells at profit. **Prevention:** Deduct 15% sell tax BEFORE computing SOL return (makes sandwiching a 15% loss). Implement `minimum_tokens_out` on buy and `minimum_sol_out` on sell. Protocol-level slippage floor (90-95% for deterministic curve).

3. **Coupled Graduation Grief Attack (CRITICAL)** — Attacker buys on CRIME, griefs FRAUD, both fail, attacker gets refund including sell tax. Zero cost to force failure. **Prevention:** Do NOT refund sell tax on failure (burn it or send to treasury). Refund proportional to current holdings, not peak holdings. Consider disabling sells in final 10% of curve (>900 SOL raised). Alternatively, independent graduation (CRIME succeeds even if FRAUD fails) — design change but eliminates coupled grief vector entirely.

4. **Refund Mechanism Solvency (CRITICAL)** — With buy+sell, the accounting is complex. User buys 100 SOL, sells 50 SOL (gets 42.5 SOL back after tax), net at risk is 57.5 SOL. But if refund uses `sol_spent` (100 SOL), it's wrong. **Prevention:** Use token-proportional refund: `refund = (sol_vault + tax_escrow) * user_tokens / total_tokens_outstanding`. This is always solvent by definition. Use ParticipantState for holdings, not live token account balance (prevents flash loan manipulation).

5. **Transfer Hook Whitelist Capacity (HIGH)** — Curve needs 2 new whitelist entries (CRIME vault, FRAUD vault). Must be added BEFORE whitelist authority burn (one-way door). If burned first, curve program cannot transfer tokens at all. **Prevention:** Extend deployment sequence: deploy curve -> init vaults -> whitelist vaults -> THEN burn. Generate vault PDAs deterministically with known seeds at deploy time.

**Additional pitfalls flagged:**
- CPI depth exhaustion: Keep curve as leaf node, never call through Tax Program
- Clock/slot manipulation at deadline: Use `unix_timestamp` not slots, OR make `Filled` status irreversible regardless of deadline
- Sell tax gaming via same-TX manipulation: 15% tax makes round-trips unprofitable; consider 1-slot cooldown between sell and buy
- execute_transition account limit (32 accounts + 12 hook remaining = 44): Requires ALT + v0 VersionedTransaction
- Rent-exempt minimum in SOL vault: Always subtract rent-exempt before distributing, use same pattern as Carnage vault

---

## Implications for Roadmap

Based on research, the v1.2 bonding curve implementation divides into 5 clear phases:

### Phase 1: Core Curve Program (Buy-Only Foundation)
**Rationale:** Build the mathematical foundation and basic buy flow first. Prove correctness of curve math BEFORE adding sell complexity. This phase delivers a working buy-only curve that can be tested end-to-end.

**Delivers:**
- Bonding curve program scaffold (Anchor 0.32.1)
- CurveState, ParticipantState account structures
- Curve math module (linear integral, quadratic solver, integer square root)
- initialize_curve, fund_curve, start_curve, purchase instructions
- mark_failed, claim_refund instructions
- Unit tests for curve math (precision, overflow, edge cases)
- Property tests for buy invariants (10K+ iterations)
- Integration tests on localnet

**Addresses features:** TS-01 (progress), TS-02 (price), TS-03 (buy interface core)

**Avoids pitfalls:** C-1 (insolvency via proven math), C-5 (precision loss via property testing)

**Research flag:** Standard bonding curve math. Skip phase-specific research.

---

### Phase 2: Sell-Back Mechanics + Tax Escrow
**Rationale:** Once buy flow is proven, add sell-back. This is the riskiest architectural addition. Requires careful state accounting (tokens_sold can decrease), tax escrow routing, and round-trip property testing.

**Delivers:**
- sell instruction with reverse integral calculation
- Tax escrow PDAs (2, one per curve)
- Tax collection (15%) and escrow routing logic
- Update ParticipantState with sell tracking (tokens_sold_back, sol_received, sell_count)
- claim_tax_refund instruction
- Sell tax distribution logic (carnage on success, refund on failure)
- Unit tests for reverse math
- Property tests for buy/sell round-trip invariants
- Integration tests for sell-back + tax + refund paths

**Addresses features:** TS-03 (sell interface), D-03 (cap indicator with sell tracking)

**Avoids pitfalls:** C-2 (MEV via 15% tax + slippage), C-3 (grief via non-refundable tax), C-4 (refund solvency via token-proportional), H-4 (tax gaming via cooldown consideration)

**Research flag:** Novel sell mechanics. May need mid-phase security review of tax escrow accounting.

---

### Phase 3: Transfer Hook Integration + Graduation System
**Rationale:** With buy+sell proven, integrate with existing protocol. This phase connects the standalone curve program to the 6-program ecosystem via Transfer Hook whitelisting and multi-TX graduation orchestration.

**Delivers:**
- Transfer Hook whitelist entries for curve vaults (extend initialize.ts)
- hook_helper.rs for Token-2022 transfer_checked with remaining_accounts forwarding (copy from Conversion Vault)
- check_transition_ready, prepare_transition, finalize_transition instructions
- distribute_tax_escrow instruction
- Graduation orchestration script (multi-TX client-side sequence)
- ALT extension with curve addresses
- Integration test: full lifecycle (init -> fund -> start -> buy -> sell -> fill -> graduate)
- Integration test: failure path (init -> fund -> start -> buy -> timeout -> refund + tax refund)

**Addresses architecture:** Transfer Hook integration, AMM pool seeding, Conversion Vault seeding, epoch/staking initialization

**Avoids pitfalls:** H-1 (whitelist timing via deployment sequence), H-2 (CPI depth via client orchestration), H-5 (hook accounts via proven helper), H-6 (account limit via ALT)

**Research flag:** Skip research (reusing existing patterns from 6 programs). May need design discussion on independent vs coupled graduation (open question from ARCHITECTURE.md Section 15).

---

### Phase 4: Frontend Launch Page
**Rationale:** With on-chain program complete and tested, build the user-facing launch page. This phase delivers the public-facing UI that drives adoption.

**Delivers:**
- New Next.js route `/launch` (or modal in factory scene)
- `useBondingCurve` hook (WebSocket + polling hybrid for both CurveState accounts)
- Client-side curve math for purchase/sell previews (JavaScript number precision)
- Dual curve progress visualization (steampunk pressure gauges)
- Buy interface with SOL input, token output preview, quick-select buttons
- Sell interface with token input, net SOL output (after 15% tax)
- Cross-curve status messaging (Doctor's voice, contextual to compound state)
- Per-wallet cap indicator
- 48-hour countdown timer (slots -> approximate wall time)
- Refund UI (conditional on Failed status)
- Price curve visualization (linear trajectory with position marker)
- Participant count display
- Transaction status feedback (reuse SwapStatus pattern)
- Mobile responsive layout
- Purchase activity feed (optional, D-07 "nice to have")

**Addresses features:** All table stakes (TS-01 through TS-11), most differentiators (D-01 through D-12)

**Avoids pitfalls:** M-3 (stale price via WebSocket), L-2 (event indexing for sells)

**Research flag:** Standard Next.js frontend. Skip research. Design decision needed: single page with both curves vs sub-routes (recommend single page for coordination visibility).

---

### Phase 5: Deployment Pipeline Integration + Testing
**Rationale:** Final phase integrates the curve into deploy-all.sh, extends initialize.ts, and runs full devnet end-to-end testing before mainnet. This phase ensures the curve works within the existing deployment infrastructure.

**Delivers:**
- Add bonding curve program to build.sh with devnet feature flag
- Extend deploy-all.sh pipeline (Phase 0-7 with curve-specific steps)
- Update initialize.ts: mint tokens -> fund curve vaults -> whitelist curve vaults -> burn authority
- Feature-gated mint addresses for bonding curve program (like Conversion Vault)
- Devnet end-to-end test: deploy all 7 programs -> initialize -> start curves -> buy/sell activity -> graduate OR fail
- Graduation orchestration script (separate from deploy-all, called manually or by admin)
- Mainnet checklist updates (curve-specific devnet->mainnet switches)
- Crank bot updates (if curve needs ongoing monitoring during 48-hour window)

**Addresses architecture:** Deployment sequence, whitelist authority burn timing, feature flags

**Avoids pitfalls:** INT-1 (whitelist burn timing via explicit sequence), INT-2 (ALT extension), INT-3 (carnage fund routing), INT-4 (test isolation)

**Research flag:** Skip research (extending existing deployment patterns).

---

### Phase Ordering Rationale

**Why math-first (Phase 1):** Bonding curve math is the foundation. If the curve math has insolvency bugs, nothing else matters. Property testing buy invariants BEFORE adding sell complexity reduces the risk surface.

**Why sell separate (Phase 2):** Sell-back is the riskiest architectural addition. Separating it from buy allows incremental testing. Buy-only curve can be validated independently, then sell adds complexity on a proven foundation.

**Why graduation after buy+sell (Phase 3):** Graduation requires both buy and sell to be working (for full lifecycle testing). Graduation also depends on Transfer Hook integration, which is easier to test with a working buy/sell flow. Client-side orchestration avoids modifying the AMM.

**Why frontend after on-chain (Phase 4):** Standard practice. On-chain program must be deployed and testable before building the UI that calls it. Frontend can be built in parallel with Phase 5 (deployment integration) if team wants to parallelize.

**Why deployment last (Phase 5):** Deployment pipeline changes affect the entire protocol. Better to finalize the curve program architecture (Phases 1-3) and have a working frontend (Phase 4) before integrating into deploy-all.sh. This phase is mostly scripting and testing, not new development.

**Dependency chain:**
- Phase 2 depends on Phase 1 (math proven)
- Phase 3 depends on Phase 2 (buy+sell working)
- Phase 4 depends on Phase 3 (on-chain deployed to localnet/devnet)
- Phase 5 depends on Phase 3+4 (program + frontend complete)

**Risk mitigation:**
- Phase 1 property testing addresses C-1, C-5 (insolvency, precision)
- Phase 2 sell tax + refund logic addresses C-2, C-3, C-4 (MEV, grief, refund solvency)
- Phase 3 whitelist + CPI depth + ALT addresses H-1, H-2, H-5, H-6 (integration pitfalls)
- Phase 4 WebSocket + slippage + UX addresses M-3, L-2 (stale data, event indexing)
- Phase 5 deployment sequence addresses INT-1, INT-2, INT-3 (whitelist burn, ALT, carnage routing)

---

### Research Flags

**Phases needing deeper research DURING planning:**
- None. All phases reuse existing patterns or implement well-understood bonding curve math. The sell-back mechanics are novel but the math is straightforward (reverse integral). Property testing validates correctness.

**Phases with standard patterns (skip research-phase):**
- Phase 1: Standard bonding curve math (linear integral, quadratic formula)
- Phase 2: Reverse integral is well-documented in bonding curve literature
- Phase 3: Reuses Transfer Hook patterns from existing 6 programs
- Phase 4: Standard Next.js frontend
- Phase 5: Extends existing deploy-all.sh patterns

**Open design questions to resolve BEFORE Phase 2:**
1. **Whitelist enforcement (BLOCKER resolution):** User has decided OPEN ACCESS (no whitelist/verification). Remove `WhitelistEntry` check or no-op it. Update FEATURES researcher's AF-01/D-10 findings.
2. **Sell when Filled:** Should selling be allowed after a curve reaches Filled status? Recommend: NO (once Filled, no more selling until graduation or partner failure). Prevents grief via last-minute dump attacks.
3. **Refund calculation:** Token-proportional (recommended) vs sol-spent-based. Recommend token-proportional for solvency guarantees.
4. **Independent vs coupled graduation:** Current design requires both curves to graduate together. Alternative: CRIME succeeds even if FRAUD fails. This is a MAJOR design change. Recommend: stick with coupled graduation for v1.2, consider independent for v1.3 if grief attacks are observed.
5. **Sell tax refund on failure:** Recommend NON-refundable (burn or send to treasury). This removes the grief incentive. User decision required.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | All dependencies already in use. Zero new npm packages. Anchor 0.32.1 validated across 6 programs. u128 precision math matches existing patterns. |
| **Features** | HIGH | Comprehensive analysis based on pump.fun domain knowledge, project specs (1500-line Bonding_Curve_Spec.md), and existing steampunk component kit. Corrected FEATURES researcher's sell-back misclassification. |
| **Architecture** | HIGH | Direct source code analysis of all 6 existing programs. CPI depth verified. Transfer Hook whitelist logic confirmed. AMM pool init constraints verified. Client-side orchestration pattern proven in existing codebase. |
| **Pitfalls** | MEDIUM | HIGH confidence for integration pitfalls (verified against codebase). MEDIUM for sell-back exploits (novel mechanics, needs security review). Training data for pump.fun/moonshot exploits not live-verified (pre-May 2025). Core math pitfalls (insolvency, precision) are HIGH confidence based on direct analysis. |

**Overall confidence: MEDIUM-HIGH**

Confidence is HIGH for everything related to integrating with the existing 6-program protocol (Transfer Hook, AMM, CPI depth, deployment sequence). Confidence is MEDIUM for the novel sell-back mechanics (15% tax, tax escrow routing, grief attack vectors) because no existing implementation combines this exact feature set. Property testing and security review during Phase 2 will raise confidence to HIGH.

### Gaps to Address During Planning/Execution

**Open design decisions (require user input BEFORE Phase 2):**
- **Whitelist enforcement:** Already resolved by user (OPEN ACCESS). Update all references to WhitelistEntry checks.
- **Sell when Filled:** Recommend disabling sells once Filled status is reached. Prevents last-minute grief attacks.
- **Sell tax refund policy:** Recommend non-refundable (burn or treasury) to remove grief incentive.
- **Independent vs coupled graduation:** Recommend coupled for v1.2. Note for future: independent graduation eliminates grief vector but adds complexity.

**Technical validations needed during implementation:**
- **Property test coverage:** Buy/sell round-trip must be tested at 10K+ iterations across all `tokens_sold` positions (0 to 460M). This is Phase 1 critical path.
- **Sell tax escrow solvency:** Verify `vault_balance + tax_escrow_balance >= sum(all_possible_refunds)` at every state transition. Phase 2 critical path.
- **Transfer Hook account resolution:** Verify curve vault whitelist entries work for both buy (vault->user) and sell (user->vault) directions. Phase 3 critical path.
- **Graduation TX size:** Measure full graduation TX byte size with all accounts + hook remaining_accounts. Verify ALT reduces it below 1232 bytes for v0 TX. Phase 3 critical path.

**Deployment sequence verification:**
- **Whitelist authority burn timing:** Curve vaults must be whitelisted BEFORE burn. Explicit check in deploy-all.sh. Phase 5 critical path.
- **Feature-gated mint addresses:** Bonding curve program needs devnet/mainnet mint address features like Conversion Vault. Build.sh two-pass build. Phase 5.

**Security review points:**
- Phase 1: Property test results for buy invariants (no overflow, precision loss, insolvency)
- Phase 2: Property test results for buy/sell round-trip (returned_sol <= spent_sol after tax)
- Phase 2: Tax escrow accounting model (separate PDA vs tracked field) — recommend separate PDA for auditability
- Phase 3: Graduation orchestration error handling (what if TX2 succeeds but TX3 fails?) — needs retry/recovery mechanism
- Phase 4: Slippage defaults (recommend 2-5% for curve buys, tighter than AMM because price movements smaller on linear curve)

---

## Sources

### Primary Sources (HIGH confidence)

**Project specs:**
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/Bonding_Curve_Spec.md` (1500 lines, comprehensive on-chain design)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/frontend-spec.md` (steampunk component kit, data hooks)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/project-overview.md` (design philosophy, zero-team-allocation)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs-site/content/launch/bonding-curve.mdx` (user-facing narrative)

**Existing codebase (direct analysis):**
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/` — Pool init, swap, transfers, math.rs checked arithmetic patterns
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/` — Whitelist logic, hook handler, ExtraAccountMetaList
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/` — CPI patterns, swap_exempt, tax calculations
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/` — Carnage execution, CPI depth chains
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/` — Transfer hook helper pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/conversion-vault/` — Initialize pattern, hook_helper.rs
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/` — deploy-all.sh, initialize.ts, build.sh
- `/Users/mlbob/Projects/Dr Fraudsworth/MEMORY.md` — Project-specific gotchas (hook accounts=4, ALT for large TX, v0 TX skipPreflight, etc.)

**Domain knowledge (verified against project context):**
- pump.fun mechanics (buy-only, exponential curves, 85 SOL graduation) — used for contrast, not as template
- Bonding curve math literature (linear integral, quadratic formula, integer square root)
- Solana CPI depth limit (4, documented in architecture.md and swap_exempt.rs comments)
- Token-2022 Transfer Hook patterns (4 remaining_accounts per mint, already proven in 6 programs)

### Secondary Sources (MEDIUM confidence)

**Training data (pre-May 2025):**
- pump.fun UI patterns (progress bar, buy interface, market cap display) — core patterns stable across all bonding curve platforms
- Strata Protocol architecture (buy+sell bonding curves, Anchor-based, archived 2023) — used for feasibility assessment, not as fork candidate
- Known Solana MEV patterns (Jito bundles, sandwich attacks) — general patterns applicable, not curve-specific exploits
- Solana bonding curve repos on GitHub (~10 evaluated, none suitable for forking per STACK research)

**Caveats on training data:**
- pump.fun exploit details (front-running, graduation snipe, bundled buys) mentioned in PITFALLS.md are not live-verified (WebSearch unavailable during research). Core principles (MEV exists, slippage protection needed) are verified practices.
- Strata Protocol status (archived, Anchor 0.25.x) from training data. Actual repo state should be verified with `gh repo view strata-foundation/strata` if considering as reference.

### Tertiary Sources (LOW confidence, flagged for verification)

**Training data requiring live verification:**
- pump.fun current sell tax (if any) — training data says buy-only, but verify before claiming no sell exists
- moonshot oracle manipulation vectors — mentioned in PITFALLS.md but not directly applicable (Dr. Fraudsworth uses no oracles)
- GitHub repo stars/activity for pump.fun clones — STACK.md assessments based on training data, not live search

**Not used as sources (explicitly excluded):**
- General bonding curve theory not specific to Solana — avoided generic crypto whitepapers
- EVM bonding curve implementations — different VM, not applicable
- Uniswap V3 concentrated liquidity — not a bonding curve, different mechanism

---

**Research completed:** 2026-03-03

**Ready for roadmap:** Yes. 5-phase structure with clear dependencies, pitfall mapping, and research flags. All open questions documented for user resolution before Phase 2 kickoff.

**Next step:** Load this summary into roadmapper agent context. Roadmapper should use the 5-phase structure as a starting point, expand with specific tasks/deliverables per phase, and flag the open design decisions (whitelist, sell-when-filled, tax refund policy, independent graduation) for user input during requirements definition.
