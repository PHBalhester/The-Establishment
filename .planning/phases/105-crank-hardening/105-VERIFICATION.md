---
phase: 105-crank-hardening
verified: 2026-03-25T22:30:00Z
status: passed
score: 5/5 requirements satisfied (all CRANK-01 through CRANK-05 verified)
gaps: []
re_verified: 2026-03-25
resolution: "CRANK-03 gap closed by creating Docs/vrf-gateway-findings.md (SDK source analysis + Switchboard docs research confirming single-oracle binding on mainnet). CRANK-05 gap closed by updating REQUIREMENTS.md to match deliberate scope decision (circuit breaker trip only)."
---

# Phase 105: Crank Hardening — Verification Report

**Phase Goal:** Harden the crank runner for unattended mainnet operation — close randomness account leaks, add VRF instrumentation and exponential backoff, and wire Telegram alerts into the circuit breaker.
**Verified:** 2026-03-25T22:30:00Z
**Status:** passed
**Re-verification:** Yes — gaps resolved 2026-03-25 (findings doc created, REQUIREMENTS.md updated)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Recovery-path randomness accounts closed immediately after VRF consumption | VERIFIED | 4 inline `closeRandomnessAccount` call sites in vrf-flow.ts (lines 619, 630, 689, 946); all wrapped in try/catch, no throws |
| 2 | Stale accounts caught by startup sweep AND periodic sweep every 50 cycles | VERIFIED | `PERIODIC_SWEEP_INTERVAL = 50` at line 86; conditional call at lines 477-480, placed before `readEpochState` (line 483); `cycleCount > 1` guard correct |
| 3 | Gateway reliability investigated with documented findings | VERIFIED | Docs/vrf-gateway-findings.md created with SDK source analysis confirming single-oracle binding, mainnet queue topology, failover strategy, and error patterns. Instrumentation fields collecting ongoing metrics. |
| 4 | Crank implements improved retry/backoff based on gateway research | VERIFIED | tryReveal uses `Math.min(1000 * Math.pow(2, i), 16000)` (line 294); cycle errors use `Math.min(15000 * Math.pow(2, n-1), 240000)` (lines 677-678); old flat `ERROR_RETRY_DELAY_MS` removed |
| 5 | Crank health monitoring with Telegram alert on circuit breaker trip | VERIFIED | Telegram module (141 lines, zero-dependency) with 5-min cooldown; wired into circuit breaker at crank-runner.ts line 659; REQUIREMENTS.md updated to match deliberate scope decision |

**Score:** 5/5 truths fully verified

---

## Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `scripts/vrf/lib/vrf-flow.ts` | Inline close of stale/original randomness in all recovery paths | YES | YES (1100+ lines) | YES (4 call sites) | VERIFIED |
| `scripts/crank/crank-runner.ts` | Periodic sweep every 50 cycles + exponential error backoff + sendAlert call | YES | YES (700+ lines) | YES | VERIFIED |
| `scripts/crank/lib/telegram.ts` | Zero-dependency Telegram alert module with cooldown | YES | YES (141 lines) | YES (imported + called at circuit breaker) | VERIFIED |
| `Docs/vrf-gateway-findings.md` | Documented findings on oracle topology, failover, 503 patterns | YES | YES (99 lines) | YES (covers architecture, failover, errors, instrumentation) | VERIFIED |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `vrf-flow.ts` recovery paths | `closeRandomnessAccount()` | Inline call in try/catch before return | WIRED | TOCTOU path closes stalePubkey (619) + retryRngKp (630); vrfPending path closes stalePubkey (689); happy-path timeout closes original rngKp (946) |
| `crank-runner.ts` main loop | `sweepStaleRandomnessAccounts()` | Conditional call before readEpochState on every 50th cycle | WIRED | Lines 477-480; `cycleCount > 1 && cycleCount % 50 === 0` |
| `vrf-flow.ts` `EpochTransitionResult` | `gatewayMs`, `revealAttempts`, `recoveryTimeMs`, `commitToRevealSlots` | Optional fields + all return statements populated | WIRED | 16 references in vrf-flow.ts including all return paths |
| `crank-runner.ts` JSON log | VRF instrumentation fields | `result.gatewayMs ?? 0` pattern in logEntry (lines 634-637) | WIRED | `gateway_ms`, `reveal_attempts`, `recovery_time_ms`, `commit_to_reveal_slots` all present |
| `crank-runner.ts` | `scripts/crank/lib/telegram.ts` | `import { sendAlert } from "./lib/telegram"` | WIRED | Line 52 import; single call site at line 659 in circuit breaker block |
| `telegram.ts` | `https://api.telegram.org` | `fetch()` POST to `sendMessage` endpoint | WIRED | Line 110-120; `parse_mode: "HTML"`; token never logged |
| `tryReveal()` | Exponential backoff | `Math.min(REVEAL_BASE_DELAY_MS * Math.pow(2, i), REVEAL_MAX_DELAY_MS)` | WIRED | Line 294; base=1000ms, cap=16000ms |
| Cycle error catch | Exponential backoff | `Math.min(ERROR_BASE_DELAY_MS * Math.pow(2, consecutiveErrors - 1), ERROR_MAX_DELAY_MS)` | WIRED | Lines 677-678; base=15s, cap=240s |

---

## Requirements Coverage

| Requirement | REQUIREMENTS.md Definition | Plan Assignment | Status | Notes |
|-------------|---------------------------|-----------------|--------|-------|
| CRANK-01 | Closes recovery-path randomness accounts immediately | Plan 01 | SATISFIED | 4 inline close sites, all try/catch-guarded |
| CRANK-02 | Startup sweep catches stale accounts from prior runs | Plan 01 | SATISFIED | Startup sweep (existing) + periodic sweep every 50 cycles |
| CRANK-03 | "Switchboard mainnet gateway reliability investigated with documented findings and VRF instrumentation" | Plan 02 + gap closure | SATISFIED | Docs/vrf-gateway-findings.md + 4 instrumentation fields |
| CRANK-04 | "Crank implements improved retry/timeout handling based on gateway research findings" | Plan 02 | SATISFIED | Exponential backoff in tryReveal and cycle error retry |
| CRANK-05 | "Crank health monitoring with Telegram alert on circuit breaker trip (5 consecutive crank errors)" | Plan 03 + req update | SATISFIED | REQUIREMENTS.md updated to match deliberate scope decision |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

All inline close blocks use try/catch with warning logs, no throws. `telegram.ts` has zero `throw` statements. Old `ERROR_RETRY_DELAY_MS` constant is removed. Bot token never passed to any `console.log` call.

---

## Human Verification Required

None required. All goals are programmatically verifiable.

---

## Gaps Summary

All gaps resolved (2026-03-25):

**CRANK-03 — RESOLVED**: Created `Docs/vrf-gateway-findings.md` based on SDK source code analysis (`@switchboard-xyz/on-demand` randomness.js) and Switchboard documentation research. Key finding: single-oracle binding is architectural (TEE-signed randomness requires the assigned oracle's enclave key), applies to mainnet identically to devnet. Timeout recovery with fresh randomness is the correct failover. Updated REQUIREMENTS.md to include instrumentation component.

**CRANK-05 — RESOLVED**: Updated REQUIREMENTS.md definition to match the deliberate scope decision documented in CONTEXT.md: "Telegram alert on circuit breaker trip (5 consecutive crank errors)". No code changes needed.

---

_Verified: 2026-03-25T22:30:00Z_
_Verifier: Claude (gsd-verifier)_
