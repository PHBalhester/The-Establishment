/**
 * Health response shape builders -- extracted for testability.
 *
 * The health endpoint collects diagnostics (postgres, solana RPC, ws-subscriber,
 * credit stats) then either returns the full payload (authenticated) or a
 * stripped version (public). These pure functions define those response shapes.
 *
 * Phase 108: Public response stripped to prevent information disclosure (zAuth + H047).
 */

export interface HealthDiagnostics {
  postgres: boolean;
  solanaRpc: boolean;
  wsSubscriber: unknown;
  credits: unknown;
}

export interface PublicHealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
}

export interface AuthenticatedHealthResponse extends PublicHealthResponse {
  checks: { postgres: boolean; solanaRpc: boolean };
  wsSubscriber: unknown;
  credits: unknown;
}

/**
 * Compute overall health status from dependency checks.
 */
export function computeStatus(postgres: boolean, solanaRpc: boolean): "ok" | "degraded" {
  return postgres && solanaRpc ? "ok" : "degraded";
}

/**
 * Build the public health response (no secret or wrong secret).
 * Only exposes status and timestamp -- no internal diagnostics.
 */
export function buildPublicResponse(status: "ok" | "degraded"): PublicHealthResponse {
  return {
    status,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build the authenticated health response (correct HEALTH_SECRET).
 * Includes full diagnostic payload for monitoring dashboards.
 */
export function buildAuthenticatedResponse(
  status: "ok" | "degraded",
  diagnostics: HealthDiagnostics,
): AuthenticatedHealthResponse {
  return {
    status,
    checks: { postgres: diagnostics.postgres, solanaRpc: diagnostics.solanaRpc },
    wsSubscriber: diagnostics.wsSubscriber,
    credits: diagnostics.credits,
    timestamp: new Date().toISOString(),
  };
}
