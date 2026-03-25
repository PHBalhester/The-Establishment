/**
 * Health Check Endpoint -- /api/health
 *
 * Two responsibilities, separated by HTTP status vs response body:
 *
 * 1. **Container liveness** (HTTP status): Always 200 if Next.js can serve
 *    requests. This is what Railway's healthcheck uses to decide whether to
 *    keep or kill the container. A running Next.js process that can respond
 *    to HTTP is alive -- downstream dependency failures don't change that.
 *
 * 2. **Dependency health** (response body): Reports connectivity to Postgres
 *    and Solana RPC. Monitoring dashboards / alerts read the body to detect
 *    degraded state. Each check runs independently so one failure doesn't
 *    mask the other.
 *
 * Returns (always 200):
 *   { status: "ok"|"degraded", checks: { postgres, solanaRpc }, timestamp }
 */

import { NextResponse } from "next/server";
import { captureException } from "@/lib/sentry";
import { sql } from "drizzle-orm";
import { db } from "@/db/connection";
import { getConnection } from "@/lib/connection";
import { getStatus as getWsSubscriberStatus } from "@/lib/ws-subscriber";
import { creditCounter } from "@/lib/credit-counter";
import { protocolStore } from "@/lib/protocol-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let postgres = false;
  let solanaRpc = false;

  // -- Postgres check --
  try {
    await db.execute(sql`SELECT 1`);
    postgres = true;
  } catch (err) {
    console.error("[health] Postgres check failed:", err);
    captureException(err instanceof Error ? err : new Error(`[health] Postgres check failed: ${err}`));
  }

  // -- Solana RPC check (prefer cached slot to save 1 credit/check) --
  try {
    const cachedSlot = protocolStore.getAccountState("__slot");
    if (cachedSlot && typeof cachedSlot.slot === "number") {
      solanaRpc = true;
    } else {
      // ws-subscriber not running or no __slot yet — fall back to RPC
      const connection = getConnection();
      await connection.getSlot();
      solanaRpc = true;
    }
  } catch (err) {
    console.error("[health] Solana RPC check failed:", err);
    captureException(err instanceof Error ? err : new Error(`[health] Solana RPC check failed: ${err}`));
  }

  const status = postgres && solanaRpc ? "ok" : "degraded";

  const wsSubscriber = getWsSubscriberStatus();
  const credits = creditCounter.getStats();

  return NextResponse.json({
    status,
    checks: { postgres, solanaRpc },
    wsSubscriber,
    credits,
    timestamp: new Date().toISOString(),
  });
}
