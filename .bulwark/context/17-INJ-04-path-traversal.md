---
task_id: db-phase1-INJ-04
provides: [INJ-04-findings, INJ-04-invariants]
focus_area: INJ-04
files_analyzed:
  - scripts/deploy/lib/connection.ts
  - scripts/deploy/upload-metadata.ts
  - scripts/deploy/update-metadata-uri.ts
  - scripts/deploy/generate-constants.ts
  - scripts/deploy/verify-authority.ts
  - scripts/deploy/transfer-authority.ts
  - scripts/deploy/fix-carnage-wsol.ts
  - scripts/deploy/test-upgrade.ts
  - scripts/deploy/sync-program-ids.ts
  - scripts/deploy/initialize.ts
  - scripts/deploy/lib/logger.ts
  - scripts/deploy/lib/pda-manifest.ts
  - scripts/deploy/generate-deployment-json.ts
  - scripts/deploy/setup-squads.ts
  - scripts/crank/crank-provider.ts
  - scripts/graduation/graduate.ts
  - scripts/e2e/lib/e2e-logger.ts
  - scripts/e2e/stress-test.ts
  - scripts/e2e/devnet-e2e-validation.ts
  - scripts/e2e/overnight-runner.ts
  - scripts/e2e/carnage-hunter.ts
  - scripts/e2e/lib/alt-helper.ts
  - scripts/e2e/lib/load-deployment.ts
  - scripts/vrf/lib/reporter.ts
  - scripts/vrf/devnet-vrf-validation.ts
  - app/next.config.ts
  - app/db/migrate.ts
  - app/scripts/sync-idl.mjs
  - app/scripts/https-proxy.mjs
  - app/app/api/health/route.ts
  - app/app/api/rpc/route.ts
  - app/app/api/webhooks/helius/route.ts
finding_count: 5
severity_breakdown: {critical: 0, high: 0, medium: 2, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# INJ-04: Path Traversal & File Access — Condensed Summary

## Key Findings (Top 5)

1. **WALLET env var flows to fs.readFileSync without traversal guard**: The WALLET environment variable is used as a file path in `scripts/deploy/lib/connection.ts:69-84` and `scripts/crank/crank-provider.ts:60-73`. While path.resolve normalizes the path, there is no check that the resolved path stays within an expected directory. An attacker controlling the env var could read arbitrary JSON files on the filesystem. Mitigated by: only operators set env vars, not end users.

2. **WALLET env var flows to execSync shell command**: In `scripts/deploy/verify-authority.ts:390-395`, the `walletPath` (derived from WALLET env var) is interpolated into an `execSync()` command string with only quote wrapping (`--keypair "${walletPath}"`). A WALLET value containing `"; rm -rf /; echo "` could escape the quotes and inject arbitrary shell commands. Mitigated by: only operators set env vars.

3. **CLI --cluster parameter constructs file paths with limited validation**: Scripts like `upload-metadata.ts:203`, `generate-constants.ts:38`, `transfer-authority.ts:62` use `${cluster}.json` to build file paths. The cluster value is validated against `["devnet", "mainnet"]` allowlist (e.g., `upload-metadata.ts:78`), which prevents traversal. This is the correct pattern.

4. **CLI --keypair parameter reads arbitrary files**: Scripts like `upload-metadata.ts:91-98` and `update-metadata-uri.ts:87-94` accept `--keypair` as a CLI argument, resolve it with `path.resolve`, and read the file at that path. No directory-restriction check (e.g., `startsWith`) is applied. An operator could point to any readable file. Mitigated by: CLI tools are operator-only, not user-facing.

5. **Deploy logger accepts logFilePath parameter without validation**: `scripts/deploy/lib/logger.ts:64-79` accepts an optional `logFilePath` parameter, creates its parent directory with `mkdirSync({recursive: true})`, and writes to it. No bounds checking on where the log file is created. Mitigated by: parameter is never user-supplied (only called internally).

## Critical Mechanisms

- **Env-var-to-file-path pipeline**: `loadProvider()` in `scripts/deploy/lib/connection.ts:64-101` reads WALLET env var -> `path.resolve()` -> `fs.readFileSync()`. No `startsWith()` guard. Used by all deploy scripts. — `scripts/deploy/lib/connection.ts:69-84`
- **Env-var-to-shell-command pipeline**: `verify-authority.ts` passes WALLET-derived `walletPath` directly into `execSync()` string interpolation via `--keypair "${walletPath}"`. — `scripts/deploy/verify-authority.ts:390-395`
- **Cluster-gated file path construction**: All `deployments/${cluster}.json` paths validate cluster against `["devnet", "mainnet"]` allowlist before path construction. This correctly prevents traversal. — `scripts/deploy/upload-metadata.ts:78`, `generate-constants.ts:27`
- **Crank WALLET_KEYPAIR vs WALLET dual-path**: `crank-provider.ts:39-80` prioritizes inline JSON (WALLET_KEYPAIR env var) over file path (WALLET env var). Railway production uses the inline JSON path, avoiding file access entirely. — `scripts/crank/crank-provider.ts:39-80`
- **File permission setting on sensitive writes**: `initialize.ts:169` and `fix-carnage-wsol.ts:102-105` set `{ mode: 0o600 }` on keypair writes. This limits readability to the owner. — `scripts/deploy/initialize.ts:169`

## Invariants & Assumptions

- INVARIANT: All `--cluster` CLI parameters are validated against `["devnet", "mainnet"]` before being used in file path construction — enforced at `scripts/deploy/upload-metadata.ts:78`, `generate-constants.ts:27`, `update-metadata-uri.ts:75`
- INVARIANT: Production crank runner uses WALLET_KEYPAIR env var (inline JSON), never file-path-based WALLET — enforced at `scripts/crank/crank-provider.ts:44-57`
- INVARIANT: Keypair files are written with mode 0o600 — enforced at `scripts/deploy/initialize.ts:169`, `fix-carnage-wsol.ts:102-105`
- ASSUMPTION: Environment variables (WALLET, CLUSTER_URL) are set only by trusted operators, never by end users — UNVALIDATED (architectural assumption)
- ASSUMPTION: Deploy/admin scripts are never exposed as web endpoints or API routes — validated by architecture (scripts/ directory is not served by Next.js)
- ASSUMPTION: The app/ production code (Next.js) performs zero filesystem operations with user-controlled paths — validated by grep (app/ has no fs operations on user input)

## Risk Observations (Prioritized)

1. **WALLET env var to execSync shell injection**: `scripts/deploy/verify-authority.ts:390-395` — WALLET value with shell metacharacters could inject commands. Impact: arbitrary code execution in operator context. Likelihood: very low (only operators control env vars, and the env var is typically a well-known file path).
2. **WALLET env var to arbitrary file read**: `scripts/deploy/lib/connection.ts:69-84` — No directory restriction on resolved path. Impact: read any JSON-parseable file. Likelihood: very low (same operator-only constraint).
3. **Deploy logger mkdir/write to arbitrary path**: `scripts/deploy/lib/logger.ts:64-79` — `logFilePath` parameter creates directories and writes files. Impact: file write to arbitrary location. Likelihood: negligible (parameter is never user-supplied).
4. **Symlink creation in home directory**: `scripts/deploy/test-upgrade.ts:93-103` — Creates symlink at `$HOME/.dr-fraudsworth-link` pointing to project root. Impact: symlink hijack if attacker pre-creates symlink. Likelihood: negligible (requires local access to admin machine).
5. **HTTPS proxy passes client URL to upstream**: `app/scripts/https-proxy.mjs:17-23` — `clientReq.url` is forwarded to localhost:3000 without filtering. Impact: SSRF to localhost (limited since target is hardcoded to localhost:3000). Likelihood: negligible (dev-only tool).

## Novel Attack Surface

- **No novel path traversal attack surface**: This codebase has zero web-facing file access endpoints. The Next.js app never reads/writes files based on user input. All filesystem operations are in operator-only scripts. The primary attack surface for INJ-04 in this codebase is therefore the env-var-to-file-path pipeline in deploy scripts, which requires operator-level access to exploit.

## Cross-Focus Handoffs

- → **SEC-02 (Secret Credential)**: The WALLET env var and WALLET_KEYPAIR env var carry private key material. Verify they are not logged, leaked in error messages, or exposed via /api/health. `scripts/crank/crank-provider.ts:50-51` logs the first 12 chars of the public key (safe), but `scripts/deploy/lib/connection.ts` could leak the full file path in error messages.
- → **INJ-02 (Command Injection)**: The `execSync()` call in `scripts/deploy/verify-authority.ts:390` interpolates `walletPath` and `clusterUrl` into a shell string. This is a command injection vector if env vars are attacker-controlled. Cross-reference with INJ-02 analysis.
- → **DATA-04 (Logging Disclosure)**: Several scripts log file paths that reveal system directory structure (`scripts/deploy/lib/connection.ts:78-79`, `scripts/deploy/upload-metadata.ts:330`). Verify these logs don't reach production logging systems.

## Trust Boundaries

The filesystem trust model in this codebase is clear-cut: the Next.js production app (app/) performs zero filesystem operations with user-controlled inputs. All file I/O is confined to operator scripts (scripts/) that read keypairs, deployment configs, IDLs, and write logs/reports. The trust boundary is the operator's environment — if an attacker gains control of environment variables or CLI arguments on the operator's machine, they can influence file paths. However, this is equivalent to having shell access, which is already catastrophic regardless of path traversal protections. The production runtime (Railway) uses inline env vars for secrets (WALLET_KEYPAIR) rather than file paths, eliminating the file-based attack surface entirely in production.
<!-- CONDENSED_SUMMARY_END -->

---

# INJ-04: Path Traversal & File Access — Full Analysis

## Executive Summary

The Dr. Fraudsworth codebase has a clean separation between its production web application (app/) and its operator tooling (scripts/). The production app performs **zero filesystem operations with user-controlled input**. All file I/O occurs in deployment scripts, testing utilities, and the crank runner — all of which are operator-only tools run from a developer's local machine or Railway CI/CD.

The path traversal attack surface is therefore **minimal and operator-scoped**. I identified 5 observations, none critical. The most notable are: (1) the WALLET env var flowing to `fs.readFileSync` without directory bounds checking, and (2) the WALLET-derived path being interpolated into an `execSync()` shell command string. Both require attacker control of the operator's environment variables, which implies pre-existing system compromise.

## Scope

**Analyzed**: All off-chain TypeScript/JavaScript files (245 files) through the path traversal lens.

**Key search patterns used**:
- `fs.readFile`, `fs.writeFile`, `fs.readFileSync`, `fs.writeFileSync`, `fs.createReadStream`, `fs.mkdir`, `fs.copyFile`, `fs.stat`, `fs.unlink`, `fs.symlink`
- `path.join`, `path.resolve`, `path.normalize`, `path.relative`
- `require("fs")`, `import * as fs`, `from "fs"`
- `process.env.*` flowing to file operations
- `req.params`, `req.query`, `req.body` flowing to file paths
- `multer`, `formidable`, `upload`, `multipart`, `sendFile`, `serveStatic`
- `exec(`, `execSync(`, `spawn(`, `child_process`
- `symlink`, `lstat`, `realpath`
- `startsWith` checks on paths (traversal guards)

## Key Mechanisms

### 1. Env-Var-to-File-Path Pipeline (Deploy Scripts)

The most common file access pattern in this codebase is:

```
process.env.WALLET → path.resolve() → fs.readFileSync()
```

This pattern appears in:
- `scripts/deploy/lib/connection.ts:69-84` (loadProvider)
- `scripts/crank/crank-provider.ts:60-73` (loadCrankProvider)
- `scripts/deploy/verify-authority.ts:103-105` (main)
- `scripts/deploy/transfer-authority.ts:161-163` (main)
- `scripts/deploy/test-upgrade.ts:511` (main)
- `scripts/deploy/generate-deployment-json.ts:152` (main)
- `scripts/deploy/setup-squads.ts:112-117` (main)

**How it works**: Each script reads the WALLET env var (defaulting to `keypairs/devnet-wallet.json`), resolves it relative to `process.cwd()`, checks existence with `fs.existsSync()`, and reads it with `fs.readFileSync()`. The content is parsed as JSON and treated as a Solana keypair byte array.

**What's missing**: No `startsWith()` check to ensure the resolved path stays within the project directory or a designated keypairs directory. `path.resolve()` normalizes `../` sequences but does not restrict them.

**Why it matters minimally**: The WALLET env var is set by the operator, not by end users. An attacker who can set this env var already has shell access. The JSON parsing step (`JSON.parse()`) would fail on non-JSON files, limiting the blast radius to information leakage about file existence and parse errors.

### 2. CLI-Argument-to-File-Path Pipeline (Deploy Scripts)

Several scripts accept `--keypair` as a CLI argument:
- `scripts/deploy/upload-metadata.ts:91-98`
- `scripts/deploy/update-metadata-uri.ts:87-94`

**How it works**: The argument is resolved with `path.isAbsolute()` / `path.resolve()`, existence is checked, and the file is read. No directory bounds check.

**Why it matters minimally**: CLI arguments are controlled by the operator running the script.

### 3. Cluster-Gated File Path Construction

Paths like `deployments/${cluster}.json` and `.env.${cluster}` appear in many deploy scripts. The cluster value is used to construct file paths.

**Validation pattern**: Every script that uses cluster validates it against `["devnet", "mainnet"]`:
- `upload-metadata.ts:78`: `if (!cluster || !["devnet", "mainnet"].includes(cluster))`
- `generate-constants.ts:27`: `if (!cluster || !["devnet", "mainnet"].includes(cluster))`
- `update-metadata-uri.ts:75`: `if (!cluster || !["devnet", "mainnet"].includes(cluster))`
- `generate-deployment-json.ts:23`: Same pattern

**Assessment**: This is the correct defense — allowlist validation before path construction. No traversal is possible because the only accepted values are "devnet" and "mainnet".

### 4. Hardcoded Path Patterns

Many scripts use paths derived from `__dirname` or `path.resolve(__dirname, ...)`:
- `scripts/deploy/lib/connection.ts:121`: `path.resolve(__dirname, "../../../target/idl")`
- `scripts/crank/crank-provider.ts:111`: `path.resolve(__dirname, "../../app/idl")`
- `scripts/graduation/graduate.ts:163`: `path.resolve(__dirname, "graduation-state.json")`
- `scripts/graduation/graduate.ts:226`: `path.resolve(__dirname, "../deploy/mint-keypairs/${name}-mint.json")`

**Assessment**: These paths are fully static (relative to the script's location). The `name` parameter in `loadMintKeypair()` comes from hardcoded arrays (`["crime", "fraud", "profit"]`), not user input.

### 5. Production App File Access

The Next.js app (`app/`) has the following file-related code:
- `app/next.config.ts:68`: `path.join(__dirname, "..")` — build-time config, no user input
- `app/db/migrate.ts:46`: `path.resolve(__dirname, "migrations")` — hardcoded migration folder
- `app/scripts/sync-idl.mjs`: Copies files from hardcoded paths only
- `app/scripts/https-proxy.mjs:13-14`: Reads certificate files from hardcoded paths

**Critical finding: The production app has ZERO file operations with user-controlled input.** All API routes (`/api/health`, `/api/rpc`, `/api/webhooks/helius`, `/api/candles`, `/api/sse/*`, `/api/sol-price`) operate exclusively on HTTP requests, database queries, and RPC calls. None of them read or write files.

## Trust Model

```
┌─────────────────────────────────────────────────────────┐
│ PRODUCTION (Railway/Next.js)                            │
│                                                         │
│  app/app/api/* → HTTP only, zero filesystem access      │
│  app/hooks/*   → Browser-side, no fs module             │
│  app/lib/*     → Server libs, no fs with user input     │
│                                                         │
│  Trust: User input NEVER touches filesystem             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ OPERATOR TOOLING (Local machine / CI)                   │
│                                                         │
│  scripts/deploy/*  → Reads env vars, CLI args, keypairs │
│  scripts/crank/*   → Reads env vars (WALLET, IDLs)      │
│  scripts/e2e/*     → Reads/writes test logs, reports    │
│  scripts/vrf/*     → Reads manifests, writes reports    │
│                                                         │
│  Trust: Operator controls all inputs (env vars, CLI)    │
│  Threat: Compromised operator machine = all bets off    │
└─────────────────────────────────────────────────────────┘
```

## State Analysis

### File System State
- **Keypair files**: `keypairs/*.json` — Solana keypair byte arrays. Written with `mode: 0o600`. Read by deploy scripts.
- **Deployment configs**: `deployments/{cluster}.json` — Program IDs, mint addresses, PDAs, metadata URIs. Written by initialize.ts, read by many scripts.
- **Graduation state**: `scripts/graduation/graduation-state.json` — Checkpoint/resume state for graduation flow.
- **ALT cache**: `scripts/deploy/alt-address.json` — Address Lookup Table address.
- **PDA manifest**: `scripts/deploy/pda-manifest.json` — All derived PDAs.
- **Log files**: Various `*.jsonl` and `*.txt` files in scripts/ directories.
- **Env files**: `.env.{cluster}` — Environment variable files written by upload-metadata.ts.

### In-Memory State
No in-memory file path state is relevant to this analysis. All paths are resolved per-invocation.

## Dependencies

- **Node.js `fs` module**: Used throughout scripts/ for file I/O. Standard library, no vulnerabilities.
- **Node.js `path` module**: Used for path resolution. `path.join()` and `path.resolve()` normalize `../` sequences but do not block them.
- **Node.js `child_process`**: Used in `verify-authority.ts`, `test-upgrade.ts`, `transfer-authority.ts` for Solana CLI invocations.
- **Drizzle ORM**: Used in `app/db/migrate.ts` for database migrations. Path to migrations folder is hardcoded.
- **Irys SDK**: Used in `upload-metadata.ts` for Arweave uploads. File paths come from hardcoded constants, not user input.

## Focus-Specific Analysis

### Pattern: `path.join(baseDir, userInput)` Without startsWith Guard (AIP-031)

The AI pitfalls document (AIP-031) warns about `path.join(baseDir, userInput)` being assumed safe. In this codebase:

- **`scripts/deploy/lib/connection.ts:72-74`**: Uses `path.isAbsolute()` check, then `path.resolve(process.cwd(), keyPath)`. No `startsWith()` guard. However, `keyPath` comes from env var, not HTTP request.
- **`scripts/crank/crank-provider.ts:62-64`**: Same pattern.
- **`scripts/deploy/upload-metadata.ts:91-93`**: Same pattern for `--keypair` CLI arg.

**Verdict**: This pattern is technically present but not exploitable because the input source is operator-controlled (env vars and CLI args), not user-controlled (HTTP requests). Adding a `startsWith()` guard would be defense-in-depth but is not necessary for the current threat model.

### Pattern: User-Supplied Filenames (AIP-033)

The AI pitfalls document (AIP-033) warns about using original upload filenames. This codebase has **no file upload functionality** — no multer, no formidable, no multipart form handling. The only "uploads" are to Arweave via the Irys SDK, where the file paths come from hardcoded constants (`TOKENS[key].imagePath`).

### Pattern: File Writes to User-Influenced Paths

- **`scripts/deploy/lib/logger.ts:64-79`**: `createLogger(logFilePath?)` accepts an optional path parameter. It calls `fs.mkdirSync(path.dirname(logPath), { recursive: true })` and `fs.writeFileSync(logPath, ...)`. This could create directories and write files anywhere. However, the parameter is never user-supplied — it's called without arguments (using the default timestamped path) in all callers.

- **`scripts/deploy/upload-metadata.ts:226,253`**: Writes to `.env.${cluster}` where cluster is allowlist-validated to "devnet" or "mainnet". Safe.

- **`scripts/deploy/fix-carnage-wsol.ts:96,102`**: Writes to `keypairs/carnage-wsol.json.bak` and `keypairs/carnage-wsol.json`. Paths are hardcoded relative to `__dirname`. Safe.

### Pattern: execSync with Env-Var-Derived Paths

**`scripts/deploy/verify-authority.ts:390-395`**:
```typescript
execSync(
  `"${solanaCli}" program set-upgrade-authority ${cvProgramId} ` +
    `--new-upgrade-authority ${deployer.publicKey.toBase58()} ` +
    `--keypair "${walletPath}" ` +
    `-u ${cluster === "devnet" ? "devnet" : clusterUrl}`,
  { encoding: "utf8", stdio: "pipe", timeout: 30000 }
);
```

The `walletPath` variable originates from `process.env.WALLET`. It is quoted with double quotes in the shell command, but shell double quotes do not prevent all injection (e.g., backticks, `$()`, etc.). A WALLET value like `keypairs/wallet.json"; curl evil.com #` could inject commands.

**Severity assessment**: LOW. The WALLET env var is set by the operator. If an attacker can set env vars, they already have code execution. The `clusterUrl` is also env-var-derived but is ternary-gated (`cluster === "devnet" ? "devnet" : clusterUrl`), which limits injection in the devnet case.

**`scripts/deploy/test-upgrade.ts:113-132`**: The `run()` function wraps `execSync()` but its `cmd` parameter comes from hardcoded strings in the test-upgrade script (Solana CLI commands built from known-safe program IDs and file paths). No user input flows in.

### Pattern: Symlink Creation

**`scripts/deploy/test-upgrade.ts:93-103`**:
```typescript
const SYMLINK_DIR = path.join(process.env.HOME || "/tmp", ".dr-fraudsworth-link");
fs.symlinkSync(ROOT, SYMLINK_DIR);
```

Creates a symlink at `$HOME/.dr-fraudsworth-link` → project root. This is a workaround for Solana CLI v3's inability to handle spaces in paths. A symlink-following attack is theoretically possible if an attacker pre-creates this symlink pointing elsewhere, but this requires local access to the operator's machine.

### Pattern: HTTPS Proxy URL Forwarding

**`app/scripts/https-proxy.mjs:17-23`**:
```javascript
const opts = {
  hostname: 'localhost',
  port: 3000,
  path: clientReq.url,
  method: clientReq.method,
  headers: clientReq.headers,
};
```

The `clientReq.url` is forwarded to `localhost:3000` without sanitization. This is a dev-only tool (not deployed to production) that listens on `0.0.0.0:3443`. In a local network, an attacker on the same network could send crafted URLs. However, since the target is hardcoded to localhost:3000 (the dev server), the attack surface is limited to sending arbitrary paths to the local Next.js dev server.

## Cross-Focus Intersections

### → SEC-02 (Secret Credential)
The WALLET env var and file paths carry private key material. Error messages in `scripts/deploy/lib/connection.ts:78-79` include the full resolved file path, which could reveal directory structure. The `scripts/crank/crank-provider.ts:50-51` correctly redacts the public key to 12 chars. However, the full wallet path is logged at `crank-provider.ts:78`.

### → INJ-02 (Command Injection)
The `execSync()` usage in `verify-authority.ts:390` is primarily a command injection concern. The shell string interpolation of `walletPath` and `clusterUrl` should be analyzed by the INJ-02 auditor for command injection, not just path traversal.

### → DATA-04 (Logging Disclosure)
File paths logged in error messages and info output could reveal directory structure:
- `scripts/deploy/lib/connection.ts:78`: `Wallet keypair not found at: ${resolvedKeyPath}`
- `scripts/deploy/upload-metadata.ts:330`: `Keypair: ${args.keypair}`
- `scripts/deploy/verify-authority.ts:107`: `Deployer: ${deployer.publicKey.toBase58()}`

### → INFRA-03 (Cloud/Env Config)
The Railway production environment uses WALLET_KEYPAIR (inline JSON) instead of WALLET (file path), which eliminates the file-based attack surface in production. This is the correct pattern for cloud deployments where the filesystem is ephemeral.

## Cross-Reference Handoffs

| Target Agent | Item | Why |
|---|---|---|
| INJ-02 (Command Injection) | `verify-authority.ts:390` execSync with env-var-derived walletPath | Shell metachar injection via WALLET env var |
| SEC-02 (Secret Credential) | File path logging in deploy scripts | Wallet paths revealed in console output |
| DATA-04 (Logging Disclosure) | Full file paths in error messages | Directory structure leakage |
| INFRA-03 (Cloud Config) | WALLET vs WALLET_KEYPAIR Railway config | Verify production uses inline JSON, not file paths |

## Risk Observations

### Observation 1: WALLET Env Var to execSync (MEDIUM)
**File**: `scripts/deploy/verify-authority.ts:390-395`
**Description**: The WALLET-derived `walletPath` is interpolated into an `execSync()` shell command string. Shell double quotes do not prevent all forms of injection (backticks, `$()` subshells).
**Impact**: Arbitrary command execution if WALLET contains shell metacharacters.
**Likelihood**: Very low — requires attacker to control operator's environment variables.
**Mitigation**: Use `execFileSync` with argument array instead of `execSync` with string interpolation.

### Observation 2: WALLET Env Var to Arbitrary File Read (MEDIUM)
**File**: `scripts/deploy/lib/connection.ts:69-84`
**Description**: WALLET env var → `path.resolve()` → `fs.readFileSync()` without directory bounds check.
**Impact**: Read any JSON-parseable file on the filesystem.
**Likelihood**: Very low — requires attacker to control operator's environment variables.
**Mitigation**: Add `startsWith(EXPECTED_DIR)` check after `path.resolve()`.

### Observation 3: Deploy Logger Arbitrary Path Write (LOW)
**File**: `scripts/deploy/lib/logger.ts:64-79`
**Description**: `createLogger(logFilePath?)` creates directories and writes to the specified path without validation.
**Impact**: File write to arbitrary location.
**Likelihood**: Negligible — parameter is never user-supplied.
**Mitigation**: None needed (internal-only parameter).

### Observation 4: Symlink Race in test-upgrade.ts (LOW)
**File**: `scripts/deploy/test-upgrade.ts:93-103`
**Description**: Creates predictable symlink at `$HOME/.dr-fraudsworth-link`. TOCTOU race between `readlinkSync` and `symlinkSync`.
**Impact**: Symlink hijack could redirect Solana CLI operations.
**Likelihood**: Negligible — requires local access to admin machine.
**Mitigation**: Use `os.tmpdir()` with random suffix instead of predictable path.

### Observation 5: HTTPS Proxy URL Pass-Through (LOW)
**File**: `app/scripts/https-proxy.mjs:17-23`
**Description**: Dev-only HTTPS proxy forwards raw client URL to localhost:3000.
**Impact**: Limited SSRF to local dev server.
**Likelihood**: Negligible — dev-only tool, not deployed.
**Mitigation**: None needed for dev tool. Ensure it's never deployed.

## Novel Attack Surface Observations

This codebase's path traversal attack surface is unusual in that it has **zero web-facing file access**. The typical web application INJ-04 vectors (file upload, file download, static file serving with user-controlled paths) are completely absent. The Next.js framework handles all static asset serving through its built-in optimized image pipeline and public directory serving, which are not user-path-configurable.

The only potential attack vector is through the operator tooling's env-var-to-file-path pipeline. This requires a fundamentally different threat model than typical path traversal: instead of an external attacker sending `../../etc/passwd` through an HTTP request, the attacker would need to compromise the operator's environment (shell, CI/CD pipeline, or Railway dashboard). At that point, the attacker likely has more direct avenues of exploitation than path traversal.

The **WALLET_KEYPAIR (inline JSON) vs WALLET (file path)** dual-mode in `crank-provider.ts` is a notable positive security pattern. By using inline JSON in production, the codebase eliminates the file-based attack surface entirely for the production crank runner.

## Questions for Other Focus Areas

1. **SEC-02**: Does the crank runner's console output (which includes wallet file paths) get captured by Railway's logging system? If so, directory structure is exposed in production logs.
2. **INJ-02**: Should the `execSync` calls in `verify-authority.ts` and `test-upgrade.ts` be refactored to `execFileSync` with argument arrays to eliminate shell injection?
3. **INFRA-03**: Is `app/scripts/https-proxy.mjs` included in production Docker images? If so, it should be excluded.
4. **DATA-04**: Are the E2E test log files (`*.jsonl`) cleaned up after test runs, or could they accumulate sensitive data?

## Raw Notes

### File Access Distribution

| Location | fs Operations | User Input? | Risk |
|---|---|---|---|
| `scripts/deploy/*` | ~80 calls | Env vars, CLI args (operator) | Low |
| `scripts/crank/*` | ~5 calls | Env vars (operator/Railway) | Low |
| `scripts/e2e/*` | ~20 calls | None (hardcoded paths) | None |
| `scripts/graduation/*` | ~5 calls | None (hardcoded paths) | None |
| `scripts/vrf/*` | ~3 calls | None (hardcoded paths) | None |
| `scripts/test/*` | ~8 calls | None (hardcoded paths) | None |
| `app/` (production) | 3 calls | None (hardcoded paths, build-time) | None |
| `app/app/api/*` | 0 calls | N/A | None |

### Grep Results Summary

- **0** instances of `req.params`, `req.query`, or `req.body` flowing to file paths
- **0** instances of multer, formidable, or any file upload middleware
- **0** instances of `sendFile` or `serveStatic` in app code
- **0** instances of `startsWith` path guards (not needed because no user-controlled paths reach fs operations)
- **5** instances of env vars flowing to `fs.readFileSync` via `path.resolve`
- **1** instance of env-var-derived path flowing to `execSync`
- **1** instance of `fs.symlinkSync` with semi-predictable path
- **3** instances of properly-validated `cluster` parameter in path construction
