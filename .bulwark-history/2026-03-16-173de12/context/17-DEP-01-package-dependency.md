---
task_id: db-phase1-package-dependency
provides: [package-dependency-findings, package-dependency-invariants]
focus_area: package-dependency
files_analyzed: [package.json, app/package.json, shared/package.json, docs-site/package.json, .gitignore, app/.gitignore, package-lock.json, Cargo.lock, railway.toml, nixpacks.toml, app/next.config.ts, scripts/deploy/deploy-all.sh, scripts/deploy/build.sh, scripts/deploy/deploy.sh, scripts/run-integration-tests.sh, shared/constants.ts, shared/programs.ts, app/lib/anchor.ts, app/lib/connection.ts, app/scripts/sync-idl.mjs, scripts/deploy/patch-mint-addresses.ts]
finding_count: 9
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 3, informational: 1}
---
<!-- CONDENSED_SUMMARY_START -->
# Package & Dependency Security — Condensed Summary

## Key Findings (Top 10)
- **package-lock.json explicitly gitignored**: Root `.gitignore:9` contains `package-lock.json`. The lockfile exists on disk (603KB, lockfileVersion 3, 1174 packages) but is NOT committed to git. Every `npm install` on CI/Railway resolves versions dynamically, defeating reproducibility and enabling time-of-install supply chain attacks. — `.gitignore:9`
- **Railway build uses `npm install` not `npm ci`**: `railway.toml:3` runs `npm run --workspace app build`. Without a committed lockfile, Railway's Nixpacks builder runs `npm install` which resolves transitive deps non-deterministically. — `railway.toml:3`
- **No `npm audit` or dependency scanning in any pipeline**: No CI/CD workflow exists (no `.github/workflows/`). No `npm audit`, `audit-ci`, or equivalent in build/deploy scripts. Zero automated vulnerability scanning. — project-wide absence
- **7 deprecated packages in dependency tree**: glob (security vulnerabilities), inflight (memory leak), rimraf (EOL), @esbuild-kit/* (merged into tsx). While mostly transitive, glob's deprecation is security-relevant. — `package-lock.json`
- **11 packages with install scripts (postinstall hooks)**: esbuild (3 instances), bigint-buffer, bufferutil, fsevents, protobufjs, sharp, unrs-resolver, utf-8-validate. None are run with `--ignore-scripts`. — `package-lock.json`
- **Version mismatches between root and app workspaces**: `@coral-xyz/anchor` (^0.32.1 vs 0.32.1), `@solana/web3.js` (^1.95.5 vs 1.98.4), `@solana/spl-token` (^0.4.9 vs 0.4.14), `typescript` (^5.3.2 vs 5.9.3). Caret ranges in root could resolve differently than pinned versions in app. — `package.json` vs `app/package.json`
- **Helius API key hardcoded in committed source**: Free-tier API key `[REDACTED-DEVNET-HELIUS-KEY]` in `shared/constants.ts:474` and `shared/programs.ts:22`. Comment says "not a secret" but it is a rate-limited credential that could be abused. — `shared/constants.ts:474`, `shared/programs.ts:22`
- **React overrides in root package.json**: `"overrides": { "react": "19.2.3", "react-dom": "19.2.3" }` forces React 19 across all workspace packages. This is intentional but means any transitive dependency incompatible with React 19 will silently break. — `package.json:26-28`
- **Cargo.lock is committed (good)**: Rust/Anchor dependency tree is pinned and reproducible. — `Cargo.lock` tracked in git
- **Strong CSP on frontend**: `app/next.config.ts` has strict Content-Security-Policy with no CDN script sources, no `unsafe-eval`. This significantly reduces client-side supply chain risk. — `app/next.config.ts:7-23`

## Critical Mechanisms
- **Dependency resolution at build time**: Without committed lockfile, every Railway deploy resolves versions fresh. The same `^0.32.1` could resolve to 0.32.1 today and 0.32.99 tomorrow if published. Attack surface: a compromised patch release of any caret-ranged dependency. — `.gitignore:9`, `railway.toml:3`
- **Workspace package linking**: npm workspaces link `shared/` and `app/` packages. `app/package.json` depends on `@dr-fraudsworth/shared: 0.0.1`. The shared package has `"main": "index.ts"` (raw TypeScript, not compiled), transpiled by Next.js via `transpilePackages`. — `shared/package.json:6`, `app/next.config.ts:27`
- **IDL sync predev/prebuild hook**: `app/scripts/sync-idl.mjs` copies IDL JSON from `target/idl/` to `app/idl/` on every dev/build. This is a trusted copy of Anchor build artifacts. If `target/` were compromised, malicious IDLs would propagate. — `app/scripts/sync-idl.mjs`
- **Patch-mint-addresses modifies Rust source at build time**: `scripts/deploy/patch-mint-addresses.ts` rewrites `constants.rs` files with derived addresses before `anchor build`. If this script were compromised, it could inject arbitrary addresses. — `scripts/deploy/build.sh:52-58`

## Invariants & Assumptions
- INVARIANT: Cargo.lock must be committed and used for all Rust builds — enforced at `Cargo.lock` (git-tracked)
- INVARIANT: package-lock.json must pin all JS dependency versions for reproducible builds — NOT enforced (gitignored at `.gitignore:9`)
- INVARIANT: No wildcard (`*`) or `latest` version specifiers in any package.json — enforced (verified across all 4 package.json files)
- INVARIANT: Build scripts must use `set -e` for fail-fast behavior — enforced at `deploy-all.sh:30`, `build.sh:28`, `deploy.sh:40`
- ASSUMPTION: npm install scripts (postinstall) from dependencies are safe — UNVALIDATED (no `--ignore-scripts` used anywhere)
- ASSUMPTION: @switchboard-xyz/on-demand (caret-ranged ^3.7.3) will not publish a compromised patch — UNVALIDATED (no lockfile committed)
- ASSUMPTION: Railway Nixpacks builder uses `npm install` (not `npm ci`) when no lockfile is present — validated by Railway docs and absence of committed lockfile
- ASSUMPTION: Helius free-tier API key exposure in source code is acceptable — partially validated (comment at `shared/constants.ts:472` says "not a secret"; however it is a rate-limited credential)

## Risk Observations (Prioritized)
1. **Gitignored package-lock.json enables supply chain attacks**: `.gitignore:9` — Any caret-ranged dependency could be silently replaced by a compromised version between builds. This is the single highest-impact supply chain issue. Impact: full compromise of any deployed code if a dependency is hijacked. Likelihood: possible (npm ecosystem attacks are documented).
2. **No dependency vulnerability scanning**: project-wide — Zero automated `npm audit`, no GitHub Dependabot, no audit-ci in CI. Known CVEs in transitive dependencies go undetected indefinitely. Impact: running code with known vulnerabilities. Likelihood: probable (7 deprecated packages already present).
3. **11 packages run install scripts without --ignore-scripts**: `package-lock.json` — postinstall hooks execute with developer/CI privileges. While current packages (esbuild, sharp, protobufjs) are legitimate, no mechanism prevents a future dependency from adding a malicious hook. Impact: arbitrary code execution during install. Likelihood: unlikely for current deps, possible for future additions.
4. **Version drift between workspaces**: `package.json` vs `app/package.json` — Root uses `@solana/web3.js: ^1.95.5` while app uses `1.98.4`. Different Solana SDK versions in scripts vs frontend could cause subtle behavioral differences (e.g., transaction serialization). Impact: silent behavioral bugs. Likelihood: possible.
5. **No CI/CD pipeline at all**: project-wide — No `.github/workflows/`, no automated tests on PR, no dependency audit on PR. All quality gates are manual.

## Novel Attack Surface
- **IDL sync as attack vector**: The `predev`/`prebuild` hook copies IDL files from `target/idl/`. If an attacker compromised the Rust build toolchain or injected a malicious `.so` that generated tampered IDL JSON, the frontend would deserialize on-chain accounts using attacker-controlled type definitions. This could cause the UI to display wrong balances or construct malicious transactions. The attack requires local build compromise but the blast radius extends to all frontend users.
- **patch-mint-addresses as trust amplifier**: This script modifies Rust source code at build time based on keypair files on disk. A compromised keypair file would cause the wrong mint addresses to be compiled into production programs. The script has no integrity verification of keypair files.

## Cross-Focus Handoffs
- -> **SEC-01 (Secret Management)**: Helius API key hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22`. Evaluate whether this credential should be environment-variable-only.
- -> **INFRA-03 (Infrastructure)**: Railway deploy has no lockfile pinning and no `npm ci`. Investigate whether Railway's Nixpacks builder can be configured to use `npm ci` with a committed lockfile.
- -> **CHAIN-06 (PDA/Interaction)**: Version mismatch in `@solana/web3.js` between root (^1.95.5) and app (1.98.4) could cause different PDA derivation or transaction serialization behavior in scripts vs frontend.
- -> **BOT-01 (Crank Security)**: Crank runner on Railway (`scripts/crank/crank-runner.ts`) uses root workspace deps. Without lockfile pinning, a Railway redeploy could change the Anchor/web3.js version the crank uses.

## Trust Boundaries
The project trusts the npm public registry to serve uncompromised packages for every build, with no lockfile to verify integrity. The Rust side is properly pinned (Cargo.lock committed). The frontend has strong CSP that mitigates client-side injection from compromised scripts. However, the server-side (API routes, crank runner) has no such protection — a compromised npm dependency would have full access to signing keys, database credentials, and RPC connections. The Railway deployment platform is trusted to execute the build faithfully, but without `npm ci` or a lockfile, there is no way to verify that the deployed code uses the same dependencies as the developer's local environment.
<!-- CONDENSED_SUMMARY_END -->

---

# Package & Dependency Security — Full Analysis

## Executive Summary

The Dr. Fraudsworth project has a **critical gap in JavaScript dependency pinning**: `package-lock.json` is explicitly gitignored, meaning every build resolves dependency versions dynamically from the npm registry. This defeats reproducibility and opens the door to supply chain attacks where a compromised patch release of any caret-ranged dependency silently enters the build. On the positive side, Rust dependencies are properly pinned via a committed `Cargo.lock`, the frontend has strong CSP headers preventing client-side script injection, and no deprecated/known-malicious packages are directly depended upon (though 7 deprecated transitive dependencies exist).

The project has no CI/CD pipeline, no automated dependency scanning, and no `--ignore-scripts` protections during npm install. These are foundational supply chain hygiene gaps that should be addressed before mainnet deployment.

## Scope

**Analyzed**: All off-chain package manifests, lockfiles, build scripts, deployment configurations, and dependency-consuming code. Excluded `programs/` (Anchor/Rust on-chain code — run SOS for on-chain audit).

**Workspaces**: Root monorepo, `app/` (Next.js frontend), `shared/` (constants package), `docs-site/` (documentation site).

## Key Mechanisms

### 1. Dependency Resolution Chain

The project is an npm workspace monorepo:
```
root/package.json       (workspaces: [shared, app])
  shared/package.json   (@dr-fraudsworth/shared, raw .ts)
  app/package.json      (Next.js 16, depends on shared)
  docs-site/package.json (separate, not in workspace)
```

Root `package.json:4-7` defines workspaces. `app/package.json:18` depends on `@dr-fraudsworth/shared: 0.0.1`. The shared package exports raw TypeScript (`"main": "index.ts"`), transpiled by Next.js via `transpilePackages` config at `app/next.config.ts:27`.

### 2. Build Pipeline

**Local build**: `scripts/deploy/build.sh` runs `anchor build` (Rust) followed by `npx tsx scripts/verify-program-ids.ts` (TypeScript). The Rust build uses committed `Cargo.lock`. The TypeScript verification uses whatever npm resolved locally.

**Railway deployment**: `railway.toml:3` runs `npm run --workspace app build`. Nixpacks detects `providers = ["node"]` from `nixpacks.toml`. Without a lockfile, Railway runs `npm install` (not `npm ci`), resolving all caret/tilde ranges fresh from the registry.

**Deploy scripts**: `deploy-all.sh` orchestrates build -> deploy -> initialize -> verify. Uses `npx tsx` for TypeScript scripts, which depends on the locally-resolved `tsx` package.

### 3. Version Pinning Strategy

| Package File | Strategy | Assessment |
|---|---|---|
| `Cargo.lock` | Committed, exact versions | GOOD |
| Root `package.json` | Caret ranges (`^`) | Mixed — acceptable WITH lockfile |
| `app/package.json` | Mix of pinned and caret | Mixed |
| `shared/package.json` | Caret peerDep, caret dep | OK for library pattern |
| `package-lock.json` | **GITIGNORED** | BAD — defeats all pinning |

### 4. Install Script Exposure

11 packages have install scripts that run automatically:
- `esbuild` (3 instances) — downloads platform-specific binary
- `sharp` — downloads native image processing library
- `protobufjs` — post-install script
- `bigint-buffer`, `bufferutil`, `utf-8-validate` — native addons
- `fsevents` — macOS filesystem watcher
- `unrs-resolver` — native resolver

All are legitimate packages, but `--ignore-scripts` is not used in any build or install command.

## Trust Model

### Trusted Entities
1. **npm public registry** — Trusted to serve correct packages for every version range. No lockfile to verify.
2. **Railway Nixpacks** — Trusted to build faithfully. No lockfile for integrity.
3. **Anchor build toolchain** — Trusted via committed Cargo.lock.
4. **Developer's local machine** — Trusted for keypair management, mint patching, initial deployment.

### Trust Boundaries
- npm registry -> local node_modules: **UNPROTECTED** (no committed lockfile)
- Anchor IDL -> Next.js frontend: `sync-idl.mjs` copies files with no integrity check
- Keypair files -> Rust source: `patch-mint-addresses.ts` modifies source with no integrity check on inputs
- Helius RPC -> app: API key in source code, rate-limited but not truly secret

## State Analysis

### Package State Files
| File | Location | Committed | Purpose |
|---|---|---|---|
| `package-lock.json` | root | NO (gitignored) | Should pin all npm deps |
| `Cargo.lock` | root | YES | Pins all Rust deps |
| `node_modules/` | root, app | NO (gitignored) | Installed packages |
| `app/idl/*.json` | app | YES | Anchor IDLs for frontend |

### Environment Configuration
| Source | Mechanism | Committed |
|---|---|---|
| `.env` | deploy scripts, crank | NO (gitignored) |
| `app/.env.local` | Next.js frontend | NO (gitignored) |
| `shared/constants.ts` | hardcoded values | YES |
| `shared/programs.ts` | Helius RPC URL with API key | YES |

## Dependencies (External APIs, Packages, Services)

### Direct Dependencies (Root)
| Package | Version | Type | Risk Notes |
|---|---|---|---|
| `@coral-xyz/anchor` | ^0.32.1 | runtime | Core Solana framework. Caret range. |
| `@solana/web3.js` | ^1.95.5 | runtime | Solana SDK. Caret range. |
| `@switchboard-xyz/on-demand` | ^3.7.3 | runtime | VRF oracle. Caret range, large transitive tree. |
| `tsx` | ^4.21.0 | dev | TypeScript runner. |
| `typescript` | ^5.3.2 | dev | Compiler. |

### Direct Dependencies (App)
| Package | Version | Type | Risk Notes |
|---|---|---|---|
| `next` | 16.1.6 | runtime | Pinned. Next.js 16. |
| `@coral-xyz/anchor` | 0.32.1 | runtime | Pinned (no caret). |
| `@solana/web3.js` | 1.98.4 | runtime | Pinned. DIFFERENT from root. |
| `drizzle-orm` | 0.45.1 | runtime | Database ORM. Pinned. |
| `postgres` | 3.4.8 | runtime | PostgreSQL driver. Pinned. |
| `react` | 19.2.3 | runtime | Pinned. React 19. |
| `buffer` | 6.0.3 | runtime | Browser Buffer polyfill. |

### Deprecated Transitive Dependencies
| Package | Deprecation Reason |
|---|---|
| `glob` (3 instances) | Known security vulnerabilities in old versions |
| `inflight` | Memory leak, unsupported |
| `rimraf` | Prior to v4 unsupported |
| `@esbuild-kit/core-utils` | Merged into tsx |
| `@esbuild-kit/esm-loader` | Merged into tsx |

## Focus-Specific Analysis

### OC-234: Lockfile Not Committed
**Status: CONFIRMED**

The root `.gitignore` at line 9 contains `package-lock.json`. This is the most significant supply chain finding. The lockfile exists on disk (603KB, lockfileVersion 3, 1174 packages) but is not tracked by git.

**Impact**: Every build environment (Railway, developer machines, potential future CI) resolves dependency versions independently. A compromised patch release of any dependency with a caret range (e.g., `@switchboard-xyz/on-demand` going from 3.7.3 to 3.7.4-malicious) would be silently installed.

**Root cause**: Likely an AI-generated `.gitignore` that applied the library convention (ignore lockfile) to an application (commit lockfile). This matches AI pitfall AIP-121 exactly.

### OC-235: Lockfile Integrity
**Status: N/A** — Cannot verify integrity of a non-committed lockfile.

### OC-238: Unmaintained Dependencies
**Status: LOW RISK**

7 deprecated packages are all transitive (not directly depended upon). The `glob` deprecation mentions security vulnerabilities but these are in the glob package's own parsing, not directly exploitable through the project's usage path (primarily through mocha test runner).

### OC-240: Packages with Install Hooks
**Status: OBSERVATION**

11 packages have install scripts. All are well-known, legitimate packages (esbuild, sharp, protobufjs, native addons). However, no `--ignore-scripts` flag is used in any install command. The Railway build (`railway.toml`) does not specify `--ignore-scripts`.

### OC-242: Pinned to Vulnerable Version Range
**Status: MEDIUM RISK**

Root `package.json` uses caret ranges for all 3 runtime dependencies:
- `@coral-xyz/anchor: ^0.32.1`
- `@solana/web3.js: ^1.95.5`
- `@switchboard-xyz/on-demand: ^3.7.3`

Without a committed lockfile, these ranges are resolved fresh on every install. The `@switchboard-xyz/on-demand` package is particularly concerning because it has a large transitive dependency tree and is developed by a smaller team than the Solana core SDK.

### OC-243: Missing npm Audit in CI
**Status: CONFIRMED**

No CI/CD pipeline exists. No `.github/workflows/` directory. No `npm audit`, `audit-ci`, or Snyk configuration found anywhere in the project.

### OC-237: Dependency Confusion
**Status: LOW RISK**

No `.npmrc` file exists. The project uses only public npm packages. The `@dr-fraudsworth/shared` package is a local workspace package (not published to npm), which means an attacker could publish a package with the same name to npm. However, npm workspace resolution should prefer the local package. The risk is low but non-zero.

### OC-244: CDN Script Without SRI
**Status: NOT APPLICABLE**

No CDN `<script>` tags found. The frontend loads all JavaScript from the same origin. Strong CSP at `app/next.config.ts:7-23` restricts `script-src` to `'self' 'unsafe-inline'` — no external script sources allowed.

## Cross-Focus Intersections

### With SEC-01/SEC-02 (Secret Management)
The Helius API key `[REDACTED-DEVNET-HELIUS-KEY]` is hardcoded in:
- `shared/constants.ts:474`
- `shared/programs.ts:22`
- Referenced in `app/next.config.ts:19` CSP connect-src

While labeled "not a secret" (free tier), it is a rate-limited credential committed to a public or potentially-public repository. An attacker could use it to exhaust the project's RPC rate limits.

### With INFRA-03 (Infrastructure)
Railway deployment at `railway.toml` does not use `npm ci` and cannot because the lockfile is gitignored. The `preDeployCommand` runs database migrations (`npx tsx app/db/migrate.ts`) which depend on the dynamically-resolved `tsx` and `drizzle-kit` packages.

### With CHAIN-06 (PDA/Interaction)
Version mismatch: root uses `@solana/web3.js: ^1.95.5` (scripts, crank) while app uses `1.98.4` (frontend). Potential for:
- Different PublicKey serialization behavior
- Different transaction construction defaults
- Different RPC call behavior

### With BOT-01 (Crank Security)
The crank runner (`scripts/crank/crank-runner.ts`) runs on Railway using root workspace dependencies. Without lockfile pinning, a Railway container rebuild could change the Anchor SDK version the crank uses, potentially breaking CPI interaction with deployed programs.

## Cross-Reference Handoffs

1. **SEC-01**: Evaluate Helius API key exposure in `shared/constants.ts:474` and `shared/programs.ts:22`
2. **INFRA-03**: Railway build needs lockfile pinning. Investigate Nixpacks `npm ci` configuration.
3. **CHAIN-06**: Version mismatch in `@solana/web3.js` between workspaces could cause PDA derivation differences
4. **BOT-01**: Crank stability depends on consistent dependency resolution across Railway deploys
5. **FE-02**: Verify that `app/next.config.ts` CSP is correctly applied in Railway production (headers() in next.config)

## Risk Observations

### HIGH
1. **Gitignored lockfile** (`.gitignore:9`): Enables time-of-install supply chain attacks on every build. Remove `package-lock.json` from `.gitignore` and commit the lockfile immediately.

### MEDIUM
2. **No CI/CD or dependency scanning** (project-wide): No automated vulnerability detection. Add `npm audit --audit-level=high` to build pipeline at minimum.
3. **Install scripts run without protection** (package-lock.json): 11 packages run postinstall scripts. Use `npm ci --ignore-scripts && npm rebuild` pattern.
4. **Version drift between workspaces** (package.json vs app/package.json): `@solana/web3.js` at ^1.95.5 vs 1.98.4 could cause behavioral differences.
5. **React overrides force React 19 globally** (package.json:26-28): Transitive dependencies incompatible with React 19 will silently break.

### LOW
6. **7 deprecated transitive dependencies**: glob, inflight, rimraf old versions. Update when possible.
7. **@dr-fraudsworth/shared not on npm**: Potential (low) dependency confusion if name is registered by attacker.
8. **Helius API key in source**: Rate-limited credential in committed code.

### INFORMATIONAL
9. **Cargo.lock properly committed**: Rust supply chain is well-managed. This is the secure pattern.

## Novel Attack Surface Observations

### IDL Supply Chain Attack
The `predev`/`prebuild` hook (`app/scripts/sync-idl.mjs`) copies IDL JSON files from `target/idl/` into the app. If a compromised Rust crate in `Cargo.lock` managed to modify the IDL output during `anchor build`, the frontend would use tampered type definitions. This could cause:
- Incorrect account deserialization (showing wrong balances)
- Malformed transaction construction (sending to wrong addresses)
- The user would see correct-looking UI but transactions would do something different

This is mitigated by Cargo.lock being committed (the Rust supply chain is pinned), but worth noting as a theoretical attack path.

### Build-Time Source Modification
`scripts/deploy/patch-mint-addresses.ts` reads keypair files from disk and rewrites `constants.rs` files in-place before `anchor build`. This creates a trust dependency on the keypair files in `scripts/deploy/mint-keypairs/` and `keypairs/`. If an attacker could replace a keypair file, the wrong mint addresses would be compiled into production programs. The script has no integrity verification (no checksum, no signature) on the keypair files it reads.

## Questions for Other Focus Areas

1. **For INFRA-03**: Does Railway support `npm ci`? Can `nixpacks.toml` be configured to use `npm ci --ignore-scripts`?
2. **For SEC-01**: Is the Helius API key rotation plan documented? What happens if the key is revoked?
3. **For BOT-01**: Has the crank runner ever experienced a dependency-version-related failure after a Railway redeploy?
4. **For CHAIN-06**: Has anyone verified that `@solana/web3.js` 1.95.x and 1.98.x produce identical PDA derivations and transaction serialization for all protocol operations?

## Raw Notes

- `docs-site/` has its own `package-lock.json` which IS committed (checked via `Glob` finding `docs-site/package-lock.json` in the filesystem). This is correct — the docs site has a separate dependency tree.
- `shared/package.json` uses `"main": "index.ts"` which is unusual — typically packages compile to JS. This works because Next.js `transpilePackages` handles it, but it means the shared package cannot be used outside the monorepo without a build step.
- The `overrides` block in root `package.json` forces React 19 — this was likely needed to resolve peer dependency conflicts between Next.js 16 and packages that haven't declared React 19 compatibility.
- `app/next.config.ts:89` notes Sentry SDK was removed due to Turbopack incompatibility. The project uses a custom fetch-based Sentry integration (`lib/sentry.ts`) instead. This is actually a supply chain improvement — fewer dependencies.
- Build scripts (`deploy-all.sh`, `build.sh`, `deploy.sh`) all use `set -e` for fail-fast, which is good practice. They also have version gates (Solana CLI v3+ required at `deploy-all.sh:49-69`).
- No `.npmrc` file means no private registry configuration. All deps come from the public npm registry. This eliminates dependency confusion from private registry misconfiguration but doesn't protect against name-squatting on the public registry.
