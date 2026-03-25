'use client';

/**
 * LaunchScene -- Full-viewport launch page container with blurred factory
 * background and CurveOverlay.png as centered brass machine overlay.
 *
 * Architecture:
 * 1. Full-bleed viewport div with the existing factory scene background
 *    image, rendered with a CSS blur overlay (backdrop-filter blur)
 * 2. CurveOverlay.png rendered as a centered overlay on top -- the brass
 *    machine with two pressure gauges and a dark center panel for swap UI
 * 3. Children (gauges, timer, panels, buttons) are positioned relative to
 *    the overlay image using percentage-based coordinates
 *
 * This follows the existing modal pattern in the app: blurred background
 * with content on top. No header, no nav chrome -- full immersive page.
 *
 * The overlay uses "contain" sizing (same as FactoryBackground) to fit
 * within the viewport at the native 16:9 ratio (2560/1440 = 1.78:1).
 */

import Image from 'next/image';
import { SCENE_DATA } from '@/lib/image-data';

interface LaunchSceneProps {
  children?: React.ReactNode;
}

export default function LaunchScene({ children }: LaunchSceneProps) {
  return (
    <div
      className="relative w-full h-screen bg-factory-bg overflow-hidden"
      aria-label="Dr. Fraudsworth's Bonding Curve Launch"
    >
      {/* Layer 1: Factory scene background image (same as main site) */}
      <Image
        src={SCENE_DATA.background.src}
        alt=""
        fill
        sizes="100vw"
        quality={60}
        placeholder="blur"
        blurDataURL={SCENE_DATA.background.blurDataURL}
        className="object-cover"
        priority
        aria-hidden="true"
      />

      {/* Layer 2: Blur overlay on top of background */}
      <div
        className="absolute inset-0 backdrop-blur-md bg-black/40"
        aria-hidden="true"
      />

      {/* Layer 3: CurveOverlay.png -- centered brass machine overlay.
          Uses "contain" strategy: scales to fit viewport while maintaining
          16:9 (1.78:1) aspect ratio. Letterbox/pillarbox filled by the
          blurred background underneath. */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 'min(100vw, calc(100vh * 1.78))',
          height: 'min(100vh, calc(100vw / 1.78))',
        }}
      >
        <Image
          src="/scene/launch/curve-overlay.png"
          alt="Bonding Curve Machine"
          fill
          sizes="min(100vw, calc(100vh * 1.78))"
          quality={90}
          className="object-contain pointer-events-none select-none"
          priority
        />

        {/* Children are positioned relative to this container,
            sharing the same coordinate space as the overlay image.
            Use percentage-based positioning to match overlay features. */}
        {children}
      </div>
    </div>
  );
}
