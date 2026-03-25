# Phase 48: Sell Tax WSOL Intermediary - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the sell tax mechanism so tax is deducted from the WSOL swap output, not from the user's native SOL balance. Users can sell CRIME/FRAUD tokens regardless of their native SOL balance. Only the sell path changes; buy path is unaffected.

</domain>

<decisions>
## Implementation Decisions

### User Proceeds Format
- User receives **native SOL** after selling (same UX as today)
- WSOL-to-SOL unwrap happens **inside the same on-chain instruction** -- fully atomic, user never sees WSOL
- On any failure (including unwrap), **full transaction revert** -- no partial states, user keeps their tokens
- **Modify swap_sol_sell in-place** -- no v2 instruction, no dead code. We control all clients

### Intermediary Account Design
- **Persistent** protocol-owned WSOL token account (initialized once, reused for all sells)
- Owned by the **swap_authority PDA** -- same signer already used in the sell flow
- Initialized during **protocol setup** (admin pays rent) -- account is ready before any sells happen
- **Drain to zero** after each sell -- no buffer, no accumulation, clean accounting

### Tax Unwrap Flow
- Tax portion is **unwrapped to native SOL before distribution** -- existing staking_escrow/carnage_vault/treasury distribution logic stays unchanged
- **Sell path only** (swap_sol_sell) -- buy path (swap_sol_buy) is unaffected since users always have native SOL to buy with

### Claude's Discretion
- **Tax-exceeds-output handling**: Whether to reject sells where tax >= gross output (likely reject with error)
- **Minimum timing**: Whether Phase 48 adds a tax-exceeds-output check or defers all minimums to Phase 49 (SEC-10)
- **Rounding dust allocation**: Who gets lamport dust when the 75/24/1 split doesn't divide evenly
- **Dust sell threshold**: Whether to reject economically meaningless sells (e.g., 1 lamport net output)
- **WSOL unwrap strategy**: Whether to unwrap all WSOL at once then split SOL, or split WSOL first then unwrap separately
- **PROFIT pool sell handling**: Whether swap_profit_sell also needs the intermediary (depends on whether it involves SOL tax deduction)

</decisions>

<specifics>
## Specific Ideas

- The intermediary is purely internal plumbing -- from the user's perspective, selling should feel identical to today (tokens in, native SOL out)
- The WSOL intermediary account should follow Phase 46's PDA validation patterns for consistency
- Success criterion SC2 explicitly requires tax distribution to arrive as native SOL -- the WSOL intermediary must not leak into downstream accounts

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 48-sell-tax-wsol-intermediary*
*Context gathered: 2026-02-19*
