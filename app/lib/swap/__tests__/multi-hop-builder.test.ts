/**
 * Multi-Hop Builder: Amount Chaining Tests
 *
 * Tests the core logic in buildAtomicRoute() — specifically how input amounts
 * are chained between steps and how split route leg boundaries are detected.
 *
 * These tests mock the transaction builders (buildSolBuyTransaction, etc.)
 * to capture the exact amounts passed to each step, without needing RPC.
 *
 * Route types tested:
 * 1. Direct 1-hop (SOL -> CRIME)
 * 2. 2-hop buy (SOL -> CRIME -> PROFIT)
 * 3. 2-hop sell (PROFIT -> CRIME -> SOL)
 * 4. 4-step split buy (SOL -> PROFIT via both factions)
 * 5. 4-step split sell (PROFIT -> SOL via both factions) — the failing TX
 * 6. Exact replica of the failed mainnet TX amounts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Transaction, PublicKey, Connection } from "@solana/web3.js";
import type { Route, RouteStep } from "../route-types";

// ---------------------------------------------------------------------------
// Mock swap-builders to capture the amounts passed to each step
// ---------------------------------------------------------------------------

interface CapturedStep {
  type: "solBuy" | "solSell" | "vaultConvert";
  inputAmount: number;
  minimumOutput: number;
  isCrime?: boolean;
}

const capturedSteps: CapturedStep[] = [];

vi.mock("../swap-builders", () => ({
  buildSolBuyTransaction: vi.fn(async (params: any) => {
    capturedSteps.push({
      type: "solBuy",
      inputAmount: params.amountInLamports,
      minimumOutput: params.minimumOutput,
      isCrime: params.isCrime,
    });
    return new Transaction();
  }),
  buildSolSellTransaction: vi.fn(async (params: any) => {
    capturedSteps.push({
      type: "solSell",
      inputAmount: params.amountInBaseUnits,
      minimumOutput: params.minimumOutput,
      isCrime: params.isCrime,
    });
    return new Transaction();
  }),
  buildVaultConvertTransaction: vi.fn(async (params: any) => {
    capturedSteps.push({
      type: "vaultConvert",
      inputAmount: params.amountInBaseUnits,
      minimumOutput: params.minimumOutput,
    });
    return new Transaction();
  }),
}));

// Mock protocol-config (MINTS and PROTOCOL_ALT)
vi.mock("@/lib/protocol-config", () => ({
  MINTS: {
    CRIME: new PublicKey("HL3rCRTFBo3qMPs5obAKVAnqSgCuuRDiGe2SA6Baoath"),
    FRAUD: new PublicKey("4ugXuC2PsfRUPSEY3xwjWFQf8NjBLS1ybAqQR4gqawtq"),
    PROFIT: new PublicKey("GtxTnLCF2vDxhGbrjWGGS3Xr2EjGRFi6546RcRrmpump"),
  },
  PROTOCOL_ALT: "7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h",
}));

// Mock confirm-transaction
vi.mock("@/lib/confirm-transaction", () => ({
  pollTransactionConfirmation: vi.fn(),
}));

// Mock error-map
vi.mock("./error-map", () => ({
  parseSwapError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock connection that returns a fake ALT and blockhash
// ---------------------------------------------------------------------------

function createMockConnection(): Connection {
  return {
    getAddressLookupTable: vi.fn().mockResolvedValue({
      value: {
        key: new PublicKey("7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h"),
        state: { addresses: [] },
        isActive: () => true,
      },
    }),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "FakeBlockhash111111111111111111111111111111111",
      lastValidBlockHeight: 999999,
    }),
  } as unknown as Connection;
}

// ---------------------------------------------------------------------------
// Import buildAtomicRoute AFTER mocks are set up
// ---------------------------------------------------------------------------

// We need to import dynamically after mocks
const { buildAtomicRoute } = await import("../multi-hop-builder");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLIPPAGE_BPS = 100; // 1%
// Deterministic throwaway address for tests (not a real user wallet)
const USER = new PublicKey("GRFKrvKo3g1oYSBkhugFrF3hMz4bNSj2nYVnMnF3hPkT");

/** Build a Route with computed minimumOutput from slippage */
function makeRoute(
  inputToken: string,
  outputToken: string,
  inputAmount: number,
  outputAmount: number,
  steps: RouteStep[],
  isSplit = false,
  splitRatio?: [number, number],
): Route {
  const minimumOutput = Math.floor(
    outputAmount * (10_000 - SLIPPAGE_BPS) / 10_000,
  );
  return {
    inputToken: inputToken as any,
    outputToken: outputToken as any,
    inputAmount,
    outputAmount,
    minimumOutput,
    steps,
    hops: steps.length,
    isSplit,
    splitRatio,
    label: "test",
    totalLpFee: 0,
    totalTax: 0,
    totalPriceImpactBps: 0,
    totalFeePct: "0%",
  };
}

function step(
  pool: string,
  inputToken: string,
  outputToken: string,
  inputAmount: number,
  outputAmount: number,
): RouteStep {
  return {
    pool,
    inputToken: inputToken as any,
    outputToken: outputToken as any,
    inputAmount,
    outputAmount,
    lpFeeBps: 0,
    taxBps: 0,
    priceImpactBps: 0,
  };
}

/** Compute expected minimumOutput with slippage */
function withSlippage(amount: number): number {
  return Math.floor(amount * (10_000 - SLIPPAGE_BPS) / 10_000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAtomicRoute amount chaining", () => {
  const conn = createMockConnection();

  beforeEach(() => {
    capturedSteps.length = 0;
  });

  // =========================================================================
  // 1. Direct 1-hop: SOL -> CRIME
  // =========================================================================

  it("direct 1-hop: passes step amounts unchanged", async () => {
    const route = makeRoute("SOL", "CRIME", 100_000_000, 450_000_000, [
      step("CRIME/SOL", "SOL", "CRIME", 100_000_000, 450_000_000),
    ]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(1);
    expect(capturedSteps[0].type).toBe("solBuy");
    expect(capturedSteps[0].inputAmount).toBe(100_000_000);
    expect(capturedSteps[0].minimumOutput).toBe(withSlippage(450_000_000));
  });

  // =========================================================================
  // 2. Direct 1-hop: CRIME -> SOL
  // =========================================================================

  it("direct 1-hop sell: passes step amounts unchanged", async () => {
    const route = makeRoute("CRIME", "SOL", 450_000_000, 80_000_000, [
      step("CRIME/SOL", "CRIME", "SOL", 450_000_000, 80_000_000),
    ]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(1);
    expect(capturedSteps[0].type).toBe("solSell");
    expect(capturedSteps[0].inputAmount).toBe(450_000_000);
    expect(capturedSteps[0].minimumOutput).toBe(withSlippage(80_000_000));
  });

  // =========================================================================
  // 3. 2-hop buy: SOL -> CRIME -> PROFIT
  // =========================================================================

  it("2-hop buy: step 2 input = step 1 minimumOutput (safe chaining)", async () => {
    const route = makeRoute("SOL", "PROFIT", 100_000_000, 4_500_000, [
      step("CRIME/SOL", "SOL", "CRIME", 100_000_000, 450_000_000),
      step("CRIME/Vault", "CRIME", "PROFIT", 450_000_000, 4_500_000),
    ]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(2);

    // Step 1: SOL buy — original input
    expect(capturedSteps[0].type).toBe("solBuy");
    expect(capturedSteps[0].inputAmount).toBe(100_000_000);

    // Step 2: vault convert — gets step 1's minimumOutput, NOT the quoted 450M
    const step1MinOutput = withSlippage(450_000_000);
    expect(capturedSteps[1].type).toBe("vaultConvert");
    expect(capturedSteps[1].inputAmount).toBe(step1MinOutput);
    // This is the ~1% leak — step 2 converts only 99% of step 1's expected output
    expect(capturedSteps[1].inputAmount).toBeLessThan(450_000_000);
  });

  // =========================================================================
  // 4. 2-hop sell: PROFIT -> CRIME -> SOL
  // =========================================================================

  it("2-hop sell: step 2 input = step 1 minimumOutput (safe chaining)", async () => {
    const route = makeRoute("PROFIT", "SOL", 4_500_000, 80_000_000, [
      step("CRIME/Vault", "PROFIT", "CRIME", 4_500_000, 450_000_000),
      step("CRIME/SOL", "CRIME", "SOL", 450_000_000, 80_000_000),
    ]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(2);

    // Step 1: vault convert — original PROFIT input
    expect(capturedSteps[0].type).toBe("vaultConvert");
    expect(capturedSteps[0].inputAmount).toBe(4_500_000);

    // Step 2: AMM sell — gets step 1's minimumOutput
    const step1MinOutput = withSlippage(450_000_000);
    expect(capturedSteps[1].type).toBe("solSell");
    expect(capturedSteps[1].inputAmount).toBe(step1MinOutput);
  });

  // =========================================================================
  // 5. 4-step split buy: SOL -> PROFIT (via CRIME + FRAUD)
  //    Steps: [buy CRIME, convert CRIME→PROFIT, buy FRAUD, convert FRAUD→PROFIT]
  //    Legs:  [--- leg 1 ---]                    [--- leg 2 ---]
  // =========================================================================

  it("split buy: leg 2 starts fresh, does NOT inherit leg 1 output", async () => {
    const route = makeRoute("SOL", "PROFIT", 200_000_000, 9_000_000, [
      step("CRIME/SOL", "SOL", "CRIME", 120_000_000, 540_000_000),
      step("CRIME/Vault", "CRIME", "PROFIT", 540_000_000, 5_400_000),
      step("FRAUD/SOL", "SOL", "FRAUD", 80_000_000, 360_000_000),
      step("FRAUD/Vault", "FRAUD", "PROFIT", 360_000_000, 3_600_000),
    ], true, [60, 40]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(4);

    // Leg 1, step 0: SOL buy CRIME — original input
    expect(capturedSteps[0].type).toBe("solBuy");
    expect(capturedSteps[0].inputAmount).toBe(120_000_000);

    // Leg 1, step 1: vault convert — gets step 0's minimumOutput
    const step0MinOutput = withSlippage(540_000_000);
    expect(capturedSteps[1].type).toBe("vaultConvert");
    expect(capturedSteps[1].inputAmount).toBe(step0MinOutput);

    // Leg 2, step 2: SOL buy FRAUD — FRESH start, uses its own inputAmount
    // NOT step 1's minimumOutput (which would be PROFIT amount, wrong token!)
    expect(capturedSteps[2].type).toBe("solBuy");
    expect(capturedSteps[2].inputAmount).toBe(80_000_000);

    // Leg 2, step 3: vault convert — gets step 2's minimumOutput
    const step2MinOutput = withSlippage(360_000_000);
    expect(capturedSteps[3].type).toBe("vaultConvert");
    expect(capturedSteps[3].inputAmount).toBe(step2MinOutput);
  });

  // =========================================================================
  // 6. 4-step split sell: PROFIT -> SOL (via CRIME + FRAUD)
  //    Steps: [vault PROFIT→CRIME, sell CRIME→SOL, vault PROFIT→FRAUD, sell FRAUD→SOL]
  //    Legs:  [-------- leg 1 --------]           [-------- leg 2 --------]
  //
  //    THIS IS THE EXACT PATTERN THAT FAILED ON MAINNET.
  //    Old code: step 2 (vault PROFIT→FRAUD) got step 1's SOL output — WRONG.
  //    Fixed code: step 2 starts a new leg, uses its own PROFIT inputAmount.
  // =========================================================================

  it("split sell: leg 2 starts fresh, does NOT inherit leg 1 SOL output", async () => {
    const route = makeRoute("PROFIT", "SOL", 9_000_000, 160_000_000, [
      step("CRIME/Vault", "PROFIT", "CRIME", 5_400_000, 540_000_000),
      step("CRIME/SOL", "CRIME", "SOL", 540_000_000, 96_000_000),
      step("FRAUD/Vault", "PROFIT", "FRAUD", 3_600_000, 360_000_000),
      step("FRAUD/SOL", "FRAUD", "SOL", 360_000_000, 64_000_000),
    ], true, [60, 40]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(4);

    // Leg 1, step 0: vault convert PROFIT→CRIME — original input
    expect(capturedSteps[0].type).toBe("vaultConvert");
    expect(capturedSteps[0].inputAmount).toBe(5_400_000);

    // Leg 1, step 1: sell CRIME→SOL — gets step 0's minimumOutput
    const step0MinOutput = withSlippage(540_000_000);
    expect(capturedSteps[1].type).toBe("solSell");
    expect(capturedSteps[1].inputAmount).toBe(step0MinOutput);

    // Leg 2, step 2: vault convert PROFIT→FRAUD — FRESH start
    // CRITICAL: must be 3_600_000 (PROFIT), NOT step 1's SOL minimumOutput
    expect(capturedSteps[2].type).toBe("vaultConvert");
    expect(capturedSteps[2].inputAmount).toBe(3_600_000);
    // Verify it's not contaminated by step 1's SOL output
    const step1MinOutput = withSlippage(96_000_000);
    expect(capturedSteps[2].inputAmount).not.toBe(step1MinOutput);

    // Leg 2, step 3: sell FRAUD→SOL — gets step 2's minimumOutput
    const step2MinOutput = withSlippage(360_000_000);
    expect(capturedSteps[3].type).toBe("solSell");
    expect(capturedSteps[3].inputAmount).toBe(step2MinOutput);
  });

  // =========================================================================
  // 7. Regression: old code would chain step 1 SOL into step 2 PROFIT
  //    Verify the exact failure mode is prevented
  // =========================================================================

  it("split sell: step 2 input is NEVER step 1 minimumOutput", async () => {
    // Large asymmetric split to make the mismatch obvious
    const route = makeRoute("PROFIT", "SOL", 10_000_000, 200_000_000, [
      step("CRIME/Vault", "PROFIT", "CRIME", 7_000_000, 700_000_000),
      step("CRIME/SOL", "CRIME", "SOL", 700_000_000, 140_000_000),
      step("FRAUD/Vault", "PROFIT", "FRAUD", 3_000_000, 300_000_000),
      step("FRAUD/SOL", "FRAUD", "SOL", 300_000_000, 60_000_000),
    ], true, [70, 30]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    // Step 1 (sell CRIME→SOL) minimumOutput
    const step1SolMin = withSlippage(140_000_000);

    // Step 2 (vault PROFIT→FRAUD) should NOT receive step 1's SOL output
    expect(capturedSteps[2].inputAmount).toBe(3_000_000); // own PROFIT amount
    expect(capturedSteps[2].inputAmount).not.toBe(step1SolMin); // not SOL
    expect(capturedSteps[2].inputAmount).not.toBe(140_000_000); // not SOL unslipped
  });

  // =========================================================================
  // 8. Mainnet TX replica: approximate amounts from the failed transaction
  //    TX: 3Jf8mggE... (slot 408790772)
  //    Convert 122 PROFIT→CRIME, sell CRIME→SOL (OK)
  //    Convert ~15.62 PROFIT→FRAUD, sell FRAUD→SOL (FAILED)
  // =========================================================================

  it("mainnet TX replica: split sell with real-ish amounts succeeds", async () => {
    // Approximate amounts from the failed TX (base units, 9 decimals for tokens, 9 for SOL)
    // PROFIT has 6 decimals, CRIME/FRAUD have 6 decimals
    // Conversion: vault rate is 100:1 (100 faction = 1 PROFIT)
    const route = makeRoute("PROFIT", "SOL", 137_620_000, 260_000_000, [
      // Leg 1: 122 PROFIT → 12200 CRIME → SOL
      step("CRIME/Vault", "PROFIT", "CRIME", 122_000_000, 12_200_000_000),
      step("CRIME/SOL", "CRIME", "SOL", 12_200_000_000, 168_000_000),
      // Leg 2: 15.62 PROFIT → 1562 FRAUD → SOL
      step("FRAUD/Vault", "PROFIT", "FRAUD", 15_620_000, 1_562_000_000),
      step("FRAUD/SOL", "FRAUD", "SOL", 1_562_000_000, 92_000_000),
    ], true, [89, 11]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(4);

    // Leg 1: vault converts 122M PROFIT (original amount)
    expect(capturedSteps[0].inputAmount).toBe(122_000_000);
    // Leg 1: sell uses vault's minimumOutput
    expect(capturedSteps[1].inputAmount).toBe(withSlippage(12_200_000_000));

    // Leg 2: vault converts 15.62M PROFIT (its own amount, NOT leg 1's SOL)
    expect(capturedSteps[2].inputAmount).toBe(15_620_000);
    // Leg 2: sell uses vault's minimumOutput
    expect(capturedSteps[3].inputAmount).toBe(withSlippage(1_562_000_000));

    // The OLD bug: step 2 would have received step 1's SOL minimumOutput
    const oldBugValue = withSlippage(168_000_000);
    expect(capturedSteps[2].inputAmount).not.toBe(oldBugValue);
  });

  // =========================================================================
  // 9. Non-split routes should NOT trigger leg boundary detection
  // =========================================================================

  it("non-split 2-hop: step 2 always chains from step 1 (no leg reset)", async () => {
    // PROFIT -> CRIME -> SOL (non-split, both tokens start with PROFIT/SOL)
    const route = makeRoute("PROFIT", "SOL", 5_000_000, 80_000_000, [
      step("CRIME/Vault", "PROFIT", "CRIME", 5_000_000, 500_000_000),
      step("CRIME/SOL", "CRIME", "SOL", 500_000_000, 80_000_000),
    ], false); // NOT split

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(2);

    // Step 2 chains from step 1's minimumOutput (not its own quoted input)
    const step1MinOutput = withSlippage(500_000_000);
    expect(capturedSteps[1].inputAmount).toBe(step1MinOutput);
    expect(capturedSteps[1].inputAmount).not.toBe(500_000_000);
  });

  // =========================================================================
  // 10. 2-hop sell via FRAUD (covers other faction path)
  // =========================================================================

  it("2-hop sell via FRAUD: same chaining as CRIME path", async () => {
    const route = makeRoute("PROFIT", "SOL", 4_500_000, 75_000_000, [
      step("FRAUD/Vault", "PROFIT", "FRAUD", 4_500_000, 450_000_000),
      step("FRAUD/SOL", "FRAUD", "SOL", 450_000_000, 75_000_000),
    ]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    expect(capturedSteps).toHaveLength(2);
    expect(capturedSteps[0].inputAmount).toBe(4_500_000);

    const step1MinOutput = withSlippage(450_000_000);
    expect(capturedSteps[1].inputAmount).toBe(step1MinOutput);
  });

  // =========================================================================
  // 11. Higher slippage = more intermediate token leak (expected behavior)
  // =========================================================================

  it("5% slippage: step 2 gets 95% of step 1 output (larger leak)", async () => {
    const highSlippageRoute: Route = {
      inputToken: "SOL",
      outputToken: "PROFIT",
      inputAmount: 1_000_000_000,
      outputAmount: 45_000_000,
      minimumOutput: Math.floor(45_000_000 * 9_500 / 10_000), // 5% slippage
      steps: [
        step("CRIME/SOL", "SOL", "CRIME", 1_000_000_000, 4_500_000_000),
        step("CRIME/Vault", "CRIME", "PROFIT", 4_500_000_000, 45_000_000),
      ],
      hops: 2,
      isSplit: false,
      label: "test",
      totalLpFee: 0,
      totalTax: 0,
      totalPriceImpactBps: 0,
      totalFeePct: "0%",
    };

    await buildAtomicRoute(highSlippageRoute, conn, USER, 10_000);

    // With 5% slippage, step 2 should get 95% of step 1's output
    const expected = Math.floor(4_500_000_000 * 9_500 / 10_000);
    expect(capturedSteps[1].inputAmount).toBe(expected);
    expect(capturedSteps[1].inputAmount).toBe(4_275_000_000);
  });

  // =========================================================================
  // 12. Split buy with equal 50/50 split
  // =========================================================================

  it("split buy 50/50: both legs independent with correct amounts", async () => {
    const route = makeRoute("SOL", "PROFIT", 200_000_000, 9_000_000, [
      step("CRIME/SOL", "SOL", "CRIME", 100_000_000, 450_000_000),
      step("CRIME/Vault", "CRIME", "PROFIT", 450_000_000, 4_500_000),
      step("FRAUD/SOL", "SOL", "FRAUD", 100_000_000, 450_000_000),
      step("FRAUD/Vault", "FRAUD", "PROFIT", 450_000_000, 4_500_000),
    ], true, [50, 50]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    // Both leg starts get their own input
    expect(capturedSteps[0].inputAmount).toBe(100_000_000);
    expect(capturedSteps[2].inputAmount).toBe(100_000_000);

    // Both leg step-2s get their respective step-1's minimumOutput
    const minOutput = withSlippage(450_000_000);
    expect(capturedSteps[1].inputAmount).toBe(minOutput);
    expect(capturedSteps[3].inputAmount).toBe(minOutput);
  });

  // =========================================================================
  // 13. Split sell with highly asymmetric split (95/5)
  // =========================================================================

  it("split sell 95/5: tiny leg 2 still gets correct PROFIT amount", async () => {
    const route = makeRoute("PROFIT", "SOL", 10_000_000, 180_000_000, [
      step("CRIME/Vault", "PROFIT", "CRIME", 9_500_000, 950_000_000),
      step("CRIME/SOL", "CRIME", "SOL", 950_000_000, 171_000_000),
      step("FRAUD/Vault", "PROFIT", "FRAUD", 500_000, 50_000_000),
      step("FRAUD/SOL", "FRAUD", "SOL", 50_000_000, 9_000_000),
    ], true, [95, 5]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    // Leg 2 step 2 (vault): gets 500_000 PROFIT (its tiny slice), NOT step 1's SOL
    expect(capturedSteps[2].inputAmount).toBe(500_000);
    expect(capturedSteps[2].inputAmount).not.toBe(withSlippage(171_000_000));

    // Leg 2 step 3 (sell): gets step 2's minimumOutput
    expect(capturedSteps[3].inputAmount).toBe(withSlippage(50_000_000));
  });

  // =========================================================================
  // 14. Verify minimumOutput is always <= outputAmount (sanity check)
  // =========================================================================

  it("minimumOutput never exceeds outputAmount for any step", async () => {
    const route = makeRoute("PROFIT", "SOL", 9_000_000, 160_000_000, [
      step("CRIME/Vault", "PROFIT", "CRIME", 5_000_000, 500_000_000),
      step("CRIME/SOL", "CRIME", "SOL", 500_000_000, 100_000_000),
      step("FRAUD/Vault", "PROFIT", "FRAUD", 4_000_000, 400_000_000),
      step("FRAUD/SOL", "FRAUD", "SOL", 400_000_000, 60_000_000),
    ], true, [56, 44]);

    await buildAtomicRoute(route, conn, USER, 10_000);

    for (const captured of capturedSteps) {
      expect(captured.minimumOutput).toBeLessThanOrEqual(captured.inputAmount * 1000);
      expect(captured.minimumOutput).toBeGreaterThan(0);
    }
  });
});
