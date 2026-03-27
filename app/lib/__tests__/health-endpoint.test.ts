import { describe, it, expect } from "vitest";
import {
  computeStatus,
  buildPublicResponse,
  buildAuthenticatedResponse,
} from "../health-response";

// ── computeStatus ─────────────────────────────────────────────────────

describe("computeStatus", () => {
  it("returns 'ok' when both postgres and solanaRpc are healthy", () => {
    expect(computeStatus(true, true)).toBe("ok");
  });

  it("returns 'degraded' when postgres is down", () => {
    expect(computeStatus(false, true)).toBe("degraded");
  });

  it("returns 'degraded' when solanaRpc is down", () => {
    expect(computeStatus(true, false)).toBe("degraded");
  });

  it("returns 'degraded' when both are down", () => {
    expect(computeStatus(false, false)).toBe("degraded");
  });

  it("only ever returns 'ok' or 'degraded'", () => {
    const allCombinations = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const;

    for (const [pg, rpc] of allCombinations) {
      const result = computeStatus(pg, rpc);
      expect(["ok", "degraded"]).toContain(result);
    }
  });
});

// ── buildPublicResponse ───────────────────────────────────────────────

describe("buildPublicResponse (public / no secret)", () => {
  it("returns only 'status' and 'timestamp' keys", () => {
    const response = buildPublicResponse("ok");
    const keys = Object.keys(response).sort();
    expect(keys).toEqual(["status", "timestamp"]);
  });

  it("does NOT include checks, wsSubscriber, or credits", () => {
    const response = buildPublicResponse("ok") as Record<string, unknown>;
    expect(response).not.toHaveProperty("checks");
    expect(response).not.toHaveProperty("wsSubscriber");
    expect(response).not.toHaveProperty("credits");
  });

  it("includes a valid ISO timestamp", () => {
    const response = buildPublicResponse("ok");
    expect(response.timestamp).toBeDefined();
    // ISO 8601 format check: parseable and not NaN
    const parsed = new Date(response.timestamp).getTime();
    expect(parsed).not.toBeNaN();
  });

  it("forwards 'degraded' status correctly", () => {
    const response = buildPublicResponse("degraded");
    expect(response.status).toBe("degraded");
  });

  it("forwards 'ok' status correctly", () => {
    const response = buildPublicResponse("ok");
    expect(response.status).toBe("ok");
  });
});

// ── buildAuthenticatedResponse ────────────────────────────────────────

describe("buildAuthenticatedResponse (secret-gated)", () => {
  const diagnostics = {
    postgres: true,
    solanaRpc: false,
    wsSubscriber: { connected: true, subscriptions: 5 },
    credits: { used: 100, remaining: 900 },
  };

  it("includes checks, wsSubscriber, credits, status, and timestamp", () => {
    const response = buildAuthenticatedResponse("degraded", diagnostics);
    const keys = Object.keys(response).sort();
    expect(keys).toEqual(["checks", "credits", "status", "timestamp", "wsSubscriber"]);
  });

  it("includes checks with postgres and solanaRpc booleans", () => {
    const response = buildAuthenticatedResponse("degraded", diagnostics);
    expect(response.checks).toEqual({ postgres: true, solanaRpc: false });
  });

  it("includes wsSubscriber diagnostic data", () => {
    const response = buildAuthenticatedResponse("degraded", diagnostics);
    expect(response.wsSubscriber).toEqual({ connected: true, subscriptions: 5 });
  });

  it("includes credits diagnostic data", () => {
    const response = buildAuthenticatedResponse("degraded", diagnostics);
    expect(response.credits).toEqual({ used: 100, remaining: 900 });
  });

  it("includes a valid ISO timestamp", () => {
    const response = buildAuthenticatedResponse("ok", diagnostics);
    const parsed = new Date(response.timestamp).getTime();
    expect(parsed).not.toBeNaN();
  });

  it("forwards status correctly", () => {
    const ok = buildAuthenticatedResponse("ok", diagnostics);
    expect(ok.status).toBe("ok");
    const degraded = buildAuthenticatedResponse("degraded", diagnostics);
    expect(degraded.status).toBe("degraded");
  });
});
