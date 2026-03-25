'use client';

/**
 * WhitepaperButton -- Image-based whitepaper button for the desktop launch scene.
 *
 * Two layers:
 * 1. Full-canvas Image overlay (pointer-events-none, z-[15]) -- always visible
 * 2. Invisible <button> positioned over the graphic area (z-[25]) -- clickable
 *
 * Hover/active state on the button drives filter + transform on the image
 * via React state, giving the golden glow + scale effect on the visible graphic.
 */

import { useState } from 'react';
import Image from 'next/image';
import { useDocsModal } from '@/components/launch/DocsModal';

export function WhitepaperButton() {
  const { open } = useDocsModal();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const imageFilter = hovered
    ? 'drop-shadow(0 0 28px rgba(212,160,74,0.9)) brightness(1.4)'
    : undefined;
  const imageTransform = pressed
    ? 'scale(0.95)'
    : hovered
      ? 'scale(1.05)'
      : undefined;

  return (
    <>
      {/* Full-canvas image overlay -- visual layer */}
      <Image
        src="/scene/launch/LaunchWhitepaperButton.png"
        alt=""
        fill
        sizes="min(100vw, calc(100vh * 1.78))"
        className="object-contain pointer-events-none select-none z-[15]"
        aria-hidden="true"
        style={{
          filter: imageFilter,
          transform: imageTransform,
          transition: 'filter 150ms ease-out, transform 150ms ease-out',
          transformOrigin: '50% 77%',
        }}
      />

      {/* Invisible clickable zone over the graphic */}
      <button
        type="button"
        onClick={open}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setPressed(false); }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        aria-label="Open whitepaper"
        className="absolute z-[25] cursor-pointer focus-visible:outline-none"
        style={{
          left: '40%',
          top: '74.5%',
          width: '20.5%',
          height: '4.5%',
        }}
      />
    </>
  );
}
