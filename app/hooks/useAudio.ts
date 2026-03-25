'use client';

/**
 * useAudio -- Hook for accessing the audio system context.
 *
 * Thin wrapper around AudioCtx that provides a clean API for any component
 * in the tree to check audio state and control playback.
 *
 * Throws if used outside an AudioProvider -- intentional developer safety
 * to catch missing providers early during development.
 *
 * Usage:
 *   const { initAudio, isPlaying, play, pause } = useAudio();
 *   initAudio(); // Call from user gesture to unlock AudioContext
 */

import { useContext } from 'react';
import { AudioCtx } from '@/providers/AudioProvider';
import type { AudioContextValue } from '@/providers/AudioProvider';

export function useAudio(): AudioContextValue {
  const context = useContext(AudioCtx);
  if (!context) {
    throw new Error(
      'useAudio must be used within an AudioProvider. ' +
      'Wrap your component tree with <AudioProvider> in providers.tsx.',
    );
  }
  return context;
}
