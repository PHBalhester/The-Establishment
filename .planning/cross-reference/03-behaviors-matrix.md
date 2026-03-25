# Behaviors Cross-Reference Matrix

**Generated:** 2026-02-01
**Source:** 00-concept-inventory.md (BEH-XXX entries)

## Analysis Approach

Behaviors are compared for:
1. Step ordering (does sequence match?)
2. Step completeness (are all steps present?)
3. Conditional branching (same conditions?)
4. Outcomes (same end state?)

---

## Behaviors Matrix

### BEH-001: SOL Pool Buy Swap Sequence (SOL -> IP)

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Tax_Pool_Logic_Spec.md | 1. LP fee (1%) from SOL input, 2. Tax from remaining SOL, 3. AMM swap, 4. Update reserves, 5. Distribute tax | Section 9.2 | "LP fee is applied before tax" |
| AMM_Implementation.md | 1. Validate inputs, 2. Calculate LP fee, 3. Compute output, 4. Transfer input to vault, 5. Transfer output to user, 6. Update reserves, 7. Emit event | Section 10 | AMM is tax-agnostic; tax handled by Tax Program |
| DrFraudsworth_Overview.md | LP fee before tax | Section "Fee & Tax Structure" | "LP fee is applied before tax" |
| Soft_Peg_Arbitrage_Spec.md | - | - | Implicit (references fee/tax order) |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Tax_Pool_Logic_Spec provides authoritative sequence. AMM_Implementation shows swap-only view (no taxes). Order: LP fee -> Tax -> AMM swap -> Distribute.

---

### BEH-002: SOL Pool Sell Swap Sequence (IP -> SOL)

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Tax_Pool_Logic_Spec.md | 1. LP fee (1%) from IP input, 2. AMM swap (gross SOL), 3. Tax from SOL output, 4. Update reserves, 5. Distribute tax | Section 9.3 | "Tax deducted from SOL output" |
| AMM_Implementation.md | Same swap mechanics as buy | Section 10 | AMM handles LP fee and swap only |
| DrFraudsworth_Overview.md | - | - | Not explicitly described |
| Soft_Peg_Arbitrage_Spec.md | - | - | Implicit |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Key difference from buy: LP fee is from IP input, tax is from SOL output. This ensures taxes are always SOL-denominated.

---

### BEH-003: Epoch Transition Sequence

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Epoch_State_Machine_Spec.md | 1. trigger_epoch_transition(), 2. VRF request, 3. VRF callback, 4. Update taxes, 5. Check Carnage, 6. Execute Carnage (atomic), 7. Return to ACTIVE | Section 6.1-6.2 | Full state machine diagram |
| Tax_Pool_Logic_Spec.md | 1. Request VRF, 2. On callback: determine flip/sample taxes, 3. Activate new config, 4. Evaluate Carnage, 5. Finalize yield | Section 7.2 | Consistent with Epoch spec |
| Carnage_Fund_Spec.md | VRF callback -> Check trigger -> Execute Carnage atomically | Section 11.1-11.2 | Focuses on Carnage within epoch transition |
| DrFraudsworth_Overview.md | 1. VRF requested, 2. Callback: flip decision + resample taxes, 3. New epoch active, 4. Carnage evaluated | Section "Epoch System" | High-level overview |
| Yield_System_Spec.md | VRF callback -> update_cumulative called | Section 5.2 | Yield update is part of epoch transition |
| AMM_Implementation.md | - | - | Not mentioned (AMM is epoch-agnostic) |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents describe the same sequence. Epoch_State_Machine_Spec is authoritative with full state diagram.

---

### BEH-004: Tax Regime Flip Logic

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Tax_Pool_Logic_Spec.md | VRF byte 0 < 192 (75%) -> flip. All four taxes derived from new regime. Magnitudes resampled every epoch. | Section 8.1-8.2 | Pseudocode provided |
| Epoch_State_Machine_Spec.md | derive_taxes(): should_flip = vrf[0] < 192, then sample low/high from bytes 1-2 | Section 7.3 | Full implementation |
| DrFraudsworth_Overview.md | 75% probability to flip, all four taxes flip together | Section "Regime Flip" | Consistent |
| Soft_Peg_Arbitrage_Spec.md | Regime flips atomically | Section 8 | Referenced for arbitrage impact |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Flip is atomic. All four taxes derived from single regime. Magnitudes resampled every epoch even without flip.

---

### BEH-005: Carnage Execution - Burn Path (98%)

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Carnage_Fund_Spec.md | 1. Check has holdings, 2. VRF byte 4 >= 5 (98%), 3. Burn all held tokens, 4. Read SOL vault, 5. Market buy target (VRF byte 5), 6. Hold tokens | Section 8.3 | Full burn path |
| Epoch_State_Machine_Spec.md | Within execute_carnage_inner: burn_tokens() if action == Burn | Section 9.1 | Simplified reference |
| DrFraudsworth_Overview.md | "98% chance: burn held IP tokens" | Section "Carnage Fund" | High-level |
| Tax_Pool_Logic_Spec.md | "98%: burn tokens" | Section 12.3 | Consistent |
| AMM_Implementation.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | Burns don't trigger hooks | Section 10.3 note in Carnage spec | Relevant to execution |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** 98% path burns held tokens, then market buys target. Burn uses Token-2022 burn instruction which doesn't trigger transfer hooks.

---

### BEH-006: Carnage Execution - Sell Path (2%)

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Carnage_Fund_Spec.md | 1. Check has holdings, 2. VRF byte 4 < 5 (2%), 3. Sell held tokens to SOL, 4. Read SOL vault (now includes sale), 5. Market buy target, 6. Hold tokens | Section 8.4 | Full sell path |
| Epoch_State_Machine_Spec.md | Within execute_carnage_inner: sell to SOL if action == Sell | Section 9.1 | Simplified reference |
| DrFraudsworth_Overview.md | "2% chance: sell held IP tokens -> accumulate SOL -> rebuy opposite side" | Section "Carnage Fund" | High-level |
| Tax_Pool_Logic_Spec.md | "2%: sell to SOL" | Section 12.3 | Consistent |
| AMM_Implementation.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** 2% path sells held tokens, then market buys. Can buy same token just sold (VRF-determined target).

---

### BEH-007: Yield Cumulative Update

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Yield_System_Spec.md | 1. Read circulating PROFIT, 2. Calculate yield_per_op4 = pending / circulating, 3. Add to cumulative, 4. Reset pending | Section 5.2, 7.3 | Full implementation |
| Epoch_State_Machine_Spec.md | - | - | References yield update in callback |
| Tax_Pool_Logic_Spec.md | - | - | References "Finalize yield accounting" |
| DrFraudsworth_Overview.md | - | - | Not mentioned at this level |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Yield_System_Spec.md)
**Notes:** Called during VRF callback. Cumulative only increases (monotonic). PROFIT in pool vaults excluded from circulating.

---

### BEH-008: Auto-Claim on Balance Change

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Yield_System_Spec.md | 1. Before swap: Calculate pending yield, 2. Transfer SOL to user, 3. Update checkpoint, 4. Execute swap | Section 5.3, 7.6 | Full implementation |
| DrFraudsworth_Overview.md | - | - | Not mentioned (only mentions Merkle claims) |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Yield_System_Spec.md)
**Notes:** Prevents ghost yield attack. Users always receive earned yield before selling. CRITICAL for security.

---

### BEH-009: Bonding Curve Purchase Flow

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Bonding_Curve_Spec.md | 1. Validate whitelist, 2. Validate cap, 3. Calculate tokens out, 4. Transfer SOL, 5. Transfer tokens, 6. Update state, 7. Check filled | Section 8.5 | Full implementation |
| Protocol_Initialization.md | Referenced in transition | Section 12 | Implicit |
| DrFraudsworth_Overview.md | "Bonding curve buyers are fully subject to all protocol mechanics" | Section "Launch Mechanics" | High-level |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | Curve PDA whitelisted | Section 4 | Enables transfers |
| Token_Program_Reference.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Bonding_Curve_Spec.md)
**Notes:** Linear curve. End price = pool seeding price (no arbitrage gap). Per-wallet cap enforced.

---

### BEH-010: Pool Transition Sequence

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Bonding_Curve_Spec.md | 1. Both curves filled, 2. Seed SOL pools (290M + 1000 SOL each), 3. Seed PROFIT pools (250M + 25M PROFIT each), 4. Initialize systems | Section 8.9 | Referenced |
| Protocol_Initialization.md | Detailed step-by-step transition | Section 12 | Full implementation |
| DrFraudsworth_Overview.md | "Seeded via bonding curve" | Section "Launch Mechanics" | High-level |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Atomic transition. Both curves must fill. Permissionless trigger with bounty.

---

### BEH-011: Transfer Hook Validation

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Transfer_Hook_Spec.md | 1. Check amount > 0, 2. Check source OR destination whitelisted, 3. Allow or reject | Section 3, 7.4 | Full implementation |
| DrFraudsworth_Overview.md | "At least one party must be whitelisted" | Section "Transfer Restrictions" | Consistent |
| AMM_Implementation.md | References hook enforcement | Section 9.2 | Confirms T22 transfers invoke hook |
| Token_Program_Reference.md | Hook coverage matrix | Section 5 | Shows which transfers are hook-protected |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | Burns don't trigger hooks | Section 10.3 | Important exception |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** At least one party must be whitelisted. Zero-amount transfers blocked. Burns don't trigger hooks.

---

### BEH-012: VRF Retry Mechanism

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Epoch_State_Machine_Spec.md | 1. VRF pending > 300 slots, 2. Anyone calls retry_vrf_request, 3. New VRF requested | Section 8.6 | Full implementation |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| DrFraudsworth_Overview.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Epoch_State_Machine_Spec.md)
**Notes:** Handles Switchboard delays. Old taxes remain active during retry. Permissionless.

---

### BEH-013: Carnage Fallback Execution

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Carnage_Fund_Spec.md | 1. Atomic fails, 2. Set pending state, 3. 100 slots to execute manually, 4. Expire if not executed | Section 11 | Full implementation |
| Epoch_State_Machine_Spec.md | Sets carnage_pending = true on failure | Section 8.3 | Consistent |
| DrFraudsworth_Overview.md | - | - | Not mentioned |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** SOL remains in vault on expiration. Fixed deadline (no extension). Permissionless execution.

---

### BEH-014: Arbitrage Loop Execution

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Soft_Peg_Arbitrage_Spec.md | SOL -> IP (cheap buy) -> PROFIT -> IP (expensive sell) -> SOL. Two taxes (different tokens), four LP fees. | Section 6 | Full mathematical model |
| DrFraudsworth_Overview.md | "SOL -> IP -> PROFIT -> IP -> SOL" | Section "Arbitrage Loop" | Consistent |
| Tax_Pool_Logic_Spec.md | - | - | Implicit (defines taxes) |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Canonical route through protocol. Profitable when S/R outside no-arb band after flip.

---

### BEH-015: Whitelist Authority Burn

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Transfer_Hook_Spec.md | 1. Authority calls burn_authority, 2. authority = None (permanent), 3. No new whitelist entries possible | Section 6.3 | Full implementation |
| Protocol_Initialization.md | "Burn all authorities" in Phase 2 | Section 6 | Confirms sequence |
| DrFraudsworth_Overview.md | "Whitelist permissions are burned at initialization" | Section "Transfer Restrictions" | Consistent |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Irreversible. All 10-13 entries must be added before burn.

---

### BEH-016: Tax Distribution Split

| Document | Sequence | Location | Notes |
|----------|----------|----------|-------|
| Tax_Pool_Logic_Spec.md | Tax collected -> 75% to Yield Escrow -> 24% to Carnage Fund -> 1% to Treasury. Immediate split. | Section 4 | Primary definition |
| Carnage_Fund_Spec.md | Tax split table: Yield 75%, Carnage 24%, Treasury 1% | Section 5.1 | Consistent |
| Yield_System_Spec.md | "Collects 75% of all SOL taxes" | Section 5.1 | Consistent |
| DrFraudsworth_Overview.md | "75% of all SOL taxes" (yield), "24% of all taxes" (Carnage) | Sections | Consistent (treasury implicit) |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned (tax-agnostic) |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** No tax accumulation in swap logic. Split happens immediately. 75/24/1 ratio.

---

## Summary Table

| Concept ID | Name | Status | Single-Source? | Key Detail |
|------------|------|--------|----------------|------------|
| BEH-001 | SOL Pool Buy Sequence | AGREEMENT | No | LP fee -> Tax -> AMM |
| BEH-002 | SOL Pool Sell Sequence | AGREEMENT | No | LP fee -> AMM -> Tax (output) |
| BEH-003 | Epoch Transition | AGREEMENT | No | VRF-driven, atomic taxes |
| BEH-004 | Tax Regime Flip | AGREEMENT | No | 75% probability, atomic |
| BEH-005 | Carnage Burn Path | AGREEMENT | No | 98%, burn then buy |
| BEH-006 | Carnage Sell Path | AGREEMENT | No | 2%, sell then buy |
| BEH-007 | Yield Cumulative Update | SINGLE-SOURCE | Yes | VRF callback, monotonic |
| BEH-008 | Auto-Claim | SINGLE-SOURCE | Yes | Prevents ghost yield |
| BEH-009 | Curve Purchase | SINGLE-SOURCE | Yes | Linear, cap enforced |
| BEH-010 | Pool Transition | AGREEMENT | No | Both curves required |
| BEH-011 | Transfer Hook Validation | AGREEMENT | No | One party whitelisted |
| BEH-012 | VRF Retry | SINGLE-SOURCE | Yes | 300 slot timeout |
| BEH-013 | Carnage Fallback | AGREEMENT | No | 100 slot deadline |
| BEH-014 | Arbitrage Loop | AGREEMENT | No | SOL->IP->PROFIT->IP->SOL |
| BEH-015 | Authority Burn | AGREEMENT | No | Irreversible |
| BEH-016 | Tax Distribution | AGREEMENT | No | 75/24/1 immediate |

**Total Behaviors:** 16
**Agreements:** 12
**Discrepancies:** 0
**Single-Source (implementation details):** 4

---

*Matrix generated for Phase 3 Plan 02*
*Cross-reference methodology: .planning/research/CROSS_REFERENCING.md*
