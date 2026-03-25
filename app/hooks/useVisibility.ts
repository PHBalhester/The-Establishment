'use client';

/**
 * useVisibility -- Page Visibility + modal-aware pausing hook.
 *
 * Combines the Page Visibility API with modal context awareness to
 * determine whether a data-fetching hook should be active. This is the
 * foundation for all RPC credit optimization: hooks that are not visible
 * (tab hidden or wrong modal open) stop polling entirely.
 *
 * Three usage patterns:
 *
 *   useVisibility()
 *     Pause only when the browser tab is hidden. Used by hooks that run
 *     everywhere (e.g., useTokenBalances on the dashboard).
 *
 *   useVisibility("swap")
 *     Pause when tab is hidden OR when a different station modal is the
 *     active modal. Used by station-specific hooks (e.g., useSwap).
 *
 *   Note: isActive === true when activeStation === null (no modal open).
 *     This ensures hooks continue running when the user is
 *     on the main factory scene with no modal open.
 *
 * The onResume callback system fires "burst-refresh" functions when the
 * tab transitions from hidden to visible, allowing hooks to immediately
 * fetch fresh data after a background period instead of waiting for the
 * next polling interval.
 *
 * Zero external dependencies (project policy).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useModal } from '@/hooks/useModal';
import type { StationId } from '@/components/modal/ModalProvider';

/**
 * Determine whether a data hook should be active based on tab visibility
 * and which modal station (if any) is currently open.
 *
 * @param requiredStation  Optional station ID. When provided, isActive
 *   is false if a different station is the active modal.
 * @returns isActive (should fetch?), tabVisible (raw tab state),
 *   onResume (register burst-refresh callback).
 */
export function useVisibility(requiredStation?: StationId): {
  isActive: boolean;
  tabVisible: boolean;
  onResume: (cb: () => void) => () => void;
} {
  // ---------------------------------------------------------------------------
  // Tab visibility state (SSR-safe initialisation)
  // ---------------------------------------------------------------------------
  const [tabVisible, setTabVisible] = useState<boolean>(
    typeof document !== 'undefined' ? !document.hidden : true,
  );

  // Ref tracking the previous tabVisible value so we can detect the
  // false -> true transition (tab return) without stale closures.
  const prevTabVisibleRef = useRef(tabVisible);

  // ---------------------------------------------------------------------------
  // Burst-refresh callback registry
  // ---------------------------------------------------------------------------
  const resumeCallbacksRef = useRef<Array<() => void>>([]);

  // ---------------------------------------------------------------------------
  // Visibility change listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handleVisibilityChange() {
      const isNowVisible = !document.hidden;
      setTabVisible(isNowVisible);

      // Detect the false -> true transition (tab was hidden, now visible).
      // Fire all burst-refresh callbacks so hooks fetch fresh data immediately.
      if (isNowVisible && !prevTabVisibleRef.current) {
        for (const cb of resumeCallbacksRef.current) {
          cb();
        }
      }

      prevTabVisibleRef.current = isNowVisible;
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Modal awareness
  // ---------------------------------------------------------------------------
  const { state } = useModal();

  // A hook is active when:
  //   (a) the browser tab is visible, AND
  //   (b) either:
  //       - no required station was specified (runs everywhere), OR
  //       - the required station matches the currently open modal, OR
  //       - no modal is open (activeStation === null) -- main factory scene
  const isActive =
    tabVisible &&
    (!requiredStation ||
      state.activeStation === requiredStation ||
      state.activeStation === null);

  // ---------------------------------------------------------------------------
  // onResume -- register a burst-refresh callback
  // ---------------------------------------------------------------------------
  const onResume = useCallback((cb: () => void): (() => void) => {
    resumeCallbacksRef.current.push(cb);

    // Return cleanup function that removes this specific callback
    return () => {
      resumeCallbacksRef.current = resumeCallbacksRef.current.filter(
        (fn) => fn !== cb,
      );
    };
  }, []);

  return { isActive, tabVisible, onResume };
}
