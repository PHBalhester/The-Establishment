---
topic: "Security & Access Control"
topic_slug: "security"
status: complete
interview_date: 2026-02-20
decisions_count: 14
provides: ["security-decisions"]
requires: ["architecture-decisions", "cpi-architecture-decisions", "amm-design-decisions"]
verification_items: ["carnage-fallback-front-running-frequency"]
---

# Security & Access Control — Decisions

## Summary
The protocol's security model centres on permissionless operation, full immutability post-burn, and graceful degradation. Five actor types interact with the system (users, deployer, crank bot, arb bots, attackers). All privileged operations are either one-time initializations, cross-program PDA-gated, or scheduled for authority burn before mainnet. The threat model covers economic attacks (sandwiching, front-running, arb gaming), VRF manipulation, transfer hook bypass, and crank liveness — all assessed at the code level.

## Decisions

### D1: Actor Model
**Choice:** Five actor types: regular users, deployer (pre-burn only), crank bot (permissionless, no on-chain privileges), arb bots (permissionless, by-design participants), and attackers.
**Rationale:** The crank bot is intentionally just a regular wallet with no special authority. Anyone can perform its functions. Arb bots are welcome — they maintain the soft peg and pay taxes that fund yield.
**Alternatives considered:** Privileged crank role (rejected — centralisation vector, single point of failure).
**Affects docs:** [security-model, operational-runbook]

### D2: Privileged Operation Inventory
**Choice:** Beyond program upgrades, two live admin keys exist post-deployment: AMM admin (pool creation) and Transfer Hook whitelist authority. Both will be burned.
**Rationale:** Code audit identified 6 privileged instruction types: (1) AMM initialize_admin (upgrade authority gated), (2) AMM initialize_pool (admin gated), (3-5) Transfer Hook whitelist management (authority gated), (6) force_carnage (devnet-only, feature-gated). Cross-program gating (deposit_rewards, swap_exempt) is PDA-based and not human-controlled.
**Alternatives considered:** Keeping admin keys live for operational flexibility (rejected — contradicts immutability decision).
**Affects docs:** [security-model, deployment-sequence, mainnet-readiness-assessment]

### D3: AMM Admin Burn
**Choice:** Add a `burn_admin` instruction to the AMM program (setting admin to Pubkey::default). Call it after all pools are created but before upgrade authority burn.
**Rationale:** Without burning, a compromised admin key could create rogue pools post-burn. No legitimate reason to create new pools after launch. Instruction must be added before upgrade authority burn (can't add code after).
**Alternatives considered:** Leave admin live (risk of rogue pool creation), set admin to dead address without instruction (no clean mechanism exists).
**Affects docs:** [security-model, deployment-sequence, mainnet-readiness-assessment, architecture]

### D4: Whitelist Authority Burn Sequencing
**Choice:** Burn whitelist authority after all whitelisting is complete and triple-verified (AI + manual), before upgrade authority burn. No new addresses will ever need whitelisting.
**Rationale:** The whitelist covers 14 protocol-controlled PDAs/vaults. Post-burn protocol has no new features, so no new integrations requiring whitelist entries. Burning before upgrade authority provides a safety window — if the burn breaks something, code can still be redeployed.
**Alternatives considered:** Burn after upgrade authority (riskier — no rollback if broken), keep authority live (centralisation vector).
**Affects docs:** [security-model, deployment-sequence]

### D5: Authority Burn Sequencing (Full Lifecycle)
**Choice:** Ordered sequence: (1) Deploy and initialise, (2) Create all pools, complete all whitelisting, (3) Verify whitelist (AI + manual), (4) Burn whitelist authority, (5) Burn AMM admin, (6) Enter tiered timelock (2hr → 24hr), (7) Burn all 5 upgrade authorities.
**Rationale:** Each step is irreversible, so ordering provides maximum safety runway. Earlier burns are validated while code is still modifiable.
**Alternatives considered:** Parallel burns (riskier), single ceremony (no fallback window).
**Affects docs:** [deployment-sequence, security-model, mainnet-readiness-assessment, operational-runbook]

### D6: Sandwich Attack Resistance
**Choice:** Accept dual-layer slippage protection as sufficient. No additional anti-MEV measures needed.
**Rationale:** Code-level audit confirmed: (1) AMM enforces user-specified `minimum_amount_out`, (2) Tax Program enforces 50% output floor (MINIMUM_OUTPUT_FLOOR_BPS = 5000) calculated from current pool reserves pre-CPI. The asymmetric tax itself acts as a poison pill — 18% round-trip cost (e.g., 4% buy + 14% sell) makes most sandwiches uneconomical.
**Alternatives considered:** Jito bundle API for atomic execution (unnecessary given tax deterrent), TWAP oracles (not applicable — protocol uses own AMM prices).
**Affects docs:** [security-model, token-economics-model, liquidity-slippage-analysis]

### D7: Carnage Front-Running Mitigation
**Choice:** Accept the atomic lock window (50 slots) + 75% fallback slippage floor as sufficient. Monitor fallback path frequency on mainnet.
**Rationale:** Atomic path (happy path) has zero front-running window — consume_randomness and Carnage execute in same TX. Fallback path (when atomic fails) creates a 50-250 slot window but is protected by 75% slippage floor. Frequency of fallback path is unknown — currently fixing atomic execution, needs devnet validation.
**Alternatives considered:** Longer lock window (delays recovery), tighter fallback slippage (risks Carnage revert on thin pools).
**Affects docs:** [security-model, oracle-failure-playbook, liquidity-slippage-analysis]

### D8: VRF Reveal Window — Accepted MEV Opportunity
**Choice:** Accept the ~3-slot window between VRF reveal and consume_randomness as a known MEV concern. No mitigation needed.
**Rationale:** During this window, an observer can read revealed VRF bytes and predict the new cheap side before tax rates update. However, this is functionally equivalent to arb bot behaviour (trading on tax asymmetry), which is the protocol's intended volume-generation mechanism. The arb corrects the soft peg and pays taxes.
**Alternatives considered:** Bundling consume_randomness with Switchboard reveal IX (adds complexity, marginal benefit given arb is desired).
**Affects docs:** [security-model, oracle-failure-playbook]

### D9: Transfer Hook Bypass — Fully Mitigated
**Choice:** Rely on implementation correctness (all code uses transfer_checked, never plain transfer) and multi-layer validation (Token-2022 ExtraAccountMetaList resolution, hook PDA re-derivation, transferring flag check).
**Rationale:** Code audit confirmed: no plain `transfer` calls for Token-2022 tokens anywhere in the codebase. Users interact through Tax Program → AMM CPI chain, never directly with Token-2022. All 14 whitelisted addresses are protocol-controlled PDAs — no user wallets, no pass-through exploits. Hook blocks transfers (atomic revert), not just logs.
**Alternatives considered:** No mint-level `require_transfer_hook` flag exists in Token-2022, so enforcement is implementation-based (standard pattern).
**Affects docs:** [security-model, token-interaction-matrix]

### D10: Crank Bot Liveness — Graceful Degradation
**Choice:** Accept permissionless cranking with bounty incentives. No dedicated crank infrastructure or redundancy required beyond the team's own runner.
**Rationale:** Code audit confirmed all epoch operations are permissionless (no authority checks). trigger_epoch_transition pays 0.001 SOL bounty from Carnage vault. If crank bot dies: swaps continue with stale tax rates, staking/unstaking works normally, yield accumulates but isn't finalised, Carnage auto-expires after 300 slots. No funds are ever locked. Protocol degrades gracefully.
**Alternatives considered:** Clockwork/automation network (adds dependency), privileged crank role (centralisation).
**Affects docs:** [security-model, operational-runbook, oracle-failure-playbook]

### D11: Security Tooling — SVK Suite Only
**Choice:** Use SVK tooling (Stronghold of Security, Dinh's Bulwark, Book of Knowledge) for security auditing. No external professional auditor engagement planned.
**Rationale:** User decision based on budget and project scope. SVK provides on-chain program auditing (SOS), off-chain code auditing (DB), and math verification (BOK).
**Alternatives considered:** Professional audit firms (OtterSec, Neodyme, Trail of Bits) — not pursuing due to budget constraints.
**Affects docs:** [security-model, mainnet-readiness-assessment]

### D12: No Bug Bounty Program
**Choice:** No bug bounty program (Immunefi or otherwise) planned for devnet or mainnet.
**Rationale:** User decision. The tiered timelock provides a bug-fix window pre-burn, and post-burn the protocol is immutable.
**Alternatives considered:** Immunefi program (not pursuing).
**Affects docs:** [security-model, mainnet-readiness-assessment]

### D13: Incident Response Post-Burn
**Choice:** Post-burn, the only response to a discovered vulnerability is for users to exit. No kill switch, no governance intervention, no remediation path.
**Rationale:** Consistent with D5 (Architecture: No Emergency Pause) and full immutability decision. The protocol either works or it doesn't — this is the trust model.
**Alternatives considered:** None — this follows directly from the immutability decision.
**Affects docs:** [security-model, operational-runbook]

### D14: Sensitive Data Handling
**Choice:** Address three identified issues before mainnet: (1) rotate and gitignore `.mcp.json` private key, (2) implement backend RPC proxy to hide Helius API key from client-side code, (3) configure Helius webhook secret for authenticated webhook ingestion. Crank bot hot wallet on mainnet should hold minimal SOL (gas-only buffer).
**Rationale:** Code audit found: `.mcp.json` has a devnet private key in git history, `NEXT_PUBLIC_RPC_URL` exposes Helius API key in browser JS, webhook endpoint is currently unauthenticated. All other secrets are properly managed (.env gitignored, keypairs have 600 permissions, database config server-side only, CSP headers well-configured).
**Alternatives considered:** N/A — these are hygiene items, not design choices.
**Affects docs:** [security-model, operational-runbook, deployment-sequence, frontend-spec]

## Open Questions
- [ ] Carnage fallback path frequency — how often does atomic execution fail on devnet? Determines whether fallback front-running window is theoretical or practical. — confidence: medium, source: interview

## Raw Notes
- force_carnage instruction is devnet-only behind `#[cfg(feature = "devnet")]` — must be absent from mainnet build. Already tracked in mainnet checklist.
- The Solana domain pack's program-security-lessons knowledge file was consulted. Protocol already follows all Priority 1 and Priority 2 recommendations (Anchor signer/owner checks, account type validation, hardcoded CPI targets, checked arithmetic, PDA canonical bumps). Oracle validation is handled through Switchboard SGX rather than traditional price oracles.
- The 50% output floor (MINIMUM_OUTPUT_FLOOR_BPS = 5000) ignores LP fees in its calculation. At 50% tolerance, the ~1% LP fee is well within the margin.
- Cross-program gating (deposit_rewards gated to Tax PDA, swap_exempt gated to Epoch PDA) provides structural access control that survives authority burns.
- User-to-user OTC transfers of CRIME/FRAUD are blocked by the transfer hook (neither party whitelisted). This is intentional — all trading goes through the AMM.
