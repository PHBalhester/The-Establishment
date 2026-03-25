# Phase 46: Account Validation Security - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Cryptographically validate all on-chain accounts that receive funds or execute CPI calls across all 5 programs, eliminating account substitution as an attack vector. Covers SEC-01 (tax destinations), SEC-02 (CPI targets), SEC-03 (VRF ownership), and SEC-07 (carnage_wsol ownership). Does NOT add new capabilities — purely hardens existing instructions.

</domain>

<decisions>
## Implementation Decisions

### Error specificity
- Include expected vs actual addresses in error data — addresses are public on-chain anyway, so no security cost, and it helps devnet debugging
- Granularity level (per-account vs per-category error codes) and error style (custom #[error_code] vs Anchor constraints) left to Claude's discretion based on existing codebase patterns

### Treasury validation
- Treasury is an EOA (not PDA-derivable) — validation approach (hardcode const vs store in state PDA) left to Claude's discretion
- Key consideration: Phase 50 makes treasury configurable, so pick the approach that minimizes re-work in Phase 50
- For PDA accounts (staking_escrow, carnage_vault): Claude decides whether to re-derive on-chain vs check against known address
- For CPI targets (amm_program, tax_program): Claude decides defense-in-depth level (Anchor Program type + explicit constraint, or type only)
- Fix scope for unflagged AccountInfo program references: Claude assesses whether to upgrade all or only SEC-02 flagged ones

### Attack test methodology
- **Adversarial matrix**: ~15+ tests covering every distinct account in every instruction where it appears (e.g., fake treasury in swap_sol_buy AND swap_sol_sell separately). Maximum coverage — not just one test per category.
- **Real program interactions**: Full integration tests — deploy programs, create pools, then attempt substitution attacks. Not lightweight mocks. High confidence required for security-critical fixes.
- Test file location and before/after proof approach left to Claude's discretion based on existing test organization

### Claude's Discretion
- Error granularity (per-account vs per-category error codes)
- Error mechanism (#[error_code] vs Anchor constraint messages)
- Treasury validation approach (hardcode vs config PDA) — optimize for clean Phase 50 transition
- PDA validation method (re-derive vs known address)
- CPI defense depth (type + explicit vs type only)
- Whether to fix unflagged untyped program references beyond SEC-02 scope
- Test file organization (new file vs existing security.ts)
- Whether tests show before/after (exploit succeeds then fails) or rejection-only

</decisions>

<specifics>
## Specific Ideas

- User wants addresses included in error messages because "on mainnet it's all public anyway" — don't hide information that's freely available on-chain
- Adversarial matrix was explicitly chosen over simpler options — quality bar is high for this security phase
- Real program integration tests chosen over mocks — must test the full CPI chain, not just constraint firing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 46-account-validation-security*
*Context gathered: 2026-02-18*
