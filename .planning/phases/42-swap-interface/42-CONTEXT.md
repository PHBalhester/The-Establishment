# Phase 42: Swap Interface - Context

**Gathered:** 2026-02-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can buy and sell tokens across all 4 pools (CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT) with real-time price quotes, visible tax/fee breakdowns, configurable slippage and priority fees, and clear transaction status feedback. This is the interactive swap form — read-only dashboard data is Phase 41, staking is Phase 43, charts are Phase 44.

</domain>

<decisions>
## Implementation Decisions

### Swap form layout
- Unified swap form (Uniswap/Jupiter style): input token on top, output token on bottom, swap arrow between
- Token dropdowns for selection — user picks input and output tokens, pool is auto-resolved behind the scenes
- Live debounced quotes (~300ms after user stops typing) — output field updates as user types
- Both-direction quoting: user can type in EITHER the input OR output field to reverse-calculate the other (e.g., "I want exactly 1000 CRIME, how much SOL?")

### Fee/tax breakdown
- Expandable details: show total fee as one number (e.g., "3.5% total fees"), clicking expands to show LP fee + tax + price impact as separate line items
- PROFIT pool swaps: hide the tax line entirely when tax is 0% (cleaner for tax-free pools)
- Slippage is applied AFTER fees/taxes are calculated — 1% default protects against pool movement, not fees
- Slippage tolerance: inline on the form (always visible), 1% default
- Priority fee (compute budget): also inline alongside slippage, configurable, auto/medium default

### Transaction feedback
- Inline on form: swap button transforms into status indicator (Sending... → Confirming... → Confirmed/Failed). Form disabled during TX
- Success: green banner replaces status area with "Swap confirmed! View on Explorer →". Auto-dismisses after 8-10 seconds or user closes. Form resets
- Error mapping: all swap-relevant errors from Tax Program and AMM mapped to human-readable messages (~20-25 errors). Unknown codes get clean fallback with raw code
- No toast notifications — all feedback inline on the form

### Pool presentation
- No explicit pool tabs or selector — token dropdowns auto-resolve to the correct pool
- Show "Pool: CRIME/SOL" or similar as info text once tokens are selected
- Invalid token pairs: disable (grey out) invalid output tokens based on selected input. Prevents impossible swaps
- SOL input → only CRIME/FRAUD available. CRIME input → SOL or PROFIT. FRAUD input → SOL or PROFIT. PROFIT input → CRIME or FRAUD

### Claude's Discretion
- Pool context alongside swap form (minimal stats vs sidebar — Claude decides what's useful without clutter)
- Flip behavior (swap arrow): Claude decides whether flipping swaps amounts too or just token selectors
- Post-swap form state: Claude decides whether to auto-reset or keep values (leaning auto-reset for clean UX)
- Exact debounce timing and loading state animations
- Disabled state styling for form during TX

</decisions>

<specifics>
## Specific Ideas

- Uniswap/Jupiter as the reference UX for the unified swap form — users should feel at home
- The protocol's value proposition (tax-free PROFIT pools) should be discoverable through the fee breakdown naturally showing 0% tax vs the SOL pool tax rates
- Reverse quoting is a quality-of-life feature — "how much SOL to get exactly X CRIME?"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 42-swap-interface*
*Context gathered: 2026-02-15*
