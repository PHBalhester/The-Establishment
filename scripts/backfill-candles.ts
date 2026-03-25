/**
 * Historical Candle Backfill Script
 *
 * Fetches historical swap transactions from the Solana devnet RPC,
 * parses Anchor events from their logs, and populates the candles
 * and swap_events tables in Postgres.
 *
 * This script uses the SAME event parsing and candle aggregation logic
 * as the live webhook handler (app/api/webhooks/helius/route.ts),
 * ensuring consistency between historical and real-time data.
 *
 * Data flow:
 * 1. getSignaturesForAddress(TAX_PROGRAM_ID) -- get all TX signatures
 * 2. getTransaction(signature) -- fetch full TX with logs
 * 3. parseSwapEvents(logMessages) -- extract TaxedSwap/UntaxedSwap events
 * 4. Upsert into candles table at all 6 resolutions
 * 5. Also stores swap_events for the swap history table
 *
 * Usage:
 *   npx tsx scripts/backfill-candles.ts --dry-run --limit 20
 *   DATABASE_URL="postgres://..." npx tsx scripts/backfill-candles.ts
 *
 * Options:
 *   --limit N     Max signatures to fetch (default: 1000)
 *   --dry-run     Parse and display events without writing to DB
 *
 * Prerequisites:
 *   - DATABASE_URL env var pointing to Postgres with migrated schema
 *   - Devnet RPC accessible (uses Helius devnet endpoint)
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_API_KEY) {
  console.error("Error: HELIUS_API_KEY environment variable is required.");
  process.exit(1);
}
const RPC_URL = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Tax Program ID -- extracted from IDL (auto-synced during deployment)
const taxIdlForId = JSON.parse(readFileSync(join(__dirname, "..", "app", "idl", "tax_program.json"), "utf-8"));
const TAX_PROGRAM_ID = new PublicKey(taxIdlForId.address);

// Pool type -> pool address mapping (loaded from PDA manifest)
// NOTE: crimeProfit/fraudProfit AMM pools removed in Phase 69 (replaced by conversion vault)
const manifestPath = join(__dirname, "deploy", "pda-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const POOL_TYPE_TO_ADDRESS: Record<string, string> = {
  solCrime: manifest.pools["CRIME/SOL"].pool,
  solFraud: manifest.pools["FRAUD/SOL"].pool,
};

// =============================================================================
// Event Parser (inline, avoids app/ path alias issues with tsx)
//
// This duplicates the logic from app/lib/event-parser.ts but uses direct
// file imports for the IDLs. The canonical source remains the app/ code.
// =============================================================================

// Load IDLs from the app's IDL directory
const taxIdlPath = join(__dirname, "..", "app", "idl", "tax_program.json");
const taxIdl = JSON.parse(readFileSync(taxIdlPath, "utf-8")) as unknown as Idl;

interface ParsedTaxedSwap {
  type: "TaxedSwap";
  user: string;
  poolType: string;
  direction: string;
  inputAmount: number;
  outputAmount: number;
  taxAmount: number;
  taxRateBps: number;
  stakingPortion: number;
  carnagePortion: number;
  treasuryPortion: number;
  epoch: number;
  slot: number;
}

interface ParsedUntaxedSwap {
  type: "UntaxedSwap";
  user: string;
  poolType: string;
  direction: string;
  inputAmount: number;
  outputAmount: number;
  lpFee: number;
  slot: number;
}

interface ParsedExemptSwap {
  type: "ExemptSwap";
  authority: string;
  pool: string;
  amountA: number;
  direction: number;
  slot: number;
}

type ParsedSwapEvent = ParsedTaxedSwap | ParsedUntaxedSwap | ParsedExemptSwap;

function enumVariant(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null) {
    const key = Object.keys(value)[0] ?? "unknown";
    // Lowercase first char: SolCrime -> solCrime, Buy -> buy
    return key.charAt(0).toLowerCase() + key.slice(1);
  }
  return String(value);
}

function pubkeyToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_bn" in value) {
    try {
      const bn = (value as { _bn: { toArrayLike: (type: unknown, endian: string, length: number) => Uint8Array } })._bn;
      const bytes = bn.toArrayLike(Buffer, "le", 32);
      return new PublicKey(bytes).toBase58();
    } catch { return String(value); }
  }
  if (typeof value === "object" && value !== null && "toBase58" in value) {
    return (value as { toBase58: () => string }).toBase58();
  }
  return String(value);
}

function bnToNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

function parseSwapEvents(logMessages: string[]): ParsedSwapEvent[] {
  const coder = new BorshCoder(taxIdl);
  const parser = new EventParser(TAX_PROGRAM_ID, coder);
  const events: ParsedSwapEvent[] = [];

  for (const event of parser.parseLogs(logMessages)) {
    const data = event.data as Record<string, unknown>;
    switch (event.name) {
      case "TaxedSwap":
        events.push({
          type: "TaxedSwap",
          user: pubkeyToString(data.user),
          poolType: enumVariant(data.pool_type),
          direction: enumVariant(data.direction),
          inputAmount: bnToNumber(data.input_amount),
          outputAmount: bnToNumber(data.output_amount),
          taxAmount: bnToNumber(data.tax_amount),
          taxRateBps: bnToNumber(data.tax_rate_bps),
          stakingPortion: bnToNumber(data.staking_portion),
          carnagePortion: bnToNumber(data.carnage_portion),
          treasuryPortion: bnToNumber(data.treasury_portion),
          epoch: bnToNumber(data.epoch),
          slot: bnToNumber(data.slot),
        });
        break;
      case "UntaxedSwap":
        events.push({
          type: "UntaxedSwap",
          user: pubkeyToString(data.user),
          poolType: enumVariant(data.pool_type),
          direction: enumVariant(data.direction),
          inputAmount: bnToNumber(data.input_amount),
          outputAmount: bnToNumber(data.output_amount),
          lpFee: bnToNumber(data.lp_fee),
          slot: bnToNumber(data.slot),
        });
        break;
      case "ExemptSwap":
        events.push({
          type: "ExemptSwap",
          authority: pubkeyToString(data.authority),
          pool: pubkeyToString(data.pool),
          amountA: bnToNumber(data.amount_a),
          direction: bnToNumber(data.direction),
          slot: bnToNumber(data.slot),
        });
        break;
    }
  }
  return events;
}

// =============================================================================
// Candle Aggregator (inline, same logic as app/db/candle-aggregator.ts)
// =============================================================================

const RESOLUTION_SECONDS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400,
};
const RESOLUTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function truncateToResolution(timestamp: Date, resolution: string): Date {
  const seconds = RESOLUTION_SECONDS[resolution]!;
  const unixSeconds = Math.floor(timestamp.getTime() / 1000);
  const truncated = Math.floor(unixSeconds / seconds) * seconds;
  return new Date(truncated * 1000);
}

// =============================================================================
// Database
// =============================================================================

function getDbClient(): ReturnType<typeof postgres> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    console.error("Set it to your Postgres connection string, e.g.:");
    console.error('  DATABASE_URL="postgres://user:pass@host:5432/db" npx tsx scripts/backfill-candles.ts');
    process.exit(1);
  }
  return postgres(connectionString, { max: 5 });
}

// =============================================================================
// Price Derivation (same logic as webhook handler)
// =============================================================================

function derivePrice(direction: string, inputAmount: number, outputAmount: number, taxAmount: number = 0): number {
  if (direction === "buy") {
    const netInput = inputAmount - taxAmount;
    return outputAmount > 0 ? netInput / outputAmount : 0;
  }
  const grossOutput = outputAmount + taxAmount;
  return inputAmount > 0 ? grossOutput / inputAmount : 0;
}

// =============================================================================
// Main Backfill Logic
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 1000;

  console.log("=== Dr. Fraudsworth Candle Backfill ===");
  console.log(`  RPC:     ${RPC_URL.replace(HELIUS_API_KEY, "***")}`);
  console.log(`  Program: ${TAX_PROGRAM_ID.toBase58()} (Tax Program)`);
  console.log(`  Limit:   ${limit} signatures`);
  console.log(`  Dry run: ${dryRun}`);
  console.log();

  const connection = new Connection(RPC_URL, "confirmed");
  const sql = dryRun ? null : getDbClient();

  try {
    // Step 1: Fetch all transaction signatures for the Tax Program
    console.log("Step 1: Fetching transaction signatures...");
    const allSignatures: Array<{ signature: string; blockTime: number | null | undefined; slot: number }> = [];
    let before: string | undefined = undefined;

    while (allSignatures.length < limit) {
      const batch = await connection.getSignaturesForAddress(
        TAX_PROGRAM_ID,
        {
          limit: Math.min(1000, limit - allSignatures.length),
          before,
        },
        "confirmed",
      );

      if (batch.length === 0) break;

      for (const sig of batch) {
        if (!sig.err) {
          allSignatures.push({
            signature: sig.signature,
            blockTime: sig.blockTime,
            slot: sig.slot,
          });
        }
      }

      before = batch[batch.length - 1].signature;
      console.log(`  Fetched ${allSignatures.length} signatures so far...`);

      // Rate limit: small delay between pagination calls
      await sleep(200);
    }

    console.log(`  Total: ${allSignatures.length} successful transactions found`);
    console.log();

    if (allSignatures.length === 0) {
      console.log("No transactions found for the Tax Program. Nothing to backfill.");
      return;
    }

    // Step 2: Fetch each transaction and parse events
    console.log("Step 2: Fetching transactions and parsing events...");
    let swapCount = 0;
    let candleCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < allSignatures.length; i++) {
      const { signature, blockTime } = allSignatures[i];

      try {
        // Fetch full transaction with logs
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });

        if (!tx || !tx.meta?.logMessages) {
          skippedCount++;
          continue;
        }

        const logMessages = tx.meta.logMessages;
        const timestamp = blockTime ? new Date(blockTime * 1000) : new Date();

        // Parse swap events from logs
        const swaps = parseSwapEvents(logMessages);

        for (const swap of swaps) {
          // Skip ExemptSwap (Carnage-internal)
          if (swap.type === "ExemptSwap") continue;

          const poolAddress = POOL_TYPE_TO_ADDRESS[swap.poolType] ?? null;
          if (!poolAddress) {
            console.warn(`  [${i + 1}] Unknown pool type: ${swap.poolType} in tx ${signature.slice(0, 16)}...`);
            continue;
          }

          const direction = swap.direction === "buy" ? "buy" : "sell";
          const taxAmt = swap.type === "TaxedSwap" ? swap.taxAmount : 0;
          const price = derivePrice(direction, swap.inputAmount, swap.outputAmount, taxAmt);

          if (price <= 0) continue;

          // Determine volume
          let volume: number;
          if (swap.type === "TaxedSwap") {
            volume = direction === "buy" ? swap.inputAmount : swap.outputAmount;
          } else {
            volume = swap.inputAmount;
          }

          swapCount++;

          if (dryRun) {
            console.log(`  [${i + 1}] ${swap.type} ${direction} on ${swap.poolType}: price=${price.toFixed(8)}, vol=${volume}, time=${timestamp.toISOString()}`);
            continue;
          }

          // Store swap event (idempotent via ON CONFLICT DO NOTHING)
          const solAmount = direction === "buy" ? swap.inputAmount : swap.outputAmount;
          const tokenAmount = direction === "buy" ? swap.outputAmount : swap.inputAmount;
          const taxAmount = swap.type === "TaxedSwap" ? swap.taxAmount : 0;
          const lpFee = swap.type === "UntaxedSwap" ? swap.lpFee : 0;
          const userWallet = swap.type === "TaxedSwap" ? swap.user : swap.user;
          const epochNumber = swap.type === "TaxedSwap" ? swap.epoch : 0;

          await sql!`
            INSERT INTO swap_events (tx_signature, pool, direction, sol_amount, token_amount, price, tax_amount, lp_fee, slippage, user_wallet, epoch_number, "timestamp")
            VALUES (${signature}, ${poolAddress}, ${direction}, ${solAmount}, ${tokenAmount}, ${price}, ${taxAmount}, ${lpFee}, ${null}, ${userWallet}, ${epochNumber}, ${timestamp})
            ON CONFLICT (tx_signature) DO NOTHING
          `;

          // Upsert candles at all 6 resolutions
          for (const resolution of RESOLUTIONS) {
            const openTime = truncateToResolution(timestamp, resolution);
            await sql!`
              INSERT INTO candles (pool, resolution, open_time, "open", high, low, close, volume, trade_count)
              VALUES (${poolAddress}, ${resolution}, ${openTime}, ${price}, ${price}, ${price}, ${price}, ${volume}, 1)
              ON CONFLICT (pool, resolution, open_time)
              DO UPDATE SET
                high = GREATEST(candles.high, ${price}),
                low = LEAST(candles.low, ${price}),
                close = ${price},
                volume = candles.volume + ${volume},
                trade_count = candles.trade_count + 1
            `;
            candleCount++;
          }
        }

        // Progress indicator
        if ((i + 1) % 50 === 0 || i === allSignatures.length - 1) {
          console.log(`  Processed ${i + 1}/${allSignatures.length} transactions (${swapCount} swaps, ${candleCount} candle upserts)`);
        }

        // Rate limit: small delay between RPC calls
        await sleep(100);
      } catch (err) {
        errorCount++;
        console.error(`  [${i + 1}] Error processing ${signature.slice(0, 16)}...: ${err}`);
        // Continue processing other transactions
      }
    }

    console.log();
    console.log("=== Backfill Complete ===");
    console.log(`  Transactions processed: ${allSignatures.length}`);
    console.log(`  Swap events found:      ${swapCount}`);
    console.log(`  Candle upserts:         ${candleCount}`);
    console.log(`  Skipped (no logs):      ${skippedCount}`);
    console.log(`  Errors:                 ${errorCount}`);

    if (dryRun) {
      console.log();
      console.log("(Dry run -- no data was written to the database)");
    }
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
