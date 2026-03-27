---
topic: "Architecture"
topic_slug: "architecture"
status: complete
interview_date: 2026-02-20
decisions_count: 5
provides: ["architecture-decisions"]
requires: []
verification_items: []
---

# Architecture — Decisions

## Summary
The protocol uses a 6-program Anchor/Rust architecture composed via CPI, with a planned path to full immutability via tiered timelock and eventual upgrade authority burn. No emergency pause mechanism — the protocol is designed to be fully decentralized and autonomous once burned.

## Decisions

### D1: Six-Program Split
**Choice:** Six separate Anchor programs (AMM, Tax, Epoch/VRF, Staking, Transfer Hook, Conversion Vault) composed via CPI.
**Rationale:** Transfer Hook must be a separate program (Token-2022 requirement). Combined codebase (~28.7K LOC) would exceed BPF loader size limits as a monolith. Separation provides independent upgrade/freeze capability per program and clean separation of concerns. Conversion Vault handles PROFIT token conversion at a fixed 100:1 rate (PROFIT -> CRIME/FRAUD), replacing the former PROFIT AMM pools with a simpler, deterministic mechanism.
**Alternatives considered:** Monolithic program (infeasible due to size limits), fewer programs with AMM+Tax merged (would eliminate one CPI hop and reduce account count, but couples AMM to tax logic and loses independent deployability).
**Known costs:** CPI depth budget fully consumed (depth-4 chains at Solana max), Sell path requires ALT + v0 VersionedTransaction (23 named + 8 remaining accounts exceeds 1232-byte TX limit), deployment must be sequenced.
**Affects docs:** [architecture, cpi-interface-contract, deployment-sequence]

### D2: Full Immutability — Burn All Upgrade Authorities
**Choice:** All 6 programs will have their upgrade authority burned after mainnet stabilization. No features will be added post-burn. The protocol either thrives or dies on the deployed code.
**Rationale:** Immutability is the ultimate trust signal for a decentralized memetic DeFi protocol. Users can verify the code and know it will never change. Adding an upgrade path is a centralisation vector.
**Alternatives considered:** Keeping selective programs upgradeable (e.g., Hook), governance-controlled upgrades. Both rejected as contrary to the fully decentralized ethos.
**Affects docs:** [architecture, security-model, deployment-sequence, mainnet-readiness-assessment, operational-runbook]

### D3: Tiered Timelock Before Burn
**Choice:** Graduated timelock on upgrade authority: 2-hour delay at launch, extended to 24-hour delay after 48-72 hours, then burned completely after 2-4 weeks.
**Rationale:** Provides a safety runway for critical bug fixes in the early mainnet hours without a kill switch. Users can monitor for pending upgrades and exit if they disagree. The graduating delay builds trust incrementally.
**Alternatives considered:** Immediate burn at launch (too risky — no bug fix window), permanent timelock without burn (still a centralisation vector).
**Affects docs:** [deployment-sequence, security-model, mainnet-readiness-assessment, operational-runbook]

### D4: Squads Multisig (2-of-3)
**Choice:** Upgrade authority held by a Squads Protocol multisig with 2-of-3 signer threshold. Squads provides the timelock enforcement on-chain.
**Rationale:** Squads is the most battle-tested multisig on Solana (formally verified by OtterSec). On-chain timelock enforcement means users don't have to trust a promise — they can verify the delay. 2-of-3 prevents single-point-of-failure key loss while keeping operational agility.
**Alternatives considered:** Single keypair (no timelock enforcement, single point of failure), custom timelock program (more code to audit), manual timelock promise (no on-chain guarantee).
**Affects docs:** [security-model, deployment-sequence, mainnet-readiness-assessment]

### D5: No Emergency Pause
**Choice:** No pause mechanism. No `is_paused` flag, no `set_paused` instruction, no pause checks in any program.
**Rationale:** An emergency pause is a centralisation vector that contradicts the decentralized protocol ethos. The protocol is relatively simple by DeFi standards, and the tiered timelock provides a bug-fix window pre-burn. Post-burn, the response to an exploit is for users to exit — the protocol cannot be changed.
**Alternatives considered:** Global pause flag with pause authority (rejected — centralisation), rate limiting / per-epoch volume caps (discussed, not pursued).
**Affects docs:** [security-model, operational-runbook, mainnet-readiness-assessment]

## Open Questions
(None — all architecture decisions are firm.)

## Raw Notes
- The 6-program split was originally a Claude recommendation during initial development (as 5 programs). The 6th program (Conversion Vault) was added when PROFIT AMM pools were replaced with a fixed-rate vault. User validated it during this interview after reviewing trade-offs.
- Phase 49 (Protocol Safety & Events) explicitly documents the emergency pause decline — see `.planning/phases/49-protocol-safety-events/49-CONTEXT.md`.
- The "fix bugs on mainnet" window is the tiered timelock period. After burn, there is no recourse for bugs — this is intentional.
- No future features planned. Post-burn, the codebase is frozen permanently.
