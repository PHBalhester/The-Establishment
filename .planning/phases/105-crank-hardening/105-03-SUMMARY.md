---
phase: 105-crank-hardening
plan: 03
subsystem: infra
tags: [telegram, alerting, circuit-breaker, crank, monitoring]

# Dependency graph
requires:
  - phase: 105-02
    provides: "Crank runner with circuit breaker, VRF instrumentation, exponential backoff"
provides:
  - "Telegram alert module (scripts/crank/lib/telegram.ts)"
  - "Circuit breaker trip fires push notification to operator phone"
affects: [107-jupiter-adapter, future-crank-enhancements]

# Tech tracking
tech-stack:
  added: ["Telegram Bot API (raw fetch, zero npm deps)"]
  patterns: ["Zero-dependency external service integration via raw fetch()"]

key-files:
  created: ["scripts/crank/lib/telegram.ts"]
  modified: ["scripts/crank/crank-runner.ts"]

key-decisions:
  - "HTML parse_mode over MarkdownV2 (avoids aggressive escaping pitfalls)"
  - "Cooldown updates on both success AND failure to prevent hammering API"
  - "Single alert event only: circuit breaker trip (per CONTEXT.md decision)"

patterns-established:
  - "Zero-dependency alerting: raw fetch() to Telegram API, matching lib/sentry.ts pattern"
  - "Best-effort external calls: never throw, never block crank, log warnings only"

# Metrics
duration: 2min
completed: 2026-03-25
---

# Phase 105 Plan 03: Telegram Alerts Summary

**Zero-dependency Telegram alert module with 5-minute cooldown, wired into crank circuit breaker for push notifications on halt**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-25T21:58:07Z
- **Completed:** 2026-03-25T22:00:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- New telegram.ts module: AlertContext interface, HTML formatting, escapeHtml(), 5-minute cooldown
- Circuit breaker integration: fires alert with epoch, wallet balance, error count, uptime, and last error
- Graceful degradation: missing env vars disable alerting, API failures are swallowed with warnings
- Bot token never leaked to logs -- URL containing token is never passed to console.log

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Telegram alert module** - `f158702` (feat)
2. **Task 2: Wire Telegram alerts into circuit breaker** - `b96075e` (feat)

## Files Created/Modified
- `scripts/crank/lib/telegram.ts` - Zero-dependency Telegram alert module with AlertContext, HTML formatting, 5-min cooldown, best-effort sendAlert()
- `scripts/crank/crank-runner.ts` - Import sendAlert, crankStartMs uptime tracking, alert call in circuit breaker block, env var docs in header

## Decisions Made
- HTML parse_mode over MarkdownV2 -- avoids Telegram's aggressive special-character escaping that breaks dynamically-generated messages
- Cooldown timestamp updates on both successful sends AND fetch errors -- prevents rapid retries when Telegram API is down
- Named the balance variable `alertBalance` to avoid shadowing the existing `balance` variable in the try block scope
- Used `epochState?.currentEpoch ?? 0` since epochState may be from a stale read before the error occurred

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Optional Telegram alerting requires two environment variables on Railway:**

1. `TELEGRAM_BOT_TOKEN` - Create a bot via @BotFather on Telegram, copy the token
2. `TELEGRAM_CHAT_ID` - Send a message to the bot, then call `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat ID

Without these variables, the crank runs normally with alerting silently disabled (log message only).

## Next Phase Readiness
- All three 105 plans complete: rent reclaim (01), VRF instrumentation (02), Telegram alerts (03)
- Phase 105 Crank Hardening is fully shipped
- Ready for Phase 106 (Vault Convert V2) or Phase 107 (Jupiter Adapter)

---
*Phase: 105-crank-hardening*
*Completed: 2026-03-25*
