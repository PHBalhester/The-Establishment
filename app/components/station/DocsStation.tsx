'use client';

/**
 * DocsStation -- Iframe-based documentation viewer for the Docs modal station.
 *
 * Embeds the Nextra documentation site (docs-site/) inside a sandboxed iframe.
 * Uses NEXT_PUBLIC_DOCS_URL env var for production, falls back to localhost:3001
 * for development.
 *
 * Features:
 * - Loading state with skeleton while iframe loads
 * - 10-second timeout fallback if iframe never fires onLoad
 * - Direct link fallback below the iframe
 * - Minimal sandbox permissions (scripts, same-origin, popups)
 *
 * Default export required for React.lazy in ModalContent.tsx.
 */

import { useState, useEffect, useRef } from 'react';

/** Docs site URL -- env var for production, localhost for dev */
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || 'http://localhost:3001';

/** Timeout before showing iframe regardless of load state (ms) */
const LOAD_TIMEOUT_MS = 10_000;

export default function DocsStation() {
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  // 10-second timeout: if iframe never fires onLoad, show it anyway
  // (may display a connection error page, which is better than infinite loading)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loadedRef.current) {
        loadedRef.current = true;
        setLoaded(true);
      }
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const handleLoad = () => {
    loadedRef.current = true;
    setLoaded(true);
  };

  return (
    <div className="space-y-2">
      <div className="relative" style={{ minHeight: '300px' }}>
        {/* Loading state while iframe loads */}
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-pulse h-4 w-32 bg-factory-surface rounded mb-2 mx-auto" />
              <p className="text-xs text-factory-text-muted">Loading documentation...</p>
            </div>
          </div>
        )}

        <iframe
          src={DOCS_URL}
          title="Dr. Fraudsworth Documentation"
          className="w-full border-0 rounded"
          style={{ height: '60vh', minHeight: '280px' }}
          sandbox="allow-scripts allow-same-origin allow-popups"
          onLoad={handleLoad}
        />
      </div>

      {/* Direct link fallback */}
      <p className="text-xs text-factory-text-muted text-center">
        Documentation site:{' '}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-factory-text"
        >
          {DOCS_URL}
        </a>
      </p>
    </div>
  );
}
