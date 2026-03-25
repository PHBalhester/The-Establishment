# Technology Stack: Interactive Factory Scene, Animations, Onboarding & Mobile

**Project:** Dr. Fraudsworth's Finance Factory -- v1.0 Visual Design Layer
**Researched:** 2026-02-22
**Overall Confidence:** MEDIUM (web research tools unavailable; versions verified from installed node_modules and npm registry where accessible; animation library recommendations based on training data with version verification needed before install)

---

## Context

This STACK research covers ONLY the new capabilities needed for the v1.0 visual design layer. The existing validated stack is NOT re-researched:

| Existing (DO NOT CHANGE) | Version | Verified |
|---|---|---|
| Next.js | 16.1.6 | node_modules |
| React | 19.2.3 | package.json |
| Tailwind CSS | 4.1.18 | package.json |
| @tailwindcss/postcss | 4.1.18 | package.json |
| Turbopack | Bundled with Next.js 16 | next.config.ts |
| Privy v3 | 3.13.1 | package.json |
| lightweight-charts | 5.1.0 | package.json |
| sharp | 0.34.5 | node_modules (root) |

**Critical constraints carried forward:**
- ALL `@sentry/*` npm packages break Turbopack SSR. Any new package must NOT monkey-patch webpack/bundler internals.
- `fs`, `net`, `tls` are stubbed via Turbopack `resolveAlias` in next.config.ts.
- State management is React hooks only (Decision D12) -- no Redux, Zustand, or Context.
- CSP is strict: `img-src 'self' data: blob:`, `script-src 'self' 'unsafe-inline'`.

---

## What This Stack Must Enable

| Capability | Requirement |
|---|---|
| Interactive scene | Layered transparent PNGs over 13MB base background, clickable hotspots |
| Hover effects | Glow, brightness, outline on PNG overlay objects |
| Modal system | Backdrop blur, themed styling, open/close transitions, focus trap |
| Ambient animations | Steam particles, bubbling liquid, gear rotation, flickering lights |
| Modal transitions | Smooth open/close with scale/opacity |
| Onboarding tour | First-time guided walkthrough of factory hotspots |
| Mobile layout | Simplified navigation replacing scene, themed modal access |
| Image optimization | 13MB base PNG to sub-1MB delivery; overlay PNGs optimized |

---

## Recommendation: CSS-First with Minimal Libraries

**The core principle: Use CSS for everything possible, add JS animation only where CSS cannot reach.**

The factory scene is fundamentally a layout and interaction problem, not an animation problem. The existing codebase already uses Tailwind utility classes exclusively (zero custom CSS beyond `@import "tailwindcss"`). The scene should follow the same pattern.

### Why CSS-First

1. **Zero bundle cost.** CSS animations run on the compositor thread, cost zero JavaScript, and add zero to the bundle size.
2. **Turbopack safety.** CSS cannot break the bundler. Every JS library is a potential Turbopack compatibility risk (learned the hard way with Sentry).
3. **Consistency with existing stack.** The entire app uses Tailwind utilities. Adding Framer Motion or GSAP would create two parallel styling systems.
4. **Performance.** CSS `filter`, `transform`, and `@keyframes` animations are GPU-accelerated. Mid-range hardware handles them effortlessly.
5. **Decision D10 alignment.** Frontend decisions explicitly chose "pure CSS (animated pseudo-elements)" for ambient effects.

---

## Recommended Stack Additions

### 1. Image Optimization: Next.js Image + Build-Time Conversion

| Technology | Version | Purpose | Why |
|---|---|---|---|
| `next/image` | Bundled with Next.js 16.1.6 | Runtime image optimization, lazy loading, responsive srcset | Already installed. Zero cost to adopt. Handles WebP/AVIF conversion, quality control, lazy loading. The `<Image>` component is purpose-built for exactly this use case. |
| `sharp` | 0.34.5 (already in node_modules) | Server-side image processing for Next.js Image optimization | Already available as Next.js optional dependency. Next.js uses sharp for on-demand WebP/AVIF transcoding. No additional install needed. |
| Build-time conversion script | Custom (Node.js + sharp) | Pre-convert 13MB base PNG to optimized WebP at multiple resolutions | The 13MB base image should NOT be served through `next/image` runtime optimization on every request. Pre-convert once at build time to WebP/AVIF at target resolutions (1920px, 2560px, 3840px) and reference the pre-optimized files. |

**Image Optimization Strategy for the 13MB Base Scene:**

The 13MB PNG is the single largest performance concern. Here is the strategy:

```
Original: MainBackground.png (13MB, likely 4000-6000px wide)
    |
    v  (build-time sharp script)
    |
    +-- scene-bg-1920.webp  (~200-400KB at quality 80)
    +-- scene-bg-2560.webp  (~400-600KB at quality 80)
    +-- scene-bg-3840.webp  (~600-900KB at quality 80)
    +-- scene-bg-1920.avif  (~150-300KB at quality 70)
    +-- scene-bg-2560.avif  (~300-500KB at quality 70)
    +-- scene-bg-3840.avif  (~500-700KB at quality 70)
```

Why pre-convert instead of runtime:
- A 13MB PNG takes 2-5 seconds to transcode on the server. That is unacceptable latency on first page load.
- Pre-converted files can be served from CDN with aggressive cache headers.
- Railway does not have persistent disk -- each deploy would re-transcode without caching.
- The base image changes only when the designer delivers new art, not on every request.

**Implementation approach:**

```typescript
// scripts/optimize-images.ts (run at build time)
import sharp from 'sharp';

const SIZES = [1920, 2560, 3840];
const FORMATS = ['webp', 'avif'] as const;

for (const size of SIZES) {
  for (const format of FORMATS) {
    await sharp('assets/MainBackground.png')
      .resize(size, null, { fit: 'inside', withoutEnlargement: true })
      .toFormat(format, { quality: format === 'avif' ? 70 : 80 })
      .toFile(`public/scene/bg-${size}.${format}`);
  }
}
```

Then in the component:

```tsx
<picture>
  <source
    srcSet="/scene/bg-1920.avif 1920w, /scene/bg-2560.avif 2560w, /scene/bg-3840.avif 3840w"
    type="image/avif"
  />
  <source
    srcSet="/scene/bg-1920.webp 1920w, /scene/bg-2560.webp 2560w, /scene/bg-3840.webp 3840w"
    type="image/webp"
  />
  <img
    src="/scene/bg-1920.webp"
    alt="Dr. Fraudsworth's Finance Factory"
    className="w-full h-full object-cover"
    loading="eager"
    fetchPriority="high"
  />
</picture>
```

**For overlay PNGs (transparent, smaller):**

Use `next/image` with runtime optimization. Overlay PNGs are likely 50-500KB each (7 objects). At these sizes, runtime transcoding is fast and the transparency alpha channel needs careful handling (WebP supports transparency; AVIF supports transparency).

```tsx
import Image from 'next/image';

<Image
  src="/scene/overlays/cauldron.png"
  alt="Carnage Cauldron"
  width={400}
  height={300}
  quality={85}
  className="absolute left-[X%] top-[Y%] cursor-pointer transition-all duration-300
             hover:brightness-125 hover:drop-shadow-[0_0_15px_rgba(34,197,94,0.6)]"
/>
```

**Confidence: HIGH** for the strategy. Sharp 0.34.5 is verified installed. Next.js Image component is stable and well-documented. WebP/AVIF support confirmed in installed Next.js image-optimizer source code.

**next.config.ts changes needed:**

```typescript
// Add to nextConfig:
images: {
  formats: ['image/avif', 'image/webp'],
  // Overlay PNGs are local, no remote patterns needed
  deviceSizes: [1920, 2560, 3840],
  imageSizes: [200, 400, 600, 800],
}
```

---

### 2. Hover Effects & Hotspot Interaction: CSS-Only

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Tailwind CSS utilities | 4.1.18 (already installed) | Hover glow, brightness, outline effects | `hover:brightness-125`, `hover:drop-shadow-[...]`, `transition-all`, `duration-300` cover 100% of hover effect needs. Zero additions required. |
| CSS `filter` property | Native CSS | Brightness, contrast, saturation adjustments | `brightness()`, `drop-shadow()`, `contrast()` are GPU-accelerated. Perfect for hover glow effects on transparent PNGs. |
| CSS `mix-blend-mode` | Native CSS | Highlight overlay effects | Can create colored glow overlays without additional elements. |

**Why no library needed:**

The hover effects described (glow, brightness, outline) are achievable with three CSS properties:

```css
/* Glow on hover */
.hotspot:hover {
  filter: brightness(1.25) drop-shadow(0 0 20px rgba(34, 197, 94, 0.6));
  transform: scale(1.02);
}

/* Transition for smooth effect */
.hotspot {
  transition: filter 0.3s ease, transform 0.3s ease;
}
```

In Tailwind:
```tsx
className="transition-all duration-300 cursor-pointer
           hover:brightness-125 hover:scale-[1.02]
           hover:drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]"
```

The `drop-shadow` filter (NOT `box-shadow`) is critical for transparent PNGs -- it follows the alpha contour of the image, creating a glow effect that outlines the actual object shape rather than the rectangular bounding box.

**Confidence: HIGH** -- CSS filter properties are universally supported and GPU-accelerated. This is exactly how game-like UIs in the browser handle overlay highlighting.

---

### 3. Modal System: Custom Implementation (No Library)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Custom `ModalOverlay` component | N/A (project code) | Reusable modal wrapper with backdrop, transitions, focus trap | The project already has a working modal pattern in `ConnectModal.tsx`. Extract and generalize it. No library needed. |
| CSS transitions | Native | Modal open/close animations (scale + opacity) | Tailwind `transition-all duration-300` + conditional classes. |
| `aria-*` attributes | Native HTML | Accessibility: focus trap, screen reader | Manual implementation per frontend-spec planned improvements. |

**Why NOT a modal library (Radix Dialog, Headless UI, etc.):**

1. **ConnectModal.tsx already works.** It has backdrop blur (`backdrop-blur-sm`), click-outside-to-close, Escape key handling, and `aria-label`. This pattern is 90% of what is needed.
2. **Turbopack risk.** Radix UI and Headless UI are React component libraries that may have internal build assumptions. Given the Sentry experience, avoiding unnecessary third-party React components near the render tree is wise.
3. **Focus trap is ~30 lines of code.** A utility function that cycles Tab focus within a modal container. Not worth a dependency.
4. **Bundle size.** `@radix-ui/react-dialog` is ~15KB. Custom modal is ~2KB.

**What to extract from ConnectModal.tsx and generalize:**

```tsx
// components/scene/ModalOverlay.tsx
interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string; // 'max-w-md' | 'max-w-2xl' | 'max-w-5xl'
}
```

Features to add beyond ConnectModal:
- **Enter/exit transitions:** `opacity-0 scale-95` -> `opacity-100 scale-100` with `transition-all duration-200`
- **Focus trap:** Tab cycling within modal, return focus to trigger on close
- **Body scroll lock:** `document.body.style.overflow = 'hidden'` when modal opens
- **ARIA:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- **Multiple sizes:** Trading Terminal needs `max-w-5xl`, Settings needs `max-w-md`

**Confidence: HIGH** -- The modal pattern is proven in the codebase. Extraction + enhancement is straightforward.

---

### 4. Ambient Animations: CSS @keyframes (Zero Dependencies)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| CSS `@keyframes` | Native | Steam particles, bubbling liquid, gear rotation, flickering lights | Decision D10 explicitly specifies "pure CSS". CSS animations run on compositor thread (zero main-thread cost), are GPU-accelerated, and respect `prefers-reduced-motion`. |
| Tailwind `@theme` / custom utilities | 4.1.18 | Define animation keyframes within Tailwind ecosystem | Tailwind v4 supports `@keyframes` definitions in the global CSS file, referenced via `animation-*` utilities. |

**Animation Implementations:**

**a) Steam Particles:**
```css
@keyframes steam-rise {
  0% { transform: translateY(0) scale(0.8); opacity: 0.6; }
  50% { transform: translateY(-40px) scale(1.2); opacity: 0.3; }
  100% { transform: translateY(-80px) scale(1.5); opacity: 0; }
}
```
Small absolutely-positioned `div` elements (or `::before`/`::after` pseudo-elements) with `border-radius: 50%`, `background: rgba(255,255,255,0.2)`, staggered via `animation-delay`. 3-5 particles per steam source.

**b) Bubbling Liquid (Cauldron):**
```css
@keyframes bubble-rise {
  0% { transform: translateY(0) scale(0.5); opacity: 0.8; }
  100% { transform: translateY(-60px) scale(1); opacity: 0; }
}
```
Green-tinted circular elements (`bg-green-400/30`) rising from the cauldron. Multiple particles with staggered delays create continuous bubbling.

**c) Gear Rotation (Settings):**
```css
@keyframes gear-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```
Continuous slow rotation (`animation: gear-spin 12s linear infinite`). Trivial CSS.

**d) Flickering Lights:**
```css
@keyframes flicker {
  0%, 100% { opacity: 1; }
  10% { opacity: 0.85; }
  20% { opacity: 0.95; }
  40% { opacity: 0.7; }
  60% { opacity: 0.9; }
  80% { opacity: 0.75; }
}
```
Applied to light source overlays. Irregular opacity changes simulate gas lamp flicker. Add `filter: brightness()` variation for extra realism.

**Integration with Tailwind v4:**

In `globals.css`:
```css
@import "tailwindcss";

@keyframes steam-rise { /* ... */ }
@keyframes bubble-rise { /* ... */ }
@keyframes gear-spin { /* ... */ }
@keyframes flicker { /* ... */ }
```

Then reference in components via inline `style` or Tailwind arbitrary values:
```tsx
<div className="animate-[steam-rise_3s_ease-in-out_infinite]" />
<div className="animate-[gear-spin_12s_linear_infinite]" />
```

**Accessibility (`prefers-reduced-motion`):**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Why NOT Framer Motion:**

Framer Motion (latest ~11.x based on training data) is an excellent library, but it is wrong for this project:

1. **Bundle size:** Framer Motion is ~30-50KB gzipped (core). That is larger than the entire custom animation CSS will be (~2KB).
2. **Turbopack risk:** Framer Motion has had known compatibility issues with Next.js bundlers in the past. While it likely works with Next.js 16, this cannot be verified with web tools unavailable. Given the Sentry disaster, avoiding unverifiable dependencies is prudent.
3. **Not needed for these effects:** Steam particles, bubbling, gear rotation, and flickering are all repeating `@keyframes` animations. Framer Motion's value is in orchestrated enter/exit animations, spring physics, and gesture handling. None of those are needed here.
4. **Decision D10 compliance:** The frontend decisions explicitly chose "pure CSS" and "no JavaScript animation libraries."

**When Framer Motion WOULD be justified (future, not v1.0):**
- Complex modal enter/exit with shared layout animations
- Drag-and-drop interactions
- Spring-based physics (e.g., pull-to-refresh)
- AnimatePresence for component mount/unmount transitions

**Why NOT GSAP:**

GSAP is overkill. It is a full animation timeline engine designed for complex sequenced animations (advertising, landing pages, data visualizations). It adds ~25KB gzipped and uses imperative DOM manipulation that conflicts with React's declarative model. GSAP's React integration (`@gsap/react`) uses `useGSAP()` hooks that create refs and imperatively animate DOM nodes -- this is fragile in a React 19 Server Components environment and provides no benefit over CSS for repetitive ambient effects.

**Confidence: HIGH** for CSS-only approach. The animations described are textbook CSS keyframe use cases. No library provides meaningful value over native CSS for this specific set of effects.

---

### 5. Modal Transitions: CSS Transitions (No Library)

| Technology | Version | Purpose | Why |
|---|---|---|---|
| CSS `transition` | Native | Smooth modal open/close | Tailwind `transition-all duration-200 ease-out` |
| Conditional Tailwind classes | N/A | Toggle transition states | `isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95'` |

**Pattern:**

```tsx
// Two-phase rendering: mount -> animate in, animate out -> unmount
const [isMounted, setIsMounted] = useState(false);
const [isVisible, setIsVisible] = useState(false);

// Open: mount first, then animate
useEffect(() => {
  if (isOpen) {
    setIsMounted(true);
    requestAnimationFrame(() => setIsVisible(true));
  } else {
    setIsVisible(false);
    const timer = setTimeout(() => setIsMounted(false), 200); // match duration
    return () => clearTimeout(timer);
  }
}, [isOpen]);

if (!isMounted) return null;

return (
  <div className={`fixed inset-0 z-50 transition-opacity duration-200
    ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
    <div className={`... transition-all duration-200 ease-out
      ${isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
      {children}
    </div>
  </div>
);
```

This is where Framer Motion's `AnimatePresence` provides cleaner DX. However, the 15-line manual implementation above achieves the same visual result with zero bundle cost. If the team finds the manual mount/unmount management tedious across 6 modals, revisit Framer Motion at that point.

**Confidence: HIGH** -- This pattern is well-established in React applications using Tailwind CSS.

---

### 6. Onboarding / Guided Tour: Custom Implementation

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Custom `OnboardingOverlay` component | N/A (project code) | First-time guided tour of factory hotspots | See rationale below. |
| `localStorage` | Native browser API | Persist "tour completed" flag | Simple, no backend needed. |

**Why NOT react-joyride:**

`react-joyride` (latest ~2.9.x based on training data) is the most popular React tour library. However:

1. **DOM dependency:** react-joyride targets elements via CSS selectors or refs. The factory scene uses absolutely-positioned images -- joyride's spotlight/highlight mechanism assumes standard DOM layout and struggles with overlapping absolute-positioned elements.
2. **Styling conflicts:** Joyride injects its own tooltip DOM and styles. Matching it to the steampunk theme requires extensive custom styling that negates the library's value.
3. **Bundle size:** ~40-50KB gzipped including its dependency on `react-floater` and `popper.js`.
4. **Turbopack compatibility:** Unknown. Cannot verify without web tools.
5. **React 19 compatibility:** Unknown for latest version. react-joyride has historically lagged behind React major versions.

**Why NOT shepherd.js:**

Shepherd.js has similar issues -- it manages its own DOM overlay and positioning system. The factory scene's custom positioning system would conflict with Shepherd's positioning logic.

**What to build instead:**

The onboarding tour for the factory scene is structurally simple:

1. Highlight one hotspot at a time (dim everything else)
2. Show a tooltip near the highlighted hotspot explaining what it does
3. "Next" / "Skip" buttons
4. 5-7 steps total (one per hotspot)
5. Store completion in localStorage

This is a controlled sequence of overlay states -- not a complex DOM traversal problem. A custom component handles this naturally:

```tsx
// components/scene/OnboardingOverlay.tsx
interface OnboardingStep {
  hotspotId: string;
  title: string;
  description: string;
  position: { x: string; y: string }; // tooltip position
}

const TOUR_STEPS: OnboardingStep[] = [
  { hotspotId: 'connect-wallet', title: 'Connect Your Wallet',
    description: 'Click the sign to connect...', position: { x: '70%', y: '15%' } },
  { hotspotId: 'swap-machine', title: 'The Trading Machine',
    description: 'This is where you swap tokens...', position: { x: '50%', y: '40%' } },
  // ... 5 more steps
];
```

The overlay dims the entire scene except the highlighted hotspot (using CSS `mix-blend-mode` or a clipped overlay `div`), positions a themed tooltip near the hotspot, and advances through steps.

**Spotlight implementation approach:**

```tsx
// Dim everything, punch a hole at the highlighted hotspot
<div className="fixed inset-0 z-60 pointer-events-none">
  {/* Semi-transparent overlay with a clipped-out region */}
  <div
    className="absolute inset-0 bg-black/70 transition-all duration-500"
    style={{
      clipPath: `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%,
        0% ${spotY}%, ${spotX}% ${spotY}%,
        ${spotX}% ${spotY + spotH}%,
        0% ${spotY + spotH}%
      )`
    }}
  />
  {/* Themed tooltip */}
  <div className="absolute pointer-events-auto" style={{ left: tooltipX, top: tooltipY }}>
    <div className="bg-zinc-900 border border-amber-600/50 rounded-lg p-4 max-w-xs shadow-xl">
      <h3 className="text-amber-400 font-semibold">{step.title}</h3>
      <p className="text-zinc-300 text-sm mt-1">{step.description}</p>
      <div className="flex gap-2 mt-3">
        <button onClick={skip} className="text-zinc-500 text-sm">Skip Tour</button>
        <button onClick={next} className="bg-amber-600 text-white text-sm px-3 py-1 rounded">Next</button>
      </div>
    </div>
  </div>
</div>
```

**Total estimated code:** ~150-200 lines. Much simpler than configuring react-joyride to work with absolute-positioned PNG layers.

**Confidence: MEDIUM** -- The approach is sound but implementation details (tooltip positioning, spotlight clipping) need iteration during build. The fallback is to use a simpler approach: just show a tooltip sequence without spotlight dimming.

---

### 7. Mobile Layout: CSS Media Queries + Conditional Rendering

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Tailwind responsive prefixes | 4.1.18 (already installed) | `md:` / `lg:` breakpoint-based layout switching | Already used in existing dashboard. No additions needed. |
| CSS `@media` | Native | Detect viewport width for scene vs. navigation swap | Standard responsive design. |

**Mobile Strategy (Decision D9 + milestone requirements):**

The interactive factory scene is desktop-only (landscape, minimum ~1024px). Mobile gets a themed navigation layout that opens the same modals.

```tsx
// components/scene/FactoryScene.tsx
export function FactoryScene() {
  return (
    <>
      {/* Desktop: Full interactive scene */}
      <div className="hidden lg:block relative w-full h-screen">
        {/* Background + overlays + hotspots */}
      </div>

      {/* Mobile/Tablet: Themed navigation grid */}
      <div className="lg:hidden">
        <MobileNavigation />
      </div>
    </>
  );
}
```

**`MobileNavigation` concept:**

A steampunk-themed vertical navigation with cards/buttons for each hotspot. Uses the same modal system -- tapping a card opens the same modal that clicking a hotspot would on desktop.

```tsx
// components/scene/MobileNavigation.tsx
const NAV_ITEMS = [
  { id: 'trade', label: 'Trading Machine', icon: '...', modal: 'trading-terminal' },
  { id: 'stake', label: 'PROFIT Yield Tube', icon: '...', modal: 'staking' },
  { id: 'carnage', label: 'Carnage Cauldron', icon: '...', modal: 'carnage' },
  // ...
];
```

No additional libraries needed. The existing Tailwind responsive utilities handle the breakpoint logic.

**Confidence: HIGH** -- This is standard responsive design pattern. The modals are already independent components that work at any viewport width.

---

## Summary: What to Install

### New npm Dependencies: NONE

That's right -- **zero new npm packages** for the v1.0 visual design layer.

Everything needed is already available:

| Capability | Technology | Status |
|---|---|---|
| Image optimization | `next/image` + `sharp` | Already installed (Next.js 16.1.6 + sharp 0.34.5) |
| Hover effects | CSS `filter` + Tailwind utilities | Already installed (Tailwind 4.1.18) |
| Modal system | Custom component (extend ConnectModal pattern) | Codebase pattern exists |
| Ambient animations | CSS `@keyframes` + Tailwind arbitrary values | Already installed |
| Modal transitions | CSS `transition` + Tailwind utilities | Already installed |
| Onboarding tour | Custom component + localStorage | Native browser APIs |
| Mobile layout | Tailwind responsive utilities | Already installed |
| Build-time image conversion | Node.js script using `sharp` | sharp already in node_modules |

### New Development Dependencies: NONE

### New Configuration Changes

| File | Change |
|---|---|
| `app/next.config.ts` | Add `images: { formats: ['image/avif', 'image/webp'], deviceSizes: [...] }` |
| `app/app/globals.css` | Add `@keyframes` definitions for steam, bubbles, gear, flicker + `prefers-reduced-motion` media query |
| `app/package.json` | Add `"optimize-images"` script entry |

---

## What NOT to Add (and Why)

| Technology | Why NOT |
|---|---|
| **Framer Motion** | Decision D10 specifies CSS-only. ~30-50KB bundle. Turbopack compatibility unverified. Provides orchestrated animations we do not need (ambient effects are simple loops). Revisit only if complex enter/exit animations prove unmanageable in CSS. |
| **GSAP** | ~25KB bundle. Imperative DOM manipulation conflicts with React's declarative model. Designed for timeline-based animations (advertising), not ambient effects. React 19 Server Components compatibility uncertain. |
| **Lottie / lottie-react** | Requires After Effects animation files (`.json`). The art direction is hand-painted PNGs, not vector animations. Wrong tool for the art style. |
| **react-joyride** | ~40-50KB. DOM-selector targeting conflicts with absolute-positioned PNG scene layout. Extensive custom styling needed to match steampunk theme. React 19 compatibility unverified. |
| **shepherd.js** | Similar DOM overlay conflicts. Not React-native (has React wrapper). Additional complexity for a simple 5-7 step tour. |
| **@radix-ui/react-dialog** | ~15KB for something ConnectModal.tsx already demonstrates in ~150 lines. Focus trap is ~30 lines of custom code. Turbopack compatibility risk. |
| **Headless UI** | Similar to Radix -- adds dependency for minimal gain. The project has a working modal pattern. |
| **react-spring** | Spring physics library. No spring-based animations needed in the factory scene. |
| **anime.js** | Another JS animation library. CSS handles all needed animations. |
| **Canvas / WebGL (Three.js, PixiJS, Phaser)** | Massive overkill. The scene is layered images with hover effects, not a game engine scene. Canvas kills accessibility. ~100-500KB bundles. |
| **ImageMagick / external image tools** | sharp (already installed) handles all image conversion needs. No external tools required. |
| **Cloudinary / Imgix** | External image CDN services. Unnecessary complexity and cost when build-time conversion + Railway CDN is sufficient. The images are static assets, not user-uploaded content. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|---|---|---|---|
| Animations | CSS @keyframes | Framer Motion | Decision D10; bundle size; Turbopack risk; CSS handles all needed effects |
| Animations | CSS @keyframes | GSAP | Imperative DOM conflicts with React; overkill for ambient loops |
| Image optimization | Build-time sharp + next/image | Runtime-only next/image | 13MB PNG is too large for on-demand server-side transcoding |
| Image optimization | Build-time sharp + next/image | Cloudinary | External dependency; cost; unnecessary for static assets |
| Modal system | Custom (extend ConnectModal) | Radix Dialog | Existing pattern works; 15KB savings; zero Turbopack risk |
| Onboarding | Custom overlay component | react-joyride | DOM targeting incompatible with absolute-positioned scene; React 19 unverified |
| Onboarding | Custom overlay component | shepherd.js | Not React-native; overlay system conflicts |
| Mobile | Tailwind responsive + conditional render | react-responsive | Tailwind responsive prefixes already handle breakpoints; library adds nothing |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| CSS animations insufficient for desired visual quality | LOW | CSS @keyframes + filter + transform cover steam, bubbles, rotation, flicker comprehensively. If a specific effect proves impossible in CSS, add Framer Motion for that ONE component only. |
| 13MB PNG causes slow first paint even after optimization | MEDIUM | Pre-convert to WebP/AVIF (10-20x compression). Add `loading="eager"` + `fetchPriority="high"` for base image. Consider low-res placeholder with blur-up effect. |
| Custom onboarding tour has positioning bugs | LOW | Start with a simpler approach (tooltip-only, no spotlight) and iterate. The factory scene positions are controlled by the developer, not dynamic DOM layout. |
| Modal focus trap has accessibility gaps | MEDIUM | Test with screen readers early. The pattern is well-documented (WAI-ARIA Dialog pattern). If implementation proves complex, `@radix-ui/react-dialog` is the fallback (with Turbopack testing). |
| Custom image optimization script needs maintenance | LOW | The script runs once per art delivery. It is ~20 lines of sharp API calls. Maintenance burden is negligible. |
| Framer Motion needed later for complex transitions | LOW | The CSS transition pattern (Section 5) can be replaced with Framer Motion for individual modals without rewriting the rest. The architecture is not locked into CSS-only permanently. |

---

## Implementation Order for Roadmap

Based on dependencies:

1. **Image optimization pipeline** (build-time sharp script + next.config.ts image config)
   - Blocks: Scene background rendering
   - Independent of other work

2. **Modal system extraction** (generalize ConnectModal pattern into ModalOverlay)
   - Blocks: All hotspot interactions
   - Depends on: Nothing new (extends existing code)

3. **Scene layout** (background + absolute-positioned overlays with hover effects)
   - Blocks: Hotspot interactions, animations
   - Depends on: Image optimization (optimized assets), Modal system

4. **Hotspot interactivity** (click handlers opening modals)
   - Depends on: Scene layout, Modal system

5. **Ambient animations** (CSS @keyframes for steam, bubbles, gears, flicker)
   - Depends on: Scene layout (needs to know where to position animation elements)
   - Can be iterated independently

6. **Mobile layout** (conditional rendering with themed navigation)
   - Independent of scene implementation
   - Can parallelize with scene work

7. **Onboarding tour** (custom overlay component)
   - Depends on: Scene layout, Hotspot interactivity (needs all hotspots in place)
   - Should be last -- needs the complete scene to tour through

---

## Version Verification Checklist

No new packages to verify. The following existing packages should be confirmed working:

```bash
export PATH="/opt/homebrew/bin:$PATH"

# Verify sharp is accessible for build scripts
node -e "const sharp = require('sharp'); console.log('sharp', sharp.versions)"

# Verify next/image is available
node -e "console.log(require('next/package.json').version)"

# Verify Tailwind v4 supports @keyframes in globals.css
# (Manual check: add a test @keyframes block to globals.css, run dev, confirm it compiles)
```

---

## Compatibility Matrix

| Feature | Next.js 16.1.6 | Turbopack | React 19.2.3 | Tailwind 4.1.18 | Notes |
|---|---|---|---|---|---|
| `next/image` | Native | Supported | N/A (server) | N/A | Image optimization is server-side |
| CSS @keyframes | N/A | N/A | N/A | Supported | Define in globals.css, reference with arbitrary values |
| CSS filter/transform | N/A | N/A | N/A | Supported | `hover:brightness-125`, `hover:drop-shadow-[...]` |
| CSS transition | N/A | N/A | N/A | Supported | `transition-all duration-200` |
| `<picture>` element | N/A | N/A | Supported | N/A | Standard HTML, works everywhere |
| Custom modal component | N/A | No risk | Supported | Styled with | Extends existing ConnectModal pattern |
| localStorage | N/A | N/A | N/A | N/A | Browser API, works in `"use client"` components |
| prefers-reduced-motion | N/A | N/A | N/A | Supported | `@media (prefers-reduced-motion: reduce)` in CSS |

**No compatibility risks identified.** All recommended technologies are either native browser APIs, already-installed packages, or CSS features.

---

## Sources

| Source | Confidence | What It Informed |
|---|---|---|
| `app/package.json` (installed packages) | HIGH | Confirmed Next.js 16.1.6, React 19.2.3, Tailwind 4.1.18 |
| `app/next.config.ts` (project code) | HIGH | Turbopack config, resolveAlias stubs, CSP policy |
| `node_modules/next/dist/server/image-optimizer.js` | HIGH | Confirmed WebP + AVIF support, quality parameter, sharp integration |
| `node_modules/sharp/package.json` (v0.34.5) | HIGH | Sharp already available for build-time image conversion |
| `app/components/wallet/ConnectModal.tsx` | HIGH | Existing modal pattern: backdrop blur, escape key, click-outside |
| `app/app/globals.css` | HIGH | Current CSS is minimal (`@import "tailwindcss"` only) -- room for @keyframes |
| `Docs/DECISIONS/frontend.md` (Decision D10) | HIGH | CSS-only animations, no JS libraries |
| `Docs/DECISIONS/frontend.md` (Decision D12) | HIGH | No state management libraries (hooks only) |
| `Docs/DECISIONS/frontend.md` (Decision D2) | HIGH | Layered PNG implementation approach |
| `Docs/frontend-spec.md` | HIGH | Planned component architecture, hotspot mapping, accessibility requirements |
| MEMORY.md (Sentry + Turbopack) | HIGH | Critical constraint: no packages that break Turbopack SSR |
| Training data: Framer Motion, GSAP, react-joyride, shepherd.js | LOW | Library capabilities and bundle sizes. Versions may be stale. |
| Training data: CSS animation performance | MEDIUM | GPU acceleration of transforms, filters, opacity. Well-established knowledge. |
| Training data: Next.js Image component | MEDIUM | API shape and configuration. Verified against installed source code. |

---

## Summary for Roadmap

**The v1.0 visual design layer requires ZERO new npm dependencies.** This is the key finding.

Everything needed -- image optimization, hover effects, modal system, ambient animations, transitions, onboarding, and mobile layout -- is achievable with already-installed technology (Next.js `<Image>`, sharp, Tailwind CSS, CSS @keyframes) plus custom components extending existing patterns (ConnectModal.tsx).

**Key decisions:**
1. **CSS-only animations** -- per Decision D10. Zero bundle cost, GPU-accelerated, `prefers-reduced-motion` compliant.
2. **Build-time image conversion** -- 13MB PNG converted to WebP/AVIF at build time via sharp script. Runtime `next/image` for smaller overlays.
3. **Custom modal system** -- Extract and generalize ConnectModal.tsx pattern. No dialog library needed.
4. **Custom onboarding tour** -- ~150-200 lines of custom code beats a 40-50KB library that fights the absolute-positioned scene layout.
5. **Zero Turbopack risk** -- No new packages means no new bundler compatibility surprises.

**The only work is writing components and CSS, not integrating libraries.** This de-risks the entire milestone.
