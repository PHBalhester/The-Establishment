# Phase 75: Launch Page - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a dedicated `/launch` route in the existing Next.js app where users buy and sell tokens on both bonding curves (CRIME + FRAUD) through a steampunk-themed interface with real-time progress gauges, 48-hour countdown timer, and conditional refund/graduation UI. This is the ONLY page served during the curve phase -- the factory scene is not accessible. After graduation, the deployment swaps to the main factory site.

</domain>

<decisions>
## Implementation Decisions

### Deployment & Navigation
- Same codebase as the main app (not a separate Next.js project) -- shares all hooks, IDL, lib code, wallet adapter
- During curve phase: root `/` redirects to `/launch`. Factory scene routes are not rendered but code remains in the repo
- After graduation: admin manually swaps Railway deployment config to serve the factory scene instead
- No header/nav chrome -- full-bleed immersive page with interactive overlay elements on a background image (simplified version of the factory scene pattern)
- Only modal on this page: docs link (iframe to Nextra, similar to Documentation Table on main site) opened via a button

### Background & Visual Design
- User will provide custom background art (WebP) for the launch page -- steampunk-themed scene
- Interactive elements positioned as overlays on the background image (same pattern as factory scene: contain-fit scaling, positioned elements)
- Pressure gauges are baked into the background art
- User will provide transparent needle/arrow overlays at 0% position -- CSS `transform: rotate()` drives needle based on fill percentage
- Both curves use the same steampunk brass aesthetic, distinguished only by name labels (no color-coding)

### Curve Progress Visualization
- Pressure gauge needles rotate via CSS transform based on % SOL raised (sol_raised / 1000 SOL target)
- Market cap in USD displayed per curve (requires SOL price feed -- existing useSolPrice hook)
- Real-time updates via WebSocket subscription to CurveState accounts (not polling)

### Buy/Sell Interface
- Single buy/sell panel, always visible on the page (not a modal, not click-to-open)
- Tabs to switch between CRIME and FRAUD curves (reuse kit Tabs component)
- Buy/Sell toggle within the panel (buy = SOL input -> token output; sell = token input -> SOL output minus 15% tax)
- One curve at a time -- no "buy both" or split feature
- Detailed preview breakdown before confirm: token amount, current price, price impact (curve movement), sell tax amount, user's current holdings, remaining wallet cap
- Slippage protection (existing useSettings slippage tolerance)
- Transaction status feedback (existing confirm-transaction + error-map patterns)

### State-Dependent UI
- **Active**: Buy/sell panel functional, countdown timer running, gauges animating
- **Filled** (one curve): That curve's gauge shows full, buy/sell disabled for it, other curve still active
- **Failed** (deadline expired): Buy/sell panel REPLACED by refund panel showing token balance per curve, proportional refund amount, claim button per curve
- **Graduated**: Big celebration overlay appears (blurred background, success message). Page stays in this state until admin manually swaps Railway deployment
- Countdown timer: always visible and prominent (overlay element), counts down from 48 hours, shows "EXPIRED" when deadline passes

### User Holdings
- Current holdings and cap shown only in the buy/sell panel (part of the detailed breakdown), not as a standalone always-visible display

### Wallet
- Same wallet stack as main app (@solana/wallet-adapter-react + useProtocolWallet)
- Wallet connect as a floating/overlay button on the page

### Claude's Discretion
- Exact overlay positioning and responsive breakpoints for the launch scene
- CurveState Anchor client setup and hook design (useCurveState or similar)
- Bonding curve transaction builder implementation (buy/sell instruction construction)
- Quote/preview math for curve buys and sells (client-side integral calculation)
- Mobile layout (stacked vs tabbed for dual-curve content)
- Celebration overlay design (CSS animation, message text)
- Refund panel layout and claim flow UX
- How the docs button/modal is positioned on the page

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Kit components** (Frame, Button, Input, Tabs, Card, Divider): Direct reuse for buy/sell panel, stats display, refund panel
- **useProtocolWallet**: Wallet connection and transaction signing
- **useTokenBalances**: Fetch user's token balances (CRIME, FRAUD holdings for cap display)
- **useSolPrice**: SOL/USD price for market cap calculation
- **useCurrentSlot**: Current slot for countdown timer computation (deadline_slot - current_slot)
- **useSettings**: Slippage tolerance and priority fee settings
- **confirm-transaction.ts**: Transaction confirmation with retry logic
- **error-map.ts**: Human-readable error messages (extend with curve-specific errors)
- **connection.ts**: RPC connection + WebSocket setup
- **Factory scene pattern** (app/page.tsx + scene/): Background image + positioned overlay elements with contain-fit scaling

### Established Patterns
- **CSS-only animations**: Zero npm deps for visual layer -- needle rotation, celebration effects all CSS
- **@media width < 64rem**: Mobile responsive breakpoint pattern
- **Kit @layer**: Component kit CSS layering for style isolation
- **WebSocket subscriptions**: Existing pattern in connection.ts for account change subscriptions (useVisibility pausing)

### Integration Points
- **Bonding curve IDL**: target/idl/bonding_curve.json (needs copy to app for Anchor client)
- **Anchor client**: app/lib/anchor.ts provides program connection setup
- **shared/programs.ts**: Program ID constants (needs bonding curve program ID added)
- **shared/constants.ts**: Protocol constants (TOTAL_FOR_SALE, SELL_TAX_BPS, etc. may need client-side equivalents)

</code_context>

<specifics>
## Specific Ideas

- The launch page follows the same visual paradigm as the factory scene: a background image with interactive overlay elements, but much simpler (fewer elements, single-purpose)
- Pressure gauge needles provided as separate transparent images at 0% -- CSS rotation is the only animation needed
- The page is the ENTIRE site during curve phase -- no other routes accessible. This is a standalone launch experience
- After graduation, admin manually switches Railway deployment. The graduated state is just a holding pattern with celebration UI
- WebSocket for real-time CurveState updates ensures gauges and stats reflect buys/sells instantly

</specifics>

<deferred>
## Deferred Ideas

- Cross-curve status messaging in Doctor's voice (PAGE-F01) -- future enhancement
- Price curve visualization with "you are here" marker (PAGE-F02) -- future enhancement
- Participant count display (PAGE-F03) -- future enhancement
- Pool seeding transparency display (PAGE-F04) -- future enhancement
- "What happens next" explainer (PAGE-F05) -- future enhancement
- Live purchase activity feed / ticker (PAGE-F06) -- future enhancement
- Graduation ceremony visual with audio sting (PAGE-F07) -- future enhancement
- Per-wallet cap indicator with mini progress gauge (PAGE-F08) -- future enhancement

</deferred>

---

*Phase: 75-launch-page*
*Context gathered: 2026-03-05*
