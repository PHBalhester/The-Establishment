# Constants Cross-Reference Matrix

**Generated:** 2026-02-01
**Source:** 00-concept-inventory.md (CONST-XXX entries)
**Documents:** 12 specification documents

## Normalization Rules

- All percentages normalized to basis points (bps): 1% = 100 bps
- All SOL amounts kept as SOL (not lamports) unless precision requires it
- All time durations kept in their specified unit (slots, minutes, hours)
- Semantic equivalence: '0.01' = '1%' = '100 bps' - NOT a conflict

---

## Constants Matrix

### CONST-001: LP_FEE_SOL_POOLS (LP Fee for SOL-paired Pools)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 1% | Section "Fee & Tax Structure" | "1% LP fee (always applied, compounds into liquidity)" |
| Tax_Pool_Logic_Spec.md | 1% / 100 bps | Section 2.1, 9.1 | Table shows "LP Fee: 1%", constant "LP_FEE_BPS = 100" |
| AMM_Implementation.md | 100 bps | Section 6 | "1% (100 bps) for SOL pools" |
| Soft_Peg_Arbitrage_Spec.md | 1% | Section 2 | "SOL pools (CRIME/SOL, FRAUD/SOL) - LP fee: 1%" |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | 1% | Section 3, 9.2 | "Tax-exempt swaps only (1% LP fee, 0% tax)" |
| Yield_System_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents that mention this constant express the same value (1% = 100 bps). Semantic equivalence applies.

---

### CONST-002: LP_FEE_PROFIT_POOLS (LP Fee for PROFIT-paired Pools)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 0.5% | Section "Fee & Tax Structure" | "0.5% LP fee" for PROFIT pools |
| Tax_Pool_Logic_Spec.md | 0.5% | Section 2.1, 10 | Table shows "LP Fee: 0.5%" for CRIME/PROFIT, FRAUD/PROFIT |
| AMM_Implementation.md | 50 bps | Section 6 | "0.5% (50 bps) for PROFIT pools" |
| Soft_Peg_Arbitrage_Spec.md | 0.5% | Section 2, 4 | "PROFIT pools (CRIME/PROFIT, FRAUD/PROFIT) - LP fee: 0.5%" |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned (Carnage uses SOL pools) |
| Yield_System_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents that mention this constant express the same value (0.5% = 50 bps).

---

### CONST-003: TAX_LOW_RANGE (Low Tax Band)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 1-4% | Section "Tax Bands" | "Low tax: 1-4%" |
| Tax_Pool_Logic_Spec.md | 100-400 bps (1-4%) | Section 6 | "Low tax: 1-4% (100-400 bps)" |
| Epoch_State_Machine_Spec.md | 100-400 bps | Section 7.2 | "Byte 1: 100 + (byte % 4) * 100 -> 1-4%" |
| AMM_Implementation.md | - | - | Not mentioned (AMM is tax-agnostic) |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Referenced implicitly |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents express the same range. VRF byte allocation confirms the 1-4% band (100 + [0-3]*100 = 100-400 bps).

---

### CONST-004: TAX_HIGH_RANGE (High Tax Band)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 11-14% | Section "Tax Bands" | "High tax: 11-14%" |
| Tax_Pool_Logic_Spec.md | 1100-1400 bps (11-14%) | Section 6 | "High tax: 11-14% (1100-1400 bps)" |
| Epoch_State_Machine_Spec.md | 1100-1400 bps | Section 7.2 | "Byte 2: 1100 + (byte % 4) * 100 -> 11-14%" |
| AMM_Implementation.md | - | - | Not mentioned (AMM is tax-agnostic) |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Referenced implicitly |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents express the same range (11-14% = 1100-1400 bps).

---

### CONST-005: EPOCH_LENGTH_SLOTS (Epoch Duration)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 30 minutes | Section "Epoch System" | "Epoch length: 30 minutes" |
| Tax_Pool_Logic_Spec.md | 30 minutes | Section 7.1 | "Epoch length: 30 minutes" |
| Epoch_State_Machine_Spec.md | 4,500 slots (~30 min) | Section 3.1 | "SLOTS_PER_EPOCH: u64 = 4_500; // ~30 minutes at 400ms/slot" |
| AMM_Implementation.md | - | - | Not mentioned (AMM is epoch-agnostic) |
| Carnage_Fund_Spec.md | - | - | Implicit (references epoch timing) |
| Yield_System_Spec.md | - | - | Implicit (references epoch timing) |
| Soft_Peg_Arbitrage_Spec.md | - | - | Implicit |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Overview says "30 minutes", Epoch spec provides precise slot-based definition (4,500 slots). These are semantically equivalent at standard slot rate (~400ms). The Epoch spec is the authoritative source for the slot-based calculation.

---

### CONST-006: VRF_TIMEOUT_SLOTS (VRF Maximum Wait)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Epoch_State_Machine_Spec.md | 300 slots (~2 min) | Section 3.1 | "VRF_TIMEOUT_SLOTS: u64 = 300; // ~2 minutes max VRF wait" |
| DrFraudsworth_Overview.md | - | - | Not mentioned |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE
**Notes:** Only defined in Epoch_State_Machine_Spec.md. Flag for Phase 4 gap analysis: should Overview or other specs reference this timing constant for completeness?

---

### CONST-007: CARNAGE_DEADLINE_SLOTS (Carnage Fallback Window)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Epoch_State_Machine_Spec.md | 100 slots (~40 sec) | Section 3.1 | "CARNAGE_DEADLINE_SLOTS: u64 = 100; // ~40 seconds fallback window" |
| Carnage_Fund_Spec.md | 100 slots | Section 11.3 | "CARNAGE_DEADLINE_SLOTS: u64 = 100; // ~40 seconds" |
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
**Notes:** Both documents that mention this constant agree on 100 slots (~40 seconds).

---

### CONST-008: TRIGGER_BOUNTY (Epoch Trigger Bounty)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Epoch_State_Machine_Spec.md | 10,000,000 lamports (0.01 SOL) | Section 3.1 | "TRIGGER_BOUNTY_LAMPORTS: u64 = 10_000_000; // 0.01 SOL" |
| DrFraudsworth_Overview.md | - | - | Not mentioned |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE
**Notes:** Only defined in Epoch_State_Machine_Spec.md. Flag for Phase 4: Consider adding to Overview for economic transparency.

---

### CONST-009: YIELD_DISTRIBUTION_SHARE (Yield Portion of Taxes)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 75% | Section "PROFIT Yield" | "75% of all SOL taxes collected per epoch" |
| Tax_Pool_Logic_Spec.md | 75% | Section 4 | "75% -> PROFIT Yield Escrow" |
| Yield_System_Spec.md | 75% | Section 1, 5.1 | "Collects 75% of all SOL taxes into an escrow vault" |
| Carnage_Fund_Spec.md | 75% (implicit) | Section 5.1 | Tax split table shows "Yield Escrow: 75%" |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned directly |
| AMM_Implementation.md | - | - | Not mentioned (AMM is tax-agnostic) |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents that mention this constant agree on 75%.

---

### CONST-010: CARNAGE_FUND_SHARE (Carnage Portion of Taxes)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 24% | Section "Carnage Fund" | "24% of all taxes, held in SOL" |
| Tax_Pool_Logic_Spec.md | 24% | Section 4 | "24% -> Carnage Fund" |
| Carnage_Fund_Spec.md | 24% | Section 1, 5.1 | "Accumulates 24% of all SOL taxes" |
| Yield_System_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents that mention this constant agree on 24%.

---

### CONST-011: TREASURY_SHARE (Treasury Portion of Taxes)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Tax_Pool_Logic_Spec.md | 1% | Section 4 | "1% -> Treasury Multisig" |
| Carnage_Fund_Spec.md | 1% | Section 5.1 | Tax split table shows "Treasury: 1%" |
| DrFraudsworth_Overview.md | - | - | Not mentioned explicitly |
| Yield_System_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT (but flag for gap)
**Notes:** Tax_Pool_Logic and Carnage_Fund agree on 1%. However, Overview only mentions 75% yield and 24% Carnage, implying 1% treasury but not stating it explicitly. Flag for Phase 4: Consider making treasury share explicit in Overview.

---

### CONST-012: CARNAGE_TRIGGER_PROBABILITY (Carnage Trigger Chance)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 1/24 (~4.17%) | Section "Carnage Fund" | "1/24 chance per epoch (~2x per day on average)" |
| Epoch_State_Machine_Spec.md | ~4.3% (11/256) | Section 7.2 | "Byte 3: < 11 (~4.3%) -> trigger Carnage" |
| Carnage_Fund_Spec.md | ~4.3% (11/256, ~1/24) | Section 6, 7.1 | "CARNAGE_TRIGGER_THRESHOLD: u8 = 11; // ~4.3% = 11/256 ~ 1/24" |
| Tax_Pool_Logic_Spec.md | 1/24 | Section 12.2 | "1/24 chance per epoch" |
| AMM_Implementation.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT (semantic equivalence)
**Notes:** Overview uses "1/24" (~4.17%), while implementation uses "11/256" (~4.3%). These are semantically equivalent approximations. The precise value is 11/256 = 4.297%. "1/24" is the human-readable approximation.

---

### CONST-013: REGIME_FLIP_PROBABILITY (Tax Regime Flip Chance)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 75% | Section "Regime Flip" | "Each epoch has a 75% probability of flipping the cheap side" |
| Tax_Pool_Logic_Spec.md | 75% | Section 8.1 | "75% chance to flip the cheap side" |
| Epoch_State_Machine_Spec.md | 75% (192/256) | Section 7.2 | "Byte 0: < 192 (75%) -> flip cheap side" |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents agree on 75% (192/256 = 75%).

---

### CONST-014: PROFIT_TOTAL_SUPPLY (PROFIT Fixed Supply)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | 50M | Section "Soft Peg Mechanism" | "50m PROFIT total supply (fixed forever)" |
| Yield_System_Spec.md | 50M (with 6 decimals) | Section 6.1 | "TOTAL_PROFIT_SUPPLY: u64 = 50_000_000_000_000; // 50M with 6 decimals" |
| Bonding_Curve_Spec.md | 50M | Section 3.5 | "PROFIT Total Supply: 50,000,000 (50M)" |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Implicit |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents that mention PROFIT supply agree on 50M tokens.

---

### CONST-015: MAX_CARNAGE_SWAP (Maximum SOL per Carnage Swap)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Carnage_Fund_Spec.md | 1000 SOL | Section 9.1 | "MAX_CARNAGE_SWAP_LAMPORTS: u64 = 1_000_000_000_000; // 1000 SOL" |
| DrFraudsworth_Overview.md | - | - | Not mentioned |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE
**Notes:** Only defined in Carnage_Fund_Spec.md. This is an implementation detail that prevents compute failures.

---

## Summary Table

| Concept ID | Name | Status | Single-Source? | Notes |
|------------|------|--------|----------------|-------|
| CONST-001 | LP_FEE_SOL_POOLS | AGREEMENT | No | 1% = 100 bps |
| CONST-002 | LP_FEE_PROFIT_POOLS | AGREEMENT | No | 0.5% = 50 bps |
| CONST-003 | TAX_LOW_RANGE | AGREEMENT | No | 1-4% = 100-400 bps |
| CONST-004 | TAX_HIGH_RANGE | AGREEMENT | No | 11-14% = 1100-1400 bps |
| CONST-005 | EPOCH_LENGTH_SLOTS | AGREEMENT | No | 4500 slots = ~30 min |
| CONST-006 | VRF_TIMEOUT_SLOTS | SINGLE-SOURCE | Yes | 300 slots |
| CONST-007 | CARNAGE_DEADLINE_SLOTS | AGREEMENT | No | 100 slots |
| CONST-008 | TRIGGER_BOUNTY | SINGLE-SOURCE | Yes | 0.01 SOL |
| CONST-009 | YIELD_DISTRIBUTION_SHARE | AGREEMENT | No | 75% |
| CONST-010 | CARNAGE_FUND_SHARE | AGREEMENT | No | 24% |
| CONST-011 | TREASURY_SHARE | AGREEMENT | No | 1% (implicit in Overview) |
| CONST-012 | CARNAGE_TRIGGER_PROBABILITY | AGREEMENT | No | ~4.3% (11/256 ~ 1/24) |
| CONST-013 | REGIME_FLIP_PROBABILITY | AGREEMENT | No | 75% (192/256) |
| CONST-014 | PROFIT_TOTAL_SUPPLY | AGREEMENT | No | 50M |
| CONST-015 | MAX_CARNAGE_SWAP | SINGLE-SOURCE | Yes | 1000 SOL |

**Total Constants:** 15
**Agreements:** 12
**Discrepancies:** 0
**Single-Source (Phase 4 gaps):** 3 (CONST-006, CONST-008, CONST-015)

---

*Matrix generated for Phase 3 Plan 02*
*Cross-reference methodology: .planning/research/CROSS_REFERENCING.md*
