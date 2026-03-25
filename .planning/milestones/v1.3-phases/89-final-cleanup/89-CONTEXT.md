# Phase 89: Final Cleanup - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Close all remaining audit findings from both verification reports (.audit + .bulwark), harden frontend/API security, and document bonding curve math proofs and dual-curve state machine edge cases. This is the final phase of v1.3 — leave the protocol fully locked down and documented for v1.4 (devnet lifecycle test + mainnet deploy).

Requirements: DOC-04, DOC-05 (original) + audit remediation from Stronghold and Bulwark verification reports.

</domain>

<decisions>
## Implementation Decisions

### Quote-Engine BigInt Conversion (H014)
- Full BigInt conversion — all inputs/outputs as BigInt, not just internal intermediates
- Include ALL functions (AMM quotes + bonding curve quotes) for consistency
- BigInt everywhere for math, convert to number only at final display step (lamports → human-readable)
- Update all callers: route-engine.ts, useRoutes.ts, RouteCard, BuySellPanel — no adapter shims, clean cut

### Crank Hardening (H019)
- Circuit breaker: halt after 5 consecutive errors, reset counter on any success
- Per-hour SOL spending cap: 0.5 SOL/hour (50x normal headroom)
- Internal-only /health endpoint: bind to 0.0.0.0 but no Railway public domain — Railway internal health check can reach it, zero public attack surface

### Security Quick-Fixes
- **H001**: Replace `!==` with `crypto.timingSafeEqual` for webhook secret comparison in helius/route.ts
- **H002**: Delete `HELIUS_API_KEY` export entirely from shared/constants.ts — dead code, all RPC goes through proxy
- **H003**: Create `.npmrc` with `ignore-scripts=true` — block all lifecycle scripts, run `npm rebuild` manually when needed
- **H035**: Fix stale 75/24/1 tax split comments → correct 71/24/5 in lib.rs, swap_sol_buy.rs, swap-flow.ts
- **S007**: New `tests/cross-crate/` workspace test crate that serializes EpochState in epoch-program and deserializes in tax-program to prove byte-level compatibility

### Frontend/API Security Hardening
- **H008**: SSE connection cap — per-IP limit (e.g., 3 connections) + global max (e.g., 100) on /api/sse
- **H024**: API rate limiting — in-memory IP-to-counter Map with sliding window, zero npm dependencies. Cover /api/rpc, /api/sse, /api/webhooks
- **H026**: HSTS header — add Strict-Transport-Security to next.config.ts headers
- **H011**: DB TLS — add `?sslmode=require` to DATABASE_URL for Railway Postgres
- **H013**: Crank vault top-up limit — max top-up amount so a bug can't drain crank wallet into vault
- **H050**: Webhook body size limit — explicitly set 1MB limit on webhook endpoint

### Bonding Curve Documentation (DOC-04)
- Update existing Bonding_Curve_Spec.md (don't create separate file)
- Full mathematical proof with equations: integral P(x), vault solvency invariant, ceil-rounding preservation proof
- Document rounding asymmetry: calculate_sol_for_tokens (ceil) vs calculate_tokens_out (floor), why protocol-favored

### Dual-Curve State Machine Documentation (DOC-05)
- Exhaustive edge case table format: every transition with preconditions
- Cover: timeout (48hr), partial fill, one-sided graduation attempt, refund math
- State machine: Funding → Active → Filled → Graduated/Failed with all branching conditions

### Claude's Discretion
- Rate limiting window size and request thresholds per endpoint
- SSE connection cap exact numbers (suggested 3/IP, 100 global — Claude can adjust)
- Vault top-up ceiling amount
- Plan wave ordering (security fixes vs docs vs BigInt)
- Cross-crate test crate structure

</decisions>

<specifics>
## Specific Ideas

- User emphasized: "Lock. It. Down." — every security finding should be addressed, not deferred
- Crypto users will use dev tools to probe for exposed APIs, keys, and endpoints — assume adversarial frontend users
- The HELIUS_API_KEY is currently visible in the JS bundle to anyone who opens dev tools
- Full math proofs in bonding curve docs serve future auditors — show the work, not just the conclusion

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/lib/swap/quote-engine.ts`: All swap quote functions — needs BigInt conversion
- `app/lib/swap/route-engine.ts`: Consumes quote-engine — caller updates needed
- `app/hooks/useRoutes.ts`: Route hook consuming quote outputs
- `scripts/crank/crank-runner.ts`: Main crank loop — add circuit breaker + spending cap + /health
- `app/app/api/webhooks/helius/route.ts`: Webhook auth with `!==` comparison
- `shared/constants.ts`: Contains hardcoded HELIUS_API_KEY export to delete
- `programs/tax-program/src/lib.rs` + `swap_sol_buy.rs`: Stale 75/24/1 comments
- `scripts/e2e/lib/swap-flow.ts`: Stale 75/24/1 comment
- `Docs/Bonding_Curve_Spec.md`: Target for DOC-04/DOC-05 additions

### Established Patterns
- Next.js API routes in `app/app/api/` — rate limiting middleware goes here
- next.config.ts already has CSP headers — HSTS addition follows same pattern
- Drizzle ORM with DATABASE_URL env var — TLS is connection string config
- Crank runner uses graceful shutdown + balance warnings — circuit breaker extends this pattern

### Integration Points
- New: `tests/cross-crate/` workspace test crate (Cargo.toml workspace member)
- New: `.npmrc` in project root
- New: Rate limiting middleware (shared across API routes)
- Updated: quote-engine.ts → route-engine.ts → useRoutes.ts → UI components (BigInt ripple)
- Updated: crank-runner.ts (circuit breaker + spending cap + health)
- Updated: next.config.ts (HSTS header)
- Updated: Bonding_Curve_Spec.md (math proofs + state machine table)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. All security items from both audit reports that are fixable without architectural changes are included.

Items deliberately left for v1.4 (architectural or operational):
- H015: Jito bundles for MEV protection (requires Jito SDK integration)
- H047: RPC failover (infrastructure change)
- H029: Crank infinite retry (subsumed by circuit breaker)
- H106: Emergency pause (deliberate design decision — no pause mechanism)

</deferred>

---

*Phase: 89-final-cleanup*
*Context gathered: 2026-03-09*
