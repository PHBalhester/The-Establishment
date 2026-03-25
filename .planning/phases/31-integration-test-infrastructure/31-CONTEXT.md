# Phase 31: Integration Test Infrastructure - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Load all 5 programs (AMM, Transfer Hook, Tax, Epoch, Staking) into a single local validator with shared protocol initialization. Prove the foundation works with smoke tests covering the two major CPI paths (swap chain + staking chain). No new program code — this is test infrastructure only.

</domain>

<decisions>
## Implementation Decisions

### Protocol initialization scope
- Initialize ALL 4 AMM pools (PROFIT/SOL, PROFIT/USDC, CARNAGE/SOL, CARNAGE/USDC) — match production state
- Full protocol init: mints, pools, transfer hook, staking pool, epoch state
- Pre-create role-based test wallets: trader (SOL + all tokens), staker (PROFIT for staking), authority (protocol admin), attacker (unauthorized caller for security tests) — approximately 4 wallets with appropriate balances

### Smoke test coverage
- Two smoke tests proving both major CPI paths:
  1. SOL buy swap — proves Tax -> AMM -> Token-2022 -> Hook chain
  2. Stake PROFIT tokens — proves Staking program CPI path works in shared environment
- Both must complete without error in the shared multi-program validator

### Claude's Discretion
- **Validator approach**: LiteSVM vs bankrun vs solana-test-validator — pick based on what we already use and multi-program compatibility
- **Instance lifecycle**: Shared vs fresh-per-file — pick based on PDA singleton pattern and test reliability
- **Existing test migration**: Whether per-program tests stay separate or move into integration framework
- **Test language**: TypeScript vs Rust — pick based on team familiarity and existing patterns
- **Init helper design**: Reusable library vs separate implementations — consider Phase 33 deployment scripts reuse
- **Test file location**: tests/integration/ vs flat in tests/ — pick based on Anchor conventions
- **Run command**: Separate `npm run test:integration` vs integrated `anchor test`
- **Diagnostic verbosity**: Logs on failure only vs always — pick based on debugging experience
- **Timeout/retry strategy**: Generous timeouts vs retries — pick based on CPI depth behavior
- **Smoke test validation depth**: Just success vs checking key amounts — pick for Phase 31 scope
- **Epoch transition in smoke test**: Include or defer to Phase 32 — pick based on scope boundary
- **Failure diagnostics**: Standard output vs CPI diagnostic report — pick based on practicality

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User trusts Claude's technical judgment on all infrastructure decisions for this phase. The key user-driven decisions are:
- All 4 pools initialized (not minimal subset)
- Role-based test wallets (not just one generic wallet)
- Both swap AND staking smoke tests (not just swap)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 31-integration-test-infrastructure*
*Context gathered: 2026-02-10*
