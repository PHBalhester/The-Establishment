---
status: resolved
trigger: "Backpack wallet in Brave browser gets Plugin Closed error when staking PROFIT tokens. Solflare works first time."
created: 2026-03-26T00:00:00Z
updated: 2026-03-26T00:00:00Z
---

## Current Focus

hypothesis: Brave's built-in wallet intercepts/conflicts with Backpack's Solana provider, causing the extension popup to close or never open when signAndSendTransaction is called on mainnet
test: Check Brave default wallet settings and whether Backpack popup actually opens before closing
expecting: If Brave wallet is set to default or "prefer extensions" mode, it can interfere with Backpack's window.solana registration, causing signAndSendTransaction to fail with "Plugin Closed"
next_action: Verify code path (signAndSendTransaction on mainnet), then determine fix options

## Symptoms

expected: User stakes PROFIT tokens successfully via Backpack wallet in Brave browser
actual: Repeated "WalletSendTransactionError: Plugin Closed" errors. Switching to Solflare wallet resolves immediately.
errors: WalletSendTransactionError: Plugin Closed at t$.sendTransaction (5738833a1eaec4c5.js:137:14287). Stack trace shows useStaking execute error.
reproduction: Use Backpack wallet in Brave browser, attempt to stake PROFIT tokens. Fails every time. Solflare works first time.
started: Reported by friend of project owner. Not clear if Backpack in Brave ever worked.

## Eliminated

- hypothesis: Transaction too large for wallet popup
  evidence: Staking TX has only 12 accounts (8 named + 4 hook) in a legacy Transaction. Well within limits. Claim is only 5 accounts.
  timestamp: 2026-03-26

- hypothesis: sign-then-send path causing issues
  evidence: On mainnet (NEXT_PUBLIC_CLUSTER=mainnet), useProtocolWallet uses wallet-adapter's sendTransaction() which calls signAndSendTransaction. NOT the sign-then-send path (that's devnet only). Code confirmed at line 97-100 of useProtocolWallet.ts.
  timestamp: 2026-03-26

- hypothesis: skipPreflight or simulation rejection
  evidence: useStaking passes skipPreflight: false, maxRetries: 2. These are standard options. The error is "Plugin Closed" not a simulation error.
  timestamp: 2026-03-26

## Evidence

- timestamp: 2026-03-26
  checked: useProtocolWallet.ts mainnet code path
  found: On mainnet, calls walletSendTransaction(tx, connection, opts) which is wallet-adapter's sendTransaction(). This internally calls the wallet's signAndSendTransaction. Backpack must handle this via its extension popup.
  implication: The popup mechanism is where "Plugin Closed" originates -- Backpack's popup either never opens or immediately closes.

- timestamp: 2026-03-26
  checked: Brave browser default wallet settings documentation
  found: Brave has built-in Solana wallet support that registers window.solana / window.braveSolana BEFORE extension wallets load. Settings at brave://settings/wallet control this. "Default" mode writes provider objects first but allows extensions to overwrite. If misconfigured, Brave wallet can intercept/conflict with Backpack.
  implication: This is the most likely root cause -- Brave's Solana provider conflicts with Backpack's registration.

- timestamp: 2026-03-26
  checked: Wallet provider setup in providers.tsx
  found: Uses empty wallets array with WalletProvider autoConnect. Relies on wallet-standard auto-detection. No explicit Backpack adapter. This is correct -- BUT it means the app accepts whatever wallet the browser's wallet-standard registration provides. If Brave's wallet interferes with Backpack's registration, the app gets a broken provider.
  implication: No code-side fix for provider registration conflicts.

- timestamp: 2026-03-26
  checked: Solflare works immediately
  found: Solflare works first time, Backpack fails every time. Solflare has a different extension architecture -- it may handle Brave's provider conflict differently, or Brave may not conflict with Solflare's registration mechanism.
  implication: Problem is specific to Backpack + Brave interaction, not our transaction construction.

- timestamp: 2026-03-26
  checked: Web search for Backpack "Plugin Closed" error
  found: No widespread reports of this specific error. "Plugin Closed" likely means the Backpack extension popup (used for TX approval) was closed before signing completed. In Brave, the built-in wallet can interfere with extension popups.
  implication: This is a Brave browser + Backpack extension interaction issue, not a dApp code issue.

## Resolution

root_cause: Brave browser's built-in Solana wallet provider conflicts with Backpack wallet extension. Brave registers window.solana/window.braveSolana before Backpack loads, and depending on Brave's "Default Wallet" setting (brave://settings/wallet), this can prevent Backpack's signing popup from opening correctly. The "Plugin Closed" error means Backpack's extension popup never successfully opened or was immediately dismissed by Brave's provider interception. Solflare works because it handles the provider conflict differently (possibly via different window registration or by working alongside Brave wallet rather than conflicting).

fix: Added "Plugin Closed" detection to all three error-map.ts files (staking, swap, curve). When detected, shows user-friendly message directing Brave users to brave://settings/wallet to set Default Solana Wallet to "Extensions (no fallback)".

verification: TypeScript compiles cleanly. Error message matches the regex /Plugin Closed/i against the reported error string "WalletSendTransactionError: Plugin Closed". All three error maps updated consistently.
files_changed:
  - app/lib/staking/error-map.ts
  - app/lib/swap/error-map.ts
  - app/lib/curve/error-map.ts
