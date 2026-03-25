# Phase 68: Audio Integration + Assets - Research

**Researched:** 2026-03-02
**Domain:** React UI wiring, floating UI component, audio asset delivery, accessibility
**Confidence:** HIGH

## Summary

This phase completes the audio integration by wiring the Settings station controls to AudioProvider, adding a floating quick-mute button, delivering audio assets, and verifying end-to-end playback. The scope has been significantly reduced from the original roadmap -- no SFX triggers, no music ducking, no per-interaction sound wiring.

**Critical finding: Settings wiring is ALREADY COMPLETE.** The Phase 67 implementation created the full Settings -> AudioProvider -> AudioManager pipeline. SettingsStation already calls `setMuted()` and `setVolume()` on SettingsProvider (Phase 65), and AudioProvider already has a `useEffect` that syncs `settings.muted` and `settings.volume` to `audioManager.setMuted()` and `audioManager.setVolume()` (Phase 67). The comment in SettingsStation line 18 ("UI shell only -- no AudioContext wiring") is stale -- Phase 67 completed that wiring. **No new Settings wiring code is needed.**

**Critical finding: Audio asset delivery is ALREADY COMPLETE.** The three MP3 files from `WebsiteAssets/WebsiteMusic/` are already copied to `app/public/music/` with URL-safe names (verified via MD5 checksums -- all three match). AudioManager's `TRACKS` array already references these files at `/music/music-1.mp3`, `/music/music-2.mp3`, `/music/music-3.mp3`. **No new asset delivery work is needed.**

The remaining actual work is: (1) Build the floating quick-mute button component, (2) Add it to the provider tree, (3) Update the stale comment in SettingsStation, (4) Manual end-to-end testing/verification.

**Primary recommendation:** Build a simple `QuickMuteButton` component as an inline SVG button, placed in `providers.tsx` as a sibling of `SplashScreen`, using the project's existing z-index layering system with `--z-index-overlays: 10` and the established inline SVG icon pattern.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React (existing) | 19 | Component, hooks, context | Already in project |
| useSettings hook (existing) | N/A | Read/write muted state | Already provides setMuted(), settings.muted |
| useAudio hook (existing) | N/A | Check isInitialized state | Already provides isInitialized to gate visibility |
| CSS custom properties (existing) | N/A | z-index layering, color tokens | Project's established theming system |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Inline SVG (existing pattern) | N/A | Speaker/mute icons | Project already uses inline SVGs for all icons -- no icon library |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline SVG icons | lucide-react / heroicons | Would add npm dependency. Project already uses inline SVGs everywhere (MobileNav, ModalShell, SwapForm, etc.). Stay consistent. |
| CSS custom properties for z-index | Tailwind z-* utilities | Project defines layering via `--z-index-*` CSS variables in globals.css. Use the system. |

**Installation:**
```bash
# No new packages needed -- all existing dependencies
```

## Architecture Patterns

### Where QuickMuteButton Lives

```
app/
  components/
    audio/
      QuickMuteButton.tsx    # NEW: Floating mute/unmute toggle
  providers/
    providers.tsx            # Add QuickMuteButton as sibling of SplashScreen
  providers/
    AudioProvider.tsx         # NO CHANGES -- wiring already complete
  components/
    station/
      SettingsStation.tsx     # COMMENT UPDATE ONLY -- stale Phase 65 comment
  lib/
    audio-manager.ts          # NO CHANGES
  public/
    music/                    # ALREADY POPULATED (Phase 67)
      music-1.mp3
      music-2.mp3
      music-3.mp3
```

### Pattern 1: QuickMuteButton as Floating Fixed-Position Element

**What:** A `position: fixed` button in the top-left corner of the viewport that toggles mute/unmute. Uses `useSettings()` (NOT `useAudio()`) to toggle the `muted` setting, which then flows through the existing SettingsProvider -> AudioProvider -> AudioManager pipeline.

**When to use:** Always -- the button is always visible after the splash screen dismisses.

**Why useSettings, not useAudio:** The mute state is owned by SettingsProvider. AudioProvider reads from SettingsProvider. The quick-mute button does the same thing as the Settings station toggle -- it calls `setMuted()` on SettingsProvider. This keeps a single source of truth.

**Why NOT `useAudio().play/pause`:** The AudioProvider's play/pause methods don't update SettingsProvider, so the Settings toggle wouldn't reflect the change. Always go through SettingsProvider for muted state changes.

```typescript
// Simplified pattern -- NOT production code
'use client';

import { useSettings } from '@/hooks/useSettings';
import { useAudio } from '@/hooks/useAudio';

export function QuickMuteButton() {
  const { settings, setMuted } = useSettings();
  const { isInitialized } = useAudio();

  // Don't show until audio is initialized (post-splash)
  if (!isInitialized) return null;

  return (
    <button
      type="button"
      aria-label="Mute"
      aria-pressed={settings.muted}
      onClick={() => setMuted(!settings.muted)}
      className="quick-mute-btn"
    >
      {/* SVG icon: speaker or speaker-muted */}
      <svg aria-hidden="true" ...>
        {settings.muted ? <MutedIcon /> : <SpeakerIcon />}
      </svg>
    </button>
  );
}
```

### Pattern 2: Provider Tree Placement

**What:** QuickMuteButton placed inside `<ToastProvider>` (inside AudioProvider and SettingsProvider) so it can access both hooks. Placed as a sibling of `<SplashScreen />`.

**Why this position:** Needs `useSettings()` (from SettingsProvider above) and `useAudio()` (from AudioProvider above). The current tree is:

```
SettingsProvider
  AudioProvider
    ModalProvider
      ToastProvider
        {children}
        <ModalRoot />
        <SplashScreen />       // existing
        <QuickMuteButton />    // NEW -- add here
        <ToastContainer />
        <WalletConnectionToast />
```

### Pattern 3: Conditional Rendering via isInitialized

**What:** The button renders `null` until `isInitialized` is true (audio system activated via splash screen click). This prevents showing a mute button before audio is even possible.

**When to use:** Always. Showing a mute button before audio exists is confusing.

### Pattern 4: Speaker Icon SVG (Inline)

**What:** Two inline SVG paths -- one for speaker-on (sound waves), one for speaker-muted (X over speaker). Follow the existing project pattern of 24x24 viewBox inline SVGs.

**Source:** The project uses 24x24 inline SVGs in MobileNav.tsx, ModalShell.tsx, SwapForm.tsx. Follow this convention.

### Anti-Patterns to Avoid
- **Duplicating mute state in QuickMuteButton:** The button must read from and write to SettingsProvider. Do NOT create local state for muted.
- **Using useAudio().play/pause for muting:** This would desync the Settings toggle from the quick-mute button. Always use `useSettings().setMuted()`.
- **Placing the button outside the provider tree:** It needs access to both useSettings and useAudio contexts.
- **Creating a separate AudioContext for the mute button:** There is no audio work here -- just toggling a boolean in SettingsProvider.
- **Using Tailwind z-* classes:** The project has a CSS custom property z-index system. Use `var(--z-index-overlays)` or a dedicated CSS class.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Settings -> AudioManager sync | New event system or duplicate useEffect | Existing AudioProvider useEffect (lines 100-115) | Already built in Phase 67, already working |
| Audio preference persistence | New localStorage logic | Existing SettingsProvider | Already built in Phase 65, validated |
| Mute state propagation | Direct audioManager.setMuted() calls from button | useSettings().setMuted() which triggers existing pipeline | Single source of truth in SettingsProvider |
| Icon library | npm install lucide-react | Inline SVG elements | Project convention, zero dependencies |
| Z-index management | Ad-hoc z-index values | CSS custom property --z-index-overlays (10) | Project's established layering system |

**Key insight:** The bulk of Phase 68's originally planned work (Settings wiring + asset delivery) was already completed across Phases 65 and 67. The only new work is the floating quick-mute button UI component plus verification.

## Common Pitfalls

### Pitfall 1: Desynced Mute State Between Settings Toggle and Quick-Mute Button
**What goes wrong:** Quick-mute button shows "unmuted" while Settings toggle shows "muted" (or vice versa).
**Why it happens:** If the quick-mute button manages its own state instead of reading from SettingsProvider, or if it calls audioManager.setMuted() directly instead of going through SettingsProvider.
**How to avoid:** Both the Settings toggle and QuickMuteButton must read from `useSettings().settings.muted` and write via `useSettings().setMuted()`. No local state for mute.
**Warning signs:** Toggle one control, check the other -- they should always agree.

### Pitfall 2: Quick-Mute Button Hidden Behind Modal Dialog
**What goes wrong:** When a modal (station) is open, the quick-mute button disappears behind the dialog's backdrop or becomes inert.
**Why it happens:** The native `<dialog>.showModal()` makes ALL elements outside its subtree inert (not just visually -- actually unclickable and unfocusable). The quick-mute button lives outside the dialog.
**How to avoid:** This is an acceptable trade-off. When a modal is open, users can control audio via the Settings station. The quick-mute button is for when NO modal is open. Do NOT try to work around the inert behavior -- it's a feature (focus trapping for accessibility). Alternatively, the button could hide itself when a modal is open for clean UX.
**Warning signs:** Button is visible but unresponsive when modal is open.

### Pitfall 3: Quick-Mute Button Overlapping Mobile Navigation
**What goes wrong:** On mobile, the floating button covers part of the bottom navigation bar or other fixed UI elements.
**Why it happens:** Fixed positioning without considering other fixed elements.
**How to avoid:** Place in top-left corner as specified. The MobileNav is at the bottom. The toast is top-center. The modal close button is within the dialog. Top-left is safe on both mobile and desktop.
**Warning signs:** Visual overlap with other UI elements on small screens.

### Pitfall 4: Quick-Mute Button Visible During Splash Screen
**What goes wrong:** The mute button appears while the splash overlay is still showing, before the user has clicked "Enter".
**Why it happens:** Component renders before checking `isInitialized`.
**How to avoid:** Gate rendering on `useAudio().isInitialized`. Return `null` when false. The splash screen has z-index 9999 so even if the button renders, it would be hidden -- but returning null is cleaner.
**Warning signs:** Button briefly flashes during page load.

### Pitfall 5: Stale Comment Leading Future Developers Astray
**What goes wrong:** SettingsStation.tsx line 18 says "UI shell only -- no AudioContext wiring (that's Phase 67)" but Phase 67 is complete and the wiring is active.
**Why it happens:** Phase 65 wrote the comment anticipating Phase 67. Phase 67 completed the wiring but didn't update the comment.
**How to avoid:** Update the comment to reflect reality: the audio controls are fully wired through SettingsProvider -> AudioProvider -> AudioManager.
**Warning signs:** Developer reads comment and tries to add wiring that already exists.

### Pitfall 6: Z-Index Conflicts with Privy Wallet Dialogs
**What goes wrong:** The floating mute button interferes with Privy's wallet confirmation overlay (z-index 999999).
**Why it happens:** If the mute button uses an excessively high z-index.
**How to avoid:** Use `var(--z-index-overlays)` which is 10. This is well below the modal (50), spinner (60), splash (9999), and Privy (999999). The button should be visible on the main page but naturally layer below all overlay UI. Per MEMORY.md, Privy's HeadlessUI z-index is 999999 -- no conflict at z-index 10.
**Warning signs:** Mute button blocking Privy wallet confirmation.

## Code Examples

### QuickMuteButton Component Structure
```typescript
// Source: Project conventions (MobileNav.tsx inline SVGs, SettingsStation.tsx useSettings pattern)
'use client';

import { useSettings } from '@/hooks/useSettings';
import { useAudio } from '@/hooks/useAudio';

export function QuickMuteButton() {
  const { settings, setMuted } = useSettings();
  const { isInitialized } = useAudio();

  // Don't render until audio system is initialized (post-splash-screen)
  if (!isInitialized) return null;

  const isMuted = settings.muted;

  return (
    <button
      type="button"
      aria-label="Mute"
      aria-pressed={isMuted}
      onClick={() => setMuted(!isMuted)}
      className="quick-mute-btn"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Speaker body (always visible) */}
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        {isMuted ? (
          /* X lines for muted state */
          <>
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </>
        ) : (
          /* Sound waves for unmuted state */
          <>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </>
        )}
      </svg>
    </button>
  );
}
```

### CSS for Floating Position
```css
/* Source: Project z-index system (globals.css lines 146-152) */
.quick-mute-btn {
  position: fixed;
  top: 1rem;
  left: 1rem;
  z-index: var(--z-index-overlays); /* 10 -- above page content, below modals */

  /* Brass theme consistent with kit components */
  background: linear-gradient(180deg, #c4a24e 0%, #8b6914 100%);
  border: 1px solid rgba(0, 0, 0, 0.3);
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #1a1207; /* dark text on brass */

  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.3),
    0 2px 4px rgba(0, 0, 0, 0.4);

  transition: opacity 0.2s ease;
}

/* Dimmed appearance when muted */
.quick-mute-btn[aria-pressed="true"] {
  opacity: 0.6;
}

.quick-mute-btn:hover {
  opacity: 1;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.3),
    0 2px 8px rgba(196, 162, 78, 0.4);
}
```

### Provider Tree Integration
```typescript
// Source: providers.tsx current structure
<ToastProvider>
  {children}
  <ModalRoot />
  <SplashScreen />
  <QuickMuteButton />    {/* NEW -- after SplashScreen */}
  <ToastContainer />
  <WalletConnectionToast />
</ToastProvider>
```

### Accessibility Pattern (WAI-ARIA APG)
```typescript
// Source: https://www.w3.org/WAI/ARIA/apg/patterns/button/
//
// For a toggle button:
// - aria-label stays FIXED as "Mute" (does NOT change to "Unmute")
// - aria-pressed toggles between true/false
// - Screen reader announces: "Mute, toggle button, pressed" or "Mute, toggle button, not pressed"
//
// This is the WAI-ARIA recommended pattern. Do NOT change aria-label based on state.
<button
  type="button"
  aria-label="Mute"
  aria-pressed={isMuted}
  onClick={() => setMuted(!isMuted)}
>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Icon libraries (heroicons, lucide) | Inline SVG | Project convention | Zero npm dependencies for icons, consistent with existing code |
| Separate audio state management | SettingsProvider -> AudioProvider pipeline | Phase 65+67 | Settings changes automatically propagate to AudioManager |
| `aria-label="Mute"` changing to `aria-label="Unmute"` | Fixed `aria-label="Mute"` + `aria-pressed` toggle | WAI-ARIA APG recommendation | Correct accessibility pattern for toggle buttons |

**Deprecated/outdated:**
- The SettingsStation comment "UI shell only -- no AudioContext wiring (that's Phase 67)" is stale. Phase 67 completed the wiring. Must be updated.

## Already Completed (Verification)

These items from the Phase 68 scope were already delivered by previous phases:

| Item | Completed In | Evidence |
|------|-------------|----------|
| Settings Toggle Music -> AudioProvider mute | Phase 65 (UI) + Phase 67 (wiring) | SettingsStation.tsx L170 calls `setMuted()`, AudioProvider.tsx L103 syncs to audioManager |
| Settings Volume Slider -> AudioProvider volume | Phase 65 (UI) + Phase 67 (wiring) | SettingsStation.tsx L176 calls `setVolume()`, AudioProvider.tsx L104 syncs to audioManager |
| MP3 files copied to public/ | Phase 67 | `app/public/music/music-{1,2,3}.mp3` exist, MD5 checksums match WebsiteAssets originals |
| URL-safe filenames | Phase 67 | "Music1.mp3" -> "music-1.mp3", "Music 2.mp3" -> "music-2.mp3", "Music3.mp3" -> "music-3.mp3" |
| AudioManager references correct paths | Phase 67 | audio-manager.ts L36: `TRACKS = ['/music/music-1.mp3', ...]` |

## Open Questions

1. **Tooltip on first visit**
   - What we know: CONTEXT.md lists "tooltip on first visit" as Claude's discretion.
   - What's unclear: Whether a tooltip adds meaningful value vs. visual noise. The speaker icon is universally recognized.
   - Recommendation: Skip the tooltip. The speaker icon is self-explanatory. A tooltip would require additional state management (localStorage "has seen tooltip" flag) and animation code for minimal benefit. If users want to adjust audio, they'll click the obvious speaker icon or visit Settings.

2. **Button visibility when modal is open**
   - What we know: Native `<dialog>.showModal()` makes all elements outside the dialog subtree inert (unfocusable, unclickable). The quick-mute button is outside the dialog.
   - What's unclear: Whether to hide the button entirely when a modal is open, or let it remain visible-but-inert.
   - Recommendation: Let it remain visible-but-inert (the browser handles this). Audio controls are accessible inside the Settings station when a modal is open. No extra hiding logic needed.

3. **public/audio/ vs public/music/ directory**
   - What we know: CONTEXT.md says "Copy 3 MP3 files ... to `public/audio/` (or similar)". Files are already at `public/music/`.
   - What's unclear: Whether to move them to `public/audio/` or leave at `public/music/`.
   - Recommendation: Leave at `public/music/`. Moving them would require updating AudioManager's TRACKS array and risk breaking working code. The "(or similar)" qualifier in CONTEXT.md supports this. Both directories are semantically correct.

## Sources

### Primary (HIGH confidence)
- **Project codebase** (direct file reads):
  - `app/lib/audio-manager.ts` -- Confirmed TRACKS array, init/setMuted/setVolume API
  - `app/providers/AudioProvider.tsx` -- Confirmed useEffect syncing settings.muted/volume to audioManager
  - `app/providers/SettingsProvider.tsx` -- Confirmed setMuted/setVolume API, localStorage persistence
  - `app/components/station/SettingsStation.tsx` -- Confirmed Toggle/Slider wired to setMuted/setVolume
  - `app/providers/providers.tsx` -- Confirmed provider tree order, component siblings
  - `app/app/globals.css` -- Confirmed z-index layering system (lines 146-152)
  - `app/public/music/` -- Confirmed MP3 files exist (MD5 verified against WebsiteAssets)
  - `app/components/mobile/MobileNav.tsx` -- Confirmed inline SVG icon convention (24x24 viewBox)
- [W3C WAI-ARIA APG Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) -- Toggle button aria-pressed pattern
- [MDN ARIA button role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/button_role) -- aria-pressed semantics

### Secondary (MEDIUM confidence)
- [Sara Soueidan - Accessible Icon Buttons](https://www.sarasoueidan.com/blog/accessible-icon-buttons/) -- Icon button accessibility pattern
- [MDN Web Audio API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) -- Autoplay policy, user gesture requirements

### Tertiary (LOW confidence)
- None -- all findings verified against codebase and official specs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All existing project dependencies, no new libraries
- Architecture: HIGH -- Direct codebase analysis, existing patterns documented
- Pitfalls: HIGH -- Based on verified codebase structure (z-index system, dialog inertness, provider tree)
- Already-completed items: HIGH -- Verified via file reads and MD5 checksums
- Accessibility: HIGH -- W3C WAI-ARIA APG official specification

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- no external dependency changes)
