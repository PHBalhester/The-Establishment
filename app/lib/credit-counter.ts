/**
 * RPC Credit Counter -- Server-Side Call Tracking
 *
 * Tracks total RPC calls and per-method breakdown for monitoring Helius
 * credit consumption. Exposed via /api/health for dashboard comparison.
 *
 * globalThis singleton pattern survives Next.js hot reloads in development.
 * Same pattern as protocol-store.ts and sse-manager.ts.
 */

// =============================================================================
// Types
// =============================================================================

interface CreditStats {
  totalCalls: number;
  methodCounts: Record<string, number>;
  startedAt: string;
}

// =============================================================================
// Credit Counter Class
// =============================================================================

class CreditCounter {
  private totalCalls = 0;
  private methodCounts: Record<string, number> = {};
  private startedAt: string;

  constructor() {
    this.startedAt = new Date().toISOString();
  }

  /** Record an RPC call for the given method (e.g., "getAccountInfo"). */
  recordCall(method: string): void {
    this.totalCalls++;
    this.methodCounts[method] = (this.methodCounts[method] ?? 0) + 1;
  }

  /** Return a snapshot of current credit stats. */
  getStats(): CreditStats {
    return {
      totalCalls: this.totalCalls,
      methodCounts: { ...this.methodCounts },
      startedAt: this.startedAt,
    };
  }

  /** Reset all counters (useful for testing). */
  resetStats(): void {
    this.totalCalls = 0;
    this.methodCounts = {};
    this.startedAt = new Date().toISOString();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

const globalForCredit = globalThis as unknown as {
  creditCounter: CreditCounter | undefined;
};

export const creditCounter =
  globalForCredit.creditCounter ?? new CreditCounter();

globalForCredit.creditCounter = creditCounter;
