# Phase 53: Asset Pipeline + Brand Foundation - Research

**Researched:** 2026-02-22
**Domain:** Image optimization, Tailwind v4 theming, Next.js Image, Typography, CSS design tokens
**Confidence:** HIGH

## Summary

This phase transforms 19.5MB of full-scene PNG assets into optimized, lazy-loaded WebP images under 2MB total, establishes a steampunk visual language through Tailwind v4 @theme tokens (colors, typography, z-index), and builds the loading/placeholder infrastructure for the factory scene.

The existing frontend is a Next.js 16.1.6 app with Tailwind 4.1.18, React 19, and Turbopack. The current `globals.css` contains only `@import "tailwindcss"` -- a blank canvas for @theme token definitions. The project uses zero-dependency patterns (no Framer Motion, no Sentry packages) and this phase follows the same philosophy: zero new npm dependencies.

**Primary recommendation:** Use a Node.js build script with `sharp` (already available via Next.js) to crop overlay PNGs to bounding boxes and convert to WebP. Define all design tokens in `globals.css` using Tailwind v4 `@theme` directives. Use `next/font/google` with CSS variables for Cinzel (headings) + IBM Plex Mono (financial data), connected to Tailwind via `@theme inline`. Generate blur placeholders as tiny base64 data URLs at build time.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already Installed -- Zero New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js Image | 16.1.6 | Image optimization, WebP conversion, lazy loading, srcset | Built-in, automatic WebP at runtime |
| next/font/google | 16.1.6 | Google Fonts self-hosting, zero layout shift | Built-in, no external requests, auto-subsetting |
| Tailwind CSS | 4.1.18 | @theme tokens for colors, fonts, z-index | Already installed, v4 @theme is the config system |
| sharp | (bundled) | Build script: crop PNGs, generate blur placeholders | Already available in project (confirmed via `require('sharp')`) |

### Supporting (Already Available)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sharp-cli | 5.2.0 | CLI wrapper for sharp (available via npx) | Quick one-off image operations |
| PostCSS | via @tailwindcss/postcss 4.1.18 | CSS processing pipeline | Already configured in postcss.config.mjs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sharp (build script) | squoosh | Sharp is faster and already available; squoosh is deprecated |
| Tiny base64 blur | blurhash | blurhash requires runtime decoder JS; base64 is native to img/CSS |
| next/font/google | CSS @import Google Fonts | next/font self-hosts, eliminates network requests, better CLS |

**Installation:** None required. All tools are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
app/
  app/
    globals.css              # @theme tokens: colors, fonts, z-index, animations
    layout.tsx               # Font CSS variables applied to <html>
    fonts.ts                 # NEW: Font definitions (Cinzel + IBM Plex Mono)
    page.tsx                 # Will become factory scene entry point
  components/
    scene/                   # NEW: Factory scene components
      FactoryBackground.tsx  # Background image with blur placeholder
      FactoryOverlay.tsx     # Individual overlay image component
      LoadingSpinner.tsx     # Steampunk gear spinner (CSS-only)
  lib/
    image-data.ts            # NEW: Blur placeholder data URLs + overlay metadata
public/
  scene/                     # NEW: Optimized scene images
    background/
      factory-bg-1920.webp   # 1920w variant
      factory-bg-2560.webp   # 2560w variant
      factory-bg-3840.webp   # 3840w variant (original resolution)
    overlays/
      carnage-cauldron.webp  # Cropped to bounding box
      connect-wallet.webp
      documentation-table.webp
      rewards-vat.webp
      settings.webp
      swap-station.webp      # Placeholder until asset provided
scripts/
  optimize-images.mjs        # NEW: Build script for crop + convert + blur generation
WebsiteAssets/               # Source PNGs (not deployed, not committed to git)
```

### Pattern 1: Tailwind v4 @theme Tokens in globals.css
**What:** All design tokens (colors, fonts, z-index, animations) defined in a single `@theme` block in globals.css
**When to use:** Always -- this IS the Tailwind v4 configuration method (replaces tailwind.config.js)
**Example:**
```css
/* Source: https://tailwindcss.com/docs/theme */
@import "tailwindcss";

@theme {
  /* Steampunk Color Palette */
  --color-factory-bg: #1a1208;
  --color-factory-surface: #2a1f0e;
  --color-factory-border: #4a3520;
  --color-factory-primary: #c4956a;     /* Warm brass */
  --color-factory-secondary: #8b6914;   /* Deep copper */
  --color-factory-accent: #d4a04a;      /* Amber/gold */
  --color-factory-text: #e8dcc8;        /* Aged parchment */
  --color-factory-text-muted: #9a8b72;  /* Faded text */
  --color-factory-glow: #f0c050;        /* Gaslight glow */
  --color-factory-success: #6b8e5a;     /* Muted green */
  --color-factory-error: #a85040;       /* Muted red */

  /* Z-Index Layering System */
  --z-index-background: 0;
  --z-index-overlays: 10;
  --z-index-hover: 20;
  --z-index-tooltip: 30;
  --z-index-modal-backdrop: 40;
  --z-index-modal: 50;

  /* Custom Animations */
  --animate-fade-in: fade-in 0.6s ease-out;
  --animate-gear-spin: gear-spin 3s linear infinite;

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes gear-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
}

/* Connect next/font CSS variables to Tailwind theme */
@theme inline {
  --font-heading: var(--font-cinzel);
  --font-mono: var(--font-ibm-plex-mono);
}
```

This generates utility classes: `bg-factory-bg`, `text-factory-accent`, `z-overlays`, `z-modal`, `font-heading`, `font-mono`, `animate-fade-in`, etc.

### Pattern 2: next/font/google with CSS Variables for Tailwind v4
**What:** Define fonts in a fonts.ts file, apply CSS variables to `<html>`, connect to Tailwind via `@theme inline`
**When to use:** Always when using Google Fonts with Tailwind v4
**Example:**
```typescript
// Source: https://nextjs.org/docs/app/api-reference/components/font
// app/fonts.ts
import { Cinzel } from 'next/font/google';
import { IBM_Plex_Mono } from 'next/font/google';

export const cinzel = Cinzel({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-cinzel',
  // Cinzel is a variable font (400-900), no weight array needed
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ibm-plex-mono',
  weight: ['400', '500', '700'],  // Not a variable font
});
```

```tsx
// app/layout.tsx
import { cinzel, ibmPlexMono } from './fonts';

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${ibmPlexMono.variable}`}>
      <body className="antialiased font-sans bg-factory-bg text-factory-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

```css
/* globals.css -- connects CSS variables to Tailwind theme */
@theme inline {
  --font-heading: var(--font-cinzel);
  --font-mono: var(--font-ibm-plex-mono);
}
```

Usage in components: `className="font-heading text-3xl font-bold"` or `className="font-mono tabular-nums"`

### Pattern 3: Next.js Image with Blur Placeholder and Responsive srcset
**What:** Static local images with blur placeholders, quality config, responsive sizes
**When to use:** For all scene images (background + overlays)
**Example:**
```tsx
// Source: https://nextjs.org/docs/app/api-reference/components/image
import Image from 'next/image';
import { backgroundBlur } from '@/lib/image-data';

// Background image -- fill mode, responsive, blur placeholder
<div className="relative w-full h-screen">
  <Image
    src="/scene/background/factory-bg-1920.webp"
    alt="Dr. Fraudsworth's Finance Factory"
    fill
    sizes="100vw"
    quality={80}
    placeholder="blur"
    blurDataURL={backgroundBlur}
    style={{ objectFit: 'cover' }}
    // preload={true} -- for LCP image (was priority, deprecated in Next 16)
  />
</div>

// Overlay image -- explicit dimensions, lazy loaded
<Image
  src="/scene/overlays/carnage-cauldron.webp"
  alt="Carnage Cauldron"
  width={400}
  height={300}
  quality={82}
  placeholder="blur"
  blurDataURL={cauldronBlur}
  loading="lazy"
  className="absolute z-overlays"
/>
```

**CRITICAL for Next.js 16:** The `qualities` field is now REQUIRED in `next.config.ts`:
```typescript
// next.config.ts -- must add images config
const nextConfig: NextConfig = {
  // ... existing config
  images: {
    qualities: [75, 80, 85],  // Allow these quality levels
    formats: ['image/webp'],  // Default, but explicit is good
    deviceSizes: [1920, 2560, 3840],  // Match our srcset breakpoints
  },
};
```

### Pattern 4: Build Script for Image Optimization
**What:** Node.js script using sharp to crop, convert, and generate blur placeholders
**When to use:** Run once when source images change, outputs go to public/scene/
**Example:**
```javascript
// scripts/optimize-images.mjs
import sharp from 'sharp';
import { writeFileSync } from 'fs';

// Trim transparent pixels (crop to bounding box) + convert to WebP
async function processOverlay(inputPath, outputPath) {
  const image = sharp(inputPath);
  const trimmed = await image.trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
  // trimmed.info has width, height, trimOffsetLeft, trimOffsetTop

  await sharp(trimmed.data)
    .webp({ quality: 82 })
    .toFile(outputPath);

  // Generate tiny blur placeholder (10px wide)
  const blurBuffer = await sharp(trimmed.data)
    .resize(10)
    .webp({ quality: 20 })
    .toBuffer();

  return {
    width: trimmed.info.width,
    height: trimmed.info.height,
    blurDataURL: `data:image/webp;base64,${blurBuffer.toString('base64')}`,
    trimOffset: { left: trimmed.info.trimOffsetLeft, top: trimmed.info.trimOffsetTop },
  };
}

// Background: generate 3 responsive sizes
async function processBackground(inputPath, outputDir) {
  const widths = [1920, 2560, 3840];
  for (const w of widths) {
    await sharp(inputPath)
      .resize(w)
      .webp({ quality: 80 })
      .toFile(`${outputDir}/factory-bg-${w}.webp`);
  }
  // Generate blur placeholder
  const blurBuffer = await sharp(inputPath)
    .resize(20)
    .webp({ quality: 20 })
    .toBuffer();
  return `data:image/webp;base64,${blurBuffer.toString('base64')}`;
}
```

### Anti-Patterns to Avoid
- **DO NOT use `@import url()` for Google Fonts.** Use `next/font/google` -- it self-hosts the fonts, eliminating FOUT and external network requests. The `@import url()` approach also requires CSP changes and adds latency.
- **DO NOT define colors in tailwind.config.js.** Tailwind v4 uses `@theme` in CSS. There is no tailwind.config.js in this project.
- **DO NOT set arbitrary z-index values (z-[999]).** Use named tokens from the @theme z-index scale.
- **DO NOT serve full-scene overlay PNGs.** The overlays are 5568x3072 full-scene images -- most pixels are transparent. Crop to bounding box first.
- **DO NOT use `priority` prop on Next.js Image.** Deprecated in Next.js 16, replaced by `preload` prop.
- **DO NOT skip the `qualities` config.** Required in Next.js 16 -- without it, the image optimization API may reject requests or allow all qualities.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image WebP conversion | Manual ffmpeg/imagemagick pipeline | `sharp` (already available) | Sharp is 10x faster, handles alpha channels correctly, Node-native |
| Responsive images | Manual `<picture>` + `<source>` elements | Next.js `<Image>` with `sizes` prop | Automatic srcset generation, format negotiation, lazy loading |
| Font loading | CSS `@font-face` with manual woff2 files | `next/font/google` | Auto-subsetting, self-hosting, CLS prevention, font metrics adjustment |
| Blur placeholders | Runtime blur computation | Build-time base64 generation with sharp | Zero runtime cost, works without JS, ~250 bytes per placeholder |
| CSS theming system | Custom CSS variables in :root | Tailwind v4 `@theme` | Generates utility classes automatically, type-safe, tree-shaken |
| Font-feature lining-nums | Manual CSS font-feature-settings | `tabular-nums` Tailwind utility | Already built into Tailwind, works with any font that supports it |

**Key insight:** Next.js 16 + Tailwind v4 + sharp cover 100% of this phase's needs without any new dependencies. The only "new code" is the build script and the @theme token definitions.

## Common Pitfalls

### Pitfall 1: Tailwind v4 @theme vs :root Confusion
**What goes wrong:** Defining custom CSS variables with `:root { --color-x: ... }` instead of `@theme { --color-x: ... }` -- the variables exist but NO utility classes are generated.
**Why it happens:** Old habits from Tailwind v3 or generic CSS variable patterns.
**How to avoid:** ALL design tokens that need utility classes MUST go in `@theme {}`. Use `:root` only for variables that don't need Tailwind utilities.
**Warning signs:** Classes like `bg-factory-surface` produce no styles.

### Pitfall 2: next/font CSS Variable Not Connected to Tailwind
**What goes wrong:** Fonts defined with `variable: '--font-cinzel'` but Tailwind doesn't know about them -- `font-heading` class doesn't work.
**Why it happens:** Missing the `@theme inline` bridge in globals.css that maps CSS variables to Tailwind font tokens.
**How to avoid:** Use `@theme inline { --font-heading: var(--font-cinzel); }` in globals.css. The `inline` keyword is critical -- it inlines the variable reference rather than wrapping it in another var().
**Warning signs:** `font-heading` class exists but doesn't apply the correct font.

### Pitfall 3: Next.js 16 Missing `qualities` Config
**What goes wrong:** Image optimization API returns 400 errors or serves unoptimized images.
**Why it happens:** Next.js 16 REQUIRES the `qualities` array in `next.config.ts` images config. Default was changed to `[75]` only.
**How to avoid:** Add `images: { qualities: [75, 80, 85] }` to next.config.ts. Include all quality values used by Image components.
**Warning signs:** Image component `quality` prop is ignored or throws 400.

### Pitfall 4: Sharp `trim()` on Full-Transparent Images
**What goes wrong:** `trim()` attempts to remove all pixels from a fully-transparent image and either errors or returns empty buffer.
**Why it happens:** Images with large transparent borders may have edge cases where threshold is too aggressive.
**How to avoid:** Use `threshold: 10` (default) and add error handling. Check that output dimensions > 0 after trim.
**Warning signs:** Empty or zero-dimension output from trim operation.

### Pitfall 5: Overlay Positioning After Crop
**What goes wrong:** Overlays appear in wrong position after cropping because the bounding box crop removes the positioning context (offset from scene origin).
**Why it happens:** The original full-scene overlays (5568x3072) encode their position via transparency -- the object IS at the correct pixel offset. After cropping, that offset is lost.
**How to avoid:** sharp's `trim()` returns `trimOffsetLeft` and `trimOffsetTop` in the info object. Store these offsets and use them as CSS `left`/`top` values (as percentages of scene dimensions) for absolute positioning.
**Warning signs:** All overlays bunch up at top-left corner after optimization.

### Pitfall 6: CSP Blocking Self-Hosted Fonts
**What goes wrong:** Fonts fail to load in production.
**Why it happens:** `font-src 'self'` in CSP blocks fonts if they're loaded from a CDN.
**How to avoid:** `next/font/google` self-hosts fonts (serves from same origin), so `font-src 'self'` already works. Verified: the existing CSP at line 12 of next.config.ts has `font-src 'self'` -- no changes needed.
**Warning signs:** This should NOT happen with next/font, but would manifest as CORS errors in browser console.

### Pitfall 7: `@theme inline` vs `@theme` for Font Variables
**What goes wrong:** Font utility classes reference `var(--font-heading)` which resolves to the Tailwind variable, not the next/font variable.
**Why it happens:** Standard `@theme { --font-heading: var(--font-cinzel); }` generates `.font-heading { font-family: var(--font-heading); }` which then needs to resolve `--font-heading` -> `var(--font-cinzel)` at the root level.
**How to avoid:** Use `@theme inline` which generates `.font-heading { font-family: var(--font-cinzel); }` directly, bypassing the intermediate variable.
**Warning signs:** Font appears to work in some contexts but not others depending on CSS specificity.

## Code Examples

Verified patterns from official sources:

### Tailwind v4 @theme Complete Color Palette
```css
/* Source: https://tailwindcss.com/docs/theme */
@import "tailwindcss";

@theme {
  /* ---- Steampunk Palette ---- */
  /* Backgrounds: dark warm tones */
  --color-factory-bg: #1a1208;
  --color-factory-surface: #2a1f0e;
  --color-factory-surface-elevated: #3a2d18;

  /* Borders */
  --color-factory-border: #4a3520;
  --color-factory-border-subtle: #3a2a15;

  /* Primary metals */
  --color-factory-primary: #c4956a;
  --color-factory-secondary: #8b6914;
  --color-factory-accent: #d4a04a;
  --color-factory-glow: #f0c050;

  /* Text hierarchy */
  --color-factory-text: #e8dcc8;
  --color-factory-text-secondary: #b8a88c;
  --color-factory-text-muted: #9a8b72;

  /* Status (muted steampunk treatment) */
  --color-factory-success: #6b8e5a;
  --color-factory-error: #a85040;
  --color-factory-warning: #c4956a;
}
```

Generates: `bg-factory-bg`, `text-factory-accent`, `border-factory-border`, etc.

### Tailwind v4 @theme Z-Index Scale
```css
/* Source: https://tailwindcss.com/docs/z-index */
@theme {
  --z-index-background: 0;
  --z-index-overlays: 10;
  --z-index-hover: 20;
  --z-index-tooltip: 30;
  --z-index-modal-backdrop: 40;
  --z-index-modal: 50;
  --z-index-spinner: 60;
}
```

Generates: `z-background`, `z-overlays`, `z-hover`, `z-tooltip`, `z-modal-backdrop`, `z-modal`, `z-spinner`

### Tailwind v4 @theme Typography Scale
```css
@theme {
  /* Font size scale */
  --text-display: 3rem;        /* Page titles, scene headers */
  --text-heading: 2rem;        /* Modal headers */
  --text-subheading: 1.25rem;  /* Section titles */
  --text-body: 1rem;           /* Default body text */
  --text-detail: 0.875rem;     /* Labels, captions */
  --text-micro: 0.75rem;       /* Fine print */

  /* Font weight aliases */
  --font-weight-display: 700;
  --font-weight-heading: 600;
  --font-weight-body: 400;
}
```

### next/font/google Multi-Font Setup
```typescript
// Source: https://nextjs.org/docs/app/api-reference/components/font
// app/fonts.ts
import { Cinzel } from 'next/font/google';
import { IBM_Plex_Mono } from 'next/font/google';

// Cinzel: variable font, weights 400-900 (all-caps display serif)
// Victorian/Roman inscriptional letterforms -- perfect for steampunk headings
export const cinzel = Cinzel({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-cinzel',
});

// IBM Plex Mono: tabular numerals, clear at small sizes
// Instrument readout feel for financial data
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ibm-plex-mono',
  weight: ['400', '500', '700'],  // IBM Plex Mono is NOT variable
});
```

### Next.js 16 Image Config
```typescript
// Source: https://nextjs.org/docs/app/api-reference/components/image
// next.config.ts additions
const nextConfig: NextConfig = {
  images: {
    qualities: [75, 80, 85],        // Required in Next.js 16
    formats: ['image/webp'],         // Default, explicit for clarity
    deviceSizes: [1920, 2560, 3840], // Match our scene breakpoints
  },
  // ... existing config
};
```

### Background Image with Blur Placeholder
```tsx
// Source: https://nextjs.org/docs/app/api-reference/components/image
'use client';
import Image from 'next/image';
import { SCENE_DATA } from '@/lib/image-data';

export function FactoryBackground() {
  return (
    <div className="relative w-full h-screen bg-factory-bg">
      <Image
        src="/scene/background/factory-bg-1920.webp"
        alt="Dr. Fraudsworth's Finance Factory"
        fill
        sizes="100vw"
        quality={80}
        placeholder="blur"
        blurDataURL={SCENE_DATA.background.blurDataURL}
        preload  // LCP element -- preload in <head>
        style={{ objectFit: 'cover' }}
        className="z-background"
      />
    </div>
  );
}
```

### Sharp Build Script: Crop + Convert + Blur
```javascript
// scripts/optimize-images.mjs
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const OVERLAYS = [
  { src: 'CarnageCauldron.png', name: 'carnage-cauldron' },
  { src: 'ConnectWallet.png', name: 'connect-wallet' },
  { src: 'DocumentationTable.png', name: 'documentation-table' },
  { src: 'RewardsVat.png', name: 'rewards-vat' },
  { src: 'Settings.png', name: 'settings' },
];

const INPUT_DIR = '../WebsiteAssets';
const OUTPUT_DIR = '../app/public/scene';
const SCENE_WIDTH = 5568;  // Original scene width
const SCENE_HEIGHT = 3072; // Original scene height

async function processOverlay(overlay) {
  const inputPath = path.join(INPUT_DIR, overlay.src);

  // Step 1: Trim transparent pixels to bounding box
  const { data, info } = await sharp(inputPath)
    .trim({ threshold: 10 })
    .toBuffer({ resolveWithObject: true });

  // Step 2: Convert to WebP
  await sharp(data)
    .webp({ quality: 82 })
    .toFile(path.join(OUTPUT_DIR, 'overlays', `${overlay.name}.webp`));

  // Step 3: Generate tiny blur placeholder
  const blurBuf = await sharp(data)
    .resize(10)
    .webp({ quality: 20 })
    .toBuffer();

  return {
    name: overlay.name,
    width: info.width,
    height: info.height,
    // Store position as percentage of scene dimensions
    left: ((info.trimOffsetLeft ?? 0) / SCENE_WIDTH) * 100,
    top: ((info.trimOffsetTop ?? 0) / SCENE_HEIGHT) * 100,
    widthPct: (info.width / SCENE_WIDTH) * 100,
    heightPct: (info.height / SCENE_HEIGHT) * 100,
    blurDataURL: `data:image/webp;base64,${blurBuf.toString('base64')}`,
  };
}
```

## Font Evaluation

### Heading Font: Cinzel (RECOMMENDED)

| Criterion | Cinzel | Playfair Display | EB Garamond |
|-----------|--------|-----------------|-------------|
| **Aesthetic** | Roman inscriptional, engraved brass | High-contrast transitional | Refined Renaissance |
| **Steampunk fit** | Excellent -- evokes engraved nameplates, machinery labels | Good -- elegant but more editorial than industrial | Fair -- too bookish, lacks industrial weight |
| **Variable font** | Yes (400-900) | Yes (400-900, with italic) | Yes (400-800, with italic) |
| **All caps** | Designed for it (inscriptional style) | Works but not optimized | Not designed for it |
| **Readability at heading size** | Excellent | Excellent | Good |
| **Weight range** | 400-900 | 400-900 | 400-800 |

**Recommendation: Cinzel** -- Its Roman inscriptional origin perfectly matches "engraved nameplates" from the context decisions. It is designed to work in all-caps display contexts. The lack of italic is irrelevant for headings. Being a variable font means efficient loading with full weight range.

**Body text strategy:** Do NOT use Cinzel for body text. Keep the existing system font stack for body (`font-sans: ui-sans-serif, system-ui, sans-serif` -- Tailwind default). Cinzel is heading/display only. This follows the context decision: "Body text must remain highly readable despite decorative heading style."

### Financial Data Font: IBM Plex Mono (RECOMMENDED)

| Criterion | IBM Plex Mono | JetBrains Mono | Share Tech Mono |
|-----------|---------------|----------------|-----------------|
| **Tabular numerals** | Yes (built-in) | Yes | Limited |
| **Character distinction** | Excellent (0/O, 1/l/I) | Excellent | Good |
| **Instrument readout feel** | Yes -- industrial, precise | More developer-focused | More tech/digital |
| **Weights available** | 100-700 (7 weights) | 100-800 (variable) | 400 only |
| **Google Fonts** | Yes | Yes | Yes |
| **Variable font** | No | Yes | No |
| **File size concern** | 3 weights ~60KB | Variable ~90KB | 1 weight ~20KB |

**Recommendation: IBM Plex Mono** -- Industrial heritage (IBM) aligns with steampunk instrument-readout aesthetic. Tabular numerals ensure perfect column alignment for prices and balances. Multiple weights allow visual hierarchy within data displays (bold totals vs regular values). Not a variable font, so we specify exact weights [400, 500, 700] to minimize download size.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js theme | @theme in CSS (globals.css) | Tailwind v4 (2025) | No config file, CSS-native tokens |
| `priority` prop on Image | `preload` prop on Image | Next.js 16 (2025) | `priority` deprecated, use `preload={true}` |
| Image quality unrestricted | `qualities` config required | Next.js 16 (2025) | Must whitelist allowed quality values |
| External Google Fonts @import | next/font/google self-hosting | Next.js 13+ (2023) | Zero layout shift, no external requests |
| @apply for component styles | Utility classes + @theme vars | Tailwind v4 (2025) | @apply still works but @theme is preferred |

**Deprecated/outdated:**
- `priority` prop on `next/image`: Use `preload` instead (Next.js 16)
- `onLoadingComplete` callback: Use `onLoad` instead (deprecated since Next.js 14)
- `domains` config for images: Use `remotePatterns` instead (deprecated since Next.js 14)
- tailwind.config.js: Not used in this project (Tailwind v4 uses CSS-native @theme)

## Existing Codebase Findings

### Current Frontend State (Verified by Reading Code)

**globals.css:** Contains only `@import "tailwindcss"` -- completely empty canvas for @theme tokens.

**layout.tsx:** Uses `<body className="antialiased">` -- no font classes, no theme colors. Wraps children in `<Providers>`.

**page.tsx:** Uses `bg-zinc-950 text-zinc-100` -- generic dark theme, not steampunk.

**ConnectModal.tsx:** Uses `z-50` (hardcoded) for modal overlay -- this is the pattern to migrate to named z-index tokens (`z-modal`).

**next.config.ts:** No `images` config at all -- must add `qualities`, `formats`, `deviceSizes`.

**CSP:** `font-src 'self'` and `img-src 'self' data: blob:` are already set. No changes needed for self-hosted fonts or base64 blur placeholders.

**WebsiteAssets:** All 6 images are 5568x3072 PNG, RGBA (overlays) or RGB (background). Total: ~20.9MB. All overlay PNGs are full-scene dimensions with transparent areas around the objects.

### Asset Size Analysis
| Asset | Current Size | After Optimization (estimated) |
|-------|-------------|-------------------------------|
| MainBackground.png | 12.9MB (5568x3072 RGB) | ~250-350KB WebP at 1920w, ~400-500KB at 2560w |
| CarnageCauldron.png | 970KB (5568x3072 RGBA) | ~40-80KB WebP after trim |
| ConnectWallet.png | 2.2MB (5568x3072 RGBA) | ~60-120KB WebP after trim |
| DocumentationTable.png | 1.7MB (5568x3072 RGBA) | ~50-100KB WebP after trim |
| RewardsVat.png | 1.9MB (5568x3072 RGBA) | ~50-100KB WebP after trim |
| Settings.png | 1.2MB (5568x3072 RGBA) | ~30-70KB WebP after trim |
| **Total** | **20.9MB** | **~480KB-1.3MB** (well under 2MB target) |

Estimates based on typical WebP compression ratios for illustrated content. Actual sizes will be determined by the build script.

## Open Questions

Things that couldn't be fully resolved:

1. **Exact overlay bounding box dimensions**
   - What we know: All overlays are 5568x3072 with transparent areas. Sharp's `trim()` will find the actual object bounds.
   - What's unclear: Exact pixel dimensions and positions after trim -- these determine responsive layout calculations.
   - Recommendation: Run the build script first; record dimensions in image-data.ts for the component layer.

2. **Swap Station placeholder sizing**
   - What we know: The SwapMachine/SwapStation asset is not yet available. The user will provide it later.
   - What's unclear: Its approximate position and size in the scene.
   - Recommendation: Reserve a slot in the overlay system with configurable placeholder dimensions. Use a generic steampunk-themed SVG placeholder or skip rendering until the asset arrives.

3. **EB Garamond as body font alternative**
   - What we know: Context says body text must be highly readable. System font stack is the safest choice.
   - What's unclear: Whether the user wants a body font that feels more "period" than system fonts.
   - Recommendation: Start with system font stack for body. If the user wants a period body font later, EB Garamond (serif) or Inter (clean sans) are good options -- but this is a separate decision outside this phase.

4. **Background image responsive strategy**
   - What we know: Background is 5568x3072. We plan 1920/2560/3840 srcset widths.
   - What's unclear: Whether Next.js Image in `fill` mode with `sizes="100vw"` will correctly select from our custom deviceSizes, or whether we need a `<picture>` element with `getImageProps()`.
   - Recommendation: Start with `<Image fill sizes="100vw">` and verify the generated srcset in browser devtools. If srcset doesn't match our widths, switch to `getImageProps()` + `<picture>`.

## Sources

### Primary (HIGH confidence)
- [Tailwind CSS v4 @theme docs](https://tailwindcss.com/docs/theme) - @theme syntax, namespaces, @theme inline
- [Tailwind CSS v4 color docs](https://tailwindcss.com/docs/colors) - --color-* namespace
- [Tailwind CSS v4 z-index docs](https://tailwindcss.com/docs/z-index) - --z-index-* namespace
- [Tailwind CSS v4 font-family docs](https://tailwindcss.com/docs/font-family) - --font-* namespace, @font-face, @theme inline for fonts
- [Next.js 16 Image component docs](https://nextjs.org/docs/app/api-reference/components/image) - blurDataURL, placeholder, quality, sizes, fill, preload, qualities config
- [Next.js 16 Font docs](https://nextjs.org/docs/app/api-reference/components/font) - variable option, CSS variables, Tailwind v4 integration
- [Next.js Font Getting Started](https://nextjs.org/docs/app/getting-started/fonts) - Google Fonts setup, multiple fonts, Tailwind integration example with @theme inline
- [sharp API docs](https://sharp.pixelplumbing.com/api-resize) - trim() with threshold, resolveWithObject for dimensions
- Existing codebase: `app/app/globals.css`, `app/app/layout.tsx`, `app/next.config.ts`, `app/package.json` (direct reads)

### Secondary (MEDIUM confidence)
- [Cinzel on Google Fonts](https://fonts.google.com/specimen/Cinzel) - Variable font, 400-900, inscriptional design
- [IBM Plex Mono on Google Fonts](https://fonts.google.com/specimen/IBM+Plex+Mono) - Tabular numerals, 7 weights
- [Playfair Display on Google Fonts](https://fonts.google.com/specimen/Playfair+Display) - Variable font comparison
- [Datawrapper Blog: Fonts for data visualization](https://www.datawrapper.de/blog/fonts-for-data-visualization) - Financial font recommendations

### Tertiary (LOW confidence)
- WebP compression ratio estimates (based on typical illustrated content ratios -- actual sizes will vary)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools already installed, APIs verified against official docs
- Architecture (Tailwind v4 @theme): HIGH - Verified syntax against official Tailwind v4 docs
- Architecture (Next.js Image): HIGH - Verified against Next.js 16.1.6 docs, including breaking changes
- Architecture (next/font): HIGH - Official docs include exact Tailwind v4 integration example
- Font evaluation: MEDIUM - Based on Google Fonts metadata and design community consensus
- Image size estimates: LOW - Based on typical compression ratios; actual results from build script will differ
- Pitfalls: HIGH - Verified from official docs (qualities requirement, priority deprecation, @theme inline)

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable technologies, 30-day window)
