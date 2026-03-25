/**
 * EpochState Reader and Tax Rate Verification
 *
 * Reads the on-chain EpochState account and verifies that tax rates
 * are within expected bands after each VRF epoch transition.
 *
 * Tax rate bands (from Epoch_State_Machine_Spec.md Section 7.2):
 * - Low:  100, 200, 300, 400 bps  (1-4%)
 * - High: 1100, 1200, 1300, 1400 bps (11-14%)
 *
 * Cheap side logic:
 * - CRIME cheap (cheapSide=0): crimeBuy=low, crimeSell=high, fraudBuy=high, fraudSell=low
 * - FRAUD cheap (cheapSide=1): fraudBuy=low, fraudSell=high, crimeBuy=high, crimeSell=low
 */

import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// ─── Interfaces ────────────────────────────────────────────────────────────

/**
 * Snapshot of EpochState account fields.
 * Maps all IDL fields to TypeScript for verification.
 */
export interface EpochStateSnapshot {
  /** Current epoch number */
  currentEpoch: number;
  /** Which token is cheap: "CRIME" or "FRAUD" */
  cheapSide: string;
  /** Raw cheapSide enum value (0=CRIME, 1=FRAUD) */
  cheapSideRaw: number;
  /** Whether VRF is pending (waiting for consume) */
  vrfPending: boolean;
  /** Whether taxes have been confirmed by VRF this epoch */
  taxesConfirmed: boolean;
  /** Low tax band value in basis points */
  lowTaxBps: number;
  /** High tax band value in basis points */
  highTaxBps: number;
  /** CRIME buy tax in basis points */
  crimeBuyTaxBps: number;
  /** CRIME sell tax in basis points */
  crimeSellTaxBps: number;
  /** FRAUD buy tax in basis points */
  fraudBuyTaxBps: number;
  /** FRAUD sell tax in basis points */
  fraudSellTaxBps: number;
  /** Genesis slot (when protocol was initialized) */
  genesisSlot: number;
  /** Slot when current epoch started */
  epochStartSlot: number;
  /** Slot when VRF was requested (0 = none) */
  vrfRequestSlot: number;
  /** Public key of the pending randomness account */
  pendingRandomnessAccount: string;
  /** Whether Carnage is pending (atomic execution failed) */
  carnagePending: boolean;
  /** Last epoch when Carnage was triggered */
  lastCarnageEpoch: number;
  /** Whether the epoch state is initialized */
  initialized: boolean;
}

/**
 * Result of tax rate verification.
 */
export interface TaxVerificationResult {
  /** Whether all checks passed */
  valid: boolean;
  /** List of error messages for failed checks */
  errors: string[];
}

// ─── Valid Tax Rate Values ─────────────────────────────────────────────────

/** Valid low tax rates: 100, 200, 300, 400 bps */
const VALID_LOW_RATES = [100, 200, 300, 400];

/** Valid high tax rates: 1100, 1200, 1300, 1400 bps */
const VALID_HIGH_RATES = [1100, 1200, 1300, 1400];

// ─── Functions ─────────────────────────────────────────────────────────────

/**
 * Read the EpochState account and map it to a typed snapshot.
 *
 * @param epochProgram Epoch Program instance
 * @param epochStatePda EpochState PDA address
 * @returns EpochStateSnapshot with all fields
 */
export async function readEpochState(
  epochProgram: Program,
  epochStatePda: PublicKey
): Promise<EpochStateSnapshot> {
  const state = await (epochProgram.account as any).epochState.fetch(epochStatePda);

  // cheapSide is a numeric enum: 0 = CRIME, 1 = FRAUD
  // Anchor serializes fieldless Rust enums as numbers.
  // Handle both numeric (0/1) and object ({ crime: {} }) representations for safety.
  let isCrime: boolean;
  if (typeof state.cheapSide === "number") {
    isCrime = state.cheapSide === 0;
  } else if (state.cheapSide && state.cheapSide.crime !== undefined) {
    isCrime = true;
  } else {
    isCrime = false;
  }
  const cheapSideStr = isCrime ? "CRIME" : "FRAUD";
  const cheapSideRaw = isCrime ? 0 : 1;

  return {
    currentEpoch: state.currentEpoch,
    cheapSide: cheapSideStr,
    cheapSideRaw,
    vrfPending: state.vrfPending,
    taxesConfirmed: state.taxesConfirmed,
    lowTaxBps: state.lowTaxBps,
    highTaxBps: state.highTaxBps,
    crimeBuyTaxBps: state.crimeBuyTaxBps,
    crimeSellTaxBps: state.crimeSellTaxBps,
    fraudBuyTaxBps: state.fraudBuyTaxBps,
    fraudSellTaxBps: state.fraudSellTaxBps,
    genesisSlot: typeof state.genesisSlot === "number"
      ? state.genesisSlot
      : state.genesisSlot.toNumber(),
    epochStartSlot: typeof state.epochStartSlot === "number"
      ? state.epochStartSlot
      : state.epochStartSlot.toNumber(),
    vrfRequestSlot: typeof state.vrfRequestSlot === "number"
      ? state.vrfRequestSlot
      : state.vrfRequestSlot.toNumber(),
    pendingRandomnessAccount: state.pendingRandomnessAccount.toBase58(),
    carnagePending: state.carnagePending,
    lastCarnageEpoch: state.lastCarnageEpoch,
    initialized: state.initialized,
  };
}

/**
 * Verify that tax rates are within expected bands and consistent with
 * the cheap_side logic.
 *
 * Checks:
 * 1. lowTaxBps is one of [100, 200, 300, 400]
 * 2. highTaxBps is one of [1100, 1200, 1300, 1400]
 * 3. If CRIME is cheap: crimeBuy=low, crimeSell=high, fraudBuy=high, fraudSell=low
 * 4. If FRAUD is cheap: fraudBuy=low, fraudSell=high, crimeBuy=high, crimeSell=low
 * 5. taxesConfirmed is true (VRF has been consumed)
 *
 * @param snapshot EpochState snapshot to verify
 * @returns TaxVerificationResult with valid flag and any errors
 */
export function verifyTaxRates(snapshot: EpochStateSnapshot): TaxVerificationResult {
  const errors: string[] = [];

  // Check 1: Low tax in valid range
  if (!VALID_LOW_RATES.includes(snapshot.lowTaxBps)) {
    errors.push(
      `lowTaxBps=${snapshot.lowTaxBps} not in valid set [${VALID_LOW_RATES.join(", ")}]`
    );
  }

  // Check 2: High tax in valid range
  if (!VALID_HIGH_RATES.includes(snapshot.highTaxBps)) {
    errors.push(
      `highTaxBps=${snapshot.highTaxBps} not in valid set [${VALID_HIGH_RATES.join(", ")}]`
    );
  }

  // Check 3/4: Cheap side consistency
  if (snapshot.cheapSide === "CRIME") {
    // CRIME cheap: crime buy = low, crime sell = high
    if (snapshot.crimeBuyTaxBps !== snapshot.lowTaxBps) {
      errors.push(
        `CRIME cheap but crimeBuyTax=${snapshot.crimeBuyTaxBps} != lowTax=${snapshot.lowTaxBps}`
      );
    }
    if (snapshot.crimeSellTaxBps !== snapshot.highTaxBps) {
      errors.push(
        `CRIME cheap but crimeSellTax=${snapshot.crimeSellTaxBps} != highTax=${snapshot.highTaxBps}`
      );
    }
    if (snapshot.fraudBuyTaxBps !== snapshot.highTaxBps) {
      errors.push(
        `CRIME cheap but fraudBuyTax=${snapshot.fraudBuyTaxBps} != highTax=${snapshot.highTaxBps}`
      );
    }
    if (snapshot.fraudSellTaxBps !== snapshot.lowTaxBps) {
      errors.push(
        `CRIME cheap but fraudSellTax=${snapshot.fraudSellTaxBps} != lowTax=${snapshot.lowTaxBps}`
      );
    }
  } else if (snapshot.cheapSide === "FRAUD") {
    // FRAUD cheap: fraud buy = low, fraud sell = high
    if (snapshot.fraudBuyTaxBps !== snapshot.lowTaxBps) {
      errors.push(
        `FRAUD cheap but fraudBuyTax=${snapshot.fraudBuyTaxBps} != lowTax=${snapshot.lowTaxBps}`
      );
    }
    if (snapshot.fraudSellTaxBps !== snapshot.highTaxBps) {
      errors.push(
        `FRAUD cheap but fraudSellTax=${snapshot.fraudSellTaxBps} != highTax=${snapshot.highTaxBps}`
      );
    }
    if (snapshot.crimeBuyTaxBps !== snapshot.highTaxBps) {
      errors.push(
        `FRAUD cheap but crimeBuyTax=${snapshot.crimeBuyTaxBps} != highTax=${snapshot.highTaxBps}`
      );
    }
    if (snapshot.crimeSellTaxBps !== snapshot.lowTaxBps) {
      errors.push(
        `FRAUD cheap but crimeSellTax=${snapshot.crimeSellTaxBps} != lowTax=${snapshot.lowTaxBps}`
      );
    }
  } else {
    errors.push(`Unknown cheapSide value: "${snapshot.cheapSide}"`);
  }

  // Check 5: Taxes should be confirmed after consume
  if (!snapshot.taxesConfirmed) {
    errors.push("taxesConfirmed is false -- VRF may not have been consumed");
  }

  // Check 6: VRF should not be pending after consume
  if (snapshot.vrfPending) {
    errors.push("vrfPending is true -- consume may have failed");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format an EpochStateSnapshot as a human-readable summary string.
 */
export function formatSnapshot(snapshot: EpochStateSnapshot): string {
  return [
    `  Epoch: ${snapshot.currentEpoch}`,
    `  Cheap Side: ${snapshot.cheapSide}`,
    `  Low Tax: ${snapshot.lowTaxBps} bps (${(snapshot.lowTaxBps / 100).toFixed(1)}%)`,
    `  High Tax: ${snapshot.highTaxBps} bps (${(snapshot.highTaxBps / 100).toFixed(1)}%)`,
    `  CRIME: buy=${snapshot.crimeBuyTaxBps}bps sell=${snapshot.crimeSellTaxBps}bps`,
    `  FRAUD: buy=${snapshot.fraudBuyTaxBps}bps sell=${snapshot.fraudSellTaxBps}bps`,
    `  VRF Pending: ${snapshot.vrfPending}`,
    `  Taxes Confirmed: ${snapshot.taxesConfirmed}`,
    `  Carnage Pending: ${snapshot.carnagePending}`,
  ].join("\n");
}
