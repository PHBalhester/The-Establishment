'use client';

/**
 * /launch route -- Bonding Curve Launch Page
 *
 * Full-viewport immersive page for the bonding curve launch phase.
 * Uses the existing factory scene background with a blur overlay,
 * and CurveOverlay.png as a centered brass machine with two pressure
 * gauges (CRIME left, FRAUD right) and a dark center panel.
 *
 * The BuySellPanel combines curve info + trading in one panel with
 * CRIME/FRAUD tabs and Info/Buy/Sell sub-tabs.
 *
 * This is the ONLY page during the curve phase -- no header, no nav.
 *
 * Mobile: Elements stack vertically below 1024px.
 */

import Link from 'next/link';
import Image from 'next/image';
import { useCurveState } from '@/hooks/useCurveState';
import { useCurrentSlot } from '@/hooks/useCurrentSlot';
import { useSolPrice } from '@/hooks/useSolPrice';
import { TARGET_SOL } from '@/lib/curve/curve-constants';
import LaunchScene from '@/components/launch/LaunchScene';
import { PressureGauge } from '@/components/launch/PressureGauge';
import { CountdownTimer } from '@/components/launch/CountdownTimer';
import { LaunchWalletButton } from '@/components/launch/LaunchWalletButton';
import {
  DocsModalProvider,
  DocsButton,
} from '@/components/launch/DocsModal';
import { WhitepaperButton } from '@/components/launch/WhitepaperButton';
import { BuySellPanel } from '@/components/launch/BuySellPanel';
import { StateMachineWrapper } from '@/components/launch/StateMachineWrapper';
import LoadingSpinner from '@/components/scene/LoadingSpinner';

/** Whether the site has switched to live mode (post-graduation) */
const isLiveMode = process.env.NEXT_PUBLIC_SITE_MODE === 'live';

export default function LaunchPage() {
  const { crime, fraud, loading, error, refresh: refreshCurves } = useCurveState();
  const { currentSlot } = useCurrentSlot();
  const { solPrice } = useSolPrice();

  // Hooks must be called before any early returns (React rules of hooks).

  // Loading state
  if (loading && !crime && !fraud) {
    return (
      <div className="w-full h-screen bg-factory-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-factory-text-muted text-sm font-mono">
            Loading curve data...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !crime && !fraud) {
    return (
      <div className="w-full h-screen bg-factory-bg flex items-center justify-center">
        <div className="text-center max-w-md mx-4">
          <p className="text-factory-text text-lg mb-2 font-heading">
            Failed to load curve data
          </p>
          <p className="text-factory-text-muted text-sm mb-4 font-mono">
            {error}
          </p>
          <p className="text-factory-text-muted text-xs">
            Refresh the page to retry. If the problem persists, the curves may
            not be initialized yet.
          </p>
        </div>
      </div>
    );
  }

  const deadlineSlot = crime?.deadlineSlot ?? fraud?.deadlineSlot ?? null;

  // DEBUG: remove after diagnosing EXPIRED issue
  console.log('[LaunchPage]', {
    crimeDeadline: crime?.deadlineSlot,
    fraudDeadline: fraud?.deadlineSlot,
    crimeStatus: crime?.status,
    fraudStatus: fraud?.status,
    crimeStartSlot: crime?.startSlot,
    deadlineSlot,
  });

  // Needle rotation: 270-degree arc from 0% (as drawn) to 100% (clockwise sweep)
  const NEEDLE_SWEEP = 270;
  const crimeNetSol = (crime?.solRaised ?? 0n) - (crime?.solReturned ?? 0n);
  const fraudNetSol = (fraud?.solRaised ?? 0n) - (fraud?.solReturned ?? 0n);
  const crimePct = TARGET_SOL > 0n
    ? Math.min(100, Number((crimeNetSol * 100n) / TARGET_SOL))
    : 0;
  const fraudPct = TARGET_SOL > 0n
    ? Math.min(100, Number((fraudNetSol * 100n) / TARGET_SOL))
    : 0;
  const crimeNeedleDeg = (crimePct / 100) * NEEDLE_SWEEP;
  const fraudNeedleDeg = (fraudPct / 100) * NEEDLE_SWEEP;

  return (
    <DocsModalProvider>
    {/* Live-mode graduated banner -- shown when admin switches NEXT_PUBLIC_SITE_MODE to 'live' */}
    {isLiveMode && (
      <div className="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-amber-900/90 via-emerald-900/90 to-amber-900/90 border-b border-amber-500/40 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full bg-emerald-400 shrink-0"
              style={{ animation: 'graduated-pulse 2s ease-in-out infinite' }}
            />
            <p className="text-amber-100 text-sm font-mono tracking-wide">
              Curves graduated &mdash; trading is live!
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 px-4 py-1.5 bg-amber-700/60 hover:bg-amber-600/70 border border-amber-500/50 rounded text-amber-100 text-sm font-mono tracking-wider transition-colors"
          >
            Enter The Factory
          </Link>
        </div>
        <style>{`
          @keyframes graduated-pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    )}
    <StateMachineWrapper crime={crime} fraud={fraud}>
      {/* ---- Desktop layout (>=1024px): Full brass machine scene ---- */}
      <div className="hidden lg:block">
        <LaunchScene>
          {/* Invisible gauge overlays for accessibility */}
          <PressureGauge
            solRaised={(crime?.solRaised ?? 0n) - (crime?.solReturned ?? 0n)}
            label="CRIME"
            className="absolute left-[5%] top-[10%] w-[28%] h-[75%] pointer-events-none"
          />
          <PressureGauge
            solRaised={(fraud?.solRaised ?? 0n) - (fraud?.solReturned ?? 0n)}
            label="FRAUD"
            className="absolute right-[5%] top-[10%] w-[28%] h-[75%] pointer-events-none"
          />

          {/* Crime needle — full-canvas arrow rotated around gauge hub */}
          <div
            className="absolute inset-0 pointer-events-none select-none z-10"
            style={{
              transformOrigin: '25.9% 50.1%',
              transform: `rotate(${crimeNeedleDeg}deg)`,
              transition: 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <Image
              src="/scene/launch/CrimeArrow.png"
              alt=""
              fill
              sizes="min(100vw, calc(100vh * 1.78))"
              className="object-contain"
              aria-hidden="true"
            />
          </div>

          {/* Fraud needle — full-canvas arrow rotated around gauge hub */}
          <div
            className="absolute inset-0 pointer-events-none select-none z-10"
            style={{
              transformOrigin: '74.1% 50.1%',
              transform: `rotate(${fraudNeedleDeg}deg)`,
              transition: 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <Image
              src="/scene/launch/FraudArrow.png"
              alt=""
              fill
              sizes="min(100vw, calc(100vh * 1.78))"
              className="object-contain"
              aria-hidden="true"
            />
          </div>

          {/* CRIME / FRAUD text labels overlay */}
          <Image
            src="/scene/launch/CurveOverlay1.png"
            alt=""
            fill
            sizes="min(100vw, calc(100vh * 1.78))"
            className="object-contain pointer-events-none select-none z-10"
            aria-hidden="true"
          />

          {/* Center panel -- inside the dark riveted area.
              Percentage-based positioning keeps the panel anchored to the
              glass area of the overlay at every viewport size. The panel
              content uses w-full + overflow-y-auto to fill and scroll
              within this container naturally (no scale() hack needed). */}
          <div
            className="absolute left-[40.5%] right-[40.5%] top-[31.5%] bottom-[28.5%] z-20 flex flex-col items-center justify-start overflow-hidden"
          >
            {/* Countdown Timer */}
            <CountdownTimer
              deadlineSlot={deadlineSlot && deadlineSlot > 0 ? deadlineSlot : null}
              className="shrink-0"
            />

            {/* Buy/Sell Panel (includes Info tab with stats) --
                flex-1 + min-h-0 lets it fill remaining vertical space
                while allowing internal overflow-y-auto to scroll. */}
            <BuySellPanel
              className="flex-1 min-h-0 w-full"
              crime={crime}
              fraud={fraud}
              solPrice={solPrice}
              onTxConfirmed={refreshCurves}
            />
          </div>

          {/* "THE FACTORY" nameplate overlay */}
          <Image
            src="/scene/launch/LaunchNamePlate.png"
            alt="The Factory"
            fill
            sizes="min(100vw, calc(100vh * 1.78))"
            className="object-contain pointer-events-none select-none z-[15]"
          />

          {/* Whitepaper image-button overlay */}
          <WhitepaperButton />
        </LaunchScene>
      </div>

      {/* ---- Mobile layout (<1024px): Stacked vertical layout ---- */}
      <div className="lg:hidden min-h-screen bg-factory-bg">
        <div className="fixed inset-0 z-0">
          <div
            className="w-full h-full bg-cover bg-center"
            style={{ backgroundImage: `url(/scene/background/factory-bg-1920.webp)` }}
          />
          <div className="absolute inset-0 backdrop-blur-md bg-black/50" />
        </div>

        <div className="relative z-10 px-3 pb-20 sm:px-4 sm:pb-20">
          {/* Mobile header bar -- sound, docs, wallet sit here so nothing overlaps */}
          <div className="h-14 sm:h-16" />

          <h1 className="font-heading text-factory-accent text-lg sm:text-xl tracking-widest text-center mb-3 sm:mb-4">
            The Factory
          </h1>

          <div className="space-y-3 sm:space-y-4">
            <CountdownTimer
              deadlineSlot={deadlineSlot && deadlineSlot > 0 ? deadlineSlot : null}
              className="text-center"
            />

            <div className="flex justify-center">
              <BuySellPanel
                className="max-w-[420px]"
                crime={crime}
                fraud={fraud}
                solPrice={solPrice}
              />
            </div>

            <div className="flex justify-center">
              <DocsButton />
            </div>
          </div>
        </div>
      </div>

    </StateMachineWrapper>
      <LaunchWalletButton />
    </DocsModalProvider>
  );
}
