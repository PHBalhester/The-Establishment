# Phase 94: Bonding Curve Deadline + Pathway 1 - Research

**Researched:** 2026-03-13
**Domain:** Solana bonding curve lifecycle testing (deploy, buy/sell, expiry, refund)
**Confidence:** HIGH

## Summary

Phase 94 verifies the complete "failure path" of the bonding curve protocol: deploy a partial protocol (Bonding Curve + Transfer Hook + mints), buy/sell tokens during a 30-minute window, let curves expire, then claim proportional refunds. This is an integration testing phase that exercises existing, well-tested on-chain code in a real devnet environment.

The on-chain programs are already built and audited (v1.3). The work is: (1) add a devnet DEADLINE_SLOTS constant variant, (2) add devnet-scaled curve parameters, (3) extend deploy-all.sh with a `--partial` flag, (4) write test scripts for multi-wallet buy/sell/refund, and (5) verify refund math matches expectations.

**Primary recommendation:** This phase requires no new library research -- it composes existing infrastructure (deploy pipeline, frontend, on-chain programs). Focus the plan on the sequencing of operations and the devnet constant scaling math.

## Standard Stack

No new libraries needed. Phase 94 uses the existing project stack:

### Core (Already Installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| @coral-xyz/anchor | 0.32.1 | Program framework + client | In use |
| @solana/web3.js | 1.x | Solana RPC client | In use |
| @solana/spl-token | latest | Token-2022 operations | In use |
| anchor-lang | 0.32.1 | Rust program framework | In use |

### Supporting (Already Installed)
| Library | Purpose | When Used |
|---------|---------|-----------|
| tsx | TypeScript script runner | pathway1-test.ts, verify-refunds.ts |
| fs/path | File I/O | JSON log output, markdown report |

**No new dependencies required.**

## Architecture Patterns

### Devnet Feature Flag Pattern (Existing, Extend)

The project already uses `#[cfg(feature = "devnet")]` for compile-time environment selection. The bonding curve's `constants.rs` currently has two DEADLINE_SLOTS variants:

```rust
// Current state:
#[cfg(not(feature = "localnet"))]
pub const DEADLINE_SLOTS: u64 = 432_000;  // ~48hr mainnet

#[cfg(feature = "localnet")]
pub const DEADLINE_SLOTS: u64 = 500;      // localnet testing
```

**Required change:** Add a devnet variant using the three-way cfg pattern already used for `crime_mint()`, `fraud_mint()`, and `epoch_program_id()`:

```rust
// Target state:
#[cfg(feature = "devnet")]
pub const DEADLINE_SLOTS: u64 = 4_500;    // ~30 min devnet

#[cfg(feature = "localnet")]
pub const DEADLINE_SLOTS: u64 = 500;      // localnet testing

#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub const DEADLINE_SLOTS: u64 = 432_000;  // ~48hr mainnet
```

**Confidence: HIGH** -- This exact three-way pattern exists in the same file for mint functions.

### Devnet Curve Parameter Scaling

CONTEXT.md decided: TARGET_SOL scaled to 5 SOL for devnet. All dependent constants must scale proportionally.

**Scaling math (5 SOL target vs 1000 SOL mainnet = 1:200 ratio):**

| Constant | Mainnet | Devnet | Derivation |
|----------|---------|--------|------------|
| TARGET_SOL | 1,000 SOL (1,000,000,000,000 lam) | 5 SOL (5,000,000,000 lam) | Direct decision |
| TARGET_TOKENS / TOTAL_FOR_SALE | 460,000,000 tokens (460e12 base) | 460,000,000 tokens (460e12 base) | Keep same -- tokens sold is unchanged |
| P_START | 900 lam/human token | ~4 lam/human token | Derived: 5 SOL / 460M * 2 / (1 + P_END/P_START ratio) |
| P_END | 3,450 lam/human token | ~17 lam/human token | Maintains P_END/P_START = 3.833x ratio |
| MAX_TOKENS_PER_WALLET | 20M tokens (20e12 base) | 20M tokens (20e12 base) | Keep same -- wallet cap unchanged |
| MIN_PURCHASE_SOL | 0.05 SOL (50,000,000 lam) | 0.001 SOL (1,000,000 lam) | Scale proportionally for testability |

**CRITICAL NOTE:** The exact P_START/P_END derivation for 5 SOL target requires careful recalculation. The linear bonding curve integral formula is:

```
Total SOL = (P_START + P_END) / 2 * TOTAL_FOR_SALE / TOKEN_DECIMAL_FACTOR
```

Solving for 5 SOL:
```
5e9 = (P_START + P_END) / 2 * 460e6
(P_START + P_END) = 5e9 * 2 / 460e6 = ~21.74 lamports/human-token
```

Maintaining the same ratio (P_END/P_START = 3450/900 = 3.833):
```
P_START + 3.833 * P_START = 21.74
4.833 * P_START = 21.74
P_START = ~4.5 -> round to 4 or 5
P_END = P_START * 3.833 -> round accordingly
```

**The planner must verify the exact integer values produce the desired 5 SOL target.** Rounding means the actual target may differ slightly -- this is fine for devnet but must be documented.

**Confidence: MEDIUM** -- Math derivation is straightforward but exact integer rounding needs verification.

### Client-Side Curve Constants

`app/lib/curve/curve-constants.ts` has hardcoded mainnet values (P_START=900, P_END=3450, TARGET_SOL=1000 SOL). These are used for:
- Price preview calculations in BuySellPanel
- Refund estimate calculations in RefundPanel
- Gauge needle percentage in LaunchPage

**For devnet testing, these must match the devnet on-chain values.** Options:
1. Feature-flag the constants file (NEXT_PUBLIC env var driven)
2. Read constants from deployment.json at build time
3. Hardcode devnet values for this test, revert later

Option 1 is cleanest: `NEXT_PUBLIC_CLUSTER=devnet` already exists (used for Sentry). Add devnet-aware constant selection in curve-constants.ts.

**Confidence: HIGH** -- Pattern already exists for cluster awareness.

### Partial Deploy Pipeline

CONTEXT.md decided: `deploy-all.sh --partial` deploys only Bonding Curve + Transfer Hook + mints.

**What to deploy:**
1. Transfer Hook program (whitelist enforcement)
2. Bonding Curve program (curve logic)
3. CRIME mint (Token-2022 with Transfer Hook extension + MetadataPointer)
4. FRAUD mint (Token-2022 with Transfer Hook extension + MetadataPointer)
5. Transfer Hook whitelist authority PDA
6. ExtraAccountMetaList PDAs for CRIME and FRAUD
7. Whitelist entries for curve PDAs (token_vault, sol_vault, etc.)
8. BcAdminConfig PDA
9. CurveState PDAs for both CRIME and FRAUD
10. Token vault PDAs (funded with 460M tokens each)
11. SOL vault PDAs
12. Tax escrow PDAs
13. ALT with partial address set

**What NOT to deploy:** AMM, Tax Program, Epoch Program, Staking, Conversion Vault, PROFIT mint.

**Implementation approach:** Skip deploy phases for unused programs in deploy.sh, skip initialize.ts steps that reference undeployed programs. The `--partial` flag would:
- In build.sh: Only build transfer_hook and bonding_curve
- In deploy.sh: Only deploy those two programs
- In initialize.ts: Only run Steps 1-5 (mints), Step 9-10 (whitelist), Steps 15-18 (curves)
- Skip: generate-constants for missing programs, ALT creation for missing addresses

**Confidence: HIGH** -- deploy pipeline is well-understood from prior phases.

### Test Script Architecture

```
scripts/test/
  pathway1-test.ts    -- Generates wallets, funds them, executes buy/sell patterns
  verify-refunds.ts   -- Reads JSON log, calculates expected vs actual, generates report
  pathway1-log.json   -- Structured output from pathway1-test.ts
  Docs/pathway1-report.md  -- Final markdown report
```

**pathway1-test.ts workflow:**
1. Generate N keypairs (5+ wallets)
2. Fund each from devnet wallet (transfer SOL)
3. For each wallet: create ATA (init_if_needed in purchase IX handles this)
4. Execute varied buy patterns on CRIME and FRAUD curves
5. Execute some sell patterns (partial sells)
6. Log all actions to JSON: {wallet, curve, action, amount, txSig, slot, tokenBalance}
7. Wait for deadline (30 min)
8. Call mark_failed on both curves (permissionless)
9. Call consolidate_for_refund on both curves (permissionless)
10. For each wallet: call claim_refund, log pre/post balances
11. Save structured JSON log

**verify-refunds.ts workflow:**
1. Read pathway1-log.json
2. For each wallet, calculate expected refund:
   - expected = floor(userBalance * refundPool / totalOutstanding)
   - refundPool = solRaised - solReturned + taxCollected (from on-chain state pre-claim)
3. Compare expected vs actual SOL received
4. Generate Docs/pathway1-report.md with pass/fail per wallet

**Confidence: HIGH** -- Follows established script patterns (initialize.ts, carnage-flow.ts).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA derivation | Manual seed concatenation | Existing `SEEDS` from shared, `deriveCurveState()` from curve-tx-builder | Already correct and tested |
| Transaction building | Raw instruction construction | `buildPurchaseInstruction`, `buildSellInstruction`, `buildClaimRefundInstruction` from curve-tx-builder.ts | Transfer Hook accounts handled |
| Refund math | Custom calculation | Mirror the exact on-chain `claim_refund.rs` formula | Must match exactly |
| Deploy pipeline | New deploy script | Extend existing deploy-all.sh with --partial | Reuse tested infrastructure |
| Curve state parsing | Custom deserializer | Anchor program.account.curveState.fetch() | Already handles all field types |

## Common Pitfalls

### Pitfall 1: Client Constants Drift from On-Chain
**What goes wrong:** Frontend shows wrong refund estimates because curve-constants.ts has mainnet values while on-chain has devnet values.
**Why it happens:** P_START, P_END, TARGET_SOL are hardcoded in both places.
**How to avoid:** Add devnet-aware constant selection in curve-constants.ts BEFORE deploying to Railway.
**Warning signs:** Gauge shows wrong percentage, refund estimate doesn't match claim.

### Pitfall 2: Transfer Hook Whitelist Missing for Curve PDAs
**What goes wrong:** Purchase and sell transactions fail with Transfer Hook errors.
**Why it happens:** Token-2022 Transfer Hook requires source and destination to be whitelisted. Curve token_vault PDAs must have whitelist entries.
**How to avoid:** initialize.ts Steps 9-10 create whitelist entries -- ensure they run for curve PDAs.
**Warning signs:** Error 3005 (AccountNotEnoughKeys) or custom hook errors on buy/sell.

### Pitfall 3: Compile-Time Invariant Assertion Failure
**What goes wrong:** `anchor build -p bonding_curve -- --features devnet` fails with compile error.
**Why it happens:** constants.rs has compile-time assertions (P_END > P_START, TOTAL_FOR_SALE > 0, TARGET_TOKENS == TOTAL_FOR_SALE as u64). If devnet constants violate these, build fails.
**How to avoid:** Verify all compile-time assertions pass with devnet values before building.
**Warning signs:** Build error mentioning const assertion.

### Pitfall 4: mark_failed Timing on Devnet
**What goes wrong:** mark_failed call fails with DeadlineNotPassed.
**Why it happens:** Devnet slot timing is not perfectly 400ms. Must wait for `current_slot > deadline_slot + 150 (FAILURE_GRACE_SLOTS)`.
**How to avoid:** Poll current slot, only call mark_failed when slot is safely past deadline + grace.
**Warning signs:** DeadlineNotPassed error from bonding curve program.

### Pitfall 5: Escrow Consolidation Order
**What goes wrong:** claim_refund fails with EscrowNotConsolidated.
**Why it happens:** consolidate_for_refund must be called BEFORE any claim_refund.
**How to avoid:** Script calls consolidate_for_refund for both curves before any claim attempts.
**Warning signs:** EscrowNotConsolidated error.

### Pitfall 6: Partner Curve Validation in Refund
**What goes wrong:** claim_refund fails with InvalidPartnerCurve.
**Why it happens:** claim_refund requires the partner curve's CurveState PDA. CRIME's partner is FRAUD and vice versa. The partner_mint stored in CurveState must match.
**How to avoid:** initialize_curve is called with correct `partner_mint` parameter. Frontend buildClaimRefundInstruction already handles this.
**Warning signs:** InvalidPartnerCurve error.

### Pitfall 7: SOL Budget Exhaustion
**What goes wrong:** Test wallets run out of SOL mid-test.
**Why it happens:** Each buy costs SOL + TX fees. 5+ wallets buying on both curves with devnet 5 SOL targets = significant SOL.
**How to avoid:** Budget calculation upfront. With 5 SOL per curve, max total buys = 10 SOL. Account for TX fees (~0.01 SOL per TX). Fund devnet wallet with at least 15 SOL.
**Warning signs:** Insufficient balance errors during automated buys.

### Pitfall 8: Stale Deployment Addresses
**What goes wrong:** Frontend points to old Phase 69 curve PDAs that don't exist.
**Why it happens:** Partial deploy creates new mint keypairs -> new PDA addresses. shared/constants.ts and DEVNET_CURVE_PDAS must be regenerated.
**How to avoid:** generate-constants.ts runs after deploy, Railway env vars updated.
**Warning signs:** "Account not found" errors in useCurveState.

## Code Examples

### Devnet DEADLINE_SLOTS (Three-Way CFG)

```rust
// Source: programs/bonding_curve/src/constants.rs
// Pattern already used for crime_mint(), fraud_mint(), epoch_program_id()

#[cfg(feature = "devnet")]
pub const DEADLINE_SLOTS: u64 = 4_500;    // ~30 min at 400ms/slot

#[cfg(feature = "localnet")]
pub const DEADLINE_SLOTS: u64 = 500;

#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub const DEADLINE_SLOTS: u64 = 432_000;  // ~48hr mainnet
```

### Devnet Curve Parameters (Template)

```rust
// These need exact integer values verified via the integral formula.
// Template showing the pattern:

#[cfg(feature = "devnet")]
pub const P_START: u128 = /* TBD -- ~4-5 */;

#[cfg(feature = "devnet")]
pub const P_END: u128 = /* TBD -- ~17-18 */;

#[cfg(feature = "devnet")]
pub const TARGET_SOL: u64 = 5_000_000_000;  // 5 SOL

// TOTAL_FOR_SALE and TARGET_TOKENS stay the same (460M tokens)
// MAX_TOKENS_PER_WALLET stays the same (20M tokens)
```

### Waiting for Mark Failed (Script Pattern)

```typescript
// Poll current slot until past deadline + grace
async function waitForDeadline(
  connection: Connection,
  deadlineSlot: number,
  graceSlots: number = 150
): Promise<void> {
  const targetSlot = deadlineSlot + graceSlots + 1;
  while (true) {
    const slot = await connection.getSlot("confirmed");
    if (slot > targetSlot) break;
    const remaining = targetSlot - slot;
    const estSeconds = remaining * 0.4;
    console.log(`Waiting... ${remaining} slots (~${Math.ceil(estSeconds)}s remaining)`);
    await new Promise(r => setTimeout(r, 10_000)); // check every 10s
  }
}
```

### Calling consolidate_for_refund

```typescript
// Both curves must be consolidated before any claim_refund
async function consolidateEscrow(
  program: Program<BondingCurve>,
  tokenMint: PublicKey,
  partnerMint: PublicKey,
): Promise<string> {
  const curveState = deriveCurveState(tokenMint, program.programId);
  const partnerCurveState = deriveCurveState(partnerMint, program.programId);
  const taxEscrow = deriveTaxEscrow(tokenMint, program.programId);
  const solVault = deriveSolVault(tokenMint, program.programId);

  return program.methods
    .consolidateForRefund()
    .accounts({
      curveState,
      partnerCurveState,
      taxEscrow,
      solVault,
    })
    .rpc();
}
```

## State of the Art

| Aspect | Current State | Impact on Phase 94 |
|--------|---------------|-------------------|
| On-chain programs | Audited v1.3, all findings closed | No program changes needed beyond constants |
| Deploy pipeline | 7-phase pipeline (Phase 91) | Extend with --partial flag |
| Frontend launch page | Complete (Phases 53-59, 70-77) | Already handles active/failed/refund states |
| RefundPanel | Built and tested locally | Needs real devnet exercise |
| Feature flags | devnet/localnet pattern established | Add devnet DEADLINE_SLOTS variant |

**No deprecated or outdated approaches in use.**

## Open Questions

1. **Exact devnet P_START / P_END integer values**
   - What we know: Must produce ~5 SOL total raised for 460M tokens sold
   - What's unclear: Exact integer rounding that satisfies compile-time assertions AND produces acceptable target
   - Recommendation: Derive in Plan 01, verify with unit test

2. **Frontend curve-constants.ts cluster-awareness**
   - What we know: NEXT_PUBLIC_CLUSTER env var exists, constants are currently hardcoded
   - What's unclear: Whether to use env var at build time or runtime import
   - Recommendation: Build-time env var (NEXT_PUBLIC_ prefix already works with Next.js)

3. **ALT for partial deploy**
   - What we know: Full protocol ALT has 46 addresses, partial only needs ~12
   - What's unclear: Whether to create a separate partial ALT or reuse full ALT creation with a subset
   - Recommendation: Create new ALT with only the addresses needed (curve PDAs, hook PDAs, programs)

4. **deploy-all.sh --partial skip mechanism**
   - What we know: Current pipeline has 7 phases in sequence
   - What's unclear: Best way to skip phases -- conditional blocks vs separate mode
   - Recommendation: Conditional blocks within each phase (if not --partial, skip)

## Sources

### Primary (HIGH confidence)
- `programs/bonding_curve/src/constants.rs` -- Current feature flag patterns, compile-time assertions
- `programs/bonding_curve/src/instructions/` -- All instruction files reviewed (claim_refund, consolidate_for_refund, mark_failed, purchase, sell, initialize_curve, start_curve)
- `programs/bonding_curve/src/state.rs` -- CurveState struct, CurveStatus enum, is_refund_eligible logic
- `programs/bonding_curve/Cargo.toml` -- Feature flags: devnet, localnet defined
- `scripts/deploy/deploy-all.sh` -- Full 7-phase pipeline
- `scripts/deploy/build.sh` -- Build with --devnet flag pattern
- `scripts/deploy/initialize.ts` -- Initialization sequence
- `app/components/launch/StateMachineWrapper.tsx` -- State machine rendering logic
- `app/components/launch/RefundPanel.tsx` -- Refund UI with claim flow
- `app/hooks/useCurveState.ts` -- WebSocket subscription to curve PDAs
- `app/lib/curve/curve-constants.ts` -- Client-side curve constants
- `app/lib/curve/curve-tx-builder.ts` -- Transaction builders including claim_refund

### Secondary (MEDIUM confidence)
- Devnet slot timing (~400ms/slot is approximate, actual timing varies)
- SOL budget estimates (TX fees vary with priority fees)

## Metadata

**Confidence breakdown:**
- Feature flag implementation: HIGH -- Exact pattern exists in same file
- Devnet constant scaling: MEDIUM -- Math derivation straightforward, integer rounding needs verification
- Deploy pipeline extension: HIGH -- Pipeline well-understood, --partial is surgical
- Test script architecture: HIGH -- Follows established project patterns
- Frontend changes: HIGH -- Cluster-awareness pattern exists

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable domain, no external dependencies changing)
