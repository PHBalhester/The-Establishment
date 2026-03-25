/**
 * Client-side AMM Quote Engine
 *
 * Mirrors on-chain math from programs/amm/src/helpers/math.rs exactly.
 * All functions are pure (no RPC calls, no React). Uses BigInt arithmetic
 * to match Rust's integer division behavior and avoid precision loss at
 * mainnet-scale reserves (290T token base units x 10B SOL lamports).
 *
 * H014 FIX: All arithmetic uses BigInt. At mainnet reserves, intermediate
 * products reach ~2.9e24, far exceeding Number.MAX_SAFE_INTEGER (9e15).
 * BigInt division truncates by default (equivalent to Rust floor division).
 *
 * BPS_DENOMINATOR = 10,000 (basis points: 100 bps = 1.0%, 50 bps = 0.5%).
 *
 * Source mapping:
 * - calculateEffectiveInput -> math.rs::calculate_effective_input
 * - calculateSwapOutput     -> math.rs::calculate_swap_output
 * - calculateTax            -> tax_math.rs::calculate_tax
 *
 * Swap type order-of-operations:
 * - SOL Buy:        tax(SOL input) -> LP fee -> AMM output
 * - SOL Sell:       LP fee(token input) -> AMM output(SOL) -> tax(SOL output)
 * - Vault Convert:  deterministic 100:1 fixed rate, zero fee, zero slippage
 */

const BPS_DENOMINATOR = 10_000n;

// =============================================================================
// Primitive Functions (mirrors on-chain math.rs)
// =============================================================================

/**
 * Calculate effective input after LP fee deduction.
 *
 * Mirrors: programs/amm/src/helpers/math.rs::calculate_effective_input
 * Formula: amountIn * (10_000 - feeBps) / 10_000  (BigInt division truncates = floor)
 *
 * @param amountIn - Raw input amount in base units (lamports or token smallest denomination)
 * @param feeBps - LP fee in basis points (e.g., 100n = 1.0%, 50n = 0.5%)
 * @returns Effective input after fee deduction
 */
export function calculateEffectiveInput(amountIn: bigint, feeBps: bigint): bigint {
  return amountIn * (BPS_DENOMINATOR - feeBps) / BPS_DENOMINATOR;
}

/**
 * Calculate swap output using constant-product formula.
 *
 * Mirrors: programs/amm/src/helpers/math.rs::calculate_swap_output
 * Formula: reserveOut * effectiveInput / (reserveIn + effectiveInput)
 * BigInt division truncates by default (rounds down) -- the protocol keeps dust.
 *
 * @param reserveIn - Current reserve of the input token
 * @param reserveOut - Current reserve of the output token
 * @param effectiveInput - Post-fee input amount (from calculateEffectiveInput)
 * @returns Amount of output token the swapper receives. 0n if denominator is 0.
 */
export function calculateSwapOutput(
  reserveIn: bigint,
  reserveOut: bigint,
  effectiveInput: bigint,
): bigint {
  const denominator = reserveIn + effectiveInput;
  if (denominator === 0n) return 0n;
  return (reserveOut * effectiveInput) / denominator;
}

/**
 * Calculate tax amount from a lamport value and tax rate in basis points.
 *
 * Mirrors: programs/tax-program/src/helpers/tax_math.rs::calculate_tax
 * Formula: amountLamports * taxBps / 10_000  (BigInt division truncates = floor)
 *
 * @param amountLamports - Amount to tax (in lamports)
 * @param taxBps - Tax rate in basis points (e.g., 400n = 4%)
 * @returns Tax amount in lamports
 */
export function calculateTax(amountLamports: bigint, taxBps: bigint): bigint {
  return amountLamports * taxBps / BPS_DENOMINATOR;
}

// =============================================================================
// Price Impact Calculation
// =============================================================================

/**
 * Calculate price impact in basis points using BigInt arithmetic.
 *
 * Price impact measures how much worse the execution rate is compared to the
 * spot rate (the marginal rate at zero trade size).
 *
 * Reformulated for BigInt (no floating-point division):
 *   spotRate = reserveOut / reserveIn
 *   actualRate = output / effectiveInput
 *   impact = (1 - actualRate/spotRate) * 10_000
 *          = (spotRate - actualRate) * 10_000 / spotRate
 *
 * Cross-multiplied to avoid intermediate division:
 *   = (effectiveInput * reserveOut - output * reserveIn) * 10_000
 *     / (effectiveInput * reserveOut)
 *
 * @param reserveIn - Reserve of input token (before swap)
 * @param reserveOut - Reserve of output token (before swap)
 * @param effectiveInput - Post-fee input amount
 * @param output - Actual output amount
 * @returns Price impact in basis points (0 = no impact, 100 = 1% worse)
 */
function calculatePriceImpactBps(
  reserveIn: bigint,
  reserveOut: bigint,
  effectiveInput: bigint,
  output: bigint,
): bigint {
  if (effectiveInput === 0n || reserveOut === 0n || reserveIn === 0n || output === 0n) return 0n;

  const spotNumerator = effectiveInput * reserveOut;  // spotRate * effectiveInput * reserveIn
  const actualNumerator = output * reserveIn;          // actualRate * effectiveInput * reserveIn

  if (spotNumerator <= actualNumerator) return 0n;  // No negative impact

  return (spotNumerator - actualNumerator) * BPS_DENOMINATOR / spotNumerator;
}

// =============================================================================
// Forward Quote Functions
// =============================================================================

/** Result of a SOL buy quote (SOL -> CRIME or FRAUD). */
export interface SolBuyQuote {
  /** Token output the user receives */
  outputTokens: bigint;
  /** LP fee deducted (in lamports) */
  lpFee: bigint;
  /** Tax deducted from SOL input (in lamports) */
  taxAmount: bigint;
  /** Net SOL input after tax (before LP fee) */
  netInput: bigint;
  /** Price impact in basis points */
  priceImpactBps: bigint;
}

/**
 * Quote a SOL buy swap (SOL -> CRIME or FRAUD).
 *
 * Order of operations:
 * 1. Tax deducted from SOL input first
 * 2. LP fee deducted from remaining SOL
 * 3. Constant-product AMM output in tokens
 *
 * @param solAmountLamports - SOL input in lamports
 * @param reserveWsol - WSOL reserve in the pool
 * @param reserveToken - Token reserve in the pool (CRIME or FRAUD)
 * @param buyTaxBps - Buy tax rate in basis points (from EpochState)
 * @param lpFeeBps - LP fee in basis points (100 for SOL pools)
 * @returns Quote with output tokens, fees, tax, and price impact
 */
export function quoteSolBuy(
  solAmountLamports: bigint,
  reserveWsol: bigint,
  reserveToken: bigint,
  buyTaxBps: bigint,
  lpFeeBps: bigint,
): SolBuyQuote {
  // 1. Tax on SOL input first
  const taxAmount = calculateTax(solAmountLamports, buyTaxBps);
  const netInput = solAmountLamports - taxAmount;

  // 2. LP fee on remaining SOL
  const effectiveInput = calculateEffectiveInput(netInput, lpFeeBps);
  const lpFee = netInput - effectiveInput;

  // 3. AMM output
  const outputTokens = calculateSwapOutput(reserveWsol, reserveToken, effectiveInput);

  // Price impact
  const priceImpactBps = calculatePriceImpactBps(reserveWsol, reserveToken, effectiveInput, outputTokens);

  return { outputTokens, lpFee, taxAmount, netInput, priceImpactBps };
}

/** Result of a SOL sell quote (CRIME or FRAUD -> SOL). */
export interface SolSellQuote {
  /** SOL output the user receives (after tax) */
  outputSol: bigint;
  /** LP fee deducted (in token base units) */
  lpFee: bigint;
  /** Tax deducted from SOL output (in lamports) */
  taxAmount: bigint;
  /** Gross SOL output before tax */
  grossSolOutput: bigint;
  /** Price impact in basis points */
  priceImpactBps: bigint;
}

/**
 * Quote a SOL sell swap (CRIME or FRAUD -> SOL).
 *
 * Order of operations:
 * 1. LP fee deducted from token input
 * 2. Constant-product AMM output in SOL
 * 3. Tax deducted from SOL output
 *
 * @param tokenAmountBaseUnits - Token input in base units (6 decimals)
 * @param reserveWsol - WSOL reserve in the pool
 * @param reserveToken - Token reserve in the pool (CRIME or FRAUD)
 * @param sellTaxBps - Sell tax rate in basis points (from EpochState)
 * @param lpFeeBps - LP fee in basis points (100 for SOL pools)
 * @returns Quote with output SOL, fees, tax, and price impact
 */
export function quoteSolSell(
  tokenAmountBaseUnits: bigint,
  reserveWsol: bigint,
  reserveToken: bigint,
  sellTaxBps: bigint,
  lpFeeBps: bigint,
): SolSellQuote {
  // 1. LP fee on token input
  const effectiveInput = calculateEffectiveInput(tokenAmountBaseUnits, lpFeeBps);
  const lpFee = tokenAmountBaseUnits - effectiveInput;

  // 2. AMM output in SOL
  const grossSolOutput = calculateSwapOutput(reserveToken, reserveWsol, effectiveInput);

  // 3. Tax on SOL output
  const taxAmount = calculateTax(grossSolOutput, sellTaxBps);
  const outputSol = grossSolOutput - taxAmount;

  // Price impact (token -> SOL direction)
  const priceImpactBps = calculatePriceImpactBps(reserveToken, reserveWsol, effectiveInput, grossSolOutput);

  return { outputSol, lpFee, taxAmount, grossSolOutput, priceImpactBps };
}

/** Result of a vault conversion quote (fixed-rate, deterministic). */
export interface VaultConvertQuote {
  /** Output amount in base units */
  outputAmount: bigint;
  /** Always 0n -- vault has no LP fee */
  lpFee: bigint;
  /** Always 0n -- deterministic conversion, no price impact */
  priceImpactBps: bigint;
}

/**
 * Quote a vault conversion (CRIME/FRAUD <-> PROFIT).
 *
 * Fixed-rate conversion: no fee, no slippage, no price impact.
 * - Faction -> PROFIT: output = input / conversionRate  (BigInt division truncates = floor)
 * - PROFIT -> Faction: output = input * conversionRate
 *
 * @param inputAmount - Input amount in base units (6 decimals)
 * @param conversionRate - Fixed rate (100n = 100:1 faction:PROFIT)
 * @param isProfitInput - true if selling PROFIT for faction token
 * @returns Quote with output amount, zero fees, zero impact
 */
export function quoteVaultConvert(
  inputAmount: bigint,
  conversionRate: bigint,
  isProfitInput: boolean,
): VaultConvertQuote {
  if (inputAmount <= 0n) return { outputAmount: 0n, lpFee: 0n, priceImpactBps: 0n };
  const outputAmount = isProfitInput
    ? inputAmount * conversionRate               // PROFIT -> faction: multiply
    : inputAmount / conversionRate;               // faction -> PROFIT: divide (BigInt truncates = floor)
  return { outputAmount, lpFee: 0n, priceImpactBps: 0n };
}

// =============================================================================
// Reverse Quote Functions
//
// Given a desired output amount, calculate the required input.
// Returns null if the desired output is impossible (>= reserve).
//
// Reverse math derivation:
// Forward: output = reserveOut * effectiveInput / (reserveIn + effectiveInput)
// Reverse: effectiveInput = ceil(reserveIn * desiredOutput / (reserveOut - desiredOutput))
// Then unwind LP fee: grossInput = ceil(effectiveInput * 10_000 / (10_000 - feeBps))
// Then unwind tax if applicable.
//
// BigInt ceil pattern: ceil(a / b) = (a + b - 1n) / b
// =============================================================================

/** Result of a reverse SOL buy quote. */
export interface ReverseSolBuyQuote {
  /** Total SOL needed (including tax and LP fee) */
  inputSolNeeded: bigint;
  /** LP fee portion (in lamports) */
  lpFee: bigint;
  /** Tax portion (in lamports) */
  taxAmount: bigint;
}

/**
 * Reverse quote for SOL buy: given desired token output, how much SOL is needed?
 *
 * Unwinds the forward path: AMM -> LP fee -> tax.
 *
 * @returns Quote with required SOL input, or null if impossible
 */
export function reverseQuoteSolBuy(
  desiredOutputTokens: bigint,
  reserveWsol: bigint,
  reserveToken: bigint,
  buyTaxBps: bigint,
  lpFeeBps: bigint,
): ReverseSolBuyQuote | null {
  // Check feasibility: output must be less than reserve
  if (desiredOutputTokens >= reserveToken || desiredOutputTokens <= 0n) return null;

  // Reverse AMM: effectiveInput needed
  // ceil(reserveWsol * desiredOutputTokens / (reserveToken - desiredOutputTokens))
  const ammDenom = reserveToken - desiredOutputTokens;
  const ammNumer = reserveWsol * desiredOutputTokens;
  const effectiveInput = (ammNumer + ammDenom - 1n) / ammDenom;

  // Reverse LP fee: grossInput = ceil(effectiveInput * 10_000 / (10_000 - feeBps))
  const lpDenom = BPS_DENOMINATOR - lpFeeBps;
  const netInput = (effectiveInput * BPS_DENOMINATOR + lpDenom - 1n) / lpDenom;
  const lpFee = netInput - effectiveInput;

  // Reverse buy tax (input-side): totalSol = ceil(netInput * 10_000 / (10_000 - taxBps))
  const taxDenom = BPS_DENOMINATOR - buyTaxBps;
  const inputSolNeeded = (netInput * BPS_DENOMINATOR + taxDenom - 1n) / taxDenom;
  const taxAmount = inputSolNeeded - netInput;

  return { inputSolNeeded, lpFee, taxAmount };
}

/** Result of a reverse SOL sell quote. */
export interface ReverseSolSellQuote {
  /** Token input needed */
  inputTokensNeeded: bigint;
  /** LP fee portion (in token base units) */
  lpFee: bigint;
  /** Tax portion (in lamports, deducted from gross SOL output) */
  taxAmount: bigint;
}

/**
 * Reverse quote for SOL sell: given desired SOL output, how many tokens are needed?
 *
 * Unwinds the forward path: tax(SOL output) -> AMM -> LP fee(token input).
 *
 * @returns Quote with required token input, or null if impossible
 */
export function reverseQuoteSolSell(
  desiredOutputSol: bigint,
  reserveWsol: bigint,
  reserveToken: bigint,
  sellTaxBps: bigint,
  lpFeeBps: bigint,
): ReverseSolSellQuote | null {
  if (desiredOutputSol <= 0n) return null;

  // Reverse sell tax (output-side): grossSolNeeded = ceil(desiredOutputSol * 10_000 / (10_000 - taxBps))
  const taxDenom = BPS_DENOMINATOR - sellTaxBps;
  const grossSolNeeded = (desiredOutputSol * BPS_DENOMINATOR + taxDenom - 1n) / taxDenom;
  const taxAmount = grossSolNeeded - desiredOutputSol;

  // Check feasibility: gross SOL needed must be less than WSOL reserve
  if (grossSolNeeded >= reserveWsol) return null;

  // Reverse AMM: effectiveInput needed (in tokens)
  // ceil(reserveToken * grossSolNeeded / (reserveWsol - grossSolNeeded))
  const ammDenom = reserveWsol - grossSolNeeded;
  const ammNumer = reserveToken * grossSolNeeded;
  const effectiveInput = (ammNumer + ammDenom - 1n) / ammDenom;

  // Reverse LP fee: grossTokenInput = ceil(effectiveInput * 10_000 / (10_000 - feeBps))
  const lpDenom = BPS_DENOMINATOR - lpFeeBps;
  const inputTokensNeeded = (effectiveInput * BPS_DENOMINATOR + lpDenom - 1n) / lpDenom;
  const lpFee = inputTokensNeeded - effectiveInput;

  return { inputTokensNeeded, lpFee, taxAmount };
}

/** Result of a reverse vault conversion quote. */
export interface ReverseVaultConvertQuote {
  /** Input amount needed in base units */
  inputNeeded: bigint;
  /** Always 0n -- vault has no LP fee */
  lpFee: bigint;
}

/**
 * Reverse quote for vault conversion: given desired output, how much input?
 *
 * - Want X PROFIT (output), need X * conversionRate faction (input)
 * - Want X faction (output), need ceil(X / conversionRate) PROFIT (input)
 *
 * Returns null if desiredOutput <= 0n.
 */
export function reverseQuoteVaultConvert(
  desiredOutput: bigint,
  conversionRate: bigint,
  isProfitInput: boolean,
): ReverseVaultConvertQuote | null {
  if (desiredOutput <= 0n) return null;
  const inputNeeded = isProfitInput
    ? (desiredOutput + conversionRate - 1n) / conversionRate   // Want faction, need PROFIT (ceil)
    : desiredOutput * conversionRate;                           // Want PROFIT, need faction
  return { inputNeeded, lpFee: 0n };
}
