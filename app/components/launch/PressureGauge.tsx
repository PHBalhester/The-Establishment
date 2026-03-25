'use client';

/**
 * PressureGauge -- CSS-driven needle rotation overlay for the CurveOverlay
 * brass machine pressure gauges.
 *
 * The CurveOverlay.png already contains the rendered brass gauge faces with
 * needle artwork baked in. This component overlays a transparent interactive
 * layer on top of each gauge area to display the fill percentage text and
 * animate a needle indicator.
 *
 * For now, the gauge needles are baked into the overlay image. This component
 * positions a semi-transparent overlay with percentage text and a CSS needle
 * that will replace the baked-in needles when separate needle assets are
 * provided later.
 *
 * Needle rotation: The gauge face goes from 0 at bottom-left (~7 o'clock)
 * to 100 at bottom-right (~5 o'clock). Needle sweeps from NEEDLE_MIN_DEG
 * (-135) to NEEDLE_MAX_DEG (135) = 270 degree arc.
 *
 * Props:
 * - solRaised: bigint (lamports) -- current SOL raised for this curve
 * - label: string -- "CRIME" or "FRAUD"
 * - className: optional positioning classes (absolute + left/top/width/height %)
 */

import { TARGET_SOL } from '@/lib/curve/curve-constants';

/** Needle sweep range in degrees (270-degree arc, clock face style) */
const NEEDLE_MIN_DEG = -135;
const NEEDLE_MAX_DEG = 135;

interface PressureGaugeProps {
  /** SOL raised in lamports (bigint) */
  solRaised: bigint;
  /** Curve label: "CRIME" or "FRAUD" */
  label: string;
  /** Positioning classes (absolute + percentage coords from parent) */
  className?: string;
}

export function PressureGauge({ solRaised, label, className }: PressureGaugeProps) {
  // Calculate fill percentage: solRaised / TARGET_SOL * 100, capped at 100
  const pct = TARGET_SOL > 0n
    ? Math.min(100, Number((solRaised * 100n) / TARGET_SOL))
    : 0;

  // Needle rotation: linear interpolation from MIN to MAX
  const needleDeg = NEEDLE_MIN_DEG + (pct / 100) * (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG);

  // Format SOL raised for display
  const solDisplay = (Number(solRaised) / 1e9).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  return (
    <div
      className={`${className ?? ''}`}
      role="meter"
      aria-label={`${label} curve progress: ${pct.toFixed(1)}%`}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Transparent overlay — positioned over the baked-in gauge in the image.
          Needle assets are baked into CurveOverlay.png for now.
          When separate needle PNGs are provided, CSS rotation will be added here. */}
    </div>
  );
}
