'use client';

/**
 * FactoryBackground -- Full-viewport government protocol scene container.
 *
 * Renders the optimized WebP background image with progressive loading:
 * 1. bg-government-bg dark navy shows instantly (no white flash)
 * 2. Blurred thumbnail fades in via Next.js Image placeholder="blur"
 * 3. Full-resolution image sharpens when loaded
 *
 * Architecture: The outer div is the viewport fill (w-full h-screen overflow-hidden).
 * Inside, a scene container uses "contain" sizing — min() ensures it fits entirely
 * within the viewport at the native 1.81:1 aspect ratio (5568/3072). Both the
 * background image AND children (overlay stations) live inside this same container,
 * so they share one coordinate space. Letterbox/pillarbox bars are filled by the
 * parent's bg-government-bg, making the bars seamless. All stations stay visible and
 * clickable at every viewport size.
 */

import Image from 'next/image';
import { SCENE_DATA } from '@/lib/image-data';

interface FactoryBackgroundProps {
  children?: React.ReactNode;
}

export default function FactoryBackground({ children }: FactoryBackgroundProps) {
  return (
    <div
      className="relative w-full h-screen bg-government-bg overflow-hidden"
      role="img"
      aria-label="The Establishment official protocol scene"
    >
      {/* Scene container: "contain" strategy — scales entire scene to fit
           within the viewport while maintaining 1.81:1 ratio. min() ensures
           the container never exceeds the viewport in either dimension,
           producing letterbox (top/bottom bars) or pillarbox (side bars) as
           needed. bg-factory-bg on the parent fills any bars seamlessly.
           All stations stay visible and clickable at every viewport size. */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 'min(100vw, calc(100vh * 1.81))',
          height: 'min(100vh, calc(100vw / 1.81))',
        }}
      >
        <Image
          src={SCENE_DATA.background.src}
          alt="The Establishment official protocol"
          fill
          sizes="min(100vw, calc(100vh * 1.81))"
          quality={80}
          placeholder="blur"
          blurDataURL={SCENE_DATA.background.blurDataURL}
          className="z-background object-cover"
          preload
        />
        {children}
      </div>
    </div>
  );
}
