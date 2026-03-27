# Phase 105: Crank Hardening - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden the crank runner for sustained mainnet reliability. Close recovery-path randomness accounts immediately, add periodic safety sweep, instrument VRF metrics for gateway research, implement Telegram alerting for critical failures, and tune retry/backoff logic. All changes are off-chain (scripts/crank/ and scripts/vrf/).

</domain>

<decisions>
## Implementation Decisions

### Recovery-path cleanup (CRANK-01)
- Close stale randomness account **inline immediately** after recovery path creates fresh randomness — don't defer to startup sweep
- If inline close fails, log a warning and move on (startup sweep catches it eventually)
- Ensure startup sweep (getProgramAccounts memcmp filter on authority offset 8) is airtight — researcher should verify no edge cases exist where accounts escape the filter

### Startup & periodic sweep (CRANK-02)
- Startup sweep already exists and works — keep it, ensure it always logs even when zero accounts found ("No stale randomness accounts found" confirms it ran)
- Add periodic sweep every 50 cycles as safety net for long-running sessions (catches silently failed inline closes)

### Gateway instrumentation (CRANK-03)
- Instrument vrf-flow.ts to capture per-cycle VRF metrics in the existing `[epoch]` JSON log line (extend, don't create separate log)
- Fields to capture:
  - `gateway_ms`: Response time of revealIx() call
  - `reveal_attempts`: Number of reveal retries before success or timeout
  - `recovery_time_ms`: Total wall-clock time for recovery path (0 if happy path)
  - `commit_to_reveal_slots`: Slot delta between commit TX and successful reveal
- Skip oracle pubkey tracking for now (gateway rotation is already ruled out)
- Document findings after 1-2 weeks of mainnet data in a markdown file

### Retry/backoff tuning (CRANK-04)
- Reveal backoff: switch from linear (3s, 6s, 9s...) to **exponential starting at 1s** (1s, 2s, 4s, 8s, 16s). 5 attempts, ~31s total
- Cycle error backoff: switch from flat 30s to **exponential** (15s, 30s, 60s, 120s, 240s). ~7.5 min total before circuit breaker trips at attempt 5
- Always attempt reveal first (no oracle-aware skip) — reveal is cheap, timeout recovery is expensive. Instrumentation data will show if this needs revisiting
- VRF_TIMEOUT_SLOTS stays hardcoded at 300 — not configurable via env var

### Alerting (CRANK-05)
- **Telegram bot** for push notifications (not Discord — user doesn't use Discord)
- Env vars: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- Alert events: **circuit breaker trip only** (5 consecutive errors, crank halting)
  - No low-balance alert (user monitors wallet directly via phone)
  - No VRF recovery or epoch stall alerts (keep it focused)
- Alert message: **rich** — includes event type, last error message (truncated), current epoch, wallet balance, consecutive error count, uptime
- 5-minute cooldown between duplicate alerts (prevents spam if Railway crash-loops the crank)
- Alert is best-effort — if Telegram API call fails, log warning and continue (don't block crank operation)

### Claude's Discretion
- Exact Telegram message formatting (markdown vs plain text, emoji usage)
- Whether to extract alerting into its own module vs inline in crank-runner.ts
- Specific error message truncation length in alert body
- Whether periodic sweep reuses the existing sweepStaleRandomnessAccounts function or is a separate lighter check

</decisions>

<specifics>
## Specific Ideas

- Telegram bot can serve as the ops notification channel for the whole protocol long-term (not just crank alerts)
- User wants to ensure startup sweep genuinely catches everything — researcher should verify the memcmp filter covers all randomness account states
- Instrumentation data feeds future CRANK-04 tuning — this is a foundation for data-driven optimization

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `closeRandomnessAccount()` in vrf-flow.ts (line 942): Already handles account existence check, SB IDL fetch, close IX — reuse for inline recovery close
- `sweepStaleRandomnessAccounts()` in crank-runner.ts (line 311): getProgramAccounts + memcmp filter — reuse for periodic sweep
- `startHealthServer()` in crank-runner.ts (line 166): HTTP health endpoint pattern — alerting module can follow similar pattern
- Existing JSON log entry (line 603): `[epoch]` log line — extend with VRF instrumentation fields

### Established Patterns
- Constants at top of crank-runner.ts with JSDoc explaining rationale (H013, H019)
- Circuit breaker pattern: consecutiveErrors counter, threshold check, halt on breach
- Spending cap: rolling window with prune/record functions
- RPC rate limiting: `sleep(RPC_DELAY_MS)` between calls
- Config from env vars with auto-detect fallback (getMinEpochSlots, getLowBalanceThreshold)

### Integration Points
- `advanceEpochWithVRF()` in vrf-flow.ts: Returns `EpochTransitionResult` — add instrumentation fields to this return type
- `tryReveal()` in vrf-flow.ts (line 251): Capture timing + attempt count here
- Recovery path in vrf-flow.ts (~line 422): Add inline close of stale account after recovery succeeds
- Main loop catch block (crank-runner.ts line 621): Trigger Telegram alert when circuit breaker trips

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 105-crank-hardening*
*Context gathered: 2026-03-25*
