# Dr. Fraudsworth's Finance Factory
## Token Program Reference

---

**Status:** DRAFT - pending spec alignment (Phase 5)

**Purpose:** Central authoritative reference for token program assignments across all Dr. Fraudsworth pools.

**v3 Context:** The v3 rebuild failure was caused by incorrect token program assumptions. This document ensures every spec and implementation correctly identifies which token program (SPL Token vs Token-2022) governs each token and pool side. Getting this wrong causes runtime failures, incorrect ATA derivations, and security vulnerabilities.

---

## 1. Token Program Matrix

The following matrix defines the authoritative token program assignment for every pool side in the protocol.

| Pool | Side | Token | Token Program | Program ID | Has Hook | Hook Protected |
|------|------|-------|---------------|------------|----------|----------------|
| CRIME/SOL | A | CRIME | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Yes | Yes |
| CRIME/SOL | B | WSOL | SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | No | **NO** |
| FRAUD/SOL | A | FRAUD | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Yes | Yes |
| FRAUD/SOL | B | WSOL | SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | No | **NO** |
| CRIME/PROFIT | A | CRIME | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Yes | Yes |
| CRIME/PROFIT | B | PROFIT | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Yes | Yes |
| FRAUD/PROFIT | A | FRAUD | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Yes | Yes |
| FRAUD/PROFIT | B | PROFIT | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Yes | Yes |

---

## 2. Program ID Constants

### 2.1 Token Programs

| Program | Address | Notes |
|---------|---------|-------|
| SPL Token (Original) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Used by WSOL, no extensions support |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Used by CRIME, FRAUD, PROFIT, supports transfer hooks |

### 2.2 Mint Addresses

| Token | Mint Address | Token Program Owner |
|-------|--------------|---------------------|
| WSOL (Native Mint) | `So11111111111111111111111111111111111111112` | SPL Token |
| CRIME | TBD at deployment | Token-2022 |
| FRAUD | TBD at deployment | Token-2022 |
| PROFIT | TBD at deployment | Token-2022 |

---

## 3. Critical Facts

### 3.1 WSOL Uses SPL Token Program (NOT Token-2022)

**This is the most important fact in this document.**

- The WSOL native mint (`So11111111111111111111111111111111111111112`) is owned by the original SPL Token program
- WSOL does NOT support Token-2022 extensions
- WSOL does NOT have transfer hook support
- WSOL transfers are NOT protected by the whitelist enforcement mechanism

### 3.2 No Hook Support for SPL Token

The original SPL Token program predates Token-2022 and has no extension system. This means:

- Transfer hooks cannot be attached to SPL Token mints
- The whitelist enforcement pattern used for CRIME/FRAUD/PROFIT does not apply to WSOL
- WSOL vault protection relies solely on PDA ownership and AMM access control

### 3.3 Mixed Pools Require Dual Token Programs

The CRIME/SOL and FRAUD/SOL pools are "mixed" pools containing:
- One Token-2022 token (CRIME or FRAUD) with transfer hook protection
- One SPL Token (WSOL) without hook protection

This requires:
- Passing both token program accounts to swap instructions
- Conditional transfer routing based on which token is being moved
- Using `transfer_checked` for Token-2022 side, standard `transfer` for SPL Token side

### 3.4 ATA Derivation Differs by Token Program

Associated Token Account addresses are derived using the token program ID as a seed:

```
ATA = PDA([wallet, token_program_id, mint], ASSOCIATED_TOKEN_PROGRAM)
```

**Implication:** A WSOL ATA and an CRIME ATA for the same wallet have different addresses because `token_program_id` differs.

---

## 4. Pool Type Summary

| Pool Type | Token A Program | Token B Program | Classification |
|-----------|-----------------|-----------------|----------------|
| CRIME/SOL | Token-2022 | SPL Token | Mixed |
| FRAUD/SOL | Token-2022 | SPL Token | Mixed |
| CRIME/PROFIT | Token-2022 | Token-2022 | T22/T22 |
| FRAUD/PROFIT | Token-2022 | Token-2022 | T22/T22 |

---

## 5. Transfer Hook Coverage

This section documents exactly which pool sides have transfer hook protection. Understanding hook coverage is critical for security analysis - hooks enforce the whitelist on Token-2022 tokens but have no effect on SPL Token (WSOL).

### 5.1 Hook Coverage Matrix

| Pool | Side | Token | Token Program | Has Hook | Hook Protected |
|------|------|-------|---------------|----------|----------------|
| CRIME/SOL | A | CRIME | Token-2022 | Yes | Yes |
| CRIME/SOL | B | WSOL | SPL Token | No | **NO** |
| FRAUD/SOL | A | FRAUD | Token-2022 | Yes | Yes |
| FRAUD/SOL | B | WSOL | SPL Token | No | **NO** |
| CRIME/PROFIT | A | CRIME | Token-2022 | Yes | Yes |
| CRIME/PROFIT | B | PROFIT | Token-2022 | Yes | Yes |
| FRAUD/PROFIT | A | FRAUD | Token-2022 | Yes | Yes |
| FRAUD/PROFIT | B | PROFIT | Token-2022 | Yes | Yes |

### 5.2 Per-Token Summary

| Token | Program | Hook Coverage | Notes |
|-------|---------|---------------|-------|
| CRIME | Token-2022 | Full | Whitelist enforced on all transfers |
| FRAUD | Token-2022 | Full | Whitelist enforced on all transfers |
| PROFIT | Token-2022 | Full | Whitelist enforced on all transfers |
| WSOL | SPL Token | **NONE** | No hook support in SPL Token program |

> **CRITICAL: WSOL Transfers Are Not Hook-Protected**
>
> The transfer hook whitelist enforcement does NOT apply to WSOL movements:
> - WSOL can be transferred freely between any wallets
> - Only CRIME, FRAUD, and PROFIT transfers trigger whitelist checks
> - Pool vault WSOL protection relies on AMM access control, not hooks

See Transfer_Hook_Spec.md Section 4 for whitelist details.

*Added: Transfer hook coverage matrix (Phase 2 audit - 02-02)*

---

## 6. Security Implications

### 6.1 WSOL Transfer Protection

WSOL transfers in SOL pools are protected by:
1. **AMM program authority** - Vaults are PDAs owned by the pool, requiring pool signature for withdrawals
2. **Tax Program PDA signature** - All swaps must route through Tax Program, which signs as `swap_authority`

WSOL transfers are NOT protected by:
- Transfer hooks (SPL Token has no hook support)
- Whitelist enforcement

### 6.2 Vault Whitelisting Asymmetry

The transfer hook whitelist includes all pool vaults (including WSOL vaults) for a reason:
- CRIME/FRAUD/PROFIT tokens can be transferred TO WSOL vaults (the destination is whitelisted)
- The whitelist check passes because at least one side (destination) is whitelisted

However, this does NOT mean WSOL has hook protection - WSOL transfers simply don't invoke any hook.

---

## 7. ATA Derivation Differences

Associated Token Account (ATA) derivation differs between token programs because the `token_program_id` is part of the PDA seeds. This means a WSOL ATA and an CRIME ATA for the same wallet have **DIFFERENT addresses**.

### 7.1 Derivation Formula

```
ATA PDA seeds: [wallet_address, token_program_id, mint_address]
Program: Associated Token Program (ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL)
```

The Associated Token Program is the same for both SPL Token and Token-2022, but the `token_program_id` seed differs.

### 7.2 Practical Implications

| Token | Token Program ID for Derivation | Notes |
|-------|--------------------------------|-------|
| CRIME | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Token-2022 |
| FRAUD | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Token-2022 |
| PROFIT | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Token-2022 |
| WSOL | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | SPL Token |

### 7.3 Code Example

```rust
use spl_associated_token_account::get_associated_token_address_with_program_id;

// For WSOL (SPL Token)
let wsol_ata = get_associated_token_address_with_program_id(
    &wallet,
    &NATIVE_MINT,  // So11111111111111111111111111111111111111112
    &spl_token::id(),  // SPL Token program
);

// For CRIME (Token-2022)
let crime_ata = get_associated_token_address_with_program_id(
    &wallet,
    &CRIME_MINT,
    &spl_token_2022::id(),  // Token-2022 program
);
```

### 7.4 Common Pitfall

> **Warning: ATA Address Mismatch**
>
> Using the wrong `token_program_id` in ATA derivation will derive a different (non-existent) address.
> - Always verify token program before ATA derivation
> - Use `get_associated_token_address_with_program_id`, not the simpler variant
> - The simpler `get_associated_token_address` assumes SPL Token and will fail for Token-2022 mints

**Symptom:** "Account not found" errors for ATAs that should exist.

**Root cause:** Using `spl_token::id()` when deriving for a Token-2022 mint (or vice versa).

*Added: ATA derivation differences (Phase 2 audit - 02-02)*

---

## 8. Security Threat Model

This threat model covers security implications specific to token program choices in the Dr. Fraudsworth protocol. All threats relate to the T22/SPL mixed architecture.

### 8.1 Threat Summary

| ID | Threat | Likelihood | Impact | Status |
|----|--------|------------|--------|--------|
| TM-01 | Unauthorized WSOL vault extraction | LOW | CRITICAL | Mitigated by design |
| TM-02 | Direct WSOL injection to vaults | MEDIUM | LOW | Accepted risk |
| TM-03 | Bypass whitelist via WSOL path | LOW | MEDIUM | Mitigated by design |
| TM-04 | ATA derivation confusion attack | LOW | MEDIUM | Mitigated by implementation |
| TM-05 | Mixed CPI program ID errors | MEDIUM | HIGH | Mitigated by design |
| TM-06 | Extension size parsing errors | LOW | MEDIUM | Mitigated by implementation |

### 8.2 Detailed Threat Analysis

#### TM-01: Unauthorized WSOL Vault Extraction

**Threat:** An attacker directly calls the SPL Token program to transfer WSOL out of pool vaults, bypassing the AMM.

**Likelihood:** LOW

**Impact:** CRITICAL - Loss of pool liquidity, protocol insolvency.

**Current Mitigation:**
- WSOL vaults are PDAs owned by the pool state account
- Pool state account is a PDA owned by the AMM program
- All WSOL withdrawals require AMM program CPI with pool PDA signing
- AMM swap instructions require Tax Program PDA (`swap_authority`) signature
- Direct SPL Token `transfer` calls will fail - vault has no externally-controlled authority

**Status:** Mitigated by design. Vault ownership is cryptographically enforced by PDA derivation.

---

#### TM-02: Direct WSOL Injection to Vaults

**Threat:** An attacker sends unexpected WSOL directly to vault accounts, manipulating pool reserves.

**Likelihood:** MEDIUM - Anyone can transfer WSOL to any account.

**Impact:** LOW - Benign; increases pool liquidity, benefits liquidity providers.

**Current Mitigation:**
- No active mitigation - this is economically harmless
- Attacker loses WSOL, protocol gains liquidity
- AMM uses cached reserves for math; injected WSOL doesn't affect k until next swap

**Status:** Accepted risk. No economic incentive for attacker; no harm to protocol.

---

#### TM-03: Bypass Whitelist via WSOL Path

**Threat:** User attempts to trade CRIME/FRAUD without whitelist approval by manipulating WSOL transfers.

**Likelihood:** LOW

**Impact:** MEDIUM - Could enable unauthorized trading, but still requires CRIME/FRAUD transfer which has hook.

**Current Mitigation:**
- All AMM swap instructions require Tax Program PDA signature
- Users cannot call AMM directly - only Tax Program can invoke swaps
- Even if WSOL side is unprotected, CRIME/FRAUD side still triggers transfer hook
- Transfer hook enforces whitelist on CRIME/FRAUD regardless of WSOL path

**Status:** Mitigated by design. Dual-layer protection: AMM access control + T22 hook.

---

#### TM-04: ATA Derivation Confusion Attack

**Threat:** Frontend/client derives ATA with wrong token_program_id, causing transfers to fail or go to wrong accounts.

**Likelihood:** LOW - Requires client-side implementation bug.

**Impact:** MEDIUM - Transaction failures, poor UX, funds sent to non-existent accounts (which fail atomically).

**Current Mitigation:**
- Documentation explicitly warns about this (Section 7.4)
- Client libraries must use `get_associated_token_address_with_program_id`
- Testing validates all ATA derivation paths
- Solana runtime rejects transfers to non-existent accounts (atomic failure)

**Status:** Mitigated by implementation. Documentation + testing + atomic failures.

---

#### TM-05: Mixed CPI Program ID Errors

**Threat:** Program invokes wrong token program for a given token side, causing transaction failure.

**Likelihood:** MEDIUM - Common during development of mixed-pool programs.

**Impact:** HIGH - Transaction failures, blocked swaps, potential for stuck state.

**Current Mitigation:**
- AMM accepts separate `token_program` and `token_program_b` accounts
- Conditional routing based on token side (documented in AMM_Implementation.md Section 9)
- Extensive integration tests covering all 8 pool sides
- Runtime enforces: SPL Token rejects T22 accounts, T22 rejects SPL accounts

**Status:** Mitigated by design. Separate account inputs + runtime enforcement.

---

#### TM-06: Extension Size Parsing Errors

**Threat:** Program uses `Account::unpack` (expects 165 bytes) on Token-2022 accounts that have extensions (> 165 bytes), causing deserialization failure.

**Likelihood:** LOW - Well-known issue with documented solution.

**Impact:** MEDIUM - Transaction failures, inability to read token account state.

**Current Mitigation:**
- Use `StateWithExtensions::<Account>::unpack` for all token account parsing
- This handles variable-size extension data correctly
- Code review checklist includes checking for deprecated unpacking patterns

**Status:** Mitigated by implementation. Correct API usage enforced.

---

### 8.3 Summary

All identified threats have documented mitigations. The key architectural principle is:

> **WSOL vault protection relies on AMM access control (Tax Program PDA signature), not transfer hooks.**

The mixed-program architecture is secure because:
1. **Token-2022 side** is protected by transfer hooks (whitelist enforcement)
2. **SPL Token side** is protected by PDA ownership (vault authority)
3. **Both sides** are protected by AMM access control (Tax Program signature requirement)

No threats require additional mitigation at this time.

*Added: Security threat model (Phase 2 audit - 02-02)*

---

## 9. Token-2022 Extensions

The following table documents which Token-2022 extensions are enabled for each protocol token. This is critical for auditors to understand the token capabilities and verify that no unintended extensions are active.

### 9.1 Extension Inventory

| Extension | CRIME | FRAUD | PROFIT | Rationale |
|-----------|-------|-------|--------|-----------|
| Transfer Hook | Yes | Yes | Yes | Whitelist enforcement for all transfers |
| Transfer Fees | No | No | No | Custom tax logic in Tax Program; T22 fees would double-tax |
| Permanent Delegate | No | No | No | Centralization risk; against decentralization goals |
| Non-Transferable | No | No | No | Must be tradeable in AMM pools |
| Interest-Bearing | No | No | No | Yield handled via staking, not token-level interest |
| Confidential Transfer | No | No | No | Not needed; would complicate tax calculations |
| Default Account State | No | No | No | Standard behavior (accounts start unfrozen) |
| Immutable Owner | No | No | No | Standard ATA behavior sufficient |
| Memo Required | No | No | No | Would complicate all transfers |
| CPI Guard | No | No | No | Swaps require CPI; enabling would block AMM |
| Metadata Pointer | TBD | TBD | TBD | May be used for on-chain token metadata |
| Group Pointer | No | No | No | Not applicable to protocol design |
| Group Member Pointer | No | No | No | Not applicable to protocol design |

### 9.2 Extension Rationale Details

**Transfer Hook (Enabled):** All protocol tokens use transfer hooks to enforce whitelist validation. This prevents unauthorized transfers and ensures all token movements route through whitelisted pool vaults. The hook program verifies that at least one side of every transfer is a whitelisted address. See Transfer_Hook_Spec.md for details.

**Transfer Fees (Disabled):** The protocol implements its own tax logic in the Tax Program with dynamic rates based on epoch state. Using Token-2022's built-in transfer fees would create double taxation and prevent the dynamic rate mechanism. Additionally, T22 transfer fees are immutable once set, while the protocol needs rates that change every epoch.

**Permanent Delegate (Disabled):** This extension would allow a delegate to transfer or burn tokens from any account, representing significant centralization risk. The protocol is designed to be trustless after authority burn. Enabling permanent delegate would undermine this guarantee.

**CPI Guard (Disabled):** This extension prevents CPI-initiated transfers from token accounts. Since all protocol swaps route through Tax Program -> AMM -> Token-2022 via CPI, enabling CPI Guard would break the entire swap flow.

**Interest-Bearing (Disabled):** Yield is distributed via the Staking Program using cumulative reward-per-token pattern, not via token-level interest. This gives more control over yield mechanics and avoids confusion between protocol yield and token-level interest.

### 9.3 Auditor Verification

To verify extension configuration for any protocol token:

```typescript
import { getExtensionTypes } from '@solana/spl-token';

const mintInfo = await getMint(connection, mintAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
const extensions = getExtensionTypes(mintInfo.tlvData);

// Expected: only TransferHook extension present
assert(extensions.includes(ExtensionType.TransferHook));
assert(extensions.length === 1); // Only transfer hook, no others
```

*Added: Token-2022 extension inventory (Phase 5 convergence - 05-05)*

---

## 10. Cross-References

The following specifications must align with this token program matrix:

| Document | Status | Key Sections |
|----------|--------|--------------|
| Docs/AMM_Implementation.md | Pending Phase 2 audit | Section 3 (Token Standards), Section 9 (Token Transfers) |
| Docs/Transfer_Hook_Spec.md | Pending Phase 2 audit | Section 4 (Whitelisted Addresses), Section 1 (Purpose) |
| Docs/Protocol_Initialzation_and_Launch_Flow.md | Pending Phase 2 audit | Section 8.1 (Initialize Pools) |
| Docs/Bonding_Curve_Spec.md | Pending Phase 2 audit | Token program references if any |

---

## Audit Trail

- **Created:** Phase 2 Token Program Audit (02-01) - 2026-02-01
- **Updated:** Added transfer hook coverage matrix (02-02) - 2026-02-01
- **Updated:** Added ATA derivation differences (02-02) - 2026-02-01
- **Updated:** Added security threat model (02-02) - 2026-02-01
- **Updated:** Added Token-2022 extension inventory (05-05) - 2026-02-03
