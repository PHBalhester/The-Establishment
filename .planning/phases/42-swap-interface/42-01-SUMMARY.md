---
phase: 42-swap-interface
plan: 01
subsystem: swap-library
tags: [amm, quote-engine, error-map, wsol, hook-resolver, constants]
dependency-graph:
  requires: [phase-39-frontend-scaffold, phase-41-dashboard]
  provides: [swap-quote-engine, swap-error-map, wsol-helpers, hook-resolver, extended-pool-configs]
  affects: [42-02-swap-builders, 42-03-swap-ui]
tech-stack:
  added: ["@solana/spl-token (to shared package)"]
  patterns: [pure-library-modules, client-side-amm-math, error-code-mapping, pool-resolution]
key-files:
  created:
    - app/lib/swap/quote-engine.ts
    - app/lib/swap/error-map.ts
    - app/lib/swap/wsol.ts
    - app/lib/swap/hook-resolver.ts
  modified:
    - shared/constants.ts
    - shared/index.ts
    - shared/package.json
decisions:
  - id: D42-01-01
    decision: "Quote engine uses JavaScript number type (not BigInt) for client-side math"
    rationale: "Pool reserves and swap amounts are within safe integer range for UI display; matches existing hook patterns"
  - id: D42-01-02
    decision: "Error map uses dual lookup (Tax vs AMM) based on program ID presence in error string"
    rationale: "Error codes overlap between programs (both start at 6000); program ID in error context disambiguates"
  - id: D42-01-03
    decision: "Added @solana/spl-token as dependency to shared package (not just peer)"
    rationale: "TOKEN_PROGRAM_FOR_MINT mapping needs NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID at import time"
metrics:
  duration: ~6 minutes
  completed: 2026-02-16
---

# Phase 42 Plan 01: Swap Library Infrastructure Summary

**Client-side AMM quote engine, error mapping, WSOL helpers, hook resolver, and extended shared constants for all swap operations.**

## What Was Built

### Quote Engine (`app/lib/swap/quote-engine.ts`)

Pure client-side AMM math mirroring `programs/amm/src/helpers/math.rs` exactly. 11 exported functions:

- **3 primitives**: `calculateEffectiveInput`, `calculateSwapOutput`, `calculateTax`
- **4 forward quotes**: `quoteSolBuy`, `quoteSolSell`, `quoteProfitBuy`, `quoteProfitSell`
- **4 reverse quotes**: `reverseQuoteSolBuy`, `reverseQuoteSolSell`, `reverseQuoteProfitBuy`, `reverseQuoteProfitSell`

Forward quotes follow the exact on-chain order of operations:
- SOL Buy: tax(SOL input) -> LP fee -> AMM output
- SOL Sell: LP fee(token input) -> AMM output(SOL) -> tax(SOL output)
- PROFIT Buy/Sell: LP fee -> AMM output (no tax)

Reverse quotes unwind the math: given desired output, calculate required input using `Math.ceil` for each inverse step to ensure sufficient input.

All functions include price impact calculation in basis points.

### Error Map (`app/lib/swap/error-map.ts`)

Maps 32 Anchor error codes to human-readable UI messages:
- **14 Tax Program errors** (6000-6013): InvalidPoolType through InvalidTreasury
- **18 AMM errors** (6000-6017): Overflow through LpFeeExceedsMax

`parseSwapError()` handles 6 error patterns: Anchor format, Solana hex format, blockhash expiry, insufficient funds, transaction size, user rejection, with a catch-all fallback.

### WSOL Helpers (`app/lib/swap/wsol.ts`)

3 exported functions for SOL wrapping/unwrapping:
- `getWsolAta`: ATA derivation using TOKEN_PROGRAM_ID (not TOKEN_2022)
- `buildWsolWrapInstructions`: Create ATA (if needed) + SystemProgram.transfer + SyncNative
- `buildWsolUnwrapInstruction`: CloseAccount to recover SOL

All operations use TOKEN_PROGRAM_ID throughout -- NATIVE_MINT is owned by the original SPL Token program.

### Hook Resolver (`app/lib/swap/hook-resolver.ts`)

Ports the exact `resolveHookAccounts` pattern from `scripts/e2e/lib/swap-flow.ts`:
- Builds a dummy `createTransferCheckedWithTransferHookInstruction`
- Extracts remaining_accounts by slicing first 4 keys (source, mint, dest, authority)
- Returns exactly 4 AccountMeta per Token-2022 mint (per HOOK_ACCOUNTS_PER_MINT = 4)

### Shared Constants Extension (`shared/constants.ts`)

6 new exports added (all existing exports preserved):
- `DEVNET_POOL_CONFIGS`: 4 pools with vault addresses and LP fee info
- `TOKEN_PROGRAM_FOR_MINT`: Mint -> token program mapping
- `VALID_PAIRS`: Valid input/output token pairs
- `resolvePool()`: Pool config + swap instruction resolver for all 8 valid pairs
- `DEVNET_PDAS_EXTENDED`: SwapAuthority, TaxAuthority, StakePool, EscrowVault
- `TREASURY_PUBKEY`: Devnet treasury wallet

## Decisions Made

| ID | Decision | Rationale |
|---|---|---|
| D42-01-01 | Quote engine uses JS number (not BigInt) | Pool reserves within safe integer range; matches existing hook patterns |
| D42-01-02 | Dual error lookup by program ID in error string | Error codes overlap between Tax/AMM; program ID disambiguates |
| D42-01-03 | @solana/spl-token added to shared/package.json | TOKEN_PROGRAM_FOR_MINT needs spl-token constants at import time |

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Task | Name | Commit | Key Files |
|---|---|---|---|
| 1 | Quote engine, error map, WSOL helpers | `8aee053` | quote-engine.ts, error-map.ts, wsol.ts |
| 2 | Hook resolver and shared constants | `5c19c7d` | hook-resolver.ts, constants.ts, index.ts |

## Verification Results

1. All 5 files exist
2. TypeScript compiles cleanly (`npx tsc --noEmit` passes)
3. Quote engine: 11 exported functions (3 primitives + 4 forward + 4 reverse)
4. Error map: 32 error codes (14 Tax + 18 AMM)
5. WSOL helpers: TOKEN_PROGRAM_ID used throughout (8 references)
6. Hook resolver: uses createTransferCheckedWithTransferHookInstruction
7. DEVNET_POOL_CONFIGS: 4 pools with vault addresses from pda-manifest.json
8. resolvePool(): returns correct config for all 8 valid pairs
9. DEVNET_POOLS: preserved unchanged at line 145

## Next Phase Readiness

Plan 02 (Swap Transaction Builders) can now import:
- `quoteSolBuy/quoteSolSell/quoteProfitBuy/quoteProfitSell` for quote display
- `reverseQuote*` functions for "I want X output" mode
- `parseSwapError` for user-facing error messages
- `buildWsolWrapInstructions/buildWsolUnwrapInstruction` for SOL buy/sell flows
- `resolveHookAccounts` for Token-2022 transfer hook accounts
- `resolvePool` for routing input/output pairs to the correct pool and instruction
- `DEVNET_POOL_CONFIGS/DEVNET_PDAS_EXTENDED/TREASURY_PUBKEY` for account addresses
