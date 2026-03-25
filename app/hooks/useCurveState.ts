"use client";

/**
 * useCurveState -- SSE-powered hook for both CurveState PDAs
 *
 * Reads CRIME and FRAUD CurveState data from useProtocolState (SSE delivery).
 * BigInt fields (tokensSold, solRaised, etc.) arrive as native bigint via
 * the bigintReviver installed in useProtocolState's JSON.parse.
 *
 * Retains a thin refresh() RPC path (DD-5 Option B) for post-transaction
 * freshness — called by launch/page.tsx onTxConfirmed. Routine updates
 * come exclusively from SSE; no polling, no browser WS subscriptions.
 *
 * Source: programs/bonding_curve/src/state.rs
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { getBondingCurveProgram } from "@/lib/anchor";
import { DEVNET_CURVE_PDAS } from "@/lib/protocol-config";
import { useProtocolState } from "@/hooks/useProtocolState";

/** Curve status as a normalized string (from Anchor enum object) */
export type CurveStatus =
  | "initialized"
  | "active"
  | "filled"
  | "failed"
  | "graduated";

/** Extracted CurveState fields with appropriate TypeScript types. */
export interface CurveStateData {
  /** Mint address (base58) */
  tokenMint: string;
  /** Token vault PDA (base58) */
  tokenVault: string;
  /** SOL vault PDA (base58) */
  solVault: string;
  /** Total tokens currently sold in base units (bigint for curve-math) */
  tokensSold: bigint;
  /** Total SOL raised from buys in lamports (bigint for curve-math) */
  solRaised: bigint;
  /** Curve lifecycle status */
  status: CurveStatus;
  /** Slot when curve started (0 if not started) */
  startSlot: number;
  /** Deadline slot (start_slot + DEADLINE_SLOTS) */
  deadlineSlot: number;
  /** Number of unique purchasers */
  participantCount: number;
  /** Cumulative tokens returned via sells (bigint) */
  tokensReturned: bigint;
  /** Cumulative SOL returned to sellers, gross before tax (bigint) */
  solReturned: bigint;
  /** Cumulative sell tax collected (bigint) */
  taxCollected: bigint;
  /** Tax escrow PDA address (base58) */
  taxEscrow: string;
  /** Whether tax escrow has been consolidated for refunds */
  escrowConsolidated: boolean;
}

export interface UseCurveStateResult {
  /** CRIME curve state (null until loaded) */
  crime: CurveStateData | null;
  /** FRAUD curve state (null until loaded) */
  fraud: CurveStateData | null;
  /** True while initial fetch is in progress */
  loading: boolean;
  /** Error message from most recent failure, or null */
  error: string | null;
  /** Force an immediate RPC re-fetch of both curves */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a BN-or-bigint-or-number field to bigint.
 * BN objects have a toString() method that produces the decimal string.
 */
function toBigInt(
  val: bigint | number | { toString(): string },
): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") return BigInt(val);
  return BigInt(val.toString());
}

/**
 * Parse Anchor enum status object into normalized string.
 * Anchor deserializes enums as objects like { active: {} } or { filled: {} }.
 * Also handles numeric form (0=Initialized, 1=Active, etc.).
 */
function parseStatus(
  status: Record<string, unknown> | number,
): CurveStatus {
  if (typeof status === "number") {
    const map: CurveStatus[] = [
      "initialized",
      "active",
      "filled",
      "failed",
      "graduated",
    ];
    return map[status] ?? "initialized";
  }

  if ("active" in status) return "active";
  if ("filled" in status) return "filled";
  if ("failed" in status) return "failed";
  if ("graduated" in status) return "graduated";
  if ("initialized" in status) return "initialized";

  return "initialized";
}

/**
 * Extract CurveStateData from a raw Anchor-decoded account (refresh() path).
 * BN objects are converted to BigInt; PublicKeys to base58 strings.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCurveState(decoded: any): CurveStateData {
  return {
    tokenMint: decoded.tokenMint.toBase58(),
    tokenVault: decoded.tokenVault.toBase58(),
    solVault: decoded.solVault.toBase58(),
    tokensSold: toBigInt(decoded.tokensSold),
    solRaised: toBigInt(decoded.solRaised),
    status: parseStatus(decoded.status),
    startSlot:
      typeof decoded.startSlot === "number"
        ? decoded.startSlot
        : decoded.startSlot.toNumber(),
    deadlineSlot:
      typeof decoded.deadlineSlot === "number"
        ? decoded.deadlineSlot
        : decoded.deadlineSlot.toNumber(),
    participantCount: decoded.participantCount,
    tokensReturned: toBigInt(decoded.tokensReturned),
    solReturned: toBigInt(decoded.solReturned),
    taxCollected: toBigInt(decoded.taxCollected),
    taxEscrow: decoded.taxEscrow.toBase58(),
    escrowConsolidated: decoded.escrowConsolidated,
  };
}

/**
 * Extract CurveStateData from SSE-delivered data (anchorToJson + bigintReviver output).
 * BigInt fields arrive as native bigint (bigintReviver reconstituted from __bigint tags).
 * String fields arrive as base58 strings (anchorToJson converted from PublicKey).
 * Number fields arrive as plain numbers (anchorToJson converted from BN).
 */
function extractFromSse(data: Record<string, unknown>): CurveStateData | null {
  if (!data || typeof data.participantCount !== "number") return null;

  return {
    tokenMint: data.tokenMint as string,
    tokenVault: data.tokenVault as string,
    solVault: data.solVault as string,
    tokensSold: typeof data.tokensSold === "bigint" ? data.tokensSold : BigInt(0),
    solRaised: typeof data.solRaised === "bigint" ? data.solRaised : BigInt(0),
    status: parseStatus(data.status as Record<string, unknown> | number),
    startSlot: data.startSlot as number,
    deadlineSlot: data.deadlineSlot as number,
    participantCount: data.participantCount as number,
    tokensReturned: typeof data.tokensReturned === "bigint" ? data.tokensReturned : BigInt(0),
    solReturned: typeof data.solReturned === "bigint" ? data.solReturned : BigInt(0),
    taxCollected: typeof data.taxCollected === "bigint" ? data.taxCollected : BigInt(0),
    taxEscrow: data.taxEscrow as string,
    escrowConsolidated: data.escrowConsolidated as boolean,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCurveState(): UseCurveStateResult {
  const { crimeCurve, fraudCurve } = useProtocolState();

  // SSE path: extract CurveStateData from protocol state
  const crime = useMemo(
    () => (crimeCurve ? extractFromSse(crimeCurve) : null),
    [crimeCurve],
  );
  const fraud = useMemo(
    () => (fraudCurve ? extractFromSse(fraudCurve) : null),
    [fraudCurve],
  );

  // DD-5 Option B: refresh() as thin RPC fetch for post-TX freshness
  const [rpcCrime, setRpcCrime] = useState<CurveStateData | null>(null);
  const [rpcFraud, setRpcFraud] = useState<CurveStateData | null>(null);

  // D6: loading = no data from either SSE or RPC fallback yet
  const loading =
    (crimeCurve === null && rpcCrime === null) ||
    (fraudCurve === null && rpcFraud === null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auto-fetch via RPC on mount if SSE hasn't delivered within 3s.
  // SSE depends on Helius webhook being registered for the bonding curve
  // program — if not configured, curve data would never load without this.
  const initialFetchDone = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!initialFetchDone.current && (crimeCurve === null || fraudCurve === null)) {
        initialFetchDone.current = true;
        refresh();
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear RPC override only when SSE delivers VALID decoded data.
  // The RPC polling fallback in useProtocolState stores raw account info
  // (lamports/owner/dataLength) that lacks Anchor-decoded fields. If we
  // cleared the RPC override whenever crimeCurve was merely truthy, we'd
  // lose our last good data source when polling overwrites decoded state
  // with raw metadata. Only clear when extractFromSse can actually parse it.
  useEffect(() => {
    if (crime) setRpcCrime(null);
  }, [crime]);
  useEffect(() => {
    if (fraud) setRpcFraud(null);
  }, [fraud]);

  const refresh = useCallback(async () => {
    try {
      const program = getBondingCurveProgram();
      const [crimeState, fraudState] = await Promise.all([
        program.account.curveState.fetch(DEVNET_CURVE_PDAS.crime.curveState),
        program.account.curveState.fetch(DEVNET_CURVE_PDAS.fraud.curveState),
      ]);
      if (!mountedRef.current) return;
      setRpcCrime(extractCurveState(crimeState));
      setRpcFraud(extractCurveState(fraudState));
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Re-fetch via RPC when tab becomes visible again (SSE drops on background)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return {
    crime: rpcCrime ?? crime,
    fraud: rpcFraud ?? fraud,
    loading,
    error,
    refresh,
  };
}
