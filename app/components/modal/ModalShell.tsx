'use client';

/**
 * ModalShell -- Singleton dialog wrapper for all factory station modals.
 *
 * Renders a native <dialog> element that syncs with ModalProvider state.
 * A single ModalShell instance lives in the DOM at all times -- content
 * is swapped inside it when switching between stations (no close/reopen
 * flash per RESEARCH.md Pitfall 7).
 *
 * Responsibilities:
 * - Sync React state (activeStation) with dialog DOM (showModal/close)
 * - Set iris-origin CSS custom properties for clip-path animation
 * - Handle close animation via class toggle + animationend event
 * - Handle native Escape via cancel event (no manual keydown listener)
 * - Handle backdrop click via target === currentTarget check
 * - Support station crossfade without closing the dialog
 * - Provide fixed header + scrollable body layout with steampunk chrome
 *
 * Why singleton: The single-dialog approach prevents the scene flash that
 * would occur if each station had its own dialog (close+open gap). With one
 * dialog, we swap content inside it.
 */

import { useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useModal } from '@/hooks/useModal';
import { ModalCloseButton } from '@/components/modal/ModalCloseButton';
import { ModalContent } from '@/components/modal/ModalContent';
import type { StationId } from '@/components/modal/ModalProvider';

// ---------------------------------------------------------------------------
// Station Metadata
// ---------------------------------------------------------------------------

/**
 * Chrome variant controls the outermost visual frame of the modal:
 * - 'classic': CSS box-shadow + corner bolts (original Phase 54 style)
 * - 'kit-frame': 9-slice border-image using riveted-paper.png asset
 *
 * Each station can opt into kit-frame independently. Phases 63-66 will
 * flip their respective stations to 'kit-frame' as they are polished.
 */
type ChromeVariant = 'classic' | 'kit-frame';

/** Display names, max-widths, and chrome variant for each factory station modal. */
const STATION_META: Record<StationId, { title: string; maxWidth: string; chromeVariant: ChromeVariant }> = {
  swap: { title: 'Swap', maxWidth: '1100px', chromeVariant: 'kit-frame' },
  carnage: { title: 'Carnage', maxWidth: '700px', chromeVariant: 'kit-frame' },
  staking: { title: 'Rewards', maxWidth: '700px', chromeVariant: 'kit-frame' },
  wallet: { title: 'Connect', maxWidth: '500px', chromeVariant: 'kit-frame' },
  docs: { title: 'Whitepaper', maxWidth: '800px', chromeVariant: 'classic' },
  settings: { title: 'Settings', maxWidth: '500px', chromeVariant: 'kit-frame' },
};

// ---------------------------------------------------------------------------
// MobileBackButton -- Phase 58 Mobile Navigation
// ---------------------------------------------------------------------------

/**
 * Left-aligned back-arrow close button for mobile viewports.
 * Visibility toggled by CSS media query in globals.css:
 * - Desktop (>=1024px): display: none (hidden)
 * - Mobile (<1024px): display: flex (visible)
 *
 * Uses a left-pointing chevron SVG (iOS convention for "go back / dismiss").
 * 48px tap target meets WCAG 2.5.8 minimum target size.
 */
function MobileBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="mobile-back-btn"
      onClick={onClick}
      aria-label="Close"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M13 4L7 10L13 16"
          stroke="#2a1f0e"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ModalShell Component
// ---------------------------------------------------------------------------

interface ModalShellProps {
  /** Display name shown in the header (e.g., "Swap Machine"). */
  title: string;
  /** Maximum width for this station's modal (e.g., '1100px'). */
  maxWidth?: string;
  /** Chrome variant: 'classic' (box-shadow + bolts) or 'kit-frame' (9-slice border-image). */
  chromeVariant?: ChromeVariant;
  /** Modal body content -- rendered inside the scrollable area. */
  children: ReactNode;
}

export function ModalShell({ title, maxWidth = '600px', chromeVariant = 'classic', children }: ModalShellProps) {
  const { state, closeModal, triggerRef } = useModal();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Track the previous station to distinguish fresh opens from station switches.
  const prevStationRef = useRef<StationId | null>(null);

  // Track whether we're currently in a closing animation to prevent double-close.
  const isClosingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Sync React state -> dialog DOM
  // -------------------------------------------------------------------------
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const { activeStation, irisOrigin } = state;

    if (activeStation !== null && !dialog.open) {
      // ---- FRESH OPEN (dialog was closed) ----
      isClosingRef.current = false;

      // Hide dialog initially so we can compute dialog-relative coordinates
      // after the browser positions it (showModal triggers margin:auto centering).
      dialog.style.clipPath = 'circle(0% at 50% 50%)';
      dialog.style.willChange = 'clip-path';
      dialog.showModal();

      // Now the dialog is positioned by the browser. Read its rect and convert
      // viewport click coordinates to dialog-relative coordinates. This is
      // critical for small modals (500px) -- a viewport x of 800px would be
      // way off-screen relative to the dialog without this conversion.
      const viewportX = irisOrigin?.x ?? window.innerWidth / 2;
      const viewportY = irisOrigin?.y ?? window.innerHeight / 2;
      const dialogRect = dialog.getBoundingClientRect();
      const relX = viewportX - dialogRect.left;
      const relY = viewportY - dialogRect.top;
      dialog.style.setProperty('--iris-x', `${relX}px`);
      dialog.style.setProperty('--iris-y', `${relY}px`);

      // Trigger the iris animation in the next frame. Removing the inline
      // clipPath and adding the animation class happen in the same style
      // recalc, so the animation starts at circle(0%) with no flash.
      requestAnimationFrame(() => {
        dialog.style.clipPath = '';
        dialog.classList.add('iris-opening');

        dialog.addEventListener(
          'animationend',
          () => {
            dialog.classList.remove('iris-opening');
            dialog.style.willChange = '';
          },
          { once: true },
        );
      });
    } else if (activeStation !== null && dialog.open) {
      // ---- STATION SWITCH (dialog already open, different station) ----
      // The content swap is handled by ModalRoot re-rendering with new station
      // props. We don't close/reopen the dialog. Apply crossfade classes.
      const prevStation = prevStationRef.current;
      if (prevStation !== null && prevStation !== activeStation) {
        // Content crossfade: the chrome div gets the exit class, then enter class.
        const chrome = dialog.querySelector('.modal-chrome');
        if (chrome) {
          chrome.classList.add('modal-content-exit');
          chrome.addEventListener(
            'animationend',
            () => {
              chrome.classList.remove('modal-content-exit');
              chrome.classList.add('modal-content-enter');
              chrome.addEventListener(
                'animationend',
                () => {
                  chrome.classList.remove('modal-content-enter');
                },
                { once: true },
              );
            },
            { once: true },
          );
        }
      }
    } else if (activeStation === null && dialog.open && !isClosingRef.current) {
      // ---- CLOSE REQUESTED (state cleared, dialog still open) ----
      handleAnimatedClose();
    }

    prevStationRef.current = activeStation;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeStation, state.irisOrigin]);

  // -------------------------------------------------------------------------
  // Close Animation Sequence (RESEARCH.md Pattern 3)
  // -------------------------------------------------------------------------
  const handleAnimatedClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open || isClosingRef.current) return;

    isClosingRef.current = true;
    dialog.classList.add('closing');

    dialog.addEventListener(
      'animationend',
      () => {
        dialog.classList.remove('closing');
        dialog.close();
        isClosingRef.current = false;

        // Restore focus to the element that triggered the modal open.
        triggerRef.current?.focus();
      },
      { once: true },
    );
  }, [triggerRef]);

  // -------------------------------------------------------------------------
  // Native Escape Handling (RESEARCH.md Pitfall 3)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      // Prevent the browser's instant close (which would skip the animation).
      e.preventDefault();
      // Trigger the animated close sequence via the provider.
      closeModal();
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [closeModal]);

  // -------------------------------------------------------------------------
  // Backdrop Click Detection (RESEARCH.md Pattern 4)
  // -------------------------------------------------------------------------
  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      // When clicking the backdrop, the event target IS the dialog element
      // itself (not a child). This distinguishes backdrop clicks from content.
      if (e.target === e.currentTarget) {
        closeModal();
      }
    },
    [closeModal],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <dialog
      ref={dialogRef}
      className="modal-shell"
      style={{ maxWidth }}
      onClick={handleDialogClick}
    >
      {/* Kit-frame: floating close sits OUTSIDE the chrome div so it can
          be positioned beyond the 30px border-image frame edge. */}
      {chromeVariant === 'kit-frame' && (
        <div className="modal-floating-close">
          <MobileBackButton onClick={closeModal} />
          <ModalCloseButton onClick={closeModal} />
        </div>
      )}

      <div className={chromeVariant === 'kit-frame' ? 'modal-chrome modal-chrome-kit' : 'modal-chrome'}>
        {/* Decorative corner bolts -- hidden for kit-frame variant (the 9-slice
            border-image provides its own visual treatment with riveted edges) */}
        {chromeVariant === 'classic' && (
          <>
            <div className="modal-bolt" style={{ top: '6px', left: '6px' }} />
            <div className="modal-bolt" style={{ top: '6px', right: '6px' }} />
            <div className="modal-bolt" style={{ bottom: '6px', left: '6px' }} />
            <div className="modal-bolt" style={{ bottom: '6px', right: '6px' }} />
          </>
        )}

        {/* Classic stations keep the full header with title + divider. */}
        {chromeVariant === 'classic' && (
          <header className="modal-header">
            <MobileBackButton onClick={closeModal} />
            <h2>{title}</h2>
            <ModalCloseButton onClick={closeModal} />
          </header>
        )}

        {/* Scrollable body */}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// ModalRoot -- Top-Level Singleton Renderer
// ---------------------------------------------------------------------------

/**
 * ModalRoot renders the singleton ModalShell with the correct title and
 * max-width for whichever station is currently active. Place this once
 * in the component tree (inside ModalProvider).
 *
 * ModalContent renders the active station's component tree via React.lazy.
 * Only one station mounts at a time (no simultaneous hook subscriptions).
 */
export function ModalRoot() {
  const { state } = useModal();

  // When no station is active, render ModalShell with defaults. The dialog
  // element always exists in the DOM -- it just isn't visible (not open).
  const station = state.activeStation;
  const meta = station ? STATION_META[station] : null;

  return (
    <ModalShell
      title={meta?.title ?? ''}
      maxWidth={meta?.maxWidth ?? '600px'}
      chromeVariant={meta?.chromeVariant ?? 'classic'}
    >
      {station && <ModalContent station={station} />}
    </ModalShell>
  );
}
