# Domain Pitfalls: v1.1 Modal Mastercraft, Docs & Audio

**Domain:** Steampunk UI component kit, chart overhaul, modal polish, MDX documentation migration, and audio system for a gamified DeFi frontend on Next.js 16.1.6 + Turbopack
**Researched:** 2026-02-24
**Overall Confidence:** MEDIUM-HIGH (Turbopack/MDX findings verified via official Next.js 16.1.6 docs; CSS border-image, Web Audio API, and lightweight-charts findings based on training data with MDN/spec-level knowledge -- marked accordingly)

---

## Critical Pitfalls

Mistakes that cause broken functionality, SSR failures, or require significant rework.

---

### CRIT-01: Turbopack MDX Plugin Serialization Trap

**What goes wrong:** You configure `@next/mdx` with remark/rehype plugins passed as JavaScript function references (the standard webpack pattern), and Turbopack silently fails or throws cryptic errors. The dev server starts but MDX pages render as blank or throw hydration errors.

**Why it happens:** Turbopack is written in Rust. It cannot execute arbitrary JavaScript functions passed through configuration. The `@next/mdx` package with Turbopack requires plugins to be specified as **string names**, not imported function references. This is explicitly documented in the official Next.js 16.1.6 MDX guide (verified 2026-02-24).

**Consequences:**
- MDX pages render blank or throw errors in development
- No clear error message pointing to the plugin serialization issue
- Developers spend hours debugging thinking it's a content issue
- If you switch to `--webpack` to "fix" it, you lose Turbopack benefits and may trigger the Sentry-like SSR breakage patterns this project has already suffered

**Prevention:**
1. **Always pass remark/rehype plugins as strings to `@next/mdx` when using Turbopack:**
   ```js
   // CORRECT for Turbopack
   const withMDX = createMDX({
     options: {
       remarkPlugins: ['remark-gfm'],
       rehypePlugins: ['rehype-slug'],
     },
   })

   // WRONG for Turbopack (works with webpack only)
   import remarkGfm from 'remark-gfm'
   const withMDX = createMDX({
     options: {
       remarkPlugins: [remarkGfm],  // Function ref -- Turbopack can't serialize this
     },
   })
   ```
2. **Plugins with non-serializable options cannot be used with Turbopack at all.** If a plugin requires a JavaScript function as an option (e.g., a custom transform callback), it is incompatible. Choose plugins that accept only JSON-serializable options (strings, numbers, booleans, arrays, plain objects).
3. **Test MDX rendering in dev mode (Turbopack) FIRST, not in `next build`.** The build may use a different code path. Dev mode with Turbopack is the constraint.
4. **For complex plugin chains, consider the experimental Rust-based MDX compiler** (`mdxRs: true` in next.config). It may handle some cases better, but it is still experimental -- test thoroughly.

**Warning signs:** MDX pages render blank in `next dev` but work in `next build --webpack`. Console shows "cannot serialize function" or similar. HMR stops working for `.mdx` files.

**Detection:** Open any MDX page in dev mode after adding plugins. If it renders, good. If blank/error, check plugin format.

**Confidence:** HIGH -- verified from official Next.js 16.1.6 documentation fetched 2026-02-24.

**Severity:** CRITICAL

---

### CRIT-02: @next/mdx Requires mdx-components.tsx at Project Root

**What goes wrong:** You install `@next/mdx` in the `app/` directory and create `mdx-components.tsx` inside `app/` (alongside `app/app/`), but Next.js cannot find it. MDX pages fail to compile with an unhelpful error, or render without any custom component mapping.

**Why it happens:** Next.js 16 with App Router requires `mdx-components.tsx` to exist at the **project root** (same level as `app/` directory, NOT inside it). The official docs state: "Create an `mdx-components.tsx` file in the root of your project." The existing docs-site already has this file at `docs-site/mdx-components.tsx` -- but the main app at `/app/` does not have one yet.

**Consequences:**
- MDX compilation fails silently or with misleading errors
- Custom component overrides (steampunk-styled headings, callouts, code blocks) never apply
- You cannot use JSX imports within MDX files

**Prevention:**
1. Create `app/mdx-components.tsx` at the project root (same level as `app/app/`, `app/components/`, etc.)
2. The existing `docs-site/mdx-components.tsx` imports from `nextra-theme-docs` -- the main app version should NOT do this. Build custom steampunk-themed components instead.
3. Also add `pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx']` to `next.config.ts`.

**Confidence:** HIGH -- verified from official docs + observed existing `docs-site/mdx-components.tsx`.

**Severity:** CRITICAL

---

### CRIT-03: Web Audio API Autoplay Policy Blocks Sound on First Visit

**What goes wrong:** You create an `AudioContext` on page load and try to play background music or ambient SFX. The audio silently fails -- no sound plays, no error is thrown in many browsers. Users think the audio system is broken.

**Why it happens:** All modern browsers enforce autoplay policies that **require a user gesture** (click, tap, keyboard press) before an `AudioContext` can produce sound. An `AudioContext` created without a user gesture starts in a "suspended" state. Calling `.play()` or scheduling audio nodes does nothing audible until `audioContext.resume()` is called **in response to a user gesture event handler**.

The policies differ by browser:
- **Chrome/Edge:** AudioContext starts suspended. Must call `resume()` from a user gesture. Some sites get "auto-play policy" exemptions after repeated visits.
- **Safari (desktop):** Same suspended start. Resume only from click/tap/keyboard.
- **Safari (iOS):** Strictest. AudioContext must be created AND resumed within the same user gesture callback. Creating it at load time and resuming later can still fail on some iOS versions.
- **Firefox:** Generally more permissive but still suspends AudioContext by default.

**Consequences:**
- Silent app on first visit
- Users who click "mute" will never hear sound even after unmuting if AudioContext was never properly resumed
- iOS Safari users may never get audio working at all if initialization pattern is wrong
- Race conditions between "user clicks play" and "AudioContext is ready" cause intermittent silence

**Prevention:**
1. **Create AudioContext lazily on first user interaction, not on page load.** The splash screen "Push the Button" flow is the PERFECT place for this -- the button click IS the user gesture.
2. **Pattern: "Audio unlock" on first interaction:**
   ```typescript
   let audioCtx: AudioContext | null = null;

   function getAudioContext(): AudioContext {
     if (!audioCtx) {
       audioCtx = new AudioContext();
     }
     if (audioCtx.state === 'suspended') {
       audioCtx.resume(); // Only works inside a user gesture handler
     }
     return audioCtx;
   }
   ```
3. **For iOS Safari: create AND play a silent buffer within the same click handler** to "unlock" the AudioContext. Some iOS versions require actual audio output (even silent) during the gesture callback.
4. **Store AudioContext state in a ref, not React state.** AudioContext is mutable and should not trigger re-renders.
5. **Always check `audioContext.state` before attempting playback.** States are: `suspended`, `running`, `closed`.
6. **Never assume `resume()` is synchronous.** It returns a Promise. On some browsers, it takes a few ms to actually transition to `running`.

**Warning signs:** Console warning "The AudioContext was not allowed to start." Audio works on desktop Chrome but not iOS Safari. Audio works on second visit but not first.

**Detection:** Test on actual iOS device (simulator does not enforce the same policies). Test in Chrome with `chrome://flags/#autoplay-policy` set to strict.

**Confidence:** HIGH -- Web Audio autoplay policies are well-established browser specs. The specific iOS Safari quirks are MEDIUM confidence (based on training data, may have changed in iOS 18+).

**Severity:** CRITICAL

---

### CRIT-04: TradingView Lightweight Charts SSR Crash -- Canvas in Server Components

**What goes wrong:** Importing `lightweight-charts` at the top level of a component that participates in SSR (even transitively through a parent) causes a server-side crash because `lightweight-charts` immediately references `document`, `window`, or `HTMLCanvasElement` at module evaluation time.

**Why it happens:** `lightweight-charts` v5 is a canvas-based library. Canvas APIs are browser-only. If any part of the module-level code (even just type setup or factory initialization) touches browser globals, importing it on the server crashes. The current codebase already handles this correctly (`CandlestickChart.tsx` is `'use client'`), but the v1.1 chart overhaul may restructure things.

**Consequences:**
- HTTP 500 on any page that transitively imports the chart component during SSR
- Error message: "document is not defined" or "self is not defined"
- This is the exact same class of bug that Sentry caused -- server code touching browser globals

**Prevention:**
1. **Always keep chart components behind `'use client'` boundary.** The existing `CandlestickChart.tsx` already does this correctly.
2. **If adding new chart types (volume bars, overlays, custom indicators), ensure they are also `'use client'`.**
3. **Never import `lightweight-charts` in a shared utility file** that might be imported by server components.
4. **Use `next/dynamic` with `ssr: false` as a safety net** if restructuring chart components into a new module hierarchy:
   ```typescript
   const Chart = dynamic(() => import('./CandlestickChart'), { ssr: false });
   ```
5. **The v5 API change (`chart.addSeries(CandlestickSeries, options)` instead of `chart.addCandlestickSeries()`) is already correctly implemented** in the current codebase. Don't regress to the v4 API.

**Warning signs:** HTTP 500 errors after restructuring chart code. "document is not defined" in server logs.

**Confidence:** HIGH -- verified from current codebase analysis (`lightweight-charts` v5.1.0 in package.json, `'use client'` directive on `CandlestickChart.tsx`).

**Severity:** CRITICAL

---

### CRIT-05: border-image Does Not Respect border-radius

**What goes wrong:** You build the 9-slice steampunk frame component using CSS `border-image` for the brass/wood border decoration, then add `border-radius` to get rounded corners. The border-image renders as a sharp rectangle -- border-radius is completely ignored. The steampunk frames look angular and broken on every element that expects rounded corners.

**Why it happens:** This is a **CSS specification limitation**, not a browser bug. The CSS spec explicitly states that `border-image` takes precedence over `border-radius` rendering. When `border-image` is set, `border-radius` has no visual effect on the border itself (it may still clip the content/background via `overflow`, but the border-image paints as a rectangle).

This affects ALL browsers uniformly -- Chrome, Firefox, Safari, Edge.

**Consequences:**
- Every steampunk frame component renders with sharp corners
- The existing modal chrome (`.modal-chrome`) uses `border-radius: 8px` and `border: 3px solid var(--color-factory-accent)` -- switching to `border-image` would lose the rounded corners
- Attempting to work around with `clip-path: inset(0 round 8px)` adds complexity and may cause issues with the existing iris-open animation which also uses `clip-path`

**Prevention:**
1. **Do NOT use CSS `border-image` for rounded components.** Use one of these alternatives instead:
   - **Pseudo-element approach:** Use `::before`/`::after` with `background-image` + `background-size` + `background-position` to manually position the 9-slice regions. The content area gets normal `border-radius`.
   - **Multiple background layers:** Apply 9-slice pieces as multiple `background-image` layers on a wrapper div, with the corner pieces positioned absolutely.
   - **SVG border approach:** Create an SVG that contains the 9-slice frame with rounded corners baked in. Reference via `background-image: url(frame.svg)`.
   - **CSS `border-image` ONLY for rectangular elements** where rounded corners are not needed (e.g., full-screen overlays, banners, separators).
2. **If the design strictly requires `border-image` with rounded corners**, the ONLY working approach is:
   - Apply `border-image` for the frame
   - Use `overflow: hidden` + `border-radius` on the CONTENT container (child div) to round the inner content area
   - Accept that the outer border edge will be rectangular
   - Mask the outer corners with additional decorative elements (the existing `.modal-bolt` corner bolts already serve this purpose)

**Warning signs:** Border-radius not rendering on any element with border-image. The component looks correct in Figma/design but wrong in browser.

**Confidence:** HIGH -- this is a well-established CSS specification behavior, not a browser-specific bug. MDN explicitly documents this limitation.

**Severity:** CRITICAL

---

## High Pitfalls

Mistakes that cause significant visual or functional issues but have clear workarounds.

---

### HIGH-01: border-image Sub-Pixel Rendering on Retina/HiDPI Displays

**What goes wrong:** The 9-slice border frame renders with visible hairline gaps, seam lines, or misaligned slices on retina (2x) and HiDPI (3x) displays. Individual border segments appear to have 1px white/transparent lines between them. The effect is most visible on diagonal or textured frame art.

**Why it happens:** When the browser scales border-image slices to fit the element's border dimensions, sub-pixel rounding occurs. A slice that should be 3.5 CSS pixels wide gets rounded to either 3px or 4px, creating a 0.5px gap or overlap. Different browsers round differently:
- Chrome rounds toward the nearest pixel
- Safari sometimes introduces half-pixel offsets on retina displays
- Firefox has its own rounding strategy

The problem is amplified when:
- The source image dimensions are not multiples of the border-image-slice values
- The element's rendered size creates fractional pixel slice widths
- The display DPR (device pixel ratio) creates additional sub-pixel math

**Consequences:**
- Visible seam lines through the steampunk frame
- Different appearance on different displays and browsers
- Customer perception of "broken" or "low quality" UI

**Prevention:**
1. **Design source images at 2x or 3x resolution** with slice boundaries on even pixel values. If the border-image-slice is 30 CSS pixels, the source image should be designed with 60px or 90px slice regions.
2. **Add 1px overlap to each slice region** in the source image. The 9-slice grid should overlap by 1 source pixel at each boundary. This prevents gaps without creating visible doubling.
3. **Use `border-image-slice: [value] fill`** to ensure the center region is also rendered, preventing "see-through" center areas.
4. **Test on actual retina hardware**, not just Chrome DevTools device emulation (which doesn't accurately simulate sub-pixel rendering).
5. **Use integer CSS pixel values for border-width** that correspond cleanly to the image's slice dimensions. Avoid fractional border widths.
6. **Consider using `image-rendering: pixelated`** on the border container if the art style permits (steampunk/pixel-art aesthetic). This forces nearest-neighbor scaling and eliminates sub-pixel blending.

**Warning signs:** Faint horizontal or vertical lines through the border frame. The frame looks perfect on a standard display but broken on retina. Different browsers show slightly different seam positions.

**Confidence:** MEDIUM -- sub-pixel rendering behavior is well-established but specific browser behavior in 2026 may have improved. The general pattern of gaps at slice boundaries on HiDPI displays is consistent in my training data.

**Severity:** HIGH

---

### HIGH-02: border-image-repeat Rendering Inconsistencies

**What goes wrong:** You use `border-image-repeat: round` or `border-image-repeat: space` to tile the side segments of the 9-slice frame, and the result looks different across browsers. `round` scales tiles to fit without clipping (but the scale factor differs), and `space` distributes tiles evenly (but the gap sizes differ).

**Why it happens:** The CSS `border-image-repeat` property has three values:
- `stretch`: Always works consistently (stretches a single tile to fill)
- `round`: Scales tiles so a whole number fits. But browsers differ on how they choose the tile count (floor vs round vs ceil).
- `space`: Distributes tiles with equal spacing. Browser differences in sub-pixel space distribution.

For textured steampunk frames, `stretch` can distort patterns. `round` is usually correct but the scaling can look wrong at certain element sizes.

**Prevention:**
1. **Default to `border-image-repeat: stretch` for the initial implementation.** It is the most predictable.
2. **Design side/edge tiles to look acceptable when stretched.** If the tile is a simple gradient or subtle texture, stretching is invisible.
3. **If `round` is needed**, test at multiple element sizes (300px, 500px, 800px, 1100px -- all the modal max-widths in the project). The tile scaling should look acceptable at all sizes.
4. **Consider using separate CSS background images for repeating border segments** instead of `border-image-repeat`. CSS `background-repeat: repeat` on positioned pseudo-elements gives more control.

**Warning signs:** Border side segments look "stretched" at some modal sizes but fine at others. Tiles appear to shift or resize when the modal is resized.

**Confidence:** MEDIUM -- based on established CSS spec knowledge. Specific browser rendering behavior may have improved.

**Severity:** HIGH

---

### HIGH-03: Web Audio Memory Leaks from Unmanaged Audio Buffers

**What goes wrong:** The audio system loads music tracks and SFX into `AudioBuffer` objects and keeps them in memory indefinitely. Over a long session (common for a DeFi app where users leave the tab open to monitor prices), memory usage grows continuously. Eventually the browser tab becomes sluggish or crashes.

**Why it happens:** `AudioBuffer` objects are raw PCM audio data stored in JavaScript memory (not GPU memory like images). A 3-minute music track at 44.1kHz stereo 32-bit float = ~30MB of memory. If you have 5 music tracks + 20 SFX loaded, that is ~200MB just for audio.

Common mistakes:
- Loading all audio upfront "for instant playback"
- Creating new `AudioBufferSourceNode` per play without cleanup (the nodes are GC'd but only after disconnection)
- Not disconnecting completed audio nodes from the audio graph
- Caching decoded buffers for rarely-used SFX

**Consequences:**
- Memory usage grows over time (especially problematic on mobile devices with 2-4GB RAM)
- Browser kills the tab to reclaim memory (users lose their transaction in progress)
- Audio playback stutters when GC runs to reclaim old buffers

**Prevention:**
1. **Implement an audio buffer pool with LRU eviction.** Load at most N buffers (e.g., current music track + 5 most recently used SFX). Evict least-recently-used buffers when the pool is full.
2. **Disconnect audio nodes when they finish playing:**
   ```typescript
   source.onended = () => {
     source.disconnect();
   };
   ```
3. **For music (long tracks): use `fetch` + `decodeAudioData` streaming**, not preloading entire tracks. Load the next track only when the current one is about to end or when user requests a track change.
4. **For SFX (short sounds): preload these since they need instant playback.** Keep total SFX buffer pool under 10MB.
5. **Provide a way to completely destroy the audio system** when the user navigates away (component unmount). Call `audioContext.close()` in cleanup.
6. **Monitor: `performance.memory` API** (Chrome only) to track JS heap during long sessions.

**Warning signs:** Chrome DevTools "Memory" tab shows `ArrayBuffer` objects growing over time. The "Audio" panel in Chrome DevTools shows disconnected nodes accumulating.

**Confidence:** MEDIUM -- Web Audio memory management patterns are well-established. Specific buffer sizes and behavior may vary with browser versions.

**Severity:** HIGH

---

### HIGH-04: TradingView Chart Memory Leak on Repeated Mount/Unmount

**What goes wrong:** The chart component mounts inside a modal. User opens modal, chart creates. User closes modal, chart component unmounts. Repeat 20 times. Memory grows with each cycle because `chart.remove()` does not fully clean up internal state, or the cleanup runs before the chart finishes its last render cycle.

**Why it happens:** The current `CandlestickChart.tsx` correctly calls `chart.remove()` in the useEffect cleanup. However, there are subtle timing issues:
- `ResizeObserver` callbacks may fire after `chart.remove()` is called, causing errors
- `chart.remove()` removes the DOM elements but internal JavaScript references may be retained if any closures reference the chart
- The current code stores chart/series refs and resets them in cleanup, which is correct. But if the v1.1 overhaul adds new features (tooltips, overlays, custom drawing), each one is a potential leak vector.

**Consequences:**
- Memory grows ~5-10MB per mount/unmount cycle
- After ~30 cycles, page becomes sluggish
- Chart rendering gets slower with each remount

**Prevention:**
1. **Keep the current cleanup pattern but add ResizeObserver disconnect BEFORE chart.remove():**
   ```typescript
   return () => {
     resizeObserver?.disconnect();  // First: stop resize callbacks
     chart.remove();                 // Then: remove chart
     chartRef.current = null;
     seriesRef.current = null;
   };
   ```
   (The current code already does this correctly -- preserve this order.)
2. **Consider keeping the chart mounted but hidden** when the modal closes, rather than destroying and recreating. The current singleton modal approach (`ModalShell` stays in DOM, content swaps inside) could keep the chart alive with `display: none` on the chart container and only call `chart.resize()` when it becomes visible again.
3. **Do NOT add event listeners to the chart object** without corresponding cleanup. `chart.subscribeCrosshairMove()` returns an unsubscribe function -- always call it in cleanup.
4. **After the v1.1 overhaul, test with a 50-cycle mount/unmount loop** and check Chrome DevTools Memory tab for retained objects.

**Warning signs:** Growing `detached HTMLCanvasElement` count in Memory tab heap snapshots. Console errors "Cannot read property of null" after closing and reopening the chart modal.

**Confidence:** MEDIUM -- based on common React + canvas library patterns. The specific v5.1.0 behavior may differ from training data.

**Severity:** HIGH

---

### HIGH-05: Dialog + Audio Interaction -- User Gesture Propagation Through Modals

**What goes wrong:** User clicks a button inside a `<dialog>` modal to play audio (e.g., "Enable Music" toggle in Settings station). The audio does not play because the browser does not consider the click a "user gesture" for audio purposes, since the click event originated inside a modal dialog's shadow tree or was processed through React's synthetic event system.

**Why it happens:** Browser autoplay policies require a "user gesture" -- but the definition of what constitutes a gesture varies:
- The click must be on a DOM element (not prevented by `e.preventDefault()`)
- Some older browser versions had issues with events inside `<dialog>` elements not counting as user gestures
- React's synthetic event system batches and re-dispatches events, which CAN cause some browsers to lose the "trusted" flag on the event

Additionally, the project's `usePrivyTopLayer.ts` hook temporarily switches the dialog from `showModal()` to `show()` and back. During this transition, click events may be swallowed or re-targeted.

**Prevention:**
1. **Call `audioContext.resume()` directly in the native click handler, not in a `useEffect` or `setTimeout`:**
   ```typescript
   // CORRECT: resume in the same synchronous call stack as the click
   function handleEnableAudio(e: React.MouseEvent) {
     audioContext.resume().then(() => {
       playBackgroundMusic();
     });
   }

   // WRONG: deferred resume may lose user gesture context
   function handleEnableAudio() {
     setTimeout(() => audioContext.resume(), 0); // May fail
   }
   ```
2. **Use the splash screen button click as the audio unlock moment.** The existing `SplashScreen.tsx` "Push the Button" interaction is the first user gesture -- perfect for creating and resuming the AudioContext.
3. **If audio toggle is in Settings station (inside modal), ensure the toggle handler calls `resume()` synchronously** within the same event handler microtask.
4. **Test on iOS Safari with the modal open.** iOS is the strictest about user gesture requirements.

**Warning signs:** Audio works when triggered from non-modal UI but fails when triggered from inside a dialog. Audio works on Chrome but not Safari.

**Confidence:** MEDIUM -- the dialog + user gesture interaction is an edge case. The core principle (resume in gesture handler) is HIGH confidence, but specific browser behavior with dialogs is MEDIUM.

**Severity:** HIGH

---

### HIGH-06: CSP Headers Block Inline MDX Styles and External Fonts

**What goes wrong:** After migrating docs from iframe-Nextra to inline MDX, custom MDX components that use inline styles or load external resources fail silently. Content renders without styling, or external fonts/images don't load. No visible error in the UI -- but the browser console shows CSP violations.

**Why it happens:** The current CSP in `next.config.ts` is strict:
```
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
```

Potential CSP conflicts with MDX content:
- **`style-src 'self' 'unsafe-inline'`:** Currently allows inline styles. BUT if you later tighten this (which is a security best practice), MDX component inline styles will break.
- **`font-src 'self'`:** If MDX docs embed Google Fonts or other CDN fonts, they will be blocked. The existing docs-site loads Google Fonts (`fonts.googleapis.com`) but this is in a separate origin (iframe) so the main app's CSP doesn't apply.
- **`img-src 'self' data: blob:`:** If MDX docs reference external images (diagrams, badges), they will be blocked.
- **`connect-src`:** If MDX docs need to fetch external data (unlikely for docs, but possible for interactive examples).
- **`frame-src` / `child-src`:** Currently allowlists the docs iframe. After migration to inline MDX, the iframe entries become unnecessary (cleanup opportunity).

**Prevention:**
1. **Audit all MDX content for external resource references** before migration. The existing MDX files at `docs-site/content/` need to be checked.
2. **Self-host any fonts or images** referenced in docs. Download Google Fonts and serve from `/public/fonts/`. This also improves performance (no external DNS lookup).
3. **Add any necessary external domains to CSP** if self-hosting is not practical. But prefer self-hosting for a DeFi app (fewer external dependencies = smaller attack surface).
4. **The current `'unsafe-inline'` for styles is sufficient** for inline MDX component styles. Do NOT tighten this without also switching to CSS modules or Tailwind classes for all MDX components.
5. **Remove the iframe-related CSP entries** (`child-src`, `frame-src` for docs site URLs) after migration is complete. Keeping them is harmless but clutters the security policy.

**Warning signs:** MDX content renders but looks unstyled. Browser console shows `Refused to load the stylesheet` or `Refused to load the image` CSP violations. Fonts render as system fallbacks.

**Confidence:** HIGH -- verified from current `next.config.ts` CSP header configuration.

**Severity:** HIGH

---

### HIGH-07: Safari border-image Rendering with SVG Sources

**What goes wrong:** You create the 9-slice frame as an SVG file (scalable, resolution-independent) and use it with `border-image-source: url(frame.svg)`. It renders correctly on Chrome and Firefox but is distorted, pixelated, or missing on Safari.

**Why it happens:** Safari has historically had rendering issues with SVG used as `border-image-source`:
- SVG viewBox dimensions not being honored correctly
- Rasterization happening at 1x even on retina displays
- `preserveAspectRatio` being ignored for border-image rendering
- SVG with embedded CSS animations not rendering in border-image context

**Consequences:**
- Safari users (significant on macOS/iOS, where your DeFi users likely are) see broken frames
- No error messages -- just visual breakage

**Prevention:**
1. **Use rasterized PNG/WebP sources for border-image**, not SVG. Generate 2x and 3x raster versions.
2. **If SVG is required, add explicit `width` and `height` attributes** (not just viewBox) to the SVG root element.
3. **Test on actual Safari** (not Chrome's user-agent spoofing). Safari's rendering engine (WebKit) differs significantly from Blink (Chrome).
4. **Alternatively, skip `border-image` entirely** for Safari-critical components and use the pseudo-element approach (see CRIT-05 prevention strategies).

**Warning signs:** Frame renders differently on Safari vs Chrome. SVG border appears pixelated on retina Mac.

**Confidence:** LOW-MEDIUM -- Safari SVG border-image issues are known from training data but may have been fixed in Safari 18+ (2025-2026). Verify on current Safari version.

**Severity:** HIGH (given macOS/iOS is a primary target platform for crypto users)

---

## Moderate Pitfalls

Mistakes that cause visual issues, performance degradation, or technical debt.

---

### MOD-01: Audio Format Compatibility Across Browsers

**What goes wrong:** You ship audio files in a single format (e.g., OGG Vorbis for small size) and discover it does not play on Safari/iOS, which does not support OGG in all contexts.

**Why it happens:** Audio codec support varies:
- **MP3:** Universal support. Slightly larger files. Lossy.
- **OGG Vorbis:** Chrome, Firefox, Edge. NOT supported in Safari (as of training data).
- **AAC/M4A:** Safari, Chrome, Edge, Firefox. Good compression.
- **WebM/Opus:** Chrome, Firefox, Edge. Partial Safari support.
- **WAV:** Universal but huge files. Only for very short SFX.

**Prevention:**
1. **Use MP3 as the primary format for maximum compatibility.** It is universally supported.
2. **For smaller files, provide OGG as a progressive enhancement** with MP3 fallback:
   ```typescript
   const audioSource = canPlayOgg() ? 'music.ogg' : 'music.mp3';
   ```
3. **For SFX (short clips), WAV or MP3 is fine.** File size matters less for 1-second effects.
4. **Check `AudioContext.decodeAudioData` success/failure** and fall back to alternate format on failure.
5. **Pre-generate both formats at build time** as part of the asset pipeline.

**Warning signs:** Audio works on Chrome but silent on Safari. `decodeAudioData` Promise rejects.

**Confidence:** MEDIUM -- codec support is well-established but Safari's OGG/Opus support may have changed in recent versions.

**Severity:** MODERATE

---

### MOD-02: Large Image Sprites vs Individual Assets for 9-Slice

**What goes wrong:** You create a single large sprite sheet containing all 9-slice frame variants (different sizes, hover states, pressed states) and discover:
- The sprite sheet exceeds 2MB, negating any loading benefit
- GPU memory usage spikes because the entire sprite must be decoded even if only one frame is used
- `border-image-slice` cannot reference sprite positions -- it slices the ENTIRE image, not a sub-region

**Why it happens:** CSS `border-image` treats the entire `border-image-source` as the 9-slice source. There is no "sprite offset" concept in the border-image spec. Unlike CSS `background-image` where you can use `background-position` to select a sprite region, `border-image-source` always uses the full image.

**Prevention:**
1. **Use individual image files for each 9-slice frame variant.** One file per frame style (e.g., `frame-brass.png`, `frame-copper.png`, `frame-wood.png`).
2. **Keep each frame image small** -- a 200x200px source image with proper slice values can decorate any size element. The browser scales the slices.
3. **Use WebP format** for the frame images. WebP with alpha is well-supported and typically 30-50% smaller than PNG.
4. **Preload the most-used frame variant** via `<link rel="preload" as="image">` since it will be needed for the first modal open.
5. **For hover/pressed state variants, consider CSS filters** (`brightness`, `saturate`, `hue-rotate`) applied to a single frame image rather than separate images per state. This halves the number of image assets.

**Warning signs:** Network tab shows large sprite sheet download. border-image renders the wrong region of a sprite.

**Confidence:** HIGH -- CSS border-image spec behavior is well-defined regarding source image handling.

**Severity:** MODERATE

---

### MOD-03: MDX Hot Reload Stalling in Development

**What goes wrong:** During MDX content authoring, hot module reload (HMR) becomes slow or stops working. Editing an MDX file requires a full page reload to see changes. Development velocity drops significantly.

**Why it happens:** MDX compilation involves multiple transformation passes (remark parse, rehype transform, React component generation). With Turbopack, each MDX file change triggers this full pipeline. If you have many MDX files with complex plugin chains, the compilation time per change can exceed the HMR timeout.

Additional factors:
- Large MDX files (>500 lines) take longer to compile
- Many remark/rehype plugins add latency to each compilation
- Imported React components within MDX files create additional dependency chains that Turbopack must trace

**Prevention:**
1. **Keep MDX files small.** Split long docs into multiple pages (one concept per page). Target <200 lines per MDX file.
2. **Minimize remark/rehype plugins.** Each plugin adds compilation overhead. Start with zero plugins and add only what is needed (remark-gfm for tables, rehype-slug for heading anchors).
3. **Use `@next/mdx` with static imports** (files in the `/app` directory tree) rather than dynamic `import()`. Static imports are faster for Turbopack to track.
4. **Do NOT use `next-mdx-remote` unless you need truly remote MDX** (fetched from an API at runtime). `@next/mdx` with local files is faster and better integrated with Turbopack.
5. **Monitor dev compilation times** via the terminal output. If MDX changes take >3 seconds, you have too many plugins or too-large files.

**Warning signs:** Terminal shows long compilation times for MDX changes. HMR falls back to full page reload for MDX edits. "Compiling..." indicator stays visible for >2 seconds.

**Confidence:** MEDIUM -- based on general Turbopack/MDX compilation patterns. Specific performance characteristics may vary with Turbopack version bundled in Next.js 16.1.6.

**Severity:** MODERATE

---

### MOD-04: next-mdx-remote vs @next/mdx -- Wrong Tool for the Job

**What goes wrong:** You install `next-mdx-remote` (designed for fetching MDX content from a CMS or API at runtime) when the actual need is rendering local MDX files that live in the repository. The added complexity provides no benefit and introduces a serialization layer that limits what MDX components can do.

**Why it happens:** Confusion between two common MDX approaches:
- **`@next/mdx`:** Compiles local `.mdx` files at build time. Full React component power. Works with Turbopack (as verified in Next.js 16.1.6 docs). Best for documentation that lives in the repo.
- **`next-mdx-remote`:** Designed for MDX content fetched at runtime (from a database, CMS, or API). Requires serialization of MDX content. Components must be passed explicitly (not imported in MDX). More restrictive.

Since the v1.1 milestone is migrating FROM an iframe-Nextra docs site TO inline documentation, and the MDX content already lives in `docs-site/content/`, this is a clear case for `@next/mdx` with local files.

**Prevention:**
1. **Use `@next/mdx` (not `next-mdx-remote`) for the docs migration.** The content lives in the repo, not a remote CMS.
2. **Move MDX files from `docs-site/content/` to `app/content/` or `app/app/docs/`** and set up `@next/mdx` with `pageExtensions`.
3. **Alternatively, use dynamic imports with `@next/mdx`** to load MDX files on demand (the official docs show this pattern with `generateStaticParams`).
4. **Only consider `next-mdx-remote` if the project later needs user-generated or admin-edited docs** stored in a database.

**Turbopack compatibility note:** `@next/mdx` is explicitly supported by Turbopack (verified in official docs). `next-mdx-remote` compatibility with Turbopack is UNKNOWN -- it relies on custom serialization that may or may not work. Avoid the risk.

**Warning signs:** Installing `next-mdx-remote` when all content is local. Having to `serialize()` MDX content that is already available as files.

**Confidence:** HIGH -- verified from official Next.js 16.1.6 MDX documentation.

**Severity:** MODERATE

---

### MOD-05: ResizeObserver Loop Error on Chart Inside Animated Modal

**What goes wrong:** Opening the swap modal (which contains the chart) triggers a continuous `ResizeObserver loop completed with undelivered notifications` warning in the console. In some cases, this cascades into visible chart flickering.

**Why it happens:** The chart's `ResizeObserver` fires when the chart container width changes. The chart then calls `chart.applyOptions({ width: newWidth })`, which changes the DOM, which triggers the `ResizeObserver` again. During the modal's iris-open animation (280ms), the container size changes rapidly across multiple frames.

The current code handles this correctly for post-animation rendering, but during the animation itself, the rapid size changes can create a feedback loop.

**Consequences:**
- Console spam during modal open
- Potential chart flickering during the 280ms animation
- In extreme cases, browsers may suspend the ResizeObserver to break the loop

**Prevention:**
1. **Debounce the ResizeObserver callback** with a `requestAnimationFrame` guard:
   ```typescript
   let rafId: number | null = null;
   const resizeObserver = new ResizeObserver(() => {
     if (rafId) return;
     rafId = requestAnimationFrame(() => {
       rafId = null;
       const newWidth = containerRef.current?.clientWidth;
       if (newWidth && newWidth > 0) {
         chart.applyOptions({ width: newWidth });
       }
     });
   });
   ```
2. **Delay ResizeObserver activation until after modal animation completes** (280ms). Use a timeout or listen for the `animationend` event on the dialog before attaching the observer.
3. **The current code already checks `newWidth > 0`** which prevents zero-width issues during animation. Preserve this guard.

**Warning signs:** Console warning "ResizeObserver loop completed with undelivered notifications". Chart flickers during modal open animation.

**Confidence:** HIGH -- this is a well-known ResizeObserver + animation interaction pattern.

**Severity:** MODERATE

---

### MOD-06: Audio Controls Accessibility -- Screen Reader and Keyboard

**What goes wrong:** The audio system has visual mute/volume controls but they are inaccessible to screen reader users and keyboard-only users. The audio plays for sighted users but screen reader users get no indication that audio is playing, no way to control it, and no way to discover the audio controls.

**Why it happens:** Audio controls are often implemented as decorative icon buttons (`<button>` with an SVG icon) without:
- `aria-label` describing the action
- `aria-pressed` for toggle state (mute/unmute)
- `role` and keyboard handling for volume sliders
- Live region announcements when audio state changes

**Consequences:**
- WCAG 2.1 Level A failure (1.4.2 Audio Control: if audio plays for >3 seconds, mechanism to pause/mute must be available)
- Screen reader users hear background music with no way to stop it
- Keyboard users cannot reach the volume control
- Legal/compliance risk (WCAG is increasingly required)

**Prevention:**
1. **Audio toggle button requirements:**
   ```html
   <button
     aria-label="Mute background music"
     aria-pressed="false"
     onClick={toggleMute}
   >
     <SpeakerIcon aria-hidden="true" />
   </button>
   ```
2. **Volume slider requirements:**
   ```html
   <input
     type="range"
     role="slider"
     aria-label="Volume"
     aria-valuemin={0}
     aria-valuemax={100}
     aria-valuenow={volume}
     min={0}
     max={100}
     value={volume}
     onChange={handleVolumeChange}
   />
   ```
3. **Announce state changes via `aria-live` region:**
   ```html
   <div aria-live="polite" className="sr-only">
     {isMuted ? 'Music muted' : 'Music playing'}
   </div>
   ```
4. **If audio auto-starts after user gesture (splash screen), provide an immediately discoverable mute button** -- visible on the main factory scene, not hidden in a settings modal.
5. **Respect `prefers-reduced-motion` media query** for audio. Some users associate motion reduction with reduced sensory stimulation. Consider starting muted when this preference is detected.
6. **Persist audio preference** in localStorage so returning users don't have to re-mute.

**Warning signs:** No `aria-label` on audio buttons. No keyboard focus visible on audio controls. Screen reader does not announce audio state.

**Confidence:** HIGH -- WCAG requirements are well-established.

**Severity:** MODERATE

---

### MOD-07: iOS Safari Audio Requires Specific Initialization Sequence

**What goes wrong:** Audio works on all desktop browsers and Android, but fails silently on iOS Safari. Even after a user gesture, `AudioContext.resume()` resolves but no audio plays.

**Why it happens:** iOS Safari has additional requirements beyond the standard Web Audio autoplay policy:
1. The `AudioContext` must be created **during** the user gesture (not before)
2. A buffer source must be started **during** the same gesture callback (even if it is a silent buffer)
3. Once "unlocked," the AudioContext stays unlocked for subsequent playback
4. iOS 15+ improved this somewhat, but the safest pattern is still to unlock explicitly

**Prevention:**
1. **"Unlock" pattern for iOS Safari:**
   ```typescript
   function unlockAudioContext(ctx: AudioContext): Promise<void> {
     if (ctx.state === 'running') return Promise.resolve();

     // Create and play a silent buffer to "unlock" on iOS
     const buffer = ctx.createBuffer(1, 1, 22050);
     const source = ctx.createBufferSource();
     source.buffer = buffer;
     source.connect(ctx.destination);
     source.start(0);

     return ctx.resume();
   }

   // Call in the splash screen button click handler
   function handleSplashClick() {
     const ctx = new AudioContext();
     unlockAudioContext(ctx).then(() => {
       // AudioContext is now permanently unlocked
       audioContextRef.current = ctx;
     });
   }
   ```
2. **Test on an actual iOS device** (not the iOS Simulator, which may not enforce the same policies).
3. **Create the AudioContext ONLY when needed**, not at module load time. iOS may reclaim suspended AudioContexts.

**Warning signs:** `audioContext.state` is `running` but no audio plays on iOS. Audio works on desktop Safari but not iOS Safari.

**Confidence:** MEDIUM -- iOS Safari audio policies have improved over time. The silent buffer unlock pattern was necessary as of iOS 17. iOS 18+ behavior is UNKNOWN (beyond training data).

**Severity:** MODERATE

---

### MOD-08: Clip-Path Animation Conflict with border-image

**What goes wrong:** The existing modal iris-open animation uses `clip-path: circle()`. If the 9-slice steampunk frame is implemented using an approach that also requires `clip-path` (e.g., to round corners on a `border-image` element, see CRIT-05), the two clip-paths conflict. CSS only allows one `clip-path` per element.

**Why it happens:** CSS `clip-path` is not composable -- you cannot layer multiple clip-paths. If the iris animation applies `clip-path: circle(...)` to the dialog, and the frame uses `clip-path: inset(0 round 8px)` for rounded corners, only one can be active at a time.

**Consequences:**
- Iris animation breaks the frame corners
- Frame corners break the iris animation
- Attempting to use nested elements with separate clip-paths may cause unexpected visual artifacts

**Prevention:**
1. **Use the pseudo-element approach for 9-slice frames (not clip-path)** so the iris animation on the dialog itself is not affected.
2. **If `clip-path` is needed on the frame, apply it to the `.modal-chrome` child** (not the `<dialog>` element which has the iris animation). The iris animation is on the `<dialog>`, the chrome is inside it.
3. **During the iris-opening animation, the frame is clipped by the dialog's clip-path anyway** -- the frame only needs to look correct once the animation completes and clip-path is removed.
4. **Test the full open/close/switch animation sequence** after adding the 9-slice frame. The current animation system is carefully tuned (280ms open, 180ms close, content crossfade) -- any new visual layer must not break it.

**Warning signs:** Iris animation reveals a rectangle instead of a circle. Frame corners flicker during animation. Frame loses rounded corners after animation completes.

**Confidence:** HIGH -- CSS clip-path composability limitations are well-established.

**Severity:** MODERATE

---

## Minor Pitfalls

Mistakes that cause annoyance or minor visual issues but are easily fixable.

---

### MINOR-01: border-image-slice Values Are Unitless (Not Pixels)

**What goes wrong:** Developer writes `border-image-slice: 30px` and the frame renders incorrectly. The slice values should be `30` (unitless) for pixel values, or `30%` for percentage values.

**Why it happens:** Unlike most CSS properties, `border-image-slice` uses **unitless numbers** that represent pixels in the source image. `border-image-slice: 30` means "slice 30 pixels from each edge of the source image." Adding `px` is technically invalid (though some browsers may tolerate it).

**Prevention:**
1. Use unitless numbers: `border-image-slice: 30 fill;`
2. The `fill` keyword ensures the center region is rendered (without it, the center is transparent)
3. Match the slice values to the actual frame border width in the source image (measure in an image editor)

**Confidence:** HIGH -- CSS spec.

**Severity:** MINOR

---

### MINOR-02: Audio Volume Persisting Across Page Navigations

**What goes wrong:** User adjusts volume in the Settings modal. Navigates to a different part of the app (or the page refreshes due to Next.js routing). Volume resets to default.

**Why it happens:** Audio state (volume, muted, current track) is stored in React state which is lost on navigation/refresh.

**Prevention:**
1. **Persist audio preferences in `localStorage`:**
   ```typescript
   const AUDIO_PREFS_KEY = 'dr-fraudsworth-audio';
   type AudioPrefs = { volume: number; muted: boolean; musicEnabled: boolean; sfxEnabled: boolean };
   ```
2. **Read preferences on AudioContext initialization.** Apply before any audio plays.
3. **Write preferences on every change** (debounced to avoid excessive writes).
4. **Respect `prefers-reduced-motion`** as a default for new users (start muted).

**Confidence:** HIGH -- standard web app pattern.

**Severity:** MINOR

---

### MINOR-03: MDX Code Blocks Need Syntax Highlighting Without Breaking Turbopack

**What goes wrong:** You add a syntax highlighting plugin (`rehype-pretty-code`, `rehype-highlight`, or `rehype-prism-plus`) and it either breaks Turbopack (non-serializable options) or adds a massive CSS bundle for language themes.

**Why it happens:** Many syntax highlighting plugins require function callbacks (custom transformers, theme functions) that cannot be serialized for Turbopack. Others inline CSS for every language they support, bloating the bundle.

**Prevention:**
1. **Use `rehype-pretty-code` with string-based configuration** if Turbopack supports it. Check if it works with the string plugin format.
2. **Alternatively, use CSS-only syntax highlighting** with a custom `<code>` component in `mdx-components.tsx` that applies pre-defined theme classes. No plugin needed.
3. **Simplest approach: no syntax highlighting in v1.1.** The docs content is protocol documentation, not a code tutorial. Plain `<pre>` with the steampunk theme colors may be sufficient. Add highlighting later as a refinement.
4. **If highlighting is needed, consider a client-side solution** like Shiki (which runs in the browser via WASM) to avoid build-time plugin issues entirely. Note: this adds bundle size.

**Warning signs:** Dev server crash after adding syntax highlighting plugin. Large CSS bundle for unused language themes.

**Confidence:** MEDIUM -- specific plugin compatibility with Turbopack string format is unverified.

**Severity:** MINOR

---

### MINOR-04: Chart Theme Switching Does Not Update Immediately

**What goes wrong:** If a theme/mode toggle is added (or already exists for dark/light mode), the TradingView chart does not respond to CSS variable changes. It keeps its hardcoded hex colors from initialization.

**Why it happens:** The current `CandlestickChart.tsx` uses hardcoded hex colors (`#1c120a`, `#bca88a`, etc.) matching the factory theme. These are set at chart creation time and are NOT reactive to CSS variable changes. If you add a theme toggle, the chart stays in the original colors.

**Prevention:**
1. **For v1.1, this is a non-issue** since the app uses a single dark steampunk theme with no toggle. Keep hardcoded colors.
2. **If theme switching is added later**, the chart must be destroyed and recreated with new colors (there is no `applyOptions` for all color properties in lightweight-charts v5).
3. **Alternatively, read computed CSS variables at chart creation time:**
   ```typescript
   const styles = getComputedStyle(document.documentElement);
   const bgColor = styles.getPropertyValue('--color-factory-bg').trim();
   ```
   This still requires chart recreation on theme change, but keeps colors in sync with the CSS system.

**Warning signs:** Chart background/text colors don't match after a theme change. Chart colors are wrong in screenshots/previews with different themes.

**Confidence:** HIGH -- verified from current `CandlestickChart.tsx` code analysis.

**Severity:** MINOR

---

### MINOR-05: focus-visible Styles on Custom Audio Controls Within Dialog

**What goes wrong:** Custom audio controls (sliders, toggle buttons) inside the modal don't show the existing steampunk focus-visible glow (`box-shadow: 0 0 0 2px var(--color-factory-glow)`) because they use `<input type="range">` or custom elements that don't match the existing `dialog :focus-visible` selector.

**Why it happens:** The existing CSS at line 457 of `globals.css` applies focus styles to `dialog :focus-visible`, which covers most interactive elements. However:
- `<input type="range">` has browser-specific shadow DOM that may not respond to the parent selector
- Custom slider thumb/track styling may override or obscure the focus indicator
- Toggle switches implemented as `<label>` + hidden `<input>` may not receive visible focus

**Prevention:**
1. **Test keyboard navigation through every audio control** with Tab key. Each should show the brass glow.
2. **For `<input type="range">`, add explicit focus styles:**
   ```css
   dialog input[type="range"]:focus-visible {
     outline: none;
     box-shadow: 0 0 0 2px var(--color-factory-glow);
   }
   ```
3. **For toggle switches, ensure the focusable element (not just the visual decoration) receives the focus indicator.**
4. **Test with keyboard only (no mouse)** to verify the full audio settings flow is navigable.

**Warning signs:** Tab key skips over audio controls. Focus indicator appears on some controls but not others. Range slider has browser-default focus outline instead of steampunk glow.

**Confidence:** HIGH -- verified from existing `globals.css` focus styles.

**Severity:** MINOR

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| 9-slice CSS border frames | CRIT-05: border-image ignores border-radius | CRITICAL | Use pseudo-element approach, not `border-image`, for rounded components |
| 9-slice CSS border frames | HIGH-01: Sub-pixel seams on retina | HIGH | Design at 2x/3x with 1px overlap at slice boundaries |
| 9-slice CSS border frames | MOD-08: Clip-path conflict with iris animation | MODERATE | Apply frame to `.modal-chrome`, not `<dialog>` |
| TradingView charts overhaul | CRIT-04: SSR crash with canvas library | CRITICAL | Keep `'use client'` directive; use `next/dynamic` with `ssr: false` as safety net |
| TradingView charts overhaul | HIGH-04: Memory leak on mount/unmount | HIGH | Consider keeping chart mounted but hidden; test 50-cycle loop |
| TradingView charts overhaul | MOD-05: ResizeObserver loop during animation | MODERATE | Debounce observer; delay activation until after animation |
| Modal interface polishes | HIGH-05: Dialog + audio user gesture | HIGH | Call `resume()` synchronously in click handler |
| Modal interface polishes | MOD-08: Clip-path animation conflict | MODERATE | Keep frame on child element, iris on dialog |
| MDX documentation migration | CRIT-01: Plugin serialization with Turbopack | CRITICAL | Use string plugin names, not function imports |
| MDX documentation migration | CRIT-02: mdx-components.tsx location | CRITICAL | Place at project root, not inside app/ |
| MDX documentation migration | MOD-04: Wrong MDX library choice | MODERATE | Use `@next/mdx`, not `next-mdx-remote` |
| MDX documentation migration | HIGH-06: CSP blocks for docs assets | HIGH | Audit MDX content; self-host fonts and images |
| Audio system | CRIT-03: Autoplay policy blocks all sound | CRITICAL | Create AudioContext lazily on first user gesture (splash button) |
| Audio system | HIGH-03: Audio buffer memory leaks | HIGH | Implement LRU buffer pool; disconnect nodes on end |
| Audio system | MOD-01: Audio format compatibility | MODERATE | Ship MP3 as primary format for universal support |
| Audio system | MOD-07: iOS Safari initialization | MODERATE | Silent buffer unlock pattern on first gesture |
| Audio system | MOD-06: Accessibility of audio controls | MODERATE | aria-label, aria-pressed, keyboard navigation, live regions |

---

## Project-Specific Interaction Warnings

These pitfalls are unique to the Dr. Fraudsworth project due to its specific combination of technologies.

### PROJ-01: Privy Dialog Conflict with Audio Controls in Modal

The existing `usePrivyTopLayer.ts` hook toggles the modal between `showModal()` and `show()` when Privy's wallet confirmation appears. During this toggle:
- The dialog temporarily closes and reopens (synchronously)
- Any AudioContext operations in progress may be affected by the brief DOM disconnection
- Focus management is temporarily disrupted

**Mitigation:** Test audio controls specifically during a Privy wallet confirmation flow. If a user is listening to music and initiates a swap (triggering Privy confirmation), the music should not skip, stutter, or stop.

### PROJ-02: CSP Updates Needed for Audio Files

If audio files are served from a CDN or external source (rather than `/public/`), the CSP `media-src` directive needs updating. Currently, there is NO `media-src` directive in the CSP header, which means it falls back to `default-src 'self'`. This is correct for self-hosted audio files in `/public/`, but will silently block external audio sources.

**Mitigation:** Serve all audio files from `/public/audio/`. No CSP change needed. If a CDN is added later, update `default-src` or add explicit `media-src`.

### PROJ-03: Turbopack + @next/mdx Integration with Existing Config

The current `next.config.ts` uses TypeScript and the `turbopack` config key. Adding `@next/mdx` requires wrapping the config with `createMDX()`. Ensure:
1. The `createMDX` wrapper is compatible with the TypeScript config format
2. The existing `turbopack.resolveAlias` for Node.js module stubs (`fs`, `net`, `tls`) is preserved
3. The existing `transpilePackages: ["@dr-fraudsworth/shared"]` is preserved
4. The `pageExtensions` addition doesn't break existing `.tsx` page routes

**Mitigation:** Test the combined config incrementally. Add `@next/mdx` wrapper, verify existing pages still work, THEN add MDX content.

---

## Sources

| Finding | Source | Confidence |
|---------|--------|------------|
| Turbopack MDX plugin string format (CRIT-01) | Official Next.js 16.1.6 docs, fetched 2026-02-24 | HIGH |
| mdx-components.tsx requirement (CRIT-02) | Official Next.js 16.1.6 docs, fetched 2026-02-24 | HIGH |
| @next/mdx vs next-mdx-remote (MOD-04) | Official Next.js 16.1.6 docs, fetched 2026-02-24 | HIGH |
| Turbopack feature support matrix | Official Turbopack docs, fetched 2026-02-24 | HIGH |
| Web Audio autoplay policies (CRIT-03) | Training data (MDN Web Audio API docs) | HIGH |
| iOS Safari audio initialization (MOD-07) | Training data | MEDIUM |
| CSS border-image + border-radius (CRIT-05) | Training data (CSS spec knowledge) | HIGH |
| border-image sub-pixel rendering (HIGH-01) | Training data | MEDIUM |
| Safari SVG border-image (HIGH-07) | Training data | LOW-MEDIUM |
| lightweight-charts SSR (CRIT-04) | Codebase analysis + training data | HIGH |
| lightweight-charts memory (HIGH-04) | Training data + codebase analysis | MEDIUM |
| ResizeObserver loop (MOD-05) | Training data + codebase analysis | HIGH |
| CSP header conflicts (HIGH-06) | Verified from `next.config.ts` in codebase | HIGH |
| Dialog + audio user gesture (HIGH-05) | Training data | MEDIUM |
| Existing modal/animation system details | Codebase analysis (ModalShell.tsx, globals.css, ModalProvider.tsx) | HIGH |
| Privy top-layer interaction (PROJ-01) | Codebase analysis (usePrivyTopLayer.ts) | HIGH |

---

## Items Needing Validation Before Implementation

These findings should be verified against current browser behavior before committing to an approach:

1. **Safari border-image with SVG** (HIGH-07): Test on Safari 18+ (current). The issues may have been resolved.
2. **iOS Safari audio unlock pattern** (MOD-07): Test on iOS 18+ (current). The silent buffer requirement may have been relaxed.
3. **OGG/Opus support in Safari** (MOD-01): Check current Safari codec support -- it may now support OGG Vorbis or WebM/Opus.
4. **rehype-pretty-code Turbopack compatibility** (MINOR-03): Test whether `'rehype-pretty-code'` works as a string plugin name with Turbopack.
5. **@next/mdx with TypeScript config**: Verify that `createMDX()` works with `next.config.ts` (not just `.mjs`). The official docs show `.mjs` examples.
