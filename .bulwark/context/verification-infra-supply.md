# Verification: Infrastructure & Supply Chain Findings

**Auditor**: Stacked Audit #2 Verification
**Date**: 2026-03-21
**Scope**: 10 findings (H003, H005, H055, H057, H056, H060, H095, H102, H110, H132)

---

## 1. H003 (CRIT, FIXED) — npm supply chain: .gitignore + railway.toml protections

**Status: STILL FIXED**

Verified:
- `.gitignore` lines 1-2: `.env` and `.env.mainnet` excluded. Lines 13-18: `scripts/deploy/mint-keypairs/`, `keypairs/mainnet-*`, `pda-manifest.json`, `pda-manifest.md` all excluded.
- `.npmrc` contains `ignore-scripts=true` with H003 reference comment. No changes since original fix (commit `807ba9e`).
- `railway.toml` uses NIXPACKS builder with explicit `buildCommand` and `startCommand`. No changes since commit `b491ce8`.
- No new sensitive patterns introduced since last audit.

**Verdict: CONFIRMED -- fix holds.**

---

## 2. H005 (HIGH, PARTIALLY_FIXED) — 17 devnet keypairs tracked in git. Git history not purged.

**Status: STILL PARTIALLY FIXED (with NEW observation)**

Verified:
- 17 devnet keypairs remain tracked in git (confirmed via `git ls-files --cached -- 'keypairs/*.json'`):
  - 7 program keypairs (amm, bonding-curve, epoch, staking, tax, transfer-hook, vault)
  - 1 devnet wallet
  - 4 squads keypairs (3 signers + create-key)
  - 2 test program keypairs (fake-tax, mock-tax, stub-staking)
  - 2 other (test-upgrade-program, carnage-wsol)
- Mainnet keypairs (10 files on disk) are correctly gitignored via `keypairs/mainnet-*` pattern and NOT tracked.
- Git history still NOT purged (no force-push / BFG has occurred).

**NEW observation**: `.env.devnet` is tracked in git and contains:
  - `HELIUS_API_KEY=[REDACTED-DEVNET-HELIUS-KEY]`
  - `SUPERMEMORY_CC_API_KEY=[REDACTED-SUPERMEMORY]-...`
  - `CLUSTER_URL` with embedded API key

  The file header says "devnet credentials are non-sensitive" which is a judgment call. Helius devnet API keys have rate limits but are free-tier; however, if abused they could exhaust the project's devnet RPC allowance. This was not flagged in the original H005 but falls under the same category of secrets-in-git.

**Verdict: CONFIRMED -- partially fixed. Devnet program keypairs intentionally tracked (needed for CI/deploy). Mainnet keypairs properly excluded. Git history purge remains unaddressed. `.env.devnet` API keys in git are an incremental risk.**

---

## 3. H055 (MED, FIXED) — CI/CD pipeline exists (.github/workflows/)

**Status: STILL FIXED**

Verified:
- `.github/workflows/ci.yml` exists (306 lines). Last changed at commit `c49b0a1`.
- Pipeline runs on push to `main` with two jobs:
  - `rust-tests`: cargo test --workspace --features devnet (unit + proptest + LiteSVM)
  - `ts-tests`: anchor test with local validator (staking.ts + cross-program-integration.ts)
- Pinned tool versions: Rust 1.93.0, Solana 3.0.13, Anchor 0.32.1, Node 22.
- Uses `actions/checkout@v4`, `actions/cache@v4`, `dtolnay/rust-toolchain`, `actions/setup-node@v4` -- all pinned to major version tags.
- `npm ci` used (not `npm install`) for reproducible builds.
- No secrets in workflow file; devnet wallet keypair used for local test validator only.

**Verdict: CONFIRMED -- fix holds. CI pipeline is functional and well-structured.**

---

## 4. H057 (MED, FIXED) — .npmrc blocks install scripts

**Status: STILL FIXED**

Verified:
- `.npmrc` contains exactly: `ignore-scripts=true`
- No changes since original commit `807ba9e`.
- This blocks `preinstall`, `postinstall`, and other lifecycle scripts from running during `npm install`.

**Verdict: CONFIRMED -- fix holds.**

---

## 5. H056 (LOW, NOT_FIXED) — Deprecated glob@7.x, inflight@1.x npm packages

**Status: STILL NOT FIXED**

Verified via `npm ls`:
- `glob@7.2.3` present in 2 paths, both via `react-native@0.84.0` (transitive dep of `@solana-mobile/wallet-adapter-mobile`):
  - `chromium-edge-launcher -> rimraf@3.0.2 -> glob@7.2.3`
  - `babel-plugin-istanbul -> test-exclude -> glob@7.2.3`
- `inflight@1.0.6` present in same paths (dep of glob@7.x).
- `mocha` uses `glob@10.5.0` (not deprecated).

These are deep transitive dependencies of `@solana/wallet-adapter-react -> @solana-mobile/wallet-adapter-mobile -> react-native`. The project has no direct control over these. The react-native dependency itself is pulled transitively and not used at runtime (this is a Next.js app, not a React Native app).

**Verdict: CONFIRMED -- still not fixed. Low risk: transitive dev/build-time only, not exploitable at runtime. Would require upstream `@solana-mobile/wallet-adapter-mobile` to update.**

---

## 6. H060 (LOW, ACCEPTED_RISK) — pda-manifest.json contains API key

**Status: STILL ACCEPTED_RISK (gitignored, but file exists on disk)**

Verified:
- `pda-manifest.json` exists on disk at `scripts/deploy/pda-manifest.json` (3440 bytes).
- Line 3 contains: `"clusterUrl": "https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-HELIUS-KEY]"`.
- `.gitignore` line 17 excludes `scripts/deploy/pda-manifest.json` -- confirmed NOT tracked in git (`git ls-files --cached` returns empty).
- Same API key is also in the git-tracked `.env.devnet` (see H005 note above), so the pda-manifest gitignore is a defense-in-depth measure but the key is already exposed via `.env.devnet`.

**Verdict: CONFIRMED -- accepted risk holds. The gitignore exclusion prevents accidental re-commitment. The key itself is already in `.env.devnet` which is tracked.**

---

## 7. H095 (LOW, ACCEPTED_RISK) — Deploy .env uses set -a pattern

**Status: STILL ACCEPTED_RISK**

Verified:
- 9 files in `scripts/deploy/` reference the `set -a && source .env && set +a` pattern (verified via grep).
- This is documented in CLAUDE.md as a mandatory step before running `initialize.ts`.
- The pattern exports all variables from the env file into the shell environment. Risk: if the shell session is shared or env vars leak to child processes, secrets could be exposed.
- Mitigated by: (a) `.env` and `.env.mainnet` are gitignored, (b) this is a local-only deployment pattern, (c) Railway uses its own env var injection.

**Verdict: CONFIRMED -- accepted risk holds. Standard deployment pattern for local script execution.**

---

## 8. H102 (MED, ACCEPTED_RISK) — Cross-program upgrade cascade risk

**Status: STILL ACCEPTED_RISK**

Verified:
- 7 production programs with extensive CPI graph (358 CPI-related occurrences across 50 Rust files).
- Key CPI chains: Tax Program -> AMM (swap), Epoch Program -> Tax Program -> AMM (carnage execution), Staking -> Token transfers.
- All 7 programs share the same upgrade authority (deployer, transitioning to Squads multisig).
- Cross-program references are by program ID (hardcoded via `declare_id!` or feature-flagged constants). An upgrade to one program that changes its interface would break callers.
- Mitigation documented in `Docs/mainnet-governance.md`: Squads 2-of-3 multisig with timelock, progressive timelock increase, authority retained for patching.
- `sync-program-ids.ts` (referenced in MEMORY.md) auto-syncs program IDs across all programs during build.

**Verdict: CONFIRMED -- accepted risk holds. The CPI dependency graph is inherent to the protocol design. Squads governance + retained upgrade authority provides the safety net for coordinated upgrades.**

---

## 9. H110 (LOW, FIXED) — Squads timelock on admin authorities

**Status: STILL FIXED**

Verified:
- `scripts/deploy/setup-squads.ts` line 103: `const timelockSeconds = Number(process.env.SQUADS_TIMELOCK_SECONDS) || 300;`
- Line 299: `timeLock: timelockSeconds` passed to Squads multisig creation.
- `.env.devnet` line 23: `SQUADS_TIMELOCK_SECONDS=300` (5 minutes for devnet).
- `Docs/mainnet-governance.md` Section 1: Initial mainnet timelock = 15 minutes (900s), with progressive increase.
- Timelock is enforced at the Squads v4 program level (on-chain), not just client-side.
- Devnet proven: 2 complete timelocked upgrade round-trips documented (per MEMORY.md).

**Verdict: CONFIRMED -- fix holds. Timelock is implemented, configurable, and tested on devnet.**

---

## 10. H132 (LOW, ACCEPTED_RISK) — Railway dashboard single point of admin access

**Status: STILL ACCEPTED_RISK**

Verified:
- `railway.toml` confirms Railway is the hosting platform (NIXPACKS builder, health checks, restart policy).
- Railway dashboard access is a single-admin point -- no evidence of team/MFA configuration in the repository.
- This is an infrastructure-layer risk outside the codebase: Railway account compromise could modify env vars (including RPC URLs, wallet references) or deploy malicious code.
- Mitigated by: (a) on-chain authority requires Squads multisig (attacker can't upgrade programs via Railway), (b) Railway is read-only for on-chain state, (c) primary risk is frontend/crank manipulation.

**Verdict: CONFIRMED -- accepted risk holds. Railway admin access is outside codebase control. On-chain security is independent of Railway compromise.**

---

## Summary Table

| Finding | Original Status | Current Status | Changed? | Notes |
|---------|----------------|----------------|----------|-------|
| H003 | FIXED | FIXED | No | .gitignore, .npmrc, railway.toml all intact |
| H005 | PARTIALLY_FIXED | PARTIALLY_FIXED | Minor | 17 devnet keypairs still tracked; `.env.devnet` also has API keys in git |
| H055 | FIXED | FIXED | No | CI pipeline functional, pinned versions |
| H057 | FIXED | FIXED | No | .npmrc ignore-scripts=true intact |
| H056 | NOT_FIXED | NOT_FIXED | No | Transitive deps of wallet-adapter, no direct fix |
| H060 | ACCEPTED_RISK | ACCEPTED_RISK | No | pda-manifest.json gitignored; key also in tracked .env.devnet |
| H095 | ACCEPTED_RISK | ACCEPTED_RISK | No | Standard local deploy pattern |
| H102 | ACCEPTED_RISK | ACCEPTED_RISK | No | CPI graph inherent to design; Squads governance mitigates |
| H110 | FIXED | FIXED | No | Timelock implemented and proven on devnet |
| H132 | ACCEPTED_RISK | ACCEPTED_RISK | No | Infrastructure-layer risk, mitigated by on-chain governance |

## Cross-Cutting Observation

The `.env.devnet` file is committed to git with the comment "devnet credentials are non-sensitive," yet it contains API keys (Helius RPC, Supermemory). The same Helius API key appears in the gitignored `pda-manifest.json`. This creates a situation where H060's gitignore fix for pda-manifest is undermined by the tracked `.env.devnet`. While devnet API keys are low-value targets, this is worth noting as an incremental improvement opportunity: either rotate the devnet API key to a non-committed env var, or document the explicit risk acceptance for devnet-tier API keys in git.
