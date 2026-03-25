# Phase 51: Program Rebuild & Devnet Deploy - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix all 37 failing tests (19 AMM, 10 Tax, 8 Epoch), build all 5 programs with devnet feature flags, fresh-deploy to devnet with new program IDs, initialize the full protocol (pools, staking, epoch system), verify all Phase 46-50 security hardening fixes on-chain, run Carnage hunter with atomic bundle verification, and restart the continuous runner on the new deployment.

Token metadata (placeholder names/logos/socials) is included in this deploy. Bonding curve and frontend integration are future phases.

</domain>

<decisions>
## Implementation Decisions

### Test fix strategy
- All 37 failures are expected from Phase 46-50 code changes -- update test expectations to match new code (code is authoritative)
- Fix tests per-program with a commit per program: AMM tests -> commit, Tax tests -> commit, Epoch tests -> commit
- Full regression sweep: run ALL test suites (staking.ts, security.ts, token-flow.ts, Rust unit tests) after fixing the 37 to catch hidden breakage
- When fixing a test that needs new accounts (e.g., sell_tax_wsol_intermediary), also extend coverage to assert the new behavior those accounts enable

### Deployment & state
- Fresh deploy from scratch -- not upgrade in-place. Too many struct changes from Phases 46-50.
- Fresh program IDs for all 5 programs (new keypairs). Fully clean slate.
- New ALT generated with the new program addresses and all derived PDAs
- Smaller LP sizing: ~2 SOL per pool (CRIME/SOL and FRAUD/SOL) to enable meaningful price movement for practicing arbitrage
- Placeholder token metadata (names, logos, website, socials) -- real assets go in at final deploy
- One more final devnet redeploy planned when frontend and bonding curve are finished

### On-chain verification
- Verify ALL Phase 46-50 hardening fixes on-chain, not just the 3 listed in success criteria:
  - Phase 46: fake staking_escrow, fake amm_program, non-Switchboard randomness all revert
  - Phase 48: sell tax deducted from WSOL output (user with low SOL can sell)
  - Phase 49: minimum output floor rejects zero-slippage swaps
  - Phase 50: VRF bounty payment transfers SOL to triggerer
- Run Carnage hunter (all 6 paths: BuyOnly+Burn+Sell x CRIME+FRAUD)
- Verify atomic bundle on-chain: VRF reveal+consume+executeCarnageAtomic in single v0 TX (was missing from last deploy)
- Update continuous runner scripts with new program IDs and restart
- Confirm 10+ epoch transitions on redeployed programs

### Build pipeline
- Claude's Discretion: update build.sh to handle tax_program devnet feature flag alongside epoch_program
- Claude's Discretion: regenerate IDLs and sync to app/src/idl/ if they differ from committed versions
- Claude's Discretion: fix warnings in our code, accept upstream crate warnings we can't control
- Claude's Discretion: determine right level of deploy script automation (all-in-one vs separate scripts)

</decisions>

<specifics>
## Specific Ideas

- "Use less SOL for the two LPs than we did last time so that we can effect the pools more and practise arbitrage"
- "The atomic bundle was missing from the last deploy" -- must be verified this time
- Plan for one final devnet redeploy when frontend + bonding curve are done

</specifics>

<deferred>
## Deferred Ideas

- Bonding curve implementation -- future milestone
- Frontend integration with new program IDs -- future phase
- Real token metadata assets (logos, socials) -- final deploy
- Vanity program addresses -- noted in STATE.md pending todos

</deferred>

---

*Phase: 51-program-rebuild-devnet-deploy*
*Context gathered: 2026-02-20*
