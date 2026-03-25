---
phase: 67-audio-system-core
plan: 02
subsystem: audio
tags: [react-context, provider, useaudio, gesture-gate, splashscreen, settings-sync]

# Dependency graph
requires:
  - phase: 67-audio-system-core plan 01
    provides: AudioManager singleton with init/play/pause/setVolume/setMuted/destroy API
  - phase: 65-settings-station-audio-controls-ui
    provides: SettingsProvider with muted/volume persistence, useSettings hook
provides:
  - AudioProvider React context wrapping AudioManager with SettingsProvider sync
  - useAudio hook for any component to access audio state and controls
  - Gesture-gated AudioContext initialization via SplashScreen button click
  - Provider tree with Audio between Settings and Modal
affects:
  - Any future component needing audio control (useAudio hook available)
  - Phase 68 if audio integration phase exists (already wired)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AudioProvider reads SettingsProvider, pushes to AudioManager (one-way data flow)"
    - "Gesture gate: initAudio() called synchronously at top of click handler"
    - "useAudio hook follows useSettings pattern (context + throw if null)"
    - "Volume 0-100 from Settings divided by 100 for AudioManager 0.0-1.0 range"
    - "isPlaying excluded from settings sync useEffect deps to avoid infinite loop"

key-files:
  created:
    - app/providers/AudioProvider.tsx
    - app/hooks/useAudio.ts
  modified:
    - app/providers/providers.tsx
    - app/components/onboarding/SplashScreen.tsx

key-decisions:
  - "AudioCtx name (not AudioContext) to avoid shadowing Web Audio API global"
  - "isPlaying excluded from settings sync useEffect deps to prevent infinite re-fire loop"
  - "initAudio() must be FIRST line in click handler — browser gesture activation window is narrow"
  - "No duplicate localStorage persistence — AudioProvider reads SettingsProvider only"

patterns-established:
  - "Audio context pattern: AudioProvider wraps engine singleton, hooks provide React API"
  - "Settings sync pattern: useEffect watches settings, pushes to engine (no bidirectional sync)"
  - "Provider ordering: Connection > Wallet > Settings > Audio > Modal > Toast"

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 67 Plan 02: AudioProvider React Context Summary

**AudioProvider context bridging AudioManager to React with SettingsProvider sync, useAudio hook, and SplashScreen gesture-gated initialization**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T19:11:20Z
- **Completed:** 2026-03-02T19:14:28Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 2

## Accomplishments
- AudioProvider React context that reads muted/volume from SettingsProvider and syncs to AudioManager in real-time
- useAudio hook following the exact useSettings pattern (context + throw if null) for any component to control audio
- Provider tree correctly ordered: Connection > Wallet > Settings > Audio > Modal > Toast
- SplashScreen gesture gate: initAudio() called synchronously at top of handleEnter before any async work
- Music auto-starts after splash screen click if user is not muted
- Volume slider and mute toggle in SettingsStation immediately affect playing music via settings sync useEffect
- Cleanup on unmount via audioManager.destroy() for hot reload safety

## Task Commits

Each task was committed atomically:

1. **Task 1: Create AudioProvider and useAudio hook** - `334cd0a` (feat)
2. **Task 2: Wire providers.tsx and SplashScreen gesture gate** - `b865681` (feat)

## Files Created/Modified
- `app/providers/AudioProvider.tsx` - React context provider bridging AudioManager with SettingsProvider (140 lines)
- `app/hooks/useAudio.ts` - Convenience hook for audio context consumption (30 lines)
- `app/providers/providers.tsx` - AudioProvider inserted between SettingsProvider and ModalProvider
- `app/components/onboarding/SplashScreen.tsx` - initAudio() added as first line of handleEnter callback

## Decisions Made
- **AudioCtx name**: Named the React context `AudioCtx` instead of `AudioContext` to avoid shadowing the Web Audio API's global `AudioContext` constructor. Prevents confusing IDE autocompletion and accidental reference to wrong context.
- **isPlaying excluded from sync deps**: The settings sync useEffect reads `isPlaying` to decide whether to call play/pause, but including it in deps would cause infinite re-fire (effect sets isPlaying, which triggers effect again). Intentionally excluded with eslint-disable comment.
- **initAudio first in handler**: Browser autoplay policy gives a narrow synchronous window during a user gesture where AudioContext creation is allowed. Any async work (setTimeout, setState flush) could close this window. initAudio() must be the first call in handleEnter.
- **No duplicate persistence**: AudioProvider does not access localStorage. SettingsProvider is the single source of truth for muted/volume persistence. AudioProvider only reads from SettingsProvider via useSettings hook.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Audio system fully wired: AudioManager engine (Plan 01) + React integration (Plan 02) complete
- Music plays when users click splash screen button (if not muted)
- Volume/mute changes from SettingsStation immediately affect playback
- Tab backgrounding suspends AudioContext (saves battery), restores on return
- useAudio() hook available for any future component needing audio control
- Phase 67 complete -- all 2 plans shipped

---
*Phase: 67-audio-system-core*
*Completed: 2026-03-02*
