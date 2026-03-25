# Phase 56: Station Content - Research

**Researched:** 2026-02-23
**Domain:** React component re-parenting into modal system, CSS-only 3D button effects, live on-chain data polling, iframe embedding
**Confidence:** HIGH (codebase-driven, existing patterns verified)

## Summary

Phase 56 wires real content into the 6 factory station modals built in Phase 54. The core pattern is **re-parenting**: existing fully-functional components (SwapForm, StakingForm, CarnageCard, ConnectModal, SlippageConfig) move inside the singleton ModalShell without modifying their hook logic. The only net-new UI element is the Big Red Button (INTERACT-05), a CSS-only 3D physical button replacing the existing SwapStatus "Swap" button for the swap execution action.

The codebase already has all necessary data hooks (useSwap, useStaking, useCarnageData, useCarnageEvents, usePoolPrices, useSolPrice, useEpochState, useChartData), a complete modal system (ModalProvider + ModalShell with iris animation), and a centralized scene-data.ts mapping stations to modals. The existing DashboardGrid orchestrator pattern (one component calls hooks, children receive props) is already followed by SwapForm and StakingForm. Phase 56 does NOT rewrite hooks or data fetching -- it arranges existing components inside themed modal panels.

**Primary recommendation:** Build a single ModalContent component that switches on `activeStation` to render the correct station panel, placed inside ModalRoot. Each station panel is a thin wrapper that re-parents existing components with minimal layout changes and steampunk theming applied via CSS classes on the modal-body context.

## Standard Stack

### Core (already installed -- zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.2.3 | Component framework | Already in use |
| Next.js | 16.1.6 | App framework | Already in use |
| Tailwind v4 | 4.1.18 | Styling via @theme tokens | Already in use |
| lightweight-charts | 5.1.0 | Candlestick chart (TradingView) | Already in use |
| @privy-io/react-auth | 3.13.1 | Wallet connection | Already in use |

### Supporting (no new additions)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @solana/web3.js | 1.98.4 | On-chain data | Hooks already use it |
| @coral-xyz/anchor | 0.32.1 | Program interaction | Hooks already use it |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS-only 3D button | Framer Motion | D10 decision: zero new npm deps for visual layer |
| CSS-only animations | GSAP | D10 decision: zero new npm deps for visual layer |
| Custom toast | react-hot-toast | D10 decision: zero new npm deps for visual layer |

**Installation:**
```bash
# No new installations needed -- zero new dependencies
```

## Architecture Patterns

### Recommended Project Structure

```
app/
  components/
    modal/
      ModalProvider.tsx       # EXISTS -- state management
      ModalShell.tsx          # EXISTS -- singleton dialog + ModalRoot
      ModalCloseButton.tsx    # EXISTS -- brass close button
      ModalContent.tsx        # NEW -- station switch + content panels
    station/                  # NEW directory for station-specific panels
      SwapStation.tsx         # NEW -- swap modal layout
      SwapStatsBar.tsx        # NEW -- market cap + tax rates bar
      BigRedButton.tsx        # NEW -- 3D swap execute button (INTERACT-05)
      CarnageStation.tsx      # NEW -- carnage modal layout
      StakingStation.tsx      # NEW -- rewards vat modal layout
      WalletStation.tsx       # NEW -- connect wallet themed wrapper
      DocsStation.tsx         # NEW -- iframe to Nextra docs
      SettingsStation.tsx     # NEW -- slippage/priority themed wrapper
    swap/                     # UNCHANGED -- existing components
    staking/                  # UNCHANGED -- existing components
    dashboard/                # UNCHANGED -- CarnageCard re-used
    chart/                    # UNCHANGED -- CandlestickChart re-used
    wallet/                   # UNCHANGED -- ConnectModal logic re-used
    scene/                    # UNCHANGED -- scene stays as-is
  hooks/                      # UNCHANGED -- no hook modifications
  app/
    globals.css               # MODIFIED -- add Big Red Button + toast CSS
```

### Pattern 1: ModalContent Switch Component

**What:** A single component inside ModalRoot that renders the correct station panel based on `state.activeStation`.
**When to use:** Always -- this is the central wiring point.

```tsx
// app/components/modal/ModalContent.tsx
function ModalContent({ station }: { station: StationId }) {
  switch (station) {
    case 'swap':     return <SwapStation />;
    case 'carnage':  return <CarnageStation />;
    case 'staking':  return <StakingStation />;
    case 'wallet':   return <WalletStation />;
    case 'docs':     return <DocsStation />;
    case 'settings': return <SettingsStation />;
    default:         return null;
  }
}
```

**Integration point:** ModalRoot in ModalShell.tsx currently has a placeholder. Replace it:

```tsx
export function ModalRoot() {
  const { state } = useModal();
  const station = state.activeStation;
  const meta = station ? STATION_META[station] : null;

  return (
    <ModalShell title={meta?.title ?? ''} maxWidth={meta?.maxWidth ?? '600px'}>
      {station && <ModalContent station={station} />}
    </ModalShell>
  );
}
```

### Pattern 2: Re-Parent Without Rewrite

**What:** Existing components (SwapForm, CarnageCard, etc.) render inside station panels. The station panel adds layout structure but does NOT modify hook logic.
**When to use:** For all stations that wrap existing components.

```tsx
// SwapStation re-parents existing components with layout structure
function SwapStation() {
  // SwapForm already calls useSwap() internally -- no change needed
  return (
    <div className="swap-station">
      <SwapStatsBar />        {/* NEW: market cap + tax rates display-only */}
      <ChartWithControls />   {/* Re-parent existing chart + controls */}
      <div className="swap-station-bottom">
        <SwapForm />           {/* Existing component, unchanged */}
        {/* BigRedButton replaces SwapStatus internally */}
      </div>
    </div>
  );
}
```

**Critical constraint:** SwapForm currently renders SwapStatus (the swap button) internally. The Big Red Button needs to REPLACE SwapStatus. Two approaches:

1. **Prop injection (recommended):** Add an optional `renderAction` prop to SwapForm that overrides the default SwapStatus rendering. This avoids modifying SwapForm's hook logic.
2. **Extract action area:** Lift the SwapStatus rendering out of SwapForm into the station panel. This requires SwapForm to expose its execution callbacks as a render prop or context.

Option 1 is cleaner because SwapForm remains self-contained.

### Pattern 3: CSS Theme Override for Modal Context

**What:** Components designed for dark backgrounds (gray-900) need CSS adjustments when rendered inside the aged-paper modal chrome.
**When to use:** Every station panel needs this.

The modal-body has a light background (aged paper: `#f5e6c8`). Existing components use `bg-gray-900`, `text-gray-400`, etc. for dark theme. Inside modals, these need overriding.

Two approaches:
1. **Dark inner card:** Wrap each station's content in a dark card (`bg-[#1a1208]` / `bg-factory-bg`) inside the modal-body. The steampunk chrome frames it, the content uses the existing dark palette.
2. **Re-theme everything:** Change all text/bg colors. Extremely fragile with existing components.

**Recommended: Approach 1 (dark inner card).** Add a `.station-content` wrapper class that provides the dark background inside the light chrome. This preserves all existing component styles.

```css
.station-content {
  background: var(--color-factory-bg);
  border-radius: 6px;
  padding: 1rem;
  color: var(--color-factory-text);
}
```

### Pattern 4: Deferred Chart Render in Modal

**What:** CandlestickChart uses ResizeObserver which may fire with width=0 during the modal's iris-open animation (clip-path expanding).
**When to use:** Swap station chart.

The chart container starts clipped at `circle(0%)` and expands over 280ms. During this period, the container has layout but may report zero visible width to ResizeObserver.

**Solution:** Defer chart initialization until after the iris-open animation completes. Use a `data-ready` attribute or a state flag set on `animationend` that the chart component checks before calling `createChart()`.

Alternative: The existing ResizeObserver in CandlestickChart guards with `if (newWidth > 0)`, which may be sufficient. Test first before adding complexity.

### Pattern 5: Toast Notification System (CSS-only)

**What:** A lightweight toast system for swap success/error notifications without npm dependencies.
**When to use:** Big Red Button success (green flash + Solscan link) and error (shake + auto-dismiss).

Since no toast library exists and D10 forbids new npm deps:

```tsx
// Minimal toast: portal-rendered div at bottom of viewport
// CSS animations for enter/exit (slide-up + fade)
// Auto-dismiss via setTimeout
// Container rendered once in ModalRoot or providers.tsx
```

Structure:
- `ToastProvider` context + `useToast()` hook (similar to useModal pattern)
- `ToastContainer` renders at bottom-right of viewport via portal
- CSS keyframes for slide-in, slide-out, auto-dismiss

### Anti-Patterns to Avoid

- **Rewriting hooks for modal context:** The hooks (useSwap, useStaking, etc.) must stay untouched. Any data they need is already fetched.
- **Mounting hooks conditionally:** React hooks cannot be called conditionally. Station panels must always mount their hooks even if the modal is closed (or use lazy mounting where the entire station component unmounts when not active).
- **Duplicating data fetching:** DashboardGrid already fetches carnage/epoch/pool data. Station panels should either re-use those hooks (they deduplicate via shared state) or accept that hooks will be called again (WebSocket subscriptions are shared via the Connection singleton).
- **Animating box-shadow:** box-shadow animations cause repaints. Use transform + opacity for 60fps per D10 decision.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 3D button depth | Multi-layer DOM approach | Single-element box-shadow + transform:translateY | Simpler for one button; Josh Comeau pattern is for reusable button systems. One button doesn't warrant 3 nested spans. |
| Toast notifications | Complex toast queue with stacking | Single-toast provider (one at a time) | Only swap success/error uses toasts. No need for queue, stacking, or position management. |
| Chart resize in modal | Custom IntersectionObserver + ResizeObserver combo | Existing ResizeObserver guard (`if (newWidth > 0)`) | Test the existing guard first. The chart already handles this case. |
| Iframe sandboxing | Custom postMessage bridge | Native `<iframe sandbox>` attribute | The Nextra site is read-only docs -- no forms, no scripts needed from the frame. |
| Market cap computation | New hook | Existing DashboardGrid pattern (usePoolPrices + useSolPrice + math) | DashboardGrid already computes token prices from pool reserves. Extract the computation to a shared utility. |

**Key insight:** This phase is 90% integration and 10% new UI (Big Red Button + toast). Do not over-engineer integration code.

## Common Pitfalls

### Pitfall 1: Hook Mounting in Unused Modals

**What goes wrong:** If all 6 station panels mount simultaneously (rendered but hidden), all hooks fire on page load -- 6 sets of WebSocket subscriptions, 6 polling intervals, 6 wallet checks.
**Why it happens:** Rendering `{station && <ModalContent station={station} />}` means only the active station mounts. But if someone renders all 6 with `display:none`, hooks still fire.
**How to avoid:** Only render the active station component. The ModalContent switch pattern above naturally handles this -- only one station's JSX tree mounts at a time.
**Warning signs:** Multiple WebSocket subscription logs in console, high RPC call volume on page load.

### Pitfall 2: Chart Initialization During Animation

**What goes wrong:** CandlestickChart calls `createChart(container, { width: container.clientWidth })` but during iris-open animation, `clientWidth` may be 0 or the pre-animation size.
**Why it happens:** `clip-path` doesn't affect layout -- the element HAS dimensions even when clipped to `circle(0%)`. So `clientWidth` should be correct. However, if the chart container is inside an element with `overflow:hidden` or the ResizeObserver fires before layout stabilizes, width may be wrong.
**How to avoid:** Test first. The existing `if (newWidth > 0)` guard in the ResizeObserver callback should handle this. If the chart renders at wrong size, add a `requestAnimationFrame` delay after mount before creating the chart.
**Warning signs:** Chart renders at wrong width, then jumps to correct width after 280ms.

### Pitfall 3: Stale Data When Modal Reopens

**What goes wrong:** User opens swap modal, sees prices. Closes modal. 5 minutes later reopens -- sees the same stale prices because the hooks unmounted and remounted without fresh data.
**Why it happens:** usePoolPrices does a one-time fetch on mount, then relies on WebSocket. If WebSocket reconnects slowly after remount, data is stale until the first update.
**How to avoid:** The hooks already handle this -- usePoolPrices fetches on mount AND subscribes. The initial fetch provides fresh data immediately. Verify this behavior with a test: open modal, check prices, close, wait, reopen, verify prices refresh.
**Warning signs:** Old prices displayed briefly on modal open.

### Pitfall 4: ConnectModal Double-Dialog

**What goes wrong:** ConnectModal currently renders its own overlay (`fixed inset-0 z-50`) with its own backdrop. Inside ModalShell (which is already a `<dialog>`), this creates a double-overlay situation.
**Why it happens:** ConnectModal was designed as a standalone modal. It manages its own visibility, Escape handling, and backdrop.
**How to avoid:** For WalletStation, extract ONLY the two-path content from ConnectModal (the wallet buttons and sign-in buttons). Do not render ConnectModal's overlay/backdrop -- ModalShell already provides these.
**Warning signs:** Double backdrop blur, Escape closes inner overlay but not ModalShell.

### Pitfall 5: SwapForm Width in Modal Layout

**What goes wrong:** SwapForm uses `max-w-md mx-auto` (max-width: 448px, centered). In the swap station modal (1100px wide), placing the chart above and the form below works. But placing the form beside the Big Red Button requires removing/overriding `max-w-md`.
**Why it happens:** The existing SwapForm was designed for standalone display, not as part of a larger layout.
**How to avoid:** Wrap SwapForm in a container that controls width. Override `max-w-md` via the parent container's styling. Or add an optional `className` prop to SwapForm's outer div.
**Warning signs:** SwapForm renders too narrow or misaligned within the swap station layout.

### Pitfall 6: Nextra X-Frame-Options Blocking Iframe

**What goes wrong:** The docs iframe shows a blank page because the Nextra site's response headers include `X-Frame-Options: DENY` (the Next.js default in some deployments).
**Why it happens:** Next.js does not set X-Frame-Options by default, but hosting providers (Vercel, Railway) may add security headers. Nextra itself does not set framing headers.
**How to avoid:** In the docs-site `next.config.mjs`, explicitly set headers to allow framing from the main app domain:

```js
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      // Or use CSP frame-ancestors for cross-origin:
      // { key: 'Content-Security-Policy', value: 'frame-ancestors https://your-app.com' },
    ],
  }];
}
```

**Warning signs:** Blank iframe, browser console error "Refused to display in a frame."

### Pitfall 7: Modal Content Flickers on Station Switch

**What goes wrong:** When switching from one station to another (e.g., clicking Carnage Cauldron while Swap is open), the content unmounts and remounts causing a flash.
**Why it happens:** ModalShell already handles station crossfade via CSS classes (content-fade-out then content-fade-in). But if React unmounts/remounts the component tree between the two animation phases, the fade-out never completes.
**How to avoid:** ModalShell's existing crossfade logic adds CSS classes to `.modal-chrome`. The content swap (React re-render with new station) happens synchronously during the fade-out/fade-in cycle. This should work because React's reconciliation is synchronous, but needs testing with actual station content.
**Warning signs:** Flash of empty modal body during station switch.

## Code Examples

### Big Red Button -- CSS-only 3D Physical Button

```css
/* Big Red Button: 3D physical steampunk button
   Technique: box-shadow for depth + translateY for press animation.
   Source: Josh Comeau / Gregory Schier patterns adapted for steampunk. */

.big-red-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  border: 3px solid #8b2020;
  cursor: pointer;

  /* Glossy red dome gradient */
  background: radial-gradient(
    ellipse at 35% 30%,
    #ff4040 0%,
    #cc2020 40%,
    #881010 80%,
    #440808 100%
  );

  /* 3D depth: hard offset shadow = button thickness */
  box-shadow:
    0 8px 0 0 #440808,                     /* 3D depth */
    0 8px 16px rgba(0, 0, 0, 0.4),         /* drop shadow */
    inset 0 2px 4px rgba(255, 255, 255, 0.3), /* rim highlight */
    0 0 20px rgba(255, 60, 60, 0.4);       /* red glow (idle) */

  /* Raise the button above its shadow */
  transform: translateY(0);
  transition: transform 60ms ease-out, box-shadow 60ms ease-out, filter 150ms ease;

  /* Prevent text selection during rapid clicks */
  user-select: none;
}

/* Hover: intensify glow */
.big-red-button:hover:not(:disabled) {
  filter: brightness(1.1);
  box-shadow:
    0 8px 0 0 #440808,
    0 8px 20px rgba(0, 0, 0, 0.5),
    inset 0 2px 4px rgba(255, 255, 255, 0.4),
    0 0 30px rgba(255, 60, 60, 0.6);       /* stronger glow */
}

/* Active/pressed: push down by shadow depth */
.big-red-button:active:not(:disabled) {
  transform: translateY(6px);
  box-shadow:
    0 2px 0 0 #440808,                     /* reduced depth */
    0 2px 8px rgba(0, 0, 0, 0.3),
    inset 0 2px 6px rgba(0, 0, 0, 0.3),   /* inverted highlight */
    0 0 15px rgba(255, 60, 60, 0.3);
}

/* Disabled: dimmed, no glow */
.big-red-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow:
    0 8px 0 0 #440808,
    0 8px 16px rgba(0, 0, 0, 0.4),
    inset 0 2px 4px rgba(255, 255, 255, 0.1);
  /* No red glow when disabled */
}

/* State: Loading -- spinning indicator */
.big-red-button[data-state="loading"] {
  pointer-events: none; /* prevent double-click */
}

/* State: Success -- green flash */
@keyframes big-red-success {
  0%   { box-shadow: 0 8px 0 0 #2a5a2a, 0 0 40px rgba(100, 255, 100, 0.8); background: radial-gradient(ellipse at 35% 30%, #60ff60 0%, #30aa30 40%, #206020 80%); }
  100% { box-shadow: 0 8px 0 0 #440808, 0 0 20px rgba(255, 60, 60, 0.4); background: radial-gradient(ellipse at 35% 30%, #ff4040 0%, #cc2020 40%, #881010 80%, #440808 100%); }
}

.big-red-button[data-state="success"] {
  animation: big-red-success 1.5s ease-out forwards;
}

/* State: Error -- shake */
@keyframes big-red-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-6px); }
  40%      { transform: translateX(6px); }
  60%      { transform: translateX(-4px); }
  80%      { transform: translateX(4px); }
}

.big-red-button[data-state="error"] {
  animation: big-red-shake 0.4s ease-out;
}
```

### Toast Component Pattern (CSS-only animation)

```tsx
// Minimal toast: no npm dependencies, CSS slide-up animation
// Renders as portal at root level, outside modal dialog

interface Toast {
  id: string;
  type: 'success' | 'error';
  message: string;
  link?: { label: string; href: string };
}

// CSS keyframes in globals.css:
// @keyframes toast-enter { from { transform: translateY(100%); opacity: 0; } to { ... } }
// @keyframes toast-exit  { from { opacity: 1; } to { opacity: 0; transform: translateY(20px); } }
```

### Station Content Switch Pattern

```tsx
// ModalContent.tsx -- placed inside ModalRoot's ModalShell children slot
import { lazy, Suspense } from 'react';
import type { StationId } from '@/components/modal/ModalProvider';

// Lazy load station panels so they don't bloat the initial bundle.
// Only the active station's code is fetched.
const SwapStation = lazy(() => import('@/components/station/SwapStation'));
const CarnageStation = lazy(() => import('@/components/station/CarnageStation'));
const StakingStation = lazy(() => import('@/components/station/StakingStation'));
const WalletStation = lazy(() => import('@/components/station/WalletStation'));
const DocsStation = lazy(() => import('@/components/station/DocsStation'));
const SettingsStation = lazy(() => import('@/components/station/SettingsStation'));

// Loading skeleton for lazy-loaded stations
function StationSkeleton() {
  return <div className="animate-pulse h-32 bg-factory-surface rounded" />;
}

export function ModalContent({ station }: { station: StationId }) {
  return (
    <div className="station-content">
      <Suspense fallback={<StationSkeleton />}>
        {station === 'swap' && <SwapStation />}
        {station === 'carnage' && <CarnageStation />}
        {station === 'staking' && <StakingStation />}
        {station === 'wallet' && <WalletStation />}
        {station === 'docs' && <DocsStation />}
        {station === 'settings' && <SettingsStation />}
      </Suspense>
    </div>
  );
}
```

### Nextra Iframe with X-Frame-Options

```js
// docs-site/next.config.mjs -- allow framing from main app
import nextra from 'nextra';

const withNextra = nextra({});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // SAMEORIGIN for dev (both on localhost).
        // For production cross-origin, use CSP frame-ancestors instead.
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ],
    }];
  },
};

export default withNextra(nextConfig);
```

### Market Cap Stats Bar Computation

```tsx
// Reuses existing DashboardGrid computation pattern
// Source: DashboardGrid.tsx lines 110-124

function useMarketCapData() {
  const { pools } = usePoolPrices();
  const { solPrice } = useSolPrice();
  const { epochState } = useEpochState();

  // Compute USD market cap from pool reserves (same as DashboardGrid)
  // price = SOL_reserves / token_reserves * SOL/USD
  // Market cap = price * total_supply (or just price for display)
  return useMemo(() => {
    const caps: Record<string, number | null> = {};
    // ... same computation as DashboardGrid tokenPricesUsd
    return { caps, taxRates: epochState };
  }, [pools, solPrice, epochState]);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate modal per station | Singleton ModalShell with content swap | Phase 54 | No close/reopen flash between stations |
| DashboardGrid renders everything | Scene-based navigation with modal panels | Phase 55 | Components must work inside modal context |
| box-shadow animation for 3D | transform:translateY + static box-shadow | Ongoing best practice | 60fps animations, no repaint |
| X-Frame-Options header | CSP frame-ancestors directive | Modern standard | More granular control for iframe embedding |

**Deprecated/outdated:**
- ConnectModal's own overlay/backdrop: Must be stripped when re-parenting into ModalShell
- SwapForm's `max-w-md mx-auto`: Too narrow for the swap station layout (1100px modal)

## Open Questions

1. **Chart resize timing**
   - What we know: CandlestickChart has a `if (newWidth > 0)` guard in ResizeObserver callback. clip-path does not affect layout dimensions.
   - What's unclear: Whether the chart renders correctly during the 280ms iris-open animation or produces visual artifacts.
   - Recommendation: Test first with the existing component. If artifacts appear, add `requestAnimationFrame` delay after mount or check for `dialog[open]` before creating chart.

2. **Docs iframe deployment**
   - What we know: Nextra site exists in `docs-site/`, uses Next.js with Nextra plugin, has content in `content/` directory.
   - What's unclear: Whether the Nextra site is deployed anywhere yet, and what the production URL will be.
   - Recommendation: Use `localhost:3001` for dev (run docs-site separately), create a `NEXT_PUBLIC_DOCS_URL` env var for production. The iframe src switches based on environment.

3. **SwapForm Big Red Button integration**
   - What we know: SwapForm renders SwapStatus internally (line 387-396). BigRedButton needs to replace SwapStatus specifically.
   - What's unclear: Whether to add a render prop to SwapForm or restructure SwapForm's JSX to externalize the action area.
   - Recommendation: Add an optional `renderAction` prop to SwapForm. When provided, it replaces the SwapStatus block. When absent, SwapForm renders SwapStatus as before (backward compatible).

4. **Toast outside dialog**
   - What we know: HTML `<dialog>` creates a top layer that sits above all other content. Toast notifications rendered inside the dialog would be confined to it. Toasts should be visible even after the modal closes (e.g., "Swap confirmed!" persists).
   - What's unclear: Whether a portal rendering toasts in `document.body` will visually layer above the dialog's `::backdrop`.
   - Recommendation: Render toast container as a sibling of the dialog, NOT inside it. The toast container needs `z-index` higher than the dialog. Since `<dialog>` uses the top layer, the toast should use `position: fixed` with very high z-index, or be rendered after the dialog in DOM order with appropriate z.

5. **Existing component dark-on-light theming**
   - What we know: Modal chrome uses light paper background. Existing components use dark backgrounds (gray-900).
   - What's unclear: Whether wrapping all content in a dark `.station-content` container looks good visually or creates an awkward dark-inside-light appearance.
   - Recommendation: Use the dark inner card approach. The steampunk chrome frames the dark content like a brass-framed window into a dark workshop. This is actually thematically coherent.

## Sources

### Primary (HIGH confidence)
- **Codebase inspection**: ModalProvider.tsx, ModalShell.tsx, SwapForm.tsx, StakingForm.tsx, CarnageCard.tsx, ConnectModal.tsx, SlippageConfig.tsx, DashboardGrid.tsx, CandlestickChart.tsx, ChartControls.tsx, useSwap.ts, useStaking.ts, useCarnageData.ts, useChartData.ts, usePoolPrices.ts, useSolPrice.ts, scene-data.ts, SceneStation.tsx, providers.tsx, globals.css, page.tsx, layout.tsx
- **Phase 56 CONTEXT.md**: User decisions on all 6 station layouts, Big Red Button spec, documentation iframe approach

### Secondary (MEDIUM confidence)
- [Josh W. Comeau: Building a Magical 3D Button](https://www.joshwcomeau.com/animation/3d-button/) -- Layered transform approach for 3D buttons (CSS-only, 60fps)
- [Gregory Schier: Clicky 3D Buttons with CSS](https://schier.co/blog/clicky-3d-buttons-with-css) -- box-shadow offset + translateY press technique
- [Next.js iframe/X-Frame-Options discussion](https://github.com/vercel/next.js/discussions/15534) -- headers configuration in next.config.js
- [TradingView lightweight-charts ResizeObserver issue #71](https://github.com/tradingview/lightweight-charts/issues/71) -- ResizeObserver integration patterns

### Tertiary (LOW confidence)
- None -- all research was verified against codebase and official sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all verified in package.json
- Architecture: HIGH -- patterns derived from existing codebase (DashboardGrid, ModalShell, SwapForm)
- Re-parenting approach: HIGH -- components are already props-only with hook isolation
- Big Red Button CSS: MEDIUM -- technique verified from two authoritative CSS sources, but exact steampunk styling needs visual iteration
- Pitfalls: HIGH -- derived from actual codebase structure analysis
- Docs iframe: MEDIUM -- Nextra site exists but deployment status unclear
- Toast system: MEDIUM -- no existing implementation, pattern is straightforward but dialog top-layer z-index interaction needs testing

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable -- no external dependency changes expected)
