# Feature Landscape: Bonding Curve Launch Page

**Domain:** Crypto bonding curve token launch UI (Solana)
**Researched:** 2026-03-03
**Overall Confidence:** HIGH (based on extensive project documentation, domain knowledge packs, security pattern library, and real-world platform analysis)

---

## Source Context

This research draws on:
- **Project specs**: `Docs/Bonding_Curve_Spec.md` (1500 lines, comprehensive on-chain design), `Docs/frontend-spec.md`, `Docs/project-overview.md`
- **User-facing docs**: `docs-site/content/launch/bonding-curve.mdx` (already written)
- **Domain knowledge packs**: `fair-launch-patterns.md` (pump.fun mechanics, LaunchLab, Heaven, IDO launchpads), `bonding-curve-variants.md` (curve math, exploit history)
- **Security patterns**: EP-061 (instant arbitrage), EP-094 (graduation exploit), EP-078 (pool init sniping)
- **Existing codebase**: Steampunk component kit (Frame, Button, Input, Tabs, Toggle, Slider, Card, Divider, Scrollbar), modal system (ModalShell singleton with iris animation), 12 data hooks, wallet-adapter infrastructure, audio system
- **Training data**: pump.fun, moonshot, friend.tech UI patterns (MEDIUM confidence -- not live-verified 2026-03-03)

WebSearch and WebFetch were unavailable during this session. pump.fun UI specifics are based on training data knowledge. Core patterns (progress bar, buy interface, market cap display) are stable across all bonding curve platforms and unlikely to have changed.

---

## Table Stakes

Features users expect on any bonding curve launch page. Missing any of these makes the page feel broken or untrustworthy.

### TS-01: Curve Progress / Fill Indicator

| Aspect | Detail |
|--------|--------|
| **What** | Visual representation of how much of the curve has been purchased (0-100%). pump.fun shows this as a prominent progress bar with percentage and SOL amount. Every bonding curve platform has this -- it is THE core visual element. |
| **Why Expected** | The single most important piece of information. Users instantly need to understand "how close is this to graduating?" Without it, there is no launch page. |
| **Complexity** | Low |
| **Dependencies** | On-chain `CurveState.tokens_sold` / `TARGET_TOKENS`. Already defined in spec (Section 14.1). |
| **Our twist** | We have TWO curves. Both must display simultaneously. The dual-progress is novel but the individual fill indicator is table stakes. |
| **Confidence** | HIGH |

### TS-02: Current Token Price Display

| Aspect | Detail |
|--------|--------|
| **What** | Show the current price per token in SOL (and ideally USD equivalent via existing `useSolPrice` hook). Must update as purchases occur. |
| **Why Expected** | Users need to know what they're paying. pump.fun shows current price prominently. This is fundamental transaction information. |
| **Complexity** | Low |
| **Dependencies** | `getCurrentPrice(tokens_sold)` function from spec Section 4.1. Existing `useSolPrice` hook for USD conversion. |
| **Confidence** | HIGH |

### TS-03: Buy Interface (SOL Input -> Token Output)

| Aspect | Detail |
|--------|--------|
| **What** | Input field for SOL amount, computed output in tokens, confirmation button. Must show estimated tokens received before purchase. Preset SOL amounts (0.1, 0.5, 1, 5, 10 SOL) as quick-select buttons. The core transactional UI element. |
| **Why Expected** | This is the primary user action. pump.fun has a simple buy box with SOL input and quick-select buttons. Every launchpad has a purchase interface. |
| **Complexity** | Medium (integrate with on-chain `purchase` instruction, handle partial fills near wallet cap, manage ATA creation for first-time buyers) |
| **Dependencies** | Existing `useProtocolWallet` hook, `connection.ts` singleton, wallet-adapter infrastructure. New `useBondingCurve` hook needed. Bonding curve program must be deployed. Steampunk `Input` and `Button` components from kit. |
| **Confidence** | HIGH |

### TS-04: Purchase Preview / Quote

| Aspect | Detail |
|--------|--------|
| **What** | Before confirming, show: tokens to receive, effective price per token, total SOL cost. If near wallet cap, show adjusted amount. Similar to existing `FeeBreakdown` pattern in `SwapForm`. |
| **Why Expected** | pump.fun shows estimated tokens before purchase. Users must understand what they're getting. Especially important with a linear curve where price changes during the purchase. |
| **Complexity** | Medium (need client-side curve math -- quadratic formula from spec Section 4.3 -- with u128/BigInt precision matching on-chain) |
| **Dependencies** | On-chain state read for `tokens_sold`, client-side `calculateTokensOut()` implementation matching spec Section 4.4. Spec Section 14.2 already defines the `previewPurchase()` TypeScript interface. |
| **Confidence** | HIGH |

### TS-05: Connected Wallet State

| Aspect | Detail |
|--------|--------|
| **What** | Show connected wallet address, SOL balance, and current holdings of curve tokens. Show "Connect Wallet" prompt if not connected. Page must be viewable without wallet connected (read-only state). |
| **Why Expected** | Standard DeFi UX. User must know their balance to decide how much to buy. Existing project already implements this pattern. |
| **Complexity** | Low (reuse existing `WalletButton`, `BalanceDisplay`, `useTokenBalances`) |
| **Dependencies** | Existing wallet-adapter infrastructure, existing `useTokenBalances` hook. May need to add CRIME/FRAUD balance display for the launch page context. |
| **Confidence** | HIGH |

### TS-06: Countdown Timer

| Aspect | Detail |
|--------|--------|
| **What** | Time remaining until the 48-hour deadline. Must be prominent and update in real-time. Show hours:minutes:seconds. Visual urgency escalation as deadline approaches (color change, pulsing). |
| **Why Expected** | Any timed sale must show remaining time. pump.fun tokens don't have deadlines, but every IDO/launchpad with a time window shows a countdown. Our 48-hour deadline is a core mechanic. |
| **Complexity** | Low-Medium (slot-based deadline must be converted to approximate wall-clock time; Solana slots are ~400ms but variable; existing `EpochCard` already implements slot-based countdown logic) |
| **Dependencies** | Existing `useCurrentSlot` hook (polls every 10s). Need `CurveState.deadline_slot` from on-chain. |
| **Confidence** | HIGH |

### TS-07: Transaction Status Feedback

| Aspect | Detail |
|--------|--------|
| **What** | After clicking buy: building -> signing -> sending -> confirming -> confirmed/failed. With appropriate messaging at each stage. Explorer link on confirmation. |
| **Why Expected** | Standard Solana DeFi UX. The existing project already implements this exact pattern for swaps (`SwapStatus.tsx`) and staking (`StakingStatus.tsx`). Reuse with curve-specific copy. |
| **Complexity** | Low (directly reuse existing transaction lifecycle pattern and component structure) |
| **Dependencies** | Existing `SwapStatus` component pattern. New error codes from `CurveError` enum (spec Section 11) mapped via existing `error-map.ts` pattern. |
| **Confidence** | HIGH |

### TS-08: SOL Raised / Market Cap Display

| Aspect | Detail |
|--------|--------|
| **What** | Show total SOL raised so far, current FDV (based on current curve price x total supply), target SOL amount (1,000 per curve). pump.fun displays market cap prominently as the primary metric users track. |
| **Why Expected** | Market cap is the lingua franca of crypto launches. Users evaluate "is this still early?" by looking at FDV and raised amount. |
| **Complexity** | Low |
| **Dependencies** | `CurveState.sol_raised`, `TARGET_SOL` constant, `useSolPrice` for USD conversion. FDV = getCurrentPrice x 1B total supply. |
| **Confidence** | HIGH |

### TS-09: Token Information Display

| Aspect | Detail |
|--------|--------|
| **What** | Token name, symbol (CRIME / FRAUD), total supply (1B each), percentage for sale (46%), token mint address (clickable to explorer). Brief token description in the Doctor's voice. |
| **Why Expected** | pump.fun shows token name, ticker, description, image, creator, mint address. Users verify what they're buying. Trust requires transparency. |
| **Complexity** | Low |
| **Dependencies** | Static content for CRIME/FRAUD. Token-2022 MetadataPointer extension already on mints. Explorer preference setting already implemented. |
| **Confidence** | HIGH |

### TS-10: Error Handling and Pre-Validation

| Aspect | Detail |
|--------|--------|
| **What** | Clear error messages for: not whitelisted, below minimum purchase (0.05 SOL), wallet cap exceeded (20M tokens), deadline passed, curve not active, insufficient SOL balance. Client-side pre-validation to prevent wasted gas on known failures. Disable buy button with explanatory text when preconditions not met. |
| **Why Expected** | Users need to understand WHY a transaction failed. Poor error handling is the #1 UX complaint on DeFi platforms. Pre-validation prevents frustration and wasted SOL on failed transactions. |
| **Complexity** | Medium (map all `CurveError` codes to user-friendly messages, implement client-side validation for wallet cap, minimum, balance, and whitelist checks before submitting TX) |
| **Dependencies** | `CurveError` enum from spec Section 11. Existing `error-map.ts` pattern. `ParticipantState` for cap check, `WhitelistEntry` for whitelist check. |
| **Confidence** | HIGH |

### TS-11: Mobile Responsiveness

| Aspect | Detail |
|--------|--------|
| **What** | The launch page must work on mobile devices. This is a SEPARATE page (/launch), not inside the factory scene, so it can have its own responsive layout independent of the landscape factory constraint. |
| **Why Expected** | Crypto users frequently trade on mobile. pump.fun is heavily used on mobile. A launch page that doesn't work on mobile loses a significant portion of potential participants, especially for a 48-hour time-limited event. |
| **Complexity** | Medium (greenfield responsive design, but must match steampunk aesthetic; the existing `MobileNav` and kit components provide a foundation) |
| **Dependencies** | Steampunk component kit (responsive), existing mobile navigation system. |
| **Confidence** | HIGH |

---

## Differentiators

Features that set Dr. Fraudsworth's launch page apart from pump.fun and other launch platforms. Not expected by users, but uniquely valuable for our dual-curve, coordination-game mechanics.

### D-01: Dual Curve Coordination Display

| Aspect | Detail |
|--------|--------|
| **What** | Side-by-side (desktop) or vertically stacked (mobile) display of BOTH CRIME and FRAUD curves. Visual connection between them -- steampunk pipes, gears, or chains linking the two gauges. Clear indication that both must fill. Status badges for each curve (Active, Filled, Waiting for Partner, Failed). |
| **Value Proposition** | This is the signature mechanic. No other bonding curve platform has dual-curve coordination. The visual representation of "both must succeed or both fail" is the core narrative tension. This transforms a purchase from a simple transaction into participation in a coordination game. It also creates emergent social dynamics: "FRAUD is lagging behind CRIME -- we need more FRAUD buyers!" |
| **Complexity** | Medium-High (novel UI pattern with no existing reference implementations; must communicate complex compound state clearly; needs careful mobile layout) |
| **Dependencies** | Both `CurveState` accounts read simultaneously. Need to handle compound states (one Filled, one Active). Spec Section 5.2 defines compound status logic (`is_refund_eligible`). |
| **Confidence** | HIGH (we know this must exist; design details are MEDIUM since no reference UI exists) |

### D-02: Cross-Curve Status Messaging (Doctor's Commentary)

| Aspect | Detail |
|--------|--------|
| **What** | Contextual messaging that changes based on the combined state of both curves, written in the Doctor's voice. A narrative layer that transforms dry blockchain data into story. Examples by state: |
| | **Both Active, early**: "The Doctor observes the early stages of his experiment with measured satisfaction. Both compounds are stabilising..." |
| | **One ahead**: "CRIME surges ahead at 73%! FRAUD languishes at 45%. The Doctor reminds you: both must succeed, or neither shall." |
| | **One Filled, partner Active**: "CRIME has reached its target! The Doctor taps his fingers impatiently as he waits for FRAUD to catch up..." |
| | **Both Filled**: "BOTH EXPERIMENTS COMPLETE! The Doctor's eyes gleam as he reaches for the transition lever..." |
| | **Failed**: "The deadline has passed. The Doctor sighs dramatically. 'Perhaps next time.' Claim your refund below." |
| **Value Proposition** | Turns data into narrative. Fits the established character. Makes the coordination game legible to non-technical users. Creates shareable moments ("look at what the Doctor said when FRAUD hit 90%!"). |
| **Complexity** | Low-Medium (state machine with ~8 compound states, each needs a message; the hard part is writing good copy, not engineering) |
| **Dependencies** | Both `CurveState` accounts. Compound state logic from spec Section 5.2. |
| **Confidence** | HIGH |

### D-03: Per-Wallet Cap Indicator

| Aspect | Detail |
|--------|--------|
| **What** | Show the user's individual progress toward their 20M token cap per curve. "You've purchased 8.5M / 20M CRIME" with a mini progress bar or gauge. When approaching the cap, auto-adjust maximum SOL input to exactly reach the cap. Disable buy button with "Cap reached" message when at 20M. |
| **Value Proposition** | pump.fun has no per-wallet cap. Making this visible communicates "we designed this to prevent whales from dominating." Users feel the protection. It also prevents user error (trying to buy more than allowed and getting a failed TX). |
| **Complexity** | Low |
| **Dependencies** | `ParticipantState.tokens_purchased` from on-chain (need to read or init-if-needed the PDA). |
| **Confidence** | HIGH |

### D-04: Refund Interface

| Aspect | Detail |
|--------|--------|
| **What** | If the launch fails (either curve doesn't fill within 48 hours), show a clear refund UI. Display how much SOL the user spent across each curve, and "Claim Refund" buttons per curve. Show refund status (claimed/unclaimed). Handle the compound failure case (one curve filled but partner failed -- both get refunds). |
| **Value Proposition** | "Your SOL is only committed if the experiment succeeds" is a powerful trust differentiator. pump.fun has no refund mechanism. Most bonding curves are fire-and-forget. The refund UI makes this guarantee tangible and actionable. |
| **Complexity** | Medium (need `claim_refund` instruction integration, handle both direct failure and partner-failure scenarios, conditional UI rendering based on `CurveStatus` + partner status) |
| **Dependencies** | `claim_refund` instruction from spec Section 8.7. `ParticipantState.refund_claimed` and `sol_spent` fields. Partner curve status for compound failure detection via `is_refund_eligible()`. |
| **Confidence** | HIGH |

### D-05: Price Curve Visualization

| Aspect | Detail |
|--------|--------|
| **What** | A visual chart showing the linear price curve from start (0.0000009 SOL) to end (0.00000345 SOL), with a marker at the current position showing where the next purchase falls. Optional: overlay actual purchase history as dots/ticks on the curve. Shows the user "you are here" on the price trajectory. |
| **Value Proposition** | pump.fun does NOT show the price curve -- users buy blind and only see the current price. Showing the full trajectory with current position communicates transparency ("we show our math") and lets users evaluate "am I early or late?" A steampunk-themed chart (pressure gauge aesthetic, brass-colored line, industrial grid background) would be visually distinctive. |
| **Complexity** | Medium (render a line chart with marker -- could use existing TradingView Lightweight Charts v5, or simpler SVG/Canvas for a static curve since it's just a straight line with annotations) |
| **Dependencies** | Static curve parameters (P_START, P_END, TOTAL_FOR_SALE). Current `tokens_sold` for position marker. Recommend SVG over TradingView -- the curve is a simple line, not market data. |
| **Confidence** | HIGH |

### D-06: Participant Count / Community Indicator

| Aspect | Detail |
|--------|--------|
| **What** | Display number of unique participants per curve (`CurveState.participant_count`). Combined participant count across both curves. Social proof and decentralization signal. |
| **Value Proposition** | pump.fun shows holder count after graduation but not during the curve. Showing participant count during the sale communicates "lots of people are in this" (social proof) and "no one person dominates" (combined with wallet cap visibility). Also useful for the coordination game narrative ("412 participants backing CRIME, 389 backing FRAUD"). |
| **Complexity** | Low |
| **Dependencies** | `CurveState.participant_count` (u32, already in the spec). |
| **Confidence** | HIGH |

### D-07: Live Purchase Feed / Activity Ticker

| Aspect | Detail |
|--------|--------|
| **What** | A real-time feed showing recent purchases: "0x8kPz... bought 1.5M CRIME for 2.3 SOL (14s ago)". Themed as a steampunk ticker tape machine or telegraph printout. Truncated addresses, amounts, relative timestamps. Scrolling or newest-at-top layout. |
| **Value Proposition** | Creates excitement and FOMO. Shows the curve is alive and active. pump.fun has a very active trade ticker that drives engagement. The steampunk theming (ticker tape, pneumatic tube messages, telegraph printout) makes this a visual differentiator beyond just the data. |
| **Complexity** | Medium-High (need real-time event subscription -- WebSocket on CurveState for state changes, or extend Helius webhook pipeline for Purchase events, or poll `getSignaturesForAddress` + parse event logs like existing `useCarnageEvents` pattern) |
| **Dependencies** | `Purchase` event from spec Section 10. Could reuse `useCarnageEvents` polling pattern (every 30-60s) or create WebSocket subscription on curve SOL vault (detect balance changes indicating purchases). |
| **Confidence** | MEDIUM (complexity depends on real-time vs polling approach; polling is easier but less exciting) |

### D-08: "What Happens Next" Explainer

| Aspect | Detail |
|--------|--------|
| **What** | Clear explanation of post-curve mechanics presented as the Doctor's experimental protocol. Three phases visualized: (1) Curve fills -> (2) Pool seeding (290M tokens + 1,000 SOL per pool, zero-gap pricing) -> (3) Protocol activation (epoch system, Carnage, staking). Visual timeline or steampunk schematic. Link to full docs. |
| **Value Proposition** | pump.fun tells users almost nothing about post-graduation mechanics. Our transition is more complex (dual pools, conversion vault, epoch system) but also more interesting. Educating users about what they're buying into increases trust and reduces "what now?" confusion. Makes the bonding curve feel like Phase 1 of a bigger experiment, not a one-off pump. |
| **Complexity** | Low (mostly static content with steampunk-themed illustrations/diagrams; the content already exists in `docs-site/content/launch/bonding-curve.mdx`) |
| **Dependencies** | Content. Link to docs site. Could embed a simplified version of the pool seeding parameters from spec Section 3.5. |
| **Confidence** | HIGH |

### D-09: Graduation Ceremony Visual

| Aspect | Detail |
|--------|--------|
| **What** | When both curves fill, a dramatic visual celebration. Steam valves blowing, gears turning, lights flashing, "THE EXPERIMENT BEGINS" in the Doctor's voice. Potentially: confetti particles but steampunk-themed (brass cogs, steam puffs, paper ticker tape). An audio sting from the audio system. This is the emotional payoff for the coordination game. |
| **Value Proposition** | No other launch platform has a "graduation ceremony." pump.fun quietly creates a Raydium pool. Our dual-curve coordination game deserves a dramatic payoff moment. This is the kind of visual that gets screen-recorded and shared on social media -- organic marketing gold. |
| **Complexity** | Medium (CSS animations + possibly canvas particles, audio sting integration, triggered by on-chain state change detection) |
| **Dependencies** | Detection of both curves reaching `Filled` status. Audio system (Phase 68, already implemented). |
| **Confidence** | MEDIUM (design question remains: what exactly does the ceremony look like? needs visual design input) |

### D-10: Whitelist / Verification Status

| Aspect | Detail |
|--------|--------|
| **What** | Show whether the connected wallet is whitelisted for purchases. If not, explain the verification process and provide a way to start it. Status: Not Verified -> Pending -> Verified. Clear explanation of WHY verification exists ("one phone, one wallet, one allocation -- the Doctor insists on fair play"). |
| **Value Proposition** | Sybil resistance is a trust differentiator. Making the verification visible (and explaining the rationale) reinforces the "fair launch" narrative. Most pump.fun launches have zero sybil protection -- we can explicitly position against this. |
| **Complexity** | Medium-High (depends on what replaces Privy for verification) |
| **Dependencies** | **BLOCKER**: Privy was removed in v1.1. `WhitelistEntry` PDA check exists in spec but the mechanism to CREATE whitelist entries is undefined. Multiple TODO comments flag this: spec Sections 5.5, 8.4, 12.1, 12.3 all reference Privy and note it needs replacement. This decision must be made before the purchase flow can work. Options include: Civic Pass, Persona KYC, social media verification (Discord/Twitter), or dropping per-wallet verification in favor of just the on-chain cap. |
| **Confidence** | LOW (verification method is TBD -- this is the biggest open question) |

### D-11: Steampunk Pressure Gauge Progress

| Aspect | Detail |
|--------|--------|
| **What** | Instead of a standard flat progress bar, use steampunk pressure gauges (circular dials with brass bezels and rotating needles) to show curve fill progress. The needle moves from "EMPTY" to "FULL" as the curve fills. When approaching 100%, the gauge enters a "red zone" with steam particle effects. Two gauges side by side for CRIME and FRAUD. |
| **Value Proposition** | Visually memorable and on-theme. No other launch page looks like this. Screenshots of the pressure gauges will be instantly recognizable as Dr. Fraudsworth. Combines TS-01 (fill indicator) with D-01 (dual display) in a thematically cohesive way. |
| **Complexity** | Medium (SVG pressure gauge component with CSS animation for needle rotation; needs brass bezel, tick marks, "CRIME" / "FRAUD" labels, percentage readout, glass reflection effect) |
| **Dependencies** | Progress data (tokens_sold / TARGET_TOKENS). Steampunk design tokens from `kit.css`. |
| **Confidence** | HIGH (we know how to build SVG components and CSS animations; existing kit has similar aesthetic treatments) |

### D-12: Pool Seeding Transparency Display

| Aspect | Detail |
|--------|--------|
| **What** | Display exactly what the pools will look like after transition: "CRIME/SOL Pool: 290M CRIME + 1,000 SOL. Opening price: 0.00000345 SOL per CRIME. Zero arbitrage gap from curve end price." Also show conversion vault parameters: "100:1 conversion rate. 250M CRIME + 250M FRAUD + 20M PROFIT seeded." |
| **Value Proposition** | Total transparency about where raised SOL goes. pump.fun's pool seeding is relatively opaque (85 SOL + 200M tokens to Raydium). Showing exact parameters builds trust. The zero-gap guarantee is especially powerful -- curve buyers know they won't get instantly dumped on at pool open. |
| **Complexity** | Low (static content derived from spec Section 3.5) |
| **Dependencies** | Spec parameters only. |
| **Confidence** | HIGH |

---

## Anti-Features

Features that are common in the bonding curve space but should be deliberately NOT built. Building these would harm the product, contradict the design philosophy, or create false expectations.

### AF-01: Sell-Back-to-Curve Button

| Aspect | Detail |
|--------|--------|
| **What** | A sell interface that lets users sell tokens back to the bonding curve before graduation. |
| **Why Avoid** | The spec explicitly states buy-only (Section 3, Invariant #8): "The bonding curve exists to raise liquidity for pool seeding, not to serve as a trading venue. Allowing sells would create adversarial dynamics that undermine the launch." Adding sell would enable instant arbitrage (EP-061: Nirvana lost $3.5M to mint-then-burn), flash loan attacks (EP-094: pump.fun lost $2M), and gaming of the curve. The sell tax mentioned in the project context applies to POST-LAUNCH pool trading, NOT to the bonding curve. |
| **What Instead** | Make buy-only status clear in the UI. Explain that free trading begins immediately after both curves graduate and pools are seeded. |

### AF-02: Chat / Comment Section

| Aspect | Detail |
|--------|--------|
| **What** | A live chat or comment section on the launch page, similar to pump.fun's comment threads. |
| **Why Avoid** | pump.fun's chat is notoriously toxic -- mostly bots, spam, coordinated FUD/shill campaigns, and price manipulation calls. It attracts low-quality engagement and requires moderation infrastructure (content moderation backend, spam filters, reporting system). The whitelist verification system already selects for more engaged users. A chat section would dilute the carefully crafted steampunk atmosphere with generic social noise. |
| **What Instead** | Link to Discord/Telegram for community discussion. The Doctor's commentary (D-02) provides personality without opening the floodgates. The activity ticker (D-07) provides social proof without requiring user-generated content moderation. |

### AF-03: Creator Profile / Token Description Editor

| Aspect | Detail |
|--------|--------|
| **What** | pump.fun lets token creators add descriptions, images, social links, website URLs. |
| **Why Avoid** | Dr. Fraudsworth is not a launchpad for arbitrary tokens -- we are launching ONE specific protocol with TWO specific tokens. There is no "creator" in the pump.fun sense. The tokens (CRIME and FRAUD) have fixed identities defined by the protocol narrative. Adding creator-style metadata editing would confuse users into thinking this is a platform for launching tokens, not a specific protocol launch. |
| **What Instead** | Hard-code the token information with the Doctor's branding. The "creator" IS Dr. Fraudsworth -- use his character, voice, and narrative throughout the page. |

### AF-04: Pre-Sale / Private Allocation / Insider Access

| Aspect | Detail |
|--------|--------|
| **What** | A mechanism for team/insiders to buy before the public curve opens, or a whitelist tier system (VIP gets first access). |
| **Why Avoid** | The project spec explicitly states "Zero team token allocation" -- 100% goes to bonding curve (46%) + pool seeding (54%). The trust model is built on NO insiders. The project overview emphasizes: "The team holds zero tokens; the only team revenue is a 2.5% trigger bounty cut." Even the appearance of insider access would undermine the protocol's core value proposition. |
| **What Instead** | Make zero-insider status prominent in the UI. Show this as a trust badge. "The Doctor holds zero tokens. Not one. Not even a test allocation. His only income is a 2.5% cut of the trading taxes that fund your yield." |

### AF-05: Candlestick Price Chart During Curve

| Aspect | Detail |
|--------|--------|
| **What** | A full TradingView candlestick/OHLCV chart showing "price action" during the bonding curve phase. |
| **Why Avoid** | On a linear bonding curve, price is a deterministic function of tokens_sold. There is no price discovery, no market dynamics, no candlestick patterns. A candlestick chart would show a monotonically increasing line that jumps with each purchase -- this looks like a pump and could trigger "number go up" gambling psychology. It implies market-driven price action where none exists. Misleading at best, manipulative at worst. |
| **What Instead** | Use the price curve visualization (D-05) showing the full linear trajectory from start to end price, with a "you are here" position marker. This is honest representation of a deterministic curve. The existing TradingView candlestick charts will be available POST-LAUNCH when real market dynamics exist. |

### AF-06: Leverage / Margin / Flash Loan Integration

| Aspect | Detail |
|--------|--------|
| **What** | Allowing users to borrow against their bonding curve position or use leverage to buy more tokens. |
| **Why Avoid** | EP-061 (Bonding Curve Instant Arbitrage, $3.5M Nirvana exploit) and EP-094 (Graduation Exploit, $1.9M pump.fun insider) explicitly document the dangers of flash loan + bonding curve interactions. The pump.fun exploit used Marginfi flash loans to manipulate bonding curve pricing. Leverage amplifies every manipulation vector. |
| **What Instead** | The per-wallet cap (20M tokens) and whitelist verification already limit concentrated positions. The 48-hour deadline makes time-based manipulation difficult. No additional financial engineering needed or wanted. |

### AF-07: Referral / Affiliate System

| Aspect | Detail |
|--------|--------|
| **What** | Referral links where existing users earn commission or bonus allocation for bringing new buyers. pump.fun's PumpSwap offers creator revenue sharing; some launchpads offer referral bonuses. |
| **Why Avoid** | Referral systems in token launches create perverse incentives: users shill aggressively to earn fees, not because they believe in the project. This attracts mercenary audiences and creates potential legal exposure (unregistered broker-dealer activity). It also conflicts with the whitelist/sybil-protection system -- referral farming typically involves creating multiple wallets. The coordination game itself is inherently shareable without financial incentives. |
| **What Instead** | Organic community growth through the narrative and aesthetic. The coordination game creates natural word-of-mouth: "FRAUD is behind, we need more buyers!" is a better marketing message than any referral bonus. |

### AF-08: Auto-Buy / DCA Bot / Limit Orders

| Aspect | Detail |
|--------|--------|
| **What** | Automated buying at intervals, at specific prices, or dollar-cost-averaging during the 48-hour window. |
| **Why Avoid** | On a linear bonding curve, price only goes up with purchases. DCA makes no economic sense -- buying earlier is strictly better. Limit orders are meaningless when price is a monotonic function of total purchased. Auto-buy conflicts with the whitelist/verification model (automated buys bypass user intent verification). These features add complexity for zero user benefit. |
| **What Instead** | Simple manual buy interface with clear price information. The ~3.83x price range from start to end is shallow enough that timing is not critical. |

---

## Feature Dependencies

```
                    [Wallet Connection (existing)]
                              |
                    [Whitelist Status Check]
                        |          |
              [Not Verified]    [Verified]
                   |                |
            [Verification      [Buy Interface]
             Flow (BLOCKER)]       |
                                   +-- [Purchase Preview (curve math)]
                                   +-- [Transaction Status (reuse)]
                                   +-- [Per-Wallet Cap (ParticipantState)]
                                   +-- [Error Pre-Validation]

[Curve State Read (new useBondingCurve hook)]
       |
       +-- [Progress / Fill Indicator]
       |       +-- [Pressure Gauge Visual (D-11)]
       |       +-- [Dual Curve Display (D-01)]
       |
       +-- [Current Price]
       +-- [SOL Raised / Market Cap]
       +-- [Participant Count]
       +-- [Countdown Timer (uses existing useCurrentSlot)]
       +-- [Cross-Curve Status Messages (D-02)]

[Price Curve Chart (D-05)] -- independent (static math + current position)

[Live Purchase Feed (D-07)] -- independent, high complexity
       +-- requires event subscription (poll or websocket)

[Refund Interface (D-04)] -- conditional (only in Failed state)
       +-- requires claim_refund instruction
       +-- requires partner curve status

[Graduation Ceremony (D-09)] -- triggered by both Filled
       +-- requires audio system (exists)

[Static Content]
       +-- [Token Info (TS-09)]
       +-- [What Happens Next (D-08)]
       +-- [Pool Seeding Preview (D-12)]
```

### Critical Path (must be resolved first)

1. **Bonding curve program deployment** -- Nothing works without the on-chain program
2. **Whitelist/verification method decision** -- Privy removed; alternative needed BEFORE the purchase flow is functional (BLOCKER)
3. **`useBondingCurve` hook** -- Core data hook reading both CurveState accounts; all UI components depend on it
4. **Client-side curve math** -- Purchase preview and price display need `calculateTokensOut()` with BigInt precision

---

## MVP Recommendation

### Phase 1: Must Have (blocks launch)

These features must ship for the page to function at all.

| # | Feature | Complexity | Reuses Existing |
|---|---------|------------|----------------|
| 1 | TS-01 + D-01 | Dual curve progress display | No (novel) |
| 2 | TS-02 | Current price per token | `useSolPrice` hook |
| 3 | TS-03 | Buy interface with SOL input | `Input`, `Button` from kit |
| 4 | TS-04 | Purchase preview / quote | Pattern from `FeeBreakdown` |
| 5 | TS-05 | Wallet connection state | `WalletButton`, `useTokenBalances` |
| 6 | TS-06 | 48-hour countdown timer | `useCurrentSlot`, `EpochCard` pattern |
| 7 | TS-07 | Transaction status feedback | `SwapStatus` pattern |
| 8 | TS-08 | SOL raised / market cap | `useSolPrice` |
| 9 | TS-09 | Token information | Static content |
| 10 | TS-10 | Error handling + pre-validation | `error-map.ts` pattern |
| 11 | TS-11 | Mobile responsive layout | Kit components |
| 12 | D-02 | Cross-curve status messaging | No (novel) |
| 13 | D-03 | Per-wallet cap indicator | ParticipantState PDA |
| 14 | D-04 | Refund interface (failure path) | claim_refund instruction |
| 15 | D-10 | Whitelist / verification status | **BLOCKER: needs design decision** |

### Phase 2: Should Have (strong differentiators, build after MVP)

| # | Feature | Complexity | Notes |
|---|---------|------------|-------|
| 16 | D-05 | Price curve visualization | SVG, relatively simple |
| 17 | D-06 | Participant count display | Trivial once data hook exists |
| 18 | D-08 | "What happens next" explainer | Content already exists in docs-site |
| 19 | D-11 | Steampunk pressure gauges | Replaces basic progress bars from Phase 1 |
| 20 | D-12 | Pool seeding preview | Static content |

### Phase 3: Nice to Have (polish, can ship post-launch)

| # | Feature | Complexity | Notes |
|---|---------|------------|-------|
| 21 | D-07 | Live purchase activity ticker | Medium-High; event subscription infrastructure |
| 22 | D-09 | Graduation ceremony visual | Medium; CSS animations + audio |

---

## Comparison to pump.fun (Quick Reference)

| Feature Category | pump.fun | Dr. Fraudsworth | Advantage |
|------------------|----------|-----------------|-----------|
| **Progress** | Flat progress bar | Steampunk pressure gauges | Visual identity |
| **Curves** | Single token | Dual-curve coordination game | Unique mechanic |
| **Selling** | Buy+Sell on curve | Buy-only (trade post-graduation) | Prevents gaming |
| **Sybil protection** | None | Whitelist verification + 20M cap | Fairness |
| **Refunds** | None (SOL committed) | Full refund if either curve fails | Trust |
| **Transparency** | Minimal (no curve chart) | Price curve + pool seeding preview | Trust |
| **Time limit** | None (indefinite) | 48-hour hard deadline | Urgency |
| **Post-graduation** | Quiet pool creation | Graduation ceremony visual | Shareability |
| **Chat** | Toxic comment section | Doctor's commentary (curated) | Quality |
| **Creator** | User-generated | Dr. Fraudsworth character | Brand |
| **Team allocation** | Creator can hold tokens | Zero team tokens | Trust |

---

## Security-Relevant Feature Notes

Based on the project's security pattern library:

| Security Pattern | Feature Implication |
|------------------|---------------------|
| EP-061: Bonding Curve Instant Arbitrage ($3.5M Nirvana) | Confirms buy-only design (AF-01). No sell-back. Prevents mint-then-burn in single TX. |
| EP-094: Graduation Exploit ($1.9M pump.fun) | `execute_transition` should not be manually triggerable from UI by regular users. Show transition status but the crank/admin handles execution. |
| EP-078: Pool Init Without Launch Delay | Our zero-gap transition design prevents sniper arbitrage at pool open. Feature D-12 should prominently communicate this guarantee. |
| Flash loan defense (pump.fun $2M, May 2024) | 48-hour deadline + per-wallet cap + whitelist = multi-layer defense. UI should communicate these protections as trust features, not just constraints. |

---

## Open Questions Requiring Team Decision

These must be resolved before the launch page can be fully designed and built:

### 1. Whitelist Verification Method (BLOCKER)

Privy was removed in v1.1. Multiple TODO comments in the bonding curve spec flag this:
- Section 5.5: `<!-- TODO: Privy removed in v1.1. Determine alternative whitelist verification method before mainnet. -->`
- Section 8.4: Same TODO
- Section 12.1: Same TODO
- Section 12.3: Same TODO

**Options to evaluate:**
- **Civic Pass**: On-chain proof-of-personhood, Solana-native, good ecosystem integration
- **Persona KYC**: More heavyweight, may deter casual users
- **Social verification**: Discord/Twitter account age + history (weaker sybil resistance but lower friction)
- **Phone verification via alternative provider**: Twilio, MessageBird (replaces Privy's phone verification)
- **Drop per-wallet verification, keep only on-chain cap**: Simplest, but loses sybil resistance (20M cap per wallet, but users can create multiple wallets)

**Recommendation**: This needs team discussion. The choice affects the entire purchase flow UX and the strength of the fairness guarantee.

### 2. Page Structure

Is `/launch` a single page with both curves, or should there be sub-routes (`/launch/crime`, `/launch/fraud`) with a combined overview? **Recommendation**: Single page. The coordination mechanic requires seeing both curves simultaneously. Sub-routes would fragment the experience and weaken the "both must fill" narrative.

### 3. Real-Time Data Strategy for Curve State

Polling (like existing hooks at 10s intervals) or WebSocket subscription on CurveState accounts? For a high-activity launch with many concurrent users, 10s polling intervals will feel stale. **Recommendation**: WebSocket subscription on both CurveState accounts (reuse `usePoolPrices` pattern with `connection.onAccountChange()`). This gives instant updates on every purchase.

### 4. Purchase Activity Feed Data Source

If D-07 is built, should it use the existing Helius webhook pipeline (extend `event-parser.ts` and database schema for curve events) or direct on-chain event polling (like `useCarnageEvents`)? **Recommendation**: Direct on-chain polling initially (simpler, no webhook config changes). If performance is insufficient, upgrade to webhook pipeline post-launch.

### 5. Launch Page Audio

Should `/launch` have its own background music separate from the factory scene? The audio system exists (Phase 68) but may need launch-specific sounds. **Recommendation**: Subtle steampunk ambient audio for the launch page, plus sound effects for purchase confirmation and graduation ceremony. Reuse audio system infrastructure, add new audio assets.

---

## Sources

| Source | Type | Confidence | Used For |
|--------|------|------------|----------|
| `Docs/Bonding_Curve_Spec.md` | Project spec | HIGH | All on-chain mechanics, state accounts, instructions, parameters, error codes |
| `docs-site/content/launch/bonding-curve.mdx` | User docs | HIGH | User-facing narrative, design constraints, Doctor's voice |
| `Docs/frontend-spec.md` | Project spec | HIGH | Existing UI patterns, component kit inventory, hooks, data fetching |
| `Docs/project-overview.md` | Project spec | HIGH | Protocol context, design philosophy, zero-team-allocation |
| `fair-launch-patterns.md` (knowledge pack) | Domain research | HIGH | pump.fun mechanics ($69k graduation, 800M supply, PumpSwap), competitor landscape |
| `bonding-curve-variants.md` (knowledge pack) | Domain research | HIGH | Curve math, security incidents, integer math considerations |
| EP-061 (security pattern) | Security | HIGH | Instant arbitrage prevention, confirms buy-only |
| EP-094 (security pattern) | Security | HIGH | Graduation exploit prevention |
| EP-078 (security pattern) | Security | MEDIUM | Pool init sniping defense |
| pump.fun UI patterns (training data) | Competitor | MEDIUM | Feature baseline. Not live-verified 2026-03-03. Core patterns stable. |
| friend.tech UI patterns (training data) | Competitor | LOW | Social bonding curve reference. May have changed since training. |
