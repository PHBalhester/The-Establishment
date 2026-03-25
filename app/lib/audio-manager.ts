/**
 * AudioManager -- Core audio engine singleton for background music playback.
 *
 * Architecture: HTMLAudioElement + MediaElementAudioSourceNode (NOT AudioBufferSourceNode).
 * Research confirmed that decodeAudioData would expand ~6.8MB MP3 into ~118MB raw PCM.
 * HTMLAudioElement streaming with MediaElementAudioSourceNode for Web Audio API gain
 * control keeps JS memory near zero.
 *
 * Key design decisions:
 * - AudioContext created lazily in init() (called from user gesture in SplashScreen)
 * - Two permanent crossfade "slots" (Audio + MediaElementSource + GainNode) -- reused
 *   by changing .src, never creating new nodes
 * - Volume changes use setValueAtTime + linearRampToValueAtTime (never direct gain.value)
 * - Tab visibility: suspend AudioContext when hidden, resume when visible
 * - iOS Safari: silent buffer + Audio element dual-play unlock
 * - Fisher-Yates shuffle with no-repeat-last constraint
 *
 * This is a plain TypeScript class -- no React, no 'use client' directive.
 * AudioProvider (Phase 67 Plan 02) wraps this class in a React context.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AudioSlot {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACKS = ['/music/music-1.mp3', '/music/music-2.mp3', '/music/music-3.mp3'];

// ---------------------------------------------------------------------------
// AudioManager Class
// ---------------------------------------------------------------------------

export class AudioManager {
  // -- Audio graph --
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private slots: [AudioSlot | null, AudioSlot | null] = [null, null];
  private activeSlot: 0 | 1 = 0;

  // -- Playlist --
  private playlist: string[] = [];
  private playlistIndex = 0;
  private lastTrack: string | null = null;

  // -- State --
  private _isPlaying = false;
  private volume = 1.0;
  private isMuted = false;
  private wasPlayingBeforeHidden = false;
  private crossfadeDuration = 2.5; // seconds

  // -- Per-play-cycle flag: prevents multiple crossfade triggers from timeupdate --
  private crossfadeStarted = false;

  // -- Visibility handler ref for cleanup --
  private handleVisibility: (() => void) | null = null;

  // -- Timeupdate handler refs for cleanup --
  private timeupdateHandlers: [(() => void) | null, (() => void) | null] = [
    null,
    null,
  ];

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Read-only playback state accessor for external consumers (e.g. AudioProvider).
   */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Initialize the AudioContext and audio graph. MUST be called during a user
   * gesture (click/touch/keydown) to satisfy browser autoplay policy.
   *
   * Safe to call multiple times -- subsequent calls just resume the context.
   */
  init(): void {
    // Guard: already initialized -- just resume if suspended
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    // Create AudioContext
    this.ctx = new AudioContext();

    // Safari compat: resume if autoplay policy suspended it
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // iOS Safari silent buffer + Audio element unlock
    this.unlockiOS();

    // Master gain node: all slot gains route through this
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    // Set initial master gain respecting mute state
    const initialGain = this.isMuted ? 0 : this.volume;
    this.masterGain.gain.setValueAtTime(initialGain, this.ctx.currentTime);

    // Create the two permanent crossfade slots
    this.slots = [this.createSlot(0), this.createSlot(1)];

    // Set up tab visibility handler
    this.setupVisibilityHandler();

    // Shuffle playlist and start if not muted
    this.playlist = this.shufflePlaylist();
    this.playlistIndex = 0;

    if (!this.isMuted) {
      this._isPlaying = true;
      this.playTrack(this.playlist[this.playlistIndex]);
    }
  }

  /**
   * Start or resume playback.
   */
  play(): void {
    if (!this.ctx || this._isPlaying) return;

    // Resume AudioContext if suspended (e.g. after tab visibility restore)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this._isPlaying = true;

    // If we have a playlist, start playing current track
    if (this.playlist.length > 0) {
      this.playTrack(this.playlist[this.playlistIndex]);
    }
  }

  /**
   * Pause playback. Keeps AudioContext warm for quick resume.
   */
  pause(): void {
    this._isPlaying = false;

    // Fade out active slot over 50ms (no click)
    const slot = this.slots[this.activeSlot];
    if (slot && this.ctx) {
      const now = this.ctx.currentTime;
      slot.gain.gain.cancelScheduledValues(now);
      slot.gain.gain.setValueAtTime(slot.gain.gain.value, now);
      slot.gain.gain.linearRampToValueAtTime(0, now + 0.05);
    }

    // Do NOT suspend AudioContext -- keep it warm for quick resume
  }

  /**
   * Set master volume. 0.0 to 1.0 range.
   * Uses smooth 50ms ramp to avoid clicks (never sets gain.value directly).
   */
  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));

    if (this.ctx && this.masterGain && !this.isMuted) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 0.05);
    }
  }

  /**
   * Set muted state. Smooth 50ms ramp to 0 or volume.
   * If unmuting and not playing, starts playback.
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;

    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);

      if (muted) {
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.05);
      } else {
        this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 0.05);

        // If unmuting and not playing, start playback
        if (!this._isPlaying) {
          this.play();
        }
      }
    }
  }

  /**
   * Tear down the audio graph. Disconnects all nodes, closes AudioContext,
   * removes event listeners.
   */
  destroy(): void {
    // Pause and disconnect both slots
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i as 0 | 1];
      if (slot) {
        slot.audio.pause();
        slot.audio.removeAttribute('src');
        slot.audio.load(); // Reset audio element

        // Remove timeupdate handler
        const handler = this.timeupdateHandlers[i as 0 | 1];
        if (handler) {
          slot.audio.removeEventListener('timeupdate', handler);
          this.timeupdateHandlers[i as 0 | 1] = null;
        }

        try {
          slot.source.disconnect();
          slot.gain.disconnect();
        } catch {
          // Already disconnected -- ignore
        }
      }
    }
    this.slots = [null, null];

    // Remove visibility listener
    if (this.handleVisibility) {
      document.removeEventListener('visibilitychange', this.handleVisibility);
      this.handleVisibility = null;
    }

    // Close AudioContext
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }

    // Null out references
    this.masterGain = null;
    this._isPlaying = false;
    this.crossfadeStarted = false;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Create one crossfade slot: Audio element + MediaElementSource + GainNode.
   * Audio elements are reused across tracks by changing .src (never creating
   * new elements).
   */
  private createSlot(index: 0 | 1): AudioSlot {
    const audio = new Audio();
    audio.preload = 'auto';
    // Do NOT set crossOrigin -- same-origin files, setting it can cause CORS preflight issues

    const source = this.ctx!.createMediaElementSource(audio);
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(0, this.ctx!.currentTime);

    // Connect: source -> gain -> masterGain
    source.connect(gain);
    gain.connect(this.masterGain!);

    // Track ended: advance to next track (fallback for tracks shorter than crossfadeDuration)
    audio.addEventListener('ended', () => this.onTrackEnded());

    // Pre-crossfade trigger: start crossfade before track ends for seamless overlap.
    // The timeupdate event fires ~4 times/sec. We check if we're within crossfadeDuration
    // of the end and trigger crossfade early.
    const timeupdateHandler = () => {
      if (
        !this._isPlaying ||
        this.crossfadeStarted ||
        !Number.isFinite(audio.duration)
      ) {
        return;
      }

      const remaining = audio.duration - audio.currentTime;
      if (remaining <= this.crossfadeDuration && remaining > 0) {
        this.crossfadeStarted = true;
        this.advanceTrack();
      }
    };

    audio.addEventListener('timeupdate', timeupdateHandler);
    this.timeupdateHandlers[index] = timeupdateHandler;

    return { audio, source, gain };
  }

  /**
   * iOS Safari silent buffer + Audio element dual-play unlock.
   *
   * Creates a 1-sample silent buffer and plays it through the AudioContext.
   * Also creates a temporary Audio element and calls .play() for mute switch bypass.
   * See: feross/unmute-ios-audio pattern + Matt Montag technique.
   */
  private unlockiOS(): void {
    if (!this.ctx) return;

    // Play a 1-sample silent buffer through AudioContext
    const buffer = this.ctx.createBuffer(1, 1, 22050);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(0);
    // Source auto-completes after 1 sample -- no cleanup needed

    // Touch an Audio element for mute-switch bypass
    const silentAudio = new Audio();
    silentAudio.play().catch(() => {
      // Will fail silently if no src, which is fine
    });
  }

  /**
   * Fisher-Yates shuffle with no-repeat-last constraint.
   * Returns a new shuffled array of track URLs.
   */
  private shufflePlaylist(): string[] {
    const shuffled = [...TRACKS];

    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // No-repeat-last constraint: if first track equals lastTrack, swap with random other
    if (
      this.lastTrack &&
      shuffled[0] === this.lastTrack &&
      shuffled.length > 1
    ) {
      const swapIdx = 1 + Math.floor(Math.random() * (shuffled.length - 1));
      [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
    }

    return shuffled;
  }

  /**
   * Called when a track reaches its natural end (ended event).
   * This is a fallback -- normally the timeupdate pre-crossfade triggers first.
   */
  private onTrackEnded(): void {
    if (!this._isPlaying) return;

    // If crossfade already started via timeupdate, don't double-advance
    if (this.crossfadeStarted) return;

    this.advanceTrack();
  }

  /**
   * Advance to the next track in the playlist. Reshuffles if at end.
   * Records lastTrack for no-repeat constraint.
   */
  private advanceTrack(): void {
    if (!this._isPlaying) return;

    // Store current track as lastTrack for no-repeat
    this.lastTrack = this.playlist[this.playlistIndex];

    // Advance index
    this.playlistIndex++;

    // If past end of playlist, reshuffle
    if (this.playlistIndex >= this.playlist.length) {
      this.playlist = this.shufflePlaylist();
      this.playlistIndex = 0;
    }

    // Crossfade to next track
    this.crossfadeTo(this.playlist[this.playlistIndex]);
  }

  /**
   * Crossfade from the active slot to the inactive slot with a new track.
   *
   * Uses linearRampToValueAtTime for smooth gain transitions.
   * Swaps activeSlot after scheduling the fade.
   */
  private crossfadeTo(url: string): void {
    if (!this.ctx) return;

    const nextSlotIndex = this.activeSlot === 0 ? 1 : 0;
    const nextSlot = this.slots[nextSlotIndex];
    const currentSlot = this.slots[this.activeSlot];

    if (!nextSlot || !currentSlot) return;

    const now = this.ctx.currentTime;

    // Reset crossfade flag for the new play cycle
    this.crossfadeStarted = false;

    // Load and play next track in the inactive slot
    nextSlot.audio.src = url;
    nextSlot.audio.play().catch(() => {
      // Autoplay may be blocked in some edge cases
    });

    // Fade in next slot: 0 -> 1 over crossfadeDuration
    nextSlot.gain.gain.cancelScheduledValues(now);
    nextSlot.gain.gain.setValueAtTime(0, now);
    nextSlot.gain.gain.linearRampToValueAtTime(
      1,
      now + this.crossfadeDuration,
    );

    // Fade out current slot: current -> 0 over crossfadeDuration
    currentSlot.gain.gain.cancelScheduledValues(now);
    currentSlot.gain.gain.setValueAtTime(currentSlot.gain.gain.value, now);
    currentSlot.gain.gain.linearRampToValueAtTime(
      0,
      now + this.crossfadeDuration,
    );

    // Swap active slot
    this.activeSlot = nextSlotIndex as 0 | 1;
  }

  /**
   * Load a track URL into the active slot and fade in from 0 to 1.
   * Used for initial playback and resume (not crossfade).
   */
  private playTrack(url: string): void {
    if (!this.ctx) return;

    const slot = this.slots[this.activeSlot];
    if (!slot) return;

    // Reset crossfade flag for new play cycle
    this.crossfadeStarted = false;

    const now = this.ctx.currentTime;

    // Load and play
    slot.audio.src = url;
    slot.audio.play().catch(() => {
      // Autoplay may be blocked -- graceful degradation
    });

    // Fade in from 0 to 1 over crossfadeDuration
    slot.gain.gain.cancelScheduledValues(now);
    slot.gain.gain.setValueAtTime(0, now);
    slot.gain.gain.linearRampToValueAtTime(1, now + this.crossfadeDuration);
  }

  /**
   * Set up Page Visibility API handler.
   * Suspends AudioContext when tab is hidden (saves CPU/battery),
   * resumes when tab is visible again.
   */
  private setupVisibilityHandler(): void {
    this.handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden: store playback state and suspend
        this.wasPlayingBeforeHidden = this._isPlaying;
        if (this.ctx && this.ctx.state === 'running') {
          this.ctx.suspend();
        }
      } else {
        // Tab visible: resume if was playing before
        if (
          this.wasPlayingBeforeHidden &&
          this.ctx &&
          this.ctx.state === 'suspended'
        ) {
          this.ctx.resume();
        }
      }
    };

    document.addEventListener('visibilitychange', this.handleVisibility);
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/**
 * Pre-created singleton instance. AudioContext is NOT created here --
 * only in init(), which must be called from a user gesture.
 */
export const audioManager = new AudioManager();
