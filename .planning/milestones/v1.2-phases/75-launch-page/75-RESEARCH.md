# Phase 75: Launch Page - Research

**Researched:** 2026-03-05
**Domain:** Next.js frontend -- bonding curve interaction page with real-time state, transaction building, and steampunk theming
**Confidence:** HIGH

## Summary

Phase 75 builds a dedicated `/launch` route in the existing Next.js app. The page surfaces two bonding curves (CRIME + FRAUD) with pressure gauge visualizations, a buy/sell panel, countdown timer, and conditional refund UI. It reuses the existing wallet adapter, kit components, and established patterns (WebSocket subscriptions, confirm-transaction, error-map, factory scene overlay positioning).

The primary technical challenges are: (1) client-side bonding curve quote math mirroring the on-chain u128 integer arithmetic, (2) Transfer Hook remaining_accounts resolution for purchase/sell transactions, (3) real-time CurveState WebSocket subscriptions for two accounts simultaneously, and (4) state-machine-driven UI (Active/Filled/Failed/Graduated) with conditional rendering.

**Primary recommendation:** Build a `useCurveState` hook following the `useEpochState` WebSocket pattern, a `curve-math.ts` library mirroring `programs/bonding_curve/src/math.rs` using BigInt, and a `curve-tx-builder.ts` for purchase/sell/claim_refund instruction construction with Transfer Hook account resolution.

## Standard Stack

### Core (already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @coral-xyz/anchor | existing | Anchor client for CurveState deserialization | Already used for all 6 programs |
| @solana/web3.js | existing | Connection, Transaction, PublicKey | Project standard |
| @solana/spl-token | existing | TOKEN_2022_PROGRAM_ID, ATA derivation | Already used for token operations |
| @solana/wallet-adapter-react | existing | Wallet connection | Project standard (via useProtocolWallet) |
| Next.js 16 | existing | App Router, /launch route | Project framework |

### Supporting (already in project)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Kit components | existing | Frame, Button, Input, Tabs, Card, Divider | Buy/sell panel, refund panel |
| useProtocolWallet | existing | Sign-then-send transaction pattern | All bonding curve transactions |
| useTokenBalances | existing | CRIME/FRAUD balance for cap display + sell | Buy/sell panel breakdown |
| useSolPrice | existing | SOL/USD for market cap | Stats display |
| useCurrentSlot | existing | Current slot for countdown computation | Countdown timer |
| useSettings | existing | Slippage tolerance | Buy/sell slippage protection |
| confirm-transaction.ts | existing | Polling-based TX confirmation | Post-submit feedback |
| connection.ts | existing | Singleton RPC + WebSocket | CurveState subscriptions |

### New Code (to be created)

| Module | Purpose | Pattern Source |
|--------|---------|---------------|
| `app/app/launch/page.tsx` | Launch page route | Factory scene page.tsx |
| `app/hooks/useCurveState.ts` | WebSocket subscription to CurveState PDAs | useEpochState.ts |
| `app/lib/curve/curve-math.ts` | Client-side quote calculation (BigInt) | programs/bonding_curve/src/math.rs |
| `app/lib/curve/curve-tx-builder.ts` | Purchase/sell/refund instruction builders | lib/swap/ pattern |
| `app/lib/curve/error-map.ts` | Bonding curve error codes -> human messages | lib/swap/error-map.ts |
| `app/lib/curve/constants.ts` | Client-side bonding curve constants | programs/bonding_curve/src/constants.rs |
| `app/components/launch/` | Launch page components | components/scene/ pattern |
| `shared/constants.ts` | Bonding curve program ID + PDA seeds | Extend existing |

### No Alternatives Needed

All libraries are locked by CONTEXT.md decisions and existing project patterns. No new npm dependencies required.

**Installation:**
```bash
# No new packages needed -- everything exists in the project
# Only action: copy bonding_curve.json IDL to app/idl/ (sync-idl.mjs handles this)
```

## Architecture Patterns

### Recommended Project Structure

```
app/
├── app/launch/
│   └── page.tsx                  # /launch route (full-bleed scene page)
├── components/launch/
│   ├── LaunchScene.tsx           # Background image + overlay container (FactoryBackground pattern)
│   ├── PressureGauge.tsx         # Needle overlay with CSS rotate()
│   ├── BuySellPanel.tsx          # Main trading panel (always visible)
│   ├── CurveTabContent.tsx       # Per-curve buy/sell form within tabs
│   ├── BuyForm.tsx               # SOL input -> token preview -> execute
│   ├── SellForm.tsx              # Token input -> SOL preview -> execute
│   ├── PreviewBreakdown.tsx      # Detailed preview (amount, price, impact, tax, cap)
│   ├── RefundPanel.tsx           # Conditional: replaces BuySellPanel on Failed
│   ├── CountdownTimer.tsx        # Slot-based countdown (deadline_slot - current_slot)
│   ├── CurveStats.tsx            # SOL raised, market cap, current price, tax escrow
│   ├── GraduationOverlay.tsx     # Celebration overlay on Graduated
│   ├── LaunchWalletButton.tsx    # Floating wallet connect button
│   └── DocsButton.tsx            # Opens docs iframe modal
├── hooks/
│   └── useCurveState.ts          # WebSocket subscription to both CurveState PDAs
├── lib/curve/
│   ├── curve-math.ts             # BigInt port of on-chain math.rs
│   ├── curve-tx-builder.ts       # Instruction builders (purchase, sell, claim_refund)
│   ├── curve-constants.ts        # P_START, P_END, TOTAL_FOR_SALE, etc.
│   └── error-map.ts              # CurveError code -> human message
└── idl/
    └── bonding_curve.json        # Synced from target/idl/
```

### Pattern 1: WebSocket CurveState Subscription (useCurveState)

**What:** Subscribe to both CurveState PDAs via `connection.onAccountChange()` for real-time updates.
**When to use:** Page mount -- drives all gauges, stats, countdown, and state-dependent UI.
**Source pattern:** `app/hooks/useEpochState.ts`

```typescript
// Pattern: dual-account WebSocket subscription
// Subscribe to both CRIME and FRAUD CurveState PDAs simultaneously
// Each fires independently when a buy/sell lands on-chain

const crimeCurveStatePda = PublicKey.findProgramAddressSync(
  [Buffer.from("curve"), MINTS.CRIME.toBuffer()],
  BONDING_CURVE_PROGRAM_ID
)[0];

const fraudCurveStatePda = PublicKey.findProgramAddressSync(
  [Buffer.from("curve"), MINTS.FRAUD.toBuffer()],
  BONDING_CURVE_PROGRAM_ID
)[0];

// connection.onAccountChange(pda, callback) fires on every state mutation
// Deserialize with Anchor: program.coder.accounts.decode("CurveState", data)
// Convert BN fields to plain numbers (toNum pattern from useEpochState)
```

### Pattern 2: Client-Side Bonding Curve Math (BigInt)

**What:** Port the on-chain `math.rs` quadratic formula to TypeScript using BigInt for precision.
**When to use:** Quote preview (show user how many tokens they get before submitting TX).
**Why BigInt:** The math involves u128 intermediates (coef^2 can reach ~2.5e36). JavaScript Number loses precision above 2^53. BigInt is exact.

```typescript
// Constants mirroring programs/bonding_curve/src/constants.rs
const P_START = 900n;       // lamports per human token
const P_END = 3_450n;       // lamports per human token
const TOTAL_FOR_SALE = 460_000_000_000_000n;  // 460M * 10^6
const TOKEN_DECIMAL_FACTOR = 1_000_000n;
const SELL_TAX_BPS = 1_500n;
const BPS_DENOMINATOR = 10_000n;

// calculate_tokens_out(sol_lamports, current_sold) -> tokens (base units)
// Quadratic formula: dx = (sqrt(coef^2 + 2*b_num*S*D*b_den) - coef) / b_num
// Where coef = P_START * TOTAL_FOR_SALE + (P_END - P_START) * current_sold

// calculate_sol_for_tokens(tokens, current_sold) -> lamports
// Linear integral: SOL = [P_START * N + (P_END - P_START) * N * (2*x1 + N) / (2 * TOTAL)] / TOKEN_DEC

// BigInt sqrt: implement Newton's method (no stdlib isqrt for BigInt in JS)
function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
```

### Pattern 3: Transfer Hook Account Resolution for Purchase/Sell

**What:** Both purchase and sell instructions require Transfer Hook `remaining_accounts`.
**When to use:** Building any bonding curve transaction that moves tokens.
**Critical detail:** CRIME and FRAUD use Token-2022 Transfer Hooks. The bonding curve program uses manual `invoke_signed` (not Anchor CPI) for token transfers, forwarding `remaining_accounts` through the hook chain.

```typescript
// Hook accounts per mint = 4 (from MEMORY.md):
// 1. extra_account_meta_list PDA
// 2. whitelist entry for source
// 3. whitelist entry for destination
// 4. hook program ID

// For purchase: vault -> user (source = token_vault, dest = user_token_account)
// For sell: user -> vault (source = user_token_account, dest = token_vault)

// Use the existing hook-resolver pattern (manual PDA derivation, no spl-token
// createTransferCheckedWithTransferHookInstruction due to browser Buffer issues)
```

### Pattern 4: State-Machine UI

**What:** CurveState.status drives which UI elements render.
**States:** `Active` | `Filled` | `Failed` | `Graduated`

```
                ┌─────────┐
                │  Active  │
                └────┬─────┘
           ┌─────────┴─────────┐
      ┌────▼────┐         ┌────▼────┐
      │ Filled  │         │ Failed  │
      └────┬────┘         └─────────┘
      ┌────▼────┐           (refund UI)
      │Graduated│
      └─────────┘
        (celebration)
```

Compound state matters: one curve can be Filled while the other is Active. UI must handle per-curve status independently.

### Pattern 5: Launch Route Redirect (Middleware or Layout)

**What:** During curve phase, root `/` redirects to `/launch`. Factory scene routes not rendered.
**Implementation:** Next.js middleware or conditional redirect in layout.

```typescript
// middleware.ts approach (simplest):
// If NEXT_PUBLIC_CURVE_PHASE=true, redirect / to /launch
// After graduation, admin removes env var and redeploys

// OR: app/page.tsx conditional redirect (avoids middleware complexity)
// import { redirect } from 'next/navigation';
// if (process.env.NEXT_PUBLIC_CURVE_PHASE === 'true') redirect('/launch');
```

### Anti-Patterns to Avoid

- **Using Number for curve math:** JavaScript Number loses precision above 2^53. The quadratic formula intermediate values reach ~2.5e36. Use BigInt exclusively.
- **Polling CurveState:** WebSocket subscription (`onAccountChange`) is specified in CONTEXT.md. Do not poll -- use the established useEpochState pattern.
- **Building custom wallet connect:** Reuse the existing wallet-adapter + useProtocolWallet. The sign-then-send pattern is critical (Phantom's signAndSendTransaction broken on devnet).
- **Adding npm deps for UI:** CONTEXT.md specifies CSS-only animations. Needle rotation is a CSS `transform: rotate()`. No animation libraries.
- **Forgetting Transfer Hook accounts:** purchase/sell instructions will fail with AccountNotEnoughKeys (3005) if remaining_accounts are missing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wallet connection | Custom wallet flow | `useProtocolWallet` + wallet-adapter | Sign-then-send pattern is battle-tested |
| TX confirmation | Custom polling | `pollTransactionConfirmation` | Handles block height expiry, status polling |
| Token balances | Manual RPC calls | `useTokenBalances` hook | Cross-instance sync, visibility gating |
| SOL price | Own price feed | `useSolPrice` hook | Jupiter API, 30s polling, visibility-aware |
| Current slot | Slot subscription | `useCurrentSlot` hook | Estimation + resync pattern, saves credits |
| Tab component | Custom tabs | Kit `Tabs` compound component | Accessible, consistent with rest of UI |
| Error parsing | String matching | error-map.ts pattern | Handles Anchor, Solana, and common errors |
| WebSocket lifecycle | Manual subscribe/cleanup | useEpochState pattern | Visibility gating, burst-refresh, Sentry |

**Key insight:** 90% of the infrastructure for this page already exists. The new work is (1) curve-specific math, (2) curve-specific TX builders, (3) CurveState hook, and (4) the page layout/components.

## Common Pitfalls

### Pitfall 1: BigInt Precision in Curve Math

**What goes wrong:** Using JavaScript `Number` for the quadratic formula causes precision loss, producing wrong token amounts that don't match on-chain.
**Why it happens:** On-chain math uses `u128` which goes up to ~3.4e38. JS Number only has 53-bit mantissa (~9e15).
**How to avoid:** Use `BigInt` for ALL curve math. The `bigintSqrt` Newton's method is needed since JS has no built-in BigInt sqrt.
**Warning signs:** Quote preview shows different amount than on-chain result. Users get SlippageExceeded errors on valid-looking trades.

### Pitfall 2: Transfer Hook remaining_accounts Ordering

**What goes wrong:** Purchase/sell transactions fail with error 3005 (AccountNotEnoughKeys).
**Why it happens:** Token-2022 Transfer Hook requires 4 extra accounts per token transfer. The bonding curve program forwards `remaining_accounts` through manual `invoke_signed`.
**How to avoid:** Derive the 4 hook accounts for the specific mint (extra_account_meta_list PDA, whitelist source, whitelist dest, hook program). Pass them as `remainingAccounts` on the Anchor method call.
**Warning signs:** Transactions fail immediately with "custom program error: 0xBBD" (3005).

### Pitfall 3: ATA Creation for First-Time Buyers

**What goes wrong:** Purchase instruction expects user's ATA for the token. First-time buyers don't have one.
**Why it happens:** The IDL shows `user_token_account` with `init_if_needed` semantics (has `associated_token_program` in accounts). But this is Token-2022, so the ATA must be created with the correct token program.
**How to avoid:** The on-chain `purchase` instruction handles ATA creation via `init_if_needed`. No client-side pre-creation needed. Just ensure `associated_token_program` is passed correctly in the instruction accounts.
**Warning signs:** First buy fails, subsequent buys work.

### Pitfall 4: Countdown Timer Accuracy

**What goes wrong:** Timer shows wrong time remaining or flickers between values.
**Why it happens:** Slot time is approximate (400ms average, but variable). Converting slots to wall-clock time is inherently imprecise.
**How to avoid:** Use `useCurrentSlot` (estimation + resync pattern). Convert remaining slots to time: `remaining_ms = remaining_slots * 400`. Display as approximate ("~2h 15m"). Don't show seconds precision.
**Warning signs:** Timer jumps when tab returns (normal -- resync corrects drift).

### Pitfall 5: Compound State Handling

**What goes wrong:** UI assumes both curves are in the same state, breaks when one is Filled and other is Active.
**Why it happens:** Curves are independent -- CRIME can fill while FRAUD is still Active.
**How to avoid:** Track per-curve state independently. The buy/sell panel disables only the filled curve. Refund panel appears only when BOTH have Failed status (or one Failed + one still Active past deadline).
**Warning signs:** Able to buy on a filled curve, or refund panel appears for only one curve.

### Pitfall 6: Sell Tax Display Precision

**What goes wrong:** Displayed tax amount doesn't match on-chain deduction.
**Why it happens:** On-chain uses ceil-rounded BPS: `(sol_gross * 1500 + 9999) / 10000`. Client must match.
**How to avoid:** Use identical formula in BigInt: `(solGross * 1500n + 9999n) / 10000n`.
**Warning signs:** User sees "Tax: 0.15 SOL" but on-chain deducts 0.150001 SOL.

### Pitfall 7: Cap Enforcement Display

**What goes wrong:** User attempts to buy, gets CapExceeded error, but UI showed purchase as valid.
**Why it happens:** Cap is enforced via ATA balance on-chain. Client preview must check current balance + intended purchase against MAX_TOKENS_PER_WALLET (20M * 10^6).
**How to avoid:** In preview breakdown, calculate `currentHoldings + tokensOut` and compare against cap. If exceeded, show warning and reduce suggested amount. Pre-validate before allowing submit.
**Warning signs:** "Wallet cap exceeded" errors on seemingly valid purchases.

## Code Examples

### CurveState Deserialization (Anchor)

```typescript
// Source: target/idl/bonding_curve.json CurveState type
import { Program } from "@coral-xyz/anchor";
import type { BondingCurve } from "@/idl/types/bonding_curve";

interface CurveStateData {
  token: { crime: {} } | { fraud: {} };
  tokenMint: PublicKey;
  tokenVault: PublicKey;
  solVault: PublicKey;
  tokensSold: bigint;      // u64 -> BigInt for precision
  solRaised: bigint;       // u64 -> BigInt
  status: { active: {} } | { filled: {} } | { failed: {} } | { graduated: {} };
  startSlot: bigint;
  deadlineSlot: bigint;
  participantCount: number;
  tokensReturned: bigint;
  solReturned: bigint;
  taxCollected: bigint;
  taxEscrow: PublicKey;
  bump: number;
  escrowConsolidated: boolean;
}

// Deserialize from raw account data:
const decoded = program.coder.accounts.decode("CurveState", accountInfo.data);
```

### Purchase Instruction Builder

```typescript
// Source: target/idl/bonding_curve.json purchase instruction
// Accounts: user, curve_state, user_token_account, token_vault, sol_vault,
//           token_mint, token_program, associated_token_program, system_program
// Args: sol_amount (u64), minimum_tokens_out (u64)
// Plus: remaining_accounts for Transfer Hook (4 accounts)

import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

function buildPurchaseInstruction(
  program: Program<BondingCurve>,
  user: PublicKey,
  tokenMint: PublicKey,  // CRIME or FRAUD mint
  solAmount: bigint,
  minimumTokensOut: bigint,
  hookAccounts: AccountMeta[],  // 4 Transfer Hook accounts
) {
  const [curveState] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), tokenMint.toBuffer()],
    program.programId
  );
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve_token_vault"), tokenMint.toBuffer()],
    program.programId
  );
  const [solVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve_sol_vault"), tokenMint.toBuffer()],
    program.programId
  );

  return program.methods
    .purchase(new BN(solAmount.toString()), new BN(minimumTokensOut.toString()))
    .accounts({
      user,
      curveState,
      tokenVault,
      solVault,
      tokenMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();
}
```

### Sell Instruction Builder

```typescript
// Source: target/idl/bonding_curve.json sell instruction
// Accounts: user, curve_state, user_token_account, token_vault, sol_vault,
//           tax_escrow, token_mint, token_program, system_program
// Args: tokens_to_sell (u64), minimum_sol_out (u64)

function buildSellInstruction(
  program: Program<BondingCurve>,
  user: PublicKey,
  tokenMint: PublicKey,
  tokensToSell: bigint,
  minimumSolOut: bigint,
  hookAccounts: AccountMeta[],
) {
  const [curveState] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), tokenMint.toBuffer()],
    program.programId
  );
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve_token_vault"), tokenMint.toBuffer()],
    program.programId
  );
  const [solVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve_sol_vault"), tokenMint.toBuffer()],
    program.programId
  );
  const [taxEscrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("tax_escrow"), tokenMint.toBuffer()],
    program.programId
  );

  return program.methods
    .sell(new BN(tokensToSell.toString()), new BN(minimumSolOut.toString()))
    .accounts({
      user,
      curveState,
      tokenVault,
      solVault,
      taxEscrow,
      tokenMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();
}
```

### Claim Refund Instruction Builder

```typescript
// Source: target/idl/bonding_curve.json claim_refund instruction
// No args -- burns entire user token balance, returns proportional SOL
// Note: claim_refund does NOT need remaining_accounts (burn doesn't trigger hooks)
// Accounts: user, curve_state, partner_curve_state, user_token_account,
//           token_mint, sol_vault, token_program

function buildClaimRefundInstruction(
  program: Program<BondingCurve>,
  user: PublicKey,
  tokenMint: PublicKey,
  partnerTokenMint: PublicKey,
) {
  const [curveState] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), tokenMint.toBuffer()],
    program.programId
  );
  const [partnerCurveState] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), partnerTokenMint.toBuffer()],
    program.programId
  );
  const [solVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve_sol_vault"), tokenMint.toBuffer()],
    program.programId
  );

  return program.methods
    .claimRefund()
    .accounts({
      user,
      curveState,
      partnerCurveState,
      tokenMint,
      solVault,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
}
```

### Hook Account Derivation

```typescript
// Derive the 4 Transfer Hook remaining_accounts for a given mint
// Source pattern: app hook-resolver (manual PDA derivation)
import { PROGRAM_IDS } from "@dr-fraudsworth/shared";

function getHookAccounts(
  mint: PublicKey,
  source: PublicKey,
  destination: PublicKey,
): AccountMeta[] {
  const hookProgram = PROGRAM_IDS.TRANSFER_HOOK;

  // 1. ExtraAccountMetaList PDA (seeds: ["extra-account-metas", mint])
  const [metaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    hookProgram,
  );

  // 2. Whitelist entry for source (seeds: ["whitelist", source])
  const [wlSource] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), source.toBuffer()],
    hookProgram,
  );

  // 3. Whitelist entry for destination (seeds: ["whitelist", destination])
  const [wlDest] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), destination.toBuffer()],
    hookProgram,
  );

  return [
    { pubkey: metaList, isSigner: false, isWritable: false },
    { pubkey: wlSource, isSigner: false, isWritable: false },
    { pubkey: wlDest, isSigner: false, isWritable: false },
    { pubkey: hookProgram, isSigner: false, isWritable: false },
  ];
}
```

### Countdown Timer Computation

```typescript
// Source: useCurrentSlot pattern + bonding curve deadline_slot
const MS_PER_SLOT = 400;

function computeCountdown(
  deadlineSlot: number,
  currentSlot: number,
): { hours: number; minutes: number; expired: boolean } {
  const remainingSlots = deadlineSlot - currentSlot;
  if (remainingSlots <= 0) {
    return { hours: 0, minutes: 0, expired: true };
  }
  const remainingMs = remainingSlots * MS_PER_SLOT;
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  return { hours, minutes, expired: false };
}
```

### Pressure Gauge Needle CSS

```typescript
// CONTEXT.md: Needle images at 0% position, CSS rotate() drives based on fill %
// Gauge range: 0% = 0 SOL raised, 100% = 1000 SOL raised
// Needle rotation range depends on art (e.g., -120deg to +120deg for 0% to 100%)

const NEEDLE_MIN_DEG = -120;  // rotation at 0% fill (to be tuned to art)
const NEEDLE_MAX_DEG = 120;   // rotation at 100% fill

function needleRotation(solRaised: number, targetSol: number): number {
  const pct = Math.min(solRaised / targetSol, 1);
  return NEEDLE_MIN_DEG + pct * (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG);
}

// In JSX:
// <img src={needleImage} style={{ transform: `rotate(${rotation}deg)` }} />
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anchor CPI for token transfer | Manual invoke_signed | Phase 71 | remaining_accounts forwarded for Transfer Hook |
| Number for u64 math | BN (Anchor) / BigInt (client) | Phase 71 | Prevents precision loss in curve calculations |
| Polling for account state | WebSocket onAccountChange | Phase 42 | Real-time updates, lower RPC credit cost |
| signAndSendTransaction | signTransaction + sendRawTransaction | Phase 64 | Reliable devnet TX submission via our RPC |

**Deprecated/outdated:**
- `createTransferCheckedWithTransferHookInstruction` from spl-token: Browser Buffer polyfill issues. Use manual PDA derivation for hook accounts instead.

## Open Questions

1. **Bonding Curve IDL sync**
   - What we know: `target/idl/bonding_curve.json` exists but is NOT yet in `app/idl/`. The `sync-idl.mjs` predev hook copies IDL files.
   - What's unclear: Whether sync-idl.mjs needs updating to include bonding_curve, or if it already globs all files.
   - Recommendation: Check sync-idl.mjs and add bonding_curve if missing. Also generate TypeScript types.

2. **Bonding Curve Program ID in shared/constants.ts**
   - What we know: Program ID is `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1` (from IDL). Not yet in `PROGRAM_IDS` constant.
   - What's unclear: Nothing -- just needs adding.
   - Recommendation: Add to shared/constants.ts `PROGRAM_IDS` and add PDA seeds for curve, token vault, sol vault, tax escrow.

3. **Exact needle rotation range**
   - What we know: User will provide background art with baked-in gauges and transparent needle overlays.
   - What's unclear: The rotation degree range (min/max) depends on the art.
   - Recommendation: Use configurable constants (NEEDLE_MIN_DEG, NEEDLE_MAX_DEG) that are tuned once art is provided. Default to -120/+120 for development.

4. **Per-wallet cap read for preview**
   - What we know: On-chain cap is enforced via ATA balance read (20M tokens). Client needs current ATA balance for the specific curve token.
   - What's unclear: Whether to use `useTokenBalances` (already fetches CRIME/FRAUD balances) or a separate query.
   - Recommendation: Reuse `useTokenBalances` -- it already returns crime/fraud balances. Convert to base units for cap comparison.

5. **Launch page env var vs middleware for routing**
   - What we know: During curve phase, `/` must redirect to `/launch`. After graduation, admin switches.
   - What's unclear: Simplest mechanism.
   - Recommendation: Use `NEXT_PUBLIC_CURVE_PHASE=true` env var checked in `app/page.tsx` with Next.js `redirect()`. Simplest, no middleware needed, admin toggles on Railway.

## Sources

### Primary (HIGH confidence)
- `target/idl/bonding_curve.json` -- All instruction accounts, args, types verified
- `programs/bonding_curve/src/math.rs` -- On-chain math formula verified
- `programs/bonding_curve/src/constants.rs` -- All constants verified (P_START=900, P_END=3450, etc.)
- `app/hooks/useEpochState.ts` -- WebSocket subscription pattern verified
- `app/hooks/useProtocolWallet.ts` -- Sign-then-send pattern verified
- `app/lib/confirm-transaction.ts` -- TX confirmation pattern verified
- `app/lib/swap/error-map.ts` -- Error parsing pattern verified
- `app/components/scene/FactoryBackground.tsx` -- Scene overlay pattern verified
- `shared/constants.ts` -- All existing constants verified

### Secondary (MEDIUM confidence)
- MEMORY.md notes on Transfer Hook accounts per mint = 4
- MEMORY.md notes on v0 TX and skipPreflight patterns

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in the project, verified in source code
- Architecture: HIGH -- all patterns are direct extensions of existing code (useEpochState, FactoryBackground, error-map)
- Curve math: HIGH -- verified against on-chain math.rs, BigInt approach standard for u128 precision
- TX builders: HIGH -- IDL verified, Transfer Hook pattern established in project
- Pitfalls: HIGH -- based on documented project history (MEMORY.md) and verified code patterns

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable -- no external dependencies, all patterns internal)
