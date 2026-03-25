'use client';

/**
 * LoadingSpinner -- CSS-only steampunk gear/cog animation.
 *
 * A reusable spinner styled as a rotating gear with notched teeth, using only
 * CSS (no SVG files, no images, no external dependencies). The gear is built
 * from a circular base with 8 teeth created using rotated child elements.
 *
 * Automatically respects `prefers-reduced-motion` via the media query in
 * globals.css which sets animation-duration to 0.01ms.
 *
 * Used for:
 * - Initial page load (Phase 55 scene assembly)
 * - Image retry fallback (Phase 55)
 * - Modal loading states (Phase 56)
 */

const SIZES = {
  sm: 32,
  md: 48,
  lg: 64,
} as const;

interface LoadingSpinnerProps {
  /** Spinner diameter: sm=32px, md=48px, lg=64px */
  size?: keyof typeof SIZES;
  /** Additional CSS classes */
  className?: string;
}

export default function LoadingSpinner({
  size = 'md',
  className,
}: LoadingSpinnerProps) {
  const diameter = SIZES[size];
  const toothSize = diameter * 0.18;
  const toothOffset = -toothSize / 2;

  return (
    <div
      className={`z-spinner inline-flex items-center justify-center ${className ?? ''}`}
      role="status"
      aria-label="Loading"
    >
      <div
        className="relative animate-gear-spin"
        style={{ width: diameter, height: diameter }}
      >
        {/* Central gear body */}
        <div
          className="absolute inset-[15%] rounded-full bg-factory-secondary border-2 border-factory-accent"
        />

        {/* Hub (center dot) */}
        <div
          className="absolute inset-[35%] rounded-full bg-factory-accent"
        />

        {/* 8 gear teeth -- evenly spaced around the circumference */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="absolute bg-factory-secondary border border-factory-accent rounded-sm"
            style={{
              width: toothSize,
              height: toothSize,
              top: '50%',
              left: '50%',
              marginTop: toothOffset,
              marginLeft: toothOffset,
              transform: `rotate(${i * 45}deg) translateY(${-diameter / 2 + toothSize * 0.3}px)`,
            }}
          />
        ))}
      </div>

      {/* Screen-reader text */}
      <span className="sr-only">Loading</span>
    </div>
  );
}
