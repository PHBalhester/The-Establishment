---
task_id: db-phase1-dep-01
provides: [dep-01-findings, dep-01-invariants]
focus_area: dep-01
files_analyzed: [package.json, app/package.json, shared/package.json, package-lock.json, .npmrc, .gitignore, app/.gitignore, .github/workflows/ci.yml, railway.toml, railway-crank.toml, nixpacks.toml, app/next.config.ts, app/scripts/sync-idl.mjs]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 4, low: 6}
---
<!-- CONDENSED_SUMMARY_START -->
# Package & Dependency Security (DEP-01) -- Condensed Summary

## Key Findings (Top 10)

- **Crank Railway build uses `npm install` not `npm ci`**: Lockfile can be silently modified during production builds, defeating integrity pinning -- `railway-crank.toml:3`
- **No `npm audit` step in CI pipeline**: 30 known vulnerabilities (9 high, 5 moderate) in the dependency tree are invisible to CI -- `.github/workflows/ci.yml` (entire file)
- **No Dependabot/Renovate configured**: No automated dependency update mechanism; CVE patches require manual discovery -- `.github/` (absent: `dependabot.yml`)
- **`next@16.1.6` has 5 moderate CVEs including CSRF bypass and HTTP request smuggling**: Fix available at `16.2.1` -- `app/package.json:29`
- **`elliptic` CVE (GHSA-848j) with no fix available**: Pulled transitively via `@irys/upload-solana` -> `@irys/bundles` -> `secp256k1`; no upstream fix exists -- `package.json:23`
- **`bigint-buffer` high-severity buffer overflow CVE (GHSA-3gc7)**: Pulled via `@solana/spl-token` -> `@solana/buffer-layout-utils`; fix requires breaking version change -- `package.json:22`
- **`serialize-javascript@<=7.0.2` RCE vulnerability (GHSA-5c6j)**: Pulled via `mocha` dev dependency; fixable with `npm audit fix` -- `package.json:38`
- **`react-native@0.84.0` pulled as transitive dependency**: Web-only app carries mobile framework with 200+ transitive deps via `@solana/wallet-adapter-react` -> `@solana-mobile/wallet-adapter-mobile` -- `app/package.json:23`
- **`@dr-fraudsworth/shared` referenced as bare version `"0.0.1"` not `workspace:*`**: npm workspace resolution resolves locally, but the `@dr-fraudsworth` scope is unregistered on npm (verified E404) making dependency confusion theoretically possible if scope is claimed -- `app/package.json:18`
- **5 extraneous packages installed**: `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util` are installed but not declared in any package.json -- `node_modules/`

## Critical Mechanisms

- **Lockfile integrity (OC-234, OC-235)**: `package-lock.json` is committed (v3 format, 1325 integrity hashes), `.gitignore` does NOT exclude it. CI uses `npm ci` (correct). Railway main service uses Nixpacks auto-detect (uses `npm ci` when lockfile present). Railway crank service overrides with `npm install` (INCORRECT). -- `package-lock.json`, `railway.toml`, `railway-crank.toml`
- **Install script blocking (OC-240)**: `.npmrc` has `ignore-scripts=true`. 13 packages declare install scripts (`protobufjs`, `sharp`, `esbuild`, `bigint-buffer`, `bufferutil`, `keccak`, `secp256k1`, `utf-8-validate`, `fsevents`, `unrs-resolver`, 3 dev esbuild instances). These are blocked by `.npmrc` locally and in CI (`npm ci` respects `.npmrc`). However `railway-crank.toml` uses `npm install` which also respects `.npmrc`, so scripts are still blocked there. -- `.npmrc:5`
- **Workspace package resolution**: `@dr-fraudsworth/shared` is defined in `shared/` workspace, resolved via npm workspaces (symlink at `node_modules/@dr-fraudsworth/shared -> ../../shared`). The lockfile records `"resolved": "shared", "link": true`. The `@dr-fraudsworth` scope is NOT registered on npm. Workspace resolution prevents public registry fallback. -- `package.json:4-7`, `shared/package.json`
- **predev/prebuild hooks in app**: `app/package.json` defines `predev` and `prebuild` that run `node scripts/sync-idl.mjs`. This script copies IDL files from `target/idl/` using hardcoded relative paths. No user input. Safe. -- `app/package.json:6-8`, `app/scripts/sync-idl.mjs`

## Invariants & Assumptions

- INVARIANT: `package-lock.json` is committed to git and not excluded by `.gitignore` -- enforced at `.gitignore` (no lockfile exclusion line)
- INVARIANT: `Cargo.lock` is committed to git -- enforced at `git ls-files -- Cargo.lock` (tracked)
- INVARIANT: npm install scripts are blocked globally via `.npmrc` `ignore-scripts=true` -- enforced at `.npmrc:5`
- INVARIANT: CI uses `npm ci` (reproducible, lockfile-pinned installs) -- enforced at `.github/workflows/ci.yml:124,245`
- ASSUMPTION: Railway Nixpacks builder uses `npm ci` when `package-lock.json` is present -- UNVALIDATED (Nixpacks default behavior; no explicit `npm ci` in `railway.toml`)
- ASSUMPTION: `@dr-fraudsworth` npm scope will not be claimed by a third party -- UNVALIDATED (scope is currently 404 on npm; an attacker could claim it)
- ASSUMPTION: All 676 installed packages are from the public npm registry (no private registries, no alternative sources) -- validated via lockfile scan (all `resolved` URLs are `https://registry.npmjs.org/`)
- ASSUMPTION: Extraneous packages are harmless build artifacts -- NOT VALIDATED (5 extraneous packages present)

## Risk Observations (Prioritized)

1. **Crank `npm install` in production**: `railway-crank.toml:3` uses `buildCommand = "npm install"` instead of `npm ci`. This can silently update the lockfile during build, installing different versions than pinned. The crank handles epoch transitions, VRF, and carnage operations with a funded wallet. A supply chain attack through lockfile modification could compromise the crank wallet.

2. **30 known CVEs, no CI gate**: The dependency tree has 30 known vulnerabilities including 9 high-severity. No `npm audit`, `audit-ci`, or Snyk step exists in CI. Vulnerabilities accumulate silently. The `next@16.1.6` CSRF bypass (GHSA-mq59) is particularly concerning for a web app with webhook endpoints.

3. **`next@16.1.6` HTTP request smuggling (GHSA-ggv3)**: Allows request smuggling via rewrites. The app uses rewrites/headers configuration. Upgrade to `16.2.1` available but outside declared range.

4. **`elliptic` cryptographic weakness (GHSA-848j)**: No fix available. Transitively pulled by `@irys/upload-solana`. This library is used for Arweave/Irys metadata upload (deploy scripts only, not runtime). The vulnerability affects ECDSA implementations. Impact is limited to deploy-time operations but could theoretically allow signing key recovery.

5. **`bigint-buffer` buffer overflow (GHSA-3gc7)**: High severity, pulled via `@solana/spl-token` -> `@solana/buffer-layout-utils`. This is used in runtime code (frontend, crank). Fix requires `@solana/spl-token@0.1.8` which is a massive breaking change and not practical.

6. **No automated dependency updates**: No Dependabot, Renovate, or equivalent. CVE patches require manual discovery and intervention. H056 from Audit #1 noted deprecated packages (`glob@7.x`, `inflight@1.x`) -- still present.

7. **`react-native` transitive bloat**: 200+ transitive deps pulled through `@solana/wallet-adapter-react` -> `@solana-mobile/wallet-adapter-mobile`. Each additional package is additional attack surface. react-native is unnecessary for a web app.

## Novel Attack Surface

- **Unregistered npm scope `@dr-fraudsworth`**: While workspace resolution prevents public registry fallback for the current codebase, if a new developer clones the repo and runs `npm install` without the workspace-aware root, or if CI misconfigures the workspace root, npm could attempt to resolve `@dr-fraudsworth/shared@0.0.1` from the public registry. Since the scope is unclaimed, an attacker could register it and publish a malicious `@dr-fraudsworth/shared@0.0.1` package. The workspace protocol (`workspace:*`) would prevent this entirely. The `"0.0.1"` bare version string provides no workspace-only guarantee.

- **Nixpacks behavior opacity**: Railway uses Nixpacks for builds. The exact npm command Nixpacks runs depends on its version and Node.js detection heuristics. The project specifies `providers = ["node"]` in `nixpacks.toml` but does not pin the Nixpacks version for the main app (only the docs-site pins `nixpacksVersion = "1.41.0"`). A Nixpacks update could change install behavior.

## Cross-Focus Handoffs

- -> **ERR-01 (Error Handling)**: The `serialize-javascript` RCE (GHSA-5c6j) is in the `mocha` dependency chain. If mocha is accidentally included in production builds, this becomes exploitable. Verify mocha is dev-only and not bundled.
- -> **CHAIN-01 (RPC/Slot)**: `@solana/web3.js@1.98.4` and `@solana/spl-token@0.4.14` are both in the `bigint-buffer` CVE path. Any code path that calls `toBigIntLE()` on untrusted buffer data could trigger the overflow. Audit buffer handling in RPC response processing.
- -> **SEC-02 (Secrets)**: The `railway-crank.toml` `npm install` issue is compounded by the crank having access to `WALLET_KEYPAIR` env var. Supply chain compromise of the crank's dependencies directly threatens the crank wallet.
- -> **INFRA-03 (Cloud/Config)**: Nixpacks version is unpinned for the main app. Railway build behavior could change without warning.

## Trust Boundaries

The npm registry is the primary trust boundary for the JavaScript supply chain. All 676 installed packages resolve from `registry.npmjs.org`. The `.npmrc` `ignore-scripts=true` setting provides a critical defense layer by preventing arbitrary code execution during install. The lockfile (`package-lock.json` v3 with integrity hashes) pins exact versions and content hashes. CI uses `npm ci` which enforces lockfile integrity. The main weakness is the crank Railway service using `npm install` instead of `npm ci`, and the absence of any automated vulnerability scanning in CI or deployment. The `@dr-fraudsworth/shared` workspace package is correctly symlinked locally but referenced with a bare version rather than workspace protocol, creating a theoretical dependency confusion vector. The Rust supply chain is well-pinned via committed `Cargo.lock`.
<!-- CONDENSED_SUMMARY_END -->

---

# Package & Dependency Security (DEP-01) -- Full Analysis

## Executive Summary

The Dr. Fraudsworth project demonstrates mature supply chain hygiene in several areas: lockfiles are committed and tracked, install scripts are globally blocked via `.npmrc`, CI uses `npm ci`, and all packages resolve from the public npm registry. However, there are significant gaps: the crank production service uses `npm install` instead of `npm ci`, no dependency auditing exists in CI, no automated update tooling (Dependabot/Renovate) is configured, and the dependency tree carries 30 known CVEs including 9 high-severity. The `next@16.1.6` framework has multiple moderate vulnerabilities including a CSRF bypass and HTTP request smuggling. The `@dr-fraudsworth/shared` workspace package uses a bare version reference instead of the `workspace:*` protocol, creating a theoretical dependency confusion vector.

## Scope

### Files Analyzed (Layer 3 -- Full Read)
- `/Users/mlbob/Projects/Dr Fraudsworth/package.json` (root, 43 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/package.json` (app workspace, 47 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/shared/package.json` (shared workspace, 13 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/package-lock.json` (19,253 lines, v3 format)
- `/Users/mlbob/Projects/Dr Fraudsworth/.npmrc` (5 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/.gitignore` (35 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/.gitignore` (41 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/.github/workflows/ci.yml` (306 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/railway.toml` (12 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/railway-crank.toml` (9 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/nixpacks.toml` (1 line)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/next.config.ts` (122 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/scripts/sync-idl.mjs` (89 lines)

### Files Analyzed (Layer 2 -- Signature Scan)
- `Cargo.lock` (tracked by git, confirmed)
- `docs-site/railway.toml` (pins Nixpacks version, reference only)

### Out of Scope
- `programs/*/Cargo.toml` -- on-chain Rust programs, skip per DEP-01 off-chain mandate
- `node_modules/` contents -- analyzed only for install script enumeration

## Key Mechanisms

### 1. npm Workspace Architecture

The project uses npm workspaces with three packages:
```
dr-fraudsworth (root)
├── shared/   (@dr-fraudsworth/shared@0.0.1)
└── app/      (app@0.1.0)
```

Root `package.json:4-7` declares workspaces: `["shared", "app"]`. The `shared` package provides constants, PDAs, and program IDs consumed by both `app` and root-level scripts.

**Dependency resolution chain**: `app/package.json:18` references `"@dr-fraudsworth/shared": "0.0.1"` (bare version). npm workspace resolution resolves this to the local `shared/` directory, confirmed by the lockfile entry `"resolved": "shared", "link": true` and the symlink at `node_modules/@dr-fraudsworth/shared -> ../../shared`.

**Risk**: The bare version `"0.0.1"` instead of `"workspace:*"` means npm's resolution algorithm first checks workspaces, then falls back to the registry. With the workspace root present, this always resolves locally. But if workspace detection fails (CI misconfiguration, partial clone, monorepo restructure), npm could attempt registry resolution. The `@dr-fraudsworth` scope is currently unregistered on npm (verified via `npm info` returning E404). This was previously investigated and cleared as H066 in Audit #1 -- the workspace protocol prevents fallback. However, the use of bare version rather than workspace protocol is a deviation from best practice.

### 2. Lockfile Integrity

**package-lock.json**: v3 format, 19,253 lines, 1,325 SHA-512 integrity hashes. Committed to git. Not excluded by any `.gitignore`. All 1,325 `resolved` URLs point to `https://registry.npmjs.org/` -- no private registries, no git URLs, no HTTP (non-HTTPS) sources.

**Cargo.lock**: Committed to git (confirmed via `git ls-files`). This pins the Rust dependency tree for on-chain programs and crank scripts.

### 3. Install Script Protection

`.npmrc:5` sets `ignore-scripts=true` globally. This blocks lifecycle scripts (preinstall, install, postinstall) for all npm operations.

**13 packages declare install scripts** (identified via `hasInstallScript` in lockfile):
1. `protobufjs` (postinstall) -- legitimate: downloads prebuilt binaries
2. `sharp` (postinstall) -- legitimate: downloads libvips native module
3. `esbuild` (3 instances, postinstall) -- legitimate: downloads platform binary
4. `bigint-buffer` (install) -- builds native addon via node-gyp
5. `bufferutil` (install) -- builds native addon
6. `keccak` (install) -- builds native addon
7. `secp256k1` (install) -- builds native addon
8. `utf-8-validate` (install) -- builds native addon
9. `fsevents` (install) -- macOS-only native module
10. `unrs-resolver` (postinstall) -- downloads platform binary

With `ignore-scripts=true`, none of these run during `npm ci` or `npm install`. Native modules that need rebuilding must use `npm rebuild <package>` explicitly. This is the correct pattern per the H003 fix from Audit #1.

### 4. CI Pipeline

`.github/workflows/ci.yml` runs on push to `main`. Two jobs:

**Job 1 (rust-tests)**: Lines 123-124 use `npm ci` (correct). No dependency audit step.
**Job 2 (ts-tests)**: Lines 244-245 use `npm ci` (correct). No dependency audit step.

Neither job runs `npm audit`, `npx audit-ci`, or any equivalent. There is no GitHub Actions workflow for dependency scanning (no `github/codeql-action`, no Snyk, no Socket).

### 5. Railway Build Pipeline

**Main app** (`railway.toml`):
- `builder = "NIXPACKS"`, `buildCommand = "npm run --workspace app build"`
- No explicit install command. Nixpacks auto-detects Node.js project and runs `npm ci` when `package-lock.json` is present.
- `nixpacks.toml` specifies `providers = ["node"]` but does not pin Nixpacks version.

**Crank** (`railway-crank.toml`):
- `builder = "NIXPACKS"`, `buildCommand = "npm install"`
- **PROBLEM**: Explicitly uses `npm install` instead of `npm ci`. `npm install` can modify the lockfile, resolve different versions, and bypass integrity checks. This is the crank service that manages a funded wallet.

### 6. Version Pinning Strategy

**Root `package.json`**: Uses caret ranges (`^`) for all dependencies. This is standard for non-production root packages.

**App `package.json`**: Uses exact versions (no `^` or `~`) for most dependencies (e.g., `"next": "16.1.6"`, `"react": "19.2.3"`). Two exceptions use caret: `"@solana/wallet-adapter-base": "^0.9.27"`, `"@solana/wallet-adapter-react": "^0.15.39"`, and `"vitest": "^4.0.18"`. The lockfile pins all resolved versions regardless of range syntax.

The app's approach of exact pinning is good practice for production dependencies. The lockfile provides the actual enforcement.

## Trust Model

### Trusted Sources
- npm public registry (`registry.npmjs.org`) -- sole package source
- GitHub repository (code provenance)
- Railway/Nixpacks build environment (build execution)

### Trust Boundaries
1. **Developer machine -> npm registry**: `npm ci` + lockfile integrity hashes verify package content
2. **Git repository -> CI**: `npm ci` enforces lockfile match
3. **Git repository -> Railway**: Nixpacks handles install (main app likely uses `npm ci`; crank explicitly uses `npm install`)
4. **npm packages -> runtime**: `ignore-scripts=true` prevents code execution during install; only the declared entry points execute at runtime

### Trust Gaps
- No verification that Nixpacks actually runs `npm ci` for the main app
- Crank explicitly opts out of lockfile enforcement via `npm install`
- No runtime dependency scanning (SCA) or SBOM generation
- No monitoring for newly published CVEs in the dependency tree

## State Analysis

### Package Count
- 676 packages installed in `node_modules/`
- 48 direct dependencies (across root + app + shared)
- 5 extraneous packages: `@emnapi/core@1.8.1`, `@emnapi/runtime@1.8.1`, `@emnapi/wasi-threads@1.1.0`, `@napi-rs/wasm-runtime@0.2.12`, `@tybys/wasm-util@0.10.1` -- likely artifacts from a previous native module install that weren't cleaned up

### Vulnerability State (npm audit output)
- **30 total vulnerabilities**: 16 low, 5 moderate, 9 high
- No critical CVEs

#### High Severity
1. **bigint-buffer (GHSA-3gc7)**: Buffer overflow via `toBigIntLE()`. Transitive via `@solana/spl-token`. No practical fix (requires `spl-token@0.1.8` downgrade).
2. **elliptic (GHSA-848j)**: Risky ECDSA implementation. No fix available. Via `@irys/upload-solana` -> `secp256k1`. Deploy-time only.
3. **serialize-javascript (GHSA-5c6j)**: RCE via RegExp.flags. Via `mocha` (dev-only). Fix available: `npm audit fix`.
4. **flatted (GHSA-25h7, GHSA-rf6f)**: DoS + prototype pollution via `parse()`. Fix available.
5-9. Various transitive ethersproject chain via elliptic.

#### Moderate Severity
1. **next@16.1.6 (5 CVEs)**: HTTP request smuggling, disk cache exhaustion, postponed buffering DoS, null origin CSRF bypass, null origin HMR CSRF bypass. Fix: `next@16.2.1`.
2. **esbuild (GHSA-67mh)**: Dev server request leakage. Dev-only, no production impact.

## Dependencies (External APIs, Packages, Services)

### Production-Critical Direct Dependencies
| Package | Version | Role | CVE Status |
|---------|---------|------|------------|
| `@coral-xyz/anchor` | 0.32.1 | Anchor framework | Clean |
| `@solana/web3.js` | 1.98.4 | Solana RPC client | Clean |
| `@solana/spl-token` | 0.4.14 | Token operations | Transitive: bigint-buffer HIGH |
| `next` | 16.1.6 | Web framework | 5 MODERATE CVEs |
| `drizzle-orm` | 0.45.1 | Database ORM | Clean |
| `postgres` | 3.4.8 | PostgreSQL driver | Clean |
| `@solana/wallet-adapter-react` | 0.15.39 | Wallet connection | Transitive: react-native bloat |
| `buffer` | 6.0.3 | Browser Buffer polyfill | Clean |
| `lightweight-charts` | 5.1.0 | Chart rendering | Clean |

### Deploy/CI-Only Dependencies
| Package | Version | Role | CVE Status |
|---------|---------|------|------------|
| `@irys/upload-solana` | 0.1.8 | Arweave metadata upload | Transitive: elliptic HIGH |
| `@sqds/multisig` | 2.1.4 | Squads governance | Transitive: bigint-buffer HIGH |
| `@switchboard-xyz/on-demand` | 3.9.0 | VRF randomness | Transitive: bigint-buffer HIGH |
| `mocha` / `ts-mocha` | 11.7.5 / 10.1.0 | Testing | Transitive: serialize-javascript HIGH |

### Transitive Dependency Concerns
- **`react-native@0.84.0`**: Pulled via `@solana/wallet-adapter-react` -> `@solana-mobile/wallet-adapter-mobile` -> `@react-native-async-storage/async-storage`. This is a web-only application; react-native adds ~200 transitive deps for zero runtime value. This expands the attack surface significantly.
- **`@ethersproject/*`**: Ethereum ecosystem libraries pulled via `@irys/bundles`. These carry the `elliptic` CVE chain. Only used for Irys/Arweave operations (deploy scripts).

## Focus-Specific Analysis

### OC-234: Lockfile Committed (PASS)
Both `package-lock.json` and `Cargo.lock` are committed and tracked by git. The `.gitignore` does not exclude lockfiles. This was a finding in Audit #1 (H003/INV-OC9) and was fixed.

### OC-235: Lockfile Integrity (PARTIAL PASS)
The lockfile uses v3 format with 1,325 integrity hashes. CI uses `npm ci` which verifies integrity. However, the crank Railway build uses `npm install` which does NOT verify integrity and can modify the lockfile.

### OC-236: Typosquatting (PASS)
All direct dependencies are well-known, high-download packages from established npm scopes (`@coral-xyz`, `@solana`, `@switchboard-xyz`, `@sqds`, `@irys`). No suspicious or low-download packages detected.

### OC-237: Dependency Confusion (LOW RISK)
The `@dr-fraudsworth/shared` package uses workspace resolution. The scope is unregistered on npm. The lockfile records it as a local link. The risk is theoretical -- it would require workspace misconfiguration AND an attacker claiming the npm scope simultaneously. Previous Audit #1 finding H066 cleared this.

### OC-238: Unmaintained Dependencies (PARTIAL FAIL)
- `glob@7.2.3` -- deprecated (glob@10+ is replacement). Pulled transitively.
- `inflight@1.x` -- deprecated, permanently. Pulled via glob@7.
- These are transitive and build-time only. Previously noted as H056 in Audit #1 (NOT_FIXED, LOW).

### OC-240: Install Hooks (PASS)
`.npmrc` `ignore-scripts=true` blocks all install hooks. 13 packages have install scripts but none execute. This was the H003 fix.

### OC-241: Private Registry Misconfiguration (PASS)
`.npmrc` contains only `ignore-scripts=true`. No private registry configuration. No scope-to-registry mapping needed since only public registry is used.

### OC-242: Pinned to Vulnerable Version Range (FAIL)
- `next` pinned at exactly `16.1.6` which has 5 known CVEs. Fix available at `16.2.1`.
- `@solana/spl-token` at `0.4.14` carries `bigint-buffer` HIGH CVE with no practical fix.

### OC-243: Missing npm Audit in CI (FAIL)
No `npm audit`, `audit-ci`, `npx audit-ci`, Snyk, or equivalent in `.github/workflows/ci.yml`. This means CVEs are only discovered through manual checks.

### OC-244: CDN Script Tags without SRI (PASS)
No CDN script tags found anywhere in the codebase. All JavaScript is bundled by Next.js/Turbopack. No external script loading.

### OC-245: Bundled Dependencies with Modifications (PASS)
`node_modules/` is not committed. No vendored dependencies. All packages resolve from npm registry.

## Cross-Focus Intersections

### DEP-01 x SEC-02 (Secrets)
The crank service (`railway-crank.toml`) uses `npm install` and has access to `WALLET_KEYPAIR` env var. A supply chain attack on the crank's dependencies could exfiltrate the crank wallet private key. The crank wallet is funded and signs epoch/carnage/VRF transactions.

### DEP-01 x CHAIN-01 (RPC)
`@solana/web3.js@1.98.4` is the primary RPC library. It is currently clean of CVEs. However, the `bigint-buffer` CVE in `@solana/spl-token` affects buffer operations that could be triggered by malformed RPC responses.

### DEP-01 x WEB-02 (Web Security)
`next@16.1.6` has a CSRF bypass via null origin (GHSA-mq59). The webhook route (`app/app/api/webhooks/helius/route.ts`) uses custom HMAC auth, so it's not affected by Next.js's Server Actions CSRF. But any future Server Actions would be vulnerable.

### DEP-01 x INFRA-03 (Infrastructure)
The Nixpacks version is unpinned for the main app (`nixpacks.toml` has only `providers = ["node"]`). The docs-site pins `nixpacksVersion = "1.41.0"`. A Nixpacks update could change the install command from `npm ci` to something else.

## Cross-Reference Handoffs

| Target Agent | Item | Priority |
|-------------|------|----------|
| ERR-01 | Verify `mocha` and `serialize-javascript` are NOT in production bundle (dev-only) | Medium |
| CHAIN-01 | Audit `bigint-buffer` usage paths through `@solana/spl-token` in RPC response handling | Medium |
| SEC-02 | Assess crank wallet exposure given `npm install` in crank Railway build | High |
| INFRA-03 | Pin Nixpacks version in main `nixpacks.toml` and verify Railway install command | Medium |
| WEB-02 | Assess `next@16.1.6` CSRF and HTTP smuggling CVEs against current route handlers | Medium |

## Risk Observations

### R1: Crank Railway uses `npm install` (HIGH)
**File**: `railway-crank.toml:3`
**What**: `buildCommand = "npm install"` instead of `npm ci`
**Why risky**: `npm install` ignores lockfile integrity, can resolve different versions, and can silently modify the lockfile. The crank service handles a funded wallet (`WALLET_KEYPAIR`). A supply chain attack modifying a transitive dependency during build could compromise the wallet.
**Remediation**: Change to `buildCommand = "npm ci"`

### R2: No dependency audit in CI (HIGH)
**File**: `.github/workflows/ci.yml` (absent step)
**What**: Neither CI job runs `npm audit` or equivalent
**Why risky**: 30 known CVEs (9 high) are invisible to the CI pipeline. New CVEs introduced by dependency updates have no automated gate.
**Remediation**: Add `npx audit-ci --high` step after `npm ci` in both jobs

### R3: next@16.1.6 CVEs (MEDIUM)
**File**: `app/package.json:29`
**What**: 5 CVEs including CSRF bypass (GHSA-mq59) and HTTP smuggling (GHSA-ggv3)
**Why risky**: The CSRF bypass via null origin affects Server Actions. HTTP smuggling via rewrites could bypass WAF rules. The disk cache exhaustion could DoS the Railway deployment.
**Remediation**: Upgrade to `next@16.2.1`

### R4: elliptic CVE with no fix (MEDIUM)
**File**: `package.json:23` (via `@irys/upload-solana`)
**What**: GHSA-848j affects ECDSA implementation in `elliptic`
**Why risky**: Used by `@irys/bundles` for Arweave signing. If the signing key can be recovered, uploaded metadata could be tampered with. Limited to deploy-time operations.
**Remediation**: Monitor for upstream fix. Consider replacing `@irys/upload-solana` with alternative Arweave upload library.

### R5: No Dependabot/Renovate (MEDIUM)
**File**: `.github/` (absent)
**What**: No automated dependency update mechanism
**Why risky**: CVE patches require manual discovery. The project has been running with H056 (deprecated glob/inflight) unfixed since Audit #1.
**Remediation**: Add `.github/dependabot.yml` with npm and cargo ecosystems

### R6: bigint-buffer HIGH CVE (MEDIUM)
**File**: Runtime via `@solana/spl-token`
**What**: Buffer overflow in `toBigIntLE()` (GHSA-3gc7)
**Why risky**: Triggered by crafted Buffer input. The `@solana/spl-token` library uses this for token account deserialization. An attacker controlling account data could trigger the overflow.
**Remediation**: No practical fix without downgrading spl-token to 0.1.x. Monitor for upstream `@solana/buffer-layout-utils` migration away from `bigint-buffer`.

### R7: react-native transitive bloat (LOW)
**File**: Via `app/package.json:23` (`@solana/wallet-adapter-react`)
**What**: `react-native@0.84.0` and ~200 transitive deps pulled into a web-only app
**Why risky**: Increases attack surface. react-native has its own set of native dependencies and build scripts.
**Remediation**: Consider `@solana/wallet-adapter-react` alternative that doesn't pull mobile deps, or use npm `overrides` to stub `@solana-mobile/wallet-adapter-mobile`.

### R8: Extraneous packages (LOW)
**File**: `node_modules/` (5 packages)
**What**: `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util` installed but undeclared
**Why risky**: Unknown provenance. May contain code that runs if imported accidentally.
**Remediation**: Run `npm prune` to remove extraneous packages

### R9: serialize-javascript RCE (LOW -- dev only)
**File**: Via `mocha` (dev dependency)
**What**: RCE via RegExp.flags (GHSA-5c6j)
**Why risky**: Only exploitable if mocha processes untrusted serialized JavaScript. Dev-only dependency, not in production bundle.
**Remediation**: `npm audit fix` resolves this

### R10: @dr-fraudsworth/shared bare version (LOW)
**File**: `app/package.json:18`
**What**: Referenced as `"0.0.1"` not `"workspace:*"`
**Why risky**: Theoretical dependency confusion if workspace resolution fails and npm scope is claimed
**Remediation**: Change to `"workspace:*"` for explicit workspace-only resolution

### R11: Unpinned Nixpacks version (LOW)
**File**: `nixpacks.toml:1`
**What**: Only specifies `providers = ["node"]`, no version pin
**Why risky**: Nixpacks updates could change install behavior
**Remediation**: Add `nixpacksVersion = "X.Y.Z"` matching current Railway version

### R12: flatted DoS + prototype pollution (LOW)
**File**: Transitive dependency
**What**: GHSA-25h7 (DoS) + GHSA-rf6f (prototype pollution) in `flatted@<=3.4.1`
**Why risky**: If `flatted.parse()` is called with untrusted input, DoS or prototype pollution possible
**Remediation**: `npm audit fix` resolves this

## Novel Attack Surface Observations

### 1. Crank Supply Chain -> Wallet Drain
The crank service on Railway builds with `npm install`, which could resolve different dependency versions than what's in the lockfile. The crank has access to `WALLET_KEYPAIR`. An attacker who publishes a malicious minor version of any crank dependency (or transitive dependency) could exfiltrate the wallet key. Combined with the 676-package dependency tree, this represents a meaningful supply chain attack surface. The `.npmrc` `ignore-scripts=true` provides defense-in-depth (blocks install-time attacks) but doesn't prevent runtime-level supply chain attacks through modified package code.

### 2. Nixpacks Opacity
The project relies on Nixpacks to auto-detect and run the correct npm commands. Unlike a Dockerfile where every step is explicit, Nixpacks abstracts the build process. If Nixpacks changes its Node.js provider behavior (e.g., switching from `npm ci` to `npm install`, or adding `--ignore-scripts=false`), the security posture changes silently. The main app doesn't pin the Nixpacks version.

### 3. IDL Sync Script as Build-Time Attack Vector
`app/scripts/sync-idl.mjs` runs during `predev` and `prebuild` hooks. It copies files from `target/idl/` to `app/idl/`. If an attacker can modify `target/idl/` (e.g., through a compromised Anchor build or a malicious Cargo dependency), the IDL files propagated to the app would contain incorrect type definitions. This could cause the frontend to construct invalid transactions. The script itself is safe (no user input, hardcoded paths), but it bridges the Rust and TypeScript supply chains.

## Questions for Other Focus Areas

1. **For SEC-02**: Is the crank wallet keypair rotated regularly? Given the `npm install` exposure, key rotation becomes more important.
2. **For INFRA-03**: What Nixpacks version is Railway currently using for the main app? Does it use `npm ci` or `npm install`?
3. **For CHAIN-01**: Are there any code paths where `bigint-buffer.toBigIntLE()` is called with untrusted data (e.g., from RPC responses)?
4. **For ERR-01**: Is `mocha` tree-shaken out of the production Next.js bundle? The `serialize-javascript` RCE is in its dep tree.
5. **For WEB-02**: Does the app use Next.js Server Actions? The null-origin CSRF bypass in `next@16.1.6` only affects Server Actions.

## Raw Notes

- H003 (npm supply chain attack) from Audit #1 was FIXED via `.npmrc` `ignore-scripts=true`. Fix is still intact.
- H056 (deprecated npm packages) from Audit #1 was NOT_FIXED (LOW). Still present: `glob@7.x`, `inflight@1.x`.
- H057 (install script packages) from Audit #1 was FIXED via `.npmrc`. Fix is still intact.
- H066 (@dr-fraudsworth/shared dependency confusion) from Audit #1 was cleared as NOT_VULNERABLE. Assessment still holds (workspace resolution prevents fallback), though using `workspace:*` would be stronger.
- S001 (chained supply chain attack) from Audit #1 was FIXED. The chain was: webhook bypass + supply chain -> data pipeline takeover. Webhook auth is now fail-closed, supply chain is pinned via lockfile. However, the crank `npm install` issue introduces a new link in a similar chain.
- The `overrides` field in root `package.json:28-31` forces `react` and `react-dom` to `19.2.3` across all workspaces. This is intentional deduplication, not a security concern.
- The app uses `tsx@4.21.0` as a runtime dependency (not just dev). This is for running TypeScript scripts directly. tsx itself is clean of CVEs.
- `drizzle-kit@0.31.9` pulls vulnerable `esbuild` (GHSA-67mh) but this is a dev-only build tool. The dev server vulnerability has no production impact.
- The CI workflow pins tool versions explicitly: Rust 1.93.0, Solana 3.0.13, Anchor 0.32.1, Node 22. This is good practice for build reproducibility.
- GitHub Actions uses `actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4`, `dtolnay/rust-toolchain@1.93.0`. These are all pinned to major or exact versions. Pinning to SHA would be more secure but is not standard practice.
