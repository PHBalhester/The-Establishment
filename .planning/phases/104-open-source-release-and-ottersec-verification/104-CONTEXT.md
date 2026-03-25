# Phase 104: Open Source Release and OtterSec Verification - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Prepare the Dr. Fraudsworth codebase for public open-source release, then submit all 6 deployed mainnet programs to OtterSec for verified badge on Solana explorers. Includes: repo creation, exhaustive secret sanitization, audit report curation, documentation accuracy review, and OtterSec verification submission. Does NOT include paid external security audit (future phase).

</domain>

<decisions>
## Implementation Decisions

### Repo Strategy
- **Fresh repo, curated copy** — new empty repo (MetalLegBob/drfraudsworth), manually copy selected directories/files. Single initial commit. Zero risk of leaked secrets from 1,979 commits of old git history
- **License: MIT** — standard for Solana ecosystem, maximally permissive, shows confidence
- **Read-only open source** — no CONTRIBUTING.md, no PRs accepted. Repo is for transparency and verification, not community contributions. Security reports go through security.txt (Phase 101)
- **Comprehensive README** — protocol overview, architecture, how it works (tax→epoch→carnage→staking flow), deployed addresses, verified build instructions, links to docs site, audit reports, and the build journey (.planning/)

### Content Inclusion
- **Include everything**: programs, frontend (Next.js app), deploy scripts, crank, graduation, test suites, docs-site (Nextra), .planning/ (all 104 phases of build journey), audit directories (.audit/, .bulwark/, .bok/, audit-history/)
- **Exclude ALL keypairs** — no keypairs/ directory at all. Devnet keys worthless but messy. Mainnet keys, Squads signer keys — all excluded. Zero exceptions
- **.env.example templates only** — all variable names with placeholder values (HELIUS_API_KEY=your-key-here). No real secrets. deployments/mainnet.json stays (addresses are public on-chain)
- **Keep all mainnet addresses visible** — program IDs, mint CAs, pool addresses, treasury address. All verifiable on-chain. The whole point of open-sourcing is verifiability
- **Exclude internal process docs** — pathway reports, deployment sequences, internal fix plans stay in private repo. Protocol specs, security model, and user-facing docs included

### Secret Sanitization (CRITICAL)
- **Military-grade thoroughness** — check and re-verify until 5 consecutive full passes find zero issues. ANYTHING dangerous to be public gets removed
- Sanitization scope: keypairs, private keys, API keys, webhook secrets, RPC URLs with API keys, signer identities, emergency operational procedures
- deployments/ JSON files are OK (on-chain addresses only)
- Scripts must be reviewed line-by-line for hardcoded secrets

### Audit Report Presentation
- **Curated summary report** — SECURITY_AUDIT_SUMMARY.md at repo root. Categorizes all findings by severity with project response to each (Fixed / Acknowledged / Won't Fix with explanation)
- **Include raw audit directories** alongside summary — .audit/, .bulwark/, .bok/ (harnesses + test code, NOT raw multi-MB proof output), .audit-history/, .bulwark-history/
- **BOK**: Include harnesses and test code. Exclude .bok/results/ (2-4MB proof output files). Need comprehensive summary report if one doesn't exist
- **Label as "AI-Assisted Internal Audit"** — transparent about methodology. Shows rigor without overstating. Pairs well with OtterSec external verification
- **VulnHunter reports included** — referenced in summary as additional analysis pass
- Unfixed-but-non-exploitable findings get clear status annotations and explanations in summary

### OtterSec Verification
- **Verification badge only** — not paid audit (future phase, POST-03 in requirements)
- **Open-source first, then submit** — OtterSec needs public repo URL. Open-source is prerequisite
- **All 6 deployed programs verified** — AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault. Bonding Curve closed (rent reclaimed), can't verify
- Phase 101 verified builds already completed — resubmit to OtterSec with new public repo URL
- If issues arise during submission, handle pragmatically at that point

### Documentation Accuracy
- **Full review against mainnet state** — every doc in Docs/ checked against current on-chain reality. Addresses, parameters, tax rates, pool configs, authority state all verified
- **Docs-site (Nextra) reviewed too** — ensure consistency between raw docs and website content
- **Governance doc (mainnet-governance.md) sanitized** — include governance structure (vault address, timelock config, authority assignments) but strip signer identities, emergency rollback procedures, and anything that helps attackers time governance operations
- **Docs-site GitHub link** — update top-right corner link to point to new public repo (MetalLegBob/drfraudsworth)

### Claude's Discretion
- Exact directory structure in the new public repo (minor reorganization for clarity is fine)
- Order of operations during sanitization passes
- Which specific internal process docs to exclude vs include (use judgment: if it's operationally sensitive or just internal noise, exclude it)
- README structure and formatting
- How to handle the .planning/phases/ STATE.md references to operational details

</decisions>

<specifics>
## Specific Ideas

- "I want people to see the entire build process, the internal audits, the math tests with BOK" — the .planning/ directory showing 104 phases of Claude-assisted development is the centerpiece transparency feature
- "Our most recent audit reports show some bugs we haven't fixed yet but none of them are exploitable bugs at all" — curated summary must clearly explain why acknowledged findings are non-exploitable
- "I think a new repo as we have keypairs from devnet etc in here" — confirmed: fresh repo, zero git history from private repo
- "Checking and re-verifying until we can go through the whole thing 5 times consecutively and not find a single thing to change" — sanitization is not a one-pass operation, it's an iterative verification loop
- Update docs-site GitHub link (top-right corner) to point to new public repo

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.gitignore` — already excludes mainnet keypairs, .env.mainnet, mint-keypairs/. New repo needs a STRICTER .gitignore
- `deployments/mainnet.json` — contains on-chain addresses (public data). Safe to include
- `scripts/deploy/` — full deploy pipeline. Needs line-by-line secret audit but structure is reusable
- `docs-site/` — complete Nextra documentation site. GitHub link in theme config needs updating

### Established Patterns
- Phase 101 verified builds already completed — Docker builds, mainnet upgrades, IDL uploads done
- security.txt already embedded in all 7 program binaries (Phase 101)
- OtterSec submission attempted but blocked on public repo requirement

### Integration Points
- OtterSec verify.osec.io API — needs public repo URL for submission
- docs-site theme config — GitHub link (top-right corner) needs new repo URL
- README.md — links to all major sections (audits, docs, programs, .planning/)
- solana-verify CLI — resubmit with --repo pointing to new public repo

### Sensitive Files Identified (Must Exclude)
- `keypairs/` — 35 files including mainnet program keys, mint keys, Squads signer keys
- `.env`, `.env.devnet`, `.env.mainnet` — real API keys and secrets
- `scripts/e2e/stress-keypairs.json` — test keypairs
- `scripts/graduation/graduation-state.json` — operational state
- `Docs/mainnet-governance.md` — needs sanitization (include structure, strip ops details)
- Any hardcoded RPC URLs with API keys in scripts

</code_context>

<deferred>
## Deferred Ideas

- **Paid external audit (OtterSec/Trail of Bits/Halborn)** — POST-03 in requirements. Engage when protocol has revenue to fund meaningful audit
- **ImmuneFi bug bounty program** — set up when protocol revenue can fund payouts. Update security.txt policy
- **Community contributions** — currently read-only open source. Revisit if/when community interest warrants it
- **GitHub org creation** — discussed but decided against for now. Revisit if project grows beyond single-maintainer

</deferred>

---

*Phase: 104-open-source-release-and-ottersec-verification*
*Context gathered: 2026-03-25*
