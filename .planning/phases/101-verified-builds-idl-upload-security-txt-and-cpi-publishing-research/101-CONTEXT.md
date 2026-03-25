# Phase 101: Verified Builds, IDL Upload, security.txt, and CPI Publishing - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Post-launch trust & transparency infrastructure for all 7 mainnet programs. Add security.txt to program binaries, perform verified Docker builds, upgrade programs on mainnet, upload IDLs on-chain, and submit verification to OtterSec. CPI publishing research concluded — no external publishing needed. Must complete BEFORE Stage 7 (Squads governance transfer) while deployer still holds upgrade authority.

</domain>

<decisions>
## Implementation Decisions

### Source Code Visibility
- Repo stays **PRIVATE** until internal audits, expert advice, or external audit
- **Verify privately** — submit to OtterSec now for explorer "Verified" badge; users can't independently check source until repo goes public
- Future plan: create a **frozen-in-time snapshot repo** (full copy including .planning/.dbs) showing the complete Claude-assisted build journey
- Include everything when going public — programs, frontend, scripts, docs, planning files

### security.txt Content
- **Contacts**: `email:drfraudsworth@gmail.com,twitter:@fraudsworth` (ordered by preference)
- **Name**: "Dr Fraudsworth's Finance Factory"
- **Project URL**: `https://fraudsworth.fun`
- **Policy**: `https://fraudsworth.fun/docs/security` (new page on Nextra docs site)
- **No bug bounty yet** — add ImmuneFi later when protocol has revenue to fund meaningful payouts
- **Auditors**: Link to internal audit reports (SOS, BOK, VulnHunter from v1.3)
- **Source code**: Omit for now (repo private). Add when public
- **Preferred languages**: "en"
- **Expiry**: Set 1 year out (2027-03-20), update with each program upgrade
- Add `security_txt!` macro to ALL 7 programs with `#[cfg(not(feature = "no-entrypoint"))]` guard

### Build & Verify Pipeline
- **Extend existing GitHub Actions CI/CD** (`.github/workflows/ci.yml`) with a verified build job
- **Manual dispatch only** (`workflow_dispatch`) — trigger when ready, no auto-runs
- Use `solana-verify build --library-name <name>` in Docker for each program
- Use Solana Foundation reusable workflows (`solana-developers/github-workflows`) as reference
- **Apple Silicon local builds NOT used** — too slow (20-45min per program via QEMU)

### IDL Upload
- Upload IDLs for **all 7 programs** (AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault, Bonding Curve)
- Use `anchor idl init --filepath <file> <program_id>` (first-time upload)
- **IDL authority kept with deployer** for now — easier updates during active development
- Transfer IDL authority to Squads at the same time as upgrade authority (Stage 7)
- Estimated cost: ~0.3-0.6 SOL for all 7 IDLs (compressed, 2x allocation)

### Execution Sequencing (CRITICAL)
1. Add `security_txt!` macro to all 7 programs' `lib.rs`
2. Create security policy page on docs site
3. Verified Docker builds of all 7 programs (new binaries with security.txt embedded)
4. Upgrade 6 already-deployed mainnet programs with verified binaries
5. Upload IDLs for all 7 programs on mainnet
6. Submit verification PDAs to OtterSec for all 7 programs
7. **THEN** Stage 5 (launch bonding curves) — BC launches with security.txt + IDL + verified build from day one
8. **THEN** Stage 7 (Squads governance transfer) — IDL authority transfers alongside upgrade authority

### CPI Publishing
- **No crates.io publishing needed** — protocol is internal/self-composing
- **No npm IDL package needed** — defer until post-audit or external integrator demand
- On-chain IDL upload (covered above) is the most impactful "CPI publishing" action
- `declare_program!` migration from `features = ["cpi"]` not needed — monorepo with same Anchor version works fine
- Manual `invoke_signed` CPI pattern retained for hook-heavy paths (Anchor CPI helpers don't forward remaining_accounts)

### Claude's Discretion
- Exact GitHub Actions workflow YAML structure
- Order of programs during verified build (parallelism vs sequential)
- Whether to use Solana Foundation reusable workflows directly or custom workflow
- Priority fee settings for mainnet IDL upload transactions
- security.txt `source_revision` field — whether to include or omit (repo is private)

</decisions>

<specifics>
## Specific Ideas

- "We want Jupiter to be able to call our Tax Program to route through" — future goal that makes on-chain IDL publishing essential, not just nice-to-have
- "I want people to see the whole build process with Claude" — when open-sourcing, include the full .planning/.dbs journey as an unprecedented transparency showcase
- Bonding Curve IDL uploaded even though it's short-lived — historical transactions should be readable on explorers after graduation

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.github/workflows/ci.yml` — existing CI pipeline (2 jobs: rust-tests, ts-tests). Extend with verified build job.
- `scripts/deploy/generate-hashes.sh` — already generates SHA256 hashes of .so files. Verified builds will replace this with Docker-deterministic hashes.
- `scripts/deploy/build.sh` — 4-step build pipeline (sync IDs, patch mints, compile, verify). Verified builds bypass this for the .so generation step.
- `solana-security-txt` crate already present in build artifacts (pulled as transitive dep). Just need to add to each program's Cargo.toml explicitly.
- `scripts/deploy/transfer-authority.ts` + `scripts/deploy/verify-authority.ts` — existing Squads governance scripts. IDL authority transfer will follow same pattern.

### Established Patterns
- Programs use `#[cfg(not(feature = "no-entrypoint"))]` guard pattern — security.txt must use same guard to avoid embedding in CPI library builds
- Feature flags: `devnet`, `cpi`, `no-entrypoint`, `idl-build` already defined in each program's Cargo.toml
- All 7 program IDs synced via `sync-program-ids.ts` — verified builds must use same IDs
- Mainnet builds must NOT use `--features devnet` — critical for 4 feature-flagged programs (epoch, tax, vault, bonding_curve)

### Integration Points
- IDL files generated at `app/idl/*.json` (7 production + 3 test) — these are the files to upload
- Anchor.toml lists all 7 programs with current mainnet program IDs
- Deployer wallet (23g7x...) holds upgrade authority for all 7 programs — will sign all upgrades and IDL uploads
- OtterSec API at `verify.osec.io` — submit verification after builds
- Squads governance scripts will need IDL authority transfer added (Phase 100 Stage 7)

</code_context>

<deferred>
## Deferred Ideas

- **Jupiter DEX integration** — Route Jupiter swaps through Tax Program for aggregator listing. Requires Jupiter partnership and potentially a new ungated swap instruction. Future phase after launch.
- **ImmuneFi bug bounty program** — Set up formal bounty when protocol revenue can fund meaningful payouts. Update security.txt policy field to link to ImmuneFi.
- **Public repo open-source** — Create frozen-in-time snapshot repo after internal/external audit. Enables fully trustless verified builds.
- **CPI crate publishing** (crates.io) — Only if external protocols want to CPI into Dr Fraudsworth programs. Not needed for internal protocol.
- **npm IDL package** — Publish TypeScript types for external developers. Defer until post-audit.
- **Codama SDK generation** — Modern approach to generating typed clients from IDL. Consider when targeting external developer adoption.
- **Anchor v1.0 Program Metadata migration** — When Anchor 1.0 ships, IDL storage moves to Program Metadata Program (separate from program binary). Re-upload IDLs at that time.

</deferred>

---

*Phase: 101-verified-builds-idl-upload-security-txt-and-cpi-publishing-research*
*Context gathered: 2026-03-20*
