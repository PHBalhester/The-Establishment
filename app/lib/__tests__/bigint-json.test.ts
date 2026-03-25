import { describe, it, expect } from "vitest";
import { bigintReplacer, bigintReviver } from "../bigint-json";

/** Round-trip helper: stringify with replacer, parse with reviver. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, bigintReplacer), bigintReviver) as T;
}

describe("bigint-json", () => {
  it("round-trips small BigInt (42n)", () => {
    expect(roundTrip(42n)).toBe(42n);
  });

  it("round-trips value beyond 2^53 (9007199254740993n)", () => {
    const value = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
    expect(roundTrip(value)).toBe(value);
  });

  it("round-trips u128 max (340282366920938463463374607431768211455n)", () => {
    const u128Max = 340282366920938463463374607431768211455n;
    expect(roundTrip(u128Max)).toBe(u128Max);
  });

  it("round-trips zero (0n)", () => {
    expect(roundTrip(0n)).toBe(0n);
  });

  it("round-trips mixed object with BigInt, number, and string", () => {
    const obj = { name: "test", amount: 42n, count: 7 };
    const result = roundTrip(obj);
    expect(result.name).toBe("test");
    expect(result.amount).toBe(42n);
    expect(result.count).toBe(7);
  });

  it("round-trips nested object with BigInt at depth > 1", () => {
    const obj = { outer: { inner: 99n } };
    const result = roundTrip(obj);
    expect(result.outer.inner).toBe(99n);
  });

  it("round-trips array with BigInts", () => {
    const arr = [1n, 2n, 3n];
    const result = roundTrip(arr);
    expect(result).toEqual([1n, 2n, 3n]);
  });

  it("revives literal __bigint tag (known trade-off, not a false positive)", () => {
    // If a real data object contains { __bigint: "42" } as a value, the
    // reviver treats it as a BigInt tag. This is the known Risk 1 from
    // the DBS CONTEXT doc. Acceptable because __bigint is not a
    // Solana/Anchor convention and no protocol fields use this pattern.
    const json = JSON.stringify({ value: { __bigint: "42" } });
    const parsed = JSON.parse(json, bigintReviver) as { value: unknown };
    expect(parsed.value).toBe(42n);
  });
});
