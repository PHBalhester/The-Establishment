# Phase 67: Audio System Core - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the audio infrastructure for background music playback: AudioManager singleton, AudioProvider context, AudioContext lazy creation, crossfade between tracks, and localStorage persistence. This phase builds the engine — Phase 68 wires it to the UI and delivers assets.

**Scope reduced from original roadmap:** No SFX system. Music only. The AudioManager, buffer cache, and GainNode routing are simpler without SFX triggers.

</domain>

<decisions>
## Implementation Decisions

### Playback behavior
- 3 MP3 tracks (~2.2-2.4MB each, ~6.8MB total) play in shuffled order
- Never repeat the same track twice in a row
- Crossfade between tracks (smooth blend, ~2-3 seconds)
- Continuous loop — after all 3 play, reshuffle and continue

### Autoplay & initialization
- Music auto-starts at audible volume on first user interaction (gesture-gated AudioContext)
- Default volume: low (~25%)
- `prefers-reduced-motion` users start muted (already decided in Phase 65)
- iOS Safari silent buffer unlock required

### Persistence
- Volume level persisted in localStorage (SettingsProvider already handles this)
- Mute state persisted in localStorage (already handled)
- Track position NOT persisted — fresh shuffle on each visit

### Architecture
- AudioManager singleton class: AudioContext, GainNode routing, buffer cache
- AudioProvider React context: wraps AudioManager, exposes play/pause/toggle/setVolume
- Provider positioned in component tree (already decided in Phase 65: Connection > Wallet > Settings > Modal > Toast)
- LRU buffer pool < 10MB (3 tracks at ~2.4MB each = ~7.2MB decoded, fits comfortably)
- BufferSourceNode disconnect on `ended` event to prevent memory leaks

### Claude's Discretion
- Crossfade implementation details (dual-source overlap vs GainNode envelope)
- Exact AudioContext resume/suspend strategy for tab backgrounding
- Buffer preloading strategy (all 3 upfront vs lazy load next track)

</decisions>

<specifics>
## Specific Ideas

- Music files located at `WebsiteAssets/WebsiteMusic/` (Music1.mp3, Music 2.mp3, Music3.mp3) — need to copy to public/ with URL-safe names
- System should be extensible — easy to add more tracks later (array-driven, not hardcoded per-track)
- No SFX at all in v1.1 — the entire SFX trigger system from original Phase 68 scope is deferred

</specifics>

<deferred>
## Deferred Ideas

- SFX system (button clicks, modal sounds, swap confirmations, carnage events) — future version
- Music ducking during SFX — not needed without SFX
- Station-specific music tracks — future version
- Phase 66 Documentation Migration — deferred to later milestone

</deferred>

---

*Phase: 67-audio-system-core*
*Context gathered: 2026-03-02*
