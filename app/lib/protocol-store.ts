/**
 * Protocol Account State Store -- In-Memory Cache for Protocol PDAs
 *
 * Stores the latest account state for protocol singleton PDAs (EpochState,
 * PoolState, StakePool, CarnageFundState, CurveState) as received from
 * Helius Enhanced Webhooks.
 *
 * Data flow:
 * 1. Helius delivers account change notification to POST /api/webhooks/helius
 * 2. Webhook handler parses the account data and calls setAccountState()
 * 3. setAccountState() updates the in-memory cache AND broadcasts via SSE
 * 4. Connected SSE clients (useProtocolState hook) receive the update
 *
 * Why in-memory:
 * Railway runs a single Next.js process for devnet (no horizontal scaling).
 * Same reasoning as sse-manager.ts. If we ever need multi-process support,
 * we'd add Redis -- but that's overkill for single-process devnet.
 *
 * The globalThis singleton pattern survives Next.js hot reloads in development.
 */

import { sseManager } from "@/lib/sse-manager";
import { bigintReplacer } from "@/lib/bigint-json";

// =============================================================================
// Types
// =============================================================================

/** Raw account data stored by pubkey. Shape depends on the account type. */
export type AccountState = Record<string, unknown>;

// =============================================================================
// Protocol Store Class
// =============================================================================

export class ProtocolStore {
  private accounts = new Map<string, AccountState>();
  private lastSerialized = new Map<string, string>();

  /**
   * H011: Slot-monotonic freshness watermark per account.
   *
   * Tracks the highest Solana slot number seen for each account via
   * Helius enhanced webhooks. The webhook handler rejects payloads
   * with a slot older than the last accepted slot — blocking replay
   * attacks that inject stale protocol state into the SSE pipeline.
   *
   * Seeded during batchSeed() with the current on-chain slot so that
   * replays of pre-startup data are rejected immediately.
   */
  private lastSlots = new Map<string, number>();

  /** Get the last accepted slot for an account (0 if never seen). */
  getLastSlot(pubkey: string): number {
    return this.lastSlots.get(pubkey) ?? 0;
  }

  /** Update the slot watermark after accepting a webhook payload. */
  setLastSlot(pubkey: string, slot: number): void {
    this.lastSlots.set(pubkey, slot);
  }

  /**
   * Update the cached state for a protocol account and broadcast via SSE.
   *
   * Keys can be Base58 pubkeys (real accounts) or synthetic keys prefixed
   * with `__` (e.g., `__supply:CRIME`, `__slot`). Both flow through the
   * same `protocol-update` SSE event type.
   *
   * Includes a dedup guard: if the serialized data is identical to the
   * last broadcast for this key, the update is stored but not broadcast.
   *
   * @param pubkey - Base58 public key or synthetic key
   * @param data - Parsed account data object
   */
  setAccountState(pubkey: string, data: AccountState): void {
    const serialized = JSON.stringify(data, bigintReplacer);
    this.accounts.set(pubkey, data);

    // Dedup: skip broadcast if data hasn't changed
    if (serialized === this.lastSerialized.get(pubkey)) return;
    this.lastSerialized.set(pubkey, serialized);

    sseManager.broadcast("protocol-update", {
      account: pubkey,
      data,
    });
  }

  /**
   * Store account data and update dedup baseline WITHOUT broadcasting.
   *
   * Used during batch initialization (instrumentation.ts) to seed the
   * store before SSE clients connect. Updates the dedup timestamp so
   * future writes have a baseline to compare against.
   *
   * @param pubkey - Base58 public key or synthetic key
   * @param data - Parsed account data object
   */
  setAccountStateQuiet(pubkey: string, data: AccountState): void {
    this.accounts.set(pubkey, data);
    this.lastSerialized.set(pubkey, JSON.stringify(data, bigintReplacer));
  }

  /**
   * Get the cached state for a specific account.
   *
   * @param pubkey - Base58 public key or synthetic key
   * @returns Cached account data, or undefined if not yet received
   */
  getAccountState(pubkey: string): AccountState | undefined {
    return this.accounts.get(pubkey);
  }

  /**
   * Get all cached account states as a plain object.
   * Used to send initial snapshot to new SSE clients.
   *
   * Returns both real account keys (Base58 pubkeys) and synthetic
   * `__`-prefixed keys. Consumers that want only real accounts should
   * filter by prefix.
   *
   * @returns Object mapping key -> account data
   */
  getAllAccountStates(): Record<string, AccountState> {
    const result: Record<string, AccountState> = {};
    for (const [key, value] of this.accounts) {
      result[key] = value;
    }
    return result;
  }
}

// =============================================================================
// Singleton Instance
//
// globalThis cache survives Next.js hot reloads in dev mode.
// Same pattern as sse-manager.ts and db/connection.ts.
// =============================================================================

const globalForStore = globalThis as unknown as {
  protocolStore: ProtocolStore | undefined;
};

export const protocolStore =
  globalForStore.protocolStore ?? new ProtocolStore();

globalForStore.protocolStore = protocolStore;
