'use client';

/**
 * CountdownTimer -- Slot-based countdown to curve deadline.
 *
 * Uses Tailwind v4 @theme utility classes: bg-factory-*, text-factory-*, etc.
 */

import { useCurrentSlot } from '@/hooks/useCurrentSlot';
import { MS_PER_SLOT } from '@dr-fraudsworth/shared';

interface CountdownTimerProps {
  deadlineSlot: number | null;
  className?: string;
}

export function CountdownTimer({ deadlineSlot, className }: CountdownTimerProps) {
  const { currentSlot } = useCurrentSlot();

  if (!deadlineSlot || deadlineSlot === 0) {
    return (
      <div className={className ?? ''}>
        <div className="inline-block bg-factory-surface/80 border border-factory-border-subtle rounded-lg px-4 py-1.5 backdrop-blur-sm">
          <p className="text-factory-text-secondary text-xs font-mono tracking-wider">
            Awaiting launch...
          </p>
        </div>
      </div>
    );
  }

  if (currentSlot === null) {
    return (
      <div className={className ?? ''}>
        <div className="inline-block bg-factory-surface/80 border border-factory-border-subtle rounded-lg px-4 py-1.5 backdrop-blur-sm">
          <p className="text-factory-text-muted text-xs font-mono animate-pulse">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  const remainingSlots = deadlineSlot - currentSlot;

  // DEBUG: remove after diagnosing EXPIRED issue
  console.log('[CountdownTimer]', { deadlineSlot, currentSlot, remainingSlots });

  if (remainingSlots <= 0) {
    return (
      <div className={className ?? ''}>
        <div className="inline-block bg-factory-error/15 border border-factory-error/40 rounded-lg px-4 py-1.5 backdrop-blur-sm">
          <p className="text-factory-error text-xs font-mono font-bold tracking-wider uppercase">
            Expired
          </p>
        </div>
      </div>
    );
  }

  const remainingMs = remainingSlots * MS_PER_SLOT;
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const timeStr = hours > 0 ? `~${hours}h ${minutes}m` : `~${minutes}m`;

  return (
    <div className={className ?? ''}>
      <div className="inline-block bg-factory-surface/80 border border-factory-border-subtle rounded-lg px-4 py-1.5 backdrop-blur-sm">
        <p className="text-factory-text text-xs font-mono tracking-wider">
          <span className="text-factory-text-muted mr-2 uppercase">Deadline</span>
          <span className="tabular-nums font-bold text-factory-accent">{timeStr}</span>
          <span className="text-factory-text-muted ml-1">remaining</span>
        </p>
      </div>
    </div>
  );
}
