# Phase 109: Public Push + Mainnet Vault Upgrade + Announcement - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Sync the public GitHub repo with v1.5 changes (crank hardening, vault convert-all, Phase 108 remediation, audit updates), deploy convert_v2 to mainnet via Squads governance, verify with mainnet smoke tests, and deploy updated frontend. User handles all announcements (pre-announce and live) — Claude handles technical execution only.

</domain>

<decisions>
## Implementation Decisions

### Operation Sequencing
- **Maximum transparency approach**: Pre-announce (user) → push code to public repo → Squads upgrade → smoke test → frontend deploy → live announce (user)
- Code is public BEFORE the on-chain upgrade — community can review convert_v2 before it goes live
- User controls upgrade timing — will manually trigger when ready to be present for monitoring
- Squads timelock (1hr) must expire during user's waking hours so they can approve and monitor

### Public Repo Sync Scope
- **Included in this push**: Phase 105 (crank hardening), Phase 106 (vault convert-all), Phase 108 (zAuth remediation), updated audit reports (.audit/, .bulwark/, SECURITY_AUDIT_SUMMARY.md)
- **Excluded**: Phase 107 (Jupiter SDK) — held for separate push when submitted to Jupiter team
- **Single squashed commit**: One commit covering all v1.5 changes, same approach as Phase 104's initial push
- **Sanitization**: Full Docs/public-push-checklist.md 6-phase sanitization — no shortcuts, every pass must be clean
- Last public push was commit 946703f (v1.4 milestone)

### Mainnet Upgrade Process
- **Only conversion-vault program is upgraded** — all other programs unchanged
- **convert_v2 is additive** — existing convert instruction untouched, zero-downtime upgrade
- **Squads 2-of-3 with 1hr timelock** — standard governance flow proven in Phase 97
- **Crank keeps running during upgrade** — crank has zero interaction with conversion vault
- **Frontend deploy after program upgrade confirmed** — Railway mainnet service updated to use convert_v2

### Mainnet Smoke Testing
- **Checkpoint wave**: User tests all 8 multi-hop routes at small size (0.05 SOL), reports back with TX signatures
- **Blowfish gate**: Someone simulates a 40+ SOL multi-hop in Phantom (preview only, not executed). Must show NO intermediate token leakage in wallet preview
- **Claude verifies**: Reviews all TX signatures against expected behavior (correct amounts, no intermediate tokens, no errors)
- **If Blowfish gate fails**: Investigate before reverting. Keep convert_v2 live (backwards compatible), diagnose whether issue is program-side or client-side

### Announcements
- **Entirely user-managed** — user handles pre-announcement, live announcement, channel selection, messaging
- Claude prepares no announcement content unless asked
- No specific dates or timelines committed in any technical artifacts

### Claude's Discretion
- Exact file selection for public repo sync (which changed files to copy)
- Sanitization pass order and tooling
- Squads proposal construction (program buffer, upgrade instruction encoding)
- Mainnet build pipeline details (build flags, binary verification)
- Smoke test checklist format and verification criteria

</decisions>

<specifics>
## Specific Ideas

- User wants the smoke test structured as a "wave checkpoint" where they report back TX signatures and Claude double-checks each one
- "Max transparency is always the best option" — code public before upgrade is a core value
- Pre-announcement is user's territory — don't worry about announcement content
- User can't afford large swap sizes personally — will have someone else simulate the 40+ SOL Blowfish test (simulation only, not executed)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Docs/public-push-checklist.md`: Comprehensive 6-phase sanitization checklist (secret scanning, dangerous files, audit findings deep scan, personal info, known secrets cross-check, final gate)
- `scripts/deploy/test-upgrade.ts`: Existing Squads upgrade test script from Phase 97
- `scripts/deploy/verify-authority.ts`: Authority verification script
- `scripts/deploy/stage-7-governance.sh`: Governance stage script for Squads operations
- `/tmp/drfraudsworth-public`: Public repo staging directory (last push: commit 946703f)

### Established Patterns
- Phase 104 curated copy approach: selective file copy from private to public repo, fresh .gitignore, zero git history leakage
- Squads governance flow proven in Phase 97 on devnet (2 complete upgrade + revert cycles documented)
- Phase 106 devnet verification: 8/8 routes verified with zero intermediate token leakage

### Integration Points
- Railway mainnet service (mainnet-web-production.up.railway.app) needs NEXT_PUBLIC_CLUSTER=mainnet + updated deployment
- Public repo (MetalLegBob/drfraudsworth) at /tmp/drfraudsworth-public
- Squads vault PDA for mainnet upgrade proposal
- Conversion vault program: `5uaw...` (mainnet program ID from Phase 95 deploy)

</code_context>

<deferred>
## Deferred Ideas

- Jupiter SDK public push — separate push when Phase 107 is complete and submitted to Jupiter
- GitHub release tag (v1.5.0) — could be added to the public repo push but not discussed as a priority
- Docs site changelog/banner — user may want this but will handle announcements themselves

</deferred>

---

*Phase: 109-public-push-mainnet-vault-upgrade-announcement*
*Context gathered: 2026-03-26*
