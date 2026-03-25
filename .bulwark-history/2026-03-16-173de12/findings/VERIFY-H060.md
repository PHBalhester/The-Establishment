# VERIFY-H060: API Key Committed to Source
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
No changes to `scripts/deploy/pda-manifest.json` or `shared/programs.ts` since last round. The Helius devnet free-tier API key remains committed to source.

## Assessment
Accepted risk. The key is a free-tier devnet RPC key with no financial exposure. Code comments already document this. Mainnet deployment will use environment variables for RPC endpoints (tracked in mainnet checklist).
