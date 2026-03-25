'use client';

/**
 * FactoryOverlay -- Single positioned overlay image within the factory scene.
 *
 * Reads position metadata (percentage-based coordinates) from SCENE_DATA.overlays
 * and renders the overlay at its correct scene position with lazy loading and a
 * blur placeholder for progressive reveal.
 *
 * Returns null if the overlay is unavailable (e.g., swap-station asset missing).
 *
 * This is a SINGLE-overlay component -- the scene assembly (Phase 55) maps over
 * overlay IDs to render all overlays. Hover effects and click handlers are added
 * in Phase 55.
 */

import Image from 'next/image';
import { SCENE_DATA } from '@/lib/image-data';

interface FactoryOverlayProps {
  /** Key into SCENE_DATA.overlays (e.g., 'carnage-cauldron') */
  overlayId: string;
  /** Additional classes for hover effects, animations, etc. (Phase 55+) */
  className?: string;
  /** For tooltips, hover effects, or labels layered on top (Phase 55+) */
  children?: React.ReactNode;
}

/**
 * Converts a kebab-case overlay ID to Title Case for the alt attribute.
 * e.g., 'carnage-cauldron' -> 'Carnage Cauldron'
 */
function toTitleCase(kebab: string): string {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function FactoryOverlay({
  overlayId,
  className,
  children,
}: FactoryOverlayProps) {
  const overlay = SCENE_DATA.overlays[overlayId];

  // Guard: unknown overlay ID
  if (!overlay) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`FactoryOverlay: unknown overlayId "${overlayId}"`);
    }
    return null;
  }

  // Guard: asset not yet available (e.g., swap-station placeholder)
  if (!overlay.available) {
    return null;
  }

  return (
    <div
      className={`absolute z-overlays ${className ?? ''}`}
      style={{
        left: `${overlay.left}%`,
        top: `${overlay.top}%`,
        width: `${overlay.widthPct}%`,
        height: `${overlay.heightPct}%`,
      }}
    >
      <Image
        src={overlay.src}
        alt={toTitleCase(overlayId)}
        fill
        quality={82}
        placeholder="blur"
        blurDataURL={overlay.blurDataURL}
        loading="lazy"
        className="object-contain"
      />
      {children}
    </div>
  );
}
