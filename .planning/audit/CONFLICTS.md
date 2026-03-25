# Conflict Tracking

## Dashboard

| Severity | Open | Resolved | Total |
|----------|------|----------|-------|
| CRITICAL | 0 | 0 | 0 |
| HIGH | 0 | 0 | 0 |
| MEDIUM | 0 | 0 | 0 |
| LOW | 0 | 0 | 0 |
| **Total** | **0** | **0** | **0** |

**Last Updated:** 2026-02-03 (Phase 7 Plan 01 - Delta validation, CLEAN PASS)

---

## Phase 3 Summary

**Detection complete:** 2026-02-01
**Conflicts by type:**
- Value conflicts: 0
- Behavioral conflicts: 0
- Assumption conflicts: 0

**Total conflicts detected:** 0

**Assumptions validated:** 8/8 (all ASSUMP entries checked against explicit constraints)

**Single-source concepts:** 22 (flagged for Phase 4 gap analysis)

**Next step:** Phase 4 (Gap Analysis) will evaluate single-source concepts for documentation needs

---

## Severity Definitions

| Level | Definition | Foundation Boost |
|-------|------------|------------------|
| CRITICAL | Breaks security or correctness | +1 if foundation doc |
| HIGH | Breaks functionality | +1 if foundation doc |
| MEDIUM | Inconsistency, no immediate breakage | - |
| LOW | Cosmetic, terminology | - |

---

## Conflict Types

| Type | Description |
|------|-------------|
| Value | Same parameter, different numeric values |
| Behavioral | Same flow, different sequences or outcomes |
| Assumption | Implicit dependencies, undocumented assumptions |

---

## Open Conflicts

_Conflicts awaiting resolution. Ordered by severity then discovery date._

(None found - see Phase 3 Summary below)

---

### Phase 2 Audit Notes

**02-01 Token Program Audit Results:**
- No actual conflicts found (no specs incorrectly claimed WSOL is Token-2022)
- Specs were missing explicit clarifications rather than containing contradictions
- Added WSOL/SPL Token clarifications to: AMM_Implementation.md, Transfer_Hook_Spec.md, Protocol_Initialzation_and_Launch_Flow.md
- Created central Token_Program_Reference.md as authoritative matrix

---

### Phase 3 Cross-Reference Analysis

**03-03 Conflict Detection Results (2026-02-01):**

#### Value Conflicts (Constants/Entities/Formulas)

**Matrices analyzed:**
- `01-constants-matrix.md`: 15 concepts, 12 agreements, **0 discrepancies**, 3 single-source
- `02-entities-matrix.md`: 14 concepts, 9 agreements, **0 discrepancies**, 5 single-source
- `05-formulas-matrix.md`: 8 concepts, 2 agreements, **0 discrepancies**, 6 single-source

**Result:** No value conflicts found. All multi-source concepts have consistent values across documents.

**Key validated agreements:**
- CONST-001/002: LP fees (1%/0.5%) consistent across 5+ documents
- CONST-003/004: Tax bands (1-4%/11-14%) consistent across 3 documents
- CONST-009/010/011: Tax split (75/24/1%) consistent across 4 documents
- ENT-004 (WSOL): Correctly identified as SPL Token (not Token-2022) across 3 documents
- FORM-001/002: AMM and tax formulas mathematically consistent

**Single-source items:** 22 concepts are documented in only one place. These are flagged for Phase 4 gap analysis but are NOT conflicts - they are authoritative definitions that may or may not need broader documentation.

#### Behavioral Conflicts (Sequences/Flows)

**Matrix analyzed:**
- `03-behaviors-matrix.md`: 16 concepts, 12 agreements, **0 discrepancies**, 4 single-source

**Result:** No behavioral conflicts found. All documented sequences are consistent.

**Key validated behaviors:**
- BEH-001/002: Swap sequences (LP fee -> Tax -> AMM) consistent
- BEH-003: Epoch transition sequence consistent across 5 documents
- BEH-004: Tax regime flip logic (75% probability, atomic) consistent
- BEH-005/006: Carnage execution paths (98%/2%) consistent across 4 documents
- BEH-016: Tax distribution split (75/24/1 immediate) consistent

#### Constraint/Terminology Alignment

**Matrices analyzed:**
- `04-constraints-matrix.md`: 14 concepts, 13 agreements, **0 discrepancies**, 1 single-source
- `06-terminology-matrix.md`: 10 concepts, 7 agreements, **0 discrepancies**, 3 single-source

**Result:** No conflicts. Constraints and terminology used consistently throughout documentation.

#### Assumption Conflicts Analysis

**Purpose:** Cross-check all 8 documented assumptions against explicit constraints and behaviors. This is critical because v3 failed due to an unstated assumption about WSOL.

**Assumptions analyzed:** ASSUMP-001 through ASSUMP-008 from `00-concept-inventory.md`

| ASSUMP ID | Assumption | Checked Against | Result |
|-----------|------------|-----------------|--------|
| ASSUMP-001 | All CRIME/FRAUD/PROFIT use same transfer hook program | Transfer_Hook_Spec.md Section 1, CONSTR-002 | VALIDATED |
| ASSUMP-002 | Epoch timing is slot-based, not wall-clock | CONST-005 (4500 slots), Epoch_State_Machine_Spec.md Section 3.1 | VALIDATED |
| ASSUMP-003 | WSOL vault security relies on AMM access control | CONSTR-007, CONSTR-008, Token_Program_Reference.md TM-01 | VALIDATED |
| ASSUMP-004 | Taxes are SOL-denominated only | CONSTR-003, BEH-001/002, Tax_Pool_Logic_Spec.md | VALIDATED |
| ASSUMP-005 | VRF result is cryptographically verified | Epoch_State_Machine_Spec.md Section 7.1 (Switchboard proof) | VALIDATED |
| ASSUMP-006 | Carnage swaps don't trigger transfer hooks | Transfer_Hook_Spec.md whitelist (#9, #10 Carnage vaults) | VALIDATED |
| ASSUMP-007 | Token-2022 burn does not trigger transfer hook | Carnage_Fund_Spec.md Section 10.3 (explicit statement) | VALIDATED |
| ASSUMP-008 | Swaps continue during VRF delay | Epoch_State_Machine_Spec.md Section 14.7 (explicit statement) | VALIDATED |

**Result:** All 8 assumptions validated. No assumption conflicts detected.

**Detailed validation notes:**

**ASSUMP-001 (Shared Hook Program):** Transfer_Hook_Spec.md explicitly states "Single hook program serves all three tokens" with shared whitelist. Hook program ID configured on each mint at creation.

**ASSUMP-002 (Slot-Based Timing):** Epoch_State_Machine_Spec.md provides authoritative slot-based definition. Overview's "~30 minutes" is an approximation for user understanding, not a conflict.

**ASSUMP-003 (WSOL Security - CRITICAL):** This was the v3 failure point. Now explicitly documented:
- CONSTR-007 states WSOL uses SPL Token, no hook support
- CONSTR-008 states AMM requires Tax Program PDA signature
- Token_Program_Reference.md TM-01 documents this as "MITIGATED: Vault access requires Tax Program PDA signature"

**ASSUMP-004 (SOL Taxes):** Tax_Pool_Logic_Spec.md Sections 9.2/9.3 show tax calculated from SOL amount (input for buys, output for sells). CONSTR-003 limits taxes to SOL pools only.

**ASSUMP-005 (VRF Verification):** Epoch_State_Machine_Spec.md Section 7.1 states Switchboard VRF validates proof before callback executes. This is Switchboard's responsibility, our code receives already-verified randomness.

**ASSUMP-006 (Carnage Whitelist):** Transfer_Hook_Spec.md Section 4 whitelist includes:
- #9: Carnage Fund PDA (SOL vault holder)
- #10: Carnage Fund PDA (token vault holder)
Swaps with Carnage Fund as counterparty pass hook validation.

**ASSUMP-007 (Burn No Hook):** Carnage_Fund_Spec.md Section 10.3 explicitly states this based on Token-2022 program behavior. Burn destination (null) is not checked by transfer hook.

**ASSUMP-008 (Swaps During Delay):** Epoch_State_Machine_Spec.md Section 14.7 explicitly addresses this: "Old taxes remain active during VRF retry period. Protocol never halts."

---

### Phase 3 Conflict Detection Summary

**Total conflicts detected:** 0
- Value conflicts: 0
- Behavioral conflicts: 0
- Assumption conflicts: 0

**Why zero conflicts is good news:**
The v3 failure was NOT due to contradictory documentation - it was due to an unstated assumption (WSOL being SPL Token, not Token-2022). The documentation rebuild has:
1. Made all assumptions explicit (8 documented in ASSUMP-XXX)
2. Validated each assumption against explicit constraints
3. Created Token_Program_Reference.md as authoritative source for token program facts

**Next steps:** Phase 4 (Gap Analysis) will address the 22 single-source concepts to determine if they need broader documentation.

---

## Resolved Conflicts

_Conflicts that have been resolved with documentation updates._

(None yet)

---

## Won't Fix

_Conflicts acknowledged but intentionally not resolved, with rationale._

(None yet)

---

## Phase 7 Delta Validation

**Date:** 2026-02-03
**Scope:** Delta validation of Phase 6 additions (2 new VRF documents + 1 modified Carnage section)

### Validation Results

**New conflicts found: 0**

Phase 6 additions introduce no conflicts with the existing converged specification set. Specifically:

1. **VRF_Implementation_Reference.md** is clearly scoped as a reference document (not authoritative spec) with all discrepancies explicitly flagged via "SPEC DISCREPANCY" callouts. No risk of readers confusing v3 implementation details with v4 spec requirements.

2. **VRF_Migration_Lessons.md** has all 7 discrepancies resolved as RESOLVED:SPEC, meaning all differences between v3 and current spec have been adjudicated in favor of the spec. No conflicting guidance remains.

3. **Carnage_Fund_Spec.md Section 9.5** (two-instruction atomic bundle) is consistent with:
   - Section 9.4 (compute budget analysis)
   - Section 9.2 (execution logic)
   - Section 2 (CPI depth architectural constraint)
   - VRF_Migration_Lessons.md DISC-07 (bidirectional cross-reference confirmed)

### Observations (Not Conflicts)

1. **Epoch_State_Machine_Spec.md does not reference VRF documents.** This is expected and intentional -- VRF_Implementation_Reference is a reference document, not a spec. The Epoch spec is authoritative for VRF integration design. A forward reference is not needed at this stage (it may be added during implementation planning when the Epoch spec is updated for On-Demand VRF pattern per DISC-04 resolution).

2. **Carnage_Fund_Spec.md Section 22 Invariant 1** says "3 CPI levels max" but Section 2 correctly documents depth 4. This is a minor wording inconsistency within the same document (the "3 CPI levels" refers to CPI calls from Epoch's perspective, while the total including Token-2022's internal hook call is 4). Section 2's ARCHITECTURAL CONSTRAINT block is the authoritative analysis. This was already noted in Phase 4 (GAP-064) and addressed -- the Section 22 wording is a summary approximation, not a contradiction.

*Phase 7 validation completed: 2026-02-03*
