/**
 * Arc Network Protocol Subscriber (stub)
 *
 * On Arc Network, real-time state is fetched directly via viem/wagmi
 * event subscriptions and polling — there is no Solana WebSocket subscriber.
 *
 * This file is kept as a no-op so instrumentation.ts continues to load
 * without errors. Real-time contract event handling is done in the
 * client-side hooks (useTokenBalances, useEpochState, etc.) via wagmi.
 */

export async function init(): Promise<void> {
  // No-op: Arc Network uses EVM event subscriptions via wagmi on the client.
  console.log("[ws-subscriber] Arc Network mode — client-side wagmi subscriptions active.");
}
