// Server-side instrumentation hook for Next.js.
// Initializes the WebSocket subscriber that feeds the protocol store
// with real-time slot, supply, and staker data from Helius.
//
// CRITICAL (Risk 3 from 2-CONTEXT.md): Unhandled exceptions in register()
// kill the Next.js server process. ALL code here MUST be wrapped in
// try/catch. A failed init means degraded (no pre-seed) but not dead.

export async function register() {
  // Only run in Node.js runtime (not Edge runtime or browser).
  // Next.js calls register() in BOTH runtimes. The Edge runtime lacks
  // Node.js WebSocket support — @solana/web3.js uses `new WebSocket()`
  // which references `window`, crashing with "window is not defined".
  if (typeof window !== "undefined") return;
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    // Dynamic import to avoid pulling server-only code into client bundles.
    // ws-subscriber imports @solana/web3.js, Anchor, etc. — heavy deps
    // that must not leak into the browser bundle.
    const { init } = await import("@/lib/ws-subscriber");
    await init();
  } catch (err) {
    // Risk 3 mitigation: log and continue. Server runs degraded
    // (protocolStore empty for non-webhook data) but doesn't crash.
    // Webhook data still flows normally. SSE clients get partial state.
    console.error("[instrumentation] ws-subscriber init failed:", err);
  }
}
