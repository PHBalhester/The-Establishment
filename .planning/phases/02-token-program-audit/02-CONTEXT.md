# Phase 2: Token Program Audit - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate and document token program assumptions across all 4 pools — this is the v3 failure root cause. Audit specs to ensure T22 vs SPL distinctions, WSOL handling, transfer hooks, and ATA derivations are explicitly documented everywhere they matter. Create matrices showing token programs and hook coverage per pool side.

</domain>

<decisions>
## Implementation Decisions

### Documentation Placement
- Update specs directly when token program info is wrong or missing
- Add audit trail notes to each spec update: "Updated: T22/WSOL validation (Phase 2 audit)"
- Create central reference document in docs/ folder (name at Claude's discretion)
- Central doc serves as authoritative truth for token program info

### Conflict Handling
- DO NOT fix spec conflicts during Phase 2 — log all issues for Phase 5 (Convergence)
- Create central reference doc as DRAFT, marked "pending spec alignment" until Phase 5
- This keeps Phase 2 focused on identification, Phase 5 on resolution

### Security Analysis
- Full threat model covering ALL token program security implications (not just WSOL/hooks)
- Include likelihood, impact, and recommended mitigations
- Equal treatment of all threats — don't prioritize v3-related over others
- Internal validation only — actual security review happens separately

### Claude's Discretion
- Matrix format (markdown table vs structured data)
- Matrix scope (unified vs per-pool matrices)
- Hook coverage integration (combined with token matrix or separate)
- ATA derivation placement (inline vs separate section)
- Central doc naming
- Conflict severity assessment
- Gap classification (CONFLICTS.md vs GAPS.md)
- Threat model location (within central doc vs separate security doc)
- Risk framework selection
- Whether to include real-world exploit examples

</decisions>

<specifics>
## Specific Ideas

- Central reference doc lives in docs/ folder alongside other project documentation
- Spec updates include explicit audit trail notes for traceability
- Threat model should be comprehensive (likelihood, impact, mitigations) but internal-only for now
- "DRAFT - pending spec alignment" status on central doc acknowledges specs need Phase 5 fixes

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-token-program-audit*
*Context gathered: 2026-02-01*
