# VERIFY-H005: Keypairs Committed to Git
**Status:** PARTIALLY_FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence
1. **Mainnet keypairs are gitignored** (`.gitignore` line 15: `keypairs/mainnet-*`). Three mainnet mint keypairs exist on disk (`mainnet-crime-mint.json`, `mainnet-fraud-mint.json`, `mainnet-profit-mint.json`) but are NOT tracked by git (`git ls-files` returns empty for `keypairs/mainnet-*.json`).

2. **Mint keypair directory also gitignored** (`.gitignore` line 12: `scripts/deploy/mint-keypairs/`).

3. **12 devnet keypairs remain tracked by git:**
   - `keypairs/amm-keypair.json`
   - `keypairs/bonding-curve-keypair.json`
   - `keypairs/carnage-wsol.json`
   - `keypairs/devnet-wallet.json`
   - `keypairs/epoch-program.json`
   - `keypairs/fake-tax-keypair.json`
   - `keypairs/mock-tax-keypair.json`
   - `keypairs/staking-keypair.json`
   - `keypairs/tax-program-keypair.json`
   - `keypairs/transfer-hook-keypair.json`
   - `keypairs/vault-keypair.json`
   - `keypairs/StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU.json`

4. **Git history not purged:** Keypair bytes remain recoverable from git history.

## Assessment
No change from round 2. Mainnet keypair protection is adequate — gitignore pattern confirmed working, no mainnet keypairs in git tracking. The 12 tracked devnet keypairs are an accepted risk (devnet-only, no monetary value). Devnet program upgrade keys are exposed but this is tolerable for a development environment.

Remaining recommendations (unchanged):
- Before open-sourcing: `git rm --cached keypairs/*.json` + add `keypairs/*.json` to `.gitignore` + purge history with `git filter-repo` or BFG
- For mainnet: generate ALL deploy keypairs fresh, never commit them
