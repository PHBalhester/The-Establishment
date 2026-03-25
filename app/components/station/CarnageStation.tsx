'use client';

/**
 * CarnageStation -- Self-contained Carnage Fund station modal.
 *
 * Phase 63 rewrite: Display logic inlined from CarnageCard (dashboard import
 * removed). Uses kit Card, Divider, and Scrollbar components for consistent
 * parchment-themed rendering under the kit-frame chromeVariant.
 *
 * Hooks called:
 * - useCarnageData(): vault balance, lifetime burn stats (polls 10s + WebSocket)
 * - useCarnageEvents(): last 5 parsed Carnage events (polls 60s)
 * - useEpochState(): current epoch number for "X epochs ago" display (polls 10s)
 *
 * Auto-refresh: hooks mount when the modal opens (React.lazy), unmount when it
 * closes. Fresh data on every open per the modal lifecycle pattern.
 *
 * Default export required for React.lazy in ModalContent.tsx.
 */

import { useCarnageData } from '@/hooks/useCarnageData';
import { useCarnageEvents } from '@/hooks/useCarnageEvents';
import { useEpochState } from '@/hooks/useEpochState';
import { Divider, Scrollbar } from '@/components/kit';
import type { CarnageEvent } from '@/hooks/useCarnageEvents';
import { carnageActionLabel } from '@/hooks/useCarnageEvents';
import { solscanTxUrl } from '@/lib/solscan';

// =============================================================================
// Constants & Format Helpers
// =============================================================================

/** Token decimals for CRIME and FRAUD (both 6) */
const TOKEN_DECIMALS = 6;

/**
 * Epoch offset: the epoch program was deployed 428 epochs before the protocol
 * went live. Display epoch numbers relative to launch (Epoch 429 → Epoch 1).
 */
const EPOCH_LAUNCH_OFFSET = 428;
function displayEpoch(onChainEpoch: number): number {
  return onChainEpoch - EPOCH_LAUNCH_OFFSET;
}

/**
 * Format a token amount with abbreviations for large values.
 * Uses token decimals (6) to convert from base units to human-readable.
 */
function formatTokenBurned(baseUnits: number): string {
  const human = baseUnits / Math.pow(10, TOKEN_DECIMALS);
  if (human >= 1_000_000) {
    return (human / 1_000_000).toFixed(2) + 'M';
  }
  if (human >= 1_000) {
    return (human / 1_000).toFixed(1) + 'K';
  }
  return human.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format lamports to SOL with 4 decimal places */
function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

/** Format an ISO date string (from Postgres) to a human-readable date string */
function formatEventDate(timestamp: string): string {
  if (!timestamp) return 'Unknown date';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// =============================================================================
// CarnageStation Component
// =============================================================================

export default function CarnageStation() {
  const { carnageData, loading: carnageLoading, error: carnageError } = useCarnageData();
  const { events: carnageEvents, loading: eventsLoading } = useCarnageEvents();
  const { epochState } = useEpochState();

  // Prop derivation (nullish coalescing)
  const totalCrimeBurned = carnageData?.totalCrimeBurned ?? null;
  const totalFraudBurned = carnageData?.totalFraudBurned ?? null;
  const totalSolSpent = carnageData?.totalSolSpent ?? null;
  const totalTriggers = carnageData?.totalTriggers ?? null;
  const lastTriggerEpoch = carnageData?.lastTriggerEpoch ?? null;
  const vaultBalanceLamports = carnageData?.vaultBalanceLamports ?? null;
  const currentEpoch = epochState?.currentEpoch ?? null;

  // Compute "X epochs ago" for last trigger
  let lastTriggerText: string | null = null;
  if (lastTriggerEpoch !== null && currentEpoch !== null) {
    const epochsAgo = currentEpoch - lastTriggerEpoch;
    if (epochsAgo === 0) {
      lastTriggerText = `Epoch ${displayEpoch(lastTriggerEpoch)} (this epoch)`;
    } else if (epochsAgo === 1) {
      lastTriggerText = `Epoch ${displayEpoch(lastTriggerEpoch)} (1 epoch ago)`;
    } else {
      lastTriggerText = `Epoch ${displayEpoch(lastTriggerEpoch)} (${epochsAgo} epochs ago)`;
    }
  } else if (lastTriggerEpoch !== null) {
    lastTriggerText = `Epoch ${displayEpoch(lastTriggerEpoch)}`;
  }

  return (
    <div>
      <h2 className="kit-card-header">Carnage Fund</h2>

      {/* Error state */}
      {carnageError && (
        <p className="text-xs text-factory-error mb-3 break-all">{carnageError}</p>
      )}

      {/* Vault SOL balance -- primary display */}
      <div className="mb-4">
        <p className="text-xs text-factory-text-secondary mb-1">Vault Balance</p>
        {carnageLoading ? (
          <div className="h-8 w-28 rounded animate-pulse opacity-20 bg-current" />
        ) : vaultBalanceLamports !== null ? (
          <p className="text-2xl font-bold font-mono text-factory-accent">
            {formatSol(vaultBalanceLamports)} SOL
          </p>
        ) : (
          <p className="text-lg text-factory-text-muted">--</p>
        )}
      </div>

      {/* Lifetime Stats */}
      <Divider className="my-3" />

      <p className="text-xs text-factory-text-secondary uppercase tracking-wider mb-2">
        Lifetime Stats
      </p>

      <div className="space-y-2">
        {/* CRIME burned */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-factory-text">CRIME Burned</span>
          {carnageLoading ? (
            <div className="h-4 w-20 rounded animate-pulse opacity-20 bg-current" />
          ) : totalCrimeBurned !== null ? (
            <span className="text-sm font-mono text-factory-crime">
              {formatTokenBurned(totalCrimeBurned)}
            </span>
          ) : (
            <span className="text-sm text-factory-text-muted">--</span>
          )}
        </div>

        {/* FRAUD burned */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-factory-text">FRAUD Burned</span>
          {carnageLoading ? (
            <div className="h-4 w-20 rounded animate-pulse opacity-20 bg-current" />
          ) : totalFraudBurned !== null ? (
            <span className="text-sm font-mono text-factory-fraud">
              {formatTokenBurned(totalFraudBurned)}
            </span>
          ) : (
            <span className="text-sm text-factory-text-muted">--</span>
          )}
        </div>

        {/* Total SOL spent */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-factory-text">SOL Spent</span>
          {carnageLoading ? (
            <div className="h-4 w-20 rounded animate-pulse opacity-20 bg-current" />
          ) : totalSolSpent !== null ? (
            <span className="text-sm font-mono text-factory-accent">
              {formatSol(totalSolSpent)} SOL
            </span>
          ) : (
            <span className="text-sm text-factory-text-muted">--</span>
          )}
        </div>

        {/* Total triggers */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-factory-text">Total Triggers</span>
          {carnageLoading ? (
            <div className="h-4 w-10 rounded animate-pulse opacity-20 bg-current" />
          ) : totalTriggers !== null ? (
            <span className="text-sm font-mono text-factory-text">
              {totalTriggers}
            </span>
          ) : (
            <span className="text-sm text-factory-text-muted">--</span>
          )}
        </div>

        {/* Last trigger epoch */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-factory-text">Last Trigger</span>
          {carnageLoading ? (
            <div className="h-4 w-32 rounded animate-pulse opacity-20 bg-current" />
          ) : lastTriggerText !== null ? (
            <span className="text-sm font-mono text-factory-text-secondary">
              {lastTriggerText}
            </span>
          ) : (
            <span className="text-sm text-factory-text-muted">None yet</span>
          )}
        </div>
      </div>

      {/* Recent Events */}
      <Divider className="my-3" />

      <p className="text-xs text-factory-text-secondary uppercase tracking-wider mb-2">
        Recent Events
      </p>

      {eventsLoading ? (
        /* Skeleton placeholders while events are loading */
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded animate-pulse opacity-20 bg-current" />
          ))}
        </div>
      ) : carnageEvents.length === 0 ? (
        <p className="text-xs text-factory-text-secondary italic">
          No Carnage events recorded yet
        </p>
      ) : (
        <Scrollbar className="max-h-64">
          <div className="space-y-2">
            {carnageEvents.map((event: CarnageEvent) => {
              // Derive per-event burned/bought amounts from per-token DB columns.
              //
              // targetToken = the token that was BOUGHT (VRF buy target).
              // crimeBurned/fraudBurned = which token was burned (from held tokens
              // of a PREVIOUS epoch). These may differ from targetToken.
              // crimeBought/fraudBought = which token was bought (matches targetToken).
              const actionLabel = carnageActionLabel(event.path);

              // Burned token: whichever column is non-zero (only one can be)
              const burnedAmount = event.crimeBurned + event.fraudBurned;
              const burnedToken = event.crimeBurned > 0 ? 'CRIME' : event.fraudBurned > 0 ? 'FRAUD' : null;
              const burnedIsCrime = burnedToken === 'CRIME';

              // Bought token: use targetToken (the buy target)
              const boughtAmount = (event.crimeBought ?? 0) + (event.fraudBought ?? 0);
              const boughtToken = event.targetToken;
              const boughtIsCrime = boughtToken === 'CRIME';

              return (
                <div key={event.txSignature} className="p-2 border-b border-factory-border-subtle/30 last:border-b-0">
                  {/* Row 1: Date and epoch */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-factory-text-secondary">
                      {formatEventDate(event.timestamp)}
                    </span>
                    <span className="text-xs font-semibold text-factory-text">
                      Epoch {displayEpoch(event.epochNumber)}
                    </span>
                  </div>

                  {/* Row 2: Action detail */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-factory-text-secondary">
                      {actionLabel === 'Burn' ? (
                        <>
                          Burned{' '}
                          <span className={burnedIsCrime ? 'text-factory-crime' : 'text-factory-fraud'}>
                            {formatTokenBurned(burnedAmount)} {burnedToken ?? 'tokens'}
                          </span>
                          {boughtAmount > 0 && (
                            <>
                              {', Bought '}
                              <span className={boughtIsCrime ? 'text-factory-crime' : 'text-factory-fraud'}>
                                {formatTokenBurned(boughtAmount)} {boughtToken}
                              </span>
                            </>
                          )}
                        </>
                      ) : actionLabel === 'Burn & Sell' ? (
                        <>
                          {'Sold '}
                          <span className={burnedIsCrime ? 'text-factory-crime' : 'text-factory-fraud'}>
                            {burnedToken ?? 'tokens'}
                          </span>
                          {boughtAmount > 0 && (
                            <>
                              {', Bought '}
                              <span className={boughtIsCrime ? 'text-factory-crime' : 'text-factory-fraud'}>
                                {formatTokenBurned(boughtAmount)} {boughtToken}
                              </span>
                            </>
                          )}
                        </>
                      ) : actionLabel === 'Buy Only' ? (
                        <>
                          Bought{' '}
                          <span className={boughtIsCrime ? 'text-factory-crime' : 'text-factory-fraud'}>
                            {formatTokenBurned(boughtAmount)} {boughtToken}
                          </span>
                        </>
                      ) : (
                        <span className="text-factory-text-muted">Unknown action</span>
                      )}
                    </span>
                    <span className="text-xs font-mono text-factory-accent">
                      {formatSol(event.solUsedForBuy)} SOL
                    </span>
                  </div>

                  {/* Explorer link */}
                  <div className="mt-1">
                    <a
                      href={solscanTxUrl(event.txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center min-h-[44px] text-xs text-factory-accent hover:text-factory-glow underline"
                    >
                      View on Explorer
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </Scrollbar>
      )}
    </div>
  );
}
