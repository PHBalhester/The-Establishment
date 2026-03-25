/**
 * Helius Webhook Handler (Raw Transactions + Enhanced Account Changes)
 *
 * Handles two types of Helius webhook payloads:
 *
 * 1. **Raw Transaction Webhooks** -- Parses Anchor events from logMessages,
 *    stores in Postgres (swap_events, epoch_events, carnage_events), upserts
 *    OHLCV candles, and broadcasts to SSE clients.
 *
 * 2. **Enhanced Account Change Webhooks** -- Receives account data updates
 *    for protocol PDAs (EpochState, PoolState, StakePool, CarnageFundState,
 *    CurveState), stores in the in-memory protocol store, and broadcasts
 *    via SSE to connected frontend clients for real-time UI updates.
 *
 * Payload discrimination:
 * - Raw webhooks deliver an array of transaction objects (have `signature`/`meta`)
 * - Enhanced webhooks deliver an array of account objects (have `account`/`accountData`)
 * - We detect by checking for `accountData` on the first array element
 *
 * Security (FE-02):
 * - **Production (NODE_ENV=production):** HELIUS_WEBHOOK_SECRET MUST be set.
 *   If missing, ALL requests are rejected with 500 (fail-closed). This prevents
 *   accidentally deploying without webhook authentication.
 * - **Non-production:** If HELIUS_WEBHOOK_SECRET is unset, auth is skipped
 *   (allows local dev/testing without configuring a secret).
 * - When HELIUS_WEBHOOK_SECRET IS set (any environment), the Authorization
 *   header must match exactly.
 *
 * Helius webhook registration:
 * Two webhooks are needed -- rawDevnet for event parsing, enhanced for account changes.
 *
 * 1. Raw Transaction Webhook (swap/epoch/carnage events):
 *   Use: npx tsx scripts/webhook-manage.ts create
 *   Or manually:
 *   POST https://api.helius.xyz/v0/webhooks?api-key=<API_KEY>
 *   {
 *     "webhookURL": "https://<deployment>/api/webhooks/helius",
 *     "transactionTypes": ["ANY"],
 *     "accountAddresses": ["<TAX_PROGRAM_ID>", "<EPOCH_PROGRAM_ID>"],
 *     "webhookType": "rawDevnet",
 *     "authHeader": "<HELIUS_WEBHOOK_SECRET>"
 *   }
 *
 * 2. Enhanced Account Change Webhook (real-time PDA updates):
 *   POST https://api.helius.xyz/v0/webhooks?api-key=<API_KEY>
 *   {
 *     "webhookURL": "https://<deployment>/api/webhooks/helius",
 *     "transactionTypes": ["Any"],
 *     "accountAddresses": [
 *       "<EpochState PDA>", "<CarnageFund PDA>",
 *       "<CRIME_SOL Pool PDA>", "<FRAUD_SOL Pool PDA>",
 *       "<StakePool PDA>",
 *       "<CRIME CurveState PDA>", "<FRAUD CurveState PDA>"
 *     ],
 *     "webhookType": "enhanced",
 *     "authHeader": "<HELIUS_WEBHOOK_SECRET>"
 *   }
 *
 * IMPORTANT: After every program redeploy, the rawDevnet webhook must be
 * re-registered with the new program IDs. Use scripts/webhook-manage.ts
 * which reads IDs from the IDL files (auto-synced during deployment).
 * Without accountAddresses, the webhook monitors nothing useful.
 *
 * Idempotency:
 * - swap_events: TX signature as primary key, onConflictDoNothing
 * - epoch_events: unique index on epoch_number, onConflictDoNothing
 * - carnage_events: unique index on epoch_number, onConflictDoNothing
 * - candles: composite unique on (pool, resolution, open_time), upsert logic
 * - account changes: in-memory store (last-write-wins, no persistence needed)
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { captureException } from "@/lib/sentry";
import { checkRateLimit, getClientIp, WEBHOOK_RATE_LIMIT } from "@/lib/rate-limit";
import { desc } from "drizzle-orm";
import { db } from "@/db/connection";
import { swapEvents, epochEvents, carnageEvents } from "@/db/schema";
import {
  parseSwapEvents,
  parseEpochEvents,
  parseCarnageEvents,
  type ParsedTaxedSwap,
  type ParsedUntaxedSwap,
  type ParsedEpochTransition,
  type ParsedTaxesUpdated,
  type ParsedCarnageExecuted,
} from "@/lib/event-parser";
import {
  DEVNET_POOLS,
  DEVNET_PDAS,
  DEVNET_PDAS_EXTENDED,
  DEVNET_CURVE_PDAS,
} from "@/lib/protocol-config";
import { upsertCandlesForSwap } from "@/db/candle-aggregator";
import { sseManager } from "@/lib/sse-manager";
import { protocolStore } from "@/lib/protocol-store";
import {
  getAmmProgram,
  getBondingCurveProgram,
  getEpochProgram,
  getStakingProgram,
} from "@/lib/anchor";
import { anchorToJson, CURVE_BIGINT_FIELDS, STAKING_BIGINT_FIELDS } from "@/lib/bigint-json";
import { validateDecodedAccount } from "@/lib/webhook-validators";

// Force Node.js runtime (not Edge) -- postgres.js driver needs Node APIs
export const runtime = "nodejs";
// Disable response caching
export const dynamic = "force-dynamic";

// =============================================================================
// Pool Type -> Pool Address Mapping
//
// Maps Anchor enum variant names (camelCase from deserialization) to the
// corresponding pool PDA addresses on devnet.
// =============================================================================

// NOTE: PROFIT pool entries (crimeProfit, fraudProfit) removed in Phase 4 DBS.
// PROFIT pools replaced by conversion vault. Historical UntaxedSwap events
// referencing these pool types will log "Unknown pool type" warnings.
const POOL_TYPE_TO_ADDRESS: Record<string, string> = {
  solCrime: DEVNET_POOLS.CRIME_SOL.pool.toBase58(),
  solFraud: DEVNET_POOLS.FRAUD_SOL.pool.toBase58(),
};

/**
 * Determine if a pool type is a SOL pool (taxed) or PROFIT pool (untaxed).
 * SOL pools have SOL on one side; PROFIT pools have two Token-2022 mints.
 */
function isSolPool(poolType: string): boolean {
  return poolType === "solCrime" || poolType === "solFraud";
}

/**
 * Derive AMM price from swap event amounts, excluding tax.
 *
 * For TaxedSwap (SOL pools):
 *   - Buy:  price = (inputAmount - taxAmount) / outputAmount
 *     Tax is deducted from SOL input before the AMM swap.
 *   - Sell: price = (outputAmount + taxAmount) / inputAmount
 *     Tax is deducted from the AMM's SOL output; gross = output + tax.
 *
 * For UntaxedSwap (PROFIT pools): pass taxAmount=0, behaves as before.
 *
 * Why exclude tax: Tax rates flip between epochs (e.g., 14% -> 3%).
 * Including tax in the price causes fake price jumps/drops on epoch
 * transitions even when the actual AMM exchange rate is smooth.
 *
 * Returns 0 if division by zero (shouldn't happen in practice).
 */
function derivePrice(
  direction: string,
  inputAmount: number,
  outputAmount: number,
  taxAmount: number = 0,
): number {
  if (direction === "buy") {
    const netInput = inputAmount - taxAmount;
    return outputAmount > 0 ? netInput / outputAmount : 0;
  }
  // sell: tax is deducted from output, so gross = output + tax
  const grossOutput = outputAmount + taxAmount;
  return inputAmount > 0 ? grossOutput / inputAmount : 0;
}

// =============================================================================
// Helius Raw Webhook Payload Types
//
// Helius rawDevnet webhooks deliver an array of transaction objects.
// We only type the fields we actually use.
// =============================================================================

interface HeliusTransaction {
  signature?: string;
  slot?: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    logMessages?: string[];
  };
  transaction?: {
    signatures?: string[];
  };
}

// =============================================================================
// Helius Enhanced Webhook Payload Types
//
// Enhanced webhooks with `accountAddresses` filter deliver account data changes.
// Each element represents a single account update with its new data.
// =============================================================================

interface HeliusAccountChange {
  /** The account public key that changed (base58) */
  account: string;
  /** Account data in various encodings */
  accountData: {
    /** The account public key (same as parent `account`) */
    account: string;
    /** Native data (parsed by Helius if known program) */
    nativeBalanceChange?: number;
    /** Token balance changes */
    tokenBalanceChanges?: unknown[];
  }[];
  /** Raw account data (base64-encoded bytes) */
  rawAccountData?: {
    data: string;
    encoding: string;
  };
  /**
   * Solana slot in which the account change occurred.
   * Present on all Helius enhanced webhook payloads (confirmed by docs).
   * Used for H011 slot-monotonic freshness check — reject stale replays.
   */
  slot?: number;
  /** Unix timestamp of the block (seconds). */
  timestamp?: number;
}

// =============================================================================
// Known Protocol Account Addresses
//
// Used to identify which protocol account changed in enhanced webhook payloads.
// Maps account pubkey -> human-readable label for logging.
// =============================================================================

const KNOWN_PROTOCOL_ACCOUNTS: Record<string, string> = {
  [DEVNET_PDAS.EpochState.toBase58()]: "EpochState",
  [DEVNET_PDAS.CarnageFund.toBase58()]: "CarnageFundState",
  [DEVNET_PDAS.CarnageSolVault.toBase58()]: "CarnageSolVault",
  [DEVNET_POOLS.CRIME_SOL.pool.toBase58()]: "PoolState:CRIME_SOL",
  [DEVNET_POOLS.FRAUD_SOL.pool.toBase58()]: "PoolState:FRAUD_SOL",
  [DEVNET_PDAS_EXTENDED.StakePool.toBase58()]: "StakePool",
  [DEVNET_CURVE_PDAS.crime.curveState.toBase58()]: "CurveState:CRIME",
  [DEVNET_CURVE_PDAS.fraud.curveState.toBase58()]: "CurveState:FRAUD",
};

/**
 * Maps each known protocol account label to its Anchor decode config.
 * null = SystemAccount (CarnageSolVault) — store lamports only, no Anchor decode.
 *
 * Account type names are camelCase to match Anchor 0.32's internal convention.
 * The Program constructor calls convertIdlToCamelCase() which converts all IDL
 * names from PascalCase to camelCase. The coder's decode() does a case-sensitive
 * lookup, so accountType values must be camelCase.
 */
const ANCHOR_DECODE_MAP: Record<
  string,
  { accountType: string; programKey: "amm" | "bondingCurve" | "epoch" | "staking" } | null
> = {
  "EpochState": { accountType: "epochState", programKey: "epoch" },
  "CarnageFundState": { accountType: "carnageFundState", programKey: "epoch" },
  "CarnageSolVault": null,
  "PoolState:CRIME_SOL": { accountType: "poolState", programKey: "amm" },
  "PoolState:FRAUD_SOL": { accountType: "poolState", programKey: "amm" },
  "StakePool": { accountType: "stakePool", programKey: "staking" },
  "CurveState:CRIME": { accountType: "curveState", programKey: "bondingCurve" },
  "CurveState:FRAUD": { accountType: "curveState", programKey: "bondingCurve" },
};

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Rate limiting (H024) ───────────────────────────────────────────
  const clientIp = getClientIp(req);
  const rateCheck = checkRateLimit(clientIp, WEBHOOK_RATE_LIMIT, "webhook");
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } },
    );
  }

  // ── Authorization check (FE-02: fail-closed in production) ─────────
  // Production: HELIUS_WEBHOOK_SECRET MUST be set. If missing, reject ALL
  // requests with 500 to prevent running unauthenticated in production.
  // Non-production: if unset, skip auth (allows local dev/testing).
  const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!webhookSecret && isProduction) {
    console.error(
      "[webhook] CRITICAL: HELIUS_WEBHOOK_SECRET is not set in production. " +
        "Rejecting all webhook requests. Set this environment variable to " +
        "enable webhook processing.",
    );
    captureException(new Error("[webhook] HELIUS_WEBHOOK_SECRET not set in production"));
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  if (webhookSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    // H001: Constant-time comparison prevents timing side-channel attacks.
    // An attacker could measure response times to guess the secret byte-by-byte
    // if we used simple string equality (short-circuits on first mismatch).
    // timingSafeEqual always compares all bytes, taking the same time regardless
    // of how many bytes match. Buffers must be equal length, so we pad/slice.
    const secretBuf = Buffer.from(webhookSecret, "utf-8");
    const headerBuf = Buffer.from(authHeader, "utf-8");
    const lengthMatch = secretBuf.length === headerBuf.length;
    // If lengths differ, compare secret against itself to avoid leaking length
    // info through timing, but still reject the request.
    const compareBuf = lengthMatch ? headerBuf : secretBuf;
    if (!lengthMatch || !timingSafeEqual(secretBuf, compareBuf)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // ── H050: Reject oversized payloads ──────────────────────────────
    // Prevents memory exhaustion from maliciously large webhook bodies.
    // 1MB is generous for Helius payloads (typical batch ~50-100KB).
    const MAX_BODY_BYTES = 1_048_576; // 1MB
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413 },
      );
    }

    // ── Parse webhook body ───────────────────────────────────────────
    // Helius delivers an array -- either transactions (raw) or accounts (enhanced)
    let payload: unknown[];
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON payload" },
        { status: 400 },
      );
    }

    if (!Array.isArray(payload)) {
      return NextResponse.json(
        { error: "Expected array payload" },
        { status: 400 },
      );
    }

    // ── Detect payload type ──────────────────────────────────────────
    // Enhanced Account Change webhooks have `accountData` on each element.
    // Raw Transaction webhooks have `signature`/`meta`/`transaction`.
    const firstItem = payload[0] as Record<string, unknown> | undefined;
    if (firstItem && "accountData" in firstItem) {
      return handleAccountChanges(payload as HeliusAccountChange[]);
    }

    // ── Raw transaction path (existing handler) ──────────────────────
    const transactions = payload as HeliusTransaction[];

    if (!Array.isArray(transactions)) {
      return NextResponse.json(
        { error: "Expected array of transactions" },
        { status: 400 },
      );
    }

    let swapCount = 0;
    let epochCount = 0;
    let carnageCount = 0;

    // ── Process each transaction ─────────────────────────────────────
    // H049: Maximum age for raw transactions (5 minutes). Stale
    // transactions are skipped to prevent webhook replay attacks.
    const MAX_TX_AGE_SECONDS = 300;

    for (const tx of transactions) {
      try {
        // Extract signature (Helius raw format uses transaction.signatures[0])
        const signature =
          tx.signature ?? tx.transaction?.signatures?.[0] ?? null;
        const logMessages = tx.meta?.logMessages ?? [];
        const blockTime = tx.blockTime;
        const slot = tx.slot ?? 0;

        // Skip transactions with errors or no logs
        if (tx.meta?.err || !logMessages.length || !signature) {
          continue;
        }

        // H049: Skip stale transactions (blockTime older than 5 minutes).
        // Prevents replay attacks where old webhook payloads are re-sent.
        // Enhanced account change webhooks skip this (handled separately above).
        if (blockTime != null) {
          const age = Math.floor(Date.now() / 1000) - blockTime;
          if (age > MAX_TX_AGE_SECONDS) {
            console.warn(
              `[webhook] Skipping stale transaction (blockTime ${blockTime}, age ${age}s): ${signature}`,
            );
            continue;
          }
        }

        // Derive timestamp from blockTime (unix seconds) or fallback to now
        const timestamp = blockTime
          ? new Date(blockTime * 1000)
          : new Date();

        // ── Parse and store swap events ──────────────────────────────
        const swaps = parseSwapEvents(logMessages);
        for (const swap of swaps) {
          // Skip ExemptSwap events -- these are Carnage-internal swaps
          // that would create false price data if stored as user trades
          if (swap.type === "ExemptSwap") {
            continue;
          }

          const poolAddress =
            POOL_TYPE_TO_ADDRESS[swap.poolType] ?? null;
          if (!poolAddress) {
            console.warn(
              `[webhook] Unknown pool type: ${swap.poolType} in tx ${signature}`,
            );
            continue;
          }

          if (swap.type === "TaxedSwap") {
            await storeTaxedSwap(signature, swap, poolAddress, timestamp);
            swapCount++;
          } else if (swap.type === "UntaxedSwap") {
            await storeUntaxedSwap(signature, swap, poolAddress, timestamp);
            swapCount++;
          }

          // ── Candle aggregation + SSE broadcast ───────────────────
          // After storing the swap event, upsert candles at all 6
          // resolutions and broadcast updates to connected SSE clients.
          // Wrapped in try/catch: candle failure must NOT block swap storage.
          if (swap.type === "TaxedSwap" || swap.type === "UntaxedSwap") {
            try {
              await upsertCandlesForSwap(swap, poolAddress, timestamp);

              // Broadcast candle update to all connected SSE clients.
              // We broadcast the raw swap data; the SSE client (chart)
              // filters by pool and resolution it's currently displaying.
              const RESOLUTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"];
              const direction = swap.direction;
              const taxAmt = swap.type === "TaxedSwap" ? swap.taxAmount : 0;
              const price = derivePrice(direction, swap.inputAmount, swap.outputAmount, taxAmt);

              for (const resolution of RESOLUTIONS) {
                sseManager.broadcast("candle-update", {
                  pool: poolAddress,
                  resolution,
                  price,
                  volume:
                    swap.type === "TaxedSwap"
                      ? direction === "buy"
                        ? swap.inputAmount
                        : swap.outputAmount
                      : swap.inputAmount,
                  timestamp: Math.floor(timestamp.getTime() / 1000),
                });
              }
            } catch (candleError) {
              // Log but don't fail -- swap event is already stored
              console.error(
                `[webhook] Candle upsert/SSE error for tx ${signature}:`,
                candleError,
              );
              captureException(candleError instanceof Error ? candleError : new Error(`[webhook] Candle upsert/SSE error for tx ${signature}: ${candleError}`));
            }
          }
        }

        // ── Parse and store epoch events ─────────────────────────────
        const epochs = parseEpochEvents(logMessages);
        if (epochs.length > 0) {
          await storeEpochEvents(signature, epochs, timestamp);
          epochCount += epochs.length;
        }

        // ── Parse and store Carnage events ───────────────────────────
        const carnages = parseCarnageEvents(logMessages);
        for (const carnage of carnages) {
          await storeCarnageEvent(signature, carnage, timestamp);
          carnageCount++;
        }
      } catch (txError) {
        // Log per-transaction errors but continue processing the batch.
        // Don't fail the whole webhook delivery for one bad transaction.
        const sig =
          tx.signature ?? tx.transaction?.signatures?.[0] ?? "unknown";
        console.error(
          `[webhook] Error processing tx ${sig}:`,
          txError,
        );
        captureException(txError instanceof Error ? txError : new Error(`[webhook] Error processing tx ${sig}: ${txError}`));
      }
    }

    // ── Return success ─────────────────────────────────────────────────
    // Helius expects a 200 response. Include counts for debugging.
    return NextResponse.json({
      ok: true,
      processed: {
        transactions: transactions.length,
        swaps: swapCount,
        epochs: epochCount,
        carnages: carnageCount,
      },
    });
  } catch (error) {
    // Outer catch: JSON parse failure or DB connection error.
    // Return 500 so Helius retries (exponential backoff, 24h window).
    console.error("[webhook] Fatal error:", error);
    captureException(error instanceof Error ? error : new Error(`[webhook] Fatal error: ${error}`));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// =============================================================================
// Enhanced Account Change Handler
// =============================================================================

/**
 * Handle Helius Enhanced Webhook payloads containing account data changes.
 *
 * For each account update, we:
 * 1. Check if the account is a known protocol PDA
 * 2. Store the raw account data in the in-memory protocol store
 * 3. The store automatically broadcasts via SSE to connected clients
 *
 * Unknown accounts are logged as warnings (indicates webhook misconfiguration).
 */
async function handleAccountChanges(
  accounts: HeliusAccountChange[],
): Promise<NextResponse> {
  let updatedCount = 0;

  // Lazy-init program instances (reused across all accounts in this batch)
  let programs: {
    amm: ReturnType<typeof getAmmProgram>;
    bondingCurve: ReturnType<typeof getBondingCurveProgram>;
    epoch: ReturnType<typeof getEpochProgram>;
    staking: ReturnType<typeof getStakingProgram>;
  } | null = null;

  for (const item of accounts) {
    const pubkey = item.account;
    const label = KNOWN_PROTOCOL_ACCOUNTS[pubkey];

    if (!label) {
      console.warn(
        `[webhook] Received account change for unknown account: ${pubkey}. ` +
          "Check webhook accountAddresses configuration.",
      );
      continue;
    }

    // H011: Slot-monotonic freshness — reject stale replays.
    // Helius enhanced webhooks include `slot` on every payload. If the
    // incoming slot is strictly older than the last accepted slot for this
    // account, the payload is a replay of stale data and must be dropped.
    // Same-slot updates (<=) are allowed because multiple transactions in
    // one slot can modify the same account. When slot is absent (undefined
    // or 0), we skip the check and degrade to pre-H011 behavior.
    const incomingSlot = item.slot ?? 0;
    if (incomingSlot > 0) {
      const lastSlot = protocolStore.getLastSlot(pubkey);
      if (incomingSlot < lastSlot) {
        console.warn(
          `[webhook] H011 stale replay rejected for ${label}: ` +
            `incoming slot ${incomingSlot} < last accepted ${lastSlot}`,
        );
        continue;
      }
    }

    const decodeInfo = ANCHOR_DECODE_MAP[label];

    // SystemAccount (CarnageSolVault) — no Anchor decode, just lamports
    if (decodeInfo === null) {
      const lamports = item.accountData?.[0]?.nativeBalanceChange;
      protocolStore.setAccountState(pubkey, {
        lamports: typeof lamports === "number" ? lamports : 0,
      });
      if (incomingSlot > 0) protocolStore.setLastSlot(pubkey, incomingSlot);
      updatedCount++;
      continue;
    }

    // Anchor-decodable account — need rawAccountData
    if (!decodeInfo || !item.rawAccountData?.data) {
      // H119: No decode info or no raw data — skip storage entirely.
      // Storing raw/attacker-controlled data would broadcast it to SSE clients.
      console.warn(`[webhook] No decode info or raw data for ${label} at ${pubkey}, skipping`);
      continue;
    }

    try {
      // Lazy-init programs on first decodable account
      if (!programs) {
        programs = {
          amm: getAmmProgram(),
          bondingCurve: getBondingCurveProgram(),
          epoch: getEpochProgram(),
          staking: getStakingProgram(),
        };
      }

      const program = programs[decodeInfo.programKey];
      const rawBuffer = Buffer.from(item.rawAccountData.data, "base64");
      const decoded = program.coder.accounts.decode(
        decodeInfo.accountType,
        rawBuffer,
      );
      const bigintFields =
        decodeInfo.accountType === "curveState" ? CURVE_BIGINT_FIELDS
        : decodeInfo.accountType === "stakePool" ? STAKING_BIGINT_FIELDS
        : undefined;
      const normalized = anchorToJson(
        decoded,
        bigintFields ? { bigintFields } : undefined,
      );

      // H096: Bounds validation before storage — reject out-of-range values
      if (!validateDecodedAccount(label, normalized)) {
        console.error(`[webhook] Bounds validation failed for ${label} at ${pubkey}`);
        captureException(new Error(`[webhook] Bounds validation rejected ${label} at ${pubkey}`));
        continue;
      }

      protocolStore.setAccountState(pubkey, normalized);
      if (incomingSlot > 0) protocolStore.setLastSlot(pubkey, incomingSlot);
    } catch (err) {
      // H119: Decode failed — skip storage entirely, fire Sentry alert.
      // Do NOT store raw attacker-controlled data in protocolStore (it would
      // broadcast to all connected SSE clients). Existing good data stays.
      console.error(
        `[webhook] Failed to decode ${label} at ${pubkey}:`,
        err,
      );
      captureException(new Error(`[webhook] Decode failed for ${label} at ${pubkey}: ${err}`));
    }

    updatedCount++;
  }

  return NextResponse.json({
    ok: true,
    processed: {
      type: "accountChanges",
      accounts: accounts.length,
      protocolUpdates: updatedCount,
    },
  });
}

// =============================================================================
// Storage Functions
// =============================================================================

/**
 * Store a TaxedSwap event (SOL pool swap with tax) in swap_events.
 *
 * Maps event fields to schema columns:
 * - solAmount / tokenAmount split by direction
 * - price derived from input/output ratio
 * - onConflictDoNothing for idempotent duplicate handling
 */
async function storeTaxedSwap(
  signature: string,
  swap: ParsedTaxedSwap,
  poolAddress: string,
  timestamp: Date,
): Promise<void> {
  const direction = swap.direction === "buy" ? "buy" : "sell";
  const price = derivePrice(direction, swap.inputAmount, swap.outputAmount, swap.taxAmount);

  // For SOL pools:
  // Buy: user pays SOL (input), receives tokens (output)
  // Sell: user pays tokens (input), receives SOL (output)
  const solAmount =
    direction === "buy" ? swap.inputAmount : swap.outputAmount;
  const tokenAmount =
    direction === "buy" ? swap.outputAmount : swap.inputAmount;

  await db
    .insert(swapEvents)
    .values({
      txSignature: signature,
      pool: poolAddress,
      direction,
      solAmount,
      tokenAmount,
      price,
      taxAmount: swap.taxAmount,
      lpFee: 0, // TaxedSwap doesn't report LP fee separately
      slippage: null, // Not calculable from event data alone
      userWallet: swap.user,
      epochNumber: swap.epoch,
      timestamp,
    })
    .onConflictDoNothing();
}

/**
 * DEAD CODE — UntaxedSwap events are no longer emitted (PROFIT pools removed,
 * replaced by conversion vault). Retained for historical event replay.
 * New vault conversion events will be added in Phase 7.
 *
 * Original: Store an UntaxedSwap event (PROFIT pool swap) in swap_events.
 * PROFIT pools had CRIME/FRAUD on side A and PROFIT on side B.
 */
async function storeUntaxedSwap(
  signature: string,
  swap: ParsedUntaxedSwap,
  poolAddress: string,
  timestamp: Date,
): Promise<void> {
  const direction = swap.direction === "buy" ? "buy" : "sell";
  const price = derivePrice(direction, swap.inputAmount, swap.outputAmount);

  // For PROFIT pools:
  // Buy (CRIME/FRAUD -> PROFIT): input=sideA, output=sideB
  // Sell (PROFIT -> CRIME/FRAUD): input=sideB, output=sideA
  // We store sideA in solAmount, sideB in tokenAmount (field repurposed)
  const sideAAmount =
    direction === "buy" ? swap.inputAmount : swap.outputAmount;
  const sideBAmount =
    direction === "buy" ? swap.outputAmount : swap.inputAmount;

  await db
    .insert(swapEvents)
    .values({
      txSignature: signature,
      pool: poolAddress,
      direction,
      solAmount: sideAAmount,
      tokenAmount: sideBAmount,
      price,
      taxAmount: 0, // PROFIT pools are untaxed
      lpFee: swap.lpFee,
      slippage: null,
      userWallet: swap.user,
      epochNumber: 0, // UntaxedSwap doesn't include epoch (PROFIT pools untaxed)
      timestamp,
    })
    .onConflictDoNothing();
}

/**
 * Store epoch events (EpochTransitionTriggered + TaxesUpdated) merged
 * into a single epoch_events row.
 *
 * Both events typically arrive in the same transaction (consume_randomness).
 * We merge them: EpochTransitionTriggered provides epoch/trigger info,
 * TaxesUpdated provides the new tax rates.
 *
 * If only one event arrives, we store what we have. The unique index on
 * epoch_number with onConflictDoNothing means the first insertion wins.
 */
async function storeEpochEvents(
  signature: string,
  events: (ParsedEpochTransition | ParsedTaxesUpdated)[],
  timestamp: Date,
): Promise<void> {
  // Find each event type in the batch
  const transition = events.find(
    (e): e is ParsedEpochTransition =>
      e.type === "EpochTransitionTriggered",
  );
  const taxUpdate = events.find(
    (e): e is ParsedTaxesUpdated => e.type === "TaxesUpdated",
  );

  // Determine epoch number from whichever event is present
  const epochNumber = transition?.epoch ?? taxUpdate?.epoch;
  if (epochNumber === undefined) return;

  // Derive per-token tax rates from TaxesUpdated fields
  // cheapSide 0=CRIME: CRIME gets low buy/high sell, FRAUD gets high buy/low sell
  // cheapSide 1=FRAUD: FRAUD gets low buy/high sell, CRIME gets high buy/low sell
  let cheapSide = "crime";
  let crimeBuyTax = 0;
  let crimeSellTax = 0;
  let fraudBuyTax = 0;
  let fraudSellTax = 0;

  if (taxUpdate) {
    cheapSide = taxUpdate.cheapSide === 0 ? "crime" : "fraud";
    if (taxUpdate.cheapSide === 0) {
      // CRIME is cheap side
      crimeBuyTax = taxUpdate.lowTaxBps;
      crimeSellTax = taxUpdate.highTaxBps;
      fraudBuyTax = taxUpdate.highTaxBps;
      fraudSellTax = taxUpdate.lowTaxBps;
    } else {
      // FRAUD is cheap side
      crimeBuyTax = taxUpdate.highTaxBps;
      crimeSellTax = taxUpdate.lowTaxBps;
      fraudBuyTax = taxUpdate.lowTaxBps;
      fraudSellTax = taxUpdate.highTaxBps;
    }
  }

  await db
    .insert(epochEvents)
    .values({
      epochNumber,
      txSignature: signature,
      cheapSide,
      crimeBuyTax,
      crimeSellTax,
      fraudBuyTax,
      fraudSellTax,
      stakingRewardDeposited: null, // Not available from event data
      carnageFundBalance: null, // Not available from event data
      timestamp,
    })
    .onConflictDoNothing();
}

/**
 * Store a CarnageExecuted event in carnage_events.
 *
 * Maps numeric target/action codes to human-readable strings.
 * Uses onConflictDoNothing since one Carnage per epoch max.
 *
 * IMPORTANT: `target` = the token being BOUGHT (VRF-selected buy target).
 * `tokensBurned` = held tokens from a PREVIOUS epoch's buy, which may be
 * a DIFFERENT token than `target`. To correctly assign crimeBurned/fraudBurned,
 * we query the previous carnage event's targetToken (= what was bought last time
 * = what is now held and being burned).
 */
async function storeCarnageEvent(
  signature: string,
  carnage: ParsedCarnageExecuted,
  timestamp: Date,
): Promise<void> {
  // Map target: 0=CRIME, 1=FRAUD (this is the BUY target)
  const targetToken = carnage.target === 0 ? "CRIME" : "FRAUD";

  // Map action: 0=BuyOnly, 1=Burn, 2=BurnAndSell
  const actionMap: Record<number, string> = {
    0: "BuyOnly",
    1: "Burn",
    2: "BurnAndSell",
  };
  const path = actionMap[carnage.action] ?? "BuyOnly";

  // Split bought tokens by target (target = buy target, so this is correct)
  const crimeBought =
    carnage.target === 0 ? carnage.tokensBought : null;
  const fraudBought =
    carnage.target === 1 ? carnage.tokensBought : null;

  // Determine which token was burned.
  // Burned tokens come from HELD tokens, which were the PREVIOUS epoch's buy
  // target. Query the most recent carnage event to find the previous target.
  let crimeBurned = 0;
  let fraudBurned = 0;

  if (carnage.tokensBurned > 0) {
    // Query the previous carnage event to determine held token
    const prevEvents = await db
      .select({ targetToken: carnageEvents.targetToken })
      .from(carnageEvents)
      .orderBy(desc(carnageEvents.epochNumber))
      .limit(1);

    const prevTarget = prevEvents[0]?.targetToken;

    if (prevTarget === "CRIME") {
      // Previous epoch bought CRIME -> held CRIME -> burned CRIME
      crimeBurned = carnage.tokensBurned;
    } else if (prevTarget === "FRAUD") {
      // Previous epoch bought FRAUD -> held FRAUD -> burned FRAUD
      fraudBurned = carnage.tokensBurned;
    } else {
      // No previous event (first ever Burn action, shouldn't happen in practice
      // since you need a BuyOnly first to have holdings). Fall back to logging.
      console.warn(
        `[webhook] Cannot determine burned token for epoch ${carnage.epoch}: no previous carnage event found. Defaulting tokensBurned to unknown.`,
      );
      // Store in crimeBurned as fallback to avoid losing the data
      crimeBurned = carnage.tokensBurned;
    }
  }

  await db
    .insert(carnageEvents)
    .values({
      epochNumber: carnage.epoch,
      txSignature: signature,
      crimeBurned,
      fraudBurned,
      solUsedForBuy: carnage.solSpent,
      crimeBought,
      fraudBought,
      carnageSolBefore: null, // Not available from event data
      carnageSolAfter: null, // Not available from event data
      path,
      targetToken,
      timestamp,
    })
    .onConflictDoNothing();
}
