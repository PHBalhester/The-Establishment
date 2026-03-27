import { describe, it, expect } from "vitest";
import {
  getClientIp,
  RPC_RATE_LIMIT,
  HEALTH_RATE_LIMIT,
  SEND_TX_RATE_LIMIT,
  SIMULATE_TX_RATE_LIMIT,
} from "../rate-limit";

/** Helper to create a minimal Request with specific headers */
function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost", {
    headers: new Headers(headers),
  });
}

describe("getClientIp", () => {
  // ── x-forwarded-for extraction ────────────────────────────────────────

  describe("x-forwarded-for extraction", () => {
    it("extracts rightmost IP from multi-hop x-forwarded-for", () => {
      const req = makeRequest({
        "x-forwarded-for": "1.1.1.1, 10.0.0.1, 203.0.113.50",
      });
      expect(getClientIp(req)).toBe("203.0.113.50");
    });

    it("handles single IP in x-forwarded-for", () => {
      const req = makeRequest({ "x-forwarded-for": "203.0.113.50" });
      expect(getClientIp(req)).toBe("203.0.113.50");
    });

    it("trims whitespace from IPs", () => {
      const req = makeRequest({
        "x-forwarded-for": " 1.1.1.1 , 203.0.113.50 ",
      });
      expect(getClientIp(req)).toBe("203.0.113.50");
    });

    it("handles IPv6 in x-forwarded-for", () => {
      const req = makeRequest({
        "x-forwarded-for": "::1, 2001:db8::1",
      });
      expect(getClientIp(req)).toBe("2001:db8::1");
    });
  });

  // ── Fallbacks ─────────────────────────────────────────────────────────

  describe("fallbacks", () => {
    it("falls back to x-real-ip when x-forwarded-for absent", () => {
      const req = makeRequest({ "x-real-ip": "10.0.0.1" });
      expect(getClientIp(req)).toBe("10.0.0.1");
    });

    it("returns 'unknown' when no IP headers present", () => {
      const req = makeRequest({});
      expect(getClientIp(req)).toBe("unknown");
    });
  });

  // ── Regression: leftmost NOT used ─────────────────────────────────────

  describe("regression: leftmost NOT used", () => {
    it("does NOT return leftmost IP (attacker-controlled)", () => {
      const req = makeRequest({
        "x-forwarded-for": "ATTACKER_SPOOFED, 10.0.0.1, 203.0.113.50",
      });
      expect(getClientIp(req)).not.toBe("ATTACKER_SPOOFED");
      expect(getClientIp(req)).toBe("203.0.113.50");
    });
  });
});

// ── Per-method rate limit profiles (Phase 108) ────────────────────────

describe("per-method rate limit profiles", () => {
  it("HEALTH_RATE_LIMIT: 30 requests per 60s window", () => {
    expect(HEALTH_RATE_LIMIT.maxRequests).toBe(30);
    expect(HEALTH_RATE_LIMIT.windowMs).toBe(60_000);
  });

  it("SEND_TX_RATE_LIMIT: 10 requests per 60s window", () => {
    expect(SEND_TX_RATE_LIMIT.maxRequests).toBe(10);
    expect(SEND_TX_RATE_LIMIT.windowMs).toBe(60_000);
  });

  it("SIMULATE_TX_RATE_LIMIT: 20 requests per 60s window", () => {
    expect(SIMULATE_TX_RATE_LIMIT.maxRequests).toBe(20);
    expect(SIMULATE_TX_RATE_LIMIT.windowMs).toBe(60_000);
  });

  it("RPC_RATE_LIMIT regression: still 300 requests per 60s window", () => {
    expect(RPC_RATE_LIMIT.maxRequests).toBe(300);
    expect(RPC_RATE_LIMIT.windowMs).toBe(60_000);
  });
});
