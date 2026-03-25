# VERIFY-H102: Cross-Program Upgrade Cascade
**Status:** ACCEPTED_RISK
**Round:** 3
**Date:** 2026-03-12

## Evidence

`scripts/deploy/deploy-all.sh` (208 lines) is a five-phase orchestrated deployment pipeline:

- **Phase 0**: Pre-generate mint keypairs (solves chicken-and-egg address patching)
- **Phase 1**: Build all programs (with `--devnet` flag auto-detected from cluster URL)
- **Phase 2**: Deploy all programs in dependency order via `deploy.sh`
- **Phase 3**: Initialize mints, PDAs, pools, whitelist entries, seed liquidity via `initialize.ts`
- **Phase 4**: Verify all accounts exist with correct data via `verify.ts`

Key safety features:
- `set -e` ensures any phase failure halts the entire pipeline
- Solana CLI version gate (requires v3.0.x Agave, rejects pre-Agave v1.x)
- `.env` sourcing for configuration consistency
- Post-deploy ALT recreation reminder
- All six programs are built and deployed atomically in one run

The pipeline ensures programs that depend on each other (e.g., tax-program reading epoch-program's EpochState, vault hardcoding mint addresses) are always deployed together with consistent addresses and layouts.

## Assessment

Cross-program upgrade cascade risk is inherent to any multi-program Solana protocol. The deploy-all.sh pipeline mitigates this by ensuring all programs are rebuilt and redeployed together in the correct order. Individual program upgrades outside this pipeline would still carry cascade risk, but the documented workflow and `set -e` guard make accidental partial deploys unlikely.

**Verdict:** Accepted risk — mitigated by the deploy-all.sh pipeline. Operators must use the pipeline for all deployments, never deploy programs individually.
