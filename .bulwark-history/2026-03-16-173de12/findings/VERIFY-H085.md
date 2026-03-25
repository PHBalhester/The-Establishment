# VERIFY-H085: Health Endpoint Always Returns HTTP 200
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- `app/app/api/health/route.ts` was modified in phase 90-02 (commit 407bc20) to add `captureException` for Sentry error reporting.
- However, the HTTP status code behavior is unchanged: always returns 200 with `status: "ok" | "degraded"` in the JSON body.
- Phase 89-03 (commit 547fe02) added a separate internal `/health` endpoint for Railway, but the public health route behavior is the same.

## Assessment
Accepted risk. This is intentional — Railway's health check treats non-200 as container death, which would cause unnecessary restarts during transient RPC outages. The `"degraded"` status in the JSON body is available for monitoring tools that inspect response bodies. Sentry now captures the underlying errors (phase 90 addition). No change from Round 2 status.
