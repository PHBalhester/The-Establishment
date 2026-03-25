'use client';

/**
 * ToastProvider -- Minimal zero-dependency toast notification system.
 *
 * Provides swap success/error feedback via a popover-rendered toast at the
 * top-center of the viewport. Only one toast is visible at a time (no
 * queue/stacking) per D10 simplicity principle.
 *
 * Architecture mirrors ModalProvider: context + hook + container component.
 *
 * Why popover: The modal is a native <dialog> in the browser's top layer.
 * Its ::backdrop applies backdrop-filter: blur() which blurs everything in
 * the regular DOM stacking context -- including portal-rendered elements at
 * document.body. The Popover API (popover="manual" + showPopover()) puts the
 * toast container in the top layer alongside the dialog, ABOVE the backdrop.
 * This means toasts render crisp and unblurred regardless of modal state.
 *
 * Toast types:
 * - success: Green left-accent border, optional Solscan link (8s auto-dismiss)
 * - error: Red left-accent border (5s auto-dismiss)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single toast notification. */
export interface Toast {
  /** Unique identifier for keying and dedup. */
  id: string;
  /** Visual treatment: green accent (success) or red accent (error). */
  type: 'success' | 'error';
  /** Human-readable message. */
  message: string;
  /** Optional link (e.g., Solscan transaction URL). */
  link?: { label: string; href: string };
}

/** Public API exposed by the toast context. */
interface ToastContextValue {
  /** Currently displayed toast (null when none visible). */
  toast: Toast | null;
  /** Whether the current toast is in its exit animation. */
  exiting: boolean;
  /** Show a toast notification. Replaces any existing toast. */
  showToast: (
    type: Toast['type'],
    message: string,
    link?: Toast['link'],
  ) => void;
  /** Trigger the exit animation and then clear the toast. */
  dismissToast: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useToast -- Access the toast notification system.
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast('success', 'Swap confirmed!', { label: 'View on Solscan', href: '...' });
 *   showToast('error', 'Transaction failed: insufficient SOL');
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error(
      'useToast must be used within a ToastProvider. ' +
        'Wrap your component tree with <ToastProvider> in providers.tsx.',
    );
  }
  return context;
}

// ---------------------------------------------------------------------------
// Auto-dismiss durations
// ---------------------------------------------------------------------------

/** Success toasts stay longer so users can click the Solscan link. */
const SUCCESS_DISMISS_MS = 8000;
/** Error toasts auto-dismiss faster. */
const ERROR_DISMISS_MS = 5000;
/** Exit animation duration (must match CSS toast-exit keyframe). */
const EXIT_ANIMATION_MS = 300;

// ---------------------------------------------------------------------------
// ToastProvider Component
// ---------------------------------------------------------------------------

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [exiting, setExiting] = useState(false);

  // Refs for cleanup: auto-dismiss timer and exit animation timer.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Clear all pending timers. */
  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  /** Trigger exit animation then clear toast state. */
  const dismissToast = useCallback(() => {
    clearTimers();
    setExiting(true);

    exitTimerRef.current = setTimeout(() => {
      setToast(null);
      setExiting(false);
      exitTimerRef.current = null;
    }, EXIT_ANIMATION_MS);
  }, [clearTimers]);

  /** Show a new toast, replacing any existing one. */
  const showToast = useCallback(
    (type: Toast['type'], message: string, link?: Toast['link']) => {
      clearTimers();
      setExiting(false);

      const newToast: Toast = {
        id: String(Date.now()),
        type,
        message,
        link,
      };

      setToast(newToast);

      // Start auto-dismiss timer.
      const duration = type === 'success' ? SUCCESS_DISMISS_MS : ERROR_DISMISS_MS;
      dismissTimerRef.current = setTimeout(() => {
        dismissToast();
      }, duration);
    },
    [clearTimers, dismissToast],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const value: ToastContextValue = {
    toast,
    exiting,
    showToast,
    dismissToast,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// ToastContainer -- Popover-Rendered Toast Display
// ---------------------------------------------------------------------------

/**
 * ToastContainer renders the current toast notification via a popover element
 * portaled to document.body. The popover="manual" attribute + showPopover()
 * puts the toast in the browser's top layer -- above the dialog's ::backdrop
 * blur -- so toasts always render crisp and visible.
 *
 * The popover container is always mounted (so we can call showPopover/hidePopover),
 * but the toast card content only renders when a toast is active.
 *
 * Place this component as a sibling of ModalRoot in providers.tsx.
 */
export function ToastContainer() {
  const { toast, exiting, dismissToast } = useToast();

  // SSR guard: document is not available during server-side rendering.
  const [mounted, setMounted] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Enter/exit the top layer via Popover API.
  //
  // IMPORTANT: When toast is truthy we always hide+show (not just "show if
  // not already open"). This re-inserts the popover at the TOP of the
  // browser's top layer stack. Without this, a toast that was already
  // showing when a <dialog>.showModal() fires would remain BELOW the
  // dialog's ::backdrop -- and the backdrop-filter: blur(6px) would blur
  // the toast. The hide+show cycle costs one synchronous layout but
  // guarantees the popover is always the topmost top-layer entry.
  //
  // Additionally, a MutationObserver watches the dialog's `open` attribute
  // to re-stack the popover whenever the dialog opens. This replaces the
  // previous useModal() dependency which coupled React state to the popover
  // lifecycle.
  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    if (toast) {
      if (el.matches(':popover-open')) {
        el.hidePopover();
      }
      el.showPopover();
    } else {
      if (el.matches(':popover-open')) {
        el.hidePopover();
      }
      return; // No toast visible → no need to watch the dialog.
    }

    // Watch the dialog's `open` attribute to detect when it enters the top
    // layer (via showModal or show). When the dialog opens, its ::backdrop
    // may be stacked above our popover. Re-inserting the popover (hide+show)
    // puts it back on top.
    //
    // This uses a MutationObserver on the DOM element instead of React modal
    // state (useModal) to decouple the popover lifecycle from React state.
    // The observer reacts to the final DOM state regardless of whether the
    // dialog was opened by ModalShell or anything else.
    const dialog = document.querySelector('dialog.modal-shell');
    if (!dialog) return;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.attributeName === 'open' &&
          (m.target as HTMLDialogElement).open &&
          el.matches(':popover-open')
        ) {
          el.hidePopover();
          el.showPopover();
        }
      }
    });

    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });

    return () => observer.disconnect();
  }, [toast]);

  if (!mounted) return null;

  const popoverElement = (
    <div
      ref={popoverRef}
      popover="manual"
      className="toast-popover"
    >
      {toast && (
        <div
          className={[
            'toast-card',
            exiting ? 'toast-exiting' : '',
            toast.type === 'success' ? 'toast-success' : 'toast-error',
          ]
            .filter(Boolean)
            .join(' ')}
          role="alert"
          aria-live="polite"
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            {/* Icon */}
            <span
              style={{
                flexShrink: 0,
                fontSize: '1.125rem',
                lineHeight: 1,
                marginTop: '1px',
              }}
              aria-hidden="true"
            >
              {toast.type === 'success' ? '\u2713' : '\u2717'}
            </span>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0 }}>{toast.message}</p>
              {toast.link && (
                <a
                  href={toast.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: '0.375rem',
                    color: 'var(--color-factory-accent)',
                    textDecoration: 'underline',
                    textUnderlineOffset: '2px',
                    fontSize: '0.8125rem',
                  }}
                >
                  {toast.link.label}
                </a>
              )}
            </div>

            {/* Dismiss button */}
            <button
              onClick={dismissToast}
              aria-label="Dismiss notification"
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                color: 'var(--color-factory-text-muted)',
                cursor: 'pointer',
                padding: '2px',
                fontSize: '1rem',
                lineHeight: 1,
              }}
            >
              {'\u2715'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(popoverElement, document.body);
}
