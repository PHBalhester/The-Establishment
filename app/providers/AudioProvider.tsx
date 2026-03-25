'use client';

/**
 * AudioProvider -- React context that bridges AudioManager with SettingsProvider.
 *
 * Responsibilities:
 * 1. Exposes initAudio() for gesture-gated AudioContext creation (SplashScreen)
 * 2. Syncs muted/volume from SettingsProvider to AudioManager in real-time
 * 3. Provides play/pause convenience methods for future UI controls
 *
 * CRITICAL: Does NOT duplicate localStorage persistence. SettingsProvider owns
 * muted/volume persistence. This provider only READS from SettingsProvider and
 * pushes values to AudioManager.
 *
 * Provider tree position: after SettingsProvider, before ModalProvider.
 * This ensures AudioProvider can read settings, and all modal/toast content
 * can access useAudio().
 */

import {
  createContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { audioManager } from '@/lib/audio-manager';
import { useSettings } from '@/hooks/useSettings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioContextValue {
  /** Whether audio system has been initialized (gesture gate passed) */
  isInitialized: boolean;
  /** Whether music is currently playing */
  isPlaying: boolean;
  /** Initialize audio system -- call from user gesture handler */
  initAudio: () => void;
  /** Start music playback */
  play: () => void;
  /** Pause music playback */
  pause: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Named AudioCtx (not AudioContext) to avoid shadowing the Web Audio API's
 * global AudioContext constructor. Starts as null -- useAudio() throws if
 * consumed outside an AudioProvider.
 */
export const AudioCtx = createContext<AudioContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider Component
// ---------------------------------------------------------------------------

interface AudioProviderProps {
  children: ReactNode;
}

export function AudioProvider({ children }: AudioProviderProps) {
  const { settings } = useSettings();

  // Track whether init() has been called (gesture gate passed)
  const [isInitialized, setIsInitialized] = useState(false);
  // Mirror AudioManager playback state for React consumers
  const [isPlaying, setIsPlaying] = useState(false);

  // -------------------------------------------------------------------------
  // initAudio -- gesture-gated AudioContext creation
  // -------------------------------------------------------------------------
  // Called from SplashScreen's click handler. Must execute synchronously
  // within the user gesture's activation window for browser autoplay policy.
  const initAudio = useCallback(() => {
    audioManager.init();
    setIsInitialized(true);

    // Apply current settings to AudioManager
    audioManager.setMuted(settings.muted);
    audioManager.setVolume(settings.muted ? 0 : settings.volume / 100);

    // Start playback only if user is not muted (respect preference)
    if (!settings.muted) {
      audioManager.play();
      setIsPlaying(true);
    }
  }, [settings.muted, settings.volume]);

  // -------------------------------------------------------------------------
  // Settings sync -- push muted/volume changes to AudioManager in real-time
  // -------------------------------------------------------------------------
  // When the user adjusts volume or toggles mute in SettingsStation, those
  // changes flow through SettingsProvider -> this useEffect -> AudioManager.
  useEffect(() => {
    if (!isInitialized) return;

    audioManager.setMuted(settings.muted);
    audioManager.setVolume(settings.muted ? 0 : settings.volume / 100);

    if (!settings.muted && !isPlaying) {
      // Unmuted while paused: resume playback
      audioManager.play();
      setIsPlaying(true);
    } else if (settings.muted && isPlaying) {
      // Muted while playing: AudioManager.setMuted already handles fade-out.
      // Update React state to reflect paused UI.
      setIsPlaying(false);
    }
  }, [settings.muted, settings.volume, isInitialized]); // eslint-disable-line react-hooks/exhaustive-deps
  // NOTE: isPlaying intentionally excluded from deps to avoid infinite loop.
  // We READ isPlaying inside but only WRITE it -- including it would cause
  // the effect to re-fire every time it sets isPlaying, creating a cycle.

  // -------------------------------------------------------------------------
  // play / pause convenience methods
  // -------------------------------------------------------------------------
  const play = useCallback(() => {
    audioManager.play();
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioManager.pause();
    setIsPlaying(false);
  }, []);

  // -------------------------------------------------------------------------
  // Cleanup on unmount (hot reload / page navigation)
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      audioManager.destroy();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Memoized context value -- prevents unnecessary re-renders of consumers
  // -------------------------------------------------------------------------
  const value = useMemo<AudioContextValue>(
    () => ({ isInitialized, isPlaying, initAudio, play, pause }),
    [isInitialized, isPlaying, initAudio, play, pause],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}
