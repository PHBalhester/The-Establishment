# Phase 104: Open Source Release and OtterSec Verification - Research

**Researched:** 2026-03-25
**Domain:** Open source release preparation, secret sanitization, Solana verified builds / OtterSec verification
**Confidence:** HIGH

## Summary

This phase has three distinct technical domains: (1) curated repo creation with military-grade secret sanitization, (2) audit report curation into a public-facing summary, and (3) OtterSec verified build submission for all 6 active mainnet programs. The project already has the CI-built verified binaries (Phase 101) and on-chain IDLs -- the main remaining work is creating the public repo as a prerequisite for OtterSec submission.

The solana-verify CLI (v0.4.12) handles verification through a well-documented workflow: `verify-from-repo` uploads a PDA containing the repo URL + commit hash on-chain, then `remote submit-job` triggers OtterSec's remote builder which independently clones the public repo, builds, and compares hashes. The project's existing Anchor workspace with 7 programs is fully compatible -- each program is verified independently using `--library-name` and the workspace root as `--mount-path`. The key prerequisite is a **public GitHub repo** -- OtterSec's infrastructure must be able to clone it.

Secret sanitization is the highest-risk task. The private repo contains real API keys (Helius, Supermemory), Solana private keys (in `.mcp.json`, `.env`, `.env.devnet`, `.env.mainnet`), 35+ keypair files, signer identities, and RPC URLs with embedded API keys in deploy logs and scripts. The fresh-repo approach (zero git history) eliminates history-based leaks, but every file being copied must be scanned. Gitleaks is the recommended automated tool, supplemented by manual passes targeting Solana-specific patterns (base58 keys, JSON arrays of 64 integers).

**Primary recommendation:** Create the public repo with a strict .gitignore, automate scanning with gitleaks, then perform 5 manual verification passes before the initial commit. Submit OtterSec verification for all 6 programs immediately after the repo goes public.

## Standard Stack

The established tools for this domain:

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| solana-verify | 0.4.12 | Deterministic builds + OtterSec verification | Official Solana ecosystem tool by Ellipsis Labs |
| gitleaks | latest | Automated secret detection in files | Standard OSS secret scanner, fast, configurable |
| gh CLI | latest | GitHub repo creation and management | Official GitHub CLI |
| git | latest | Fresh repo creation, curated initial commit | Standard |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| trufflehog | latest | Deep secret verification (validates if secrets are active) | Optional second pass after gitleaks |
| Docker | latest | Required for `solana-verify build` deterministic containers | OtterSec verification step |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| gitleaks | trufflehog | Trufflehog verifies if secrets are active but slower; gitleaks better for pre-commit scanning of staged files |
| Manual sanitization only | Automated only | Both are insufficient alone -- need automated scanning PLUS manual passes for Solana-specific patterns |

**Installation:**
```bash
# gitleaks (macOS)
brew install gitleaks

# solana-verify (already installed from Phase 101)
cargo install solana-verify

# gh CLI (likely already installed)
brew install gh
```

## Architecture Patterns

### Public Repo Structure (Recommended)
```
drfraudsworth/
├── programs/               # All 7 Anchor programs (including test/mock programs)
│   ├── amm/
│   ├── transfer-hook/
│   ├── tax-program/
│   ├── epoch-program/
│   ├── staking/
│   ├── conversion-vault/
│   └── bonding_curve/
├── app/                    # Next.js frontend
├── docs-site/              # Nextra documentation site
├── scripts/                # Deploy, crank, graduation, test scripts
│   ├── deploy/
│   ├── crank/
│   ├── graduation/
│   ├── test/
│   ├── e2e/
│   └── vrf/
├── shared/                 # TypeScript shared constants
├── tests/                  # Anchor test suites
├── deployments/            # On-chain addresses (public data)
│   ├── mainnet.json
│   └── devnet.json
├── .audit/                 # SOS audit (AI-assisted)
├── .bulwark/               # Bulwark audit (AI-assisted)
├── .bok/                   # BOK formal verification
│   ├── invariants/
│   ├── confirmed-invariants/
│   ├── reports/
│   ├── *.sh                # Runner scripts
│   └── (NO results/)      # Exclude 21MB raw Kani output
├── .audit-history/         # Historical audit snapshots
├── .bulwark-history/       # Historical bulwark snapshots
├── .planning/              # 104 phases of build journey
├── .github/                # CI workflows
│   └── workflows/
│       ├── ci.yml
│       └── verified-build.yml
├── Docs/                   # Protocol specs and documentation
├── Cargo.toml              # Workspace root
├── Cargo.lock              # Locked dependencies (REQUIRED for verified builds)
├── Anchor.toml             # Anchor configuration
├── package.json            # Node dependencies
├── package-lock.json       # Locked npm deps
├── rust-toolchain.toml     # Pinned Rust version
├── LICENSE                 # MIT license
├── README.md               # Comprehensive project overview
├── SECURITY_AUDIT_SUMMARY.md  # Curated audit findings summary
├── .gitignore              # STRICT exclusion rules
└── .env.example            # Template with placeholder values
```

### Pattern 1: Fresh Repo with Curated Copy
**What:** Create an empty GitHub repo, locally assemble the curated file tree, push a single initial commit.
**When to use:** When the existing repo has secrets in git history that cannot be safely removed.
**Why this pattern:** The private repo has 1,979 commits with real keypairs, API keys, and private keys scattered throughout history. `git filter-branch` or BFG Repo-Cleaner cannot guarantee complete removal. A fresh repo with zero history is the only safe approach.

**Workflow:**
```bash
# 1. Create empty repo on GitHub
gh repo create MetalLegBob/drfraudsworth --public --license mit

# 2. Clone it locally
git clone https://github.com/MetalLegBob/drfraudsworth.git /tmp/drfraudsworth-public

# 3. Copy files from private repo (curated list)
# Use rsync with explicit include/exclude rules
rsync -av --exclude-from=sanitize-exclude.txt \
  "/Users/mlbob/Projects/Dr Fraudsworth/" /tmp/drfraudsworth-public/

# 4. Run gitleaks scan on the assembled directory
gitleaks detect --source /tmp/drfraudsworth-public --no-git -v

# 5. Manual verification passes (5 consecutive clean)
# 6. Single initial commit
cd /tmp/drfraudsworth-public
git add -A
git commit -m "Initial open source release - Dr. Fraudsworth's Finance Factory"
git push origin main
```

### Pattern 2: OtterSec Verification for Anchor Workspace
**What:** Submit each of the 6 active mainnet programs for verified build badge on Solana explorers.
**When to use:** After the public repo is live with the correct source code at a tagged commit.

**Per-program workflow:**
```bash
# For each program (6 total):
solana-verify verify-from-repo \
  -u https://api.mainnet-beta.solana.com \
  --program-id <PROGRAM_ID> \
  https://github.com/MetalLegBob/drfraudsworth \
  --commit-hash <INITIAL_COMMIT_HASH> \
  --library-name <LIBRARY_NAME> \
  --mount-path .

# When prompted to upload PDA on-chain, select YES
# Cost: small rent per PDA (~0.002 SOL per program)

# Then trigger remote verification:
solana-verify remote submit-job \
  --program-id <PROGRAM_ID> \
  --uploader <DEPLOYER_PUBKEY>
```

**Library names for this project** (must match what produces the .so filename):
| Program | Library Name | Program ID |
|---------|-------------|------------|
| AMM | `amm` | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` |
| Transfer Hook | `transfer_hook` | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` |
| Tax Program | `tax_program` | `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj` |
| Epoch Program | `epoch_program` | `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2` |
| Staking | `staking` | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` |
| Conversion Vault | `conversion_vault` | `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` |

**NOT verified:** Bonding Curve (program account closed after graduation, rent reclaimed).

**Critical: Mainnet programs were NOT built with `--features devnet`.** The default (no features) produces mainnet binaries. OtterSec's remote builder must build WITHOUT feature flags.

### Pattern 3: Strict .gitignore for Public Repo
**What:** Comprehensive .gitignore that prevents accidental secret commits.
**Why:** The public repo's .gitignore must be MORE restrictive than the private repo's.

```gitignore
# === SECRETS (NEVER COMMIT) ===
.env
.env.*
!.env.example
keypairs/
mint-keypairs/
*.json.burned
*.json.bak
stress-keypairs.json

# === MCP/Claude config (may contain API keys) ===
.mcp.json
.claude/settings.local.json

# === Build artifacts ===
target/
.anchor/
node_modules/
dist/
.next/
app/.next/

# === Test artifacts ===
test-ledger/
scripts/e2e/*.jsonl
scripts/e2e/*.log
.bok/results/
.bok/worktree/

# === Generated deploy artifacts ===
scripts/deploy/deploy-log-*.txt
scripts/deploy/pda-manifest.json
scripts/deploy/pda-manifest.md
scripts/deploy/mint-keypairs/
scripts/deploy/alt-address.json

# === OS files ===
.DS_Store
*.swp

# === Large assets ===
WebsiteAssets/
ci-artifacts/
```

### Anti-Patterns to Avoid
- **Copying .git directory:** Never copy the private repo's .git -- that IS the git history containing secrets
- **Using `git filter-branch` on existing repo:** Cannot guarantee all secrets are removed from all refs, tags, and stash entries
- **Trusting .gitignore alone:** .gitignore only prevents future commits; existing tracked files need explicit exclusion during the curated copy
- **Automating the copy without review:** Every file must be at minimum gitleaks-scanned; sensitive directories need manual review
- **Adding `source_code` to security_txt! and redeploying:** This would change binary hashes and break OtterSec verification. The public repo URL is available on explorer via the PDA metadata -- no need to embed in the binary

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret detection | grep/regex patterns | gitleaks | 800+ built-in rules, handles Base64, JWT, UUID patterns, Solana-aware rules possible via custom config |
| Verified builds | Manual Docker builds | solana-verify CLI | Deterministic container environment, PDA upload, remote API integration |
| License file | Write from scratch | GitHub license templates | MIT license text is standardized; GitHub auto-generates with correct formatting |
| Repo creation | GitHub web UI | `gh repo create` | Scriptable, consistent, can set visibility/license in one command |
| Secret rotation detection | Manual checking | trufflehog (optional) | Verifies if detected secrets are still active/valid |

**Key insight:** The "military-grade" sanitization requirement means automated tools are necessary but NOT sufficient. Gitleaks catches standard patterns, but Solana-specific secrets (64-integer JSON arrays, base58 private keys, PDA seeds) may require custom gitleaks rules or manual passes.

## Common Pitfalls

### Pitfall 1: Solana Keypair JSON Arrays Not Detected by Default
**What goes wrong:** Gitleaks default rules may not flag Solana keypair files (arrays of 64 integers like `[128,45,...]`)
**Why it happens:** Keypair format is non-standard -- not base64, not hex, just a JSON number array
**How to avoid:** Add custom gitleaks rule targeting JSON arrays of 64+ integers. Also manually verify no `keypairs/` directory or `*.json` files containing number arrays survive the copy.
**Warning signs:** Any `.json` file with an array of 64+ numbers in the 0-255 range

### Pitfall 2: RPC URLs with Embedded API Keys in Deploy Logs
**What goes wrong:** `scripts/deploy/deploy-log-*.txt` files contain full Helius RPC URLs with API keys
**Why it happens:** Deploy scripts log the RPC URL for debugging
**How to avoid:** Exclude ALL deploy log files from the public repo. The .gitignore already has `deploy-log-*.txt` but these files exist in the private repo and must not be copied.
**Warning signs:** Any URL containing `?api-key=` or `helius-rpc.com`

### Pitfall 3: .mcp.json Contains Private Keys
**What goes wrong:** The `.mcp.json` in the repo root contains a Solana private key in the `SOLANA_PRIVATE_KEY` env var for the solana-mcp tool
**Why it happens:** MCP server configuration stored in project root
**How to avoid:** Exclude `.mcp.json` from the public repo entirely. Also exclude `.claude/settings.local.json` which may contain user-specific configs.
**Warning signs:** Any JSON with "PRIVATE_KEY" or "SECRET" field names

### Pitfall 4: .env Files Contain Real API Keys and Secrets
**What goes wrong:** `.env`, `.env.devnet`, `.env.mainnet` all contain real Helius API keys, webhook secrets, and RPC URLs
**Why it happens:** Standard development pattern, but these are not gitignored in the current .gitignore (`.env.devnet` is tracked!)
**How to avoid:** Create `.env.example` with placeholder values. Exclude ALL `.env*` files except `.env.example`.
**Warning signs:** `.env.devnet` appears in git status as a tracked file

### Pitfall 5: Binary Hash Mismatch After Repo Modifications
**What goes wrong:** OtterSec verification fails because the public repo produces different binaries than what's deployed on mainnet
**Why it happens:** Even whitespace changes in Cargo.toml, adding files to workspace members, or changing rust-toolchain.toml can change compilation output
**How to avoid:** The public repo must contain EXACTLY the same Rust source code, Cargo.toml, Cargo.lock, and rust-toolchain.toml as the private repo at the commit that produced the deployed mainnet binaries. Verify by running `solana-verify build --library-name <name>` locally before submitting.
**Warning signs:** `solana-verify get-executable-hash` on local build doesn't match `solana-verify get-program-hash` on mainnet

### Pitfall 6: Governance Doc Reveals Operational Security Details
**What goes wrong:** The mainnet-governance.md contains signer setup procedures, emergency hotfix timelines, and operational details that help attackers
**Why it happens:** The document was written for internal operational use
**How to avoid:** Create a sanitized version that includes governance STRUCTURE (vault address, timelock config, authority assignments, burn philosophy) but strips: signer wallet types/locations, emergency procedure timelines, exact hotfix response times, and anything that helps time governance operations.
**Warning signs:** References to "Signer 1/2/3", specific device locations, "20 minutes total" hotfix timeline

### Pitfall 7: Anchor.toml References Private Keypair Paths
**What goes wrong:** `Anchor.toml` has `wallet = "keypairs/devnet-wallet.json"` which references a file that won't exist in the public repo
**Why it happens:** Standard Anchor config points to local wallet file
**How to avoid:** Update `Anchor.toml` to use a generic path like `~/.config/solana/id.json` or note in README that wallet path needs configuration
**Warning signs:** `wallet =` pointing to a path inside `keypairs/`

### Pitfall 8: Forgetting Squads Signer Keypairs in Obscure Locations
**What goes wrong:** `keypairs/squads-signer-{1,2,3}.json` and `keypairs/squads-create-key.json` leak multisig signer identities
**Why it happens:** Test keypairs stored alongside program keypairs
**How to avoid:** The entire `keypairs/` directory is excluded, but also scan for any `.json` file anywhere that contains keypair arrays
**Warning signs:** Any reference to `squads-signer`, `create-key`, or keypair paths outside `keypairs/`

### Pitfall 9: Graduation State File Contains Operational Data
**What goes wrong:** `scripts/graduation/graduation-state.json` contains operational timestamps and state
**Why it happens:** Runtime state stored alongside scripts
**How to avoid:** Exclude this file. It's already in the git untracked list.
**Warning signs:** Any `*-state.json` file in scripts/

### Pitfall 10: OtterSec PDA Upload Requires Deployer Wallet as Signer
**What goes wrong:** The `verify-from-repo` command needs a signer that matches the program's upgrade authority
**Why it happens:** OtterSec verification trusts PDAs signed by the program authority
**How to avoid:** The deployer wallet (`23g7x...`) still holds the mainnet deployer keypair. However, upgrade authority was transferred to Squads vault. Check whether the PDA upload needs the CURRENT authority or the original deployer. May need to use `export-pda-tx` and submit through Squads.
**Warning signs:** "Authority mismatch" errors during PDA upload

## Code Examples

### Gitleaks Custom Config for Solana Projects
```toml
# .gitleaks.toml - Custom rules for Solana project sanitization
title = "Dr. Fraudsworth Sanitization Rules"

# Standard rules are included by default
# Add Solana-specific patterns:

[[rules]]
id = "solana-keypair-json-array"
description = "Solana keypair as JSON integer array"
regex = '''\[\s*\d{1,3}(\s*,\s*\d{1,3}){60,}\s*\]'''
tags = ["solana", "keypair"]

[[rules]]
id = "solana-base58-private-key"
description = "Solana base58 private key (88 chars)"
regex = '''[1-9A-HJ-NP-Za-km-z]{87,88}'''
tags = ["solana", "private-key"]
# Note: high false positive rate, use for manual review triggers

[[rules]]
id = "helius-api-key"
description = "Helius API key in URL"
regex = '''helius-rpc\.com/?\?api-key=[a-f0-9-]{36}'''
tags = ["api-key", "helius"]

[[rules]]
id = "helius-api-key-standalone"
description = "Helius API key value"
regex = '''HELIUS_API_KEY\s*=\s*[a-f0-9-]{36}'''
tags = ["api-key", "helius"]

# Allowlist paths that are expected to have key-like content
[allowlist]
paths = [
  '''deployments/.*\.json''',  # On-chain addresses (public)
  '''\.planning/.*'''          # Planning docs may reference addresses
]
```

### .env.example Template
```bash
# =============================================================================
# Dr. Fraudsworth Environment Configuration
# Copy this file to .env.devnet or .env.mainnet and fill in values
# =============================================================================

# Helius RPC Configuration
# Get API key from: https://dashboard.helius.dev
HELIUS_API_KEY=your-helius-api-key-here
CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=your-helius-api-key-here
COMMITMENT=finalized

# Token Metadata URIs (Arweave permanent storage)
CRIME_METADATA_URI=https://gateway.irys.xyz/your-crime-metadata-id
FRAUD_METADATA_URI=https://gateway.irys.xyz/your-fraud-metadata-id
PROFIT_METADATA_URI=https://gateway.irys.xyz/your-profit-metadata-id

# Pool Seed Liquidity (required for non-localhost clusters)
SOL_POOL_SEED_SOL_OVERRIDE=2500000000
SOL_POOL_SEED_TOKEN_OVERRIDE=290000000000000

# Sentry Error Tracking
SENTRY_DSN=https://your-key@o123.ingest.us.sentry.io/your-project-id

# Helius Webhook (for on-chain event processing)
HELIUS_WEBHOOK_SECRET=your-webhook-secret-here

# Squads Governance
SQUADS_TIMELOCK_SECONDS=900

# Wallet path (point to your deployer keypair)
WALLET=~/.config/solana/id.json
```

### OtterSec Verification Script
```bash
#!/usr/bin/env bash
# verify-ottersec.sh - Submit all 6 programs for OtterSec verification
# Run AFTER the public repo is live with the correct source code

set -euo pipefail

REPO_URL="https://github.com/MetalLegBob/drfraudsworth"
COMMIT_HASH="$1"  # Pass the initial commit hash
RPC_URL="https://api.mainnet-beta.solana.com"
DEPLOYER_PUBKEY="23g7xmrtXA6LSWopQcAUgiptGUArSLEMakBKcY1S59YR"

# Programs to verify (bonding_curve excluded - account closed)
declare -A PROGRAMS=(
  ["amm"]="5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
  ["transfer_hook"]="CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd"
  ["tax_program"]="43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"
  ["epoch_program"]="4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2"
  ["staking"]="12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"
  ["conversion_vault"]="5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ"
)

for lib in "${!PROGRAMS[@]}"; do
  program_id="${PROGRAMS[$lib]}"
  echo "=== Verifying $lib ($program_id) ==="

  # Step 1: Upload PDA on-chain (interactive - asks for confirmation)
  solana-verify verify-from-repo \
    -u "$RPC_URL" \
    --program-id "$program_id" \
    "$REPO_URL" \
    --commit-hash "$COMMIT_HASH" \
    --library-name "$lib" \
    --mount-path .

  # Step 2: Trigger remote verification
  solana-verify remote submit-job \
    --program-id "$program_id" \
    --uploader "$DEPLOYER_PUBKEY"

  echo "=== $lib submitted ==="
  echo ""
done

echo "All 6 programs submitted. Check status at:"
for lib in "${!PROGRAMS[@]}"; do
  echo "  https://verify.osec.io/status/${PROGRAMS[$lib]}"
done
```

### MIT License Text
```
MIT License

Copyright (c) 2026 Dr. Fraudsworth

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| solana-verifiable-build (Ellipsis Labs only) | solana-verify CLI (unified tool) | 2024-2025 | Single CLI for build + verify + remote submit |
| Manual OtterSec submission | `solana-verify remote submit-job` | 2024 | Automated API submission, no manual coordination |
| OtterSec-only verification | Multi-signer trust model | 2025 | Explorer accepts PDAs from program authority OR trusted signers (OtterSec, Explorer) |
| BFG Repo-Cleaner for history sanitization | Fresh repo approach | Always recommended | Only guaranteed way to remove all secrets from git history |

**Deprecated/outdated:**
- `solana-verifiable-build` crate name: now `solana-verify` (v0.4.12)
- Manual hash comparison: PDA-based verification is the standard now
- OtterSec-only verification: Solana Explorer now has its own trusted signer system alongside OtterSec

## Specific Findings: Secret Inventory

Complete inventory of sensitive files/patterns found in the private repo that MUST NOT appear in the public repo:

### Files to Exclude Entirely
| Path | Type | Risk |
|------|------|------|
| `keypairs/` (entire directory, 35+ files) | Solana keypairs | CRITICAL - mainnet program keys, mint keys, Squads signers |
| `.env` | API keys | CRITICAL - real Helius API key, Supermemory key |
| `.env.devnet` | API keys | CRITICAL - real Helius devnet API key |
| `.env.mainnet` | API keys | CRITICAL - real Helius mainnet API key, webhook secrets |
| `.mcp.json` | Private key | CRITICAL - contains Solana private key in base58 |
| `.claude/settings.local.json` | User config | LOW - may contain personal paths |
| `scripts/e2e/stress-keypairs.json` | Keypairs | HIGH - test keypairs |
| `scripts/graduation/graduation-state.json` | Operational state | LOW |
| `scripts/graduation/graduation-state.json.devnet-backup` | Operational state | LOW |
| `scripts/deploy/deploy-log-*.txt` | RPC URLs with API keys | HIGH |
| `scripts/deploy/pda-manifest.json` | May contain sensitive data | MEDIUM |
| `scripts/deploy/pda-manifest.md` | May contain sensitive data | MEDIUM |
| `scripts/deploy/alt-address.json` | Devnet ALT address | LOW - but exclude for cleanliness |
| `.bok/results/` | 21MB raw Kani output | LOW (no secrets, just large) |
| `.bok/worktree/` | Build artifacts | LOW |
| `ci-artifacts/` | CI build outputs | LOW |
| `WebsiteAssets/` | Original unoptimized PNGs | LOW (large files) |
| `Dr Fraudsworth` (symlink) | Self-referencing symlink | LOW - causes issues |
| `Dr Fraudsworth.code-workspace` | VS Code workspace | LOW |
| `WIP Components/` | Work in progress | LOW |
| `Components/` | Old components | LOW |
| `test-ledger/` | Local validator state | HIGH - contains keypairs |

### Files to Sanitize (Include Modified Version)
| Path | What to Strip | What to Keep |
|------|--------------|--------------|
| `Docs/mainnet-governance.md` | Signer wallet types/locations, emergency timelines, hotfix response times, Signer 1/2/3 details | Governance structure, vault address, timelock config, burn philosophy, verification commands |
| `Anchor.toml` | `wallet = "keypairs/devnet-wallet.json"` | Change to `wallet = "~/.config/solana/id.json"` |
| `CLAUDE.md` | May contain personal paths, development-specific instructions | Consider whether to include at all -- it shows the AI-assisted development methodology |
| `.planning/STATE.md` | May reference internal operational details | Review and sanitize |

### Patterns to Search For (Manual Pass Targets)
| Pattern | Where Found | Why Dangerous |
|---------|-------------|---------------|
| JSON arrays of 64+ integers (0-255) | Any `.json` file | Solana keypair format |
| Base58 strings 87-88 chars | `.mcp.json`, scripts | Solana private key format |
| `helius-rpc.com/?api-key=` | Deploy logs, scripts, configs | Leaks API key |
| `HELIUS_API_KEY=` with real value | `.env*` files | Leaks API key |
| `SOLANA_PRIVATE_KEY=` | `.mcp.json` | Leaks private key |
| `api-key=` with UUID format | Script comments, logs | Leaks API key |
| `webhook-secret` / `HELIUS_WEBHOOK_SECRET` | `.env*` files | Leaks webhook auth |
| `SUPERMEMORY_CC_API_KEY` | `.env` | Leaks third-party API key |

## Specific Findings: OtterSec Verification

### PDA Upload Authority Question
**Critical uncertainty:** The `verify-from-repo` command creates a PDA that must be signed by the program's authority. However, mainnet program upgrade authorities have been transferred to the Squads vault PDA. Two possible scenarios:

1. **The deployer wallet can still sign the PDA** -- the PDA signer doesn't need to be the current upgrade authority, just the wallet that pays for the PDA rent. This would be the simplest path.
2. **The current authority (Squads vault) must sign** -- in this case, use `solana-verify export-pda-tx` to create the transaction, then submit through Squads multisig.

**Confidence: MEDIUM** -- The Solana docs mention "upgrade authority" as the signer but the Explorer also accepts "trusted signers." Need to test this during execution.

**Recommended approach:** Try with the deployer wallet first. If it fails with authority mismatch, fall back to the `export-pda-tx` + Squads multisig flow.

### Remote Verification Timeline
- Simple programs: 1-5 minutes
- Complex programs (like this workspace): up to 30 minutes per program
- OtterSec re-verifies every 24 hours automatically
- Badge appears on Solana Explorer, SolanaFM, and SolScan after successful verification

### Verification Cost
- PDA upload: ~0.002 SOL per program (6 programs = ~0.012 SOL total)
- Remote submission: free (API rate limited to 1 per 30 seconds per IP)
- Total estimated cost: ~0.012 SOL

### Verified Badge Display
Once verified, explorers show:
- Green "Program Source Verified" badge
- Repository URL (links to public repo)
- Commit hash
- Build command used
- Signer information
- Last verified timestamp
- On-chain and executable hash values

## Specific Findings: Audit Report Curation

### Existing Audit Directories
| Directory | Audit Type | Files | Notes |
|-----------|-----------|-------|-------|
| `.audit/` | SOS (Stronghold of Security) - AI-assisted | ~65 findings (H001-H065), 10 suggestions (S001-S010), context docs, index, strategies | Comprehensive on-chain program audit |
| `.bulwark/` | Bulwark - AI-assisted | ~132 findings (H001-H132), 10 suggestions (S001-S010), context docs, verification report | Full-stack security audit including off-chain |
| `.bok/` | BOK (Book of Knowledge) - Formal verification | Invariants, Kani proofs, proptest, LiteSVM | Mathematical correctness proofs |
| `.audit-history/` | Historical SOS snapshots | 2 snapshots (Feb, Mar) | Shows audit progression |
| `.bulwark-history/` | Historical Bulwark snapshot | 1 snapshot (Mar) | Shows audit progression |
| `Docs/VULNHUNTER-AUDIT-2026-03-05.md` | VulnHunter analysis | 1 file | Additional automated analysis |
| `Docs/vulnhunter-report-2026-03-12.md` | VulnHunter v2 analysis | 1 file | Updated automated analysis |

### SECURITY_AUDIT_SUMMARY.md Structure
The curated summary should:
1. **Label methodology clearly:** "AI-Assisted Internal Audit" -- transparent about tooling
2. **Categorize by severity:** Critical, High, Medium, Low, Informational
3. **Show resolution status:** Fixed (with commit/version), Acknowledged (with justification), Won't Fix (with risk assessment)
4. **Explain non-exploitable findings:** For acknowledged findings that are theoretically possible but practically non-exploitable, provide clear reasoning
5. **Reference raw audit directories:** Point to `.audit/`, `.bulwark/`, `.bok/` for full details
6. **Include VulnHunter:** Referenced as additional automated analysis pass
7. **Include BOK formal verification summary:** Mathematical proofs of invariant correctness

### BOK Handling
Per CONTEXT.md decisions:
- **Include:** `.bok/invariants/`, `.bok/confirmed-invariants/`, `.bok/reports/`, `.bok/run-bc-kani.sh`, `.bok/run-kani-individual.sh`, `.bok/INDEX.md`, `.bok/STATE.json`, `.bok/summary.md`
- **Exclude:** `.bok/results/` (21MB of raw Kani verification output) and `.bok/worktree/`

## Specific Findings: Documentation Accuracy

### Docs Requiring Mainnet State Verification
| Document | What to Check |
|----------|---------------|
| `Docs/operational-runbook.md` | Contains Phase 69 devnet addresses -- needs mainnet address update |
| `Docs/deployment-sequence.md` | May reference old deploy steps |
| `Docs/mainnet-deploy-checklist.md` | Verify reflects actual mainnet deploy flow |
| `Docs/security-model.md` | Verify authority state matches on-chain |
| `Docs/token-economics-model.md` | Verify supply, tax rates, distribution match on-chain |
| `Docs/architecture.md` | Verify program IDs and account layouts |
| All `docs-site/content/` pages | Cross-check against on-chain state |

### Docs-Site GitHub Link Updates
Two links in `docs-site/app/layout.tsx` need updating:
- Line 33: `projectLink="https://github.com/dr-fraudsworth"` -> `"https://github.com/MetalLegBob/drfraudsworth"`
- Line 60: `docsRepositoryBase="https://github.com/dr-fraudsworth/docs/tree/main/docs-site/content"` -> `"https://github.com/MetalLegBob/drfraudsworth/tree/main/docs-site/content"`

## Open Questions

Things that couldn't be fully resolved:

1. **PDA Upload Authority with Squads-held programs**
   - What we know: `verify-from-repo` creates a PDA that stores verification metadata; the deployer wallet is typically the signer
   - What's unclear: Whether the deployer wallet can sign PDAs for programs whose upgrade authority is now the Squads vault PDA
   - Recommendation: Try deployer wallet first; if rejected, use `export-pda-tx` + Squads multisig flow. This is a runtime-discovery issue.

2. **CLAUDE.md and .claude/ directory in public repo**
   - What we know: These show the AI-assisted development methodology and Claude-specific configuration
   - What's unclear: Whether `CLAUDE.md` contains any sensitive information beyond dev workflow instructions. `.claude/settings.local.json` may have secrets but `.claude/settings.json` is likely safe. `.claude/skills/` directory has MCP skill files.
   - Recommendation: Include `CLAUDE.md` (shows AI methodology, part of the story), include `.claude/skills/` (shows tools used). Exclude `.claude/settings.local.json` and `.claude/agents/` (user-specific). Review each file individually.

3. **Internal process docs in Docs/archive/ and Docs/DECISIONS/**
   - What we know: 30+ files in `Docs/archive/` from various dev phases, DECISIONS/ has internal decision records
   - What's unclear: Whether any contain operational secrets or just historical design discussions
   - Recommendation: Exclude both directories as "internal process docs" per CONTEXT.md decisions. The canonical versions of specs live in the main `Docs/` directory.

4. **Test programs (fake-tax-program, mock-tax-program, stub-staking) in public repo**
   - What we know: These are test mock programs used in unit/integration testing
   - What's unclear: Whether including them adds confusion or value
   - Recommendation: Include them -- they're needed for `anchor test` to work, and showing test infrastructure demonstrates rigor

5. **Deploy scripts referencing keypair paths**
   - What we know: Scripts like `deploy-all.sh`, `stage-*.sh` reference `keypairs/` directory which won't exist
   - What's unclear: How much script modification is needed vs just documenting "configure your wallet path"
   - Recommendation: Leave scripts as-is (they show the real deploy process), document in README that keypair paths need configuration for reproduction

## Sources

### Primary (HIGH confidence)
- [Solana Verified Builds Documentation](https://solana.com/docs/programs/verified-builds) - Complete verification workflow, CLI commands, PDA upload process
- [Ellipsis Labs solana-verifiable-build](https://github.com/Ellipsis-Labs/solana-verifiable-build) - CLI v0.4.12, installation, build commands
- [OtterSec Verified Programs API](https://github.com/otter-sec/solana-verified-programs-api) - API endpoints, rate limits, verification workflow
- [Solana Explorer Program Verification](https://deepwiki.com/solana-foundation/explorer/3.3-program-verification-system) - How badge displays, trust model, UI components
- Project codebase inspection - `.env` files, `.mcp.json`, `keypairs/`, scripts, docs, workflows

### Secondary (MEDIUM confidence)
- [Gitleaks GitHub](https://github.com/gitleaks/gitleaks) - Secret scanner capabilities, configuration
- [TruffleHog GitHub](https://github.com/trufflesecurity/trufflehog) - Verification of active secrets
- [MIT License via choosealicense.com](https://choosealicense.com/licenses/mit/) - Standard license text
- [solana-verify crates.io](https://crates.io/crates/solana-verify) - Version tracking (v0.4.12)

### Tertiary (LOW confidence)
- OtterSec PDA authority requirements with Squads-transferred programs -- could not find explicit documentation on this scenario

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - solana-verify CLI is well-documented, gitleaks is standard
- Architecture (repo structure): HIGH - based on direct codebase inspection
- Secret inventory: HIGH - based on actual file inspection of private repo
- OtterSec workflow: HIGH for basic flow, MEDIUM for Squads authority edge case
- Pitfalls: HIGH - identified from actual file contents, not speculation
- Documentation accuracy scope: MEDIUM - identified files to check but haven't verified contents

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable domain -- solana-verify CLI doesn't change frequently)
