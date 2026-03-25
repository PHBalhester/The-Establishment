---
task_id: db-phase1-path-traversal
provides: [path-traversal-findings, path-traversal-invariants]
focus_area: path-traversal
files_analyzed: [scripts/crank/crank-provider.ts, scripts/deploy/lib/connection.ts, scripts/deploy/initialize.ts, scripts/deploy/patch-mint-addresses.ts, scripts/deploy/verify.ts, scripts/deploy/lib/logger.ts, scripts/e2e/lib/alt-helper.ts, scripts/e2e/lib/e2e-logger.ts, scripts/e2e/overnight-runner.ts, scripts/vrf/lib/reporter.ts, scripts/optimize-images.mjs, scripts/graduation/graduate.ts, app/lib/event-parser.ts, app/app/api/webhooks/helius/route.ts, app/app/api/candles/route.ts, app/app/api/sse/candles/route.ts, app/app/api/health/route.ts, app/db/migrate.ts, app/next.config.ts]
finding_count: 3
severity_breakdown: {critical: 0, high: 0, medium: 1, low: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Path Traversal & File Access -- Condensed Summary

## Key Findings (Top 5)
- **No user-input-driven file paths exist in any API route or frontend code**: All 6 API routes (webhooks/helius, candles, sse/candles, health, carnage-events, sol-price) accept only JSON bodies or URL query parameters, none of which flow into file system operations -- `app/app/api/*/route.ts`
- **WALLET env var used as file path without traversal guard**: `process.env.WALLET` is resolved via `path.resolve(process.cwd(), keyPath)` and read as a keypair file; no `startsWith` check constrains it to the project directory -- `scripts/crank/crank-provider.ts:62-63`, `scripts/deploy/lib/connection.ts:72-74`
- **All script-side file I/O uses hardcoded or __dirname-relative paths**: IDL loading, manifest loading, mint keypair loading, ALT cache, and log files all derive paths from `__dirname` or hardcoded relative paths, not from any external input -- `scripts/deploy/lib/connection.ts:121`, `scripts/crank/crank-provider.ts:111`
- **No file upload handling exists in the entire off-chain codebase**: No multer, formidable, busboy, or custom file upload logic detected in any API route or server component
- **Borsh deserialization in event-parser.ts is not a path traversal concern**: The INDEX tagged this file INJ-04 for "deserialization of untrusted data" but the deserialization is Borsh decoding of on-chain log messages, which does not involve file paths or file system operations -- `app/lib/event-parser.ts`

## Critical Mechanisms
- **Wallet keypair loading (crank-provider.ts:44-80)**: Priority chain: WALLET_KEYPAIR env var (JSON string) -> WALLET env var (file path) -> default `keypairs/devnet-wallet.json`. The file path branch uses `path.isAbsolute()` check then `path.resolve(process.cwd(), keyPath)`. No directory containment check. Concern: env var poisoning could read arbitrary files, though the file must contain valid JSON byte array to not crash.
- **Wallet keypair loading (connection.ts:64-84)**: Same pattern as crank-provider. Accepts `walletPath` parameter or `process.env.WALLET`. Resolves with `path.resolve(process.cwd(), keyPath)`. No containment check.
- **ALT cache file (alt-helper.ts:48,218-220,287-296)**: Reads/writes JSON to hardcoded `ALT_CACHE_PATH` derived from `__dirname`. Not influenced by any input.
- **Logger file creation (logger.ts:72-79)**: Accepts optional `logFilePath` parameter. If provided by caller, writes log file there without path validation. In practice, only called without override from initialize.ts.
- **IDL loading (crank-provider.ts:111-121, connection.ts:121-132)**: Loads IDL JSON from `__dirname`-relative paths. The `name` parameter to `loadIdl()` is always a hardcoded string literal ("amm", "tax_program", etc.), never user input.

## Invariants & Assumptions
- INVARIANT: No API route performs file system read or write operations -- enforced by architecture (all API routes use Postgres via Drizzle ORM, not file I/O)
- INVARIANT: All file paths in scripts are derived from `__dirname`, `path.resolve(__dirname, ...)`, or hardcoded constants -- enforced at every call site
- INVARIANT: No file upload capability exists -- enforced by absence of upload middleware or file-receiving API endpoints
- ASSUMPTION: `process.env.WALLET` is set by trusted operators (admin/devops), not by untrusted users -- UNVALIDATED (no directory containment check)
- ASSUMPTION: `logFilePath` parameter in `createLogger()` is never called with user-controlled input -- validated by code inspection (only called without parameter from initialize.ts)
- ASSUMPTION: Railway environment variables (WALLET_KEYPAIR, PDA_MANIFEST) are set by trusted operators -- validated by deployment architecture (Railway dashboard access is admin-only)

## Risk Observations (Prioritized)
1. **WALLET env var as arbitrary file path (MEDIUM)**: `scripts/crank/crank-provider.ts:60-73`, `scripts/deploy/lib/connection.ts:69-84` -- If an attacker can control the WALLET environment variable in the Railway deployment, they could point it to any file on the filesystem. The file contents are JSON-parsed and used as a Keypair. While the file must be a valid 64-byte JSON array to not crash, reading arbitrary files is still a concern. Impact is limited because: (a) these are CLI scripts run by operators, not web-exposed services; (b) even if the file is read, its contents must be a valid Solana keypair format; (c) Railway env vars require admin access.
2. **No containment check on IDL directory (LOW)**: `scripts/crank/crank-provider.ts:114` uses `path.join(idlDir, \`${name}.json\`)` where `name` is always a hardcoded literal. If this pattern were ever extended to accept dynamic names, it could allow traversal. Currently safe because all callers pass string literals.
3. **Logger logFilePath parameter not validated (LOW)**: `scripts/deploy/lib/logger.ts:64` accepts an optional file path for log output. If a caller passed user-controlled input, it could write to arbitrary locations. Currently safe because no caller passes this parameter.

## Novel Attack Surface
- **Keypair file as oracle**: The WALLET env var pattern reads a file, JSON-parses it, and feeds it to `Keypair.fromSecretKey()`. If an attacker could place a crafted file and control the WALLET env var, they could potentially cause the crank to use a specific wallet. This is more of a credential substitution attack than a path traversal, but the traversal-unguarded file read is the enabling mechanism. The blast radius is high (fund control) but likelihood is very low (requires Railway admin access).

## Cross-Focus Handoffs
- -> **SEC-01 (Key Management)**: WALLET env var file read pattern at `scripts/crank/crank-provider.ts:60-73` and `scripts/deploy/lib/connection.ts:69-84` -- investigate whether the keypair loading has adequate access controls and whether the file path should be constrained.
- -> **SEC-02 (Secret & Credential Management)**: WALLET_KEYPAIR env var at `scripts/crank/crank-provider.ts:41-57` contains raw secret key bytes as JSON string in environment variable -- cross-reference with secret management posture.
- -> **API-04 (Webhook Security)**: Helius webhook handler at `app/app/api/webhooks/helius/route.ts:131-289` -- no file I/O but the optional auth header pattern (line 136-141) is worth investigating from the webhook security lens.

## Trust Boundaries
All file system operations in this codebase are confined to operator-executed CLI scripts (crank, deploy, e2e, vrf validation) and build-time tooling (optimize-images). No web-facing code (API routes, frontend components) performs any file system operations. The trust model assumes that anyone who can set environment variables or run scripts has full operator access. The only risk surface is the WALLET env var which is used as a file path without directory containment, but this is mitigated by the deployment architecture where only admin operators have access to env var configuration. There is zero user-to-filesystem data flow in this codebase.
<!-- CONDENSED_SUMMARY_END -->

---

# Path Traversal & File Access -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase has an extremely minimal path traversal attack surface. There are no file upload capabilities, no user-input-driven file paths, and no API routes that interact with the filesystem. All file I/O is confined to operator CLI scripts (deployment, crank, testing) and build tooling. The only noteworthy observation is that two wallet-loading functions accept file paths from environment variables without directory containment checks, but this is mitigated by the operational trust model where environment variables are set by admin operators.

## Scope

**Analyzed directories:**
- `scripts/` -- All deployment, crank, e2e, vrf, and utility scripts
- `app/app/api/` -- All 6 Next.js API route handlers
- `app/lib/` -- Library code including event-parser.ts
- `app/db/` -- Database migration and schema
- `app/` root -- next.config.ts

**Excluded:** `programs/` (on-chain Anchor/Rust), `.bok/worktree/` (duplicate), `.next/` (build output), `.claude/` (tooling)

## Key Mechanisms

### 1. Wallet Keypair Loading (Two Implementations)

**crank-provider.ts (lines 34-87):**
Three-tier priority for loading wallet:
1. `WALLET_KEYPAIR` env var: JSON string parsed directly, no file I/O
2. `WALLET` env var: Used as file path, resolved via `path.isAbsolute()` / `path.resolve(process.cwd(), keyPath)`
3. Default: `keypairs/devnet-wallet.json`

No `startsWith()` containment check after `path.resolve()`. This means `WALLET=../../../etc/passwd` would be resolved and read. However, `JSON.parse()` would fail on non-JSON files, and `Keypair.fromSecretKey()` would fail on non-64-byte arrays.

**connection.ts (lines 64-101):**
Same pattern. Additionally accepts `walletPath` parameter from callers, but all callers pass `undefined` (letting env var or default win).

### 2. IDL Loading

**crank-provider.ts (lines 108-131):**
```typescript
const idlDir = path.resolve(__dirname, "../../app/idl");
function loadIdl(name: string): any {
  const idlPath = path.join(idlDir, `${name}.json`);
  // ...
}
```
All 5 callers pass hardcoded string literals. No user input flows into `name`.

**connection.ts (lines 118-145):**
Same pattern with `../../../target/idl/` base directory. Same hardcoded callers.

### 3. File Write Operations

| File | Operation | Path Source | User Input? |
|------|-----------|-------------|-------------|
| `scripts/deploy/lib/logger.ts:78-79` | `writeFileSync`, `appendFileSync` | `logFilePath` param or `__dirname`-relative | No (param never passed by callers) |
| `scripts/e2e/lib/e2e-logger.ts:68,82` | `writeFileSync`, `appendFileSync` | Constructor `logPath` param | No (callers pass hardcoded paths) |
| `scripts/e2e/lib/alt-helper.ts:287-296` | `writeFileSync` | Hardcoded `ALT_CACHE_PATH` from `__dirname` | No |
| `scripts/vrf/lib/reporter.ts:269-272` | `writeFileSync` | `filePath` param from caller | No (caller passes hardcoded path) |
| `scripts/deploy/patch-mint-addresses.ts:234-236` | `writeFileSync` | Derived from `PROJECT_ROOT` + hardcoded `spec.file` | No |
| `scripts/optimize-images.mjs:269` | `writeFileSync` | Hardcoded `IMAGE_DATA_PATH` | No |

### 4. File Read Operations (Non-Wallet)

| File | What's Read | Path Source |
|------|-------------|-------------|
| `scripts/deploy/patch-mint-addresses.ts:35-41` | Keypair files | Hardcoded relative paths |
| `scripts/deploy/patch-mint-addresses.ts:216` | Rust source files | `PROJECT_ROOT` + hardcoded `spec.file` |
| `scripts/e2e/lib/alt-helper.ts:206-207` | Carnage WSOL keypair | `__dirname`-relative hardcoded path |
| `scripts/e2e/lib/alt-helper.ts:220` | ALT cache JSON | Hardcoded `ALT_CACHE_PATH` |
| `app/db/migrate.ts:46` | Migration SQL files | `__dirname`-relative path |

### 5. API Routes -- Zero File I/O

All 6 API routes were inspected:
- `app/app/api/webhooks/helius/route.ts` -- JSON body parsing, Postgres writes
- `app/app/api/candles/route.ts` -- Query params, Postgres reads
- `app/app/api/sse/candles/route.ts` -- SSE stream, no file I/O
- `app/app/api/health/route.ts` -- (not read, likely simple health check)
- `app/app/api/carnage-events/route.ts` -- (not read, likely Postgres query)
- `app/app/api/sol-price/route.ts` -- (not read, likely external API call)

None perform any `fs.*` operations. The Next.js framework handles static file serving for `public/` directory contents, which is standard and not a traversal concern.

## Trust Model

The codebase has a clear two-tier trust model:

1. **Operator tier (trusted)**: CLI scripts run by admin/developer. Have access to keypair files, env vars, and deployment infrastructure. All file I/O occurs in this tier.
2. **User tier (untrusted)**: Web clients interacting via API routes and frontend. Zero file I/O in this tier. Users can only submit JSON payloads (webhook handler), URL query parameters (candle API), or connect SSE streams.

The trust boundary is clean: no data from the user tier crosses into file system operations.

## State Analysis

- **No file-based state accessed by web tier**: All web-tier state is in Postgres (swap_events, epoch_events, carnage_events, candles tables).
- **File-based state in operator tier**: ALT cache (`alt-address.json`), deployment logs, graduation checkpoint state, PDA manifest, mint keypairs. All accessed only by CLI scripts.
- **No session storage on filesystem**: No file-based sessions exist.

## Dependencies

- **sharp** (in optimize-images.mjs): Image processing library. Only used in build script with hardcoded input paths (`WebsiteAssets/`). No user input flows into sharp operations.
- **drizzle-orm**: Database ORM. Migration runner reads SQL files from `__dirname`-relative path. No user input in migration paths.
- **@coral-xyz/anchor**: Borsh deserialization in event-parser.ts. Operates on in-memory data (log messages), not files.

## Focus-Specific Analysis

### Path Traversal (OC-062, OC-063)
**Not exploitable.** No user-controlled input flows into `fs.readFile`, `fs.writeFile`, `path.join`, or `path.resolve` in any web-accessible code path. The WALLET env var pattern in CLI scripts is the only case where a configurable path is used for file access, and it's constrained to the operator trust tier.

### Filename Injection in Upload (OC-064)
**Not applicable.** No file upload functionality exists. No multer, formidable, busboy, or manual multipart parsing. The project is a DeFi protocol with no user file upload requirements.

### Symlink Following (OC-065)
**Not assessed -- low relevance.** File reads in CLI scripts use `fs.readFileSync` which follows symlinks by default. In the Railway container environment, symlink attacks would require container compromise first. In local dev, the operator controls the filesystem.

### AI-Generated Code Pitfalls (AIP-031, AIP-033)
- **AIP-031 (path.join assumed safe)**: The `loadIdl()` functions use `path.join(idlDir, \`${name}.json\`)` but `name` is always a hardcoded string literal, so AIP-031 does not apply.
- **AIP-033 (original upload filename)**: Not applicable -- no file uploads exist.

## Cross-Focus Intersections

### INJ-03 (SSRF)
The candles API accepts a `pool` query parameter which is a base58 string used in a Drizzle `eq()` query, not in any URL or file path. No intersection.

### SEC-01/SEC-02 (Key/Secret Management)
The WALLET env var file path pattern is more of a key management concern than a path traversal concern. The file being read contains secret key material. Cross-reference recommended.

### DATA-01 (Database)
All API routes use Drizzle ORM with parameterized queries (no SQL injection via file path). The `pool` parameter in candles API is passed to `eq(candles.pool, pool)` which is parameterized.

## Cross-Reference Handoffs

1. **SEC-01**: WALLET env var as unvalidated file path (`scripts/crank/crank-provider.ts:60-73`, `scripts/deploy/lib/connection.ts:69-84`) -- investigate key loading security posture.
2. **SEC-02**: WALLET_KEYPAIR env var stores raw secret key bytes as JSON string (`scripts/crank/crank-provider.ts:41-57`) -- assess secret storage practices.
3. **API-04**: Helius webhook optional auth (`app/app/api/webhooks/helius/route.ts:136-141`) -- not path-traversal-related but noted during analysis.

## Risk Observations

1. **(MEDIUM) WALLET env var as arbitrary file path**: Two wallet loaders accept env-var-controlled file paths without containment checks. Mitigated by operator-only access model. Recommendation: Add `startsWith(allowedDir)` check after `path.resolve()` as defense-in-depth.

2. **(LOW) IDL name parameter not validated against allowlist**: `loadIdl(name)` in both connection.ts and crank-provider.ts concatenates `name` into a file path. All current callers use hardcoded strings, but adding an allowlist would prevent future regression.

3. **(LOW) Logger path parameter unvalidated**: `createLogger(logFilePath?)` writes to caller-specified path. Currently no callers pass this parameter, but future callers could introduce a write-to-arbitrary-path bug.

## Novel Attack Surface Observations

- **Keypair substitution via path traversal**: If an attacker compromises Railway env vars and sets WALLET to point to a different keypair file they've managed to place on the filesystem, the crank would sign transactions with the attacker's wallet. This is a credential substitution attack enabled by the lack of path containment. The practical likelihood is near-zero (requires Railway admin access, at which point the attacker could just set WALLET_KEYPAIR directly), but it represents an unnecessary attack surface.

## Questions for Other Focus Areas

- **For SEC-01**: Are there any other code paths that load keypair files from configurable locations?
- **For INFRA-01**: Does the Railway container have any writable directories where an attacker could place a crafted keypair file?
- **For ERR-01**: If `fs.readFileSync` fails on a WALLET path (e.g., permission denied), does the error message leak the full file path or file contents?

## Raw Notes

- `app/next.config.ts` has a `path.join(__dirname, "..")` for Turbopack root -- this is build config, not runtime file access.
- `app/next.config.ts` stubs `fs`, `net`, `tls` for browser builds via resolveAlias -- smart pattern to prevent Node.js module leakage into browser bundle.
- `scripts/optimize-images.mjs` reads from hardcoded `WebsiteAssets/` directory and writes to `app/public/scene/` -- purely build tooling, no user input.
- `scripts/deploy/patch-mint-addresses.ts` reads and writes Rust source files -- purely deployment tooling with hardcoded paths.
- `scripts/graduation/graduate.ts` uses checkpoint file (`graduation-state.json`) for resume -- hardcoded path, no user input.
- The Borsh deserialization concern flagged by the INDEX (event-parser.ts tagged INJ-04) is about data integrity, not path traversal. The deserializer operates on in-memory log message strings, not file paths. This should be investigated by ERR-02 or CHAIN-06 instead.
