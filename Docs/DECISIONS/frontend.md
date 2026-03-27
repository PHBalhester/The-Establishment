---
topic: "Frontend"
topic_slug: "frontend"
status: complete
interview_date: 2026-02-20
decisions_count: 12
provides: ["frontend-decisions"]
requires: ["architecture-decisions", "security-decisions"]
verification_items: []
---

# Frontend — Decisions

## Summary
The frontend is a single interactive steampunk factory scene — not a traditional multi-page DeFi app. Users interact with Dr. Fraudsworth's factory by clicking illustrated elements that open modals for protocol functions. Existing page-based routes (`/`, `/swap`) become legacy dev-only views. A separate Nextra docs site provides thorough protocol documentation.

## Decisions

### D1: Single Interactive Scene (No Page Navigation)
**Choice:** The entire app is one page — an illustrated steampunk factory. Each visual element is a clickable hotspot that opens a modal. No router navigation between pages.
**Rationale:** Distinctive UX that sets the project apart from every other DeFi dashboard. The factory metaphor makes abstract DeFi concepts tangible (cauldron = Carnage, bubbling tube = yield, etc.).
**Alternatives considered:** Traditional multi-page DeFi layout with sidebar/tabs (rejected — generic), single-page with scroll sections (rejected — doesn't leverage the art concept).
**Affects docs:** [frontend-spec, project-overview]

### D2: Layered PNG Implementation
**Choice:** Scene built from layered transparent PNGs positioned over a static background. Each asset is cut from the main illustration and placed as an absolutely-positioned layer. Hover highlights individual assets (glow/brighten effect).
**Rationale:** Allows per-element hover/click interactivity without complex SVG manipulation. Artist produces one scene; dev team slices into layers.
**Alternatives considered:** SVG overlays with hotspot regions (harder to get the hand-painted aesthetic), HTML5 Canvas (overkill, accessibility issues), CSS image maps (no hover effects).
**Affects docs:** [frontend-spec]

### D3: Seven Clickable Hotspots (Six Unique Modals)
**Choice:** The scene contains 7 clickable elements mapping to 6 modals:

| Hotspot | Visual Element | Modal |
|---------|---------------|-------|
| Swap/Trade | Control panel + Machine screen | Trading terminal (chart + swap + epoch taxes) |
| PROFIT Yield | Green bubbling tube (left) | Staking interface (stake/unstake/claim, APY) |
| Carnage Fund | Cauldron (bottom right) | Fund balance, burn totals, recent events, time since last trigger |
| Connect Wallet | Hanging sign (top right) | Wallet-adapter wallet picker |
| How It Works | Blueprint stand (bottom left) | Brief comedic explainer + link to Nextra docs |
| Settings | Gear on wall (left) | Wallet export, explorer pref, priority fee, SOL/USD toggle |

**Rationale:** Control panel and machine screen are physically adjacent and logically related (both are the "trading workstation"), so they share one modal.
**Alternatives considered:** Separate modals for chart vs swap (rejected — fragments the trading flow).
**Affects docs:** [frontend-spec, project-overview]

### D4: Trading Terminal Layout
**Choice:** The Swap/Trade modal uses a split layout:
- **Left:** Candlestick chart with tabs along top to switch token pairs
- **Right top:** Swap interface (token selector, amount, fee breakdown, "Big Red Button" to execute)
- **Right bottom:** Current epoch tax rates for CRIME/FRAUD

**Rationale:** Everything a trader needs in one view — no tab-switching to see price before swapping. The "Big Red Button" label is on-brand with the factory/industrial theme.
**Alternatives considered:** Tabbed swap/chart/stats (rejected — too many clicks for core action).
**Affects docs:** [frontend-spec]

### D5: Carnage Modal Is View-Only
**Choice:** The Carnage Fund modal displays fund balance, total CRIME/FRAUD burned, recent Carnage events, and time since last trigger. No user actions — Carnage is protocol-automated.
**Rationale:** Carnage is triggered by VRF + epoch logic, not user action. The modal is informational/entertainment ("watch the cauldron bubble").
**Alternatives considered:** N/A — Carnage is inherently non-interactive for users.
**Affects docs:** [frontend-spec, token-economics-model]

### D6: How It Works Links to Nextra Docs
**Choice:** The blueprint stand modal shows a brief, comedic explainer of the protocol, plus a button linking to the full Nextra documentation site (16 pages covering overview, gameplay, earning, security, reference).
**Rationale:** Keep the in-app experience light and fun; send serious readers to the dedicated docs site. The Nextra site (`docs-site/`) is already built with Nextra 4 + Next.js 15.
**Alternatives considered:** Full docs embedded in-app (rejected — bloats the scene, wrong tone).
**Affects docs:** [frontend-spec, project-overview]

### D7: Settings Modal Scope
**Choice:** Settings modal contains 4 items:
1. **Wallet info** — displays connected wallet address and type (external wallets manage their own key export)
2. **Explorer preference** — dropdown: Solscan / SolanaFM / Solana Explorer (swaps TX link base URL)
3. **Priority fee** — presets: Normal / Fast / Turbo (compute budget for mainnet congestion)
4. **SOL vs USD display** — toggle for balance/price denomination

**Rationale:** Minimal set that's high-value and low-effort. RPC selection excluded (support headache, Helius is reliable). Theme toggle excluded (steampunk art dictates dark). Notifications excluded (no notification system).
**Alternatives considered:** RPC endpoint picker (rejected — complexity vs value), slippage in settings (rejected — already in swap UI).
**Affects docs:** [frontend-spec]

### D8: Legacy Pages Retained Dev-Only
**Choice:** Existing `/` (dashboard) and `/swap` page routes are kept in the codebase but not accessible to end users. They serve as dev/debug views for the builder only.
**Rationale:** The existing hooks and components powering these pages are reused inside the scene's modals. The pages themselves are useful for testing individual features without the scene layer.
**Alternatives considered:** Delete them entirely (rejected — still useful for development).
**Affects docs:** [frontend-spec]

### D9: Desktop-First, Mobile TBD
**Choice:** The interactive factory scene targets desktop/landscape viewports. Mobile strategy is undecided — options are: (a) prompt rotate-to-landscape and scale, (b) build a simplified mobile layout, (c) defer mobile entirely for v1.
**Rationale:** The scene's landscape aspect ratio and clickable hotspot density don't translate naturally to portrait mobile. Better to ship a great desktop experience than compromise both.
**Alternatives considered:** Mobile-first responsive (rejected — would require fundamentally different art and interaction model).
**Affects docs:** [frontend-spec]

### D10: CSS Animations for Ambient Effects
**Choice:** Desired ambient animations: bubbling green tube, simmering cauldron. Implemented with pure CSS (animated pseudo-elements or small sprite sheets). No JavaScript animation libraries.
**Rationale:** Lightweight, performant, no additional dependencies. CSS keyframes can convincingly simulate bubble/simmer effects.
**Alternatives considered:** Lottie/After Effects animations (overkill), JavaScript Canvas (heavyweight), static only (misses the immersive opportunity).
**Affects docs:** [frontend-spec]

### D11: Nextra Docs Site Deployment
**Choice:** The Nextra documentation site (`docs-site/`) is a separate deployment from the main app. Built with Nextra 4 + Next.js 15, 16 content pages, Pagefind search. Deploys to Vercel (auto-detected).
**Rationale:** Separate deployment keeps the main app lean. Docs can update independently. Nextra's MDX-based content is easy to maintain.
**Alternatives considered:** Embed docs in main app (rejected — different build tooling, bloats main bundle).
**Affects docs:** [frontend-spec, project-overview, deployment-sequence]

### D12: State Management Stays Hook-Based
**Choice:** No centralized state manager (Redux, Zustand, etc.). All state lives in React hooks (per-feature: useSwap, useStaking, usePoolPrices, etc.) with the DashboardGrid pattern (one hook-consuming orchestrator, presentational children).
**Rationale:** Already working well. The modal-based UI means each modal is self-contained — no complex cross-modal state needed. Adding a state library would be over-engineering.
**Alternatives considered:** Zustand for global state (rejected — no cross-cutting state needs identified).
**Affects docs:** [frontend-spec, architecture]

## Open Questions
None — all decisions are firm for v1.

## Raw Notes
- The factory art is a commissioned steampunk illustration with Dr. Fraudsworth (a robot with a top hat and monocle) as the centrepiece
- The "Big Red Button" for swaps is a deliberate branding choice — factory industrial aesthetic
- The comedic tone in "How It Works" matches the overall project personality (Dr. Fraudsworth is a character, not just a protocol name)
- Existing frontend code (hooks, components, lib/) slots directly into the modal architecture — no rewrite needed, just re-parented into modal containers
