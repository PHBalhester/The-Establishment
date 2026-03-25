---
phase: 75-launch-page
verified: 2026-03-07T11:15:00Z
status: passed
score: 8/8 must-haves verified
---

# Phase 75: Launch Page Verification Report

**Phase Goal:** Users can visit a dedicated /launch page to buy and sell tokens on both bonding curves through a steampunk-themed interface with real-time progress, countdown timer, and conditional refund UI.
**Verified:** 2026-03-07T11:15:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | /launch page loads with steampunk theming and two pressure gauges | VERIFIED | `app/app/launch/page.tsx` (177 lines) renders LaunchScene with blurred factory bg + CurveOverlay.png. Two PressureGauge components positioned at left/right with CSS needle rotation driven by `solRaised / TARGET_SOL`. Mobile layout stacks gauges in 2-col grid. |
| 2 | Users can buy tokens (SOL input -> preview -> execute) | VERIFIED | `BuyForm.tsx` (345 lines) has debounced `calculateTokensOut` quote, balance/cap validation, builds purchase TX via `buildPurchaseInstruction`, signs via `useProtocolWallet`, confirms via `pollTransactionConfirmation`. |
| 3 | Users can sell tokens (token input -> preview with 15% tax -> execute) | VERIFIED | `SellForm.tsx` (368 lines) has debounced `calculateSolForTokens` + `calculateSellTax` quote, builds sell TX via `buildSellInstruction`, slippage applied on net (post-tax) amount matching on-chain check. |
| 4 | Real-time data: tax escrow counter, countdown timer, price, SOL raised | VERIFIED | `CurveStats.tsx` (140 lines) displays SOL raised, market cap, spot price, and tax escrow per curve. `CountdownTimer.tsx` (98 lines) converts deadlineSlot - currentSlot to ~Xh Ym with EXPIRED state. |
| 5 | State-dependent UI: active/filled/failed/graduated | VERIFIED | `StateMachineWrapper.tsx` (63 lines) implements compound state machine: both graduated -> GraduationOverlay, either failed -> RefundPanel, otherwise -> BuySellPanel. BuySellPanel disables individual curves when filled. |
| 6 | Refund interface for Failed status with proportional refund and claim button | VERIFIED | `RefundPanel.tsx` (351 lines) shows per-curve token balances, proportional refund estimates matching on-chain formula, claim buttons with escrowConsolidated gate, full TX lifecycle via `buildClaimRefundInstruction`. |
| 7 | Route redirect to /launch during curve phase | VERIFIED | `app/app/page.tsx` line 38: `if (process.env.NEXT_PUBLIC_CURVE_PHASE === 'true') { redirect('/launch'); }` |
| 8 | Client-side curve math matches on-chain math.rs | VERIFIED | `curve-math.ts` (229 lines) exports `calculateTokensOut`, `calculateSolForTokens`, `calculateSellTax`, `getCurrentPrice` -- all BigInt implementations with quadratic formula and linear integral matching Rust math.rs. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/idl/bonding_curve.json` | Bonding curve IDL | VERIFIED | 2666 lines, synced from target/idl/ |
| `app/idl/types/bonding_curve.ts` | TypeScript types | VERIFIED | 2673 lines, generated types |
| `app/lib/anchor.ts` | getBondingCurveProgram() | VERIFIED | 115 lines, factory function added |
| `shared/constants.ts` | Program IDs, PDA seeds | VERIFIED | 474 lines, BONDING_CURVE + devnet PDAs |
| `app/lib/curve/curve-constants.ts` | BigInt constants | VERIFIED | 74 lines, P_START/P_END/TARGET_SOL etc. |
| `app/lib/curve/curve-math.ts` | Curve math functions | VERIFIED | 229 lines, 5 exported functions |
| `app/lib/curve/error-map.ts` | parseCurveError() | VERIFIED | 141 lines, 24 error variants mapped |
| `app/hooks/useCurveState.ts` | WebSocket subscription | VERIFIED | 366 lines, dual-PDA onAccountChange |
| `app/lib/curve/hook-accounts.ts` | Hook accounts resolver | VERIFIED | 67 lines, getCurveHookAccounts exported |
| `app/lib/curve/curve-tx-builder.ts` | TX instruction builders | VERIFIED | 225 lines, 3 builders with accountsStrict |
| `app/app/launch/page.tsx` | /launch route | VERIFIED | 177 lines, desktop+mobile layouts |
| `app/components/launch/LaunchScene.tsx` | Blurred bg + overlay | VERIFIED | 83 lines, factory bg + CurveOverlay.png |
| `app/components/launch/PressureGauge.tsx` | CSS needle gauge | VERIFIED | 96 lines, 270-degree arc sweep |
| `app/components/launch/CountdownTimer.tsx` | Slot countdown | VERIFIED | 98 lines, slot-based with EXPIRED |
| `app/components/launch/CurveStats.tsx` | Stats display | VERIFIED | 140 lines, SOL/cap/price/escrow |
| `app/components/launch/LaunchWalletButton.tsx` | Floating wallet btn | VERIFIED | 91 lines, fixed position |
| `app/components/launch/DocsModal.tsx` | Iframe docs modal | VERIFIED | 114 lines, iframe to Nextra |
| `app/components/launch/BuySellPanel.tsx` | Tabbed buy/sell | VERIFIED | 159 lines, CRIME/FRAUD tabs + Buy/Sell toggle |
| `app/components/launch/BuyForm.tsx` | Buy with preview | VERIFIED | 345 lines, debounced quote + TX |
| `app/components/launch/SellForm.tsx` | Sell with preview | VERIFIED | 368 lines, debounced quote + tax + TX |
| `app/components/launch/PreviewBreakdown.tsx` | Trade metrics | VERIFIED | 237 lines, price/impact/tax/holdings |
| `app/components/launch/RefundPanel.tsx` | Refund claims | VERIFIED | 351 lines, proportional refund + claim TX |
| `app/components/launch/GraduationOverlay.tsx` | Celebration overlay | VERIFIED | 107 lines, CSS gear animation |
| `app/components/launch/StateMachineWrapper.tsx` | State machine | VERIFIED | 63 lines, graduated/failed/active routing |
| `app/public/scene/launch/curve-overlay.png` | Brass machine asset | VERIFIED | Exists (2560x1440 image) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| page.tsx | useCurveState | import + destructure | WIRED | `const { crime, fraud, loading, error } = useCurveState()` |
| useCurveState | Solana RPC | onAccountChange WebSocket | WIRED | Lines 242, 276: dual subscription to crime/fraud PDAs |
| BuyForm | curve-tx-builder | buildPurchaseInstruction | WIRED | Line 172: builds IX, line 193: polls confirmation |
| SellForm | curve-tx-builder | buildSellInstruction | WIRED | Line 181: builds IX, line 202: polls confirmation |
| RefundPanel | curve-tx-builder | buildClaimRefundInstruction | WIRED | Line 173: builds IX, line 191: polls confirmation |
| curve-tx-builder | hook-accounts | getCurveHookAccounts | WIRED | Import + usage in purchase/sell builders |
| BuySellPanel | BuyForm/SellForm | import + render | WIRED | Lines 136/143: renders based on Buy/Sell toggle |
| StateMachineWrapper | RefundPanel/GraduationOverlay | conditional render | WIRED | Priority: graduated > failed > active |
| page.tsx (root) | /launch | redirect() | WIRED | NEXT_PUBLIC_CURVE_PHASE env gate |
| BuyForm/SellForm | curve-math | calculateTokensOut/calculateSolForTokens | WIRED | Debounced quote preview on input change |

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| PAGE-01: /launch page with steampunk theming | SATISFIED | Full-bleed LaunchScene with factory bg, CurveOverlay brass machine, amber/gold palette |
| PAGE-02: Two pressure gauges showing % progress | SATISFIED | Two PressureGauge components with CSS needle rotation, SOL raised / 1000 SOL target |
| PAGE-03: Buy (SOL->token) and sell (token->SOL with 15% tax) | SATISFIED | BuyForm + SellForm with debounced preview, slippage protection, sign-then-send TX |
| PAGE-04: Real-time tax escrow counter | SATISFIED | CurveStats displays taxCollected SOL per curve |
| PAGE-05: Inline Nextra documentation embed (iframe) | SATISFIED | DocsModal with iframe to Railway docs URL |
| PAGE-06: 48h countdown, price, SOL raised / market cap | SATISFIED | CountdownTimer (slot-based), CurveStats (price, SOL raised, market cap) |
| PAGE-07: Refund interface (conditional on Failed) | SATISFIED | RefundPanel with proportional refund estimate, claim button per curve, escrow gate |
| PAGE-08: Wallet connection, error handling, pre-validation, mobile responsive | SATISFIED | LaunchWalletButton, cap/balance/deadline validation in forms, mobile stacked layout |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| LaunchScene.tsx | 42 | `placeholder="blur"` | Info | Next.js Image placeholder prop, not a code stub |
| BuyForm.tsx | 254 | `placeholder="0.00"` | Info | HTML input placeholder, not a code stub |
| SellForm.tsx | 266 | `placeholder="0.00"` | Info | HTML input placeholder, not a code stub |
| PreviewBreakdown.tsx | 57 | `return null` | Info | Conditional render when solPrice unavailable, correct pattern |

No blocker or warning anti-patterns found. Zero console.log statements in any launch component.

### Human Verification Required

### 1. Visual Steampunk Theming

**Test:** Navigate to /launch and inspect the brass machine scene, pressure gauges, and overall aesthetic.
**Expected:** Consistent steampunk/factory design language with amber/gold color palette, blurred factory background, CurveOverlay brass machine centered.
**Why human:** Visual appearance and design coherence cannot be verified programmatically.

### 2. Pressure Gauge Needle Animation

**Test:** With curve data loaded, observe the CSS needle rotation on both gauges.
**Expected:** Needle rotates smoothly (cubic-bezier transition) proportional to SOL raised. At 0 SOL: needle at 7 o'clock. At 1000 SOL: needle at 5 o'clock.
**Why human:** CSS animation smoothness and visual accuracy require visual inspection.

### 3. Mobile Responsive Layout

**Test:** View /launch on a mobile viewport (<1024px width).
**Expected:** Stacked vertical layout: countdown, two gauges side-by-side, stats, buy/sell panel, docs button. All readable and usable.
**Why human:** Responsive layout and touch interaction require device/emulator testing.

### 4. Full Buy/Sell Transaction Flow

**Test:** Connect wallet, enter SOL amount, verify preview, execute buy. Then sell tokens back.
**Expected:** Quote preview updates after 300ms debounce. Pre-validation catches cap/balance issues. TX submits, confirms, and shows success/error feedback.
**Why human:** End-to-end transaction flow requires wallet interaction and devnet connectivity.

### 5. Countdown Timer Accuracy

**Test:** Observe countdown with known deadline slot. Wait several minutes and verify time decreases.
**Expected:** ~Xh Ym format decreasing over time. Shows "EXPIRED" after deadline. Shows "Awaiting launch..." before start.
**Why human:** Slot-time accuracy is inherently approximate and needs real-time observation.

### Gaps Summary

No gaps found. All 25 artifacts exist, are substantive (minimum 63 lines, maximum 2673 lines), and are properly wired into the component tree. All 8 requirements (PAGE-01 through PAGE-08) are satisfied by implemented code with real functionality -- no stubs, no placeholders, no empty handlers. The data layer (curve-math, useCurveState, curve-tx-builder) connects to the UI layer (forms, panels, stats) through proper imports and function calls. The state machine correctly routes between active, filled, failed, and graduated UI states.

The only items requiring human verification are visual/interactive concerns (theming appearance, animation smoothness, mobile layout, and end-to-end transaction execution on devnet).

---

_Verified: 2026-03-07T11:15:00Z_
_Verifier: Claude (gsd-verifier)_
