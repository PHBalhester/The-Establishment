'use client';

/**
 * DocsModal -- Docs button + iframe modal for Nextra documentation.
 *
 * Per CONTEXT.md: "Only modal on this page: docs link (iframe to Nextra)".
 *
 * Desktop: The trigger is an image-based button (LaunchWhitepaperButton.png)
 * rendered in page.tsx as a full-canvas overlay. This component exposes
 * `useDocsModal()` so the page can open the modal from that button.
 *
 * Mobile: Renders a fallback CSS text button via <DocsModal />.
 */

import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from 'react';

/** Documentation URL -- uses env var set on Railway, falls back to same-origin /docs */
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || '/docs';

/* ------------------------------------------------------------------ */
/*  Shared context so the desktop image-button can open the modal     */
/* ------------------------------------------------------------------ */

interface DocsModalContextValue {
  open: () => void;
}

const DocsModalContext = createContext<DocsModalContextValue | null>(null);

export function useDocsModal() {
  const ctx = useContext(DocsModalContext);
  if (!ctx) throw new Error('useDocsModal must be inside <DocsModalProvider>');
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Provider -- wraps the launch page, renders the modal when open    */
/* ------------------------------------------------------------------ */

export function DocsModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setIsOpen(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  return (
    <DocsModalContext.Provider value={{ open: () => setIsOpen(true) }}>
      {children}

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-[95vw] sm:max-w-4xl h-[90vh] sm:h-[80vh] mx-2 sm:mx-4 bg-factory-surface border border-amber-800/40 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-800/30 bg-black/30">
              <h2 className="text-sm font-semibold text-amber-200">
                Documentation
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center w-10 h-10 min-h-[44px] min-w-[44px] text-amber-400/60 hover:text-amber-200 transition-colors"
                aria-label="Close documentation"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Iframe */}
            <iframe
              src={DOCS_URL}
              title="Dr. Fraudsworth Documentation"
              className="w-full h-[calc(100%-48px)] border-0"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </div>
        </div>
      )}
    </DocsModalContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile fallback button (CSS text button, used below 1024px)       */
/* ------------------------------------------------------------------ */

interface DocsButtonProps {
  className?: string;
}

export function DocsButton({ className }: DocsButtonProps) {
  const { open } = useDocsModal();

  return (
    <div className={className}>
      <button
        onClick={open}
        className="flex items-center gap-2 text-xs font-medium text-amber-300/80 bg-black/50 backdrop-blur-sm border border-amber-800/40 rounded-lg px-4 py-3 min-h-[48px] hover:border-amber-600/60 hover:text-amber-200 transition-colors"
        aria-label="Open documentation"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 19.5v-15A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 010-5H20" />
        </svg>
        Docs
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Legacy export -- keeps mobile usage simple                        */
/* ------------------------------------------------------------------ */

export function DocsModal({ className }: DocsButtonProps) {
  return <DocsButton className={className} />;
}
