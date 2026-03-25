# VERIFY-H021: Build Script Patch-Mint Logic
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
No commits since 2026-03-09 reference H021. `scripts/deploy/build.sh` still contains patch-mint logic (chicken-and-egg fix for hardcoded mint addresses in feature-flagged programs). No changes to file since last round.

## Assessment
Accepted risk. The build script is admin-only deploy infrastructure, not user-facing. The patch-mint pattern is a necessary part of the two-pass deploy pipeline documented in project memory.
