"use client";

/**
 * RouteBadge -- "Best" badge shown on the highest-ranked route
 *
 * Props-only component (no hooks). Purely presentational.
 * Renders a small pill badge indicating this route has the best output.
 */

export function RouteBadge() {
  return (
    <span className="text-xs bg-factory-accent text-factory-bg px-2 py-0.5 rounded-full font-medium">
      Best
    </span>
  );
}
