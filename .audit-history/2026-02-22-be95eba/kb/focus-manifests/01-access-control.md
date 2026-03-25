# Focus Manifest: Access Control

## Core Patterns (always load)

### Account Validation (EP-001-014)
- EP-001: Missing Signer Check (CRITICAL)
- EP-002: Missing Owner Check (CRITICAL)
- EP-003: Account Type Cosplay / Discriminator Bypass (CRITICAL)
- EP-004: PDA Seed Collision (HIGH)
- EP-005: Bump Seed Canonicalization (HIGH)
- EP-006: Unchecked Sysvar Account (HIGH)
- EP-007: Account Relationship Not Verified (CRITICAL)
- EP-008: Cross-Account Data Mismatch (HIGH)
- EP-009: Duplicate Mutable Accounts (CRITICAL)
- EP-010: Unchecked Token Mint (CRITICAL)
- EP-011: Rent Siphoning (MEDIUM)
- EP-012: Account Realloc Without Safeguards (MEDIUM)
- EP-013: Mint Authority Not Verified (HIGH)
- EP-014: ALT Account Substitution (HIGH)

### Access Control (EP-026-032)
- EP-026: Missing Authority Constraint (CRITICAL)
- EP-027: Confused Deputy / Authority Mismatch (CRITICAL)
- EP-028: Delegate Authority Misuse (HIGH)
- EP-029: Missing Freeze Check (MEDIUM)
- EP-030: Token Authority Confusion (HIGH)
- EP-031: Multi-Sig Duplicate Signer Bypass (CRITICAL)
- EP-032: PDA Authority Without Derivation Check (CRITICAL)

### Key Management (EP-068-074)
- EP-068: Single Admin Key (CRITICAL)
- EP-069: No Admin Key Rotation (HIGH)
- EP-070: Sensitive Data in Logs (HIGH)
- EP-071: Unprotected Upgrade Authority (CRITICAL)
- EP-072: No Emergency Pause (MEDIUM)
- EP-073: Excessive Admin Privileges (HIGH)
- EP-074: No Timelock on Parameter Changes (HIGH)

### Initialization (EP-075-078)
- EP-075: Double Initialization (HIGH)
- EP-076: Front-Runnable Init / Pre-Funding DoS (HIGH)
- EP-077: Incomplete Field Init (MEDIUM)
- EP-078: Pool Init Without Launch Delay (LOW)

### Gap Analysis
- EP-126: Multisig / ACL Role Escalation (CRITICAL)

## Conditional (load if detected)
- Staking attacks playbook (staking detected)
