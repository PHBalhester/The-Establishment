# VERIFY-H031: No Global Unhandled Rejection Handler in Crank Runner
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
Crank runner was modified in phase 89-03 (circuit breaker, spending cap, vault top-up ceiling), but no `unhandledRejection` or `uncaughtException` handler was added. Grep confirms zero matches in `scripts/crank/`. The top-level `main().catch()` remains the only error boundary.

## Assessment
Accepted risk. Railway auto-restarts crashed processes, mitigating silent crash scenarios. The circuit breaker additions in 89-03 add resilience but don't address this specific concern. Low severity given the operational environment.
