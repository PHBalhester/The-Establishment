# Document Manifest

> This manifest is the master index. If a doc is not listed here, it is either archived or orphaned.

## Spec -- Protocol Behavior Documentation

| File | Purpose | Last Verified |
|------|---------|---------------|
| [architecture.md](architecture.md) | System architecture: CPI composition, component boundaries, data flow, infrastructure | 2026-03-08 |
| [data-model.md](data-model.md) | PDA derivation tree, account layouts, entity relationships across programs | 2026-03-08 |
| [token-economics-model.md](token-economics-model.md) | Unified CRIME/FRAUD/PROFIT economic model: tax flows, rewards sources, Carnage redistribution | 2026-03-08 |
| [cpi-interface-contract.md](cpi-interface-contract.md) | Explicit CPI interface definitions: instruction signatures, required accounts, expected state | 2026-03-08 |
| [frontend-spec.md](frontend-spec.md) | Pages, components, user flows, state management, SSE, wallet integration | 2026-03-08 |
| [security-model.md](security-model.md) | Threat model, access control matrix, attack surface analysis | 2026-03-08 |
| [error-handling-playbook.md](error-handling-playbook.md) | Unified error catalog across all 7 programs with codes, causes, recovery steps | 2026-03-08 |
| [account-layout-reference.md](account-layout-reference.md) | Byte-level account layouts for all PDAs, size calculations, field offsets | 2026-03-08 |
| [token-interaction-matrix.md](token-interaction-matrix.md) | Token pair interaction map: which hooks fire, Token-2022 vs SPL Token edge cases | 2026-03-08 |
| [Bonding_Curve_Spec.md](Bonding_Curve_Spec.md) | Bonding curve mechanics: linear pricing, dual-curve coupling, graduation, refunds | 2026-03-08 |
| [carnage-spec.md](carnage-spec.md) | Carnage Fund: 6 execution paths, shared module, CPI depth chain, slippage floors | 2026-03-08 |
| [epoch-spec.md](epoch-spec.md) | Epoch/VRF: full lifecycle, anti-reroll, epoch skip safety, retry recovery | 2026-03-08 |
| [tax-spec.md](tax-spec.md) | Tax Program: buy/sell paths, sell floor propagation, pool reader is_reversed | 2026-03-08 |
| [transfer-hook-spec.md](transfer-hook-spec.md) | Transfer Hook: whitelist PDA, ExtraAccountMetaList, 4 accounts per mint | 2026-03-08 |
| [upgrade-cascade.md](upgrade-cascade.md) | CPI dependency graph, breaking change categories, safe upgrade order | 2026-03-08 |
| [project-overview.md](project-overview.md) | Unified "what is this system" overview synthesizing all specs | 2026-03-08 |

## Audit -- Security Findings

| File | Purpose | Last Verified |
|------|---------|---------------|
| [VULNHUNTER-AUDIT-2026-03-05.md](VULNHUNTER-AUDIT-2026-03-05.md) | Automated security audit: 56 requirements, 246 plans verified | 2026-03-07 |
| [SFK.md](SFK.md) | Security Fortress Knowledge: hardening findings and remediations | 2026-03-05 |
| [SECURITY_TESTS.md](SECURITY_TESTS.md) | Attack simulation test results and security test coverage | 2026-02-09 |

## Operational -- Deployment and Operations

| File | Purpose | Last Verified |
|------|---------|---------------|
| [deployment-sequence.md](deployment-sequence.md) | Full deployment pipeline: build, deploy, initialize, verify steps | 2026-03-08 |
| [operational-runbook.md](operational-runbook.md) | VRF cranking, crank runner config, devnet SOL management, troubleshooting | 2026-03-08 |
| [oracle-failure-playbook.md](oracle-failure-playbook.md) | Switchboard VRF failure modes: detection, automated recovery, manual intervention | 2026-02-22 |
| [mainnet-checklist.md](mainnet-checklist.md) | Devnet-to-mainnet switch points and pre-launch checklist | 2026-02-27 |
| [mainnet-readiness-assessment.md](mainnet-readiness-assessment.md) | Go/no-go assessment consolidating checklist and reconciliation findings | 2026-03-08 |
| [Compute_Budget_Profile.md](Compute_Budget_Profile.md) | CU usage per instruction, budget optimization analysis | 2026-03-08 |

## Reference -- Project Context

| File | Purpose | Last Verified |
|------|---------|---------------|
| [PROJECT_BRIEF.md](PROJECT_BRIEF.md) | High-level project brief and vision statement | 2026-03-08 |
| [liquidity-slippage-analysis.md](liquidity-slippage-analysis.md) | Slippage under various liquidity scenarios, Carnage rebalancing worst-case analysis | 2026-02-26 |
| [edge-case-audit.md](edge-case-audit.md) | Edge case inventory with coverage status and test references | 2026-03-08 |

## Other Directories

| Path | Purpose |
|------|---------|
| `Docs/DECISIONS/` | Architectural decision records (10 files: amm-design, cpi-architecture, security, etc.) |
| `Docs/archive/` | Archived historical documents (see below) |

## Archived Files (Docs/archive/)

Files moved from active Docs/ to archive. Preserved for historical reference but no longer maintained.

| File | Reason for Archival |
|------|---------------------|
| AMM_Implementation.md | Superseded by architecture.md and cpi-interface-contract.md |
| Carnage_Fund_Spec.md | Superseded by carnage-spec.md |
| Carnage_Bug_Investigation.md | One-time bug investigation (resolved) |
| CODERECON_CONTEXT.md | One-time code reconnaissance context |
| DBS-base-profit-redesign.md | Implemented PROFIT redesign (historical) |
| Deployment_Sequence.md | Superseded by deployment-sequence.md (rewritten) |
| Devnet_Deployment_Report.md | Phase 69 deployment report (historical) |
| DrFraudsworth_Overview.md | Superseded by project-overview.md |
| E2E_Devnet_Test_Report.md | Phase 69 end-to-end test report (historical) |
| Epoch_State_Machine_Spec.md | Superseded by architecture.md and cpi-interface-contract.md |
| Infrastructure_Cost_Analysis_2026.md | Cost analysis snapshot (historical) |
| installed-ai-skills-guide.md | Internal AI tooling guide (not protocol spec) |
| Jupiter_DEX_Integration_Roadmap.md | Future planning doc (deferred) |
| New_Yield_System_Spec.md | Superseded by token-economics-model.md |
| Overnight_Report.md | One-time overnight run report (historical) |
| Protocol_Initialzation_and_Launch_Flow.md | Superseded by deployment-sequence.md |
| RECONCILIATION_REPORT.md | One-time spec reconciliation (historical) |
| redeploy-schedule.md | Phase 69 redeploy schedule (historical) |
| Soft_Peg_Arbitrage_Spec.md | Superseded by token-economics-model.md |
| SolanaSetup.md | Dev environment setup (historical) |
| Spec_vs_Implementation_Reconciliation.md | One-time reconciliation (historical) |
| STATE.json | Stale state file (superseded by .planning/STATE.md) |
| Tax_Pool_Logic_Spec.md | Superseded by tax-spec.md |
| Token_Program_Reference.md | Superseded by token-interaction-matrix.md |
| Transfer_Hook_Spec.md | Superseded by transfer-hook-spec.md |
| v1.1-asset-spec.md | v1.1 asset spec (shipped milestone, historical) |
| VRF_Devnet_Validation_Report.md | VRF validation report (historical) |
| VRF_Implementation_Reference.md | Superseded by oracle-failure-playbook.md |
| VRF_Migration_Lessons.md | One-time migration lessons (historical) |
| Yield_System_Spec_OLD.md | Deprecated yield system spec |
