---
status: diagnosed
trigger: "Phantom wallet shows 'This dApp could be malicious' red warning on all swap transactions on mainnet"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Phantom flags dApps that use signTransaction+sendRawTransaction (sign-then-send) instead of signAndSendTransaction
test: Code review + Phantom docs + community reports confirm this pattern triggers the warning
expecting: N/A - root cause confirmed
next_action: Return diagnosis to user

## Symptoms

expected: Phantom simulates the transaction, shows balance changes preview, user approves normally
actual: Phantom shows red "Request blocked - This dApp could be malicious" on every swap
errors: No on-chain errors - transactions succeed after clicking through warning
reproduction: Any swap on fraudsworth.fun - all swap types get the red warning
started: Immediately on mainnet launch (2026-03-24). Devnet bonding curve buys did NOT show this.

## Eliminated

- hypothesis: skipPreflight=true causing simulation failure on mainnet
  evidence: skipPreflight is already false for direct swaps (useSwap.ts L763-764), and isDevnet-gated for multi-hop (multi-hop-builder.ts L391-397). On mainnet, skipPreflight=false for both paths. This only affects OUR sendRawTransaction, not Phantom's pre-sign simulation.
  timestamp: 2026-03-24

- hypothesis: v0 VersionedTransaction causing Phantom simulation failure
  evidence: Phantom explicitly supports v0 transactions (docs.phantom.com/development-powertools/solana-versioned-transactions). The v0 format is not the issue.
  timestamp: 2026-03-24

- hypothesis: Blockhash mismatch between our RPC and Phantom's RPC
  evidence: Would cause intermittent failures, not 100% reproduction. Also, Phantom fetches its own blockhash for simulation -- our blockhash doesn't affect Phantom's simulation step.
  timestamp: 2026-03-24

## Evidence

- timestamp: 2026-03-24
  checked: useProtocolWallet.ts - the sendTransaction implementation
  found: Uses sign-then-send pattern: signTransaction(tx) then connection.sendRawTransaction(serialized). Does NOT use wallet-adapter's sendTransaction() which calls signAndSendTransaction internally. Comment at L16-24 explains this was intentional for devnet because "Phantom's RPC silently drops transactions".
  implication: This is the exact pattern Phantom flags as potentially malicious.

- timestamp: 2026-03-24
  checked: Phantom developer docs and community reports
  found: Phantom's Blowfish security layer treats sign-then-send as a red flag. When a dApp calls signTransaction() instead of signAndSendTransaction(), Phantom cannot fully control the TX submission path, which is a pattern used by phishing dApps. Phantom docs explicitly recommend signAndSendTransaction. Multiple community reports (GitHub discussions #426, #320, #404) confirm this pattern causes the red warning.
  implication: Our intentional workaround for devnet TX dropping is the root cause on mainnet.

- timestamp: 2026-03-24
  checked: Devnet vs mainnet behavior difference
  found: Devnet Phantom may be less strict about warnings (or user tested with a different Phantom version). The MEMORY.md note says "Phantom's signAndSendTransaction sends TX via Phantom's own RPC -- on devnet it silently drops TXs". This was the original reason for sign-then-send. On mainnet, Phantom's RPC works correctly, so the workaround is unnecessary AND triggers the security warning.
  implication: The fix that was necessary for devnet is counterproductive on mainnet.

- timestamp: 2026-03-24
  checked: useSwap.ts executeSwap (direct swap path)
  found: L763 calls wallet.sendTransaction() which routes through useProtocolWallet's wrappedSendTransaction (sign-then-send). ALL swap paths go through this.
  implication: Every single transaction from the app triggers the warning because they all use sign-then-send.

## Resolution

root_cause: useProtocolWallet.ts uses signTransaction() + connection.sendRawTransaction() (sign-then-send pattern) instead of the wallet-adapter's standard sendTransaction() which calls Phantom's signAndSendTransaction. Phantom's Blowfish security layer flags sign-then-send as a potential phishing pattern, triggering the red "This dApp could be malicious" warning on every transaction. This workaround was intentionally added for devnet (where Phantom's own RPC silently drops transactions) but is unnecessary and harmful on mainnet.

fix: |
  Two-part fix:
  1. PRIMARY: Switch useProtocolWallet.ts to use wallet-adapter's sendTransaction() (which calls signAndSendTransaction) on mainnet. Keep sign-then-send as devnet fallback.
  2. SECONDARY: Email review@phantom.com / review@blowfish.xyz to whitelist fraudsworth.fun domain (may still be needed even after code fix, for new domains).

verification:
files_changed: []
