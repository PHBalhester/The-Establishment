'use client';

/**
 * ModalProvider -- Global modal state management via React Context.
 *
 * Manages which factory station modal is currently open and tracks the click
 * origin coordinates for the iris-open CSS clip-path animation. Enforces a
 * single-modal policy (MODAL-03): only one station can be open at a time.
 * There is no stack, no queue -- opening a new station replaces the current one.
 *
 * The provider does NOT render any <dialog> element. It only manages state.
 * The ModalShell component (Plan 02) consumes this context to sync the
 * <dialog> DOM element with React state.
 *
 * Body scroll lock (body.modal-open class) is applied synchronously in the
 * open/close callbacks -- not in a useEffect -- so it takes effect immediately
 * before any animation begins.
 */

import { createContext, useState, useCallback, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Station IDs matching the 6 factory stations from the scene overlay. */
export type StationId =
  | 'swap'
  | 'carnage'
  | 'staking'
  | 'wallet'
  | 'docs'
  | 'settings';

/** Viewport coordinates (px) for the iris clip-path animation origin. */
export interface IrisOrigin {
  x: number;
  y: number;
}

/** Internal modal state -- which station is open and where the iris starts. */
export interface ModalState {
  activeStation: StationId | null;
  irisOrigin: IrisOrigin | null;
  /** When navigating station-to-station (e.g. Swap → Settings), stores the
   *  origin station so goBack() can return the user there. Null when opened
   *  directly from the scene (no "back" destination). */
  previousStation: StationId | null;
}

/** Public API exposed by the modal context to consumers via useModal(). */
export interface ModalContextValue {
  /** Current modal state (active station and iris origin). */
  state: ModalState;

  /**
   * Open a station modal. If a different station is already open, it is
   * replaced (single-modal policy). If the same station is requested,
   * the call is ignored (no-op).
   *
   * @param station  Which station to open.
   * @param clickOrigin  Viewport coordinates of the clicked scene object
   *                     (center point). Used as the iris animation origin.
   */
  openModal: (station: StationId, clickOrigin: IrisOrigin) => void;

  /**
   * Close the currently open modal. The provider clears state and removes
   * the body scroll lock. The actual <dialog> close animation is handled
   * by ModalShell (Plan 02) listening to state changes.
   */
  closeModal: () => void;

  /**
   * Navigate back to the previous station (e.g. Settings → Swap).
   * Only works when previousStation is set (station-to-station navigation).
   * Returns true if navigation happened, false if there was nowhere to go back to.
   */
  goBack: () => boolean;

  /**
   * Ref to the DOM element that triggered the modal open. Used for focus
   * restoration when the modal closes (MODAL-06 accessibility requirement).
   * Stored as a ref (not state) to avoid unnecessary re-renders.
   */
  triggerRef: RefObject<HTMLElement | null>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * The modal context. Starts as null -- useModal() throws if consumed
 * outside a ModalProvider, ensuring developer safety.
 */
export const ModalContext = createContext<ModalContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider Component
// ---------------------------------------------------------------------------

interface ModalProviderProps {
  children: ReactNode;
}

export function ModalProvider({ children }: ModalProviderProps) {
  const [state, setState] = useState<ModalState>({
    activeStation: null,
    irisOrigin: null,
    previousStation: null,
  });

  // Ref to the element that opened the modal -- for focus restoration on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  const openModal = useCallback(
    (station: StationId, clickOrigin: IrisOrigin) => {
      // Same station already open -- no-op.
      if (state.activeStation === station) return;

      // Save the currently focused element so we can restore focus on close.
      // This must happen before any state change triggers re-renders.
      triggerRef.current = document.activeElement as HTMLElement | null;

      // Apply body scroll lock synchronously (before animation starts).
      document.body.classList.add('modal-open');

      setState({
        activeStation: station,
        irisOrigin: clickOrigin,
        // If navigating from one open station to another (e.g. Swap → Settings),
        // store the origin so goBack() can return the user there.
        // If opening fresh from the scene (no station active), no back destination.
        previousStation: state.activeStation,
      });
    },
    [state.activeStation],
  );

  const closeModal = useCallback(() => {
    // Remove body scroll lock synchronously.
    document.body.classList.remove('modal-open');

    setState({
      activeStation: null,
      irisOrigin: null,
      previousStation: null,
    });

    // Note: Focus restoration to triggerRef.current happens in ModalShell
    // (Plan 02) after the close animation completes via animationend event.
    // We do NOT restore focus here because the dialog is still visible
    // during the close animation -- restoring focus prematurely would shift
    // focus behind the still-visible dialog.
  }, []);

  const goBack = useCallback((): boolean => {
    if (!state.previousStation) return false;

    setState((prev) => ({
      activeStation: prev.previousStation,
      irisOrigin: prev.irisOrigin, // keep same iris origin (no new animation)
      previousStation: null, // one level only, no deep stack
    }));
    return true;
  }, [state.previousStation]);

  const value: ModalContextValue = {
    state,
    openModal,
    closeModal,
    goBack,
    triggerRef,
  };

  return (
    <ModalContext.Provider value={value}>
      {children}
    </ModalContext.Provider>
  );
}
