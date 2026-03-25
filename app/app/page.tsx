'use client';

/**
 * Root page -- Full-viewport interactive factory scene compositor.
 *
 * During the curve phase (NEXT_PUBLIC_CURVE_PHASE=true), the root /
 * redirects to /launch. The launch page IS the entire site during
 * this phase. When admin removes the env var and redeploys, the
 * factory scene becomes the root again.
 *
 * Replaces the Phase 54 dashboard layout with the factory scene as the
 * primary navigation surface. Each factory machine (station) is a clickable
 * interactive object that opens a modal panel.
 *
 * Architecture:
 * - FactoryBackground renders a unified scene container (background + overlays
 *   in the same coordinate space, sized to cover the viewport at 1.81:1 ratio)
 * - 6 SceneStation children render overlay images positioned by percentage
 * - Below 1024px: steampunk-themed mobile navigation (Phase 58) replaces the
 *   scene with a vertical station list
 *
 * The scene IS the navigation -- no header, no nav bar, no dashboard grid.
 * Wallet connection, swap, carnage, staking, docs, and settings are all
 * accessible via their respective station objects on the factory floor.
 */

import { redirect } from 'next/navigation';
import { MobileNav } from '@/components/mobile/MobileNav';
import FactoryBackground from '@/components/scene/FactoryBackground';
import FactoryOverlay from '@/components/scene/FactoryOverlay';
import { SceneStation } from '@/components/scene/SceneStation';
import { STATIONS } from '@/components/scene/scene-data';

export default function Home() {
  // During curve phase, the launch page IS the entire site.
  // NEXT_PUBLIC_CURVE_PHASE is inlined at build time by Next.js.
  // When admin wants to switch back: remove env var on Railway, redeploy.
  if (process.env.NEXT_PUBLIC_CURVE_PHASE?.toLowerCase() === 'true') {
    redirect('/launch');
  }

  return (
    <>
      {/* Desktop scene: visible at lg (1024px) and above */}
      <main className="hidden lg:block">
        <FactoryBackground>
          {/* Decorative title banner -- not interactive, just positioned text art */}
          <FactoryOverlay overlayId="banner" />

          {/* 6 stations rendered in tab-priority order (wallet -> settings).
              Positioned by percentage inside FactoryBackground's unified scene
              container -- same coordinate space as the background image. */}
          {STATIONS.map((station) => (
            <SceneStation key={station.stationId} station={station} />
          ))}
        </FactoryBackground>
      </main>

      {/* Mobile navigation: visible below lg (1024px) -- Phase 58 */}
      <main className="lg:hidden">
        <MobileNav />
      </main>
    </>
  );
}
