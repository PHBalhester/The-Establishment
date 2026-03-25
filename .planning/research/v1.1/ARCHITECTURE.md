# Architecture Patterns: v1.1 "Modal Mastercraft, Docs & Audio"

**Domain:** Gamified DeFi frontend -- steampunk themed component kit, audio system, doc integration
**Researched:** 2026-02-24
**Overall confidence:** HIGH (based on thorough codebase analysis + established web platform patterns)

---

## Table of Contents

1. [Current Architecture Summary](#1-current-architecture-summary)
2. [Component Kit Architecture](#2-component-kit-architecture)
3. [9-Slice Frame System](#3-9-slice-frame-system)
4. [Audio System Architecture](#4-audio-system-architecture)
5. [Documentation Integration (MDX)](#5-documentation-integration-mdx)
6. [Design Token Pipeline](#6-design-token-pipeline)
7. [Chart Theming Architecture](#7-chart-theming-architecture)
8. [Cross-Cutting Concerns](#8-cross-cutting-concerns)

---

## 1. Current Architecture Summary

### What Exists Today

The project has a well-established foundation with clear patterns:

**Provider Tree:**
```
PrivyProvider
  ModalProvider (React Context)
    ToastProvider (React Context)
      {children} (page content)
      ModalRoot (singleton <dialog>)
      SplashScreen
      ToastContainer (Popover API portal)
      WalletConnectionToast (hook carrier)
      PrivyTopLayerFix (hook carrier)
```

**Component Organization:**
```
app/components/
  modal/       ModalShell, ModalProvider, ModalContent, ModalCloseButton
  station/     SwapStation, CarnageStation, StakingStation, DocsStation, etc.
  chart/       CandlestickChart, ChartControls
  swap/        SwapForm, TokenSelector, RouteSelector, FeeBreakdown, etc.
  staking/     StakingForm, StakeTab, UnstakeTab, ClaimTab, StakingStats
  dashboard/   EpochCard, TaxRatesCard, PoolCard, CarnageCard, DashboardGrid
  wallet/      WalletButton, BalanceDisplay, ConnectModal
  scene/       FactoryOverlay, FactoryBackground, SceneStation, LoadingSpinner
  toast/       ToastProvider (context + hook + container)
  onboarding/  SplashScreen
  mobile/      MobileNav
```

**Design Token System (globals.css @theme):**
- 40+ CSS custom properties in `--color-factory-*` namespace
- Z-index layering system (`--z-index-*`)
- Typography scale (`--text-*`)
- Animation tokens (`--animate-*`)
- Font bridging via `@theme inline` for Tailwind utility generation
- WCAG AA contrast verification matrix documented inline

**Styling Architecture:**
- Tailwind v4 utility classes for layout/spacing
- CSS classes in globals.css for complex themed components (modal chrome, brass buttons, lever tabs, big red button, toast cards, splash screen, mobile nav)
- Zero external UI libraries (no shadcn, no Radix, no HeadlessUI)
- CSS-only animations (clip-path iris, keyframe transitions)

**Key Architectural Decisions Already Made:**
1. Singleton `<dialog>` modal with content swapping (not per-station dialogs)
2. React.lazy for station code splitting
3. Popover API for toasts (renders above dialog backdrop)
4. CSS custom properties as the single source of truth for theme tokens
5. No npm dependencies for visual layer
6. Hooks as the primary data-fetching abstraction (not Context for data)

### Patterns to Preserve in v1.1

These patterns are battle-tested and should NOT be disrupted:

- **Zero visual-layer npm deps**: Component kit must be CSS + React only
- **CSS classes for complex visual effects**: Brass button, lever tab patterns live in globals.css -- this is intentional, not debt
- **Dialog singleton**: The Privy top-layer fix depends on the single-dialog architecture
- **@theme tokens as the contract**: All components reference `--color-factory-*` -- new components must too
- **Station lazy loading**: ModalContent uses React.lazy -- any new station content must support this

---

## 2. Component Kit Architecture

### Recommended Pattern: Themed Primitives in `app/components/kit/`

**Confidence: HIGH** -- This follows the existing codebase patterns (brass-button, brass-input, lever-tab classes in globals.css) and simply formalizes them into a structured library.

### File Organization

```
app/components/kit/
  index.ts              // Barrel export: export * from './Button'
  Button.tsx            // Brass button variants (primary, secondary, ghost)
  Input.tsx             // Brass input (text, number)
  Select.tsx            // Themed native <select> wrapper
  Tabs.tsx              // Lever tab group
  Frame.tsx             // 9-slice steampunk frame (see Section 3)
  Badge.tsx             // Status badges (success, error, warning, faction)
  Card.tsx              // Surface card with optional frame
  Meter.tsx             // Progress/gauge meter (steampunk gauge aesthetic)
  Tooltip.tsx           // Popover API tooltip (steampunk parchment)
  Label.tsx             // Form label with optional required indicator
  Divider.tsx           // Brass rule divider
  types.ts              // Shared types (Size, Variant, FactionColor)
```

### Why This Organization

1. **Flat directory, not nested**: Each component is a single file. No `Button/Button.tsx + Button.module.css + Button.stories.tsx` nesting. Matches the existing codebase convention (SwapForm.tsx, TokenSelector.tsx are flat files).

2. **Barrel export**: `import { Button, Input, Frame } from '@/components/kit'` -- clean imports for consumers. The barrel file is the only new import path station components need.

3. **Separate from `station/` and `ui/`**: The kit is the primitive layer. Stations consume kit components. This creates a clear dependency direction: `kit/ <- station/` and `kit/ <- swap/` etc.

### Prop Patterns

**Variant + Size pattern** (not className forwarding):

```typescript
// types.ts -- Shared across all kit components
export type Size = 'sm' | 'md' | 'lg';
export type Variant = 'primary' | 'secondary' | 'ghost';
export type FactionColor = 'crime' | 'fraud' | 'profit';

// Button.tsx -- Example prop API
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;        // Visual style (default: 'secondary')
  size?: Size;              // Dimensions (default: 'md')
  loading?: boolean;        // Shows spinner, disables interaction
  fullWidth?: boolean;      // width: 100%
}
```

**Why this API shape:**
- `variant` maps to CSS class names (existing pattern: `brass-button`, `lever-tab`)
- `size` controls padding/font-size via CSS classes
- `extends HTMLButtonAttributes` preserves native props (onClick, disabled, aria-*)
- No `className` override prop -- variants are the customization API, preventing accidental theme breakage

**Composition over configuration:**

```typescript
// GOOD: Compose kit primitives
<Card>
  <Frame variant="brass">
    <Tabs>...</Tabs>
  </Frame>
</Card>

// BAD: Mega-props on a single component
<Card frame="brass" tabs={[...]} headerTitle="..." />
```

### CSS Architecture for Kit Components

**Recommendation: Continue the globals.css class pattern**, with one structural improvement.

The existing globals.css is already 1390 lines. Adding kit component styles inline would push it past maintainability. But the project's zero-deps constraint means CSS Modules or styled-components are out.

**Solution: CSS layer + dedicated kit stylesheet.**

```css
/* app/components/kit/kit.css -- imported in globals.css */
@layer kit {
  .kit-button { /* ... */ }
  .kit-button-primary { /* ... */ }
  .kit-button-sm { /* ... */ }
  .kit-input { /* ... */ }
  /* etc. */
}
```

```css
/* globals.css -- add one import at the top */
@import "tailwindcss";
@import "../components/kit/kit.css" layer(kit);
```

**Why CSS layers:**
- Tailwind v4 uses `@layer` natively. The `kit` layer slots in at a known specificity level.
- Kit styles can reference `var(--color-factory-*)` tokens -- no new token system needed.
- Dedicated file keeps globals.css from growing unbounded while maintaining the zero-deps approach.
- Class naming convention `kit-*` prevents collision with existing `modal-*`, `brass-*`, `lever-*` classes.

**Confidence note:** CSS `@layer` and `@import` with layer syntax are well-supported in modern browsers (baseline since 2022). Tailwind v4 uses them internally. This is a LOW risk pattern.

### Migration Path for Existing Components

Existing CSS classes (`brass-button`, `brass-input`, `lever-tab`) should NOT be renamed or moved immediately. The kit components wrap them:

```typescript
// Button.tsx (simplified)
export function Button({ variant = 'secondary', size = 'md', ...props }: ButtonProps) {
  const className = [
    'kit-button',
    `kit-button-${variant}`,
    `kit-button-${size}`,
  ].join(' ');
  return <button className={className} {...props} />;
}
```

The kit CSS for `kit-button-secondary` can initially just extend the existing `brass-button` styles. Over time, the raw `brass-button` class usage in existing components can be migrated to `<Button>` component usage. This is a gradual, non-breaking migration.

---

## 3. 9-Slice Frame System

### What Is 9-Slice

A 9-slice (or 9-patch) frame divides a border image into 9 regions: 4 corners (fixed), 4 edges (stretch/tile), and 1 center (fill). CSS `border-image` implements this natively.

### Recommended Architecture

**Confidence: HIGH** -- CSS `border-image` with `border-image-slice` is the standard browser-native approach. No JS needed.

### Frame Component Design

```typescript
// Frame.tsx
interface FrameProps {
  /** Frame asset variant (maps to a border-image source) */
  variant: 'brass' | 'iron' | 'parchment';
  /** Size affects border-image-width (thicker borders for larger frames) */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show a header bar (adds a top section with different styling) */
  header?: React.ReactNode;
  /** Content fills the center slice */
  children: React.ReactNode;
  /** Optional className for the outer wrapper (layout positioning only) */
  className?: string;
}
```

### CSS Implementation

```css
/* kit.css */
.kit-frame {
  /* The border-image shorthand handles 9-slice automatically */
  border-style: solid;
  /* Padding creates space between content and the frame edges */
  padding: var(--frame-padding, 1rem);
}

/* Variant: brass (polished steampunk metal) */
.kit-frame-brass {
  border-image-source: url('/frames/brass-frame.png');
  border-image-slice: 24 fill;  /* 24px corners, fill center */
  border-image-width: 24px;
  border-image-outset: 0;
  border-image-repeat: round;   /* round = stretch to fit evenly */
}

/* Size modifiers change border-image-width (thicker frame) */
.kit-frame-sm {
  border-image-width: 16px;
  border-image-slice: 16 fill;
  --frame-padding: 0.75rem;
}

.kit-frame-lg {
  border-image-width: 32px;
  border-image-slice: 32 fill;
  --frame-padding: 1.25rem;
}
```

### Asset Pipeline for Frame Images

Each frame variant needs a single PNG/WebP image designed for 9-slice cutting:

```
public/frames/
  brass-frame.png      (96x96 or 128x128 source, corners at 24-32px)
  iron-frame.png       (same structure, darker palette)
  parchment-frame.png  (same structure, paper/parchment texture)
```

**Critical design requirement for frame source images:**
- Corner regions must be identical in all 4 corners (or at least the same dimensions)
- Edge regions must tile/stretch cleanly (no gradients that break at seams)
- The `border-image-slice` value must match the corner size in pixels
- `fill` keyword in the slice value is needed to apply the center region as background

### Frame With Header Pattern

For frames that include a title bar (like the modal chrome does now), use a compound structure:

```typescript
function Frame({ variant, size, header, children, className }: FrameProps) {
  const frameClass = [
    'kit-frame',
    `kit-frame-${variant}`,
    size && `kit-frame-${size}`,
  ].filter(Boolean).join(' ');

  return (
    <div className={`${frameClass} ${className ?? ''}`}>
      {header && (
        <div className="kit-frame-header">
          {header}
        </div>
      )}
      <div className="kit-frame-body">
        {children}
      </div>
    </div>
  );
}
```

The header is a div INSIDE the 9-slice frame, not a separate element above it. This keeps the brass border continuous around the entire component.

### Alternative: Multi-Layer Box-Shadow Approach (Existing Pattern)

The current `.modal-chrome` already creates a frame effect using multi-layer box-shadow and borders WITHOUT border-image:

```css
.modal-chrome {
  border: 3px solid var(--color-factory-accent);
  border-radius: 8px;
  box-shadow:
    0 0 0 6px var(--color-factory-surface-elevated),  /* outer ring */
    0 0 0 8px var(--color-factory-accent),             /* brass ring */
    0 0 40px rgba(240, 192, 80, 0.15),                 /* glow */
    0 16px 48px rgba(0, 0, 0, 0.5);                    /* drop shadow */
}
```

**Consideration:** If the AI-generated assets have detailed textures (rivets, patina, wear), `border-image` is the right choice because box-shadow can only produce solid colors and gradients. If frames are "clean metal" (solid brass with shadows for depth), the existing box-shadow + border pattern is simpler and doesn't require image assets at all.

**Recommendation:** Build the Frame component to support BOTH modes:
- `variant="brass"` uses box-shadow/border (no image assets needed, matches existing chrome)
- `variant="brass-textured"` uses `border-image` with a PNG asset
- This lets the team start immediately with CSS-only frames and upgrade to asset-based frames when the AI-generated artwork is ready

### Pitfall: border-image and border-radius

**CRITICAL:** CSS `border-image` and `border-radius` are incompatible. The spec says border-image overrides border-radius. If you apply `border-image-source` to an element with `border-radius: 8px`, the rounded corners will disappear.

**Workaround:** For rounded 9-slice frames, the rounding must be baked into the frame PNG itself (transparent corners in the source image). Or use a wrapper div with `border-radius` + `overflow: hidden` around the frame element, but this clips the border-image-outset.

**Best approach for this project:** Since the steampunk aesthetic favors hard-corner industrial frames (riveted metal), the lack of `border-radius` with `border-image` is actually a feature -- it produces the right look. For any component that needs rounded corners, use the box-shadow/border variant instead of `border-image`.

---

## 4. Audio System Architecture

### Recommended Pattern: Singleton AudioManager + React Context + Hooks

**Confidence: HIGH** -- Web Audio API + AudioContext lifecycle management is well-established. The singleton pattern is the standard approach for games/interactive web apps.

### Why Not Just `<audio>` Elements

HTML `<audio>` elements work for background music but are wrong for UI sound effects because:
- No precise timing control (latency varies by browser)
- No mixing/volume control across multiple simultaneous sounds
- No audio sprite support (single file, multiple cues)
- Each element loads its own buffer (duplicated memory for repeated sounds)

Web Audio API solves all of these with `AudioContext` + `AudioBuffer` + `GainNode`.

### System Architecture

```
                    +-----------------+
                    | AudioManager    |  (singleton, lives outside React)
                    | - audioContext  |
                    | - bufferCache   |
                    | - masterGain    |
                    | - sfxGain       |
                    | - musicGain     |
                    +---------+-------+
                              |
                    +---------+-------+
                    | AudioProvider   |  (React Context, wraps app)
                    | - exposes API   |
                    | - handles prefs |
                    +---------+-------+
                              |
               +--------------+--------------+
               |              |              |
         useAudio()    useSoundEffect()  <AudioToggle>
         (hook)        (hook)            (UI component)
```

### AudioManager Class (Singleton)

```typescript
// app/lib/audio/audio-manager.ts

type SoundId = 'click' | 'success' | 'error' | 'whoosh' | 'lever' | 'iris-open'
             | 'iris-close' | 'gear-spin' | 'carnage-boom' | 'epoch-bell';

interface AudioManagerOptions {
  /** Base path for audio files (default: '/audio/') */
  basePath?: string;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private bufferCache: Map<string, AudioBuffer> = new Map();
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private basePath: string;

  // Volume state (0-1)
  private _masterVolume = 0.7;
  private _sfxVolume = 1.0;
  private _musicVolume = 0.5;
  private _muted = false;

  constructor(options: AudioManagerOptions = {}) {
    this.basePath = options.basePath ?? '/audio/';
  }

  /** Lazily create AudioContext on first user interaction.
   *  CRITICAL: Browsers block AudioContext creation without user gesture. */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();

      // Chain: source -> category gain -> master gain -> destination
      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.applyVolumes();
    }
    // Resume if suspended (browser auto-suspends after tab goes background)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** Preload audio files into buffer cache. Call after first user gesture. */
  async preload(soundIds: SoundId[]): Promise<void> {
    const ctx = this.ensureContext();
    const loads = soundIds
      .filter(id => !this.bufferCache.has(id))
      .map(async (id) => {
        const response = await fetch(`${this.basePath}${id}.webm`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.bufferCache.set(id, audioBuffer);
      });
    await Promise.allSettled(loads);  // allSettled: don't fail if one file 404s
  }

  /** Play a sound effect (fire-and-forget). */
  play(soundId: SoundId): void {
    if (this._muted) return;
    const ctx = this.ensureContext();
    const buffer = this.bufferCache.get(soundId);
    if (!buffer) return; // Not preloaded yet -- silent fail, not error

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxGain!);
    source.start(0);
    // BufferSourceNode auto-disconnects after playback ends
  }

  // Volume control methods...
  setMasterVolume(v: number) { this._masterVolume = v; this.applyVolumes(); }
  setSfxVolume(v: number) { this._sfxVolume = v; this.applyVolumes(); }
  setMusicVolume(v: number) { this._musicVolume = v; this.applyVolumes(); }
  setMuted(muted: boolean) { this._muted = muted; this.applyVolumes(); }
  get muted() { return this._muted; }

  private applyVolumes() {
    const effective = this._muted ? 0 : this._masterVolume;
    this.masterGain?.gain.setValueAtTime(effective, this.ctx?.currentTime ?? 0);
    this.sfxGain?.gain.setValueAtTime(this._sfxVolume, this.ctx?.currentTime ?? 0);
    this.musicGain?.gain.setValueAtTime(this._musicVolume, this.ctx?.currentTime ?? 0);
  }
}

// Singleton export
export const audioManager = new AudioManager();
```

### React Integration

```typescript
// app/providers/AudioProvider.tsx
'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { audioManager } from '@/lib/audio/audio-manager';
import type { SoundId } from '@/lib/audio/audio-manager';

interface AudioContextValue {
  play: (id: SoundId) => void;
  muted: boolean;
  toggleMute: () => void;
  preloaded: boolean;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMuted] = useState(false);
  const [preloaded, setPreloaded] = useState(false);

  // Restore mute preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('audio-muted');
    if (saved === 'true') {
      setMuted(true);
      audioManager.setMuted(true);
    }
  }, []);

  // Preload core UI sounds on first user interaction
  useEffect(() => {
    const handler = async () => {
      await audioManager.preload([
        'click', 'success', 'error', 'whoosh',
        'lever', 'iris-open', 'iris-close',
      ]);
      setPreloaded(true);
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', handler);
    };
    document.addEventListener('click', handler, { once: false });
    document.addEventListener('keydown', handler, { once: false });
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', handler);
    };
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    audioManager.setMuted(next);
    localStorage.setItem('audio-muted', String(next));
  }, [muted]);

  const play = useCallback((id: SoundId) => {
    audioManager.play(id);
  }, []);

  return (
    <AudioContext.Provider value={{ play, muted, toggleMute, preloaded }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
}
```

### Key Architectural Decisions

**1. AudioManager lives outside React (plain class, not Context)**

The AudioContext and buffer cache must survive React re-renders. The singleton class owns the Web Audio resources. React Context only exposes the API and manages preference state (muted, volume).

**2. Lazy AudioContext creation (user gesture gate)**

Browsers require a user gesture before creating or resuming an AudioContext. The splash screen's "Push to Enter" click is the natural first gesture. Preloading starts after that click.

**3. WebM for audio files (not MP3)**

WebM/Opus has better compression, lower latency decode, and is supported in all modern browsers (baseline since 2020). MP3 decode latency is measurably higher for short UI sounds. WAV is too large. OGG/Vorbis is deprecated in favor of Opus.

**4. Fire-and-forget playback for SFX**

`BufferSourceNode` is a one-shot node -- create it, start it, forget it. The browser garbage collects it after playback. No need to track or stop SFX.

**5. prefers-reduced-motion suppresses audio**

The existing CSS `prefers-reduced-motion` rule disables visual animations. Audio should respect this too -- some users with vestibular disorders experience discomfort from unexpected sounds. The AudioProvider should check `matchMedia('(prefers-reduced-motion: reduce)')` and default to muted.

### Provider Tree Integration

```typescript
// providers.tsx update
<PrivyProvider>
  <ModalProvider>
    <ToastProvider>
      <AudioProvider>
        {children}
        <ModalRoot />
        <SplashScreen />
        <ToastContainer />
        <WalletConnectionToast />
        <PrivyTopLayerFix />
      </AudioProvider>
    </ToastProvider>
  </ModalProvider>
</PrivyProvider>
```

AudioProvider goes inside ToastProvider (so toasts can play sounds) and outside children (so all components can access useAudio).

### Audio File Organization

```
public/audio/
  click.webm         // UI button press (50ms)
  success.webm       // Transaction confirmed (200ms)
  error.webm         // Transaction failed (150ms)
  whoosh.webm        // Modal open/station switch (200ms)
  lever.webm         // Tab switch / lever pull (100ms)
  iris-open.webm     // Mechanical aperture opening (280ms, matching animation)
  iris-close.webm    // Mechanical close (180ms, matching animation)
  gear-spin.webm     // Gear rotation (for splash screen, loops)
  carnage-boom.webm  // Carnage event notification (500ms)
  epoch-bell.webm    // Epoch transition bell (300ms)
```

Short sounds, all under 1 second. Total preload budget: ~50-100KB for core UI sounds.

### Pitfall: AudioContext State Management

The AudioContext can be in three states: `running`, `suspended`, `closed`.

- **Suspended**: Browser auto-suspends after ~30s of no audio activity or when tab goes background. Must call `ctx.resume()` before playing.
- **Closed**: Terminal state, cannot be resumed. Never call `ctx.close()` unless the page is unloading.
- **Tab visibility**: Use `document.visibilitychange` to pause/resume. Don't burn CPU decoding audio in a background tab.

---

## 5. Documentation Integration (MDX)

### Current State

Documentation lives in a separate Nextra app (`docs-site/`) with its own `next.config.mjs`, `node_modules`, and build pipeline. The main app embeds it via `<iframe>` in `DocsStation.tsx` with:
- CSP `frame-src` and `child-src` directives allowing the docs domain
- Nextra's CSP `frame-ancestors` allowing the main app domain
- 10-second load timeout fallback
- Separate Railway deployment for the docs site

### Recommended Architecture: Inline MDX with @next/mdx

**Confidence: MEDIUM** -- Next.js has built-in MDX support via `@next/mdx`, but integrating Nextra's content structure (with `_meta.js` files and theme-docs components) requires careful migration. The MDX rendering itself is straightforward; the Nextra-specific features need replacement.

### Why Replace the Iframe

1. **Deployment complexity**: Two separate Next.js apps, two Railway services, two build pipelines
2. **CSP fragility**: iframe requires CSP frame-src + frame-ancestors coordination
3. **No shared theming**: Docs site has its own CSS that doesn't match the factory aesthetic
4. **Performance**: iframe loads a full Next.js app including hydration, just to show text
5. **UX friction**: iframe scrolling within modal scrolling is a bad pattern
6. **Search/accessibility**: iframe content is invisible to the main app's search and screen readers

### Architecture: MDX Content as Static Route Segments

```
app/
  app/
    docs/
      layout.tsx          // Docs layout with sidebar navigation
      page.tsx            // Docs index (redirects to first page)
      [slug]/
        page.tsx          // Dynamic route that loads MDX by slug
      mdx-components.tsx  // Custom components for MDX rendering
  content/
    docs/                 // MDX files (moved from docs-site/content/)
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
      security/
        protocol-guarantees.mdx
        how-randomness-works.mdx
      launch/
        bonding-curve.mdx
        pool-seeding.mdx
      reference/
        tokenomics.mdx
        glossary.mdx
```

### MDX Processing Options

**Option A: @next/mdx (recommended)**

Next.js has first-party MDX support. With `@next/mdx` installed:

```typescript
// next.config.ts
import createMDX from '@next/mdx';

const withMDX = createMDX({
  // Use remark/rehype plugins for features like frontmatter, GFM tables
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
```

**Option B: next-mdx-remote (for dynamic loading)**

If MDX content needs to be loaded dynamically at runtime (not at build time), `next-mdx-remote` compiles MDX on the server and ships serialized output to the client. This is useful for CMS-driven content but adds complexity.

**Recommendation: Option A (@next/mdx)** because:
- Content is static (checked into the repo)
- Build-time compilation is faster for the user
- Simpler setup, fewer moving parts
- Type-safe imports (`import Content from './docs/page.mdx'`)

### DocsStation Integration

Instead of the iframe, DocsStation renders MDX content directly:

```typescript
// DocsStation.tsx (revised)
'use client';

import { useState } from 'react';
// Navigation data structure replaces Nextra _meta.js files
import { DOC_SECTIONS } from '@/content/docs/navigation';

export default function DocsStation() {
  const [currentPage, setCurrentPage] = useState('overview/what-is-dr-fraudsworth');

  return (
    <div className="flex gap-4">
      {/* Sidebar navigation */}
      <nav className="w-48 flex-shrink-0 border-r border-factory-border-subtle pr-4">
        {DOC_SECTIONS.map(section => (
          <div key={section.title}>
            <h3 className="text-sm font-heading text-factory-accent mb-1">
              {section.title}
            </h3>
            {section.pages.map(page => (
              <button
                key={page.slug}
                onClick={() => setCurrentPage(page.slug)}
                className={/* active/inactive styles */}
              >
                {page.title}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Content area */}
      <div className="flex-1 prose-factory">
        <MDXContent slug={currentPage} />
      </div>
    </div>
  );
}
```

### MDX Custom Components (Steampunk Theming)

The MDX renderer needs custom components that match the factory aesthetic:

```typescript
// mdx-components.tsx
export function useMDXComponents() {
  return {
    // Headings: Cinzel serif, brass accent color
    h1: (props) => <h1 className="font-heading text-factory-accent text-2xl mb-4" {...props} />,
    h2: (props) => <h2 className="font-heading text-factory-accent text-xl mb-3 mt-6" {...props} />,
    h3: (props) => <h3 className="font-heading text-factory-text text-lg mb-2 mt-4" {...props} />,

    // Paragraphs: readable body text
    p: (props) => <p className="text-factory-text-secondary mb-3 leading-relaxed" {...props} />,

    // Code blocks: IBM Plex Mono on dark surface
    code: (props) => <code className="font-mono bg-factory-surface px-1 py-0.5 rounded text-sm" {...props} />,
    pre: (props) => <pre className="bg-factory-surface border border-factory-border-subtle rounded p-4 overflow-x-auto mb-4 font-mono text-sm" {...props} />,

    // Tables: brass-bordered
    table: (props) => <table className="w-full border-collapse mb-4" {...props} />,
    th: (props) => <th className="text-left border-b-2 border-factory-accent px-3 py-2 font-heading text-sm text-factory-accent" {...props} />,
    td: (props) => <td className="border-b border-factory-border-subtle px-3 py-2 text-sm" {...props} />,

    // Links: accent colored
    a: (props) => <a className="text-factory-accent underline hover:text-factory-glow" {...props} />,

    // Lists
    ul: (props) => <ul className="list-disc list-inside mb-3 text-factory-text-secondary" {...props} />,
    ol: (props) => <ol className="list-decimal list-inside mb-3 text-factory-text-secondary" {...props} />,

    // Blockquote: parchment callout
    blockquote: (props) => (
      <blockquote
        className="border-l-4 border-factory-accent pl-4 my-4 italic text-factory-text-secondary"
        {...props}
      />
    ),

    // Horizontal rule: brass divider
    hr: () => <hr className="border-t-2 border-factory-accent my-6 opacity-50" />,
  };
}
```

### CSP Cleanup After Migration

Once the iframe is removed:
- Remove `child-src` and `frame-src` for `localhost:3001` and `docs-drfraudsworth.up.railway.app` from next.config.ts
- Decommission the docs-site Railway service
- The docs-site directory can remain as an archive or be deleted

### Pitfall: MDX Content Within Modal Scroll

The docs content will render inside `ModalShell`'s `.modal-body` (which has `overflow-y: auto`). Long documentation pages need to scroll smoothly within this container. Anchor links (`#section-id`) may not work correctly inside a scrolling container within a dialog. Test this early.

**Mitigation:** Use `scrollIntoView({ behavior: 'smooth', block: 'start' })` on the scroll container, not `window.location.hash`. The modal body is the scroll parent, not the viewport.

---

## 6. Design Token Pipeline

### Current Pipeline

```
AI Artwork (Midjourney/DALL-E)
    |
    v
Photoshop Processing (manual crop, overlay extraction)
    |
    v
scripts/optimize-images.mjs (WebP conversion, blur placeholders)
    |
    v
public/scene/overlays/*.webp  +  app/lib/image-data.ts (auto-generated)
    |
    v
Next.js Image component (responsive srcset, lazy loading)
```

### Recommended Expanded Pipeline for v1.1

```
+---------------------------+
| AI-Generated Assets       |
| (frames, textures, icons) |
+-------------+-------------+
              |
              v
+---------------------------+
| Photoshop Processing      |
| - Crop to standard sizes  |
| - Extract 9-slice regions |
| - Color-correct to token  |
|   palette (#daa520, etc.) |
| - Export as PNG-24 + alpha |
+-------------+-------------+
              |
              v
+---------------------------+
| Build Script              |
| scripts/process-assets.mjs|
| - Optimize PNG (pngquant) |
| - Convert to WebP/AVIF    |
| - Generate 9-slice PNGs   |
| - Emit CSS custom props   |
|   for frame dimensions    |
| - Generate TypeScript      |
|   manifest (like image-   |
|   data.ts)                |
+-------------+-------------+
              |
              v
+---+-------+--------+------+
|   |       |        |      |
v   v       v        v      v
CSS   public/   kit.css    TS
vars  frames/  (frame     manifest
              variants)
```

### Token Flow: From Art to Component

**Step 1: Color tokens from artwork**

The AI generates artwork in various colors. Photoshop processing color-corrects to match existing tokens:

```
AI brass texture -> color-correct to #daa520 (--color-factory-accent)
AI parchment    -> color-correct to #f5e6c8 (modal-chrome gradient start)
AI iron/dark    -> color-correct to #2c1e12 (--color-factory-surface)
```

This ensures visual consistency: a frame asset and a button gradient both reference the same brass tone.

**Step 2: Build script extracts dimensions**

For 9-slice frames, the build script reads the PNG dimensions and emits CSS custom properties:

```css
/* Auto-generated by scripts/process-assets.mjs */
:root {
  --frame-brass-slice: 24;
  --frame-brass-width: 24px;
  --frame-brass-src: url('/frames/brass-frame.webp');
  --frame-iron-slice: 20;
  --frame-iron-width: 20px;
  --frame-iron-src: url('/frames/iron-frame.webp');
}
```

**Step 3: Kit CSS references generated tokens**

```css
.kit-frame-brass {
  border-image-source: var(--frame-brass-src);
  border-image-slice: var(--frame-brass-slice) fill;
  border-image-width: var(--frame-brass-width);
}
```

**Step 4: TypeScript manifest for dynamic access**

```typescript
// Auto-generated
export const FRAME_VARIANTS = {
  brass: { slice: 24, width: 24, src: '/frames/brass-frame.webp' },
  iron: { slice: 20, width: 20, src: '/frames/iron-frame.webp' },
} as const;
```

### Design Token Layers

The project already has a clean token hierarchy. v1.1 adds one layer:

```
Layer 1: Primitive Palette  (already exists)
  --color-factory-bg, --color-factory-accent, etc.

Layer 2: Semantic Tokens    (already exists)
  --color-factory-success-surface, --color-factory-error-text, etc.

Layer 3: Component Tokens   (NEW in v1.1)
  --frame-brass-src, --frame-brass-slice
  --chart-up-color, --chart-down-color
  --audio-feedback-enabled (CSS custom property for audio state)
```

Layer 3 references Layer 1/2 tokens where possible:
```css
--chart-up-color: var(--color-factory-success);
--chart-down-color: var(--color-factory-error);
```

This creates a single place to rebrand: change Layer 1, and Layers 2-3 cascade automatically.

---

## 7. Chart Theming Architecture

### Current State

CandlestickChart.tsx has hardcoded hex values for TradingView chart colors:

```typescript
// Lines 98-134 of CandlestickChart.tsx
const chart = createChart(containerRef.current, {
  layout: {
    background: { type: ColorType.Solid, color: "#1c120a" },  // hardcoded
    textColor: "#bca88a",                                       // hardcoded
  },
  grid: {
    vertLines: { color: "#4a3520" },                            // hardcoded
    horzLines: { color: "#4a3520" },                            // hardcoded
  },
  // ... 15+ more hardcoded values
});
```

These hex values DO match the CSS custom properties (confirmed by comments in the source), but they're duplicated constants -- if the theme changes, two places need updating.

### Recommended Architecture: Chart Theme Object

**Confidence: HIGH** -- TradingView lightweight-charts v5 accepts a full options object. Creating a theme adapter is straightforward.

### Theme Object Pattern

```typescript
// app/lib/chart/chart-theme.ts

import { ColorType, type ChartOptions, type DeepPartial } from 'lightweight-charts';

/**
 * Factory theme for TradingView lightweight-charts.
 *
 * Why hardcoded hex values (not CSS var() reads):
 * TradingView renders to a <canvas> element. Canvas drawing contexts
 * cannot read CSS custom properties -- they need resolved hex/rgb strings.
 * We duplicate the token values here and document which CSS token each
 * corresponds to, so theme changes can be applied to both places.
 *
 * If we ever need runtime theme switching, we'd read getComputedStyle()
 * to resolve the CSS variables and rebuild this object.
 */
export const FACTORY_CHART_THEME: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: '#1c120a' },  // --color-factory-bg
    textColor: '#bca88a',                                       // --color-factory-text-secondary
  },
  grid: {
    vertLines: { color: '#4a3520' },   // --color-factory-border-subtle
    horzLines: { color: '#4a3520' },   // --color-factory-border-subtle
  },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    borderColor: '#86644a',            // --color-factory-border
  },
  rightPriceScale: {
    borderColor: '#86644a',            // --color-factory-border
  },
  crosshair: {
    horzLine: {
      color: '#86644a',               // --color-factory-border
      labelBackgroundColor: '#2c1e12', // --color-factory-surface
    },
    vertLine: {
      color: '#86644a',               // --color-factory-border
      labelBackgroundColor: '#2c1e12', // --color-factory-surface
    },
  },
};

/** Candlestick series color options */
export const FACTORY_CANDLE_COLORS = {
  upColor: '#5da84a',              // --color-factory-success
  downColor: '#c04030',            // --color-factory-error
  borderUpColor: '#5da84a',        // --color-factory-success
  borderDownColor: '#c04030',      // --color-factory-error
  wickUpColor: '#5da84a',          // --color-factory-success
  wickDownColor: '#c04030',        // --color-factory-error
} as const;
```

### Runtime Theme Resolution (Optional Enhancement)

If runtime theme switching is ever needed (e.g., a "light mode" for the docs station), the theme object can be resolved from CSS:

```typescript
/** Resolve chart theme from current CSS custom properties.
 *  Call this inside a useEffect (needs DOM access for getComputedStyle). */
export function resolveChartTheme(): DeepPartial<ChartOptions> {
  const style = getComputedStyle(document.documentElement);
  const get = (prop: string) => style.getPropertyValue(prop).trim();

  return {
    layout: {
      background: { type: ColorType.Solid, color: get('--color-factory-bg') },
      textColor: get('--color-factory-text-secondary'),
    },
    // ... etc
  };
}
```

This is a FUTURE option, not needed for v1.1. Documenting it here so the architecture supports it.

### Applying the Theme

```typescript
// CandlestickChart.tsx (simplified change)
import { FACTORY_CHART_THEME, FACTORY_CANDLE_COLORS } from '@/lib/chart/chart-theme';

const chart = createChart(containerRef.current, {
  ...FACTORY_CHART_THEME,
  width: width ?? containerRef.current.clientWidth,
  height,
});

const series = chart.addSeries(CandlestickSeries, {
  ...FACTORY_CANDLE_COLORS,
  ...(priceFormatterRef.current ? { priceFormat: { ... } } : {}),
});
```

The chart creation code drops from ~30 lines of inline config to ~5 lines.

---

## 8. Cross-Cutting Concerns

### Provider Ordering After v1.1

The full provider tree after v1.1 additions:

```
PrivyProvider          (wallet, auth)
  ModalProvider        (modal state management)
    ToastProvider      (toast notifications)
      AudioProvider    (audio system -- NEW)
        {children}
        ModalRoot
        SplashScreen
        ToastContainer
        WalletConnectionToast
        PrivyTopLayerFix
```

AudioProvider is innermost because:
- Modal open/close sounds need useAudio() -- ModalRoot is a child of AudioProvider
- Toast sounds need useAudio() -- ToastContainer is a child of AudioProvider
- Audio state doesn't depend on Modal or Toast state (no circular deps)

### File Organization After v1.1

```
app/
  app/
    globals.css                     (existing, add kit.css import)
    layout.tsx                      (unchanged)
    fonts.ts                        (unchanged)
    docs/                           (NEW: doc routes)
      layout.tsx
      [slug]/page.tsx
  components/
    kit/                            (NEW: component primitives)
      kit.css
      index.ts
      Button.tsx, Input.tsx, Frame.tsx, etc.
    modal/                          (existing, unchanged)
    station/                        (existing, DocsStation revised)
    chart/                          (existing, uses chart-theme.ts)
    swap/                           (existing)
    staking/                        (existing)
    dashboard/                      (existing)
    wallet/                         (existing)
    scene/                          (existing)
    toast/                          (existing)
    onboarding/                     (existing)
    mobile/                         (existing)
  hooks/                            (existing + useAudio)
  lib/
    audio/                          (NEW: AudioManager)
      audio-manager.ts
    chart/                          (NEW: chart theme)
      chart-theme.ts
    (existing files unchanged)
  providers/
    providers.tsx                   (add AudioProvider)
  content/
    docs/                           (NEW: MDX content moved from docs-site)
      navigation.ts                 (replaces Nextra _meta.js)
      overview/*.mdx
      gameplay/*.mdx
      earning/*.mdx
      security/*.mdx
      launch/*.mdx
      reference/*.mdx
```

### Performance Budget

| Addition | Bundle Impact | Mitigation |
|----------|--------------|------------|
| Kit CSS | ~5-8KB uncompressed | CSS layer, tree-shaken by class usage |
| AudioManager | ~2KB JS | Singleton, no React overhead |
| AudioProvider | ~1KB JS | Thin context wrapper |
| Audio files | ~50-100KB total | Preloaded after first gesture, cached |
| MDX runtime | ~15-20KB JS | Replaces entire Nextra app iframe load |
| Chart theme | ~1KB JS | Replaces inline config (net zero) |
| Frame images | ~10-30KB each | border-image caches after first load |

**Net effect:** The MDX migration is a net REDUCTION in total page weight because it eliminates the iframe that loaded an entire Nextra app. Audio files are preloaded lazily and only after user interaction.

### Dependency Additions

| Package | Purpose | Why Needed |
|---------|---------|-----------|
| `@next/mdx` | MDX compilation in Next.js | Replaces Nextra iframe |
| `@mdx-js/react` | MDX component provider | Custom themed components |
| `remark-gfm` | GitHub-flavored markdown tables | Docs use tables extensively |
| `remark-frontmatter` | YAML frontmatter in MDX | Page titles and metadata |

**No other dependencies.** The audio system, component kit, frame system, and chart theme are all zero-dependency implementations.

### Testing Strategy

| System | Test Approach |
|--------|--------------|
| Kit components | Visual snapshot tests (or manual verification) |
| Frame system | Cross-browser rendering check (Chrome, Safari, Firefox) |
| Audio system | Manual test (Web Audio API requires browser context) |
| MDX rendering | Build-time test (MDX compilation errors caught at build) |
| Chart theme | Visual comparison (side-by-side with current) |

---

## Sources and Confidence

| Topic | Source | Confidence |
|-------|--------|-----------|
| CSS border-image 9-slice | CSS spec (border-image-slice), training data verified | HIGH |
| border-image + border-radius conflict | CSS spec explicit: "border-image replaces border-radius" | HIGH |
| Web Audio API AudioContext lifecycle | Web Audio API spec, standard pattern | HIGH |
| AudioContext user gesture requirement | Chrome autoplay policy (widely documented) | HIGH |
| Next.js @next/mdx | Next.js docs (training data, needs verification for v16) | MEDIUM |
| Tailwind v4 @layer support | Tailwind v4 docs, CSS spec | HIGH |
| TradingView lightweight-charts v5 API | Verified against codebase usage patterns | HIGH |
| WebM/Opus browser support | Baseline since 2020, widely documented | HIGH |
| CSS custom properties in canvas context | Known limitation: canvas cannot read CSS vars | HIGH |

**Items needing verification during implementation:**
- `@next/mdx` exact configuration for Next.js 16.1.6 (may have changed since training)
- Whether `next-mdx-remote` v5 has better Turbopack compatibility than `@next/mdx`
- Exact `border-image-slice` values for the AI-generated frame assets (depends on artwork dimensions)
