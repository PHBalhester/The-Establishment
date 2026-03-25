---
phase: 88-documentation-overhaul
verified: 2026-03-09T20:10:03Z
status: gaps_found
score: 8/10 must-haves verified
gaps:
  - truth: "DOC_MANIFEST.md is updated as master index of all active docs"
    status: failed
    reason: "4 new spec docs created in 88-02 (carnage-spec.md, epoch-spec.md, tax-spec.md, transfer-hook-spec.md) are missing from DOC_MANIFEST.md. The manifest header states 'If a doc is not listed here, it is either archived or orphaned' making these 4 docs appear orphaned when they are the most current specs."
    artifacts:
      - path: "Docs/DOC_MANIFEST.md"
        issue: "Missing 4 new spec docs from the Spec table: carnage-spec.md, epoch-spec.md, tax-spec.md, transfer-hook-spec.md. Archive section also has stale superseded-by references (e.g. Transfer_Hook_Spec.md says superseded by cpi-interface-contract.md, should reference transfer-hook-spec.md)."
    missing:
      - "Add carnage-spec.md, epoch-spec.md, tax-spec.md, transfer-hook-spec.md to Spec table with 2026-03-08 verification date"
      - "Update archive superseded-by references: Transfer_Hook_Spec.md -> transfer-hook-spec.md, Carnage_Fund_Spec.md -> carnage-spec.md, Epoch_State_Machine_Spec.md -> epoch-spec.md"
  - truth: "Nextra overview/three-tokens.mdx accurately describes PROFIT token standard"
    status: partial
    reason: "PROFIT properties table on line 52 says 'SPL Token (classic)' but body text on line 61 correctly says 'Token-2022 with transfer hook'. Internal contradiction within same page. Code confirms all 3 mints use TOKEN_2022_PROGRAM_ID."
    artifacts:
      - path: "docs-site/content/overview/three-tokens.mdx"
        issue: "Line 52 PROFIT table says 'SPL Token (classic)' contradicting line 61 which correctly says Token-2022"
    missing:
      - "Change line 52 from 'SPL Token (classic)' to 'Token-2022 with transfer hook'"
---

# Phase 88: Documentation Overhaul Verification Report

**Phase Goal:** All specification documents accurately describe the current code, and the Nextra documentation site content is rewritten
**Verified:** 2026-03-09T20:10:03Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Cross-program CPI dependency graph is documented with safe upgrade order | VERIFIED | upgrade-cascade.md (187 lines) covers all 7 programs, safe upgrade order, breaking change categories, upgrade-at-same-address commitment |
| 2 | Planning artifacts and deployment reports are archived out of active Docs/ | VERIFIED | 7 stale files confirmed absent from Docs/ and present in Docs/archive/ (30 total archived) |
| 3 | DOC_MANIFEST.md is updated as master index of all active docs | FAILED | 4 new spec docs (carnage-spec, epoch-spec, tax-spec, transfer-hook-spec) are missing from the manifest. Manifest has 24 entries but 28 active .md files exist in Docs/ |
| 4 | Carnage spec accurately describes shared module, 6 paths, carnage_lock_slot | VERIFIED | carnage-spec.md (304 lines), 31 matches for key terms, no stubs |
| 5 | Epoch spec accurately describes VRF flow, force_carnage, epoch skip, reserved padding | VERIFIED | epoch-spec.md (382 lines), 35 matches for key terms, no stubs |
| 6 | Tax spec accurately describes sell floor, is_reversed, error codes 6014-6017 | VERIFIED | tax-spec.md (345 lines), 11 matches for key terms, no stubs |
| 7 | Transfer Hook spec accurately describes whitelist PDA, ExtraAccountMetaList, dual-hook ordering | VERIFIED | transfer-hook-spec.md (309 lines), 54 matches for key terms, no stubs |
| 8 | Architecture doc includes bonding curve as 7th program and Phase 78-86 hardening | VERIFIED | architecture.md (671 lines), 7 bonding curve mentions, 2 upgrade-cascade references |
| 9 | All 16 Nextra MDX pages rewritten with accurate content, user-approved | PARTIALLY VERIFIED | All 16 files exist with substantive content (80-303 lines each), no stubs, user-approved per summaries. However three-tokens.mdx has internal contradiction (PROFIT table says SPL Token, body says Token-2022) |
| 10 | Bonding Curve spec reflects dual-curve coupling, graduation, refund, partner_mint | VERIFIED | Bonding_Curve_Spec.md (2293 lines), partner_mint confirmed (2 mentions) |

**Score:** 8/10 truths verified (1 failed, 1 partial)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `Docs/upgrade-cascade.md` | CPI dependency graph, upgrade order | VERIFIED | 187 lines, all 7 programs, no stubs |
| `Docs/DOC_MANIFEST.md` | Master index of all active docs | PARTIAL | 91 lines, categorized, but missing 4 new spec docs |
| `Docs/carnage-spec.md` | Carnage Fund spec | VERIFIED | 304 lines, code-first, no stubs |
| `Docs/epoch-spec.md` | Epoch/VRF spec | VERIFIED | 382 lines, code-first, no stubs |
| `Docs/tax-spec.md` | Tax Program spec | VERIFIED | 345 lines, code-first, no stubs |
| `Docs/transfer-hook-spec.md` | Transfer Hook spec | VERIFIED | 309 lines, code-first, no stubs |
| `Docs/architecture.md` | System architecture with 7 programs | VERIFIED | 671 lines, bonding curve included |
| `Docs/Bonding_Curve_Spec.md` | Bonding curve spec | VERIFIED | 2293 lines, partner_mint, hardening |
| 16 MDX pages (docs-site/content/) | Nextra site rewrite | VERIFIED | All 16 exist, 80-303 lines, no stubs, user-approved |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| architecture.md | upgrade-cascade.md | cross-reference link | WIRED | 2 references found |
| carnage-spec.md | carnage_execution.rs | code-first documentation | WIRED | 31 key term matches |
| tax-spec.md | tax-program source | code-first documentation | WIRED | 11 key term matches |
| DOC_MANIFEST.md | all active docs | index coverage | NOT WIRED | 4 new specs missing from index |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| DOC-01: All spec docs updated (Carnage, Epoch, Tax, Transfer Hook + others) | SATISFIED | All 4 named specs + 14 other active docs updated |
| DOC-02: Nextra documentation site reviewed page-by-page with user and content rewritten | PARTIALLY SATISFIED | All 16 pages rewritten and user-approved; minor PROFIT table contradiction in three-tokens.mdx |
| DOC-03: Cross-program upgrade cascade documented as upgrade-at-same-address commitment | SATISFIED | upgrade-cascade.md covers CPI graph, safe order, commitment statement |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| docs-site/content/overview/three-tokens.mdx | 52 | PROFIT table says "SPL Token (classic)" contradicting line 61 | Warning | Misleading info in user-facing docs |
| Docs/DOC_MANIFEST.md | - | 4 new spec docs unlisted | Warning | Manifest claims to be exhaustive but is not |

### Human Verification Required

### 1. Nextra Site Visual Check
**Test:** Run `cd docs-site && npm run dev` and navigate all 16 pages
**Expected:** All pages render correctly, no broken formatting, code snippets display properly
**Why human:** MDX rendering issues can only be caught visually

### 2. Content Accuracy Spot-Check
**Test:** Compare 2-3 code snippets in MDX pages against actual program source
**Expected:** Code snippets match current program behavior
**Why human:** Verifier checked structural content presence but not line-by-line code accuracy

### Gaps Summary

Two gaps were found, both related to completeness rather than correctness:

1. **DOC_MANIFEST.md missing 4 new specs**: Plans 88-01 and 88-02 ran in close sequence. Plan 88-01 created the manifest, then 88-02 created 4 new spec docs, but nobody updated the manifest to include them. Plan 88-03 updated last-verified dates but didn't add the missing entries. This is a simple omission -- 4 lines need to be added to the Spec table.

2. **PROFIT token standard contradiction in three-tokens.mdx**: The summary table says "SPL Token (classic)" but the body text correctly says "Token-2022 with transfer hook." The body text was corrected in the user review (plan 88-04 Task 2) but the table cell was missed. This is a one-line fix.

Both gaps are minor and can be fixed in under 5 minutes.

---

_Verified: 2026-03-09T20:10:03Z_
_Verifier: Claude (gsd-verifier)_
