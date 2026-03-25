---
phase: 92-mainnet-credentials-preflight
verified: 2026-03-13T18:15:00Z
status: passed
score: 7/7 must-haves verified
gaps: []
---

# Phase 92: Mainnet Credentials & Preflight Verification Report

**Phase Goal:** Mainnet deployment has its own isolated credentials, environment config, and preflight safety checks -- nothing shared with devnet
**Verified:** 2026-03-13T18:15:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A fresh mainnet deployer wallet exists with its keypair stored securely outside git | VERIFIED | ~/mainnet-keys/deployer.json exists (239 bytes), outside repo, pubkey 23g7xmrt... |
| 2 | Separate .env.devnet and .env.mainnet files exist with cluster-aware sourcing | VERIFIED | .env.mainnet (98 lines), app/.env.mainnet (80 lines), deploy-all.sh sources `.env.${CLUSTER}` at line 103-113 |
| 3 | Deploy scripts refuse to run if wrong env is loaded | VERIFIED | Cross-validation at lines 123-147 catches devnet URL in mainnet config and vice versa; Check 3 blocks devnet wallet on mainnet |
| 4 | Mainnet preflight catches keypairs in git staging | VERIFIED | Check 1 (lines 221-260): `git diff --cached` filtered for keypair/wallet/mint/deployer patterns |
| 5 | Mainnet preflight catches missing env vars | VERIFIED | Check 2 (lines 263-321): REQUIRED_VARS + MAINNET_EXTRA_VARS with CHANGE_ME placeholder detection |
| 6 | Mainnet preflight catches insufficient deployer balance | VERIFIED | Check 4 (lines 376-429): `solana balance` compared against MAINNET_MIN_BALANCE via awk |
| 7 | Mainnet preflight catches binary hash mismatches | VERIFIED | Check 5 (lines 439-496): shasum -a 256 comparison against expected-hashes.{cluster}.json manifest |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.env.mainnet` | Complete root env template | VERIFIED | 98 lines, 15 vars covering RPC/deploy/crank/webhook/preflight categories, CHANGE_ME_MAINNET placeholders, gitignored |
| `app/.env.mainnet` | Complete frontend env template | VERIFIED | 80 lines, 10 vars covering server+client, Railway guidance header, auto-vars documented, gitignored |
| `scripts/deploy/generate-hashes.sh` | Binary hash manifest generator | VERIFIED | 101 lines, executable (755), uses shasum -a 256, produces valid JSON at deployments/expected-hashes.{cluster}.json |
| `deployments/expected-hashes.devnet.json` | Test output from generate-hashes.sh | VERIFIED | Valid JSON with 10 program hashes, ISO timestamp, cluster field |
| `~/mainnet-keys/deployer.json` | Fresh mainnet deployer wallet | VERIFIED | 239 bytes, outside repo at ~/mainnet-keys/ |
| `scripts/deploy/deploy-all.sh` (preflight section) | 5 preflight safety checks | VERIFIED | 319 lines added (lines 196-513), all 5 checks with PREFLIGHT_FAILED accumulator pattern |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| deploy-all.sh | .env.{cluster} | `source "$ENV_FILE"` at line 112 | WIRED | ENV_FILE=".env.${CLUSTER}" with existence check |
| deploy-all.sh | expected-hashes.{cluster}.json | shasum comparison in Check 5 | WIRED | jq extracts expected hash, shasum computes actual, comparison at line 472 |
| deploy-all.sh | REQUIRED_VARS | env var presence loop | WIRED | Iterates REQUIRED_VARS + MAINNET_EXTRA_VARS with -z and CHANGE_ME checks |
| generate-hashes.sh | target/deploy/*.so | shasum -a 256 | WIRED | Finds all .so files, hashes each, writes JSON manifest |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| INFRA-08: Fresh mainnet deployer wallet | SATISFIED | ~/mainnet-keys/deployer.json exists, separate from devnet-wallet.json |
| INFRA-09: Fresh Helius mainnet API key | SATISFIED | HELIUS_API_KEY=CHANGE_ME_MAINNET in .env.mainnet with provisioning instructions |
| INFRA-10: Fresh webhook secret for mainnet | SATISFIED | HELIUS_WEBHOOK_SECRET=CHANGE_ME_MAINNET in both .env.mainnet files |
| INFRA-11: Fresh Sentry environment tag | SATISFIED | NEXT_PUBLIC_CLUSTER=mainnet in app/.env.mainnet; sentry.ts uses this as environment tag (same DSN, different tag) |
| INFRA-12: Railway production environment separate | SATISFIED | app/.env.mainnet is complete Railway reference template with guidance header and auto-var documentation |
| INFRA-14: Mainnet preflight script | SATISFIED | 5 checks embedded in deploy-all.sh: git staging scan, env var validation, wallet sanity, balance check, binary hash verification |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns detected |

### Env Var Coverage Audit

All 31 `process.env.*` references in the codebase were cross-referenced against both .env.mainnet files. 6 vars are intentionally absent:
- `HOME`, `HOSTNAME`: System-provided
- `ANCHOR_WALLET`: Fallback, covered by WALLET
- `FULL`, `OVERNIGHT_EPOCHS`: Test-only scripts
- `NEXT_PUBLIC_SOLANA_CLUSTER`: Legacy fallback, superseded by NEXT_PUBLIC_CLUSTER

### Human Verification Required

None -- all checks are structural and verifiable programmatically. The deployer wallet, env templates, and preflight gate are infrastructure artifacts that don't require visual or runtime testing.

### Gaps Summary

No gaps found. All 7 observable truths verified, all 6 artifacts substantive and wired, all 6 requirements satisfied.

---

_Verified: 2026-03-13T18:15:00Z_
_Verifier: Claude (gsd-verifier)_
