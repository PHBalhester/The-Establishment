# Phase 41: Protocol Data Dashboard - Context

**Gathered:** 2026-02-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Read-only display of live protocol state -- epoch info, tax rates, pool prices, and Carnage data -- without requiring a connected wallet. Proves the RPC data pipeline end-to-end. This is a tech layer phase -- no branding or visual design polish. UI will be completely overhauled in a future milestone.

</domain>

<decisions>
## Implementation Decisions

### Dashboard Layout
- Card grid layout -- each data category gets its own card/panel
- Dashboard IS the landing page (root URL `/`)
- Swap and staking will be separate pages accessible from navigation

### Data Refresh Strategy
- **WebSocket subscriptions (real-time)** for data that changes on every swap:
  - Pool prices (4 pool accounts)
  - Carnage vault SOL balance
  - Epoch reward accumulation (tax deposits)
- **10-second polling** for data that only changes at epoch boundaries:
  - Current epoch number + cheap side
  - Tax rates
  - Countdown timer (slot-based, client ticks locally between polls)
  - Carnage trigger threshold / last trigger time
- No visible "last updated" indicator -- data should feel current

### Price Display
- USD denominated market cap as default view, with toggle to price-per-token
- SOL/USD conversion rate sourced from Jupiter Price API
- Each pool card shows price + both sides of pool reserves (e.g. "150 SOL / 1.2M CRIME")
- All 4 pools displayed as a flat grid, no grouping by token or pair type

### Carnage Display
- No special visual treatment/theming -- tech layer only, branding comes later
- Show vault balance and trigger threshold as raw numbers (no progress bar)
- Show lifetime burn totals (total CRIME burned + total FRAUD burned)
- Show last 5 Carnage events with per-event detail:
  - Date of event
  - Which token was burned (or sold) and amount
  - SOL spent and what action it funded (buy for burn / sell proceeds)

### Epoch & Countdown
- Countdown shows approximate time remaining as text (e.g. "~2 minutes remaining"), not a ticking MM:SS clock
- Updates on each 10s poll; honest about slot timing variability
- Cheap-side indicator: visual highlight on the relevant pool cards (no separate text label in epoch section)
- Warning banner displayed when epoch transition is imminent (<30 seconds remaining)
- Tax rates shown as raw percentages only (e.g. "CRIME Buy: 3.2%, Sell: 4.8%"), no high/low labels

### Claude's Discretion
- Card grid ordering/priority (which data categories appear where)
- Exact card dimensions and spacing
- Loading skeleton design
- Error state handling (RPC failures, stale data)
- WebSocket reconnection strategy

</decisions>

<specifics>
## Specific Ideas

- Pool reserves should show both sides of the pool (SOL amount + token amount), not just TVL
- Carnage event history should show the action breakdown (which token, what action) not just aggregate numbers
- Epoch countdown should be honest about variability rather than pretending slot timing is precise

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 41-protocol-data-dashboard*
*Context gathered: 2026-02-15*
