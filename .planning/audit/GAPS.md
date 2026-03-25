# Gap Tracking

## Dashboard

| Priority | Open | Filled | Won't Fill | Total |
|----------|------|--------|------------|-------|
| CRITICAL | 0 | 0 | 0 | 0 |
| HIGH | 0 | 5 | 0 | 5 |
| MEDIUM | 0 | 16 | 0 | 16 |
| LOW | 0 | 3 | 0 | 3 |
| **Total** | **0** | **24** | **0** | **24** |

**All 24 gaps resolved!**
- HIGH: 5 Filled
- MEDIUM: 16 Filled
- LOW: 3 Filled
- Total: 24/24 Complete

**Last Updated:** 2026-02-03 (Phase 7 Plan 01 - Delta validation of Phase 6 additions, CLEAN PASS)

---

## Gap Categories (14-Category Coverage Checklist)

| # | Category | Priority Baseline | Gaps Found |
|---|----------|-------------------|------------|
| 1 | Token Program Compatibility | HIGH | 2 |
| 2 | Account Architecture | HIGH | 3 |
| 3 | Mathematical Invariants | HIGH | 4 |
| 4 | Instruction Set | MEDIUM | 1 |
| 5 | CPI Patterns | HIGH | 5 |
| 6 | Authority & Access Control | HIGH | 1 |
| 7 | Economic Model | MEDIUM | 0 |
| 8 | State Machine Specifications | HIGH | 3 |
| 9 | Error Handling | MEDIUM | 1 |
| 10 | Event Emissions | LOW | 1 |
| 11 | Security Considerations | HIGH | 0 |
| 12 | Testing Requirements | MEDIUM | 2 |
| 13 | Deployment Specification | MEDIUM | 1 |
| 14 | Operational Documentation | LOW | 1 |

---

## Open Gaps

_Gaps awaiting documentation. Ordered by priority then category._

---

## Foundation + Core Documents (Plan 04-01)

### GAP-001: Overview Missing WSOL SPL Token Clarification

| Field | Value |
|-------|-------|
| Category | 1. Token Program Compatibility |
| Severity | HIGH |
| Document(s) | DrFraudsworth_Overview.md |
| Status | **Filled** |
| Resolution | Added "WSOL Exception" callout to Token Structure section |
| Filled In | DrFraudsworth_Overview.md, Token Structure section |
| Iteration | 1 |

**What Was Missing:**
Overview stated "All tokens are Token-2022 assets with transfer hooks" but did not mention that WSOL uses the original SPL Token program. This was the exact assumption that caused the v3 rebuild failure.

**Resolution Applied:**
Added a prominent "Important: WSOL Exception" callout block in the Token Structure section that:
- Explicitly states WSOL uses SPL Token (spl-token), NOT Token-2022
- Documents asymmetric token programs in SOL-paired pools
- Lists the implications for transfer hooks
- References Token_Program_Reference.md for the authoritative matrix

**Commit:** 56396e3

---

### GAP-002: Missing Token-2022 Extension Inventory

| Field | Value |
|-------|-------|
| Category | 1. Token Program Compatibility |
| Severity | MEDIUM |
| Document(s) | Token_Program_Reference.md |
| Status | **Filled** |
| Resolution | Added Section 9 Token-2022 Extensions with 13-extension inventory, rationale details, and auditor verification |
| Filled In | Token_Program_Reference.md, Section 9 |
| Iteration | 1 |

**What's Missing:**
Neither document includes a complete Token-2022 extension inventory showing which extensions are enabled/disabled for CRIME, FRAUD, and PROFIT tokens.

**Why It Matters:**
Token-2022 has many extensions (Transfer Fees, Permanent Delegate, Interest-Bearing, Confidential Transfer, etc.). Auditors and implementers need explicit documentation of which are used and which are explicitly NOT used.

**Potential Impact:**
- Unclear if Transfer Fees extension is used (we use custom tax logic)
- Uncertainty about Permanent Delegate (centralization risk)
- Missing documentation for auditors

**Suggested Fix:**
Add to Token_Program_Reference.md Section 1 or new Section 1.5:

```markdown
## Token-2022 Extensions

| Extension | CRIME | FRAUD | PROFIT | Rationale |
|-----------|-------|-------|--------|-----------|
| Transfer Hook | Yes | Yes | Yes | Whitelist enforcement |
| Transfer Fees | No | No | No | Custom tax logic in Tax Program |
| Permanent Delegate | No | No | No | Centralization risk |
| Non-Transferable | No | No | No | Must be tradeable |
| Interest-Bearing | No | No | No | Yield handled via staking |
| Confidential Transfer | No | No | No | Not needed |
| Default Account State | No | No | No | Standard behavior |
```

---

### GAP-003: Overview Missing Core Invariants Summary

| Field | Value |
|-------|-------|
| Category | 3. Mathematical Invariants |
| Severity | MEDIUM |
| Document(s) | DrFraudsworth_Overview.md |
| Status | **Filled** |
| Resolution | Added Protocol Invariants section with 7 core invariants, protocol-specific guarantees, and violation consequences |
| Filled In | DrFraudsworth_Overview.md, Protocol Invariants section |
| Iteration | 1 |

**What's Missing:**
The Overview does not include a summary of the protocol's core mathematical invariants.

**Why It Matters:**
Invariants define what MUST always be true. Having them in the Overview helps readers understand the protocol's guarantees at a high level.

**Potential Impact:**
- Readers don't know what properties the protocol guarantees
- Implementation may violate invariants unknowingly
- Harder to audit without invariant checklist

**Suggested Fix:**
Add section "## Protocol Invariants" to Overview:

1. **Constant Product:** Each pool maintains `reserve_a * reserve_b >= k_initial`
2. **Tax Distribution:** `yield_share + carnage_share + treasury_share == 100%`
3. **Epoch Monotonicity:** Epoch numbers only increase
4. **Escrow Solvency:** Staking escrow >= sum of all pending rewards
5. **Whitelist Immutability:** Whitelist cannot change after authority burn

---

### GAP-004: Tax_Pool_Logic_Spec Missing Account Architecture

| Field | Value |
|-------|-------|
| Category | 2. Account Architecture |
| Severity | HIGH |
| Document(s) | Tax_Pool_Logic_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 2 Account Architecture with stateless design philosophy and swap_authority PDA |
| Filled In | Tax_Pool_Logic_Spec.md, Section 2 Account Architecture |
| Iteration | 1 |

**What Was Missing:**
Tax_Pool_Logic_Spec did not define its account structures, PDA derivations, or account sizes. It only described the business logic.

**Resolution Applied:**
Added comprehensive Section 2 "Account Architecture" that includes:
- Section 2.1: Stateless design philosophy explanation (Tax Program reads from EpochState, no TaxState account needed)
- Section 2.2: swap_authority PDA with seeds ["swap_authority"], purpose, and access control pattern with code example
- Section 2.3: Cross-program references table showing all external accounts (EpochState, Pool, vaults, escrow, etc.)
- Section 2.4: Token program references table showing which token program (SPL Token vs Token-2022) is used for each pool type

**Commit:** 20f6ab4

---

### GAP-005: Tax_Pool_Logic_Spec Missing Instruction Account Lists

| Field | Value |
|-------|-------|
| Category | 4. Instruction Set |
| Severity | HIGH |
| Document(s) | Tax_Pool_Logic_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 10 Swap Instructions with complete account tables for all 4 swap variants |
| Filled In | Tax_Pool_Logic_Spec.md, Section 10 Swap Instructions |
| Iteration | 1 |

**What Was Missing:**
Section 9 described the swap logic flow but did not provide complete instruction signatures with account lists.

**Resolution Applied:**
Added comprehensive Section 10 "Swap Instructions" that includes:
- Section 10.1: Common account pattern overview table
- Section 10.2: swap_sol_buy complete account table (15 accounts)
- Section 10.3: swap_sol_sell complete account table (15 accounts)
- Section 10.4: swap_profit_buy complete account table (9 accounts - no tax accounts)
- Section 10.5: swap_profit_sell complete account table (9 accounts - no tax accounts)
- Section 10.6: Pool type differences summary table
- Section 10.7: Transfer hook integration with CPI depth diagram

**Commit:** baa5264

---

### GAP-006: Tax_Pool_Logic_Spec Missing CPI Depth Analysis

| Field | Value |
|-------|-------|
| Category | 5. CPI Patterns |
| Severity | MEDIUM |
| Document(s) | Tax_Pool_Logic_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 11 CPI Depth Analysis with ASCII diagrams for all swap variants |
| Filled In | Tax_Pool_Logic_Spec.md, Section 11 CPI Depth Analysis |
| Iteration | 1 |

**What's Missing:**
Tax Program makes CPI calls to AMM (swap), Staking Program (deposit_rewards), and Token programs (transfers). The CPI depth and compute budget implications are not documented.

**Why It Matters:**
Complex CPI chains can exceed compute limits. Epoch_State_Machine_Spec documents 260k CU for VRF callback, but Tax Program's swap CPI chain needs similar analysis.

**Potential Impact:**
- Swaps may fail due to compute limits
- Hidden depth issues with Token-2022 transfer hooks (which also CPI)

**Suggested Fix:**
Add section "## CPI Depth Analysis":

```markdown
## CPI Depth Analysis

### swap_sol_buy CPI Chain

Tax Program::swap_sol_buy
  |-> AMM Program::swap_sol_pool (depth 1)
      |-> Token-2022::transfer_checked (depth 2)
          |-> Transfer Hook Program (depth 3)
      |-> SPL Token::transfer (depth 2, WSOL side)
  |-> Staking Program::deposit_rewards (depth 1)
      |-> System Program::transfer (depth 2)

**Max Depth:** 3
**Estimated Compute:** ~150k CU
```

---

### GAP-007: Tax_Pool_Logic_Spec Missing Error Handling

| Field | Value |
|-------|-------|
| Category | 9. Error Handling |
| Severity | MEDIUM |
| Document(s) | Tax_Pool_Logic_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 19 Error Handling with complete TaxError enum (11 variants) |
| Filled In | Tax_Pool_Logic_Spec.md, Section 19 Error Handling |
| Iteration | 1 |

**What's Missing:**
Tax_Pool_Logic_Spec does not define error codes for the Tax Program.

**Why It Matters:**
Error codes are essential for debugging and user-facing error messages. All programs need defined errors.

**Potential Impact:**
- Generic error messages make debugging hard
- Users see unhelpful "Transaction failed"
- Harder to write tests

**Suggested Fix:**
Add section "## Error Handling":

```rust
#[error_code]
pub enum TaxError {
    #[msg("Invalid pool type for this operation")]
    InvalidPoolType,

    #[msg("Tax calculation overflow")]
    TaxOverflow,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Invalid epoch state")]
    InvalidEpochState,

    #[msg("Insufficient input amount")]
    InsufficientInput,
}
```

---

### GAP-008: Tax_Pool_Logic_Spec Missing Event Emissions

| Field | Value |
|-------|-------|
| Category | 10. Event Emissions |
| Severity | LOW |
| Document(s) | Tax_Pool_Logic_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 20 Events with TaxedSwap struct (12 fields), SwapDirection enum, UntaxedSwap event, usage guide, and example JSON |
| Filled In | Tax_Pool_Logic_Spec.md, Section 20 Events |
| Iteration | 1 |

**What's Missing:**
Tax_Pool_Logic_Spec does not define events for taxed swaps.

**Resolution Applied:**
Added Section 20 Events with:
- TaxedSwap event struct with 12 fields (user, pool_type, direction, amounts, tax breakdown, epoch, slot)
- SwapDirection enum (Buy/Sell)
- UntaxedSwap event for PROFIT pool swaps
- Off-chain usage guide and example JSON event log

---

### GAP-009: AMM_Implementation Missing Account Size Calculation

| Field | Value |
|-------|-------|
| Category | 2. Account Architecture |
| Severity | MEDIUM |
| Document(s) | AMM_Implementation.md |
| Status | **Filled** |
| Resolution | Added Section 4.3 Pool State Size Calculation with field breakdown, rent estimate, and Anchor space constraint |
| Filled In | AMM_Implementation.md, Section 4.3 |
| Iteration | 1 |

**What's Missing:**
Section 4.2 lists Pool State fields but does not include account size calculation.

**Why It Matters:**
Account size is required for Anchor's `space` constraint and rent calculation.

**Potential Impact:**
- Incorrect space allocation causes runtime errors
- Under-allocation = account creation fails
- Over-allocation = wasted SOL

**Suggested Fix:**
Add size calculation to Section 4.2:

```markdown
**Size Calculation:**
- discriminator: 8 bytes
- pool_type: 1 byte (enum)
- token_a_mint: 32 bytes
- token_b_mint: 32 bytes
- vault_a: 32 bytes
- vault_b: 32 bytes
- reserve_a: 8 bytes (u64)
- reserve_b: 8 bytes (u64)
- lp_fee_bps: 2 bytes (u16)
- initialized: 1 byte (bool)
- bump: 1 byte
- **Total:** 157 bytes
```

---

### GAP-010: New_Yield_System_Spec Missing Testing Requirements

| Field | Value |
|-------|-------|
| Category | 12. Testing Requirements |
| Severity | MEDIUM |
| Document(s) | New_Yield_System_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 17 Testing Requirements with 32 test cases across 5 categories |
| Filled In | New_Yield_System_Spec.md, Section 17 |
| Iteration | 1 |

**What's Missing:**
The New_Yield_System_Spec does not include a Testing Requirements section.

**Why It Matters:**
The staking system handles real SOL. Testing requirements ensure all edge cases are covered before deployment.

**Potential Impact:**
- Missing test coverage for critical edge cases
- First-depositor attack mitigation may not be tested
- Flash loan scenarios may not be covered

**Suggested Fix:**
Add section "## Testing Requirements":

```markdown
## Testing Requirements

### Unit Tests
- Reward calculation precision
- Overflow protection
- Stake/unstake balance updates

### Integration Tests
- Stake -> claim -> unstake flow
- Multiple users with different stake times
- Epoch transitions with pending rewards
- Zero total_staked handling

### Security Tests
- First-depositor attack (should fail with MINIMUM_STAKE)
- Flash loan attack (same-epoch stake/unstake = 0 rewards)
- Escrow solvency invariant

### Edge Cases
- Stake exactly at epoch boundary
- Claim with exactly 0 pending
- Partial unstake scenarios
```

---

## Dependent + Launch + Infrastructure Documents (Plan 04-02)

### GAP-050: Missing Compute Budget Estimate for Carnage Execution

| Field | Value |
|-------|-------|
| Category | 5. CPI Patterns |
| Severity | MEDIUM |
| Document(s) | Carnage_Fund_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 9.4 Compute Budget Analysis with CU estimates per path |
| Filled In | Carnage_Fund_Spec.md, Section 9.4 |
| Iteration | 1 |

**What's Missing:**
The Carnage execution CPI chain (Epoch -> Tax -> AMM -> Token-2022 -> Hook) reaches depth 3-4. Section 2 mentions "3 CPI levels" but no compute budget estimate is provided for the full execution path (burn + buy or sell + buy).

**Why It Matters:**
- Carnage atomically executes burn/sell then buy operations
- 1000 SOL max cap was chosen to "bound compute requirements" (Section 9.1)
- Without explicit CU estimates, the cap may be insufficient or overly conservative
- Failed atomic execution triggers fallback path (increased MEV risk)

**Potential Impact:**
- Atomic execution failures more common than expected
- Fallback execution window creates MEV opportunities
- 1000 SOL cap may not be optimal

**Suggested Fix:**
Add Section 9.4 "Compute Budget Analysis" with:
- CU estimate for burn-then-buy path
- CU estimate for sell-then-buy path
- Justification for 1000 SOL cap based on CU analysis
- Expected CU per SOL swapped

---

### GAP-051: Soft Peg Arbitrage Spec Missing Practical Examples

| Field | Value |
|-------|-------|
| Category | 12. Testing Requirements |
| Severity | MEDIUM |
| Document(s) | Soft_Peg_Arbitrage_Spec.md |
| Status | **Filled** |
| Resolution | Added Worked Examples section with 3 scenarios and summary table |
| Filled In | Soft_Peg_Arbitrage_Spec.md, Worked Examples section |
| Iteration | 1 |

**What's Missing:**
The spec provides theoretical formulas but no concrete numerical examples. Section 11 mentions "practical threshold of roughly 3-5%" without worked examples showing when arbitrage becomes profitable.

**Why It Matters:**
- Arbitrage is a core protocol feature (not a bug to fix)
- Bots need to understand extractable value to participate
- No example calculations for common scenarios (e.g., 1%/14% flip vs 4%/11% flip)

**Potential Impact:**
- Arbitrageurs may miscalculate profitability
- UI may incorrectly display arbitrage opportunities
- Testing cannot validate expected arbitrage profits

**Suggested Fix:**
Add Section 14 "Worked Examples" with:
- Example 1: Full flip (1% -> 14%) with specific pool depths
- Example 2: Marginal flip (4% -> 11%) showing minimal profitability
- Example 3: No-flip epoch showing why arbitrage is not viable
- Expected first-dollar profit percentages for each scenario

---

### GAP-052: Carnage Fund Missing Operational Runbooks

| Field | Value |
|-------|-------|
| Category | 14. Operational Documentation |
| Severity | LOW |
| Document(s) | Carnage_Fund_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 12.3 Operational Monitoring with metrics table, 3 alert levels, investigation checklist, and monitoring guidance |
| Filled In | Carnage_Fund_Spec.md, Section 12.3 Operational Monitoring |
| Iteration | 1 |

**What's Missing:**
Section 12 documents failure modes and Section 20 covers UI integration, but there are no operational runbooks for monitoring Carnage health or responding to persistent failures.

**Resolution Applied:**
Added Section 12.3 Operational Monitoring with:
- 6 key metrics table with alert thresholds
- 3 alert levels (Informational, Warning, Investigation Required)
- 4-step investigation checklist for persistent failures
- Explicit note that no admin intervention is possible
- Monitoring implementation guidance (WebSocket, indexing, alerts)
- Dashboard recommendations (real-time, daily, weekly)

---

### GAP-053: [CROSS-DOC] Bonding Curve Failure Does Not Explicitly Document Other Curve's Fate

| Field | Value |
|-------|-------|
| Category | 8. State Machine Specifications |
| Severity | MEDIUM |
| Document(s) | Bonding_Curve_Spec.md, Protocol_Initialzation_and_Launch_Flow.md |
| Status | **Filled** |
| Resolution | Atomic cross-doc: Compound States in Bonding_Curve_Spec + Section 13.5 in Protocol Init |
| Filled In | Bonding_Curve_Spec.md S5.2, Protocol_Initialzation_and_Launch_Flow.md S13.5 |
| Iteration | 1 |

**What's Missing:**
Section 9.1 of Bonding_Curve_Spec states "CRIME curve also effectively fails (cannot transition alone)" but the CurveStatus enum has no state representing "partner curve failed". The filled curve stays in `Filled` status even though transition is impossible.

**Why It Matters:**
- Users may see CRIME curve as "Filled" and expect protocol launch
- No explicit state transition for "filled but partner failed"
- Refund eligibility for filled curve participants is mentioned but not reflected in state

**Affected Documents:**
1. Bonding_Curve_Spec.md - CurveStatus enum missing state
2. Protocol_Initialzation_and_Launch_Flow.md - Emergency procedures Section 13 doesn't address filled-but-blocked curve

**Potential Impact:**
- UI may incorrectly show curve status
- Refund logic may be ambiguous for filled curve participants
- State machine has implicit "effectively failed" state not in enum

**Suggested Fix:**
Either:
A) Add `PartnerFailed` status to CurveStatus enum, OR
B) Document that `Filled` + partner `Failed` = refund eligible, and update UI guidance

---

### GAP-054: Missing Explicit Authority Burn Verification Procedures

| Field | Value |
|-------|-------|
| Category | 6. Authority & Access Control |
| Severity | HIGH |
| Document(s) | Protocol_Initialzation_and_Launch_Flow.md |
| Status | **Filled** |
| Resolution | Added Section 10.4 Authority Burn Threat Model with full verification procedures |
| Filled In | Protocol_Initialzation_and_Launch_Flow.md, Section 10.4 |
| Iteration | 1 |

**What Was Missing:**
Section 7.6 showed verification of token state ("mintAuthority === null") but no explicit on-chain verification procedure for transfer hook authorities.

**Resolution Applied:**
Added comprehensive Section 10.4 "Authority Burn Threat Model" that includes:
- TM-AUTH-01 through TM-AUTH-04 threat analysis (mint, freeze, transfer hook, whitelist authorities)
- Full threat model following Token_Program_Reference.md pattern
- Section 10.4.3 verification script additions with getTransferHook() checks
- Section 10.4.4 verification checkpoint for all authority burns
- Documents likelihood, impact, and mitigation status for each authority type

**Commit:** 7390cf2

---

### GAP-055: execute_transition Instruction Missing Detailed Account List

| Field | Value |
|-------|-------|
| Category | 13. Deployment Specification |
| Severity | MEDIUM |
| Document(s) | Bonding_Curve_Spec.md |
| Status | **Filled** |
| Resolution | Complete 34-account table replacing simplified list |
| Filled In | Bonding_Curve_Spec.md, Section 8.9 |
| Iteration | 1 |

**What's Missing:**
Section 8.9 shows `execute_transition` with a simplified account list ending in "... (Pool accounts, AMM program, etc.)". The Protocol_Initialzation_and_Launch_Flow.md Section 12.2 shows more accounts but still uses "// ..." placeholders.

**Why It Matters:**
- Transition is the most complex single instruction
- Missing accounts = failed transaction
- Implementation requires exact account list

**Potential Impact:**
- Implementer must reverse-engineer account requirements
- Transition failure at critical moment
- No clear specification for what accounts are needed

**Suggested Fix:**
Replace Section 8.9 simplified account list with complete list including:
- All 4 pool states and 8 vault accounts
- All 3 reserve vault accounts
- Both curve SOL vaults
- Both token mints + PROFIT mint
- All required programs (AMM, Token-2022, System)
- ExtraAccountMetaList accounts for hook invocation

---

### GAP-056: Missing "During Wait" Behavior for Curve Fill

| Field | Value |
|-------|-------|
| Category | 8. State Machine Specifications |
| Severity | MEDIUM |
| Document(s) | Bonding_Curve_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 9.3 Post-Fill Waiting Period with timeline and user guidance |
| Filled In | Bonding_Curve_Spec.md, Section 9.3 |
| Iteration | 1 |

**What's Missing:**
When one curve fills before the other, the spec doesn't document what happens to the filled curve during the waiting period. Can users still purchase from it? (No - it's filled). But can they do anything? The `Filled` state behavior is implicit.

**Why It Matters:**
- 04-RESEARCH.md Pitfall 2: "Not documenting what happens during asynchronous waits"
- CRIME could fill at hour 10, FRAUD might take until hour 47
- 37 hours of "Filled" state with no documented behavior

**Potential Impact:**
- Users unclear what to do while waiting
- UI may show misleading information
- No explicit documentation of "wait for partner" state

**Suggested Fix:**
Add Section 9.3 "Post-Fill Waiting Period" documenting:
- Filled curve is read-only (no more purchases)
- Transition cannot occur until partner fills
- Users should wait and monitor partner progress
- If deadline passes with partner unfilled, both enter refund mode

---

### GAP-057: [CROSS-DOC] Transfer Hook Whitelist Count Inconsistency

| Field | Value |
|-------|-------|
| Category | 2. Account Architecture |
| Severity | MEDIUM |
| Document(s) | Transfer_Hook_Spec.md, Protocol_Initialzation_and_Launch_Flow.md |
| Status | **Filled** |
| Resolution | User decision: 13 entries correct. Transfer_Hook_Spec.md updated to match Protocol Init |
| Filled In | Transfer_Hook_Spec.md Section 4, Protocol_Initialzation_and_Launch_Flow.md Section 6.2 |
| Iteration | 1 |

**What Was Missing:**
Transfer_Hook_Spec.md Section 4 said "Total: 10 addresses" but Protocol_Initialzation_and_Launch_Flow.md listed 13 entries. The 10-entry list was missing:
- Separate Carnage CRIME and FRAUD vaults (had single "Carnage Fund PDA")
- Separate CRIME and FRAUD bonding curve token vaults (had single "Bonding Curve PDA")
- Reserve vault for transition distribution

**Resolution Applied:**
User confirmed 13 entries is architecturally correct because:
- Carnage needs separate vaults for CRIME and FRAUD tokens (2, not 1)
- Bonding curves need separate token vaults per mint (2, not 1)
- Reserve needs whitelisting for transition distribution

Transfer_Hook_Spec.md Section 4 updated with complete 13-entry table. Protocol Init Section 6.2 verified consistent. Cross-references added between both documents.

**Commit:** bb6d907, 7d80d43

---

## Gap Summary

**Total Gaps:** 24
**By Plan:**
- Plan 04-01 (Foundation + Core): 10 gaps (GAP-001 to GAP-010)
- Plan 04-02 (Dependent + Launch + Infrastructure): 8 gaps (GAP-050 to GAP-057)
- Plan 04-03 (Deep-Dive Analysis): 7 gaps (GAP-060 to GAP-066)

**Cross-Document Gaps:** 3 (GAP-053, GAP-057, GAP-063)

**By Severity:**
- CRITICAL: 0
- HIGH: 5 (GAP-001, GAP-004, GAP-005, GAP-054, GAP-064)
- MEDIUM: 16
- LOW: 3 (GAP-008, GAP-052, GAP-062)

**Top Gap Categories:**
1. CPI Patterns (5 gaps) - GAP-006, GAP-050, GAP-064, GAP-065, GAP-066
2. Mathematical Invariants (4 gaps) - GAP-003, GAP-060, GAP-061, GAP-062
3. Account Architecture (3 gaps) - GAP-004, GAP-009, GAP-057
4. State Machine Specifications (3 gaps) - GAP-053, GAP-056, GAP-063
5. Token Program Compatibility (2 gaps) - GAP-001, GAP-002
6. Testing Requirements (2 gaps) - GAP-010, GAP-051

**Documents Audited (Plan 04-01):**
1. DrFraudsworth_Overview.md - 2 gaps (GAP-001, GAP-003)
2. Token_Program_Reference.md - 1 gap (GAP-002)
3. Epoch_State_Machine_Spec.md - 0 gaps (comprehensive spec)
4. Tax_Pool_Logic_Spec.md - 5 gaps (GAP-004 to GAP-008)
5. AMM_Implementation.md - 1 gap (GAP-009)
6. New_Yield_System_Spec.md - 1 gap (GAP-010)

**Documents Audited (Plan 04-02):**
1. Carnage_Fund_Spec.md - 2 gaps (GAP-050, GAP-052)
2. Soft_Peg_Arbitrage_Spec.md - 1 gap (GAP-051)
3. Bonding_Curve_Spec.md - 2 gaps (GAP-055, GAP-056)
4. Protocol_Initialzation_and_Launch_Flow.md - 1 gap (GAP-054)
5. Transfer_Hook_Spec.md - 0 direct gaps (contributes to GAP-053, GAP-057)
6. SolanaSetup.md - 0 gaps (informational document, not protocol spec)

**Deep-Dive Analysis (Plan 04-03):**
1. Mathematical Invariants - 3 gaps (GAP-060, GAP-061, GAP-062)
2. State Machine Transitions - 1 gap (GAP-063)
3. CPI Depth & Compute Budget - 3 gaps (GAP-064, GAP-065, GAP-066)

---

## Deep-Dive Analysis (Plan 04-03)

### Mathematical Invariants Analysis

The following 7+ protocol invariants were systematically verified against spec documentation:

| Invariant | Document(s) | Explicit Statement | Violation Consequences | Detection Method | Recovery |
|-----------|-------------|-------------------|----------------------|------------------|----------|
| 1. AMM Constant Product (`k_after >= k_before`) | AMM_Implementation.md S8.2 | Yes | Yes (abort) | Yes (check in swap) | N/A (tx reverts) |
| 2. Total Supply Conservation | Not explicitly documented | No | No | No | No |
| 3. No Negative Balances | Implied by u64 types | Implicit | N/A (rust prevents) | N/A | N/A |
| 4. Tax Distribution (75+24+1=100%) | Tax_Pool_Logic_Spec.md S4 | Yes | No | No | No |
| 5. Epoch Monotonicity | Epoch_State_Machine_Spec.md S6.2 | Yes | No | No | No |
| 6. Yield Escrow Solvency | New_Yield_System_Spec.md S9.5 | Yes | No | Yes (in claim) | Yes (tx reverts) |
| 7. Cumulative Only Increases | New_Yield_System_Spec.md S16 | Yes (invariant 5) | No | No | N/A |

**Additional Protocol-Specific Invariants Identified:**

| Invariant | Document(s) | Status |
|-----------|-------------|--------|
| 8. Single Global Tax Regime | Tax_Pool_Logic_Spec.md S5 | Explicit |
| 9. Whitelist Immutability Post-Burn | DrFraudsworth_Overview.md | Explicit |
| 10. No Admin Functions Post-Deployment | Multiple docs | Explicit |
| 11. Liquidity is Permanent | AMM_Implementation.md | Explicit |
| 12. SOL Never Lost in Carnage | Carnage_Fund_Spec.md S22.7 | Explicit |

### GAP-060: Missing Total Supply Conservation Invariant Documentation

| Field | Value |
|-------|-------|
| Category | 3. Mathematical Invariants |
| Severity | MEDIUM |
| Document(s) | DrFraudsworth_Overview.md, Token_Program_Reference.md |
| Status | **Filled** |
| Resolution | Added Total Supply Accounting subsection with token-specific table, Carnage burn exception, verification formula |
| Filled In | DrFraudsworth_Overview.md, Protocol Invariants section |
| Iteration | 1 |

**What's Missing:**
No spec document explicitly states the total supply conservation invariant: `sum(all_balances) == total_supply` for each token. This is guaranteed by Token-2022/SPL Token programs but should be explicit for auditors.

**Why It Matters:**
- Auditors need explicit statement of this fundamental invariant
- Carnage burns reduce total supply (intentional) - should document this exception
- Helps reason about token flows

**Potential Impact:**
- Security auditors may ask "where is supply conservation documented?"
- Edge cases around burns not explicitly tied to supply accounting

**Suggested Fix:**
Add to Overview Section "Protocol Invariants":
```markdown
**Total Supply Accounting:**
- `sum(all_token_balances) == total_supply` for CRIME, FRAUD, PROFIT
- Exception: Carnage burns REDUCE total_supply (tracked in CarnageFundState.total_X_burned)
- Token-2022/SPL Token programs enforce this at the program level
```

---

### GAP-061: Invariant Violation Consequences Not Documented

| Field | Value |
|-------|-------|
| Category | 3. Mathematical Invariants |
| Severity | MEDIUM |
| Document(s) | DrFraudsworth_Overview.md |
| Status | **Filled** |
| Resolution | Added Invariant Failure Modes subsection with security-critical classification and monitoring recommendations |
| Filled In | DrFraudsworth_Overview.md, Protocol Invariants section |
| Iteration | 1 |

**What's Missing:**
While individual specs document some invariants, there's no consolidated "what happens if X is violated" documentation. For example:
- What if tax distribution doesn't sum to 100%? (Code bug - undefined behavior)
- What if epoch number decreases? (Should be impossible - no consequence documented)
- What if cumulative decreases? (Stakers lose rewards - not documented)

**Why It Matters:**
- Auditors need to understand failure modes
- Helps prioritize which invariants are security-critical vs correctness-critical
- Documents expected behavior under violation

**Potential Impact:**
- Security review may flag missing failure mode analysis
- Implementation may not handle all edge cases

**Suggested Fix:**
Add to Overview or create new "Invariants & Failure Modes" document:
```markdown
## Invariant Failure Modes

| Invariant | Violation Type | Consequence | Detection |
|-----------|---------------|-------------|-----------|
| AMM k | Code bug | TX reverts | Pre-swap check |
| Tax split != 100% | Code bug | Undefined | N/A (constant in code) |
| Epoch decrease | Impossible | N/A | Type system (u32) |
| Escrow insolvency | Unexpected | Claims fail | On-claim check |
```

---

### GAP-062: Missing Boundary Conditions for Tax Bands

| Field | Value |
|-------|-------|
| Category | 3. Mathematical Invariants |
| Severity | LOW |
| Document(s) | Tax_Pool_Logic_Spec.md, Epoch_State_Machine_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 7.4 Tax Band Boundary Conditions with all 8 achievable values, boundary Q&A, VRF distribution, and testing implications |
| Filled In | Epoch_State_Machine_Spec.md, Section 7.4 Tax Band Boundary Conditions |
| Iteration | 1 |

**What's Missing:**
Tax bands are documented (1-4% low, 11-14% high) but boundary behavior is not explicit.

**Resolution Applied:**
Added Section 7.4 Tax Band Boundary Conditions with:
- Table of all 8 achievable tax rates (4 low + 4 high)
- Exact Rust code showing rate selection from arrays
- Boundary behavior Q&A table (7 questions answered explicitly)
- VRF byte distribution showing 25% probability per rate
- Testing implications for comprehensive boundary testing

---

### State Machine Transition Analysis

#### Epoch State Machine (Epoch_State_Machine_Spec.md)

| State | Documented | Transitions | "During Wait" Behavior |
|-------|-----------|-------------|----------------------|
| ACTIVE | Yes (S6.1) | Yes | Implicit (normal operation) |
| VRF_PENDING | Yes (S6.1) | Yes | **Yes** - S14.7: "Swaps continue normally using old taxes" |
| VRF_RETRY | Yes (S6.1) | Yes | Same as VRF_PENDING |
| CARNAGE_PENDING | Yes (S6.1) | Yes | **Partial** - S6.2 says epoch continues, unclear if new epoch can start |

**Finding:** Epoch state machine is well-documented. Minor gap on CARNAGE_PENDING overlap with next epoch.

#### Carnage State Machine (Carnage_Fund_Spec.md)

| State | Documented | Transitions | "During Wait" Behavior |
|-------|-----------|-------------|----------------------|
| IDLE | Implicit | Yes | Normal swaps |
| PENDING_EXECUTION | Yes (S11.2) | Yes | **Gap**: Can new epoch transition occur while Carnage pending? |
| EXECUTED | N/A (clears to IDLE) | Yes | N/A |
| EXPIRED | N/A (clears to IDLE) | Yes | N/A |

**Finding:** Carnage state is embedded in EpochState (carnage_pending flag), not separate state machine. "During wait" for PENDING_EXECUTION needs clarification.

#### Bonding Curve State Machine (Bonding_Curve_Spec.md)

| State | Documented | Transitions | "During Wait" Behavior |
|-------|-----------|-------------|----------------------|
| Initialized | Yes (S5.2) | Yes | No purchases possible |
| Active | Yes (S5.2) | Yes | Purchases allowed |
| Filled | Yes (S5.2) | Yes | **Gap**: GAP-056 already logged |
| Failed | Yes (S5.2) | Yes | Refunds available |
| Transitioned | Yes (S5.2) | Yes | Final state |

**Finding:** GAP-056 already covers missing "during wait" for Filled state.

### GAP-063: Carnage Pending + Epoch Transition Overlap Not Documented

| Field | Value |
|-------|-------|
| Category | 8. State Machine Specifications |
| Severity | MEDIUM |
| Document(s) | Epoch_State_Machine_Spec.md, Carnage_Fund_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 6.3 Cross-System Interactions with behavior table and safety proof |
| Filled In | Epoch_State_Machine_Spec.md Section 6.3, Carnage_Fund_Spec.md Section 11.2 |
| Iteration | 1 |

**What Was Missing:**
Specs did not document what happens if `carnage_pending = true` when the next epoch boundary arrives. Could epoch transitions be blocked by stale Carnage pending state?

**Resolution Applied:**
Added Epoch_State_Machine_Spec.md Section 6.3 "Cross-System Interactions" documenting:
- Epoch transitions are INDEPENDENT of Carnage pending state
- `trigger_epoch_transition` checks only `vrf_pending` and epoch boundary, NOT `carnage_pending`
- Behavior table for all state combinations
- Safety proof: 100-slot deadline (~40s) resolves well before next epoch (~30min)
- Invariant: `carnage_pending` and `vrf_pending` are independent state dimensions
- Cross-reference added in Carnage_Fund_Spec.md Section 11.2

**Commit:** 19c9723

---

### CPI Depth Analysis

#### CPI Chain 1: Swap Flow (Tax -> AMM -> Token Programs)

```
User Transaction
  └─> Tax Program::swap_sol_buy (entry point)
      └─> AMM Program::swap_sol_pool (depth 1)
          ├─> Token-2022::transfer_checked (depth 2) [CRIME/FRAUD side]
          │   └─> Transfer Hook Program::execute (depth 3)
          └─> SPL Token::transfer (depth 2) [WSOL side, no hook]
      └─> Staking Program::deposit_rewards (depth 1, parallel)
          └─> System Program::transfer (depth 2)
```

**Max Depth:** 3 (CRIME/FRAUD path with hook)
**Documented:** GAP-006 already flagged missing CPI depth analysis in Tax spec
**Compute Estimate:** Not documented (gap)

#### CPI Chain 2: VRF Callback Flow (Switchboard -> Epoch -> Staking)

```
Switchboard VRF::callback
  └─> Epoch Program::vrf_callback (depth 1)
      └─> Staking Program::update_cumulative (depth 2)
```

**Max Depth:** 2 (without Carnage)
**Documented:** Yes - Epoch_State_Machine_Spec.md S14.5 says ~260k CU
**With Carnage Inline:**

```
Switchboard VRF::callback
  └─> Epoch Program::vrf_callback (depth 1)
      └─> Staking Program::update_cumulative (depth 2)
      └─> [If Carnage] execute_carnage_inner (inline, not CPI)
          └─> Tax Program::swap_exempt (depth 2)
              └─> AMM Program::swap (depth 3)
                  └─> Token-2022::transfer_checked (depth 4) [CRIME/FRAUD]
                      └─> Transfer Hook (depth 5) -- EXCEEDS LIMIT!
```

**CRITICAL FINDING:** Carnage execution path may exceed depth 4!

#### CPI Chain 3: Carnage Execution (Detailed)

Per Carnage_Fund_Spec.md Section 2:
- "This is 3 CPI levels. Adding a separate Carnage Fund Program would push to 4 levels."

But the analysis shows:
```
VRF Callback (Switchboard depth 0)
  └─> Epoch::vrf_callback (depth 1)
      └─> Tax::swap_exempt (depth 2)  -- But wait, is Carnage calling Tax or AMM directly?
```

**Clarification needed:** The spec says Carnage is "inline within Epoch Program" but execution logic shows CPI to Tax Program for swap_exempt. Let's trace accurately:

Per Carnage_Fund_Spec.md Section 9.2:
```
Epoch Program::execute_carnage_inner (inline, not CPI from VRF's perspective)
  └─> Tax Program::swap_exempt (CPI depth 1 from Epoch)
      └─> AMM Program::swap (CPI depth 2 from Epoch)
          └─> Token-2022::transfer (CPI depth 3 from Epoch)
              └─> Transfer Hook (CPI depth 4 from Epoch)
```

**Actual Max Depth from Epoch:** 4 (at the Solana limit)
**From Switchboard callback:** Switchboard -> Epoch is external call (depth 1), so:
```
Switchboard callback -> Epoch (1) -> Tax (2) -> AMM (3) -> Token-2022 (4) -> Hook (5)
```

Wait, Switchboard callback invokes user program - that's not a CPI, that's the entry point.

**Corrected Analysis:**
- Switchboard VRF callback sets Epoch::vrf_callback as the callback instruction
- Entry point is Epoch::vrf_callback (depth 0)
- Epoch -> Staking::update_cumulative (depth 1)
- Epoch -> [Carnage inline] -> Tax::swap_exempt (depth 1)
- Tax -> AMM (depth 2)
- AMM -> Token-2022 (depth 3)
- Token-2022 -> Hook (depth 4)

**Max Depth:** 4 (exactly at limit)

This matches Carnage spec Section 2: "3 CPI levels" (Tax->AMM->Token is 3 from Epoch's perspective, but Token-2022 internally calls Hook making it 4 total).

### GAP-064: CPI Depth at Solana Limit Needs Explicit Acknowledgment

| Field | Value |
|-------|-------|
| Category | 5. CPI Patterns |
| Severity | HIGH |
| Document(s) | Carnage_Fund_Spec.md, Epoch_State_Machine_Spec.md |
| Status | **Filled** |
| Resolution | Updated Section 2 with complete CPI depth analysis and ARCHITECTURAL CONSTRAINT warning |
| Filled In | Carnage_Fund_Spec.md, Section 2 Architectural Decision |
| Iteration | 1 |

**What Was Missing:**
Carnage_Fund_Spec.md Section 2 claimed "3 CPI levels" but did not account for Token-2022's internal CPI to Transfer Hook (making it 4 total).

**Resolution Applied:**
Completely rewrote Section 2's CPI depth analysis to include:
- Accurate execution path diagram showing all 5 levels (entry + 4 CPI)
- "SOLANA LIMIT" marker at depth 4
- Prominent "ARCHITECTURAL CONSTRAINT -- PERMANENT" warning block
- Explicit statement that no additional CPI can be added
- Explanation of why inline Carnage was chosen (separate program would exceed limit)
- Statement superseding the earlier "3 CPI levels" understanding

**Commit:** 31553db

---

### GAP-065: Missing Compute Budget Estimates for Tax Program Swaps

| Field | Value |
|-------|-------|
| Category | 5. CPI Patterns |
| Severity | MEDIUM |
| Document(s) | Tax_Pool_Logic_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 12 Compute Budget Analysis with CU estimates and frontend recommendations |
| Filled In | Tax_Pool_Logic_Spec.md, Section 12 Compute Budget Analysis |
| Iteration | 1 |

**What's Missing:**
Tax_Pool_Logic_Spec.md does not include compute unit estimates for swap operations. Epoch spec documents 260k CU for VRF callback, but regular user swaps need similar analysis.

**Why It Matters:**
- Users need to know if swaps require compute budget increases
- Complex swap paths (with hooks) may exceed default 200k CU
- Frontend needs to set appropriate compute limits

**Potential Impact:**
- User swaps may fail with compute exceeded errors
- Poor UX if users need to manually increase compute budget

**Suggested Fix:**
Add to Tax_Pool_Logic_Spec.md (or create during Phase 5 account architecture gap fill):
```markdown
## Compute Budget Analysis

| Operation | CPI Chain | Estimated CU | Notes |
|-----------|-----------|--------------|-------|
| swap_sol_buy (CRIME) | Tax->AMM->T22->Hook | ~120k | Hook adds ~30k |
| swap_sol_sell (CRIME) | Tax->AMM->SPL+T22->Hook | ~130k | Mixed token programs |
| swap_profit_pool | Tax->AMM->T22->Hook×2 | ~150k | Both sides have hooks |

**Recommendation:** Frontend should set 200k CU for all swaps, 300k for complex multi-hop trades.
```

---

### GAP-066: Missing Authority Signing Documentation for CPI Chains

| Field | Value |
|-------|-------|
| Category | 5. CPI Patterns |
| Severity | MEDIUM |
| Document(s) | Tax_Pool_Logic_Spec.md, Carnage_Fund_Spec.md |
| Status | **Filled** |
| Resolution | Added Section 13 CPI Authority Chain with signing flow diagrams and Key Signers table |
| Filled In | Tax_Pool_Logic_Spec.md, Section 13 CPI Authority Chain |
| Iteration | 1 |

**What's Missing:**
The CPI chains require PDA signatures at multiple levels. While individual specs mention signing (e.g., Carnage uses "carnage_signer_seeds"), there's no consolidated view of which PDA signs which CPI call.

**Why It Matters:**
- Implementers need to know exact signer requirements
- Missing signer = failed transaction
- Complex chains like Carnage have multiple signing authorities

**Potential Impact:**
- Implementation errors from incorrect signer setup
- Debugging difficulty when CPI fails due to missing signer

**Suggested Fix:**
Add to Tax_Pool_Logic_Spec.md and Carnage_Fund_Spec.md:
```markdown
## CPI Authority Chain

### swap_sol_buy
```
Tax Program::swap_sol_buy (user signs)
  └─> AMM::swap (Tax PDA signs as swap_authority)
      └─> Token-2022::transfer_checked
          ├─> [input] User signs
          └─> [output] Pool PDA signs
```

### Carnage Execution
```
Epoch::execute_carnage_inner (no user signer - permissionless)
  └─> Tax::swap_exempt (Carnage PDA signs)
      └─> AMM::swap (Tax PDA signs)
          └─> Token transfers (Carnage vault PDA or Pool PDA signs)
```

---

## Filled Gaps

_Gaps that have been addressed with new or updated documentation._

### GAP-001: WSOL Clarification in Overview (HIGH) -- Filled in Plan 05-02

| Field | Value |
|-------|-------|
| Category | Token Program Compatibility |
| Severity | HIGH |
| Status | **Filled** |
| Resolution | Added "WSOL Exception" callout to Token Structure section |
| Document | DrFraudsworth_Overview.md |
| Commit | 56396e3 |

---

### GAP-054: Authority Burn Threat Model (HIGH) -- Filled in Plan 05-02

| Field | Value |
|-------|-------|
| Category | Authority & Access Control |
| Severity | HIGH |
| Status | **Filled** |
| Resolution | Added Section 10.4 Authority Burn Threat Model with TM-AUTH-01 through TM-AUTH-04 |
| Document | Protocol_Initialzation_and_Launch_Flow.md |
| Commit | 7390cf2 |

---

### GAP-064: CPI Depth Warning (HIGH) -- Filled in Plan 05-02

| Field | Value |
|-------|-------|
| Category | CPI Patterns |
| Severity | HIGH |
| Status | **Filled** |
| Resolution | Corrected CPI depth to 4 with ARCHITECTURAL CONSTRAINT warning |
| Document | Carnage_Fund_Spec.md |
| Commit | 31553db |

---

### GAP-004: Tax Account Architecture (HIGH) -- Filled in Plan 05-01

| Field | Value |
|-------|-------|
| Category | Account Architecture |
| Severity | HIGH |
| Status | **Filled** |
| Resolution | Added Section 2 Account Architecture with stateless design, swap_authority PDA, and cross-program references |
| Document | Tax_Pool_Logic_Spec.md |
| Commit | 20f6ab4 |

---

### GAP-005: Tax Instruction Account Lists (HIGH) -- Filled in Plan 05-01

| Field | Value |
|-------|-------|
| Category | Instruction Set |
| Severity | HIGH |
| Status | **Filled** |
| Resolution | Added Section 10 Swap Instructions with complete account tables for all 4 swap variants |
| Document | Tax_Pool_Logic_Spec.md |
| Commit | baa5264 |

---

### GAP-002: Token-2022 Extension Inventory (MEDIUM) -- Filled in Plan 05-05

| Field | Value |
|-------|-------|
| Category | Token Program Compatibility |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 9 with 13-extension inventory, rationale details, and auditor verification |
| Document | Token_Program_Reference.md |
| Commit | 7adb162 |

---

### GAP-003: Protocol Invariants Summary (MEDIUM) -- Filled in Plan 05-05

| Field | Value |
|-------|-------|
| Category | Mathematical Invariants |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Protocol Invariants section with 7 core invariants, guarantees, and violation consequences |
| Document | DrFraudsworth_Overview.md |
| Commit | 2cabded |

---

### GAP-009: AMM Account Size Calculation (MEDIUM) -- Filled in Plan 05-05

| Field | Value |
|-------|-------|
| Category | Account Architecture |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 4.3 with field-by-field size breakdown (157 bytes), rent estimate, Anchor constraint |
| Document | AMM_Implementation.md |
| Commit | 81c1dc8 |

---

### GAP-010: Yield Testing Requirements (MEDIUM) -- Filled in Plan 05-05

| Field | Value |
|-------|-------|
| Category | Testing Requirements |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 17 with 32 test cases across unit, integration, security, edge case, stress categories |
| Document | New_Yield_System_Spec.md |
| Commit | 2539a4c |

---

### GAP-060: Total Supply Conservation (MEDIUM) -- Filled in Plan 05-08

| Field | Value |
|-------|-------|
| Category | Mathematical Invariants |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Total Supply Accounting subsection with token-specific table, Carnage burn exception, verification formula |
| Document | DrFraudsworth_Overview.md |
| Commit | 137f399 |

---

### GAP-061: Invariant Violation Consequences (MEDIUM) -- Filled in Plan 05-08

| Field | Value |
|-------|-------|
| Category | Mathematical Invariants |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Invariant Failure Modes subsection with security-critical classification and monitoring recommendations |
| Document | DrFraudsworth_Overview.md |
| Commit | 3058dee |

---

### GAP-050: Carnage Compute Budget (MEDIUM) -- Filled in Plan 05-06

| Field | Value |
|-------|-------|
| Category | CPI Patterns |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 9.4 Compute Budget Analysis with CU estimates per execution path, 1000 SOL cap justification |
| Document | Carnage_Fund_Spec.md |
| Commit | 0ca4b7c |

---

### GAP-051: Soft Peg Worked Examples (MEDIUM) -- Filled in Plan 05-06

| Field | Value |
|-------|-------|
| Category | Testing Requirements |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Worked Examples section with 3 scenarios showing arbitrage profitability (or lack thereof) |
| Document | Soft_Peg_Arbitrage_Spec.md |
| Commit | 50a65b4 |

---

### GAP-053: Partner Curve Failure State (MEDIUM, CROSS-DOC) -- Filled in Plan 05-06

| Field | Value |
|-------|-------|
| Category | State Machine Specifications |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Atomic cross-doc: Compound States in Bonding_Curve_Spec S5.2 + Partner Curve Failure Handling in Protocol Init S13.5 |
| Document | Bonding_Curve_Spec.md, Protocol_Initialzation_and_Launch_Flow.md |
| Commit | 2f64534 |

---

### GAP-055: execute_transition Account List (MEDIUM) -- Filled in Plan 05-06

| Field | Value |
|-------|-------|
| Category | Deployment Specification |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Complete 34-account table replacing simplified list with all pools, vaults, reserves, and programs |
| Document | Bonding_Curve_Spec.md |
| Commit | 97988d4 |

---

### GAP-056: Filled State Waiting Behavior (MEDIUM) -- Filled in Plan 05-06

| Field | Value |
|-------|-------|
| Category | State Machine Specifications |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 9.3 Post-Fill Waiting Period with allowed actions, timeline, user guidance, and partner failure edge case |
| Document | Bonding_Curve_Spec.md |
| Commit | ff3049d |

---

### GAP-006: Tax CPI Depth Analysis (MEDIUM) -- Filled in Plan 05-04

| Field | Value |
|-------|-------|
| Category | CPI Patterns |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 11 CPI Depth Analysis with ASCII diagrams for all swap variants, depth summary table |
| Document | Tax_Pool_Logic_Spec.md |
| Commit | c24a514 |

---

### GAP-007: Tax Error Handling (MEDIUM) -- Filled in Plan 05-04

| Field | Value |
|-------|-------|
| Category | Error Handling |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 19 Error Handling with TaxError enum (11 variants) and error conditions table |
| Document | Tax_Pool_Logic_Spec.md |
| Commit | 7ace35b |

---

### GAP-065: Tax Compute Budget Estimates (MEDIUM) -- Filled in Plan 05-04

| Field | Value |
|-------|-------|
| Category | CPI Patterns |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 12 Compute Budget Analysis with CU estimates per swap variant, frontend recommendations |
| Document | Tax_Pool_Logic_Spec.md |
| Commit | 0857a5a |

---

### GAP-066: Tax Authority Signing Documentation (MEDIUM) -- Filled in Plan 05-04

| Field | Value |
|-------|-------|
| Category | CPI Patterns |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 13 CPI Authority Chain with signing flow diagrams, Key Signers table with PDA seeds |
| Document | Tax_Pool_Logic_Spec.md |
| Commit | 0857a5a |

---

### GAP-057: Whitelist Count Inconsistency (MEDIUM, CROSS-DOC) -- Filled in Plan 05-07

| Field | Value |
|-------|-------|
| Category | Account Architecture |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | User decision: 13 entries correct. Transfer_Hook_Spec.md updated from 10 to 13. Cross-references added. |
| Document | Transfer_Hook_Spec.md, Protocol_Initialzation_and_Launch_Flow.md |
| Commit | bb6d907, 7d80d43 |

---

### GAP-063: Carnage Pending + Epoch Overlap (MEDIUM, CROSS-DOC) -- Filled in Plan 05-07

| Field | Value |
|-------|-------|
| Category | State Machine Specifications |
| Severity | MEDIUM |
| Status | **Filled** |
| Resolution | Added Section 6.3 Cross-System Interactions with independent state dimensions proof |
| Document | Epoch_State_Machine_Spec.md, Carnage_Fund_Spec.md |
| Commit | 19c9723 |

---

### GAP-008: Tax Event Emissions (LOW) -- Filled in Plan 05-10

| Field | Value |
|-------|-------|
| Category | Event Emissions |
| Severity | LOW |
| Status | **Filled** |
| Resolution | Added Section 20 Events with TaxedSwap, SwapDirection, UntaxedSwap, usage guide, example JSON |
| Document | Tax_Pool_Logic_Spec.md |
| Commit | c1afb0f |

---

### GAP-052: Carnage Operational Runbooks (LOW) -- Filled in Plan 05-10

| Field | Value |
|-------|-------|
| Category | Operational Documentation |
| Severity | LOW |
| Status | **Filled** |
| Resolution | Added Section 12.3 Operational Monitoring with metrics, alert levels, investigation checklist |
| Document | Carnage_Fund_Spec.md |
| Commit | 4538e1a |

---

### GAP-062: Tax Band Boundary Conditions (LOW) -- Filled in Plan 05-10

| Field | Value |
|-------|-------|
| Category | Mathematical Invariants |
| Severity | LOW |
| Status | **Filled** |
| Resolution | Added Section 7.4 Tax Band Boundary Conditions with all 8 achievable values, Q&A, VRF distribution |
| Document | Epoch_State_Machine_Spec.md |
| Commit | 2e8c7cb |

---

## Won't Fill

_Gaps acknowledged but intentionally not filled, with rationale._

(None yet)

---

## Phase 4 Complete

**Audit Scope:** 12 documents against 14-category checklist
**Deep-Dive Areas:** Mathematical invariants (7 verified, 3 gaps), state machines (3 audited, 1 gap), CPI depth (4 chains traced, 3 gaps)

**Ready for Phase 5:** All 24 gaps have GAP-XXX IDs for systematic resolution.

**Recommended Phase 5 Order:**
1. **CRITICAL gaps first** (none currently - good news)
2. **HIGH gaps** (5 total - security/implementation critical):
   - GAP-001: WSOL clarification in Overview (v3 failure cause)
   - GAP-004: Tax spec account architecture
   - GAP-005: Tax spec instruction account lists
   - GAP-054: Authority burn verification procedures
   - GAP-064: CPI depth at Solana limit acknowledgment
3. **[CROSS-DOC] gaps** (3 total - resolve authoritative source):
   - GAP-053: Partner curve failure state
   - GAP-057: Whitelist count inconsistency (10 vs 13)
   - GAP-063: Carnage pending + epoch transition overlap
4. **MEDIUM/LOW gaps** (16 remaining)

**Key Finding:** Carnage execution CPI chain reaches exactly depth 4 (Solana's hard limit). This is a permanent architectural constraint that should be explicitly documented.

**Protocol Invariants Status:**
- 12 invariants identified across protocol
- 7 core invariants explicitly documented in specs
- 3 gaps logged for missing/incomplete invariant documentation
- No invariants found to be CRITICAL missing (correctness not at risk)

*Phase 4 completed: 2026-02-02*

---

## Phase 7 Delta Validation

**Date:** 2026-02-03
**Scope:** Delta validation of Phase 6 additions against the converged 12-document baseline

### Validation Target

3 artifacts from Phase 6:
1. `VRF_Implementation_Reference.md` (new document, 737 lines)
2. `VRF_Migration_Lessons.md` (new document, 258 lines)
3. `Carnage_Fund_Spec.md` Section 9.5 (modified section)

### 14-Category Checklist Results

**VRF_Implementation_Reference.md** (reference document -- fewer categories applicable):

| Category | Applicable? | Result |
|----------|-------------|--------|
| 1. Token Program | No (reference doc) | N/A |
| 2. Account Architecture | Yes | Clean -- v3 layout clearly marked as v3, not v4 authoritative |
| 3. Mathematical Invariants | Partial | Clean -- tax rate derivation documented with discrepancy flagged |
| 4. Instruction Set | Partial | Clean -- commit/consume instructions documented as reference |
| 5. CPI Patterns | Yes | Clean -- explicitly states no CPI to Switchboard (client-side pattern) |
| 6. Authority & Access Control | No | N/A |
| 7. Economic Model | No | N/A |
| 8. State Machine | Yes | Clean -- VRF lifecycle compatible with Epoch spec state machine |
| 9. Error Handling | Partial | Clean -- 8 VRF-specific error codes documented |
| 10. Event Emissions | No | N/A |
| 11. Security | Yes | Clean -- anti-reroll, timeout, stale randomness consistent with Epoch spec |
| 12. Testing Requirements | No | N/A |
| 13. Deployment Specification | No | N/A |
| 14. Operational Documentation | No | N/A |

**VRF_Migration_Lessons.md** (lessons-learned document):

| Check | Result |
|-------|--------|
| All 7 DISC entries RESOLVED:SPEC | Confirmed -- no regressions |
| Cross-references to Epoch_State_Machine_Spec.md accurate | Confirmed -- 4 references, section numbers match |
| Cross-references to VRF_Implementation_Reference.md accurate | Confirmed -- 2 references valid |
| Open questions (Section 6) clearly deferred | Confirmed -- 3 items with specific Action: fields |

**Carnage_Fund_Spec.md Section 9.5 consistency:**

| Check | Result |
|-------|--------|
| Section 9.5 vs 9.4 (Compute Budget) | Consistent -- two-instruction approach resolves CU concern |
| Section 9.5 vs Section 2 (CPI Depth) | Consistent -- depth-4 constraint maintained with instruction isolation |
| Section 9.5 vs Section 9.2 (Execution Logic) | Consistent -- execution flow unchanged, only instruction bundling differs |
| Section 9.5 cross-ref to DISC-07 | Valid -- bidirectional reference confirmed |

### Cross-Reference Validation

| Pair | Direction | Status |
|------|-----------|--------|
| VRF_Implementation_Reference <-> VRF_Migration_Lessons | 8 forward, 2 back | Valid |
| VRF_Migration_Lessons <-> Epoch_State_Machine_Spec | 4 refs to Epoch spec | Valid |
| Carnage_Fund_Spec 9.5 <-> VRF_Migration_Lessons DISC-07 | Bidirectional | Valid |
| Epoch_State_Machine_Spec -> VRF_Implementation_Reference | Not referenced | Observation (expected -- reference doc) |
| INDEX.md -> VRF documents | Not yet included | Addressed in Task 2 |

### Light Sweep of All 14 Documents

All 14 active documents scanned:
1. DrFraudsworth_Overview.md -- no stale references
2. Token_Program_Reference.md -- no stale references
3. Epoch_State_Machine_Spec.md -- no stale references
4. Tax_Pool_Logic_Spec.md -- no stale references
5. AMM_Implementation.md -- no stale references
6. New_Yield_System_Spec.md -- no stale references
7. Carnage_Fund_Spec.md -- no stale references
8. Soft_Peg_Arbitrage_Spec.md -- no stale references
9. Bonding_Curve_Spec.md -- no stale references
10. Protocol_Initialzation_and_Launch_Flow.md -- no stale references
11. Transfer_Hook_Spec.md -- no stale references
12. SolanaSetup.md -- no stale references
13. VRF_Implementation_Reference.md -- no stale references
14. VRF_Migration_Lessons.md -- no stale references

Checked for: IPA/IPB/OP4 naming (only in archived doc), "12 documents" count (none in Docs/), broken cross-references (none found).

### Result

**New gaps found: 0**
**New conflicts found: 0**

Phase 6 additions are fully consistent with the converged 12-document baseline. The Phase 5 convergence (2 clean passes on 12 documents) extends cleanly to the 14-document scope.

*Phase 7 validation completed: 2026-02-03*
