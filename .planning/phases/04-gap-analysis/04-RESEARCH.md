# Phase 4: Gap Analysis - Research

**Researched:** 2026-02-02
**Domain:** Specification Gap Detection and Coverage Analysis
**Confidence:** HIGH

## Summary

Phase 4 audits all 12 specification documents against the established 14-category coverage checklist to identify specification gaps. The methodology is well-defined: Phase 3 already built the cross-reference matrices (85 concepts, 0 conflicts), identified 22 single-source concepts, and validated 8 assumptions. Phase 4 uses these as starting points plus systematic category-by-category auditing.

The key insight from CONTEXT.md decisions: the v3 failure was unstated assumptions, not contradictions. This means Phase 4 should err on the side of logging gaps for "obvious" patterns that experienced Solana/Anchor developers might assume but aren't explicitly documented. Industry-standard patterns MUST be explicit in specs.

**Primary recommendation:** Execute in a systematic document-by-document audit using the 14-category checklist, evaluating each of the 22 single-source concepts, and tracing CPI calls to find cross-document gaps. Output gaps with GAP-XXX IDs, full context, and severity classification (CRITICAL/HIGH/MEDIUM/LOW).

## Standard Stack

### Core Tools

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Markdown | CommonMark | Gap inventory documentation | Version-controllable, established pattern |
| Existing cross-reference matrices | Phase 3 | Starting point for single-source evaluation | Already captures concept locations |
| 14-category checklist | `.planning/research/COVERAGE.md` | Systematic audit framework | Explicitly researched for this project |

### Supporting Documents

| Document | Purpose | Key Content |
|----------|---------|-------------|
| `.planning/cross-reference/00-concept-inventory.md` | Master concept list | 85 concepts, 8 assumptions, 22 single-source flags |
| `.planning/cross-reference/*-matrix.md` | Cross-reference matrices | Concept locations across all 12 docs |
| `.planning/audit/GAPS.md` | Target output location | Gap tracking with severity and categories |
| `.planning/audit/CONFLICTS.md` | Phase 3 assumption validation | 8 validated assumptions to reference |

**No installation required** - this is a documentation audit phase.

## Architecture Patterns

### Recommended Output Structure

```
.planning/
├── audit/
│   └── GAPS.md                    # Updated with logged gaps (GAP-XXX entries)
│
└── phases/04-gap-analysis/
    ├── 04-CONTEXT.md              # Already exists (user decisions)
    ├── 04-RESEARCH.md             # This file
    └── 04-XX-PLAN.md              # Execution plans
```

### Pattern 1: Gap Entry Format

**What:** Each identified gap gets a standardized entry with unique ID, category, severity, and context.

**When to use:** Logging every gap to GAPS.md

**Why:** From CONTEXT.md - "Full context per gap entry: what's missing + why it matters + potential impact"

**Example:**
```markdown
### GAP-001: Missing Account Size Calculation for UserYieldAccount

| Field | Value |
|-------|-------|
| Category | 2. Account Architecture |
| Severity | MEDIUM |
| Document(s) | Yield_System_Spec.md |
| Status | Open |

**What's Missing:**
UserYieldAccount struct is defined but no explicit account size calculation is provided.

**Why It Matters:**
Account size affects rent-exempt minimum and must be calculated correctly for Anchor's `space` constraint.

**Potential Impact:**
- Implementation could miscalculate space
- Under-allocation causes runtime errors
- Over-allocation wastes SOL

**Suggested Fix:**
Add field-by-field breakdown: 32 + 8 + 16 + 8 + 8 + 8 + 8 + 1 = 89 bytes (+ 8 discriminator = 97 bytes)
```

### Pattern 2: Single-Source Concept Evaluation

**What:** Systematic evaluation of each of the 22 single-source concepts from Phase 3.

**When to use:** During gap detection, before logging

**Why:** From CONTEXT.md - "22 single-source concepts flagged for Phase 4 gap analysis"

**Evaluation Framework:**
```markdown
For each single-source concept:

1. Is this intentionally authoritative? (Formula definitions, implementation details)
   YES → Not a gap. Single-source is correct.
   NO → Continue

2. Should other documents reference this?
   YES → Log gap: Document X should reference [CONCEPT-ID]
   NO → Continue

3. Is this an unstated assumption that could cause v3-style failures?
   YES → Log gap: Make explicit in [relevant doc]
   NO → Single-source is acceptable
```

### Pattern 3: Category-Based Systematic Audit

**What:** For each document, audit against all 14 categories to ensure complete coverage.

**When to use:** Primary audit methodology

**Why:** From COVERAGE.md - proven framework for DeFi protocol specifications

**Audit Template:**
```markdown
## [Document Name] Audit

### Category 1: Token Program Compatibility
- [ ] Token standard matrix present?
- [ ] Pool token program requirements specified?
- [ ] Transfer instruction requirements documented?
- [ ] Token-2022 extensions listed?

### Category 2: Account Architecture
- [ ] Complete PDA inventory?
- [ ] Account size calculations?
- [ ] Account ownership documented?
- [ ] Rent considerations addressed?

... [continue for all 14 categories]
```

### Pattern 4: CPI Depth Tracing

**What:** Map all CPI relationships and verify compute budget concerns are documented.

**When to use:** GAP-04 requirement (CPI depth analysis gaps)

**Why:** From CONTEXT.md - "CPI depth analysis gaps documented with compute budget concerns"

**Tracing Template:**
```markdown
## CPI Depth Analysis

### [Instruction Name]

**CPI Chain:**
```
Epoch Program::vrf_callback
  └─> Staking Program::update_cumulative (depth 1)
  └─> Carnage logic (inline)
      └─> AMM Program::swap_exempt (depth 1)
          └─> Token-2022::transfer_checked (depth 2)
              └─> Transfer Hook (depth 3)
```

**Max Depth:** 3
**Compute Estimate:** ~260k CU (documented in spec? YES/NO)
**Gap:** [Description if compute not documented]
```

### Pattern 5: Cross-Document Gap Tagging

**What:** Gaps that span multiple documents get a [CROSS-DOC] tag for Phase 5 routing.

**When to use:** When a gap affects or requires updates to multiple specs

**Why:** From CONTEXT.md - "All gaps in unified list with [CROSS-DOC] tag for those spanning multiple specs"

**Example:**
```markdown
### GAP-015: [CROSS-DOC] Whitelist Entry Count Inconsistency

| Field | Value |
|-------|-------|
| Category | 6. Authority & Access Control |
| Severity | MEDIUM |
| Document(s) | Transfer_Hook_Spec.md, Protocol_Initialization.md, DrFraudsworth_Overview.md |
| Status | Open |

**What's Missing:**
Whitelist entry count varies: "10-13" in Transfer_Hook, "13" in initialization, not mentioned in Overview.

**Why It Matters:**
Must know exact count for authority burn verification.

**Affected Documents:**
1. Transfer_Hook_Spec.md - Authoritative (should be explicit)
2. Protocol_Initialization.md - References count
3. DrFraudsworth_Overview.md - Should match
```

### Anti-Patterns to Avoid

- **Logging non-gaps:** Single-source formulas are intentionally authoritative, not gaps
- **Over-flagging:** Not every missing detail is a gap; focus on implementation-blocking or security-impacting
- **Severity inflation:** Reserve CRITICAL for actual security/correctness issues
- **Duplicate logging:** Check if Phase 3 already addressed something
- **Vague descriptions:** Gaps must be actionable for Phase 5

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gap ID scheme | Random numbering | GAP-XXX sequential | Traceable, referenced in Phase 5 |
| Category assignment | Ad-hoc categories | 14-category checklist | Consistent framework |
| Severity classification | Gut feeling | CONTEXT.md criteria | Documented rules |
| Single-source evaluation | Skip or auto-flag | Systematic framework | Some are intentionally single-source |

## Common Pitfalls

### Pitfall 1: Treating Single-Source as Automatic Gaps

**What goes wrong:** Flagging all 22 single-source concepts as gaps when many are intentionally authoritative.
**Why it happens:** Mechanical application of "appears in one doc = gap."
**How to avoid:** Use the single-source evaluation framework. Formulas and implementation-specific details often belong in one place.
**Warning signs:** Gap list includes FORM-003 through FORM-008 (these are correctly single-source).

### Pitfall 2: Missing "During Wait" Behaviors

**What goes wrong:** Not documenting what happens during asynchronous waits (VRF pending, Carnage pending).
**Why it happens:** Specs focus on happy path, not intermediate states.
**How to avoid:** Explicitly audit each state machine for "what happens while waiting?" For example: Can users swap during VRF_PENDING? (Yes, old taxes apply.)
**Warning signs:** State machine specs only show transitions, not behaviors during states.

### Pitfall 3: Assuming Standard Patterns Are Obvious

**What goes wrong:** Not documenting Anchor/Solana patterns that "any developer would know."
**Why it happens:** v3 lesson: WSOL being SPL Token was "obvious" but unstated.
**How to avoid:** From CONTEXT.md: "Industry-standard Solana/Anchor patterns MUST be explicit in specs."
**Warning signs:** Phrases like "standard CPI pattern" without explaining what that means.

### Pitfall 4: Compute Budget Handwaving

**What goes wrong:** Claiming operations "fit within budget" without actual estimates.
**Why it happens:** Compute estimation is tedious; developers assume it'll be fine.
**How to avoid:** Flag any CPI chain > depth 2 for explicit compute analysis.
**Warning signs:** No compute estimates anywhere in spec despite complex CPI patterns.

### Pitfall 5: Conflating Gaps and TODOs

**What goes wrong:** Treating spec TODOs as automatic CRITICAL gaps.
**Why it happens:** TODOs look scary.
**How to avoid:** From CONTEXT.md: "TODOs/TBDs evaluated individually, not automatic CRITICAL."
**Warning signs:** Every TBD becomes GAP-XXX:CRITICAL.

## 14-Category Checklist Quick Reference

From `.planning/research/COVERAGE.md` - abbreviated for audit use:

| # | Category | Priority | Key Questions |
|---|----------|----------|---------------|
| 1 | Token Program Compatibility | HIGH | Token matrix? Transfer instructions? Extensions? |
| 2 | Account Architecture | HIGH | PDA inventory? Sizes? Ownership? Rent? |
| 3 | Mathematical Invariants | HIGH | Core invariants? Boundaries? Violation consequences? |
| 4 | Instruction Set | MEDIUM | Complete list? Account lists? Parameters? Dependencies? |
| 5 | CPI Patterns | HIGH | CPI map? Authority patterns? Security analysis? |
| 6 | Authority & Access Control | HIGH | Authority inventory? Lifecycle? Burn procedures? |
| 7 | Economic Model | MEDIUM | Fee structure? Tax distribution? Yield calculations? |
| 8 | State Machine Specifications | HIGH | All states? Transitions? Timing? Randomness? |
| 9 | Error Handling | MEDIUM | Error codes? Recovery? Fatal errors? |
| 10 | Event Emissions | LOW | Event inventory? Indexer requirements? |
| 11 | Security Considerations | HIGH | Attack vectors? Solana vulnerabilities? Economic attacks? |
| 12 | Testing Requirements | MEDIUM | Unit tests? Integration? Invariant? Negative? |
| 13 | Deployment Specification | MEDIUM | Order? Initialization sequence? Verification? |
| 14 | Operational Documentation | LOW | Monitoring? Alerting? Runbooks? |

## 22 Single-Source Concepts for Evaluation

From Phase 3 summaries, requiring systematic evaluation:

### Constants (3)
- **CONST-006: VRF_TIMEOUT_SLOTS** (Epoch spec only) - 300 slots
- **CONST-008: TRIGGER_BOUNTY** (Epoch spec only) - 0.01 SOL
- **CONST-015: MAX_CARNAGE_SWAP** (Carnage spec only) - 1000 SOL cap

### Entities (5)
- **ENT-007: YieldState Account** (Yield spec only) - Now renamed StakePool
- **ENT-008: UserYieldAccount** (Yield spec only) - Now renamed UserStake
- **ENT-009: Pool State Account** (AMM spec only)
- **ENT-010: WhitelistEntry Account** (Hook spec only)
- **ENT-011: CurveState Account** (Curve spec only)

### Behaviors (4)
- **BEH-007: Yield Cumulative Update** (Yield spec only)
- **BEH-008: Auto-Claim on Balance Change** (Old yield spec only - now replaced by staking)
- **BEH-009: Bonding Curve Purchase Flow** (Curve spec only)
- **BEH-012: VRF Retry Mechanism** (Epoch spec only)

### Constraints (1)
- **CONSTR-012: Per-Wallet Token Cap** (Curve spec only) - 20M

### Formulas (6)
- **FORM-003: Epoch Calculation** (Epoch spec only) - Intentionally authoritative
- **FORM-004: Yield Per PROFIT Calculation** (Yield spec only) - Intentionally authoritative
- **FORM-005: Pending Yield Calculation** (Yield spec only) - Intentionally authoritative
- **FORM-006: ATA Derivation** (Token ref only) - Intentionally authoritative
- **FORM-007: Linear Curve Price Function** (Curve spec only) - Intentionally authoritative
- **FORM-008: No-Arbitrage Band** (Arbitrage spec only) - Intentionally authoritative

### Terminology (3)
- **TERM-008: Checkpoint Model** (Yield spec only) - Now "Cumulative Reward Per Token"
- **TERM-009: Ghost Yield Attack** (Yield spec only) - Security concept
- **TERM-010: Circulating Supply (PROFIT)** (Yield spec only) - Now total_staked

## Severity Classification Rules

From CONTEXT.md decisions:

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Security-impacting OR blocks implementation (either qualifies) |
| **HIGH** | Significant implementation ambiguity OR economic model gaps |
| **MEDIUM** | Clarity improvements OR missing non-critical details |
| **LOW** | Cosmetic, optional enhancements, nice-to-have documentation |

**Note:** No severity boost for foundation documents (contrary to Phase 3). Each gap judged on its own merit.

## Expected Gap Categories

Based on document review, likely gaps by category:

### Category 2: Account Architecture
- Account size calculations may be incomplete
- Some PDAs may lack explicit derivation documentation

### Category 3: Mathematical Invariants
- Yield system invariants (escrow solvency) need verification
- AMM constant product invariant may need explicit statement

### Category 4: Instruction Set
- Instruction dependencies may not be fully documented
- Parameter validation ranges may be implicit

### Category 5: CPI Patterns
- CPI depth for VRF callback + staking + Carnage execution
- Compute budget documentation

### Category 8: State Machine Specifications
- "During wait" behaviors for VRF_PENDING (partially documented, verify complete)
- Carnage fallback state machine (verify complete)

### Category 12: Testing Requirements
- Stress test scenarios mentioned but may lack detail
- Invariant tests may not be fully specified

## Document Processing Order

Audit in dependency order (upstream first):

1. **Foundation Documents:**
   - DrFraudsworth_Overview.md
   - Token_Program_Reference.md

2. **Core Mechanics:**
   - Epoch_State_Machine_Spec.md
   - Tax_Pool_Logic_Spec.md
   - AMM_Implementation.md
   - New_Yield_System_Spec.md (replaces old Yield_System_Spec.md)

3. **Dependent Specs:**
   - Carnage_Fund_Spec.md
   - Soft_Peg_Arbitrage_Spec.md

4. **Launch Flow:**
   - Bonding_Curve_Spec.md
   - Protocol_Initialzation_and_Launch_Flow.md

5. **Infrastructure:**
   - Transfer_Hook_Spec.md

6. **Development:**
   - SolanaSetup.md (minimal gaps expected)

## Open Questions

1. **Yield System Spec Update:** The New_Yield_System_Spec.md replaced the old checkpoint-based model with staking. Should the 22 single-source concepts from Phase 3 be re-evaluated given this change? (Answer: Yes, some concepts like BEH-008 "Auto-Claim" and TERM-008 "Checkpoint Model" are now obsolete.)

2. **Cross-Document Gap Ownership:** From CONTEXT.md Claude's Discretion - "which doc owns the authoritative spec." Should this be decided during gap logging or deferred to Phase 5? (Recommendation: Log options during Phase 4, decide ownership during Phase 5 resolution.)

## Sources

### Primary (HIGH confidence)
- `.planning/research/COVERAGE.md` - 14-category checklist (project-specific research)
- `.planning/phases/04-gap-analysis/04-CONTEXT.md` - User decisions constraining approach
- `.planning/cross-reference/*` - Phase 3 matrices and concept inventory
- `.planning/audit/CONFLICTS.md` - Phase 3 assumption validations

### Secondary (MEDIUM confidence)
- Industry DeFi audit standards (informed checklist)
- Solana security best practices (informed category priorities)

### Tertiary (LOW confidence)
- None - this is process execution using established patterns

## Metadata

**Confidence breakdown:**
- Gap identification methodology: HIGH - Constrained by CONTEXT.md and 14-category checklist
- Severity classification: HIGH - Rules defined in CONTEXT.md
- Single-source evaluation: HIGH - Framework from Phase 3 outputs
- CPI analysis approach: MEDIUM - Depends on actual CPI chains in specs

**Research date:** 2026-02-02
**Valid until:** Indefinite - process documentation based on locked decisions
