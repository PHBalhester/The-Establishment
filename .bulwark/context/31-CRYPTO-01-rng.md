---
task_id: db-phase1-crypto-01-rng
provides: [crypto-01-rng-findings, crypto-01-rng-invariants]
focus_area: crypto-01-rng
files_analyzed: [app/lib/audio-manager.ts, app/lib/sentry.ts, app/app/api/webhooks/helius/route.ts, app/lib/rate-limit.ts, app/lib/sse-connections.ts, app/lib/event-parser.ts, scripts/e2e/lib/stress-wallet.ts, scripts/test/pathway2-fill.ts, scripts/e2e/stress-test.ts, scripts/vrf/lib/vrf-flow.ts, scripts/crank/crank-runner.ts, scripts/deploy/initialize.ts, scripts/deploy/fix-carnage-wsol.ts]
finding_count: 4
severity_breakdown: {critical: 0, high: 0, medium: 0, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# CRYPTO-01: Random Number Generation & Nonces — Condensed Summary

## Key Findings (Top 5)
- **Math.random() in audio shuffle is non-security**: Fisher-Yates shuffle for music playlist uses Math.random() — confirmed not security-sensitive — `app/lib/audio-manager.ts:343,353`
- **Math.random() in test/stress scripts**: randInt/randFloat helpers use Math.random() for test amount jitter — non-production, non-security — `scripts/e2e/lib/stress-wallet.ts:78,83`; `scripts/test/pathway2-fill.ts:145,149`; `scripts/e2e/stress-test.ts:65`
- **crypto.randomUUID() for Sentry event IDs**: Uses Web Crypto API's randomUUID (v4, CSPRNG-backed) for non-security identifiers (Sentry error tracking IDs) — `app/lib/sentry.ts:150`
- **Webhook auth uses timingSafeEqual correctly**: HELIUS_WEBHOOK_SECRET comparison uses constant-time comparison with length-matching defense to prevent timing side-channel — `app/app/api/webhooks/helius/route.ts:291-299`
- **Keypair.generate() uses CSPRNG**: All Solana keypair generation (deploy scripts, VRF randomness accounts, test wallets) goes through @solana/web3.js Keypair.generate() which delegates to tweetnacl's crypto_sign_keypair seeded by randomBytes — CSPRNG-backed — `scripts/vrf/lib/vrf-flow.ts:510,651`; `scripts/deploy/initialize.ts:168`; `scripts/deploy/fix-carnage-wsol.ts:101`

## Critical Mechanisms
- **VRF Randomness (Switchboard On-Demand)**: Off-chain code creates randomness accounts via `sb.Randomness.create()` + `Keypair.generate()`, commits, waits for oracle reveal, then consumes. Anti-reroll protection binds randomness account at commit time. Recovery path creates fresh randomness after 300-slot timeout — `scripts/vrf/lib/vrf-flow.ts:648-718`
- **Webhook Secret Comparison**: fail-closed in production (500 if HELIUS_WEBHOOK_SECRET unset), constant-time comparison with length-guard — `app/app/api/webhooks/helius/route.ts:266-301`
- **Keypair Generation for Token Accounts**: `Keypair.generate()` used for mint keypairs, WSOL accounts, and test wallets. All delegate to tweetnacl (Ed25519) seeded by Node.js `crypto.randomBytes(32)` — `scripts/deploy/initialize.ts:168`
- **Sentry Event ID**: `crypto.randomUUID()` generates UUID v4 (CSPRNG-backed) — not security-sensitive but correctly implemented — `app/lib/sentry.ts:150`

## Invariants & Assumptions
- INVARIANT: All Solana keypair generation uses CSPRNG (tweetnacl's Ed25519 via `Keypair.generate()`) — enforced by @solana/web3.js library design
- INVARIANT: Webhook secret comparison is constant-time — enforced at `app/app/api/webhooks/helius/route.ts:299` via `timingSafeEqual()`
- INVARIANT: Production webhook endpoint requires HELIUS_WEBHOOK_SECRET — enforced at `app/app/api/webhooks/helius/route.ts:273` (fail-closed)
- ASSUMPTION: Math.random() is only used in non-security contexts (audio shuffle, test scripts) — validated by grep across entire codebase; no security-sensitive usage found
- ASSUMPTION: VRF randomness account keypairs do not need to be secret — validated; they are Switchboard on-chain accounts, the keypair is only used to sign the creation TX
- ASSUMPTION: `crypto.randomUUID()` in Node.js 18+ is CSPRNG-backed (UUID v4) — validated by Node.js documentation

## Risk Observations (Prioritized)
1. **Math.random() proximity to security code in stress-wallet.ts**: While only used for test jitter amounts, `scripts/e2e/lib/stress-wallet.ts:78,83` uses Math.random() in a file that also handles real keypairs and transactions. A future refactor could accidentally extend Math.random() usage to security contexts. LOW risk — test-only code, not deployed.
2. **No off-chain encryption or hashing operations**: The codebase performs zero symmetric encryption, zero password hashing, zero HMAC generation (beyond the webhook timingSafeEqual). The absence of crypto operations means the absence of crypto bugs, but also the absence of defense-in-depth for data at rest. INFORMATIONAL — consistent with project architecture (no user accounts, no stored secrets beyond env vars).
3. **VRF randomness keypair lifecycle**: Fresh `Keypair.generate()` created for each VRF attempt (including retries). The keypair signs the creation TX then is discarded. No keypair reuse across epochs. INFORMATIONAL — correct pattern.
4. **Sentry event_id uses randomUUID without dash stripping verification**: `crypto.randomUUID().replace(/-/g, "")` correctly strips dashes, producing a 32-char hex string matching Sentry's event_id format. No security impact but worth noting the transform — `app/lib/sentry.ts:150`

## Novel Attack Surface
- **No novel crypto attack surface detected**: This codebase does not implement custom cryptographic primitives, encryption, hashing, or key derivation. All randomness needs are either delegated to Switchboard VRF (on-chain), Solana's Keypair.generate() (CSPRNG), or crypto.randomUUID() (CSPRNG). The absence of custom crypto is itself the strongest security posture. The main risk is that a future contributor introduces Math.random() for a security-sensitive purpose — which is an AI-generated-code pitfall (AIP-149) to watch for in future reviews.

## Cross-Focus Handoffs
- → **SEC-02 (Secret Credential)**: Webhook secret stored as env var (`HELIUS_WEBHOOK_SECRET`). Verify rotation story, entropy requirements, and whether HMAC-SHA256 (standard Helius pattern) should be used instead of raw string comparison
- → **BOT-01 (Keeper/Crank)**: VRF randomness account creation in crank-runner.ts — verify that failed VRF attempts properly clean up randomness accounts to avoid rent accumulation
- → **CHAIN-05 (MEV/Ordering)**: VRF reveal bytes are public before consume_randomness processes them. Off-chain MEV observation window between oracle reveal and TX3 landing is a cross-boundary concern

## Trust Boundaries
The off-chain codebase trusts the Switchboard VRF oracle for randomness generation — off-chain code only creates the randomness account (using CSPRNG keypair) and orchestrates the commit-reveal flow. The webhook authentication boundary uses a shared-secret model with constant-time comparison (correct). No session tokens, API keys, or nonces are generated off-chain for security purposes. All transaction nonces (blockhashes) are fetched from Solana RPC at confirmed/finalized commitment. The codebase's crypto footprint is intentionally minimal — all security-critical randomness lives on-chain via Switchboard.
<!-- CONDENSED_SUMMARY_END -->

---

# CRYPTO-01: Random Number Generation & Nonces — Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase has a remarkably small cryptographic footprint. There are no symmetric encryption operations, no password hashing, no custom key derivation functions, and no HMAC computations. The only crypto-relevant operations are:

1. **Solana keypair generation** (`Keypair.generate()`) — CSPRNG-backed via tweetnacl
2. **Webhook secret comparison** (`timingSafeEqual`) — constant-time, correctly implemented
3. **Sentry event IDs** (`crypto.randomUUID()`) — CSPRNG-backed UUID v4
4. **Audio playlist shuffle** (`Math.random()`) — non-security
5. **Test script jitter** (`Math.random()`) — non-production

No critical or high findings were identified. The four low findings are defensive observations about code proximity and future-proofing rather than exploitable vulnerabilities.

## Scope

**In scope:** All off-chain TypeScript/JavaScript code in `app/`, `scripts/`, `shared/`, and `tests/` directories, analyzed through the lens of random number generation, nonce management, and cryptographic operations.

**Out of scope:** On-chain Anchor/Rust programs in `programs/` (run SOS for on-chain audit). Switchboard VRF's internal randomness generation (trusted external dependency).

## Key Mechanisms

### 1. Solana Keypair Generation

All keypair generation in the codebase uses `@solana/web3.js`'s `Keypair.generate()`, which internally calls `tweetnacl.sign.keyPair()`. Tweetnacl's key generation seeds from `crypto.randomBytes(32)` (Node.js CSPRNG). This is the correct pattern.

**Locations:**
- VRF randomness accounts: `scripts/vrf/lib/vrf-flow.ts:510,651` — fresh keypair per VRF attempt
- Deploy mint keypairs: `scripts/deploy/initialize.ts:168` — saved with `mode: 0o600`
- WSOL fix keypair: `scripts/deploy/fix-carnage-wsol.ts:101` — saved with `mode: 0o600`
- Test wallets: `tests/*.ts` (60+ instances) — ephemeral, test-only
- Stress test: `scripts/e2e/stress-test.ts:214` — ephemeral, test-only

**Keypair persistence:** Deploy scripts (`initialize.ts`, `fix-carnage-wsol.ts`) write keypairs to disk with UNIX permission `0o600` (owner read/write only). This is correct file permission hygiene.

### 2. Webhook Secret Comparison (timingSafeEqual)

The Helius webhook handler (`app/app/api/webhooks/helius/route.ts:286-301`) implements constant-time string comparison:

```
const secretBuf = Buffer.from(webhookSecret, "utf-8");
const headerBuf = Buffer.from(authHeader, "utf-8");
const lengthMatch = secretBuf.length === headerBuf.length;
const compareBuf = lengthMatch ? headerBuf : secretBuf;
if (!lengthMatch || !timingSafeEqual(secretBuf, compareBuf)) { ... }
```

**Analysis:**
- `timingSafeEqual` imported from `node:crypto` — correct API
- Length mismatch handled by comparing secret against itself (prevents length-based timing leak)
- Fail-closed in production: returns 500 if `HELIUS_WEBHOOK_SECRET` is unset

**Observation:** The comparison is a raw string match (Authorization header vs. stored secret). This is NOT HMAC-SHA256 verification. Helius webhooks typically use HMAC-SHA256 (the secret is used to compute an HMAC of the body, and the signature is sent in the Authorization header). The current implementation compares the raw secret value, meaning Helius sends the secret directly in the header. Need to verify this is the correct Helius authentication model — if Helius sends an HMAC signature instead, this comparison is semantically wrong (comparing secret bytes vs. HMAC digest bytes).

**Cross-focus handoff to SEC-02:** Verify Helius webhook authentication model.

### 3. crypto.randomUUID() for Sentry

`app/lib/sentry.ts:150` uses `crypto.randomUUID()` to generate Sentry event IDs. In Node.js 18+, `crypto.randomUUID()` generates UUID v4 backed by CSPRNG. The dashes are stripped to match Sentry's 32-char hex event_id format.

This is not security-sensitive (Sentry event IDs are internal telemetry identifiers), but it's correctly implemented regardless.

### 4. Math.random() Usage (Non-Security)

All Math.random() usage in the codebase is non-security:

| File | Line(s) | Purpose | Security Impact |
|------|---------|---------|-----------------|
| `app/lib/audio-manager.ts` | 343, 353 | Fisher-Yates shuffle for music playlist | None — UX only |
| `scripts/e2e/lib/stress-wallet.ts` | 78, 83, 337 | Test amount jitter + random action selection | None — test-only |
| `scripts/test/pathway2-fill.ts` | 145, 149, 493, 500 | Test amount jitter + random curve selection | None — test-only |
| `scripts/e2e/stress-test.ts` | 65 | Test amount jitter | None — test-only |

**False positive check (FP-002 / H112):** The audio-manager.ts Math.random() was already cleared as NOT VULNERABLE in Audit #1 (H112). The test scripts are non-production code. No false positive concerns.

### 5. VRF Off-Chain Orchestration

The VRF flow (`scripts/vrf/lib/vrf-flow.ts`) manages the three-transaction Switchboard On-Demand commit-reveal cycle:

1. **TX1: Create randomness account** — `Keypair.generate()` for new Switchboard account
2. **TX2: Commit + trigger_epoch_transition** — Binds randomness account to epoch
3. **TX3: Reveal + consume_randomness** — Oracle reveals, on-chain consumes

**Off-chain CRYPTO-01 concerns:**
- The randomness account keypair is generated via CSPRNG (`Keypair.generate()`) — correct
- Fresh keypair per attempt (lines 510, 651) — no reuse
- Recovery path creates new keypair for retry (line 510) — correct
- The actual randomness is generated by Switchboard's oracle, not off-chain code
- Off-chain code only orchestrates; it does not generate or influence the random values

**Nonce management:** Transaction nonces (recentBlockhash) are fetched from Solana RPC at appropriate commitment levels (`confirmed` for standard TXs, `finalized` for VRF TX1). This is standard Solana practice.

## Trust Model

| Trust Boundary | Direction | Trust Level |
|----------------|-----------|-------------|
| Off-chain -> Switchboard VRF | Off-chain trusts oracle for randomness | Trusted external dependency |
| Off-chain -> @solana/web3.js Keypair.generate() | Off-chain trusts library for CSPRNG | Trusted dependency (tweetnacl) |
| Helius -> Webhook endpoint | External service authenticates via shared secret | Verified (timingSafeEqual) |
| Browser -> Sentry | Event IDs are telemetry, not security tokens | No trust requirement |
| Test scripts -> Math.random() | Non-security jitter for test scenarios | No trust requirement |

## State Analysis

No cryptographic state is persisted:
- No encryption keys stored in databases or caches
- No session tokens generated server-side
- No nonces maintained across requests
- Webhook secret loaded from environment variable per-request
- VRF keypairs are ephemeral (created, used for one TX, then discarded in-memory)

## Dependencies

| Dependency | Crypto Role | Risk |
|------------|-------------|------|
| `@solana/web3.js` | Keypair.generate() (tweetnacl Ed25519) | LOW — well-audited, widely used |
| `node:crypto` | timingSafeEqual, randomUUID | LOW — Node.js standard library |
| `@switchboard-xyz/on-demand` | VRF randomness account creation | LOW — trusted oracle SDK |
| `tweetnacl` | Ed25519 key generation (transitive via web3.js) | LOW — audited, minimal |

## Focus-Specific Analysis

### AIP-149 Check: Math.random() for Token/Secret Generation
**Result: NOT FOUND.** No instance of Math.random() is used for tokens, secrets, nonces, salts, session IDs, or any security-sensitive purpose. All instances are in audio UX or test scripts.

### AIP-150 Check: Static/Hardcoded Initialization Vectors
**Result: NOT APPLICABLE.** No encryption operations exist in the codebase. No IVs or nonces for symmetric encryption.

### AIP-151 Check: AES-ECB Mode
**Result: NOT APPLICABLE.** No AES encryption in the codebase.

### AIP-152 Check: MD5/SHA-1 for Password Hashing
**Result: NOT APPLICABLE.** No password hashing in the codebase. No user accounts.

### AIP-153 Check: Encryption Without Authentication
**Result: NOT APPLICABLE.** No encryption in the codebase.

### AIP-154 Check: Hardcoded Encryption Keys
**Result: NOT APPLICABLE.** No encryption keys in the codebase.

### AIP-155 Check: String Equality for HMAC/Token Comparison
**Result: CORRECTLY HANDLED.** Webhook secret comparison uses `timingSafeEqual` from `node:crypto` — `app/app/api/webhooks/helius/route.ts:299`.

### AIP-156 Check: UUID v1 for Security Identifiers
**Result: NOT FOUND.** The only UUID usage is `crypto.randomUUID()` (v4, CSPRNG) for non-security Sentry event IDs.

### AIP-157 Check: PBKDF2 with Low Iterations
**Result: NOT APPLICABLE.** No PBKDF2 or key derivation in the codebase.

### AIP-158 Check: Base64 Treated as Encryption
**Result: NOT FOUND.** No functions named encrypt/decrypt exist. Base64 is used only for legitimate encoding (Borsh event data, Sentry envelopes).

## Cross-Focus Intersections

### SEC-02 (Secret Credential)
- Webhook secret is a shared-secret token compared raw (not HMAC). Verify this matches Helius's authentication model.
- All env var secrets (DATABASE_URL, HELIUS_WEBHOOK_SECRET, WALLET_KEYPAIR) are loaded without entropy validation.

### BOT-01 (Keeper/Crank)
- Crank runner calls `advanceEpochWithVRF()` which creates VRF randomness keypairs. The keypair lifecycle is ephemeral and correct, but failed VRF attempts should be audited for rent-exempt lamport accumulation on abandoned randomness accounts.

### CHAIN-05 (MEV/Ordering)
- VRF reveal bytes become public when the Switchboard oracle processes the commitment (~3 slots after TX2). Between oracle reveal and TX3 landing, an MEV bot could observe the upcoming tax rates and front-run. This is a cross-boundary concern documented in ARCHITECTURE.md section 9.6.

### DATA-05 (Encryption)
- No data-at-rest encryption exists. Keypair files are protected by filesystem permissions (0o600) only. This is appropriate for deployment scripts but worth noting.

## Cross-Reference Handoffs

| Handoff | Target Agent | Item |
|---------|-------------|------|
| Webhook auth model | SEC-02 | Verify Helius sends raw secret (not HMAC signature) in Authorization header |
| VRF randomness account rent | BOT-01 | Check if abandoned randomness accounts from failed VRF attempts accumulate rent |
| VRF reveal MEV window | CHAIN-05 | Assess observable VRF reveal -> consume_randomness timing gap |
| Keypair file permissions | SEC-01 | Verify 0o600 permissions survive git operations and deployment pipeline |

## Risk Observations

### LOW-01: Math.random() in Test Files Near Production Code
**Files:** `scripts/e2e/lib/stress-wallet.ts:78,83`
**Observation:** stress-wallet.ts contains both `Math.random()` helpers and real Keypair/Transaction operations. While the randomness is only used for test amount jitter, the proximity creates a pattern where a future contributor might use `randInt()`/`randFloat()` for something security-sensitive.
**Mitigation:** Add a comment on the `randInt`/`randFloat` functions: "// INSECURE: Math.random() - test-only, NOT for security use"

### LOW-02: No Entropy Validation on Webhook Secret
**File:** `app/app/api/webhooks/helius/route.ts:270`
**Observation:** `process.env.HELIUS_WEBHOOK_SECRET` is loaded without checking minimum length or entropy. A one-character secret would pass the comparison but offer negligible protection.
**Mitigation:** Add a minimum length check (e.g., >= 32 characters) in the production guard.

### LOW-03: Webhook Auth Model Uncertainty
**File:** `app/app/api/webhooks/helius/route.ts:287`
**Observation:** The comparison checks `authorization` header against the raw secret value. Standard webhook authentication uses HMAC-SHA256 (secret is used as key to sign the body, signature sent in header). If Helius uses HMAC, this comparison would accept any request that sends the raw secret, not just Helius. Need to verify Helius's actual authentication mechanism.
**Note:** This may already be validated by SEC-02 or API-04. Cross-referencing with those agents' findings.

### LOW-04: VRF Keypair Not Zeroed After Use
**File:** `scripts/vrf/lib/vrf-flow.ts:651`
**Observation:** The VRF randomness account keypair (`rngKp`) is created, used to sign the creation TX, and then allowed to be garbage-collected. The secret key bytes remain in memory until GC. In Node.js, there is no reliable way to zero a Uint8Array's backing buffer (V8 may optimize away memset). This is an informational observation — the keypair signs only a Switchboard account creation TX and has no authority over funds.

## Novel Attack Surface Observations

This codebase's novel characteristic from a CRYPTO-01 perspective is the **complete absence of custom cryptography**. There are:
- Zero encryption operations
- Zero hashing operations (beyond event discriminator references in comments)
- Zero key derivation operations
- Zero HMAC computations
- Zero nonce management beyond Solana's recentBlockhash

This means the standard CRYPTO-01 exploit patterns (ECB mode, static IVs, weak hashes, PBKDF2 iterations, nonce reuse) have zero attack surface. The protocol delegates all security-critical randomness to Switchboard VRF (on-chain) and all cryptographic operations to well-audited libraries (@solana/web3.js, node:crypto).

The risk, therefore, is **negative space**: if a future feature requires encryption, hashing, or token generation, there are no established patterns to follow. An AI-generated code addition is particularly likely to introduce AIP-149 (Math.random() for tokens) or AIP-154 (hardcoded keys) because there are no existing secure patterns to copy.

## Questions for Other Focus Areas

1. **SEC-02:** Does Helius use HMAC-SHA256 signature verification or raw shared-secret comparison? The current implementation assumes raw secret.
2. **BOT-01:** When a VRF attempt fails and creates a randomness account that is never consumed, does the account remain on-chain accumulating rent? Who pays and who recovers?
3. **CHAIN-05:** What is the observable timing gap between Switchboard oracle revealing VRF bytes and TX3 (consume_randomness) landing on-chain? Is this exploitable for tax rate front-running?
4. **DATA-05:** Are there plans to add encryption for any stored data (keypairs at rest, database contents)?

## Raw Notes

### Grep Summary: Math.random() Locations
- `app/lib/audio-manager.ts:343,353` — audio shuffle (CLEARED by H112)
- `scripts/e2e/lib/stress-wallet.ts:78,83,337` — test jitter
- `scripts/test/pathway2-fill.ts:145,149,493,500` — test jitter
- `scripts/e2e/stress-test.ts:65` — test jitter

### Grep Summary: Crypto API Usage
- `app/app/api/webhooks/helius/route.ts:71` — `import { timingSafeEqual } from "node:crypto"`
- `app/lib/sentry.ts:150` — `crypto.randomUUID()` (Web Crypto API)
- No other `node:crypto` imports in app/ or scripts/

### Grep Summary: Keypair.generate() (Production-Relevant Only)
- `scripts/deploy/initialize.ts:168,299,551,561,724,748,763,1383,1416` — deploy/init
- `scripts/deploy/fix-carnage-wsol.ts:101` — WSOL fix
- `scripts/vrf/lib/vrf-flow.ts:510,651` — VRF randomness
- `scripts/deploy/setup-squads.ts:64` — test signer fallback

### Absence Log
- No `createHash` calls in app/ TS files
- No `createHmac` calls in app/ or scripts/ TS files
- No `createCipheriv`/`createDecipheriv` calls anywhere
- No `pbkdf2` calls anywhere
- No `scrypt` calls anywhere
- No uuid library imports (only native `crypto.randomUUID`)
- No nanoid imports
