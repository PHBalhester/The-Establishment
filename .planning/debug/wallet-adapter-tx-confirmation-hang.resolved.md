---
status: verifying
trigger: "wallet-adapter-tx-confirmation-hang: After migrating from Privy to wallet-adapter-react, all TXs hang at confirmation and expire"
created: 2026-02-27T00:00:00Z
updated: 2026-02-27T00:03:00Z
---

## Current Focus

hypothesis: CONFIRMED -- wallet-adapter's StandardWalletAdapter uses Phantom's signAndSendTransaction, which sends TX via Phantom's RPC (not our Helius RPC). TX never lands on-chain from our perspective.
test: Fix applied -- switched to signTransaction + sendRawTransaction in useProtocolWallet.ts
expecting: TXs now submit via our Helius RPC. User needs to test swap/staking flow in browser.
next_action: User manual verification -- connect Phantom on devnet, attempt swap, verify TX confirms

## Symptoms

expected: After approving a swap/staking TX in Phantom popup, TX confirms within seconds, UI shows "confirmed"
actual: Phantom popup appears, user approves, popup closes. sendTransaction() returns valid signature. TX never lands on-chain. Blockhash expires after ~20s.
errors: "Transaction expired: block height exceeded lastValidBlockHeight" / confirmTransaction hangs indefinitely via websocket
reproduction: Connect Phantom on devnet, attempt any swap, approve in popup, TX never confirms
started: Immediately after DBS Phase 1 migration from Privy to wallet-adapter-react

## Eliminated

- hypothesis: Chain detection is wrong (getChainForEndpoint returns mainnet for our Helius URL)
  evidence: getChainForEndpoint uses regex /\bdevnet\b/i which matches "devnet.helius-rpc.com". Returns "solana:devnet" correctly.
  timestamp: 2026-02-27T00:00:30Z

- hypothesis: prepareTransaction overwrites our blockhash with one from a different context
  evidence: prepareTransaction only sets blockhash if not already set (adapter.ts line 112-119). Our code sets it before calling sendTransaction, so it's a no-op.
  timestamp: 2026-02-27T00:00:40Z

- hypothesis: Connection mismatch between providers.tsx ConnectionProvider and getConnection() singleton
  evidence: Both use identical URL from NEXT_PUBLIC_RPC_URL / DEVNET_RPC_URL. Same Helius endpoint.
  timestamp: 2026-02-27T00:00:50Z

## Evidence

- timestamp: 2026-02-27T00:00:20Z
  checked: StandardWalletAdapter.sendTransaction() source code (adapter.ts lines 256-351)
  found: When Phantom supports SolanaSignAndSendTransaction feature (which it does), the adapter calls Phantom's signAndSendTransaction. Phantom both signs AND sends the TX via its own internal RPC. It does NOT use our Connection/Helius RPC for submission.
  implication: TX submission is delegated entirely to Phantom's infrastructure. We have no control over which RPC actually submits the TX.

- timestamp: 2026-02-27T00:00:25Z
  checked: Old Privy flow vs new wallet-adapter flow
  found: OLD: build TX -> wallet.signTransaction() (sign only) -> connection.sendRawTransaction() (WE send to Helius) -> confirmTransaction. NEW: build TX -> wallet.sendTransaction() -> StandardWalletAdapter calls Phantom's signAndSendTransaction (Phantom signs AND sends via its own RPC) -> we try to confirm via our Helius RPC.
  implication: The migration changed WHO submits the TX. Old = us (Helius). New = Phantom (unknown RPC).

- timestamp: 2026-02-27T00:00:35Z
  checked: StandardWalletAdapter fallback path (SolanaSignTransaction feature, lines 323-341)
  found: When feature === SolanaSignTransaction (sign-only), the adapter does wallet.signTransaction() -> connection.sendRawTransaction() -- exactly matching old Privy flow. But Phantom supports both features and signAndSendTransaction takes priority (lines 266-282).
  implication: The fix is to bypass sendTransaction entirely and use signTransaction + sendRawTransaction directly.

- timestamp: 2026-02-27T00:00:55Z
  checked: useWallet() exposes signTransaction for Phantom
  found: WalletProviderBase.tsx line 208-217: signTransaction is exposed when adapter supports it. Phantom supports SolanaSignTransaction. TypeScript compiles with the new flow.
  implication: Safe to use signTransaction + sendRawTransaction pattern.

- timestamp: 2026-02-27T00:02:00Z
  checked: TypeScript compilation and Next.js build
  found: Both pass cleanly with the fix applied. No type errors, no build errors.
  implication: Fix is safe to deploy.

## Resolution

root_cause: wallet-adapter's StandardWalletAdapter.sendTransaction() delegates TX submission to Phantom's signAndSendTransaction feature, which sends the TX via Phantom's own internal RPC endpoint instead of our Helius devnet RPC. The TX is either dropped or not propagated by Phantom's RPC. The signature returned is pre-computed from signing (the TX hash), not confirmation of network submission. Our polling on Helius RPC never finds the TX because it was never successfully submitted through a reliable path.

fix: Changed useProtocolWallet.ts to use sign-then-send pattern: (1) call useWallet().signTransaction() to get wallet to sign only (single popup), (2) serialize the signed TX, (3) call connection.sendRawTransaction() to submit via our Helius RPC. This gives us full control over TX submission, matching the old Privy flow. Updated stale comments in useSwap.ts, useStaking.ts, multi-hop-builder.ts, and confirm-transaction.ts.

verification: TypeScript compiles clean. Next.js build succeeds. Awaiting manual browser test (connect Phantom on devnet, attempt swap, verify TX confirms).

files_changed:
- app/hooks/useProtocolWallet.ts (core fix: sign-then-send pattern)
- app/hooks/useSwap.ts (comment update)
- app/hooks/useStaking.ts (comment update)
- app/lib/swap/multi-hop-builder.ts (comment update)
- app/lib/confirm-transaction.ts (comment update)
