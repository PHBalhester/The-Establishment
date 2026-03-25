"use client";

// Next.js App Router global error boundary.
// Catches unhandled errors in client components and reports them to Sentry.
// Uses our zero-dependency reporter (lib/sentry.ts) because all @sentry/*
// npm packages conflict with Turbopack's SSR runtime.
import { captureException } from "@/lib/sentry";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div
          style={{
            padding: "2rem",
            fontFamily: "monospace",
            backgroundColor: "#0a0a0a",
            color: "#e5e5e5",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
            Something went wrong
          </h2>
          <p style={{ color: "#a3a3a3", marginBottom: "1.5rem" }}>
            An unexpected error occurred. The error has been reported.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1.5rem",
              cursor: "pointer",
              backgroundColor: "#1a1a1a",
              color: "#e5e5e5",
              border: "1px solid #333",
              borderRadius: "0.375rem",
              fontFamily: "monospace",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
