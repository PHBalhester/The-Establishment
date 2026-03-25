# Phase 87: CI/CD Pipeline - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

GitHub Actions workflow that runs the full test suite on every push to main. Test-only pipeline — no deployment, no devnet interaction, no secrets. Requirement: CI-01.

</domain>

<decisions>
## Implementation Decisions

### CI Scope & Triggers
- Trigger: push to main only (no PRs, no manual dispatch)
- Test scope: Rust tests (cargo test) + LiteSVM integration tests + ts-mocha TypeScript tests
- No Next.js build or docs-site build in CI
- No path-based filtering — full suite runs every time
- Informational only — no branch protection rules, no merge blocking

### Test Partitioning
- 3 parallel jobs: (1) cargo test (unit + proptest), (2) LiteSVM integration tests, (3) ts-mocha TypeScript tests
- Proptest: default 256 iterations in CI (full 5M stays local/manual)
- Fail fast — each job stops on first failure

### Build Environment
- Runner: ubuntu-latest
- Install Rust, Solana CLI, Anchor CLI, Node.js with aggressive caching (cargo registry, target dir, Solana binaries)
- Pin all versions explicitly (Rust via rust-toolchain.toml, Solana CLI, Anchor CLI, Node.js) — match local setup
- Build step: `anchor build` with `--features devnet` before tests (LiteSVM needs .so binaries)

### Secrets & Deployment
- Pure test-only — no deployment, no devnet interaction
- No secrets needed — all tests run locally (LiteSVM, cargo test, ts-mocha without devnet RPC)
- Build with `--features devnet` using committed mint keypairs in `keypairs/mint-keypairs/`
- TS integration tests requiring devnet RPC skipped in CI

### Claude's Discretion
- Exact caching keys and restore strategies
- Workflow file structure and step naming
- How to split LiteSVM tests from regular cargo tests (test binary filtering, feature flags, etc.)
- Node.js version to pin (must be >=22 per package.json engines)
- Whether to use `actions/setup-node`, `dtolnay/rust-toolchain`, or manual installs
- Timeout values for each job

</decisions>

<specifics>
## Specific Ideas

- Build process must follow the two-step pattern: `anchor build` then `anchor build -p epoch_program -- --features devnet` (per MEMORY.md)
- StakePool PDA singleton constraint means LiteSVM test files may need separate test binaries or sequential execution within their job
- The `ts-mocha` command uses `tests/**/*.ts` glob — CI should only run tests that don't require devnet connection

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/deploy/build.sh`: Existing build script that handles the devnet feature flag flow — could inform CI build step
- `Anchor.toml`: Program IDs for devnet and localnet already configured
- `package.json`: `npm test` script runs `ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts`

### Established Patterns
- Workspace Cargo.toml at root with `members = ["programs/*"]` and resolver 2
- 7 production programs + 3 test programs (mock-tax, fake-tax, stub-staking)
- Two-pass build: first `anchor build`, then `anchor build -p epoch_program -- --features devnet`
- LiteSVM tests live in `programs/*/tests/` as Rust integration tests
- TypeScript tests in `tests/` directory use ts-mocha

### Integration Points
- New file: `.github/workflows/ci.yml` (greenfield — no existing CI config)
- May need `rust-toolchain.toml` at project root for version pinning
- Cargo cache key should include `Cargo.lock` hash

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 87-ci-cd-pipeline*
*Context gathered: 2026-03-08*
