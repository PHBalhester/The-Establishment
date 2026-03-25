# Constraints Cross-Reference Matrix

**Created:** 2026-02-01
**Phase:** 03-cross-reference
**Plan:** 02
**Category:** Constraints (CONSTR)

## Purpose

Cross-references all 14 constraint concepts across 12 specification documents, tracking where each constraint is stated, implied, or relied upon.

## Matrix Summary

| Concept ID | Primary Document | Documents Referencing | Status |
|------------|-----------------|----------------------|--------|
| CONSTR-001 | DrFraudsworth_Overview.md | 2 | AGREEMENT |
| CONSTR-002 | Transfer_Hook_Spec.md | 3 | AGREEMENT |
| CONSTR-003 | Tax_Pool_Logic_Spec.md | 3 | AGREEMENT |
| CONSTR-004 | DrFraudsworth_Overview.md | 4 | AGREEMENT |
| CONSTR-005 | Tax_Pool_Logic_Spec.md | 3 | AGREEMENT |
| CONSTR-006 | Tax_Pool_Logic_Spec.md | 2 | AGREEMENT |
| CONSTR-007 | Token_Program_Reference.md | 3 | AGREEMENT |
| CONSTR-008 | AMM_Implementation.md | 3 | AGREEMENT |
| CONSTR-009 | AMM_Implementation.md | 2 | AGREEMENT |
| CONSTR-010 | Bonding_Curve_Spec.md | 2 | AGREEMENT |
| CONSTR-011 | Bonding_Curve_Spec.md | 2 | AGREEMENT |
| CONSTR-012 | Bonding_Curve_Spec.md | 1 | SINGLE-SOURCE |
| CONSTR-013 | DrFraudsworth_Overview.md | 2 | AGREEMENT |
| CONSTR-014 | Yield_System_Spec.md | 2 | AGREEMENT |

**Totals:** 13 agreements, 0 discrepancies, 1 single-source

---

## Detailed Cross-Reference

### CONSTR-001: No Direct Wallet Transfers

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | "Direct wallet-to-wallet transfers are not permitted" | Section "Transfer Restrictions" | Primary statement of constraint |
| Transfer_Hook_Spec.md | At least one party must be whitelisted; wallets not in whitelist | Section 3 | Enforcement mechanism |

**Status:** AGREEMENT
**Notes:** Primary statement and enforcement mechanism align. Transfer hook implements the restriction.

---

### CONSTR-002: Whitelist Immutability

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Transfer_Hook_Spec.md | "Whitelist is immutable after initialization" (authority burned) | Section 2 | Primary statement |
| DrFraudsworth_Overview.md | "Whitelist cannot be modified post-launch" | Section "Governance" | High-level statement |
| Protocol_Initialzation_and_Launch_Flow.md | burn_authority called after whitelist setup | Section 5 | Execution sequence |

**Status:** AGREEMENT
**Notes:** All documents agree on immutability post-launch. Protocol_Initialization specifies burn_authority timing.

---

### CONSTR-003: Taxes Apply Only to SOL Pools

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Tax_Pool_Logic_Spec.md | "Taxes apply only to SOL pools" - PROFIT pools LP fee only | Section 2 | Primary statement |
| DrFraudsworth_Overview.md | "PROFIT pools are tax-free" | Section "Soft Peg" | High-level confirmation |
| Soft_Peg_Arbitrage_Spec.md | Arbitrage calculation assumes no tax on PROFIT pools | Section 6 | Relied upon for profit calculation |

**Status:** AGREEMENT
**Notes:** Tax-free PROFIT pools are critical for arbitrage mechanics. All specs align.

---

### CONSTR-004: No Admin Intervention Post-Deployment

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | "No admin intervention post-deployment" | Section "Governance & Ownership" | Primary statement |
| Epoch_State_Machine_Spec.md | All transitions permissionless | Section 2 | Implementation detail |
| AMM_Implementation.md | No admin functions, no upgrade authority | Section 17 | Implementation detail |
| Carnage_Fund_Spec.md | No admin override for Carnage execution | Section 12 | Implementation detail |

**Status:** AGREEMENT
**Notes:** Trustless design consistently stated across all major program specs.

---

### CONSTR-005: Single Global Tax Regime

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Tax_Pool_Logic_Spec.md | "Single global tax regime per epoch" - no per-pool taxes | Section 5 | Primary statement |
| DrFraudsworth_Overview.md | One regime affects both CRIME and FRAUD pools | Section "Tax Regime" | High-level confirmation |
| Epoch_State_Machine_Spec.md | EpochState stores single cheap_side, single set of tax rates | Section 4.1 | Storage confirmation |

**Status:** AGREEMENT
**Notes:** Single regime is fundamental to asymmetric tax arbitrage. All specs align.

---

### CONSTR-006: Zero Tax Never Possible

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Tax_Pool_Logic_Spec.md | "Zero tax is never possible" - minimum 1% (100 bps) | Section 6 | Primary statement with range |
| DrFraudsworth_Overview.md | Tax ranges 1-4% and 11-14% | Section "Tax Regime" | Range confirmation |

**Status:** AGREEMENT
**Notes:** Low range starts at 1%, ensuring perpetual yield generation.

---

### CONSTR-007: WSOL Uses SPL Token Program

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Token_Program_Reference.md | WSOL uses SPL Token (NOT Token-2022), no transfer hook support | Section 3.1 | Primary statement, critical fact |
| AMM_Implementation.md | Mixed pools require dual token program handling | Section 6.2 | Implementation consequence |
| Transfer_Hook_Spec.md | WSOL vaults whitelisted but not hook-protected | Section 5.1 | Security implication |

**Status:** AGREEMENT
**Notes:** CRITICAL constraint. WSOL vault security relies on AMM access control (PDA signature), not transfer hooks. This was the v3 failure point that triggered the documentation rebuild.

---

### CONSTR-008: AMM Requires Tax Program Signature

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| AMM_Implementation.md | "All swap instructions require a signature from the Tax Program PDA" | Section 18 | Primary statement |
| Carnage_Fund_Spec.md | Carnage uses swap_exempt which also requires authorized signer | Section 9.2 | Exception path still controlled |
| Token_Program_Reference.md | Vault security relies on this constraint | Section 3.1 (TM-01) | Security dependency |

**Status:** AGREEMENT
**Notes:** This constraint prevents tax bypass and protects WSOL vaults. Cryptographically enforced.

---

### CONSTR-009: Protocol-Owned Liquidity Only

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| AMM_Implementation.md | "Protocol-owned liquidity only" - no deposits, no withdrawals | Section 1 | Primary statement |
| DrFraudsworth_Overview.md | "Liquidity is permanently locked" | Section "Pools" | High-level confirmation |

**Status:** AGREEMENT
**Notes:** Permanent liquidity ensures long-term protocol viability. No LP token mechanism needed.

---

### CONSTR-010: Both Curves Must Fill

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Bonding_Curve_Spec.md | "Both curves must complete for transition" - atomic success/failure | Section 2 | Primary statement |
| Protocol_Initialzation_and_Launch_Flow.md | Transition only callable when both status == Filled | Section 4.2 | Implementation detail |

**Status:** AGREEMENT
**Notes:** Prevents asymmetric launch where one token has liquidity and other doesn't.

---

### CONSTR-011: 48-Hour Curve Deadline

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Bonding_Curve_Spec.md | 432,000 slots (~48 hours) deadline for curve completion | Section 7.1 | Primary statement |
| Protocol_Initialzation_and_Launch_Flow.md | Fixed deadline, no extension mechanism | Section 4.1 | Confirmation |

**Status:** AGREEMENT
**Notes:** Slot-based timing (432,000 slots at 400ms = 48 hours). Failure triggers refund mechanism.

---

### CONSTR-012: Per-Wallet Token Cap (20M)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Bonding_Curve_Spec.md | 20,000,000 tokens max per wallet per curve | Section 6.1 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Flagged for Phase 4 gap analysis. Anti-whale mechanism during bonding curve phase. Should potentially be mentioned in Overview or Launch Flow.

---

### CONSTR-013: Carnage Is Tax-Exempt

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | "Carnage Fund is tax-exempt (LP fees still apply)" | Section "Carnage Fund" | Primary statement |
| Carnage_Fund_Spec.md | Uses swap_exempt instruction, 0% tax, 1% LP fee | Section 9.2 | Implementation detail |

**Status:** AGREEMENT
**Notes:** Tax exemption prevents Carnage from paying taxes back to itself (circular). LP fees still apply.

---

### CONSTR-014: Claims Never Expire

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | "Claims never expire" - yield accumulates indefinitely | Section 2 | Primary statement |
| DrFraudsworth_Overview.md | "Yield can be claimed at any time" | Section "Yield" | High-level confirmation |

**Status:** AGREEMENT
**Notes:** Checkpoint model enables indefinite accumulation. No per-epoch claim deadlines.

---

## Normalization Rules Applied

1. **Slot-based timing:** 432,000 slots normalized to "~48 hours" using 400ms/slot
2. **Tax ranges:** Always expressed as both percentage and basis points (1-4% = 100-400 bps)
3. **Semantic equivalence:** "immutable" = "cannot be modified" = "authority burned"

## Flags for Phase 4

- **CONSTR-012 (Per-Wallet Cap):** Single-source, should be documented in Overview or Launch Flow
