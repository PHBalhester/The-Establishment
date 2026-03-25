"use client";

/**
 * GraduationOverlay -- Full-screen celebration when BOTH curves graduate
 *
 * Renders an absolute-positioned overlay that covers the entire launch page
 * when both CRIME and FRAUD curves reach Graduated status. Uses CSS-only
 * animations for the celebration effect (no npm deps per project convention).
 *
 * This state persists until admin swaps Railway deployment to the factory
 * scene. No dismiss button -- purely visual celebration.
 *
 * Steampunk brass/gold aesthetic with subtle glow pulse animation.
 */

interface GraduationOverlayProps {
  className?: string;
}

export function GraduationOverlay({ className = "" }: GraduationOverlayProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}
    >
      {/* Blurred backdrop */}
      <div className="absolute inset-0 backdrop-blur-lg bg-black/70" />

      {/* Celebration content */}
      <div className="relative z-10 text-center max-w-xl mx-4 space-y-6">
        {/* Decorative gear animation */}
        <div className="flex justify-center mb-4">
          <div
            className="w-24 h-24 rounded-full border-4 border-amber-500/60 relative"
            style={{ animation: "graduation-spin 12s linear infinite" }}
          >
            {/* Gear teeth (CSS pseudo-elements via inline positioned divs) */}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <div
                key={deg}
                className="absolute w-3 h-6 bg-amber-500/60 rounded-sm"
                style={{
                  top: "50%",
                  left: "50%",
                  transform: `rotate(${deg}deg) translateY(-52px) translate(-50%, -50%)`,
                }}
              />
            ))}
            {/* Inner circle */}
            <div className="absolute inset-3 rounded-full border-2 border-amber-400/40 flex items-center justify-center">
              <div
                className="w-3 h-3 rounded-full bg-amber-400/80"
                style={{ animation: "graduation-glow 2s ease-in-out infinite" }}
              />
            </div>
          </div>
        </div>

        {/* Main header */}
        <h1
          className="text-4xl md:text-5xl font-bold tracking-widest"
          style={{
            color: "#d4a843",
            textShadow:
              "0 0 20px rgba(212, 168, 67, 0.4), 0 0 40px rgba(212, 168, 67, 0.2)",
            animation: "graduation-glow 3s ease-in-out infinite",
          }}
        >
          THE EXPERIMENT SUCCEEDS
        </h1>

        {/* Decorative divider */}
        <div className="flex items-center justify-center gap-3">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-amber-500/50" />
          <div className="w-2 h-2 rotate-45 bg-amber-500/60" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-amber-500/50" />
        </div>

        {/* Subtext */}
        <p className="text-amber-200/70 text-lg md:text-xl font-mono leading-relaxed">
          Both curves have filled and graduated.
        </p>
        <p className="text-amber-200/50 text-sm font-mono">
          Liquidity pools are being seeded. The factory awaits.
        </p>

        {/* Brass plate */}
        <div className="mt-8 inline-block px-8 py-3 border border-amber-700/40 rounded bg-gradient-to-b from-amber-900/30 to-amber-950/40">
          <p className="text-amber-300/60 text-xs font-mono tracking-wider uppercase">
            Graduation Complete
          </p>
        </div>
      </div>

      {/* CSS keyframes via style tag -- no external CSS file needed */}
      <style>{`
        @keyframes graduation-glow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        @keyframes graduation-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
