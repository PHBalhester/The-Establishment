# Phase 101: Verified Builds, IDL Upload, security.txt, and CPI Publishing - Research

**Researched:** 2026-03-20
**Domain:** Solana verified builds, on-chain IDL upload, security.txt embedding, program transparency
**Confidence:** HIGH

## Summary

This phase adds trust and transparency infrastructure to all 7 mainnet programs: embedding security.txt contact information, performing deterministic Docker-based verified builds, upgrading programs on mainnet with verified binaries, uploading IDLs on-chain, and submitting verification to OtterSec. CPI publishing was already ruled out in CONTEXT.md (no external consumers exist).

The standard approach is well-established: `solana-security-txt` crate for contact info, `solana-verify build` for deterministic Docker builds (replaces the old `anchor build --verifiable` approach), `anchor idl init` for on-chain IDL upload, and the OtterSec verify API for explorer badges. All tools are mature and widely used in the Solana ecosystem.

**Critical constraint:** The repo is PRIVATE. `verify-from-repo` requires a public repo for independent verification by third parties. However, we can still: (1) build deterministic binaries locally with `solana-verify build`, (2) deploy those binaries, (3) upload a verification PDA on-chain with the hash, and (4) submit to OtterSec's API. Full third-party verification becomes possible when the repo goes public (deferred per CONTEXT.md). The verified build process itself and the hash comparison are still valuable even with a private repo.

**Primary recommendation:** Add security.txt to all 7 programs, build verified binaries in GitHub Actions via Docker, upgrade mainnet programs, upload IDLs, and submit verification PDA. This must happen BEFORE Stage 5 (bonding curve launch) and BEFORE Stage 7 (Squads governance transfer) while the deployer still holds upgrade authority.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `solana-security-txt` | 1.1.1 | Macro to embed security contact info in program binary | Created by Neodyme Labs, the standard for Solana security.txt. Used by most production protocols. |
| `solana-verify` (CLI) | 0.4.11 | Docker-based deterministic build + on-chain verification PDA | Maintained by Ellipsis Labs, endorsed by Solana Foundation. Powers the OtterSec verify system. |
| `anchor` (CLI) | 0.32.1 | IDL upload via `anchor idl init` | Already installed. Standard tool for Anchor IDL management. |
| `query-security-txt` | latest | CLI to verify security.txt is correctly embedded in binary | Companion tool to solana-security-txt for pre-deploy validation. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Docker | latest | Required by solana-verify for deterministic builds | Must be installed on the build machine (GitHub Actions runner or local) |
| `solanafoundation/anchor:v0.32.1` | 0.32.1 | Docker image for deterministic Anchor builds | Used automatically by solana-verify when building Anchor programs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `solana-verify build` | `anchor build --verifiable` | Anchor 0.32+ uses solana-verify internally. Direct solana-verify gives more control and matches CONTEXT.md decision. |
| Solana Foundation reusable workflows | Custom workflow | Reusable workflows handle single programs well but don't support 7-program sequential builds with feature flags. Custom workflow per CONTEXT.md. |
| `anchor idl upgrade` | `anchor idl init` | `init` for first-time upload, `upgrade` for subsequent. Since no IDLs are uploaded yet, use `init`. |

**Installation:**
```bash
cargo install solana-verify
cargo install query-security-txt
# Docker must be installed separately (already available on GitHub Actions ubuntu-latest)
```

## Architecture Patterns

### Recommended Project Structure (no changes needed)
```
programs/
  amm/src/lib.rs                    # Add security_txt! macro here
  transfer-hook/src/lib.rs          # Add security_txt! macro here
  tax-program/src/lib.rs            # Add security_txt! macro here
  epoch-program/src/lib.rs          # Add security_txt! macro here
  staking/src/lib.rs                # Add security_txt! macro here
  conversion-vault/src/lib.rs       # Add security_txt! macro here
  bonding_curve/src/lib.rs          # Add security_txt! macro here
.github/workflows/
  ci.yml                            # Existing CI (keep as-is)
  verified-build.yml                # NEW: manual-dispatch verified build workflow
docs-site/content/security/
  security-policy.mdx               # NEW: security policy page
```

### Pattern 1: security_txt! Macro with no-entrypoint Guard
**What:** Embed security.txt contact information in each program binary, guarded so it only appears in the entrypoint build (not CPI library builds).
**When to use:** Every production program that gets deployed to mainnet.
**Example:**
```rust
// Source: https://docs.rs/solana-security-txt/1.1.1/solana_security_txt/
// In each program's lib.rs, BEFORE the #[program] block:

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Dr Fraudsworth's Finance Factory",
    project_url: "https://fraudsworth.fun",
    contacts: "email:drfraudsworth@gmail.com,twitter:@fraudsworth",
    policy: "https://fraudsworth.fun/docs/security/security-policy",
    preferred_languages: "en",
    auditors: "Internal audits: SOS, BOK, VulnHunter (v1.3)",
    expiry: "2027-03-20"
}
```

### Pattern 2: Verified Build per Program
**What:** Build each program individually in Docker using `solana-verify build --library-name <name>`.
**When to use:** Before any mainnet deploy or upgrade.
**Example:**
```bash
# Source: https://solana.com/docs/programs/verified-builds
# Build one program at a time:
solana-verify build --library-name amm
solana-verify build --library-name transfer_hook
solana-verify build --library-name tax_program
# ... etc

# Get the hash of the built binary:
solana-verify get-executable-hash target/deploy/amm.so

# Compare to on-chain hash:
solana-verify get-program-hash -u mainnet-beta 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR
```

### Pattern 3: IDL Upload
**What:** Upload Anchor IDL JSON to an on-chain PDA so explorers/SDKs can decode transactions.
**When to use:** After program is deployed, before public use.
**Example:**
```bash
# Source: https://www.anchor-lang.com/docs/references/cli
# First-time upload:
anchor idl init \
  --filepath target/idl/amm.json \
  --provider.cluster mainnet \
  --provider.wallet keypairs/mainnet-deployer.json \
  5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR

# Check authority:
anchor idl authority 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR \
  --provider.cluster mainnet

# Transfer authority later (to Squads vault):
anchor idl set-authority \
  -n <SQUADS_VAULT_PDA> \
  -p 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR \
  --provider.cluster mainnet \
  --provider.wallet keypairs/mainnet-deployer.json
```

### Pattern 4: OtterSec Verification Submission
**What:** Submit verification data to OtterSec API for explorer badges.
**When to use:** After deploying verified binary to mainnet.
**Example:**
```bash
# Source: https://github.com/otter-sec/solana-verified-programs-api

# Option A: via CLI (requires public repo for full trust chain)
solana-verify verify-from-repo -um \
  --program-id 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR \
  https://github.com/org/repo \
  --commit-hash <HASH> \
  --library-name amm \
  --mount-path programs/amm

# Option B: Upload PDA on-chain + remote verify (for private repo)
# Build locally with solana-verify build
# Deploy the binary
# Upload verification PDA:
solana-verify export-pda-tx \
  --program-id <PROGRAM_ID> \
  --uploader <DEPLOYER_PUBKEY>
# Then submit remote job:
solana-verify remote submit-job \
  --program-id <PROGRAM_ID> \
  --uploader <DEPLOYER_PUBKEY>
```

### Anti-Patterns to Avoid
- **Building with `anchor build` after `solana-verify build`:** This overwrites the deterministic binary with a non-deterministic one. The hash will no longer match. Always deploy the `target/deploy/*.so` from the verified build.
- **Using `anchor build --verifiable` alongside `solana-verify build`:** Pick one. CONTEXT.md specifies `solana-verify build --library-name`. Don't mix approaches.
- **Uploading IDLs before upgrading programs:** The IDL should match the deployed binary. Upgrade program first, then upload IDL.
- **Burning IDL authority prematurely:** Keep IDL authority with deployer for now; transfer to Squads with upgrade authority in Stage 7.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Security contact info in binary | Custom string embedding | `solana-security-txt` crate | Standard format, parsed by explorers, query-security-txt validation tool |
| Deterministic builds | Custom Docker setup | `solana-verify build` | Maintained by Ellipsis Labs, uses Solana Foundation Docker images, handles all edge cases |
| IDL on-chain storage | Custom PDA for IDL | `anchor idl init` | Anchor's IDL format is the ecosystem standard, auto-parsed by Solana Explorer, SolanaFM, SolScan |
| Verification submission | Manual API calls | `solana-verify verify-from-repo --remote` or `solana-verify remote submit-job` | Handles PDA creation, OtterSec API submission, and re-verification polling |
| Hash comparison | Custom sha256 script | `solana-verify get-executable-hash` + `solana-verify get-program-hash` | Handles ELF format correctly, not just raw file hash |

**Key insight:** The entire verified builds pipeline (build, deploy, verify, submit) is a solved problem with well-maintained tooling. The only custom work is the GitHub Actions workflow YAML and the security policy page content.

## Common Pitfalls

### Pitfall 1: Overwriting Verified Binary with anchor build
**What goes wrong:** After running `solana-verify build`, someone runs `anchor build` which produces a non-deterministic binary, overwriting the verified one. The deployed binary then fails hash verification.
**Why it happens:** `anchor build` and `solana-verify build` output to the same `target/deploy/` directory. Muscle memory causes developers to run `anchor build` out of habit.
**How to avoid:** In the GitHub Actions workflow, NEVER run `anchor build` after `solana-verify build`. If you need IDLs, build them separately with `anchor build` first, save the IDLs, then run `solana-verify build` which overwrites the .so files.
**Warning signs:** Hash mismatch between local binary and on-chain program after upgrade.

### Pitfall 2: Feature Flags in Verified Builds
**What goes wrong:** Four programs (tax_program, epoch_program, conversion_vault, bonding_curve) require `--features devnet` for devnet builds but MUST NOT use it for mainnet. Using wrong features produces wrong binaries.
**Why it happens:** The existing build.sh has a `--devnet` flag, but `solana-verify build` has its own flag syntax.
**How to avoid:** For mainnet verified builds, do NOT pass any extra features. The default build (no features) produces mainnet binaries. For devnet verified builds (if ever needed), pass `-- --features devnet` after the library name.
**Warning signs:** Programs with compile_error! guards fail to build (bonding_curve without devnet/localnet feature), or programs use wrong Switchboard PID.

### Pitfall 3: Library Name vs Package Name
**What goes wrong:** Using hyphenated package names (e.g., `tax-program`) instead of underscore library names (e.g., `tax_program`) with `solana-verify build --library-name`.
**Why it happens:** Cargo normalizes hyphens to underscores for library names, but the .so file uses underscores. The `--library-name` flag expects the underscore form.
**How to avoid:** Use the .so filename (without extension) as the library name: `amm`, `transfer_hook`, `tax_program`, `epoch_program`, `staking`, `conversion_vault`, `bonding_curve`.
**Warning signs:** "library not found" error from solana-verify.

### Pitfall 4: Verified Build Time on Apple Silicon
**What goes wrong:** `solana-verify build` on macOS with Apple Silicon runs via QEMU emulation inside Docker, taking 20-45 minutes PER PROGRAM (7 programs = 2.5-5 hours).
**Why it happens:** Docker on Apple Silicon uses QEMU to emulate x86_64 Linux for the Solana build environment.
**How to avoid:** CONTEXT.md already decided this: use GitHub Actions (ubuntu-latest runner, native x86_64). Never build verified binaries on local Apple Silicon.
**Warning signs:** Extremely slow build times, timeout in CI.

### Pitfall 5: Private Repo Verification Limitations
**What goes wrong:** Running `solana-verify verify-from-repo` against a private GitHub repo fails because the OtterSec API cannot clone the repo.
**Why it happens:** The verification system needs to build the source code independently. Private repos are inaccessible to the verifier.
**How to avoid:** For now (repo is private per CONTEXT.md), use the two-step approach: (1) build and deploy verified binaries locally/CI, (2) upload the verification PDA on-chain with the binary hash. The on-chain hash proves the binary matches what was deployed, even though the source isn't independently verifiable yet. Full verification becomes possible when the repo goes public.
**Warning signs:** `verify-from-repo` returns authentication errors.

### Pitfall 6: IDL Upload Authority Default
**What goes wrong:** `anchor idl init` is permissionless for the initial upload -- anyone could upload a fake IDL to your program's IDL PDA before you do.
**Why it happens:** The IDL account is a PDA derived from the program ID. First uploader becomes authority.
**How to avoid:** Upload IDLs immediately after deploying programs. Then verify the authority is your deployer wallet: `anchor idl authority <PROGRAM_ID>`.
**Warning signs:** Someone else's IDL appears on explorer for your program.

### Pitfall 7: IDL Size and Rent Costs
**What goes wrong:** Large IDLs (especially bonding_curve at 72KB and epoch_program at 68KB) require significant rent-exempt storage.
**Why it happens:** `anchor idl init` allocates 2x the IDL size for future upgrade headroom. Large IDLs = large rent.
**How to avoid:** Budget for this. Rough calculation: Solana rent is ~0.00000348 SOL per byte per epoch. For a 72KB IDL at 2x = 144KB, rent-exempt minimum is approximately 1.0 SOL. Total across 7 IDLs estimated at 0.5-2.0 SOL (CONTEXT.md estimated 0.3-0.6 SOL; this may be low for the larger IDLs).
**Warning signs:** Insufficient SOL in deployer wallet causing IDL init failure.

### Pitfall 8: Program Upgrade After Verified Build
**What goes wrong:** The deployer upgrades a program using a non-verified binary, which breaks the verification status.
**Why it happens:** OtterSec re-verifies all programs every 24 hours. If the on-chain binary changes, re-verification will fail.
**How to avoid:** ALWAYS use `solana-verify build` for any future upgrades. Never use `anchor build` output for mainnet deployments.
**Warning signs:** OtterSec API returns "unverified" status for previously verified program.

## Code Examples

Verified patterns from official sources:

### Adding security_txt! to an Anchor Program
```rust
// Source: https://github.com/neodyme-labs/solana-security-txt
// Add to each program's lib.rs, BEFORE the declare_id! macro

use anchor_lang::prelude::*;

// Only include security.txt in the entrypoint build, NOT in CPI library builds.
// This guard matches the existing pattern used for the program entrypoint.
#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Dr Fraudsworth's Finance Factory",
    project_url: "https://fraudsworth.fun",
    contacts: "email:drfraudsworth@gmail.com,twitter:@fraudsworth",
    policy: "https://fraudsworth.fun/docs/security/security-policy",
    preferred_languages: "en",
    auditors: "Internal audits: SOS, BOK, VulnHunter (v1.3)",
    expiry: "2027-03-20"
}

declare_id!("...");

#[program]
pub mod amm {
    // ...
}
```

### Cargo.toml Dependency Addition
```toml
# Add to [dependencies] in each of the 7 production program Cargo.toml files:
[dependencies]
solana-security-txt = "1.1.1"
```

### GitHub Actions Verified Build Workflow (workflow_dispatch)
```yaml
# Source: https://solana.com/docs/programs/verified-builds
# .github/workflows/verified-build.yml
name: Verified Build

on:
  workflow_dispatch:
    inputs:
      priority_fee:
        description: 'Priority fee in microlamports for IDL uploads'
        required: false
        default: '50000'
        type: string

env:
  SOLANA_VERSION: "3.0.13"
  ANCHOR_VERSION: "0.32.1"

jobs:
  verified-build:
    runs-on: ubuntu-latest
    timeout-minutes: 120  # 7 programs, ~10-15min each in Docker
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust 1.93.0
        uses: dtolnay/rust-toolchain@1.93.0

      - name: Install solana-verify
        run: cargo install solana-verify

      - name: Build all 7 programs (verified, sequential)
        run: |
          for lib in amm transfer_hook tax_program epoch_program staking conversion_vault bonding_curve; do
            echo "=== Building $lib ==="
            solana-verify build --library-name "$lib"
            echo "Hash: $(solana-verify get-executable-hash target/deploy/${lib}.so)"
          done

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: verified-binaries
          path: target/deploy/*.so
          retention-days: 90

      - name: Upload IDL artifacts
        uses: actions/upload-artifact@v4
        with:
          name: verified-idls
          path: target/idl/*.json
          retention-days: 90
```

### Verifying security.txt Before Deploy
```bash
# Source: https://github.com/neodyme-labs/solana-security-txt
# After building, verify the security.txt is embedded correctly:
cargo install query-security-txt

# Check each .so file:
for so in target/deploy/{amm,transfer_hook,tax_program,epoch_program,staking,conversion_vault,bonding_curve}.so; do
  echo "=== $(basename $so) ==="
  query-security-txt "$so"
  echo ""
done
```

### IDL Upload Script for All 7 Programs
```bash
# Upload IDLs to mainnet for all 7 programs
# Must have deployer wallet with sufficient SOL

PROGRAMS=(
  "amm:5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
  "transfer_hook:CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd"
  "tax_program:43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"
  "epoch_program:4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2"
  "staking:12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"
  "conversion_vault:5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ"
  "bonding_curve:DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV"
)

for entry in "${PROGRAMS[@]}"; do
  IFS=: read -r name id <<< "$entry"
  echo "=== Uploading IDL for $name ($id) ==="
  anchor idl init \
    --filepath "target/idl/${name}.json" \
    --provider.cluster mainnet \
    --provider.wallet keypairs/mainnet-deployer.json \
    "$id"
done
```

### Program Upgrade with Verified Binary
```bash
# After verified build, deploy the .so to mainnet as an upgrade
# (assuming deployer still holds upgrade authority)

solana program deploy target/deploy/amm.so \
  --program-id 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR \
  --url mainnet-beta \
  --keypair keypairs/mainnet-deployer.json \
  --with-compute-unit-price 50000

# Verify the hash matches:
solana-verify get-program-hash -u mainnet-beta \
  5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR
```

## Library Name to Program ID Mapping

Critical reference for build and verification commands:

| Library Name (--library-name) | Package Name (Cargo.toml) | .so File | Mainnet Program ID |
|-------------------------------|---------------------------|----------|-------------------|
| `amm` | amm | amm.so | 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR |
| `transfer_hook` | transfer-hook | transfer_hook.so | CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd |
| `tax_program` | tax-program | tax_program.so | 43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj |
| `epoch_program` | epoch-program | epoch_program.so | 4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2 |
| `staking` | staking | staking.so | 12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH |
| `conversion_vault` | conversion-vault | conversion_vault.so | 5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ |
| `bonding_curve` | bonding-curve | bonding_curve.so | DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV |

Note: `transfer-hook` has an explicit `[lib] name = "transfer_hook"` in its Cargo.toml. All others rely on Cargo's automatic hyphen-to-underscore conversion.

## Execution Sequencing Constraints

Per CONTEXT.md, the execution order is critical and must be enforced in planning:

```
1. Add security_txt! macro to all 7 programs' lib.rs
2. Create security policy page on docs site
3. Verified Docker builds of all 7 programs (new binaries with security.txt embedded)
4. Upgrade 6 already-deployed mainnet programs with verified binaries
   (Bonding Curve is deployed but not yet launched)
5. Upload IDLs for all 7 programs on mainnet
6. Submit verification to OtterSec for all 7 programs
7. THEN Stage 5 (launch bonding curves)
8. THEN Stage 7 (Squads governance transfer -- IDL authority transfers alongside)
```

**Why this order matters:**
- Steps 1-3 must complete before any mainnet changes (code changes + build)
- Step 4 BEFORE step 5: IDL must match the deployed binary version
- Steps 4-6 BEFORE Stage 5: BC launches with security.txt + IDL + verified build from day one
- All before Stage 7: deployer must hold upgrade authority to perform program upgrades and IDL uploads

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `anchor build --verifiable` | `solana-verify build` | Anchor 0.32.0 (2024) | Anchor now uses solana-verify internally. Direct usage preferred for control. |
| Manual hash comparison | `solana-verify get-executable-hash` / `get-program-hash` | solana-verify 0.4+ | ELF-aware hashing, not raw file hash. More reliable. |
| No on-chain verification | OtterSec verify PDA | 2024 | Otter Verify program (`verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC`) stores verification on-chain |
| Explorer doesn't show security.txt | Solana Explorer parses security.txt | 2023+ | Security contact info visible on explorer pages |
| IDL stored off-chain | `anchor idl init` on-chain PDA | Anchor 0.2x+ | Explorers auto-decode transactions using on-chain IDL |

**Deprecated/outdated:**
- `anchor verify` (old standalone Anchor verification) -- replaced by `solana-verify verify-from-repo`
- `projectserum/build` Docker images -- replaced by `solanafoundation/anchor:<version>` images
- `anchor build --verifiable -d <image>` (manual image override) -- no longer needed with solana-verify

## Private Repo Strategy

Since the repo is private (CONTEXT.md decision), the verification strategy has two phases:

### Phase A: Now (Private Repo)
1. Build deterministic binaries with `solana-verify build` in GitHub Actions
2. Deploy binaries to mainnet
3. Save the binary hashes in deployment artifacts
4. Upload IDLs on-chain (IDLs are readable regardless of repo visibility)
5. Upload verification PDA on-chain with hash data
6. OtterSec can verify the hash matches the on-chain binary
7. Explorer shows IDL and security.txt (these work regardless of source visibility)

### Phase B: Future (Public Repo - Deferred)
1. Open-source the repo
2. Run `solana-verify verify-from-repo --remote` against the public repo
3. OtterSec independently builds and verifies the binary matches
4. Explorer shows full "Program Source Verified" badge with source link

**What users see now (Phase A):** IDL on explorer, security.txt contact info, and binary hash on verification PDA. They cannot independently verify source code maps to binary.

**What users see later (Phase B):** Full green "Verified" badge on Solana Explorer, SolanaFM, and SolScan with link to source.

## Open Questions

Things that couldn't be fully resolved:

1. **Exact IDL rent costs for large IDLs**
   - What we know: `anchor idl init` allocates 2x IDL size. Solana rent is ~6.96 SOL per MB (rent-exempt). Largest IDL (bonding_curve) is 72KB, so 2x = 144KB = ~1.0 SOL. Smallest (staking) is 38KB, 2x = 76KB = ~0.53 SOL.
   - What's unclear: Exact total cost across all 7 IDLs. Rough estimate: 2.5-5.0 SOL total (higher than CONTEXT.md's 0.3-0.6 SOL estimate).
   - Recommendation: Budget 5 SOL for IDL uploads to be safe. Verify by checking deployer balance before and after a devnet test run.

2. **solana-verify build with feature flags for programs that have compile_error! guards**
   - What we know: bonding_curve has `compile_error!` without `devnet` or `localnet` feature. For mainnet, it needs to build without these features. The `compile_error!` guard may need a `mainnet` feature or removal of the guard for production builds.
   - What's unclear: Whether `solana-verify build --library-name bonding_curve` can pass extra cargo features. Syntax appears to be `solana-verify build --library-name bonding_curve -- --features mainnet` but this needs testing.
   - Recommendation: Test this on devnet first. May need to add a `mainnet` feature flag or restructure the compile_error guard.

3. **OtterSec verification with private repo**
   - What we know: `verify-from-repo` needs the repo to be publicly accessible. The on-chain PDA can still be uploaded with hash data.
   - What's unclear: Whether `solana-verify remote submit-job` works with just the PDA (no repo URL), or if it requires a repo URL. If it requires a repo URL, the private repo blocks remote verification entirely.
   - Recommendation: Test with `solana-verify export-pda-tx` and `remote submit-job` on devnet first. If it fails, document that full verification is deferred until repo goes public, and just ensure IDL + security.txt are uploaded.

4. **Priority fees for mainnet IDL uploads**
   - What we know: Mainnet transactions need priority fees. `anchor idl init` supports `--priority-fee` or the provider can be configured.
   - What's unclear: Whether `anchor idl init` supports priority fee flags directly, or if this needs to be set via provider config.
   - Recommendation: Claude's discretion per CONTEXT.md. Start with 50000 microlamports, increase if transactions fail.

## Sources

### Primary (HIGH confidence)
- [Solana Verified Builds Documentation](https://solana.com/docs/programs/verified-builds) - Complete guide on verified builds, solana-verify CLI, Docker setup, OtterSec integration
- [solana-security-txt crate docs](https://docs.rs/solana-security-txt/1.1.1/solana_security_txt/) - Macro syntax, all fields, no-entrypoint guard pattern
- [neodyme-labs/solana-security-txt GitHub](https://github.com/neodyme-labs/solana-security-txt) - README with Cargo.toml dependency, full example, query-security-txt tool
- [Anchor CLI Reference](https://www.anchor-lang.com/docs/references/cli) - IDL subcommands: init, upgrade, set-authority, erase-authority, authority
- [Anchor Verifiable Builds Reference](https://www.anchor-lang.com/docs/references/verifiable-builds) - anchor build --verifiable, Docker image info
- [solana-developers/github-workflows](https://github.com/solana-developers/github-workflows) - Reusable workflow structure for verified builds + IDL upload
- [otter-sec/solana-verified-programs-api](https://github.com/otter-sec/solana-verified-programs-api) - OtterSec API endpoints, PDA verification, webhook monitoring

### Secondary (MEDIUM confidence)
- [Anchor GitHub Action Example (Woody4618)](https://github.com/Woody4618/anchor-github-action-example) - Practical workflow YAML for build/deploy/verify
- [Solana Anchor Verifiable Builds blog (chalda)](https://blog.chalda.cz/posts/solana-anchor-verifiable-builds/) - Practical guide with IDL upload commands, Docker image gotchas
- [OtterSec/solana-verified-programs-api DeepWiki](https://deepwiki.com/otter-sec/solana-verified-programs-api/1-overview) - API overview and webhook architecture

### Tertiary (LOW confidence)
- IDL rent cost calculation: estimated from Solana rent formula (6.96 SOL/MB), not verified with actual anchor idl init output
- solana-verify feature flag passthrough syntax: inferred from CLI help pattern, needs testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools are well-documented, mature, and widely used
- Architecture (security.txt macro): HIGH - Verified via official docs and crate documentation
- Architecture (verified builds): HIGH - Solana Foundation maintains the documentation and Docker images
- Architecture (IDL upload): HIGH - Standard Anchor CLI workflow, well-documented
- Pitfalls: MEDIUM - Some pitfalls are from research synthesis, not direct experience
- Private repo strategy: MEDIUM - The PDA upload path needs testing to confirm it works without a public repo
- IDL costs: LOW - Estimated from rent formula, not verified empirically

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (tools are stable, 30-day window appropriate)
