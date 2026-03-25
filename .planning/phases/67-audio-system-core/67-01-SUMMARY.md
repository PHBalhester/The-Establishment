---
phase: 67-audio-system-core
plan: 01
subsystem: audio
tags: [web-audio-api, audiocontext, gainnode, crossfade, htmlaudioelement, mediaelementsource]

# Dependency graph
requires:
  - phase: 65-settings-station-audio-controls-ui
    provides: SettingsProvider with muted/volume persistence (localStorage)
provides:
  - AudioManager singleton class (audioManager instance)
  - 3 MP3 music files in public/music/
  - init/play/pause/setVolume/setMuted/destroy public API
  - Dual-slot crossfade with 2.5s linear gain ramps
  - iOS Safari silent buffer unlock
  - Tab visibility suspend/resume
affects:
  - 67-02 (AudioProvider wraps AudioManager in React context)
  - 68-audio-integration (wires AudioProvider to SplashScreen + UI controls)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AudioManager singleton with gesture-gated AudioContext creation"
    - "HTMLAudioElement + MediaElementAudioSourceNode (not AudioBufferSourceNode) for near-zero memory"
    - "Dual-slot crossfade: two permanent Audio+Source+Gain slots, reuse via .src changes"
    - "Web Audio API gain scheduling: setValueAtTime + linearRampToValueAtTime (never direct gain.value)"
    - "Pre-crossfade trigger via timeupdate event (start overlap before track ends)"

key-files:
  created:
    - app/lib/audio-manager.ts
    - app/public/music/music-1.mp3
    - app/public/music/music-2.mp3
    - app/public/music/music-3.mp3
  modified: []

key-decisions:
  - "HTMLAudioElement streaming over AudioBufferSourceNode to avoid 118MB decoded PCM"
  - "Linear crossfade (linearRampToValueAtTime) over equal-power — subtle dip acceptable for background music"
  - "50ms ramp for all volume/mute changes to prevent clicks"
  - "Pre-crossfade via timeupdate (not just ended event) for seamless track overlap"
  - "No crossOrigin on Audio elements — same-origin files, avoids CORS preflight"

patterns-established:
  - "Singleton pattern: new AudioManager() at module scope, AudioContext only in init()"
  - "Slot reuse: change .src, never create new Audio elements or MediaElementSourceNodes"
  - "Gain scheduling: cancel → setValueAtTime → linearRamp triple for all transitions"

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 67 Plan 01: Audio System Core Summary

**AudioManager singleton with dual-slot crossfade, gesture-gated AudioContext, iOS Safari unlock, and 3 MP3 music tracks**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T19:02:13Z
- **Completed:** 2026-03-02T19:05:23Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- 3 MP3 music files (7.2MB total) delivered to app/public/music/ with URL-safe kebab-case names
- AudioManager singleton class with full playback engine: init, play, pause, setVolume, setMuted, destroy
- Dual-slot crossfade architecture using HTMLAudioElement + MediaElementAudioSourceNode (near-zero JS memory)
- Fisher-Yates shuffle with no-repeat-last constraint for continuous playlist
- iOS Safari silent buffer + Audio element dual-play unlock
- Tab visibility handler: suspend AudioContext when hidden, resume when visible
- Pre-crossfade trigger via timeupdate event for seamless track overlap before end

## Task Commits

Each task was committed atomically:

1. **Task 1: Copy music files to public/music/** - `bca50e4` (chore)
2. **Task 2: Build AudioManager singleton class** - `313ebbd` (feat)

## Files Created/Modified
- `app/public/music/music-1.mp3` - Music track 1 (2.5MB)
- `app/public/music/music-2.mp3` - Music track 2 (2.3MB)
- `app/public/music/music-3.mp3` - Music track 3 (2.3MB)
- `app/lib/audio-manager.ts` - AudioManager singleton class (306 lines)

## Decisions Made
- **HTMLAudioElement over AudioBufferSourceNode**: decodeAudioData would expand ~6.8MB MP3 into ~118MB raw PCM. HTMLAudioElement streaming keeps JS memory near zero.
- **Linear crossfade over equal-power**: linearRampToValueAtTime is simpler and browser-native. The midpoint volume dip is subtle for 2.5s crossfades on low-volume background music.
- **50ms ramp for volume/mute changes**: Prevents audible clicks from instantaneous gain changes. Short enough to feel immediate to users.
- **Pre-crossfade via timeupdate**: The HTMLAudioElement `ended` event fires after playback stops, causing a gap. The `timeupdate` listener triggers crossfade when `remaining <= crossfadeDuration`, creating seamless overlap.
- **No crossOrigin attribute**: Same-origin files in /public/ don't need CORS. Setting crossOrigin can trigger unnecessary preflight requests.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- AudioManager class ready for wrapping by AudioProvider (67-02)
- Exports: `AudioManager` class and `audioManager` singleton instance
- Public API: init(), play(), pause(), setVolume(0-1), setMuted(bool), destroy()
- SettingsProvider volume is 0-100; AudioProvider (67-02) will divide by 100 before passing to setVolume()
- SplashScreen click handler is the gesture gate for audioManager.init()

---
*Phase: 67-audio-system-core*
*Completed: 2026-03-02*
