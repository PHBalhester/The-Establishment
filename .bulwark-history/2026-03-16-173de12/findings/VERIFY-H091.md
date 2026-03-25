# VERIFY-H091: No Distributed Locking for Crank
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- No commits referencing H091 since 2026-03-09.
- Single-instance crank assumption unchanged. No distributed locking mechanism added.
- VRF TOCTOU handling (VRF-04) provides idempotency protection if duplicate cranks run.

## Assessment
Accepted risk. The crank runs as a single Railway service instance. Solana's transaction model provides natural idempotency — duplicate epoch transitions fail with "already initialized" PDA errors. The VRF-04 TOCTOU guard handles the most sensitive path. Adding distributed locking (Redis, etc.) would add infrastructure complexity disproportionate to the risk. No change from Round 2.
