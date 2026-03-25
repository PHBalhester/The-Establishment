/**
 * Protocol Initialization Script
 *
 * Executes the complete Dr. Fraudsworth protocol initialization in strict
 * dependency order with idempotent check-before-init for every step.
 *
 * This is the heart of the deployment system. It bootstraps the entire protocol:
 * - 3 Token-2022 mints with Transfer Hook extensions
 * - Transfer Hook whitelist authority + ExtraAccountMetaLists
 * - 2 AMM pools + conversion vault with seed liquidity
 * - All vault whitelist entries
 * - Epoch state machine
 * - Staking pool with dead stake
 * - Carnage fund with 3 vaults
 * - 2 Bonding curves (CRIME + FRAUD) with 460M token funding each
 * - Whitelist authority burn (irreversible -- after all 15 entries)
 * - PDA manifest generation
 *
 * Idempotency: Every step checks account existence on-chain before executing.
 * Re-running after partial completion skips already-initialized accounts.
 * Re-running after full completion skips all steps without error.
 *
 * Mint keypair persistence: On first run, generates 3 mint Keypairs and saves
 * them to scripts/deploy/mint-keypairs/. On subsequent runs, loads existing
 * keypairs from that directory. This ensures pool PDAs (which depend on mint
 * addresses) are consistent across runs.
 *
 * No retry logic -- fail fast on any error (per 33-CONTEXT.md).
 * No test wallets -- deployment scripts don't need them.
 * No airdrops -- handled by deploy.sh.
 *
 * Usage: CLUSTER_URL=http://localhost:8899 npx tsx scripts/deploy/initialize.ts
 *
 * Source: .planning/phases/33-deployment-scripts/33-02-PLAN.md
 * Blueprint: tests/integration/helpers/protocol-init.ts (17-step sequence)
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  tokenMetadataInitializeWithRentTransfer,
  getMintLen,
  ExtensionType,
  createAccount,
  mintTo,
  createWrappedNativeAccount,
  getAccount,
  createTransferCheckedInstruction,
  AuthorityType,
  createSetAuthorityInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Shared deployment library (created in 33-01)
import { loadProvider, loadPrograms } from "./lib/connection";
import { createLogger } from "./lib/logger";
import { accountExists, mintExists } from "./lib/account-check";

// PDA manifest generator (created in 33-02 Task 1)
import { generateManifest, writeManifest, generateDeploymentConfig, canonicalOrder } from "./lib/pda-manifest";
import { DeploymentConfig, validateDeploymentConfig } from "./lib/deployment-schema";

// PDA seed constants and derivation helpers from canonical source.
// These are the SAME seeds used on-chain and in integration tests.
import {
  TOKEN_DECIMALS,
  MINIMUM_STAKE,
  SOL_POOL_FEE_BPS,
  SOL_POOL_SEED_SOL,
  SOL_POOL_SEED_TOKEN,
  ADMIN_SEED,
  WHITELIST_AUTHORITY_SEED,
  WHITELIST_ENTRY_SEED,
  EXTRA_ACCOUNT_META_SEED,
  EPOCH_STATE_SEED,
  STAKE_POOL_SEED,
  ESCROW_VAULT_SEED,
  STAKE_VAULT_SEED,
  CARNAGE_FUND_SEED,
  CARNAGE_SOL_VAULT_SEED,
  CARNAGE_CRIME_VAULT_SEED,
  CARNAGE_FRAUD_VAULT_SEED,
  CURVE_SEED,
  CURVE_TOKEN_VAULT_SEED,
  CURVE_SOL_VAULT_SEED,
  CURVE_TAX_ESCROW_SEED,
  derivePoolPDA,
  deriveVaultPDAs,
  deriveWhitelistEntryPDA,
} from "../../tests/integration/helpers/constants";

// =============================================================================
// Constants
// =============================================================================

const TOTAL_STEPS = 27;

/** Per-token total supply at 6 decimals */
const TOTAL_SUPPLY: Record<string, number> = {
  CRIME:  1_000_000_000_000_000, // 1B * 10^6
  FRAUD:  1_000_000_000_000_000, // 1B * 10^6
  PROFIT:    20_000_000_000_000, // 20M * 10^6
};

/** Vault seeding amounts at 6 decimals */
const VAULT_SEED_CRIME  = 250_000_000_000_000; // 250M CRIME
const VAULT_SEED_FRAUD  = 250_000_000_000_000; // 250M FRAUD
const VAULT_SEED_PROFIT =  20_000_000_000_000 - MINIMUM_STAKE; // 20M PROFIT minus 1 PROFIT for dead stake

/** Vault PDA seeds (match on-chain constants.rs) */
const VAULT_CONFIG_SEED = Buffer.from("vault_config");
const VAULT_CRIME_SEED  = Buffer.from("vault_crime");
const VAULT_FRAUD_SEED  = Buffer.from("vault_fraud");
const VAULT_PROFIT_SEED = Buffer.from("vault_profit");

/** Directory to persist mint keypairs between runs */
const MINT_KEYPAIRS_DIR = path.resolve(__dirname, "mint-keypairs");

/**
 * BPF Loader Upgradeable program ID.
 * Used to derive ProgramData addresses for InitializeAdmin (upgrade authority check).
 */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

// =============================================================================
// Mint Keypair Persistence
// =============================================================================

/**
 * Load an existing mint keypair from disk, or generate a new one and save it.
 *
 * Why persist mint keypairs?
 * - Mints are created as regular accounts (not PDAs), so their address comes
 *   from a keypair, not deterministic seeds.
 * - Pool PDAs depend on mint addresses: changing the mint = different pool PDA.
 * - On re-run, we must use the SAME mint keypair to get the same pool PDAs.
 * - Saving to disk on first run ensures consistency across all subsequent runs.
 *
 * @param name - Mint name (used as filename: "{name}-mint.json")
 * @returns Keypair for this mint (loaded or newly generated)
 */
function loadOrCreateMintKeypair(name: string): Keypair {
  const filePath = path.join(MINT_KEYPAIRS_DIR, `${name}-mint.json`);

  if (fs.existsSync(filePath)) {
    // Load existing keypair from disk
    const secretKey = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  }

  // Generate new keypair and save to disk
  fs.mkdirSync(MINT_KEYPAIRS_DIR, { recursive: true });
  const keypair = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  return keypair;
}

// =============================================================================
// Main Initialization
// =============================================================================

async function main() {
  // ---------------------------------------------------------------------------
  // Setup: Provider, programs, logger
  // ---------------------------------------------------------------------------
  const provider = loadProvider();
  const programs = loadPrograms(provider);
  const connection = provider.connection;
  const log = createLogger();

  // The provider wallet is the authority (upgrade authority, admin, payer)
  const authority = (provider.wallet as anchor.Wallet).payer;
  const clusterUrl = process.env.CLUSTER_URL || "http://localhost:8899";

  // ---------------------------------------------------------------------------
  // Env var hard-error guard (non-localhost only)
  //
  // Why fail fast here? Phase 69 cost 50 SOL because pool seed env vars were
  // missing -- initialize.ts fell through to test defaults (10 SOL / 10K tokens)
  // which created under-seeded pools that couldn't be re-seeded without a full
  // redeploy. This guard ensures ALL required vars are present BEFORE any
  // on-chain operations, so we never get halfway through initialization only
  // to discover a missing config value.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Partial Deploy Mode (Pathway 1 testing)
  //
  // When PARTIAL_DEPLOY=true, only deploy Transfer Hook + Bonding Curve
  // related steps (mints, whitelist, curves). Skips AMM, Tax, Epoch,
  // Staking, Conversion Vault, and PROFIT mint entirely.
  // ---------------------------------------------------------------------------
  const isPartial = process.env.PARTIAL_DEPLOY === "true";

  const isLocalhost = clusterUrl.includes("localhost") || clusterUrl.includes("127.0.0.1");
  if (!isLocalhost) {
    // Partial deploy doesn't need pool seed amounts (no AMM pools created)
    const REQUIRED_VARS_NON_LOCALHOST = isPartial
      ? ["HELIUS_API_KEY", "CLUSTER_URL"]
      : [
          "HELIUS_API_KEY",
          "CLUSTER_URL",
        ];

    const missing = REQUIRED_VARS_NON_LOCALHOST.filter(
      (v) => !process.env[v] || process.env[v]!.trim() === ""
    );

    if (missing.length > 0) {
      console.error("");
      console.error("!!! MISSING REQUIRED ENVIRONMENT VARIABLES !!!");
      console.error("");
      for (const v of missing) {
        console.error(`  - ${v}`);
      }
      console.error("");
      console.error("Set these in .env.devnet or .env.mainnet before running.");
      console.error("Reminder: source the env file with `set -a && source .env.devnet && set +a`");
      console.error("");
      process.exit(1);
    }
  }

  log.section("Dr. Fraudsworth Protocol Initialization");
  if (isPartial) {
    log.info("*** PARTIAL DEPLOY MODE (Pathway 1 Testing) ***");
    log.info("  Programs: Transfer Hook, Bonding Curve only");
    log.info("  Mints: CRIME, FRAUD (no PROFIT)");
    log.info("  Skipped: AMM, Tax, Epoch, Staking, Vault");
  }
  log.info(`Cluster:   ${clusterUrl}`);
  log.info(`Authority: ${authority.publicKey.toBase58()}`);
  log.info(`Tx log:    ${log.getLogPath()}`);

  // Check authority balance
  const balance = await connection.getBalance(authority.publicKey);
  log.info(`Balance:   ${balance / 1e9} SOL`);
  if (balance < 2 * 1e9) {
    log.error("Authority balance too low (< 2 SOL). Fund the wallet or run deploy.sh first (which auto-airdrops on devnet).");
    process.exit(1);
  }

  // Track step completion for summary
  let completed = 0;
  let skipped = 0;
  let stepNum = 0;

  // Program IDs (derived from loaded programs, which read from IDL files)
  const hookProgramId = programs.transferHook.programId;
  const ammProgramId = programs.amm.programId;
  const epochProgramId = programs.epochProgram.programId;
  const stakingProgramId = programs.staking.programId;
  const vaultProgramId = programs.conversionVault.programId;
  const taxProgramIdForPda = programs.taxProgram.programId;

  // ProgramData PDAs for upgrade authority verification (Phase 78-02).
  // Every init instruction now requires program + programData to verify
  // the caller is the program's upgrade authority.
  const [hookProgramDataPda] = PublicKey.findProgramAddressSync(
    [hookProgramId.toBuffer()], BPF_LOADER_UPGRADEABLE
  );
  const [epochProgramDataPda] = PublicKey.findProgramAddressSync(
    [epochProgramId.toBuffer()], BPF_LOADER_UPGRADEABLE
  );
  const [stakingProgramDataPda] = PublicKey.findProgramAddressSync(
    [stakingProgramId.toBuffer()], BPF_LOADER_UPGRADEABLE
  );
  const [vaultProgramDataPda] = PublicKey.findProgramAddressSync(
    [vaultProgramId.toBuffer()], BPF_LOADER_UPGRADEABLE
  );
  const [taxProgramDataPda] = PublicKey.findProgramAddressSync(
    [taxProgramIdForPda.toBuffer()], BPF_LOADER_UPGRADEABLE
  );

  // =========================================================================
  // Step 1: Create 3 Token-2022 mints with TransferHook extension
  // =========================================================================
  log.section("Step 1: Create Token-2022 Mints");

  // Load or create mint keypairs (persisted to disk for reproducibility)
  const crimeMintKeypair = loadOrCreateMintKeypair("crime");
  const fraudMintKeypair = loadOrCreateMintKeypair("fraud");
  // Partial deploy skips PROFIT -- generate a dummy keypair (never used on-chain)
  const profitMintKeypair = isPartial
    ? Keypair.generate()
    : loadOrCreateMintKeypair("profit");

  const crimeMint = crimeMintKeypair.publicKey;
  const fraudMint = fraudMintKeypair.publicKey;
  const profitMint = profitMintKeypair.publicKey;

  log.info(`CRIME mint:  ${crimeMint.toBase58()}`);
  log.info(`FRAUD mint:  ${fraudMint.toBase58()}`);
  if (!isPartial) {
    log.info(`PROFIT mint: ${profitMint.toBase58()}`);
  } else {
    log.info(`PROFIT mint: (skipped in partial deploy)`);
  }

  const mintLen = getMintLen([ExtensionType.TransferHook, ExtensionType.MetadataPointer]);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  // Resolve metadata URIs from env vars or deployment.json.
  // Priority: CRIME_METADATA_URI env var > deployments/{cluster}.json > hard error.
  // This ensures mints are always created with permanent Arweave metadata URIs
  // rather than stale Railway placeholders.
  const deployClusterForMeta = clusterUrl.includes("mainnet") ? "mainnet" : "devnet";

  function resolveMetadataUri(tokenName: string): string {
    const envKey = `${tokenName.toUpperCase()}_METADATA_URI`;
    const envVal = process.env[envKey];
    if (envVal) {
      log.info(`  ${tokenName} metadata URI resolved from env var (${envKey})`);
      return envVal;
    }

    // Try deployment.json fallback
    const deployPath = path.join(__dirname, "../../deployments", `${deployClusterForMeta}.json`);
    if (fs.existsSync(deployPath)) {
      const config = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
      const key = tokenName.toLowerCase() as "crime" | "fraud" | "profit";
      if (config.metadata?.[key]) {
        log.info(`  ${tokenName} metadata URI resolved from deployment.json`);
        return config.metadata[key];
      }
    }

    throw new Error(
      `No metadata URI for ${tokenName}. ` +
      `Set ${envKey} env var or run upload-metadata.ts first.`
    );
  }

  // Partial deploy: only resolve metadata for CRIME and FRAUD
  const tokenMetadata: Record<string, { symbol: string; uri: string }> = isPartial
    ? {
        CRIME: { symbol: "CRIME", uri: resolveMetadataUri("CRIME") },
        FRAUD: { symbol: "FRAUD", uri: resolveMetadataUri("FRAUD") },
      }
    : {
        CRIME: { symbol: "CRIME", uri: resolveMetadataUri("CRIME") },
        FRAUD: { symbol: "FRAUD", uri: resolveMetadataUri("FRAUD") },
        PROFIT: { symbol: "PROFIT", uri: resolveMetadataUri("PROFIT") },
      };

  // Partial deploy: only CRIME and FRAUD mints
  const mintKeypairs = isPartial
    ? [
        { name: "CRIME", kp: crimeMintKeypair },
        { name: "FRAUD", kp: fraudMintKeypair },
      ]
    : [
        { name: "CRIME", kp: crimeMintKeypair },
        { name: "FRAUD", kp: fraudMintKeypair },
        { name: "PROFIT", kp: profitMintKeypair },
      ];

  for (const { name, kp } of mintKeypairs) {
    stepNum++;

    if (await mintExists(connection, kp.publicKey)) {
      log.step(stepNum, TOTAL_STEPS, `Create ${name} mint`, "SKIPPED");
      skipped++;
      continue;
    }

    // Build transaction: createAccount + initTransferHook + initMetadataPointer + initMint
    const mintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: kp.publicKey,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        kp.publicKey,
        authority.publicKey,
        hookProgramId,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMetadataPointerInstruction(
        kp.publicKey,
        authority.publicKey, // metadata pointer authority
        kp.publicKey,        // metadata lives on the mint itself
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        kp.publicKey,
        TOKEN_DECIMALS,
        authority.publicKey,
        null, // no freeze authority
        TOKEN_2022_PROGRAM_ID
      )
    );

    const sig = await sendAndConfirmTransaction(connection, mintTx, [authority, kp]);
    log.step(stepNum, TOTAL_STEPS, `Create ${name} mint`, "done", sig);

    // Initialize token metadata (separate TX -- needs mint to exist first)
    // tokenMetadataInitializeWithRentTransfer handles space reallocation
    const meta = tokenMetadata[name];
    await tokenMetadataInitializeWithRentTransfer(
      connection,
      authority,       // payer
      kp.publicKey,    // mint
      authority.publicKey, // META-09: Update authority retained with deployer (transferred to Squads in Phase 97)
      authority,       // mint authority signer
      name,            // token name
      meta.symbol,     // token symbol
      meta.uri,        // metadata URI
    );
    log.info(`  Metadata initialized: ${name} (${meta.symbol})`);
    completed++;
  }

  // Reset step counter -- mints were 3 sub-steps, counted as step 1
  stepNum = 1;

  // =========================================================================
  // Step 2: Initialize Transfer Hook WhitelistAuthority
  // =========================================================================
  stepNum = 2;
  log.section("Step 2: Initialize WhitelistAuthority");

  const [whitelistAuthority] = PublicKey.findProgramAddressSync(
    [WHITELIST_AUTHORITY_SEED],
    hookProgramId
  );

  if (await accountExists(connection, whitelistAuthority)) {
    // Ownership verification: deserialize and check authority matches deployer
    const whitelistAuthData = await programs.transferHook.account.whitelistAuthority.fetch(
      whitelistAuthority
    );
    const storedAuthority = whitelistAuthData.authority;
    if (storedAuthority !== null && !storedAuthority.equals(authority.publicKey)) {
      throw new Error(
        `SECURITY: WhitelistAuthority exists but authority is ${storedAuthority.toBase58()}, ` +
        `expected ${authority.publicKey.toBase58()}. Possible front-run attack.`
      );
    }
    log.step(stepNum, TOTAL_STEPS, "Initialize WhitelistAuthority", "SKIPPED");
    log.info("  WhitelistAuthority exists with correct authority, skipping.");
    skipped++;
  } else {
    const sig = await programs.transferHook.methods
      .initializeAuthority()
      .accountsStrict({
        signer: authority.publicKey,
        whitelistAuthority,
        program: hookProgramId,
        programData: hookProgramDataPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Initialize WhitelistAuthority", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 3: Initialize ExtraAccountMetaList for each mint
  // =========================================================================
  stepNum = 3;
  log.section("Step 3: Initialize ExtraAccountMetaLists");

  for (const { name, kp } of mintKeypairs) {
    const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
      [EXTRA_ACCOUNT_META_SEED, kp.publicKey.toBuffer()],
      hookProgramId
    );

    if (await accountExists(connection, extraAccountMetaList)) {
      log.step(stepNum, TOTAL_STEPS, `ExtraAccountMetaList for ${name}`, "SKIPPED");
      skipped++;
      continue;
    }

    const sig = await programs.transferHook.methods
      .initializeExtraAccountMetaList()
      .accountsStrict({
        payer: authority.publicKey,
        whitelistAuthority,
        authority: authority.publicKey,
        extraAccountMetaList,
        mint: kp.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, `ExtraAccountMetaList for ${name}`, "done", sig);
    completed++;
  }

  // ---------------------------------------------------------------------------
  // Hoist admin account variables for both full and partial paths
  //
  // In full deploy, these are populated in Step 5. In partial deploy, they are
  // populated in the partial-specific minting block below. Either way, they
  // must be visible to Steps 17-25 (bonding curve initialization).
  // ---------------------------------------------------------------------------
  let adminWsolAccount: PublicKey = PublicKey.default;
  let adminCrimeAccount: PublicKey = PublicKey.default;
  let adminFraudAccount: PublicKey = PublicKey.default;
  let adminProfitAccount: PublicKey = PublicKey.default;
  const adminTokenAccounts: { name: string; account: PublicKey; mint: PublicKey }[] = [];

  // =========================================================================
  // Steps 4-16: Full Protocol Init (SKIPPED in partial deploy)
  //
  // Partial deploy only needs: mints (Step 1), whitelist authority (Step 2),
  // ExtraAccountMetaList (Step 3), admin token accounts + minting (Step 5),
  // bonding curve PDAs (Steps 17-25), and manifest generation (Step 27).
  // Steps 4, 6-16 are skipped (AMM, pools, vault, epoch, staking, carnage).
  // =========================================================================
  if (isPartial) {
    log.section("Steps 4-16: SKIPPED (partial deploy mode)");
    log.info("  Skipping: AMM, pools, vault, epoch, staking, carnage");

    // Partial deploy still needs admin token accounts with minted tokens for
    // curve funding (Steps 22-23 call fund_curve which transfers from admin account).
    log.section("Step 5 (partial): Create Admin Token Accounts + Mint for CRIME/FRAUD");

    for (const { name, kp } of mintKeypairs) {
      const targetSupply = TOTAL_SUPPLY[name];

      // Safety: check current total supply to prevent double-minting on re-runs
      const mintInfo = await connection.getAccountInfo(kp.publicKey);
      if (mintInfo) {
        const currentSupply = Number(Buffer.from(mintInfo.data.subarray(36, 44)).readBigUInt64LE());
        if (currentSupply >= targetSupply) {
          log.info(`  ${name} already has ${currentSupply / 10 ** TOKEN_DECIMALS} tokens minted -- skipping mint`);
          // Still need an admin account to transfer from for curve funding.
          const tokenAccount = await createAccount(
            connection, authority, kp.publicKey, authority.publicKey,
            Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID
          );
          adminTokenAccounts.push({ name, account: tokenAccount, mint: kp.publicKey });
          continue;
        }
      }

      // Create Token-2022 account with fresh keypair each run
      const tokenAccount = await createAccount(
        connection, authority, kp.publicKey, authority.publicKey,
        Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID
      );

      // Mint per-token supply amount (CRIME=1B, FRAUD=1B)
      await mintTo(
        connection, authority, kp.publicKey, tokenAccount, authority,
        targetSupply, undefined, undefined, TOKEN_2022_PROGRAM_ID
      );

      adminTokenAccounts.push({ name, account: tokenAccount, mint: kp.publicKey });
      log.info(`  Admin ${name} account: ${tokenAccount.toBase58()} (${targetSupply / 10 ** TOKEN_DECIMALS} tokens minted)`);
    }

    // Set admin account references for curve funding (Steps 22-23)
    adminCrimeAccount = adminTokenAccounts.find(a => a.name === "CRIME")!.account;
    adminFraudAccount = adminTokenAccounts.find(a => a.name === "FRAUD")!.account;
    adminProfitAccount = PublicKey.default; // Not used in partial deploy

    log.info("  Admin token accounts created for partial deploy curve funding");
  }

  if (!isPartial) {
  // =========================================================================
  // Step 4: Initialize AMM AdminConfig
  // =========================================================================
  stepNum = 4;
  log.section("Step 4: Initialize AMM AdminConfig");

  const [adminConfig] = PublicKey.findProgramAddressSync(
    [ADMIN_SEED],
    ammProgramId
  );

  // ProgramData address for upgrade authority verification
  const [programData] = PublicKey.findProgramAddressSync(
    [ammProgramId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  if (await accountExists(connection, adminConfig)) {
    // Ownership verification: check admin matches deployer
    const adminConfigData = await programs.amm.account.adminConfig.fetch(adminConfig);
    if (!adminConfigData.admin.equals(authority.publicKey)) {
      throw new Error(
        `SECURITY: AMM AdminConfig exists but admin is ${adminConfigData.admin.toBase58()}, ` +
        `expected ${authority.publicKey.toBase58()}. Possible front-run attack.`
      );
    }
    log.step(stepNum, TOTAL_STEPS, "Initialize AMM AdminConfig", "SKIPPED");
    log.info("  AMM AdminConfig exists with correct admin, skipping.");
    skipped++;
  } else {
    const sig = await programs.amm.methods
      .initializeAdmin(authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        adminConfig,
        program: ammProgramId,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Initialize AMM AdminConfig", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 5: Create admin token accounts for seed liquidity
  //
  // Idempotency: Admin T22 accounts are needed by pool init (Step 7), vault
  // seeding (Step 10), and staking init (Step 13). Only skip admin account
  // creation if ALL downstream consumers are satisfied. WSOL is only needed
  // for pool init, so it's checked separately.
  // =========================================================================
  stepNum = 5;
  log.section("Step 5: Create Admin Token Accounts + Mint Seed Liquidity");

  // Pre-check: derive all 2 pool PDAs and check if they already exist
  // Pool existence check removed -- pools are created during graduation (Stage 6),
  // not during initialization. The allPoolsExist flag was only used for WSOL
  // wrapping which is also deferred to graduation.

  // Check if vault seeding is still needed (any vault token account has 0 balance)
  const vaultConfigForCheck = PublicKey.findProgramAddressSync(
    [VAULT_CONFIG_SEED], vaultProgramId
  )[0];
  const vaultAccountsForCheck = [
    { seed: VAULT_CRIME_SEED, label: "CRIME" },
    { seed: VAULT_FRAUD_SEED, label: "FRAUD" },
    { seed: VAULT_PROFIT_SEED, label: "PROFIT" },
  ];

  let vaultNeedsSeeding = false;
  if (await accountExists(connection, vaultConfigForCheck)) {
    for (const { seed, label } of vaultAccountsForCheck) {
      const [vaultAcct] = PublicKey.findProgramAddressSync(
        [seed, vaultConfigForCheck.toBuffer()], vaultProgramId
      );
      try {
        const acct = await getAccount(connection, vaultAcct, "confirmed", TOKEN_2022_PROGRAM_ID);
        if (Number(acct.amount) === 0) {
          log.info(`  Vault ${label} has 0 balance -- seeding still needed`);
          vaultNeedsSeeding = true;
        }
      } catch {
        // Account doesn't exist yet (vault not initialized) -- Step 8 will create it
        vaultNeedsSeeding = true;
      }
    }
  } else {
    // Vault not initialized yet -- will need seeding after Step 8
    vaultNeedsSeeding = true;
  }

  // Check if staking needs initialization
  const [stakePoolForCheck] = PublicKey.findProgramAddressSync(
    [STAKE_POOL_SEED], stakingProgramId
  );
  const stakingNeedsInit = !(await accountExists(connection, stakePoolForCheck));

  // Check if mint authorities still exist (if burned, can't mint new tokens)
  let mintAuthorityExists = false;
  for (const { kp } of mintKeypairs) {
    const mintInfo = await connection.getAccountInfo(kp.publicKey);
    if (mintInfo && mintInfo.data[0] === 1) {
      mintAuthorityExists = true;
      break;
    }
  }

  // Determine what admin accounts are needed
  const needT22Accounts = (vaultNeedsSeeding || stakingNeedsInit) && mintAuthorityExists;
  // WSOL wrapping for pool seeding is NO LONGER needed during initialization.
  // Pool creation (Step 7) was moved to graduation in Phase 94.1, so the WSOL
  // that was wrapped here went unused. The graduation script creates its own
  // WSOL from the SOL withdrawn from filled curve vaults.
  // Keeping this as false prevents blocking fresh deploys when balance < 25 SOL.
  const needWsolAccount = false;

  // admin account variables hoisted above (before partial/full split)

  if (!needT22Accounts && !needWsolAccount) {
    // All downstream consumers satisfied -- skip admin account creation
    log.step(stepNum, TOTAL_STEPS, "Create admin token accounts + mint", "SKIPPED");
    log.info("  All pools seeded, vault seeded, staking initialized -- admin accounts not needed");
    skipped++;

    // Resolve existing admin token accounts for curve funding (Steps 22-23).
    // Step 5 creates accounts with random keypairs, so we can't derive them.
    // Instead, find the deployer's token accounts for each mint on-chain.
    for (const { name, kp } of mintKeypairs) {
      const tokenAccounts = await connection.getTokenAccountsByOwner(
        authority.publicKey,
        { mint: kp.publicKey, programId: TOKEN_2022_PROGRAM_ID },
      );
      if (tokenAccounts.value.length > 0) {
        // Pick the account with the highest balance
        let best = tokenAccounts.value[0];
        let bestAmount = BigInt(0);
        for (const ta of tokenAccounts.value) {
          const amt = Buffer.from(ta.account.data.subarray(64, 72)).readBigUInt64LE();
          if (amt > bestAmount) { bestAmount = amt; best = ta; }
        }
        if (name === "CRIME") adminCrimeAccount = best.pubkey;
        else if (name === "FRAUD") adminFraudAccount = best.pubkey;
        else if (name === "PROFIT") adminProfitAccount = best.pubkey;
        log.info(`  Resolved admin ${name} account: ${best.pubkey.toBase58()} (${Number(bestAmount) / 1e6} tokens)`);
      }
    }
  } else {
    // At least one downstream step needs admin accounts

    // WSOL wrapping skipped -- pools created during graduation with dynamic SOL
    adminWsolAccount = PublicKey.default;
    log.info("  WSOL skipped (pool creation deferred to graduation)");
    if (false) {
      // Legacy WSOL wrapping code -- kept for reference but unreachable.
      // Remove after mainnet launch confirms graduation WSOL flow works.
      const wsolAmount = SOL_POOL_SEED_SOL * 2 + 5 * 1e9;
      try {
        adminWsolAccount = await createWrappedNativeAccount(
          connection,
          authority,
          authority.publicKey,
          wsolAmount,
          Keypair.generate(),
          undefined,
          TOKEN_PROGRAM_ID
        );
        log.info(`  Admin WSOL account: ${adminWsolAccount.toBase58()}`);
      } catch (err: any) {
        throw new Error(`Failed to create WSOL account: ${err.message}`);
      }
    }

    // Create Token-2022 accounts for CRIME, FRAUD, PROFIT and mint seed liquidity
    for (const { name, kp } of mintKeypairs) {
      const targetSupply = TOTAL_SUPPLY[name];

      // Safety: check current total supply to prevent double-minting on re-runs
      const mintInfo = await connection.getAccountInfo(kp.publicKey);
      if (mintInfo) {
        const currentSupply = Number(Buffer.from(mintInfo.data.subarray(36, 44)).readBigUInt64LE());
        if (currentSupply >= targetSupply) {
          log.info(`  ${name} already has ${currentSupply / 10 ** TOKEN_DECIMALS} tokens minted (target: ${targetSupply / 10 ** TOKEN_DECIMALS}) -- skipping mint`);
          // Still need an admin account to transfer from for vault seeding.
          // Create an empty one (no minting).
          const tokenAccount = await createAccount(
            connection, authority, kp.publicKey, authority.publicKey,
            Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID
          );
          adminTokenAccounts.push({ name, account: tokenAccount, mint: kp.publicKey });
          continue;
        }
      }

      // Create Token-2022 account with fresh keypair each run.
      // Using undefined would create an ATA, which fails on re-run since ATAs
      // can't be recreated for T22 mints via the standard ATA program.
      const tokenAccount = await createAccount(
        connection,
        authority,
        kp.publicKey,
        authority.publicKey,
        Keypair.generate(), // fresh keypair each run (ATA rejects T22 re-creation)
        undefined, // confirmOptions
        TOKEN_2022_PROGRAM_ID
      );

      // Mint per-token supply amount (CRIME=1B, FRAUD=1B, PROFIT=20M)
      await mintTo(
        connection,
        authority,
        kp.publicKey,
        tokenAccount,
        authority,
        targetSupply,
        undefined, // multiSigners
        undefined, // confirmOptions
        TOKEN_2022_PROGRAM_ID
      );

      adminTokenAccounts.push({ name, account: tokenAccount, mint: kp.publicKey });
      log.info(`  Admin ${name} account: ${tokenAccount.toBase58()} (${targetSupply / 10 ** TOKEN_DECIMALS} tokens minted)`);
    }

    log.step(stepNum, TOTAL_STEPS, "Create admin token accounts + mint", "done");
    completed++;

    // Build a lookup for easy access
    adminCrimeAccount = adminTokenAccounts.find(a => a.name === "CRIME")!.account;
    adminFraudAccount = adminTokenAccounts.find(a => a.name === "FRAUD")!.account;
    adminProfitAccount = adminTokenAccounts.find(a => a.name === "PROFIT")!.account;
  }

  // =========================================================================
  // Step 6: Whitelist admin Token-2022 accounts
  // =========================================================================
  stepNum = 6;
  log.section("Step 6: Whitelist Admin T22 Accounts");

  for (const { name, account } of adminTokenAccounts) {
    const [whitelistEntry] = deriveWhitelistEntryPDA(account, hookProgramId);

    if (await accountExists(connection, whitelistEntry)) {
      log.info(`  ${name} admin account already whitelisted`);
      skipped++;
      continue;
    }

    const sig = await programs.transferHook.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: authority.publicKey,
        whitelistAuthority,
        whitelistEntry,
        addressToWhitelist: account,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.info(`  ${name} admin account whitelisted (${sig.slice(0, 12)}...)`);
    completed++;
  }

  log.step(stepNum, TOTAL_STEPS, "Whitelist admin T22 accounts", "done");

  // =========================================================================
  // Step 7: SKIPPED — AMM pools are created during GRADUATION, not init.
  //
  // Why: Pool seeding requires the SOL withdrawn from filled curve vaults.
  // Creating pools here with placeholder SOL amounts caused a critical bug:
  // graduation found pools "already exist" and skipped creation, leaving the
  // withdrawn curve SOL stranded in the admin wallet instead of providing
  // AMM liquidity. On mainnet this would strand ~1000 SOL of user funds.
  //
  // Pool vault whitelisting (old Step 11) and whitelist authority burn
  // (old Step 26) also moved to graduation for the same reason.
  // =========================================================================
  log.section("Step 7: Initialize 2 SOL Pools — SKIPPED (moved to graduation)");
  log.info("  AMM pools are created during graduation with dynamic SOL from curve vaults.");
  log.info("  Pool vault whitelisting and whitelist burn also happen post-graduation.");
  skipped += 2; // 2 pools

  // Track all pool vaults for whitelisting in step 11
  const poolVaultMap: { pool: PublicKey; vaultA: PublicKey; vaultB: PublicKey }[] = [];

  /**
   * Initialize a single AMM pool with idempotent check.
   *
   * Handles canonical mint ordering, PDA derivation, Transfer Hook
   * remaining_accounts for T22 seed liquidity transfers, and the
   * initializePool instruction call.
   */
  async function initPool(
    stepNumber: number,
    label: string,
    rawMint1: PublicKey,
    rawMint2: PublicKey,
    tokenProgram1: PublicKey,
    tokenProgram2: PublicKey,
    source1: PublicKey,
    source2: PublicKey,
    feeBps: number,
    amount1: number | bigint,
    amount2: number | bigint
  ): Promise<void> {
    // Canonical ordering: smaller pubkey = mintA
    const [mintA, mintB] = canonicalOrder(rawMint1, rawMint2);

    // Map token programs, sources, and amounts to canonical order
    let tokenProgramA: PublicKey;
    let tokenProgramB: PublicKey;
    let sourceA: PublicKey;
    let sourceB: PublicKey;
    let amountA: number | bigint;
    let amountB: number | bigint;

    if (mintA.equals(rawMint1)) {
      tokenProgramA = tokenProgram1;
      tokenProgramB = tokenProgram2;
      sourceA = source1;
      sourceB = source2;
      amountA = amount1;
      amountB = amount2;
    } else {
      tokenProgramA = tokenProgram2;
      tokenProgramB = tokenProgram1;
      sourceA = source2;
      sourceB = source1;
      amountA = amount2;
      amountB = amount1;
    }

    // Derive pool PDA
    const [pool] = derivePoolPDA(mintA, mintB, ammProgramId);
    const { vaultA: [vaultA], vaultB: [vaultB] } = deriveVaultPDAs(pool, ammProgramId);

    // Track vaults for whitelisting
    poolVaultMap.push({ pool, vaultA, vaultB });

    // Idempotent check
    if (await accountExists(connection, pool)) {
      log.step(stepNumber, TOTAL_STEPS, `Initialize ${label}`, "SKIPPED");
      skipped++;
      return;
    }

    // Build Transfer Hook remaining_accounts for T22 seed liquidity transfers.
    // For each T22 mint involved, we need:
    //   [extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]
    const hookRemainingAccounts: {
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }[] = [];

    const aIsT22 = tokenProgramA.equals(TOKEN_2022_PROGRAM_ID);
    const bIsT22 = tokenProgramB.equals(TOKEN_2022_PROGRAM_ID);

    if (aIsT22) {
      const [extraMeta] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, mintA.toBuffer()],
        hookProgramId
      );
      const [wlSource] = deriveWhitelistEntryPDA(sourceA, hookProgramId);
      const [wlDest] = deriveWhitelistEntryPDA(vaultA, hookProgramId);
      hookRemainingAccounts.push(
        { pubkey: extraMeta, isSigner: false, isWritable: false },
        { pubkey: wlSource, isSigner: false, isWritable: false },
        { pubkey: wlDest, isSigner: false, isWritable: false },
        { pubkey: hookProgramId, isSigner: false, isWritable: false }
      );
    }

    if (bIsT22) {
      const [extraMeta] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, mintB.toBuffer()],
        hookProgramId
      );
      const [wlSource] = deriveWhitelistEntryPDA(sourceB, hookProgramId);
      const [wlDest] = deriveWhitelistEntryPDA(vaultB, hookProgramId);
      hookRemainingAccounts.push(
        { pubkey: extraMeta, isSigner: false, isWritable: false },
        { pubkey: wlSource, isSigner: false, isWritable: false },
        { pubkey: wlDest, isSigner: false, isWritable: false },
        { pubkey: hookProgramId, isSigner: false, isWritable: false }
      );
    }

    log.info(`  mintA: ${mintA.toBase58()}`);
    log.info(`  mintB: ${mintB.toBase58()}`);
    log.info(`  pool:  ${pool.toBase58()}`);

    const sig = await programs.amm.methods
      .initializePool(
        feeBps,
        new anchor.BN(amountA.toString()),
        new anchor.BN(amountB.toString())
      )
      .accountsStrict({
        payer: authority.publicKey,
        adminConfig,
        admin: authority.publicKey,
        pool,
        vaultA,
        vaultB,
        mintA,
        mintB,
        sourceA,
        sourceB,
        tokenProgramA,
        tokenProgramB,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(hookRemainingAccounts)
      .signers([authority])
      .rpc();

    log.step(stepNumber, TOTAL_STEPS, `Initialize ${label}`, "done", sig);
    completed++;
  }

  // Pool creation calls removed — see graduation script.
  // The initPool() helper is retained for reference but never called.

  // =========================================================================
  // Step 8: Initialize Conversion Vault
  // =========================================================================
  stepNum = 8;
  log.section("Step 8: Initialize Conversion Vault");

  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [VAULT_CONFIG_SEED], vaultProgramId
  );
  const [vaultCrime] = PublicKey.findProgramAddressSync(
    [VAULT_CRIME_SEED, vaultConfig.toBuffer()], vaultProgramId
  );
  const [vaultFraud] = PublicKey.findProgramAddressSync(
    [VAULT_FRAUD_SEED, vaultConfig.toBuffer()], vaultProgramId
  );
  const [vaultProfit] = PublicKey.findProgramAddressSync(
    [VAULT_PROFIT_SEED, vaultConfig.toBuffer()], vaultProgramId
  );

  if (await accountExists(connection, vaultConfig)) {
    // Ownership verification: check account is owned by the expected program
    const vaultConfigInfo = await connection.getAccountInfo(vaultConfig);
    if (vaultConfigInfo && !vaultConfigInfo.owner.equals(vaultProgramId)) {
      throw new Error(
        `SECURITY: VaultConfig exists but owned by ${vaultConfigInfo.owner.toBase58()}, ` +
        `expected ${vaultProgramId.toBase58()}. Possible front-run attack.`
      );
    }
    log.step(stepNum, TOTAL_STEPS, "Initialize Conversion Vault", "SKIPPED");
    log.info("  Conversion Vault exists with correct program owner, skipping.");
    skipped++;
  } else {
    const sig = await programs.conversionVault.methods
      .initialize()
      .accountsStrict({
        payer: authority.publicKey,
        vaultConfig,
        vaultCrime,
        vaultFraud,
        vaultProfit,
        crimeMint,
        fraudMint,
        profitMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        program: vaultProgramId,
        programData: vaultProgramDataPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Initialize Conversion Vault", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 9: Whitelist Vault Token Accounts
  // =========================================================================
  stepNum = 9;
  log.section("Step 9: Whitelist Vault Token Accounts");

  let vaultWhitelistNewCount = 0;
  for (const { name, account } of [
    { name: "CRIME", account: vaultCrime },
    { name: "FRAUD", account: vaultFraud },
    { name: "PROFIT", account: vaultProfit },
  ]) {
    const [whitelistEntry] = deriveWhitelistEntryPDA(account, hookProgramId);

    if (await accountExists(connection, whitelistEntry)) {
      log.info(`  Vault ${name} account already whitelisted`);
      skipped++;
      continue;
    }

    await programs.transferHook.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: authority.publicKey,
        whitelistAuthority,
        whitelistEntry,
        addressToWhitelist: account,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    log.info(`  Vault ${name} account whitelisted`);
    vaultWhitelistNewCount++;
    completed++;
  }

  log.step(stepNum, TOTAL_STEPS, `Whitelist vault token accounts (${vaultWhitelistNewCount} new)`, vaultWhitelistNewCount > 0 ? "done" : "SKIPPED");

  // =========================================================================
  // Step 10: Seed Vault + Burn Mint Authority
  // =========================================================================
  stepNum = 10;
  log.section("Step 10: Seed Vault + Burn Mint Authority");

  const seedingPlan = [
    { name: "CRIME",  source: adminCrimeAccount,  dest: vaultCrime,  mint: crimeMint,  amount: VAULT_SEED_CRIME },
    { name: "FRAUD",  source: adminFraudAccount,  dest: vaultFraud,  mint: fraudMint,  amount: VAULT_SEED_FRAUD },
    { name: "PROFIT", source: adminProfitAccount, dest: vaultProfit, mint: profitMint, amount: VAULT_SEED_PROFIT },
  ];

  for (const { name, source, dest, mint, amount } of seedingPlan) {
    // Check if already seeded
    try {
      const acct = await getAccount(connection, dest, "confirmed", TOKEN_2022_PROGRAM_ID);
      if (Number(acct.amount) > 0) {
        log.info(`  Vault ${name} already seeded (${acct.amount} tokens)`);
        skipped++;
        continue;
      }
    } catch { /* account exists but empty or not found, proceed */ }

    // Build transfer_checked with hook remaining_accounts
    const transferIx = createTransferCheckedInstruction(
      source, mint, dest, authority.publicKey, amount, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID
    );

    // Append hook accounts (4 per transfer)
    const [extraMeta] = PublicKey.findProgramAddressSync(
      [EXTRA_ACCOUNT_META_SEED, mint.toBuffer()], hookProgramId
    );
    const [wlSource] = deriveWhitelistEntryPDA(source, hookProgramId);
    const [wlDest] = deriveWhitelistEntryPDA(dest, hookProgramId);
    transferIx.keys.push(
      { pubkey: extraMeta, isSigner: false, isWritable: false },
      { pubkey: wlSource, isSigner: false, isWritable: false },
      { pubkey: wlDest, isSigner: false, isWritable: false },
      { pubkey: hookProgramId, isSigner: false, isWritable: false },
    );

    const tx = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    log.info(`  Seeded vault ${name}: ${amount / 10 ** TOKEN_DECIMALS}M tokens (${sig.slice(0, 12)}...)`);
    completed++;
  }

  // Burn mint authority for all 3 mints (set to null — irreversible!)
  for (const { name, kp } of mintKeypairs) {
    // Check if authority already burned
    const mintInfo = await connection.getAccountInfo(kp.publicKey);
    if (mintInfo) {
      // Token-2022 mint layout: bytes 0-3 = COption<Pubkey> for mint_authority
      // Byte 0: 0 = None, 1 = Some
      const hasAuthority = mintInfo.data[0] === 1;
      if (!hasAuthority) {
        log.info(`  ${name} mint authority already burned`);
        skipped++;
        continue;
      }
    }

    const burnIx = createSetAuthorityInstruction(
      kp.publicKey,          // mint
      authority.publicKey,   // current authority
      AuthorityType.MintTokens,
      null,                  // new authority = null
      [],                    // multiSigners
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new Transaction().add(burnIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    log.info(`  ${name} mint authority burned (${sig.slice(0, 12)}...)`);
    completed++;
  }

  log.step(stepNum, TOTAL_STEPS, "Seed vault + burn mint authority", "done");

  // =========================================================================
  // Step 11: Whitelist pool vault addresses — SKIPPED (moved to graduation)
  //
  // Pool vaults are whitelisted during graduation after pool creation.
  // The whitelist authority is NOT burned during init to allow this.
  // =========================================================================
  stepNum = 11;
  log.section("Step 11: Whitelist Pool Vault Addresses — SKIPPED (moved to graduation)");
  log.info("  Pool vault whitelisting happens during graduation after pool creation.");
  skipped++;

  // =========================================================================
  // Step 12: Initialize EpochState
  // =========================================================================
  stepNum = 12;
  log.section("Step 12: Initialize EpochState");

  const [epochState] = PublicKey.findProgramAddressSync(
    [EPOCH_STATE_SEED],
    epochProgramId
  );

  if (await accountExists(connection, epochState)) {
    // Ownership verification: check account is owned by the expected program
    const epochStateInfo = await connection.getAccountInfo(epochState);
    if (epochStateInfo && !epochStateInfo.owner.equals(epochProgramId)) {
      throw new Error(
        `SECURITY: EpochState exists but owned by ${epochStateInfo.owner.toBase58()}, ` +
        `expected ${epochProgramId.toBase58()}. Possible front-run attack.`
      );
    }
    log.step(stepNum, TOTAL_STEPS, "Initialize EpochState", "SKIPPED");
    log.info("  EpochState exists with correct program owner, skipping.");
    skipped++;
  } else {
    const sig = await programs.epochProgram.methods
      .initializeEpochState()
      .accountsStrict({
        payer: authority.publicKey,
        epochState,
        program: epochProgramId,
        programData: epochProgramDataPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Initialize EpochState", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 13: Initialize StakePool (with dead stake)
  // =========================================================================
  stepNum = 13;
  log.section("Step 13: Initialize StakePool");

  const [stakePool] = PublicKey.findProgramAddressSync(
    [STAKE_POOL_SEED],
    stakingProgramId
  );
  const [escrowVault] = PublicKey.findProgramAddressSync(
    [ESCROW_VAULT_SEED],
    stakingProgramId
  );
  const [stakeVault] = PublicKey.findProgramAddressSync(
    [STAKE_VAULT_SEED],
    stakingProgramId
  );

  if (await accountExists(connection, stakePool)) {
    // Ownership verification: check account is owned by the expected program
    const stakePoolInfo = await connection.getAccountInfo(stakePool);
    if (stakePoolInfo && !stakePoolInfo.owner.equals(stakingProgramId)) {
      throw new Error(
        `SECURITY: StakePool exists but owned by ${stakePoolInfo.owner.toBase58()}, ` +
        `expected ${stakingProgramId.toBase58()}. Possible front-run attack.`
      );
    }
    log.step(stepNum, TOTAL_STEPS, "Initialize StakePool", "SKIPPED");
    log.info("  StakePool exists with correct program owner, skipping.");
    skipped++;
  } else {
    // Build Transfer Hook remaining_accounts for the dead stake transfer.
    // The dead stake goes: adminProfitAccount -> stakeVault (PROFIT mint).
    // stakeVault doesn't exist yet (created by this instruction), but we can
    // derive its PDA address deterministically.
    const [profitExtraAccountMetaList] = PublicKey.findProgramAddressSync(
      [EXTRA_ACCOUNT_META_SEED, profitMint.toBuffer()],
      hookProgramId
    );

    const [whitelistSourceForInit] = deriveWhitelistEntryPDA(
      adminProfitAccount,
      hookProgramId
    );
    const [whitelistDestForInit] = deriveWhitelistEntryPDA(
      stakeVault,
      hookProgramId
    );

    const deadStakeHookAccounts = [
      { pubkey: profitExtraAccountMetaList, isSigner: false, isWritable: false },
      { pubkey: whitelistSourceForInit, isSigner: false, isWritable: false },
      { pubkey: whitelistDestForInit, isSigner: false, isWritable: false },
      { pubkey: hookProgramId, isSigner: false, isWritable: false },
    ];

    const sig = await programs.staking.methods
      .initializeStakePool()
      .accountsStrict({
        authority: authority.publicKey,
        stakePool,
        escrowVault,
        stakeVault,
        authorityTokenAccount: adminProfitAccount,
        profitMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        program: stakingProgramId,
        programData: stakingProgramDataPda,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(deadStakeHookAccounts)
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, `Initialize StakePool (dead stake: ${MINIMUM_STAKE})`, "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 14: Whitelist StakeVault
  // =========================================================================
  stepNum = 14;
  log.section("Step 14: Whitelist StakeVault");

  const [stakeVaultWhitelistEntry] = deriveWhitelistEntryPDA(stakeVault, hookProgramId);

  if (await accountExists(connection, stakeVaultWhitelistEntry)) {
    log.step(stepNum, TOTAL_STEPS, "Whitelist StakeVault", "SKIPPED");
    skipped++;
  } else {
    const sig = await programs.transferHook.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: authority.publicKey,
        whitelistAuthority,
        whitelistEntry: stakeVaultWhitelistEntry,
        addressToWhitelist: stakeVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Whitelist StakeVault", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 15: Initialize Carnage Fund + WSOL + Intermediary
  // =========================================================================
  stepNum = 15;
  log.section("Step 15: Initialize Carnage Fund + WSOL + Intermediary");

  // --- Carnage Fund ---
  const [carnageState] = PublicKey.findProgramAddressSync(
    [CARNAGE_FUND_SEED],
    epochProgramId
  );
  const [carnageSolVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_SOL_VAULT_SEED],
    epochProgramId
  );
  const [carnageCrimeVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_CRIME_VAULT_SEED],
    epochProgramId
  );
  const [carnageFraudVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_FRAUD_VAULT_SEED],
    epochProgramId
  );

  if (await accountExists(connection, carnageState)) {
    // Ownership verification: check account is owned by the expected program
    const carnageStateInfo = await connection.getAccountInfo(carnageState);
    if (carnageStateInfo && !carnageStateInfo.owner.equals(epochProgramId)) {
      throw new Error(
        `SECURITY: CarnageFundState exists but owned by ${carnageStateInfo.owner.toBase58()}, ` +
        `expected ${epochProgramId.toBase58()}. Possible front-run attack.`
      );
    }
    log.info("  Carnage Fund already initialized with correct program owner, skipping.");
    skipped++;
  } else {
    const sig = await programs.epochProgram.methods
      .initializeCarnageFund()
      .accountsStrict({
        authority: authority.publicKey,
        carnageState,
        solVault: carnageSolVault,
        crimeVault: carnageCrimeVault,
        fraudVault: carnageFraudVault,
        crimeMint,
        fraudMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        program: epochProgramId,
        programData: epochProgramDataPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.info(`  Carnage Fund initialized (${sig.slice(0, 12)}...)`);
    completed++;
  }

  // --- Carnage WSOL Account (CarnageSigner PDA-owned) ---
  // This WSOL account is used by execute_carnage_atomic for the swap_exempt CPI.
  // Must use explicit Keypair because ATA rejects off-curve (PDA) owners.
  // Owner = CarnageSigner PDA, token program = TOKEN_PROGRAM_ID (SPL Token, NOT Token-2022).
  // Fund with 0 lamports initial (actual SOL funded per-swap from sol_vault).

  const carnageWsolKeypairPath = path.resolve(__dirname, "../../keypairs/carnage-wsol.json");

  // Load or generate WSOL keypair (idempotent -- persisted to keypairs/carnage-wsol.json)
  let carnageWsolKeypair: Keypair;
  if (fs.existsSync(carnageWsolKeypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(carnageWsolKeypairPath, "utf8"));
    carnageWsolKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    log.info(`  Loaded existing Carnage WSOL keypair: ${carnageWsolKeypair.publicKey.toBase58()}`);
  } else {
    carnageWsolKeypair = Keypair.generate();
    fs.writeFileSync(carnageWsolKeypairPath, JSON.stringify(Array.from(carnageWsolKeypair.secretKey)), { mode: 0o600 });
    log.info(`  Generated new Carnage WSOL keypair: ${carnageWsolKeypair.publicKey.toBase58()}`);
  }

  // Derive CarnageSigner PDA (owner of the WSOL account)
  const [carnageSignerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("carnage_signer")],
    epochProgramId
  );
  log.info(`  CarnageSigner PDA: ${carnageSignerPda.toBase58()}`);

  // Check if the account already exists on-chain (idempotent)
  // IMPORTANT: Also validate the token-level owner matches the current CarnageSigner PDA.
  // After a clean deploy with new program IDs, the CarnageSigner PDA changes but the old
  // WSOL account (owned by the old PDA) may still exist on-chain. The existence check alone
  // is insufficient — we must verify owner correctness too. (Phase 95 bug: error 6026)
  let carnageWsolNeedsCreation = true;
  if (await accountExists(connection, carnageWsolKeypair.publicKey)) {
    try {
      const existingWsol = await getAccount(connection, carnageWsolKeypair.publicKey, "confirmed", TOKEN_PROGRAM_ID);
      if (existingWsol.owner.equals(carnageSignerPda)) {
        log.info(`  Carnage WSOL already exists with correct owner: ${carnageWsolKeypair.publicKey.toBase58()}`);
        carnageWsolNeedsCreation = false;
        skipped++;
      } else {
        log.info(
          `  WARNING: Carnage WSOL exists but has WRONG owner!\n` +
          `    Current owner: ${existingWsol.owner.toBase58()}\n` +
          `    Expected owner: ${carnageSignerPda.toBase58()}\n` +
          `  Generating new keypair and creating fresh WSOL account...`
        );
        // Generate a new keypair since the old address is occupied by a stale account
        carnageWsolKeypair = Keypair.generate();
        fs.writeFileSync(carnageWsolKeypairPath, JSON.stringify(Array.from(carnageWsolKeypair.secretKey)), { mode: 0o600 });
        log.info(`  New Carnage WSOL keypair: ${carnageWsolKeypair.publicKey.toBase58()}`);
      }
    } catch (e) {
      log.info(`  WARNING: Could not decode existing Carnage WSOL account, will recreate: ${e}`);
    }
  }
  if (carnageWsolNeedsCreation) {
    // Create WSOL account with CarnageSigner PDA as owner
    // Fund with 0 lamports initial (rent-exempt minimum is covered by createWrappedNativeAccount)
    const carnageWsolAccount = await createWrappedNativeAccount(
      connection,
      authority,                     // payer
      carnageSignerPda,             // owner (CarnageSigner PDA)
      0,                            // 0 lamports initial (funded per-swap from sol_vault)
      carnageWsolKeypair,           // explicit keypair (ATA rejects off-curve PDA owners)
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID              // WSOL uses SPL Token, NOT Token-2022
    );
    log.info(`  Carnage WSOL created: ${carnageWsolAccount.toBase58()}`);
    completed++;
  }

  // --- WSOL Intermediary (sell tax extraction account) ---
  const taxProgramId = programs.taxProgram.programId;
  const [wsolIntermediaryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("wsol_intermediary")],
    taxProgramId
  );
  const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_authority")],
    taxProgramId
  );
  log.info(`  WSOL Intermediary PDA: ${wsolIntermediaryPda.toBase58()}`);

  if (await accountExists(connection, wsolIntermediaryPda)) {
    log.info(`  WSOL Intermediary already exists: ${wsolIntermediaryPda.toBase58()}`);
    skipped++;
  } else {
    const sig = await programs.taxProgram.methods
      .initializeWsolIntermediary()
      .accountsStrict({
        admin: authority.publicKey,
        wsolIntermediary: wsolIntermediaryPda,
        swapAuthority: swapAuthorityPda,
        mint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        program: taxProgramIdForPda,
        programData: taxProgramDataPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.info(`  WSOL Intermediary initialized (${sig.slice(0, 12)}...)`);
    completed++;
  }

  log.step(stepNum, TOTAL_STEPS, "Initialize Carnage Fund + WSOL + Intermediary", "done");

  // =========================================================================
  // Step 16: Fund Carnage SOL + Whitelist Carnage Vaults
  // =========================================================================
  stepNum = 16;
  log.section("Step 16: Fund Carnage SOL + Whitelist Carnage Vaults");

  // --- Fund Carnage SOL vault with rent-exempt minimum ---
  const carnageSolBalance = await connection.getBalance(carnageSolVault);

  if (carnageSolBalance > 0) {
    log.info(`  Carnage SOL vault already funded: ${carnageSolBalance} lamports`);
    skipped++;
  } else {
    const rentExemptMinimum = await connection.getMinimumBalanceForRentExemption(0);
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: carnageSolVault,
        lamports: rentExemptMinimum,
      })
    );
    const sig = await sendAndConfirmTransaction(connection, fundTx, [authority]);
    log.info(`  Funded Carnage SOL vault: ${rentExemptMinimum} lamports (${sig.slice(0, 12)}...)`);
    completed++;
  }

  // --- Whitelist Carnage token vaults ---
  let carnageWhitelistCount = 0;
  for (const { name, vault } of [
    { name: "CRIME", vault: carnageCrimeVault },
    { name: "FRAUD", vault: carnageFraudVault },
  ]) {
    const [whitelistEntry] = deriveWhitelistEntryPDA(vault, hookProgramId);

    if (await accountExists(connection, whitelistEntry)) {
      log.info(`  Carnage ${name} vault already whitelisted`);
      skipped++;
      continue;
    }

    await programs.transferHook.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: authority.publicKey,
        whitelistAuthority,
        whitelistEntry,
        addressToWhitelist: vault,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    log.info(`  Carnage ${name} vault whitelisted`);
    carnageWhitelistCount++;
    completed++;
  }

  log.step(stepNum, TOTAL_STEPS, `Fund Carnage SOL + whitelist vaults (${carnageWhitelistCount} new)`, "done");

  } // End of if (!isPartial) block -- Steps 4-16

  // =========================================================================
  // Steps 17-25: Bonding Curve initialization (BcAdminConfig, curves, funding)
  //
  // Anti-sniper: Bonding curve deploys at Stage 5 (launch time), not Stage 2.
  // If the BC program isn't on-chain yet, skip Steps 17-25 entirely — they
  // will run when initialize.ts is called again during Stage 5 after BC deploy.
  // PDA derivations are unconditional (needed for manifest generation).
  // =========================================================================
  const bondingCurveProgramId = programs.bondingCurve.programId;
  const bcDeployed = await accountExists(connection, bondingCurveProgramId);

  if (!bcDeployed) {
    log.section("Steps 17-25: Bonding Curve — DEFERRED (anti-sniper)");
    log.info("  Bonding curve program not deployed yet. Steps 17-25 will run at Stage 5.");
    log.info("  PDA addresses are still derived for manifest generation.");
    for (let s = 17; s <= 25; s++) {
      skipped++;
    }
    stepNum = 25;
  }

  // -------------------------------------------------------------------------
  // PDA derivations for Steps 17-25 (unconditional — needed for manifest)
  // -------------------------------------------------------------------------
  const BC_ADMIN_SEED = Buffer.from("bc_admin");
  const [bcAdminConfig] = PublicKey.findProgramAddressSync(
    [BC_ADMIN_SEED], bondingCurveProgramId
  );
  const [bcProgramDataPda] = PublicKey.findProgramAddressSync(
    [bondingCurveProgramId.toBuffer()], BPF_LOADER_UPGRADEABLE
  );
  const [crimeCurveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, crimeMint.toBuffer()], bondingCurveProgramId
  );
  const [crimeTokenVault] = PublicKey.findProgramAddressSync(
    [CURVE_TOKEN_VAULT_SEED, crimeMint.toBuffer()], bondingCurveProgramId
  );
  const [crimeSolVault] = PublicKey.findProgramAddressSync(
    [CURVE_SOL_VAULT_SEED, crimeMint.toBuffer()], bondingCurveProgramId
  );
  const [crimeTaxEscrow] = PublicKey.findProgramAddressSync(
    [CURVE_TAX_ESCROW_SEED, crimeMint.toBuffer()], bondingCurveProgramId
  );
  const [fraudCurveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, fraudMint.toBuffer()], bondingCurveProgramId
  );
  const [fraudTokenVault] = PublicKey.findProgramAddressSync(
    [CURVE_TOKEN_VAULT_SEED, fraudMint.toBuffer()], bondingCurveProgramId
  );
  const [fraudSolVault] = PublicKey.findProgramAddressSync(
    [CURVE_SOL_VAULT_SEED, fraudMint.toBuffer()], bondingCurveProgramId
  );
  const [fraudTaxEscrow] = PublicKey.findProgramAddressSync(
    [CURVE_TAX_ESCROW_SEED, fraudMint.toBuffer()], bondingCurveProgramId
  );

  if (bcDeployed) {
  // =========================================================================
  // Step 17: Initialize BcAdminConfig (Bonding Curve admin PDA)
  //
  // Why here? BcAdminConfig must exist before any curve operations. It stores
  // the bonding curve admin authority (initially the deployer, later transferred
  // to a multisig). The `initializeBcAdmin` instruction can only be called by
  // the program's upgrade authority (verified via ProgramData).
  //
  // This closes DEPLOY-GAP-01: BcAdminConfig was previously a manual step
  // that could be forgotten, leaving curves without admin access control.
  // =========================================================================
  stepNum = 17;
  log.section("Step 17: Initialize BcAdminConfig");

  if (await accountExists(connection, bcAdminConfig)) {
    log.step(stepNum, TOTAL_STEPS, "Initialize BcAdminConfig", "SKIPPED");
    log.info("  BcAdminConfig already initialized, skipping");
    skipped++;
  } else {
    const sig = await programs.bondingCurve.methods
      .initializeBcAdmin(authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        adminConfig: bcAdminConfig,
        program: bondingCurveProgramId,
        programData: bcProgramDataPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Initialize BcAdminConfig", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 18: Initialize CRIME Curve
  // =========================================================================
  stepNum = 18;
  log.section("Step 18: Initialize CRIME Curve");

  if (await accountExists(connection, crimeCurveState)) {
    // Ownership verification: check account is owned by bonding curve program
    const crimeCurveInfo = await connection.getAccountInfo(crimeCurveState);
    if (crimeCurveInfo && !crimeCurveInfo.owner.equals(bondingCurveProgramId)) {
      throw new Error(
        `SECURITY: CRIME CurveState exists but owned by ${crimeCurveInfo.owner.toBase58()}, ` +
        `expected ${bondingCurveProgramId.toBase58()}. Possible front-run attack.`
      );
    }
    log.step(stepNum, TOTAL_STEPS, "Initialize CRIME curve", "SKIPPED");
    log.info("  CRIME CurveState exists with correct program owner, skipping.");
    skipped++;
  } else {
    const sig = await programs.bondingCurve.methods
      .initializeCurve({ crime: {} }, fraudMint)
      .accountsStrict({
        authority: authority.publicKey,
        adminConfig: bcAdminConfig,
        curveState: crimeCurveState,
        tokenVault: crimeTokenVault,
        solVault: crimeSolVault,
        taxEscrow: crimeTaxEscrow,
        tokenMint: crimeMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Initialize CRIME curve", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 19: Initialize FRAUD Curve
  // =========================================================================
  stepNum = 19;
  log.section("Step 19: Initialize FRAUD Curve");

  if (await accountExists(connection, fraudCurveState)) {
    // Ownership verification: check account is owned by bonding curve program
    const fraudCurveInfo = await connection.getAccountInfo(fraudCurveState);
    if (fraudCurveInfo && !fraudCurveInfo.owner.equals(bondingCurveProgramId)) {
      throw new Error(
        `SECURITY: FRAUD CurveState exists but owned by ${fraudCurveInfo.owner.toBase58()}, ` +
        `expected ${bondingCurveProgramId.toBase58()}. Possible front-run attack.`
      );
    }
    log.step(stepNum, TOTAL_STEPS, "Initialize FRAUD curve", "SKIPPED");
    log.info("  FRAUD CurveState exists with correct program owner, skipping.");
    skipped++;
  } else {
    const sig = await programs.bondingCurve.methods
      .initializeCurve({ fraud: {} }, crimeMint)
      .accountsStrict({
        authority: authority.publicKey,
        adminConfig: bcAdminConfig,
        curveState: fraudCurveState,
        tokenVault: fraudTokenVault,
        solVault: fraudSolVault,
        taxEscrow: fraudTaxEscrow,
        tokenMint: fraudMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Initialize FRAUD curve", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 20: Whitelist CRIME Curve Token Vault
  //
  // WHY before fund_curve? fund_curve transfers 460M tokens via Token-2022
  // transfer_checked, which triggers the Transfer Hook. If the vault isn't
  // whitelisted, Transfer Hook rejects with WhitelistCheckFailed (0x1770).
  // =========================================================================
  stepNum = 20;
  log.section("Step 20: Whitelist CRIME Curve Token Vault");

  const [crimeVaultWhitelistEntry] = deriveWhitelistEntryPDA(crimeTokenVault, hookProgramId);

  if (await accountExists(connection, crimeVaultWhitelistEntry)) {
    log.step(stepNum, TOTAL_STEPS, "Whitelist CRIME curve vault", "SKIPPED");
    skipped++;
  } else {
    const sig = await programs.transferHook.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: authority.publicKey,
        whitelistAuthority,
        whitelistEntry: crimeVaultWhitelistEntry,
        addressToWhitelist: crimeTokenVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Whitelist CRIME curve vault", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 21: Whitelist FRAUD Curve Token Vault
  // =========================================================================
  stepNum = 21;
  log.section("Step 21: Whitelist FRAUD Curve Token Vault");

  const [fraudVaultWhitelistEntry] = deriveWhitelistEntryPDA(fraudTokenVault, hookProgramId);

  if (await accountExists(connection, fraudVaultWhitelistEntry)) {
    log.step(stepNum, TOTAL_STEPS, "Whitelist FRAUD curve vault", "SKIPPED");
    skipped++;
  } else {
    const sig = await programs.transferHook.methods
      .addWhitelistEntry()
      .accountsStrict({
        authority: authority.publicKey,
        whitelistAuthority,
        whitelistEntry: fraudVaultWhitelistEntry,
        addressToWhitelist: fraudTokenVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    log.step(stepNum, TOTAL_STEPS, "Whitelist FRAUD curve vault", "done", sig);
    completed++;
  }

  // =========================================================================
  // Step 22: Fund CRIME Curve (460M tokens)
  //
  // Token supply math:
  //   Step 5 mints 1B CRIME to admin account
  //   Step 7 seeds pool with 290M CRIME (SOL_POOL_SEED_TOKEN)
  //   Step 10 seeds vault with 250M CRIME (VAULT_SEED_CRIME)
  //   Remaining: 1B - 290M - 250M = 460M CRIME
  //
  // The fund_curve on-chain instruction transfers exactly TARGET_TOKENS
  // (460M * 10^6) from authority's token account to the curve vault.
  // Transfer Hook remaining_accounts are required (4 accounts per mint).
  // =========================================================================
  stepNum = 22;
  log.section("Step 22: Fund CRIME Curve (460M tokens)");

  {
    // Check if already funded (vault has tokens)
    const crimeVaultInfo = await getAccount(
      connection, crimeTokenVault, "confirmed", TOKEN_2022_PROGRAM_ID
    ).catch(() => null);

    if (crimeVaultInfo && Number(crimeVaultInfo.amount) > 0) {
      log.step(stepNum, TOTAL_STEPS, "Fund CRIME curve", "SKIPPED");
      log.info(`  Vault already funded: ${Number(crimeVaultInfo.amount) / 1e6} tokens`);
      skipped++;
    } else {
      // Verify admin has enough tokens for curve funding
      const curveAllocation = 460_000_000_000_000; // 460M * 10^6
      const adminCrimeInfo = await getAccount(
        connection, adminCrimeAccount, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      const adminBalance = Number(adminCrimeInfo.amount);
      if (adminBalance < curveAllocation) {
        log.error(`Admin CRIME balance too low for curve: ${adminBalance / 1e6} < 460,000,000`);
        log.error(`Expected 460M tokens remaining after pool (290M) + vault (250M) seeding.`);
        process.exit(1);
      }

      // Build Transfer Hook remaining_accounts (4 accounts per mint)
      const [crimeExtraMeta] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, crimeMint.toBuffer()], hookProgramId
      );
      const [crimeWlSource] = deriveWhitelistEntryPDA(adminCrimeAccount, hookProgramId);
      const [crimeWlDest] = deriveWhitelistEntryPDA(crimeTokenVault, hookProgramId);
      const crimeHookAccounts = [
        { pubkey: crimeExtraMeta, isSigner: false, isWritable: false },
        { pubkey: crimeWlSource, isSigner: false, isWritable: false },
        { pubkey: crimeWlDest, isSigner: false, isWritable: false },
        { pubkey: hookProgramId, isSigner: false, isWritable: false },
      ];

      const sig = await programs.bondingCurve.methods
        .fundCurve()
        .accountsStrict({
          authority: authority.publicKey,
          adminConfig: bcAdminConfig,
          curveState: crimeCurveState,
          authorityTokenAccount: adminCrimeAccount,
          tokenVault: crimeTokenVault,
          tokenMint: crimeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(crimeHookAccounts)
        .signers([authority])
        .rpc();
      log.step(stepNum, TOTAL_STEPS, "Fund CRIME curve (460M tokens)", "done", sig);
      completed++;
    }
  }

  // =========================================================================
  // Step 23: Fund FRAUD Curve (460M tokens)
  // =========================================================================
  stepNum = 23;
  log.section("Step 23: Fund FRAUD Curve (460M tokens)");

  {
    // Check if already funded (vault has tokens)
    const fraudVaultInfo = await getAccount(
      connection, fraudTokenVault, "confirmed", TOKEN_2022_PROGRAM_ID
    ).catch(() => null);

    if (fraudVaultInfo && Number(fraudVaultInfo.amount) > 0) {
      log.step(stepNum, TOTAL_STEPS, "Fund FRAUD curve", "SKIPPED");
      log.info(`  Vault already funded: ${Number(fraudVaultInfo.amount) / 1e6} tokens`);
      skipped++;
    } else {
      // Verify admin has enough tokens for curve funding
      const curveAllocation = 460_000_000_000_000; // 460M * 10^6
      const adminFraudInfo = await getAccount(
        connection, adminFraudAccount, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      const adminBalance = Number(adminFraudInfo.amount);
      if (adminBalance < curveAllocation) {
        log.error(`Admin FRAUD balance too low for curve: ${adminBalance / 1e6} < 460,000,000`);
        log.error(`Expected 460M tokens remaining after pool (290M) + vault (250M) seeding.`);
        process.exit(1);
      }

      // Build Transfer Hook remaining_accounts (4 accounts per mint)
      const [fraudExtraMeta] = PublicKey.findProgramAddressSync(
        [EXTRA_ACCOUNT_META_SEED, fraudMint.toBuffer()], hookProgramId
      );
      const [fraudWlSource] = deriveWhitelistEntryPDA(adminFraudAccount, hookProgramId);
      const [fraudWlDest] = deriveWhitelistEntryPDA(fraudTokenVault, hookProgramId);
      const fraudHookAccounts = [
        { pubkey: fraudExtraMeta, isSigner: false, isWritable: false },
        { pubkey: fraudWlSource, isSigner: false, isWritable: false },
        { pubkey: fraudWlDest, isSigner: false, isWritable: false },
        { pubkey: hookProgramId, isSigner: false, isWritable: false },
      ];

      const sig = await programs.bondingCurve.methods
        .fundCurve()
        .accountsStrict({
          authority: authority.publicKey,
          adminConfig: bcAdminConfig,
          curveState: fraudCurveState,
          authorityTokenAccount: adminFraudAccount,
          tokenVault: fraudTokenVault,
          tokenMint: fraudMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(fraudHookAccounts)
        .signers([authority])
        .rpc();
      log.step(stepNum, TOTAL_STEPS, "Fund FRAUD curve (460M tokens)", "done", sig);
      completed++;
    }
  }

  // =========================================================================
  // LAUNCH GATE — Manual confirmation before starting curves
  //
  // Steps 17-23 are complete: BcAdminConfig initialized, curves created,
  // vaults whitelisted, curves funded with 460M tokens each.
  //
  // Steps 24-25 (startCurve) make curves LIVE for public buying.
  // This is the point of no return. Require explicit confirmation.
  // =========================================================================
  log.section("LAUNCH GATE: Curves funded and ready");
  log.info("");
  log.info("  ╔══════════════════════════════════════════════════════════════╗");
  log.info("  ║  ALL PRE-LAUNCH STEPS COMPLETE                              ║");
  log.info("  ║                                                              ║");
  log.info("  ║  Steps 17-23: BcAdmin, curves, whitelist, funding — DONE    ║");
  log.info("  ║  Steps 24-25: startCurve() — WAITING FOR CONFIRMATION       ║");
  log.info("  ║                                                              ║");
  log.info("  ║  After this, bonding curves are LIVE for public buying.      ║");
  log.info("  ║  This cannot be undone.                                      ║");
  log.info("  ╚══════════════════════════════════════════════════════════════╝");
  log.info("");

  const rl = await import("readline");
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    iface.question("  Type LAUNCH to start curves, or Ctrl+C to abort: ", resolve);
  });
  iface.close();

  if (answer.trim() !== "LAUNCH") {
    log.info("");
    log.info("  Aborted. Curves are funded but NOT started.");
    log.info("  Re-run initialize.ts when ready — it will resume from Step 24.");
    process.exit(0);
  }

  log.info("");
  log.info("  LAUNCHING...");
  log.info("");

  // =========================================================================
  // Step 24: Start CRIME Curve
  //
  // Sets status to Active, records start_slot and deadline_slot.
  // On-chain: validates token vault has >= TARGET_TOKENS (460M) before
  // activation, and requires status == Initialized.
  // =========================================================================
  stepNum = 24;
  log.section("Step 24: Start CRIME Curve");

  {
    // Idempotent check: if curve is no longer in Initialized status, it's
    // already been started (Active, Filled, Graduated, or Failed). Skip.
    const crimeCurveData = await programs.bondingCurve.account.curveState.fetch(
      crimeCurveState
    ).catch(() => null);

    if (crimeCurveData && !("initialized" in crimeCurveData.status)) {
      log.step(stepNum, TOTAL_STEPS, "Start CRIME curve", "SKIPPED");
      log.info(`  Curve already started (status: ${JSON.stringify(crimeCurveData.status)})`);
      skipped++;
    } else {
      const sig = await programs.bondingCurve.methods
        .startCurve()
        .accountsStrict({
          authority: authority.publicKey,
          adminConfig: bcAdminConfig,
          curveState: crimeCurveState,
          tokenVault: crimeTokenVault,
          tokenMint: crimeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      log.step(stepNum, TOTAL_STEPS, "Start CRIME curve", "done", sig);
      completed++;
    }
  }

  // =========================================================================
  // Step 25: Start FRAUD Curve
  // =========================================================================
  stepNum = 25;
  log.section("Step 25: Start FRAUD Curve");

  {
    const fraudCurveData = await programs.bondingCurve.account.curveState.fetch(
      fraudCurveState
    ).catch(() => null);

    if (fraudCurveData && !("initialized" in fraudCurveData.status)) {
      log.step(stepNum, TOTAL_STEPS, "Start FRAUD curve", "SKIPPED");
      log.info(`  Curve already started (status: ${JSON.stringify(fraudCurveData.status)})`);
      skipped++;
    } else {
      const sig = await programs.bondingCurve.methods
        .startCurve()
        .accountsStrict({
          authority: authority.publicKey,
          adminConfig: bcAdminConfig,
          curveState: fraudCurveState,
          tokenVault: fraudTokenVault,
          tokenMint: fraudMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      log.step(stepNum, TOTAL_STEPS, "Start FRAUD curve", "done", sig);
      completed++;
    }
  }
  } // End of if (bcDeployed) block — Steps 17-25

  // =========================================================================
  // Step 26: Burn Whitelist Authority — SKIPPED (moved to graduation)
  //
  // Whitelist authority burn is now the FINAL step of graduation, not init.
  // This is because AMM pool vaults must be whitelisted during graduation
  // (after pools are created with dynamic SOL from curve vaults).
  //
  // Whitelist entries at init time (11 total):
  //   Step 6:  3 admin T22 accounts (CRIME, FRAUD, PROFIT)
  //   Step 9:  3 conversion vault accounts (CRIME, FRAUD, PROFIT)
  //   Step 14: 1 stake vault
  //   Step 16: 2 carnage vaults (CRIME, FRAUD)
  //   Step 20: 1 CRIME curve token vault
  //   Step 21: 1 FRAUD curve token vault
  //   -------
  //   Total:  11 whitelist entries
  //
  // Graduation adds:
  //   4 pool vault accounts (2 pools x 2 vaults)
  //   Then burns whitelist authority (IRREVERSIBLE)
  // =========================================================================
  stepNum = 26;
  log.section("Step 26: Burn Whitelist Authority — SKIPPED (moved to graduation)");
  log.info("  Whitelist authority burn happens during graduation after pool vault whitelisting.");
  log.info("  This ensures pool vaults can be whitelisted with correct SOL amounts.");
  skipped++;

  // =========================================================================
  // Step 27: Generate PDA Manifest
  // =========================================================================
  stepNum = 27;
  log.section("Step 27: Generate PDA Manifest");

  const manifest = generateManifest(
    {
      amm: ammProgramId,
      transferHook: hookProgramId,
      taxProgram: programs.taxProgram.programId,
      epochProgram: epochProgramId,
      staking: stakingProgramId,
      conversionVault: vaultProgramId,
      bondingCurve: bondingCurveProgramId,
    },
    { crime: crimeMint, fraud: fraudMint, profit: profitMint },
    clusterUrl
  );

  writeManifest(manifest);
  log.step(stepNum, TOTAL_STEPS, "Generate PDA manifest", "done");
  completed++;

  const manifestDir = path.resolve(__dirname);
  log.info(`  JSON: ${path.join(manifestDir, "pda-manifest.json")}`);
  log.info(`  MD:   ${path.join(manifestDir, "pda-manifest.md")}`);

  // =========================================================================
  // Step 27b: Write deployments/{cluster}.json
  //
  // The deployment config is the canonical source of truth for all protocol
  // addresses. It extends the PDA manifest with schemaVersion, bonding curve
  // PDAs, hook accounts, ALT, treasury, and authority tracking.
  // =========================================================================
  log.section("Step 26b: Write deployments/{cluster}.json");

  // Determine cluster from CLUSTER_URL
  const deployCluster = clusterUrl.includes("mainnet") ? "mainnet" : "devnet";

  // Read ALT address if available
  const altAddressPath = path.join(__dirname, "alt-address.json");
  let altAddress: string | null = null;
  if (fs.existsSync(altAddressPath)) {
    try {
      const altData = JSON.parse(fs.readFileSync(altAddressPath, "utf8"));
      altAddress = altData.altAddress || null;
    } catch {
      log.info("  Warning: Could not read alt-address.json, ALT will be null");
    }
  }

  const deployerAddress = authority.publicKey.toBase58();
  const treasuryAddress = process.env.TREASURY_PUBKEY || deployerAddress;

  const deploymentConfig = generateDeploymentConfig(
    deployCluster,
    {
      amm: ammProgramId,
      transferHook: hookProgramId,
      taxProgram: programs.taxProgram.programId,
      epochProgram: epochProgramId,
      staking: stakingProgramId,
      conversionVault: vaultProgramId,
      bondingCurve: bondingCurveProgramId,
    },
    { crime: crimeMint, fraud: fraudMint, profit: profitMint },
    altAddress,
    treasuryAddress,
    deployerAddress,
  );

  // Validate before writing
  const configErrors = validateDeploymentConfig(deploymentConfig);
  if (configErrors.length > 0) {
    log.error("Deployment config validation failed:");
    for (const err of configErrors) {
      log.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // Write to deployments/{cluster}.json
  const deploymentsDir = path.resolve(__dirname, "../..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const deploymentJsonPath = path.join(deploymentsDir, `${deployCluster}.json`);
  fs.writeFileSync(deploymentJsonPath, JSON.stringify(deploymentConfig, null, 2) + "\n");

  log.info(`Wrote ${deploymentJsonPath}`);

  // =========================================================================
  // Summary
  // =========================================================================
  log.section(isPartial ? "Partial Initialization Complete" : "Protocol Initialization Complete");
  log.info(`Steps:     ${TOTAL_STEPS}`);
  log.info(`Completed: ${completed}`);
  log.info(`Skipped:   ${skipped}`);
  log.info(`Tx log:    ${log.getLogPath()}`);
  log.info(`Manifest:  ${path.join(manifestDir, "pda-manifest.json")}`);
  log.info("");
  log.info("Mints:");
  log.info(`  CRIME:  ${crimeMint.toBase58()}`);
  log.info(`  FRAUD:  ${fraudMint.toBase58()}`);
  if (!isPartial) {
    log.info(`  PROFIT: ${profitMint.toBase58()}`);
  }
  log.info("");
  log.info("Key PDAs:");
  log.info(`  BcAdminConfig:      ${bcAdminConfig.toBase58()}`);
  log.info(`  WhitelistAuthority: ${whitelistAuthority.toBase58()}`);
  log.info(`  CrimeCurve:         ${crimeCurveState.toBase58()}`);
  log.info(`  FraudCurve:         ${fraudCurveState.toBase58()}`);
}

main().catch((err) => {
  console.error("\n=== Protocol Initialization FAILED ===");
  console.error("Error:", err.message || err);
  if (err.logs) {
    console.error("Program logs:");
    for (const log of err.logs) {
      console.error("  ", log);
    }
  }
  process.exit(1);
});
