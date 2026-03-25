/**
 * Bonding Curve Constants (Client-Side BigInt)
 *
 * Mirrors programs/bonding_curve/src/constants.rs exactly.
 * All values are BigInt for safe use in curve-math.ts calculations.
 *
 * CRITICAL: These must stay in sync with on-chain constants.
 * If any constant drifts, client-side previews will diverge from
 * actual on-chain behavior.
 *
 * Environment-dependent constants use NEXT_PUBLIC_CLUSTER to select
 * devnet vs mainnet values, matching the on-chain #[cfg(feature)] pattern.
 *
 * Source: programs/bonding_curve/src/constants.rs
 */

// ---------------------------------------------------------------------------
// Cluster Detection
// ---------------------------------------------------------------------------

/**
 * Whether we're running against devnet.
 * NEXT_PUBLIC_CLUSTER is set in .env.devnet / .env.mainnet and forwarded
 * by Next.js to client bundles via the NEXT_PUBLIC_ prefix.
 */
const isDevnet = process.env.NEXT_PUBLIC_CLUSTER?.toLowerCase() === 'devnet';

// ---------------------------------------------------------------------------
// Precision Scaling (Section 4.4)
// ---------------------------------------------------------------------------

/** 1e12 scaling factor for intermediate arithmetic. */
export const PRECISION = 1_000_000_000_000n;

// ---------------------------------------------------------------------------
// Curve Parameters (Section 3.2 / 4.1)
// ---------------------------------------------------------------------------

/**
 * Start price in lamports per human token.
 * Devnet: 5 (scaled for 5 SOL target). Mainnet: 450 (500 SOL target).
 */
export const P_START = isDevnet ? 5n : 450n;

/**
 * End price in lamports per human token.
 * Devnet: 17 (scaled for 5 SOL target). Mainnet: 1,725 (500 SOL target).
 */
export const P_END = isDevnet ? 17n : 1_725n;

/**
 * Total tokens available for sale per curve: 460M with 6 decimals.
 * 460,000,000 * 10^6 = 460,000,000,000,000 base units.
 * Same across all environments.
 */
export const TOTAL_FOR_SALE = 460_000_000_000_000n;

// ---------------------------------------------------------------------------
// Token Config
// ---------------------------------------------------------------------------

/**
 * Token decimal factor: 10^6.
 * Bridges lamports-per-human-token (P_START/P_END) to lamports-per-base-unit.
 */
export const TOKEN_DECIMAL_FACTOR = 1_000_000n;

// ---------------------------------------------------------------------------
// Target Values (Section 7.1)
// ---------------------------------------------------------------------------

/**
 * Target SOL raised in lamports.
 * Devnet: 5 SOL for testability. Mainnet: 500 SOL per curve.
 */
export const TARGET_SOL = isDevnet ? 5_000_000_000n : 500_000_000_000n;

/** Maximum tokens per wallet: 20M with 6 decimals. Same across environments. */
export const MAX_TOKENS_PER_WALLET = 20_000_000_000_000n;

/**
 * Minimum SOL per purchase in lamports.
 * Devnet: 0.001 SOL for small-amount testing. Mainnet: 0.05 SOL.
 */
export const MIN_PURCHASE_SOL = isDevnet ? 1_000_000n : 50_000_000n;

// ---------------------------------------------------------------------------
// Sell Tax (Section 4.5)
// ---------------------------------------------------------------------------

/** Sell tax: 15% expressed in basis points. */
export const SELL_TAX_BPS = 1_500n;

/** Basis point denominator: 10,000 = 100%. */
export const BPS_DENOMINATOR = 10_000n;
