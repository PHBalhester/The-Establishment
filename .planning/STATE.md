---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Post-Launch Hardening & Expansion
status: in_progress
stopped_at: Completed 108-04 (regression tests + unit tests for Phase 108)
last_updated: "2026-03-26T22:35:00Z"
last_activity: 2026-03-26 -- Completed 108-04 (unit tests + live regression for Phase 108 security fixes)
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 12
  completed_plans: 11
  percent: 92
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-25)

**Core value:** Real SOL yield from real trading friction -- not ponzinomics.
**Current focus:** v1.5 Post-Launch Hardening & Expansion

## Current Position

Phase: 108 of 109 (zAuth Vulnerability Remediation)
Plan: 4 of 4 in phase (108-04 complete; 108-03 manual infra pending user execution)
Status: Phase 108 code complete. 108-03 manual infra (Cloudflare + Railway URL) pending. Next: Phase 109.
Last activity: 2026-03-26 -- Completed 108-04 (27 unit tests + live regression for Phase 108 security fixes)

Progress: [█████████-] 92% (v1.5 overall)

## Performance Metrics

**Velocity (cumulative):**
- Total plans completed: 360 (across v0.1-v1.5)
- Milestones shipped: 14
- Total phases: 109

**By Milestone (recent):**

| Milestone | Phases | Plans | Days |
|-----------|--------|-------|------|
| v1.2 Bonding Curves | 8 | 25 | 5 |
| v1.3 Hardening | 16 | 45 | 5 |
| v1.4 Pre-Mainnet | 16 | 58 | 14 |

## Accumulated Context

### Decisions

- CRANK first (off-chain only, immediate SOL savings, no on-chain changes)
- VAULT second (on-chain upgrade via Squads, fixes live multi-hop UX bug)
- JUP last (largest scope, off-chain SDK, external Jupiter team review dependency)
- CRANK-03 is research that feeds CRANK-04 implementation (sequential within Phase 105)
- convert_v2 is NEW instruction alongside existing convert (backwards compatible)
- Jupiter SDK is isolated workspace member at sdk/jupiter-adapter/ (never touches BPF)
- USDC pools deferred to v1.6 (4+ unresolved design decisions)
- 105-01: Inline close stale accounts before return (not after) -- ensures cleanup even if caller throws
- 105-01: TOCTOU path closes both stalePubkey AND retryRngKp since neither is returned
- 105-01: Periodic sweep at START of cycle (before TX1) to avoid racing active randomness
- 105-02: Happy-path tryReveal uses 5 attempts (~31s), recovery keeps 10 (~93s)
- 105-02: commitToRevealSlots = 0 for recovery paths (commit was in prior cycle)
- 105-02: JSON log snake_case for VRF instrumentation fields
- 105-03: HTML parse_mode over MarkdownV2 (avoids escaping pitfalls)
- 105-03: Single alert event only: circuit breaker trip (not low balance, not VRF recovery)
- 105-03: Cooldown updates on both success AND fetch errors to prevent API hammering
- 106-01: Owner check in handler (not struct) to preserve shared Convert struct behavior
- 106-01: Conditional cfg imports for feature-gated compute functions
- 106-01: No pub use for convert_v2 module to avoid ambiguous handler re-export
- 106-03: SOS diff-audit CLEARED convert_v2 with 0 findings across 8 security checks
- 106-02: IDL synced manually (no sync-idl.mjs exists); useSwap.ts needed zero changes
- 106-02: isMultiHopStep defaults to false for backwards compatibility in buildStepTransaction
- 106.1-01: skipPreflight:true forced centrally in useProtocolWallet devnet branch (not per-callsite)
- 106.1-01: multi-hop-builder passes skipPreflight:false as mainnet default; useProtocolWallet overrides on devnet
- 106-04: Split-route vault steps at leg boundaries use exact amounts, not convert-all (prevents greedy consumption)
- 106-04: Large swap Blowfish preview deferred to mainnet (devnet simulation unreliable)
- 106-04: All 8 multi-hop routes verified on devnet with zero intermediate token leakage
- 108-01: Public health response stripped to { status, timestamp } -- HEALTH_SECRET gates full diagnostics
- 108-01: sendTransaction 10/min, simulateTransaction 20/min per-method limits (additive with shared 300/min)
- 108-01: 16 RPC methods in allowlist (plan said 17, actual count is 16), all documented
- 108-02: Production HTTPS-only frame-ancestors (removed localhost, Railway dev URL from docs CSP)
- 108-02: Keep unsafe-inline for script-src/style-src (Nextra/Pagefind compatibility)
- 108-02: Postgres connect_timeout: 5s prevents pool slot exhaustion on unreachable DB
- 108-04: Extracted health-response.ts pure functions for testability (computeStatus, buildPublicResponse, buildAuthenticatedResponse)
- 108-04: Live regression 5/9 PASS (pre-existing functionality); 4/9 blocked pending deployment + manual infra

### Pending Todos

- 3 ignored LiteSVM tests (is_reversed bug) -- test-only
- Stale devnet buffer (~1.3 SOL locked, authority = vault PDA) -- non-blocking

### Roadmap Evolution

- Phase 106.1 inserted after Phase 106: Cluster-aware transaction submission for devnet testing (URGENT)
- Phase 108 added: zAuth vulnerability report triage and remediation
- Phase 109 added: Public Push + Mainnet Vault Upgrade + Announcement

### Blockers/Concerns

- Blowfish large-swap preview must be verified on mainnet before public announcement (devnet simulation does not support this)
- Phase 106-04 devnet testing RESOLVED: Phase 106.1 centralized skipPreflight override, all 8 routes verified on devnet.

## Session Continuity

Last session: 2026-03-26T22:35:00Z
Stopped at: Completed 108-04 (unit tests + live regression for Phase 108)
Next action: Execute 108-03 manual infra (Cloudflare rate limit + Railway URL deletion + UptimeRobot), then push + re-run live regression, then Phase 109

## Milestone History

| Milestone | Phases | Plans | Status | Date |
|-----------|--------|-------|--------|------|
| v0.1 Documentation Audit | 1-7 | 29 | SHIPPED | 2026-02-03 |
| v0.2 AMM Program | 8-13 | 12 | SHIPPED | 2026-02-04 |
| v0.3 Transfer Hook | 14-17 | 9 | SHIPPED | 2026-02-06 |
| v0.4 Tax Program | 18-21 | 11 | SHIPPED | 2026-02-06 |
| v0.5 Epoch/VRF | 22-25 | 16 | SHIPPED | 2026-02-06 |
| v0.6 Staking/Yield | 26-29 | 17 | SHIPPED | 2026-02-09 |
| v0.7 Integration + Devnet | 30-38 | 25 | SHIPPED | 2026-02-15 |
| v0.8 Frontend Tech | 39-45 | 18 | SHIPPED | 2026-02-18 |
| v0.9 Protocol Hardening | 46-52 | 27 | SHIPPED | 2026-02-20 |
| v1.0 Frontend Design | 53-59 | 30 | SHIPPED | 2026-02-24 |
| v1.1 Modal Mastercraft | 60-69 | 27 | SHIPPED | 2026-03-02 |
| v1.2 Bonding Curves | 70-77 | 25 | SHIPPED | 2026-03-07 |
| v1.3 Hardening & Polish | 78-90.1 | 45 | SHIPPED | 2026-03-12 |
| v1.4 Pre-Mainnet | 91-104 | 58 | SHIPPED | 2026-03-25 |
| v1.5 Post-Launch Hardening | 105-107 | -- | ACTIVE | -- |

---
*Updated: 2026-03-26 -- 108-04 complete. 27 unit tests passing (rate limit profiles + health endpoint response shapes). Live regression 5/9 pass, 4 blocked pending deployment. 108-03 manual infra next, then push to deploy.*
