# Technology Stack: v1.1 "Modal Mastercraft, Docs & Audio"

**Project:** Dr. Fraudsworth's Finance Factory
**Milestone:** v1.1 (Phases 60-68)
**Researched:** 2026-02-24
**Research tools available:** Codebase analysis, installed package typings. WebSearch and WebFetch were unavailable during this session -- findings rely on training data verified against installed packages where possible.

---

## 1. CSS border-image / 9-Slice Technique (Phase 60)

### Recommendation: Use `border-image` with `border-image-slice` for the steampunk frame system

**Confidence: MEDIUM** (based on well-established CSS spec, verified against known browser support)

### How It Works

The CSS `border-image` property family takes a single image and slices it into 9 regions: four corners, four edges, and a center fill. The browser stretches or tiles the edge pieces to fit the element's dimensions while keeping corners pixel-perfect.

```css
.steampunk-frame {
  /* Source image: the 9-slice sprite */
  border-image-source: url('/components/frames/brass-frame.webp');

  /* Slice insets: distance from each edge to define the 9 regions.
     Values are in image pixels (unitless) or percentages.
     The "fill" keyword tells the browser to also render the center slice
     as the element background (without it, center is transparent). */
  border-image-slice: 40 fill;

  /* Width: how wide the border-image renders on the element.
     Can differ from the actual CSS border-width. */
  border-image-width: 40px;

  /* Outset: how far the border-image extends beyond the border box.
     Useful for decorative frames that shouldn't eat into content space. */
  border-image-outset: 0;

  /* Repeat: how edge slices fill the space between corners.
     "stretch" (default) -- stretches to fill. Best for smooth gradients.
     "repeat" -- tiles at natural size, may clip at edges.
     "round" -- tiles but rescales to fit evenly (no clipping).
     "space" -- tiles with even spacing between repetitions. */
  border-image-repeat: stretch;
}
```

### Shorthand Syntax

```css
.steampunk-frame {
  /* border-image: source slice / width / outset repeat */
  border-image: url('/components/frames/brass-frame.webp') 40 fill / 40px / 0 stretch;
}
```

### Key Decisions for the Component Kit

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **Image format** | WebP | Project already uses WebP for all scene assets. Next.js Image optimization pipeline is configured for it. |
| **Slice values** | Unitless pixels, NOT percentages | Pixel values are easier to control and match Photoshop slice guides exactly. |
| **Repeat mode** | `stretch` for brass frames, `round` for chain/rivet borders | Smooth metal gradients should stretch. Repeating decorative elements (rivets, chains) should round to avoid partial tiles. |
| **Fill keyword** | Include `fill` for card-type frames, omit for border-only frames | Cards with paper/leather interior need the center slice rendered. Pure border decorations don't need it. |
| **Outset** | 0 for most components, small positive for decorative overlapping frames | Keep border-image within the border box by default to avoid layout surprises. |

### Browser Support

`border-image` has been supported in all modern browsers since 2014+. Baseline widely available:
- Chrome 16+
- Firefox 15+
- Safari 6+
- Edge 12+

**No polyfills needed.** This is one of the most well-supported CSS features.

### Performance Considerations

- **GPU compositing:** `border-image` is rendered by the browser's painting pipeline. It does NOT trigger layout -- only paint. Repainting happens when the element changes size.
- **Image size matters:** Use appropriately sized source images. A 200x200px 9-slice sprite is ideal -- large enough for crisp corners at 2x, small enough to decode quickly. WebP compression makes this negligible.
- **Avoid animating `border-image-slice`:** Changing slice values triggers repaint. If you need animated frames, animate the content inside instead.
- **Multiple frames per page:** Each unique `border-image-source` is a separate HTTP request. Use a single sprite sheet per frame style, or consider CSS `image-set()` for density variants.

### Gotchas and Pitfalls

1. **`border-image` overrides `border-radius`**: When border-image is set, `border-radius` is completely ignored. For rounded corners, the 9-slice image itself must have rounded corners baked in, or use a wrapper approach (outer div with border-radius + overflow:hidden, inner div with border-image).

2. **`border-image-width` vs `border-width`**: These are independent. `border-image-width` controls how much space the border image occupies. If `border-image-width` is not set, it falls back to `border-width`. Set both explicitly to avoid confusion.

3. **Box model interaction**: `border-image-width` DOES affect layout (it takes space like a border). But `border-image-outset` pushes the image outside the border box WITHOUT affecting layout -- content and padding are unaffected, but the image may overlap adjacent elements.

4. **No `box-shadow` stacking**: Since `border-radius` is ignored, any `box-shadow` on the element will also render as rectangular (shadow follows the border-box, not the image shape). The existing modal chrome uses `box-shadow` extensively -- this is a conflict to plan for.

### Recommended Architecture for Component Kit

```
public/
  components/
    frames/
      brass-panel.webp       -- Standard panel frame (buttons, cards)
      brass-panel-wide.webp  -- Wider corner for large modals
      leather-inset.webp     -- Inset leather texture for content areas
      rivet-border.webp      -- Chain/rivet repeating border
    sprites/
      gauge-bg.webp          -- Circular gauge background
      slider-track.webp      -- Horizontal track for sliders
      toggle-housing.webp    -- Toggle switch housing

app/
  components/
    kit/
      SteampunkFrame.tsx     -- Wrapper applying border-image from props
      SteampunkButton.tsx    -- Button with 9-slice brass frame
      SteampunkInput.tsx     -- Input with recessed gauge frame
      SteampunkCard.tsx      -- Card with 9-slice panel
      SteampunkSlider.tsx    -- Range slider with custom track/thumb
      SteampunkToggle.tsx    -- Toggle with housing sprite
      SteampunkTabs.tsx      -- Lever-tab with 9-slice
      SteampunkDivider.tsx   -- Decorative divider (chain/pipe)
      SteampunkScrollbar.tsx -- Custom scrollbar styling
```

### Alternative: CSS `background` + `padding` Instead of `border-image`

For elements where `border-radius` or `box-shadow` stacking is needed, consider using `background-image` with carefully sized padding instead of `border-image`. This preserves `border-radius` but requires manual sizing. Use this as a fallback for specific components, not as the primary approach.

---

## 2. TradingView Lightweight Charts v5 Theming (Phase 61)

### Recommendation: Use the existing v5 installation (5.1.0), leverage `applyOptions()` for full restyling

**Confidence: HIGH** (verified against installed `dist/typings.d.ts` in `node_modules/lightweight-charts`)

### Current State

The project already has a working `CandlestickChart.tsx` using lightweight-charts v5.1.0 with hardcoded hex color values matching the factory theme tokens. The chart works correctly but uses inline hex values rather than reading CSS custom properties.

### v5 Theming API (Verified from Installed Typings)

**ChartOptions (via `createChart` or `chart.applyOptions`):**

```typescript
{
  layout: {
    background: { type: ColorType.Solid, color: string },
    // OR gradient:
    // background: { type: ColorType.VerticalGradient, topColor: string, bottomColor: string },
    textColor: string,           // Scale label text
    fontSize: number,            // Scale label font size (default: 12)
    fontFamily: string,          // Scale label font family
    attributionLogo: boolean,    // TradingView logo (can disable if attribution met elsewhere)
  },
  grid: {
    vertLines: { color: string, style?: LineStyle, visible?: boolean },
    horzLines: { color: string, style?: LineStyle, visible?: boolean },
  },
  crosshair: {
    horzLine: {
      color: string,
      labelBackgroundColor: string,
      // style, width, visible, labelVisible
    },
    vertLine: {
      color: string,
      labelBackgroundColor: string,
    },
  },
  rightPriceScale: {
    borderColor: string,
    // borderVisible, textColor (inherits from layout.textColor)
  },
  timeScale: {
    borderColor: string,
    timeVisible: boolean,
    secondsVisible: boolean,
  },
}
```

**CandlestickSeries Options (via `chart.addSeries(CandlestickSeries, options)` or `series.applyOptions`):**

```typescript
{
  upColor: string,         // Rising candle body color
  downColor: string,       // Falling candle body color
  borderVisible: boolean,  // Whether candle borders are drawn
  borderUpColor: string,   // Rising candle border
  borderDownColor: string, // Falling candle border
  wickVisible: boolean,    // Whether wicks are drawn
  wickColor: string,       // Generic wick color
  wickUpColor: string,     // Rising wick color
  wickDownColor: string,   // Falling wick color
  priceFormat: {
    type: 'custom',
    formatter: (price: number) => string,
    minMove: number,
  },
}
```

### Recommended Restyling Approach

Rather than reading CSS custom properties at runtime (which adds complexity for a canvas-based renderer), maintain a TypeScript theme constants file that mirrors the globals.css token values:

```typescript
// lib/chart-theme.ts
export const CHART_THEME = {
  // Layout
  background: '#1c120a',        // --color-factory-bg
  textColor: '#bca88a',         // --color-factory-text-secondary
  fontFamily: "'IBM Plex Mono', monospace",

  // Grid
  gridColor: '#4a3520',         // --color-factory-border-subtle
  borderColor: '#86644a',       // --color-factory-border

  // Crosshair
  crosshairColor: '#86644a',    // --color-factory-border
  crosshairLabelBg: '#2c1e12',  // --color-factory-surface

  // Candles
  upColor: '#5da84a',           // --color-factory-success
  downColor: '#c04030',         // --color-factory-error

  // New in v1.1: additional steampunk touches
  upWickColor: '#7ac068',       // Lighter green for wick visibility
  downWickColor: '#d45a4a',     // Lighter red for wick visibility
} as const;
```

### New v5 Features to Leverage for Restyling

| Feature | Status | Use Case |
|---------|--------|----------|
| `autoSize: true` | Available in v5.1.0 | Replace manual ResizeObserver with built-in auto-resize. Simplifies `CandlestickChart.tsx`. |
| `attributionLogo: false` | Available | Disable in-chart logo (attribution can be provided via link in footer per Apache-2.0 license). |
| `VerticalGradient` background | Available | Could use subtle gradient from `#1c120a` to `#2c1e12` for depth. |
| `createTextWatermark()` | Available (exported function) | Add pair name watermark text behind candles. |
| `createImageWatermark()` | Available (exported function) | Could add subtle factory logo/gear watermark. |
| Pane separators | Available (`layout.panes`) | Color separator between volume and price panes if volume is added. |
| Custom color parsers | Available | Not needed -- hex colors are sufficient. |

### Critical v5 API Notes (Confirmed from Typings)

- **Series creation:** `chart.addSeries(CandlestickSeries, options)` -- NOT `chart.addCandlestickSeries()` (v4 API, removed in v5).
- **Exports:** `CandlestickSeries` is exported as `candlestickSeries` (lowercase) in the typings but the existing code imports `CandlestickSeries` (PascalCase). Both work because the type-level definition maps `SeriesDefinition<"Candlestick">`.
- **ESM only:** v5 ships only `.mjs` files. This works natively with Turbopack.
- **`applyOptions` for live updates:** Both chart and series support `applyOptions()` for dynamic theme changes without recreation.

---

## 3. Browser Audio: Web Audio API vs Howler.js vs Tone.js (Phase 68)

### Recommendation: Use the Web Audio API directly (zero npm dependencies)

**Confidence: MEDIUM** (based on training knowledge of Web Audio API; no live verification possible)

### Comparison

| Criterion | Web Audio API (Native) | Howler.js | Tone.js |
|-----------|----------------------|-----------|---------|
| **Bundle size** | 0 KB (browser built-in) | ~10 KB gzipped | ~150 KB gzipped |
| **npm dependency** | None | Yes | Yes |
| **Learning curve** | Moderate | Low | High |
| **SFX playback** | Excellent | Excellent | Overkill |
| **Background music** | Good (manual looping) | Excellent (built-in loop) | Excellent |
| **Volume control** | GainNode | volume property | Built-in |
| **Spatial audio** | Full 3D | Basic panning | Full 3D |
| **Browser support** | All modern browsers | All modern browsers | All modern browsers |
| **Mobile autoplay** | Requires user gesture | Handles unlock automatically | Handles unlock automatically |
| **Turbopack compat** | N/A (no import) | NEEDS VERIFICATION | NEEDS VERIFICATION |

### Why Web Audio API (Zero Dependencies)

The project philosophy is clear: "zero npm dependencies beyond Next.js Image and Tailwind." The existing codebase has NO audio library dependencies, and the Sentry experience (MEMORY.md) demonstrates that npm packages can break Turbopack in unexpected ways. The Web Audio API provides everything needed for this use case:

1. **Background music:** Load a buffer, create a source node, connect through a GainNode, loop.
2. **Sound effects:** Pre-decode audio buffers, play on demand with individual GainNode per SFX.
3. **Volume control:** GainNode.gain.value (0.0 to 1.0).
4. **Mute:** Set master GainNode to 0.

### Architecture: Audio Manager Singleton

```typescript
// lib/audio.ts -- Zero-dependency audio manager

class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private musicSource: AudioBufferSourceNode | null = null;

  // Lazy init: AudioContext must be created after user gesture
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      // Routing: sfx -> master -> destination
      //          music -> master -> destination
      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
    // Resume if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  async preload(name: string, url: string): Promise<void> {
    if (this.buffers.has(name)) return;
    const ctx = this.ensureContext();
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    this.buffers.set(name, audioBuffer);
  }

  playSFX(name: string): void {
    const ctx = this.ensureContext();
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxGain!);
    source.start(0);
  }

  playMusic(name: string, loop = true): void {
    this.stopMusic();
    const ctx = this.ensureContext();
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    this.musicSource = ctx.createBufferSource();
    this.musicSource.buffer = buffer;
    this.musicSource.loop = loop;
    this.musicSource.connect(this.musicGain!);
    this.musicSource.start(0);
  }

  stopMusic(): void {
    this.musicSource?.stop();
    this.musicSource = null;
  }

  setMasterVolume(v: number): void { if (this.masterGain) this.masterGain.gain.value = v; }
  setMusicVolume(v: number): void { if (this.musicGain) this.musicGain.gain.value = v; }
  setSFXVolume(v: number): void { if (this.sfxGain) this.sfxGain.gain.value = v; }
  mute(): void { this.setMasterVolume(0); }
  unmute(v = 1): void { this.setMasterVolume(v); }
}

export const audioManager = new AudioManager();
```

### Critical: Browser Autoplay Policy

**All modern browsers block audio playback until a user gesture (click, tap, keydown) has occurred.** This is the single most important constraint for Phase 68.

**Strategy:**
1. The splash screen "Push the Button" click is the first user gesture -- use it to create and resume the AudioContext.
2. On splash button click: `audioManager.ensureContext()` + optionally start background music.
3. All subsequent SFX calls will work because the context is already unlocked.
4. If user navigates directly (bypassing splash on return visits), any first click on the page unlocks audio.

### Audio File Format Recommendation

| Format | Size | Browser Support | Use Case |
|--------|------|----------------|----------|
| **OGG Vorbis** (.ogg) | Smallest | All except Safari (iOS/macOS) | NOT recommended as sole format |
| **MP3** (.mp3) | Medium | Universal | Good fallback |
| **AAC** (.m4a) | Medium | Universal | Good alternative |
| **WebM Opus** (.webm) | Smallest with quality | Chrome, Firefox, Edge (NOT Safari) | NOT recommended as sole format |
| **WAV** (.wav) | Largest | Universal | Only for tiny SFX (<50KB) |

**Recommendation:** Use **MP3** for universal compatibility. File sizes for short SFX (button clicks, lever pulls, gear sounds) will be 5-30 KB each. Background music loops at 128kbps MP3 will be ~500KB-1MB for a 30-60 second loop.

Alternatively, provide dual formats (OGG + MP3) with runtime detection:

```typescript
const canPlayOgg = new Audio().canPlayType('audio/ogg; codecs=vorbis') !== '';
const ext = canPlayOgg ? '.ogg' : '.mp3';
```

### CSP Consideration

Audio files served from `/public/audio/` will be same-origin. No CSP changes needed. If loading from CDN, add the CDN domain to `connect-src` in `next.config.ts`.

### Sound Effect Categories for Steampunk Theme

| Category | Examples | Suggested Format |
|----------|----------|-----------------|
| **UI clicks** | Button press, lever toggle, tab switch | MP3, 5-15KB each |
| **Mechanical** | Gear turn, steam hiss, pipe clank | MP3, 15-40KB each |
| **Transaction** | Swap confirm, stake deposit, reward claim | MP3, 20-50KB each |
| **Ambient/Music** | Steampunk workshop loop, factory ambience | MP3, 500KB-1.5MB |
| **Notifications** | Toast appear, error buzz, success chime | MP3, 10-25KB each |

### User Controls Architecture

Store audio preferences in `localStorage`:

```typescript
interface AudioPrefs {
  masterVolume: number;  // 0.0 - 1.0
  musicVolume: number;   // 0.0 - 1.0
  sfxVolume: number;     // 0.0 - 1.0
  muted: boolean;
}
```

Expose via React hook (`useAudio`) that wraps the singleton AudioManager and syncs with localStorage. The Settings modal (Phase 66) will include volume sliders built with the SteampunkSlider component (Phase 60).

---

## 4. Next.js MDX for Documentation Overhaul (Phase 67)

### Recommendation: Use `@next/mdx` with Turbopack for inline MDX, eliminating the separate docs-site

**Confidence: MEDIUM** (based on training knowledge of Next.js MDX support; needs live verification of Turbopack compatibility)

### Current State

The documentation currently lives in a **separate Nextra-powered Next.js 15 app** (`docs-site/`) that runs on its own port and is embedded via iframe in the main app's "Docs" modal. This has several problems:

1. **Two separate deployments** (main app + docs-site on Railway)
2. **iframe embedding** requires CSP `frame-src` exceptions and `X-Frame-Options` configuration
3. **Nextra 4 + Next.js 15** is a different stack than the main app (Next.js 16)
4. **16 MDX pages** need rewriting anyway per the milestone plan

### Options Evaluated

| Approach | Turbopack Compatible? | Dependencies | Complexity |
|----------|----------------------|--------------|------------|
| **@next/mdx** (official) | YES (first-party) | `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react` | Low -- pages are `.mdx` files in `app/` |
| **next-mdx-remote** | NEEDS VERIFICATION | `next-mdx-remote` | Medium -- content loaded at build/runtime |
| **Manual markdown→HTML** | YES (no loader needed) | `unified`, `remark`, `rehype` (or `marked`) | Medium-High -- manual pipeline |
| **Keep Nextra (iframe)** | N/A (separate app) | Nextra, nextra-theme-docs | High (two deployments) |

### Recommended: `@next/mdx` (Official Next.js Integration)

**Why:**
1. **First-party Turbopack support** -- `@next/mdx` is maintained by the Next.js team and is explicitly listed as compatible with Turbopack.
2. **Zero runtime overhead** -- MDX is compiled to React components at build time.
3. **Component overrides** -- Use `mdx-components.tsx` at the app root to map standard Markdown elements (h1, h2, p, a, code, table, etc.) to steampunk-styled components.
4. **Eliminates iframe** -- Docs pages become regular routes or components inside the modal.
5. **Eliminates separate deployment** -- No more docs-site on Railway.

### Setup

```bash
npm install @next/mdx @mdx-js/loader @mdx-js/react
```

```typescript
// next.config.ts (addition)
import createMDX from '@next/mdx';

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    // remarkPlugins and rehypePlugins for GFM tables, syntax highlighting, etc.
  },
});

export default withMDX(nextConfig);
```

```typescript
// mdx-components.tsx (app root)
import type { MDXComponents } from 'mdx/types';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => <h1 className="font-heading text-heading text-factory-accent">{children}</h1>,
    h2: ({ children }) => <h2 className="font-heading text-subheading text-factory-primary">{children}</h2>,
    p: ({ children }) => <p className="text-factory-text text-body leading-relaxed">{children}</p>,
    a: ({ href, children }) => <a href={href} className="text-factory-accent underline">{children}</a>,
    table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse">{children}</table></div>,
    code: ({ children }) => <code className="bg-factory-surface px-1.5 py-0.5 rounded text-factory-glow font-mono text-detail">{children}</code>,
    // ... steampunk-styled overrides for all MDX elements
    ...components,
  };
}
```

### Content Organization

Move docs content from `docs-site/content/` to the main app:

```
app/
  content/
    docs/
      overview/
        what-is-dr-fraudsworth.mdx
        how-it-works.mdx
        three-tokens.mdx
      gameplay/
        epoch-rounds.mdx
        tax-regime.mdx
        carnage-fund.mdx
        soft-peg.mdx
      earning/
        profit-and-yield.mdx
        arbitrage.mdx
      launch/
        bonding-curve.mdx
        pool-seeding.mdx
      security/
        protocol-guarantees.mdx
        how-randomness-works.mdx
      reference/
        tokenomics.mdx
        glossary.mdx
```

### Rendering Strategy for Modal

Two approaches for rendering MDX inside the docs modal:

**Option A: Dynamic import (recommended)**
```typescript
// Lazy-load each MDX page as a React component
const DocsPage = lazy(() => import(`@/content/docs/${section}/${page}.mdx`));
```

**Option B: Route-based**
Make docs actual routes (`app/docs/[...slug]/page.tsx`) and render in the modal via intercepting routes or a shared layout.

**Recommendation:** Option A (dynamic import) keeps docs inside the existing modal system without creating new routes. The modal's `ModalContent` component already uses lazy loading for station content -- docs pages would follow the same pattern.

### NEEDS VERIFICATION Flag

The `@next/mdx` + Turbopack combination should work based on Next.js team's stated support, but the specific version (Next.js 16.1.6 + Turbopack) should be tested early in Phase 67. If it fails, fall back to `next-mdx-remote/rsc` which compiles MDX at request time (no loader required, no Turbopack integration needed).

### Alternative: next-mdx-remote (Backup Plan)

If `@next/mdx` has Turbopack issues:

```typescript
import { compileMDX } from 'next-mdx-remote/rsc';
import fs from 'fs/promises';

async function DocsPage({ slug }: { slug: string }) {
  const source = await fs.readFile(`content/docs/${slug}.mdx`, 'utf8');
  const { content } = await compileMDX({
    source,
    components: steampunkComponents,
  });
  return content;
}
```

This approach requires server components (which the app already uses) and has zero Turbopack dependency since it does its own compilation.

---

## 5. CSS Custom Properties + Tailwind v4 Design Token System (Phase 60)

### Recommendation: Extend the existing `@theme` system in globals.css -- it already does exactly what is needed

**Confidence: HIGH** (verified from actual `globals.css` in the codebase)

### Current State (Already Excellent)

The project already has a comprehensive Tailwind v4 design token system in `globals.css` using the `@theme` directive. This is verified directly from the codebase:

```css
@theme {
  /* Colors generate: bg-factory-*, text-factory-*, border-factory-* */
  --color-factory-bg: #1c120a;
  --color-factory-surface: #2c1e12;
  --color-factory-surface-elevated: #3d2b1a;
  --color-factory-border: #86644a;
  --color-factory-accent: #daa520;
  /* ... 30+ tokens total */

  /* Z-index generates: z-background, z-overlays, z-modal, etc. */
  --z-index-modal: 50;
  /* ... */

  /* Typography generates: text-display, text-heading, etc. */
  --text-display: 3rem;
  /* ... */

  /* Animations generate: animate-fade-in, animate-iris-open, etc. */
  --animate-fade-in: fade-in 0.6s ease-out;
  /* ... */
}
```

### What Phase 60 Should ADD (Not Replace)

The component kit needs these additional tokens for the 9-slice frame system:

```css
@theme {
  /* === Component Kit Frame Tokens (Phase 60) === */

  /* 9-slice border widths for different frame styles */
  --spacing-frame-sm: 24px;      /* Small frame (inputs, badges) */
  --spacing-frame-md: 40px;      /* Medium frame (cards, panels) */
  --spacing-frame-lg: 56px;      /* Large frame (modals, full panels) */

  /* Component-specific interactive tokens */
  --color-factory-slider-track: #3d2b1a;
  --color-factory-slider-fill: #daa520;
  --color-factory-slider-thumb: #c89060;
  --color-factory-toggle-off: #3d2b1a;
  --color-factory-toggle-on: #daa520;
  --color-factory-scrollbar-track: #2c1e12;
  --color-factory-scrollbar-thumb: #86644a;

  /* Transition timing for mechanical feel */
  --animate-lever-press: lever-press 100ms ease-out;
  --animate-gear-click: gear-click 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

### Tailwind v4 `@theme` Specifics

Tailwind v4 (version 4.1.18, confirmed from package.json) uses `@theme` to define design tokens that automatically generate utility classes:

- `--color-*` generates `bg-*`, `text-*`, `border-*`, `ring-*`, etc.
- `--spacing-*` generates `p-*`, `m-*`, `w-*`, `h-*`, `gap-*`, etc.
- `--text-*` generates `text-*` (font-size)
- `--font-*` generates `font-*` (font-family)
- `--animate-*` generates `animate-*`
- `--z-index-*` generates `z-*`

The `@theme inline` variant (already used for font-family bridging) inlines `var()` references instead of creating intermediate custom properties.

### No Additional Dependencies Needed

The existing Tailwind v4 + PostCSS setup handles everything. No need for additional theming libraries, CSS-in-JS solutions, or custom PostCSS plugins.

---

## 6. Image Optimization: WebP Asset Pipeline (Phase 60)

### Recommendation: Continue the existing WebP pipeline with Next.js Image component for scene assets, raw CSS `url()` for 9-slice sprites

**Confidence: HIGH** (verified from next.config.ts and existing public/ directory structure)

### Current Pipeline

From `next.config.ts`:
```typescript
images: {
  qualities: [75, 80, 82, 85],
  formats: ["image/webp"],
  deviceSizes: [1920, 2560, 3840],
},
```

Existing WebP assets in `public/scene/`:
- Background: 3 resolution variants (1920, 2560, 3840)
- Overlays: 7 station-specific WebP files
- Splash: 2 PNG files (wheel, wheelbutton)

### 9-Slice Sprite Strategy

**Critical distinction:** Next.js `<Image>` component is for content images (responsive, lazy-loaded, optimized). CSS `border-image` uses `url()` which bypasses Next.js Image optimization entirely.

For 9-slice sprites used in `border-image`:
1. **Pre-optimize in Photoshop/design tool** -- Export at 2x size as WebP with quality 85
2. **Store in `public/components/frames/`** -- Direct URL access via `/components/frames/brass-panel.webp`
3. **No Next.js Image component** -- `border-image-source: url(...)` loads directly
4. **Cache headers** -- These assets are immutable. Add `Cache-Control: public, max-age=31536000, immutable` via Next.js headers config.

### Recommended Sprite Sizes

| Sprite | Dimensions | Use Case | Expected Size |
|--------|-----------|----------|---------------|
| brass-panel.webp | 200x200 | Standard card/panel frame | 5-15 KB |
| brass-panel-wide.webp | 300x200 | Wide panel variant | 8-20 KB |
| leather-inset.webp | 160x160 | Content area background | 4-10 KB |
| rivet-border.webp | 80x80 | Repeating rivet border | 2-5 KB |
| gauge-bg.webp | 120x120 | Circular gauge elements | 3-8 KB |

Total new asset weight: estimated 22-58 KB (negligible with WebP compression).

### Adding Cache Headers for Static Assets

```typescript
// next.config.ts (addition to existing headers)
{
  source: "/components/:path*",
  headers: [
    {
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    },
  ],
},
```

---

## Stack Summary Table

| Area | Technology | Version | New Dep? | Confidence |
|------|-----------|---------|----------|------------|
| **9-slice frames** | CSS `border-image` | CSS3 | No | MEDIUM |
| **Chart theming** | lightweight-charts | 5.1.0 (installed) | No | HIGH |
| **Audio** | Web Audio API | Browser native | No | MEDIUM |
| **MDX docs** | @next/mdx | Latest | Yes (3 pkgs) | MEDIUM |
| **Design tokens** | Tailwind v4 @theme | 4.1.18 (installed) | No | HIGH |
| **Image pipeline** | WebP + Next.js Image | N/A | No | HIGH |

### New Dependencies Summary

Only Phase 67 (Documentation) requires new npm packages:

```bash
npm install @next/mdx @mdx-js/loader @mdx-js/react
```

All other phases use zero new dependencies -- CSS-native features, already-installed packages, or browser-native APIs.

### Dependencies NOT Recommended

| Library | Why Not |
|---------|---------|
| **Howler.js** | Adds npm dependency; project philosophy is zero deps where possible; Turbopack compatibility unknown |
| **Tone.js** | Massive (~150KB); designed for music production, overkill for SFX+background music |
| **Framer Motion** | Would add animation library when CSS animations already work perfectly in existing modal system |
| **styled-components / Emotion** | Tailwind v4 + CSS custom properties handles theming; no CSS-in-JS needed |
| **Nextra (continued)** | Eliminates by moving docs inline; kills separate deployment |
| **chart.js** | Already using lightweight-charts which is purpose-built for financial charts |

---

## Verification Flags

Items that need live testing during early phases:

| Item | Phase | What to Test | Fallback |
|------|-------|-------------|----------|
| `border-image` + `border-radius` conflict | 60 | Verify corners are handled by image, not CSS radius | Wrapper div approach |
| `@next/mdx` + Turbopack | 67 | Import .mdx file in a test page, verify dev server renders | `next-mdx-remote/rsc` |
| Web Audio API autoplay unlock timing | 68 | Verify splash screen click unlocks AudioContext on iOS Safari | Add unlock listener to first modal interaction |
| `autoSize: true` on lightweight-charts | 61 | Replace manual ResizeObserver with built-in autoSize | Keep current ResizeObserver approach |
| MDX dynamic import inside modal | 67 | Lazy-load `.mdx` content inside ModalContent | Static imports with code splitting |

---

## Sources

| Source | Type | Confidence |
|--------|------|------------|
| `/Users/mlbob/Projects/Dr Fraudsworth/app/package.json` | Codebase (installed versions) | HIGH |
| `/Users/mlbob/Projects/Dr Fraudsworth/app/app/globals.css` | Codebase (existing theme system) | HIGH |
| `/Users/mlbob/Projects/Dr Fraudsworth/app/next.config.ts` | Codebase (Next.js + image config) | HIGH |
| `/Users/mlbob/Projects/Dr Fraudsworth/app/components/chart/CandlestickChart.tsx` | Codebase (existing chart impl) | HIGH |
| `/Users/mlbob/Projects/Dr Fraudsworth/node_modules/lightweight-charts/dist/typings.d.ts` | Installed package typings | HIGH |
| `/Users/mlbob/Projects/Dr Fraudsworth/docs-site/package.json` | Codebase (existing docs setup) | HIGH |
| CSS `border-image` specification | Training knowledge (well-established spec) | MEDIUM |
| Web Audio API specification | Training knowledge (well-established API) | MEDIUM |
| `@next/mdx` Turbopack compatibility | Training knowledge (may have changed) | LOW -- NEEDS VERIFICATION |
| Browser autoplay policies | Training knowledge (policies evolve) | MEDIUM |
