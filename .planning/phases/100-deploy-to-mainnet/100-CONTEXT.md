# Phase 100: Deploy to Mainnet - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Execute the validated 8-stage deployment checklist on Solana mainnet-beta. This is the actual launch of Dr. Fraudsworth's Finance Factory — pre-deploy infrastructure days in advance, trigger bonding curves at launch, monitor the 48-hour fill period, graduate into AMM pools, verify full protocol operation, start the crank, and transfer authorities to Squads multisig. Marketing, social media, and community coordination are out of scope — this phase is purely technical deployment execution.

</domain>

<decisions>
## Implementation Decisions

### Pre-Deploy Timing (Stages 0-4)
- Deploy Stages 0-4 (programs, mints, PDAs, ALT, frontend) 3-5 days before launch
- Joint review checkpoint after Stages 0-4: verify every program, mint, PDA, ALT, and frontend connection together before proceeding to Stage 5
- Exact launch day/time is a game-day decision — not locked in advance

### Curve Fill Period (Stage 5 → Stage 6)
- No artificial seeding of lagging curves — all-or-nothing from community buyers
- If both curves don't fill within 48 hours, refund path activates and the protocol does not proceed
- Monitor via frontend launch page gauges + UptimeRobot alerts for site downtime — no custom alerting scripts
- Pre-graduation on-chain verification required: confirm both curves genuinely filled and reserves match expected values before running graduate.ts
- Graduation triggered manually by running graduate.ts locally (not automated)

### Post-Launch Operations (After Stage 6)
- 24-48 hours of stable trading before running Stage 7 (Squads authority transfer)
- Initial Squads timelock: 15 minutes (900s), increasing progressively as protocol proves stable
- Emergency response: follow checklist emergency procedures (4 scenarios documented) + Claude session on standby for anything procedures don't cover
- Deployer retains hot-fix capability during the critical first 24-48 hours before authority transfer

### Mainnet Signer Setup (Stage 7)
- 1 file keypair (script proposer, encrypted at rest on primary machine) + 1 browser wallet (Phantom on separate device) + 1 Ledger hardware wallet
- File keypair used by setup-squads.ts and transfer-authority.ts to propose transactions
- Browser wallet and Ledger approve proposals via Squads web UI (app.squads.so) — no CLI Ledger signing needed
- setup-squads.ts creates the multisig with all 3 pubkeys upfront

### Claude's Discretion
- Exact ordering of verification steps within the joint review checkpoint
- graduate.ts pre-graduation check implementation (extend verify.ts or standalone script)
- Error handling and retry strategy for mainnet transactions (priority fees, confirmation strategy)
- Post-graduation crank startup verification steps

</decisions>

<specifics>
## Specific Ideas

- Pre-deploying 3-5 days in advance minimizes launch-day pressure — Stage 5 is the only launch-day action
- The all-or-nothing curve fill philosophy means no backup plan beyond the built-in refund path — user fully accepts this outcome
- The 24-48 hour window before authority transfer is a safety net — deployer can hot-fix if something goes wrong before locking down governance
- Signer architecture is clean: script proposes, humans approve via web UI. No complex CLI Ledger integration needed

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/deploy/stage-{0..7}-*.sh`: 8 independently-runnable stage scripts (Phase 98)
- `scripts/deploy/deploy-all.sh`: Orchestrator that calls stages 0-4 sequentially
- `scripts/deploy/verify.ts`: 36-check deep verification against deployment.json
- `scripts/deploy/initialize.ts`: 23-step idempotent initialization
- `scripts/graduation/graduate.ts`: 11-step graduation orchestrator with checkpoint/resume
- `scripts/deploy/setup-squads.ts`: Squads multisig creation script
- `scripts/deploy/transfer-authority.ts`: Authority transfer to Squads vault
- `scripts/deploy/verify-authority.ts`: Authority verification post-transfer
- `Docs/mainnet-deploy-checklist.md`: Exhaustive checklist validated by fresh devnet deploy
- `Docs/mainnet-governance.md`: Step-by-step governance procedure

### Established Patterns
- Stage scripts are self-contained with GO/NO-GO gates between each
- `set -a && source .env.mainnet && set +a` for env loading
- Two-pass deploy eliminated when mint keypairs exist before build (Stage 0 handles)
- Idempotent scripts with checkpoint/resume (initialize.ts, graduate.ts)
- Preflight safety gate catches: keypairs in git staging, missing env vars, insufficient balance, hash mismatches

### Integration Points
- `deployments/mainnet.json`: Canonical address source (written by deploy pipeline, consumed by everything)
- `.env.mainnet`: Mainnet credentials (Helius keys, wallet paths, cluster URL)
- `keypairs/mainnet-*-mint.json`: Vanity mint keypairs (cRiME, FraUd, pRoFiT)
- `~/mainnet-keys/deployer.json`: Mainnet deployer wallet (outside git)
- Railway mainnet services: web + crank + Postgres (provisioned by Phase 98.1)
- fraudsworth.fun domain (configured by Phase 98.1)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 100-deploy-to-mainnet*
*Context gathered: 2026-03-15*
