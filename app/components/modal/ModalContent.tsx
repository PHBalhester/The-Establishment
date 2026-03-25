'use client';

/**
 * ModalContent -- Station switch component with lazy loading.
 *
 * Renders the correct station panel based on the active station ID.
 * Each station is loaded lazily via React.lazy() so only the active
 * station's code is fetched -- the other 5 stations contribute zero
 * bytes to the initial bundle.
 *
 * The outer `.station-content` wrapper provides a dark background
 * (factory-bg) inside the light brass modal chrome. This "dark inner
 * card" approach preserves all existing component styles which expect
 * a dark background, while the steampunk chrome frames it like a
 * brass-rimmed window into the factory machinery.
 *
 * Only one station component mounts at a time (React short-circuit
 * evaluation). This prevents simultaneous hook subscriptions across
 * all 6 stations -- a critical performance consideration since each
 * station may subscribe to WebSocket feeds and polling intervals.
 */

import { lazy, Suspense } from 'react';
import type { StationId } from '@/components/modal/ModalProvider';

// ---------------------------------------------------------------------------
// Lazy Station Imports
// ---------------------------------------------------------------------------

/**
 * Lazy-load each station panel. These modules are created in Plans 02-04.
 * Until those plans execute, importing these will cause chunk-load errors
 * at runtime (but TypeScript compiles fine with the lazy wrapper).
 */
const SwapStation = lazy(() => import('@/components/station/SwapStation'));
const CarnageStation = lazy(() => import('@/components/station/CarnageStation'));
const StakingStation = lazy(() => import('@/components/station/StakingStation'));
const WalletStation = lazy(() => import('@/components/station/WalletStation'));
const DocsStation = lazy(() => import('@/components/station/DocsStation'));
const SettingsStation = lazy(() => import('@/components/station/SettingsStation'));

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

/** Pulsing placeholder shown while a station module is being fetched. */
function StationSkeleton() {
  return <div className="animate-pulse h-32 bg-factory-surface rounded" />;
}

// ---------------------------------------------------------------------------
// ModalContent Component
// ---------------------------------------------------------------------------

interface ModalContentProps {
  /** Which station to render. */
  station: StationId;
}

/**
 * Renders the active station inside a dark wrapper with lazy loading.
 *
 * Only the matching station's component tree mounts -- the others are
 * short-circuited by `&&` and never evaluated. This means only one set
 * of hooks (useSwap, useStaking, useCarnageData, etc.) is active at
 * any given time.
 */
export function ModalContent({ station }: ModalContentProps) {
  return (
    <div className="station-content">
      <Suspense fallback={<StationSkeleton />}>
        {station === 'swap' && <SwapStation />}
        {station === 'carnage' && <CarnageStation />}
        {station === 'staking' && <StakingStation />}
        {station === 'wallet' && <WalletStation />}
        {station === 'docs' && <DocsStation />}
        {station === 'settings' && <SettingsStation />}
      </Suspense>
    </div>
  );
}
