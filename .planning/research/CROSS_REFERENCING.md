# Specification Cross-Referencing Methodology

**Project:** Dr. Fraudsworth's Finance Factory
**Purpose:** Systematic conflict detection across 11 specification documents
**Produced:** 2026-02-01
**Confidence:** HIGH (methodology is well-established in requirements engineering)

---

## Executive Summary

This document defines a practical methodology for cross-referencing the Dr. Fraudsworth specification set to identify conflicts, inconsistencies, and gaps before implementation begins. The approach combines:

1. **Concept Inventory** - Extract all defined concepts from each document
2. **Cross-Reference Matrix** - Map where concepts appear across documents
3. **Conflict Categories** - Systematic checks for specific conflict types
4. **Resolution Workflow** - Track, resolve, and verify fixes
5. **Convergence Testing** - Iterate until stable

The methodology is designed for 11 documents and manual execution (no specialized tooling required).

---

## 1. Document Inventory

### 1.1 Current Specification Set

| ID | Document | Primary Domain | Dependencies |
|----|----------|----------------|--------------|
| D01 | DrFraudsworth_Overview.md | System overview | All (meta-document) |
| D02 | AMM_Implementation.md | Swap mechanics | D07, D10 |
| D03 | Bonding_Curve_Spec.md | Launch mechanics | D08, D02 |
| D04 | Carnage_Fund_Spec.md | Chaos mechanism | D05, D06, D02 |
| D05 | Epoch_State_Machine_Spec.md | Time/state coordination | D06, D04 |
| D06 | Tax_Pool_Logic_Spec.md | Tax execution | D05, D02, D09 |
| D07 | Soft_Peg_Arbitrage_Spec.md | Peg mechanics | D02, D06 |
| D08 | Protocol_Initialization_and_Launch_Flow.md | Deployment sequence | D03, D02, all |
| D09 | Yield_System_Spec.md | OP4 yield distribution | D06, D05 |
| D10 | Transfer_Hook_Spec.md | Token restrictions | D02 |
| D11 | SolanaSetup.md | Environment setup | None (infrastructure) |

### 1.2 Document Relationships

```
                    ┌──────────────────┐
                    │   D01: Overview  │ (meta-document, first written)
                    │   [LIKELY STALE] │
                    └────────┬─────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ D03: Bonding  │   │ D05: Epoch    │   │ D10: Transfer │
│ Curve         │──▶│ State Machine │   │ Hook          │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        ▼                   ▼                   │
┌───────────────┐   ┌───────────────┐          │
│ D08: Init &   │   │ D06: Tax Pool │◀─────────┤
│ Launch Flow   │   │ Logic         │          │
└───────┬───────┘   └───────┬───────┘          │
        │                   │                   │
        │           ┌───────┴───────┐          │
        │           ▼               ▼          │
        │   ┌───────────────┐ ┌───────────────┐│
        │   │ D04: Carnage  │ │ D09: Yield    ││
        │   │ Fund          │ │ System        ││
        │   └───────────────┘ └───────────────┘│
        │                                      │
        └──────────────────┬───────────────────┘
                           ▼
                   ┌───────────────┐
                   │ D02: AMM      │
                   │ Implementation│
                   └───────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │ D07: Soft Peg │
                   │ Arbitrage     │
                   └───────────────┘
```

---

## 2. Concept Inventory

### 2.1 What to Extract

For each document, extract:

1. **Defined Constants** - Numeric values, percentages, rates
2. **Named Entities** - Tokens, pools, accounts, programs
3. **Behaviors** - What happens when, execution sequences
4. **Constraints** - Hard rules, invariants, prohibitions
5. **Formulas** - Mathematical relationships
6. **Terminology** - Domain-specific terms and definitions

### 2.2 Inventory Template

```markdown
## Document: [Name]

### Constants
| Name | Value | Context |
|------|-------|---------|
| EPOCH_LENGTH | 30 minutes | Timing |
| LP_FEE_SOL_POOLS | 1% (100 bps) | Fee structure |

### Entities
| Name | Type | Description |
|------|------|-------------|
| IPA | Token | Token-2022 with transfer hook |
| EpochState | Account | Global singleton |

### Behaviors
| Trigger | Action | Outcome |
|---------|--------|---------|
| Epoch boundary | Request VRF | Tax regime may flip |

### Constraints
| Rule | Enforcement |
|------|-------------|
| No direct wallet transfers | Transfer hook |
| Pools are protocol-owned | No LP withdrawal |

### Formulas
| Name | Expression |
|------|------------|
| Swap output | reserve_out * amount_in / (reserve_in + amount_in) |

### Terminology
| Term | Definition |
|------|------------|
| Cheap side | IP token with low buy tax, high sell tax |
```

### 2.3 Priority Concepts for This Protocol

These concepts appear across multiple documents and are high-conflict-risk:

| Concept | Primary Doc | Also Appears In |
|---------|-------------|-----------------|
| LP Fee Rates | D06 | D01, D02, D07 |
| Tax Bands | D06 | D01, D05 |
| Epoch Length | D05 | D01, D06 |
| Tax Distribution Split | D06 | D01, D04, D09 |
| Token Supply | D03 | D01, D08 |
| Pool Seeding Amounts | D03 | D08 |
| Carnage Trigger Probability | D04 | D01, D05 |
| Transfer Hook Behavior | D10 | D01, D02 |
| Yield Eligibility | D09 | D01, D06 |
| VRF Integration | D05 | D04, D06 |

---

## 3. Cross-Reference Matrix

### 3.1 Building the Matrix

Create a matrix where:
- **Rows** = Concepts (from inventory)
- **Columns** = Documents (D01-D11)
- **Cells** = Value or behavior as stated in that document

Example:

| Concept | D01 | D02 | D05 | D06 |
|---------|-----|-----|-----|-----|
| LP Fee (SOL pools) | 1% | 1% (100 bps) | — | 1% (100 bps) |
| LP Fee (OP4 pools) | 0.5% | 0.5% (50 bps) | — | 0.5% |
| Epoch Length | 30 min | — | ~30 min (4500 slots) | 30 min |
| Tax Split - Yield | 75% | — | — | 75% |
| Tax Split - Carnage | 24% | — | — | 24% |
| Tax Split - Treasury | — | — | — | 1% |

### 3.2 Matrix Analysis

For each row:

1. **Check for explicit conflicts** - Different values for same concept
2. **Check for implicit conflicts** - Same value stated differently (may drift)
3. **Check for gaps** - Concept missing from document that should define it
4. **Check for orphans** - Concept defined in only one place (may be outdated)

### 3.3 Conflict Detection Template

```markdown
## Conflict: [CONFLICT-ID]

**Concept:** [What concept is in conflict]
**Type:** [Value/Behavior/Terminology/Sequence/Assumption]

### Appearances
| Document | States | Section |
|----------|--------|---------|
| D01 | 75% | Overview > OP4 Yield |
| D06 | 76% | Section 4 |

### Analysis
[Why this matters, impact if unresolved]

### Resolution
- [ ] Determine correct value
- [ ] Update [list of documents]
- [ ] Verify no cascading impacts

### Resolved
- **Decision:** [What was decided]
- **Updated:** [List of documents modified]
- **Verified:** [Date/commit]
```

---

## 4. Conflict Categories

### 4.1 Value Conflicts

**Definition:** Same parameter has different numeric values across documents.

**Detection Method:**
1. Extract all numeric constants from each document
2. Group by concept name (may require fuzzy matching)
3. Compare values within each group

**Common Patterns:**
- Percentages stated differently (75% vs 0.75 vs 7500 bps)
- Rounding differences (1/24 vs 4.17% vs ~4%)
- Unit mismatches (lamports vs SOL, slots vs seconds)

**Checklist for This Protocol:**
- [ ] LP fee rates match across D01, D02, D06
- [ ] Tax band ranges match across D01, D05, D06
- [ ] Tax distribution percentages sum to 100%
- [ ] Token supplies match across D01, D03, D08
- [ ] Pool seeding amounts match across D03, D08
- [ ] Carnage probabilities match across D01, D04, D05
- [ ] Epoch timing matches (slots, duration, boundary calculation)

### 4.2 Behavioral Conflicts

**Definition:** Same action described with different execution sequences or outcomes.

**Detection Method:**
1. Extract all "when X happens, Y occurs" statements
2. Group by trigger event
3. Compare action sequences and outcomes

**Common Patterns:**
- Order of operations differs (fee before tax vs tax before fee)
- Missing steps in one document
- Different conditions for same outcome

**Checklist for This Protocol:**
- [ ] Swap execution order matches (D02 vs D06)
- [ ] Epoch transition sequence matches (D05 vs D06)
- [ ] Carnage execution sequence matches (D04 vs D05)
- [ ] Tax collection timing matches (when deducted, when distributed)
- [ ] VRF callback sequence matches (D05 vs D04)
- [ ] Pool initialization sequence matches (D02 vs D03 vs D08)
- [ ] Yield finalization sequence matches (D09 vs D06)

### 4.3 Terminology Conflicts

**Definition:** Same concept referred to by different names, or same name used for different concepts.

**Detection Method:**
1. Build a terminology glossary from all documents
2. Identify synonyms (different words, same meaning)
3. Identify homonyms (same word, different meanings)

**Common Patterns:**
- "Cheap side" vs "favored token" vs "low-tax token"
- "Tax" vs "fee" used interchangeably
- "Epoch transition" vs "epoch boundary" vs "epoch flip"

**Checklist for This Protocol:**
- [ ] Token naming consistent (IPA, IPB, OP4)
- [ ] Pool naming consistent (IPA/SOL vs IPA-SOL vs SOL pool)
- [ ] Tax terminology consistent (tax vs fee vs levy)
- [ ] Regime terminology consistent (cheap side, flip, roll)
- [ ] State terminology consistent (epoch, state, phase)

### 4.4 Assumption Conflicts

**Definition:** Documents make incompatible implicit assumptions.

**Detection Method:**
1. Extract explicit constraints from each document
2. Identify implicit assumptions (things taken for granted)
3. Check if implicit assumptions in one document contradict explicit constraints in another

**Common Patterns:**
- One doc assumes feature exists, another doesn't define it
- One doc assumes ordering, another assumes independence
- One doc assumes atomic execution, another has multi-step

**Checklist for This Protocol:**
- [ ] Token program assumptions match (T22 vs SPL for each pool side)
- [ ] Atomicity assumptions match (what's atomic, what's not)
- [ ] Authority assumptions match (who can call what)
- [ ] Timing assumptions match (instant vs delayed effects)
- [ ] State visibility assumptions match (what's readable when)

### 4.5 Interface Conflicts

**Definition:** Documents describe incompatible integration points.

**Detection Method:**
1. Identify all cross-program calls (CPIs)
2. Map caller expectations vs callee contracts
3. Verify account structures match across boundaries

**Common Patterns:**
- Caller expects return value, callee doesn't provide
- Account structures differ in required fields
- Error handling assumptions differ

**Checklist for This Protocol:**
- [ ] AMM swap interface matches Tax Program expectations
- [ ] Transfer hook interface matches AMM expectations
- [ ] VRF callback interface matches Epoch state expectations
- [ ] Carnage Fund interface matches expected callers

### 4.6 Sequence Conflicts

**Definition:** Documents describe events in incompatible orders.

**Detection Method:**
1. Extract all "happens before" relationships
2. Build partial order graph
3. Check for cycles (impossible orderings)
4. Check for missing dependencies

**Checklist for This Protocol:**
- [ ] Pool initialization must complete before swaps (D08 vs D02)
- [ ] Curve completion must precede pool seeding (D03 vs D08)
- [ ] VRF request must precede tax regime activation (D05)
- [ ] Epoch finalization must precede yield calculation (D05 vs D09)
- [ ] Token minting must precede pool seeding (D08)

---

## 5. Conflict Tracking Workflow

### 5.1 Issue Registry Format

Create a tracking file: `.planning/research/CONFLICTS.md`

```markdown
# Specification Conflicts Registry

## Summary
| ID | Status | Type | Severity | Documents |
|----|--------|------|----------|-----------|
| C001 | OPEN | Value | HIGH | D01, D06 |
| C002 | RESOLVED | Terminology | LOW | D01, D05, D06 |

---

## OPEN CONFLICTS

### C001: Tax Distribution Missing Treasury Split

**Type:** Value Conflict
**Severity:** HIGH
**Documents:** D01, D06

**Issue:**
- D01 states: "75% yield, 24% carnage" (99% total)
- D06 states: "75% yield, 24% carnage, 1% treasury" (100% total)

**Impact:** D01 is missing 1% treasury allocation. Either treasury doesn't exist or D01 is outdated.

**Resolution Required:**
- [ ] Confirm treasury exists as a concept
- [ ] Update D01 to include treasury split
- [ ] Verify no other docs reference incorrect split

---

## RESOLVED CONFLICTS

### C002: Epoch Length Terminology
...
```

### 5.2 Severity Levels

| Level | Definition | Action |
|-------|------------|--------|
| CRITICAL | Implementation would produce incorrect behavior | Block all work until resolved |
| HIGH | Values/behavior differ in meaningful ways | Resolve before implementation |
| MEDIUM | Terminology inconsistent but intent is clear | Resolve during documentation pass |
| LOW | Stylistic differences, no functional impact | Resolve opportunistically |

### 5.3 Resolution Protocol

For each conflict:

1. **Identify authoritative source** - Which document is "correct"?
   - Most recently updated?
   - Most detailed specification?
   - Matches implementation reality?

2. **Determine correct value/behavior** - May require design decision

3. **List all affected documents** - Every doc that mentions this concept

4. **Update documents atomically** - All changes in single commit

5. **Verify resolution** - Re-run cross-reference for affected concept

6. **Check for cascading conflicts** - Does fix introduce new conflicts?

---

## 6. Iteration Protocol

### 6.1 Convergence Definition

The specification set is **converged** when:

1. A full cross-reference pass finds zero new conflicts
2. A full gap analysis finds zero new gaps
3. All previously identified conflicts are resolved
4. All previously identified gaps are filled

### 6.2 Iteration Steps

```
┌─────────────────────────────────────────────────────────┐
│ ITERATION N                                             │
├─────────────────────────────────────────────────────────┤
│ 1. Cross-reference all documents                        │
│    - Build/update concept inventory                     │
│    - Populate cross-reference matrix                    │
│    - Run all conflict category checks                   │
│    - Log new conflicts to registry                      │
│                                                         │
│ 2. Gap analysis                                         │
│    - Identify missing specifications                    │
│    - Identify under-specified areas                     │
│    - Log gaps to registry                               │
│                                                         │
│ 3. Resolve conflicts                                    │
│    - Work through registry by severity                  │
│    - Update affected documents                          │
│    - Mark conflicts resolved                            │
│                                                         │
│ 4. Fill gaps                                            │
│    - Write new documentation                            │
│    - Expand existing documentation                      │
│    - Mark gaps filled                                   │
│                                                         │
│ 5. Convergence check                                    │
│    - If new conflicts/gaps found: ITERATION N+1        │
│    - If clean pass: CONVERGED                          │
└─────────────────────────────────────────────────────────┘
```

### 6.3 Expected Iterations

Based on the 11-document set:

| Iteration | Expected Outcome |
|-----------|------------------|
| 1 | Many conflicts found (D01 vs later docs), major gaps identified |
| 2 | New conflicts from gap-filling docs, fewer existing conflicts |
| 3 | Minor conflicts, edge cases |
| 4+ | Convergence expected |

### 6.4 Diminishing Returns Check

If iteration count exceeds 5:

1. **Stop and assess** - Are conflicts fundamental design disagreements?
2. **Escalate** - Some conflicts may require design decisions, not doc fixes
3. **Document as known issues** - Accept some ambiguity with explicit acknowledgment

---

## 7. Practical Execution Guide

### 7.1 Session Structure

Each cross-reference session should:

1. **Set scope** - Which documents, which conflict categories
2. **Time-box** - 2-4 hours per session max
3. **Document as you go** - Don't batch conflict logging
4. **Commit checkpoint** - Save progress even if incomplete

### 7.2 Recommended Order

For this protocol:

1. **Start with D01 (Overview)** - It's known to be outdated; surface all discrepancies
2. **Core mechanics next** - D05 (Epoch), D06 (Tax), D02 (AMM)
3. **Dependent specs** - D04 (Carnage), D09 (Yield), D07 (Soft Peg)
4. **Launch flow** - D03 (Bonding), D08 (Initialization)
5. **Infrastructure** - D10 (Transfer Hook), D11 (Setup)

### 7.3 Quick Reference: Comparison Pairs

High-value document pairs to compare directly:

| Pair | Why Compare |
|------|-------------|
| D01 vs D06 | Tax percentages, epoch timing |
| D02 vs D06 | Swap execution order, fee application |
| D03 vs D08 | Pool seeding amounts, token allocations |
| D04 vs D05 | Carnage trigger, VRF integration |
| D05 vs D06 | Epoch transition sequence |
| D09 vs D06 | Yield source, distribution timing |
| D10 vs D02 | Transfer hook integration |

---

## 8. Output Artifacts

This methodology produces:

| Artifact | Location | Purpose |
|----------|----------|---------|
| Concept Inventory | `.planning/research/CONCEPTS.md` | All defined concepts |
| Cross-Reference Matrix | `.planning/research/MATRIX.md` | Concept x Document mapping |
| Conflicts Registry | `.planning/research/CONFLICTS.md` | All identified conflicts |
| Gaps Registry | `.planning/research/GAPS.md` | All identified gaps |
| Iteration Log | `.planning/research/ITERATIONS.md` | Progress tracking |

---

## 9. Sources

This methodology draws from established requirements engineering practices:

- [Requirements Traceability Matrix Guide](https://www.testrail.com/blog/requirements-traceability-matrix/) - RTM fundamentals
- [ISO/IEC/IEEE 29148](https://www.reqview.com/blog/requirements-traceability-matrix/) - Systems and software engineering requirements standards
- [Software Requirements Conflict Identification](https://thesai.org/Downloads/Volume7No10/Paper_44-Software_Requirements_Conflict_Identification.pdf) - Academic review of conflict detection techniques
- [AI Document Consistency and Reducing Conflicts](https://www.testmanagement.com/blog/2025/11/ai-document-consistency/) - Document consistency principles
- [Documentation Review Checklist](https://whisperit.ai/blog/documentation-review-checklist) - Practical review techniques

---

## 10. Quality Gate Verification

- [x] Methodology is practical for 11 documents (section 7 provides execution guide)
- [x] Includes specific conflict categories to check (section 4 with checklists)
- [x] Provides tracking/resolution workflow (section 5)
- [x] Verification of resolution addressed (section 5.3 step 5-6)
- [x] Iterative convergence process defined (section 6)
