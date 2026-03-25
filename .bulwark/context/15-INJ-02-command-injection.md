---
task_id: db-phase1-inj-02
provides: [inj-02-findings, inj-02-invariants]
focus_area: inj-02
files_analyzed:
  - scripts/deploy/verify-authority.ts
  - scripts/deploy/test-upgrade.ts
  - scripts/deploy/transfer-authority.ts
  - scripts/deploy/sync-program-ids.ts
  - scripts/deploy/patch-mint-addresses.ts
  - scripts/deploy/upload-metadata.ts
  - scripts/deploy/generate-deployment-json.ts
  - scripts/deploy/generate-constants.ts
  - scripts/crank/crank-provider.ts
  - scripts/load-test/run.ts
  - app/app/api/webhooks/helius/route.ts
  - app/app/api/rpc/route.ts
  - app/app/api/candles/route.ts
  - app/lib/bigint-json.ts
  - app/lib/protocol-store.ts
  - app/lib/event-parser.ts
  - app/providers/SettingsProvider.tsx
  - app/instrumentation-client.ts
  - app/db/candle-aggregator.ts
finding_count: 5
severity_breakdown: {critical: 0, high: 0, medium: 2, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# Command & Code Injection (INJ-02) -- Condensed Summary

## Key Findings (Top 5)
- **Shell command injection surface limited to 3 deploy scripts**: Only `verify-authority.ts`, `test-upgrade.ts`, and `transfer-authority.ts` (dead import) use `child_process`. None accept external user input -- `scripts/deploy/verify-authority.ts:390`, `scripts/deploy/test-upgrade.ts:126`
- **`execSync` commands use string concatenation with env vars/config values**: `verify-authority.ts:390-395` and `test-upgrade.ts:212-216` build shell commands via string concatenation with `cvProgramId`, `walletPath`, `cluster`, and `clusterUrl`. These originate from `deployments/{cluster}.json` and `process.env` -- `scripts/deploy/verify-authority.ts:390`
- **`new RegExp` patterns properly escaped in sync/patch scripts**: `sync-program-ids.ts` and `patch-mint-addresses.ts` both implement and apply `escapeRegex()` before inserting dynamic values into RegExp constructors -- `scripts/deploy/sync-program-ids.ts:218`, `scripts/deploy/patch-mint-addresses.ts:140`
- **`generate-deployment-json.ts` uses unescaped `cluster` in RegExp, but input is allowlisted**: `cluster` at line 37 is interpolated raw into `new RegExp()`, but validated against `["devnet", "mainnet"]` at line 179 -- `scripts/deploy/generate-deployment-json.ts:37`
- **Zero `exec`/`eval`/`spawn`/`Function`/`vm` usage in app/ or crank code**: The entire Next.js application layer and crank runner are free of command/code injection sinks -- verified via exhaustive grep

## Critical Mechanisms
- **`execSync` in verify-authority.ts**: Invokes `solana program set-upgrade-authority` via shell to prove deployer cannot upgrade. Command built with `cvProgramId` (from JSON config) + `walletPath` (from env/default) + `cluster` (derived from URL string matching). Shell injection only possible if deployment JSON or env vars are compromised. -- `scripts/deploy/verify-authority.ts:390-395`
- **`run()` helper in test-upgrade.ts**: Wraps `execSync` to invoke `solana program deploy`, `solana program write-buffer`, `solana program set-buffer-authority`. All arguments come from file paths resolved via `path.join` and program keypair addresses. No external/user input enters the shell. -- `scripts/deploy/test-upgrade.ts:113-133`
- **`bigintReviver` custom JSON deserialization**: `BigInt(value.__bigint)` in `bigint-json.ts:48` receives server-controlled data (SSE from protocol-store) and on the webhook path receives attacker-controlled data (Helius payload). BigInt constructor only accepts numeric strings -- non-numeric throws, but no prototype pollution or code exec risk. -- `app/lib/bigint-json.ts:46-49`
- **RPC proxy method allowlist**: `app/api/rpc/route.ts:31-59` enforces a strict allowlist of RPC method names, preventing arbitrary method calls through the proxy. The JSON body is re-serialized and forwarded, not interpolated into commands. -- `app/app/api/rpc/route.ts:31-59`
- **Drizzle ORM parameterized queries**: All database interactions use Drizzle ORM's `sql` template tag or typed builder methods. The `candle-aggregator.ts:121-125` SQL expressions use Drizzle's parameterized `sql` tagged template, not raw string interpolation. -- `app/db/candle-aggregator.ts:121-125`

## Invariants & Assumptions
- INVARIANT: No `exec`/`eval`/`spawn`/`child_process`/`Function`/`vm` calls exist in `app/` (Next.js runtime) or `scripts/crank/` (production crank) -- enforced by architecture (verified via grep)
- INVARIANT: Shell execution is confined to `scripts/deploy/` directory (admin-only, local-machine tooling) -- enforced at `scripts/deploy/verify-authority.ts:33`, `scripts/deploy/test-upgrade.ts:41`
- INVARIANT: All RegExp with dynamic inputs use `escapeRegex()` -- enforced at `scripts/deploy/sync-program-ids.ts:218`, `scripts/deploy/patch-mint-addresses.ts:140`
- ASSUMPTION: `deployments/{cluster}.json` is trusted input (written by deploy scripts, committed to repo) -- VALIDATED by git tracking + code review
- ASSUMPTION: `process.env.WALLET` and `process.env.CLUSTER_URL` values do not contain shell metacharacters -- UNVALIDATED (env vars pass directly to `execSync` command strings)
- ASSUMPTION: `upload-metadata.ts:240` regex `new RegExp('^${key}=.*$', 'm')` is safe because `key` comes from hardcoded `envVars` object keys -- VALIDATED (keys are string literals "CRIME_METADATA_URI", "FRAUD_METADATA_URI", "PROFIT_METADATA_URI")

## Risk Observations (Prioritized)
1. **Shell command string concatenation with env vars**: `scripts/deploy/verify-authority.ts:390-395` -- `walletPath` and `clusterUrl` env var values are interpolated into shell command strings without escaping. If `WALLET` contains shell metacharacters (e.g., `; rm -rf /`), arbitrary command execution would occur. Impact: RCE on admin machine. Likelihood: requires compromised env or malicious `.env` file, but no defensive validation exists. **MEDIUM** severity (admin tooling, not production runtime).
2. **Shell command string concatenation in test-upgrade.ts**: `scripts/deploy/test-upgrade.ts:212-216` -- `safePath(binaryPath)` and `safePath(keypairPath)` are used in shell commands. `safePath()` replaces path prefix but doesn't escape shell metacharacters. If directory names or file paths contain `;`, `|`, `$()`, etc., shell injection would occur. Dr Fraudsworth project name contains a space (already handled by symlink), but not shell-special chars. **MEDIUM** severity (admin tooling only).
3. **Dead `execSync` import in transfer-authority.ts**: `scripts/deploy/transfer-authority.ts:37` -- imports `execSync` but never uses it. No runtime risk, but indicates possible copy-paste from another script. Could confuse future developers into adding shell calls. **LOW** severity (code quality).
4. **`generate-deployment-json.ts` unescaped `cluster` in RegExp**: `scripts/deploy/generate-deployment-json.ts:37` -- `cluster` is not passed through `escapeRegex()` before use in `new RegExp`. However, the value is validated against `["devnet", "mainnet"]` at line 179. Neither string contains regex metacharacters. Safe by input validation, but fragile if the allowlist expands. **LOW** severity.
5. **BigInt constructor with external-origin string**: `app/lib/bigint-json.ts:48` -- `BigInt(value.__bigint)` where `value.__bigint` could come from an attacker-crafted SSE event if they compromise the webhook pipeline. BigInt constructor in JS only accepts numeric strings and throws on non-numeric input. No code execution path. **LOW** severity (defense in depth note).

## Novel Attack Surface
- **No novel command injection vectors found**: This codebase has an unusually clean separation between deployment scripts (which use shell commands) and production runtime code (which does not). The project is an AI-assisted codebase and the common AI pitfalls (AIP-027: eval for math, AIP-028: exec instead of execFile, AIP-035: dynamic require) are entirely absent. This is notable because AI-generated Solana projects commonly introduce shell commands for keypair generation or program deployment in production paths.
- **Buffer.prototype modification in instrumentation-client.ts**: The `instrumentation-client.ts` file modifies `Buffer.prototype` with `writeBigUInt64LE` and `readBigUInt64LE` polyfills. While not a command injection vector, prototype modification is a code-level concern. The modifications are narrowly scoped (BigInt serialization only) and conditionally applied (only if missing). Cross-reference with INJ-05 (prototype pollution) for deeper analysis.

## Cross-Focus Handoffs
- -> **INJ-05 (Prototype Pollution)**: `app/instrumentation-client.ts:10-27` modifies `Buffer.prototype`. Verify no attacker can influence these polyfill functions via prototype chain manipulation. Also check `app/lib/bigint-json.ts:18-25` `isBigIntTag` which checks `"__bigint" in v` -- could a crafted `__proto__` payload create a false positive?
- -> **SEC-02 (Secret Credential)**: `scripts/deploy/verify-authority.ts:103` reads `WALLET` env var and passes it to `execSync` at line 393. If the wallet path leaks or is manipulated, it could expose keypair file locations in error messages or shell output.
- -> **INJ-01 (SQL Injection)**: `app/db/candle-aggregator.ts:121-125` uses Drizzle's `sql` tagged template for GREATEST/LEAST expressions. Verify these are truly parameterized and not subject to second-order injection via `update.price`/`update.volume` values derived from webhook payloads.

## Trust Boundaries
Shell execution is strictly confined to admin-only deployment scripts (`scripts/deploy/`) that run on the developer's local machine -- never in the Railway production environment or crank runner. The inputs to shell commands come from deployment configuration JSON files (committed to git), environment variables, and derived file paths. The production Next.js application (`app/`) and the crank runner (`scripts/crank/`) contain zero shell execution, eval, dynamic require, or Function constructor calls. The trust boundary is clear: deployment scripts trust the local filesystem and environment; production code trusts only Helius webhooks (authenticated), Solana RPC responses (display-only), and browser input (validated at API boundaries via Drizzle ORM and method allowlists).
<!-- CONDENSED_SUMMARY_END -->

---

# Command & Code Injection (INJ-02) -- Full Analysis

## Executive Summary

The Dr. Fraudsworth codebase presents a **low command injection risk profile**. Shell execution via `child_process.execSync` is confined to three deployment scripts that run exclusively on the admin's local machine. The production Next.js application layer (168 files), the crank runner, and all API routes contain zero instances of `exec`, `eval`, `spawn`, `Function`, `vm`, or dynamic `require`/`import` with variable input. The codebase uses Drizzle ORM with parameterized queries for all database access, and a strict method allowlist for RPC proxying.

The two medium-severity observations relate to shell command string concatenation in admin deployment scripts, where environment variable values are interpolated without escaping. While the attack vector requires compromised local environment or malicious `.env` files (not a remote exploit), the absence of shell argument sanitization violates defense-in-depth principles.

## Scope

**In scope:** All off-chain TypeScript/JavaScript code in:
- `app/` -- Next.js frontend + API routes + libraries (168 files)
- `scripts/` -- Deployment, E2E, crank, load testing (77 files)
- `shared/` -- Shared constants

**Out of scope:** Anchor/Rust programs in `programs/` (on-chain code).

## Key Mechanisms

### 1. Shell Execution in Deployment Scripts

Three files use `child_process`:

#### `scripts/deploy/verify-authority.ts` (line 390)

```typescript
execSync(
  `"${solanaCli}" program set-upgrade-authority ${cvProgramId} ` +
    `--new-upgrade-authority ${deployer.publicKey.toBase58()} ` +
    `--keypair "${walletPath}" ` +
    `-u ${cluster === "devnet" ? "devnet" : clusterUrl}`,
  { encoding: "utf8", stdio: "pipe", timeout: 30000 }
);
```

**Input provenance:**
- `solanaCli` -- derived from `process.env.HOME` + hardcoded path. Safe unless HOME is malicious.
- `cvProgramId` -- from `config.programs.conversionVault` (JSON file). Base58 pubkey, no shell metacharacters in valid pubkeys.
- `deployer.publicKey.toBase58()` -- cryptographic derivation, safe output format.
- `walletPath` -- from `process.env.WALLET || path.join(KEYPAIRS_DIR, "devnet-wallet.json")`. **UNESCAPED** in shell command. A WALLET value of `"; malicious-command #` would execute.
- `clusterUrl` -- from `process.env.CLUSTER_URL || "https://api.devnet.solana.com"`. **UNESCAPED**.

**Why 1 (exists):** Negative test -- proves deployer cannot upgrade programs after authority transfer.
**Why 2 (implemented this way):** Uses Solana CLI binary because the SetAuthority instruction is not easily constructed in pure JS (would require BPFLoaderUpgradeable instruction building).
**Why 3 (here):** Only called during governance verification (post-deploy admin task).
**Why 4 (these values):** Standard Solana CLI argument format.
**Why 5 (fail):** If walletPath or clusterUrl contains shell metacharacters, arbitrary command execution on admin machine.

#### `scripts/deploy/test-upgrade.ts` (lines 113-133)

```typescript
function run(cmd: string): string {
  const env = { ... };
  return execSync(cmd, {
    encoding: "utf-8",
    env,
    cwd: ROOT,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 300_000,
  }).trim();
}
```

Called at lines 212, 234, 621-625 with commands like:
```typescript
run(
  `solana program deploy ${safePath(BINARY_A)} ` +
    `--program-id ${safePath(testProgramKpPath)} ` +
    `--keypair ${safePath(walletPath)} ` +
    `--url ${cluster} ` +
    `--with-compute-unit-price 10000`
);
```

**`safePath()` analysis:** Replaces `ROOT` prefix with a symlink path to avoid spaces. Does NOT escape shell special characters.

**Input provenance for `run()` calls:**
- `safePath(BINARY_A)` -- constant file path (`target/deploy/fake_tax_program.so`). Safe.
- `safePath(testProgramKpPath)` -- constant path in `keypairs/`. Safe.
- `safePath(walletPath)` -- from `process.env.WALLET || path.join(KEYPAIRS_DIR, "devnet-wallet.json")`. **UNESCAPED**.
- `cluster` -- from `detectCluster(clusterUrl)` which returns only "devnet", "mainnet", or "localnet". Safe.

#### `scripts/deploy/transfer-authority.ts` (line 37)

**Dead import.** `import { execSync } from "child_process"` is imported but never called anywhere in the file. Confirmed by grep -- zero instances of `execSync(` in this file.

### 2. No Shell Execution in Production Code

Exhaustive grep confirms zero instances of the following in `app/` and `scripts/crank/`:
- `exec(`, `execSync`, `execFile`
- `spawn`, `spawnSync`, `fork`
- `child_process`
- `eval(`
- `new Function(`
- `vm.runIn`
- Dynamic `require()` or `import()` with template literals

### 3. RegExp Construction

Five scripts construct `RegExp` objects dynamically:

| File | Line | Input | Escaped? | Validated? |
|------|------|-------|----------|------------|
| `sync-program-ids.ts` | 250, 273, 301, 325, 452 | `fnName`, `constName`, `testFnName`, `programName`, `oldAddress` | Yes (`escapeRegex()`) | N/A |
| `patch-mint-addresses.ts` | 79, 96, 110, 125 | `spec.functionName`, `spec.newAddress` | Yes (`escapeRegex()`) | N/A |
| `upload-metadata.ts` | 240 | `key` | No | Yes (hardcoded keys) |
| `generate-deployment-json.ts` | 37 | `cluster` | No | Yes (allowlist) |

Both `escapeRegex()` implementations use the standard pattern:
```typescript
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

This correctly escapes all regex metacharacters.

For `upload-metadata.ts:240`, the `key` comes from:
```typescript
const envVars: Record<string, string> = {
  CRIME_METADATA_URI: metadataUris.crime,
  FRAUD_METADATA_URI: metadataUris.fraud,
  PROFIT_METADATA_URI: metadataUris.profit,
};
for (const [key, value] of Object.entries(envVars)) {
  const regex = new RegExp(`^${key}=.*$`, "m");
```
Keys are hardcoded string literals. No injection risk.

For `generate-deployment-json.ts:37`, `cluster` is validated:
```typescript
if (!cluster || !["devnet", "mainnet"].includes(cluster)) {
  process.exit(1);
}
```
Only "devnet" or "mainnet" reach the RegExp. No metacharacters.

### 4. `eval()` / `Function()` / `vm` Analysis

**Zero instances found in project source code.**

The only `new Function` match is in `.next/build/chunks/` (Next.js build output), which is framework code, not project code. Per FP-005, eval in build tools/dev dependencies is a false positive.

### 5. Dynamic `require()` / `import()` Analysis

**Zero instances of dynamic require/import with user-controlled input.**

The `crank-provider.ts:113-121` has a `loadIdl()` function that takes a `name` parameter:
```typescript
function loadIdl(name: string): any {
  const idlPath = path.join(idlDir, `${name}.json`);
  return JSON.parse(fs.readFileSync(idlPath, "utf8"));
}
```

Called only with hardcoded string literals: `"epoch_program"`, `"amm"`, `"tax_program"`, `"staking"`, `"transfer_hook"`. No external input flows into `name`. This is file read (INJ-04 territory), not dynamic module loading.

### 6. JSON Deserialization Analysis

**`bigintReviver` in `bigint-json.ts:46-49`:**
```typescript
export function bigintReviver(_key: string, value: unknown): unknown {
  if (isBigIntTag(value)) {
    return BigInt(value.__bigint);
  }
  return value;
}
```

- `isBigIntTag()` checks: `typeof v === "object" && v !== null && "__bigint" in v && typeof v.__bigint === "string"`
- `BigInt()` constructor only accepts numeric strings. Non-numeric throws `SyntaxError`. No code execution path.
- Attacker could craft a payload with `{ "__bigint": "not-a-number" }` which would throw, but this is caught by the try/catch in the webhook handler.

**`JSON.parse` in webhook handler (`route.ts:321`):**
```typescript
payload = await req.json();
```

Standard Next.js request body parsing. `JSON.parse` alone does not create `__proto__` properties (per FP-010). The parsed data flows into Drizzle ORM (parameterized) and Anchor Borsh decoding (binary), neither of which is vulnerable to JSON-based injection.

**`JSON.parse` of `localStorage` in SettingsProvider.tsx (`line 190`):**
```typescript
const parsed = JSON.parse(raw);
if (typeof parsed !== 'object' || parsed === null) return defaults;
return {
  slippageBps: typeof parsed.slippageBps === 'number' && ... ? parsed.slippageBps : defaults.slippageBps,
  ...
};
```

Properly validates types before use. Each field is individually type-checked. No prototype pollution or injection risk -- values are used as plain primitives (numbers, strings, booleans).

## Trust Model

| Trust Zone | Injection Relevance |
|-----------|-------------------|
| **Browser client** | No shell, eval, or dynamic require. React JSX escaping (FP-008). localStorage parsed with type validation. |
| **Next.js API routes** | No shell execution. JSON body parsed via `req.json()`. Database via Drizzle ORM parameterized. RPC proxy uses method allowlist. |
| **Webhook handler** | Untrusted input from Helius (authenticated). Parsed via `req.json()`, validated (array check, type discrimination). No eval/exec. DB writes via Drizzle parameterized ORM. |
| **Crank runner** | No shell execution. Env vars used for wallet loading only (keypair JSON, RPC URL). |
| **Deploy scripts** | Shell execution present. Inputs from local filesystem (JSON configs, env vars, file paths). Not exposed to network/user input. |
| **Load test scripts** | No shell execution. CLI args parsed from `process.argv` but only used for URL strings passed to `fetch()`. |

## State Analysis

No state stores (databases, caches, sessions) are accessible via command or code injection. All database access uses Drizzle ORM's parameterized query builder. The in-memory `protocol-store.ts` uses a simple `Map<string, AccountState>` with no eval, no template rendering, and no shell execution.

## Dependencies

| Dependency | Injection Risk | Notes |
|-----------|---------------|-------|
| `@coral-xyz/anchor` BorshCoder | None | Binary deserialization, no eval |
| `drizzle-orm` | None (parameterized) | `sql` tagged template is safe |
| `@irys/upload` | None | Used for Arweave uploads, not user-facing |
| `@sqds/multisig` | None | Transaction construction, no eval |
| `next/server` | None | Standard request/response handling |

No `js-yaml`, `ejs`, `nunjucks`, `pug`, or other template/deserialization libraries that commonly introduce injection vulnerabilities.

## Focus-Specific Analysis

### Shell Command Injection (OC-055, AIP-028)

**Verdict: Not exploitable remotely. Two scripts have defense-in-depth gaps.**

The two `execSync` call sites in production deploy scripts use string concatenation to build shell commands. Per AIP-028, the secure pattern is `execFile('solana', ['program', 'set-upgrade-authority', ...])` with array arguments. The current code uses `exec()` semantics (shell interpretation).

However, the attack prerequisites are severe:
1. Attacker must control env vars on the admin's local machine (requires SSH access or malicious `.env` file)
2. Scripts are never run in production (Railway) -- only locally by mlbob
3. The Solana CLI requires shell invocation for some subcommands

**Recommendation:** Convert to `execFileSync('solana', [...args])` where possible, or at minimum validate/escape env var values before shell interpolation. This is a defense-in-depth improvement, not an active vulnerability.

### Code Injection via eval/Function (OC-056, AIP-027)

**Verdict: Not present.**

Zero instances of `eval()`, `new Function()`, or `vm.runIn*` in project source. The codebase uses proper alternatives:
- Math: `BigInt()`, BN arithmetic, `Number()` -- no eval-based calculation
- JSON: `JSON.parse()` with custom reviver -- no eval
- Templates: React JSX -- no server-side template rendering

### Dynamic require/import (OC-078, AIP-035)

**Verdict: Not present.**

No dynamic `require()` or `import()` with user-controlled input. All module loading uses static import paths or hardcoded string literals.

### RegExp Injection (OC-079, AIP-037)

**Verdict: Properly mitigated.**

All `new RegExp()` calls with dynamic input either:
1. Use `escapeRegex()` to sanitize the input (`sync-program-ids.ts`, `patch-mint-addresses.ts`), or
2. Validate input against a strict allowlist before RegExp construction (`generate-deployment-json.ts`, `upload-metadata.ts`)

No `new RegExp(req.query.search)` or similar patterns exist.

### Prototype Pollution to Code Execution (OC-066/067)

**Verdict: Low risk. No gadget chains identified.**

`Buffer.prototype` is modified in `instrumentation-client.ts` with BigInt polyfills. This is controlled code, not user-influenced. No `_.merge()`, `Object.assign()` with untrusted input, or deep merge patterns found. Handoff to INJ-05 for deeper prototype pollution analysis.

## Cross-Focus Intersections

| Focus | Intersection | Notes |
|-------|-------------|-------|
| INJ-01 (SQL) | Drizzle `sql` template tag usage | Verify parameterization is complete (see candle-aggregator.ts) |
| INJ-03 (SSRF) | RPC proxy forwards requests | Method allowlist prevents arbitrary calls, but URL comes from env |
| INJ-04 (Path Traversal) | `loadIdl()` in crank-provider.ts | Static names only, but pattern could be extended |
| INJ-05 (Prototype Pollution) | `Buffer.prototype` modification | Potential gadget if attacker can influence polyfill functions |
| SEC-02 (Secrets) | `walletPath` in shell commands | Path could leak in error messages |
| ERR-02 (Error Handling) | `BigInt()` throws on invalid input | Caught by webhook handler try/catch |

## Cross-Reference Handoffs

1. **-> INJ-05**: `instrumentation-client.ts:10-27` modifies `Buffer.prototype`. Check for prototype chain attacks.
2. **-> SEC-02**: `verify-authority.ts:103` uses `process.env.WALLET` in shell command. Assess env var compromise scenarios.
3. **-> INJ-01**: `candle-aggregator.ts:121-125` Drizzle `sql` template expressions with webhook-derived values. Verify parameterization.
4. **-> INJ-04**: `crank-provider.ts:61-63` resolves file path from `process.env.WALLET`. Check for path traversal.

## Risk Observations

### Medium Severity

1. **M-01: Shell command string concatenation in verify-authority.ts** (line 390-395)
   - `walletPath` from `process.env.WALLET` and `clusterUrl` from `process.env.CLUSTER_URL` are interpolated without shell escaping
   - Impact: RCE on admin machine if env vars are compromised
   - Likelihood: Requires local env compromise; admin-only script
   - Recommendation: Use `execFileSync` with argument array, or validate env vars contain only expected characters (path chars, URL chars)

2. **M-02: Shell command string concatenation in test-upgrade.ts** (line 212-216)
   - `safePath()` handles spaces but not shell metacharacters
   - Impact: Same as M-01
   - Recommendation: Same as M-01

### Low Severity

3. **L-01: Dead `execSync` import in transfer-authority.ts** (line 37)
   - Unused import creates false impression of shell execution capability
   - Recommendation: Remove dead import

4. **L-02: Unescaped `cluster` in RegExp in generate-deployment-json.ts** (line 37)
   - Safe today due to allowlist, but fragile if allowlist changes
   - Recommendation: Apply `escapeRegex()` for defense-in-depth

5. **L-03: BigInt constructor with external-origin string** (bigint-json.ts:48)
   - Non-numeric strings throw SyntaxError (caught by handler)
   - No code execution risk, but defense-in-depth could add numeric regex validation
   - Recommendation: Add `if (!/^-?\d+$/.test(value.__bigint)) return value;` guard

## Novel Attack Surface Observations

1. **AI code generation quality**: This codebase shows no signs of the common AI-generated injection pitfalls cataloged in AIP-026 through AIP-040. No `eval()` for math, no `exec()` with template literals for user-facing features, no `require(userInput)`, no unescaped RegExp with user input. The shell execution that does exist is confined to deployment tooling with admin-only access. This is notably cleaner than typical AI-assisted Solana projects.

2. **RPC proxy as indirect injection surface**: The `/api/rpc` route (app/api/rpc/route.ts) acts as a JSON-RPC proxy. While it enforces a method allowlist, the params within allowed methods are forwarded verbatim to Helius. If Helius had a server-side vulnerability triggered by specific param structures, the proxy would forward the exploit. This is a theoretical concern -- Helius is a trusted third-party service -- but worth noting for the trust model.

3. **Webhook payload as injection vector**: The Helius webhook payload is the primary untrusted input to the server. It flows through JSON parsing -> Anchor event decoding -> Drizzle ORM writes. None of these steps involve shell execution or eval. The payload also flows through `anchorToJson()` -> `JSON.stringify(bigintReplacer)` -> SSE broadcast -> `JSON.parse(bigintReviver)` on the client. This entire pipeline is injection-safe: no template rendering, no eval, no shell commands, no innerHTML.

## Questions for Other Focus Areas

1. **For INJ-01**: Does Drizzle's `sql` tagged template properly parameterize the values in `GREATEST(${candles.high}, ${update.price})` expressions? Are these truly parameterized queries, or does the `sql` tag perform string interpolation?
2. **For INJ-05**: Can the `Buffer.prototype` polyfills in `instrumentation-client.ts` be weaponized via prototype chain manipulation if an attacker controls a key earlier in the prototype chain?
3. **For SEC-02**: Are the `.env.devnet` / `.env.mainnet` files gitignored? If they contain shell-unsafe characters in `WALLET` or `CLUSTER_URL`, the deploy scripts would be vulnerable.

## Raw Notes

### Files with zero injection surface (confirmed clean)
- All 168 `app/` files: No exec/eval/spawn/Function/vm
- All `scripts/crank/` files: No exec/eval/spawn/Function/vm
- All `scripts/e2e/` files: No exec/eval/spawn/Function/vm
- All `scripts/load-test/` files: No exec/eval/spawn/Function/vm
- `shared/constants.ts`, `shared/index.ts`: Pure data exports

### Grep results summary
- `exec(` in project source: 3 files (verify-authority, test-upgrade, transfer-authority)
- `eval(` in project source: 0 files
- `spawn` in project source: 0 files
- `new Function` in project source: 0 files
- `vm.runIn` in project source: 0 files
- `new RegExp` in project source: 6 files (all properly handled)
- `dangerouslySetInnerHTML` in project source: 0 files
- `innerHTML` in project source: 0 files
- `document.write` in project source: 0 files
