# Dr. Fraudsworth's Finance Factory
## Protocol Initialization & Launch Flow

---

## 1. Purpose

This document defines the **exact sequence of operations** required to deploy and launch the Dr. Fraudsworth protocol.

It covers:
- Program deployment order
- Account initialization sequence
- PDA calculation and verification
- Authority management and burns
- Launch procedures
- Emergency procedures
- Post-launch monitoring

**This is the deployment runbook.** Follow it exactly.

---

## 2. Overview

### 2.1 Deployment Phases

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 0: PREPARATION                                           │
│  - Build programs, calculate PDAs, prepare keys                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: PROGRAM DEPLOYMENT                                    │
│  - Deploy all 6 programs                                        │
│  - Verify deployments                                           │
│  > v1.2 Update: bonding_curve added as 7th program              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: TRANSFER HOOK SETUP                                   │
│  - Initialize authority                                         │
│  - Add all 14 whitelist entries                                 │
│  - Burn authority                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: TOKEN CREATION                                        │
│  - Create mints with transfer hooks                             │
│  - Initialize ExtraAccountMetaLists                             │
│  - Mint total supplies                                          │
│  - Burn mint authorities                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: INFRASTRUCTURE SETUP                                  │
│  - Initialize pools (empty)                                     │
│  - Initialize Carnage Fund                                      │
│  - Initialize Staking System                                    │
│  - Initialize Epoch State                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: CURVE SETUP                                           │
│  - Initialize curves                                            │
│  - Fund curves from reserve                                     │
│  - Open access (no whitelist)                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 6: VERIFICATION (24h wait)                               │
│  - Verify all state                                             │
│  - Test transactions                                            │
│  - Security review                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 7: LAUNCH                                                │
│  - Start curves                                                 │
│  - Monitor                                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 8: TRANSITION                                            │
│  - Both curves fill                                             │
│  - Execute transition                                           │
│  - Protocol is LIVE                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Timeline Estimate

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Preparation | 1-2 hours | 2 hours |
| Phase 1: Program Deployment | 30 minutes | 2.5 hours |
| Phase 2: Transfer Hook Setup | 15 minutes | 2.75 hours |
| Phase 3: Token Creation | 15 minutes | 3 hours |
| Phase 4: Infrastructure Setup | 20 minutes | 3.3 hours |
| Phase 5: Curve Setup | 15 minutes | 3.5 hours |
| Phase 6: Verification | 24 hours | 27.5 hours |
| Phase 7: Launch | Instant | 27.5 hours |
| Phase 8: Transition | When filled | Variable |

---

## 3. Prerequisites

### 3.1 Software Requirements

```bash
# Solana CLI
solana --version  # 1.17+ required

# Anchor
anchor --version  # 0.29+ required

# Node.js (for scripts)
node --version    # 18+ required
```

### 3.2 Keys Required

| Key | Purpose | Security |
|-----|---------|----------|
| Deployer | Deploy programs, initialize state | Hot wallet (temporary) |
| Multisig | Final authority holder | Squads multisig |
| Backend Authority | Whitelist management | AWS KMS / HSM | <!-- v1.2 Update: Backend Authority no longer needed for curve whitelist (removed). May still be used for Transfer Hook whitelist setup. -->

### 3.3 SOL Requirements (Mainnet Estimates)

| Purpose | Amount |
|---------|--------|
| Program deployments (6 programs) | ~15 SOL |
| Account rent (all PDAs) | ~2 SOL |
| Transaction fees | ~1 SOL |
| Buffer for retries | ~5 SOL |
| **Total deployer wallet** | **~25 SOL** |

### 3.4 Environment Configuration

```bash
# .env file
CLUSTER=mainnet-beta  # or devnet for testing
DEPLOYER_KEYPAIR=/path/to/deployer.json
MULTISIG_ADDRESS=<squads_multisig_pubkey>
BACKEND_AUTHORITY=<kms_managed_pubkey>
```

---

## 4. Phase 0: Preparation

### 4.1 Build All Programs

```bash
# Clean build
anchor clean
anchor build

# Verify build artifacts exist
ls -la target/deploy/*.so
```

Expected artifacts:
- `transfer_hook.so`
- `amm.so`
- `tax_program.so`
- `epoch_program.so`
- `staking_program.so`
- `curve_program.so`

> **v1.2 Update:** v1.2 adds `bonding_curve` as a 7th program (`bonding_curve.so`). It depends on Transfer Hook (whitelist entries for curve token vaults) and has its own PDA set (curve_state, token_vault, sol_vault, tax_escrow per token).

### 4.2 Generate Program Keypairs

```bash
# Generate deterministic keypairs for programs
# These define your program IDs

solana-keygen new -o target/deploy/transfer_hook-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/amm-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/tax_program-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/epoch_program-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/staking_program-keypair.json --no-bip39-passphrase
solana-keygen new -o target/deploy/curve_program-keypair.json --no-bip39-passphrase
```

### 4.3 Calculate All PDAs

Run the PDA calculation script **before deployment**:

```typescript
// scripts/calculate-pdas.ts

import { PublicKey } from '@solana/web3.js';

const PROGRAMS = {
  transferHook: new PublicKey('<TRANSFER_HOOK_PROGRAM_ID>'),
  amm: new PublicKey('<AMM_PROGRAM_ID>'),
  taxProgram: new PublicKey('<TAX_PROGRAM_ID>'),
  epochProgram: new PublicKey('<EPOCH_PROGRAM_ID>'),
  stakingProgram: new PublicKey('<STAKING_PROGRAM_ID>'),
  curveProgram: new PublicKey('<CURVE_PROGRAM_ID>'),
};

// Token mints (will be created as PDAs or keypairs)
const CRIME_MINT = new PublicKey('<CRIME_MINT>');
const FRAUD_MINT = new PublicKey('<FRAUD_MINT>');
const PROFIT_MINT = new PublicKey('<PROFIT_MINT>');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Calculate all PDAs
function calculatePDAs() {
  const pdas: Record<string, PublicKey> = {};
  
  // === POOL PDAs ===
  
  // CRIME/SOL Pool
  [pdas.crimeSOLPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), CRIME_MINT.toBuffer(), WSOL_MINT.toBuffer()],
    PROGRAMS.amm
  );
  [pdas.crimeSOLVaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.crimeSOLPool.toBuffer(), Buffer.from('a')],
    PROGRAMS.amm
  );
  [pdas.crimeSOLVaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.crimeSOLPool.toBuffer(), Buffer.from('b')],
    PROGRAMS.amm
  );
  
  // FRAUD/SOL Pool
  [pdas.fraudSOLPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), FRAUD_MINT.toBuffer(), WSOL_MINT.toBuffer()],
    PROGRAMS.amm
  );
  [pdas.fraudSOLVaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.fraudSOLPool.toBuffer(), Buffer.from('a')],
    PROGRAMS.amm
  );
  [pdas.fraudSOLVaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.fraudSOLPool.toBuffer(), Buffer.from('b')],
    PROGRAMS.amm
  );
  
  // CRIME/PROFIT Pool
  [pdas.crimePROFITPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), CRIME_MINT.toBuffer(), PROFIT_MINT.toBuffer()],
    PROGRAMS.amm
  );
  [pdas.crimePROFITVaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.crimePROFITPool.toBuffer(), Buffer.from('a')],
    PROGRAMS.amm
  );
  [pdas.crimePROFITVaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.crimePROFITPool.toBuffer(), Buffer.from('b')],
    PROGRAMS.amm
  );
  
  // FRAUD/PROFIT Pool
  [pdas.fraudPROFITPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), FRAUD_MINT.toBuffer(), PROFIT_MINT.toBuffer()],
    PROGRAMS.amm
  );
  [pdas.fraudPROFITVaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.fraudPROFITPool.toBuffer(), Buffer.from('a')],
    PROGRAMS.amm
  );
  [pdas.fraudPROFITVaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pdas.fraudPROFITPool.toBuffer(), Buffer.from('b')],
    PROGRAMS.amm
  );
  
  // === CARNAGE PDAs ===
  
  [pdas.carnageState] = PublicKey.findProgramAddressSync(
    [Buffer.from('carnage_fund')],
    PROGRAMS.epochProgram
  );
  [pdas.carnageCRIMEVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('carnage_crime_vault')],
    PROGRAMS.epochProgram
  );
  [pdas.carnageFRAUDVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('carnage_fraud_vault')],
    PROGRAMS.epochProgram
  );
  
  // === CURVE PDAs ===
  
  [pdas.crimeCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('curve'), CRIME_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  [pdas.crimeCurveTokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('curve_token_vault'), CRIME_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  [pdas.crimeCurveSOLVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('curve_sol_vault'), CRIME_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  
  [pdas.fraudCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('curve'), FRAUD_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  [pdas.fraudCurveTokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('curve_token_vault'), FRAUD_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  [pdas.fraudCurveSOLVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('curve_sol_vault'), FRAUD_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  
  // === RESERVE PDA ===
  
  [pdas.reserve] = PublicKey.findProgramAddressSync(
    [Buffer.from('reserve')],
    PROGRAMS.curveProgram
  );
  [pdas.reserveCRIMEVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('reserve_vault'), CRIME_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  [pdas.reserveFRAUDVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('reserve_vault'), FRAUD_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  [pdas.reservePROFITVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('reserve_vault'), PROFIT_MINT.toBuffer()],
    PROGRAMS.curveProgram
  );
  
  // === STAKING PDAs ===

  [pdas.stakePool] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool')],
    PROGRAMS.stakingProgram
  );
  [pdas.stakingEscrow] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow_vault')],
    PROGRAMS.stakingProgram
  );
  [pdas.stakeVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_vault')],
    PROGRAMS.stakingProgram
  );
  
  // === EPOCH PDA ===
  
  [pdas.epochState] = PublicKey.findProgramAddressSync(
    [Buffer.from('epoch_state')],
    PROGRAMS.epochProgram
  );
  
  // === TRANSFER HOOK PDAs ===
  
  [pdas.transferHookAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('authority')],
    PROGRAMS.transferHook
  );
  
  return pdas;
}

// Output all PDAs
const pdas = calculatePDAs();
console.log(JSON.stringify(pdas, (k, v) => v instanceof PublicKey ? v.toBase58() : v, 2));
```

### 4.4 Save PDA Manifest

Save the output to `deployment/pda-manifest.json`. This is your source of truth.

### 4.5 Verification Checkpoint

Before proceeding:
- [ ] All programs built successfully
- [ ] Program keypairs generated
- [ ] PDA manifest created
- [ ] Deployer wallet funded (25+ SOL)
- [ ] Multisig address confirmed
- [ ] Backend authority key configured (KMS)

---

## 5. Phase 1: Program Deployment

### 5.1 Deploy Order

Programs must be deployed in this order (dependencies):

```
1. Transfer Hook Program  (no dependencies)
2. AMM Program            (no dependencies)
3. Tax Program            (depends on: AMM)
4. Staking Program        (no dependencies)
5. Epoch Program          (depends on: AMM, Tax, Staking)
6. Curve Program          (depends on: AMM, Epoch)
```

> **v1.2 Update:** v1.2 adds `bonding_curve` as a 7th program. Deploy after Transfer Hook (needs whitelist entries for curve token vaults). Dependencies: Transfer Hook, existing token infrastructure.

### 5.2 Program Upgrade Authority

**Decision:** All programs deploy with **timelock upgrade authority** (48-72 hours).

**Why not burn upgrade authority immediately?**
- External dependencies (Switchboard SDK) may require updates if their account format changes
- Critical bug fixes may be needed post-launch
- Burning is irreversible — timelock provides safety with exit window for users

**Why not keep direct upgrade authority?**
- Users must trust the deployer not to rug
- No transparency on changes

**Timelock approach:**
- Upgrade authority is set to a timelock program (e.g., [Squads Timelock](https://squads.so/))
- Any program upgrade requires a 48-72 hour waiting period
- Users can monitor pending upgrades and exit if they disagree
- This is industry standard for serious DeFi protocols (Marinade, Mango, etc.)

**Implementation:**
```bash
# During initial deployment, set upgrade authority to timelock multisig
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <TIMELOCK_ADDRESS>
```

**Authority types (don't confuse these):**

| Authority Type | What it controls | When burned? |
|----------------|------------------|--------------|
| **Program upgrade authority** | Can deploy new program bytecode | Never (timelock instead) |
| **Mint authority** | Can mint new tokens | Phase 3 (after minting supply) |
| **Transfer hook authority** | Can change hook program on mint | Phase 3 (after mint creation) |
| **Whitelist authority** | Can add/remove whitelist entries | Phase 2 (after all entries added) |
| **In-program admin accounts** | Program-specific privileged functions | Varies by program |

**Verification:**
```bash
# Verify program upgrade authority is the timelock address
solana program show <PROGRAM_ID>

# Expected:
# - Upgrade Authority: <TIMELOCK_ADDRESS> (NOT deployer wallet)
```

### 5.3 Deployment Commands

```bash
# Set cluster
solana config set --url mainnet-beta

# Deploy each program
anchor deploy --program-name transfer_hook --provider.cluster mainnet
anchor deploy --program-name amm --provider.cluster mainnet
anchor deploy --program-name tax_program --provider.cluster mainnet
anchor deploy --program-name staking_program --provider.cluster mainnet
anchor deploy --program-name epoch_program --provider.cluster mainnet
anchor deploy --program-name curve_program --provider.cluster mainnet
```

### 5.4 Verify Deployments

```bash
# For each program, verify it's deployed and executable
solana program show <PROGRAM_ID>

# Expected output should show:
# - Program Id: <expected_id>
# - Owner: BPFLoaderUpgradeab1e11111111111111111111111
# - Executable: true
```

### 5.5 Record Program IDs

Update `deployment/program-ids.json`:

```json
{
  "transferHook": "<TRANSFER_HOOK_PROGRAM_ID>",
  "amm": "<AMM_PROGRAM_ID>",
  "taxProgram": "<TAX_PROGRAM_ID>",
  "stakingProgram": "<STAKING_PROGRAM_ID>",
  "epochProgram": "<EPOCH_PROGRAM_ID>",
  "curveProgram": "<CURVE_PROGRAM_ID>"
}
```

### 5.6 Verification Checkpoint

- [ ] All 6 programs deployed
- [ ] All program IDs recorded
- [ ] All programs show as executable
- [ ] All upgrade authorities set to timelock address (not deployer)
- [ ] PDA manifest regenerated with actual program IDs

---

## 6. Phase 2: Transfer Hook Setup

### 6.1 Initialize Transfer Hook Authority

```typescript
// Initialize the whitelist authority
await program.methods
  .initializeAuthority()
  .accounts({
    authority: deployer.publicKey,
    whitelistAuthority: pdas.transferHookAuthority,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();
```

### 6.2 Add Whitelist Entries

Add all 14 entries. **Order doesn't matter, but all must be added before authority burn.**

```typescript
const whitelistAddresses = [
  // Pool Vaults (8)
  { name: 'CRIME/SOL Vault A', address: pdas.crimeSOLVaultA },
  { name: 'CRIME/SOL Vault B', address: pdas.crimeSOLVaultB },
  { name: 'FRAUD/SOL Vault A', address: pdas.fraudSOLVaultA },
  { name: 'FRAUD/SOL Vault B', address: pdas.fraudSOLVaultB },
  { name: 'CRIME/PROFIT Vault A', address: pdas.crimePROFITVaultA },
  { name: 'CRIME/PROFIT Vault B', address: pdas.crimePROFITVaultB },
  { name: 'FRAUD/PROFIT Vault A', address: pdas.fraudPROFITVaultA },
  { name: 'FRAUD/PROFIT Vault B', address: pdas.fraudPROFITVaultB },
  
  // Carnage Vaults (2)
  { name: 'Carnage CRIME Vault', address: pdas.carnageCRIMEVault },
  { name: 'Carnage FRAUD Vault', address: pdas.carnageFRAUDVault },
  
  // Curve PDAs (2)
  { name: 'CRIME Curve Token Vault', address: pdas.crimeCurveTokenVault },
  { name: 'FRAUD Curve Token Vault', address: pdas.fraudCurveTokenVault },
  
  // Reserve (1)
  { name: 'Reserve', address: pdas.reserve },

  // Staking (1)
  { name: 'Stake Vault', address: pdas.stakeVault },
];

// See Transfer_Hook_Spec.md Section 4 for the authoritative whitelist definition.
// This list MUST match exactly -- whitelist is immutable after authority burn.

for (const entry of whitelistAddresses) {
  console.log(`Adding whitelist entry: ${entry.name}`);
  
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), entry.address.toBuffer()],
    PROGRAMS.transferHook
  );
  
  await program.methods
    .addWhitelistEntry()
    .accounts({
      authority: deployer.publicKey,
      whitelistAuthority: pdas.transferHookAuthority,
      whitelistEntry: whitelistPda,
      addressToWhitelist: entry.address,
      systemProgram: SystemProgram.programId,
    })
    .signers([deployer])
    .rpc();
    
  console.log(`  ✓ ${entry.name} whitelisted`);
}
```

### 6.3 Verify Whitelist

```typescript
// Verify all entries exist
for (const entry of whitelistAddresses) {
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), entry.address.toBuffer()],
    PROGRAMS.transferHook
  );
  
  const account = await connection.getAccountInfo(whitelistPda);
  if (!account) {
    throw new Error(`Whitelist entry missing: ${entry.name}`);
  }
  console.log(`  ✓ ${entry.name} verified`);
}
```

### 6.4 Burn Transfer Hook Authority

**⚠️ IRREVERSIBLE ACTION ⚠️**

```typescript
// Final verification prompt
console.log('About to burn Transfer Hook authority.');
console.log('This is IRREVERSIBLE. Whitelist cannot be modified after this.');
console.log('Verify all 14 entries are correct before proceeding.');
await promptConfirmation('Type BURN to proceed: ', 'BURN');

await program.methods
  .burnAuthority()
  .accounts({
    authority: deployer.publicKey,
    whitelistAuthority: pdas.transferHookAuthority,
  })
  .signers([deployer])
  .rpc();

console.log('✓ Transfer Hook authority burned');
```

### 6.5 Verification Checkpoint

- [ ] Transfer Hook authority initialized
- [ ] All 14 whitelist entries added
- [ ] All entries verified on-chain
- [ ] Authority burned
- [ ] Verified authority is None (burned)

---

## 7. Phase 3: Token Creation

### 7.1 Create Token Mints

Each mint requires:
- Transfer Hook extension configured
- 6 decimals
- Mint authority (temporarily deployer)

```typescript
import {
  ExtensionType,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

async function createMintWithHook(
  connection: Connection,
  payer: Keypair,
  mintKeypair: Keypair,
  decimals: number,
  transferHookProgramId: PublicKey,
): Promise<void> {
  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  
  const transaction = new Transaction().add(
    // Create account
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Initialize transfer hook extension
    createInitializeTransferHookInstruction(
      mintKeypair.publicKey,
      payer.publicKey,  // Transfer hook authority (will burn later)
      transferHookProgramId,
      TOKEN_2022_PROGRAM_ID,
    ),
    // Initialize mint
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      payer.publicKey,  // Mint authority (will burn later)
      null,             // Freeze authority (none)
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  
  await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair]);
}

// Create all three mints
await createMintWithHook(connection, deployer, crimeMintKeypair, 6, PROGRAMS.transferHook);
await createMintWithHook(connection, deployer, fraudMintKeypair, 6, PROGRAMS.transferHook);
await createMintWithHook(connection, deployer, profitMintKeypair, 6, PROGRAMS.transferHook);
```

### 7.2 Initialize ExtraAccountMetaLists

Required for transfer hooks to work:

```typescript
async function initializeExtraAccountMetaList(
  mint: PublicKey,
): Promise<void> {
  const [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    PROGRAMS.transferHook
  );
  
  await transferHookProgram.methods
    .initializeExtraAccountMetaList()
    .accounts({
      mint: mint,
      extraAccountMetaList: extraAccountMetaListPda,
      authority: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([deployer])
    .rpc();
}

await initializeExtraAccountMetaList(CRIME_MINT);
await initializeExtraAccountMetaList(FRAUD_MINT);
await initializeExtraAccountMetaList(PROFIT_MINT);
```

### 7.3 Create Reserve Token Accounts

```typescript
import { createAssociatedTokenAccountIdempotent } from '@solana/spl-token';

// Reserve needs token accounts for all three tokens
const reserveCRIMEAccount = await createAssociatedTokenAccountIdempotent(
  connection,
  deployer,
  CRIME_MINT,
  pdas.reserve,  // Owner is the Reserve PDA
  {},
  TOKEN_2022_PROGRAM_ID,
);

const reserveFRAUDAccount = await createAssociatedTokenAccountIdempotent(
  connection,
  deployer,
  FRAUD_MINT,
  pdas.reserve,
  {},
  TOKEN_2022_PROGRAM_ID,
);

const reservePROFITAccount = await createAssociatedTokenAccountIdempotent(
  connection,
  deployer,
  PROFIT_MINT,
  pdas.reserve,
  {},
  TOKEN_2022_PROGRAM_ID,
);
```

### 7.4 Mint Total Supplies

```typescript
import { mintTo } from '@solana/spl-token';

const CRIME_TOTAL_SUPPLY = 1_000_000_000_000_000n;  // 1B with 6 decimals
const FRAUD_TOTAL_SUPPLY = 1_000_000_000_000_000n;  // 1B with 6 decimals
const PROFIT_TOTAL_SUPPLY = 20_000_000_000_000n;     // 20M with 6 decimals  // v1.2 Note: Corrected to 20M (20_000_000_000_000n) in v1.1

// Mint CRIME to Reserve
await mintTo(
  connection,
  deployer,
  CRIME_MINT,
  reserveCRIMEAccount,
  deployer,  // Mint authority
  CRIME_TOTAL_SUPPLY,
  [],
  {},
  TOKEN_2022_PROGRAM_ID,
);

// Mint FRAUD to Reserve
await mintTo(
  connection,
  deployer,
  FRAUD_MINT,
  reserveFRAUDAccount,
  deployer,
  FRAUD_TOTAL_SUPPLY,
  [],
  {},
  TOKEN_2022_PROGRAM_ID,
);

// Mint PROFIT to Reserve
await mintTo(
  connection,
  deployer,
  PROFIT_MINT,
  reservePROFITAccount,
  deployer,
  PROFIT_TOTAL_SUPPLY,
  [],
  {},
  TOKEN_2022_PROGRAM_ID,
);
```

### 7.5 Burn Mint Authorities

**⚠️ IRREVERSIBLE ACTION ⚠️**

```typescript
import { setAuthority, AuthorityType } from '@solana/spl-token';

console.log('About to burn mint authorities for CRIME, FRAUD, and PROFIT.');
console.log('This is IRREVERSIBLE. No more tokens can ever be minted.');
await promptConfirmation('Type BURN to proceed: ', 'BURN');

// Burn CRIME mint authority
await setAuthority(
  connection,
  deployer,
  CRIME_MINT,
  deployer,
  AuthorityType.MintTokens,
  null,  // New authority = null (burned)
  [],
  {},
  TOKEN_2022_PROGRAM_ID,
);

// Burn FRAUD mint authority
await setAuthority(
  connection,
  deployer,
  FRAUD_MINT,
  deployer,
  AuthorityType.MintTokens,
  null,
  [],
  {},
  TOKEN_2022_PROGRAM_ID,
);

// Burn PROFIT mint authority
await setAuthority(
  connection,
  deployer,
  PROFIT_MINT,
  deployer,
  AuthorityType.MintTokens,
  null,
  [],
  {},
  TOKEN_2022_PROGRAM_ID,
);

// Also burn transfer hook authorities on mints
await setAuthority(
  connection,
  deployer,
  CRIME_MINT,
  deployer,
  AuthorityType.TransferHookProgramId,
  null,
  [],
  {},
  TOKEN_2022_PROGRAM_ID,
);
// ... repeat for FRAUD and PROFIT
```

### 7.6 Verify Token State

```typescript
// Verify supplies
const crimeMint = await getMint(connection, CRIME_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
assert(crimeMint.supply === CRIME_TOTAL_SUPPLY, 'CRIME supply mismatch');
assert(crimeMint.mintAuthority === null, 'CRIME mint authority not burned');

// ... repeat for FRAUD and PROFIT

// Verify Reserve balances
const reserveCRIMEBalance = await connection.getTokenAccountBalance(reserveCRIMEAccount);
assert(reserveCRIMEBalance.value.amount === CRIME_TOTAL_SUPPLY.toString(), 'Reserve CRIME balance mismatch');

// ... repeat for FRAUD and PROFIT
```

### 7.7 Verification Checkpoint

- [ ] All 3 mints created with transfer hook extension
- [ ] ExtraAccountMetaLists initialized for all mints
- [ ] Reserve token accounts created
- [ ] Total supplies minted to Reserve
- [ ] All mint authorities burned
- [ ] All transfer hook authorities burned
- [ ] Supplies verified correct

---

## 8. Phase 4: Infrastructure Setup

### 8.1 Initialize Pools (Empty)

Pools are created but not seeded until transition.

> **Token Program Note:** SOL pools (CRIME/SOL, FRAUD/SOL) are "mixed" pools requiring two different token programs. WSOL uses the **SPL Token program** (`TOKEN_PROGRAM_ID` = `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), while CRIME/FRAUD use **Token-2022** (`TOKEN_2022_PROGRAM_ID` = `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). See `Docs/Token_Program_Reference.md` for the authoritative matrix.

```typescript
// Initialize CRIME/SOL Pool (Mixed: Token-2022 + SPL Token)
await ammProgram.methods
  .initializePool(PoolType.IpaSol)
  .accounts({
    authority: deployer.publicKey,
    pool: pdas.crimeSOLPool,
    tokenAMint: CRIME_MINT,
    tokenBMint: WSOL_MINT,
    vaultA: pdas.crimeSOLVaultA,
    vaultB: pdas.crimeSOLVaultB,
    tokenProgram: TOKEN_2022_PROGRAM_ID,   // CRIME uses Token-2022
    tokenProgramB: TOKEN_PROGRAM_ID,       // wSOL uses SPL Token (NOT Token-2022)
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();

// Repeat for FRAUD/SOL (same mixed pattern)
// For CRIME/PROFIT and FRAUD/PROFIT: both tokenProgram and tokenProgramB = TOKEN_2022_PROGRAM_ID
```

### 8.2 Initialize Carnage Fund

```typescript
await epochProgram.methods
  .initializeCarnageFund()
  .accounts({
    authority: deployer.publicKey,
    carnageState: pdas.carnageState,
    solVault: pdas.carnageSOLVault,
    crimeVault: pdas.carnageCRIMEVault,
    fraudVault: pdas.carnageFRAUDVault,
    crimeMint: CRIME_MINT,
    fraudMint: FRAUD_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();
```

### 8.3 Initialize Staking System

```typescript
await stakingProgram.methods
  .initializeStakePool()
  .accounts({
    authority: deployer.publicKey,
    stakePool: pdas.stakePool,
    escrowVault: pdas.stakingEscrow,
    stakeVault: pdas.stakeVault,
    profitMint: PROFIT_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();

// Protocol stakes MINIMUM_STAKE (1 PROFIT) to prevent first-depositor attack
// See New_Yield_System_Spec.md Section 14 for initialization sequence
```

### 8.4 Initialize Epoch State

```typescript
await epochProgram.methods
  .initializeEpochState()
  .accounts({
    authority: deployer.publicKey,
    epochState: pdas.epochState,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();
```

### 8.5 Verification Checkpoint

- [ ] All 4 pools initialized (empty)
- [ ] Carnage Fund initialized
- [ ] Staking System initialized
- [ ] Epoch State initialized
- [ ] All PDAs match expected addresses

---

## 9. Phase 5: Curve Setup

### 9.1 Initialize Reserve State

```typescript
await curveProgram.methods
  .initializeReserve()
  .accounts({
    authority: deployer.publicKey,
    reserveState: pdas.reserve,
    crimeVault: pdas.reserveCRIMEVault,
    fraudVault: pdas.reserveFRAUDVault,
    profitVault: pdas.reservePROFITVault,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();
```

### 9.2 Initialize Curves

```typescript
// Initialize CRIME Curve
await curveProgram.methods
  .initializeCurve(Token.CRIME)
  .accounts({
    authority: deployer.publicKey,
    curveState: pdas.crimeCurve,
    tokenVault: pdas.crimeCurveTokenVault,
    solVault: pdas.crimeCurveSOLVault,
    tokenMint: CRIME_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();

// Initialize FRAUD Curve
await curveProgram.methods
  .initializeCurve(Token.FRAUD)
  .accounts({
    authority: deployer.publicKey,
    curveState: pdas.fraudCurve,
    tokenVault: pdas.fraudCurveTokenVault,
    solVault: pdas.fraudCurveSOLVault,
    tokenMint: FRAUD_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();
```

### 9.3 Fund Curves from Reserve

```typescript
const CURVE_ALLOCATION = 460_000_000_000_000n;  // 460M with 6 decimals

// Fund CRIME Curve
await curveProgram.methods
  .fundCurve()
  .accounts({
    authority: deployer.publicKey,
    curveState: pdas.crimeCurve,
    tokenVault: pdas.crimeCurveTokenVault,
    reserveVault: pdas.reserveCRIMEVault,
    reserveState: pdas.reserve,
    tokenMint: CRIME_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .signers([deployer])
  .rpc();

// Fund FRAUD Curve
await curveProgram.methods
  .fundCurve()
  .accounts({
    authority: deployer.publicKey,
    curveState: pdas.fraudCurve,
    tokenVault: pdas.fraudCurveTokenVault,
    reserveVault: pdas.reserveFRAUDVault,
    reserveState: pdas.reserve,
    tokenMint: FRAUD_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .signers([deployer])
  .rpc();
```

### 9.4 Initialize Privy Whitelist Authority -- REMOVED (v1.2)

> **v1.2 Update:** This step is removed. Open access -- no Privy verification, no whitelist authority, no backend key. The 20M per-wallet token cap is the sole sybil resistance. See Bonding_Curve_Spec.md Section 2 (Design Constraints).

~~```typescript
await curveProgram.methods
  .initializeWhitelistAuthority()
  .accounts({
    authority: deployer.publicKey,
    whitelistAuthority: pdas.curveWhitelistAuthority,
    backendAuthority: BACKEND_AUTHORITY_PUBKEY,  // KMS-managed key
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();
```~~

### 9.5 Verification Checkpoint

- [ ] Reserve state initialized
- [ ] Both curves initialized
- [ ] Both curves funded (460M each)
- [ ] Reserve balances correct (540M CRIME, 540M FRAUD remaining)
> **v1.2 Update:** PROFIT supply corrected to 20M in v1.1 (was 50M). Privy whitelist authority step removed -- open access, no whitelist.
- [ ] Curves in `Initialized` status (not yet Active)

---

## 10. Phase 6: Verification (24h Wait)

### 10.1 Automated Verification Script

Run comprehensive verification:

```typescript
// scripts/verify-deployment.ts

async function verifyDeployment() {
  const results: VerificationResult[] = [];
  
  // === PROGRAM VERIFICATION ===
  
  for (const [name, programId] of Object.entries(PROGRAMS)) {
    const programInfo = await connection.getAccountInfo(programId);
    results.push({
      check: `Program ${name} deployed`,
      passed: programInfo !== null && programInfo.executable,
    });
  }
  
  // === WHITELIST VERIFICATION ===
  
  for (const entry of whitelistAddresses) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('whitelist'), entry.address.toBuffer()],
      PROGRAMS.transferHook
    );
    const account = await connection.getAccountInfo(pda);
    results.push({
      check: `Whitelist: ${entry.name}`,
      passed: account !== null,
    });
  }
  
  // === TOKEN VERIFICATION ===
  
  const crimeMint = await getMint(connection, CRIME_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
  results.push({
    check: 'CRIME supply correct',
    passed: crimeMint.supply === CRIME_TOTAL_SUPPLY,
  });
  results.push({
    check: 'CRIME mint authority burned',
    passed: crimeMint.mintAuthority === null,
  });
  
  // ... repeat for FRAUD, PROFIT
  
  // === CURVE VERIFICATION ===
  
  const crimeCurve = await curveProgram.account.curveState.fetch(pdas.crimeCurve);
  results.push({
    check: 'CRIME curve initialized',
    passed: crimeCurve.status.initialized !== undefined,
  });
  
  const crimeCurveBalance = await connection.getTokenAccountBalance(pdas.crimeCurveTokenVault);
  results.push({
    check: 'CRIME curve funded',
    passed: crimeCurveBalance.value.amount === CURVE_ALLOCATION.toString(),
  });
  
  // ... repeat for FRAUD
  
  // === RESERVE VERIFICATION ===
  
  const reserveCRIMEBalance = await connection.getTokenAccountBalance(pdas.reserveCRIMEVault);
  results.push({
    check: 'Reserve CRIME balance (540M)',
    passed: reserveCRIMEBalance.value.amount === '540000000000000',
  });
  
  // ... repeat for FRAUD, PROFIT
  
  // === OUTPUT RESULTS ===
  
  console.log('\n=== VERIFICATION RESULTS ===\n');
  
  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? '✓' : '✗';
    console.log(`${status} ${result.check}`);
    if (!result.passed) allPassed = false;
  }
  
  console.log('\n' + (allPassed ? '✓ ALL CHECKS PASSED' : '✗ SOME CHECKS FAILED'));
  
  return allPassed;
}
```

### 10.2 Manual Transfer Hook Test

Verify the hook actually blocks unauthorized transfers:

```typescript
// Create a test wallet (not whitelisted)
const testWallet = Keypair.generate();

// Fund it with some SOL for fees
await connection.requestAirdrop(testWallet.publicKey, LAMPORTS_PER_SOL);

// Try to transfer tokens between two non-whitelisted wallets
// This MUST fail

try {
  await transfer(
    connection,
    deployer,
    reserveCRIMEAccount,  // Whitelisted (Reserve)
    testWalletCRIMEAccount,  // NOT whitelisted
    pdas.reserve,  // Authority is Reserve PDA
    1000000n,  // 1 token
    [],
    {},
    TOKEN_2022_PROGRAM_ID,
  );
  
  // If we get here, the transfer succeeded - THIS IS BAD
  throw new Error('CRITICAL: Transfer hook did not block unauthorized transfer!');
} catch (error) {
  if (error.message.includes('NoWhitelistedParty')) {
    console.log('✓ Transfer hook correctly blocked unauthorized transfer');
  } else {
    throw error;
  }
}
```

### 10.3 Test Whitelist Flow

End-to-end test of the Privy whitelist:

```typescript
// 1. Create test user wallet
const testUser = Keypair.generate();

// 2. Verify purchase fails without whitelist
try {
  await curveProgram.methods
    .purchase(new BN(100_000_000))  // 0.1 SOL
    .accounts({
      user: testUser.publicKey,
      curveState: pdas.crimeCurve,
      // ... other accounts
    })
    .signers([testUser])
    .rpc();
    
  throw new Error('CRITICAL: Purchase succeeded without whitelist!');
} catch (error) {
  if (error.message.includes('NotWhitelisted')) {
    console.log('✓ Purchase correctly rejected without whitelist');
  } else {
    throw error;
  }
}

// 3. Add to whitelist (simulating backend)
await curveProgram.methods
  .addToWhitelist(Buffer.alloc(32))  // Dummy verification hash
  .accounts({
    authority: backendAuthority,
    whitelistAuthority: pdas.curveWhitelistAuthority,
    whitelistEntry: deriveWhitelistPda(testUser.publicKey),
    wallet: testUser.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([backendAuthority])
  .rpc();

// 4. Verify purchase now succeeds
// (Don't actually execute on mainnet - just verify the simulation passes)
const simulation = await curveProgram.methods
  .purchase(new BN(100_000_000))
  .accounts({
    user: testUser.publicKey,
    curveState: pdas.crimeCurve,
    // ... other accounts
  })
  .simulate();

console.log('✓ Whitelisted user can purchase (simulation passed)');
```

### 10.4 Authority Burn Threat Model

Authority burns are IRREVERSIBLE and security-critical. This threat model documents the risks and mitigations for each authority type.

#### 10.4.1 Threat Summary

| ID | Threat | Likelihood | Impact | Status |
|----|--------|------------|--------|--------|
| TM-AUTH-01 | Unburned mint authority | LOW (explicit burn step) | CRITICAL (unlimited mint) | Mitigated |
| TM-AUTH-02 | Unburned freeze authority | LOW (explicit burn step) | HIGH (freeze user accounts) | Mitigated |
| TM-AUTH-03 | Unburned transfer hook authority on mint | LOW (explicit burn step) | HIGH (modify hook behavior) | Mitigated |
| TM-AUTH-04 | Unburned whitelist authority | LOW (explicit burn step) | HIGH (add/remove whitelist) | Mitigated |

#### 10.4.2 Detailed Threat Analysis

**TM-AUTH-01: Unburned Mint Authority**

**Threat:** Mint authority retained, enabling unlimited token creation.

**Likelihood:** LOW - Section 7.5 explicitly burns mint authorities.

**Impact:** CRITICAL - Unlimited token minting destroys economic model.

**Mitigation:**
- Explicit burn step in Section 7.5 using `setAuthority(..., null)`
- Verification in Section 10.1 checks `mintAuthority === null`
- Manual verification before proceeding to Phase 7

**Status:** Mitigated by explicit burn + verification.

---

**TM-AUTH-02: Unburned Freeze Authority**

**Threat:** Freeze authority retained, enabling freezing of user token accounts.

**Likelihood:** LOW - Mints created with freeze authority = null (Section 7.1).

**Impact:** HIGH - Could freeze user funds, causing loss of trust.

**Mitigation:**
- Mints created with `freezeAuthority: null` in `createInitializeMintInstruction`
- Cannot be set after mint creation
- Verification confirms no freeze authority ever existed

**Status:** Mitigated by design (never granted).

---

**TM-AUTH-03: Unburned Transfer Hook Authority on Mint**

**Threat:** Transfer hook authority on mint retained, allowing hook program change or disable.

**Likelihood:** LOW - Section 7.5 explicitly burns transfer hook authority.

**Impact:** HIGH - Could disable whitelist enforcement, breaking protocol security model.

**Mitigation:**
- Explicit burn step in Section 7.5 for `AuthorityType.TransferHookProgramId`
- Verification required (see 10.4.3)
- Burns for CRIME, FRAUD, and PROFIT separately

**Status:** Mitigated by explicit burn + verification.

---

**TM-AUTH-04: Unburned Whitelist Authority**

**Threat:** Transfer Hook whitelist authority retained, enabling whitelist modifications.

**Likelihood:** LOW - Section 6.4 explicitly burns authority.

**Impact:** HIGH - Could add malicious addresses or remove legitimate ones.

**Mitigation:**
- Explicit burn step in Section 6.4 calling `burnAuthority()`
- Verification in Section 6.5 checkpoint
- Once burned, no whitelist modifications possible

**Status:** Mitigated by explicit burn + verification.

#### 10.4.3 Authority Burn Verification Script

Add to the verification script (Section 10.1):

```typescript
// === AUTHORITY BURN VERIFICATION ===

import { getTransferHook } from '@solana/spl-token';

// Verify transfer hook authority burned on each mint
const crimeMint = await getMint(connection, CRIME_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
const crimeHookExt = getTransferHook(crimeMint);
results.push({
  check: 'CRIME transfer hook authority burned',
  passed: crimeHookExt?.authority === null,
});

const fraudMint = await getMint(connection, FRAUD_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
const fraudHookExt = getTransferHook(fraudMint);
results.push({
  check: 'FRAUD transfer hook authority burned',
  passed: fraudHookExt?.authority === null,
});

const profitMint = await getMint(connection, PROFIT_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
const profitHookExt = getTransferHook(profitMint);
results.push({
  check: 'PROFIT transfer hook authority burned',
  passed: profitHookExt?.authority === null,
});

// Verify whitelist authority burned
const whitelistAuth = await transferHookProgram.account.whitelistAuthority.fetch(pdas.transferHookAuthority);
results.push({
  check: 'Transfer Hook whitelist authority burned',
  passed: whitelistAuth.authority === null || whitelistAuth.authority.equals(PublicKey.default),
});
```

#### 10.4.4 Verification Checkpoint

After running authority burn verification:

- [ ] All 3 mint authorities burned (CRIME, FRAUD, PROFIT)
- [ ] All 3 transfer hook authorities on mints burned
- [ ] Transfer Hook whitelist authority burned
- [ ] No freeze authority ever existed (confirmed null from creation)
- [ ] Verification script includes all authority checks
- [ ] All checks pass before proceeding to Phase 7

### 10.5 Security Review Checklist

- [ ] All authority burns verified (mint, transfer hook)
- [ ] No remaining admin keys except whitelist backend
- [ ] Whitelist backend key is in KMS (not hot wallet)
- [ ] All PDAs match manifest
- [ ] Token supplies exactly correct
- [ ] Curve allocations exactly correct
- [ ] Reserve allocations exactly correct
- [ ] Transfer hook blocks non-whitelisted transfers
- [ ] Transfer hook allows whitelisted transfers
- [ ] Pool vaults exist but are empty
- [ ] Carnage Fund initialized with empty vaults
- [ ] Staking System initialized
- [ ] Epoch State initialized with genesis values

### 10.5 Final Pre-Launch Checklist

- [ ] Verification script passes 100%
- [ ] Manual transfer hook test passes
- [ ] Whitelist flow test passes
- [ ] Security review complete
- [ ] Monitoring dashboards ready
- [ ] Announcement prepared
- [ ] Team available for launch window
- [ ] Emergency contacts confirmed

---

## 11. Phase 7: Launch

### 11.1 Pre-Launch (T-30 minutes)

```bash
# Final state verification
npx ts-node scripts/verify-deployment.ts

# Verify backend whitelist service is running
curl https://api.yoursite.com/health

# Verify monitoring is active
# Check Grafana/DataDog dashboards
```

### 11.2 Start Curves (T-0)

```typescript
// Start CRIME Curve
const crimeStartTx = await curveProgram.methods
  .startCurve()
  .accounts({
    authority: deployer.publicKey,
    curveState: pdas.crimeCurve,
    tokenVault: pdas.crimeCurveTokenVault,
  })
  .signers([deployer])
  .rpc();

console.log(`CRIME Curve started: ${crimeStartTx}`);

// Start FRAUD Curve
const fraudStartTx = await curveProgram.methods
  .startCurve()
  .accounts({
    authority: deployer.publicKey,
    curveState: pdas.fraudCurve,
    tokenVault: pdas.fraudCurveTokenVault,
  })
  .signers([deployer])
  .rpc();

console.log(`FRAUD Curve started: ${fraudStartTx}`);

// Record start slot and deadline
const clock = await connection.getSlot();
console.log(`Launch slot: ${clock}`);
console.log(`Deadline slot: ${clock + 432_000}`);
```

### 11.3 Post-Launch Announcement

After curves are confirmed active, publish announcement.

---

## 12. Phase 8: Transition

### 12.1 Monitor Curve Progress

```typescript
async function monitorCurves() {
  while (true) {
    const crimeCurve = await curveProgram.account.curveState.fetch(pdas.crimeCurve);
    const fraudCurve = await curveProgram.account.curveState.fetch(pdas.fraudCurve);
    
    const crimeProgress = (Number(crimeCurve.tokensSold) / Number(TARGET_TOKENS)) * 100;
    const fraudProgress = (Number(fraudCurve.tokensSold) / Number(TARGET_TOKENS)) * 100;
    
    console.log(`CRIME: ${crimeProgress.toFixed(2)}% | FRAUD: ${fraudProgress.toFixed(2)}%`);
    
    if (crimeCurve.status.filled && fraudCurve.status.filled) {
      console.log('Both curves filled! Ready for transition.');
      break;
    }
    
    await sleep(10000);  // Check every 10 seconds
  }
}
```

### 12.2 Execute Transition

Once both curves are filled:

```typescript
// Anyone can call this - we'll call it ourselves to ensure it happens
const transitionTx = await curveProgram.methods
  .executeTransition()
  .accounts({
    executor: deployer.publicKey,
    crimeCurve: pdas.crimeCurve,
    fraudCurve: pdas.fraudCurve,
    reserveState: pdas.reserve,
    
    // SOL Pool Seeding
    crimeSOLPool: pdas.crimeSOLPool,
    crimeSOLVaultA: pdas.crimeSOLVaultA,
    crimeSOLVaultB: pdas.crimeSOLVaultB,
    fraudSOLPool: pdas.fraudSOLPool,
    fraudSOLVaultA: pdas.fraudSOLVaultA,
    fraudSOLVaultB: pdas.fraudSOLVaultB,
    
    // PROFIT Pool Seeding
    crimePROFITPool: pdas.crimePROFITPool,
    crimePROFITVaultA: pdas.crimePROFITVaultA,
    crimePROFITVaultB: pdas.crimePROFITVaultB,
    fraudPROFITPool: pdas.fraudPROFITPool,
    fraudPROFITVaultA: pdas.fraudPROFITVaultA,
    fraudPROFITVaultB: pdas.fraudPROFITVaultB,
    
    // Reserve Vaults
    reserveCRIMEVault: pdas.reserveCRIMEVault,
    reserveFRAUDVault: pdas.reserveFRAUDVault,
    reservePROFITVault: pdas.reservePROFITVault,
    
    // Curve SOL Vaults
    crimeCurveSOLVault: pdas.crimeCurveSOLVault,
    fraudCurveSOLVault: pdas.fraudCurveSOLVault,
    
    // Programs
    ammProgram: PROGRAMS.amm,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([deployer])
  .rpc();

console.log(`Transition complete: ${transitionTx}`);
```

### 12.3 Verify Transition

```typescript
// Verify pool liquidity
const crimeSOLVaultABalance = await connection.getTokenAccountBalance(pdas.crimeSOLVaultA);
const crimeSOLVaultBBalance = await connection.getTokenAccountBalance(pdas.crimeSOLVaultB);

console.log(`CRIME/SOL Pool:`);
console.log(`  CRIME: ${crimeSOLVaultABalance.value.uiAmount}`);
console.log(`  SOL: ${crimeSOLVaultBBalance.value.uiAmount}`);

// Verify curve status
const crimeCurve = await curveProgram.account.curveState.fetch(pdas.crimeCurve);
console.log(`CRIME Curve status: ${Object.keys(crimeCurve.status)[0]}`);

// Should be: transitioned
```

### 12.4 Protocol is LIVE

After successful transition:
- All 4 pools are seeded and tradable
- Epoch system begins (taxes active)
- Yield accumulation starts
- Carnage Fund begins accumulating

**🚀 PROTOCOL IS LIVE 🚀**

---

## 13. Emergency Procedures

### 13.1 Phase-Specific Abort Points

| Phase | Abort Possible? | Recovery |
|-------|-----------------|----------|
| 0: Preparation | Yes | Just don't proceed |
| 1: Program Deploy | Yes | Redeploy programs |
| 2: Transfer Hook | **PARTIAL** | After authority burn: NO recovery |
| 3: Token Creation | **PARTIAL** | After mint authority burn: NO recovery |
| 4: Infrastructure | Yes | Reinitialize accounts |
| 5: Curve Setup | Yes | Reinitialize curves |
| 6: Verification | Yes | Fix issues, reverify |
| 7: Launch | **NO** | Curves are live, 48h deadline applies |
| 8: Transition | Yes | Retry transition if it fails |

### 13.2 Transfer Hook Authority Burned Too Early

**Problem:** Whitelist is incomplete but authority is burned.

**Recovery:** **NONE.** Must redeploy entire protocol from scratch.

**Prevention:** Triple-check whitelist entries before burn. Use verification script.

### 13.3 Mint Authority Burned with Wrong Supply

**Problem:** Minted wrong amount, authority already burned.

**Recovery:** **NONE.** Must redeploy entire protocol from scratch.

**Prevention:** Verify supplies before burn. Use verification script.

### 13.4 Curve Fails to Fill

**Problem:** 48h passes, one or both curves didn't fill.

**Recovery:**
1. Call `mark_failed()` on unfilled curve(s)
2. Both curves enter Failed status
3. Users claim refunds via `claim_refund()`
4. Protocol does not launch
5. Decide whether to retry with new parameters

### 13.5 Partner Curve Failure Handling

If one curve fills but the partner fails to fill by deadline:

| Curve | Status | Action |
|-------|--------|--------|
| Filled curve | Filled (refund eligible) | Participants claim refunds |
| Failed curve | Failed | Participants claim refunds |

**Key points:**
- No special enum state needed - refund eligibility is a function of both curve statuses
- UI should show "Transition blocked - partner curve failed" for filled curve
- Refund mechanism is identical for both curves
- Transition can never occur - protocol launch cancelled

See Bonding_Curve_Spec.md Section 5.2 "Compound States" and Section 9.3 for full details.

### 13.6 Transition Fails

**Problem:** Both curves filled but transition instruction fails.

**Recovery:**
1. Identify failure cause (logs)
2. Fix if possible (unlikely to be code issue if tested)
3. Retry `execute_transition()`
4. Transition is idempotent - safe to retry

### 13.7 Emergency Contacts

| Role | Contact | Availability |
|------|---------|--------------|
| Lead Dev | [REDACTED] | 24/7 during launch |
| Backend Lead | [REDACTED] | 24/7 during launch |
| Multisig Signers | [REDACTED] | On-call |

---

## 14. Post-Launch Monitoring

### 14.1 Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Curve fill rate | On-chain | < 1% per hour after 4h |
| Whitelist errors | Backend logs | > 10 per minute |
| Transaction failures | RPC logs | > 5% error rate |
| Pool TVL | On-chain | Unexpected change > 10% |
| Epoch transitions | On-chain events | Missing epoch |

### 14.2 Monitoring Script

```typescript
// scripts/monitor.ts

async function monitor() {
  // Curve Progress
  const crimeCurve = await curveProgram.account.curveState.fetch(pdas.crimeCurve);
  const fraudCurve = await curveProgram.account.curveState.fetch(pdas.fraudCurve);
  
  metrics.gauge('curve.crime.progress', 
    Number(crimeCurve.tokensSold) / Number(TARGET_TOKENS) * 100);
  metrics.gauge('curve.fraud.progress', 
    Number(fraudCurve.tokensSold) / Number(TARGET_TOKENS) * 100);
  metrics.gauge('curve.crime.participants', crimeCurve.participantCount);
  metrics.gauge('curve.fraud.participants', fraudCurve.participantCount);
  
  // Error Rate
  const recentTxs = await connection.getSignaturesForAddress(
    PROGRAMS.curveProgram,
    { limit: 100 }
  );
  const errorCount = recentTxs.filter(tx => tx.err !== null).length;
  metrics.gauge('curve.error_rate', errorCount / 100);
  
  // Alert if needed
  if (errorCount > 5) {
    alert('High error rate on curve program!');
  }
}

setInterval(monitor, 30000);  // Every 30 seconds
```

### 14.3 Post-Transition Monitoring

After protocol goes live:

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Epoch progression | Epoch State | Epoch stuck > 35 minutes |
| Tax collection | Events | Zero taxes for 1 hour |
| Yield accumulation | Staking Pool State | Mismatch with expected |
| Carnage triggers | Events | None for 48 hours |
| Pool reserves | On-chain | K invariant violation |

---

## 15. Appendix: Complete Transaction List

### Phase 1: Program Deployment
1. Deploy transfer_hook.so
2. Deploy amm.so
3. Deploy tax_program.so
4. Deploy staking_program.so
5. Deploy epoch_program.so
6. Deploy curve_program.so

### Phase 2: Transfer Hook Setup
7. initialize_authority
8-21. add_whitelist_entry (×14)
22. burn_authority

### Phase 3: Token Creation
23. Create CRIME mint
24. Create FRAUD mint
25. Create PROFIT mint
26. Initialize ExtraAccountMetaList (CRIME)
27. Initialize ExtraAccountMetaList (FRAUD)
28. Initialize ExtraAccountMetaList (PROFIT)
29. Create Reserve CRIME token account
30. Create Reserve FRAUD token account
31. Create Reserve PROFIT token account
32. Mint CRIME to Reserve
33. Mint FRAUD to Reserve
34. Mint PROFIT to Reserve
35. Burn CRIME mint authority
36. Burn FRAUD mint authority
37. Burn PROFIT mint authority
38. Burn CRIME transfer hook authority
39. Burn FRAUD transfer hook authority
40. Burn PROFIT transfer hook authority

### Phase 4: Infrastructure Setup
41. Initialize CRIME/SOL Pool
42. Initialize FRAUD/SOL Pool
43. Initialize CRIME/PROFIT Pool
44. Initialize FRAUD/PROFIT Pool
45. Initialize Carnage Fund
46. Initialize Staking System
47. Initialize Epoch State

### Phase 5: Curve Setup
48. Initialize Reserve State
49. Initialize CRIME Curve
50. Initialize FRAUD Curve
51. Fund CRIME Curve
52. Fund FRAUD Curve
53. Initialize Whitelist Authority

### Phase 7: Launch
54. Start CRIME Curve
55. Start FRAUD Curve

### Phase 8: Transition
56. Execute Transition

**Total: 56 transactions** (not including user purchases and whitelist additions)

> **v1.2 Update:** Transaction count will change in v1.2: whitelist authority initialization removed (#53), bonding_curve program deployment added, new curve instructions (sell, consolidate_for_refund, distribute_tax_escrow, prepare_transition, finalize_transition), and multi-TX graduation sequence replaces monolithic execute_transition (#56).

---

## 16. Appendix: Devnet Rehearsal

### 16.1 Devnet Differences

| Item | Mainnet | Devnet |
|------|---------|--------|
| SOL funding | Real SOL | Airdrop |
| Whitelist backend | KMS key | Local keypair |
| Verification wait | 24 hours | 1 hour (or skip) |
| Monitoring | Full stack | Console logs |

### 16.2 Devnet Script

```bash
#!/bin/bash
# scripts/devnet-rehearsal.sh

set -e

echo "=== DEVNET REHEARSAL ==="

# Set cluster
solana config set --url devnet

# Fund deployer
solana airdrop 10
solana airdrop 10
solana airdrop 10

# Run full deployment
npx ts-node scripts/deploy-phase-1.ts
npx ts-node scripts/deploy-phase-2.ts
npx ts-node scripts/deploy-phase-3.ts
npx ts-node scripts/deploy-phase-4.ts
npx ts-node scripts/deploy-phase-5.ts

# Verify
npx ts-node scripts/verify-deployment.ts

# Test whitelist flow
npx ts-node scripts/test-whitelist.ts

# Start curves
npx ts-node scripts/start-curves.ts

# Simulate purchases
npx ts-node scripts/simulate-purchases.ts

# Execute transition
npx ts-node scripts/execute-transition.ts

# Final verification
npx ts-node scripts/verify-post-transition.ts

echo "=== DEVNET REHEARSAL COMPLETE ==="
```

### 16.3 Localnet Testing

For faster iteration:

```bash
# Start local validator with programs
solana-test-validator \
  --bpf-program <TRANSFER_HOOK_ID> target/deploy/transfer_hook.so \
  --bpf-program <AMM_ID> target/deploy/amm.so \
  # ... etc

# Run tests
anchor test --skip-local-validator
```

---

## 17. Invariants Summary

1. **Program IDs are immutable** — Deploy once, PDAs derived forever
2. **Whitelist is immutable after burn** — Triple-check before burning
3. **Token supplies are immutable after burn** — Triple-check before burning
4. **Curves have 48h deadline** — No extensions possible
5. **Both curves must fill** — Or both fail
6. **Transition is atomic** — All pools seeded together
7. **No admin functions post-transition** — Protocol is autonomous

---

## Audit Trail

- **Updated:** T22/WSOL validation (Phase 2 audit) - Added explicit token program note for Section 8.1 pool initialization, clarified that WSOL uses SPL Token program (not Token-2022), added cross-reference to Token_Program_Reference.md
- **Updated:** Phase 5 GAP-057 resolution - Added cross-reference to Transfer_Hook_Spec.md as authoritative whitelist definition. Verified 13-entry list consistency between both documents.
- **Updated:** Whitelist corrected from 13 to 14 entries. Added Stake Vault PDA (entry #14). Updated transaction numbering in Phase 2. Cross-reference: Transfer_Hook_Spec.md Section 4, New_Yield_System_Spec.md Section 12.3
- **Updated:** Added Section 5.2 Program Upgrade Authority - Documents timelock upgrade authority policy, distinguishes program upgrade authority from other authority types (mint, whitelist, transfer hook), adds verification checkpoint item. Decision: 48-72hr timelock for all programs.