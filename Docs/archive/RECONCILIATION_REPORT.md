---
docs_reviewed: 15
decisions_traced: 80
conflicts_found: 18
gaps_identified: 30
verification_items: 16
status: complete
---

# Reconciliation Report

> **Historical Note:** This reconciliation was performed pre-vault migration (February 2026). PROFIT pool references below reflect the state at reconciliation time. PROFIT AMM pools have since been replaced by a fixed-rate conversion vault. See [DBS-base-profit-redesign.md](DBS-base-profit-redesign.md) for migration details.

## Summary

The 15-document suite is comprehensive and well-structured — the vast majority of the 80 interview decisions are reflected across the documentation. However, the reconciliation identified **3 critical conflicts** (wrong program IDs, contradictory tax field descriptions, unclear PROFIT pool tax status), **7 high-severity conflicts** (wrong token supply, VRF byte threshold errors, stale program IDs, logic errors), and **30 documentation gaps** ranging from missing security analysis to undocumented operational procedures. Additionally, **16 verification items** need resolution before the documentation can be considered authoritative.

---

## Pass 1: Completeness (80/80 decisions traced)

All 80 decisions from the 10 DECISIONS files were traced across all 15 documents via 5 parallel reconciliation agents. Each decision appears in at least one document. Coverage by decision category:

| Category | Decisions | Fully Covered | Partially Covered | Notes |
|----------|-----------|---------------|-------------------|-------|
| Architecture | 5 | 5 | 0 | Excellent — all reflected in architecture + project-overview |
| Token Model | 10 | 8 | 2 | D8 (volume floor thesis) and D10 (1% treasury) partial |
| Account Structure | 4 | 4 | 0 | Good coverage across data-model + account-layout |
| CPI Architecture | 6 | 6 | 0 | Fully documented in cpi-interface-contract |
| AMM Design | 8 | 8 | 0 | Well covered across multiple docs |
| Security | 14 | 14 | 0 | Comprehensive across security-model + mainnet-readiness |
| Frontend | 12 | 12 | 0 | All reflected in frontend-spec |
| Operations | 7 | 7 | 0 | Covered in operational-runbook + deployment-sequence |
| Error Handling | 9 | 7 | 2 | D5 (concurrent Carnage) + D6 (staking race) only partial |
| Testing | 5 | 3 | 2 | D3 (devnet runbooks) + D4 (coverage philosophy) partial |
| **TOTAL** | **80** | **74** | **6** | **No decisions fully missing** |

### Partially Covered Decisions (6)

These decisions appear but lack full rationale or context:

1. **TM-D8** (Volume floor thesis): Mentioned in project-overview but arbitrage mechanics not fully elaborated
2. **TM-D10** (1% treasury operational use): Referenced but purpose not detailed in any doc
3. **EH-D5** (Concurrent Carnage + user swap): Implied via PoolLocked error but runtime serialization guarantee not explicit
4. **EH-D6** (Staking epoch race non-existent): Mentioned in defense-in-depth table but conclusion not explicitly stated
5. **Test-D3** (Devnet tests as manual runbooks): Referenced but not formally labeled as such
6. **Test-D4** (Philosophy-based coverage): Numbers cited but philosophy (no percentage target) not named

---

## Pass 2: Consistency (18 conflicts found)

### CRITICAL (3)

**CONFLICT C1: EpochState Tax Fields — Single vs Per-Token Magnitudes**
- `account-layout-reference`: Shows ONE `low_tax_bps` + ONE `high_tax_bps` in EpochState
- `token-economics-model`: Describes 4 independent per-token magnitudes (CRIME low/high, FRAUD low/high) from VRF bytes 1-4
- `oracle-failure-playbook`: Appendix B shows bytes 1-2 = CRIME, bytes 3-4 = FRAUD (per-token)
- **Impact**: Core to the tax entropy analysis and arbitrage economics thesis
- **Resolution**: Verify `epoch_state.rs` struct. One document is fundamentally wrong.

**CONFLICT C2: PROFIT Token Supply — 50M vs 1B**
- `DECISIONS/token-model.md D2`: "50,000,000 PROFIT" (50M)
- `deployment-sequence.md Step 1`: Shows PROFIT as "1,000,000,000 (1B)" in mints table
- **Impact**: If PROFIT is 1B not 50M, the entire token economics model's ratio assumptions break
- **Resolution**: Check on-chain mint supply for `8y7Mat...`. Update whichever doc is wrong.

**CONFLICT C3: PROFIT Pool Tax Status Ambiguity**
- `DECISIONS/token-model.md D9`: "PROFIT pools are untaxed"
- Tax Program has `swap_profit_buy` and `swap_profit_sell` instructions (suggesting taxation)
- `liquidity-slippage-analysis`: Flags this with NEEDS_VERIFICATION
- **Impact**: If PROFIT pools ARE taxed, all liquidity analysis PROFIT pool calculations are wrong
- **Resolution**: Read `swap_profit_buy.rs` to determine if tax rate is 0% or positive.

### HIGH (7)

**CONFLICT H1: Transfer Hook Program ID in data-model**
- `data-model.md`: References `9UyWsQ...` (stale pre-Phase 51 ID)
- Everywhere else: `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce`
- **Fix**: Update data-model.md to current ID

**CONFLICT H2: Frontend-spec IDL Program IDs Stale**
- `frontend-spec Appendix A`: Lists `zFW9mo...`, `9UyWsQ...`, `FV3kWD...`, `AH7yaW...`, `Bb8ist...`
- Current IDs: `5ANTHFtg`, `CmNyuLdM`, `DRjNCjt4`, `G6dmJTdC`, `EZFeU613`
- **Fix**: Update frontend-spec Appendix A to current program IDs

**CONFLICT H3: VRF Byte 0 Threshold — 128 vs 192**
- `operational-runbook`: "byte 0: < 128 = flip cheap side" (50% probability)
- `oracle-failure-playbook`: "byte 0: < 192 = flip cheap side" (75% probability)
- `DECISIONS/token-model.md D6`: "75% chance" for flip
- **Fix**: Verify `consume_randomness.rs`. Operational-runbook is likely wrong (should be 192 = 75%).

**CONFLICT H4: VRF Bytes 3-4 Layout**
- `operational-runbook`: Bytes 3-4 listed as "(reserved)"
- `oracle-failure-playbook`: Bytes 3-4 = FRAUD low/high magnitudes
- **Fix**: Verify `consume_randomness.rs`. Update operational-runbook.

**CONFLICT H5: WsolIntermediary Token Program**
- `data-model.md`: "Token-2022 WSOL account"
- PROJECT_BRIEF + architecture: "SPL Token for WSOL"
- **Fix**: Update data-model.md — WSOL is always SPL Token.

**CONFLICT H6: WhitelistEntry Logic — AND vs OR**
- `data-model.md`: "source AND destination" must be whitelisted
- `architecture.md` + `project-overview`: "source OR destination"
- **Fix**: data-model.md has the error. Correct to "source OR destination".

**CONFLICT H7: Tiered Timelock Duration**
- `DECISIONS/architecture.md D3`: 2hr for first 48-72 hours, then 24hr
- `deployment-sequence.md`: 2hr for "first 1-2 weeks"
- **Fix**: Update deployment-sequence to match decisions (48-72 hours, not 1-2 weeks).

### MEDIUM (5)

**CONFLICT M1: PROJECT_BRIEF 75/24/1 Labels Reversed**
- Brief says: "(pool/Carnage fund/staking)"
- Should be: "(staking/Carnage/treasury)"
- **Fix**: Swap labels in PROJECT_BRIEF.md

**CONFLICT M2: Whitelist Entry Count**
- `account-layout-reference`: "~20-30 entries"
- `token-interaction-matrix`: Enumerates exactly 14 entries
- **Fix**: Update account-layout-reference to 14.

**CONFLICT M3: PoolState Size Discrepancy**
- `account-layout-reference`: 224 bytes
- `DECISIONS/amm-design.md D2`: 223 bytes
- Manual field sum: 216 bytes
- **Fix**: Verify `pool.rs` INIT_SPACE. All three numbers might be wrong.

**CONFLICT M4: useSolPrice Data Source**
- `frontend-spec`: "Jupiter Price API v3"
- `DECISIONS/operations.md`: "CoinGecko"
- **Fix**: Check `app/hooks/useSolPrice.ts` and update the stale doc.

**CONFLICT M5: Carnage Action Type Naming Inconsistent**
- `frontend-spec`: "Burn/Sell" (2 types)
- `frontend-spec DB schema`: "BuyOnly/Burn/BurnAndSell" (3 types)
- `cpi-interface-contract`: "Sell+Buy, Burn+Buy, BuyOnly"
- **Fix**: Standardize to on-chain enum names across all docs.

### LOW (3)

**CONFLICT L1**: ALT address stale in architecture.md, data-model.md, operational-runbook.md (`EyUnc...` 46 addr vs `4rW2y...` 48 addr in MEMORY)
**CONFLICT L2**: Crank bot daily SOL cost — 0.576 SOL/day (per-epoch math) vs 1.5-3 SOL/day (includes devnet test swaps)
**CONFLICT L3**: Error variant counts — 94 (decisions) vs 92 (current code)

---

## Pass 3: Gaps (30 gaps identified)

### Critical Gaps (4)

| # | Gap | Location | Impact |
|---|-----|----------|--------|
| G1 | PROFIT pool tax exemption not documented | data-model, token-economics-model | Readers assume all swaps are taxed |
| G2 | Pre-mainnet checkpoint missing full 6-item checklist from Test-D5 | mainnet-readiness-assessment | Risk of incomplete verification before irreversible burn |
| G3 | Bonding curve security scope not addressed | mainnet-readiness-assessment | New program handling 1000+ SOL with no security plan |
| G4 | Carnage atomic CU at 150K/200K limit — no mainnet validation | error-handling-playbook, mainnet-readiness | If exceeds 200K CU on mainnet, all Carnage falls to less-secure fallback |

### High Gaps (8)

| # | Gap | Location | Impact |
|---|-----|----------|--------|
| G5 | EpochState tax rate derivation formula missing | data-model | Devs can't derive cached fields without reading source |
| G6 | Staking→Token-2022 CPI pattern not in CPI contract | cpi-interface-contract | Same manual CPI pattern needed but undocumented |
| G7 | Tax Program cross-program EpochState read not in CPI contract | cpi-interface-contract | Exploitable via account substitution if not validated |
| G8 | Webhook auth marked "Optional" but mainnet-required (Sec-D14) | frontend-spec | False sense of security for mainnet |
| G9 | Pool draining attack not explicitly addressed in security-model | security-model | Standard AMM attack vector missing from threat model |
| G10 | Crank bot Railway deployment procedure missing | operational-runbook | Can't deploy to production without undocumented knowledge |
| G11 | CI/CD not set up (Testing D1 specifies GitHub Actions) | mainnet-readiness | Regressions during bonding curve development |
| G12 | Carnage sell path slippage not analyzed | liquidity-slippage-analysis | Missing worst-case for dual-pool Carnage paths |

### Medium Gaps (10)

| # | Gap | Location |
|---|-----|----------|
| G13 | Concurrent Carnage + user swap not in security-model | security-model |
| G14 | StakePool MINIMUM_STAKE constraint not on entity definition | data-model |
| G15 | AdminConfig burn_admin mechanism not in data-model | data-model |
| G16 | Carnage empty-vault graceful no-op not in security-model | security-model |
| G17 | Frontend error handling — which programs are unmapped | frontend-spec |
| G18 | RPC polling optimization not integrated into frontend-spec | frontend-spec |
| G19 | WSOL intermediary lifecycle (close/reinit) unexplained | data-model |
| G20 | Helius webhook setup procedure missing | operational-runbook |
| G21 | Database migration/schema provisioning not documented | operational-runbook |
| G22 | Compute budget security analysis missing | security-model |

### Low Gaps (8)

| # | Gap | Location |
|---|-----|----------|
| G23 | Carnage 98/2 burn/sell probability not in architecture | architecture |
| G24 | Missing error codes in token-interaction-matrix | token-interaction-matrix |
| G25 | Reserve vault (whitelist #13) undocumented | account-layout-reference |
| G26 | Bonding curve accounts not in account-layout-reference | account-layout-reference |
| G27 | Nextra docs site deployment procedure missing | deployment-sequence |
| G28 | Sentry Crons referenced as implemented but is planned | operational-runbook |
| G29 | WSOL intermediary failure recovery undocumented | operational-runbook |
| G30 | API key hardcoded in runbook command examples | operational-runbook |

---

## Pass 4: Verification Items (16 items)

### Pre-Mainnet Critical (must resolve before authority burn)

| # | Item | Flagged By | Action |
|---|------|-----------|--------|
| V1 | Mainnet priority fee vs 0.001 SOL bounty | A, C, D, E | Measure mainnet priority fees. Adjust CRANK_BOUNTY_LAMPORTS if needed. |
| V2 | PROFIT pool tax status (taxed or untaxed?) | E | Read `swap_profit_buy.rs`. If taxed, fix decisions OR fix code. |
| V3 | EpochState single vs per-token magnitudes | B | Read `epoch_state.rs`. Fix the wrong document. |
| V4 | PROFIT supply on-chain (50M vs 1B) | D | Check devnet mint supply. Fix deployment-sequence or decisions. |
| V5 | VRF byte 0 threshold (128 vs 192) | D | Read `consume_randomness.rs`. Fix operational-runbook. |
| V6 | Backend RPC proxy for mainnet | C | Implement before mainnet. API key exposure is security-blocking. |

### Pre-Mainnet High (should resolve)

| # | Item | Flagged By | Action |
|---|------|-----------|--------|
| V7 | PoolState INIT_SPACE actual size | A, B | Read `pool.rs`. Reconcile 224 vs 223 vs 216. |
| V8 | Cross-program EpochStateReader layout match | A | Diff `epoch_state.rs` vs `epoch_state_reader.rs`. |
| V9 | WhitelistEntry — which 14 addresses exactly? | A | List from on-chain state or initialize.ts. |
| V10 | Frontend error map missing Tax 6014-6017 | E | Update `error-map.ts` for user-facing sell errors. |
| V11 | Carnage fallback front-running frequency | A, C, E | Run 100+ epoch devnet session. Measure fallback %. |
| V12 | Bonding curve implementation status | D | Confirm whether program exists in codebase. |

### Pre-Mainnet Medium

| # | Item | Flagged By | Action |
|---|------|-----------|--------|
| V13 | LP fee/tax ordering — which comes first? | A | Read `swap_sol_buy.rs`. Reconcile across docs. |
| V14 | WSOL whitelist entries (#2, #4) necessity | B | Check if any T22 transfer targets WSOL vaults. |
| V15 | Pool seeding amounts match bonding curve spec | B, D | Verify when bonding curve is built. |
| V16 | Error variant counts (94 vs 92) | E | Count from current `errors.rs` files. Update decisions. |

---

## Recommended Actions (prioritized)

### Immediate (verify against source code, fix docs)

1. **V3 + V5 + V4**: Read `epoch_state.rs`, `consume_randomness.rs`, check PROFIT mint supply — resolves 3 critical conflicts with 3 source code reads
2. **V2**: Read `swap_profit_buy.rs` — resolves PROFIT pool tax ambiguity (critical for liquidity analysis)
3. **H1 + H2 + H5 + H6 + M1**: Fix 5 clear doc errors (wrong IDs, wrong token program, AND→OR, label swap) — no verification needed, answers are known
4. **V7**: Read `pool.rs` INIT_SPACE — resolves PoolState size discrepancy

### Before Mainnet

5. **V1**: Measure mainnet priority fees vs bounty — operational sustainability
6. **V6**: Build backend RPC proxy — security-blocking
7. **G2**: Add full Test-D5 checklist to mainnet-readiness
8. **G3 + G11**: Address bonding curve security + set up CI/CD

### Documentation Polish (batch update)

9. Fix all LOW conflicts (ALT address, error counts, SOL cost, etc.)
10. Fill medium/low gaps (procedures, missing formulas, naming standardization)

---

---

## Resolution Log (2026-02-22)

### Conflicts Resolved (18/18)

| Conflict | Resolution | Doc(s) Changed |
|----------|-----------|----------------|
| **C1** | Source code confirms per-token independent magnitudes. `low_tax_bps`/`high_tax_bps` are LEGACY (always 0). Cached fields are ACTIVE. | account-layout-reference.md |
| **C2** | User confirmed: 50M is mainnet intent, 1B is devnet convenience. Deployment-sequence annotated. | deployment-sequence.md |
| **C3** | Source code confirms PROFIT pools are UNTAXED ("No protocol tax is applied - only the 0.5% AMM LP fee"). Decisions correct. | No change needed (docs already say untaxed) |
| **H1** | Hook program ID updated to `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce` | data-model.md |
| **H2** | All 5 program IDs updated to Phase 51 addresses | frontend-spec.md |
| **H3** | VRF byte 0 threshold corrected: 128 → 192 (75% probability) | operational-runbook.md |
| **H4** | Bytes 3-4 updated from "(reserved)" to FRAUD low/high magnitudes | operational-runbook.md |
| **H5** | WSOL intermediary corrected from "Token-2022" to "SPL Token" | data-model.md |
| **H6** | Whitelist logic corrected from "AND" to "OR" | data-model.md |
| **H7** | Tiered timelock corrected from "1-2 weeks" to "48-72 hours" per Architecture D3 | deployment-sequence.md |
| **M1** | Tax labels corrected: "(pool/Carnage fund/staking)" → "(staking/Carnage fund/treasury)" | PROJECT_BRIEF.md |
| **M2** | WhitelistEntry count corrected from "~20-30" to "14" | account-layout-reference.md |
| **M3** | PoolState size corrected to 224 bytes total (216 data + 8 discriminator). Code comment has arithmetic error claiming 232. | account-layout-reference.md |
| **M4** | Source code confirms Jupiter Price API (not CoinGecko). Both DECISIONS/operations.md and architecture.md updated. | DECISIONS/operations.md, architecture.md |
| **M5** | Carnage naming standardized: "BurnAndSell" → "Sell" to match on-chain `CarnageAction` enum | frontend-spec.md |
| **L1** | ALT address updated from `EyUnc...` (46 addr) to `4rW2y...` (48 addr) in all 4 stale docs | architecture.md, data-model.md, operational-runbook.md, deployment-sequence.md |
| **L2** | Acknowledged — 0.576 SOL/day is pure crank cost; higher devnet figures include test swaps. No doc change needed. | N/A |
| **L3** | Acknowledged — error count drift is expected during development. Will re-count at mainnet freeze. | N/A |

### Verification Items Resolved (7/16)

| Item | Resolution |
|------|-----------|
| **V2** | PROFIT pools confirmed UNTAXED via `swap_profit_buy.rs` source code |
| **V3** | EpochState has BOTH legacy fields (always 0) AND 4 per-token cached fields. `token-economics-model` was correct. `account-layout-reference` fixed. |
| **V4** | User confirmed: devnet 1B, mainnet 50M. `deployment-sequence.md` annotated. |
| **V5** | `FLIP_THRESHOLD = 192` confirmed in `tax_derivation.rs`. `operational-runbook` fixed. |
| **V7** | PoolState = 216 data + 8 disc = 224 total. Code comment wrong (claims 232). `account-layout-reference` fixed. |
| **V9** | Token-interaction-matrix enumerates exactly 14 entries. `account-layout-reference` count corrected. |
| **V16** | Deferred to mainnet freeze — error count drift is expected during active development. |

### Verification Items Remaining (9/16)

| Item | Status | Notes |
|------|--------|-------|
| **V1** | Pre-mainnet | Measure mainnet priority fees vs bounty |
| **V6** | Pre-mainnet | Backend RPC proxy (security-blocking) |
| **V8** | Pre-mainnet | Cross-program EpochStateReader layout match |
| **V10** | Pre-mainnet | Frontend error map missing Tax 6014-6017 |
| **V11** | Pre-mainnet | Carnage fallback front-running frequency measurement |
| **V12** | Pre-mainnet | Bonding curve implementation status |
| **V13** | Pre-mainnet | LP fee/tax ordering verification |
| **V14** | Pre-mainnet | WSOL whitelist entries necessity check |
| **V15** | Pre-mainnet | Pool seeding amounts vs bonding curve spec |

### Gaps Resolved (30/30)

All 30 gaps filled via 5 parallel Opus agents, each targeting a cluster of docs.

| Gap | Description | Doc(s) Changed | Summary |
|-----|-------------|----------------|---------|
| **G1** | PROFIT pool tax exemption undocumented | data-model.md | Added explicit "PROFIT pools are untaxed" note with 0.5% LP-fee-only explanation |
| **G2** | Pre-mainnet checkpoint missing 6-item checklist | mainnet-readiness-assessment.md | Added full Test-D5 6-item checklist (Rust tests, TS tests, 100-epoch run, Carnage, manual smoke, review) |
| **G3** | Bonding curve security scope not addressed | mainnet-readiness-assessment.md | Added B1 blocker with scope estimate, OQ4/OQ5 open questions, security audit requirement |
| **G4** | Carnage CU budget — no mainnet validation | mainnet-readiness-assessment.md | Noted in blockers; profiled measurements integrated |
| **G5** | Tax rate derivation formula missing | data-model.md | Added formula: `low_bps = 100 + (byte * 300 / 255)`, `high_bps = 1100 + (byte * 300 / 255)` |
| **G6** | Staking Token-2022 CPI pattern undocumented | cpi-interface-contract.md | Added full section: manual `transfer_checked_with_hook` helper, remaining_accounts forwarding |
| **G7** | Tax Program cross-program EpochState read | cpi-interface-contract.md | Added section on `EpochStateReader` mirror struct, discriminator requirement, layout match |
| **G8** | Webhook auth "Optional" but mainnet-required | frontend-spec.md | Marked as REQUIRED for mainnet per Sec-D14 |
| **G9** | Pool draining attack missing from security model | security-model.md | Added ATK-E7 with 4 defense layers (k-invariant, zero-output, slippage floor, proptest) |
| **G10** | Railway deployment procedure missing | operational-runbook.md | Added full Railway section: deploy procedure, health checks, crank bot service setup |
| **G11** | CI/CD not set up | mainnet-readiness-assessment.md | Noted as pre-mainnet requirement per Testing D1 |
| **G12** | Carnage sell path slippage not analyzed | liquidity-slippage-analysis.md | Added dual-pool compounding analysis with worked examples |
| **G13** | Concurrent Carnage + user swap | security-model.md | Added ATK-E8: runtime serialization, PoolLocked guard, independent slippage floors |
| **G14** | MINIMUM_STAKE not on entity definition | data-model.md | Added constraint on StakePool: `MINIMUM_STAKE = 1_000_000` with first-depositor protection rationale |
| **G15** | burn_admin mechanism undocumented | data-model.md | Added burn_admin mechanism: sets admin to `Pubkey::default()`, irreversible |
| **G16** | Carnage empty-vault no-op | security-model.md | Added to checklist: zero SOL vault returns `Ok(())` with zero amounts |
| **G17** | Frontend error handling — unmapped programs | frontend-spec.md | Error map coverage noted |
| **G18** | RPC polling optimization | frontend-spec.md | Polling intervals documented (10s on-chain, 30s SOL price) |
| **G19** | WSOL intermediary lifecycle | data-model.md | Added transfer-close-distribute-reinit cycle explanation |
| **G20** | Helius webhook setup procedure | operational-runbook.md | Added full webhook-manage.ts CLI section with create/delete/list commands |
| **G21** | Database migration procedure | operational-runbook.md | Added PostgreSQL section: Railway plugin, Drizzle ORM, migration commands |
| **G22** | Compute budget security analysis | security-model.md | Added full CU budget analysis table: all user swaps <123K, Carnage at 600K |
| **G23** | Carnage 98/2 burn/sell probability | architecture.md | Added: "98% Burn path, 2% Sell path (VRF byte 6)" to Epoch Program description |
| **G24** | Missing error codes in token-interaction-matrix | token-interaction-matrix.md | Error codes added to interaction entries |
| **G25** | Reserve vault (whitelist #13) | account-layout-reference.md | Documented reserve vault whitelist entry |
| **G26** | Bonding curve accounts | account-layout-reference.md | Noted as placeholder pending implementation |
| **G27** | Nextra docs site deployment | deployment-sequence.md | Added docs-site deployment step |
| **G28** | Sentry Crons status clarified | operational-runbook.md | Marked as "planned" not "implemented" |
| **G29** | WSOL intermediary failure recovery | operational-runbook.md | Added recovery procedure for stuck WSOL accounts |
| **G30** | API key in runbook examples | operational-runbook.md | Replaced hardcoded keys with env var references |

---

*Report generated 2026-02-22 by 5 parallel Grand Library Reconciliation Agents (Groups A-E)*
*Methodology: Chunked reconciliation — each agent reviewed 3 docs against all 80 decisions*
*Resolution pass completed 2026-02-22 — all 18 conflicts resolved, 7/16 verification items closed*
*Gap-filling pass completed 2026-02-22 — all 30 gaps filled via 5 parallel Opus agents*

---

## Post-Vault Migration Updates

The following changes were made to the protocol after this reconciliation was completed. Findings in the report above that reference PROFIT pools, PROFIT pool LP fees, or PROFIT pool tax status are now historical context only.

### Changes Since Reconciliation

1. **PROFIT AMM pools replaced by fixed-rate conversion vault (100:1)**
   - CRIME/PROFIT and FRAUD/PROFIT AMM pools have been removed
   - A single conversion vault replaces them: 100 CRIME = 1 PROFIT = 100 FRAUD (permanent, immutable rate)
   - Zero conversion fees (the 0.5% PROFIT pool LP fee no longer applies)
   - Program count increased from 5 to 6 (AMM, Tax, Epoch, Staking, Transfer Hook + Conversion Vault)

2. **Tax distribution split updated**
   - Old: 75% staking yield escrow / 24% Carnage fund / 1% treasury multisig
   - New: 71% staking yield escrow / 24% Carnage fund / 5% treasury
   - The 1% treasury multisig allocation has been replaced by a 5% treasury split

3. **PROFIT supply reduced for mainnet**
   - Old: 50,000,000 PROFIT (50M)
   - New: 20,000,000 PROFIT (20M)
   - 100% allocated to the conversion vault (no bonding curve, no pool seeding)

4. **SOL pool seeding corrected**
   - Old (incorrect in some docs): 540M tokens per SOL pool (54% of 1B)
   - New (correct): 290M tokens per SOL pool (29% of 1B)
   - The remaining 250M per IP token (25%) is pre-loaded into the conversion vault as cross-conversion buffer

5. **Affected reconciliation findings (now historical)**
   - C3 (PROFIT pool tax status): Moot — vault has no tax and no LP fee
   - V2 (PROFIT pool tax verification): Moot — no PROFIT pools exist
   - G1 (PROFIT pool tax exemption documentation): Moot — vault replaces pools
   - D8 references to "0.5% PROFIT pools" LP fee: Historical only
   - Any liquidity-slippage-analysis findings about PROFIT pools: Historical only
