# Phase 32: CPI Chain Validation - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate every cross-program call path locally with compute budget profiling, catching integration issues before devnet. Fix pre-existing test failures (19 AMM + 10 Tax) that exercise the same CPI paths. No new program code — this is testing, validation, and documentation.

</domain>

<decisions>
## Implementation Decisions

### Compute budget approach
- Start with Solana's default 200k CU limit for all tests
- Measure actual CU consumption per CPI path
- Increase CU limit incrementally for paths that exceed 200k — find the minimum that works
- Document both actual CU used AND the limit set, so headroom is visible
- Define thresholds: <80% = OK, 80-95% = Warning (optimize in this phase), >95% = Critical (must optimize before shipping)
- If any path hits Warning zone, proactively optimize it now — don't defer to mainnet prep

### Compute budget ownership
- CU limits are always client-side (ComputeBudgetProgram instruction added by SDK/frontend)
- On-chain programs cannot request their own compute budget (Solana constraint)
- Document recommended CU limits per instruction type for integrators in the compute profile doc

### Pre-existing test failures
- Fix all 29 pre-existing failures (19 AMM swap + 10 Tax SOL swap) as part of Phase 32
- These tests exercise the same CPI paths being validated — fixing them adds coverage
- Root causes: missing swap_authority PDA in test helpers, AMM pool vault setup issues

### Negative/authorization testing
- Full negative matrix per CPI entry point: unauthorized callers + wrong PDA seeds + wrong program IDs + missing accounts
- Standard test assertions (no custom security logging) — descriptive test names carry the intent
- Test failures are self-documenting: test name = security invariant being violated

### Carnage depth-4 chain strategy
- Keep Carnage atomic (single transaction) — atomicity IS the security feature against MEV
- Measure CU, optimize if needed, request higher CU limit (up to 1.4M) if default 200k isn't enough
- Splitting into 2 transactions is absolute last resort (creates MEV front-running window)
- If CU falls in Warning zone (>80%), optimize within Phase 32
- Test Carnage with multiple pool states (varying liquidity levels) to catch worst-case CU scenarios
- No contingency plan needed for >1.4M CU — if it doesn't fit in 1.4M, something is fundamentally wrong

### Claude's Discretion
- Whether compute profiling is automated (parse logs) or manual (read and record) — pick what's practical
- Test file organization: same file with grouped sections vs separate security file — pick based on test runner constraints
- Compute doc table format: path-focused vs program-focused grouping — pick what's most readable
- Visual indicators in docs (emoji vs text labels for thresholds)

</decisions>

<specifics>
## Specific Ideas

- "We don't need to use 1.4M if we don't need to" — CU limits should be tight, not wasteful (mainnet priority fee implications)
- Carnage must remain atomic to prevent MEV front-running — this is a hard security requirement
- Compute profile doc should include an "SDK/Frontend Recommendations" section with per-instruction minimum CU limits + suggested padding

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 32-cpi-chain-validation*
*Context gathered: 2026-02-10*
