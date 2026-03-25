/**
 * Debug endpoint: Reset SSE connection slots for caller's IP
 *
 * Flushes ghost connections that were never properly released.
 * Temporary -- remove after fixing the underlying release mechanism.
 */

import { releaseConnection, getSnapshot } from "@/lib/sse-connections";
import { getClientIp } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const callerIp = getClientIp(req);
  const before = getSnapshot();
  const count = before.perIp[callerIp] ?? 0;

  // Release all slots for this IP
  for (let i = 0; i < count; i++) {
    releaseConnection(callerIp);
  }

  const after = getSnapshot();

  return Response.json({
    callerIp,
    released: count,
    before: before.perIp[callerIp] ?? 0,
    after: after.perIp[callerIp] ?? 0,
    globalCount: after.globalCount,
  });
}
