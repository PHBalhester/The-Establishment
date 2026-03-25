# DeFi Protocol Specification Coverage Checklist

**Domain:** Solana DeFi Protocol (AMM + Token-2022 + Yield System)
**Researched:** 2026-02-01
**Purpose:** Define what a complete protocol specification must cover before implementation begins

---

## Executive Summary

A DeFi protocol specification must be complete before code is written. The v3 failure (assuming all pools were Token-2022 when WSOL requires SPL Token) demonstrates that foundational assumptions must be explicitly documented and validated against Solana's runtime constraints.

This document provides a comprehensive checklist of topics every DeFi protocol specification should address, with Solana-specific considerations highlighted. Missing any category creates implementation risk.

---

## 1. Token Program Compatibility (CRITICAL for Solana)

**Why this failed v3:** The assumption "all tokens are Token-2022" was undocumented. WSOL is SPL Token, not Token-2022. Mixed pools require dual program handling.

### 1.1 Token Standard Matrix

Every specification MUST include a matrix like:

| Token | Standard | Transfer Hook | Freeze Authority | Mint Authority |
|-------|----------|---------------|------------------|----------------|
| IPA | Token-2022 | Yes | None | Burned |
| IPB | Token-2022 | Yes | None | Burned |
| OP4 | Token-2022 | Yes | None | Burned |
| WSOL | SPL Token | No | N/A | N/A |

### 1.2 Pool Token Program Requirements

For EACH pool, explicitly state:

| Pool | Token A Program | Token B Program | Mixed? |
|------|-----------------|-----------------|--------|
| IPA/SOL | Token-2022 | SPL Token | YES |
| IPB/SOL | Token-2022 | SPL Token | YES |
| IPA/OP4 | Token-2022 | Token-2022 | NO |
| IPB/OP4 | Token-2022 | Token-2022 | NO |

### 1.3 Transfer Instruction Requirements

For each token type, document which transfer instruction is required:
- SPL Token: `transfer` or `transfer_checked`
- Token-2022: `transfer_checked` (required for hooks)
- Token-2022 with hooks: Must pass `ExtraAccountMetaList` and hook program

### 1.4 Token-2022 Extension Inventory

For EACH Token-2022 mint, document which extensions are enabled:

| Extension | IPA | IPB | OP4 | Rationale |
|-----------|-----|-----|-----|-----------|
| Transfer Hook | Yes | Yes | Yes | Whitelist enforcement |
| Transfer Fees | No | No | No | Custom tax logic in Tax Program |
| Permanent Delegate | No | No | No | Centralization risk |
| Non-Transferable | No | No | No | Must be tradeable |
| Interest-Bearing | No | No | No | Yield handled separately |
| Confidential Transfer | No | No | No | Not needed |

**Why document disabled extensions:** Auditors and implementers need to know what ISN'T used to verify no unexpected interactions.

---

## 2. Account Architecture

### 2.1 Complete PDA Inventory

Every protocol needs a comprehensive PDA table:

| PDA Name | Seeds | Program | Purpose | Mutable? |
|----------|-------|---------|---------|----------|
| Pool State | ["pool", mint_a, mint_b] | AMM | Store pool configuration | Yes |
| Vault A | ["vault", pool, "a"] | AMM | Hold token A | Yes (balance) |
| Vault B | ["vault", pool, "b"] | AMM | Hold token B | Yes (balance) |
| Epoch State | ["epoch_state"] | Epoch | Global epoch configuration | Yes |
| ... | ... | ... | ... | ... |

### 2.2 Account Size Calculations

For EACH account type:
- Field-by-field breakdown
- Discriminator allocation (8 bytes for Anchor)
- Padding/alignment considerations
- Total space with formula

Example:
```
EpochState:
  - discriminator: 8 bytes
  - genesis_slot: 8 bytes (u64)
  - current_epoch: 4 bytes (u32)
  - cheap_side: 1 byte (enum)
  - ...
  - TOTAL: 69 bytes
```

### 2.3 Account Ownership

For each account type, document:
- Who creates it
- Who owns it (program)
- Who can modify it (which instructions)
- Authority lifecycle (can authority be burned?)

### 2.4 Account Rent Considerations

Document rent-exempt minimums and who pays:
- Estimated SOL for deployment
- Who funds each account creation
- Recovery strategy if rent runs out (shouldn't happen with rent-exempt)

---

## 3. Mathematical Invariants

### 3.1 Core Protocol Invariants

Every DeFi protocol has mathematical properties that must ALWAYS hold. Document them explicitly:

1. **Constant Product (per pool):** `reserve_a * reserve_b >= k_initial`
2. **Total Supply Conservation:** `sum(all_balances) == total_supply` for each token
3. **No Negative Balances:** `balance >= 0` always
4. **Tax Distribution:** `yield_share + carnage_share + protocol_share == 100%`
5. **Epoch Monotonicity:** `epoch_n+1 > epoch_n` always

### 3.2 Invariant Violation Consequences

For each invariant, document:
- What happens if violated
- How to detect violation
- Recovery procedure (if any)

### 3.3 Edge Case Boundaries

Document explicit boundaries:
- Minimum trade size (to prevent dust attacks)
- Maximum trade size (if any)
- Minimum/maximum pool reserves
- Precision limits (integer overflow points)

---

## 4. Instruction Set

### 4.1 Complete Instruction Inventory

For EACH instruction:

| Instruction | Program | Callable By | CPI Allowed | Authority Required |
|-------------|---------|-------------|-------------|-------------------|
| initialize_pool | AMM | Deployer | No | Deployer |
| swap | Tax | Anyone | No | None |
| advance_epoch | Epoch | Anyone | No | None |
| ... | ... | ... | ... | ... |

### 4.2 Instruction Account Lists

For EACH instruction, document EVERY account:
- Name
- Type (Signer, WritableSigner, Readonly, etc.)
- PDA derivation (if applicable)
- Validation constraints

### 4.3 Instruction Parameters

For EACH instruction:
- Parameter name and type
- Valid ranges
- Default values (if any)
- Serialization format (Borsh, custom)

### 4.4 Instruction Dependencies

Document which instructions must be called before others:
```
initialize_authority -> add_whitelist_entry -> burn_authority
create_mint -> initialize_extra_account_meta_list -> mint_tokens -> burn_mint_authority
```

---

## 5. Cross-Program Invocation (CPI) Patterns

### 5.1 CPI Map

Document which programs call which:

```
Tax Program --CPI--> AMM Program (swap execution)
Tax Program --CPI--> Token-2022 Program (transfers)
Epoch Program --CPI--> Switchboard VRF (randomness)
Yield Program --CPI--> System Program (SOL transfers)
```

### 5.2 CPI Authority Patterns

For each CPI relationship:
- Who signs for the CPI
- PDA signing requirements
- Seeds used for PDA signing

### 5.3 CPI Security Considerations

- Reentrancy analysis
- Privilege escalation risks
- Return value validation requirements

---

## 6. Authority & Access Control

### 6.1 Authority Inventory

| Authority | Holder | Burnability | Post-Burn State |
|-----------|--------|-------------|-----------------|
| Mint Authority (IPA) | Deployer | Required | None |
| Transfer Hook Authority (IPA) | Deployer | Required | None |
| Whitelist Authority | Deployer | Required | None |
| Epoch Admin | None | N/A | N/A |

### 6.2 Authority Lifecycle

For each authority:
1. Initial state at deployment
2. Who can change it
3. When it gets burned
4. Verification that burn occurred

### 6.3 Permissionless Operations

List ALL operations that can be called by anyone:
- Epoch advancement
- Yield claims
- Swap execution
- Carnage triggering

---

## 7. Economic Model

### 7.1 Fee Structure

Document ALL fees with precision:

| Fee Type | Rate | Applied To | Recipient |
|----------|------|------------|-----------|
| LP Fee (SOL pools) | 1.00% (100 bps) | Input amount | Pool reserves |
| LP Fee (OP4 pools) | 0.50% (50 bps) | Input amount | Pool reserves |
| Buy Tax (cheap) | 1-4% | SOL amount | Tax distribution |
| Sell Tax (expensive) | 11-14% | SOL amount | Tax distribution |

### 7.2 Tax Distribution

Document exactly where collected taxes go:

| Destination | Percentage | Timing |
|-------------|------------|--------|
| Yield System | 75% | Immediate |
| Carnage Fund | 24% | Immediate |
| Protocol | 1% | Immediate |

### 7.3 Yield Calculations

- Snapshot timing (epoch boundary)
- Eligible holders (circulating OP4 only)
- Exclusions (pool vaults, etc.)
- Claim mechanics
- Rounding behavior

### 7.4 Price Impact Analysis

Document expected price impacts for various trade sizes:
- Small trades: <1% impact
- Medium trades: 1-5% impact
- Large trades: >5% impact
- Flash loan considerations

---

## 8. State Machine Specifications

### 8.1 State Diagram

For EACH state machine (epoch, Carnage, curve):
- All possible states
- Transition triggers
- Transition guards
- State persistence

### 8.2 Timing Model

For time-based transitions:
- Slot-based vs clock-based (slot-based preferred)
- Timing constants
- Drift tolerance
- Failure modes

### 8.3 Randomness Integration

For VRF-dependent transitions:
- VRF source (Switchboard, etc.)
- Request lifecycle
- Timeout handling
- Fallback behavior

---

## 9. Error Handling

### 9.1 Error Code Inventory

For EACH program, list ALL error codes:

| Code | Name | When Thrown | User Message |
|------|------|-------------|--------------|
| 6000 | NoWhitelistedParty | Neither source nor dest in whitelist | "Transfer not allowed" |
| 6001 | ZeroAmountTransfer | Amount is 0 | "Cannot transfer zero" |
| ... | ... | ... | ... |

### 9.2 Error Recovery

For recoverable errors:
- What the user should do
- Automatic retry logic (if any)
- State rollback behavior

### 9.3 Fatal Errors

For non-recoverable errors:
- What triggers them
- Protocol state after failure
- Manual intervention required

---

## 10. Event Emissions

### 10.1 Event Inventory

For EACH event:

| Event Name | Program | Fields | When Emitted |
|------------|---------|--------|--------------|
| SwapExecuted | AMM | pool, user, amount_in, amount_out, ... | Every swap |
| EpochAdvanced | Epoch | epoch_num, new_taxes, ... | Epoch transition |
| CarnageTriggered | Epoch | target, action, amount | Carnage execution |

### 10.2 Indexer Requirements

What off-chain systems need from events:
- Required fields for yield calculations
- Fields for UI display
- Audit trail requirements

---

## 11. Security Considerations

### 11.1 Attack Vector Inventory

Document known attack vectors and mitigations:

| Attack | Vector | Mitigation | Verified? |
|--------|--------|------------|-----------|
| Sandwich | MEV | Atomic execution | No |
| Flash Loan | Price manipulation | N/A (no external oracles) | Yes |
| Reentrancy | Transfer hook | State-before-transfer | TBD |
| Sybil | Yield farming | Economic irrationality | TBD |

### 11.2 Solana-Specific Vulnerabilities

Must address:
- Missing signer checks
- Missing owner checks
- Account confusion attacks
- PDA seed manipulation
- Arithmetic overflow/underflow
- Borsh deserialization attacks
- CPI privilege escalation

### 11.3 Economic Attack Vectors

- Price manipulation feasibility
- Arbitrage profit extraction
- Tax evasion attempts
- Yield gaming strategies

### 11.4 Operational Security

- Key management (deployer, multisig)
- Monitoring requirements
- Incident response procedures

---

## 12. Testing Requirements

### 12.1 Unit Test Coverage

For EACH function:
- Happy path tests
- Error condition tests
- Boundary condition tests
- Overflow tests

### 12.2 Integration Test Scenarios

Critical paths that must be tested end-to-end:
- Full swap lifecycle (tax collection, LP fee, transfer)
- Epoch transition with VRF
- Carnage execution
- Yield claim after epoch

### 12.3 Invariant Tests

Property-based tests for each invariant:
- Fuzz testing with random inputs
- Constant product verification
- Balance conservation checks

### 12.4 Negative Tests

Explicit tests for attack scenarios:
- Unauthorized access attempts
- Invalid PDA derivations
- Wrong program IDs
- Insufficient funds

---

## 13. Deployment Specification

### 13.1 Deployment Order

Explicit ordering with dependencies:
1. Deploy Transfer Hook Program (no deps)
2. Deploy AMM Program (no deps)
3. Deploy Tax Program (depends: AMM)
4. ...

### 13.2 Initialization Sequence

Step-by-step with verification checkpoints:
1. Initialize whitelist authority
2. Add whitelist entries (verify count)
3. Burn whitelist authority (verify burned)
4. ...

### 13.3 Abort/Recovery Procedures

At each phase:
- Can we abort?
- How to recover?
- What's irreversible?

### 13.4 Post-Deployment Verification

Checklist of on-chain state to verify:
- [ ] All PDAs exist
- [ ] Authorities burned
- [ ] Supplies correct
- [ ] Pools initialized

---

## 14. Operational Documentation

### 14.1 Monitoring Requirements

Metrics to track post-launch:
- Transaction success rate
- Error frequency by type
- TVL changes
- Epoch progression

### 14.2 Alerting Thresholds

When to page on-call:
- Error rate > X%
- Epoch stuck > Y minutes
- TVL drop > Z%

### 14.3 Runbooks

Procedures for common scenarios:
- Epoch stuck: [steps]
- High error rate: [steps]
- VRF timeout: [steps]

---

## Coverage Checklist Summary

### Mandatory for All DeFi Protocols

- [ ] Token standard compatibility matrix
- [ ] Complete PDA inventory with derivations
- [ ] Mathematical invariants documented
- [ ] Complete instruction set with accounts
- [ ] CPI patterns mapped
- [ ] Authority lifecycle documented
- [ ] Fee structure with precision
- [ ] Error code inventory
- [ ] Event schema documented
- [ ] Attack vector analysis
- [ ] Deployment sequence
- [ ] Testing requirements

### Solana-Specific Requirements

- [ ] Token-2022 vs SPL Token handling for EACH token
- [ ] Mixed pool dual-program requirements
- [ ] Transfer hook ExtraAccountMetaList setup
- [ ] PDA seed documentation
- [ ] Account size calculations
- [ ] Rent-exemption considerations
- [ ] Slot-based vs clock-based timing
- [ ] CPI signer requirements
- [ ] Borsh serialization formats

### Security-Critical Documentation

- [ ] Authority burn procedures
- [ ] Signer/owner check requirements
- [ ] Reentrancy analysis
- [ ] Overflow protection strategy
- [ ] Privilege escalation analysis
- [ ] Emergency procedures

---

## Gaps That Cause Implementation Failures

Based on v3 experience and industry patterns:

### 1. Implicit Token Program Assumptions
**Failure Mode:** Assuming all tokens use the same program
**Prevention:** Explicit token standard matrix for every token

### 2. Missing Account Validation Requirements
**Failure Mode:** Forgetting to validate account ownership/PDA derivation
**Prevention:** Account validation section for every instruction

### 3. Undocumented Authority Lifecycle
**Failure Mode:** Unclear when authorities can be changed
**Prevention:** Authority inventory with explicit burn requirements

### 4. Missing Error Paths
**Failure Mode:** Unclear what happens on failure
**Prevention:** Error code inventory with recovery procedures

### 5. Timing Ambiguity
**Failure Mode:** Clock vs slot timing confusion
**Prevention:** Explicit timing model with constants

### 6. CPI Return Value Handling
**Failure Mode:** Not checking CPI return values
**Prevention:** CPI section with return validation requirements

### 7. Insufficient Invariant Testing
**Failure Mode:** Invariants violated in edge cases
**Prevention:** Invariant list with property-based test requirements

---

## Sources

- [Token-2022 Extension Guide](https://www.solana-program.com/docs/token-2022/extensions)
- [Transfer Hook Interface](https://www.solana-program.com/docs/transfer-hook-interface)
- [Securing Solana: A Developer's Guide](https://cantina.xyz/blog/securing-solana-a-developers-guide)
- [Solana Security Ecosystem Review 2025](https://solanasec25.sec3.dev/)
- [Anchor PDA Documentation](https://www.anchor-lang.com/docs/basics/pda)
- [Helius: Solana Hacks, Bugs, and Exploits History](https://www.helius.dev/blog/solana-hacks)
- [Identifying Invariants in Smart Contracts](https://docs.df3ndr.com/Book/4/8/4-identifying_invariants.html)
- [Minswap AMM V2 Specifications](https://github.com/minswap/minswap-dex-v2/blob/main/amm-v2-docs/amm-v2-specs.md)
- [GitHub: solsec - Solana Security Resources](https://github.com/sannykim/solsec)
- [Zellic Audit Reports](https://reports.zellic.io/publications/dfynrfq)
- [QAwerk DeFi Testing Checklist](https://qawerk.com/blog/defi-testing-checklist/)
