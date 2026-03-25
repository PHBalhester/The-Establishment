# VERIFY-H048: Sign-Then-Send Bypasses Wallet Simulation
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
No changes to `app/hooks/useProtocolWallet.ts` since last round. Still uses `signTransaction()` + `sendRawTransaction()` pattern instead of `signAndSendTransaction`.

## Assessment
Accepted risk. This is a deliberate workaround for Phantom's broken devnet `signAndSendTransaction` (documented in MEMORY.md). Phantom sends via its own RPC which silently drops devnet transactions. Will be revisited for mainnet where Phantom's RPC is more reliable.
