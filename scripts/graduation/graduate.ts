/**
 * Graduation Orchestration Script
 *
 * Runs after both bonding curves fill (~460M tokens sold per curve).
 * Transitions the protocol from bonding curve phase to fully operational AMM trading.
 *
 * This is a MANUAL admin operation, NOT automated. The admin runs this script
 * when they observe both curves have reached Filled status.
 *
 * Checkpoint+resume: Each step saves progress to graduation-state.json.
 * If the script fails mid-way, re-running picks up from the last completed step.
 * This is critical because each step involves real SOL and tokens.
 *
 * Full sequence:
 *   1.  Verify both curves are Filled
 *   2.  prepare_transition (both curves: Filled -> Graduated)
 *   3.  Withdraw SOL from CRIME curve vault (~500 SOL, dynamic)
 *   4.  Withdraw SOL from FRAUD curve vault (~500 SOL, dynamic)
 *   5.  Close CRIME token vault (recover rent, vault should be empty)
 *   6.  Close FRAUD token vault (recover rent)
 *   7.  Create CRIME/SOL AMM pool (290M CRIME + withdrawn SOL)
 *   8.  Create FRAUD/SOL AMM pool (290M FRAUD + withdrawn SOL)
 *   9.  Whitelist pool vault addresses on Transfer Hook
 *   10. Seed Conversion Vault (250M CRIME + 250M FRAUD + 20M PROFIT)
 *   11. Distribute CRIME tax escrow to carnage fund
 *   12. Distribute FRAUD tax escrow to carnage fund
 *   13. Skip whitelist authority burn (retained -- transfers to Squads multisig at Stage 7)
 *
 * Usage:
 *   source .env && npx tsx scripts/graduation/graduate.ts
 *
 * Prerequisites:
 *   - Both curves must be in Filled status
 *   - Admin wallet must hold 290M CRIME, 290M FRAUD (reserved at deploy time for pool seeding)
 *   - Admin wallet must hold 250M CRIME, 250M FRAUD, 20M PROFIT (vault reserves)
 *   - .env sourced with correct CLUSTER_URL and WALLET
 *
 * Pool seeding is DYNAMIC: after withdrawing SOL from each curve vault, the
 * actual withdrawn amount (tracked via balance delta) is used to seed the
 * corresponding AMM pool. No hardcoded SOL amount. SOL_POOL_SEED_SOL_OVERRIDE
 * env var still works as an emergency override.
 *
 * IRREVERSIBLE: prepare_transition (step 2) transitions curves to Graduated,
 * which is a terminal state. Once started, graduation must be completed.
 *
 * Source: .planning/phases/74-protocol-integration/74-04-PLAN.md
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createWrappedNativeAccount,
  getAccount,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Shared deployment library
import { loadProvider, loadPrograms, Programs } from "../deploy/lib/connection";
import { createLogger, Logger } from "../deploy/lib/logger";
import { accountExists } from "../deploy/lib/account-check";
import { canonicalOrder } from "../deploy/lib/pda-manifest";

// PDA seed constants and derivation helpers from canonical source
import {
  TOKEN_DECIMALS,
  SOL_POOL_FEE_BPS,
  ADMIN_SEED,
  WHITELIST_AUTHORITY_SEED,
  WHITELIST_ENTRY_SEED,
  EXTRA_ACCOUNT_META_SEED,
  CARNAGE_SOL_VAULT_SEED,
  derivePoolPDA,
  deriveVaultPDAs,
  deriveWhitelistEntryPDA,
} from "../../tests/integration/helpers/constants";

// =============================================================================
// ANSI Colors (match logger.ts pattern)
// =============================================================================

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// =============================================================================
// Graduation Constants
//
// Token amounts are HARDCODED (Phase 69 lesson: .env defaults are dangerous).
// SOL amounts are DYNAMIC -- determined by actual vault withdrawal balance delta.
// SOL_POOL_SEED_SOL_OVERRIDE env var is available as emergency override.
// =============================================================================

/** Tokens per AMM pool: 290M at 6 decimals (tokens left after 460M sold + 250M vault) */
const GRADUATION_POOL_SEED_TOKEN = Number(process.env.SOL_POOL_SEED_TOKEN_OVERRIDE)
  || 290_000_000_000_000; // 290M * 10^6

/** Emergency SOL override for pool seeding (env var). If set, uses this instead of dynamic amount. */
const SOL_POOL_SEED_SOL_OVERRIDE = process.env.SOL_POOL_SEED_SOL_OVERRIDE
  ? Number(process.env.SOL_POOL_SEED_SOL_OVERRIDE)
  : undefined;

/** Sanity-check minimum: pool must be seeded with at least 1 SOL. Catches bugs/empty vaults. */
const MIN_POOL_SEED_SOL = 1 * LAMPORTS_PER_SOL;

/** Conversion Vault seeding: 250M CRIME at 6 decimals */
const VAULT_SEED_CRIME = 250_000_000_000_000;

/** Conversion Vault seeding: 250M FRAUD at 6 decimals */
const VAULT_SEED_FRAUD = 250_000_000_000_000;

/** Conversion Vault seeding: 20M PROFIT at 6 decimals */
const VAULT_SEED_PROFIT = 20_000_000_000_000;

/** Vault PDA seeds (match conversion-vault on-chain constants) */
const VAULT_CONFIG_SEED = Buffer.from("vault_config");
const VAULT_CRIME_SEED = Buffer.from("vault_crime");
const VAULT_FRAUD_SEED = Buffer.from("vault_fraud");
const VAULT_PROFIT_SEED = Buffer.from("vault_profit");

/** Bonding curve PDA seeds (match bonding_curve on-chain constants) */
const CURVE_SEED = Buffer.from("curve");
const CURVE_TOKEN_VAULT_SEED = Buffer.from("curve_token_vault");
const CURVE_SOL_VAULT_SEED = Buffer.from("curve_sol_vault");
const TAX_ESCROW_SEED = Buffer.from("tax_escrow");
const BC_ADMIN_SEED = Buffer.from("bc_admin");

// =============================================================================
// Checkpoint+Resume State
// =============================================================================

interface StepState {
  name: string;
  completed: boolean;
  txSig?: string;
  timestamp?: string;
  error?: string;
}

interface GraduationState {
  startedAt: string;
  steps: StepState[];
  /** SOL withdrawn from CRIME curve vault (lamports). Set after withdraw_crime_sol. */
  crimeWithdrawn?: number;
  /** SOL withdrawn from FRAUD curve vault (lamports). Set after withdraw_fraud_sol. */
  fraudWithdrawn?: number;
}

const STATE_FILE = path.resolve(__dirname, "graduation-state.json");

const STEP_NAMES = [
  "verify_curves_filled",
  "prepare_transition",
  "withdraw_crime_sol",
  "withdraw_fraud_sol",
  "close_crime_token_vault",
  "close_fraud_token_vault",
  "create_crime_sol_pool",
  "create_fraud_sol_pool",
  "whitelist_pool_vaults",
  "seed_conversion_vault",
  "distribute_crime_tax_escrow",
  "distribute_fraud_tax_escrow",
  "burn_whitelist_authority",
];

/**
 * Load existing graduation state from disk, or create a fresh one.
 *
 * Why checkpoint+resume instead of idempotent re-check?
 * - 74-CONTEXT.md decision: explicit progress tracking for high-stakes operations
 * - Each step involves real SOL (~500 SOL per curve withdrawal)
 * - Resume from failure point is faster than re-checking all on-chain state
 * - State file provides an audit trail of what happened and when
 * - Stores withdrawn SOL amounts for pool seeding on resume
 */
function loadState(): GraduationState {
  if (fs.existsSync(STATE_FILE)) {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const state: GraduationState = JSON.parse(raw);
    console.log(`${DIM}  Resuming from existing state (started ${state.startedAt})${RESET}`);
    return state;
  }

  const state: GraduationState = {
    startedAt: new Date().toISOString(),
    steps: STEP_NAMES.map((name) => ({
      name,
      completed: false,
    })),
  };
  saveState(state);
  return state;
}

function saveState(state: GraduationState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// =============================================================================
// Mint Discovery
// =============================================================================

/**
 * Load mint keypairs from the deployment directory.
 *
 * These are the same keypairs generated by initialize.ts (Step 1) and
 * persisted to scripts/deploy/mint-keypairs/. The graduation script needs
 * them to derive PDAs for curve state, token vaults, etc.
 */
function loadMintKeypair(name: string): Keypair {
  const filePath = path.resolve(__dirname, `../deploy/mint-keypairs/${name}-mint.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Mint keypair not found: ${filePath}\n` +
      `Expected to find mint keypairs from the deployment phase.\n` +
      `Ensure scripts/deploy/mint-keypairs/ contains ${name}-mint.json`
    );
  }
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

/**
 * Find the admin's token account for a given mint by scanning all token accounts.
 *
 * Why scan rather than derive ATA? initialize.ts creates token accounts with
 * fresh keypairs (not ATAs) because ATA rejects re-creation for Token-2022 mints.
 * We must discover the actual account addresses by querying the chain.
 *
 * Returns the account with the highest balance for this mint (admin may have
 * multiple accounts from different init runs).
 */
async function findAdminTokenAccount(
  connection: anchor.web3.Connection,
  adminPubkey: PublicKey,
  mint: PublicKey,
  label: string,
): Promise<PublicKey> {
  const accounts = await connection.getTokenAccountsByOwner(adminPubkey, {
    mint,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  if (accounts.value.length === 0) {
    throw new Error(
      `No ${label} token account found for admin ${adminPubkey.toBase58()}\n` +
      `Mint: ${mint.toBase58()}\n` +
      `Admin must hold reserved tokens from deploy-time initialization.`
    );
  }

  // Pick the account with the highest balance
  let bestAccount = accounts.value[0].pubkey;
  let bestBalance = BigInt(0);

  for (const { pubkey, account } of accounts.value) {
    // Token-2022 account data: amount is at offset 64, 8 bytes LE
    const amount = account.data.readBigUInt64LE(64);
    if (amount > bestBalance) {
      bestBalance = amount;
      bestAccount = pubkey;
    }
  }

  console.log(`  ${label} admin token account: ${bestAccount.toBase58()} (balance: ${Number(bestBalance) / 10 ** TOKEN_DECIMALS})`);
  return bestAccount;
}

// =============================================================================
// Step Implementations
// =============================================================================

/**
 * Step 1: Verify both curves are Filled (or already Graduated from a partial resume).
 *
 * This is a verification-only step (no on-chain transaction). We read both
 * CurveState accounts and check their status field. If either is not Filled
 * or Graduated, we abort with a clear error showing current statuses.
 */
async function verifyFilled(
  programs: Programs,
  crimeMint: PublicKey,
  fraudMint: PublicKey,
  bondingCurveProgramId: PublicKey,
): Promise<string> {
  const [crimeCurveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, crimeMint.toBuffer()],
    bondingCurveProgramId,
  );
  const [fraudCurveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, fraudMint.toBuffer()],
    bondingCurveProgramId,
  );

  const crimeState = await programs.bondingCurve.account.curveState.fetch(crimeCurveState);
  const fraudState = await programs.bondingCurve.account.curveState.fetch(fraudCurveState);

  // Extract status -- Anchor deserializes enums as objects like { filled: {} }
  const crimeStatus = Object.keys(crimeState.status)[0];
  const fraudStatus = Object.keys(fraudState.status)[0];

  console.log(`  CRIME curve: status=${crimeStatus}, tokensSold=${crimeState.tokensSold.toString()}, solRaised=${crimeState.solRaised.toString()}`);
  console.log(`  FRAUD curve: status=${fraudStatus}, tokensSold=${fraudState.tokensSold.toString()}, solRaised=${fraudState.solRaised.toString()}`);

  const validStatuses = ["filled", "graduated"];
  if (!validStatuses.includes(crimeStatus)) {
    throw new Error(
      `CRIME curve is "${crimeStatus}" -- must be Filled or Graduated to graduate.\n` +
      `Tokens sold: ${crimeState.tokensSold.toString()}\n` +
      `SOL raised: ${crimeState.solRaised.toString()}`
    );
  }
  if (!validStatuses.includes(fraudStatus)) {
    throw new Error(
      `FRAUD curve is "${fraudStatus}" -- must be Filled or Graduated to graduate.\n` +
      `Tokens sold: ${fraudState.tokensSold.toString()}\n` +
      `SOL raised: ${fraudState.solRaised.toString()}`
    );
  }

  return "verification-only";
}

/**
 * Step 2: Transition both curves from Filled to Graduated.
 *
 * Calls prepareTransition which requires both curves to be Filled.
 * If already Graduated (partial resume), the on-chain instruction will fail,
 * so we check first and skip if already graduated.
 */
async function prepareTransition(
  programs: Programs,
  authority: Keypair,
  crimeMint: PublicKey,
  fraudMint: PublicKey,
  bondingCurveProgramId: PublicKey,
): Promise<string> {
  const [crimeCurveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, crimeMint.toBuffer()],
    bondingCurveProgramId,
  );
  const [fraudCurveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, fraudMint.toBuffer()],
    bondingCurveProgramId,
  );

  // Check if already graduated (resume scenario)
  const crimeState = await programs.bondingCurve.account.curveState.fetch(crimeCurveState);
  const crimeStatus = Object.keys(crimeState.status)[0];
  if (crimeStatus === "graduated") {
    console.log(`  Both curves already Graduated (resume scenario) -- skipping`);
    return "already-graduated";
  }

  console.log(`  ${RED}*** IRREVERSIBLE: Transitioning both curves to Graduated ***${RESET}`);
  console.log(`  This is a terminal state. Both curves will be permanently Graduated.`);

  const [adminConfig] = PublicKey.findProgramAddressSync(
    [BC_ADMIN_SEED], bondingCurveProgramId,
  );

  const sig = await programs.bondingCurve.methods
    .prepareTransition()
    .accountsStrict({
      authority: authority.publicKey,
      adminConfig,
      crimeCurveState,
      fraudCurveState,
    })
    .signers([authority])
    .rpc();

  console.log(`  Both curves transitioned to Graduated`);
  return sig;
}

/**
 * Steps 3-4: Withdraw SOL from a graduated curve's SOL vault.
 *
 * Calls withdrawGraduatedSol which transfers ~500 SOL (minus rent) from the
 * curve's SOL vault to the admin wallet.
 *
 * Returns { sig, withdrawn } where withdrawn is the actual lamports received
 * by the admin (tracked via admin balance delta). This amount is used to seed
 * the corresponding AMM pool -- no hardcoded SOL amount needed.
 *
 * Note: TX fee (~5000 lamports) is negligible vs ~500 SOL and is acceptable.
 */
async function withdrawSol(
  programs: Programs,
  authority: Keypair,
  mint: PublicKey,
  label: string,
  bondingCurveProgramId: PublicKey,
  connection: anchor.web3.Connection,
): Promise<{ sig: string; withdrawn: number }> {
  const [curveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, mint.toBuffer()],
    bondingCurveProgramId,
  );
  const [solVault] = PublicKey.findProgramAddressSync(
    [CURVE_SOL_VAULT_SEED, mint.toBuffer()],
    bondingCurveProgramId,
  );

  // Check vault balance before withdrawal for logging
  const vaultBalance = await connection.getBalance(solVault);
  console.log(`  ${label} SOL vault balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);

  if (vaultBalance <= 890_880) {
    // Only rent-exempt minimum remains -- nothing to withdraw
    console.log(`  ${label} SOL vault already withdrawn (only rent remaining)`);
    return { sig: "already-withdrawn", withdrawn: 0 };
  }

  // Track admin balance BEFORE withdrawal to compute actual received amount
  const adminBalanceBefore = await connection.getBalance(authority.publicKey);

  const [adminConfig] = PublicKey.findProgramAddressSync(
    [BC_ADMIN_SEED], bondingCurveProgramId,
  );

  const sig = await programs.bondingCurve.methods
    .withdrawGraduatedSol()
    .accountsStrict({
      authority: authority.publicKey,
      adminConfig,
      curveState,
      solVault,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  // Track admin balance AFTER to compute actual withdrawn amount
  const adminBalanceAfter = await connection.getBalance(authority.publicKey);
  const withdrawn = adminBalanceAfter - adminBalanceBefore;
  // Note: withdrawn is slightly less than vault transfer due to TX fee (~5000 lamports).
  // This is acceptable -- the pool gets seeded with exactly what admin received.

  console.log(`  Withdrew ${withdrawn / LAMPORTS_PER_SOL} SOL from ${label} curve vault (admin delta)`);

  return { sig, withdrawn };
}

/**
 * Steps 5-6: Close an empty token vault from a graduated curve.
 *
 * Calls closeTokenVault which recovers rent from the empty vault.
 * The vault must have 0 token balance (enforced by on-chain constraint).
 */
async function closeTokenVault(
  programs: Programs,
  authority: Keypair,
  mint: PublicKey,
  label: string,
  bondingCurveProgramId: PublicKey,
  connection: anchor.web3.Connection,
): Promise<string> {
  const [curveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, mint.toBuffer()],
    bondingCurveProgramId,
  );
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [CURVE_TOKEN_VAULT_SEED, mint.toBuffer()],
    bondingCurveProgramId,
  );

  // Check if vault already closed (no account on chain)
  const vaultInfo = await connection.getAccountInfo(tokenVault);
  if (vaultInfo === null) {
    console.log(`  ${label} token vault already closed`);
    return "already-closed";
  }

  // Check vault token balance -- if not empty, log warning and skip
  try {
    const vaultAccount = await getAccount(connection, tokenVault, "confirmed", TOKEN_2022_PROGRAM_ID);
    if (vaultAccount.amount > BigInt(0)) {
      console.log(`  ${YELLOW}WARNING: ${label} token vault has ${vaultAccount.amount} tokens remaining${RESET}`);
      console.log(`  ${YELLOW}Cannot close non-empty vault. Skipping.${RESET}`);
      return "skipped-not-empty";
    }
  } catch (err: any) {
    // If the account can't be parsed as a token account, it might already be closed
    console.log(`  ${label} token vault in unexpected state: ${err.message}`);
    return "skipped-error";
  }

  const [adminConfig] = PublicKey.findProgramAddressSync(
    [BC_ADMIN_SEED], bondingCurveProgramId,
  );

  const sig = await programs.bondingCurve.methods
    .closeTokenVault()
    .accountsStrict({
      authority: authority.publicKey,
      adminConfig,
      curveState,
      tokenVault,
      tokenMint: mint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([authority])
    .rpc();

  console.log(`  ${label} token vault closed, rent recovered`);
  return sig;
}

/**
 * Steps 7-8: Create an AMM pool with seed liquidity.
 *
 * Follows the exact same initPool pattern from initialize.ts:
 * - Canonical mint ordering (NATIVE_MINT < everything)
 * - Transfer Hook remaining_accounts for Token-2022 transfers
 * - Creates wrapped native account for SOL side
 *
 * Pool SOL amount is dynamic -- determined by actual vault withdrawal.
 * SOL_POOL_SEED_SOL_OVERRIDE env var overrides for emergencies.
 * Token amount remains hardcoded at 290M (fixed unsold allocation).
 */
async function createAmmPool(
  programs: Programs,
  authority: Keypair,
  tokenMint: PublicKey,
  label: string,
  adminTokenAccount: PublicKey,
  connection: anchor.web3.Connection,
  poolSeedSol: number,
): Promise<string> {
  const ammProgramId = programs.amm.programId;
  const hookProgramId = programs.transferHook.programId;

  // Canonical ordering: NATIVE_MINT (0x06...) < everything
  const [mintA, mintB] = canonicalOrder(NATIVE_MINT, tokenMint);

  // Derive pool PDA
  const [pool] = derivePoolPDA(mintA, mintB, ammProgramId);

  // Check if pool already exists (resume scenario)
  if (await accountExists(connection, pool)) {
    console.log(`  ${label} pool already exists: ${pool.toBase58()}`);
    return "already-exists";
  }

  // Derive vault PDAs
  const { vaultA: [vaultA], vaultB: [vaultB] } = deriveVaultPDAs(pool, ammProgramId);

  // Admin config PDA
  const [adminConfig] = PublicKey.findProgramAddressSync([ADMIN_SEED], ammProgramId);

  // Map token programs, sources, and amounts to canonical order
  // NATIVE_MINT is always mintA (0x06 < everything)
  const tokenProgramA = TOKEN_PROGRAM_ID;         // SOL side
  const tokenProgramB = TOKEN_2022_PROGRAM_ID;    // Token side

  // Create fresh WSOL account for pool seeding
  const adminWsolAccount = await createWrappedNativeAccount(
    connection,
    authority,
    authority.publicKey,
    poolSeedSol + 1_000_000_000, // +1 SOL buffer for fees
    Keypair.generate(),
    undefined,
    TOKEN_PROGRAM_ID,
  );
  console.log(`  Created WSOL account: ${adminWsolAccount.toBase58()} (${poolSeedSol / LAMPORTS_PER_SOL} SOL)`);

  // Build Transfer Hook remaining_accounts for the T22 mint (side B)
  // SOL side (A) uses TOKEN_PROGRAM_ID, no hooks needed
  // Token side (B) uses TOKEN_2022_PROGRAM_ID with Transfer Hook
  const [extraMeta] = PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_META_SEED, mintB.toBuffer()],
    hookProgramId,
  );
  const [wlSource] = deriveWhitelistEntryPDA(adminTokenAccount, hookProgramId);
  const [wlDest] = deriveWhitelistEntryPDA(vaultB, hookProgramId);

  // Hook accounts only for side B (Token-2022 mint)
  const hookRemainingAccounts = [
    { pubkey: extraMeta, isSigner: false, isWritable: false },
    { pubkey: wlSource, isSigner: false, isWritable: false },
    { pubkey: wlDest, isSigner: false, isWritable: false },
    { pubkey: hookProgramId, isSigner: false, isWritable: false },
  ];

  console.log(`  Pool: ${pool.toBase58()}`);
  console.log(`  mintA (SOL): ${mintA.toBase58()}`);
  console.log(`  mintB (${label}): ${mintB.toBase58()}`);
  console.log(`  Seeding: ${GRADUATION_POOL_SEED_TOKEN / 10 ** TOKEN_DECIMALS}M tokens + ${poolSeedSol / LAMPORTS_PER_SOL} SOL`);

  const sig = await programs.amm.methods
    .initializePool(
      SOL_POOL_FEE_BPS,
      new anchor.BN(poolSeedSol.toString()),
      new anchor.BN(GRADUATION_POOL_SEED_TOKEN.toString()),
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
      sourceA: adminWsolAccount,
      sourceB: adminTokenAccount,
      tokenProgramA,
      tokenProgramB,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookRemainingAccounts)
    .signers([authority])
    .rpc();

  console.log(`  ${label} pool created successfully`);
  return sig;
}

/**
 * Step 9: Seed Conversion Vault with reserve tokens.
 *
 * Transfers 250M CRIME, 250M FRAUD, and 20M PROFIT to the conversion vault
 * token accounts. Uses the same pattern as initialize.ts Step 10:
 * createTransferCheckedInstruction with Transfer Hook remaining_accounts.
 */
async function seedConversionVault(
  programs: Programs,
  authority: Keypair,
  crimeMint: PublicKey,
  fraudMint: PublicKey,
  profitMint: PublicKey,
  adminCrimeAccount: PublicKey,
  adminFraudAccount: PublicKey,
  adminProfitAccount: PublicKey,
  connection: anchor.web3.Connection,
): Promise<string> {
  const hookProgramId = programs.transferHook.programId;
  const vaultProgramId = programs.conversionVault.programId;

  // Derive vault PDAs
  const [vaultConfig] = PublicKey.findProgramAddressSync([VAULT_CONFIG_SEED], vaultProgramId);
  const [vaultCrime] = PublicKey.findProgramAddressSync(
    [VAULT_CRIME_SEED, vaultConfig.toBuffer()], vaultProgramId
  );
  const [vaultFraud] = PublicKey.findProgramAddressSync(
    [VAULT_FRAUD_SEED, vaultConfig.toBuffer()], vaultProgramId
  );
  const [vaultProfit] = PublicKey.findProgramAddressSync(
    [VAULT_PROFIT_SEED, vaultConfig.toBuffer()], vaultProgramId
  );

  const seedingPlan = [
    { name: "CRIME", source: adminCrimeAccount, dest: vaultCrime, mint: crimeMint, amount: VAULT_SEED_CRIME },
    { name: "FRAUD", source: adminFraudAccount, dest: vaultFraud, mint: fraudMint, amount: VAULT_SEED_FRAUD },
    { name: "PROFIT", source: adminProfitAccount, dest: vaultProfit, mint: profitMint, amount: VAULT_SEED_PROFIT },
  ];

  const txSigs: string[] = [];

  for (const { name, source, dest, mint, amount } of seedingPlan) {
    // Check if vault already has tokens (resume scenario)
    try {
      const acct = await getAccount(connection, dest, "confirmed", TOKEN_2022_PROGRAM_ID);
      if (acct.amount > BigInt(0)) {
        console.log(`  ${name} vault already seeded (${acct.amount} tokens)`);
        continue;
      }
    } catch { /* vault not found or empty -- proceed */ }

    // Build transfer_checked with hook remaining_accounts (4 per transfer)
    const transferIx = createTransferCheckedInstruction(
      source, mint, dest, authority.publicKey, amount, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID
    );

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
    console.log(`  Seeded ${name} vault: ${amount / 10 ** TOKEN_DECIMALS}M tokens (${sig.slice(0, 12)}...)`);
    txSigs.push(sig);
  }

  return txSigs.length > 0 ? txSigs[txSigs.length - 1] : "already-seeded";
}

/**
 * Steps 10-11: Distribute tax escrow SOL to the carnage fund.
 *
 * Calls distributeTaxEscrow for each curve. This is permissionless (anyone can
 * call once graduated), but we call it as the admin in the graduation script
 * to ensure it happens immediately.
 *
 * The tax escrow holds 15% of all sell proceeds collected during the bonding
 * curve phase. This SOL goes to the carnage fund for community events.
 */
async function distributeTaxEscrow(
  programs: Programs,
  authority: Keypair,
  mint: PublicKey,
  label: string,
  bondingCurveProgramId: PublicKey,
  epochProgramId: PublicKey,
  connection: anchor.web3.Connection,
): Promise<string> {
  const [curveState] = PublicKey.findProgramAddressSync(
    [CURVE_SEED, mint.toBuffer()],
    bondingCurveProgramId,
  );
  const [taxEscrow] = PublicKey.findProgramAddressSync(
    [TAX_ESCROW_SEED, mint.toBuffer()],
    bondingCurveProgramId,
  );
  const [carnageSolVault] = PublicKey.findProgramAddressSync(
    [CARNAGE_SOL_VAULT_SEED],
    epochProgramId,
  );

  // Check escrow balance -- if only rent remaining, already distributed
  const escrowBalance = await connection.getBalance(taxEscrow);
  const rentExempt = 890_880; // approximate rent for 0-byte account
  if (escrowBalance <= rentExempt) {
    console.log(`  ${label} tax escrow already distributed (balance: ${escrowBalance} lamports)`);
    return "already-distributed";
  }

  console.log(`  ${label} tax escrow balance: ${escrowBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`  Distributing to carnage fund: ${carnageSolVault.toBase58()}`);

  const sig = await programs.bondingCurve.methods
    .distributeTaxEscrow()
    .accountsStrict({
      curveState,
      taxEscrow,
      carnageFund: carnageSolVault,
    })
    .rpc();

  const escrowAfter = await connection.getBalance(taxEscrow);
  console.log(`  Distributed ${(escrowBalance - escrowAfter) / LAMPORTS_PER_SOL} SOL to carnage fund`);
  return sig;
}

// =============================================================================
// Pool Vault Whitelisting + Whitelist Authority Burn
// =============================================================================

/**
 * Step 9: Whitelist all AMM pool vault addresses on the Transfer Hook.
 *
 * Each pool has 2 vaults (vaultA, vaultB). Both must be whitelisted so
 * Transfer Hook allows token transfers into/out of pool vaults.
 *
 * This step MUST happen after pool creation (steps 7-8) and BEFORE
 * whitelist authority burn (step 13). Moving this from initialize.ts
 * to graduation ensures pools are created with correct dynamic SOL amounts.
 */
async function whitelistPoolVaults(
  programs: Programs,
  authority: Keypair,
  crimeMint: PublicKey,
  fraudMint: PublicKey,
  connection: anchor.web3.Connection,
): Promise<string> {
  const ammProgramId = programs.amm.programId;
  const hookProgramId = programs.transferHook.programId;

  const [whitelistAuthority] = PublicKey.findProgramAddressSync(
    [WHITELIST_AUTHORITY_SEED], hookProgramId,
  );

  // Check if authority is already burned
  try {
    const authData = await programs.transferHook.account.whitelistAuthority.fetch(whitelistAuthority);
    if (authData.authority === null) {
      console.log(`  ${YELLOW}Whitelist authority already burned — pool vaults must already be whitelisted${RESET}`);
      return "already-burned";
    }
  } catch {
    throw new Error("WhitelistAuthority account not found — was initialize.ts Step 2 run?");
  }

  let whitelisted = 0;
  const sigs: string[] = [];

  for (const [label, mint] of [["CRIME", crimeMint], ["FRAUD", fraudMint]] as [string, PublicKey][]) {
    // Canonical ordering: NATIVE_MINT (0x06...) < everything
    const [mintA, mintB] = canonicalOrder(NATIVE_MINT, mint);
    const [pool] = derivePoolPDA(mintA, mintB, ammProgramId);
    const { vaultA: [vaultA], vaultB: [vaultB] } = deriveVaultPDAs(pool, ammProgramId);

    for (const [vaultLabel, vault] of [["vaultA", vaultA], ["vaultB", vaultB]] as [string, PublicKey][]) {
      const [whitelistEntry] = deriveWhitelistEntryPDA(vault, hookProgramId);

      if (await accountExists(connection, whitelistEntry)) {
        console.log(`  ${label} ${vaultLabel} already whitelisted`);
        continue;
      }

      const sig = await programs.transferHook.methods
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

      whitelisted++;
      sigs.push(sig);
      console.log(`  Whitelisted ${label} ${vaultLabel}: ${vault.toBase58().slice(0, 12)}...`);
    }
  }

  console.log(`  ${whitelisted} pool vaults whitelisted`);
  return sigs.length > 0 ? sigs[0] : "already-whitelisted";
}

/**
 * Step 13: Burn the Transfer Hook whitelist authority (IRREVERSIBLE).
 *
 * After this, no new whitelist entries can ever be added. This is the
 * final step of graduation, ensuring all required addresses are whitelisted
 * before the authority is permanently revoked.
 *
 * Whitelist entries at this point (15 total):
 *   Init Step 6:  3 admin T22 accounts (CRIME, FRAUD, PROFIT)
 *   Init Step 9:  3 conversion vault accounts (CRIME, FRAUD, PROFIT)
 *   Init Step 14: 1 stake vault
 *   Init Step 16: 2 carnage vaults (CRIME, FRAUD)
 *   Init Step 20: 1 CRIME curve token vault
 *   Init Step 21: 1 FRAUD curve token vault
 *   Grad Step 9:  4 pool vault accounts (2 pools x 2 vaults)
 *   -------
 *   Total: 15 whitelist entries
 */
/**
 * DISABLED: Whitelist authority is no longer burned during graduation.
 * It transfers to Squads multisig at Stage 7 for future flexibility.
 *
 * 🚨 NO AUTHORITY MAY BE BURNED WITHOUT EXPLICIT WRITTEN CONFIRMATION
 * FROM THE PROJECT OWNER (mlbob). See Docs/mainnet-governance.md Section 8.
 *
 * This function is retained as dead code for reference only.
 * If re-enabled in the future, it MUST prompt for manual confirmation.
 */
async function burnWhitelistAuthority(
  _programs: Programs,
  _authority: Keypair,
): Promise<string> {
  throw new Error(
    "burnWhitelistAuthority is DISABLED. " +
    "Whitelist authority transfers to Squads at Stage 7. " +
    "No authority may be burned without explicit owner confirmation. " +
    "See Docs/mainnet-governance.md Section 8."
  );
}

// =============================================================================
// Pool Seed SOL Resolution
// =============================================================================

/**
 * Determine the SOL amount to seed an AMM pool with.
 *
 * Priority:
 * 1. SOL_POOL_SEED_SOL_OVERRIDE env var (emergency override)
 * 2. Dynamic withdrawn amount from vault (normal operation)
 * 3. Error if neither is available (prevents silent wrong-amount seeding)
 *
 * Sanity-checks that the amount is at least MIN_POOL_SEED_SOL.
 */
function resolvePoolSeedSol(label: string, withdrawnAmount?: number): number {
  if (SOL_POOL_SEED_SOL_OVERRIDE !== undefined) {
    console.log(`  ${YELLOW}Using SOL_POOL_SEED_SOL_OVERRIDE: ${SOL_POOL_SEED_SOL_OVERRIDE / LAMPORTS_PER_SOL} SOL for ${label} pool${RESET}`);
    return SOL_POOL_SEED_SOL_OVERRIDE;
  }

  if (withdrawnAmount === undefined || withdrawnAmount === 0) {
    throw new Error(
      `No withdrawn SOL amount available for ${label} pool seeding.\n` +
      `The withdraw step must complete first, or set SOL_POOL_SEED_SOL_OVERRIDE env var.\n` +
      `Check graduation-state.json for stored withdrawal amounts.`
    );
  }

  if (withdrawnAmount < MIN_POOL_SEED_SOL) {
    throw new Error(
      `${label} withdrawn amount ${withdrawnAmount / LAMPORTS_PER_SOL} SOL is below minimum ${MIN_POOL_SEED_SOL / LAMPORTS_PER_SOL} SOL.\n` +
      `This likely indicates an empty vault or failed withdrawal.\n` +
      `Set SOL_POOL_SEED_SOL_OVERRIDE to override.`
    );
  }

  console.log(`  ${label} pool SOL seed: ${withdrawnAmount / LAMPORTS_PER_SOL} SOL (dynamic from vault withdrawal)`);
  return withdrawnAmount;
}

// =============================================================================
// Post-Graduation Verification
// =============================================================================

/**
 * Run post-graduation verification to confirm the protocol is operational.
 *
 * Checks:
 * - Both CurveState accounts show Graduated status
 * - AMM pools exist with liquidity
 * - Conversion Vault has token balances
 * - Tax escrows have been distributed (only rent remaining)
 */
async function verifyGraduation(
  programs: Programs,
  crimeMint: PublicKey,
  fraudMint: PublicKey,
  profitMint: PublicKey,
  connection: anchor.web3.Connection,
): Promise<void> {
  const bondingCurveProgramId = programs.bondingCurve.programId;
  const ammProgramId = programs.amm.programId;
  const vaultProgramId = programs.conversionVault.programId;
  const epochProgramId = programs.epochProgram.programId;

  console.log(`\n${BOLD}=== Post-Graduation Verification ===${RESET}\n`);
  let allPassed = true;

  // 1. Curve statuses
  for (const [label, mint] of [["CRIME", crimeMint], ["FRAUD", fraudMint]] as [string, PublicKey][]) {
    const [curveStatePda] = PublicKey.findProgramAddressSync(
      [CURVE_SEED, mint.toBuffer()], bondingCurveProgramId
    );
    const state = await programs.bondingCurve.account.curveState.fetch(curveStatePda);
    const status = Object.keys(state.status)[0];
    const ok = status === "graduated";
    console.log(`  ${ok ? GREEN + "PASS" : RED + "FAIL"}${RESET} ${label} curve: ${status}`);
    if (!ok) allPassed = false;
  }

  // 2. AMM pools
  for (const [label, tokenMint] of [["CRIME/SOL", crimeMint], ["FRAUD/SOL", fraudMint]] as [string, PublicKey][]) {
    const [mintA, mintB] = canonicalOrder(NATIVE_MINT, tokenMint);
    const [pool] = derivePoolPDA(mintA, mintB, ammProgramId);
    const exists = await accountExists(connection, pool);
    console.log(`  ${exists ? GREEN + "PASS" : RED + "FAIL"}${RESET} ${label} pool: ${exists ? pool.toBase58() : "NOT FOUND"}`);
    if (!exists) allPassed = false;
  }

  // 3. Conversion Vault balances
  const [vaultConfig] = PublicKey.findProgramAddressSync([VAULT_CONFIG_SEED], vaultProgramId);
  for (const [label, seed, expectedMin] of [
    ["CRIME", VAULT_CRIME_SEED, VAULT_SEED_CRIME],
    ["FRAUD", VAULT_FRAUD_SEED, VAULT_SEED_FRAUD],
    ["PROFIT", VAULT_PROFIT_SEED, VAULT_SEED_PROFIT],
  ] as [string, Buffer, number][]) {
    const [vaultAcct] = PublicKey.findProgramAddressSync([seed, vaultConfig.toBuffer()], vaultProgramId);
    try {
      const acct = await getAccount(connection, vaultAcct, "confirmed", TOKEN_2022_PROGRAM_ID);
      const hasTokens = acct.amount > BigInt(0);
      console.log(`  ${hasTokens ? GREEN + "PASS" : RED + "FAIL"}${RESET} Vault ${label}: ${Number(acct.amount) / 10 ** TOKEN_DECIMALS} tokens`);
      if (!hasTokens) allPassed = false;
    } catch {
      console.log(`  ${RED}FAIL${RESET} Vault ${label}: account not found`);
      allPassed = false;
    }
  }

  // 4. Tax escrows distributed
  for (const [label, mint] of [["CRIME", crimeMint], ["FRAUD", fraudMint]] as [string, PublicKey][]) {
    const [taxEscrow] = PublicKey.findProgramAddressSync(
      [TAX_ESCROW_SEED, mint.toBuffer()], bondingCurveProgramId
    );
    const balance = await connection.getBalance(taxEscrow);
    const distributed = balance <= 890_880; // only rent remaining
    console.log(`  ${distributed ? GREEN + "PASS" : YELLOW + "WARN"}${RESET} ${label} escrow: ${balance} lamports ${distributed ? "(distributed)" : "(has balance)"}`);
  }

  console.log(`\n  ${allPassed ? GREEN + "All verifications passed" : RED + "Some verifications failed"}${RESET}\n`);
}

// =============================================================================
// Main Execution
// =============================================================================

async function main() {
  // -------------------------------------------------------------------------
  // Environment check
  // -------------------------------------------------------------------------
  if (!process.env.CLUSTER_URL) {
    console.log(`${YELLOW}WARNING: CLUSTER_URL not set. Did you source .env?${RESET}`);
    console.log(`  Usage: source .env && npx tsx scripts/graduation/graduate.ts`);
    console.log(`  Using default: http://localhost:8899`);
  }

  // -------------------------------------------------------------------------
  // Setup: Provider, programs, mints
  // -------------------------------------------------------------------------
  const provider = loadProvider();
  const programs = loadPrograms(provider);
  const connection = provider.connection;
  const log = createLogger();

  const authority = (provider.wallet as anchor.Wallet).payer;
  const clusterUrl = process.env.CLUSTER_URL || "http://localhost:8899";

  // Load mint keypairs (persisted from deployment)
  const crimeMintKeypair = loadMintKeypair("crime");
  const fraudMintKeypair = loadMintKeypair("fraud");
  const profitMintKeypair = loadMintKeypair("profit");

  const crimeMint = crimeMintKeypair.publicKey;
  const fraudMint = fraudMintKeypair.publicKey;
  const profitMint = profitMintKeypair.publicKey;

  const bondingCurveProgramId = programs.bondingCurve.programId;
  const epochProgramId = programs.epochProgram.programId;

  // -------------------------------------------------------------------------
  // Banner
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}=== Dr. Fraudsworth Graduation ===${RESET}`);
  console.log(`  Cluster:   ${clusterUrl}`);
  console.log(`  Authority: ${authority.publicKey.toBase58()}`);
  console.log(`  CRIME:     ${crimeMint.toBase58()}`);
  console.log(`  FRAUD:     ${fraudMint.toBase58()}`);
  console.log(`  PROFIT:    ${profitMint.toBase58()}`);
  console.log(`  BondingCurve: ${bondingCurveProgramId.toBase58()}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`  Balance:   ${balance / LAMPORTS_PER_SOL} SOL`);
  console.log(`  Tx log:    ${log.getLogPath()}`);
  console.log(`  State:     ${STATE_FILE}`);

  // -------------------------------------------------------------------------
  // Load checkpoint state
  // -------------------------------------------------------------------------
  const state = loadState();

  // Log graduation amounts prominently
  console.log(`\n${BOLD}  Graduation Amounts:${RESET}`);
  console.log(`  Pool token seed:  ${GRADUATION_POOL_SEED_TOKEN / 10 ** TOKEN_DECIMALS}M per pool`);
  console.log(`  Pool SOL seed:    dynamic (from vault withdrawal)${SOL_POOL_SEED_SOL_OVERRIDE ? ` [OVERRIDE: ${SOL_POOL_SEED_SOL_OVERRIDE / LAMPORTS_PER_SOL} SOL]` : ""}`);
  console.log(`  Vault CRIME:      ${VAULT_SEED_CRIME / 10 ** TOKEN_DECIMALS}M`);
  console.log(`  Vault FRAUD:      ${VAULT_SEED_FRAUD / 10 ** TOKEN_DECIMALS}M`);
  console.log(`  Vault PROFIT:     ${VAULT_SEED_PROFIT / 10 ** TOKEN_DECIMALS}M`);

  // -------------------------------------------------------------------------
  // Discover admin token accounts (needed for steps 7-9)
  // Do this upfront so failures happen early, before any state changes.
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}  Discovering admin token accounts...${RESET}`);
  const adminCrimeAccount = await findAdminTokenAccount(connection, authority.publicKey, crimeMint, "CRIME");
  const adminFraudAccount = await findAdminTokenAccount(connection, authority.publicKey, fraudMint, "FRAUD");
  const adminProfitAccount = await findAdminTokenAccount(connection, authority.publicKey, profitMint, "PROFIT");

  // -------------------------------------------------------------------------
  // Checkpoint+resume execution loop
  // -------------------------------------------------------------------------
  console.log(`\n${BOLD}=== Executing Graduation Sequence ===${RESET}\n`);

  for (let i = 0; i < state.steps.length; i++) {
    const step = state.steps[i];

    if (step.completed) {
      console.log(`  ${DIM}SKIP: ${step.name} (completed at ${step.timestamp})${RESET}`);
      continue;
    }

    console.log(`\n  ${BOLD}EXEC: [${i + 1}/${state.steps.length}] ${step.name}${RESET}`);

    try {
      let sig: string;

      switch (step.name) {
        case "verify_curves_filled":
          sig = await verifyFilled(programs, crimeMint, fraudMint, bondingCurveProgramId);
          break;

        case "prepare_transition":
          sig = await prepareTransition(programs, authority, crimeMint, fraudMint, bondingCurveProgramId);
          break;

        case "withdraw_crime_sol": {
          const result = await withdrawSol(programs, authority, crimeMint, "CRIME", bondingCurveProgramId, connection);
          sig = result.sig;
          if (result.withdrawn > 0) {
            state.crimeWithdrawn = result.withdrawn;
            saveState(state);
            console.log(`  Stored crimeWithdrawn: ${result.withdrawn / LAMPORTS_PER_SOL} SOL`);
          }
          break;
        }

        case "withdraw_fraud_sol": {
          const result = await withdrawSol(programs, authority, fraudMint, "FRAUD", bondingCurveProgramId, connection);
          sig = result.sig;
          if (result.withdrawn > 0) {
            state.fraudWithdrawn = result.withdrawn;
            saveState(state);
            console.log(`  Stored fraudWithdrawn: ${result.withdrawn / LAMPORTS_PER_SOL} SOL`);
          }
          break;
        }

        case "close_crime_token_vault":
          sig = await closeTokenVault(programs, authority, crimeMint, "CRIME", bondingCurveProgramId, connection);
          break;

        case "close_fraud_token_vault":
          sig = await closeTokenVault(programs, authority, fraudMint, "FRAUD", bondingCurveProgramId, connection);
          break;

        case "create_crime_sol_pool": {
          const crimePoolSol = resolvePoolSeedSol("CRIME", state.crimeWithdrawn);
          sig = await createAmmPool(programs, authority, crimeMint, "CRIME", adminCrimeAccount, connection, crimePoolSol);
          break;
        }

        case "create_fraud_sol_pool": {
          const fraudPoolSol = resolvePoolSeedSol("FRAUD", state.fraudWithdrawn);
          sig = await createAmmPool(programs, authority, fraudMint, "FRAUD", adminFraudAccount, connection, fraudPoolSol);
          break;
        }

        case "whitelist_pool_vaults":
          sig = await whitelistPoolVaults(programs, authority, crimeMint, fraudMint, connection);
          break;

        case "seed_conversion_vault":
          sig = await seedConversionVault(
            programs, authority,
            crimeMint, fraudMint, profitMint,
            adminCrimeAccount, adminFraudAccount, adminProfitAccount,
            connection,
          );
          break;

        case "distribute_crime_tax_escrow":
          sig = await distributeTaxEscrow(programs, authority, crimeMint, "CRIME", bondingCurveProgramId, epochProgramId, connection);
          break;

        case "distribute_fraud_tax_escrow":
          sig = await distributeTaxEscrow(programs, authority, fraudMint, "FRAUD", bondingCurveProgramId, epochProgramId, connection);
          break;

        case "burn_whitelist_authority":
          // Whitelist authority is NO LONGER burned during graduation.
          // It transfers to Squads multisig at Stage 7 for future flexibility
          // (new DEX pool integrations, whitelist additions, etc.).
          console.log(`  Whitelist authority burn SKIPPED (retained for Squads transfer at Stage 7)`);
          sig = "skipped";
          break;

        default:
          throw new Error(`Unknown step: ${step.name}`);
      }

      // Mark step completed and persist
      step.completed = true;
      step.txSig = sig || "verification-only";
      step.timestamp = new Date().toISOString();
      step.error = undefined;
      saveState(state);

      console.log(`  ${GREEN}DONE: ${step.name}${RESET} (${sig?.slice(0, 16) || "ok"})`);
    } catch (err: any) {
      // Save error state and abort
      step.error = err.message;
      saveState(state);

      console.error(`\n  ${RED}FAILED: ${step.name}${RESET}`);
      console.error(`  Error: ${err.message}`);
      if (err.logs) {
        console.error(`  Program logs:`);
        for (const line of err.logs) {
          console.error(`    ${line}`);
        }
      }
      console.error(`\n  ${BOLD}Re-run this script to resume from this step.${RESET}`);
      console.error(`  State saved to: ${STATE_FILE}`);
      process.exit(1);
    }
  }

  // -------------------------------------------------------------------------
  // Post-graduation verification
  // -------------------------------------------------------------------------
  await verifyGraduation(programs, crimeMint, fraudMint, profitMint, connection);

  // -------------------------------------------------------------------------
  // Print audit summary
  // -------------------------------------------------------------------------
  console.log(`${BOLD}=== Graduation Complete ===${RESET}\n`);
  console.log(`  All ${state.steps.length} steps completed successfully.\n`);
  console.log(`  Transaction signatures:`);
  for (const step of state.steps) {
    const sig = step.txSig || "n/a";
    const display = sig.length > 20 ? sig.slice(0, 20) + "..." : sig;
    console.log(`    ${step.name}: ${display}`);
  }
  console.log(`\n  State file: ${STATE_FILE}`);
  console.log(`  Tx log:     ${log.getLogPath()}`);
  console.log(`\n  ${GREEN}Protocol is now operational. AMM trading is live.${RESET}\n`);
}

main().catch((err) => {
  console.error(`\n${RED}=== Graduation FAILED ===${RESET}`);
  console.error("Error:", err.message || err);
  if (err.logs) {
    console.error("Program logs:");
    for (const line of err.logs) {
      console.error("  ", line);
    }
  }
  process.exit(1);
});
