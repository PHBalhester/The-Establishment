# Project Research Summary: v1.1 "Modal Mastercraft, Docs & Audio"

**Project:** Dr. Fraudsworth's Finance Factory
**Domain:** Gamified DeFi frontend -- steampunk-themed UI overhaul (component kit, chart restyling, docs migration, audio system)
**Researched:** 2026-02-24
**Confidence:** MEDIUM-HIGH

---

## Executive Summary

v1.1 is a purely frontend milestone spanning 9 phases (60-68) that upgrades the Dr. Fraudsworth UI from functional-but-plain to immersive steampunk. The research is unanimous: the existing architecture is excellent and should be extended, not replaced. The codebase already has a comprehensive Tailwind v4 `@theme` token system, a battle-tested singleton `<dialog>` modal with iris animations, and a zero-npm-dependency philosophy for the visual layer. All four research documents converge on a CSS-first, zero-dependency approach for the component kit (9-slice `border-image` frames, extended `@theme` tokens, CSS layer for kit styles), the Web Audio API for sound (no Howler.js or Tone.js), `@next/mdx` for documentation (replacing the iframe-Nextra deployment), and the existing lightweight-charts v5.1.0 with a centralized theme object for chart restyling.

The recommended approach follows the existing patterns: CSS classes in a dedicated `kit.css` file (imported via `@layer`), a singleton AudioManager class outside React wrapped by an AudioProvider context, MDX content compiled at build time via `@next/mdx`, and frame assets as individual WebP files. The only new npm dependencies are three MDX packages (`@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`). Everything else uses browser-native APIs or already-installed packages. The critical dependency chain is: design tokens -> 9-slice frame component -> component kit -> modal polish + docs + charts. Audio is a parallel track that only intersects at the Settings modal (needs toggle/slider components).

The top risks are: (1) Turbopack MDX plugin serialization -- remark/rehype plugins MUST be passed as strings, not function references, or MDX pages render blank; (2) CSS `border-image` completely ignores `border-radius` -- the steampunk aesthetic must embrace rectangular frames or use the existing box-shadow/border approach for rounded components; (3) Web Audio autoplay policy -- AudioContext must be created lazily on the splash screen's first click, with a silent-buffer unlock for iOS Safari; (4) the `@next/mdx` + Next.js 16.1.6 + Turbopack combination needs early verification since the researchers could not live-test it. All four risks have clear mitigation strategies documented in detail.

---

## Key Findings

### Recommended Stack

The milestone adds almost nothing to the dependency tree. Five of six technology areas use zero new dependencies.

**Core technologies:**
- **CSS `border-image` (9-slice):** Native CSS for steampunk frames -- universal browser support since 2014, no JS needed, no polyfills. Use `stretch` for smooth gradients, `round` for repeating patterns (rivets, chains).
- **Tailwind v4 `@theme` extensions:** The existing token system is already excellent (40+ tokens). Phase 60 adds component-level tokens (`--spacing-frame-*`, `--color-factory-slider-*`, `--animate-lever-press`) to the same `@theme` block. No new tooling.
- **Web Audio API (native):** Zero-dependency audio system. Singleton AudioManager with GainNode routing (master -> sfx/music channels). MP3 as primary format for universal compat; total SFX budget ~50-100KB.
- **`@next/mdx`:** Official first-party MDX integration for Next.js. Replaces the separate Nextra docs-site and its iframe embedding. Three new npm packages. Eliminates a Railway deployment.
- **lightweight-charts v5.1.0 (already installed):** Extract hardcoded hex values into a centralized `chart-theme.ts` object. Add watermark, custom HTML tooltip, volume histogram, OHLC legend. No new dependencies.
- **WebP image pipeline (existing):** Continue the existing pipeline for scene assets. 9-slice frame sprites are pre-optimized WebP served via CSS `url()` (not Next.js Image). Individual files, NOT sprite sheets.

**New npm packages (Phase 67 only):**
```
@next/mdx  @mdx-js/loader  @mdx-js/react
```
Optional: `remark-gfm` (GFM tables), `rehype-slug` (heading anchors)

**Explicitly rejected:** Howler.js, Tone.js, Framer Motion, styled-components, chart.js, Nextra (continued), any CSS-in-JS solution, any 3D/WebGL effects.

### Expected Features

**Must have (table stakes):**
- 9-slice frame wrapper component (core visual primitive)
- Brass button, input, tab, card, divider upgrades with texture assets
- Toggle switch and slider (needed for audio controls in Settings)
- Themed scrollbar upgrade
- Chart custom tooltip, OHLC legend, volume histogram, steampunk frame wrapper
- Background music + SFX with mute/volume controls
- Inline MDX documentation (replacing iframe-Nextra)
- MDX custom components matching steampunk theme (headings, callouts, code blocks, tables)
- Audio autoplay unlock via splash screen click
- `prefers-reduced-motion` respect for audio (default to muted)
- localStorage persistence for audio preferences

**Should have (differentiators):**
- Pressure gauge component (epoch progress, fund accumulation)
- Riveted panel header decoration
- Steampunk tooltip (Popover API)
- Music fade-in on entry, music ducking during important SFX
- Chart watermark ("Dr. Fraudsworth" branding)
- Docs sidebar navigation with search filtering
- CSS filter-based hover states on frame assets (avoid duplicate images)

**Defer to post-v1.1:**
- Custom dropdown/select component (accessibility complexity -- use styled native `<select>`)
- Mermaid diagram automation (pre-render 3-4 SVGs manually)
- 3D/WebGL effects (never build these)
- Canvas-based UI components (accessibility nightmare)
- npm-published component library (premature abstraction)
- Runtime theme switching for charts (single dark theme is sufficient)
- Client-side Mermaid rendering (~200KB bundle cost)

### Architecture Approach

The architecture preserves every existing pattern and adds three new systems: a `components/kit/` directory with a `kit.css` stylesheet imported via CSS `@layer`, an `AudioManager` singleton with React Context wrapper, and MDX content compiled via `@next/mdx` rendered inside the existing modal system. The critical architectural insight is that the existing modal singleton, React.lazy code splitting, Popover API toasts, and `@theme` token system are all battle-tested and must not be disrupted.

**Major components:**
1. **Component Kit (`components/kit/`)** -- Flat directory of themed primitives (Button, Input, Frame, Tabs, Slider, Toggle, etc.) with CSS in `kit.css` via `@layer kit`. Props use Variant + Size pattern, not className forwarding. Barrel export via `index.ts`.
2. **9-Slice Frame System** -- `Frame.tsx` component supporting both CSS-only (box-shadow/border) and asset-based (`border-image`) variants. Frame images are individual WebP files in `public/frames/`. Two visual domains: paper (modal chrome, docs) and dark (station content, DeFi UI).
3. **Audio System** -- `AudioManager` class (plain JS singleton outside React) managing AudioContext, buffer cache, and GainNode routing. `AudioProvider` (React Context) exposes `play()`, `mute()`, `toggleMute()`. Preloads core SFX on first user gesture. Provider sits inside ToastProvider, outside children.
4. **MDX Documentation** -- Content in `content/docs/` organized by category. Rendered via `@next/mdx` with steampunk-themed `mdx-components.tsx` at project root. DocsStation replaces iframe with direct MDX rendering. Sidebar navigation via React state (not URL routing).
5. **Chart Theme** -- Centralized `chart-theme.ts` exporting `FACTORY_CHART_THEME` and `FACTORY_CANDLE_COLORS` objects. Hardcoded hex values with comments mapping to CSS tokens. Chart creation drops from ~30 lines to ~5 lines.

### Critical Pitfalls

The top 8 pitfalls, ranked by severity and likelihood:

1. **Turbopack MDX plugin serialization (CRIT-01):** Remark/rehype plugins MUST be passed as string names (`'remark-gfm'`), not imported function references. Turbopack is Rust-based and cannot execute JS functions passed through config. This is verified from official Next.js 16.1.6 docs.

2. **`border-image` ignores `border-radius` (CRIT-05):** This is a CSS spec requirement, not a browser bug. The existing `.modal-chrome` uses `border-radius: 8px`. Switching to `border-image` loses rounded corners. Mitigation: Build Frame component to support BOTH modes -- CSS-only (box-shadow/border with rounded corners) AND asset-based (`border-image` with rectangular corners). Steampunk aesthetic favors hard-corner industrial frames.

3. **Web Audio autoplay blocks all sound (CRIT-03):** AudioContext must be created AND resumed during a user gesture (click). The splash screen "Push the Button" is the perfect unlock point. iOS Safari is strictest -- requires creating a silent buffer and playing it during the gesture callback.

4. **`mdx-components.tsx` must be at project root (CRIT-02):** Not inside `app/app/` -- at the same level as `app/app/`. Also requires `pageExtensions` update in `next.config.ts`.

5. **lightweight-charts SSR crash (CRIT-04):** Chart imports must stay behind `'use client'` boundary. The existing code does this correctly, but restructuring during v1.1 chart overhaul could regress it.

6. **`border-image` sub-pixel seams on retina (HIGH-01):** Design source images at 2x/3x with 1px overlap at slice boundaries. Test on actual retina hardware, not emulation.

7. **Audio buffer memory leaks (HIGH-03):** Pre-decoded PCM audio uses significant memory (~30MB per 3-min track). Implement LRU buffer pool. Disconnect `BufferSourceNode` on `ended` event. Keep total SFX pool under 10MB.

8. **CSP blocks after MDX migration (HIGH-06):** Audit all MDX content for external resource references before migration. Self-host fonts and images. Remove iframe-related CSP entries after migration.

---

## Implications for Roadmap

Based on the combined research, the 9 phases (60-68) should follow this dependency-driven ordering:

### Phase 60: Design Tokens + Component Kit Foundation
**Rationale:** Everything else depends on the component kit. Tokens must be extended first, then the 9-slice frame primitive, then derived components (button, input, tabs, toggle, slider, divider, card, scrollbar).
**Delivers:** `components/kit/` directory, `kit.css` with `@layer kit`, extended `@theme` tokens, Frame component (both CSS-only and asset-based variants), all primitive components.
**Addresses:** Table stakes components (FEATURES 1.1), design token extensions (FEATURES 7.2), CSS architecture (ARCHITECTURE 2)
**Avoids:** CRIT-05 (border-radius conflict) by supporting dual frame modes; HIGH-01 (sub-pixel seams) by establishing asset preparation guidelines upfront; MOD-02 (sprite sheet mistake) by using individual files.

### Phase 61: Chart Overhaul
**Rationale:** Chart restyling depends on Frame component (for chart wrapper) but not on modal polish or docs. Can proceed as soon as the kit foundation exists. Minimal risk -- mostly extraction of existing hardcoded values.
**Delivers:** `chart-theme.ts`, custom HTML tooltip, OHLC legend overlay, volume histogram, chart frame wrapper, chart UX fixes (loading skeleton, keyboard a11y, resize debounce, empty state).
**Addresses:** Chart improvements (FEATURES 3.3), chart theme architecture (ARCHITECTURE 7)
**Avoids:** CRIT-04 (SSR crash) by preserving `'use client'`; HIGH-04 (memory leak) by adding `subscribeCrosshairMove` unsubscribe in cleanup; MOD-05 (ResizeObserver loop) by debouncing with RAF guard.

### Phase 62: Swap Station Polish
**Rationale:** Swap is the most-used modal. Apply the component kit to this station first for maximum visible impact. Depends on Phase 60 kit components.
**Delivers:** 9-slice framed swap modal, themed chart controls, stats bar with riveted panel header, styled form inputs.
**Addresses:** Swap station polish (FEATURES 6.5)
**Avoids:** MOD-08 (clip-path conflict) by applying frame to `.modal-chrome`, not `<dialog>`.

### Phase 63: Carnage + Staking + Wallet + Dashboard Station Polish
**Rationale:** Apply the same component kit to the remaining stations. These are independent of each other and can be done in any order within the phase, but they all depend on Phase 60.
**Delivers:** Themed Carnage Cauldron (gauge components for stats), Rewards Vat (tab refinement, pressure gauge for staked amount), Connect Wallet (framed option cards), Dashboard cards.
**Addresses:** Per-modal polish (FEATURES 6.5), gauge/meter components (FEATURES 1.2)

### Phase 64: Modal Infrastructure Polish
**Rationale:** Cross-cutting modal improvements that apply to ALL stations. Best done after individual station polish is complete so there is a clear baseline. Depends on kit components for close button, scrollbar, loading states.
**Delivers:** Brass valve close button, custom scrollbar track texture, gear-spinning loading skeleton, `overscroll-behavior: contain`, content slide-in transitions.
**Addresses:** Modal polish opportunities (FEATURES 6.2), scroll containment (FEATURES 6.3)

### Phase 65: Settings Station + Audio Controls UI
**Rationale:** Settings station needs toggle and slider components (from Phase 60). The audio controls UI must exist before the audio system is wired up (Phase 68). This creates the UI shell.
**Delivers:** Audio section in Settings modal (mute toggle, music on/off, SFX on/off, volume slider), themed slippage/priority fee controls, section dividers with GaugeDivider.
**Addresses:** Audio settings UI (FEATURES 4.7), settings polish (FEATURES 6.5)
**Avoids:** MOD-06 (audio a11y) by building accessible controls from the start (`aria-label`, `aria-pressed`, keyboard navigation).

### Phase 66: Documentation Migration (MDX)
**Rationale:** Docs migration is independent of audio and can proceed in parallel. Depends on kit components for MDX custom components (headings, callouts, code blocks, tables, dividers). Eliminates the separate docs-site Railway deployment.
**Delivers:** 16 MDX pages migrated to main app, steampunk-themed MDX components, sidebar navigation, CSP cleanup (remove iframe entries), docs-site decommissioned.
**Addresses:** MDX documentation overhaul (FEATURES 5), documentation architecture (ARCHITECTURE 5)
**Avoids:** CRIT-01 (Turbopack plugin serialization) by using string plugin names; CRIT-02 (mdx-components.tsx location) by placing at project root; MOD-04 (wrong MDX library) by using `@next/mdx` not `next-mdx-remote`; HIGH-06 (CSP blocks) by auditing content and self-hosting assets.

### Phase 67: Audio System Core
**Rationale:** Audio system depends on the Settings UI (Phase 65) being ready for the controls. The AudioManager singleton and AudioProvider can be built in parallel with docs migration (Phase 66), but the wiring to UI controls needs Settings phase complete.
**Delivers:** `AudioManager` class, `AudioProvider` context, audio preloading on first gesture, splash screen audio unlock, `prefers-reduced-motion` respect, localStorage persistence.
**Addresses:** Audio system core (FEATURES 4.1-4.6), audio architecture (ARCHITECTURE 4)
**Avoids:** CRIT-03 (autoplay policy) by lazy AudioContext creation on splash click; MOD-07 (iOS Safari) by silent buffer unlock; HIGH-03 (memory leaks) by LRU buffer pool and node disconnect; HIGH-05 (dialog gesture propagation) by using splash screen as unlock point.

### Phase 68: Audio Integration + Asset Creation
**Rationale:** Final phase -- wire audio triggers into all UI interactions, create/commission audio files, integrate with Settings controls. Must come last because it touches every station.
**Delivers:** Sound effects on all UI interactions (button clicks, lever tabs, modal open/close, swap confirm, carnage events), background music loop, audio file assets, full integration test.
**Addresses:** Sound design inventory (FEATURES 4.4), fade patterns (FEATURES 4.5)
**Avoids:** MOD-01 (format compat) by shipping MP3 as primary format; PROJ-01 (Privy dialog conflict) by testing audio during wallet confirmation flow.

### Phase Ordering Rationale

- **Tokens and kit first** because every other phase consumes these primitives. Building stations without the kit would mean rework.
- **Chart overhaul early** because it is self-contained and high-impact. It only needs the Frame component from Phase 60.
- **Station polish in the middle** because it applies the kit to real content, validating the component API before docs and audio consume it.
- **Docs and audio in the back half** because they have the most unknowns (Turbopack MDX compat, iOS Safari audio behavior) and benefit from a stable component kit.
- **Audio integration last** because it is a cross-cutting concern that touches every station -- doing it last means all UI touchpoints exist.

### Dependency Map

```
Phase 60: Design Tokens + Component Kit
  |
  +---> Phase 61: Chart Overhaul (needs Frame component)
  |
  +---> Phase 62: Swap Station Polish (needs kit components)
  |
  +---> Phase 63: Other Stations Polish (needs kit components)
  |       |
  |       +---> Phase 64: Modal Infrastructure Polish (after individual stations)
  |
  +---> Phase 65: Settings Station + Audio Controls UI (needs Toggle, Slider)
  |       |
  |       +---> Phase 67: Audio System Core (needs Settings UI for controls)
  |               |
  |               +---> Phase 68: Audio Integration + Assets (needs audio system + all stations)
  |
  +---> Phase 66: Documentation Migration (needs kit for MDX components, parallel to audio track)
```

**Parallel tracks after Phase 60:**
- Track A: Chart (61) -> Swap (62) -> Other Stations (63) -> Modal Infra (64)
- Track B: Settings (65) -> Audio Core (67) -> Audio Integration (68)
- Track C: Docs Migration (66) -- independent after kit exists

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 60 (Component Kit):** NEEDS RESEARCH -- AI-generated frame asset preparation specifics, exact `border-image-slice` values, retina testing methodology. The CSS patterns are well-established but the asset pipeline integration needs validation.
- **Phase 66 (Documentation Migration):** NEEDS EARLY VERIFICATION -- `@next/mdx` + Next.js 16.1.6 + Turbopack must be tested in the first hour of the phase. If it fails, the fallback is `next-mdx-remote/rsc`. The Turbopack plugin serialization trap (CRIT-01) is verified from official docs but the full chain needs live testing.
- **Phase 67 (Audio System):** NEEDS DEVICE TESTING -- iOS Safari audio unlock pattern must be tested on actual hardware. The silent buffer unlock is the recommended pattern but iOS 18+ behavior is unknown (beyond training data cutoff).

**Phases with standard patterns (skip deep research):**
- **Phase 61 (Chart Overhaul):** Well-documented. TradingView v5 API is verified from installed typings. Chart theme extraction is straightforward refactoring.
- **Phase 62-63 (Station Polish):** Standard CSS application of kit components. No novel patterns.
- **Phase 64 (Modal Infra):** Small CSS additions (`overscroll-behavior`, scrollbar styling, loading skeleton). All well-established patterns.
- **Phase 65 (Settings UI):** Standard form controls using kit components.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Almost everything is browser-native or already installed. Only 3 new npm packages for MDX. Verified from codebase analysis + installed typings. |
| Features | MEDIUM-HIGH | Feature inventory is solid (based on codebase analysis). TradingView custom tooltip API and MDX dynamic import patterns need live verification. |
| Architecture | HIGH | Directly extends existing patterns. Provider tree, component organization, CSS layer approach all follow established codebase conventions. |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls (Turbopack serialization, border-radius, autoplay) are HIGH confidence. iOS Safari specifics and Safari SVG border-image are MEDIUM (may have improved beyond training data). |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

1. **`@next/mdx` + Turbopack live verification:** Researchers could not test this combination. Must be validated in the first task of Phase 66. Fallback: `next-mdx-remote/rsc` (zero Turbopack dependency since it compiles its own MDX).

2. **iOS Safari audio behavior (2026):** Training data covers through iOS 17. The silent buffer unlock pattern may no longer be necessary on iOS 18+. Test on current hardware during Phase 67.

3. **Safari `border-image` with WebP:** Safari's handling of WebP as `border-image-source` should be verified. PNG is the safe fallback if WebP causes issues.

4. **`rehype-pretty-code` Turbopack compatibility:** If syntax highlighting is desired for docs code blocks, this plugin's string-format compatibility with Turbopack is unknown. Simplest approach: skip syntax highlighting in v1.1 and use plain styled `<pre>` blocks.

5. **AI-generated frame asset pipeline:** The asset preparation process (Photoshop processing, color correction to token palette, 9-slice region specification) needs to be established before Phase 60 implementation begins. The research documents the requirements but the tooling/workflow is not yet set up.

6. **Audio file creation/sourcing:** No audio files exist yet. Steampunk SFX and background music need to be sourced, commissioned, or generated. This is a content dependency for Phase 68 that should be started early (during Phase 60-65 development).

7. **WebM/Opus vs MP3 decision:** STACK.md recommends MP3 for universal compat; ARCHITECTURE.md recommends WebM/Opus for better compression and latency. MP3 is the safer choice. Provide dual formats if budget allows.

### Conflicts Between Research Documents

One minor disagreement was identified:

- **Audio file format:** STACK.md recommends MP3 as the sole format for simplicity and universal support. ARCHITECTURE.md recommends WebM/Opus for superior compression and lower decode latency. **Resolution:** Use MP3 as the primary format (guaranteed universal support). If Safari adds full Opus support by Phase 68 implementation time, switch to Opus. Do not ship dual formats unless testing reveals a real problem.

- **Both STACK.md and ARCHITECTURE.md** converge on all other technology choices. FEATURES.md and PITFALLS.md are fully aligned with the stack and architecture recommendations.

---

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `globals.css`, `next.config.ts`, `CandlestickChart.tsx`, `ModalShell.tsx`, `package.json` -- verified existing patterns and installed versions
- Installed typings: `node_modules/lightweight-charts/dist/typings.d.ts` -- verified v5 API surface
- Official Next.js 16.1.6 documentation (fetched 2026-02-24) -- Turbopack MDX plugin serialization, `mdx-components.tsx` requirements, `@next/mdx` vs `next-mdx-remote` comparison
- CSS specification -- `border-image`, `border-image-slice`, `border-radius` interaction, `@layer`

### Secondary (MEDIUM confidence)
- Web Audio API specification (training data) -- AudioContext lifecycle, autoplay policies, GainNode routing
- Browser autoplay policies (training data, stable since 2018) -- user gesture requirements
- TradingView lightweight-charts v5 API (training data + installed typings) -- `subscribeCrosshairMove`, watermark, histogram series
- iOS Safari audio initialization patterns (training data through iOS 17)

### Tertiary (LOW confidence -- needs validation)
- Safari SVG `border-image` rendering (training data, may be fixed in Safari 18+)
- `rehype-pretty-code` Turbopack string-format compatibility
- iOS 18+ AudioContext unlock requirements
- `@next/mdx` behavior with TypeScript config format (official docs show `.mjs` examples)

---
*Research completed: 2026-02-24*
*Ready for roadmap: yes*
