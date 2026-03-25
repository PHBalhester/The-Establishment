---
phase: 69-devnet-ecosystem-relaunch
plan: 02
subsystem: infra
tags: [solana, devnet, deploy, initialize, token-2022, amm, conversion-vault, alt, pda]

# Dependency graph
requires:
  - phase: 69-01
    provides: 6 compiled .so artifacts with --devnet feature flags, clean mint-keypairs dir, fixed tax split
  - phase: DBS phases 1-7
    provides: Conversion vault program, tax split update, PROFIT pool removal
provides:
  - 6 programs deployed and executable on devnet
  - 3 Token-2022 mints with MetadataPointer and TransferHook extensions (CRIME, FRAUD, PROFIT)
  - 2 SOL pools initialized with 2.5 SOL + 290M tokens each
  - Conversion Vault with 250M CRIME + 250M FRAUD + 20M PROFIT
  - 10 whitelist entries for all protocol token accounts
  - Epoch state, staking pool, carnage fund initialized
  - Mint authorities burned for all 3 mints
  - PDA manifest at scripts/deploy/pda-manifest.json
  - ALT with 46 protocol addresses at scripts/deploy/alt-address.json
affects: [69-03 frontend update, 69-04 e2e validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-pass deploy: first deploy -> init mints/pools -> rebuild with patched mints -> re-deploy feature-flagged programs"
    - "Protocol-wide ALT with 46 addresses for v0 transaction compression"
    - "Idempotent initialize.ts: re-runnable, skips completed steps"

key-files:
  created:
    - scripts/deploy/pda-manifest.json
    - scripts/deploy/alt-address.json
    - scripts/deploy/mint-keypairs/crime-mint.json
    - scripts/deploy/mint-keypairs/fraud-mint.json
    - scripts/deploy/mint-keypairs/profit-mint.json
    - scripts/deploy/deployment-report.md
  modified: []

key-decisions:
  - "Two-pass deploy required: vault/tax/epoch programs need correct mint addresses compiled in via --devnet feature flag"
  - "2.5 SOL per pool seed liquidity (conserves devnet SOL)"
  - "All 20M PROFIT to vault, no pre-seeded StakeVault"
  - "Fresh admin token accounts on third run after stale accounts from first run caused failures"

patterns-established:
  - "Deploy sequence: deploy-all.sh -> initialize.ts -> build.sh --devnet -> re-deploy 3 programs -> verify.ts -> alt-helper.ts"

# Metrics
duration: 5min
completed: 2026-02-26
---

# Phase 69 Plan 02: Deploy and Initialize Summary

**Full devnet deployment: 6 programs, 3 Token-2022 mints, 2 SOL pools (2.5 SOL each), conversion vault (250M CRIME + 250M FRAUD + 20M PROFIT), 10 whitelist entries, epoch/staking/carnage initialized, ALT with 46 addresses -- 39/39 verification checks pass**

## Performance

- **Duration:** ~5 min (verification + ALT creation steps executed here; deployment + initialization completed in prior sessions)
- **Started:** 2026-02-26T21:37:13Z
- **Completed:** 2026-02-26T21:41:00Z
- **Tasks:** 2 (1 human checkpoint + 1 auto)
- **Files modified:** 0 code files (on-chain deployment operations + planning docs only)

## Accomplishments
- 6 programs deployed and executable on devnet (AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault)
- 3 Token-2022 mints created with MetadataPointer + TransferHook extensions, authorities burned
- 2 SOL liquidity pools initialized (CRIME/SOL: 2.5 SOL + 290M CRIME, FRAUD/SOL: 2.5 SOL + 290M FRAUD)
- Conversion Vault funded with 250M CRIME + 250M FRAUD + 20M PROFIT
- 10 whitelist entries covering all pool vaults, stake vault, carnage vaults, and conversion vault token accounts
- Epoch state, staking pool, carnage fund, carnage WSOL all initialized
- verify.ts: 39/39 checks PASS, 0 failures
- Protocol-wide ALT created with 46 addresses for v0 transaction compression
- PDA manifest generated with all addresses for downstream consumers

## Deployed Protocol State

### Programs (6)
| Program | Address |
|---------|---------|
| AMM | `5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj` |
| Transfer Hook | `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce` |
| Tax Program | `DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj` |
| Epoch Program | `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz` |
| Staking | `EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu` |
| Conversion Vault | `6WwVAc12B5x8gukgNyXa4agUyvi9PxdYTdPdnb9qEWFL` |

### Mints (3)
| Mint | Address |
|------|---------|
| CRIME | `8NEgQvt8fkhjCLw3Zub8cPGAF7BBSCFC8oNVPyjs1wPT` |
| FRAUD | `76ddoHyn3sLpbBdLNZ7PNKJShycPUfaact7qiGLpV2rF` |
| PROFIT | `7X6xxGxzJuShgRDHDXU1W9knXJX4VroPtNwd2QLH13Um` |

### Pools (2)
| Pool | Address | Reserves |
|------|---------|----------|
| CRIME/SOL | `HTgTKMZUgsLkqGmaDVG9iygsrL76753RDLcEK4qqmgps` | 2.5 SOL + 290M CRIME |
| FRAUD/SOL | `B5CofRUdxDo4cXZby3VioraZeF8tJNgEyPBGN5BYJbvN` | 2.5 SOL + 290M FRAUD |

### Conversion Vault
| Account | Address | Balance |
|---------|---------|---------|
| VaultConfig | `DKajwQ8SFrQvDuocZfaxosBkZHbp6uV74dnzGRZc328o` | - |
| VaultCrime | `3tEuiFbjovVQJ8qHUECqCAQH9M7DJCoTbt9oYT3DVB6z` | 250M CRIME |
| VaultFraud | `4MyP655Wvuqm1cPQi9wWcjZpERoTF8dUBm9u8uzpi9kT` | 250M FRAUD |
| VaultProfit | `D63NbW4a9tsuh9qCEcu2FuJcZB4K7ELufmuPjck58LWV` | 20M PROFIT |

### Key PDAs
| PDA | Address |
|-----|---------|
| AdminConfig | `CggwKL3RH7k2PkWuFce6cPo1Hna428kD6SLxgSuPSyE9` |
| WhitelistAuthority | `23d4GXjahWZirY1JNYsVcFzQ2LurTJeoaDumRbzAfLi5` |
| EpochState | `6716g7hsQiaPAf9jhXJ42HXrisAx8xMpifn6Yu4u15AS` |
| StakePool | `G7FsjDYC2gQwFVAG5LGzCqrTWqbEzap2mxdRsBdLvoPK` |
| CarnageFund | `HzfNk1XkqUADxDZeUvsKNoEXYSFHieAZ738zgT3vtwUn` |
| CarnageWSol | `3BfadNCGacSCZAZhqctd9WcuhKdJfpSLmiumqNTgwSu9` |

### ALT
| Item | Value |
|------|-------|
| Address | `BjLU4DQgJVqpr6X3fAssnXNcj9cmENVw1xPMova3KigA` |
| Addresses | 46 |
| Network | devnet |

## Task Commits

This plan involved on-chain deployment operations (no code file changes):

1. **Task 1: Stop Railway crank runner** - Human checkpoint (completed by user)
2. **Task 2: Deploy, initialize, verify, create ALT** - On-chain operations (no git commit for on-chain work)

**Plan metadata:** (this commit)

## Files Created/Modified
- `scripts/deploy/pda-manifest.json` - All PDA addresses for the fresh deployment
- `scripts/deploy/alt-address.json` - New ALT address cache (46 addresses)
- `scripts/deploy/mint-keypairs/crime-mint.json` - New CRIME mint keypair
- `scripts/deploy/mint-keypairs/fraud-mint.json` - New FRAUD mint keypair
- `scripts/deploy/mint-keypairs/profit-mint.json` - New PROFIT mint keypair
- `scripts/deploy/deployment-report.md` - Verification report (39/39 pass)

Note: All above files are gitignored (keypairs/secrets) or deployment artifacts. No source code was modified.

## Decisions Made
- **Two-pass deploy approach:** Programs must be deployed first so mints can be created, then programs rebuilt with correct mint addresses compiled in via `--devnet` feature flag, then re-deployed. This is inherent to the Anchor devnet feature flag pattern.
- **Fresh admin token accounts on third run:** Stale admin token accounts from the first initialization attempt (which used old mints) caused failures on the second run. Third run created fresh admin accounts, completing successfully.

## Deviations from Plan

### Deployment Required Three Runs

**1. Vault init failed on first attempt (stale hardcoded mint addresses)**
- **Issue:** After first deploy + init steps 1-7 (mints, pools), the conversion vault and tax/epoch programs still had stale mint addresses compiled in. Vault initialization failed because on-chain constants didn't match the newly-created mints.
- **Resolution:** Rebuilt with `build.sh --devnet` (which runs `patch-mint-addresses.ts` to inject new mint pubkeys into constants.rs), then re-deployed the 3 feature-flagged programs (tax, epoch, vault). Second run of initialize.ts completed steps 8-17.

**2. Step 10 failed on second run (stale admin token accounts)**
- **Issue:** Admin token accounts created during the first init run (for old mints that no longer existed after fresh mint generation) caused the second run to fail at step 10.
- **Resolution:** Third run of initialize.ts created fresh admin accounts and completed all 17 steps successfully. The script's idempotent design (skip completed steps) handled this gracefully.

---

**Total deviations:** 2 (both deployment sequencing issues, resolved by re-running idempotent init script)
**Impact on plan:** No impact on final state. The two-pass deploy pattern is documented as an established pattern for future deploys.

## Issues Encountered
- The `alt-helper.ts` script is a library module without a `main()` entrypoint. Required an inline tsx runner to invoke `getOrCreateProtocolALT()` with the correct provider and manifest. Not a blocker -- resolved in seconds.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 programs deployed and verified on devnet -- ready for frontend update (69-03)
- PDA manifest at `scripts/deploy/pda-manifest.json` has all addresses for `shared/constants.ts` update
- ALT at `BjLU4DQgJVqpr6X3fAssnXNcj9cmENVw1xPMova3KigA` ready for frontend v0 transactions
- New mints: CRIME=`8NEgQvt8fkhjCLw3Zub8cPGAF7BBSCFC8oNVPyjs1wPT`, FRAUD=`76ddoHyn3sLpbBdLNZ7PNKJShycPUfaact7qiGLpV2rF`, PROFIT=`7X6xxGxzJuShgRDHDXU1W9knXJX4VroPtNwd2QLH13Um`
- Crank runner needs restarting with new addresses (part of 69-03 or 69-04)

---
*Phase: 69-devnet-ecosystem-relaunch*
*Completed: 2026-02-26*
