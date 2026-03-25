# Architecture: Interactive Factory Scene Integration

**Domain:** Steampunk factory scene overlay with modal-based DeFi interfaces
**Researched:** 2026-02-22
**Confidence:** HIGH (based on direct codebase analysis + verified Next.js 16 docs)

---

## Executive Summary

The factory scene is a layered image composition rendered over a static background, where each layer is a clickable steampunk object that opens a themed modal. The existing hooks (`useSwap`, `useStaking`, etc.) and their orchestrator components (`SwapForm`, `StakingForm`, `DashboardGrid`) are untouched -- only the presentation wrapping changes. The core architectural challenges are: (1) responsive image layer positioning without layout shift, (2) a modal state machine that handles open/close animations cleanly, (3) a theming strategy that re-skins existing components without rewriting logic, and (4) a 19.5MB+ asset pipeline that does not destroy initial page load.

---

## Recommended Architecture

### Overall Structure

```
layout.tsx (Providers)
  |
  page.tsx (root)
    |
    +-- <ModalProvider>                  (React Context for modal state)
    |
    +-- <FactoryScene>                   (desktop: visible, mobile: hidden)
    |     |
    |     +-- <SceneBackground />        (MainBackground.webp, fill, preload)
    |     +-- <SceneLayer id="cauldron" />   (CarnageCauldron.webp, positioned overlay)
    |     +-- <SceneLayer id="wallet" />     (ConnectWallet.webp, positioned overlay)
    |     +-- <SceneLayer id="docs" />       (DocumentationTable.webp, positioned overlay)
    |     +-- <SceneLayer id="rewards" />    (RewardsVat.webp, positioned overlay)
    |     +-- <SceneLayer id="settings" />   (Settings.webp, positioned overlay)
    |     +-- <MachineHotspot />             (invisible button over machine area in bg)
    |     +-- <AmbientEffects />             (CSS animations: steam, bubbles, gears)
    |
    +-- <MobileNav />                    (mobile: visible, desktop: hidden)
    |     +-- themed nav buttons mapping to same modals
    |
    +-- <ModalManager />                 (portal-based, renders active modal)
          |
          +-- <ModalOverlay>             (backdrop + animation wrapper)
                |
                +-- <TradingTerminalModal />  (chart + swap + tax rates)
                +-- <StakingModal />          (StakingForm + StakingStats)
                +-- <CarnageModal />          (CarnageCard, view-only)
                +-- <WalletModal />           (ConnectModal, already built)
                +-- <HowItWorksModal />       (comedic explainer + docs link)
                +-- <SettingsModal />         (4 settings items)
```

### Key Principle: Presentation Shell, Not Logic Rewrite

The existing components follow the **DashboardGrid orchestrator pattern** -- one component calls hooks, children receive props. This pattern slots directly into the modal architecture:

```
BEFORE (current page route):
  SwapPage -> SwapForm (calls useSwap) -> TokenSelector, FeeBreakdown, etc.

AFTER (modal):
  TradingTerminalModal -> SwapForm (calls useSwap) -> TokenSelector, FeeBreakdown, etc.
                        -> ChartControls + CandlestickChart
                        -> EpochCard + TaxRatesCard
```

The orchestrators (`SwapForm`, `StakingForm`, `DashboardGrid`) are **re-parented** into modals. Their children are **re-themed** (new className values). No hook changes, no state logic changes.

---

## Component Inventory: New vs Modified vs Unchanged

### NEW Components (to build)

| Component | Location | Purpose | Complexity |
|-----------|----------|---------|------------|
| `FactoryScene` | `components/scene/FactoryScene.tsx` | Container for background + all layers, handles responsive scaling | Medium |
| `SceneBackground` | `components/scene/SceneBackground.tsx` | Next.js Image with `fill` + `preload` for the main factory image | Low |
| `SceneLayer` | `components/scene/SceneLayer.tsx` | Positioned, clickable overlay with hover glow effect | Medium |
| `AmbientEffects` | `components/scene/AmbientEffects.tsx` | CSS-only animations (steam wisps, cauldron bubbles, gear rotation) | Medium |
| `ModalManager` | `components/modal/ModalManager.tsx` | Context-based modal state, renders active modal via portal | Medium |
| `ModalOverlay` | `components/modal/ModalOverlay.tsx` | Backdrop blur, close handlers, focus trap, enter/exit animations | Medium |
| `TradingTerminalModal` | `components/modal/TradingTerminalModal.tsx` | Composes chart + swap + tax rates into split layout | Medium |
| `StakingModal` | `components/modal/StakingModal.tsx` | Wraps StakingForm + StakingStats | Low |
| `CarnageModal` | `components/modal/CarnageModal.tsx` | Wraps CarnageCard (view-only) | Low |
| `HowItWorksModal` | `components/modal/HowItWorksModal.tsx` | Comedic explainer + Nextra docs link | Low |
| `SettingsModal` | `components/modal/SettingsModal.tsx` | 4 settings items with localStorage persistence | Medium |
| `MobileNav` | `components/mobile/MobileNav.tsx` | Themed bottom nav or sidebar for portrait viewports | Medium |
| `useModalState` | `hooks/useModalState.ts` | React Context-based modal state management | Low |
| `useSettings` | `hooks/useSettings.ts` | localStorage-backed settings (explorer pref, priority fee, SOL/USD) | Low |

### MODIFIED Components (re-themed, logic untouched)

These need their Tailwind classes swapped from `bg-gray-900`/`bg-zinc-950` dark theme to steampunk palette tokens. Their props interfaces and hook calls do NOT change.

| Component | Change Scope |
|-----------|-------------|
| `SwapForm` | className changes: card backgrounds, text colors, button styles |
| `TokenSelector` | className changes: dropdown styling |
| `FeeBreakdown` | className changes: expand/collapse panel styling |
| `SlippageConfig` | className changes: preset buttons, input styling |
| `SwapStatus` | className changes: status indicators, button -> "Big Red Button" |
| `RouteSelector` | className changes: route card styling |
| `MultiHopStatus` | className changes: step indicator styling |
| `StakingForm` | className changes: tab buttons, card backgrounds |
| `StakingStats` | className changes: stats display |
| `StakeTab` | className changes: input styling |
| `UnstakeTab` | className changes: input/warning styling |
| `ClaimTab` | className changes: display styling |
| `StakingStatus` | className changes: status indicators |
| `EpochCard` | className changes: card chrome |
| `TaxRatesCard` | className changes: card chrome |
| `PoolCard` | className changes: card chrome |
| `CarnageCard` | className changes: card chrome |
| `CandlestickChart` | Theme object changes (chart background, grid lines, crosshair colors) |
| `ChartControls` | className changes: tab/button styling |
| `WalletButton` | className changes: button chrome |
| `BalanceDisplay` | className changes: display chrome |

### UNCHANGED Components (no modification needed)

| Component/Module | Reason |
|-----------------|--------|
| All 13 hooks (`useSwap`, `useStaking`, `usePoolPrices`, etc.) | Pure data layer, no presentation concerns |
| All `lib/` utilities (swap-builders, quote-engine, hook-resolver, etc.) | Transaction builders, no UI |
| All API routes (`/api/candles`, `/api/sse`, `/api/webhooks`, `/api/health`) | Server-side, no UI |
| `providers.tsx` | Privy/wallet config, no changes |
| `db/` schema and queries | Database layer unchanged |
| `idl/` types | Anchor IDL types unchanged |
| `shared/` package | Constants and PDAs unchanged |

---

## Detailed Architecture: Scene Layout System

### Responsive Image Positioning Strategy

The factory scene must maintain exact visual alignment between the background and overlays at any viewport width. This is the hardest architectural problem.

**Approach: Percentage-based absolute positioning within an aspect-ratio-locked container.**

```tsx
// FactoryScene.tsx
<div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
  {/* Background layer: fills container */}
  <Image
    src={backgroundImage}  // static import for auto blur placeholder
    alt=""
    fill
    sizes="100vw"
    style={{ objectFit: "cover" }}
    preload
    placeholder="blur"
    quality={80}
  />

  {/* Each overlay: positioned as % of container */}
  <SceneLayer
    id="cauldron"
    src="/scene/cauldron.webp"
    position={{ top: "58%", left: "68%", width: "22%", height: "35%" }}
    onClick={() => openModal("carnage")}
    label="Carnage Cauldron"
  />
  {/* ... other layers */}
</div>
```

**Why this works:**
1. The outer `div` locks to the background's natural aspect ratio. The MainBackground image is landscape (approximately 16:9 based on visual analysis -- the exact ratio should be measured from the source file and used precisely).
2. All overlay positions are percentages of this container -- they scale proportionally at any width.
3. `object-fit: cover` on the background ensures no letterboxing.
4. Overlays use `position: absolute` with percentage `top/left/width/height` so they track the background exactly.
5. No JavaScript resize listeners needed -- CSS handles everything.

**Why NOT CSS `background-image`:**
- Cannot use Next.js Image optimization (WebP/AVIF conversion, responsive srcset)
- Cannot use `preload` for LCP
- Cannot use `placeholder="blur"` for progressive loading
- Cannot get responsive image size selection via `sizes` prop

### SceneLayer Component

Each interactive factory element is wrapped in a `<button>` for accessibility.

```tsx
interface SceneLayerProps {
  id: string;
  src: string;
  position: { top: string; left: string; width: string; height: string };
  onClick: () => void;
  label: string;
  animationClass?: string;
}

function SceneLayer({ id, src, position, onClick, label, animationClass }: SceneLayerProps) {
  return (
    <button
      onClick={onClick}
      className={`absolute cursor-pointer group focus:outline-none
                  focus-visible:ring-2 focus-visible:ring-amber-400
                  ${animationClass ?? ""}`}
      style={position}
      role="button"
      aria-label={label}
      aria-haspopup="dialog"
    >
      <Image
        src={src}
        alt=""  // Decorative -- button has aria-label
        fill
        sizes="33vw"
        style={{ objectFit: "contain" }}
        loading="lazy"
      />

      {/* Hover glow: CSS filter on covering div */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100
                      transition-opacity duration-300 pointer-events-none"
           style={{ filter: "brightness(1.3) drop-shadow(0 0 20px rgba(218,165,32,0.6))" }} />

      {/* Tooltip label on hover */}
      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2
                       text-xs text-amber-200 opacity-0 group-hover:opacity-100
                       transition-opacity whitespace-nowrap pointer-events-none
                       bg-black/70 px-2 py-0.5 rounded">
        {label}
      </span>
    </button>
  );
}
```

**Hover effect rationale:** CSS `filter: brightness()` + `drop-shadow()` applied to a covering div gives a warm golden glow without modifying the source image. The `drop-shadow` respects the PNG transparency, so only the opaque pixels glow. This matches the steampunk aesthetic (gas-lamp amber glow) without any animation library.

**Using `<button>` instead of `<div>`:** This gives keyboard focus, Enter/Space activation, and screen reader discovery for free. The `focus-visible:ring` ensures keyboard users see where they are.

### Machine/Control Panel Hotspot

The machine and control panel are part of the MainBackground image (not separate overlays). The clickable region is an invisible button positioned over that area.

```tsx
{/* Machine hotspot: invisible button over the control panel area */}
<button
  onClick={() => openModal("trading")}
  className="absolute cursor-pointer
             hover:bg-amber-400/10 rounded-lg transition-all duration-300
             focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
  style={{ top: "25%", left: "30%", width: "40%", height: "55%" }}
  aria-label="Trading Terminal"
  aria-haspopup="dialog"
/>
```

### Position Mapping (from asset analysis)

Based on visual inspection of the 6 assets (each is a transparent PNG with the element positioned relative to where it belongs in the full scene):

| Layer | Approx Position (% of scene) | Notes |
|-------|------------------------------|-------|
| Background | 0,0 to 100%,100% (fill) | LCP image, preload, blur placeholder |
| CarnageCauldron | bottom-right (~65-70% left, ~55-60% top) | Cauldron with bubbling green liquid |
| ConnectWallet | top-right (~55-60% left, ~0-5% top) | Hanging wooden sign on chains |
| DocumentationTable | bottom-left (~5-15% left, ~60-70% top) | Blueprint stand with open book |
| RewardsVat | left side (~5-15% left, ~15-30% top) | Green bubbling tube/vat apparatus |
| Settings | far-left (~0-5% left, ~15-30% top) | Cluster of brass gears |
| Machine (hotspot) | center (~25-35% left, ~20-30% top, ~40% wide, ~55% tall) | Part of background -- invisible button |

**These positions are approximate.** Final values must be tuned by visual alignment in the browser. The architecture supports this easily -- just change percentage values in the position objects.

---

## Detailed Architecture: Modal Management

### State Management: React Context (not Zustand)

Decision D12 says "no centralized state manager." Modal state is simple enough for React Context. Only one modal is open at a time.

```tsx
// hooks/useModalState.ts
type ModalId = "trading" | "staking" | "carnage" | "wallet" | "howItWorks" | "settings" | null;

interface ModalContextValue {
  activeModal: ModalId;
  openModal: (id: ModalId) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextValue>(/* default */);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [activeModal, setActiveModal] = useState<ModalId>(null);

  const openModal = useCallback((id: ModalId) => {
    setActiveModal(id);
  }, []);

  const closeModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  return (
    <ModalContext.Provider value={{ activeModal, openModal, closeModal }}>
      {children}
    </ModalContext.Provider>
  );
}

export function useModalState() {
  return useContext(ModalContext);
}
```

**Why Context instead of Zustand:**
- Single one-of-N state (which modal is open, or null)
- No complex selectors or derived state
- Matches Decision D12 ("no centralized state manager")
- Context re-render scope is small (only ModalManager and scene buttons consume it)

### ModalManager: Portal-Based Rendering

```tsx
// components/modal/ModalManager.tsx
import { createPortal } from "react-dom";

function ModalManager() {
  const { activeModal, closeModal } = useModalState();

  if (!activeModal) return null;

  const content = (() => {
    switch (activeModal) {
      case "trading": return <TradingTerminalModal />;
      case "staking": return <StakingModal />;
      case "carnage": return <CarnageModal />;
      case "wallet": return <WalletModal />;
      case "howItWorks": return <HowItWorksModal />;
      case "settings": return <SettingsModal />;
      default: return null;
    }
  })();

  return createPortal(
    <ModalOverlay onClose={closeModal}>
      {content}
    </ModalOverlay>,
    document.body
  );
}
```

**Why portal:** Avoids z-index stacking issues with the scene layers. Modals render as direct children of `<body>`, completely outside the scene DOM tree. This is the same approach used by production dialog libraries.

### ModalOverlay: Shared Wrapper

This replaces the inline modal pattern in `ConnectModal.tsx` with a reusable, accessible wrapper.

```tsx
// components/modal/ModalOverlay.tsx
function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const [isVisible, setIsVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Trigger enter animation on next frame
    requestAnimationFrame(() => setIsVisible(true));

    // Lock body scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center
                  bg-black/70 backdrop-blur-sm
                  transition-opacity duration-300
                  ${isVisible ? "opacity-100" : "opacity-0"}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={contentRef}
        className={`relative max-h-[90vh] overflow-y-auto
                    transition-all duration-300
                    ${isVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (consistent across all modals) */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10
                     text-factory-text-muted hover:text-factory-text
                     transition-colors"
          aria-label="Close"
        >
          {/* X icon SVG */}
        </button>

        {children}
      </div>
    </div>
  );
}
```

**Features:**
1. **Backdrop:** Semi-transparent dark with `backdrop-filter: blur(8px)`
2. **Close on backdrop click:** `onClick` on overlay, `stopPropagation` on content
3. **Close on Escape:** `useEffect` keyboard listener
4. **Enter animation:** CSS transition from `opacity-0 scale-95` to `opacity-100 scale-100`
5. **Body scroll lock:** `document.body.style.overflow = "hidden"` while open
6. **prefers-reduced-motion:** Should be handled via `motion-safe:` Tailwind modifier

**Focus trap (Phase 5 accessibility improvement):** For v1 ship, the Escape-to-close and backdrop-click-to-close patterns from the existing ConnectModal are sufficient. Full focus trap (Tab cycling within modal) is a planned accessibility improvement that can be added as a `useFocusTrap` hook in a polish phase.

### Modal Sizing Strategy

| Modal | Desktop Size | Layout | Content |
|-------|-------------|--------|---------|
| Trading Terminal | `max-w-6xl` (~1152px) | Split: chart left 60%, swap+taxes right 40% | Chart + SwapForm + EpochCard + TaxRatesCard |
| Staking | `max-w-lg` (~512px) | Single column | StakingStats + StakingForm |
| Carnage | `max-w-lg` (~512px) | Single column | CarnageCard |
| Wallet | `max-w-md` (~448px) | Single column | Existing ConnectModal content |
| How It Works | `max-w-xl` (~576px) | Single column | Text + link button |
| Settings | `max-w-md` (~448px) | Single column | 4 settings items |

---

## Detailed Architecture: Re-Theming Strategy

### Approach: Tailwind v4 @theme Tokens

Instead of find-and-replace on 500+ Tailwind class strings, define a steampunk theme as CSS custom properties using Tailwind v4's `@theme` directive. This generates real utility classes.

```css
/* globals.css */
@import "tailwindcss";

@theme {
  /* Steampunk factory palette */
  --color-factory-bg: #1a1209;
  --color-factory-surface: #2a1f0e;
  --color-factory-surface-raised: #3d2e18;
  --color-factory-border: #5c4a2e;
  --color-factory-border-light: #8b7355;
  --color-factory-text: #e8dcc8;
  --color-factory-text-muted: #9b8b72;
  --color-factory-text-dim: #6b5d48;
  --color-factory-accent: #daa520;
  --color-factory-accent-hover: #ffd700;
  --color-factory-accent-dim: #b8860b;
  --color-factory-success: #4ade80;
  --color-factory-error: #f87171;
  --color-factory-glow: rgba(218, 165, 32, 0.3);
}
```

**This generates utilities like:**
- `bg-factory-surface` (instead of `bg-gray-900`)
- `text-factory-text` (instead of `text-zinc-100`)
- `border-factory-border` (instead of `border-zinc-700`)
- `hover:text-factory-accent-hover` (fully compositional)

**Why Tailwind v4 @theme:**
- Confirmed working: project uses Tailwind 4.1.18 with `@tailwindcss/postcss`
- Generates real utility classes with IDE autocomplete
- Works with all Tailwind modifiers (`hover:`, `focus:`, responsive, etc.)
- No arbitrary value syntax (`bg-[var(--x)]`) needed
- Single source of truth for the palette

### Component Theming Examples

**SwapForm card background:**
```tsx
// BEFORE:
<div className="bg-gray-900 rounded-xl p-4">

// AFTER:
<div className="bg-factory-surface rounded-xl p-4 border border-factory-border">
```

**Button styling:**
```tsx
// BEFORE (neutral CTA):
<button className="w-full py-2.5 px-4 bg-zinc-100 text-zinc-900 font-medium rounded-lg">

// AFTER (steampunk CTA):
<button className="w-full py-2.5 px-4 bg-factory-accent text-factory-bg font-bold rounded-lg
                   hover:bg-factory-accent-hover transition-colors">
```

**Text colors:**
```tsx
// BEFORE:
<span className="text-sm text-gray-400">You pay</span>

// AFTER:
<span className="text-sm text-factory-text-muted">You pay</span>
```

### Theming Migration Path

**Phase 1: Define tokens in globals.css** -- Zero visual change, just adds the `@theme` block.

**Phase 2: Theme modal chrome first** -- ModalOverlay, modal card backgrounds, close buttons. This is new code, so there is nothing to migrate.

**Phase 3: Theme existing components** -- One component at a time, swap `bg-gray-900` to `bg-factory-surface`, `text-zinc-100` to `text-factory-text`, etc.

**Phase 4: Theme the chart** -- CandlestickChart's theme object uses hex colors directly, not Tailwind classes. Update the hex values to match the steampunk palette.

### What NOT to Do: Wrapper-Based Theming

A tempting anti-pattern is wrapping existing components in `<div className="steampunk-theme">` that overrides child styles via CSS specificity. This breaks because:
1. Tailwind utilities have flat specificity -- parent selectors cannot override them
2. Creates maintenance confusion (which styles win?)
3. Tailwind v4 does not support the old `important` config option

The correct approach is **direct className modification on each component**. This is safe because the components are presentation-focused (data via props) and the className changes are purely cosmetic.

---

## Detailed Architecture: Animation Layer

### Ambient Effects (CSS-only, per Decision D10)

```css
/* globals.css -- ambient animation keyframes */

/* Steam: translucent wisps that rise and fade */
@keyframes steam-rise {
  0% { transform: translateY(0) scaleX(1); opacity: 0.4; }
  50% { transform: translateY(-40px) scaleX(1.2); opacity: 0.2; }
  100% { transform: translateY(-80px) scaleX(0.8); opacity: 0; }
}

.steam-wisp {
  position: absolute;
  width: 30px;
  height: 30px;
  background: radial-gradient(circle, rgba(200,200,200,0.3) 0%, transparent 70%);
  border-radius: 50%;
  animation: steam-rise 4s ease-out infinite;
}
.steam-wisp-1 { left: 20%; animation-delay: 0s; }
.steam-wisp-2 { left: 50%; animation-delay: 1.5s; }
.steam-wisp-3 { left: 70%; animation-delay: 3s; }

/* Bubbles: small circles that rise from cauldron */
@keyframes bubble-rise {
  0% { transform: translateY(0) scale(1); opacity: 0.6; }
  100% { transform: translateY(-50px) scale(0.5); opacity: 0; }
}

.bubble {
  position: absolute;
  width: 8px;
  height: 8px;
  background: rgba(74, 222, 128, 0.5);
  border-radius: 50%;
  animation: bubble-rise 3s ease-in infinite;
}

/* Respect user motion preferences */
@media (prefers-reduced-motion: reduce) {
  .steam-wisp, .bubble {
    animation: none;
    opacity: 0.15;
  }
}
```

**Why CSS-only:**
- Zero JS overhead, 60fps guaranteed
- No animation library dependency (Framer Motion is ~40KB gzipped)
- `prefers-reduced-motion` handled trivially via media query
- Matches Decision D10

### Modal Transitions (CSS transitions, not keyframe animations)

Modal open/close uses CSS `transition` (not `animation`) because transitions support interruption -- if a user clicks to close mid-open, the transition reverses smoothly.

No Framer Motion, no React Spring, no GSAP. CSS transitions are sufficient for modal open/close.

---

## Detailed Architecture: Asset Pipeline

### Current Asset Problem

| Asset | Current Size | Format |
|-------|-------------|--------|
| MainBackground | 12.0 MB | PNG |
| ConnectWallet | 2.1 MB | PNG |
| RewardsVat | 1.8 MB | PNG |
| DocumentationTable | 1.6 MB | PNG |
| Settings | 1.1 MB | PNG |
| CarnageCauldron | 0.95 MB | PNG |
| **Total** | **19.55 MB** | |

This is far too large for initial page load. Target: under 2MB for above-the-fold content.

### Optimization Strategy

**Step 1: Convert PNGs to WebP**

WebP with transparency typically achieves 50-70% compression over PNG for illustrated art. Estimated savings:

| Asset | PNG Size | Est. WebP Size | Savings |
|-------|----------|----------------|---------|
| MainBackground | 12.0 MB | ~3.5 MB | ~70% |
| ConnectWallet | 2.1 MB | ~0.7 MB | ~67% |
| RewardsVat | 1.8 MB | ~0.6 MB | ~67% |
| DocumentationTable | 1.6 MB | ~0.5 MB | ~69% |
| Settings | 1.1 MB | ~0.4 MB | ~64% |
| CarnageCauldron | 0.95 MB | ~0.35 MB | ~63% |
| **Total** | **19.55 MB** | **~6.05 MB** | **~69%** |

Conversion command: `cwebp -q 80 input.png -o output.webp` (for each file).

**Step 2: Use Next.js Image component for automatic format negotiation**

Next.js Image will generate responsive srcset entries and serve optimized formats. The `quality` prop controls compression.

**Step 3: Loading priority hierarchy**

| Asset | Strategy | Rationale |
|-------|----------|-----------|
| MainBackground | `preload` + `placeholder="blur"` + `quality={80}` | LCP element -- must load first |
| All overlays | `loading="lazy"` | Secondary visual elements; load on viewport entry |

**Step 4: Blur placeholder for background**

Use static import for the background image to get auto-generated `blurDataURL`:

```tsx
import bgImage from "@/public/scene/background.webp";

<Image
  src={bgImage}
  alt=""
  fill
  sizes="100vw"
  preload
  placeholder="blur"
  quality={80}
/>
```

This gives an instant blurred preview (tiny inline data URL) while the full image loads.

**Step 5: Responsive image sizes**

The background does NOT need to be full resolution on small screens. The `sizes="100vw"` prop combined with Next.js deviceSizes config (default: 640, 750, 828, 1080, 1200, 1920, 2048, 3840) means a 768px browser gets the 828w variant, not the 1920w variant.

**Step 6: next.config.ts updates**

```typescript
// Add to nextConfig:
images: {
  qualities: [75, 80],  // Required in Next.js 16
  formats: ['image/webp'],  // Enable WebP (default)
},
```

**Step 7: Asset file organization**

```
app/public/scene/
  background.webp       (converted from MainBackground.png)
  cauldron.webp         (converted from CarnageCauldron.png)
  wallet-sign.webp      (converted from ConnectWallet.png)
  docs-table.webp       (converted from DocumentationTable.png)
  rewards-vat.webp      (converted from RewardsVat.png)
  settings-gears.webp   (converted from Settings.png)
```

**CSP note:** The current CSP has `img-src 'self' data: blob:` -- local images and blur data URLs are already allowed. No CSP changes needed.

---

## Detailed Architecture: Mobile Routing

### Strategy: Component Swap via CSS, Not Route Swap

Desktop and mobile see the same URL (`/`) but different components based on viewport width.

```tsx
// app/page.tsx
export default function Home() {
  return (
    <ModalProvider>
      {/* Desktop: interactive scene (hidden below md breakpoint) */}
      <div className="hidden md:block">
        <FactoryScene />
      </div>

      {/* Mobile: themed navigation menu (hidden above md breakpoint) */}
      <div className="block md:hidden">
        <MobileNav />
      </div>

      {/* Modals: same on both viewports, rendered via portal */}
      <ModalManager />
    </ModalProvider>
  );
}
```

**Why NOT separate routes:**
- Modals are identical on both viewports
- Hooks are identical
- Single URL is better for sharing links
- No server-side user-agent sniffing needed
- CSS breakpoint switching is instant

### MobileNav Design

A full-screen themed menu with large touch targets. Each item opens the same modal as the desktop hotspot.

```tsx
function MobileNav() {
  const { openModal } = useModalState();

  return (
    <div className="min-h-screen bg-factory-bg p-4 flex flex-col">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-xl font-bold text-factory-accent">Dr. Fraudsworth</h1>
        <WalletButton />
      </header>

      <div className="grid grid-cols-2 gap-4 flex-1 content-start">
        <NavCard label="Trade" icon="/scene/machine-thumb.webp" onClick={() => openModal("trading")} />
        <NavCard label="Stake" icon="/scene/rewards-vat-thumb.webp" onClick={() => openModal("staking")} />
        <NavCard label="Carnage" icon="/scene/cauldron-thumb.webp" onClick={() => openModal("carnage")} />
        <NavCard label="How It Works" icon="/scene/docs-thumb.webp" onClick={() => openModal("howItWorks")} />
        <NavCard label="Settings" icon="/scene/settings-thumb.webp" onClick={() => openModal("settings")} />
        <NavCard label="Wallet" icon="/scene/wallet-thumb.webp" onClick={() => openModal("wallet")} />
      </div>
    </div>
  );
}
```

**NavCard** shows a small thumbnail of each factory element (cropped/scaled from the overlays at ~96x96px) with a label. Touch targets are at least 48x48px per WCAG guidelines.

### Modal Responsiveness on Mobile

| Modal | Desktop Layout | Mobile Layout |
|-------|---------------|---------------|
| Trading Terminal | Side-by-side (chart 60%, swap 40%) | Stacked: chart top, swap below. Chart height reduced to 250px. |
| Staking | `max-w-lg` centered | Full width with `mx-4` padding |
| Carnage | `max-w-lg` centered | Full width with `mx-4` padding |
| Others | `max-w-md` centered | Full width with `mx-4` padding |

The Trading Terminal is the only modal needing structural responsive changes:

```tsx
<div className="flex flex-col lg:flex-row gap-4 max-w-6xl mx-auto p-4">
  <div className="w-full lg:w-3/5">
    <ChartControls ... />
    <CandlestickChart height={300} ... />  {/* Use 300 default, 400 on lg */}
  </div>
  <div className="w-full lg:w-2/5 space-y-4">
    <SwapForm />
    <div className="flex gap-4">
      <EpochCard ... />
      <TaxRatesCard ... />
    </div>
  </div>
</div>
```

---

## Trading Terminal "Big Red Button"

The "Big Red Button" (Decision D4) replaces the current neutral swap execution button.

**Implementation:** className change on the `SwapStatus` component's submit button:

```tsx
// Current (neutral):
<button className="w-full py-3 bg-zinc-100 text-zinc-900 font-medium rounded-lg">

// Themed (Big Red Button):
<button className="w-full py-4 bg-red-700 hover:bg-red-600 text-white font-bold
                   rounded-xl shadow-lg shadow-red-900/50
                   border-2 border-red-500
                   transition-all duration-150
                   active:scale-[0.98] active:shadow-sm">
```

Button text changes by state:
- Idle: "EXECUTE SWAP" (red)
- Building/Signing/Sending/Confirming: "PROCESSING..." (pulsing amber)
- Confirmed: "SWAP COMPLETE" (green, fades back)
- Failed: "RETRY" (red outline)

---

## Data Flow Diagram

```
                  ModalProvider (Context: activeModal)
                       |
           +-----------+-----------+
           |                       |
    FactoryScene              ModalManager
    (or MobileNav)                 |
           |                  createPortal -> body
    SceneLayer clicks              |
    openModal("trading")     ModalOverlay
                                   |
                       TradingTerminalModal
                                   |
                       +-----------+-----------+
                       |           |           |
                  SwapForm    ChartSection   TaxDisplay
                       |           |           |
                  useSwap()   useChartData  useEpochState
                       |      usePoolPrices  useCurrentSlot
                  (unchanged)   (unchanged)   (unchanged)
```

**Key insight:** The data flow is ONE-WAY from hooks to components. The modal system only adds a presentation shell above the existing component tree. No new hooks, no new data fetching, no new state management beyond the single modal-open context.

---

## Suggested Build Order

### Phase 1: Foundation (asset pipeline + theme tokens + modal system)

**Everything else depends on these.**

1. Convert PNGs to WebP, place in `app/public/scene/`
2. Add `@theme` block to `globals.css` with steampunk color tokens
3. Update `next.config.ts` with `images.qualities` for Next.js 16
4. Build `useModalState` context hook
5. Build `ModalOverlay` component (backdrop, close, focus trap, animations)
6. Build `ModalManager` component (portal, renders active modal)
7. Wire `ModalProvider` into the page layout

**Deliverable:** Modal system works -- can open/close empty modals from a test button.

### Phase 2: Scene layout (background + hotspots)

**Visual foundation.**

1. Build `SceneBackground` (Next.js Image with blur placeholder)
2. Build `SceneLayer` component (positioned overlay with hover glow)
3. Build `FactoryScene` container (aspect-ratio box + all layers)
4. Map hotspot positions by visual alignment with the background
5. Wire hotspot clicks to `openModal()`
6. Add machine/screen invisible hotspot

**Deliverable:** The factory scene renders, overlays are correctly positioned, clicking opens empty modals.

### Phase 3: Modal content (wrap existing components)

**Connects the scene to real functionality.**

1. Build `TradingTerminalModal` (compose chart + SwapForm + tax cards)
2. Build `StakingModal` (wrap StakingForm + StakingStats)
3. Build `CarnageModal` (wrap CarnageCard)
4. Integrate existing `ConnectModal` into `WalletModal` wrapper
5. Build `HowItWorksModal` (new content)
6. Build `SettingsModal` (new content + `useSettings` hook)

**Deliverable:** All 6 modals functional with current (un-themed) components inside.

### Phase 4: Re-theme existing components

**Cosmetic polish.**

1. Theme modal chrome (card backgrounds, borders, close buttons)
2. Theme SwapForm and children (7 files)
3. Theme StakingForm and children (6 files)
4. Theme dashboard cards (5 files)
5. Theme chart (2 files -- className + theme object)
6. Theme wallet components (3 files)
7. Implement "Big Red Button" on SwapStatus

**Deliverable:** Fully themed modals with steampunk aesthetic.

### Phase 5: Ambient effects + polish

1. Build `AmbientEffects` (CSS animations: steam, bubbles)
2. Add `prefers-reduced-motion` media query support
3. Refine modal enter/exit animation timing
4. Add hover tooltip labels on scene layers

**Deliverable:** Scene feels alive and polished.

### Phase 6: Mobile navigation

1. Build `MobileNav` with themed navigation cards
2. Generate mobile thumbnail images from scene assets
3. Add responsive breakpoint switching (`hidden md:block` / `block md:hidden`)
4. Make Trading Terminal modal responsive (stacked layout on mobile)
5. Test all modals at mobile viewport widths

**Deliverable:** Full mobile experience via simplified themed navigation.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Canvas/WebGL for the scene
**What:** Using HTML5 Canvas, WebGL, or Three.js for the factory scene.
**Why bad:** Massive bundle size (Three.js is 500KB+), accessibility nightmare (no DOM elements for focus/screen readers), overkill for static positioned images with CSS hover effects.
**Instead:** DOM-based layout with Next.js Image components and CSS effects.

### Anti-Pattern 2: Framer Motion for modal transitions
**What:** Adding Framer Motion or React Spring for animation.
**Why bad:** ~40KB gzipped dependency for effects achievable with CSS. Potential Turbopack compatibility risk (similar category to Sentry issue -- libraries that patch build internals). Based on project memory: "ALL @sentry/* npm packages break Turbopack SSR."
**Instead:** CSS transitions for modals, CSS keyframes for ambient effects. Zero-dependency approach consistent with the existing `lib/sentry.ts` philosophy.

### Anti-Pattern 3: Z-index wars between scene layers and modals
**What:** Layering modals and scene elements at the same DOM level with competing z-index values.
**Why bad:** Creates brittle stacking contexts, especially with `backdrop-filter`.
**Instead:** Portal-based modals render as direct children of `<body>`, completely outside the scene DOM tree. The scene never needs to coordinate z-index with modals.

### Anti-Pattern 4: Route-based modals (parallel routes, intercepting routes)
**What:** Using Next.js App Router parallel routes or intercepting routes for modal state.
**Why bad:** Over-engineering. Modals do not need URL state, back-button navigation, or SSR. Route-based modals introduce hydration complexity, loading states, and URL management overhead.
**Instead:** Client-side React Context for modal open/close. Simple, fast, no hydration edge cases.

### Anti-Pattern 5: Creating themed component duplicates
**What:** Creating `ThemedSwapForm` that duplicates `SwapForm` logic with new styles.
**Why bad:** Two components to maintain. Logic divergence is inevitable. Bugs get fixed in one but not the other.
**Instead:** Modify className values directly on existing components. One component, one truth.

### Anti-Pattern 6: Client-side image conversion at runtime
**What:** Using a library like `sharp` in the browser or a custom loader to convert PNG at runtime.
**Why bad:** Wastes user bandwidth downloading the full PNG, then converting. Defeats the purpose of optimization.
**Instead:** Pre-convert PNGs to WebP at build/deploy time. Let Next.js Image handle responsive srcset generation.

### Anti-Pattern 7: Using `background-image` CSS for the scene
**What:** Setting MainBackground as a CSS `background-image` instead of using `<Image>`.
**Why bad:** Loses all Next.js Image optimization: no responsive srcset, no WebP/AVIF format negotiation, no `preload` for LCP, no `placeholder="blur"`, no lazy loading control.
**Instead:** Use Next.js `<Image fill>` for the background. Gets all optimization benefits automatically.

---

## Integration Points Summary

### Files That Need No Changes (pure data/logic layer)

- All 13 hooks in `app/hooks/`
- All utilities in `app/lib/` (swap builders, quote engine, hook resolver, etc.)
- All API routes in `app/app/api/`
- `app/providers/providers.tsx`
- `app/db/` (schema, queries)
- `app/idl/` (Anchor types)
- `shared/` package

### Files That Change (presentation layer only)

- `app/app/page.tsx` -- replace DashboardGrid with FactoryScene + MobileNav + ModalManager
- `app/app/layout.tsx` -- add ModalProvider wrapper
- `app/app/globals.css` -- add @theme tokens + animation keyframes
- `app/next.config.ts` -- add `images.qualities` config
- 23 component files across `swap/`, `staking/`, `dashboard/`, `chart/`, `wallet/` -- className swaps

### Files Created (new presentation components)

- 12 new component files across `scene/`, `modal/`, `mobile/`
- 2 new hook files (`useModalState.ts`, `useSettings.ts`)
- 6 optimized WebP assets in `app/public/scene/`

### Dev Pages Retained (Decision D8)

- `app/app/swap/page.tsx` -- kept as dev-only swap/chart/staking view
- Current `page.tsx` dashboard content moved to `app/app/dashboard/page.tsx` (optional)

---

## Sources

- **Next.js 16.1.6 Image Component documentation** -- WebFetch verified 2026-02-20. Confirmed: `preload` prop (replaces deprecated `priority`), `fill` prop, `placeholder="blur"`, `sizes`, `quality`, `qualities` config requirement.
- **Next.js 16.1.6 Image Optimization guide** -- WebFetch verified 2026-02-20. Confirmed: static import auto-generates blurDataURL, WebP/AVIF format support, responsive srcset generation.
- **Existing codebase analysis** -- direct file reads of all components, hooks, lib utilities, pages, providers, and config files.
- **Frontend decisions** -- `Docs/DECISIONS/frontend.md` (D1-D12): single scene, layered PNGs, 7 hotspots, trading terminal layout, CSS animations, desktop-first, hook-based state.
- **Frontend specification** -- `Docs/frontend-spec.md`: complete component inventory, hook inventory, planned scene/modal architecture, hotspot-to-modal mapping.
- **System architecture** -- `Docs/architecture.md`: on-chain architecture context, frontend role description.
- **WebsiteAssets** -- visual inspection of all 6 PNG files: MainBackground (12MB), CarnageCauldron (947KB), ConnectWallet (2.1MB), DocumentationTable (1.6MB), RewardsVat (1.8MB), Settings (1.1MB).
- **ConnectModal.tsx** -- existing modal pattern (backdrop, Escape key, click-outside) used as reference for ModalOverlay design.
- **Tailwind CSS v4 @theme** -- based on project's Tailwind 4.1.18 + `@tailwindcss/postcss` config. The `@theme` directive is a Tailwind v4 feature for defining design tokens as CSS custom properties that generate utility classes.
