# VERIFY-H089: Crank Error Messages Truncated to 300 Characters
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- No commits referencing H089 since 2026-03-09.
- `scripts/crank/crank-runner.ts` still truncates error messages with `.slice(0, 300)`.
- No changes to this file in recent commits.

## Assessment
Accepted risk. The 300-char truncation prevents log bloat from Solana's verbose error messages (which can include full base64 transaction data). Critical diagnostic info (error code, program ID, instruction index) appears in the first 300 chars of Solana errors. Full errors are available via Sentry if needed. No change from Round 2.
