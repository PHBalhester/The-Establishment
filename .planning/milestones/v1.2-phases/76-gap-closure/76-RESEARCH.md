# Phase 76: Gap Closure -- Verification + Bug Fix - Research

**Researched:** 2026-03-07
**Domain:** Procedural gap closure (documentation + one-line bug fix)
**Confidence:** HIGH

## Summary

Phase 76 closes three prescriptive gaps identified by the v1.2 milestone audit (`.planning/v1.2-MILESTONE-AUDIT.md`). All three items have exact specifications -- there are no architectural decisions or library choices to research. The work is: (1) create a missing Phase 74 VERIFICATION.md, (2) fix a one-line display bug in RefundPanel.tsx, and (3) update stale REQUIREMENTS.md checkboxes.

The research confirms the bug, validates the fix, and documents the exact format and evidence sources the planner needs to execute each task.

**Primary recommendation:** Execute all three items as a single plan with three tasks. No dependencies between them, no external libraries, no on-chain changes.

## Standard Stack

No new libraries or tools required. All work uses existing project files and patterns.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| N/A | N/A | N/A | Phase is documentation + one-line TypeScript fix |

## Architecture Patterns

### Recommended Approach

All three items are file edits. No architecture decisions needed.

### Pattern 1: VERIFICATION.md Format

**What:** Phase 74 needs a VERIFICATION.md following the established project format.
**When to use:** Every completed phase must have a VERIFICATION.md.
**Format (from Phase 75 VERIFICATION.md):**

```markdown
---
phase: 74-protocol-integration
verified: [timestamp]
status: passed
score: X/X must-haves verified
---

# Phase 74: Protocol Integration Verification Report

**Phase Goal:** [goal from CONTEXT.md]
**Verified:** [timestamp]
**Status:** passed

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | [requirement statement] | VERIFIED | [evidence] |

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| INTG-01 | SATISFIED | [evidence] |
```

### Evidence Sources for Phase 74 VERIFICATION.md

The milestone audit's integration checker already confirmed all 6 INTG requirements at the code level. Evidence mapping:

| Requirement | Evidence Source | Confirmed By |
|-------------|---------------|--------------|
| INTG-01: Whitelist entries before burn | 74-03-SUMMARY.md: "15 whitelist entries complete (13 pre-existing + 2 curve vaults)" | Integration checker |
| INTG-02: Graduation orchestration | 74-04-SUMMARY.md: "1010-line checkpoint+resume graduation script, 11-step multi-TX sequence" | Integration checker |
| INTG-03: AMM pool seeding at P_end | 74-04-SUMMARY.md: "290M tokens + 1000 SOL per pool" hardcoded | Integration checker |
| INTG-04: Tax escrow + Vault seeding | 74-04-SUMMARY.md: "distribute_tax_escrow for both curves" in graduation flow | Integration checker |
| INTG-05: Deploy pipeline (7th program) | 74-02-SUMMARY.md: "build.sh, deploy.sh, patch-mint-addresses.ts" all extended | Integration checker |
| INTG-06: Feature-gated mints + ALT | 74-02-SUMMARY.md: "feature-gated mints and ALT extension with curve addresses" | Integration checker |

### Key Files for VERIFICATION.md

| File | What It Proves |
|------|---------------|
| `scripts/deploy/build.sh` | 7th program build with devnet feature (INTG-05) |
| `scripts/deploy/deploy.sh` | 7th program deploy via keypair (INTG-05) |
| `scripts/deploy/initialize.ts` | Curve init/whitelist/fund/start/burn sequence (INTG-01, INTG-05) |
| `scripts/graduation/graduate.ts` | 11-step graduation orchestration (INTG-02, INTG-03, INTG-04) |
| `programs/bonding_curve/src/constants.rs` | Feature-gated mint addresses (INTG-06) |
| `scripts/e2e/lib/alt-helper.ts` | ALT extension with curve addresses (INTG-06) |
| `scripts/deploy/lib/pda-manifest.ts` | 8 bonding curve PDA addresses (INTG-06) |
| `tests/integration/lifecycle.test.ts` | 21 tests covering full lifecycle (INTG-01 through INTG-06) |

### Pattern 2: RefundPanel Bug Fix

**What:** Line 93 in `app/components/launch/RefundPanel.tsx` double-subtracts `tokensReturned`.
**Root cause confirmed (HIGH confidence):**

On-chain `sell.rs` line 254: `curve.tokens_sold = x2` where `x2 = x1 - tokens_to_sell`. So `tokens_sold` is already decremented when tokens are sold back.

On-chain `claim_refund.rs` line 125: `let total_outstanding = curve.tokens_sold;` -- uses `tokens_sold` directly, NOT `tokens_sold - tokens_returned`.

The `tokens_returned` field is a cumulative counter for analytics/events only. It tracks the total ever returned, while `tokens_sold` is the live position on the curve.

**Current (buggy):**
```typescript
// app/components/launch/RefundPanel.tsx line 93
const totalOutstanding = curve.tokensSold - curve.tokensReturned;
```

**Fixed:**
```typescript
const totalOutstanding = curve.tokensSold;
```

**Impact:** Display-only. Inflates refund estimate by ~12.5% when sells have occurred. On-chain refund amount is always correct regardless of what the UI shows.

### Pattern 3: REQUIREMENTS.md Checkbox Updates

**What:** PAGE-01 through PAGE-08 checkboxes are `[ ]` but should be `[x]` per Phase 75 VERIFICATION.md. INTG-01 through INTG-06 traceability status needs updating.

**Current state (from REQUIREMENTS.md):**
- Lines 97-102: INTG-01 through INTG-06 have `Phase: 76`, `Status: Pending`
- Lines 44-51: PAGE-01 through PAGE-08 already show `[x]` in the specification section (checkboxes)
- Lines 106-113: PAGE-01 through PAGE-08 in traceability table show `Status: Complete`

**Wait -- the REQUIREMENTS.md has ALREADY been partially updated.** Re-reading carefully:
- The specification checkboxes (lines 29-35, 44-51) are all `[x]` -- already checked
- The traceability table (lines 84-113) has PAGE-01..08 as `Complete` already
- INTG-01..06 traceability shows `Phase: 76, Status: Pending`

**What actually needs changing:**
- INTG-01..06 traceability: change `Status: Pending` to `Status: Complete`
- The PAGE checkboxes are already correct in the current REQUIREMENTS.md

**Note:** The audit frontmatter said "PAGE-01 through PAGE-08 checkboxes stale" but the current REQUIREMENTS.md file already has them as `[x]`. The file was updated on 2026-03-07 (per the footer). The planner should verify current state before editing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VERIFICATION.md format | New template | Copy Phase 75 VERIFICATION.md format | Consistency across all phases |
| Refund math understanding | New analysis | Read on-chain claim_refund.rs line 125 | Source of truth is Rust code |

## Common Pitfalls

### Pitfall 1: Editing Wrong Line in RefundPanel.tsx
**What goes wrong:** Changing the wrong calculation or adding logic instead of simplifying.
**How to avoid:** The fix is REMOVAL only -- delete `- curve.tokensReturned` from line 93. Do not add anything.
**Warning signs:** If you're adding code instead of removing, you're doing it wrong.

### Pitfall 2: REQUIREMENTS.md Already Partially Updated
**What goes wrong:** Making edits that are already done, causing merge conflicts or duplicated work.
**How to avoid:** Read the current REQUIREMENTS.md state before editing. The file was last updated 2026-03-07. PAGE checkboxes may already be correct.
**Warning signs:** If `[x]` already present where you're trying to add it.

### Pitfall 3: VERIFICATION.md Missing Evidence References
**What goes wrong:** Writing a VERIFICATION.md that just says "done" without referencing specific files, commits, or audit evidence.
**How to avoid:** Reference the integration checker findings from `v1.2-MILESTONE-AUDIT.md` and specific SUMMARY.md files from Plans 74-01 through 74-05.

### Pitfall 4: Treating This as On-Chain Work
**What goes wrong:** Thinking the RefundPanel bug needs an on-chain fix or redeployment.
**How to avoid:** The audit explicitly states "Display-only bug -- on-chain refund is correct." The fix is TypeScript only, no program changes, no redeployment.

## Code Examples

### RefundPanel Fix (Exact Change)

```typescript
// File: app/components/launch/RefundPanel.tsx
// Line 93 BEFORE:
const totalOutstanding = curve.tokensSold - curve.tokensReturned;

// Line 93 AFTER:
const totalOutstanding = curve.tokensSold;
```

### INTG Traceability Update (Exact Change)

```markdown
<!-- BEFORE (lines 97-102) -->
| INTG-01 | Phase 76 | Pending |
| INTG-02 | Phase 76 | Pending |
| INTG-03 | Phase 76 | Pending |
| INTG-04 | Phase 76 | Pending |
| INTG-05 | Phase 76 | Pending |
| INTG-06 | Phase 76 | Pending |

<!-- AFTER -->
| INTG-01 | Phase 74, 76 | Complete |
| INTG-02 | Phase 74, 76 | Complete |
| INTG-03 | Phase 74, 76 | Complete |
| INTG-04 | Phase 74, 76 | Complete |
| INTG-05 | Phase 74, 76 | Complete |
| INTG-06 | Phase 74, 76 | Complete |
```

## State of the Art

Not applicable -- this phase is procedural gap closure, not new technology adoption.

## Open Questions

1. **REQUIREMENTS.md current state**
   - What we know: File was updated 2026-03-07 with PAGE checkboxes already `[x]`
   - What's unclear: Whether the INTG status was also updated in that same edit
   - Recommendation: Planner should read current file state before generating edit instructions

## Sources

### Primary (HIGH confidence)
- `programs/bonding_curve/src/instructions/claim_refund.rs` line 125 -- confirms `total_outstanding = curve.tokens_sold`
- `programs/bonding_curve/src/instructions/sell.rs` line 254 -- confirms `tokens_sold` decremented on sell
- `app/components/launch/RefundPanel.tsx` line 93 -- confirms buggy double-subtraction
- `.planning/v1.2-MILESTONE-AUDIT.md` -- defines all 3 gaps with exact specifications
- `.planning/phases/75-launch-page/75-VERIFICATION.md` -- format template
- `.planning/phases/74-protocol-integration/74-0{1..5}-SUMMARY.md` -- evidence for INTG requirements
- `.planning/REQUIREMENTS.md` -- current state of checkboxes and traceability

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no libraries needed
- Architecture: HIGH -- all patterns are established project conventions
- Pitfalls: HIGH -- verified against actual code and file state
- Bug fix: HIGH -- confirmed by reading on-chain Rust source

**Research date:** 2026-03-07
**Valid until:** Indefinite (procedural gap closure, not technology-dependent)
