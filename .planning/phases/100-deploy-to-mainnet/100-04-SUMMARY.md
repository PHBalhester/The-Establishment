---
phase: 100-deploy-to-mainnet
plan: 04
subsystem: infra
tags: [mainnet, governance, squads, multisig, authority-transfer, timelock, solana]

# Dependency graph
requires:
  - phase: 100-03
    provides: Protocol live on mainnet, trading active, crank running
  - phase: 97-squads-governance
    provides: Squads scripts (setup-squads.ts, transfer-authority.ts, verify-authority.ts), devnet-proven workflow
provides:
  - Squads 2-of-3 multisig on mainnet (vault PDA 4SMcPtix...)
  - 11 authorities transferred to Squads vault (6 program upgrades, 2 admin PDAs, 3 metadata)
  - Deployer confirmed unable to upgrade unilaterally
  - Bonding curve program closed (immutable, rent reclaimed ~4.73 SOL)
  - Mainnet deployment COMPLETE
affects: [101, 103]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Squads 2-of-3 mainnet: 1 file keypair (proposer) + 2 Ledger signers"
    - "3600s (1hr) initial timelock -- progressive escalation schedule"
    - "Closed BC program: upgrade authority N/A (immutable), BcAdminConfig transfer N/A (program closed)"

key-files:
  created: []
  modified:
    - deployments/mainnet.json
    - Docs/mainnet-deploy-checklist.md

key-decisions:
  - "Timelock set to 3600s (1 hour), not 900s (15 min) as originally planned -- stability already confirmed"
  - "Bonding curve program closed before Squads transfer -- rent reclaimed, program immutable"
  - "11 authorities transferred (not 13): BC upgrade and BcAdminConfig are N/A due to closed program"
  - "Authorities transferred NOT burned -- per project authority strategy"

patterns-established:
  - "Authority count: 11 active (6 program upgrades + 2 admin PDAs + 3 metadata), 2 N/A (closed BC)"
  - "Timelock progression: 1hr -> 24hr -> 7d -> BURN (post-audit)"

# Metrics
duration: ~multi-session
completed: 2026-03-25
---

# Phase 100 Plan 04: Execute Stage 7 (Governance) Summary

**Squads 2-of-3 multisig created on mainnet with 3600s timelock, 11 authorities transferred to vault (6 program upgrades + AMM AdminConfig + WhitelistAuthority + 3 metadata), deployer confirmed locked out -- mainnet deployment COMPLETE**

## Performance

- **Duration:** Multi-session (stability observation + authority transfer)
- **Tasks:** 3 (1 decision gate, 1 auto, 1 human-verify)

## Accomplishments

- Created Squads 2-of-3 multisig on mainnet
  - Multisig PDA: F7axBNUgWQQ33ZYLdenCk5SV3wBrKyYz9R7MscdPJi1A
  - Vault PDA: 4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ
  - Threshold: 2-of-3, Timelock: 3600s (1 hour)
  - Signer 1: Ckw8hHnP... (file keypair, proposer)
  - Signer 2: 63LLDG... (mlbob's Ledger)
  - Signer 3: 66kDYp... (third party Ledger)
- Transferred 11 authorities to Squads vault:
  - 6 program upgrade authorities (AMM, Hook, Tax, Epoch, Staking, Vault)
  - AMM AdminConfig admin
  - WhitelistAuthority admin
  - 3 metadata update authorities (CRIME, FRAUD, PROFIT mints)
- BC-related authorities N/A:
  - BC upgrade authority: program was closed (immutable) -- rent reclaimed ~4.73 SOL
  - BcAdminConfig transfer: FAILED as expected (UnsupportedProgramId -- program closed)
- Deployer confirmed unable to upgrade unilaterally (negative test passed)
- Mainnet deployment COMPLETE -- all 8 stages (0-7) executed

## Task Commits

1. **Task 1: Stability confirmation decision** - N/A (decision checkpoint, approved)
2. **Task 2: Execute Stage 7 (Squads + authority transfer)** - executed across sessions
3. **Task 3: Final verification checkpoint** - N/A (human-verify, mainnet-live confirmed)

## Squads Configuration

| Property | Value |
|----------|-------|
| Multisig PDA | F7axBNUgWQQ33ZYLdenCk5SV3wBrKyYz9R7MscdPJi1A |
| Vault PDA | 4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ |
| Threshold | 2-of-3 |
| Timelock | 3600s (1 hour) |

## Authority Transfer Results

| Authority | Status | Notes |
|-----------|--------|-------|
| AMM upgrade | Transferred | Vault PDA |
| Transfer Hook upgrade | Transferred | Vault PDA |
| Tax Program upgrade | Transferred | Vault PDA |
| Epoch Program upgrade | Transferred | Vault PDA |
| Staking upgrade | Transferred | Vault PDA |
| Conversion Vault upgrade | Transferred | Vault PDA |
| Bonding Curve upgrade | N/A | Program closed (immutable) |
| AMM AdminConfig | Transferred | Vault PDA |
| WhitelistAuthority | Transferred | Vault PDA |
| BcAdminConfig | N/A | Program closed (UnsupportedProgramId) |
| CRIME metadata | Transferred | Vault PDA |
| FRAUD metadata | Transferred | Vault PDA |
| PROFIT metadata | Transferred | Vault PDA |

**Result: 11/11 transferable authorities transferred. 2 N/A (closed BC program).**

## Deviations from Plan

### Scope Adjustments

**1. Timelock set to 3600s instead of 900s**

- **Reason:** By the time Stage 7 was executed, sufficient stability had been observed. The team opted for 1-hour timelock directly (skipping the 5-minute initial window).

**2. Authority count is 11, not 13**

- **Reason:** Bonding curve program was closed to reclaim ~4.73 SOL rent before authority transfer. This made BC upgrade authority (immutable) and BcAdminConfig transfer (program gone) both N/A. This is expected and documented.

---

**Total deviations:** 2 scope adjustments (both intentional)
**Impact on plan:** No negative impact. Reduced authority count is expected given closed BC program.

## Decisions Made

- Timelock at 3600s (1hr) initial -- stability already confirmed by observation period
- BC program closed before transfer -- rent reclaimed, program no longer needed post-graduation
- 11 authorities transferred (not 13) -- 2 N/A due to closed program
- No authorities burned -- all held by Squads vault per project authority strategy

## Issues Encountered

- BcAdminConfig transfer returned UnsupportedProgramId -- expected since BC program was closed. Not a failure.

## Timelock Progression Schedule

| Milestone | Timelock | Rationale |
|-----------|----------|-----------|
| Launch (current) | 3600s (1 hr) | Stability confirmed |
| +1 week | 3600s (1 hr) | Or extend to 24hr if stable |
| +1 month | 86400s (24 hr) | Routine operations |
| +3 months | 604800s (7 days) | Community governance maturity |
| Post-audit | BURN | After external audit funded and completed |

## Next Phase Readiness

- MAINNET DEPLOYMENT IS COMPLETE
- All authorities under Squads governance
- Protocol fully operational: trading, staking, epochs, carnage
- Phase 101 (verified builds, IDL upload) can proceed when ready
- Phase 103 (off-chain security hardening) can proceed independently

---
*Phase: 100-deploy-to-mainnet*
*Completed: 2026-03-25*
