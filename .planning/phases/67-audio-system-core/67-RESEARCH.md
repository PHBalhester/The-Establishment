# Phase 67: Audio System Core - Research

**Researched:** 2026-03-02
**Domain:** Web Audio API, React audio architecture, browser autoplay policy
**Confidence:** HIGH

## Summary

This phase builds the audio infrastructure for background music playback: an AudioManager singleton, an AudioProvider React context, gesture-gated AudioContext creation, crossfade between tracks, and integration with the existing SettingsProvider for persistence.

The standard approach uses the native Web Audio API (no third-party audio libraries). The system uses `HTMLAudioElement` instances connected through `MediaElementAudioSourceNode` into an AudioContext graph with per-track `GainNode` instances for crossfading. This avoids the massive memory cost of `decodeAudioData()` (which decodes compressed MP3 into raw PCM -- a ~10x-15x expansion) and leverages the browser's built-in streaming/buffering for MP3 playback.

The architecture is: AudioManager singleton class (owns the AudioContext, GainNodes, and Audio elements) wrapped by an AudioProvider React context (exposes play/pause/toggle/setVolume to components, reads from SettingsProvider for persisted preferences).

**Primary recommendation:** Use `HTMLAudioElement` + `MediaElementAudioSourceNode` + `GainNode` for music playback and crossfading. Do NOT use `AudioBufferSourceNode` with `decodeAudioData()` -- the decoded PCM buffers would consume ~42MB per 2-minute track (~126MB total for 3 tracks), far exceeding the 10MB budget and providing no benefit for background music.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Web Audio API (native) | N/A | AudioContext, GainNode, MediaElementAudioSourceNode | Browser-native, zero dependencies, full control over gain scheduling |
| HTMLAudioElement (native) | N/A | MP3 streaming playback | Browser-native streaming, no memory bloat from decoded buffers |
| React Context API | React 19 | AudioProvider wrapping AudioManager | Already used for SettingsProvider, consistent pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Page Visibility API (native) | N/A | Pause music when tab is hidden | Always -- saves CPU/battery, prevents competing audio |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native Web Audio API | howler.js | Howler adds ~10KB and handles cross-browser quirks, but adds npm dependency risk (Turbopack compat), and our needs are simple enough for native API |
| Native Web Audio API | Tone.js | Overkill for background music -- designed for music synthesis/production |
| HTMLAudioElement streaming | AudioBufferSourceNode + decodeAudioData | Would decode 2.2MB MP3 into ~42MB raw PCM per track. 3 tracks = ~126MB decoded. Unusable for music. Only appropriate for short SFX (<5s) |

**Installation:**
```bash
# No npm packages needed -- all browser-native APIs
```

## Architecture Patterns

### Recommended Project Structure
```
app/
  lib/
    audio-manager.ts     # AudioManager singleton class (AudioContext, GainNodes, crossfade logic)
  providers/
    AudioProvider.tsx     # React context wrapping AudioManager, reads SettingsProvider
  hooks/
    useAudio.ts          # useContext(AudioContext) convenience hook
  public/
    music/
      music-1.mp3        # Copied from WebsiteAssets with URL-safe names
      music-2.mp3
      music-3.mp3
```

### Pattern 1: AudioManager Singleton
**What:** A plain TypeScript class (not a React component) that owns the AudioContext, Audio elements, GainNodes, and all playback logic. Created lazily on first user gesture.
**When to use:** Always -- separates audio engine from React lifecycle.
**Why singleton:** Safari allows only 4 open AudioContext instances. One context handles everything.

```typescript
// Source: MDN Web Audio API Best Practices + verified patterns
class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private tracks: string[] = ['/music/music-1.mp3', '/music/music-2.mp3', '/music/music-3.mp3'];
  private currentSlot: 0 | 1 = 0;
  // Two "slots" for crossfading -- each has an Audio element + MediaElementSource + GainNode
  private slots: [AudioSlot | null, AudioSlot | null] = [null, null];

  /** Must be called during a user gesture (click/touch/keydown) */
  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    // Create two crossfade slots
    this.slots = [this.createSlot(), this.createSlot()];
  }

  private createSlot(): AudioSlot {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous'; // needed for CORS if ever external
    const source = this.ctx!.createMediaElementSource(audio);
    const gain = this.ctx!.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.masterGain!);
    return { audio, source, gain };
  }
  // ... crossfade, shuffle, volume methods
}
```

### Pattern 2: Dual-Slot Crossfade
**What:** Two Audio element "slots" with independent GainNodes. When track ends, load next track into the inactive slot, fade out active slot's gain while fading in the new one.
**When to use:** For the 2-3 second crossfade between tracks.
**Why dual-slot:** You cannot create a new MediaElementAudioSourceNode from an Audio element that already has one. Two permanent slots avoids this limitation.

```typescript
// Source: MDN GainNode + linearRampToValueAtTime documentation
crossfadeTo(url: string): void {
  const nextSlot = this.currentSlot === 0 ? 1 : 0;
  const fadeTime = this.ctx!.currentTime;
  const fadeDuration = 2.5; // seconds

  // Load new track into inactive slot
  this.slots[nextSlot]!.audio.src = url;
  this.slots[nextSlot]!.audio.play();

  // Fade in new slot
  this.slots[nextSlot]!.gain.gain.setValueAtTime(0, fadeTime);
  this.slots[nextSlot]!.gain.gain.linearRampToValueAtTime(1, fadeTime + fadeDuration);

  // Fade out current slot
  this.slots[this.currentSlot]!.gain.gain.setValueAtTime(
    this.slots[this.currentSlot]!.gain.gain.value, fadeTime
  );
  this.slots[this.currentSlot]!.gain.gain.linearRampToValueAtTime(0, fadeTime + fadeDuration);

  this.currentSlot = nextSlot as 0 | 1;
}
```

### Pattern 3: AudioProvider + SettingsProvider Integration
**What:** AudioProvider reads muted/volume from SettingsProvider (which already persists to localStorage). AudioProvider syncs these values to AudioManager. No duplicate persistence.
**When to use:** Always -- avoids dual source of truth.

```typescript
// AudioProvider reads settings and syncs to AudioManager
function AudioProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const managerRef = useRef<AudioManager>(audioManager); // singleton

  // Sync volume changes to AudioManager
  useEffect(() => {
    managerRef.current.setVolume(settings.muted ? 0 : settings.volume / 100);
  }, [settings.muted, settings.volume]);

  // ... expose play/pause/toggle via context
}
```

### Pattern 4: Gesture-Gated Initialization via SplashScreen
**What:** The SplashScreen button click is the user gesture that creates/resumes the AudioContext. This is the natural place since every session starts with SplashScreen.
**When to use:** Always -- this is the only reliable gesture gate.

### Anti-Patterns to Avoid
- **Creating AudioContext at module scope:** Will be `suspended` and may never unlock on iOS Safari.
- **Using `decodeAudioData()` for music tracks:** Decodes MP3 into raw PCM (44100 samples/sec x 4 bytes x 2 channels = ~352KB/sec). A 2-minute track becomes ~42MB decoded. Use HTMLAudioElement streaming instead.
- **Setting `gain.value` directly during transitions:** Causes audible clicks/pops. Always use `setValueAtTime()` + `linearRampToValueAtTime()` for smooth transitions.
- **Using `exponentialRampToValueAtTime()` to fade to zero:** Exponential ramp cannot reach 0 (division by zero in the math). Use `linearRampToValueAtTime(0, ...)` or ramp to 0.0001 then set to 0.
- **Creating new Audio elements per track play:** Each `new Audio()` + `createMediaElementSource()` creates a permanent binding. Create 2 slots once, reuse by changing `.src`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| iOS Safari audio unlock | Custom event listener matrix | Simple `audioContext.resume()` in splash screen click handler, plus silent buffer technique | The gesture-gated resume is the standard approach; silent buffer covers iOS mute switch edge case |
| Audio preference persistence | New localStorage logic | Existing SettingsProvider (already has `muted` and `volume`) | Already built, validated, and handles localStorage edge cases |
| Smooth gain transitions | Manual requestAnimationFrame loops | `GainNode.gain.linearRampToValueAtTime()` | Browser-native scheduling, sample-accurate, no frame jank |
| Tab backgrounding pause | Custom setInterval polling | Page Visibility API `visibilitychange` event | Native browser event, zero overhead, reliable |

**Key insight:** The Web Audio API already has scheduling primitives (`setValueAtTime`, `linearRampToValueAtTime`) that handle smooth transitions at the audio engine level. Do NOT implement gain ramping with `requestAnimationFrame` or `setInterval` -- these operate at 60fps/1000ms granularity while the audio engine operates at 44100Hz sample accuracy.

## Common Pitfalls

### Pitfall 1: AudioContext Created Outside User Gesture (CRIT-03)
**What goes wrong:** AudioContext starts in `suspended` state and never plays audio. iOS Safari is especially strict.
**Why it happens:** Creating AudioContext at module scope, in useEffect, or during SSR.
**How to avoid:** Create AudioContext inside the SplashScreen button's `onClick` handler. This is a guaranteed user gesture. Call `audioManager.init()` there.
**Warning signs:** `audioContext.state === 'suspended'` after init, no audio on iOS.

### Pitfall 2: Memory Leaks from Undisconnected Source Nodes (HIGH-03)
**What goes wrong:** Using `AudioBufferSourceNode` pattern: creating new source nodes per play without disconnecting them. Nodes accumulate in the audio graph.
**Why it happens:** AudioBufferSourceNode is one-shot (cannot replay), so developers create new ones per play and forget to disconnect.
**How to avoid:** Using `MediaElementAudioSourceNode` with 2 permanent slots eliminates this entirely -- slots are created once and reused. The Audio element's `.src` is swapped, no new nodes created. If any BufferSourceNode IS used (e.g., silent buffer for iOS unlock), disconnect it in the `ended` callback.
**Warning signs:** Increasing memory usage over time in DevTools Performance tab.

### Pitfall 3: HTMLAudioElement Already Bound to MediaElementSourceNode
**What goes wrong:** Calling `createMediaElementSource(audio)` on an Audio element that was already connected. Throws error: "already connected to a different MediaElementSourceNode."
**Why it happens:** Creating new connections instead of reusing existing ones.
**How to avoid:** Create exactly 2 Audio+Source+Gain "slots" at init time. Never create new ones. Swap `.src` to change tracks.
**Warning signs:** Runtime error in console about duplicate MediaElementSourceNode.

### Pitfall 4: Crossfade Volume Dip (Linear vs Equal-Power)
**What goes wrong:** During crossfade, perceived volume drops noticeably at the midpoint.
**Why it happens:** Linear crossfade: at midpoint both gains are 0.5, but perceived loudness of 0.5+0.5 is less than 1.0 (human hearing is logarithmic).
**How to avoid:** Use equal-power crossfade curve: `gain1 = Math.cos(t * 0.5 * Math.PI)`, `gain2 = Math.cos((1-t) * 0.5 * Math.PI)`. OR: for simplicity, `linearRampToValueAtTime` is acceptable for 2-3 second crossfades on background music -- the dip is subtle.
**Warning signs:** Users perceive music getting quieter during transitions.

### Pitfall 5: iOS Safari Mute Switch Behavior (MOD-07)
**What goes wrong:** Web Audio API is silent when iOS hardware mute switch is on, even after AudioContext is unlocked.
**Why it happens:** iOS treats Web Audio differently from HTMLMediaElement when mute switch is engaged.
**How to avoid:** Play a silent buffer through both an `<audio>` tag AND AudioContext during the first user gesture. This "warms up" the audio pipeline. The feross/unmute-ios-audio technique: create a brief silent oscillator at frequency 0 connected to destination during the click handler.
**Warning signs:** Audio works on desktop Safari but not on iPhone with mute switch on.

### Pitfall 6: CSP Blocking Audio Files
**What goes wrong:** MP3 files from `/public/music/` are blocked by Content-Security-Policy.
**Why it happens:** Missing `media-src` directive in CSP header.
**How to avoid:** The existing CSP has `default-src 'self'` which `media-src` falls back to. Audio files served from the same origin (via Next.js `/public/`) will work. No CSP changes needed.
**Warning signs:** Console CSP violation errors mentioning media-src.

### Pitfall 7: Privy Dialog Gesture Propagation (HIGH-05)
**What goes wrong:** Privy wallet confirmation dialog overlays could theoretically intercept click events that should reach the SplashScreen button.
**Why it happens:** Privy uses HeadlessUI with z-index 999999.
**How to avoid:** SplashScreen renders BEFORE any wallet interaction is possible (it's the first thing users see). By the time Privy dialogs appear, AudioContext is already initialized. This is a non-issue for Phase 67 but worth documenting.
**Warning signs:** AudioContext not initializing on certain user flows.

### Pitfall 8: gain.value Direct Assignment Causes Clicks
**What goes wrong:** Audible click/pop artifacts when changing volume.
**Why it happens:** Setting `gain.value` directly causes an instantaneous jump in the audio signal.
**How to avoid:** Always use `gain.setValueAtTime(currentValue, now)` followed by `gain.linearRampToValueAtTime(targetValue, now + 0.05)` even for "immediate" volume changes. The 50ms ramp eliminates clicks.
**Warning signs:** Audible clicks when muting/unmuting or adjusting volume slider.

## Code Examples

### AudioContext Creation in User Gesture
```typescript
// Source: MDN Web Audio API Best Practices
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices

// Called from SplashScreen handleEnter callback
function initAudio(): void {
  const ctx = new AudioContext();
  // Safari compat: resume if autoplay policy suspended it
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
}
```

### iOS Safari Silent Buffer Unlock
```typescript
// Source: feross/unmute-ios-audio pattern + Matt Montag technique
// https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos

function unlockiOSAudio(ctx: AudioContext): void {
  // Create a silent buffer and play it
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  // Source auto-disconnects after playing 1 sample

  // Also touch an Audio element for mute-switch bypass
  const silentAudio = new Audio();
  silentAudio.play().catch(() => {}); // Will fail silently if no src, which is fine
}
```

### Smooth Volume Change (No Clicks)
```typescript
// Source: MDN GainNode documentation
// https://developer.mozilla.org/en-US/docs/Web/API/GainNode

function setVolume(gainNode: GainNode, ctx: AudioContext, volume: number): void {
  const now = ctx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.05); // 50ms ramp, no clicks
}
```

### Crossfade Between Tracks
```typescript
// Source: MDN linearRampToValueAtTime + Boris Smus Web Audio API book
// https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/linearRampToValueAtTime

function crossfade(
  ctx: AudioContext,
  fadeOutGain: GainNode,
  fadeInGain: GainNode,
  durationSec: number = 2.5
): void {
  const now = ctx.currentTime;

  // Anchor current values (required for ramp start point)
  fadeOutGain.gain.cancelScheduledValues(now);
  fadeOutGain.gain.setValueAtTime(fadeOutGain.gain.value, now);
  fadeOutGain.gain.linearRampToValueAtTime(0, now + durationSec);

  fadeInGain.gain.cancelScheduledValues(now);
  fadeInGain.gain.setValueAtTime(0, now);
  fadeInGain.gain.linearRampToValueAtTime(1, now + durationSec);
}
```

### Tab Visibility Handling
```typescript
// Source: MDN Page Visibility API
// https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API

function setupVisibilityHandler(ctx: AudioContext, wasPlayingRef: { current: boolean }): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      wasPlayingRef.current = ctx.state === 'running';
      if (ctx.state === 'running') ctx.suspend();
    } else {
      if (wasPlayingRef.current && ctx.state === 'suspended') {
        ctx.resume();
      }
    }
  });
}
```

### Fisher-Yates Shuffle (No Repeat)
```typescript
// Standard shuffle with no-repeat-last constraint
function shufflePlaylist(tracks: string[], lastPlayed?: string): string[] {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // If first track after shuffle === last played, swap with a random other position
  if (lastPlayed && shuffled[0] === lastPlayed && shuffled.length > 1) {
    const swapIdx = 1 + Math.floor(Math.random() * (shuffled.length - 1));
    [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
  }
  return shuffled;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `new webkitAudioContext()` | `new AudioContext()` | Safari 14.1+ (2021) | No webkit prefix needed for Safari 14.1+. Still safe to include fallback for ancient devices |
| `createGainNode()` (deprecated) | `createGain()` or `new GainNode(ctx)` | Web Audio API 1.0 | Use `createGain()` or constructor form |
| `decodeAudioData(buffer, success, error)` (callback) | `decodeAudioData(buffer)` (Promise) | Widely supported since 2020 | Use Promise form; callback still works |
| `noteOn(0)` / `noteOff(0)` | `start()` / `stop()` | Removed years ago | Only use `start()`/`stop()` |

**Deprecated/outdated:**
- `webkitAudioContext`: Only needed for Safari < 14.1 (released April 2021). For this project targeting modern browsers, `AudioContext` alone is sufficient.
- `createGainNode()`: Replaced by `createGain()`. Long deprecated.
- `AudioBufferSourceNode` for music tracks: Not deprecated, but inappropriate for tracks > 10 seconds due to memory cost of decoded PCM.

## Open Questions

1. **Equal-power vs linear crossfade**
   - What we know: Linear crossfade has a perceived volume dip at midpoint. Equal-power curve (cosine-based) eliminates it.
   - What's unclear: Whether the dip is perceptible for 2-3 second crossfades on low-volume background music.
   - Recommendation: Start with `linearRampToValueAtTime` (simpler, browser-native scheduling). If testing reveals a noticeable dip, switch to manual equal-power curve via `setValueCurveAtTime()` or `requestAnimationFrame` (only for the crossfade envelope, not general volume).

2. **Buffer preloading strategy**
   - What we know: 3 tracks at ~2.3MB each = ~6.8MB total compressed. HTMLAudioElement handles buffering natively.
   - What's unclear: Whether to preload all 3 (using `audio.preload = 'auto'`) or load lazily.
   - Recommendation: Preload the NEXT track only. Set `preload = 'auto'` on the upcoming slot's Audio element ~10 seconds before the current track ends. The browser handles the streaming. First track loads immediately on init.

3. **iOS Safari hardware mute switch**
   - What we know: The silent buffer + Audio element dual-play technique reportedly works to bypass the mute switch. The feross/unmute-ios-audio library implements this.
   - What's unclear: Whether this still works on iOS 18+ Safari (2025-2026). Cannot verify without hardware testing.
   - Recommendation: Implement the technique (it's ~10 lines of code, zero risk). If it fails, music simply stays muted when hardware switch is on -- graceful degradation.

4. **AudioContext limit on Safari**
   - What we know: Safari allows a maximum of 4 AudioContext instances per page.
   - What's unclear: Whether any other part of the app creates AudioContext instances.
   - Recommendation: Enforce singleton pattern strictly. AudioManager creates exactly 1 AudioContext. Add a guard (`if (this.ctx) return`) in init.

## Sources

### Primary (HIGH confidence)
- [MDN Web Audio API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) - AudioContext creation, user gesture requirements
- [MDN GainNode](https://developer.mozilla.org/en-US/docs/Web/API/GainNode) - Volume control, gain scheduling, click avoidance
- [MDN linearRampToValueAtTime](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/linearRampToValueAtTime) - Smooth gain transitions
- [MDN AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode) - One-shot limitation, memory implications
- [MDN createMediaElementSource](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource) - Audio element binding, re-routing behavior
- [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) - Tab backgrounding pattern
- [MDN media-src CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/media-src) - Falls back to default-src 'self'
- [MDN exponentialRampToValueAtTime](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/exponentialRampToValueAtTime) - Cannot ramp to zero, workarounds

### Secondary (MEDIUM confidence)
- [Matt Montag - Unlock Web Audio in Safari](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos) - Verified unlock technique: `resume()` on user gesture + event listeners
- [feross/unmute-ios-audio](https://github.com/feross/unmute-ios-audio) - Silent buffer + Audio element dual-play for iOS mute switch bypass
- [Boris Smus - Web Audio API (O'Reilly)](https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch03.html) - Equal-power crossfade formula, crossfade playlist pattern
- [Chrome blog - HTML5 audio and Web Audio API](https://developer.chrome.com/blog/html5-audio-and-the-web-audio-api-are-bffs) - MediaElementAudioSourceNode pattern

### Tertiary (LOW confidence)
- [WebAudio spec issue #904](https://github.com/WebAudio/web-audio-api/issues/904) - AudioNode disconnect memory behavior (confirms disconnect needed for BufferSourceNode)
- [Can I Use - Web Audio API](https://caniuse.com/audio-api) - Browser support (Baseline: widely available since 2015)

## Integration Points (Project-Specific)

### Existing Code That AudioManager Must Integrate With

1. **SettingsProvider** (`app/providers/SettingsProvider.tsx`)
   - Already persists `muted: boolean` and `volume: number (0-100)` to localStorage
   - AudioProvider reads from SettingsContext, does NOT duplicate persistence
   - Volume value 0-100 maps to gain 0.0-1.0 (divide by 100)
   - Default volume: 20 (set in SettingsProvider `getDefaults()`)
   - `prefers-reduced-motion` check already defaults `muted: true`

2. **SplashScreen** (`app/components/onboarding/SplashScreen.tsx`)
   - Button click in `handleEnter` callback is the user gesture for AudioContext creation
   - Must call `audioManager.init()` inside this callback
   - SplashScreen renders inside ToastProvider, after SettingsProvider in tree

3. **Provider Tree** (`app/providers/providers.tsx`)
   - AudioProvider should go between SettingsProvider and ModalProvider:
     ```
     ConnectionProvider > WalletProvider > SettingsProvider > AudioProvider > ModalProvider > ToastProvider
     ```
   - This ensures AudioProvider can read from SettingsProvider, and all modal/toast content can access useAudio()

4. **CSP** (`app/next.config.ts`)
   - `default-src 'self'` provides fallback for `media-src`
   - MP3 files in `/public/music/` are same-origin -- no CSP changes needed

5. **Music Files** (`WebsiteAssets/WebsiteMusic/`)
   - Must copy to `app/public/music/` with URL-safe names:
     - `Music1.mp3` -> `music-1.mp3`
     - `Music 2.mp3` -> `music-2.mp3`
     - `Music3.mp3` -> `music-3.mp3`
   - Track list should be array-driven for extensibility

### Memory Budget Analysis

| Item | Compressed (MP3) | Decoded (PCM) | Notes |
|------|-------------------|---------------|-------|
| Music1.mp3 | 2.43 MB | ~42 MB | Stereo 44.1kHz x ~120s x 4 bytes |
| Music 2.mp3 | 2.21 MB | ~38 MB | Estimated |
| Music3.mp3 | 2.20 MB | ~38 MB | Estimated |
| **Total if using AudioBufferSourceNode** | 6.84 MB | **~118 MB** | **Exceeds 10MB LRU budget by 12x** |
| **Total using HTMLAudioElement** | 6.84 MB | **~0 MB additional** | Browser manages streaming buffer |

**Decision:** Use HTMLAudioElement. The browser's media pipeline handles MP3 decoding and streaming with minimal JS-visible memory overhead. The "LRU buffer pool < 10MB" requirement from the roadmap is automatically satisfied because there are no AudioBuffer objects to manage.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All browser-native APIs, well-documented on MDN
- Architecture: HIGH - Dual-slot crossfade with MediaElementAudioSourceNode is established pattern, verified with MDN docs
- Pitfalls: HIGH - AudioContext gesture requirement, GainNode click prevention, iOS Safari unlock are all well-documented
- Crossfade specifics: MEDIUM - Linear vs equal-power crossfade perceptibility for background music is subjective; recommendation to start simple is pragmatic
- iOS mute switch bypass: MEDIUM - Technique is established but cannot verify on iOS 18+ without hardware testing

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- Web Audio API spec changes rarely)
