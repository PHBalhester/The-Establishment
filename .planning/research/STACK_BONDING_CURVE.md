# Technology Stack: Bonding Curve Program (Buy + Sell)

**Project:** Dr. Fraudsworth's Finance Factory -- Bonding Curve Launch System
**Researched:** 2026-03-03
**Overall Confidence:** MEDIUM (WebSearch/WebFetch unavailable during research; forkable repo assessments based on training data -- flagged for live verification)

---

## Context

This STACK.md covers the **7th on-chain program** (bonding curve with buy+sell) and its frontend launch page. The existing protocol stack is validated and deployed:

- **Anchor 0.32.1** / anchor-lang 0.32.1 / anchor-spl 0.32.1
- **Token-2022** with Transfer Hook extension (4 extra accounts per mint)
- **@solana/web3.js 1.98.4** (v1 locked -- Anchor 0.32.1 dependency)
- **@coral-xyz/anchor 0.32.1** TypeScript client
- **Next.js 16.1.6** / React 19.2.3 / Tailwind v4.1.18
- **6 deployed programs** (AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault)

The bonding curve program is a **new standalone Anchor program** that:
1. Manages two parallel linear bonding curves (CRIME + FRAUD)
2. Supports both BUY and SELL operations on curves
3. Applies 0% buy tax and 15% sell tax
4. Graduates to AMM pool seeding on success
5. Provides proportional refunds on failure

---

## Forkable Open Source Implementations

**CRITICAL ASSESSMENT: The user specifically asked to evaluate forkable repos before building from scratch.**

### Known Solana Bonding Curve Repos (Training Data -- LOW confidence, needs live verification)

| Repo | Stars (approx) | License | Anchor? | Buy+Sell? | Audit? | Last Active | Assessment |
|------|---------------|---------|---------|-----------|--------|-------------|------------|
| `nickolastone/pump.fun-smart-contract` | ~200+ | Unclear | Yes | BUY ONLY | No | 2024 | Not suitable -- buy-only |
| Various pump.fun clones on GitHub | 50-500 | Mixed (MIT/Apache/Unlicensed) | Yes/Native | Mostly BUY ONLY | No | 2024-2025 | pump.fun model is buy-only by design |
| `strata-foundation/strata` | ~300 | Apache-2.0 | Yes (older) | Yes (buy+sell) | Yes (partial) | Archived 2023 | Best candidate but uses legacy SPL Token, not Token-2022. Anchor version mismatch (0.25.x) |
| `metaplex-foundation/mpl-token-metadata` | N/A | N/A | N/A | N/A | N/A | N/A | Not a bonding curve -- metadata only |
| Custom pump.fun forks with sell | ~10-50 | Unlicensed | Yes | Some | No | 2024-2025 | Too small/unreviewed for security-critical code |

**Confidence: LOW** -- These assessments are from training data. Stars, licenses, and activity dates MUST be verified with `gh` CLI or browser before making fork decisions.

### pump.fun Architecture (Relevant Background)

pump.fun popularized the Solana bonding curve model. Key architectural facts:

- **Buy-only curve**: Users buy tokens on a bonding curve. There is NO sell-back-to-curve mechanism in pump.fun's original design.
- **Exponential curve**: pump.fun uses an exponential (not linear) price function.
- **Graduation**: When the curve reaches a target (typically 85 SOL), liquidity is migrated to Raydium.
- **No tax**: pump.fun charges a flat 1% fee on buys, not a percentage tax on sells.

**Why pump.fun clones are NOT directly forkable for Dr. Fraudsworth:**

1. **Buy-only vs Buy+Sell**: The spec requires sell-back-to-curve with a 15% sell tax. pump.fun clones don't have sell logic at all. Adding sell logic to a buy-only architecture is not a patch -- it changes the state model fundamentally (sell tax escrow, price recalculation on sells, supply tracking for both directions).

2. **Linear vs Exponential**: Dr. Fraudsworth uses a linear curve with closed-form quadratic solution. pump.fun uses exponential. Different math entirely.

3. **Token-2022 vs SPL Token**: All pump.fun clones use SPL Token. Dr. Fraudsworth requires Token-2022 with Transfer Hook. This affects every token transfer instruction (CPI patterns, remaining_accounts for hook forwarding).

4. **Dual curves**: pump.fun has one curve per token. Dr. Fraudsworth has two coupled curves (CRIME + FRAUD) with atomic success/failure. No pump.fun clone has this concept.

5. **Sell tax with conditional routing**: The 15% sell tax that goes to carnage fund on success but becomes part of refund pool on failure -- this is completely novel.

### Strata Protocol (Best Fork Candidate -- but still not recommended)

Strata Protocol by Strata Foundation was the most complete open-source bonding curve implementation on Solana:

- **Buy AND sell** support on bonding curves
- **Multiple curve types** (linear, exponential, fixed-price)
- **Anchor-based** (but version 0.25.x -- significantly older than 0.32.1)
- **Partial audit** by Bramah Systems
- **Apache-2.0 license**

**Why Strata is NOT recommended for forking:**

1. **Archived**: The repo was archived in 2023. No maintenance, no security updates.
2. **Anchor 0.25.x**: Two major versions behind our 0.32.1. Account constraint syntax, error handling, and IDL generation are all different. The migration effort would be comparable to rewriting.
3. **SPL Token only**: No Token-2022 support. Every token interaction needs rewriting.
4. **Complex abstraction**: Strata has a "Social Tokens" layer, a "Marketplace" layer, and a "Bonding" layer. We need only the bonding math. Forking would mean stripping 80% of the code and then upgrading the remaining 20%.
5. **No sell tax**: Strata's sell mechanism returns the integral of the curve without tax deduction. Adding sell tax changes the state accounting model.

### Recommendation: Build From Scratch

**Verdict: Build the bonding curve program from scratch.**

**Rationale:**
- No existing forkable implementation supports the combination of: Token-2022 + Transfer Hook + buy+sell + sell tax + dual coupled curves + conditional tax routing + Anchor 0.32.1.
- The closest candidate (Strata) is archived, two Anchor versions behind, and would require more effort to adapt than to build clean.
- The bonding curve math itself is straightforward (linear curve with quadratic solution). The complexity is in the state machine and integration with the existing protocol, not in the curve math.
- Building from scratch ensures consistency with the existing codebase patterns (checked arithmetic, proptest, error handling conventions, PDA derivation patterns, Token-2022 CPI patterns).
- The existing Bonding_Curve_Spec.md already has detailed Rust pseudocode for all instructions.

**However -- BORROW the math patterns:**
- The quadratic formula solution for linear curve integral is well-established mathematics
- The integer square root algorithm (Newton's method) is a known pattern -- borrow from any reference implementation
- The Synthetix cumulative reward pattern (already used in Staking program) can inform the sell-tax accounting

---

## On-Chain Stack (New Bonding Curve Program)

### Core Dependencies

| Technology | Version | Purpose | Why |
|---|---|---|---|
| anchor-lang | 0.32.1 | Program framework | Must match existing programs. Already validated. |
| anchor-spl | 0.32.1 (features: token_2022) | Token-2022 CPI helpers | Required for `transfer_checked` CPI with CRIME/FRAUD Token-2022 mints. |

**Cargo.toml template (based on conversion-vault pattern):**

```toml
[package]
name = "bonding-curve"
version = "0.1.0"
description = "Dr Fraudsworth Bonding Curve - Linear price curves with buy+sell"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.32.1", features = ["token_2022"] }

[dev-dependencies]
proptest = "1.9"

[features]
default = []
devnet = []
localnet = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

**Why this exact shape:**
- `init-if-needed` feature: Required for `ParticipantState` accounts that are created on first purchase (same pattern as the spec's `purchase` instruction)
- `token_2022` feature on anchor-spl: Required for Token-2022 `transfer_checked` CPI
- `devnet` feature: For feature-gated devnet-specific logic (e.g., shorter deadline for testing)
- `proptest` dev dependency: For property-based testing of curve math (same pattern as AMM and Staking)
- No additional crates needed. The curve math uses only `u128` checked arithmetic from Rust stdlib.

### What NOT to Add (On-Chain)

| Rejected | Why |
|---|---|
| `num-integer` crate | Integer square root can be implemented in ~15 lines with Newton's method. No need for a dependency. |
| `fixed` crate (fixed-point arithmetic) | u128 with manual scaling (already the pattern in AMM math.rs and Staking math.rs) is sufficient and consistent. Adding a new numeric type creates API boundary friction. |
| `decimal` or `rust_decimal` crate | Same reasoning as `fixed`. u128 with 1e12 or 1e18 precision scaling is the established pattern. |
| `spl-math` crate | Provides sqrt and other functions but adds a dependency on an SPL crate that may have version conflicts with anchor-spl 0.32.1. |
| Any external bonding curve library | None exist that are audited and compatible with Anchor 0.32.1 + Token-2022. |

---

## Curve Math: Precision and Overflow Analysis

### The Linear Curve Problem

For `P(x) = P_start + (P_end - P_start) * x / TOTAL_FOR_SALE`:

- `P_start = 900` (lamports per 1M tokens, as in spec)
- `P_end = 3450`
- `TOTAL_FOR_SALE = 460_000_000_000_000` (460M tokens with 6 decimals)
- `Price slope b = (P_end - P_start) / TOTAL_FOR_SALE = 2550 / 460_000_000_000_000`

### Buy Calculation (SOL -> Tokens)

The integral of the linear price function gives:
```
S = a * dx + b * (x2^2 - x1^2) / 2
```

Solving for dx (tokens out) requires the quadratic formula:
```
dx = (-(a + b*x1) + sqrt((a + b*x1)^2 + 2*b*S)) / b
```

### Sell Calculation (Tokens -> SOL)

The sell is the **reverse integral**. Given `dx` tokens to sell starting from position `x1`:
```
SOL_out = a * dx + b * ((x1)^2 - (x1 - dx)^2) / 2
       = a * dx + b * dx * (2*x1 - dx) / 2
       = dx * (a + b * (x1 - dx/2))
```

This is simpler than buy -- no quadratic formula needed. It is a direct evaluation of the definite integral.

### Sell Tax Application

```
gross_sol = sell_integral(tokens_to_sell, current_sold)
tax = gross_sol * 1500 / 10000  // 15%
net_sol = gross_sol - tax
```

The tax SOL goes to a separate escrow vault. On success (both curves graduate), the tax goes to the carnage fund. On failure, the tax returns to the refund pool.

### Precision Strategy: u128 with Manual Scaling

**Recommended: PRECISION = 1_000_000_000_000 (1e12)**

This matches the existing spec's approach and provides adequate precision for the value ranges:

| Operation | Max Value | Fits in u128? |
|---|---|---|
| `a = P_start * PRECISION` | `900 * 1e12 = 9e14` | Yes (u128 max: ~3.4e38) |
| `b = (P_end - P_start) * PRECISION / TOTAL_FOR_SALE` | `2550 * 1e12 / 4.6e14 = ~5543` | Yes |
| `coef_linear = a + b * x1` | `9e14 + 5543 * 4.6e14 = ~2.55e18` | Yes |
| `discriminant = coef^2 + 2*b*S` | `(2.55e18)^2 + 2*5543*1e21 = ~6.5e36` | Yes (fits in u128) |
| `sqrt(discriminant)` | `~2.55e18` | Yes |

**Key insight**: The largest intermediate value is the discriminant at ~6.5e36, which is well within u128 range (max ~3.4e38). No u256 needed.

### Integer Square Root Implementation

Newton's method for integer square root -- standard algorithm, ~15 lines:

```rust
fn integer_sqrt(n: u128) -> Option<u128> {
    if n == 0 { return Some(0); }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    // Verify: x*x <= n < (x+1)*(x+1)
    if x.checked_mul(x)? <= n {
        Some(x)
    } else {
        None
    }
}
```

This converges in O(log(log(n))) iterations -- for u128 values, typically 6-8 iterations. No external crate needed.

### Sell-Side Math: Tokens Sold Counter Direction

**Critical design decision for buy+sell curves:**

When a user sells tokens back to the curve, `tokens_sold` DECREASES. This means:
- The price drops (moving backward along the curve)
- Future buyers get a lower price
- The curve can re-sell tokens that were previously sold and returned

This is fundamentally different from the buy-only spec where `tokens_sold` only increases.

**State changes on sell:**
```
curve.tokens_sold -= tokens_returned    // Price moves backward
curve.sol_raised -= net_sol_returned    // SOL leaves the vault
tax_escrow += tax_amount                // Tax goes to escrow (not user)
```

**Overflow protection:**
- `tokens_sold` cannot go below 0 (checked_sub)
- `sol_raised` cannot go below 0 (checked_sub)
- User cannot sell more tokens than they hold (ParticipantState tracks holdings)
- User cannot sell more tokens than were ever sold on the curve (tokens_sold >= sell_amount)

---

## CPI Depth Analysis (Critical)

### Bonding Curve CPI Chains

The bonding curve program's CPI requirements:

| Operation | CPI Chain | Max Depth |
|---|---|---|
| Buy (SOL -> tokens) | User -> BondingCurve -> Token-2022 -> TransferHook | 3 |
| Sell (tokens -> SOL) | User -> BondingCurve -> Token-2022 -> TransferHook | 3 |
| Transition (graduate) | User -> BondingCurve -> AMM (init_pool) -> Token-2022 -> TransferHook | 4 |
| Refund (SOL return) | User -> BondingCurve (system_program::transfer, no CPI to Token-2022) | 1 |

**Key observations:**

1. **Buy and Sell paths reach depth 3**: This is safe. Solana max is 4 (index 0-4 for 5 levels of stack height).

2. **Transition path reaches depth 4**: This is the maximum. The transition instruction CPIs into AMM to seed pools, which then CPIs into Token-2022, which triggers the Transfer Hook. This matches the existing Carnage execution depth.

3. **The bonding curve CANNOT go through the Tax Program for pool seeding**: Adding Tax to the chain would make it BondingCurve -> Tax -> AMM -> Token-2022 -> Hook = depth 5. This exceeds Solana's limit.

4. **Transition must call AMM directly**: The bonding curve program needs a direct CPI path to AMM's `initialize_pool` (or a new `seed_pool` instruction). This bypasses the Tax Program entirely, which is correct since pool seeding is a one-time administrative action, not a user swap.

### Transfer Hook Integration for Buy/Sell

Token transfers on the bonding curve (both buy and sell) involve Token-2022 `transfer_checked` which triggers the Transfer Hook. This means:

- The bonding curve's token vault must be whitelisted in the Transfer Hook program
- Each buy/sell instruction needs 4 remaining_accounts per mint (ExtraAccountMetaList, whitelist_source, whitelist_dest, hook_program)
- The `transfer_checked_with_hook` manual CPI helper (already used in Staking program) should be reused

**Account count estimate for buy instruction:** ~12 accounts + 4 remaining = ~16 total
**Account count estimate for sell instruction:** ~13 accounts + 4 remaining = ~17 total (extra: tax_escrow)
**Account count estimate for transition:** ~32+ accounts (both curves + both pools + vaults + mints + programs)

The transition instruction may need ALT + v0 VersionedTransaction (same pattern as sell swap path in Tax Program). This is a known pattern in the codebase.

---

## Token-2022 Integration Points

### Curve Token Vaults

Each curve needs a PDA-controlled Token-2022 token account:
- `curve_token_vault` for CRIME or FRAUD tokens (holds tokens for sale)
- `sol_vault` for SOL (system account, not a Token-2022 account)
- `tax_escrow` for SOL from sell taxes (system account)

### Transfer Hook Whitelisting

New whitelist entries needed in the Transfer Hook program:
- CRIME curve token vault (for transfers in/out during buy/sell)
- FRAUD curve token vault (same)
- Tax escrow PDAs (if SOL is wrapped to WSOL for any step -- likely not needed since SOL vault is native)

**Important**: The existing Transfer Hook has `WhitelistAuthority` which was intended to be burned. If it has been burned, new whitelist entries cannot be added. This needs verification.

**If WhitelistAuthority is burned**: The bonding curve token vaults cannot be whitelisted, which means Token-2022 transfers to/from the vault will fail the hook check. This would be a BLOCKER.

**Mitigation options:**
1. Verify WhitelistAuthority status on devnet. If not yet burned, add entries before burning.
2. If already burned on devnet: redeploy Transfer Hook with additional whitelist entries pre-populated.
3. Alternative: The curve could hold tokens in a PDA that IS already whitelisted (e.g., use an existing whitelisted vault). This is hacky and not recommended.

**Confidence: MEDIUM** -- The whitelist authority burn status is unknown without checking devnet state. This is a critical integration question.

### Sell Path: Token Direction

On sell, tokens flow FROM user TO curve_token_vault. The Transfer Hook validates that at least one side (source or destination) is whitelisted. Since curve_token_vault will be whitelisted, the sell transfer will pass the hook check.

On buy, tokens flow FROM curve_token_vault TO user. Same logic applies -- vault is whitelisted, so the hook check passes.

---

## Frontend Stack (Launch Page)

### No New npm Dependencies Needed

The existing frontend stack has everything needed for a bonding curve launch page:

| Need | Existing Solution | Why No New Dependency |
|---|---|---|
| Charts (curve visualization) | `lightweight-charts` 5.1.0 | Already installed. Can render the bonding curve as a line chart or area chart. |
| Progress bars | Tailwind CSS utilities | `w-[${percent}%]` with transition. No library needed for simple progress bars. |
| Countdown timers | `Date.now()` + `setInterval` | Trivial to implement. The 48-hour deadline is slot-based on-chain but can be displayed as wall-clock time using slot duration estimate. |
| SOL price display | Existing Jupiter Price API integration | Already integrated in the frontend. |
| Wallet connection | `@solana/wallet-adapter-react` | Already installed and configured. |
| Transaction building | `@coral-xyz/anchor` 0.32.1 | Already installed. Will generate IDL types for the new program. |
| Number formatting | Manual (existing patterns) | The codebase already has SOL/token formatting utilities. |

### What NOT to Add (Frontend)

| Rejected | Why |
|---|---|
| `chart.js` or `recharts` | `lightweight-charts` is already installed and handles financial charts well. Adding a second chart library increases bundle size for no benefit. |
| `react-countdown` | A 48-hour countdown is ~10 lines of React. No need for a library. |
| `framer-motion` | The steampunk factory scene uses CSS animations. Adding a motion library for one page is overkill. |
| `@solana/web3.js` v2 | Locked to v1. See STACK.md constraints. |
| `decimal.js` | Frontend bonding curve math (preview calculations) can use JavaScript's native `number` for display purposes. Precision-critical math happens on-chain. |
| `bignumber.js` | The project already uses `BN` from `@coral-xyz/anchor` (bn.js). No need for a competing BigNumber library. |

### Frontend Curve Math (Preview Only)

For purchase/sell previews in the UI, JavaScript native `number` (64-bit float) provides sufficient precision:

```typescript
// These are DISPLAY calculations only -- on-chain math is authoritative
const P_START = 0.0000009;  // SOL per token
const P_END = 0.00000345;
const TOTAL_FOR_SALE = 460_000_000;

function previewBuy(solAmount: number, currentSold: number): number {
  const a = P_START;
  const b = (P_END - P_START) / TOTAL_FOR_SALE;
  const x1 = currentSold;
  const discriminant = (a + b * x1) ** 2 + 2 * b * solAmount;
  const dx = (-(a + b * x1) + Math.sqrt(discriminant)) / b;
  return Math.min(dx, TOTAL_FOR_SALE - currentSold);
}

function previewSell(tokenAmount: number, currentSold: number): number {
  const a = P_START;
  const b = (P_END - P_START) / TOTAL_FOR_SALE;
  const x1 = currentSold;
  const x2 = x1 - tokenAmount;
  // Integral from x2 to x1
  const grossSol = a * tokenAmount + b * (x1 ** 2 - x2 ** 2) / 2;
  const tax = grossSol * 0.15;
  return grossSol - tax;
}
```

**Precision note**: JavaScript `number` has 53 bits of mantissa (~15-16 significant digits). For display preview of SOL amounts (max ~1000 SOL = 1e12 lamports), this provides more than adequate precision. The on-chain u128 math with 1e12 scaling is authoritative.

---

## Shared Constants (Cross-Program)

### New Shared Constants Module

The bonding curve program needs to share constants with:
- The deploy/initialize script
- The frontend
- Tests

Recommend extending the existing `shared/` workspace package:

```typescript
// shared/src/bonding-curve-constants.ts
export const BONDING_CURVE = {
  TOTAL_FOR_SALE: 460_000_000,        // 460M tokens (pre-decimal)
  TARGET_SOL: 1_000,                   // 1000 SOL
  P_START_LAMPORTS: 900,               // lamports per 1M tokens
  P_END_LAMPORTS: 3_450,               // lamports per 1M tokens
  SELL_TAX_BPS: 1_500,                 // 15%
  BUY_TAX_BPS: 0,                      // 0%
  MAX_TOKENS_PER_WALLET: 20_000_000,   // 20M tokens
  MIN_PURCHASE_SOL: 0.05,              // 0.05 SOL
  DEADLINE_HOURS: 48,
  DEADLINE_SLOTS: 432_000,             // 48h at 400ms/slot
} as const;
```

---

## Testing Stack

### On-Chain Tests

| Layer | Tool | What | Pattern From |
|---|---|---|---|
| Unit tests | `cargo test` (Rust native) | Curve math functions, overflow cases, edge cases | AMM `math.rs` |
| Property tests | `proptest` 1.9 | All-inputs validation of curve math invariants | AMM proptest module |
| Integration tests | `ts-mocha` + `@coral-xyz/anchor` | Full buy/sell/transition/refund flows against local validator | Existing `tests/` directory |

### Key Proptest Properties for Bonding Curve

1. **Buy-sell round-trip conservation**: `buy(S) -> sell(tokens) <= S` (sell tax means user always gets back less)
2. **Price monotonicity**: `price(x+1) >= price(x)` for all `x` in range
3. **Integral correctness**: `sum(buy_integral) = total_sol_raised` at curve completion
4. **Sell tax conservation**: `gross_sol = net_sol + tax` for all sell operations
5. **No overflow**: All operations on maximum inputs produce valid results or explicit errors

### Dev-Dependencies (Unchanged from Existing Programs)

```toml
[dev-dependencies]
proptest = "1.9"
```

No additional test dependencies needed. The integration test framework (`ts-mocha` + Anchor) is already configured in `Anchor.toml`.

---

## Deployment Integration

### Anchor.toml Addition

```toml
[programs.devnet]
bonding_curve = "BONDING_CURVE_PROGRAM_ID_HERE"

[programs.localnet]
bonding_curve = "BONDING_CURVE_PROGRAM_ID_HERE"
```

### deploy-all.sh Extension

The existing `deploy-all.sh` pipeline (Phase 0 -> Phase 4) should be extended to include the bonding curve program. The bonding curve does NOT have chicken-and-egg mint address dependencies (unlike Conversion Vault), since curve addresses are derived from the mint addresses which are already known.

### Feature-Gating for Devnet

```rust
#[cfg(feature = "devnet")]
pub const DEADLINE_SLOTS: u64 = 750;   // ~5 min for testing
#[cfg(not(feature = "devnet"))]
pub const DEADLINE_SLOTS: u64 = 432_000; // 48 hours for mainnet
```

Same pattern as `epoch-program` which uses `devnet` feature for shorter epoch intervals.

---

## Compute Budget Estimate

Based on the existing program measurements:

| Instruction | Estimated CU | Basis | Status |
|---|---|---|---|
| `purchase` (buy) | ~30,000-50,000 | Curve math + system_transfer + Token-2022 transfer_checked + hook | OK (< 200K) |
| `sell` (sell) | ~35,000-55,000 | Same as buy + tax calculation + escrow transfer | OK (< 200K) |
| `initialize_curve` | ~10,000-15,000 | Account creation only | OK |
| `execute_transition` | ~150,000-200,000 | Multiple CPI calls to AMM + Token-2022 + Hook | WARNING -- may need elevated CU budget |

**Note on transition CU**: The `execute_transition` instruction is complex (32+ accounts, multiple CPI calls). It may need `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` to be safe. This should be measured in testing.

---

## Architecture Decision: Sell Tax Escrow

### The Problem

The 15% sell tax creates a novel accounting challenge:
- On **curve success**: Tax SOL should go to the carnage fund
- On **curve failure**: Tax SOL should be included in the refund pool

This means the tax cannot be immediately sent to the carnage fund -- it must be escrowed until outcome is determined.

### Recommended Approach

**Separate `tax_escrow` PDA per curve** (system account holding native SOL):

```
seeds = ["curve_tax_escrow", token_mint]
program = bonding_curve_program
```

- On each sell: `tax_amount` transferred from `sol_vault` to `tax_escrow`
- Wait, actually: `gross_sol` from sell integral stays in `sol_vault`. Only `net_sol` goes to user. The remaining `tax_amount` stays in `sol_vault`.
- **Simpler approach**: Track `total_tax_collected` as a field on `CurveState`. The sol_vault holds ALL SOL (raised + tax). On refund, users get back `participant.sol_spent`. On success, `sol_vault - total_sol_raised_from_buys` = tax pool goes to carnage.

Actually, the cleanest approach for buy+sell:

- `sol_vault` holds all SOL (from buys) minus SOL returned (from sells)
- `tax_collected` field tracks cumulative sell tax
- On refund: users get proportional refund based on their TOKEN HOLDINGS (not sol_spent, since they may have sold some)
- On success: `tax_collected` SOL goes to carnage, remaining SOL seeds pools

**This is a design decision that affects the state model. Flagged for discussion with the user.**

---

## Summary: Complete Stack for Bonding Curve

### On-Chain (New Program)

| Component | Technology | Version |
|---|---|---|
| Framework | anchor-lang | 0.32.1 |
| Token operations | anchor-spl (token_2022) | 0.32.1 |
| Curve math | Pure Rust (u128 + checked arithmetic) | N/A |
| Integer sqrt | Newton's method (inline) | N/A |
| Property testing | proptest | 1.9 |
| Integration testing | ts-mocha + Anchor | Existing |

### Frontend (Launch Page Addition)

| Component | Technology | Version | Status |
|---|---|---|---|
| Framework | Next.js | 16.1.6 | Already installed |
| UI framework | React | 19.2.3 | Already installed |
| Styling | Tailwind CSS | v4.1.18 | Already installed |
| Charts | lightweight-charts | 5.1.0 | Already installed |
| Wallet | @solana/wallet-adapter-react | ^0.15.39 | Already installed |
| Transaction builder | @coral-xyz/anchor | 0.32.1 | Already installed |
| BigNumber | BN (from Anchor/bn.js) | Bundled | Already installed |

**Net new dependencies: ZERO**

### What Needs Building (Not Forking)

1. **Bonding curve program** (~1,500-2,500 LOC estimated)
   - State accounts (CurveState, ParticipantState, ReserveState)
   - Instructions (initialize, fund, start, purchase, sell, mark_failed, claim_refund, execute_transition)
   - Math module (price calculation, buy integral, sell integral, integer sqrt)
   - Error types
2. **Curve math unit tests + proptest** (~500-800 LOC)
3. **Integration tests** (~800-1,200 LOC)
4. **Frontend launch page** (new page route + components)
5. **Deploy/initialize script extensions**
6. **Transfer Hook whitelist entries** (for new curve vaults)

---

## Open Questions (Flagged for User Discussion)

1. **WhitelistAuthority status**: Has the Transfer Hook WhitelistAuthority been burned on devnet? If yes, how do we whitelist the new curve vaults?

2. **Sell tax accounting**: Should tax be tracked as a separate field on CurveState, or held in a separate PDA? The tracking approach is simpler but the separate PDA is more auditable.

3. **Refund calculation with buy+sell**: If a user buys 10M tokens then sells 5M, what is their refund basis? Options:
   - Refund based on current token holdings (proportional share of sol_vault)
   - Refund based on net SOL spent (sol_spent - sol_received_from_sells)
   - Refund the full sol_vault proportional to tokens held

4. **Transition instruction size**: With 32+ accounts, does transition need an ALT? Should it be split into multiple instructions (e.g., `transition_seed_crime_pool` + `transition_seed_fraud_pool` + `transition_finalize`)?

5. **Curve program CPI to AMM**: Does AMM's `initialize_pool` instruction exist and accept CPI calls? Or does the bonding curve need to transfer SOL/tokens to a staging area, and then a separate admin script calls AMM?

---

## Sources and Confidence

| Claim | Confidence | Source |
|---|---|---|
| Anchor 0.32.1 compatibility | HIGH | Verified from existing Cargo.toml files in the codebase |
| Token-2022 CPI patterns | HIGH | Verified from existing programs (Staking, Conversion Vault) |
| u128 precision sufficient for curve math | HIGH | Manual calculation of intermediate values against u128 max |
| pump.fun is buy-only | MEDIUM | Training data + spec analysis (needs live verification) |
| Strata Protocol is archived | LOW | Training data only -- verify with `gh repo view strata-foundation/strata` |
| No suitable forkable implementation exists | MEDIUM | Based on training data assessment of known repos. Live GitHub search recommended. |
| Frontend needs zero new dependencies | HIGH | Verified from existing app/package.json |
| Compute budget estimates | MEDIUM | Extrapolated from similar instructions in existing programs |
| Transfer Hook whitelist concern | HIGH | Logical deduction from architecture docs -- needs devnet state verification |
