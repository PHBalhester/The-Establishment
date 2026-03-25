# Phase 56: Station Content - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Re-parent existing DeFi components (SwapForm, StakingForm, CarnageCard, etc.) into themed modals for all 6 factory stations. Build the Big Red Button swap execution element. No new protocol features -- existing functionality gets modal wrappers and themed presentation.

</domain>

<decisions>
## Implementation Decisions

### Swap Station Layout
- **Top section**: Stats bar showing market caps in USD for CRIME (CRIME/SOL pool), FRAUD (FRAUD/SOL pool), PROFIT (PROFIT/CRIME pool), and PROFIT (PROFIT/FRAUD pool), plus current tax rates
- **Middle section**: TradingView candlestick chart with timeframe toggles (1m, 5m, 15m, 1h, 4h, 1d)
- **Bottom section**: Swap form on the left, Big Red Button on the right
- Stats bar is display-only (not clickable for pair selection)
- Token pair selector is a separate dropdown in the swap form area
- Fee breakdown and route details are in a collapsible/expandable "Route details" section below swap inputs (collapsed by default)

### Big Red Button
- Disabled until all swap inputs are valid (amount > 0, pair selected, wallet connected) -- visually dimmed when disabled
- Visual states: idle = red glow, loading = spinning indicator, success = green flash, error = shake animation
- On success: green flash on button + toast with clickable transaction link to Solscan
- On error: shake animation + steampunk-themed toast notification that auto-dismisses (not inline)
- 3D physical appearance level: Claude's discretion (somewhere between stylized 3D and arcade physical, fitting the steampunk aesthetic)

### Carnage Cauldron Content
- SOL balance (current fund)
- Lifetime stats: total CRIME burnt, total FRAUD burnt, total SOL spent
- Last trigger timestamp
- Last 5 recent Carnage events (compact list with timestamp, type, amounts)
- Data auto-polls every ~10-15 seconds while modal is open

### Rewards Vat Content
- Tab-based layout with 4 tabs: Stake, Unstake, Claim, Stats
- Stake/Unstake/Claim tabs contain their respective form interfaces
- Stats tab shows: pending rewards, user's staked balance, total protocol staked, last 5 epoch rewards, total protocol rewards distributed
- Data auto-polls every ~10-15 seconds while modal is open

### Documentation Table
- Embeds existing Nextra gitbook via iframe inside the modal
- Nextra site is in the codebase (not yet deployed) -- needs to run on localhost:3001 during dev, deployed separately for production
- Documentation modal should be wider than standard station modals (exact width at Claude's discretion, will be tuned during implementation)
- X-Frame-Options on the Nextra deployment must allow framing from the main app domain

### Connect Wallet & Settings
- Connect Wallet: extends existing ConnectModal with Phantom, Solflare, and Privy social login
- Settings: slippage tolerance and priority fee configuration
- These extend existing components with themed wrappers (no new logic)

### Claude's Discretion
- Big Red Button realism level (within the steampunk aesthetic)
- Exact Documentation modal width
- Toast notification positioning and animation style
- Loading skeleton designs for data-fetching states
- Auto-poll interval tuning (suggested ~10-15s, can adjust based on RPC load)
- Chart component selection and integration details

</decisions>

<specifics>
## Specific Ideas

- Market caps displayed in USD, computed from pool reserves (CRIME/SOL, FRAUD/SOL, PROFIT/CRIME, PROFIT/FRAUD)
- Carnage lifetime stats give the protocol a "history" feel -- total destruction metrics
- Rewards Vat stats tab should feel like a yield dashboard summary
- Documentation is the existing Nextra gitbook, not custom-written content for the modal
- All modals auto-refresh data while open to maintain live feel

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 56-station-content*
*Context gathered: 2026-02-23*
