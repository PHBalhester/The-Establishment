# VERIFY-H095: deploy-all.sh Exports All .env Variables
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- No commits referencing H095 since 2026-03-09.
- `scripts/deploy/deploy-all.sh` still uses `set -a && source .env` to export all environment variables.
- No changes to this file in recent commits.

## Assessment
Accepted risk. The deploy script runs locally on the developer's machine, not in production. The `set -a` pattern is standard for deploy scripts that need env vars available to child processes (anchor, solana CLI, tsx). The .env file is git-ignored and contains only deployment-specific values. No change from Round 2.
