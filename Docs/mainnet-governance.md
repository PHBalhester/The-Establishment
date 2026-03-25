# Mainnet Governance Procedure

> This document describes the governance structure for Dr. Fraudsworth on Solana mainnet. Operational security details (signer identities, emergency response timelines, hotfix procedures) are maintained privately.

Step-by-step guide for setting up, operating, and eventually burning the Squads 2-of-3 multisig governance on mainnet.

## Mainnet Address Placeholders

The following values must be filled in at mainnet deploy time. They are referenced throughout this document.

| Placeholder | Source | Example |
|-------------|--------|---------|
| `VAULT_PDA` | Output of `setup-squads.ts` | `4SMcPtix...` (devnet) |
| `MULTISIG_PDA` | Output of `setup-squads.ts` | `F7axBNUg...` (devnet) |
| `PROGRAM_IDS` | `deployments/mainnet.json` programs section | 7 program IDs |

All mainnet addresses live in `deployments/mainnet.json` after setup. This file is the single source of truth.

---

## 1. Overview

### What is the Squads Multisig?

The Squads v4 multisig is a 2-of-3 timelocked governance mechanism that controls all program upgrade authorities and admin PDA authorities for Dr Fraudsworth. It replaces single-key deployer control with a multi-signature requirement, preventing any single compromised key from modifying the protocol.

### Why it exists

- **Security**: No single point of failure. An attacker must compromise 2 of 3 signing keys.
- **Trust**: Community can verify that upgrades require multi-party approval and a public timelock.
- **Safety net**: Retained upgrade authority allows patching critical bugs discovered post-launch.
- **Progressive decentralization**: Timelock increases over time, culminating in authority burn after external audit.

### Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Threshold | 2 of 3 | Allows operation if 1 key is lost; requires 2 for security |
| Initial timelock | 15 minutes (900s) | Fast response capability at launch |
| Config authority | null (autonomous) | Multisig governs itself -- no single key can change settings |
| Vault PDA index | 0 | Standard first vault |

### Key URLs

- Squads App: https://app.squads.so/
- Squads v4 Program: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (same on devnet and mainnet)

---

## 2. Signer Setup

### Signer Requirements

Three wallets across different devices/locations. At least one hardware wallet (Ledger) is recommended for maximum security.

### Ledger Signer Setup

For mainnet, at least one signer should be a Ledger hardware wallet:

1. Install the Solana app on Ledger via Ledger Live
2. Get the Ledger's public key:
   ```bash
   solana-keygen pubkey usb://ledger
   ```
3. Note: The Squads SDK does NOT natively support Ledger signing via CLI scripts. For Ledger-signed approvals, use the **Squads web UI** at https://app.squads.so/:
   - Connect Ledger wallet in the Squads app
   - Navigate to the pending proposal
   - Click "Approve" -- Ledger will prompt for confirmation

### Security Best Practices

- Never store all 3 signer keypairs on the same machine
- Back up each keypair to encrypted storage (not cloud)
- The Ledger signer should remain in secure physical storage when not actively signing
- Record each signer's public key in `deployments/mainnet.json`

---

## 3. Initial Setup Procedure

### Prerequisites

- Mainnet deployer wallet funded with sufficient SOL (10+ SOL recommended)
- All 7 programs deployed to mainnet (via `deploy-all.sh`)
- All admin PDAs initialized (via `initialize.ts`)
- 3 signer wallets ready (see Section 2)
- `.env.mainnet` configured with:
  ```bash
  CLUSTER_URL=<mainnet-rpc-url>
  WALLET=<path-to-mainnet-deployer-keypair>
  SQUADS_TIMELOCK_SECONDS=900
  COMMITMENT=confirmed
  ```

### Step-by-step

1. **Source environment:**
   ```bash
   set -a && source .env.mainnet && set +a
   ```

2. **Configure signer pubkeys** in `setup-squads.ts` (or pass as CLI args for Ledger signers). The devnet script auto-generates keypairs; mainnet should use pre-existing wallets.

3. **Run setup-squads.ts:**
   ```bash
   npx tsx scripts/deploy/setup-squads.ts
   ```

4. **Verify on Squads app:**
   - Go to https://app.squads.so/
   - Connect one of the signer wallets
   - Confirm the multisig appears with correct members, threshold (2), and timelock

5. **Confirm `deployments/mainnet.json` was updated** with `squadsVault`, `squadsMultisig`, and `squadsCreateKey` fields.

---

## 4. Authority Transfer Procedure

**WARNING: Upgrade authority transfer is ONE-WAY for program upgrade authorities. The deployer can never regain upgrade authority once transferred. Triple-check everything before executing.**

### Transfer Order

Transfer all authorities in one script run:

1. **7 upgrade authorities** (AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault, Bonding Curve)
2. **3 admin PDA authorities** (AMM AdminConfig, WhitelistAuthority, BcAdminConfig)

### Step-by-step

1. **Run transfer-authority.ts:**
   ```bash
   npx tsx scripts/deploy/transfer-authority.ts
   ```

2. **Verify EACH transfer individually:**
   ```bash
   solana program show <PROGRAM_ID> --url mainnet-beta
   # Should show: Authority: <VAULT_PDA>
   ```

3. **Run full verification:**
   ```bash
   npx tsx scripts/deploy/verify-authority.ts
   ```

### Critical Notes

- `transfer-authority.ts` is **idempotent** -- re-running skips already-transferred authorities
- BPFLoaderUpgradeable SetAuthority: new authority is the **3rd account**, NOT in instruction data
- BorshCoder IDL encoding uses **snake_case** field names (`new_admin`, `new_authority`)

---

## 5. Performing a Program Upgrade

### When to Upgrade

Only upgrade programs for:
- Critical bug fixes (security vulnerabilities, fund loss risks)
- Auditor-recommended changes
- Essential feature additions (approved by governance process)

### Step-by-step

1. **Modify code, build, and test locally**
2. **Write binary to buffer:**
   ```bash
   solana program write-buffer target/deploy/<program>.so \
     --url mainnet-beta --keypair <deployer-keypair>
   ```
3. **Set buffer authority to vault PDA**
4. **Create Squads proposal** (via script or Squads app)
5. **Approve with 2 of 3 signers**
6. **Wait for timelock** (community visibility window)
7. **Execute the upgrade**
8. **Verify upgrade** with `verify-authority.ts`

### Rollback Procedure

Follow the same upgrade flow with the original binary. This was proven on devnet with the `test-upgrade.ts` script.

---

## 6. Timelock Progression Schedule

| Stage | Timelock | Trigger |
|-------|----------|---------|
| Launch | 15 minutes | Initial deployment |
| Stable (48-72hr) | 24 hours | No critical issues after launch |
| Post-audit | Consider burn | External audit funded and completed |

Changing the timelock requires a config change proposal through Squads (must wait current timelock duration).

---

## 7. Emergency Procedures

### Lost Signer Key
- 2-of-3 still works with remaining 2 signers
- Rotate via config change proposal

### Compromised Signer Key
- Cannot unilaterally upgrade (need 2 keys)
- Timelock gives community notice of any malicious proposal
- Rotate immediately

### All Signers Compromised
- No on-chain remedy; timelock provides community awareness window
- Inherent tradeoff of retaining upgrade capability

### Protocol Bug (Hotfix Needed)
1. Identify and write the fix
2. Build and test locally
3. Follow standard upgrade procedure (Section 5)

---

## 8. Authority Burn Sequence (Post-Audit Only)

**EVERY BURN IS IRREVERSIBLE.** Only proceed after:
1. External security audit completed with clean report
2. Explicit written confirmation for EACH individual authority burn
3. Documented reason why that specific authority is no longer needed

### Burn Order

| Step | Authority | What It Disables |
|------|-----------|------------------|
| 1 | WhitelistAuthority | No new addresses can be whitelisted |
| 2 | AMM AdminConfig | No new pools can be initialized |
| 3 | BcAdminConfig | No new bonding curves can be created |
| 4-6 | 3 Metadata Update Authorities | Token metadata becomes immutable |
| 7-13 | 7 Upgrade Authorities | Programs become immutable forever |

---

## 9. Verification Commands

```bash
# Full authority verification
npx tsx scripts/deploy/verify-authority.ts

# Individual program check
solana program show <PROGRAM_ID> --url mainnet-beta
```

### Related Scripts

| Script | Purpose |
|--------|---------|
| `scripts/deploy/setup-squads.ts` | Create 2-of-3 multisig with timelock |
| `scripts/deploy/transfer-authority.ts` | Transfer all 10 authorities to vault PDA |
| `scripts/deploy/verify-authority.ts` | Verify all 11 authority checks |
| `scripts/deploy/test-upgrade.ts` | Prove timelocked upgrade round-trip |

---

*Document: Docs/mainnet-governance.md*
*Phase: 97-squads-governance*
*Last updated: 2026-03-25*
