/**
 * H011: Slot-monotonic freshness check tests.
 *
 * Tests the slot tracking logic and the freshness decision function
 * that the webhook handler uses to reject stale replays.
 *
 * We can't import ProtocolStore directly because it pulls in sse-manager
 * (which requires Next.js runtime). Instead, we test the freshness logic
 * in isolation using the same Map-based pattern and the exact decision
 * function from handleAccountChanges().
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Replicate the slot tracking interface from ProtocolStore ────────────
// This mirrors the exact lastSlots Map + getLastSlot/setLastSlot from
// protocol-store.ts so we can test the logic without importing SSE deps.

class SlotTracker {
  private lastSlots = new Map<string, number>();

  getLastSlot(pubkey: string): number {
    return this.lastSlots.get(pubkey) ?? 0;
  }

  setLastSlot(pubkey: string, slot: number): void {
    this.lastSlots.set(pubkey, slot);
  }
}

// ── Replicate the exact freshness check from handleAccountChanges() ─────
// This is a 1:1 copy of the decision logic in route.ts so we can verify
// it handles all edge cases correctly.

function shouldAccept(
  tracker: SlotTracker,
  pubkey: string,
  incomingSlot: number | undefined,
): boolean {
  const slot = incomingSlot ?? 0;
  if (slot > 0) {
    const lastSlot = tracker.getLastSlot(pubkey);
    if (slot < lastSlot) return false; // rejected — stale replay
  }
  return true; // accepted
}

describe("H011 slot-monotonic freshness", () => {
  let tracker: SlotTracker;

  beforeEach(() => {
    tracker = new SlotTracker();
  });

  // ── Basic slot tracking ─────────────────────────────────────────────

  describe("SlotTracker", () => {
    it("returns 0 for unseen accounts", () => {
      expect(tracker.getLastSlot("unknownPubkey")).toBe(0);
    });

    it("stores and retrieves a slot", () => {
      tracker.setLastSlot("acc1", 100);
      expect(tracker.getLastSlot("acc1")).toBe(100);
    });

    it("overwrites with higher slot", () => {
      tracker.setLastSlot("acc1", 100);
      tracker.setLastSlot("acc1", 200);
      expect(tracker.getLastSlot("acc1")).toBe(200);
    });

    it("tracks per-account independently", () => {
      tracker.setLastSlot("accA", 100);
      tracker.setLastSlot("accB", 500);
      expect(tracker.getLastSlot("accA")).toBe(100);
      expect(tracker.getLastSlot("accB")).toBe(500);
    });
  });

  // ── Freshness decision logic ────────────────────────────────────────

  describe("shouldAccept (mirrors webhook handler logic)", () => {
    it("accepts first webhook for an account (watermark = 0)", () => {
      expect(shouldAccept(tracker, "acc", 100)).toBe(true);
    });

    it("accepts same-slot update (multiple TXs in one slot)", () => {
      tracker.setLastSlot("acc", 100);
      expect(shouldAccept(tracker, "acc", 100)).toBe(true);
    });

    it("accepts newer slot", () => {
      tracker.setLastSlot("acc", 100);
      expect(shouldAccept(tracker, "acc", 200)).toBe(true);
    });

    it("REJECTS older slot (stale replay)", () => {
      tracker.setLastSlot("acc", 200);
      expect(shouldAccept(tracker, "acc", 100)).toBe(false);
    });

    it("REJECTS replay that is just 1 slot behind", () => {
      tracker.setLastSlot("acc", 200);
      expect(shouldAccept(tracker, "acc", 199)).toBe(false);
    });

    it("gracefully degrades when slot is undefined (no Helius slot)", () => {
      tracker.setLastSlot("acc", 200);
      expect(shouldAccept(tracker, "acc", undefined)).toBe(true);
    });

    it("gracefully degrades when slot is 0", () => {
      tracker.setLastSlot("acc", 200);
      expect(shouldAccept(tracker, "acc", 0)).toBe(true);
    });

    it("rejects replay after batchSeed sets high watermark", () => {
      // Simulates batchSeed setting watermark to current on-chain slot
      tracker.setLastSlot("epochState", 350_000_000);

      // Attacker replays from slot 340M → rejected
      expect(shouldAccept(tracker, "epochState", 340_000_000)).toBe(false);

      // Real webhook from slot 350M+1 → accepted
      expect(shouldAccept(tracker, "epochState", 350_000_001)).toBe(true);
    });

    it("accepts slot 1 on cold start without batchSeed", () => {
      // No batchSeed ran — watermark is 0 for all accounts
      expect(shouldAccept(tracker, "acc", 1)).toBe(true);
    });
  });

  // ── Sequence simulation ─────────────────────────────────────────────

  describe("realistic webhook sequence", () => {
    it("processes a normal ascending sequence correctly", () => {
      const pubkey = "EpochStatePDA";
      const slots = [100, 105, 110, 115, 120];

      for (const slot of slots) {
        expect(shouldAccept(tracker, pubkey, slot)).toBe(true);
        tracker.setLastSlot(pubkey, slot);
      }

      expect(tracker.getLastSlot(pubkey)).toBe(120);
    });

    it("rejects replayed payloads interleaved with real ones", () => {
      const pubkey = "PoolStatePDA";

      // Real webhook slot 100 → accepted
      expect(shouldAccept(tracker, pubkey, 100)).toBe(true);
      tracker.setLastSlot(pubkey, 100);

      // Real webhook slot 200 → accepted
      expect(shouldAccept(tracker, pubkey, 200)).toBe(true);
      tracker.setLastSlot(pubkey, 200);

      // Attacker replays slot 100 → REJECTED
      expect(shouldAccept(tracker, pubkey, 100)).toBe(false);

      // Attacker replays slot 150 → REJECTED (still < 200)
      expect(shouldAccept(tracker, pubkey, 150)).toBe(false);

      // Real webhook slot 300 → accepted
      expect(shouldAccept(tracker, pubkey, 300)).toBe(true);
      tracker.setLastSlot(pubkey, 300);

      expect(tracker.getLastSlot(pubkey)).toBe(300);
    });

    it("handles multiple accounts independently during replay attack", () => {
      tracker.setLastSlot("poolA", 200);
      tracker.setLastSlot("poolB", 300);

      // Replay poolA slot 100 → rejected
      expect(shouldAccept(tracker, "poolA", 100)).toBe(false);

      // Real poolB slot 400 → accepted
      expect(shouldAccept(tracker, "poolB", 400)).toBe(true);

      // poolA is unaffected by poolB's update
      expect(tracker.getLastSlot("poolA")).toBe(200);
    });
  });
});
