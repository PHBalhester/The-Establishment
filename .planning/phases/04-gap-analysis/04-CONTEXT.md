# Phase 4: Gap Analysis - Context

**Gathered:** 2026-02-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Audit all 12 spec documents against the 14-category coverage checklist to identify specification gaps. Outputs include: missing mathematical invariants, missing state machine transitions (especially "during wait" behaviors), and CPI depth/compute budget concerns. The deliverable is a complete gap inventory that Phase 5 will systematically resolve.

</domain>

<decisions>
## Implementation Decisions

### Gap Severity Criteria
- CRITICAL = security-impacting OR blocks implementation (both conditions qualify)
- No severity boost for foundation documents — judge each gap on its own merit
- Industry-standard Solana/Anchor patterns MUST be explicit in specs (v3 lesson about unstated assumptions)
- "Similar to X" references depend on criticality — security-relevant needs explicit spec, minor can reference
- TODOs/TBDs evaluated individually, not automatic CRITICAL

### Output Structure
- Each gap gets a unique ID: GAP-XXX format for Phase 5 tracking
- Full context per gap entry: what's missing + why it matters + potential impact
- All gaps in unified list with [CROSS-DOC] tag for those spanning multiple specs

### Cross-Document Gaps
- Two-pronged identification: Phase 3 matrices as starting point + CPI call tracing
- All 22 single-source concepts from Phase 3 get systematic evaluation (gap or intentionally authoritative?)

### Claude's Discretion
- HIGH vs MEDIUM severity distinction
- LOW gap handling (log vs skip vs separate category)
- Output organization (by severity, by document, by category)
- Summary/dashboard format — something balanced
- Cross-document gap fix location — which doc owns the authoritative spec

</decisions>

<specifics>
## Specific Ideas

- v3 failure was unstated assumptions — err on side of explicit documentation even for "obvious" patterns
- Phase 3 already flagged 22 single-source concepts and 8 assumptions — leverage this existing analysis
- Gaps should be actionable enough that Phase 5 can resolve without re-analyzing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-gap-analysis*
*Context gathered: 2026-02-02*
