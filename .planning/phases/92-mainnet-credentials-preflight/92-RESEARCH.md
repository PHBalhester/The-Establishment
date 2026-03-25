# Phase 92: Mainnet Credentials & Preflight - Research

**Researched:** 2026-03-12
**Domain:** Deployment infrastructure, environment isolation, preflight safety gates
**Confidence:** HIGH

## Summary

Phase 92 is purely operational infrastructure -- no new libraries, no new on-chain code, no new frameworks. The work is creating a fresh mainnet deployer wallet, splitting env files for complete devnet/mainnet isolation, building a comprehensive env var inventory from codebase scanning, and inserting a preflight safety gate as Phase 0 in the existing deploy-all.sh pipeline.

The codebase already has strong foundations: deploy-all.sh accepts a cluster argument, sources `.env.{cluster}`, cross-validates cluster URLs, and has a mainnet confirmation prompt. The existing `.env.devnet` (committed) and `.env.mainnet` (gitignored, placeholder) files exist from Phase 91. The Sentry implementation already supports environment tagging via `NEXT_PUBLIC_CLUSTER`. What remains is filling in the gaps: wallet generation, complete env var audit, preflight checks, and service credential separation.

**Primary recommendation:** This phase is bash scripting and env var management -- no external dependencies needed. The key risk is missing env vars, so the codebase audit must be exhaustive and automated (grep-based), not manual.

## Standard Stack

### Core

No new libraries required. This phase uses only existing tools:

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| solana-keygen | v3.0.x (Agave) | Generate mainnet deployer wallet | Standard Solana CLI tool, already installed |
| bash | 5.x | Preflight script, env sourcing | Already used by deploy-all.sh |
| sha256sum / shasum | System | Binary hash verification | macOS built-in (shasum -a 256) |
| jq | System | Parse deployment.json for address extraction | Already used in deploy-all.sh Phase 1.5 |
| git | System | Check staging area for keypairs | Already available |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| grep -r | Scan codebase for process.env references | One-time env var inventory |
| solana balance | Check deployer SOL balance | Preflight balance gate |

### Alternatives Considered

None -- all decisions are locked in CONTEXT.md.

## Architecture Patterns

### Env File Layout (From CONTEXT.md Decisions)

```
/                                    # Project root
├── .env.devnet                      # Root env -- committed (devnet is non-sensitive)
├── .env.mainnet                     # Root env -- gitignored (mainnet secrets)
├── app/
│   ├── .env.local                   # Local dev -- points to devnet (unchanged)
│   ├── .env.devnet                  # Frontend devnet env (Railway devnet service)
│   └── .env.mainnet                 # Frontend mainnet env (Railway mainnet service)
└── ~/mainnet-keys/
    └── deployer.json                # Mainnet deployer keypair (outside repo)
```

### Pattern 1: Complete Env Var Inventory

**What:** Automated grep of all `process.env.*` references across the codebase to build exhaustive .env.mainnet templates.
**When to use:** Before creating env files -- ensures nothing is missed.

Three distinct env var scopes exist in this project:

**Root .env.{cluster}** (sourced by deploy-all.sh, crank runner, scripts):
```bash
# Already in .env.devnet -- must mirror in .env.mainnet:
HELIUS_API_KEY=                      # Separate mainnet key
CLUSTER_URL=                         # Mainnet Helius RPC URL
COMMITMENT=finalized                 # Same for both
SOL_POOL_SEED_SOL_OVERRIDE=          # Mainnet seed amounts
SOL_POOL_SEED_TOKEN_OVERRIDE=        # Mainnet seed amounts
TREASURY_PUBKEY=                     # Mainnet treasury (multisig after Phase 97)
DEPLOYER_KEYPAIR=                    # Path: ~/mainnet-keys/deployer.json

# Crank-specific (from crank-provider.ts / crank-runner.ts):
WALLET_KEYPAIR=                      # JSON byte array for Railway (no file access)
WALLET=                              # Path fallback for local runs
CARNAGE_WSOL_PUBKEY=                 # Mainnet WSOL account for carnage
PDA_MANIFEST=                        # JSON string (Railway env var)
HEALTH_PORT=8080                     # Crank health check port
MIN_EPOCH_SLOTS_OVERRIDE=            # Optional: override epoch slot count
CRANK_LOW_BALANCE_SOL=               # Optional: low balance warning threshold

# Webhook management (from webhook-manage.ts):
WEBHOOK_URL=                         # Mainnet Railway webhook endpoint URL
HELIUS_WEBHOOK_SECRET=               # Mainnet webhook auth secret
```

**Frontend app/.env.{cluster}** (Railway service env vars):
```bash
# Server-side only (no NEXT_PUBLIC_ prefix):
DATABASE_URL=                        # Mainnet Postgres connection string
HELIUS_RPC_URL=                      # Mainnet Helius RPC (server-side API routes)
HELIUS_RPC_URL_FALLBACK=             # Optional fallback RPC
HELIUS_WEBHOOK_SECRET=               # Must match root env webhook secret
SENTRY_DSN=                          # Server-side Sentry DSN

# Client-side (NEXT_PUBLIC_ prefix, inlined at build time):
NEXT_PUBLIC_RPC_URL=                 # NOT USED (browser goes through /api/rpc)
NEXT_PUBLIC_SENTRY_DSN=              # Client-side Sentry DSN (same DSN, different tag)
NEXT_PUBLIC_CLUSTER=mainnet          # Cluster tag for Sentry + Solscan links
NEXT_PUBLIC_COMMIT_SHA=              # Auto-set by Railway (RAILWAY_GIT_COMMIT_SHA)
NEXT_PUBLIC_CURVE_PHASE=             # true during bonding curve launch
NEXT_PUBLIC_DEMO_MODE=false          # Must be false on mainnet
NEXT_PUBLIC_DOCS_URL=                # Production docs URL
```

### Pattern 2: Preflight as Pipeline Phase 0

**What:** Insert preflight checks before Phase 0 (mint keypairs) in deploy-all.sh. Current Phase 0 becomes Phase 1, etc.
**When to use:** Always -- runs automatically on every deploy, mainnet AND devnet.

The existing deploy-all.sh already has:
- Cluster argument validation (line 50-62)
- Toolchain version gate (line 72-93)
- Cluster URL cross-validation (line 123-147)
- Mainnet confirmation prompt (line 170-194)

Preflight adds four NEW checks after env sourcing, before any on-chain ops:

```bash
# Check 1: No keypairs in git staging
# Check 2: All required env vars present
# Check 3: Deployer balance >= minimum (mainnet only)
# Check 4: Binary hashes match expectations (mainnet only)
```

### Pattern 3: Binary Hash Verification

**What:** Compare SHA256 of compiled .so files against expected hashes stored in a manifest.
**When to use:** Mainnet deploys -- ensures the exact binaries you verified are the ones being deployed.

Two storage options (Claude's discretion per CONTEXT.md):
1. **Standalone hash file** (`deployments/binary-hashes.json`) -- simple, diffable, human-readable
2. **Field in deployment.json** -- centralized but mixes concerns

Recommendation: Standalone `deployments/expected-hashes.{cluster}.json` because:
- Can be generated independently of deployment.json
- Human can inspect and verify without parsing a large JSON
- Separate file per cluster prevents cross-contamination

Format:
```json
{
  "generated": "2026-03-12T10:00:00Z",
  "programs": {
    "amm": { "hash": "sha256:abc123...", "file": "target/deploy/amm.so" },
    "transfer_hook": { "hash": "sha256:def456...", "file": "target/deploy/transfer_hook.so" }
  }
}
```

### Anti-Patterns to Avoid

- **Single .env for both clusters:** The entire point of this phase is isolation. Never source .env without a cluster suffix.
- **Hardcoding mainnet values in code:** All cluster-specific values must come from env vars, never if/else in code.
- **Storing mainnet keypair in repo:** Even gitignored files can be accidentally committed. The keypair lives at `~/mainnet-keys/deployer.json` (outside repo entirely).
- **Optional preflight:** Preflight MUST be mandatory in the pipeline. A standalone script will be forgotten.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Keypair generation | Custom key derivation | `solana-keygen new` | Cryptographically sound, standard tool |
| SHA256 hashing | Node.js crypto script | `shasum -a 256` (macOS) | Zero dependencies, available everywhere |
| Git staging check | Custom file scanner | `git diff --cached --name-only` | Authoritative source of staged files |
| Env var presence check | Custom parser | Bash `[ -z "${VAR}" ]` pattern | Simple, readable, no dependencies |

## Common Pitfalls

### Pitfall 1: Incomplete Env Var Inventory
**What goes wrong:** Missing an env var in .env.mainnet. Deploy succeeds but feature silently breaks (e.g., missing CARNAGE_WSOL_PUBKEY causes crank crash on mainnet).
**Why it happens:** Building env file from memory instead of scanning code.
**How to avoid:** Automated `grep -roh 'process\.env\.\w\+' scripts/ app/` to find ALL references. Cross-reference against .env.mainnet template.
**Warning signs:** Any env var in code that doesn't appear in any .env file.

### Pitfall 2: macOS sha256sum vs shasum
**What goes wrong:** Script uses `sha256sum` which doesn't exist on macOS.
**Why it happens:** Linux assumption in bash scripts.
**How to avoid:** Use `shasum -a 256` on macOS. Check with `command -v sha256sum || command -v shasum`.
**Warning signs:** "command not found" on first macOS test.

### Pitfall 3: Deployer Keypair Path Not Absolute
**What goes wrong:** DEPLOYER_KEYPAIR=`./keypairs/deployer.json` resolves differently depending on working directory.
**Why it happens:** Relative paths in env vars.
**How to avoid:** Always use absolute path: `DEPLOYER_KEYPAIR=~/mainnet-keys/deployer.json`. Preflight should verify the file exists.
**Warning signs:** "File not found" errors when running from different directories.

### Pitfall 4: WALLET vs DEPLOYER_KEYPAIR Confusion
**What goes wrong:** deploy-all.sh currently defaults WALLET to `keypairs/devnet-wallet.json` (line 151). On mainnet, this means deploying with the devnet wallet if WALLET isn't overridden.
**Why it happens:** The WALLET env var default is hardcoded to devnet path.
**How to avoid:** On mainnet, WALLET must be set to `~/mainnet-keys/deployer.json` in .env.mainnet. Preflight must verify WALLET points to a mainnet-appropriate path (not containing "devnet").
**Warning signs:** Mainnet deploy using devnet wallet address.

### Pitfall 5: app/.env.mainnet Railway Integration
**What goes wrong:** Railway doesn't automatically pick up .env files. Env vars must be set in Railway's service settings.
**Why it happens:** Assuming Railway reads .env files like local dev.
**How to avoid:** The app/.env.mainnet file is a REFERENCE TEMPLATE for what to set in Railway's env var dashboard. Document this clearly.
**Warning signs:** Frontend works locally but not on Railway deployment.

### Pitfall 6: Sentry DSN Is Shared, Environment Tag Is Not
**What goes wrong:** Using separate Sentry projects means losing correlation between devnet and mainnet errors.
**Why it happens:** Over-isolating Sentry.
**How to avoid:** Per CONTEXT.md: same Sentry project, environment tag ("devnet" vs "mainnet"). The zero-dep sentry.ts already reads `NEXT_PUBLIC_CLUSTER` for the cluster tag and `NODE_ENV` for environment. Set `NEXT_PUBLIC_CLUSTER=mainnet` in app/.env.mainnet.
**Warning signs:** Creating unnecessary separate Sentry projects.

## Code Examples

### Wallet Generation
```bash
# Generate mainnet deployer wallet
# --no-bip39-passphrase: No passphrase prompt (seed phrase alone is sufficient)
# Write seed phrase on paper IMMEDIATELY
mkdir -p ~/mainnet-keys
solana-keygen new --no-bip39-passphrase -o ~/mainnet-keys/deployer.json
# Record the pubkey
solana-keygen pubkey ~/mainnet-keys/deployer.json
```

### Git Staging Keypair Check
```bash
# Check for keypair-like files in git staging area
# Catches: .json files in keypairs/, any file matching keypair patterns
STAGED_KEYPAIRS=$(git diff --cached --name-only 2>/dev/null | grep -E '(keypair|\.json$)' | grep -iE '(keypair|wallet|mint|deployer|mainnet)' || true)
if [ -n "$STAGED_KEYPAIRS" ]; then
  echo "!!! PREFLIGHT FAILED: Keypair files staged for commit !!!"
  echo ""
  echo "  Files detected:"
  echo "$STAGED_KEYPAIRS" | sed 's/^/    /'
  echo ""
  echo "  Run: git reset HEAD <file> to unstage"
  exit 1
fi
```

### Required Env Var Check
```bash
# Check all required env vars are present and non-empty
REQUIRED_VARS="HELIUS_API_KEY CLUSTER_URL COMMITMENT"
if [ "$CLUSTER" = "mainnet" ]; then
  REQUIRED_VARS="$REQUIRED_VARS DEPLOYER_KEYPAIR TREASURY_PUBKEY"
fi

MISSING=""
for VAR in $REQUIRED_VARS; do
  eval VAL="\${${VAR}:-}"
  if [ -z "$VAL" ]; then
    MISSING="$MISSING $VAR"
  fi
  # Also catch unset placeholders
  if [ "$VAL" = "CHANGE_ME_MAINNET" ] || [ "$VAL" = "CHANGE_ME" ]; then
    MISSING="$MISSING $VAR (still placeholder)"
  fi
done

if [ -n "$MISSING" ]; then
  echo "!!! PREFLIGHT FAILED: Missing required env vars !!!"
  echo "  Missing:$MISSING"
  exit 1
fi
```

### Binary Hash Generation and Verification
```bash
# Generate hashes after a verified build
generate_hashes() {
  local HASH_FILE="deployments/expected-hashes.${CLUSTER}.json"
  echo "{" > "$HASH_FILE"
  echo '  "generated": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",' >> "$HASH_FILE"
  echo '  "programs": {' >> "$HASH_FILE"
  local FIRST=true
  for SO in target/deploy/*.so; do
    local NAME=$(basename "$SO" .so)
    local HASH=$(shasum -a 256 "$SO" | cut -d' ' -f1)
    [ "$FIRST" = true ] || echo "," >> "$HASH_FILE"
    FIRST=false
    printf '    "%s": "%s"' "$NAME" "$HASH" >> "$HASH_FILE"
  done
  echo "" >> "$HASH_FILE"
  echo "  }" >> "$HASH_FILE"
  echo "}" >> "$HASH_FILE"
}

# Verify hashes before deploy
verify_hashes() {
  local HASH_FILE="deployments/expected-hashes.${CLUSTER}.json"
  if [ ! -f "$HASH_FILE" ]; then
    echo "!!! PREFLIGHT FAILED: No expected hashes file !!!"
    echo "  Generate with: ./scripts/deploy/generate-hashes.sh $CLUSTER"
    exit 1
  fi
  # Compare each .so against expected hash
  for SO in target/deploy/*.so; do
    local NAME=$(basename "$SO" .so)
    local ACTUAL=$(shasum -a 256 "$SO" | cut -d' ' -f1)
    local EXPECTED=$(jq -r ".programs.\"$NAME\"" "$HASH_FILE")
    if [ "$EXPECTED" = "null" ]; then
      echo "  WARNING: No expected hash for $NAME -- skipping"
      continue
    fi
    if [ "$ACTUAL" != "$EXPECTED" ]; then
      echo "!!! PREFLIGHT FAILED: Binary hash mismatch !!!"
      echo "  Program:  $NAME"
      echo "  Expected: $EXPECTED"
      echo "  Actual:   $ACTUAL"
      echo ""
      echo "  Did you rebuild after your last code change?"
      exit 1
    fi
  done
  echo "  All binary hashes match. OK."
}
```

### Deployer Balance Check
```bash
# Check deployer has sufficient SOL (mainnet only)
if [ "$CLUSTER" = "mainnet" ]; then
  DEPLOYER_BALANCE_RAW=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)?')
  # MAINNET_MIN_BALANCE set by Phase 98 -- use placeholder until then
  MIN_BALANCE="${MAINNET_MIN_BALANCE:-10}"
  if [ "$(echo "$DEPLOYER_BALANCE_RAW < $MIN_BALANCE" | bc)" -eq 1 ]; then
    echo "!!! PREFLIGHT FAILED: Insufficient deployer balance !!!"
    echo "  Current:  ${DEPLOYER_BALANCE_RAW} SOL"
    echo "  Required: ${MIN_BALANCE} SOL (MAINNET_MIN_BALANCE)"
    exit 1
  fi
fi
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single .env file | .env.{cluster} files | Phase 91 | Already implemented, this phase fills in mainnet values |
| Manual env var tracking | Automated codebase grep | Phase 92 | Catches forgotten env vars |
| No preflight | Pipeline-integrated preflight | Phase 92 | Prevents dangerous deploy mistakes |
| Devnet wallet for everything | Separate mainnet deployer | Phase 92 | Clean credential isolation |

## Open Questions

1. **MAINNET_MIN_BALANCE value**
   - What we know: Phase 98 calculates exact SOL budget with line items
   - What's unclear: Exact amount until Phase 98 completes
   - Recommendation: Use placeholder (10 SOL) in .env.mainnet, update after Phase 98

2. **Railway mainnet service creation**
   - What we know: Separate Railway service needed for mainnet frontend
   - What's unclear: Whether to create it now or during Phase 95/96 (lifecycle test)
   - Recommendation: Document what needs to be set in Railway, but actual service creation can wait until needed. The .env.mainnet file serves as the reference template.

3. **Helius mainnet API key creation**
   - What we know: Same Helius account, new separate key
   - What's unclear: Whether to create the key now or defer until Phase 98
   - Recommendation: Create placeholder in .env.mainnet with CHANGE_ME. Actual key creation is a manual Helius dashboard action before mainnet deploy.

## Codebase-Specific Findings

### Existing deploy-all.sh Phase Numbering
Current phases in deploy-all.sh:
- Phase 0: Mint keypairs
- Phase 1: Build
- Phase 1.5: Binary address verification (mainnet only)
- Phase 2: Deploy
- Phase 3: Initialize
- Phase 4: Generate constants
- Phase 5: Create/extend ALT
- Phase 6: Verify

Preflight should become a new "Phase -1" or "Preflight" section that runs BEFORE the existing Phase 0. This avoids renumbering all existing phases (which would break documentation references). The CONTEXT.md says "preflight becomes new Phase 0, existing phases shift" -- but shifting 7 phases is disruptive. Alternative: label it "Preflight" (unnumbered) before Phase 0.

### WALLET Env Var Default (Critical)
Line 151 of deploy-all.sh: `export WALLET="${WALLET:-keypairs/devnet-wallet.json}"`

On mainnet, this MUST be overridden by .env.mainnet setting WALLET to the mainnet deployer path. The preflight should verify that on mainnet, WALLET does NOT contain "devnet".

### Crank Runner Env Vars on Railway
The crank runner on Railway uses `WALLET_KEYPAIR` (JSON byte array string) instead of a file path. For mainnet, a SEPARATE Railway service or env var set is needed. The mainnet crank wallet must be different from the deployer wallet (defense in depth -- crank wallet only needs SOL for transaction fees, not the full deploy budget).

### Frontend Env Vars NOT in .env Files
Railway injects some env vars automatically:
- `RAILWAY_GIT_COMMIT_SHA` (used by sentry.ts for release tracking)
- `NODE_ENV=production` (set by Railway)
- `PORT` (Railway assigns dynamically)

These don't need to be in .env files but should be documented.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- Direct grep of all process.env references across scripts/ and app/
- **deploy-all.sh** -- Read line-by-line, all existing patterns documented
- **.env.devnet / .env.mainnet** -- Current state verified
- **sentry.ts** -- Confirmed environment tag support via NEXT_PUBLIC_CLUSTER
- **crank-provider.ts / crank-runner.ts** -- All env var references catalogued
- **webhook route.ts** -- HELIUS_WEBHOOK_SECRET usage confirmed

### Secondary (MEDIUM confidence)
- **Railway env var behavior** -- Based on project team's existing Railway deployment experience (documented in MEMORY.md)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new tools, all existing CLI utilities
- Architecture: HIGH -- patterns directly from CONTEXT.md decisions and codebase analysis
- Pitfalls: HIGH -- derived from actual code inspection (WALLET default, shasum vs sha256sum, Railway behavior)
- Env var inventory: HIGH -- grep-verified against actual codebase

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable infrastructure, no fast-moving dependencies)
