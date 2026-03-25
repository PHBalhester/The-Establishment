/**
 * Drizzle ORM Schema -- Indexer Event Tables
 *
 * Schema-only definition. No database connection is established here.
 * Phase 44 will provision Postgres on Railway and generate migrations
 * from these table definitions using drizzle-kit.
 *
 * Tables:
 *   swap_events    -- Rich swap data (tax, LP fee, slippage, wallet, epoch)
 *   candles        -- OHLCV price candles for all 4 pools at multiple resolutions
 *   epoch_events   -- Snapshot of protocol state at each epoch transition
 *   carnage_events -- Full execution trace of Carnage rebalancing events
 */

import {
  pgTable,
  varchar,
  integer,
  bigint,
  real,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// =============================================================================
// Swap Events -- rich data capture per CONTEXT.md decision
// Primary key is the Solana TX signature (natural idempotency key).
// =============================================================================
export const swapEvents = pgTable(
  "swap_events",
  {
    txSignature: varchar("tx_signature", { length: 128 }).primaryKey(),
    pool: varchar("pool", { length: 64 }).notNull(), // pool PDA address
    direction: varchar("direction", { length: 4 }).notNull(), // "buy" | "sell"
    solAmount: bigint("sol_amount", { mode: "number" }).notNull(), // lamports
    tokenAmount: bigint("token_amount", { mode: "number" }).notNull(), // base units (6 decimals)
    price: real("price").notNull(), // token price in SOL
    taxAmount: bigint("tax_amount", { mode: "number" }).notNull(), // lamports of tax paid
    lpFee: bigint("lp_fee", { mode: "number" }).notNull(), // lamports of LP fee
    slippage: real("slippage"), // actual slippage % (nullable, may not always be calculable)
    userWallet: varchar("user_wallet", { length: 64 }).notNull(), // user's wallet address
    epochNumber: integer("epoch_number").notNull(), // which epoch the swap occurred in
    timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
  },
  (table) => [
    index("swap_pool_idx").on(table.pool),
    index("swap_epoch_idx").on(table.epochNumber),
    index("swap_time_idx").on(table.timestamp),
    index("swap_user_idx").on(table.userWallet),
  ],
);

// =============================================================================
// Candle Data -- OHLCV for all 4 pool pairs at multiple resolutions
// Unique constraint on (pool, resolution, open_time) prevents duplicate candles.
// Resolutions: "1m", "5m", "15m", "1h", "4h", "1d"
// =============================================================================
export const candles = pgTable(
  "candles",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    pool: varchar("pool", { length: 64 }).notNull(), // pool PDA address
    resolution: varchar("resolution", { length: 4 }).notNull(), // "1m","5m","15m","1h","4h","1d"
    openTime: timestamp("open_time", { mode: "date" }).notNull(), // start of candle period
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(), // in lamports
    tradeCount: integer("trade_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("candle_unique_idx").on(
      table.pool,
      table.resolution,
      table.openTime,
    ),
    index("candle_pool_res_idx").on(table.pool, table.resolution),
    index("candle_time_idx").on(table.openTime),
  ],
);

// =============================================================================
// Epoch Events -- snapshot of protocol state at each epoch transition
// One row per epoch. Unique constraint on epoch_number.
// =============================================================================
export const epochEvents = pgTable(
  "epoch_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    epochNumber: integer("epoch_number").notNull(),
    txSignature: varchar("tx_signature", { length: 128 }).notNull(),
    cheapSide: varchar("cheap_side", { length: 8 }).notNull(), // "crime" | "fraud"
    crimeBuyTax: integer("crime_buy_tax").notNull(), // bps
    crimeSellTax: integer("crime_sell_tax").notNull(), // bps
    fraudBuyTax: integer("fraud_buy_tax").notNull(), // bps
    fraudSellTax: integer("fraud_sell_tax").notNull(), // bps
    stakingRewardDeposited: bigint("staking_reward_deposited", {
      mode: "number",
    }), // lamports (nullable for epochs with no deposit)
    carnageFundBalance: bigint("carnage_fund_balance", { mode: "number" }), // lamports at transition time
    timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("epoch_number_idx").on(table.epochNumber),
    index("epoch_time_idx").on(table.timestamp),
  ],
);

// =============================================================================
// Carnage Events -- full execution trace of Carnage rebalancing
// One carnage event per epoch max. Unique constraint on epoch_number.
// =============================================================================
export const carnageEvents = pgTable(
  "carnage_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    epochNumber: integer("epoch_number").notNull(),
    txSignature: varchar("tx_signature", { length: 128 }).notNull(),
    crimeBurned: bigint("crime_burned", { mode: "number" }).notNull(), // base units burned
    fraudBurned: bigint("fraud_burned", { mode: "number" }).notNull(), // base units burned
    solUsedForBuy: bigint("sol_used_for_buy", { mode: "number" }).notNull(), // lamports used in buy step
    crimeBought: bigint("crime_bought", { mode: "number" }), // base units (nullable, depends on path)
    fraudBought: bigint("fraud_bought", { mode: "number" }), // base units (nullable, depends on path)
    carnageSolBefore: bigint("carnage_sol_before", { mode: "number" }), // lamports in fund before execution
    carnageSolAfter: bigint("carnage_sol_after", { mode: "number" }), // lamports in fund after execution
    path: varchar("path", { length: 32 }), // "BuyOnly" | "Burn" | "BurnAndSell"
    targetToken: varchar("target_token", { length: 8 }), // "CRIME" | "FRAUD" (cheap side)
    timestamp: timestamp("timestamp", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("carnage_epoch_idx").on(table.epochNumber),
    index("carnage_time_idx").on(table.timestamp),
  ],
);
