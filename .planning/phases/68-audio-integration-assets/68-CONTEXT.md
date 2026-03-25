# Phase 68: Audio Integration + Assets - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the audio system (from Phase 67) into the UI: connect Settings controls to AudioProvider, add floating quick-mute icon, copy and serve MP3 assets, and verify end-to-end playback.

**Scope significantly reduced from original roadmap:** No SFX triggers, no music ducking, no per-interaction sound wiring. This phase is now primarily about UI integration and asset delivery.

</domain>

<decisions>
## Implementation Decisions

### Quick mute button
- Floating speaker icon in the top-left corner of the viewport
- Always visible (overlays the page, not tied to any modal)
- Toggles mute/unmute — simple click behavior
- Visual state reflects current mute status (speaker vs speaker-muted icon)

### Settings wiring
- Settings station "Toggle Music" switch → AudioProvider mute/unmute
- Settings station volume slider → AudioProvider setVolume
- Controls already built in Phase 65 — this phase wires the onChange handlers

### Asset delivery
- Copy 3 MP3 files from `WebsiteAssets/WebsiteMusic/` to `public/audio/` (or similar)
- Rename to URL-safe filenames (no spaces: "Music 2.mp3" → "music-2.mp3")
- Served as static files from Next.js public directory

### Testing
- Verify autoplay works after first click
- Verify crossfade between tracks
- Verify shuffle doesn't repeat
- Verify volume slider adjusts live
- Verify mute toggle from both Settings and quick-mute icon
- Verify prefers-reduced-motion starts muted
- Verify Privy wallet flow doesn't break with audio active

### Claude's Discretion
- Quick mute icon design (use existing speaker SVG or minimal custom)
- Exact z-index for floating mute button (must not conflict with modals/Privy)
- Whether to show a brief tooltip on first visit explaining the mute button

</decisions>

<specifics>
## Specific Ideas

- Quick mute icon: top-left floating, always accessible without opening Settings
- System must support adding more tracks later — just drop MP3s and update the track list array
- No SFX — the original scope of wiring click/swap/modal sounds is entirely removed

</specifics>

<deferred>
## Deferred Ideas

- SFX triggers on button clicks, modal open/close, swap confirm, carnage events — future version
- Music ducking during important events — not needed without SFX
- Audio file creation/sourcing for SFX — future version
- Privy dialog conflict testing with SFX — not applicable without SFX

</deferred>

---

*Phase: 68-audio-integration-assets*
*Context gathered: 2026-03-02*
