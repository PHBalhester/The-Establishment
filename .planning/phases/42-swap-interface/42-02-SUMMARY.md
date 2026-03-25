# Plan 42-02 Summary: SOL Swap Form & UI

## Status: COMPLETE (checkpoint approved)

## What was built
- **swap-builders.ts**: Transaction builders for SOL buy and SOL sell, 20 named accounts each matching on-chain SwapSolBuy/SwapSolSell structs
- **useSwap.ts**: Full swap lifecycle hook (idle -> building -> signing -> sending -> confirming -> confirmed/failed), debounced quoting, slippage config, priority fees
- **SwapForm.tsx**: Single-component swap form with token selectors, amount inputs, fee breakdown, slippage config
- **TokenSelector.tsx, FeeBreakdown.tsx, SlippageConfig.tsx, SwapStatus.tsx**: Supporting UI components
- **/swap page**: Next.js route with swap form

## Bugs fixed during live testing
1. **Browser Buffer polyfill**: `writeBigUInt64LE` not available in npm buffer v6.x. Rewrote hook-resolver.ts to use manual PDA derivation.
2. **Privy RPC config**: Added `config.solana.rpcs` with CAIP-2 key `"solana:devnet"` (NOT `"devnet"`). Added `@solana/kit` dependency.
3. **Privy chain param**: Added `chain: "solana:devnet"` to signTransaction calls.
4. **SwapAuthority PDA**: Fixed incorrect derivation from AMM to Tax Program in both shared/constants.ts and pda-manifest.ts.

## Verification
- Buy + Sell for CRIME/SOL: PASS (Privy wallet)
- Buy + Sell for FRAUD/SOL: PASS (Privy wallet)
- Buy + Sell for CRIME/SOL: PASS (Phantom external wallet)
- Buy + Sell for FRAUD/SOL: PASS (Phantom external wallet)

## Commits
- `d04a938`: SOL swap transaction builders and useSwap hook
- `694af67`: Swap UI components and /swap page
- `340c7f1`: Fix browser swap failures (Privy RPC, hook resolver, PDA)

## Artifacts created
- Docs/mainnet-checklist.md: Comprehensive devnet->mainnet switch points
