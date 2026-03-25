# Phase 3: Cross-Reference - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract concepts from all 11 spec documents and build a conflict detection matrix for systematic comparison. This phase DETECTS conflicts — resolution happens in Phase 5 (Convergence).

</domain>

<decisions>
## Implementation Decisions

### Concept Taxonomy
- Prioritize behaviors and constraints over constants/formulas (v3 failure was an unstated constraint)
- Full decomposition — extract every sub-component that could conflict
- Full inference — actively identify unstated assumptions as first-class concepts
- All 6 concept types matter: constants, entities, behaviors, constraints, formulas, terminology

### Matrix Format
- Split by category (constants-matrix.md, behaviors-matrix.md, etc.) — conflicts cluster by type
- Cell content includes: value, location reference (file:line), and surrounding context
- Log conflicts in detail, include summary section for agreements
- Each row traces to source documents

### Conflict Classification
- Four-tier severity: CRITICAL / HIGH / MEDIUM / LOW
- CRITICAL = security impact OR foundation document involved
- HIGH = implementation blocking OR incorrect behavior (non-security)
- MEDIUM/LOW = clarity issues, terminology differences, minor inconsistencies
- Semantic equivalence threshold — only log when meaning differs, not formatting ('0.3%' = '0.30%')
- Behavioral conflicts get both text description AND Mermaid diagrams

### Review Workflow
- Phase 3 detects only — resolution deferred to Phase 5
- Each conflict explained clearly with: what's conflicting, where it appears, why it matters, resolution options
- Simple conflicts get recommendation + reasoning
- Complex conflicts get options with pros/cons + recommended option
- Q&A session required after Phase 3 completion (per roadmap checkpoint)

### Claude's Discretion
- Naming convention for extracted concepts (preserve vs normalize)
- How to handle single-source concepts (likely flag for Phase 4 gap analysis)
- Conflict presentation order (by severity, document, or category)

</decisions>

<specifics>
## Specific Ideas

- "As long as they are clear and explained in simple detail for me to understand and learn" — conflicts should be educational, not just logged
- V3 failure was caused by unstated assumption about WSOL token program — this validates prioritizing implicit constraints
- Resolution options should include "why, pros, cons" for complex decisions

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-cross-reference*
*Context gathered: 2026-02-01*
