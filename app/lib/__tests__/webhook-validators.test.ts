import { describe, it, expect } from "vitest";
import { validateDecodedAccount } from "../webhook-validators";

describe("validateDecodedAccount", () => {
  // ── EpochState ──────────────────────────────────────────────────────────

  describe("EpochState", () => {
    it("accepts valid EpochState with all BPS in [0, 10000]", () => {
      expect(
        validateDecodedAccount("EpochState", {
          crimeBuyTaxBps: 500,
          crimeSellTaxBps: 300,
          fraudBuyTaxBps: 200,
          fraudSellTaxBps: 100,
          lowTaxBps: 50,
          highTaxBps: 9999,
        }),
      ).toBe(true);
    });

    it("rejects EpochState with BPS > 10000", () => {
      expect(
        validateDecodedAccount("EpochState", { crimeBuyTaxBps: 10001 }),
      ).toBe(false);
    });

    it("rejects EpochState with negative BPS", () => {
      expect(
        validateDecodedAccount("EpochState", { fraudSellTaxBps: -1 }),
      ).toBe(false);
    });

    it("accepts EpochState at boundary values (0 and 10000)", () => {
      expect(
        validateDecodedAccount("EpochState", {
          crimeBuyTaxBps: 0,
          crimeSellTaxBps: 10000,
          fraudBuyTaxBps: 0,
          fraudSellTaxBps: 10000,
          lowTaxBps: 0,
          highTaxBps: 10000,
        }),
      ).toBe(true);
    });

    it("accepts EpochState with missing optional fields", () => {
      expect(
        validateDecodedAccount("EpochState", { crimeBuyTaxBps: 500 }),
      ).toBe(true);
    });
  });

  // ── PoolState ───────────────────────────────────────────────────────────

  describe("PoolState", () => {
    it("accepts valid PoolState with positive reserves", () => {
      expect(
        validateDecodedAccount("PoolState:CRIME_SOL", {
          reserveA: 1000,
          reserveB: 2000,
          feeNumerator: 25,
          feeDenominator: 10000,
        }),
      ).toBe(true);
    });

    it("accepts PoolState with zero reserves (during init)", () => {
      expect(
        validateDecodedAccount("PoolState:FRAUD_SOL", {
          reserveA: 0,
          reserveB: 0,
          feeNumerator: 25,
          feeDenominator: 10000,
        }),
      ).toBe(true);
    });

    it("rejects PoolState with negative reserveA", () => {
      expect(
        validateDecodedAccount("PoolState:CRIME_SOL", { reserveA: -1 }),
      ).toBe(false);
    });

    it("rejects PoolState with zero feeDenominator", () => {
      expect(
        validateDecodedAccount("PoolState:CRIME_SOL", { feeDenominator: 0 }),
      ).toBe(false);
    });

    it("accepts PoolState with __bigint tagged reserves", () => {
      expect(
        validateDecodedAccount("PoolState:CRIME_SOL", {
          reserveA: { __bigint: "1000000000" },
          reserveB: { __bigint: "2000000000" },
          feeDenominator: 10000,
        }),
      ).toBe(true);
    });
  });

  // ── CarnageFundState ────────────────────────────────────────────────────

  describe("CarnageFundState", () => {
    it("accepts valid CarnageFundState with non-negative balances", () => {
      expect(
        validateDecodedAccount("CarnageFundState", {
          solBalance: 100,
          tokenBalance: 200,
        }),
      ).toBe(true);
    });

    it("rejects CarnageFundState with negative balance", () => {
      expect(
        validateDecodedAccount("CarnageFundState", { solBalance: -1 }),
      ).toBe(false);
    });
  });

  // ── StakePool ───────────────────────────────────────────────────────────

  describe("StakePool", () => {
    it("accepts valid StakePool", () => {
      expect(
        validateDecodedAccount("StakePool", {
          totalStaked: 5000,
          rewardsPerTokenStored: { __bigint: "999999999" },
        }),
      ).toBe(true);
    });

    it("rejects StakePool with negative totalStaked", () => {
      expect(
        validateDecodedAccount("StakePool", { totalStaked: -100 }),
      ).toBe(false);
    });

    it("accepts StakePool with zero values", () => {
      expect(
        validateDecodedAccount("StakePool", {
          totalStaked: 0,
          rewardsPerTokenStored: 0,
        }),
      ).toBe(true);
    });
  });

  // ── CurveState ──────────────────────────────────────────────────────────

  describe("CurveState", () => {
    it("accepts valid CurveState", () => {
      expect(
        validateDecodedAccount("CurveState:CRIME", {
          currentPrice: 0.001,
          tokensSold: { __bigint: "500000000" },
          solRaised: { __bigint: "1000000" },
        }),
      ).toBe(true);
    });

    it("rejects CurveState with negative currentPrice", () => {
      expect(
        validateDecodedAccount("CurveState:CRIME", { currentPrice: -0.5 }),
      ).toBe(false);
    });
  });

  // ── Unknown labels ──────────────────────────────────────────────────────

  describe("unknown labels", () => {
    it("returns true for unknown labels (fail-open)", () => {
      expect(
        validateDecodedAccount("CarnageSolVault", { lamports: 999 }),
      ).toBe(true);
    });

    it("returns true for completely unknown labels", () => {
      expect(
        validateDecodedAccount("SomeNewAccount", { anything: "goes" }),
      ).toBe(true);
    });
  });
});
