# Verification: H049 - Cross-program upgrade cascade

**Original Severity:** MEDIUM
**Verification Status:** FIXED (Documentation Added)

## Changes Found

A dedicated document `docs/upgrade-cascade.md` has been created that addresses the core concern:

1. **CPI dependency graph**: Full depth-annotated graph showing all 7 programs and their CPI relationships (depth 0 leaf nodes through depth 3 Epoch Program)
2. **Upgrade ordering**: Documents which programs are safe to upgrade independently vs. which require coordinated upgrades
3. **Upgrade-at-same-address commitment**: Explicitly states all programs must be upgraded at their fixed addresses
4. **Program addresses**: Table of all 7 program addresses with upgrade authority status

The two-pass deploy pipeline (`deploy-all.sh`) remains the primary deployment mechanism, handling the chicken-and-egg problem of hardcoded mint addresses.

## Verification Analysis

The documentation recommendation from the original finding has been implemented. The `docs/upgrade-cascade.md` document provides the operational reference needed for safe upgrades.

The "shared registry" recommendation was not implemented (nor was it expected to be -- it would require significant architectural changes for marginal benefit given the fixed program IDs).

The "pause flag" recommendation was explicitly rejected per the S005 decision above.

## Regression Check

No regression. The 15 hardcoded cross-program IDs remain as before (inherent to the architecture). The dependency graph is accurately documented.
