# Phase 33: Deployment Scripts - Research

**Researched:** 2026-02-11
**Domain:** Solana program deployment automation, protocol initialization scripting
**Confidence:** HIGH

## Summary

Phase 33 automates the full build-deploy-initialize-verify cycle for the Dr. Fraudsworth protocol (5 programs) via idempotent scripts. The research covers three domains: (1) shell-based build/deploy automation using `anchor build` and `solana program deploy`, (2) TypeScript-based protocol initialization using the Anchor SDK with idempotent check-before-init patterns, and (3) PDA manifest generation and post-deployment verification.

The project already has strong foundations to build on: a proven 17-step initialization sequence in `tests/integration/helpers/protocol-init.ts`, a robust program ID verification script in `scripts/verify-program-ids.ts`, and comprehensive PDA seed constants in `tests/integration/helpers/constants.ts`. The deployment scripts will adapt these patterns for production use -- adding idempotent checks, operator-friendly logging, fail-fast error handling, and transaction signature logging.

The key technical insight is that `solana program deploy ./program.so --program-id ./keypair.json` handles both initial deploys and upgrades natively. The program keypair is only needed for the first deployment; upgrades only need the program ID (public key) and the upgrade authority wallet. Since all 5 program keypairs are canonical in `keypairs/`, the build/deploy script can verify consistency before deploying.

**Primary recommendation:** Build 4 scripts: (1) `build.sh` -- anchor build + verify-ids, (2) `deploy.sh` -- deploy 5 programs to target cluster, (3) `initialize.ts` -- idempotent 17-step protocol init, (4) `verify.ts` -- PDA manifest generation + post-deploy verification. Orchestrate them via a top-level `deploy-all.sh`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @coral-xyz/anchor | ^0.32.1 | Anchor TypeScript client for building/sending transactions | Already in project, proven in protocol-init.ts |
| @solana/web3.js | ^1.95.5 | Low-level Solana RPC, connection, keypair handling | Already in project, used throughout |
| @solana/spl-token | ^0.4.9 | Token-2022 mint creation, mintTo, transfer_checked | Already in project, needed for mint initialization |
| tsx | ^4.21.0 | TypeScript script runner (fast, no config) | Already in project, used by verify-ids script |
| anchor CLI | 0.32.1 | `anchor build` compiles all programs to .so | Installed via AVM, confirmed in project |
| solana CLI | 2.x | `solana program deploy`, `solana program show` | Installed at ~/.local/share/solana/install/ |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fs (Node built-in) | N/A | Read keypair files, write manifest/logs | All scripts need file I/O |
| path (Node built-in) | N/A | Cross-platform path resolution | File path construction |
| child_process (Node built-in) | N/A | Shell command execution from TS if needed | Optional for verify-ids integration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate shell + TS scripts | All-TypeScript (using child_process for CLI) | Shell is cleaner for build/deploy (simple CLI wrappers); TS is better for complex init transactions. Hybrid is the right call per CONTEXT.md decision |
| tsx runner | ts-node | tsx is faster (no compilation step), already used for verify-ids. ts-node has issues with Node 24+ ESM loading |
| Anchor workspace auto-load | Manual IDL + Program construction | Standalone scripts can't reliably use anchor.workspace; manual construction gives full control over connection/provider |

**Installation:**
No new dependencies needed. All libraries already present in `package.json`.

## Architecture Patterns

### Recommended Project Structure
```
scripts/deploy/
  build.sh              # Compile all programs + verify IDs
  deploy.sh             # Deploy programs to target cluster
  initialize.ts         # Idempotent protocol initialization (~32 txns)
  verify.ts             # PDA manifest generation + post-deploy verification
  deploy-all.sh         # Orchestrator: build -> deploy -> init -> verify
  lib/
    connection.ts       # Shared: create provider from cluster URL + wallet
    pda-manifest.ts     # PDA derivation for all protocol addresses
    logger.ts           # Step logging + tx signature file logging
    account-check.ts    # Idempotent account existence checks
```

### Pattern 1: Standalone Anchor Provider (No anchor.workspace)
**What:** Create Anchor provider and Program instances manually in deployment scripts, without relying on `anchor.workspace` which only works in test contexts.
**When to use:** All TypeScript deployment scripts (initialize.ts, verify.ts)
**Example:**
```typescript
// Source: Verified pattern from existing init-localnet.ts + Anchor SDK docs
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";

// Load wallet
const walletPath = process.env.WALLET || "keypairs/devnet-wallet.json";
const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf8"));
const wallet = new anchor.Wallet(
  Keypair.fromSecretKey(new Uint8Array(secretKey))
);

// Create connection to target cluster
const clusterUrl = process.env.CLUSTER_URL || "http://localhost:8899";
const connection = new Connection(clusterUrl, "confirmed");

// Create provider
const provider = new anchor.AnchorProvider(connection, wallet, {
  preflightCommitment: "confirmed",
  commitment: "confirmed",
});

// Load IDL and create Program instance
const ammIdl = JSON.parse(
  fs.readFileSync("target/idl/amm.json", "utf8")
);
const ammProgram = new anchor.Program(ammIdl, provider);
```

### Pattern 2: Idempotent Check-Before-Init
**What:** Before each initialization transaction, check if the target account/PDA already exists on-chain. Skip if already initialized, execute if not.
**When to use:** Every step in the initialization sequence.
**Example:**
```typescript
// Source: Proven pattern from existing init-localnet.ts and protocol-init.ts
async function accountExists(
  connection: Connection,
  address: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(address);
  return info !== null && info.data.length > 0;
}

// In initialization step:
const [whitelistAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("authority")],
  hookProgram.programId
);

if (await accountExists(connection, whitelistAuthority)) {
  log(step, "WhitelistAuthority", "SKIPPED (already exists)");
} else {
  const sig = await hookProgram.methods
    .initializeAuthority()
    .accountsStrict({ /* ... */ })
    .signers([authority])
    .rpc();
  log(step, "WhitelistAuthority", "done", sig);
}
```

### Pattern 3: Deploy with Canonical Keypairs
**What:** Use `solana program deploy` with `--program-id keypairs/<program>-keypair.json` to deploy to deterministic program addresses. This handles both fresh deploys and upgrades.
**When to use:** The deploy.sh script for all 5 programs.
**Example:**
```bash
# Source: Solana CLI docs (solana.com/docs/programs/deploying)
# Fresh deploy OR upgrade (same command handles both):
solana program deploy \
  target/deploy/amm.so \
  --program-id keypairs/amm-keypair.json \
  --keypair keypairs/devnet-wallet.json \
  --url "$CLUSTER_URL"

# Verify deployment:
solana program show $(solana-keygen pubkey keypairs/amm-keypair.json) \
  --url "$CLUSTER_URL"
```

### Pattern 4: Step-by-Step Operator Logging with Tx Log File
**What:** Print human-readable step progress to terminal while writing transaction signatures to a separate log file.
**When to use:** All initialization and verification steps.
**Example:**
```typescript
// Terminal output:
// [1/32] Creating WhitelistAuthority... done
// [2/32] Creating CRIME mint... done
// [3/32] Creating FRAUD mint... SKIPPED (already exists)

function logStep(
  step: number,
  total: number,
  name: string,
  status: "done" | "SKIPPED",
  sig?: string
) {
  const prefix = `[${step}/${total}]`;
  console.log(`${prefix} ${name}... ${status}`);

  if (sig) {
    fs.appendFileSync(TX_LOG_PATH, `${name}: ${sig}\n`);
  }
}
```

### Pattern 5: PDA Manifest Generation
**What:** Pre-calculate all protocol PDA addresses from program IDs and output as both JSON (machine-readable) and markdown (human review).
**When to use:** After deploy, before init (to verify program IDs produce expected PDAs), and after init (to verify all accounts exist).
**Example:**
```typescript
// Source: Derived from existing tests/integration/helpers/constants.ts
// which already has all PDA derivation helpers

interface PdaManifest {
  generatedAt: string;
  clusterUrl: string;
  programs: Record<string, string>;  // name -> programId
  pdas: Record<string, string>;      // name -> derived address
}

function generateManifest(programIds: Record<string, PublicKey>): PdaManifest {
  const pdas: Record<string, string> = {};

  // Staking PDAs
  const [stakePool] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake_pool")],
    programIds.staking
  );
  pdas["stakePool"] = stakePool.toBase58();
  // ... all other PDAs

  return { generatedAt: new Date().toISOString(), /* ... */ pdas };
}

// Output both formats:
fs.writeFileSync("scripts/deploy/pda-manifest.json", JSON.stringify(manifest, null, 2));
fs.writeFileSync("scripts/deploy/pda-manifest.md", markdownTable(manifest));
```

### Anti-Patterns to Avoid
- **Reusing test helpers directly:** The test `protocol-init.ts` has test-specific behavior (airdrops, random keypairs for mints, test wallets). Deployment scripts need deterministic mints (from saved keypairs or first-run generation), no test wallets, and real error handling. Model on the 17-step sequence but don't import the test helper.
- **Using `anchor deploy`:** It generates new program addresses each time. Use `solana program deploy --program-id <keypair>` for deterministic addresses.
- **Local state files for idempotency:** Decided in CONTEXT.md -- use on-chain detection only. No `.deploy-state.json` tracking files.
- **Retrying on failure:** Decided in CONTEXT.md -- fail fast, report clearly. User fixes and re-runs; idempotency handles already-completed steps.
- **Hardcoding program IDs in deploy scripts:** Always derive from keypair files. The `keypairs/` directory is the canonical source of truth.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Program ID verification | Custom cross-reference checker | Existing `npm run verify-ids` (scripts/verify-program-ids.ts) | Already validates 3 ID layers + cross-refs + placeholders. 774 lines of battle-tested logic |
| PDA seed constants | Duplicate seed definitions | Import from `tests/integration/helpers/constants.ts` | All 25+ PDA seeds already defined and source-mapped to on-chain constants |
| PDA derivation helpers | Rewrite derivation functions | Import `derivePoolPDA`, `deriveVaultPDAs`, `deriveWhitelistEntryPDA` from constants.ts | Proven helpers that handle canonical ordering |
| Canonical mint ordering | Manual pubkey comparison | Import `canonicalOrder` pattern from protocol-init.ts | Pool PDA derivation requires mints in correct order |
| Token-2022 mint creation | Custom mint creation logic | Use `@solana/spl-token` helpers (`getMintLen`, `createInitializeTransferHookInstruction`, etc.) | Already proven in protocol-init.ts, handles extensions correctly |
| Keypair derivation from file | Custom JSON parser | `Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path))))` | Standard pattern used throughout project |

**Key insight:** The project already has most building blocks. The deployment scripts primarily need to (a) adapt the protocol-init.ts 17-step sequence with idempotent checks, (b) wrap the build/deploy CLI commands, and (c) add the manifest/verify layer.

## Common Pitfalls

### Pitfall 1: anchor deploy vs solana program deploy
**What goes wrong:** `anchor deploy` generates a NEW keypair each time, deploying to a random address. Your declare_id! won't match.
**Why it happens:** `anchor deploy` is designed for development iteration, not production deployment with deterministic addresses.
**How to avoid:** Always use `solana program deploy ./target/deploy/program.so --program-id ./keypairs/program-keypair.json`. This deploys to the address derived from the keypair, and handles both fresh deploys and upgrades.
**Warning signs:** Program ID mismatch errors after deployment, `npm run verify-ids` failing.

### Pitfall 2: Mint Keypairs Lost Between Runs
**What goes wrong:** The 17-step init sequence creates mints with `Keypair.generate()`. On re-run, new random keypairs are generated, producing different mint addresses. All pool PDAs, whitelist entries, and ExtraAccountMetaLists are now wrong.
**Why it happens:** Mints are created as regular accounts (not PDAs) so their address comes from a keypair, not deterministic seeds.
**How to avoid:** For deployment, either (a) save mint keypairs to files on first init and load them on subsequent runs, or (b) detect that mints already exist by checking a downstream PDA (like a pool) and skip the entire mint-creation phase. Option (b) is simpler and aligns with the on-chain-only idempotency decision. But on first run, the mint keypairs need to be saved for the verify step.
**Warning signs:** "Account already in use" errors, or pool initialization failing because mint addresses don't match pool PDA seeds.

### Pitfall 3: Transaction Order Dependencies
**What goes wrong:** Attempting to create a pool before AdminConfig exists, or whitelisting a vault before the pool creates it.
**Why it happens:** The 17-step sequence has strict ordering requirements due to cross-program dependencies.
**How to avoid:** Follow the exact ordering from protocol-init.ts. The sequence is: (1) mints, (2) WhitelistAuthority, (3) ExtraAccountMetaLists, (4) AdminConfig, (5) admin token accounts + whitelist them, (6-9) 4 pools, (10) whitelist pool vaults, (11) EpochState, (12) StakePool (with dead stake), (13) whitelist StakeVault, (14) CarnageFund, (15) whitelist Carnage vaults, (16) fund Carnage SOL vault.
**Warning signs:** "Account not found" or "constraint violation" errors during initialization.

### Pitfall 4: Upgrade Authority Mismatch on InitializeAdmin
**What goes wrong:** AMM's `InitializeAdmin` instruction verifies the caller is the program's upgrade authority by checking the ProgramData account. If the deploy wallet differs from the init wallet, this fails.
**Why it happens:** On localnet/devnet the deploy wallet and init wallet are typically the same (`keypairs/devnet-wallet.json`), but on mainnet they might differ.
**How to avoid:** Ensure the wallet used for `solana program deploy` is the same wallet used to run `initialize.ts`. The deploy script should use `--keypair keypairs/devnet-wallet.json` to match.
**Warning signs:** "Unauthorized" error on InitializeAdmin instruction.

### Pitfall 5: Hook Accounts for Token-2022 Transfers During Init
**What goes wrong:** Several init steps perform `transfer_checked` on Token-2022 mints with Transfer Hook extensions. The Transfer Hook requires extra accounts (ExtraAccountMetaList, whitelist entries, hook program ID) passed as `remainingAccounts`.
**Why it happens:** Anchor SPL's `transfer_checked` does NOT forward `remaining_accounts`. The project uses manual `invoke_signed` patterns.
**How to avoid:** Copy the proven `remainingAccounts` construction from protocol-init.ts for: (a) pool seed liquidity transfers (Step 6b-10), (b) StakePool dead stake transfer (Step 13). The pattern is: `[extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]`.
**Warning signs:** "NoWhitelistedParty" error (0x1770) during pool init or StakePool init.

### Pitfall 6: PDA-Owned WSOL Accounts
**What goes wrong:** Attempting to create a WSOL ATA for a PDA-owned account fails because ATAs reject off-curve (PDA) owners.
**Why it happens:** WSOL uses SPL Token (not Token-2022). ATA derivation requires an on-curve pubkey.
**How to avoid:** Use `createWrappedNativeAccount` with an explicit `Keypair` (not ATA). This is already handled correctly in protocol-init.ts.
**Warning signs:** "Invalid seeds, address must fall off the curve" error.

### Pitfall 7: Balance Check Before Deployment
**What goes wrong:** Deployment fails partway through because the wallet doesn't have enough SOL for rent + fees.
**Why it happens:** Deploying 5 programs + creating 30+ accounts requires significant SOL (2-5 SOL on devnet, ~15+ SOL on mainnet).
**How to avoid:** Check wallet balance at the start of each script and report if insufficient. On devnet, consider auto-airdrop (Claude's discretion per CONTEXT.md).
**Warning signs:** "Insufficient funds" errors mid-deployment, partially initialized state.

## Code Examples

Verified patterns from existing project code:

### Loading All 5 Programs Manually (Standalone Script)
```typescript
// Source: Derived from existing scripts/init-localnet.ts pattern
// Adapted for all 5 programs with manual IDL loading

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { Amm } from "../../target/types/amm";
import { TransferHook } from "../../target/types/transfer_hook";
import { TaxProgram } from "../../target/types/tax_program";
import { EpochProgram } from "../../target/types/epoch_program";
import { Staking } from "../../target/types/staking";

function loadProvider(clusterUrl: string, walletPath: string): anchor.AnchorProvider {
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const wallet = new anchor.Wallet(
    Keypair.fromSecretKey(new Uint8Array(secretKey))
  );
  const connection = new Connection(clusterUrl, "confirmed");
  return new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
  });
}

function loadProgram<T>(idlName: string, provider: anchor.AnchorProvider): anchor.Program<T> {
  const idlPath = path.resolve(__dirname, `../../target/idl/${idlName}.json`);
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  return new anchor.Program<T>(idl, provider);
}

// Usage:
const provider = loadProvider(clusterUrl, walletPath);
const amm = loadProgram<Amm>("amm", provider);
const transferHook = loadProgram<TransferHook>("transfer_hook", provider);
const taxProgram = loadProgram<TaxProgram>("tax_program", provider);
const epochProgram = loadProgram<EpochProgram>("epoch_program", provider);
const staking = loadProgram<Staking>("staking", provider);
```

### Build Script Core Logic
```bash
# Source: Derived from Anchor CLI docs + existing project structure
#!/bin/bash
set -e
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

echo "=== Dr. Fraudsworth Build Script ==="

# Step 1: anchor build (compiles all programs)
echo "[1/3] Building all programs..."
anchor build
echo "  done"

# Step 2: Verify build artifacts exist
echo "[2/3] Checking build artifacts..."
for prog in amm transfer_hook tax_program epoch_program staking; do
  if [ ! -f "target/deploy/${prog}.so" ]; then
    echo "  ERROR: target/deploy/${prog}.so not found"
    exit 1
  fi
  echo "  OK: ${prog}.so"
done

# Step 3: Verify program ID consistency
echo "[3/3] Verifying program ID consistency..."
npx tsx scripts/verify-program-ids.ts
VERIFY_EXIT=$?
if [ $VERIFY_EXIT -ne 0 ]; then
  echo "  ERROR: Program ID verification failed"
  exit 1
fi
echo "  All program IDs consistent"
echo ""
echo "=== Build Complete ==="
```

### Deploy Script Core Logic
```bash
# Source: Solana CLI deploy docs + existing project keypair structure
#!/bin/bash
set -e
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

CLUSTER_URL="${1:-http://localhost:8899}"
WALLET="${WALLET:-keypairs/devnet-wallet.json}"

echo "=== Dr. Fraudsworth Deploy Script ==="
echo "Cluster: $CLUSTER_URL"
echo "Wallet: $WALLET"

# Check wallet balance
BALANCE=$(solana balance --url "$CLUSTER_URL" --keypair "$WALLET" | awk '{print $1}')
echo "Wallet balance: $BALANCE SOL"

# Deploy each program (handles both fresh deploy and upgrade)
PROGRAMS=(
  "amm:keypairs/amm-keypair.json"
  "transfer_hook:keypairs/transfer-hook-keypair.json"
  "tax_program:keypairs/tax-program-keypair.json"
  "epoch_program:keypairs/epoch-program.json"
  "staking:keypairs/staking-keypair.json"
)

STEP=1
TOTAL=${#PROGRAMS[@]}
for entry in "${PROGRAMS[@]}"; do
  IFS=':' read -r name keypair <<< "$entry"
  PROGRAM_ID=$(solana-keygen pubkey "$keypair")
  echo "[$STEP/$TOTAL] Deploying $name ($PROGRAM_ID)..."

  solana program deploy \
    "target/deploy/${name}.so" \
    --program-id "$keypair" \
    --keypair "$WALLET" \
    --url "$CLUSTER_URL"

  echo "  done"
  STEP=$((STEP + 1))
done

# Verify all programs are deployed and executable
echo ""
echo "Verifying deployments..."
for entry in "${PROGRAMS[@]}"; do
  IFS=':' read -r name keypair <<< "$entry"
  PROGRAM_ID=$(solana-keygen pubkey "$keypair")
  solana program show "$PROGRAM_ID" --url "$CLUSTER_URL" > /dev/null 2>&1
  if [ $? -ne 0 ]; then
    echo "  ERROR: $name ($PROGRAM_ID) not deployed"
    exit 1
  fi
  echo "  OK: $name ($PROGRAM_ID)"
done

echo ""
echo "=== Deploy Complete ==="
```

### Idempotent Account Existence Check
```typescript
// Source: Proven pattern from scripts/init-localnet.ts (line 74-80)
async function accountExists(
  connection: Connection,
  address: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(address);
  return info !== null && info.data.length > 0;
}

// For program deployment verification:
async function programIsDeployed(
  connection: Connection,
  programId: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(programId);
  return info !== null && info.executable === true;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `anchor deploy` for production | `solana program deploy --program-id <keypair>` | Always been the case | `anchor deploy` generates new addresses; `solana program deploy` is deterministic |
| Anchor 0.29.x | Anchor 0.32.1 | 2024 | New IDL format, Program constructor changes, better TypeScript types |
| `solana-web3.js` classes (Connection) | Still standard for Anchor projects | Ongoing | @solana/kit (v2) exists but Anchor 0.32.x still uses web3.js v1 |
| `ts-node` for scripts | `tsx` (esbuild-based) | 2024+ | tsx is faster, no config needed, handles ESM better. Already used in project for verify-ids |
| Manual deploy scripts | Still manual (no standard tool) | N/A | Solana ecosystem has no "terraform" equivalent. Shell + TS is the standard approach |

**Deprecated/outdated:**
- `@project-serum/anchor`: Renamed to `@coral-xyz/anchor` long ago. Project already uses the correct package.
- `anchor migrate` / `migrations/deploy.js`: Anchor's built-in migration system is minimal and rarely used for complex protocols. Custom scripts are the standard.

## Open Questions

1. **Mint keypair persistence on first init**
   - What we know: Mints are created with `Keypair.generate()` in the 17-step sequence. Their addresses are non-deterministic.
   - What's unclear: Should the deploy scripts save mint keypairs to files on first run for future reference, or is the on-chain PDA detection sufficient for idempotency?
   - Recommendation: Save mint keypairs to a `scripts/deploy/mint-keypairs/` directory on first init. This enables the verify script to deterministically re-derive all dependent PDAs (pool addresses depend on mint addresses). The init script checks if mint keypairs exist on disk and loads them; if not, generates new ones and saves them. This is the only "local state" exception, and it's justified because mint addresses are non-deterministic inputs to all other PDA derivations.
   - **Note:** This is within Claude's discretion per CONTEXT.md. The decision is to save keypairs because the verify step fundamentally cannot work without knowing mint addresses, and re-deriving them from on-chain state would require searching for accounts (fragile and slow).

2. **Cluster targeting approach**
   - What we know: CONTEXT.md says Claude picks the right approach (CLI flag vs Solana CLI config).
   - Recommendation: Use environment variable `CLUSTER_URL` with sensible defaults. Shell scripts accept it as first positional arg or env var. TypeScript scripts read from env. This is simpler than maintaining Solana CLI config state (which affects other tools) and more explicit than relying on `solana config get`.
   - Default: `http://localhost:8899` (localnet) for safety.

3. **Auto-airdrop on devnet**
   - What we know: CONTEXT.md says Claude decides.
   - Recommendation: Yes, auto-airdrop on devnet/localnet if balance < 5 SOL. The deploy script detects the cluster (localhost -> localnet, api.devnet.solana.com -> devnet) and requests airdrop if needed. Skip for mainnet URLs. This removes a manual step that would trip up every first-time deployment attempt.

4. **Verify depth**
   - What we know: CONTEXT.md says Claude picks between existence-only and existence + data checks.
   - Recommendation: Existence + key data checks. For programs: verify executable + owner = BPFLoaderUpgradeable. For pools: verify pool state has correct mints and fee_bps. For staking: verify total_staked >= MINIMUM_STAKE. For epoch: verify epoch_state exists. For mints: verify supply > 0. These checks catch real deployment issues (wrong program, wrong parameters) that existence-only would miss.

## Sources

### Primary (HIGH confidence)
- Solana CLI deploy docs (`solana.com/docs/programs/deploying.md`) -- deploy commands, `--program-id` flag, upgrade behavior
- Anchor CLI docs (`anchor-lang.com/docs/references/cli`) -- `anchor build`, `anchor deploy` vs `solana program deploy`, `anchor keys sync`
- Anchor.toml docs (`anchor-lang.com/docs/references/anchor-toml`) -- `[programs.localnet]`, `[programs.devnet]`, validator config
- Existing project code (HIGH confidence -- verified in codebase):
  - `scripts/verify-program-ids.ts` -- program ID verification (774 lines)
  - `scripts/init-localnet.ts` -- localnet initialization with idempotent checks
  - `tests/integration/helpers/protocol-init.ts` -- 17-step init sequence (1034 lines)
  - `tests/integration/helpers/constants.ts` -- all PDA seeds and derivation helpers
  - `scripts/run-integration-tests.sh` -- shell patterns for validator management
  - `Anchor.toml` -- program ID mappings for localnet and devnet
  - `Docs/Deployment_Sequence.md` -- deployment ordering documentation
  - `Docs/Protocol_Initialzation_and_Launch_Flow.md` -- full launch runbook

### Secondary (MEDIUM confidence)
- Solana Stack Exchange -- deploy with keypair, upgrade without keypair, program account structure (multiple verified answers)
- Anchor Framework Expert (MCP) -- standalone Provider/Program construction pattern

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, patterns proven in tests
- Architecture: HIGH -- modeled on existing scripts + proven init sequence
- Pitfalls: HIGH -- derived from actual bugs fixed in Phases 28-32 and documented patterns
- Deploy mechanics: HIGH -- verified against official Solana and Anchor documentation

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable domain -- CLI commands and Anchor SDK rarely change)
