# Phase 52: Smart Swap Routing - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Route comparison engine that evaluates multi-hop and split-route paths across all token pools, ranks them by expected output, and presents the best route to users with transparent fee/output estimates and one-click execution. Covers: routing engine logic, route comparison UI, multi-hop transaction execution, and split routing. Does NOT include new pool creation, new token pairs, or liquidity provision features.

</domain>

<decisions>
## Implementation Decisions

### Smart Routing Toggle
- Checkbox/toggle labeled "Smart Routing" in the swap UI
- When OFF: direct swap behavior (existing functionality, unchanged)
- When ON: routing engine evaluates all paths, shows expandable best route with alternatives
- Default: ON for all users

### Route Presentation
- Best route shown by default; expandable "See all routes" section reveals alternatives
- Each route displays: expected output amount, LP fee %, tax fee %, price impact %, and hop count
- Best route gets a simple "Best" badge -- no reason text, trust the engine
- Routes ranked by expected output amount

### Multi-hop Execution UX
- Single wallet approval: user signs once, both hops execute sequentially behind the scenes
- Progress indicator: simple spinner with text (e.g., "Executing route..."), no step-by-step stepper
- Partial failure handling: show intermediate state clearly ("Hop 1 succeeded, Hop 2 failed"), with both "Retry swap" (re-quotes hop 2 with fresh prices) and "Keep [TOKEN]" buttons

### Route Refresh & Staleness
- Auto-refresh quotes on a 30-second timer (same as Jupiter)
- Timer starts when routes are first loaded, resets on user input changes

### Claude's Discretion
- Split routing trigger threshold (when to suggest splits vs single route)
- Split route display format (single card vs separate legs)
- Split route failure handling (likely: same pattern as multi-hop for consistency)
- Pre-execution price change handling (slippage tolerance vs pre-check)
- Quote countdown timer visibility (visible circular timer vs hidden refresh)
- Route path visualization (whether to show SOL -> CRIME -> PROFIT arrows)

</decisions>

<specifics>
## Specific Ideas

- Smart Routing toggle is the gating mechanism -- keeps the swap UI simple for casual users who just want direct swaps, but powerful for users who want optimal routing
- Single-sign pattern for all multi-transaction flows (multi-hop AND split routes) -- consistent UX
- Partial failure UX gives users agency: they can retry OR keep the intermediate token, not forced into either

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 52-smart-swap-routing*
*Context gathered: 2026-02-20*
