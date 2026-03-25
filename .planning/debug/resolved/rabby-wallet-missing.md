---
status: resolved
trigger: "Rabby wallet doesn't appear as an option in the wallet connection dialog on the production site"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Rabby wallet does not support Solana, so it cannot appear in a Solana dApp wallet list
test: Verified wallet-standard detection chain + researched Rabby's chain support
expecting: N/A - not a bug
next_action: Resolve as not-a-bug

## Symptoms

expected: Rabby wallet should appear as a selectable wallet in the connect dialog
actual: Rabby is not listed. Other wallets (Phantom etc.) do appear.
errors: None reported
reproduction: Open fraudsworth.fun, click connect wallet - Rabby not in the list
started: Not sure if it ever worked. First report now.

## Eliminated

- hypothesis: App uses explicit wallet list that excludes Rabby
  evidence: providers.tsx line 44 uses `wallets = useMemo(() => [], [])` (empty array), relying entirely on wallet-standard auto-detection. No wallets are explicitly included or excluded.
  timestamp: 2026-03-24

- hypothesis: wallet-standard auto-detection is broken or misconfigured
  evidence: WalletProvider uses useStandardWalletAdapters hook which calls DEPRECATED_getWallets() from @wallet-standard/app, listens for register/unregister events. The isWalletAdapterCompatibleStandardWallet filter requires standard:connect + standard:events + (solana:signAndSendTransaction OR solana:signTransaction). This is the correct standard pipeline and works for Phantom/Solflare/Backpack.
  timestamp: 2026-03-24

## Evidence

- timestamp: 2026-03-24
  checked: providers.tsx WalletProvider configuration
  found: Empty wallets array, fully relying on wallet-standard auto-detection. Comment on line 41-43 confirms this is intentional.
  implication: No explicit wallet filtering that could exclude Rabby

- timestamp: 2026-03-24
  checked: ConnectModal.tsx wallet display logic
  found: Filters to wallets with readyState "Installed" or "Loadable" (line 57-59). No name-based filtering.
  implication: Any wallet-standard wallet that registers as Solana-compatible will appear

- timestamp: 2026-03-24
  checked: isWalletAdapterCompatibleStandardWallet in @solana/wallet-adapter-base/lib/cjs/standard.js
  found: Requires standard:connect + standard:events + (solana:signAndSendTransaction OR solana:signTransaction). This is the gatekeeper for which wallets appear.
  implication: Only wallets advertising Solana transaction features pass through

- timestamp: 2026-03-24
  checked: Rabby wallet Solana support status (web search)
  found: Rabby is EVM-only. Supports 110+ EVM chains. Solana integration was on roadmap for Q4 2025 but has not shipped as of March 2026. GitHub issue #2585 requests Solana support.
  implication: Rabby does not register wallet-standard with Solana features, so it correctly does not appear

## Resolution

root_cause: NOT A BUG. Rabby wallet is an EVM-only wallet that does not support Solana. It therefore does not register itself via the wallet-standard protocol with Solana chain features (solana:signAndSendTransaction / solana:signTransaction). The Solana wallet adapter's isWalletAdapterCompatibleStandardWallet filter correctly excludes it. This is working as designed -- only Solana-capable wallets appear in the connect dialog.
fix: No fix needed. The app correctly shows only wallets that support Solana.
verification: N/A - not a bug
files_changed: []
