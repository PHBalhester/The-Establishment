# Phase 97: Squads Governance - Research

**Researched:** 2026-03-15
**Domain:** Squads Protocol v4 multisig, Solana program authority management, admin PDA transfer
**Confidence:** MEDIUM (SDK docs verified; admin PDA gap is HIGH confidence finding)

## Summary

This phase requires creating a 2-of-3 Squads v4 multisig with configurable timelock, transferring all 7 program upgrade authorities and 3 admin PDA authorities to the Squads vault PDA, then proving a full timelocked upgrade round-trip on devnet.

The Squads v4 SDK (`@sqds/multisig` v2.1.3+) provides TypeScript methods for multisig creation, vault transaction proposals, approval, and execution. The program upgrade authority transfer uses the Solana CLI `solana program set-upgrade-authority` with `--skip-new-upgrade-authority-signer-check` (required because the Squads vault is a PDA that cannot sign). For program upgrades through the multisig, you write the new binary to a buffer, set the buffer authority to the vault PDA, then create a vault transaction containing the BPFLoaderUpgradeable upgrade instruction.

**CRITICAL FINDING:** The 3 admin PDAs (AMM AdminConfig, Transfer Hook WhitelistAuthority, BcAdminConfig) have NO transfer authority instructions. They only have `initialize_*` and `burn_*`. New `transfer_admin` / `transfer_authority` instructions MUST be added to all 3 programs before admin PDA authority can be transferred to Squads. This requires a code change, rebuild, and redeploy.

**Primary recommendation:** Add transfer authority instructions to AMM, Transfer Hook, and Bonding Curve programs first, then proceed with Squads setup and authority transfer.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@sqds/multisig` | ^2.1.3 | Squads v4 TypeScript SDK | Official SDK from Squads Protocol; 3x audited (Trail of Bits, OtterSec, Neodyme), formally verified |
| `@solana/web3.js` | ^1.73.0 | Solana connection, transactions, keypairs | Peer dependency of @sqds/multisig, already in project |
| `@coral-xyz/anchor` | (existing) | Program interaction for admin PDA transfers | Already in project; needed for calling transfer_admin instructions via IDL |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Solana CLI `solana program` | v3.0.x (Agave) | Upgrade authority transfer, buffer management | CLI commands for set-upgrade-authority and write-buffer |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @sqds/multisig SDK | Squads web UI | UI is fine for one-off, but scripts must be repeatable per GOV-05/GOV-06 |
| @sqds/multisig | @squads-protocol/multisig | Appears to be an alternate npm scope; @sqds/multisig is the canonical package per official docs |

**Installation:**
```bash
npm install @sqds/multisig
```

## Architecture Patterns

### Recommended Script Structure
```
scripts/deploy/
  setup-squads.ts          # GOV-01, GOV-05: Create multisig + fund signers
  transfer-authority.ts    # GOV-02, GOV-03, GOV-06: Transfer all 10 authorities
  verify-authority.ts      # GOV-07: Verify all authorities held by vault
  test-upgrade.ts          # GOV-04: Prove timelocked upgrade round-trip
keypairs/
  squads-signer-1.json     # Auto-generated devnet signer
  squads-signer-2.json
  squads-signer-3.json
Docs/
  mainnet-governance.md    # GOV-08: Step-by-step mainnet procedure
```

### Pattern 1: Squads Multisig Creation
**What:** Create a 2-of-3 multisig with timelock using multisigCreateV2
**When to use:** One-time setup per cluster (devnet, mainnet)
```typescript
// Source: https://docs.squads.so/main/development/typescript/instructions/create-multisig
import * as multisig from "@sqds/multisig";
const { Permission, Permissions } = multisig.types;

const createKey = Keypair.generate();
const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

// Fetch program config for treasury (required by SDK)
const programConfigPda = multisig.getProgramConfigPda({})[0];
const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
  connection, programConfigPda
);

const sig = await multisig.rpc.multisigCreateV2({
  connection,
  createKey,        // Must be a Keypair (signer)
  creator,          // Keypair paying for account creation
  multisigPda,
  configAuthority: null,  // Autonomous: multisig governs itself
  timeLock: Number(process.env.SQUADS_TIMELOCK_SECONDS) || 300,
  members: [
    { key: signer1.publicKey, permissions: Permissions.all() },
    { key: signer2.publicKey, permissions: Permissions.all() },
    { key: signer3.publicKey, permissions: Permissions.all() },
  ],
  threshold: 2,
  treasury: programConfig.treasury,
  rentCollector: null,
  sendOptions: { skipPreflight: true },
});
```

### Pattern 2: Program Upgrade Authority Transfer
**What:** Transfer BPFLoaderUpgradeable upgrade authority to Squads vault PDA
**When to use:** For each of 7 programs, after multisig is created
```bash
# --skip-new-upgrade-authority-signer-check is REQUIRED because vault PDA cannot sign
# Source: https://solana.com/docs/programs/deploying
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <VAULT_PDA_ADDRESS> \
  --skip-new-upgrade-authority-signer-check \
  --keypair keypairs/devnet-wallet.json \
  --url devnet
```
**TypeScript equivalent** (for scripting):
```typescript
// BPFLoaderUpgradeable SetAuthority instruction
import { BpfLoader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "@solana/web3.js";
// Or construct the instruction manually:
// Instruction index 4 = SetAuthority for BPFLoaderUpgradeable
// Accounts: [programData (writable), currentAuthority (signer), newAuthority (optional)]
```

### Pattern 3: Vault Transaction for Program Upgrade
**What:** Create a proposal to upgrade a program through the multisig
**When to use:** For proving the timelocked upgrade round-trip (GOV-04)
```typescript
// Step 1: Deploy new binary to buffer
// solana program write-buffer target/deploy/conversion_vault.so --url devnet

// Step 2: Set buffer authority to vault PDA
// solana program set-buffer-authority <BUFFER_ADDRESS> --new-buffer-authority <VAULT_PDA>

// Step 3: Create vault transaction with BPFLoaderUpgradeable::Upgrade instruction
const upgradeIx = /* BPFLoaderUpgradeable upgrade instruction */;
const txMessage = new TransactionMessage({
  payerKey: vaultPda,
  recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
  instructions: [upgradeIx],
});

const txIndex = /* next transaction index from multisig account */;
await multisig.rpc.vaultTransactionCreate({
  connection,
  feePayer: signer1,
  multisigPda,
  transactionIndex: txIndex,
  creator: signer1.publicKey,
  vaultIndex: 0,
  ephemeralSigners: 0,
  transactionMessage: txMessage,
  memo: "Upgrade Conversion Vault - test",
});

// Step 4: Create proposal
await multisig.rpc.proposalCreate({
  connection,
  feePayer: signer1,
  multisigPda,
  transactionIndex: txIndex,
  creator: signer1,
});

// Step 5: Approve with 2 of 3 signers
await multisig.rpc.proposalApprove({
  connection, feePayer: signer1, multisigPda,
  transactionIndex: BigInt(txIndex), member: signer1,
});
await multisig.rpc.proposalApprove({
  connection, feePayer: signer2, multisigPda,
  transactionIndex: BigInt(txIndex), member: signer2,
});

// Step 6: Wait for timelock
// Poll multisig account for proposal status; once Approved, wait timeLock seconds

// Step 7: Execute
await multisig.rpc.vaultTransactionExecute({
  connection,
  feePayer: signer1,
  multisigPda,
  transactionIndex: BigInt(txIndex),
  member: signer1.publicKey,
  signers: [signer1],
  sendOptions: { skipPreflight: true },
});
```

### Pattern 4: Admin PDA Authority Transfer (requires new instructions)
**What:** Transfer admin authority stored in program PDAs to Squads vault
**When to use:** After adding transfer_admin instructions to AMM, Hook, BC programs
```typescript
// AMM: transfer_admin(new_admin: Pubkey)
await programs.amm.methods
  .transferAdmin(vaultPda)
  .accounts({ admin: deployer.publicKey, adminConfig: adminConfigPda })
  .signers([deployer])
  .rpc();

// Transfer Hook: transfer_authority(new_authority: Pubkey)
await programs.transferHook.methods
  .transferAuthority(vaultPda)
  .accounts({ authority: deployer.publicKey, whitelistAuthority: whitelistPda })
  .signers([deployer])
  .rpc();

// Bonding Curve: transfer_bc_admin(new_authority: Pubkey)
await programs.bondingCurve.methods
  .transferBcAdmin(vaultPda)
  .accounts({ authority: deployer.publicKey, adminConfig: bcAdminPda })
  .signers([deployer])
  .rpc();
```

### Anti-Patterns to Avoid
- **Using multisig PDA instead of vault PDA for authority**: The vault PDA (derived with index 0) is what actually holds authority and signs transactions. The multisig PDA is the config account, NOT the signer.
- **Forgetting --skip-new-upgrade-authority-signer-check**: Without this flag, `set-upgrade-authority` requires the new authority to sign, which a PDA cannot do. The command will fail silently or error.
- **Setting configAuthority to a keypair**: Per CONTEXT.md, config authority should be null (autonomous). Setting it to a keypair would allow single-signer governance changes, defeating the purpose.
- **Transferring authority before testing**: Always create the multisig AND prove the upgrade flow BEFORE transferring real program authorities. Test with a single guinea pig first.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multisig creation | Custom multisig program | `@sqds/multisig` SDK | Squads is triple-audited, formally verified, Solana standard |
| PDA derivation | Manual seed+bump calculation | `multisig.getVaultPda()`, `multisig.getMultisigPda()` | SDK handles seeds/bumps correctly, prevents derivation bugs |
| Timelock enforcement | Custom delay mechanism | Squads built-in `timeLock` field | Enforced at program level, cannot be bypassed |
| BPFLoader upgrade instruction | Manual instruction data packing | Solana CLI `solana program write-buffer` + `set-buffer-authority` | CLI handles buffer creation, authority setting, and upgrade atomically |

**Key insight:** Squads v4 is the de facto standard for multisig governance on Solana, securing $10B+ in assets. Using the SDK is non-negotiable -- the alternative is a custom program with zero audits.

## Common Pitfalls

### Pitfall 1: Vault PDA vs Multisig PDA Confusion
**What goes wrong:** Authority is transferred to the multisig PDA instead of the vault PDA
**Why it happens:** Both are derived from the createKey, easy to confuse
**How to avoid:** Always derive vault PDA explicitly: `multisig.getVaultPda({ multisigPda, index: 0 })`. Verify the vault PDA address after derivation. Log both addresses in setup-squads.ts.
**Warning signs:** Authority transfer succeeds but upgrade proposals fail with "authority mismatch"

### Pitfall 2: Missing Admin PDA Transfer Instructions
**What goes wrong:** Cannot transfer admin PDA authorities to Squads because no instruction exists
**Why it happens:** Original programs only had initialize + burn, no transfer
**How to avoid:** Add `transfer_admin` / `transfer_authority` / `transfer_bc_admin` instructions to AMM, Transfer Hook, and Bonding Curve programs BEFORE attempting authority transfer. This requires rebuild + redeploy.
**Warning signs:** Attempting to write a transfer-authority.ts script and discovering there's no instruction to call

### Pitfall 3: Buffer Authority Mismatch on Upgrade
**What goes wrong:** Upgrade proposal fails because buffer authority doesn't match vault PDA
**Why it happens:** Buffer is created with deployer as authority; must be transferred to vault PDA before creating proposal
**How to avoid:** After `solana program write-buffer`, immediately `solana program set-buffer-authority <BUFFER> --new-buffer-authority <VAULT_PDA> --skip-new-upgrade-authority-signer-check`
**Warning signs:** VaultTransactionExecute fails with "authority mismatch" on the buffer account

### Pitfall 4: Timelock Not Elapsed
**What goes wrong:** Execution fails because timelock period hasn't passed
**Why it happens:** Proposal reaches Approved status immediately after 2 votes, but execution is blocked by timeLock
**How to avoid:** Poll the proposal status AND check elapsed time since approval. Wait `timeLock` seconds from when proposal was Approved (not when it was created).
**Warning signs:** "Transaction not ready for execution" error

### Pitfall 5: Solana CLI Path with Spaces
**What goes wrong:** CLI commands fail with unhelpful errors when project path contains spaces ("Dr Fraudsworth")
**Why it happens:** Solana CLI has issues with paths containing spaces, especially for --keypair flag
**How to avoid:** Use symlinks or absolute paths with proper quoting. For keypair, read the file and use TypeScript web3.js directly instead of CLI for authority transfer.
**Warning signs:** "No default signer found" or "unrecognized signer source" errors

### Pitfall 6: Squads Program Config Treasury
**What goes wrong:** `multisigCreateV2` fails because treasury address is wrong
**Why it happens:** Must fetch Squads program config PDA to get the correct treasury address
**How to avoid:** Always fetch via `multisig.accounts.ProgramConfig.fromAccountAddress()` before creating multisig
**Warning signs:** Account validation error on multisig creation

## Code Examples

### Verifying Upgrade Authority On-Chain
```typescript
// Source: verify.ts pattern (existing project code)
import { Connection, PublicKey } from "@solana/web3.js";

async function getUpgradeAuthority(
  connection: Connection,
  programId: PublicKey
): Promise<PublicKey | null> {
  const programInfo = await connection.getAccountInfo(programId);
  if (!programInfo) return null;

  // BPFLoaderUpgradeable program data is at a separate PDA
  // Derived: [program_id] with BPFLoaderUpgradeable program
  const PROGRAM_DATA_SEED_OFFSET = 4; // skip 4-byte account type
  const programDataAddress = new PublicKey(
    programInfo.data.slice(PROGRAM_DATA_SEED_OFFSET, PROGRAM_DATA_SEED_OFFSET + 32)
  );

  const programData = await connection.getAccountInfo(programDataAddress);
  if (!programData) return null;

  // Upgrade authority is at offset 13 (4 type + 8 slot + 1 option flag)
  const hasAuthority = programData.data[12] === 1;
  if (!hasAuthority) return null;

  return new PublicKey(programData.data.slice(13, 45));
}
```

### Negative Verification (Deployer Cannot Upgrade)
```typescript
// Attempt upgrade from deployer, confirm it fails
try {
  const result = execSync(
    `solana program deploy target/deploy/conversion_vault.so ` +
    `--program-id ${programId} --keypair ${deployerKeypair} -u devnet`,
    { encoding: "utf8" }
  );
  throw new Error("FAIL: Deployer was able to upgrade after authority transfer!");
} catch (err) {
  if (err.message.includes("was able to upgrade")) throw err;
  // Expected: "Upgrade authority mismatch" or similar
  console.log("PASS: Deployer correctly rejected from upgrading");
}
```

### Reading Admin PDA Authority
```typescript
// Verify admin PDA authority is held by vault
const adminConfig = await programs.amm.account.adminConfig.fetch(adminConfigPda);
assert(adminConfig.admin.equals(vaultPda), "AMM admin should be Squads vault");

const whitelistAuth = await programs.transferHook.account.whitelistAuthority.fetch(whitelistPda);
assert(whitelistAuth.authority?.equals(vaultPda), "Whitelist authority should be Squads vault");

const bcAdmin = await programs.bondingCurve.account.bcAdminConfig.fetch(bcAdminPda);
assert(bcAdmin.authority.equals(vaultPda), "BC admin should be Squads vault");
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Squads v3 (Mesh) | Squads v4 | 2024 | v4 has native timelock, roles, spending limits. v3 is deprecated. |
| `@sqds/sdk` (v3 SDK) | `@sqds/multisig` (v4 SDK) | 2024 | Different API surface; v4 uses `multisigCreateV2`, `vaultTransactionCreate` |
| `multisigCreate` | `multisigCreateV2` | v4 SDK | V1 is deprecated; V2 requires `treasury` from programConfig |

**Deprecated/outdated:**
- `@sqds/sdk`: This is the Squads v3 (Mesh) SDK. Do NOT use.
- `multisig.rpc.multisigCreate()`: Deprecated in favor of `multisigCreateV2`.

## Critical Finding: Missing Transfer Instructions

**Confidence: HIGH** (verified by reading all program source files)

The 3 admin PDAs currently only support:
- **AMM AdminConfig**: `initialize_admin` + `burn_admin`
- **Transfer Hook WhitelistAuthority**: `initialize_authority` + `burn_authority`
- **Bonding Curve BcAdminConfig**: `initialize_bc_admin` + `burn_bc_admin`

None have a `transfer_*` instruction. New instructions are needed:

| Program | New Instruction | Accounts | Logic |
|---------|----------------|----------|-------|
| AMM | `transfer_admin(new_admin: Pubkey)` | admin (signer), admin_config (mut, has_one=admin) | Set admin_config.admin = new_admin |
| Transfer Hook | `transfer_authority(new_authority: Pubkey)` | authority (signer), whitelist_authority (mut) | Set whitelist_authority.authority = Some(new_authority) |
| Bonding Curve | `transfer_bc_admin(new_admin: Pubkey)` | authority (signer), admin_config (mut, has_one=authority) | Set admin_config.authority = new_admin |

Each is ~15 lines of Rust. The `has_one` constraint ensures only the current admin can transfer.

**Impact:** This requires a program rebuild and redeploy BEFORE authority transfer. Since upgrade authority hasn't been transferred yet, this is still possible. The rebuild must go through the existing `build.sh` pipeline.

## Squads v4 Program ID

**Program ID:** `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
**Available on:** Both devnet and mainnet-beta

Confidence: HIGH (verified via Solscan)

## Open Questions

1. **TransactionMessage blockhash for vault transactions**
   - What we know: Quickstart shows fetching latest blockhash for TransactionMessage
   - What's unclear: Whether vault transactions need a "fresh" blockhash or if any blockhash works (since execution happens later after timelock)
   - Recommendation: Use latest blockhash at proposal creation time; the Squads program likely handles this internally. Test on devnet to confirm.

2. **Proposal status polling**
   - What we know: Proposals transition through states (Draft -> Active -> Approved -> Executed)
   - What's unclear: Exact polling method for checking if timelock has elapsed; whether there's an SDK helper or if you read the proposal account directly
   - Recommendation: Fetch proposal account directly with `multisig.accounts.Proposal.fromAccountAddress()` and check `status` field plus timestamp math.

3. **BPFLoaderUpgradeable upgrade instruction construction in TypeScript**
   - What we know: CLI handles this via `solana program deploy --buffer`
   - What's unclear: The exact TypeScript instruction data layout for BPFLoaderUpgradeable::Upgrade (instruction index, accounts)
   - Recommendation: Use the GitHub action source code as reference: https://github.com/Squads-Protocol/squads-v4-program-upgrade or construct manually with known layout (instruction discriminator = 3, accounts = [programData, program, buffer, spill, rent, clock, authority]).

4. **Admin PDA transfer: will rebuild change program IDs?**
   - What we know: Adding new instructions to existing programs and redeploying preserves the program ID (we own the keypairs)
   - What's unclear: Whether the IDL changes might affect existing PDA derivations
   - Recommendation: Adding instructions does NOT change existing account layouts or PDA seeds. Only the IDL grows with new instruction definitions. Existing state is preserved. Safe to proceed.

## Sources

### Primary (HIGH confidence)
- Squads v4 Quickstart: https://docs.squads.so/main/development/introduction/quickstart
- Squads v4 Accounts Reference: https://docs.squads.so/main/development/reference/accounts
- Squads v4 Time-locks: https://docs.squads.so/main/development/reference/time-locks
- Squads v4 CLI Commands: https://docs.squads.so/main/development/cli/commands
- Squads v4 Create Multisig: https://docs.squads.so/main/development/typescript/instructions/create-multisig
- Squads Programs UI: https://docs.squads.so/main/navigating-your-squad/developers-assets/programs
- Solana Deploying Programs: https://solana.com/docs/programs/deploying
- Project source code: programs/amm/src/, programs/transfer-hook/src/, programs/bonding_curve/src/ (directly verified)

### Secondary (MEDIUM confidence)
- Squads v4 SDK Typedoc: https://v4-sdk-typedoc.vercel.app/
- Squads v4 GitHub: https://github.com/Squads-Protocol/v4
- Squads v4 Program Upgrade Action: https://github.com/Squads-Protocol/squads-v4-program-upgrade
- Squads Program ID on Solscan: https://solscan.io/account/SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf

### Tertiary (LOW confidence)
- BPFLoaderUpgradeable instruction layout (from training data, needs validation at implementation time)
- `@sqds/multisig` v2.1.4 as latest version (npm search result, not directly verified on npm page)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - @sqds/multisig is the only viable SDK, well-documented
- Architecture: MEDIUM - Script structure follows existing project patterns; Squads SDK API details need validation during implementation
- Pitfalls: HIGH - Missing transfer instructions is verified from source; vault vs multisig PDA confusion is well-documented in community
- Admin PDA gap: HIGH - Directly verified by reading all instruction files in all 3 programs

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable domain; Squads v4 is mature)
