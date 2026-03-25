# Domain Pitfalls: Interactive Factory Scene UI

**Domain:** Adding interactive scene-based UI, heavy image assets, and ambient animations to an existing functional Next.js 16 DeFi frontend
**Researched:** 2026-02-22
**Overall Confidence:** HIGH (grounded in codebase analysis + official Next.js 16.1.6 docs + established web performance principles)

---

## Critical Pitfalls

Mistakes that cause regressions, broken functionality, or require significant rework.

---

### CRIT-01: 13MB PNG Background Destroys Mobile and Low-Bandwidth Load Times

**What goes wrong:** A 13MB uncompressed PNG served as the full-screen factory background causes 5-15 second load times on 3G/4G connections. Users on mobile or throttled connections see a blank white/black screen while the image downloads. First Contentful Paint and Largest Contentful Paint metrics tank. Users abandon the page before ever seeing the factory.

**Why it happens:** Developers test on localhost or fast office WiFi where 13MB loads in under a second. The PNG format preserves every pixel perfectly, which feels "right" for commissioned art but is catastrophic for web delivery.

**Consequences:**
- LCP exceeds 4 seconds (Google's "poor" threshold is 2.5s)
- Mobile users on cellular data consume ~13MB just for the background
- Railway hosting bandwidth costs increase linearly with user count
- Users may assume the site is broken and leave
- The existing functional DeFi features (swaps, staking, charts) are blocked behind this download

**Prevention:**
1. **Convert to WebP or AVIF before serving.** WebP typically achieves 25-35% smaller files than PNG for photographic/illustrated content. AVIF achieves 50%+ compression over PNG. A 13MB PNG could become 3-5MB WebP or 2-3MB AVIF.
2. **Use Next.js Image component with `fill` and `sizes`.** The `<Image>` component (verified in Next.js 16.1.6 docs) auto-serves WebP, generates responsive srcsets, and lazy-loads by default. For the background, use `fill` with `sizes="100vw"` and `loading="eager"` (since it IS the main content).
3. **Generate a low-quality blurDataURL placeholder.** A 10-pixel-wide blurred version (~500 bytes as base64) shows immediately while the full image loads. Use `placeholder="blur"` with a manually generated `blurDataURL`.
4. **Serve pre-compressed files at multiple resolutions.** Generate 1920w, 2560w, and 3840w variants. The `<Image>` component's `deviceSizes` config (default: `[640, 750, 828, 1080, 1200, 1920, 2048, 3840]`) handles this automatically.
5. **Consider splitting the background into tiles** if the full-resolution image exceeds 5MB even after compression. Load the viewport-visible portion first, then fill in off-screen areas.
6. **Set `quality` to 80-85** for the background image. At full-screen size, the difference between quality 85 and 100 is imperceptible but the file size difference is substantial.

**Warning signs:** Load time exceeding 3 seconds on a simulated "Fast 3G" in Chrome DevTools. Check Network tab sorted by size -- if any single asset exceeds 2MB, it needs optimization.

**Detection:** Lighthouse audit, Network tab in Chrome DevTools with "Fast 3G" throttling enabled. Target: background image under 2MB delivered.

**Phase:** Must be addressed in the very first phase of scene implementation. Do NOT start with raw PNGs and "optimize later."

**Severity:** CRITICAL

---

### CRIT-02: Overlay PNGs Without Transparent Region Optimization Cause Massive GPU Memory Usage

**What goes wrong:** Each overlay PNG (5-6 layers for individual clickable objects) is rendered as a full-viewport-size image with transparent pixels. The GPU must allocate a texture for each layer at screen resolution. On a 4K display, a single RGBA layer is 4096 x 2160 x 4 bytes = ~33MB of GPU memory. Six layers = ~200MB of GPU memory just for mostly-transparent images.

**Why it happens:** The artist provides overlay PNGs at full scene dimensions (matching the background) with transparency everywhere except the object itself. This is convenient for Photoshop alignment but terrible for web rendering.

**Consequences:**
- GPU memory exhaustion on integrated graphics (common in laptops)
- Browser tab crashes on mobile devices with limited GPU memory (typically 256-512MB total)
- Compositing becomes expensive -- every frame must blend 6+ layers
- Scrolling, modal transitions, and hover effects stutter or drop frames
- Existing WebSocket connections for pool price updates may be disrupted if tab crashes

**Prevention:**
1. **Crop each overlay to its bounding box.** If the cauldron occupies only 400x300 pixels in the bottom-right of a 1920x1080 scene, serve a 400x300 PNG and position it with CSS `position: absolute; bottom: Xpx; right: Xpx`. This reduces GPU texture memory by 90%+ per layer.
2. **Use CSS `contain: layout style` on the overlay container.** This tells the browser each overlay is independent and prevents the entire scene from being re-painted when one layer changes.
3. **Convert overlay PNGs to WebP with alpha.** WebP supports transparency and compresses much better than PNG for photographic content.
4. **Lazy-load overlays that are not immediately visible** (e.g., objects that require scrolling or are at scene edges). Use the `<Image>` component's default `loading="lazy"`.
5. **Test on target hardware.** Open Chrome DevTools > Rendering > Layer borders to visualize how many GPU layers are being created. Each green/yellow border is a separate texture.

**Warning signs:** Chrome DevTools "Layers" panel shows 10+ compositing layers. `Performance.memory` API shows GPU process exceeding 500MB. Fan noise increases on laptop when factory scene is visible.

**Detection:** Chrome DevTools > Performance tab > Record while scrolling/hovering. Look for "Composite Layers" taking >4ms per frame. Chrome `chrome://gpu/` page shows GPU memory usage.

**Phase:** Must be addressed when preparing art assets, before any code touches them. This is an asset pipeline decision, not a code decision.

**Severity:** CRITICAL

---

### CRIT-03: Breaking Existing DeFi Functionality During Re-parenting

**What goes wrong:** Moving working components (SwapForm, StakingForm, CandlestickChart, etc.) from their current page-level containers into modal wrappers subtly breaks them. WebSocket subscriptions drop, Anchor program connections fail to initialize, polling intervals reset on every modal open/close, or the TradingView chart fails to resize within its new modal container.

**Why it happens:** The existing components were built and tested as page-level components. They have implicit assumptions:
- `DashboardGrid` and `SwapForm` are hook orchestrators that mount once and stay mounted. Modals mount/unmount components on open/close.
- `CandlestickChart` uses `ResizeObserver` on its parent container. A modal's opening animation may report zero dimensions initially.
- WebSocket subscriptions in `usePoolPrices` and `useCarnageData` use `connection.onAccountChange()` with cleanup on unmount. Frequent mount/unmount cycles cause subscription churn.
- `useChartSSE` manages an `EventSource` with exponential backoff. Mount/unmount resets the backoff state.

**Consequences:**
- Stale prices shown in swap UI (WebSocket dropped and not reconnected)
- Chart renders blank inside modal (ResizeObserver fires with width=0 during animation)
- Doubled RPC calls (subscriptions created twice during animation open/close cycle)
- Transaction failures if hook state is lost between modal sessions
- Loss of user trust in a DeFi product where stale data = financial risk

**Prevention:**
1. **Keep hook orchestrators mounted at all times.** Use CSS `display: none` / `visibility: hidden` or render modals in a "always present but hidden" pattern rather than conditional rendering (`{isOpen && <Modal>}`). This prevents subscription churn.
2. **Alternatively, lift hook state to a scene-level orchestrator.** A single `FactoryScene` component calls all data hooks once and passes data down to modals via props. Modals become purely presentational -- they can mount/unmount freely because they have no data-fetching responsibilities.
3. **Delay ResizeObserver-dependent components.** Wait for the modal open animation to complete before initializing the chart. Use `onTransitionEnd` or a brief `setTimeout` (matching animation duration) before calling `chart.resize()`.
4. **Test each component in isolation inside a modal wrapper BEFORE integrating into the scene.** Create a test route `/dev/modal-test` that wraps each existing component in a basic modal and exercises open/close cycles.
5. **Preserve the existing `/` and `/swap` routes as-is** (already planned per Decision D8). These are your regression baselines. If the modals break, you can verify the raw components still work.

**Warning signs:** Console errors about "Cannot read property of null" or "Subscription already closed" when opening modals. Chart renders at zero width then snaps to correct size. Balance displays show stale values after reopening a modal.

**Detection:** Open modal, close it, open it again 5 times rapidly. Check console for errors. Compare displayed prices in modal vs. a direct RPC query.

**Phase:** This is the highest-risk phase. Address it immediately after image asset preparation, before any visual polish.

**Severity:** CRITICAL

---

### CRIT-04: CSP Violations from New Asset Domains or Inline Styles

**What goes wrong:** The existing Content Security Policy in `next.config.ts` is strict (verified in codebase). Adding images from a CDN, loading web fonts for steampunk typography, or using CSS-in-JS for animation libraries triggers CSP violations that silently block resources. The page appears broken with missing images/fonts but no visible error unless DevTools console is open.

**Why it happens:** The current CSP is:
- `img-src 'self' data: blob:` -- images MUST be same-origin or data URIs
- `font-src 'self'` -- fonts MUST be same-origin
- `style-src 'self' 'unsafe-inline'` -- styles are OK (Tailwind uses inline)
- `script-src 'self' 'unsafe-inline'` -- scripts are OK
- `connect-src` has specific whitelist for RPC, Privy, Sentry, CoinGecko

If steampunk fonts are loaded from Google Fonts (fonts.googleapis.com + fonts.gstatic.com), they'll be blocked. If scene images move to a CDN (Cloudflare R2, Vercel Blob, etc.), they'll be blocked. If an animation library injects `<style>` tags with nonces, it might conflict.

**Consequences:**
- Fonts don't load, falling back to system fonts (breaks the steampunk aesthetic)
- CDN-hosted images show as broken image icons
- No visible error to the user -- just missing content
- Difficult to debug because CSP violations only appear in browser console, not in Next.js error overlay

**Prevention:**
1. **Audit the CSP before adding any external resources.** The CSP lives at `/Users/mlbob/Projects/Dr Fraudsworth/app/next.config.ts` lines 7-23.
2. **If using a CDN for assets, add the CDN hostname to `img-src`.** Example: `img-src 'self' data: blob: https://your-cdn.example.com`
3. **If adding Google Fonts, add both domains:** `font-src 'self' https://fonts.gstatic.com` and `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
4. **Self-host fonts instead.** Download the font files, place in `public/fonts/`, load via `@font-face` in CSS. This avoids CSP changes entirely and eliminates an external dependency. Recommended approach for a DeFi app where minimizing external dependencies improves security.
5. **Test in production mode** (not just dev). CSP headers are only applied via `next.config.ts` headers function, which may behave differently between dev and production builds.

**Warning signs:** Resources that work in development but fail in production. Browser console shows `Refused to load the image/font/script because it violates the following Content Security Policy directive`.

**Detection:** Open browser DevTools Console tab, filter for "CSP" or "Content Security Policy". Also check Network tab for blocked requests (shown with red status).

**Phase:** Address at the start of theming/fonts phase and again when deciding on image hosting strategy.

**Severity:** CRITICAL

---

### CRIT-05: Turbopack Compatibility with Animation Libraries

**What goes wrong:** Installing a JavaScript animation library (Framer Motion, GSAP, Lottie, react-spring) introduces webpack-specific code paths that Turbopack does not support. The project already discovered this pattern with @sentry/nextjs (which monkey-patches webpack internals and breaks Turbopack SSR). Animation libraries are less likely to patch webpack directly, but some bundle Node.js-specific code or use webpack plugins for tree-shaking.

**Why it happens:** Turbopack's official docs (verified 2026-02-22) state: "Turbopack does not support webpack plugins." Any library that depends on a webpack plugin for optimization or code splitting will fail. Additionally, some libraries use `require()` for conditional imports that Turbopack resolves differently than webpack.

The project's `next.config.ts` already stubs `fs`, `net`, `tls` via `turbopack.resolveAlias` for Anchor/web3.js compatibility. Adding more libraries with Node.js transitive dependencies will require additional stubs.

**Consequences:**
- Build failures with "Module not found" errors
- SSR crashes (HTTP 500 on page routes) identical to the Sentry debacle
- Dev server hangs or hot reload breaks
- Potential regression to webpack (losing Turbopack's performance benefits) if the library cannot be made compatible

**Prevention:**
1. **Decision D10 already says "Pure CSS animations, no JavaScript animation libraries."** This is the correct decision. Adhere to it strictly.
2. **If CSS-only proves insufficient for a specific effect, evaluate the library in isolation first.** Create a minimal Next.js 16 + Turbopack project, install the library, verify it works with both dev and build. Do NOT test in the main project first.
3. **Prefer Web Animations API (WAAPI) over libraries.** `element.animate()` is native, zero-dependency, and works perfectly with Turbopack. It provides programmatic control that CSS keyframes lack (pause, reverse, playback rate) without any bundler concerns.
4. **If a library is truly needed, check these conditions:**
   - No webpack plugin requirements (check the library's Next.js setup guide)
   - No Node.js-specific imports (check for `fs`, `path`, `crypto` in the dependency tree)
   - No server-side rendering code paths (or explicit `"use client"` boundary)
5. **The Buffer polyfill issue is a warning sign.** The project already battles browser/Node compatibility (Buffer v6 lacking BigInt methods). Each new library with Node.js transitive deps compounds this.

**Warning signs:** "Module not found" errors after installing a new package. SSR 500 errors on any page route. Dev server takes noticeably longer to compile after adding a dependency.

**Detection:** After installing any new dependency, immediately run `next dev` and load every route. Check for console errors and SSR failures. Also run `next build` to catch build-time issues.

**Phase:** Enforce throughout all phases. The CSS-only animation decision (D10) should be treated as a hard constraint, not a preference.

**Severity:** CRITICAL

---

## High-Severity Pitfalls

Mistakes that cause significant UX degradation, performance issues, or costly rework.

---

### HIGH-01: Backdrop Blur on Every Modal Causes Paint Storm

**What goes wrong:** The existing `ConnectModal` uses `backdrop-blur-sm` on its overlay (verified in codebase at `ConnectModal.tsx` line 65). When 5-6 modals all use `backdrop-blur` over a complex scene with multiple layered images and CSS animations, each modal open triggers an expensive full-screen blur operation. On lower-end hardware, this causes a visible stutter (200-500ms) when opening modals.

**Why it happens:** `backdrop-filter: blur()` requires the browser to:
1. Render everything behind the modal to an offscreen texture
2. Apply a Gaussian blur shader to that texture
3. Composite the blurred texture with the modal foreground

When "everything behind" includes a 1920x1080+ background image, 5-6 overlay PNGs, and running CSS animations, this is expensive. The blur must be re-computed on every frame if anything behind it is animating.

**Consequences:**
- Modal open animation drops below 30fps on integrated GPUs
- CSS animations running behind the blur (bubbling tube, gears) cause continuous re-blurs
- Mobile devices may drop frames or become unresponsive
- Users perceive the app as sluggish when it was previously snappy

**Prevention:**
1. **Pause all CSS animations when a modal is open.** Add a CSS class to the scene container (e.g., `.scene--modal-open`) that sets `animation-play-state: paused` on all ambient animations. This prevents continuous re-blur operations.
2. **Use a solid semi-transparent overlay instead of blur when animations are running.** `bg-black/70` (the existing approach at `bg-black/60`) is essentially free compared to `backdrop-blur`. Use blur only if animations are paused.
3. **Use `will-change: transform` on modal overlays** to promote them to their own compositing layer, preventing the blur from affecting the scene's paint operations.
4. **Pre-render a static blurred snapshot.** When opening a modal, capture the scene to a canvas (via `html2canvas` or a pre-generated blurred version of the background), display that as the backdrop, then overlay the modal. This is a one-time operation vs. continuous blur.
5. **Test on throttled CPU.** Chrome DevTools > Performance > CPU throttling 4x to simulate mobile hardware.

**Warning signs:** Visible jank when opening/closing modals. Chrome DevTools Performance tab shows "Paint" operations exceeding 8ms per frame during modal transitions. GPU process memory spikes when modal opens.

**Detection:** Open Chrome DevTools > Performance > Record > Open and close a modal. Check for long paint operations and compositor frame drops.

**Phase:** Address during modal implementation phase. The pattern chosen for the first modal (TradingTerminal) sets the precedent for all others.

**Severity:** HIGH

---

### HIGH-02: Hover Glow Effects Triggering Full-Scene Repaints

**What goes wrong:** Hover effects on hotspot elements (glow, brighten, scale) implemented using CSS `filter: brightness()` or `box-shadow` with spread cause the browser to repaint the entire scene (or a large portion of it) on every hover state change. With 7 hotspots, rapid mouse movement across the scene triggers constant repaints.

**Why it happens:** CSS `filter` and `box-shadow` are not compositor-only properties. They require the main thread to repaint the affected area. If the affected element is not on its own compositing layer, the repaint may cascade to parent elements (including the background image).

Compositor-only properties that avoid repaints: `transform`, `opacity`.
Non-compositor properties that cause repaints: `filter`, `box-shadow`, `background-color`, `border`, `width/height`.

**Consequences:**
- Frame drops during mouse movement over the scene
- Janky hover-in/hover-out transitions
- Main thread blocked by paint operations, delaying JavaScript execution (including WebSocket message handling for price updates)
- On slow machines, hover effects feel laggy which undermines the premium aesthetic

**Prevention:**
1. **Implement glow effects using `opacity` on a pre-rendered glow layer.** For each hotspot, create TWO overlay images: the normal state and the glowing state. Cross-fade between them using `opacity: 0` to `opacity: 1` with `transition: opacity 0.3s`. Opacity changes are compositor-only and cost zero main-thread time.
2. **If using CSS `filter: brightness()`, promote the element to its own compositing layer** with `will-change: filter` or `transform: translateZ(0)`. This isolates the repaint to that element's layer only.
3. **Avoid `box-shadow` for glow effects.** Box-shadow is painted on the CPU. Use a pre-baked glow PNG overlaid with opacity control, or use CSS `drop-shadow()` filter (which at least benefits from GPU acceleration when the element is promoted).
4. **Limit `will-change` usage.** Do NOT apply `will-change` to all 7+ hotspots simultaneously. Too many promoted layers consume GPU memory (see CRIT-02). Apply `will-change` on `mouseenter` and remove it on `mouseleave` + transition end.
5. **Use `contain: strict` on hotspot containers** to prevent style/layout changes from propagating to parent elements.

**Warning signs:** Chrome DevTools > Rendering > Paint flashing shows green rectangles covering large areas on hover. Performance tab shows >4ms paint times during hover.

**Detection:** Chrome DevTools > Rendering > Enable "Paint flashing" (green overlay on repainted areas). Hover over hotspots and watch how much area flashes green. Ideally, only the hotspot itself should flash, not the background.

**Phase:** Address during hotspot interaction implementation.

**Severity:** HIGH

---

### HIGH-03: Focus Trap and Keyboard Navigation Broken in Scene

**What goes wrong:** The interactive factory scene is built as a grid of absolutely-positioned images with click handlers. Keyboard users cannot tab between hotspots. Screen readers see a collection of meaningless `<div>` elements. When a modal opens, focus is not trapped inside it -- tab continues to cycle through the (now invisible) scene elements behind the modal. Pressing Escape does nothing in some modals.

**Why it happens:** The existing `ConnectModal` has basic keyboard support (Escape key listener, verified in codebase), but it lacks:
- Focus trap (tab can escape the modal)
- Focus restoration (focus doesn't return to the hotspot that opened the modal)
- `aria-modal="true"` attribute
- `role="dialog"` attribute

The hotspot elements need to be interactive (`<button>` or elements with `role="button"`, `tabindex="0"`, `aria-label`), not just `<div onClick>`.

**Consequences:**
- Completely inaccessible to keyboard-only and screen reader users
- May violate legal accessibility requirements (ADA/WCAG) depending on jurisdiction
- Failing to trap focus in modals is a WCAG 2.1 Level A failure (criterion 2.1.2)
- DeFi users who rely on keyboard navigation (power users often do) cannot use the app

**Prevention:**
1. **Use semantic HTML for hotspots.** Each hotspot should be a `<button>` element with `aria-label="Open Trading Terminal"` (etc.), not a `<div>` with an onClick handler.
2. **Implement a reusable ModalOverlay component with built-in focus trap.** The focus trap should:
   - Move focus to the first focusable element inside the modal on open
   - Cycle tab focus within the modal (Tab from last element goes to first, Shift+Tab from first goes to last)
   - Return focus to the triggering element on close
   - Close on Escape key
   - Include `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the modal title
3. **Test with keyboard only** (unplug mouse / disable trackpad). Can you open every modal, interact with all controls inside, and close the modal using only Tab, Enter, Space, and Escape?
4. **The ConnectModal pattern is a starting point but needs enhancement.** Its Escape-key handling and backdrop-click-to-close are good, but it lacks focus trap and ARIA attributes.

**Warning signs:** Cannot navigate to a hotspot using Tab key. Focus "disappears" behind the modal when tabbing. Screen reader announces nothing meaningful when entering the scene area.

**Detection:** Keyboard-only testing (Tab through the entire page). VoiceOver (macOS) or NVDA (Windows) screen reader testing. `axe-core` or Lighthouse accessibility audit.

**Phase:** Build the `ModalOverlay` component with focus trap BEFORE implementing any specific modals. All modals should use this shared component.

**Severity:** HIGH

---

### HIGH-04: CandlestickChart Resize Failure Inside Modal

**What goes wrong:** The `CandlestickChart` component (verified in codebase) uses `ResizeObserver` to dynamically set its width. When the chart is rendered inside a modal that animates open (e.g., with CSS `transform: scale(0)` to `scale(1)` or `opacity: 0` to `opacity: 1`), the `ResizeObserver` fires during the animation with intermediate dimensions. The TradingView Lightweight Charts library renders at the wrong size, then may or may not re-render when the animation completes.

**Why it happens:** `ResizeObserver` fires for every size change during an animation. If the modal opens with a CSS transition, the chart container goes from 0px to 600px over 300ms, firing multiple resize callbacks with intermediate values. The chart library may throttle or debounce these internally, potentially settling on an intermediate value.

Additionally, the Trading Terminal modal's split layout (chart left, swap right, per Decision D4) means the chart's container is flex-based. Flex children may not have their final dimensions until all siblings have rendered.

**Consequences:**
- Chart renders at wrong width (too narrow, too wide, or zero)
- White gap or overflow next to the chart
- Chart never corrects itself unless the browser window is resized
- Users cannot read price charts accurately -- dangerous for a DeFi trading terminal

**Prevention:**
1. **Defer chart initialization until modal animation completes.** Do NOT render `<CandlestickChart>` until the modal is fully open. Use `onTransitionEnd` callback or `requestAnimationFrame` after the animation duration.
2. **Alternatively, render the chart immediately but call `chart.resize()` once after animation completes.** The TradingView Lightweight Charts API has a `resize(width, height)` method. Call it after a brief delay matching the modal animation duration.
3. **Use `display: block` transitions instead of `transform: scale`.** Display changes don't trigger intermediate ResizeObserver callbacks -- the container goes from hidden to full-size in one step.
4. **Set explicit dimensions on the chart container** (e.g., `width: 100%; min-height: 400px`) so the ResizeObserver has a stable target even during animation.
5. **Test the specific animation timing.** Open the Trading Terminal modal 20 times in a row and verify the chart renders correctly every time.

**Warning signs:** Chart sometimes renders at 0 width or a sliver. Chart width is correct in the dev route (`/swap`) but wrong in the modal. Chart works on first open but fails on subsequent opens.

**Detection:** Open and close the Trading Terminal modal rapidly 10 times. Check if the chart dimensions are correct each time. Use browser DevTools to inspect the `<canvas>` element dimensions.

**Phase:** Address when implementing the TradingTerminalModal. This is the most complex modal due to the chart integration.

**Severity:** HIGH

---

### HIGH-05: Re-theming Breaks Component Styling Specificity

**What goes wrong:** The existing components use a mix of `zinc-*` and `gray-*` Tailwind scales (verified in codebase: `page.tsx` uses `bg-zinc-950`, `swap/page.tsx` uses `bg-gray-950`). When applying the steampunk theme (brass/copper tones, gas-lamp amber), developers override styles at the wrong specificity level. Some components keep their old zinc/gray colors while others get the new palette, creating a visual mishmash.

**Why it happens:** Tailwind v4 (installed as 4.1.18) generates utility classes with equal specificity. There is no `@apply` cascade issue, but the problem is that styles are scattered across 20+ component files as inline utility classes. There is no centralized theme -- each component independently specifies colors like `bg-zinc-900`, `text-gray-400`, `border-zinc-700`.

The frontend-spec's own reconciliation flag notes: "The current color system uses mixed zinc/gray scales." Applying a theme means touching every single component file.

**Consequences:**
- Inconsistent visual appearance (some components steampunk-themed, others still dev-gray)
- Regression bugs from manually editing utility classes in every component
- Merge conflicts if theming work overlaps with functional changes
- Difficulty maintaining the theme because there's no single source of truth for colors

**Prevention:**
1. **Create a theme token layer before changing any component.** Define semantic color variables in `globals.css`:
   ```css
   @import "tailwindcss";
   :root {
     --color-surface: #1a1205;       /* dark brass */
     --color-surface-raised: #2a1f0d;
     --color-border: #5a4320;        /* tarnished bronze */
     --color-text-primary: #e8d5a3;  /* warm cream */
     --color-text-secondary: #a08b60;
     --color-accent: #d4a833;        /* bright brass */
   }
   ```
   Then use these in Tailwind utilities via `bg-[var(--color-surface)]` or extend Tailwind's theme.
2. **Create a component-by-component migration checklist.** Do NOT try to re-theme all components in one pass. Change one component, visually verify, commit.
3. **Keep the old color values as comments** during migration so you can quickly revert if something looks wrong.
4. **Wait for designer assets before starting the re-theme.** The milestone context says "colors, fonts -- pending from designer." Do NOT guess at steampunk colors. Build the variable system now, populate the values when design tokens arrive.

**Warning signs:** Visual inconsistency between components (one modal has copper borders, another has zinc borders). Component styling changes cause unexpected changes in other components (Tailwind class conflicts).

**Detection:** Screenshot comparison before and after theming each component. Visual regression testing.

**Phase:** Create the theme token layer early. Apply to components only after designer provides final color values.

**Severity:** HIGH

---

### HIGH-06: prefers-reduced-motion Not Respected

**What goes wrong:** The ambient CSS animations (bubbling tube, simmering cauldron, rotating gears, flickering lights) run at full intensity for users who have enabled "Reduce motion" in their OS accessibility settings. These users may have vestibular disorders, motion sickness, or seizure sensitivities. Animated backgrounds and pulsing effects can cause physical discomfort.

**Why it happens:** CSS `@keyframes` animations run by default unless explicitly paused for reduced-motion users. Developers building ambient animations focus on the visual effect and forget to add the media query.

**Consequences:**
- Physical discomfort for affected users (headaches, nausea, seizures in extreme cases)
- WCAG 2.1 Level AAA failure (criterion 2.3.3: Animation from Interactions)
- App becomes unusable for a meaningful portion of users
- Potential legal liability depending on jurisdiction

**Prevention:**
1. **Add a global reduced-motion rule at the top of `globals.css`:**
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
     }
   }
   ```
   This is a nuclear option but guarantees compliance. For a more nuanced approach, target specific animation classes.
2. **For each animation, define a reduced-motion alternative.** Bubbling tube: show a static glow instead of moving bubbles. Rotating gears: show gears at rest. This preserves the aesthetic without the motion.
3. **The frontend-spec already flags this** (verified: "prefers-reduced-motion" listed as MEDIUM priority planned improvement). Elevate it to HIGH priority -- it should be implemented alongside the animations, not as an afterthought.
4. **Test with macOS System Preferences > Accessibility > Display > Reduce motion enabled.**

**Warning signs:** Animations play identically regardless of OS motion settings. The `@media (prefers-reduced-motion)` query is absent from the CSS.

**Detection:** Enable reduced motion in OS settings. Load the page. All animations should be paused or replaced with static alternatives.

**Phase:** Implement alongside every animation. Do NOT ship animations without reduced-motion handling in the same commit.

**Severity:** HIGH

---

## Moderate-Severity Pitfalls

Mistakes that cause delays, suboptimal UX, or technical debt requiring cleanup later.

---

### MOD-01: Mobile Layout as Afterthought Creates Two Codepaths

**What goes wrong:** Decision D9 says "Desktop-first, mobile TBD." The team builds the entire scene for desktop, then discovers that the mobile fallback requires essentially rebuilding the navigation. The scene cannot simply be "scaled down" -- it needs a completely different interaction model (no hover states on touch, no full-screen scene, different modal sizing).

**Why it happens:** The factory scene is inherently landscape and hover-dependent. These concepts do not translate to portrait mobile:
- No hover on touch devices (hover effects require alternative for tap)
- 7 hotspots on a phone-width scene are too small to tap accurately
- Full-screen background at phone resolution would be a blurry mess (scaling 1920px to 375px)
- `backdrop-blur` is significantly more expensive on mobile GPUs

**Consequences:**
- Mobile users see a broken or unusable experience
- Building the mobile fallback as a separate view doubles the testing surface
- Mobile layout may not integrate cleanly with the scene's modal system
- Delayed launch if mobile is required before shipping

**Prevention:**
1. **Define the mobile fallback UI at the same time as the desktop scene, even if building it later.** Know exactly what mobile users will see: a simplified navigation grid/list that opens the same modals. This avoids designing yourself into a corner.
2. **Build the modal system to be mobile-responsive from day one.** Modals should use `max-w-*` and `max-h-*` with scrolling interiors. The Trading Terminal modal needs a stacked layout (chart on top, swap below) on narrow screens.
3. **Use a breakpoint check to conditionally render scene vs. mobile layout:**
   ```tsx
   const isDesktop = useMediaQuery('(min-width: 768px)');
   return isDesktop ? <FactoryScene /> : <MobileNav />;
   ```
4. **The frontend-spec suggests 768px as minimum for full scene experience.** Build the mobile navigation for everything below 768px. This covers phones and portrait tablets.
5. **Touch-specific interactions:** Replace hover-glow with tap-highlight (`:active` state on mobile). Consider long-press for a preview tooltip.

**Warning signs:** No mobile designs exist when desktop scene is complete. Testing only happens on desktop. Mobile DevTools simulation shows unusable layout.

**Detection:** Resize browser to 375px width. If the scene is completely broken, the mobile fallback needs to be planned now (not built yet, but planned).

**Phase:** Define the mobile layout spec during the planning phase. Build it as a separate phase after desktop scene is complete.

**Severity:** MEDIUM

---

### MOD-02: Onboarding Flow Blocks Existing Users

**What goes wrong:** A first-time onboarding flow (tutorial, guided tour, welcome modal) is implemented to trigger every time the page loads, or uses a persistence mechanism (localStorage) that resets when users clear their browser data. Returning users are annoyed by re-encountering the tutorial. Worse, the onboarding overlay may prevent users from accessing their staked funds or executing a time-sensitive swap.

**Why it happens:** Onboarding is usually built last and rushed. The "first time" detection is implemented as a simple localStorage flag that doesn't account for:
- Users who use multiple browsers/devices
- Users who clear browsing data
- Private/incognito browsing
- Users who connected their wallet (proving they're experienced) but cleared localStorage

**Consequences:**
- Returning users forced through tutorial repeatedly
- Time-sensitive DeFi actions (epoch-ending swaps) blocked by unskippable onboarding
- Users disconnect wallet and reconnect, resetting the onboarding flag
- Negative perception ("this app treats me like I don't know what I'm doing")

**Prevention:**
1. **Make onboarding skippable at every step.** A persistent "Skip tutorial" button should be visible at all times. Pressing Escape should also skip.
2. **Tie onboarding completion to the wallet, not localStorage.** Store an `onboarding_complete` flag in a server-side database keyed to the wallet public key. This persists across browsers and data clears.
3. **If server-side storage is too complex, use localStorage but with a fallback.** If the user has a connected wallet AND token balances > 0, skip onboarding regardless of localStorage state. They clearly know what they're doing.
4. **Never block functional actions behind onboarding.** The tutorial should be an overlay that can be dismissed, not a blocking modal sequence.
5. **Consider "progressive disclosure" instead of a tutorial.** Show subtle hints on first interaction ("Click the cauldron to view Carnage events") rather than a step-by-step walkthrough.

**Warning signs:** Onboarding triggers every time in incognito mode. No skip button. Onboarding covers the entire screen with no way to access wallet or swap.

**Detection:** Load the page in incognito, connect a wallet, close the tab. Re-open in incognito. Does the onboarding repeat? Can you skip it? Can you access your funds during onboarding?

**Phase:** Build as a late-phase feature. The scene and modals must be fully functional first. Onboarding should never be a dependency for core functionality.

**Severity:** MEDIUM

---

### MOD-03: Web Font Loading Causes Flash of Unstyled Text (FOUT)

**What goes wrong:** Custom steampunk-themed fonts are loaded as web fonts (either self-hosted or from Google Fonts). While the font downloads (~50-200KB per weight), the browser displays text in the fallback system font. When the web font loads, all text reflows to the new font, causing a jarring visual shift. In a single-page scene app, this means the entire UI snaps from one look to another 1-2 seconds after initial paint.

**Why it happens:** Web fonts are render-blocking by default, but browsers implement `font-display: swap` to avoid invisible text (FOIT). The swap behavior shows the fallback font immediately, then swaps to the web font when loaded. If the steampunk font has very different metrics from the fallback system font, the swap causes significant layout shift.

**Consequences:**
- Text reflows after 1-2 seconds, shifting hotspot labels and UI elements
- Perceived quality drops ("it looked right, then jumped")
- CLS (Cumulative Layout Shift) increases, harming Core Web Vitals
- If fonts fail to load (CDN down, CSP blocks), the fallback font persists permanently

**Prevention:**
1. **Self-host fonts and preload them.** Place font files in `public/fonts/` and add `<link rel="preload">` in the layout:
   ```tsx
   <link rel="preload" href="/fonts/steampunk.woff2" as="font" type="font/woff2" crossOrigin="" />
   ```
2. **Use `font-display: swap` with size-adjust.** The `size-adjust` CSS property can make the fallback font match the custom font's metrics, minimizing layout shift:
   ```css
   @font-face {
     font-family: 'Steampunk';
     src: url('/fonts/steampunk.woff2') format('woff2');
     font-display: swap;
     size-adjust: 105%;
   }
   ```
3. **Use WOFF2 format exclusively.** WOFF2 compresses ~30% better than WOFF. All modern browsers support it. No need to ship multiple formats.
4. **Limit the number of font weights.** Each weight (Regular, Bold, Italic) is a separate file download. Use at most 2-3 weights.
5. **Test with slow 3G throttling** to see the FOUT in action. If it's jarring, consider using `font-display: optional` (which skips the font entirely if it doesn't load fast enough, but means some users never see the custom font).

**Warning signs:** Text visibly reflows 1-2 seconds after page load. Different font on first paint vs. final render. Network tab shows font files loading after initial paint.

**Detection:** Throttle to "Slow 3G" in Chrome DevTools Network tab. Record the page load. Watch for text reflow.

**Phase:** Address during theming phase, when designer provides font selections.

**Severity:** MEDIUM

---

### MOD-04: Z-Index War Between Scene Layers, Modals, and Privy

**What goes wrong:** The factory scene uses absolutely-positioned layers with varying z-indices. Modals need to appear above the scene. The Privy wallet connection iframe (from `@privy-io/react-auth`) creates its own stacking context at a high z-index. The result is a z-index arms race where modals appear behind the Privy iframe, or scene elements bleed through modal overlays.

**Why it happens:** Each system creates its own z-index range without coordination:
- Scene layers: z-1 through z-10 (background, overlays, hotspots)
- Custom modals: z-50 (per existing `ConnectModal` at line 65)
- Privy iframe: Privy sets its own z-index (typically z-[2147483647] or similar browser-max values)
- Toast notifications / error banners: need to be above modals

CSS stacking contexts are created by `position`, `opacity < 1`, `transform`, `filter`, `backdrop-filter`, and `will-change`. Adding these to scene elements can inadvertently create new stacking contexts that trap z-index values.

**Consequences:**
- Privy login/wallet popup appears behind a custom modal
- Scene hotspot hover effects show through modal overlays
- Tooltip or notification appears behind the scene
- Difficult to debug because stacking contexts are not visible in the DOM

**Prevention:**
1. **Define a z-index scale and document it:**
   ```
   z-0:  Background image
   z-10: Overlay layers (factory objects)
   z-20: Hotspot hover effects
   z-30: (reserved)
   z-40: (reserved)
   z-50: Modal overlays (matches existing ConnectModal)
   z-60: (reserved for inner-modal dropdowns)
   z-[9999]: Third-party overlays (Privy, Cloudflare challenge)
   ```
2. **Use a single stacking context root.** Wrap the scene in a single `position: relative` container. All scene z-indices are relative to this container, not the document root.
3. **Modals should portal to document body** (using React `createPortal`). This escapes any stacking context created by the scene container.
4. **Test with Privy login open simultaneously with a custom modal.** Both should be usable without overlap issues.
5. **Avoid `transform` or `opacity < 1` on scene container elements** unless you understand the stacking context implications. A `transform: translateZ(0)` for GPU acceleration creates a new stacking context.

**Warning signs:** Elements appearing in unexpected visual order. A modal's backdrop-click handler fires when you meant to click a Privy button. CSS changes to one layer unexpectedly affect the visual stacking of unrelated elements.

**Detection:** Open Chrome DevTools > Layers panel. Verify that the stacking order matches your expectations. Also: 3D View in Edge DevTools is excellent for visualizing z-index relationships.

**Phase:** Define the z-index scale before building any scene layers. Enforce it via code review.

**Severity:** MEDIUM

---

### MOD-05: Image Preloading Strategy Causes Waterfall Loading

**What goes wrong:** All scene images (background + 5-6 overlays) are loaded lazily by default (Next.js `<Image>` default is `loading="lazy"`). This means the background loads, then the browser discovers overlay images and starts loading them, creating a visual "pop-in" effect as objects appear one by one over the background. Alternatively, all images are set to `loading="eager"` which blocks the initial page render.

**Why it happens:** Without an explicit loading strategy, the browser loads images in DOM order as they enter the viewport. For a full-screen scene, all images are "in the viewport" immediately, but the browser may still stagger requests if it's managing connection limits.

**Consequences:**
- Objects appear one by one over the background (looks unpolished)
- Or, all images block rendering (long white screen before anything appears)
- Network waterfall shows sequential image loading instead of parallel

**Prevention:**
1. **Use `loading="eager"` and `fetchPriority="high"` ONLY for the background image.** It must load first and fast.
2. **Use `loading="eager"` but `fetchPriority="auto"` for overlay images.** They should start loading immediately but defer to the background.
3. **Use a loading state.** Show the blurred background placeholder (from `blurDataURL`) with a subtle loading indicator until ALL images are loaded. Then transition to the full scene. This prevents the pop-in effect entirely.
4. **Use the `onLoad` callback on `<Image>` components** to track which images have loaded. Display the scene only when all critical images are ready:
   ```tsx
   const [loadedCount, setLoadedCount] = useState(0);
   const totalImages = 7; // background + 6 overlays
   const allLoaded = loadedCount >= totalImages;
   ```
5. **For the background specifically, consider using `getImageProps()` with CSS `background-image` and `image-set()`** (as shown in Next.js 16.1.6 docs) for maximum control over loading behavior.

**Warning signs:** Objects "pop in" sequentially over the background. Network tab shows image requests staggered over 2-3 seconds. White flash before scene appears.

**Detection:** Throttle to "Fast 3G" and record the page load. Note the order and timing of image appearances.

**Phase:** Address during scene composition phase. The loading strategy must be decided before integrating overlays.

**Severity:** MEDIUM

---

### MOD-06: Polling Hooks Competing with Scene Rendering for Main Thread

**What goes wrong:** The existing 12 custom hooks poll at various intervals (10s, 30s, 60s). When the scene is rendering animations and handling hover effects, these polling callbacks compete for main thread time. A polling callback that triggers a re-render (new epoch data, new pool prices) during a CSS animation frame causes the animation to stutter.

**Why it happens:** JavaScript is single-threaded. If `useEpochState` fires its 10-second poll and triggers a state update + re-render, React must reconcile the component tree. If this coincides with a CSS animation frame, the browser may skip the animation frame to prioritize the JavaScript work.

The existing architecture uses independent polling (not batched), which means multiple hooks can fire in the same ~10ms window, compounding the issue.

**Consequences:**
- Animation stutters every 10 seconds (coinciding with polling bursts)
- Mouse hover responsiveness drops during data updates
- TradingView chart redraws during price WebSocket updates, visible as micro-stutters
- Users perceive the scene as "laggy" despite fast hardware

**Prevention:**
1. **Adopt the scene-level orchestrator pattern.** A single hook consumer (the `FactoryScene` component) calls all data hooks. Child components (hotspots, animations, modals) receive data via props and are `React.memo()`-wrapped. This prevents unnecessary re-renders of animation components when unrelated data changes.
2. **Use `React.startTransition` for non-urgent data updates.** Epoch state, tax rates, and pool prices can update at lower priority than animation frames:
   ```tsx
   startTransition(() => {
     setEpochData(newData);
   });
   ```
3. **Batch multiple state updates.** React 19 (installed as 19.2.3) automatically batches state updates within event handlers, but `setTimeout` callbacks (from polling) may not batch across hooks. Consider using `useSyncExternalStore` or `useReducer` to combine multiple data sources.
4. **Isolate animation components from data flow.** Scene animations (bubbling tube, gears) should not be children of data-consuming components. Place them in a separate React subtree that only receives theme data, not live protocol data.
5. **The frontend-spec's planned optimization** ("Batch individual getAccountInfo calls into getMultipleAccounts") would reduce the number of separate state updates. Implement this before or alongside the scene work.

**Warning signs:** Chrome DevTools Performance tab shows React reconciliation/commit during animation frames. "Long Tasks" (>50ms) coinciding with polling intervals. Animation FPS drops from 60 to 30-40 periodically.

**Detection:** Profile with Chrome DevTools Performance tab while the scene is running. Look for periodic spikes in JS execution that correlate with animation stutter.

**Phase:** Address during the scene orchestrator implementation. This is an architecture decision that affects all subsequent work.

**Severity:** MEDIUM

---

### MOD-07: Static Public Folder Assets Have No Cache Headers

**What goes wrong:** Images placed in Next.js `public/` folder are served with `Cache-Control: public, max-age=0` (verified in official Next.js 16.1.6 docs). This means every page visit re-downloads all scene images. For a 13MB background (even compressed to 3-5MB), this wastes bandwidth and slows repeat visits.

**Why it happens:** Next.js explicitly states it "cannot safely cache assets in the public folder because they may change." This is a reasonable default for frequently-changing assets, but catastrophic for static scene artwork that never changes.

**Consequences:**
- Repeat visitors re-download multi-megabyte scene images on every visit
- Railway bandwidth costs scale with visits x asset size
- Return visits feel slower than first visits should
- Browser cache is useless for these assets

**Prevention:**
1. **Use Next.js `<Image>` component with static imports.** When you `import bg from './factory-bg.webp'`, Next.js hashes the file and serves it with `Cache-Control: immutable` (permanent cache). This is the best approach.
2. **If using `public/` folder, add custom cache headers in `next.config.ts`:**
   ```typescript
   async headers() {
     return [
       {
         source: '/scene/:path*',
         headers: [
           { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }
         ]
       },
       // ... existing CSP headers
     ];
   }
   ```
3. **Use content-hash filenames.** Name files like `factory-bg.a1b2c3.webp` so the URL changes when the content changes, allowing aggressive caching without stale content risk.
4. **If using Railway CDN or a CDN like Cloudflare, configure caching at the CDN level** for `/scene/` paths.

**Warning signs:** Network tab shows 200 (not 304 or "from cache") for scene images on repeat visits. Bandwidth monitoring shows image transfer on every page load.

**Detection:** Load the page. Reload the page. Check Network tab -- scene images should show "from disk cache" or "from memory cache" on the second load.

**Phase:** Address when setting up the image asset pipeline, before deploying any scene images.

**Severity:** MEDIUM

---

## Minor Pitfalls

Mistakes that cause annoyance, rough edges, or minor technical debt.

---

### MINOR-01: Scene Aspect Ratio Not Preserved on Ultra-wide or Unusual Viewports

**What goes wrong:** The factory scene image has a fixed aspect ratio (likely 16:9 from the artist). On ultra-wide monitors (21:9), the scene is stretched or has large bars on top/bottom. On 4:3 monitors, the scene is letterboxed or cropped incorrectly.

**Prevention:** Use `object-fit: cover` for the background to fill any viewport while preserving aspect ratio. Accept that some edges may be cropped. Position hotspots using percentage-based coordinates (not pixel-based) so they remain aligned regardless of cropping.

**Phase:** Address during scene layout implementation.

**Severity:** LOW

---

### MINOR-02: Scene Interactions Interfere with Browser Gestures

**What goes wrong:** On trackpads and mobile, two-finger swipe (back/forward navigation), pinch-to-zoom, and scroll gestures conflict with scene interactions. Users accidentally navigate away while trying to interact with hotspots.

**Prevention:** Apply `touch-action: none` to the scene container to disable default browser touch actions. Add `overscroll-behavior: contain` to prevent scroll chaining. Be careful not to disable zoom entirely (accessibility concern) -- only disable it within the scene container.

**Phase:** Address during mobile/touch interaction implementation.

**Severity:** LOW

---

### MINOR-03: DevTools Performance Overhead from Scene Complexity

**What goes wrong:** The scene with multiple compositing layers, running animations, and WebSocket subscriptions makes Chrome DevTools Performance tab recordings extremely large. Developers struggle to identify actual performance issues because the baseline "noise" from the scene is so high.

**Prevention:** Build the scene incrementally. Profile after each addition (background, then one overlay, then hover effect, then one animation). This way you catch regressions immediately and know exactly which addition caused a performance drop. Also use the Layers panel instead of the Performance tab for compositing-specific investigation.

**Phase:** Practice throughout all scene-building phases.

**Severity:** LOW

---

### MINOR-04: Image Alt Text and Decorative Image Handling

**What goes wrong:** Scene images that are purely decorative (background, overlay objects that are also interactive buttons) are given meaningful alt text that clutters screen reader output. Or, interactive hotspots are implemented as images without proper ARIA labels, so screen readers announce "factory-cauldron.png" instead of "Open Carnage Fund viewer."

**Prevention:** Background and overlay images should have `alt=""` (empty string, marking them as decorative). The interactive elements should be `<button>` elements with `aria-label`, not `<img>` elements. The visual appearance comes from CSS background or positioned image children, but the interactive element is semantic HTML.

**Phase:** Address during hotspot implementation (same phase as HIGH-03).

**Severity:** LOW

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|---|---|---|---|
| Asset preparation (images) | CRIT-01, CRIT-02 | CRITICAL | Compress, crop, convert before any code work. Test total download size < 5MB. |
| Scene layout + background | MOD-05, MOD-07, MINOR-01 | MEDIUM | Establish loading strategy, caching, and aspect ratio handling. |
| Hotspot interactivity | HIGH-02, HIGH-03, MINOR-02, MINOR-04 | HIGH | Use semantic HTML, compositor-only properties, focus management. |
| Modal system | CRIT-03, HIGH-01, HIGH-04, MOD-04 | CRITICAL/HIGH | Build reusable ModalOverlay with focus trap. Test re-parenting of every existing component. |
| CSS animations | CRIT-05, HIGH-06, MOD-06 | HIGH | CSS-only per D10. Add prefers-reduced-motion from the start. Profile impact on data hooks. |
| Theming (colors/fonts) | CRIT-04, HIGH-05, MOD-03 | HIGH | Token layer first. Self-host fonts. Update CSP for new resources. |
| Mobile fallback | MOD-01 | MEDIUM | Define mobile layout spec now. Build after desktop scene is complete. |
| Onboarding | MOD-02 | MEDIUM | Skippable always. Never block DeFi actions. |

---

## Summary of Prevention Strategy by Priority

**Do FIRST (before writing any scene code):**
1. Compress and crop all image assets (CRIT-01, CRIT-02)
2. Define z-index scale and theme token layer (MOD-04, HIGH-05)
3. Build the reusable ModalOverlay component with focus trap (HIGH-03)
4. Configure image caching headers (MOD-07)

**Do DURING scene implementation:**
5. Scene-level hook orchestrator pattern (CRIT-03, MOD-06)
6. Loading state for image pop-in prevention (MOD-05)
7. Compositor-only hover effects (HIGH-02)
8. Pause animations behind modals (HIGH-01)
9. prefers-reduced-motion alongside every animation (HIGH-06)

**Do AFTER scene works:**
10. Mobile fallback navigation (MOD-01)
11. Onboarding flow (MOD-02)
12. Visual theme application (HIGH-05, waiting on designer)
13. Font loading strategy (MOD-03, waiting on designer)

---

## Sources and Confidence

| Finding | Source | Confidence |
|---|---|---|
| Next.js Image component API (fill, sizes, quality, placeholder, onLoad, caching) | Official Next.js 16.1.6 docs (fetched 2026-02-22) | HIGH |
| Public folder caching: `Cache-Control: public, max-age=0` | Official Next.js 16.1.6 docs (fetched 2026-02-22) | HIGH |
| Turbopack does not support webpack plugins | Official Next.js 16.1.6 Turbopack docs (fetched 2026-02-22) | HIGH |
| Existing CSP configuration | Codebase: `app/next.config.ts` lines 7-23 | HIGH |
| Existing ConnectModal pattern | Codebase: `app/components/wallet/ConnectModal.tsx` | HIGH |
| Mixed zinc/gray color scales | Codebase analysis + frontend-spec reconciliation flag | HIGH |
| Sentry/Turbopack incompatibility pattern | Project memory (MEMORY.md, proven via previous experience) | HIGH |
| CSS compositor-only properties (transform, opacity) | Established web performance knowledge (Chrome rendering pipeline) | HIGH |
| backdrop-filter performance characteristics | Established web performance knowledge | HIGH |
| prefers-reduced-motion media query | MDN/WCAG standards (well-established) | HIGH |
| GPU memory per RGBA layer calculation | Established knowledge (4 bytes/pixel x resolution) | HIGH |
| ResizeObserver behavior during CSS transitions | Established browser behavior (ResizeObserver spec) | MEDIUM |
| WebP/AVIF compression ratios vs PNG | Established knowledge, Next.js docs mention AVIF "compresses 20% smaller than WebP" | HIGH |
