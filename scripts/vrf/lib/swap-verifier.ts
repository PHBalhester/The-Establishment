/**
 * Post-VRF Swap Tax Rate Verification
 *
 * Verifies that VRF-derived tax rates are correctly stored in EpochState
 * and would be applied to swaps. This is VRF-04 validation.
 *
 * Approach: State-read verification. The full swap CPI chain requires
 * ~15 accounts + Transfer Hook remaining_accounts, which is too complex
 * for a standalone validation script. Instead, we verify:
 * 1. EpochState has VRF-derived tax rates (not zeros, not defaults)
 * 2. Tax rates are in spec bands (100-400 low, 1100-1400 high)
 * 3. Per-token rates are consistent with cheap_side logic
 * 4. taxesConfirmed is true (VRF has been consumed)
 *
 * Full swap testing with actual token transfers is deferred to Phase 36
 * (E2E Devnet Testing), which has the full protocol context available.
 *
 * Source: Epoch_State_Machine_Spec.md Section 10, 35-CONTEXT.md
 */

import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { readEpochState, verifyTaxRates, EpochStateSnapshot } from "./epoch-reader";
import { SwapVerificationResult } from "./reporter";

/**
 * Verify that VRF-derived tax rates are correctly set and would be
 * applied to swaps via the Tax Program.
 *
 * This is a state-level verification (not an actual swap) because:
 * - The Tax Program reads EpochState at swap time via CPI
 * - Integration tests (Phase 32) already verified the Tax→Epoch CPI chain
 * - The full swap requires ~15 accounts + Transfer Hook setup
 * - Phase 36 will do end-to-end swap testing on devnet
 *
 * What we verify here:
 * - EpochState has been updated by VRF (taxesConfirmed=true)
 * - Tax rates are non-zero and within spec bands
 * - Per-token tax assignments match cheap_side logic
 * - The rates would be read correctly by the Tax Program
 *
 * @returns SwapVerificationResult with pass/fail and details
 */
export async function verifyTaxRateAppliedToSwap(
  epochProgram: Program,
  epochStatePda: PublicKey
): Promise<SwapVerificationResult> {
  console.log("  [swap] Verifying VRF-derived tax rates are set for swaps...");

  let snapshot: EpochStateSnapshot;
  try {
    snapshot = await readEpochState(epochProgram, epochStatePda);
  } catch (e) {
    return {
      passed: false,
      expectedTaxBps: 0,
      actualTaxBps: 0,
      pool: "N/A",
      swapSig: "N/A (state verification only)",
      details: `Failed to read EpochState: ${e}`,
    };
  }

  // Check 1: Taxes must be confirmed (VRF consumed)
  if (!snapshot.taxesConfirmed) {
    return {
      passed: false,
      expectedTaxBps: 0,
      actualTaxBps: 0,
      pool: "N/A",
      swapSig: "N/A (state verification only)",
      details: "taxesConfirmed is false -- VRF has not been consumed yet",
    };
  }

  // Check 2: Full tax rate verification
  const verification = verifyTaxRates(snapshot);
  if (!verification.valid) {
    return {
      passed: false,
      expectedTaxBps: snapshot.lowTaxBps,
      actualTaxBps: snapshot.crimeBuyTaxBps,
      pool: "state verification",
      swapSig: "N/A (state verification only)",
      details: `Tax rate verification failed: ${verification.errors.join("; ")}`,
    };
  }

  // Check 3: Non-zero rates
  if (snapshot.lowTaxBps === 0 || snapshot.highTaxBps === 0) {
    return {
      passed: false,
      expectedTaxBps: 0,
      actualTaxBps: 0,
      pool: "state verification",
      swapSig: "N/A (state verification only)",
      details: "Tax rates are zero -- VRF may not have updated them",
    };
  }

  // All checks passed
  const details = [
    `Tax Program reads EpochState dynamically at swap time.`,
    `Current rates: low=${snapshot.lowTaxBps}bps, high=${snapshot.highTaxBps}bps.`,
    `CheapSide: ${snapshot.cheapSide}.`,
    `CRIME: buy=${snapshot.crimeBuyTaxBps}bps sell=${snapshot.crimeSellTaxBps}bps.`,
    `FRAUD: buy=${snapshot.fraudBuyTaxBps}bps sell=${snapshot.fraudSellTaxBps}bps.`,
    `Verified by state read. Full swap testing deferred to Phase 36.`,
  ].join(" ");

  console.log(`  [swap] Rates verified: low=${snapshot.lowTaxBps}bps, high=${snapshot.highTaxBps}bps, cheapSide=${snapshot.cheapSide}`);
  console.log("  [swap] Note: Full swap CPI verification deferred to Phase 36 (E2E Devnet Testing)");

  return {
    passed: true,
    expectedTaxBps: snapshot.lowTaxBps,
    actualTaxBps: snapshot.lowTaxBps,
    pool: "state verification (full swap CPI deferred to Phase 36)",
    swapSig: "N/A (state verification only)",
    details,
  };
}
