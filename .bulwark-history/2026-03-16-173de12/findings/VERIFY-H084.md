# VERIFY-H084: No Automated Cross-Language Constant Synchronization
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- No commits referencing H084 since 2026-03-09.
- Constants still duplicated across Rust on-chain programs, TypeScript `shared/` package, and test helpers.
- Existing compile-time offset validation tests in `epoch-program/src/constants.rs` provide partial drift protection.

## Assessment
Accepted risk. Cross-language constant sync tooling (e.g., code generation from a single source of truth) would be ideal but is low priority given: (1) constants rarely change post-launch, (2) compile-time tests catch offset drift in the epoch program, (3) the shared TypeScript package is the single source for all frontend/script consumers. No change from Round 2.
