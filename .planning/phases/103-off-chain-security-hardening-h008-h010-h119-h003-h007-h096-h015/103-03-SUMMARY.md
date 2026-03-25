---
phase: 103
plan: 03
status: complete
started: 2026-03-23
completed: 2026-03-23
---

## Summary

Closed Bulwark findings H003 (lockfile bypass in production builds) and H007 (dependency confusion on @dr-fraudsworth scope) with two layers of defense.

## What Changed

### Task 1: Switch Railway builds to npm ci and fix workspace dependency
- Changed `railway.toml` and `railway-crank.toml` build commands from `npm install` to `npm ci` — enforces exact lockfile versions, fails on drift
- Changed `@dr-fraudsworth/shared` dependency in `app/package.json` from registry reference to `file:../shared` — hard-fails if local path missing, never resolves from npm registry
- Regenerated `package-lock.json` to reflect the `file:` protocol change

### Task 2: Register @dr-fraudsworth npm scope (manual)
- User registered `dr-fraudsworth` organization on npmjs.com
- Scope permanently reserved — no attacker can publish malicious `@dr-fraudsworth/*` packages
- Defense-in-depth: `file:` protocol is primary defense, scope registration is secondary

## Key Files

### key-files.modified
- `railway.toml` — npm ci for app builds
- `railway-crank.toml` — npm ci for crank builds
- `app/package.json` — file:../shared protocol

## Commits
- `a2d0b19` — fix(103-03): enforce lockfile installs and prevent dependency confusion

## Deviations
- Plan specified `workspace:*` protocol for `@dr-fraudsworth/shared`, but npm v11 does not support `workspace:` (pnpm/yarn only). Used `file:../shared` instead — identical security guarantee: explicit local path that hard-fails if missing.

## Self-Check: PASSED
- [x] Railway builds use npm ci (lockfile enforced)
- [x] @dr-fraudsworth/shared resolves via file: protocol (never from registry)
- [x] @dr-fraudsworth npm scope registered (defense-in-depth)
- [x] package-lock.json updated
