"use client";

/**
 * RouteSelector -- Collapsible route list with auto-selection
 *
 * Shows the best route by default. When multiple routes exist, provides
 * an expand/collapse button to view alternatives. Includes a circular
 * countdown timer showing seconds until the next quote refresh.
 *
 * Key behaviors:
 * - Auto-selects the best route on mount and when routes change
 * - Flicker prevention: keeps current selection if it's within 0.1%
 *   (10 bps) of the new best route's output
 * - Only auto-switches when current selection disappears or a different
 *   route beats it by > 0.1%
 *
 * Uses RouteCard for individual route rendering.
 */

import { useState, useEffect, useRef } from "react";
import type { Route } from "@/lib/swap/route-types";
import { RouteCard } from "./RouteCard";

// =============================================================================
// Props
// =============================================================================

interface RouteSelectorProps {
  /** Ranked routes (best first, i.e. highest outputAmount) */
  routes: Route[];
  /** Currently selected route (null if none selected yet) */
  selectedRoute: Route | null;
  /** Callback when user selects a route */
  onSelectRoute: (route: Route) => void;
  /** Whether routes are currently being computed */
  loading: boolean;
  /** Decimal places for output token display (6 for tokens, 9 for SOL) */
  outputDecimals: number;
  /** Seconds until next quote refresh (0-30) */
  refreshCountdown: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Anti-flicker threshold in basis points.
 * If the currently selected route's output is within this margin of
 * the new best route, we do NOT auto-switch the selection.
 * From RESEARCH.md: 10 bps = 0.1%.
 */
const ANTI_FLICKER_BPS = 10;

/**
 * Maximum countdown value for the circular timer.
 * The SVG circle animation assumes a 30-second refresh cycle.
 */
const MAX_COUNTDOWN = 30;

// =============================================================================
// CountdownCircle sub-component
// =============================================================================

/**
 * Small circular SVG countdown timer (16x16px).
 * Shows the remaining seconds in the center and animates a stroke
 * arc clockwise from full to empty.
 */
function CountdownCircle({ seconds }: { seconds: number }) {
  // Circle geometry: radius=6, circumference=2*pi*6 ~= 37.7
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  // Progress fraction (1 = full, 0 = empty)
  const progress = Math.max(0, Math.min(seconds / MAX_COUNTDOWN, 1));
  const dashOffset = circumference * (1 - progress);

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="flex-shrink-0"
    >
      {/* Background circle (track) */}
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-factory-border-subtle"
      />
      {/* Foreground circle (progress) -- rotated -90deg so it starts at top */}
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        className="text-factory-text-muted transition-[stroke-dashoffset] duration-1000 ease-linear"
        style={{ transform: "rotate(-90deg)", transformOrigin: "8px 8px" }}
      />
      {/* Center text */}
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-factory-text-muted"
        fontSize="7"
        fontFamily="monospace"
      >
        {seconds}
      </text>
    </svg>
  );
}

// =============================================================================
// Component
// =============================================================================

export function RouteSelector({
  routes,
  selectedRoute,
  onSelectRoute,
  loading,
  outputDecimals,
  refreshCountdown,
}: RouteSelectorProps) {
  const [expanded, setExpanded] = useState(false);

  // Track the previous routes reference to detect changes
  const prevRoutesRef = useRef<Route[]>(routes);

  // ---------------------------------------------------------------------------
  // Auto-selection with flicker prevention
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (routes.length === 0) return;

    const bestRoute = routes[0];

    // Case 1: No route selected yet -- select the best
    if (!selectedRoute) {
      onSelectRoute(bestRoute);
      return;
    }

    // Case 2: Check if current selection still exists in new routes
    const currentInNewRoutes = routes.find(
      (r) => r.label === selectedRoute.label,
    );

    if (!currentInNewRoutes) {
      // Current selection disappeared -- select the best
      onSelectRoute(bestRoute);
      return;
    }

    // Case 3: Current selection exists. Check if a different route
    // beats it by more than the anti-flicker threshold (0.1%).
    if (bestRoute.label !== selectedRoute.label) {
      const currentOutput = currentInNewRoutes.outputAmount;
      const bestOutput = bestRoute.outputAmount;

      // Only auto-switch if the best route beats current by > 10 bps
      if (currentOutput > 0) {
        const improvementBps =
          ((bestOutput - currentOutput) / currentOutput) * 10_000;
        if (improvementBps > ANTI_FLICKER_BPS) {
          onSelectRoute(bestRoute);
        }
        // Otherwise: keep current selection (within flicker threshold)
      }
    }
    // If bestRoute.label === selectedRoute.label, no change needed
  }, [routes, selectedRoute, onSelectRoute]);

  // Update prev routes ref
  useEffect(() => {
    prevRoutesRef.current = routes;
  }, [routes]);

  // ---------------------------------------------------------------------------
  // Render: empty state
  // ---------------------------------------------------------------------------
  if (routes.length === 0 && !loading) {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render: loading state
  // ---------------------------------------------------------------------------
  if (loading && routes.length === 0) {
    return (
      <div className="mt-3">
        <div className="text-sm text-factory-text-muted animate-pulse px-1">
          Finding best route...
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: single route (no expand/collapse needed)
  // ---------------------------------------------------------------------------
  if (routes.length === 1) {
    return (
      <div className="mt-3 space-y-2">
        <RouteCard
          route={routes[0]}
          isBest={true}
          isSelected={selectedRoute?.label === routes[0].label}
          onSelect={() => onSelectRoute(routes[0])}
          outputDecimals={outputDecimals}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: multiple routes with expand/collapse
  // ---------------------------------------------------------------------------
  return (
    <div className="mt-3 space-y-2">
      {/* Best route (always visible) */}
      <RouteCard
        route={routes[0]}
        isBest={true}
        isSelected={selectedRoute?.label === routes[0].label}
        onSelect={() => onSelectRoute(routes[0])}
        outputDecimals={outputDecimals}
      />

      {/* Expand/collapse button with countdown */}
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-factory-text-secondary hover:text-factory-text hover:underline transition-colors"
        >
          {expanded
            ? "Hide routes"
            : `See all routes (${routes.length})`}
        </button>
        <CountdownCircle seconds={refreshCountdown} />
      </div>

      {/* Expanded: remaining routes */}
      {expanded &&
        routes.slice(1).map((route, i) => (
          <RouteCard
            key={route.label}
            route={route}
            isBest={false}
            isSelected={selectedRoute?.label === route.label}
            onSelect={() => onSelectRoute(route)}
            outputDecimals={outputDecimals}
          />
        ))}
    </div>
  );
}
