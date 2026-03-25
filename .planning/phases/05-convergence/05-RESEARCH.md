# Phase 5: Convergence - Research

**Researched:** 2026-02-02
**Domain:** Documentation Gap Resolution and Iterative Stability
**Confidence:** HIGH

## Summary

Phase 5 fills the 24 gaps identified in Phase 4 and iterates until the documentation set achieves stability (2 consecutive clean passes with zero new gaps discovered). This is a documentation editing phase, not a code implementation phase. The methodology is well-defined: gaps have detailed entries in GAPS.md with severity, category, and suggested fixes; the 05-CONTEXT.md locks in key decisions about resolution depth, priority ordering, and iteration strategy.

Key simplifications from Phase 4 findings:
- **Zero conflicts exist** - the v3 failure was caused by unstated assumptions, not contradictions between documents
- Therefore CONV-01 (resolve conflicts) is effectively complete before Phase 5 starts
- Phase 5 focus is entirely on gap filling (CONV-02) and iteration (CONV-03, CONV-04)

The gap inventory is well-structured: 5 HIGH, 16 MEDIUM, 3 LOW across 24 unique gaps. The 05-CONTEXT.md mandates HIGH gaps are resolved completely before any MEDIUM/LOW work begins. Three cross-document gaps (GAP-053, GAP-057, GAP-063) require atomic resolution across multiple specs to prevent temporary inconsistencies.

**Primary recommendation:** Execute gap fills in priority tiers (HIGH first, then MEDIUM, then LOW), with Q&A checkpoints and re-analysis after each tier. Use Epoch_State_Machine_Spec.md as the quality template. Cross-document gaps must be resolved atomically within single plans.

## Standard Stack

### Core Tools

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Markdown | CommonMark | Specification documents | Established format across all project docs |
| Git | System | Version control, atomic commits | Track changes per gap fill |
| GAPS.md | Phase 4 output | Gap inventory with severity and suggested fixes | Authoritative gap source |
| ITERATIONS.md | Phase 1 output | Track convergence passes | Documents iteration toward stability |

### Supporting Documents

| Document | Purpose | Key Content |
|----------|---------|-------------|
| `.planning/audit/GAPS.md` | Gap inventory | 24 gaps with GAP-XXX IDs, severity, suggested fixes |
| `.planning/audit/ITERATIONS.md` | Iteration tracker | Convergence status, consecutive clean passes |
| `.planning/phases/05-convergence/05-CONTEXT.md` | User decisions | Priority tiers, resolution depth, iteration strategy |
| `Docs/Epoch_State_Machine_Spec.md` | Quality template | Exemplary spec (0 gaps) to use as target quality level |

**No installation required** - this is a documentation editing phase.

## Architecture Patterns

### Pattern 1: Gap Resolution Entry Update

**What:** When filling a gap, update GAPS.md to track resolution status.

**When to use:** After completing each gap fill.

**Why:** From Phase 1 decisions - "Full audit trails everywhere because this is a documentation audit."

**Example:**
```markdown
### GAP-001: Overview Missing WSOL SPL Token Clarification

| Field | Value |
|-------|-------|
| Category | 1. Token Program Compatibility |
| Severity | HIGH |
| Document(s) | DrFraudsworth_Overview.md |
| Status | **Filled** |
| Resolution | Added clarifying note in Token Structure section referencing Token_Program_Reference.md |
| Filled In | DrFraudsworth_Overview.md Section 2.1 |
| Iteration | 1 |
```

### Pattern 2: Comprehensive Fill Format

**What:** Gap fills strengthen the entire section, not just add the minimum required content.

**When to use:** All gap fills (per 05-CONTEXT.md decisions).

**Why:** From 05-CONTEXT.md - "Comprehensive approach: use each gap as opportunity to strengthen the entire section."

**Structure for HIGH gaps:**
```markdown
## [Section Name]

[Prose explanation of the concept]

### [Subsection with Technical Details]

[Specification content]

### Worked Example (for HIGH gaps and complex behaviors only)

[Concrete numerical example showing the concept in action]

### Test Scenarios

[Describe specific testing scenarios, not implementation details]
```

### Pattern 3: Cross-Document Atomic Resolution

**What:** Gaps spanning multiple documents are resolved in a single plan to prevent temporary inconsistency.

**When to use:** GAP-053, GAP-057, GAP-063 (tagged [CROSS-DOC] or identified as cross-doc in analysis).

**Why:** From 05-CONTEXT.md - "Cross-document gaps must be resolved in the same plan (no temporary inconsistency)."

**Process:**
1. Identify all documents affected by the gap
2. Determine authoritative source (Claude's discretion per gap)
3. Update all affected documents in same plan
4. Commit all changes together

### Pattern 4: Threat Model Format (for GAP-054)

**What:** Authority burn verification requires a full threat model analysis.

**When to use:** GAP-054 specifically.

**Why:** From 05-CONTEXT.md - "GAP-054 (authority burn): requires full threat model like we did for WSOL in Phase 2."

**Template (from Token_Program_Reference.md Section 8):**
```markdown
### 8.X Authority Burn Verification

| ID | Threat | Likelihood | Impact | Status |
|----|--------|------------|--------|--------|
| TM-XX | Unburned authority Y | ... | ... | ... |

**Threat:** [Description]
**Likelihood:** [LOW/MEDIUM/HIGH]
**Impact:** [LOW/MEDIUM/HIGH/CRITICAL]
**Current Mitigation:** [List of mitigations]
**Verification Procedure:**
```typescript
// Verification code
```
**Status:** [Mitigated/Accepted/Open]
```

### Pattern 5: CPI Depth Documentation (for GAP-064)

**What:** Document CPI depth with explicit chain diagram and Solana limit acknowledgment.

**When to use:** GAP-064 specifically.

**Why:** From 05-CONTEXT.md - "GAP-064 (CPI depth): correct Carnage spec's '3 levels' claim to accurate '4 levels' with inline warning."

**Template:**
```markdown
## CPI Depth Analysis

**Execution Path:**
```
Epoch::vrf_callback (entry point)
  |-> Tax::swap_exempt (depth 1)
      |-> AMM::swap (depth 2)
          |-> Token-2022::transfer_checked (depth 3)
              |-> Transfer Hook::execute (depth 4) -- SOLANA LIMIT
```

**Total CPI Depth:** 4 (exactly at Solana's hard limit of 4)

**WARNING: ARCHITECTURAL CONSTRAINT**
- No additional CPI calls can be added to this path
- Future Token-2022 changes requiring more depth would break Carnage
- This constraint is PERMANENT and UNCHANGEABLE
```

### Anti-Patterns to Avoid

- **Minimal fills:** Don't just add the bare minimum to close the gap - strengthen the whole section
- **Partial cross-doc updates:** Never update one document of a cross-doc gap without updating all affected docs
- **Skipping status updates:** Always update GAPS.md when filling a gap
- **Implicit threat models:** Security-related gaps (like GAP-054) need explicit threat analysis, not just prose
- **CPI depth handwaving:** GAP-064 requires exact depth count, not approximations

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gap tracking | Ad-hoc notes | GAPS.md with Status field updates | Established tracking from Phase 1 |
| Quality reference | Invent new format | Copy Epoch_State_Machine_Spec.md patterns | Exemplary spec with 0 gaps |
| Threat model | Prose description | TM-XX format from Token_Program_Reference.md | Established security documentation pattern |
| Iteration tracking | Mental accounting | ITERATIONS.md updates | Convergence criteria require documented passes |
| Value conflict resolution | Choose arbitrary value | Present options to user (per 05-CONTEXT.md) | GAP-057 whitelist count requires user decision |

## Common Pitfalls

### Pitfall 1: Resolving Cross-Doc Gaps Across Multiple Plans

**What goes wrong:** GAP-053 is resolved in one plan for Bonding_Curve_Spec.md, but Protocol_Initialization.md isn't updated until a later plan. During the gap, documentation is temporarily inconsistent.

**Why it happens:** Natural tendency to batch work by document rather than by gap.

**How to avoid:** From 05-CONTEXT.md - "Atomicity: cross-document gaps must be resolved in the same plan." Plan cross-doc gaps together, not separately.

**Warning signs:** Plan edits only one document but gap entry shows multiple affected documents.

### Pitfall 2: Minimal Gap Fills

**What goes wrong:** Gap asks for "account architecture section" and implementer adds a 3-line summary instead of comprehensive specification.

**Why it happens:** Time pressure or uncertainty about depth required.

**How to avoid:** From 05-CONTEXT.md - "Comprehensive approach: use each gap as opportunity to strengthen the entire section." Use Epoch_State_Machine_Spec.md as quality reference.

**Warning signs:** New section is significantly shorter than equivalent sections in Epoch_State_Machine_Spec.md.

### Pitfall 3: Forgetting to Update GAPS.md Status

**What goes wrong:** Gap is filled in the spec document, but GAPS.md still shows "Status: Open." Re-analysis thinks gap still exists.

**Why it happens:** Focus on spec editing, forget tracking update.

**How to avoid:** Each plan should explicitly include "Update GAPS.md" as a task.

**Warning signs:** Re-analysis pass discovers gaps that were supposedly already filled.

### Pitfall 4: Iteration Without Q&A Checkpoint

**What goes wrong:** After filling all MEDIUM gaps, moving directly to LOW without user validation. Mistakes in MEDIUM fills propagate and compound.

**Why it happens:** Momentum to "just finish" without stopping.

**How to avoid:** From 05-CONTEXT.md - "Q&A checkpoint: after every re-analysis iteration pass."

**Warning signs:** Multiple iterations complete without user feedback.

### Pitfall 5: Choosing Arbitrary Values for Cross-Doc Conflicts

**What goes wrong:** GAP-057 (whitelist count: 10 vs 13) is resolved by picking one number without user input.

**Why it happens:** Desire to make progress; conflict seems "obvious" to resolve.

**How to avoid:** From 05-CONTEXT.md - "Value conflicts (like GAP-057 whitelist count): present options with implications, user decides."

**Warning signs:** Cross-doc gap with numeric inconsistency resolved without explicit user decision.

### Pitfall 6: Skipping Re-Analysis After Tier Completion

**What goes wrong:** After completing HIGH gaps, jumping directly to MEDIUM without running gap analysis to verify no new issues were introduced.

**Why it happens:** Assumption that edits only fixed things, didn't break anything.

**How to avoid:** From 05-CONTEXT.md - "Priority tier batching: HIGH first, verify clean, then MEDIUM, verify clean, then LOW."

**Warning signs:** Plan sequence goes HIGH -> MEDIUM without intermediate verification.

## Execution Workflow

### Phase 5 Execution Order

Based on ROADMAP.md requirements and 05-CONTEXT.md decisions:

```
1. Fill all HIGH gaps (5 gaps: GAP-001, GAP-004, GAP-005, GAP-054, GAP-064)
   |
   v
2. Q&A Checkpoint (verify HIGH fills correct)
   |
   v
3. Re-run gap analysis (check for new issues)
   |
   v
4. Fill all MEDIUM gaps (16 gaps) + resolve CROSS-DOC gaps atomically
   |
   v
5. Q&A Checkpoint (verify MEDIUM fills correct)
   |
   v
6. Re-run gap analysis (check for new issues)
   |
   v
7. Fill all LOW gaps (3 gaps)
   |
   v
8. Q&A Checkpoint (verify LOW fills correct)
   |
   v
9. Final re-run gap analysis
   |
   v
10. If clean: Run second consecutive pass
   |
   v
11. If 2 consecutive clean passes: Phase 5 complete
```

### Gap Priority Map

**HIGH (5 gaps) - First:**
| GAP ID | Document(s) | Summary | Special Requirements |
|--------|-------------|---------|----------------------|
| GAP-001 | DrFraudsworth_Overview.md | WSOL SPL Token clarification | v3 root cause - critical |
| GAP-004 | Tax_Pool_Logic_Spec.md | Account architecture section | Template from Epoch spec |
| GAP-005 | Tax_Pool_Logic_Spec.md | Instruction account lists | Complete Anchor-style tables |
| GAP-054 | Protocol_Initialzation_and_Launch_Flow.md | Authority burn verification | Full threat model required |
| GAP-064 | Carnage_Fund_Spec.md, Epoch_State_Machine_Spec.md | CPI depth at Solana limit | Inline warning format |

**CROSS-DOC (3 gaps) - With MEDIUM tier:**
| GAP ID | Documents | Summary | Resolution Approach |
|--------|-----------|---------|---------------------|
| GAP-053 | Bonding_Curve_Spec.md, Protocol_Initialization | Partner curve failure state | Single source or synced (Claude discretion) |
| GAP-057 | Transfer_Hook_Spec.md, Protocol_Initialization | Whitelist count (10 vs 13) | User decision required |
| GAP-063 | Epoch_State_Machine_Spec.md, Carnage_Fund_Spec.md | Carnage pending + epoch overlap | Expand Epoch spec |

**MEDIUM (16 gaps) - After HIGH verified:**
- GAP-002 through GAP-010 (excluding HIGH gaps already listed)
- GAP-050 through GAP-066 (excluding HIGH and CROSS-DOC already listed)

**LOW (3 gaps) - Last:**
- GAP-008: Tax spec event emissions
- GAP-052: Carnage operational runbooks
- GAP-062: Tax band boundary conditions

### Suggested Plan Breakdown

Based on 05-CONTEXT.md guidance and gap dependencies:

**Plan 05-01: HIGH Gaps - Tax Spec Foundations**
- GAP-004: Tax_Pool_Logic_Spec account architecture
- GAP-005: Tax_Pool_Logic_Spec instruction account lists
- These are related and both affect Tax spec

**Plan 05-02: HIGH Gaps - Critical Safety**
- GAP-001: Overview WSOL clarification (v3 root cause)
- GAP-054: Authority burn verification with threat model
- GAP-064: CPI depth at Solana limit acknowledgment

**Plan 05-03: Verify HIGH Tier + Q&A Checkpoint**
- Re-run gap analysis on modified documents
- Q&A with user to validate HIGH fills
- Identify any new gaps introduced

**Plan 05-04: MEDIUM Gaps - Tax Spec Completion**
- GAP-006: CPI depth analysis for Tax spec
- GAP-007: Error handling for Tax spec
- GAP-065: Compute budget estimates
- GAP-066: Authority signing documentation

**Plan 05-05: MEDIUM Gaps - Core Specs**
- GAP-002: Token-2022 extension inventory
- GAP-003: Overview invariants summary
- GAP-009: AMM account size calculation
- GAP-010: Yield system testing requirements

**Plan 05-06: MEDIUM Gaps - Dependent Specs + Cross-Doc Resolution**
- GAP-050: Carnage compute budget estimate
- GAP-051: Soft peg worked examples
- GAP-053: [CROSS-DOC] Partner curve failure state (atomic update)
- GAP-055: execute_transition account list
- GAP-056: Curve fill during-wait behavior

**Plan 05-07: MEDIUM Gaps - Cross-Doc Resolution**
- GAP-057: [CROSS-DOC] Whitelist count inconsistency (requires user decision)
- GAP-063: [CROSS-DOC] Carnage pending + epoch overlap

**Plan 05-08: MEDIUM Gaps - Invariants and State Machines**
- GAP-060: Total supply conservation invariant
- GAP-061: Invariant violation consequences
- Update Overview with consolidated invariant section

**Plan 05-09: Verify MEDIUM Tier + Q&A Checkpoint**
- Re-run gap analysis
- Q&A with user
- Prepare for LOW tier

**Plan 05-10: LOW Gaps**
- GAP-008: Tax spec event emissions
- GAP-052: Carnage operational runbooks
- GAP-062: Tax band boundary conditions

**Plan 05-11: Final Verification**
- Complete re-run of gap analysis
- Run second consecutive clean pass
- Update ITERATIONS.md with convergence status
- Final Q&A checkpoint

## Expected Effort Distribution

| Tier | Gap Count | Relative Effort | Notes |
|------|-----------|-----------------|-------|
| HIGH | 5 | 40% | GAP-054 threat model is intensive; GAP-004/005 are substantial additions |
| MEDIUM | 16 | 50% | Volume of gaps; cross-doc coordination adds complexity |
| LOW | 3 | 5% | Straightforward additions |
| Iteration/Verify | N/A | 5% | Re-analysis passes, Q&A checkpoints |

**Total Estimated Plans:** 10-12 (may adjust based on iteration findings)

## Quality References

### Exemplary Spec: Epoch_State_Machine_Spec.md

The Epoch spec achieved 0 gaps in Phase 4 audit. Key patterns to replicate:

1. **Complete account architecture** (Section 4)
   - Full struct with comments
   - Size calculation
   - PDA derivation

2. **State machine diagram** (Section 6.1)
   - ASCII art state diagram
   - All states and transitions labeled

3. **Instruction tables** (Section 8.x)
   - Complete account list per instruction
   - Type, mutability, description columns

4. **Error handling** (Section 11)
   - Full `#[error_code]` enum
   - Descriptive messages

5. **Events** (Section 12)
   - Complete event structs
   - All relevant fields

6. **Security considerations** (Section 14)
   - Explicit threat discussion
   - Compute budget analysis

7. **Testing requirements** (Section 15)
   - Unit, integration, negative, stress categories
   - Specific scenarios listed

### Quality Checklist for Gap Fills

Before marking a gap as filled:

- [ ] Content addresses the "What's Missing" from GAPS.md
- [ ] Section is comparable in depth to Epoch spec equivalent
- [ ] Worked example included (if HIGH gap or complex behavior)
- [ ] Test scenarios described (if applicable)
- [ ] Cross-references to related specs included
- [ ] GAPS.md Status updated to "Filled" with Resolution details

## Open Questions

### 1. GAP-057 Value Resolution

**Question:** Should the whitelist count be 10 or 13?

**What we know:**
- Transfer_Hook_Spec.md Section 4 says "Total: 10 addresses"
- Protocol_Initialization.md Section 6.2 lists 13 entries (8 pool vaults + 2 Carnage vaults + 2 Curve vaults + 1 Reserve)

**What's unclear:** Is Transfer_Hook_Spec.md outdated, or does Protocol_Initialization.md include entries that shouldn't be whitelisted?

**Recommendation:** Per 05-CONTEXT.md, present both options to user with implications during Plan 05-07 execution.

### 2. GAP-053 Authority Resolution

**Question:** Should partner curve failure be a new `PartnerFailed` enum state, or documented as "Filled + partner Failed = refund eligible"?

**Options:**
- A) Add `PartnerFailed` status to CurveStatus enum - explicit state machine, cleaner code
- B) Document `Filled` + partner `Failed` compound state - simpler, no code change needed

**Recommendation:** Claude's discretion per 05-CONTEXT.md. Option B is documentation-only (fits this phase), Option A implies code design decision.

### 3. GAP-063 Expansion Location

**Question:** Which spec should be the authoritative source for Carnage pending + epoch transition overlap?

**Options:**
- Epoch_State_Machine_Spec.md (owns epoch transitions)
- Carnage_Fund_Spec.md (owns Carnage state)

**Recommendation:** Per 05-CONTEXT.md - "GAP-063: expand Epoch_State_Machine_Spec.md with cross-system interaction section."

## Sources

### Primary (HIGH confidence)
- `.planning/phases/05-convergence/05-CONTEXT.md` - User decisions constraining approach
- `.planning/audit/GAPS.md` - Complete gap inventory with 24 entries
- `.planning/ROADMAP.md` - Phase requirements and success criteria
- `Docs/Epoch_State_Machine_Spec.md` - Quality template (0 gaps)
- `Docs/Token_Program_Reference.md` Section 8 - Threat model pattern

### Secondary (MEDIUM confidence)
- Phase 4 verification report - Gap severity validation
- Phase 1 CONTEXT.md - Convergence definition (2 consecutive clean passes)

### Tertiary (LOW confidence)
- None - this is process execution using established patterns

## Metadata

**Confidence breakdown:**
- Gap resolution methodology: HIGH - Constrained by CONTEXT.md and established gap format
- Priority ordering: HIGH - Explicitly defined in CONTEXT.md decisions
- Quality target: HIGH - Epoch spec provides concrete template
- Iteration strategy: HIGH - Defined in CONTEXT.md with clean pass requirements

**Research date:** 2026-02-02
**Valid until:** Indefinite - process documentation based on locked decisions
