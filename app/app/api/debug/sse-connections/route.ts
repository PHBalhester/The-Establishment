/**
 * Debug endpoint: SSE connection state snapshot
 *
 * Returns current connection counts per IP and globally.
 * Temporary -- remove after diagnosing the 429 issue.
 */

import { getSnapshot } from "@/lib/sse-connections";
import { getClientIp } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const snapshot = getSnapshot();
  const callerIp = getClientIp(req);

  return Response.json({
    callerIp,
    ...snapshot,
    headers: {
      "x-envoy-external-address": req.headers.get("x-envoy-external-address"),
      "x-forwarded-for": req.headers.get("x-forwarded-for"),
      "x-real-ip": req.headers.get("x-real-ip"),
    },
  });
}
