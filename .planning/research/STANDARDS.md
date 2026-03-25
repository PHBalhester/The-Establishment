# Documentation Standards for DeFi Protocol Specifications

**Domain:** DeFi/Smart Contract Documentation Standards
**Researched:** 2026-02-01
**Confidence:** HIGH (based on industry standards from DeFiSafety, EEA, OpenZeppelin, Uniswap, Compound, Aave)

---

## Executive Summary

This document establishes documentation standards for the Dr Fraudsworth protocol specifications. The standards are derived from:

1. **DeFiSafety Process Quality Review** - Industry scoring criteria for DeFi documentation
2. **EEA DeFi Risk Assessment Guidelines** - Enterprise Ethereum Alliance specification requirements
3. **Well-documented protocols** - Uniswap V4, Compound, Aave, OpenZeppelin patterns
4. **Anchor Framework conventions** - IDL generation, Rust documentation patterns
5. **Architectural Decision Records (ADR)** - Cross-document dependency tracking

**Critical lesson from v3:** The previous build failed because an architectural assumption (all pools T22/T22) was undocumented when reality required T22/SPL for WSOL pools. These standards explicitly address how to prevent such gaps.

---

## Required Sections for Every Specification Document

### 1. Header Block (Mandatory)

Every spec document MUST begin with:

```markdown
# [Component Name] Specification

| Field | Value |
|-------|-------|
| Status | Draft / Review / Approved / Implemented |
| Version | 1.0.0 |
| Last Updated | YYYY-MM-DD |
| Author(s) | [names] |
| Reviewers | [names] |
| Dependencies | [List other spec documents this depends on] |
| Dependents | [List spec documents that depend on this] |
| Program(s) | [Anchor program names this affects] |
| Accounts | [PDA/account types this defines] |
```

**Why:** The dependency fields are critical. The v3 failure occurred because the pool spec didn't explicitly declare its dependency on token program selection, and no document tracked that WSOL requires TOKEN_PROGRAM_ID.

### 2. Overview Section

```markdown
## Overview

### Purpose
[One paragraph: What problem does this component solve?]

### Scope
[What this document covers and explicitly what it does NOT cover]

### Key Invariants
[List of properties that MUST always be true]
- Invariant 1: [description]
- Invariant 2: [description]

### Security Assumptions
[What must be true for this to be secure]
```

**Why:** Invariants are the single most important section for security. Formal verification research shows that explicitly stated invariants catch bugs that code review misses. The Compound protocol uses invariants extensively (e.g., "total supply equals sum of all balances").

### 3. State Definition

For any component that manages on-chain state:

```markdown
## State

### Account Structure: [AccountName]

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| discriminator | [u8; 8] | 8 | Anchor discriminator | Auto-generated |
| authority | Pubkey | 32 | Owner who can modify | Must sign mutations |
| ... | ... | ... | ... | ... |

**Total Size:** X bytes
**PDA Seeds:** `[b"seed", authority.key().as_ref()]`
**Bump:** Stored in account

### State Transitions

```
[Initial] ---(initialize)---> [Active]
[Active] ---(action_a)---> [StateA]
[StateA] ---(action_b)---> [StateB]
[Any] ---(close)---> [Closed]
```

### State Invariants

1. `field_a + field_b == field_total` (always)
2. `state != Closed => authority != Pubkey::default()` (always)
```

**Why:** DeFiSafety requires documentation of "all developed source code" with "links to source." State machine diagrams prevent the category of bugs where operations occur in unexpected states.

### 4. Instructions/Functions

For each instruction:

```markdown
## Instructions

### instruction_name

**Purpose:** [One sentence]

**Authorization:**
- Signer: [who must sign]
- Additional checks: [e.g., must be epoch authority]

**Accounts:**

| Account | Type | Mutable | Description |
|---------|------|---------|-------------|
| authority | Signer | No | Transaction signer |
| pool | Account<Pool> | Yes | Pool to modify |
| token_program | Program | No | **CRITICAL: Must match mint owner** |

**Parameters:**

| Name | Type | Constraints | Description |
|------|------|-------------|-------------|
| amount | u64 | > 0, <= MAX_AMOUNT | Tokens to transfer |

**Preconditions:**
1. Pool must be in `Active` state
2. `amount <= pool.available_liquidity`
3. Current slot must be within valid epoch

**Postconditions:**
1. `pool.balance' = pool.balance - amount`
2. `user.balance' = user.balance + amount`
3. Event `Transfer { amount, from, to }` emitted

**Error Conditions:**

| Error Code | Condition | User Message |
|------------|-----------|--------------|
| InsufficientLiquidity | amount > available | "Requested amount exceeds available liquidity" |
| InvalidState | pool.state != Active | "Pool is not active" |
| InvalidEpoch | slot not in epoch | "Operation not allowed in current epoch" |

**Edge Cases:**
- Zero amount: Returns early with no-op (or error? DECIDE)
- Exactly MAX_AMOUNT: Succeeds, but emits warning event
- Pool has dust (<1 lamport worth): [document behavior]

**Example:**
```rust
// Happy path
let result = instruction_name(ctx, 1000)?;
assert_eq!(pool.balance, initial - 1000);

// Edge case: zero amount
let result = instruction_name(ctx, 0); // Should return Ok(()) or Err?
```
```

**Why:** This level of detail is what auditors need. OpenZeppelin's contracts documentation includes preconditions/postconditions for every function. The "Edge Cases" section specifically addresses the v3 problem - undocumented assumptions about what happens at boundaries.

### 5. Cross-Program Interactions (CPI)

```markdown
## Cross-Program Invocations

### Outbound CPIs (This Program Calls)

| Target Program | Instruction | Purpose | Error Handling |
|----------------|-------------|---------|----------------|
| Token Program | transfer | Move tokens | Propagate error |
| AMM | swap | Convert tax to SOL | Retry once, then fail |

### Inbound CPIs (Other Programs Call This)

| Caller Program | Instruction | Authorization |
|----------------|-------------|---------------|
| Bonding Curve | graduate | Must be curve authority PDA |

### CPI Security Considerations

1. **Reentrancy:** [Is this instruction reentrant-safe? How?]
2. **Authority Validation:** [How do we verify the caller?]
3. **State Consistency:** [Is state valid if CPI fails mid-execution?]
```

**Why:** The EEA DeFi Risk Guidelines emphasize that security assessment must "cover all software used, including...bridges and oracles, and third-party tools." CPIs are the Solana equivalent of external contract calls.

### 6. Token Program Specification (CRITICAL for this project)

```markdown
## Token Programs

### Token Configuration

| Token | Mint Address | Token Program | Transfer Hook? |
|-------|--------------|---------------|----------------|
| IPA | [address] | Token-2022 | Yes |
| IPB | [address] | Token-2022 | Yes |
| OP4 | [address] | Token-2022 | No |
| WSOL | So111...111 | TOKEN_PROGRAM_ID | No |

### Pool Token Program Matrix

| Pool | Token A | Token A Program | Token B | Token B Program |
|------|---------|-----------------|---------|-----------------|
| IPA/SOL | IPA | TOKEN_2022_PROGRAM_ID | WSOL | TOKEN_PROGRAM_ID |
| IPB/SOL | IPB | TOKEN_2022_PROGRAM_ID | WSOL | TOKEN_PROGRAM_ID |
| IPA/OP4 | IPA | TOKEN_2022_PROGRAM_ID | OP4 | TOKEN_2022_PROGRAM_ID |
| IPB/OP4 | IPB | TOKEN_2022_PROGRAM_ID | OP4 | TOKEN_2022_PROGRAM_ID |

### ATA Derivation Warning

**CRITICAL:** ATAs for the same mint/owner differ by token program!
- Token-2022 ATA: `get_associated_token_address_with_program_id(owner, mint, TOKEN_2022_PROGRAM_ID)`
- SPL Token ATA: `get_associated_token_address_with_program_id(owner, mint, TOKEN_PROGRAM_ID)`

Passing the wrong token program causes `MissingAccount` errors.
```

**Why:** This section exists specifically because the v3 build failed from undocumented token program assumptions. Making this explicit and MANDATORY in every pool-related spec prevents the same class of error.

### 7. Mathematical Specifications

For any component with calculations:

```markdown
## Mathematics

### Fee Calculation

**Formula:**
```
tax_amount = input_amount * tax_rate / BASIS_POINTS
lp_fee = input_amount * LP_FEE_BPS / BASIS_POINTS
output_amount = input_amount - tax_amount - lp_fee
```

**Precision:**
- All calculations use u64
- Intermediate results use u128 to prevent overflow
- Division truncates (rounds toward zero)
- Multiply before divide to preserve precision

**Constants:**
| Name | Value | Units |
|------|-------|-------|
| BASIS_POINTS | 10_000 | bps |
| MIN_TAX_BPS | 75 | bps (0.75%) |
| MAX_TAX_BPS | 1475 | bps (14.75%) |

**Overflow Analysis:**
- Maximum input: u64::MAX = 18.4e18
- Maximum intermediate: input * MAX_TAX_BPS = 18.4e18 * 1475 = 2.7e22
- u128::MAX = 3.4e38 (safe)

**Dust Handling:**
- Amounts < DUST_THRESHOLD (100 lamports) are retained in pool
- Rationale: Gas cost of distribution exceeds dust value
```

**Why:** DeFi exploits frequently target arithmetic edge cases. Compound's formal verification (by Certora) specifically checks mathematical invariants. The "Dust Handling" section prevents the class of bugs where small amounts accumulate exploitably.

### 8. Events/Logging

```markdown
## Events

### Event: SwapExecuted

**Emitted when:** A swap completes successfully

| Field | Type | Description |
|-------|------|-------------|
| pool | Pubkey | Pool address |
| user | Pubkey | Swapper address |
| input_mint | Pubkey | Token sold |
| output_mint | Pubkey | Token bought |
| input_amount | u64 | Tokens sold |
| output_amount | u64 | Tokens received |
| tax_amount | u64 | Tax collected |
| timestamp | i64 | Unix timestamp |

**Indexing:** Pool, User, input_mint, output_mint should be indexed for queries.

**Off-chain Consumption:**
- Subgraph: Tracks TVL, volume
- UI: Shows transaction history
- Analytics: Calculates metrics
```

**Why:** DeFiSafety scores protocols on event documentation. Aave and Uniswap provide comprehensive event specifications enabling rich off-chain integrations.

### 9. Error Definitions

```markdown
## Errors

### Error Codes

| Code | Name | Message | Cause | Resolution |
|------|------|---------|-------|------------|
| 6000 | InsufficientLiquidity | "Insufficient pool liquidity" | Requested amount > available | Reduce amount or wait |
| 6001 | InvalidEpoch | "Invalid epoch for operation" | Operation attempted outside valid window | Wait for next epoch |
| 6002 | Unauthorized | "Unauthorized" | Signer != required authority | Use correct wallet |

### Error Hierarchy

```
AnchorError
├── InstructionError (Solana runtime)
├── ProgramError (Anchor-generated)
│   ├── AccountErrors (6000-6099)
│   ├── MathErrors (6100-6199)
│   ├── StateErrors (6200-6299)
│   └── AuthErrors (6300-6399)
```

### Client-Side Error Handling

```typescript
try {
  await program.methods.swap(amount).rpc();
} catch (e) {
  if (e.code === 6000) {
    // Show "Insufficient liquidity" to user
  }
}
```
```

**Why:** The EEA Guidelines note that "error messages from smart contracts are not standardized and are frequently human-unreadable." Explicit error documentation improves debugging and user experience.

### 10. Security Considerations

```markdown
## Security

### Threat Model

| Threat | Likelihood | Impact | Mitigation |
|--------|------------|--------|------------|
| Price manipulation | Medium | High | Use TWAP, check slippage |
| Front-running | High | Medium | Slippage protection, private mempools |
| Flash loan attack | Low | Critical | Require multi-block settlement |

### Access Control Matrix

| Role | Can Initialize | Can Update | Can Pause | Can Upgrade |
|------|---------------|------------|-----------|-------------|
| Admin | Yes | Yes | Yes | Yes |
| Operator | No | Limited | Yes | No |
| User | No | No | No | No |

### Known Limitations

1. **Not reentrant-safe for X:** [explain]
2. **Depends on oracle freshness:** [explain threshold]
3. **Admin can rug:** [document trust assumptions]

### Audit Status

| Audit Firm | Date | Scope | Critical Issues | Status |
|------------|------|-------|-----------------|--------|
| [TBD] | [TBD] | Full protocol | [TBD] | Pending |
```

**Why:** DeFiSafety requires "security assessment covers all software." The EEA requires disclosure of "all security breaches and exploits." Being explicit about known limitations builds trust and helps auditors focus.

---

## Cross-Document Dependency Tracking

### Dependency Declaration Format

Every spec document must declare dependencies using this format:

```markdown
## Document Dependencies

### This Document Depends On:

| Document | Dependency Type | What We Need |
|----------|-----------------|--------------|
| TOKEN_SPEC.md | Data | Mint addresses, token programs |
| EPOCH_SPEC.md | Behavior | Epoch boundaries, state transitions |
| AMM_SPEC.md | Interface | Swap instruction signature |

### Documents That Depend On This:

| Document | What They Need | Breaking Changes Require |
|----------|----------------|-------------------------|
| YIELD_SPEC.md | Distribution amounts | Review of yield calculations |
| UI_SPEC.md | Event structure | Frontend update |
```

### Dependency Graph (Maintained in INDEX.md)

A central `INDEX.md` file must maintain the full dependency graph:

```markdown
# Specification Index

## Dependency Graph

```
TOKENS_SPEC.md
├── POOL_SPEC.md (depends on token programs)
│   ├── SWAP_SPEC.md (depends on pool structure)
│   └── LP_SPEC.md (depends on pool structure)
├── TAX_SPEC.md (depends on token hooks)
│   └── DISTRIBUTION_SPEC.md (depends on tax amounts)
└── CARNAGE_SPEC.md (depends on token burns)

EPOCH_SPEC.md
├── TAX_SPEC.md (depends on epoch state)
├── YIELD_SPEC.md (depends on epoch boundaries)
└── CARNAGE_SPEC.md (depends on epoch timing)

VRF_SPEC.md
├── TAX_SPEC.md (uses bytes 0-3)
└── CARNAGE_SPEC.md (uses bytes 4-6)
```

## Change Impact Analysis

When modifying any spec, check:
1. All dependent documents listed in INDEX.md
2. Search for references to modified sections
3. Update version numbers in all affected docs
```

**Why:** The ADR methodology emphasizes tracking decisions across documents. The v3 failure was a dependency tracking failure - the pool spec didn't know it depended on token program selection logic.

---

## Edge Case Documentation Standard

### Edge Case Checklist

Every instruction/function spec must address these categories:

#### Numeric Edge Cases
- [ ] Zero value inputs
- [ ] Maximum value inputs (u64::MAX)
- [ ] Near-maximum (u64::MAX - 1)
- [ ] Amounts that cause overflow in intermediate calculations
- [ ] Dust amounts (< minimum meaningful unit)
- [ ] Amounts equal to exact thresholds

#### State Edge Cases
- [ ] First ever operation (empty state)
- [ ] Last operation before state transition
- [ ] Concurrent operations (race conditions)
- [ ] Operations during state transitions
- [ ] Re-initialization attempts

#### Time/Epoch Edge Cases
- [ ] Operation at exact epoch boundary
- [ ] Operation one slot before boundary
- [ ] Operation one slot after boundary
- [ ] Skipped epochs (no activity)
- [ ] Clock drift or manipulation

#### Account Edge Cases
- [ ] Account doesn't exist
- [ ] Account exists but wrong owner
- [ ] Account exists but wrong program
- [ ] Account has zero balance
- [ ] Account at rent-exempt minimum

### Edge Case Documentation Format

```markdown
### Edge Case: [Name]

**Scenario:** [What happens]
**Expected Behavior:** [What should occur]
**Why:** [Rationale for this behavior]
**Test Case:** [Reference to test that validates this]
```

---

## Implementation Detail Level

### What Must Be Documented (Minimum for Implementation)

1. **Every public instruction** with full signature
2. **Every account structure** with exact byte layout
3. **Every PDA derivation** with exact seeds
4. **Every CPI call** with target and data format
5. **Every error code** with number and message
6. **Every event** with fields and types
7. **Every constant** with value and units
8. **Every calculation** with formula and precision

### What Should Be Documented (For Auditability)

1. **Rationale** for design decisions
2. **Alternatives considered** and why rejected
3. **Known limitations** and trust assumptions
4. **Upgrade paths** and migration procedures
5. **Testing strategy** and coverage requirements

### What May Be Omitted

1. Implementation details that don't affect interface
2. Optimization techniques (document separately if novel)
3. Exact code structure (Anchor conventions sufficient)

---

## Actionable Checklist for Auditing Existing Docs

Use this checklist to evaluate each specification document:

### Header and Metadata
- [ ] Has version number
- [ ] Has status (Draft/Review/Approved)
- [ ] Has last updated date
- [ ] Lists dependencies explicitly
- [ ] Lists dependents explicitly

### Technical Completeness
- [ ] All account structures fully specified with byte sizes
- [ ] All PDA seeds documented
- [ ] All instructions have preconditions/postconditions
- [ ] All instructions have error conditions
- [ ] All calculations have formulas with precision rules

### Security Coverage
- [ ] Threat model documented
- [ ] Access control matrix present
- [ ] Known limitations explicitly stated
- [ ] Reentrancy safety addressed
- [ ] Authority validation documented

### Edge Cases
- [ ] Zero/max values addressed
- [ ] Epoch boundary behavior specified
- [ ] First/last operation behavior specified
- [ ] Error recovery documented

### Token Programs (Dr Fraudsworth Specific)
- [ ] Token program for each mint explicitly stated
- [ ] Pool token program combinations documented
- [ ] ATA derivation warnings included
- [ ] Transfer hook behavior documented

### Cross-Document Consistency
- [ ] Constants match across all docs
- [ ] Account names consistent
- [ ] Error codes don't conflict
- [ ] Event names don't conflict

### Implementation Readiness
- [ ] Sufficient detail to implement without guessing
- [ ] Examples provided for complex operations
- [ ] Test cases referenced or included

---

## Sources

### Industry Standards
- [DeFiSafety Process Quality Review 0.9](https://defisafety.com/documentation-09) - Scoring criteria for DeFi documentation
- [EEA DeFi Risk Assessment Guidelines v1](https://entethalliance.org/specs/defi-risks/) - Enterprise documentation requirements
- [EthTrust Security Levels Specification](https://entethalliance.org/specs/ethtrust-sl/) - Security documentation standards

### Protocol Documentation Examples
- [Uniswap V4 Documentation](https://docs.uniswap.org/contracts/v4/overview) - Singleton design, hooks architecture
- [Compound III Documentation](https://docs.compound.finance/) - Formal verification approach
- [Aave V3 Smart Contracts](https://aave.com/docs/aave-v3/smart-contracts) - Contract categorization, view contracts

### Technical References
- [Solidity NatSpec Format](https://docs.soliditylang.org/en/latest/natspec-format.html) - Smart contract documentation standard
- [Anchor IDL Specification](https://www.anchor-lang.com/docs/basics/idl) - Program interface documentation
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/5.x) - Code quality and documentation patterns

### Architectural Documentation
- [Architectural Decision Records](https://adr.github.io/) - Decision tracking methodology
- [Google Cloud ADR Overview](https://docs.cloud.google.com/architecture/architecture-decision-records) - Dependency tracking
- [Microsoft ADR Guidance](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record) - Lifecycle management

### Formal Methods
- [Ethereum Formal Verification](https://ethereum.org/developers/docs/smart-contracts/formal-verification/) - Invariant specification
- [Certora Compound Verification](https://compound.finance/documents/Certora.pdf) - Formal verification example

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| Required Sections | HIGH | Based on DeFiSafety, EEA, and major protocol patterns |
| Edge Case Standards | HIGH | OWASP SCWE-083, Uniswap error docs confirm approach |
| Dependency Tracking | HIGH | ADR methodology is well-established |
| Token Program Section | HIGH | Direct response to v3 failure analysis |
| Implementation Detail Level | MEDIUM | Varies by team preference, these are minimum thresholds |

---

## Application to Dr Fraudsworth

### Immediate Actions

1. **Create INDEX.md** - Central dependency graph for all 11+ spec documents
2. **Add Header Blocks** - Every spec needs version, dependencies, dependents
3. **Token Program Matrix** - Must appear in every pool-related spec
4. **Edge Case Sections** - Add to every instruction specification
5. **Cross-Reference Check** - Verify constants match across all documents

### v3 Failure Prevention

The specific failure (undocumented T22/SPL requirement for WSOL pools) would have been caught by:

1. **TOKENS_SPEC.md** requiring explicit token program per mint
2. **POOL_SPEC.md** dependency declaration on TOKENS_SPEC.md
3. **INDEX.md** showing pool specs depend on token specs
4. **Edge Case section** asking "what happens with different token programs?"
5. **Checklist item** "Token program for each mint explicitly stated"

These standards make it impossible to omit such architectural assumptions because the checklist explicitly demands their documentation.
