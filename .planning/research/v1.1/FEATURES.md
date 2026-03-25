# Feature Landscape: v1.1 "Modal Mastercraft, Docs & Audio"

**Domain:** Gamified DeFi frontend -- steampunk-themed UI components, chart restyling, documentation overhaul, audio system
**Researched:** 2026-02-24
**Overall confidence:** MEDIUM (WebSearch/WebFetch unavailable; findings based on training data through May 2025 + codebase analysis. Flagged where verification is needed.)

---

## 1. Steampunk Component Kit

### 1.1 Table Stakes Components

Every themed component library needs these. Missing any of them creates inconsistency where some UI elements "break the illusion."

| Component | Why Expected | Complexity | Current State |
|-----------|-------------|------------|---------------|
| 9-slice border frame | Core visual wrapper for all panels/cards | Med | Not yet -- modal uses CSS gradients + box-shadow |
| Themed button (brass) | Every interactive element needs consistent styling | Low | `.brass-button` exists in globals.css -- needs asset-based upgrade |
| Themed input | Form fields throughout swap, staking, settings | Low | `.brass-input` exists -- needs asset-based border treatment |
| Toggle switch | Settings (audio on/off, theme prefs) | Low | Not yet |
| Slider (range input) | Volume control, slippage fine-tuning | Med | Not yet |
| Tab bar | Staking (Stake/Unstake/Claim), chart controls | Low | `.lever-tab` exists -- solid, may just need texture refinement |
| Card/panel | Container for content groups (stats, token info) | Low | `.station-content` exists -- upgrade with 9-slice frames |
| Divider | Section separators inside modals | Low | Plain `h-px bg-factory-border` -- needs decorative treatment |
| Themed scrollbar | Modal body scrolling (already themed via `scrollbar-color`) | Low | Exists but CSS-only -- could get texture upgrade |
| Select/dropdown | Pool selector, resolution picker in chart controls | Med | Native `<select>` currently -- custom dropdown for full theming |

### 1.2 Differentiator Components

Not strictly required but would elevate the steampunk immersion significantly.

| Component | Value Proposition | Complexity | Notes |
|-----------|-------------------|------------|-------|
| Pressure gauge (progress) | Shows epoch progress, fund accumulation as analog gauge | Med | Strong steampunk identity piece -- animated needle rotation |
| Brass dial/knob | Rotary input for settings like volume | High | Cool but possibly over-engineered for what a slider achieves |
| Riveted panel header | Decorative header bar with bolt accents | Low | Already have `.modal-bolt` -- extend the pattern |
| Steampunk tooltip | Brass-framed hover info cards | Med | Current tooltips are browser defaults |
| Steam particle effect | Ambient particles on hover/interaction | Med | Pure CSS or canvas -- adds atmosphere but is visual polish |
| Animated pipe divider | Animated flowing liquid/steam in dividers | Med | Thematic but high effort for low functional value |

### 1.3 Anti-Components

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full CSS framework / utility system | You already have Tailwind v4 with `@theme` tokens. Building a parallel system creates maintenance burden and naming conflicts | Extend existing `@theme` tokens + add component classes in globals.css |
| npm-published component library | Premature abstraction. This is a single product, not a design system for multiple apps. Publishing adds build pipeline complexity (Rollup, types, versioning) | Keep components as local `.tsx` files + CSS classes |
| 3D WebGL steampunk effects | GPU-intensive, accessibility nightmare, breaks mobile, distracts from DeFi functionality | CSS transforms, box-shadows, and 2D image assets create 95% of the effect at 5% of the cost |
| Canvas-based UI components | Canvas elements break accessibility (no DOM tree, no screen reader access, no focus management) | HTML + CSS for all interactive elements. Canvas only for decorative non-interactive elements if needed |
| Themed native `<select>` replacement with portals | Custom dropdowns that portal outside the dialog break focus trapping and `<dialog>` inertness. Massive accessibility complexity | Use the native `<select>` with CSS styling (background, color, border work fine) OR use a listbox pattern that renders INSIDE the dialog |

### 1.4 Component Architecture Pattern

**Recommendation: CSS-first with asset overlay approach.**

The existing codebase already follows this pattern well (`.brass-button`, `.lever-tab`, `.brass-input` are CSS classes in globals.css, applied via className). The v1.1 upgrade adds AI-generated texture assets via `border-image` and `background-image`.

```
Component hierarchy:
  <SteampunkFrame>          -- 9-slice border wrapper (the core primitive)
    <SteampunkHeader>       -- Bolted panel header with title
    <SteampunkBody>         -- Scrollable content area
  </SteampunkFrame>

  <BrassButton>             -- Wraps <button> with brass styling
  <BrassInput>              -- Wraps <input> with gauge-recessed styling
  <LeverTab>                -- Tab component with mechanical press animation
  <SteamToggle>             -- iOS-style toggle with brass/steam skin
  <BrassSlider>             -- Range input with brass track/thumb
  <GaugeDivider>            -- Decorative horizontal rule with pipe/rivet accent
```

**Why this pattern works for this project:**
1. Zero runtime JS for styling (CSS classes + assets)
2. Compatible with Tailwind v4 `@theme` tokens already in use
3. Server-renderable (no client-side style injection)
4. Works with Turbopack (no CSS-in-JS complications per MEMORY.md Sentry note)

---

## 2. 9-Slice Border Implementation in CSS

### 2.1 How CSS `border-image` 9-Slice Works

**Confidence: HIGH** (CSS specification, stable for 10+ years)

The `border-image` CSS property divides a source image into 9 regions using slice lines, then stretches/tiles/repeats the edge and center sections to fit any element size.

```
  ┌──────┬──────────────┬──────┐
  │  TL  │     Top      │  TR  │   (corners = fixed size)
  ├──────┼──────────────┼──────┤
  │ Left │   Center     │ Right│   (edges = stretched/tiled)
  ├──────┼──────────────┼──────┤
  │  BL  │    Bottom    │  BR  │   (center = optional fill)
  └──────┴──────────────┴──────┘
```

**Key properties:**

```css
.steampunk-frame {
  /* Source image -- the full frame texture (PNG or WebP) */
  border-image-source: url('/ui/frame-brass.png');

  /* Slice: inset from each edge (px or %). Defines the 9 regions.
     The "fill" keyword tells the browser to also render the center slice
     (without it, the center is transparent). */
  border-image-slice: 40 fill;

  /* Width: how wide the border renders in the layout.
     Can differ from slice (slice = source pixels, width = rendered size). */
  border-image-width: 40px;

  /* Outset: pushes the border outward beyond the border box.
     Useful so the ornate frame doesn't eat into content padding. */
  border-image-outset: 8px;

  /* Repeat: how edge slices fill the space between corners.
     "stretch" = scale to fit (good for smooth gradients)
     "round" = tile and scale to fit integer count (best for repeating patterns)
     "repeat" = tile exactly (can cause clipping at edges) */
  border-image-repeat: round;
}
```

### 2.2 Practical Considerations for This Project

**Shorthand syntax:**
```css
border-image: url('/ui/frame-brass.png') 40 fill / 40px / 8px round;
```

**Responsive behavior:**
- `border-image-slice` in pixels is NOT responsive (fixed px from the source image)
- `border-image-width` CAN be responsive (use `clamp()` or media queries)
- For the steampunk aesthetic, fixed-pixel borders are fine -- ornamental frames should NOT scale with viewport (a 2px rivet line at any screen size looks right)

**Gotchas:**
1. `border-image` completely overrides `border-radius` -- rounded corners are ignored when border-image is active. Steampunk frames are typically rectangular, so this is acceptable.
2. `border-image` replaces `border-color`, `border-style` -- you must set `border-width` or `border-image-width` for it to render, but `border-color`/`border-style` are ignored.
3. The `fill` keyword in `border-image-slice` is essential if you want the center of the 9-slice to render. Without it, the background shows through. For frames where the interior is textured paper/metal, use `fill`. For frames that are just borders around transparent content, omit `fill`.
4. Fallback: browsers that don't support `border-image` (essentially none in 2026) fall back to normal `border` properties. Set a solid `border` as fallback.

### 2.3 Asset Preparation Guidelines

For the AI-generated steampunk frame assets:

| Requirement | Specification | Why |
|-------------|--------------|-----|
| Format | WebP (lossy, quality 85-90) or PNG-8 if few colors | WebP matches existing asset pipeline; lossy is fine for textures |
| Dimensions | 240x240px minimum (80px corners + 80px edges + center) | Ensures crisp corners on 2x retina. Too small = blurry bolts/rivets |
| Corner size | Consistent across all frame variants (e.g., all corners = 80px) | Allows a single `border-image-slice` value across all frame types |
| Seamless edges | Edge slices must tile seamlessly when `round`/`repeat` is used | Test by placing two copies side-by-side before committing the asset |
| Transparent center | For "border-only" frames, center region should be transparent | Allows `background` CSS to show through for content area styling |
| Named variants | `frame-brass.webp`, `frame-copper.webp`, `frame-iron.webp` | Supports different visual weights (brass = primary, iron = subtle) |

### 2.4 Integration with Existing Modal System

The current `.modal-chrome` uses CSS gradients and box-shadows for its frame effect. Upgrading to 9-slice:

```css
/* Before (current): */
.modal-chrome {
  background: linear-gradient(135deg, #f5e6c8 0%, #e8d5a8 50%, #f0dbb8 100%);
  border: 3px solid var(--color-factory-accent);
  box-shadow: 0 0 0 6px var(--color-factory-surface-elevated),
              0 0 0 8px var(--color-factory-accent), ...;
}

/* After (9-slice upgrade): */
.modal-chrome {
  border-image: url('/ui/frame-brass.webp') 48 fill / 48px / 0 round;
  /* The multi-layer box-shadow for depth can remain -- border-image
     and box-shadow are independent properties */
  box-shadow: 0 0 40px rgba(240, 192, 80, 0.15),
              0 16px 48px rgba(0, 0, 0, 0.5);
}
```

**Note:** The `.modal-bolt` decorative elements (CSS radial-gradient circles) would become redundant if the 9-slice frame asset includes bolt/rivet details in its corners. Remove the DOM elements and let the border-image handle it.

---

## 3. TradingView Lightweight Charts v5 Theming

### 3.1 Current State

**Confidence: HIGH** (verified by reading existing `CandlestickChart.tsx`)

The project already has lightweight-charts v5.1.0 installed and working. Current theming is solid:
- Colors match the factory palette via hardcoded hex values
- Crosshair label backgrounds use dark surface color
- Grid lines use `#4a3520` (factory-border-subtle)
- Candle colors: green up (#5da84a) / red down (#c04030)

### 3.2 Available Customization Points in v5

**Confidence: MEDIUM** (based on training data for lightweight-charts v5 API; specific options should be verified against official docs)

| Area | API | What Can Be Customized |
|------|-----|----------------------|
| Chart layout | `createChart({ layout: {...} })` | background (solid/gradient), textColor, fontSize, fontFamily |
| Grid | `grid: { vertLines, horzLines }` | color, visible, style (solid/dashed/dotted) |
| Crosshair | `crosshair: { mode, horzLine, vertLine }` | color, width, style, labelBackgroundColor, labelVisible |
| Time scale | `timeScale: {...}` | borderColor, barSpacing, minBarSpacing, fixLeftEdge, fixRightEdge, timeVisible, secondsVisible |
| Price scale | `rightPriceScale: {...}` | borderColor, scaleMargins, autoScale, borderVisible |
| Watermark | `watermark: {...}` | text, color, visible, fontSize, fontFamily, fontStyle |
| Series options | `addSeries(Type, options)` | upColor, downColor, borderUpColor, borderDownColor, wickUpColor, wickDownColor, priceFormat |

### 3.3 Recommended Improvements for v1.1

| Improvement | Implementation | Complexity |
|-------------|---------------|------------|
| Custom font family | `layout: { fontFamily: 'IBM Plex Mono, monospace' }` -- matches `--font-mono` | Low |
| Watermark branding | `watermark: { text: 'Dr. Fraudsworth', color: 'rgba(218,165,32,0.08)', visible: true }` | Low |
| Grid style | Switch to dashed grid lines: `{ style: LineStyle.Dashed }` for a blueprint/technical drawing feel | Low |
| Custom tooltip | Use chart's `subscribeCrosshairMove()` to build an HTML tooltip positioned via JS. Allows full steampunk styling (9-slice frame, brass text) that the default tooltip can't achieve | Med |
| OHLC legend overlay | Render a floating div above the chart showing O/H/L/C/V for the hovered candle. TradingView's default legend is limited. Use `subscribeCrosshairMove()` to get current candle data | Med |
| Volume sub-chart | Add a histogram series below candlesticks: `chart.addSeries(HistogramSeries, { color: 'rgba(218,165,32,0.3)' })` | Med |
| Price line markers | Use `createPriceLine()` to show key levels (e.g., peg price, last carnage price) as labeled horizontal lines | Low |
| Steampunk chart frame | Wrap the chart container with the 9-slice frame component | Low |

### 3.4 Custom Tooltip Pattern

**Confidence: MEDIUM** (API pattern from training data; verify subscribeCrosshairMove signature)

```typescript
// Subscribe to crosshair movement
chart.subscribeCrosshairMove((param) => {
  if (!param.time || !param.seriesData.size) {
    // Hide tooltip
    return;
  }
  const data = param.seriesData.get(series);
  if (data) {
    // Position and populate HTML tooltip element
    // param.point gives { x, y } in chart coordinates
  }
});
```

The HTML tooltip element should be:
- Absolutely positioned within the chart container
- Styled with the steampunk frame/card classes
- Shows: time, OHLC values, volume, price change %
- Uses `pointer-events: none` so it doesn't interfere with chart interaction

### 3.5 Chart UX Fixes to Include

Based on the existing `ChartControls.tsx` and `CandlestickChart.tsx`:

| Fix | Why | How |
|-----|-----|-----|
| Loading skeleton with chart dimensions | Current loading overlay says "Loading chart data..." over an empty div -- causes layout shift when chart mounts | Set explicit height on container div matching chart height prop |
| Keyboard accessibility for range buttons | Time range buttons are focusable but don't communicate current selection to screen readers | Add `aria-pressed={tr === range}` to range buttons |
| Chart resize on modal size change | ResizeObserver watches the container, but modal opening animation changes size -- chart may render at pre-animation width | Debounce or delay initial fitContent() until after iris animation completes (280ms) |
| Empty state | No candles = empty chart with "Loading..." forever | Show "No data available" message when candles is empty and loading is false |

---

## 4. Web Audio System

### 4.1 Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|-------------|------------|-------|
| Background music (looping) | Establishes atmosphere, DeFi apps increasingly use ambient sound | Med | Must handle autoplay policy |
| Button/interaction SFX | Click feedback for brass buttons, levers, Big Red Button | Low | Short audio clips triggered on events |
| Mute toggle | Users MUST be able to silence audio | Low | Single toggle in Settings, persisted |
| Volume control | Fine-grained control beyond just mute | Low | Slider 0-100, persisted |
| State persistence | Volume/mute settings survive page refresh | Low | localStorage |
| Reduced motion respect | `prefers-reduced-motion` should silence or reduce audio | Low | Check media query, default to muted |

### 4.2 Autoplay Policy -- The Critical Constraint

**Confidence: HIGH** (well-established browser behavior, stable since 2018)

**All modern browsers block autoplay of audio without user interaction.** This is non-negotiable and cannot be worked around. The rules:

1. **Audio cannot play before a user gesture** (click, tap, keydown). Even setting `volume = 0` and then raising it doesn't work -- the AudioContext itself must be created/resumed after a gesture.
2. **The first user interaction "unlocks" the AudioContext.** After that, subsequent plays work without gestures.
3. **Mobile is stricter than desktop.** iOS Safari requires a touch event specifically (not just any input event). Android Chrome is similar.
4. **The `<audio>` element and Web Audio API both follow these rules.** There's no escape hatch.

**Implication for Dr. Fraudsworth:** The splash screen "Push to Enter" interaction is the PERFECT unlock point. When the user clicks the brass button to enter the factory, that click event should:
1. Create the global `AudioContext`
2. Resume it (if it was created in suspended state)
3. Start background music (if not muted in settings)

This is architecturally clean -- the splash screen is already a required interaction gate.

### 4.3 Recommended Architecture

```
AudioProvider (React Context)
  ├── AudioContext (Web Audio API)
  ├── GainNode (master volume)
  ├── State: { muted: boolean, volume: number, musicEnabled: boolean }
  ├── Methods: playMusic(), stopMusic(), playSFX(name), setVolume(), toggleMute()
  └── Persistence: localStorage for muted/volume/musicEnabled
```

**Why Web Audio API over `<audio>` elements:**
- Single AudioContext manages all sounds
- GainNode provides smooth volume control with `linearRampToValueAtTime()` for fade-in/out
- Multiple SFX can play simultaneously without creating DOM elements
- Better latency for interaction sounds (pre-decoded audio buffers)

**Why NOT audio sprite sheets:**
Audio sprites (single file with multiple sounds at different time offsets) were useful in the `<audio>` element era to reduce HTTP requests. With Web Audio API + HTTP/2, individual small files are simpler:
- Each SFX is a separate `.webm` or `.mp3` file (2-10KB each)
- Pre-decode them into `AudioBuffer` objects on first user interaction
- Play from buffer (instant, zero latency)

### 4.4 Sound Design Inventory

| Sound | Trigger | Duration | Notes |
|-------|---------|----------|-------|
| Background music | After splash screen entry (looping) | 60-120s loop | Steampunk ambient -- ticking, steam hiss, low industrial hum. Must loop seamlessly. |
| Button click | Any `.brass-button` click | ~100ms | Mechanical click -- typewriter key or telegraph lever |
| Big Red Button press | BigRedButton activation | ~300ms | Heavy industrial button slam with metallic resonance |
| Lever tab switch | `.lever-tab` activation | ~150ms | Lever throw / switch flip |
| Modal open | Dialog iris animation start | ~200ms | Brass hinge / vault door opening |
| Modal close | Dialog close animation start | ~150ms | Brass hinge closing, shorter |
| Toggle switch | SteamToggle on/off | ~100ms | Steam release hiss (on) / valve close (off) |
| Success | Swap complete, stake complete | ~500ms | Coin clink + steam whistle |
| Error | Transaction failed | ~300ms | Harsh steam burst / pressure release |
| Carnage event | Carnage fund triggers | ~1000ms | Explosion + factory alarm (dramatic) |

### 4.5 Fade Patterns

**Music fade-in on entry:**
```typescript
// After user clicks splash button:
const gainNode = audioContext.createGain();
gainNode.gain.setValueAtTime(0, audioContext.currentTime);
gainNode.gain.linearRampToValueAtTime(
  userVolume,  // from localStorage, default 0.3
  audioContext.currentTime + 2.0  // 2-second fade-in
);
```

**Music duck during SFX (optional but polished):**
When important SFX plays (carnage explosion, success whistle), temporarily lower music volume:
```typescript
musicGain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.1);
// After SFX duration:
musicGain.gain.linearRampToValueAtTime(userVolume, ctx.currentTime + sfxDuration + 0.3);
```

### 4.6 Mobile Audio Activation

**Confidence: HIGH** (well-documented browser behavior)

**iOS Safari specific:** The AudioContext must be created AND `resume()` called within a touch event handler. Creating it outside and resuming later may fail.

**Pattern:**
```typescript
let audioCtx: AudioContext | null = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  // iOS may create it in "suspended" state
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Call initAudio() inside the splash screen button onClick handler.
// This works because onClick is a user-activation event in all browsers.
```

**Do NOT:**
- Create AudioContext in a useEffect (no user gesture)
- Create AudioContext in a setTimeout/requestAnimationFrame (not directly in gesture handler on iOS)
- Rely on `touchstart` alone (some frameworks prevent default, breaking the gesture chain)

### 4.7 Settings UI Components Needed

For the Settings modal:

| Control | Component | Persistence |
|---------|-----------|-------------|
| Master mute | `<SteamToggle>` | `localStorage: audio-muted` |
| Music on/off | `<SteamToggle>` | `localStorage: audio-music` |
| SFX on/off | `<SteamToggle>` | `localStorage: audio-sfx` |
| Master volume | `<BrassSlider>` (0-100) | `localStorage: audio-volume` |

---

## 5. MDX Documentation (Inline, Replacing iframe)

### 5.1 Current State

The docs are currently:
- A **separate Nextra 4 app** (`docs-site/`) running on port 3001
- Embedded via `<iframe>` in the `DocsStation` component
- 16 MDX pages across 5 categories (overview, gameplay, earning, launch, security, reference)
- Uses Nextra theme-docs for navigation, search (pagefind), and styling

The iframe approach has clear downsides:
- Separate deployment (docs-site must be hosted alongside the main app)
- No styling integration with the steampunk theme
- Iframe sandboxing creates navigation quirks
- Double bundle (Nextra app has its own React, Next.js runtime)
- Loading state / timeout fallback UX is poor

### 5.2 Approach: Inline MDX in Next.js App Router

**Confidence: MEDIUM** (Next.js MDX support is well-established, but specific v16.1.6 behavior should be verified)

**Recommended approach:** Move the 16 MDX files into the main app and render them natively using `@next/mdx` or `next-mdx-remote`.

**Option A: `@next/mdx` (compile-time MDX)**
- MDX files in `app/docs/[slug]/page.mdx` or imported statically
- Compiled at build time by Next.js
- Fastest rendering (zero runtime MDX parsing)
- Limitations: cannot load MDX from a database or CMS at runtime

**Option B: `next-mdx-remote` (runtime MDX)**
- MDX content stored as strings, parsed at request time or in RSC
- More flexible (could load from files, database, API)
- Slightly more setup but well-maintained library
- Allows custom component injection at render time

**Recommendation: Option A (`@next/mdx`)**. The docs are static content (16 pages, not user-generated), so compile-time is appropriate. No need for runtime flexibility. This keeps the zero-dependency ethos.

### 5.3 Required Packages

```bash
npm install @next/mdx @mdx-js/react
# Optional for syntax highlighting:
npm install rehype-pretty-code shiki
# Optional for diagrams:
# Mermaid via client-side rendering (see 5.6)
```

**Note:** Verify compatibility with Next.js 16.1.6. The `@next/mdx` package version should match the Next.js major version.

### 5.4 Custom MDX Components for Steampunk Theme

Each MDX element maps to a steampunk-styled React component:

| MDX Element | Custom Component | Steampunk Treatment |
|-------------|-----------------|-------------------|
| `# Heading` | `<h1>` | Cinzel serif font, factory-accent color, decorative rule below |
| `## Heading` | `<h2>` | Cinzel font, slightly smaller, brass underline |
| `> Blockquote` | `<Callout>` | 9-slice brass frame, amber background, "Dr. Fraudsworth says:" |
| `code block` | `<CodeBlock>` | Dark factory-bg with brass border, syntax highlighting |
| `table` | `<Table>` | Brass header row, alternating row shading with factory-surface tones |
| `a` (link) | `<Link>` | Factory-accent color, underline on hover, internal links navigate within modal |
| `img` | `<Image>` | Wrapped in brass frame, lazy loaded via Next.js Image |
| `---` | `<Divider>` | GaugeDivider component -- decorative pipe/rivet horizontal rule |

**Custom components (non-standard MDX):**

| Component | Usage in MDX | Purpose |
|-----------|-------------|---------|
| `<TokenBadge token="CRIME" />` | Inline colored token references | Shows token name with faction color dot |
| `<Formula>` | Mathematical formulas (tax calculations) | Monospace styled formula display |
| `<Diagram>` | System architecture diagrams | Wrapper for Mermaid or static SVG |
| `<Warning>` | Critical security/risk callouts | Red-bordered callout box |
| `<TipBox>` | Helpful tips | Amber-bordered callout box |

### 5.5 Navigation Within the Modal

The docs are viewed inside the ModalShell (DocsStation). Navigation needs to work differently from a full-page docs site:

**Recommended pattern:** Tab-based category navigation + scrollable content.

```
┌─────────────────────────────────────────────────┐
│ [Header: How It Works]                    [X]   │
├─────────────────────────────────────────────────┤
│ [Overview] [Gameplay] [Earning] [Security] [Ref]│  <- lever-tab bar
├─────────────────────────────────────────────────┤
│ ┌─ Sidebar ──┐ ┌─ Content ──────────────────┐  │
│ │ Page 1     │ │ # What is Dr. Fraudsworth?  │  │
│ │ Page 2 *   │ │                             │  │
│ │ Page 3     │ │ Lorem ipsum dolor sit amet  │  │
│ └────────────┘ │ ...                         │  │
│                └─────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

On mobile (<1024px), the sidebar becomes a top dropdown or collapses, and the full width is used for content.

**State management:** Use URL hash or React state (NOT URL path) since the docs are inside a modal, not a routed page. `useState` for `activeCategory` and `activePage` is sufficient.

### 5.6 Syntax Highlighting

**Recommendation: `rehype-pretty-code` with Shiki.**

**Confidence: MEDIUM** (well-known library, but verify current version compatibility)

- Shiki provides VS Code-quality syntax highlighting at build time
- Supports custom themes (can create a steampunk theme matching factory colors)
- Zero client-side JS for highlighting (all done at compile time)
- Alternative: `rehype-highlight` with highlight.js (simpler but less customizable)

Custom theme colors for code blocks:
```json
{
  "background": "#1c120a",
  "foreground": "#ecdcc4",
  "keyword": "#daa520",
  "string": "#5da84a",
  "number": "#e86050",
  "comment": "#8a7a62",
  "function": "#c89060"
}
```

### 5.7 Mermaid Diagrams

**Confidence: LOW** (Mermaid is well-known but integration with compile-time MDX varies; verify approach)

The existing docs have ASCII diagrams (like the tax flow in index.mdx). These could be upgraded to Mermaid.

**Option A: Client-side Mermaid rendering**
- `import mermaid from 'mermaid'` in a `<Diagram>` component
- Renders SVG on mount (client-side only)
- Works but adds ~200KB to client bundle

**Option B: Build-time Mermaid → SVG**
- Use `remark-mermaid` or `rehype-mermaid` plugin
- Converts Mermaid code blocks to inline SVG at build time
- Zero client-side cost
- Requires `playwright` or `puppeteer` at build time (heavy dependency)

**Option C: Pre-rendered SVG files**
- Render Mermaid diagrams manually, export as SVG, commit to repo
- Zero build/runtime cost
- Manual update process

**Recommendation: Option C for v1.1.** The 16 docs pages have ~3-4 diagrams total. Pre-rendering them as SVG files and including them via the `<Diagram>` MDX component is pragmatic. Automated Mermaid rendering can be added later if the docs grow significantly.

### 5.8 Search

The current Nextra docs use Pagefind for search. When moving to inline MDX:

**Option A: Simple Ctrl+F / browser search** -- since docs are in a modal with scrollable content, the browser's built-in find works.

**Option B: Client-side text search** -- index the MDX content at build time into a JSON structure, search with a simple `filter()` in a search input at the top of the docs modal. Lightweight, no dependencies.

**Recommendation: Option B.** A simple search input that filters the page list by title/content keywords. No need for full-text search indexing for 16 pages.

---

## 6. Modal UI Polish Patterns

### 6.1 Current State Assessment

The existing modal system is remarkably well-built:
- Native `<dialog>` with `showModal()` (correct approach)
- Focus trapping via native dialog inertness
- Iris-open clip-path animation with dialog-relative coordinate calculation
- Backdrop blur + dimming with animation
- Station crossfade without dialog close/reopen
- Body scroll lock
- Escape handling via `cancel` event (correct approach)
- Focus restoration to trigger element on close
- Mobile fullscreen with slide-up/down animations
- Privy wallet overlay compatibility via non-modal toggle
- `prefers-reduced-motion` respected

This is an unusually complete modal implementation. v1.1 polish is about visual refinement, not architectural changes.

### 6.2 Polish Opportunities

| Area | Current | Improvement | Complexity |
|------|---------|-------------|------------|
| Frame visual | CSS gradient + box-shadow + bolt divs | 9-slice border-image with AI-generated brass frame asset | Med |
| Header | Plain text on paper gradient | Riveted panel header with decorative bolts integrated into 9-slice | Low |
| Close button | CSS radial-gradient brass circle | Could use a small brass valve/gear asset image | Low |
| Scrollbar | `scrollbar-color` only (thin, two-tone) | Custom WebKit scrollbar with brass track texture | Low |
| Content transitions | CSS fade in/out | Could add subtle slide-in from bottom for new content | Low |
| Loading states | "Loading..." text | Gear-spinning skeleton (reuse splash animation) | Low |

### 6.3 Scroll Containment

**Confidence: HIGH** (standard CSS behavior)

The modal body already uses `overflow-y: auto` for scroll containment. Additional polish:

```css
/* Prevent scroll chaining: when the user scrolls to the end of the modal body,
   the scroll event should NOT propagate to the page behind the modal.
   overscroll-behavior: contain prevents this "scroll leak." */
.modal-body {
  overscroll-behavior: contain;
}
```

This is a one-line addition to the existing `.modal-body` rule in globals.css.

### 6.4 Animation Timing Reference

Current timings are well-calibrated. For reference and consistency with new components:

| Animation | Duration | Easing | Notes |
|-----------|----------|--------|-------|
| Iris open | 280ms | cubic-bezier(0.22, 1, 0.36, 1) | Overshoots slightly for theatrical feel |
| Modal close | 180ms | ease-in | Faster than open (dismissal feels snappy) |
| Backdrop fade-in | 280ms | ease-out | Matches iris duration |
| Backdrop fade-out | 180ms | ease-in | Matches close duration |
| Content crossfade | 150ms out + 200ms in | ease-in / ease-out | Out is faster for responsiveness |
| Mobile slide-up | 300ms | cubic-bezier(0.22, 1, 0.36, 1) | Slightly slower than desktop iris |
| Mobile slide-down | 200ms | ease-in | Matches desktop close feel |

New components should use similar durations:
- **Micro-interactions** (button press, toggle flip): 60-100ms
- **State transitions** (tab switch, content reveal): 150-200ms
- **Macro-transitions** (modal open/close): 180-300ms

### 6.5 Per-Modal Polish Notes

**Swap Station:**
- Chart container needs the 9-slice frame wrapper
- `<select>` elements in ChartControls should be styled or replaced with themed dropdowns
- BigRedButton already has excellent CSS -- no changes needed
- SwapStatsBar could benefit from a riveted panel header treatment

**Carnage Cauldron:**
- Stats display (burns, vault balance) could use gauge/meter components
- Event history list items could use brass bullet points or flame icons
- Dramatic red/amber color shift when vault is near trigger threshold

**Rewards Vat (Staking):**
- Tab bar already uses `.lever-tab` -- just needs texture refinement
- Staked amount display could use a pressure-gauge visual
- Reward rate could show as a flow-meter animation

**Connect Wallet:**
- Two-path layout is clean -- add decorative frames around each option card
- Wallet option buttons should use `.brass-button` styling (partially done)
- Could add steampunk icons (key for wallet, envelope for social login)

**Settings:**
- New audio controls section (toggle + slider)
- Existing slippage/priority fee controls get themed inputs
- Section dividers get `<GaugeDivider>` treatment

---

## 7. Design Token System

### 7.1 Current State

**Confidence: HIGH** (verified from globals.css in the codebase)

The project already has a comprehensive design token system using Tailwind v4 `@theme` variables:

**Existing tokens:**
- 3 background colors (bg, surface, surface-elevated)
- 2 border colors (border, border-subtle)
- 4 metal accents (primary, secondary, accent, glow)
- 3 text hierarchy levels (text, text-secondary, text-muted)
- 3 status colors (success, error, warning)
- 3 status surface/border/text triplets
- 3 faction identity colors (crime, fraud, profit)
- Interactive state tokens (active, active-surface)
- 7-level z-index system
- 6-level typography scale
- 6 custom animations

This is already an excellent foundation. v1.1 additions should extend it, not replace it.

### 7.2 New Tokens Needed for v1.1

| Token | Value | Purpose |
|-------|-------|---------|
| `--color-factory-paper` | `#f5e6c8` | Aged paper background (currently hardcoded in .modal-chrome) |
| `--color-factory-paper-dark` | `#e8d5a8` | Darker paper for contrast within paper areas |
| `--color-factory-ink` | `#2a1f0e` | Dark ink text on paper surfaces (currently hardcoded in .modal-header h2) |
| `--color-factory-brass-light` | `#f0c050` | Same as glow but semantic name for frame highlights |
| `--color-factory-brass-dark` | `#8b6914` | Dark brass for shadows/borders on paper surfaces |
| `--spacing-frame-border` | `48px` | Standard 9-slice border width (for consistent frame sizing) |
| `--spacing-frame-padding` | `1.5rem` | Content padding inside framed elements |
| `--animate-lever-press` | `lever-press 100ms ease` | Mechanical lever/button depression animation |
| `--animate-gauge-fill` | `gauge-fill 600ms ease-out` | For animated gauge/meter fills |
| `--animate-steam-puff` | `steam-puff 400ms ease-out` | Decorative steam effect on interactions |

### 7.3 Token Architecture Principle

**Two visual domains, one token system:**

1. **Paper domain** (modal chrome, docs): Light backgrounds (`--paper`, `--ink`), brass accents
2. **Dark domain** (station content, DeFi UI): Dark backgrounds (`--bg`, `--surface`), light text

Both domains share brass/metal accent tokens (`--accent`, `--glow`, `--primary`). This is already the pattern in use -- the `.modal-chrome` is paper-toned and `.station-content` is dark-toned.

New tokens should respect this dichotomy. Do not add tokens that work in only one domain without making the naming clear (e.g., `--factory-paper` clearly belongs to the paper domain).

### 7.4 Component Token Mapping

How each component type maps to the token system:

```
SteampunkFrame:
  border-image:     asset-based (not tokenized)
  box-shadow:       --factory-glow (outer glow)
  inner-background: --factory-paper (paper domain)
                    OR --factory-bg (dark domain)

BrassButton:
  background:       gradient of --factory-surface-elevated -> --factory-surface
  border:           --factory-border
  text:             --factory-text
  hover-glow:       --factory-glow at 20% opacity
  active-shadow:    --factory-border (inset)

BrassInput:
  background:       --factory-surface
  border:           --factory-border
  text:             --factory-text
  placeholder:      --factory-text-muted
  focus-border:     --factory-accent
  focus-glow:       --factory-glow at 30% opacity

LeverTab:
  inactive:         gradient --factory-surface-elevated -> --factory-surface
  active:           --factory-surface + --factory-accent border
  text-inactive:    --factory-text-secondary
  text-active:      --factory-accent
```

---

## 8. Feature Dependencies

```
                      ┌──────────────────┐
                      │  Design Tokens   │  (extend existing @theme)
                      │  (foundation)    │
                      └────────┬─────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
     │  9-Slice Frame │ │ Brass Button │ │ Brass Input  │
     │  Component     │ │  (upgrade)   │ │  (upgrade)   │
     └────────┬──────┘ └──────┬───────┘ └──────┬───────┘
              │                │                │
     ┌────────▼──────────────────────────────────▼───────┐
     │                Component Kit                       │
     │  (Toggle, Slider, Tabs, Cards, Dividers, etc.)    │
     └────────┬──────────────────────────────────┬───────┘
              │                                   │
     ┌────────▼──────┐                   ┌───────▼────────┐
     │  Modal Polish  │                   │ MDX Docs       │
     │  (5 stations)  │                   │ (styled with   │
     │                │                   │  component kit)│
     └────────┬──────┘                   └───────┬────────┘
              │                                   │
              │              ┌───────────────┐    │
              └──────────────▶ Charts Overhaul│    │
                             │ (frame + UX)  │    │
                             └───────────────┘    │
                                                  │
     ┌──────────────┐                              │
     │ Audio System  │  (independent -- can be     │
     │ (parallel)    │   built in parallel with    │
     └──────────────┘   everything except Settings │
                        modal which needs toggle/  │
                        slider components)          │
```

**Key dependency chain:** Tokens -> 9-Slice + Components -> Modal Polish + Docs + Charts

**Parallel track:** Audio system is independent of visual components except that Settings modal needs toggle/slider components from the component kit.

---

## 9. MVP Recommendation

### Priority 1: Foundation (must be first)
1. **Design token extensions** -- add missing tokens to globals.css @theme
2. **9-slice frame component** -- the core visual primitive everything else wraps
3. **Brass button/input/tab upgrades** -- refine existing classes with asset textures

### Priority 2: Visible Impact (biggest user-facing improvement)
4. **Modal polish (5 stations)** -- apply component kit to all modals
5. **Charts overhaul** -- custom tooltip, volume histogram, OHLC legend, steampunk frame
6. **MDX docs migration** -- remove iframe, render inline with steampunk styling

### Priority 3: Atmosphere (polish layer)
7. **Audio system** -- background music + SFX + settings controls
8. **Decorative touches** -- steam particles, animated dividers, pressure gauges

### Defer to post-v1.1
- **Custom dropdown/select component**: High complexity for the accessibility-correct version. Use styled native `<select>` for now.
- **Mermaid diagram automation**: Pre-render SVGs manually for the 3-4 diagrams.
- **3D/WebGL effects**: Never build these. CSS achieves the steampunk look.

---

## 10. Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| 9-slice CSS | HIGH | CSS border-image is stable, well-documented, 10+ years in browsers |
| Component architecture | HIGH | Based on existing codebase patterns that are already working well |
| TradingView theming | MEDIUM | API surface based on training data for v5; specific options should be verified against current v5.1.0 docs |
| Audio autoplay policy | HIGH | Browser autoplay restrictions are well-established and stable since 2018 |
| Web Audio API patterns | MEDIUM | Core API is stable; specific method signatures should be verified |
| MDX in Next.js 16 | MEDIUM | @next/mdx has existed for years but v16.1.6 specifics should be verified |
| Mermaid integration | LOW | Multiple approaches exist; build-time vs runtime tradeoffs need verification |
| Modal polish | HIGH | Based on direct analysis of the existing codebase |
| Design tokens | HIGH | Existing system is well-structured; extensions are straightforward |

---

## 11. Sources

All findings in this document are based on:
1. **Direct codebase analysis** of the current Dr. Fraudsworth frontend (HIGH confidence)
2. **Training data** through May 2025 for CSS specifications, Web Audio API, and library APIs (MEDIUM confidence -- flagged per-section)
3. **WebSearch and WebFetch were unavailable** during this research session. Findings that rely on training data alone are marked MEDIUM or LOW confidence.

**Verification recommended before implementation:**
- TradingView lightweight-charts v5.1.0 API docs (custom tooltip, watermark, histogram)
- Next.js 16.1.6 MDX configuration (verify @next/mdx compatibility)
- `rehype-pretty-code` + Shiki compatibility with Next.js 16 / Turbopack
- Web Audio API `AudioContext.resume()` behavior on current iOS Safari (2026)
