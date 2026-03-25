# Concept Inventory

**Created:** 2026-02-01
**Phase:** 03-cross-reference
**Purpose:** Master inventory of all concepts extracted from 12 specification documents

## Dashboard

| Concept Type | Count | ID Range |
|--------------|-------|----------|
| Constants (CONST) | 15 | CONST-001 to CONST-015 |
| Entities (ENT) | 14 | ENT-001 to ENT-014 |
| Behaviors (BEH) | 16 | BEH-001 to BEH-016 |
| Constraints (CONSTR) | 14 | CONSTR-001 to CONSTR-014 |
| Formulas (FORM) | 8 | FORM-001 to FORM-008 |
| Terminology (TERM) | 10 | TERM-001 to TERM-010 |
| Assumptions (ASSUMP) | 8 | ASSUMP-001 to ASSUMP-008 |
| **Total** | **85** | - |

**Documents Processed:** 12/12

---

## 1. Constants (CONST)

Numeric values, percentages, rates, durations, thresholds.

### CONST-001: LP_FEE_SOL_POOLS

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | 100 bps (1%) |
| Also Appears In | DrFraudsworth_Overview.md, AMM_Implementation.md |
| Location | Tax_Pool_Logic_Spec.md:Section 2.1 |

**Context:** LP fee applied to all swaps in SOL-paired pools (CRIME/SOL, FRAUD/SOL). Applied to input amount before tax calculation. Compounds into pool liquidity.

### CONST-002: LP_FEE_PROFIT_POOLS

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | 50 bps (0.5%) |
| Also Appears In | DrFraudsworth_Overview.md, AMM_Implementation.md, Soft_Peg_Arbitrage_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 2.1 |

**Context:** LP fee for PROFIT-paired pools (CRIME/PROFIT, FRAUD/PROFIT). Lower than SOL pools. No taxes on these pools.

### CONST-003: TAX_LOW_RANGE

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | 100-400 bps (1-4%) |
| Also Appears In | DrFraudsworth_Overview.md, Epoch_State_Machine_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 6 |

**Context:** Range for "low" tax values. Applied to the cheap side buy and expensive side sell. Sampled uniformly within band via VRF.

### CONST-004: TAX_HIGH_RANGE

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | 1100-1400 bps (11-14%) |
| Also Appears In | DrFraudsworth_Overview.md, Epoch_State_Machine_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 6 |

**Context:** Range for "high" tax values. Applied to cheap side sell and expensive side buy. Sampled uniformly within band via VRF.

### CONST-005: EPOCH_LENGTH_SLOTS

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | 4,500 slots (~30 minutes at 400ms/slot) |
| Also Appears In | DrFraudsworth_Overview.md (as "30 minutes") |
| Location | Epoch_State_Machine_Spec.md:Section 3.1 |

**Context:** Duration of one epoch in Solana slots. Slot-based timing (not wall-clock) for deterministic boundaries.

### CONST-006: VRF_TIMEOUT_SLOTS

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | 300 slots (~2 minutes) |
| Also Appears In | Single-source |
| Location | Epoch_State_Machine_Spec.md:Section 3.1 |

**Context:** Maximum wait time for VRF callback. After this, anyone can call retry_vrf_request.

### CONST-007: CARNAGE_DEADLINE_SLOTS

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | 100 slots (~40 seconds) |
| Also Appears In | Carnage_Fund_Spec.md |
| Location | Epoch_State_Machine_Spec.md:Section 3.1 |

**Context:** Fallback window for manual Carnage execution if atomic execution fails.

### CONST-008: TRIGGER_BOUNTY

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | 10,000,000 lamports (0.01 SOL) |
| Also Appears In | Single-source |
| Location | Epoch_State_Machine_Spec.md:Section 3.1 |

**Context:** Bounty paid from treasury to whoever triggers epoch transition. Incentivizes permissionless triggering.

### CONST-009: YIELD_DISTRIBUTION_SHARE

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | 75% of taxes |
| Also Appears In | DrFraudsworth_Overview.md, Yield_System_Spec.md, Carnage_Fund_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 4 |

**Context:** Portion of collected SOL taxes distributed to PROFIT holders. Primary source of yield.

### CONST-010: CARNAGE_FUND_SHARE

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | 24% of taxes |
| Also Appears In | DrFraudsworth_Overview.md, Carnage_Fund_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 4 |

**Context:** Portion of collected SOL taxes sent to Carnage Fund for chaos mechanism.

### CONST-011: TREASURY_SHARE

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | 1% of taxes |
| Also Appears In | Carnage_Fund_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 4 |

**Context:** Portion of taxes to protocol multisig treasury.

### CONST-012: CARNAGE_TRIGGER_PROBABILITY

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | ~4.3% (11/256, approximately 1/24) |
| Also Appears In | DrFraudsworth_Overview.md (as "1/24"), Carnage_Fund_Spec.md |
| Location | Epoch_State_Machine_Spec.md:Section 7.2 (byte 3) |

**Context:** Probability of Carnage triggering each epoch. VRF byte 3 < 11 triggers Carnage.

### CONST-013: REGIME_FLIP_PROBABILITY

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | 75% (192/256) |
| Also Appears In | DrFraudsworth_Overview.md, Tax_Pool_Logic_Spec.md |
| Location | Epoch_State_Machine_Spec.md:Section 7.2 (byte 0) |

**Context:** Probability of cheap side flipping each epoch. VRF byte 0 < 192 triggers flip.

### CONST-014: PROFIT_TOTAL_SUPPLY

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | DrFraudsworth_Overview.md |
| Value | 50,000,000 (50M with 6 decimals) |
| Also Appears In | Yield_System_Spec.md, Bonding_Curve_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Soft Peg Mechanism" |

**Context:** Fixed forever. Half paired with CRIME, half with FRAUD in PROFIT pools.

### CONST-015: MAX_CARNAGE_SWAP

| Field | Value |
|-------|-------|
| Type | Constant |
| Primary Document | Carnage_Fund_Spec.md |
| Value | 1,000,000,000,000 lamports (1000 SOL) |
| Also Appears In | Single-source |
| Location | Carnage_Fund_Spec.md:Section 9.1 |

**Context:** Maximum SOL per Carnage swap execution. Prevents "too big to execute" failures.

---

## 2. Entities (ENT)

Tokens, pools, accounts, programs, roles.

### ENT-001: CRIME Token

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | DrFraudsworth_Overview.md |
| Value | IP token A, Token-2022 with transfer hook |
| Also Appears In | All specs |
| Location | DrFraudsworth_Overview.md:Section "Token Structure" |

**Context:** One of two interchangeable IP tokens. Subject to asymmetric taxes. One billion total supply.

### ENT-002: FRAUD Token

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | DrFraudsworth_Overview.md |
| Value | IP token B, Token-2022 with transfer hook |
| Also Appears In | All specs |
| Location | DrFraudsworth_Overview.md:Section "Token Structure" |

**Context:** One of two interchangeable IP tokens. Subject to asymmetric taxes. One billion total supply.

### ENT-003: PROFIT Token

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | DrFraudsworth_Overview.md |
| Value | Yield-bearing token, Token-2022 with transfer hook |
| Also Appears In | Yield_System_Spec.md, Tax_Pool_Logic_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Token Structure" |

**Context:** 50M fixed supply. Earns 75% of taxes. Provides soft peg between CRIME and FRAUD via PROFIT pools.

### ENT-004: WSOL

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Token_Program_Reference.md |
| Value | Wrapped SOL, SPL Token (NOT Token-2022), mint So11111111111111111111111111111111111111112 |
| Also Appears In | AMM_Implementation.md, Transfer_Hook_Spec.md |
| Location | Token_Program_Reference.md:Section 2.2 |

**Context:** Native mint owned by original SPL Token program. No transfer hook support. Pool security relies on AMM access control.

### ENT-005: EpochState Account

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | Global singleton PDA storing epoch number, tax config, VRF state, Carnage state |
| Also Appears In | Tax_Pool_Logic_Spec.md, Carnage_Fund_Spec.md |
| Location | Epoch_State_Machine_Spec.md:Section 4.1 |

**Context:** Single global account governing all pools. Seeds = ["epoch_state"].

### ENT-006: CarnageFundState Account

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Carnage_Fund_Spec.md |
| Value | PDA storing SOL vault, IP vaults, held token info, stats |
| Also Appears In | Epoch_State_Machine_Spec.md |
| Location | Carnage_Fund_Spec.md:Section 4.1 |

**Context:** Owned by Epoch Program. Seeds = ["carnage_fund"].

### ENT-007: YieldState Account

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Yield_System_Spec.md |
| Value | Global singleton PDA storing cumulative yield-per-PROFIT, pending yield, update tracking |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 4.1 |

**Context:** Seeds = ["yield_state"]. Stores cumulative u128 with 1e18 precision.

### ENT-008: UserYieldAccount

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Yield_System_Spec.md |
| Value | Per-user PDA storing last claimed cumulative value |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 4.4 |

**Context:** Seeds = ["user_yield", user_pubkey]. User pays ~0.002 SOL rent on first PROFIT purchase.

### ENT-009: Pool State Account

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | AMM_Implementation.md |
| Value | PDA storing pool type, mints, vaults, reserves, LP fee |
| Also Appears In | Single-source |
| Location | AMM_Implementation.md:Section 4.2 |

**Context:** Seeds = ["pool", token_a_mint, token_b_mint]. Mints must be canonically ordered.

### ENT-010: WhitelistEntry Account

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Transfer_Hook_Spec.md |
| Value | PDA marking an address as whitelisted for token transfers |
| Also Appears In | Single-source |
| Location | Transfer_Hook_Spec.md:Section 5.2 |

**Context:** Seeds = ["whitelist", address]. Existence = whitelisted.

### ENT-011: CurveState Account

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Bonding_Curve_Spec.md |
| Value | PDA storing curve status, tokens sold, SOL raised, deadline |
| Also Appears In | Protocol_Initialzation_and_Launch_Flow.md |
| Location | Bonding_Curve_Spec.md:Section 5.1 |

**Context:** Seeds = ["curve", token_mint]. One per token (CRIME, FRAUD).

### ENT-012: Tax Program

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | Program that wraps AMM swaps, calculates taxes, distributes proceeds |
| Also Appears In | AMM_Implementation.md, Epoch_State_Machine_Spec.md, Carnage_Fund_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 1 |

**Context:** All swaps must route through Tax Program. Provides swap_authority PDA that AMM requires.

### ENT-013: Epoch Program

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | Program managing epochs, VRF integration, tax regime, Carnage execution |
| Also Appears In | Carnage_Fund_Spec.md, Yield_System_Spec.md |
| Location | Epoch_State_Machine_Spec.md:Section 1 |

**Context:** Carnage Fund logic is inline in Epoch Program (not separate) due to CPI depth constraints.

### ENT-014: Transfer Hook Program

| Field | Value |
|-------|-------|
| Type | Entity |
| Primary Document | Transfer_Hook_Spec.md |
| Value | Program enforcing whitelist on CRIME/FRAUD/PROFIT transfers |
| Also Appears In | Token_Program_Reference.md, AMM_Implementation.md |
| Location | Transfer_Hook_Spec.md:Section 1 |

**Context:** Single hook serves all three Token-2022 tokens. Shared whitelist.

---

## 3. Behaviors (BEH)

Execution sequences, "when X, then Y" flows, state transitions.

### BEH-001: SOL Pool Buy Swap Sequence

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | LP fee (1%) from SOL input -> Tax from remaining SOL -> AMM swap -> Update reserves -> Distribute tax |
| Also Appears In | AMM_Implementation.md |
| Location | Tax_Pool_Logic_Spec.md:Section 9.2 |

**Context:** Order of operations for SOL -> IP swaps. LP fee applied first, then tax deducted, then swap executed.

### BEH-002: SOL Pool Sell Swap Sequence

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | LP fee (1%) from IP input -> AMM swap (gross SOL) -> Tax from SOL output -> Update reserves -> Distribute tax |
| Also Appears In | AMM_Implementation.md |
| Location | Tax_Pool_Logic_Spec.md:Section 9.3 |

**Context:** Order of operations for IP -> SOL swaps. Tax deducted from output SOL.

### BEH-003: Epoch Transition Sequence

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | trigger_epoch_transition() -> VRF request -> VRF callback -> Update taxes -> Check Carnage -> Execute Carnage (atomic) -> Active |
| Also Appears In | Tax_Pool_Logic_Spec.md, Carnage_Fund_Spec.md |
| Location | Epoch_State_Machine_Spec.md:Section 6.1 |

**Context:** State machine: ACTIVE -> VRF_PENDING -> ACTIVE (via callback). Taxes update atomically in callback.

### BEH-004: Tax Regime Flip Logic

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | VRF byte 0 < 192 -> flip cheap side. All four taxes derived from new regime. Magnitudes resampled every epoch. |
| Also Appears In | Epoch_State_Machine_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 8.2 |

**Context:** Regime flip applies to entire tax configuration atomically. No independent tax rolls.

### BEH-005: Carnage Execution - Burn Path (98%)

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Carnage_Fund_Spec.md |
| Value | If holding tokens: burn all -> Read SOL vault -> Market buy target (VRF-determined) -> Hold tokens |
| Also Appears In | Epoch_State_Machine_Spec.md |
| Location | Carnage_Fund_Spec.md:Section 8.3 |

**Context:** Most common Carnage path. VRF byte 4 >= 5 triggers burn. 98% of triggers.

### BEH-006: Carnage Execution - Sell Path (2%)

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Carnage_Fund_Spec.md |
| Value | If holding tokens: sell to SOL -> Read SOL vault -> Market buy target -> Hold tokens |
| Also Appears In | Epoch_State_Machine_Spec.md |
| Location | Carnage_Fund_Spec.md:Section 8.4 |

**Context:** Rare Carnage path. VRF byte 4 < 5 triggers sell. Can buy same token just sold.

### BEH-007: Yield Cumulative Update

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Yield_System_Spec.md |
| Value | VRF callback -> Read circulating PROFIT -> Calculate yield_per_op4 -> Add to cumulative -> Reset pending |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 5.2 |

**Context:** Called during VRF callback. Cumulative only increases. PROFIT in pool vaults excluded.

### BEH-008: Auto-Claim on Balance Change

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Yield_System_Spec.md |
| Value | Before swap: Calculate pending yield -> Transfer SOL to user -> Update checkpoint -> Execute swap |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 5.3 |

**Context:** Prevents ghost yield attack. Users always receive earned yield before selling.

### BEH-009: Bonding Curve Purchase Flow

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Bonding_Curve_Spec.md |
| Value | Validate whitelist -> Validate cap -> Calculate tokens out -> Transfer SOL -> Transfer tokens -> Update state -> Check filled |
| Also Appears In | Protocol_Initialzation_and_Launch_Flow.md |
| Location | Bonding_Curve_Spec.md:Section 8.5 |

**Context:** Linear curve price function. End price = pool seeding price (no arbitrage gap).

### BEH-010: Pool Transition Sequence

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Bonding_Curve_Spec.md |
| Value | Both curves filled -> Seed SOL pools (290M + 1000 SOL each) -> Seed PROFIT pools (250M + 25M PROFIT each) -> Initialize systems |
| Also Appears In | Protocol_Initialzation_and_Launch_Flow.md |
| Location | Bonding_Curve_Spec.md:Section 8.9 |

**Context:** Atomic transition. Both curves must fill. Permissionless trigger with bounty.

### BEH-011: Transfer Hook Validation

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Transfer_Hook_Spec.md |
| Value | Check amount > 0 -> Check source OR destination whitelisted -> Allow or reject |
| Also Appears In | Single-source |
| Location | Transfer_Hook_Spec.md:Section 3 |

**Context:** At least one party must be whitelisted. Zero-amount transfers blocked.

### BEH-012: VRF Retry Mechanism

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | If VRF pending > 300 slots: Anyone can call retry_vrf_request -> New VRF requested |
| Also Appears In | Single-source |
| Location | Epoch_State_Machine_Spec.md:Section 8.6 |

**Context:** Handles Switchboard delays. Old taxes remain active during retry.

### BEH-013: Carnage Fallback Execution

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Carnage_Fund_Spec.md |
| Value | Atomic fails -> Set pending state -> 100 slots to execute manually -> Expire if not executed |
| Also Appears In | Epoch_State_Machine_Spec.md |
| Location | Carnage_Fund_Spec.md:Section 11 |

**Context:** SOL remains in vault on expiration. Fixed deadline (no extension).

### BEH-014: Arbitrage Loop Execution

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Soft_Peg_Arbitrage_Spec.md |
| Value | SOL -> IP (cheap buy) -> PROFIT -> IP (expensive sell) -> SOL. Two taxes (different tokens), four LP fees. |
| Also Appears In | DrFraudsworth_Overview.md |
| Location | Soft_Peg_Arbitrage_Spec.md:Section 6 |

**Context:** Canonical route through protocol. Profitable when S/R outside no-arb band after flip.

### BEH-015: Whitelist Authority Burn

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Transfer_Hook_Spec.md |
| Value | Authority calls burn_authority -> authority = None (permanent) -> No new whitelist entries possible |
| Also Appears In | Protocol_Initialzation_and_Launch_Flow.md |
| Location | Transfer_Hook_Spec.md:Section 6.3 |

**Context:** Irreversible. All 13 entries must be added before burn.

### BEH-016: Tax Distribution Split

| Field | Value |
|-------|-------|
| Type | Behavior |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | Tax collected -> 75% to Yield Escrow -> 24% to Carnage Fund -> 1% to Treasury. Immediate split. |
| Also Appears In | Carnage_Fund_Spec.md, Yield_System_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 4 |

**Context:** No tax accumulation in swap logic. Split happens immediately.

---

## 4. Constraints (CONSTR)

Hard rules, invariants, prohibitions, access control.

### CONSTR-001: No Direct Wallet Transfers

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | DrFraudsworth_Overview.md |
| Value | "Direct wallet-to-wallet transfers are not permitted" |
| Also Appears In | Transfer_Hook_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Transfer Restrictions" |

**Context:** Enforced via transfer hook. All movement routes through pools.

### CONSTR-002: Whitelist Immutability

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Transfer_Hook_Spec.md |
| Value | "Whitelist is immutable after initialization" (authority burned) |
| Also Appears In | DrFraudsworth_Overview.md, Protocol_Initialzation_and_Launch_Flow.md |
| Location | Transfer_Hook_Spec.md:Section 2 |

**Context:** 10-13 addresses whitelisted, then authority burned. Cannot add or remove.

### CONSTR-003: Taxes Apply Only to SOL Pools

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | "Taxes apply only to SOL pools" - PROFIT pools have LP fee only |
| Also Appears In | DrFraudsworth_Overview.md, Soft_Peg_Arbitrage_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 2 |

**Context:** PROFIT pools (CRIME/PROFIT, FRAUD/PROFIT) are tax-free. Creates arbitrage mechanics.

### CONSTR-004: No Admin Intervention Post-Deployment

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | DrFraudsworth_Overview.md |
| Value | "No admin intervention post-deployment" |
| Also Appears In | Epoch_State_Machine_Spec.md, AMM_Implementation.md, Carnage_Fund_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Governance & Ownership" |

**Context:** All transitions are permissionless. Authorities burned. No admin escape hatches.

### CONSTR-005: Single Global Tax Regime

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | "Single global tax regime per epoch" - no per-pool or independent tax rolls |
| Also Appears In | DrFraudsworth_Overview.md, Epoch_State_Machine_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 5 |

**Context:** All four taxes derived from single regime. Flip is atomic.

### CONSTR-006: Zero Tax Never Possible

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | "Zero tax is never possible" - minimum 1% (100 bps) |
| Also Appears In | DrFraudsworth_Overview.md |
| Location | Tax_Pool_Logic_Spec.md:Section 6 |

**Context:** Low range is 1-4%, high range is 11-14%. No 0% tax scenarios.

### CONSTR-007: WSOL Uses SPL Token Program

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Token_Program_Reference.md |
| Value | WSOL uses SPL Token (NOT Token-2022), has no transfer hook support |
| Also Appears In | AMM_Implementation.md, Transfer_Hook_Spec.md |
| Location | Token_Program_Reference.md:Section 3.1 |

**Context:** Critical fact. WSOL vault protection relies on AMM access control, not hooks. ATA derivation differs.

### CONSTR-008: AMM Requires Tax Program Signature

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | AMM_Implementation.md |
| Value | "All swap instructions require a signature from the Tax Program PDA" |
| Also Appears In | Carnage_Fund_Spec.md, Token_Program_Reference.md |
| Location | AMM_Implementation.md:Section 18 |

**Context:** Prevents users from calling AMM directly to bypass taxes. Cryptographically enforced.

### CONSTR-009: Protocol-Owned Liquidity Only

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | AMM_Implementation.md |
| Value | "Protocol-owned liquidity only" - no deposits, no withdrawals |
| Also Appears In | DrFraudsworth_Overview.md |
| Location | AMM_Implementation.md:Section 1 |

**Context:** All liquidity is permanent. Pools seeded at initialization, never modified.

### CONSTR-010: Both Curves Must Fill

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Bonding_Curve_Spec.md |
| Value | "Both curves must complete for transition" - atomic success/failure |
| Also Appears In | Protocol_Initialzation_and_Launch_Flow.md |
| Location | Bonding_Curve_Spec.md:Section 2 |

**Context:** If one curve fails, both fail. Refunds available for both.

### CONSTR-011: 48-Hour Curve Deadline

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Bonding_Curve_Spec.md |
| Value | 432,000 slots (~48 hours) deadline for curve completion |
| Also Appears In | Protocol_Initialzation_and_Launch_Flow.md |
| Location | Bonding_Curve_Spec.md:Section 7.1 |

**Context:** Fixed, no extension. Failure triggers refund mechanism.

### CONSTR-012: Per-Wallet Token Cap (20M)

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Bonding_Curve_Spec.md |
| Value | 20,000,000 tokens max per wallet per curve |
| Also Appears In | Single-source |
| Location | Bonding_Curve_Spec.md:Section 6.1 |

**Context:** Enforced on-chain via whitelist/participant state. Separate caps for CRIME and FRAUD.

### CONSTR-013: Carnage Is Tax-Exempt

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | DrFraudsworth_Overview.md |
| Value | "Carnage Fund is tax-exempt (LP fees still apply)" |
| Also Appears In | Carnage_Fund_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Carnage Fund" |

**Context:** Uses swap_exempt instruction. 0% tax, 1% LP fee.

### CONSTR-014: Claims Never Expire

| Field | Value |
|-------|-------|
| Type | Constraint |
| Primary Document | Yield_System_Spec.md |
| Value | "Claims never expire" - yield accumulates indefinitely |
| Also Appears In | DrFraudsworth_Overview.md |
| Location | Yield_System_Spec.md:Section 2 |

**Context:** Checkpoint model allows claiming all pending yield in single transaction.

---

## 5. Formulas (FORM)

Mathematical relationships, calculations, derivations.

### FORM-001: AMM Pricing (Constant Product)

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | AMM_Implementation.md |
| Value | `amount_out = reserve_out * effective_input / (reserve_in + effective_input)` where `effective_input = amount_in * (10000 - lp_fee_bps) / 10000` |
| Also Appears In | Tax_Pool_Logic_Spec.md |
| Location | AMM_Implementation.md:Section 8.1 |

**Context:** Standard Uniswap V2 formula. Use u128 for intermediate math. Round down outputs.

### FORM-002: Tax Calculation

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | Tax_Pool_Logic_Spec.md |
| Value | `tax_amount = sol_amount * tax_rate_bps / 10000` |
| Also Appears In | Epoch_State_Machine_Spec.md |
| Location | Tax_Pool_Logic_Spec.md:Section 9.2-9.3 (implicit) |

**Context:** Applied to SOL amount (input for buys, output for sells) after LP fee.

### FORM-003: Epoch Calculation

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | `current_epoch = (current_slot - genesis_slot) / SLOTS_PER_EPOCH` |
| Also Appears In | Single-source |
| Location | Epoch_State_Machine_Spec.md:Section 3.2 |

**Context:** Integer division. Deterministic epoch boundaries from slot-based timing.

### FORM-004: Yield Per PROFIT Calculation

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | Yield_System_Spec.md |
| Value | `yield_per_op4 = (epoch_yield_lamports * 1e18) / circulating_op4` |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 6.3 |

**Context:** Scaled by 1e18 for precision. Added to cumulative (monotonically increasing).

### FORM-005: Pending Yield Calculation

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | Yield_System_Spec.md |
| Value | `pending = (current_cumulative - user_last_cumulative) * user_balance / 1e18` |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 6.4 |

**Context:** Delta times balance, divided by precision. Result in lamports.

### FORM-006: ATA Derivation

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | Token_Program_Reference.md |
| Value | `ATA = PDA([wallet_address, token_program_id, mint_address], ASSOCIATED_TOKEN_PROGRAM)` |
| Also Appears In | Single-source |
| Location | Token_Program_Reference.md:Section 7.1 |

**Context:** token_program_id differs for WSOL (SPL) vs CRIME/FRAUD/PROFIT (T22). Different addresses for same wallet.

### FORM-007: Linear Curve Price Function

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | Bonding_Curve_Spec.md |
| Value | `P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE` where P_START = 0.0000009 SOL, P_END = 0.00000345 SOL |
| Also Appears In | Single-source |
| Location | Bonding_Curve_Spec.md:Section 4.1 |

**Context:** End price matches pool seeding price. ~3.83x price increase across curve.

### FORM-008: No-Arbitrage Band

| Field | Value |
|-------|-------|
| Type | Formula |
| Primary Document | Soft_Peg_Arbitrage_Spec.md |
| Value | `F1 <= S/R <= 1/F2` where F1, F2 are loop friction factors |
| Also Appears In | Single-source |
| Location | Soft_Peg_Arbitrage_Spec.md:Section 7 |

**Context:** S = SOL price ratio, R = PROFIT price ratio. Band shifts on regime flip creating arbitrage.

---

## 6. Terminology (TERM)

Domain-specific terms and definitions.

### TERM-001: Cheap Side

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | DrFraudsworth_Overview.md |
| Value | The IP token with low buy tax and high sell tax in current epoch |
| Also Appears In | Tax_Pool_Logic_Spec.md, Epoch_State_Machine_Spec.md, Soft_Peg_Arbitrage_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Tax Regime Model" |

**Context:** Cheap to buy, expensive to sell. Determines arbitrage direction.

### TERM-002: Expensive Side

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | DrFraudsworth_Overview.md |
| Value | The IP token with high buy tax and low sell tax in current epoch |
| Also Appears In | Tax_Pool_Logic_Spec.md, Soft_Peg_Arbitrage_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Tax Regime Model" |

**Context:** Opposite of cheap side. Expensive to buy, cheap to sell.

### TERM-003: Epoch

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | Epoch_State_Machine_Spec.md |
| Value | 30-minute period (4,500 slots) during which tax regime is fixed |
| Also Appears In | DrFraudsworth_Overview.md, Tax_Pool_Logic_Spec.md |
| Location | Epoch_State_Machine_Spec.md:Section 3 |

**Context:** Slot-based, not wall-clock. 48 epochs per day.

### TERM-004: Carnage

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | DrFraudsworth_Overview.md |
| Value | Protocol chaos mechanism - market buys with accumulated SOL, burns or sells held tokens |
| Also Appears In | Carnage_Fund_Spec.md, Epoch_State_Machine_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Carnage Fund" |

**Context:** Deflationary, volatility-inducing. ~2x daily on average.

### TERM-005: Regime Flip

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | DrFraudsworth_Overview.md |
| Value | When cheap side changes from CRIME to FRAUD or vice versa (75% probability per epoch) |
| Also Appears In | Tax_Pool_Logic_Spec.md, Epoch_State_Machine_Spec.md, Soft_Peg_Arbitrage_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Regime Flip" |

**Context:** All four taxes flip atomically. Creates arbitrage opportunity.

### TERM-006: Soft Peg

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | DrFraudsworth_Overview.md |
| Value | CRIME and FRAUD loosely pegged to each other through PROFIT pools. Peg = marginal AMM price including LP fees, excluding taxes. |
| Also Appears In | Soft_Peg_Arbitrage_Spec.md |
| Location | DrFraudsworth_Overview.md:Section "Soft Peg Mechanism" |

**Context:** Not a hard peg. Taxes act as directional friction, not price.

### TERM-007: Mixed Pool

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | Token_Program_Reference.md |
| Value | Pool containing one Token-2022 token and one SPL Token (WSOL). Requires dual token programs. |
| Also Appears In | AMM_Implementation.md |
| Location | Token_Program_Reference.md:Section 4 |

**Context:** CRIME/SOL and FRAUD/SOL are mixed pools. T22 side has hooks, SPL side does not.

### TERM-008: Checkpoint Model

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | Yield_System_Spec.md |
| Value | Yield distribution model tracking cumulative yield-per-PROFIT globally and user's last claimed value |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 3.2 |

**Context:** Alternative to Merkle claims. No per-epoch accounts. One claim catches all pending.

### TERM-009: Ghost Yield Attack

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | Yield_System_Spec.md |
| Value | Attack where user claims yield for periods they didn't hold tokens (sell, wait, rebuy, claim) |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 11.2 |

**Context:** Prevented by auto-claim on balance change. Checkpoint updated before sell.

### TERM-010: Circulating Supply (PROFIT)

| Field | Value |
|-------|-------|
| Type | Terminology |
| Primary Document | Yield_System_Spec.md |
| Value | Total PROFIT supply minus PROFIT held in pool vaults (50M - CRIME/PROFIT vault - FRAUD/PROFIT vault) |
| Also Appears In | Single-source |
| Location | Yield_System_Spec.md:Section 6.2 |

**Context:** Only circulating PROFIT earns yield. Pool-held PROFIT excluded.

---

## 7. Assumptions (ASSUMP)

Inferred dependencies - things documents assume to be true but don't explicitly state.

**Phase 3 Plan 03 Validation:** All 8 assumptions cross-checked against explicit constraints. See CONFLICTS.md for detailed validation notes.

### ASSUMP-001: All CRIME/FRAUD/PROFIT Use Same Transfer Hook Program

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Transfer_Hook_Spec.md |
| Explicit? | No - implied by "Single hook program serves all three tokens" |
| Depends On | Token mint configuration at initialization |
| If Wrong | Each token could have different transfer rules, breaking uniformity |
| **Status** | **VALIDATED** - Transfer_Hook_Spec.md Section 1 confirms shared hook |

**Documents That Rely On This:**
- DrFraudsworth_Overview.md (assumes uniform transfer restrictions)
- AMM_Implementation.md (assumes consistent hook behavior)
- Token_Program_Reference.md (hook coverage matrix assumes shared hook)

### ASSUMP-002: Epoch Timing Is Slot-Based, Not Wall-Clock

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Epoch_State_Machine_Spec.md |
| Explicit? | Partially - stated in Epoch spec, but Overview says "30 minutes" without clarifying |
| Depends On | Solana slot production rate (~400ms/slot) |
| If Wrong | Epoch boundaries would drift, affecting arbitrage timing and predictability |
| **Status** | **VALIDATED** - Epoch_State_Machine_Spec.md Section 3.1 defines SLOTS_PER_EPOCH = 4500 |

**Documents That Rely On This:**
- DrFraudsworth_Overview.md (says "30 minutes" without slot clarification)
- Soft_Peg_Arbitrage_Spec.md (assumes predictable epoch timing)
- UI integration code (displays time remaining)

### ASSUMP-003: WSOL Vault Security Relies on AMM Access Control

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Token_Program_Reference.md |
| Explicit? | Now explicit after Phase 2 audit, but not originally clear |
| Depends On | Tax Program PDA signature requirement on all swaps |
| If Wrong | WSOL could be extracted from vaults directly via SPL Token transfer |
| **Status** | **VALIDATED** - CONSTR-007, CONSTR-008, Token_Program_Reference.md TM-01 confirm |

**Documents That Rely On This:**
- AMM_Implementation.md (assumes vault security)
- Transfer_Hook_Spec.md (notes WSOL vaults whitelisted but no hook protection)
- Token_Program_Reference.md (threat model TM-01)

### ASSUMP-004: Taxes Are SOL-Denominated Only

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Tax_Pool_Logic_Spec.md |
| Explicit? | Yes in Tax spec, but not restated everywhere |
| Depends On | Tax calculation happening on SOL amount (input for buys, output for sells) |
| If Wrong | Tax distribution (75/24/1 split) wouldn't work correctly |
| **Status** | **VALIDATED** - CONSTR-003, BEH-001/002, Tax_Pool_Logic_Spec.md confirm |

**Documents That Rely On This:**
- Yield_System_Spec.md (assumes SOL escrow receives SOL)
- Carnage_Fund_Spec.md (assumes SOL deposits)
- DrFraudsworth_Overview.md (describes SOL yield)

### ASSUMP-005: VRF Result Is Cryptographically Verified

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Epoch_State_Machine_Spec.md |
| Explicit? | Partially - mentions Switchboard VRF validates proof |
| Depends On | Switchboard VRF program providing verified randomness |
| If Wrong | Tax regimes and Carnage triggers could be manipulated |
| **Status** | **VALIDATED** - Epoch_State_Machine_Spec.md Section 7.1 (Switchboard proof) |

**Documents That Rely On This:**
- Tax_Pool_Logic_Spec.md (assumes random tax magnitudes)
- Carnage_Fund_Spec.md (assumes random trigger/action/target)
- Soft_Peg_Arbitrage_Spec.md (assumes unpredictable regime flips)

### ASSUMP-006: Carnage Swaps Don't Trigger Transfer Hooks

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Carnage_Fund_Spec.md, Transfer_Hook_Spec.md |
| Explicit? | No - implied by Carnage vaults being whitelisted |
| Depends On | Carnage vault addresses being in the whitelist |
| If Wrong | Carnage buys/sells would fail with "NoWhitelistedParty" |
| **Status** | **VALIDATED** - Transfer_Hook_Spec.md whitelist includes #9, #10 Carnage vaults |

**Documents That Rely On This:**
- Carnage_Fund_Spec.md (assumes swaps work)
- Transfer_Hook_Spec.md (whitelist includes Carnage vaults #9, #10)

### ASSUMP-007: Token-2022 Burn Does Not Trigger Transfer Hook

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Carnage_Fund_Spec.md |
| Explicit? | Stated as "Token-2022 burn instruction does not trigger transfer hooks" |
| Depends On | Token-2022 program behavior |
| If Wrong | Carnage burns would fail (burn destination is not whitelisted) |
| **Status** | **VALIDATED** - Carnage_Fund_Spec.md Section 10.3 explicitly confirms |

**Documents That Rely On This:**
- Carnage_Fund_Spec.md (burn path assumes hooks not triggered)
- Transfer_Hook_Spec.md (no burn address in whitelist)

### ASSUMP-008: Swaps Continue During VRF Delay

| Field | Value |
|-------|-------|
| Type | Assumption (inferred) |
| Inferred From | Epoch_State_Machine_Spec.md |
| Explicit? | Partially - stated in Section 14.7 |
| Depends On | Swap logic reading current taxes from EpochState without epoch validation |
| If Wrong | Protocol would halt during VRF delays |
| **Status** | **VALIDATED** - Epoch_State_Machine_Spec.md Section 14.7 explicitly confirms |

**Documents That Rely On This:**
- Tax_Pool_Logic_Spec.md (assumes taxes always readable)
- AMM_Implementation.md (assumes swaps always possible)
- DrFraudsworth_Overview.md (implies continuous trading)

---

## Cross-Reference Index

_Concepts by primary document, to be expanded during matrix building (Plan 02)_

| Document | Concept Count | Key Concepts |
|----------|--------------|--------------|
| DrFraudsworth_Overview.md | 12 | ENT-001-003, CONST-014, CONSTR-001, TERM-001-006 |
| Token_Program_Reference.md | 8 | ENT-004, CONSTR-007, FORM-006, TERM-007, ASSUMP-003 |
| Epoch_State_Machine_Spec.md | 14 | CONST-005-008,012-013, ENT-005, BEH-003-004, ASSUMP-002,005 |
| Tax_Pool_Logic_Spec.md | 10 | CONST-001-004,009-011, BEH-001-002,016, CONSTR-003,005-006 |
| AMM_Implementation.md | 6 | ENT-009,012, FORM-001, CONSTR-008-009 |
| Carnage_Fund_Spec.md | 8 | CONST-007,015, ENT-006, BEH-005-006,013, ASSUMP-006-007 |
| Yield_System_Spec.md | 10 | ENT-007-008, BEH-007-008, FORM-004-005, TERM-008-010, CONSTR-014 |
| Soft_Peg_Arbitrage_Spec.md | 4 | BEH-014, FORM-008, TERM-006 |
| Bonding_Curve_Spec.md | 6 | ENT-011, BEH-009-010, FORM-007, CONSTR-010-012 |
| Protocol_Initialzation_and_Launch_Flow.md | 2 | BEH-010,015 |
| Transfer_Hook_Spec.md | 6 | ENT-010,014, BEH-011,15, CONSTR-002, ASSUMP-001 |
| SolanaSetup.md | 0 | (Development environment, minimal protocol concepts) |

**Total Concepts:** 85
**Minimum thresholds met:**
- Constants: 15 (target 8-15)
- Entities: 14 (target 8-12)
- Behaviors: 16 (target 10-15)
- Constraints: 14 (target 8-12)
- Formulas: 8 (target 5-8)
- Terminology: 10 (target 5-8)
- Assumptions: 8 (target 5+)
