---
topic: "Testing & Validation"
topic_slug: "testing"
status: complete
interview_date: 2026-02-20
decisions_count: 5
provides: ["testing-decisions"]
requires: ["architecture-decisions", "operations-decisions"]
verification_items: []
---

# Testing & Validation — Decisions

## Summary
Testing strategy formalizes the existing multi-layer approach (~116 tests, ~23K LOC) with lightweight CI automation, philosophy-based coverage, and a formal pre-mainnet checkpoint. Devnet tests are treated as manual validation runbooks, not automated regression tests.

## Decisions

### D1: Lightweight GitHub Actions CI
**Choice:** Single GitHub Actions workflow running on push to `main`, executing all local-validator tests (Rust + LiteSVM + TS/Mocha)
**Rationale:** Cheap insurance against regressions before immutable program burn. Solo dev context means the primary value is catching forgotten regressions after multi-file sessions, not team coordination. Free tier (2,000 min/month) covers ~200-400 runs.
**Alternatives considered:** No CI (current state — works but risky pre-burn), full pipeline with staging/deploy gates (enterprise overhead for solo project), PR-based checks (no PRs in solo workflow)
**Affects docs:** [operational-runbook, mainnet-readiness-assessment]

### D2: Three-Tier Test Classification
**Choice:** Tests classified into three tiers based on environment and determinism:
- **Fast** — Rust unit tests, proptests, math proofs (`cargo test`, no validator, ~30s)
- **Medium** — LiteSVM integration tests (in-process, no validator, ~1-2min)
- **Slow** — TS/Mocha integration + security tests (local validator via `anchor test`, ~5-10min)
- **Live** — Devnet VRF, continuous runner, carnage hunter (real cluster, manual only)

Fast + Medium + Slow run in CI. Live tests are manual-only.
**Rationale:** Fast/Medium/Slow are deterministic and free — run them always. Live tests cost SOL, depend on devnet availability, and are non-deterministic (VRF, network latency) — they're validation procedures, not regression tests.
**Alternatives considered:** Including devnet tests in CI (fragile, costs SOL, non-deterministic failures would block deploys)
**Affects docs:** [operational-runbook, mainnet-readiness-assessment]

### D3: Devnet Tests as Manual Validation Runbooks
**Choice:** Devnet tests (devnet-vrf.ts, continuous runner, carnage hunter) documented as manual validation procedures in the operational runbook, not as automated test suites. Referenced from testing docs but clearly distinguished.
**Rationale:** They answer "does this work on a real network?" (validation) not "is the logic correct?" (regression). Run before milestone completion or mainnet prep, not on every push.
**Alternatives considered:** Automating devnet tests on schedule (SOL costs, faucet rate limits, flaky results)
**Affects docs:** [operational-runbook, mainnet-readiness-assessment]

### D4: Philosophy-Based Coverage (No Percentage Target)
**Choice:** No formal coverage percentage target. Instead, document the coverage philosophy:
- Every state-changing instruction has at least one happy-path and one failure-path test
- Every CPI chain is tested end-to-end
- Every known attack vector has a simulation
- Math functions have property-based tests (proptest, 10K iterations)
**Rationale:** Coverage percentages pressure writing tests for trivial code to hit a number. For a solo project with immutable programs, meaningful coverage of critical paths matters more than metrics. The existing test suite already covers all CPI chains (buy/sell x CRIME/FRAUD), all 6 Carnage paths, 24 attack scenarios, 20 account validation cases, and 4 proptest properties.
**Alternatives considered:** 80% line coverage target (would require tests for trivial getters/error messages with no safety benefit)
**Affects docs:** [security-model, mainnet-readiness-assessment]

### D5: Formal Pre-Mainnet Testing Checkpoint
**Choice:** Before burning upgrade authority, a documented checklist must pass:
1. All Rust tests pass (`cargo test --workspace`)
2. All TS integration tests pass (4 suites: smoke, carnage, CPI chains, access control)
3. All security tests pass (24 attack sims + 20 account validation)
4. Devnet continuous runner completes N epochs without error
5. Carnage hunter fires and completes successfully on devnet
6. SVK audit findings addressed or accepted
**Rationale:** Burning upgrade authority is irreversible. This one-shot gate needs an explicit, documented checkpoint — not just "I think it all works."
**Alternatives considered:** Informal "run everything and check" (too easy to skip a suite under time pressure)
**Affects docs:** [mainnet-readiness-assessment, deployment-sequence]

## Open Questions
None — all decisions resolved.

## Raw Notes
- Current test counts: 90 TS test cases, 12 Rust integration test files, 34 math unit tests, 4 proptest properties (10K iterations each)
- Test isolation constraint: StakePool PDA is singleton, so separate test files must run in separate validators
- LiteSVM tests use a cross-version type bridge (Anchor Solana 2.x Pubkey ↔ LiteSVM Solana 3.x Address)
- Maximum test timeout is 1,000,000ms (16.67 min) for deep CPI chain tests
- No existing CI/CD infrastructure — `.github/workflows/` does not exist yet
