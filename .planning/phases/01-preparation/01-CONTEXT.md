# Phase 1: Preparation - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up tracking infrastructure for systematic documentation audit. This phase creates the scaffolding to track discoveries — document inventory, conflict log, gap log, and iteration tracker. The actual auditing happens in later phases.

</domain>

<decisions>
## Implementation Decisions

### Inventory Structure
- **Organization:** Dependency order — foundation docs first, dependent docs after (supports audit priority)
- **Metadata per doc:** Rich — name, path, dependencies, primary topics, last modified, word count, key concepts defined, external references, audit status
- **Dependencies representation:** Claude's discretion — likely visual Mermaid graph for overview + inline references in each entry for detail
- **Audit status tracking:** Phase-aware — track which audit phase last reviewed each document
- **Summary section:** Dashboard view at top — docs audited, conflicts open, gaps remaining, current iteration
- **Versioning:** Git-based — inventory shows last-modified timestamp, git handles detailed diff history
- **V3 reference:** Include archive-V3 branch as separate reference section, clearly marked as legacy/reference (not authoritative)

### Conflict Tracking Design
- **Severity determination:** Combined — impact-based baseline (CRITICAL/HIGH/MEDIUM/LOW) with foundation flag for priority adjustment
  - CRITICAL = breaks security/correctness
  - HIGH = breaks functionality
  - MEDIUM = inconsistency
  - LOW = cosmetic
  - Foundation docs with many dependents get priority boost
- **Categorization:** Both dimensions — track conflict type (value/behavioral/assumption) AND domain (token/pool/security/VRF/etc.)
- **Resolution tracking:** Full audit trail — status + rationale (which doc authoritative, why) + which iteration resolved it + what changed
- **Specificity:** Quote-level — include actual quoted text from both docs showing the conflict (self-contained, auditable)

### Gap Tracking Design
- **Categorization:** By checklist category — use the 14-category coverage checklist from research (invariants, state machines, CPI depth, etc.)
- **Priority determination:** Category baseline + adjustment
  - Security/invariant gaps → HIGH baseline
  - State machine/behavior gaps → MEDIUM baseline
  - Terminology/cosmetic gaps → LOW baseline
  - Can adjust specific gaps up/down based on actual impact
- **Gap details:** Full context — what's missing, which doc should have it, priority, suggested content/approach, why it matters, related concepts, references
- **Resolution tracking:** Full trail — status (Open/Filled/Won't fill) + location where filled + which iteration + summary of content added

### Iteration Logging
- **Iteration scope:** Change cycle — one iteration = making doc changes then re-running analysis (not phase completion or full doc passes)
- **Per-iteration logging:** Full detail — summary stats (new conflicts, new gaps, resolved, filled) + specific issues list + patterns observed + decisions made + blockers hit
- **Convergence definition:** Zero issues total + 2 consecutive clean passes
  1. All logged conflicts → resolved
  2. All logged gaps → filled (or explicitly marked won't-fill with rationale)
  3. Two consecutive verification passes → find no new issues
- **Prediction tracking:** Just actuals — no expected vs predicted iteration estimates

### Claude's Discretion
- Exact visual representation of dependency graph (Mermaid syntax, layout)
- Document entry template specifics (field ordering, formatting)
- How to handle edge cases in categorization
- File organization within .planning/audit/ directory

</decisions>

<specifics>
## Specific Ideas

- Dashboard view in inventory inspired by project health dashboards — quick scan of audit state
- Quote-level conflict specificity chosen to make CONFLICTS.md self-contained — shouldn't need to flip between files to understand a conflict
- Conservative convergence (2 clean passes) chosen because v3 failure was caused by assumptions that seemed fine on first pass
- Full audit trails everywhere because this is a documentation audit — precision and traceability matter more than brevity

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-preparation*
*Context gathered: 2026-02-01*
