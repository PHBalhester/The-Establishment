/**
 * Crank Provider — Standalone provider, program, and manifest loader.
 *
 * Works on Railway (and any environment) without depending on gitignored
 * `target/types/` or `target/idl/`. Loads IDLs from committed `app/idl/`.
 *
 * Wallet priority:
 *   1. WALLET_KEYPAIR env var (JSON array string, e.g. "[12,34,56,...]")
 *   2. WALLET env var (file path)
 *   3. keypairs/devnet-wallet.json (committed, devnet only)
 *
 * IDL source: app/idl/ (committed, synced from target/idl/ by app/scripts/sync-idl.mjs)
 *
 * Manifest priority:
 *   1. PDA_MANIFEST env var (full JSON string)
 *   2. scripts/deploy/pda-manifest.json (gitignored, available locally)
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { PDAManifest } from "../e2e/devnet-e2e-validation";

// ---- Provider ----

/**
 * Create an AnchorProvider with wallet loaded from env var or file.
 *
 * On Railway: set WALLET_KEYPAIR env var with the JSON byte array.
 * Locally: defaults to keypairs/devnet-wallet.json (committed).
 */
export function loadCrankProvider(): anchor.AnchorProvider {
  const url = process.env.CLUSTER_URL || "http://localhost:8899";
  const commitment =
    (process.env.COMMITMENT as anchor.web3.Commitment) || "confirmed";

  // Priority 1: WALLET_KEYPAIR env var (JSON array string)
  // Used on Railway/mainnet where keypair files aren't available.
  const keypairEnv = process.env.WALLET_KEYPAIR;
  let wallet: anchor.Wallet;

  if (keypairEnv) {
    try {
      const secretKey = JSON.parse(keypairEnv);
      wallet = new anchor.Wallet(
        Keypair.fromSecretKey(new Uint8Array(secretKey))
      );
      console.log(
        `  Wallet: loaded from WALLET_KEYPAIR env var (${wallet.publicKey.toBase58().slice(0, 12)}...)`
      );
    } catch (err) {
      throw new Error(
        `Failed to parse WALLET_KEYPAIR env var: ${String(err).slice(0, 100)}`
      );
    }
  } else {
    // Priority 2/3: File path from WALLET env var or default
    const keyPath =
      process.env.WALLET || "keypairs/devnet-wallet.json";
    const resolvedPath = path.isAbsolute(keyPath)
      ? keyPath
      : path.resolve(process.cwd(), keyPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Wallet not found at ${resolvedPath} and WALLET_KEYPAIR env var not set.\n` +
          `Set WALLET_KEYPAIR='[byte,array,...]' or WALLET=/path/to/keypair.json`
      );
    }

    const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    wallet = new anchor.Wallet(
      Keypair.fromSecretKey(new Uint8Array(secretKey))
    );
    console.log(
      `  Wallet: loaded from ${keyPath} (${wallet.publicKey.toBase58().slice(0, 12)}...)`
    );
  }

  const connection = new Connection(url, commitment);
  return new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: commitment,
    commitment,
  });
}

// ---- Programs ----

/**
 * All protocol programs needed by the crank runner.
 * Uses Program<any> — no dependency on gitignored target/types/.
 */
export interface CrankPrograms {
  epochProgram: anchor.Program;
  amm: anchor.Program;
  taxProgram: anchor.Program;
  staking: anchor.Program;
  transferHook: anchor.Program;
}

/**
 * Load programs from committed app/idl/ directory.
 * These IDLs are synced from target/idl/ by app/scripts/sync-idl.mjs
 * and contain the correct program addresses.
 */
export function loadCrankPrograms(
  provider: anchor.AnchorProvider
): CrankPrograms {
  const idlDir = path.resolve(__dirname, "../../app/idl");

  function loadIdl(name: string): any {
    const idlPath = path.join(idlDir, `${name}.json`);
    if (!fs.existsSync(idlPath)) {
      throw new Error(
        `IDL not found: ${idlPath}\n` +
          `Ensure app/idl/ is synced: cp target/idl/*.json app/idl/`
      );
    }
    return JSON.parse(fs.readFileSync(idlPath, "utf8"));
  }

  return {
    epochProgram: new anchor.Program(loadIdl("epoch_program"), provider),
    amm: new anchor.Program(loadIdl("amm"), provider),
    taxProgram: new anchor.Program(loadIdl("tax_program"), provider),
    staking: new anchor.Program(loadIdl("staking"), provider),
    transferHook: new anchor.Program(loadIdl("transfer_hook"), provider),
  };
}

// ---- Manifest ----

/**
 * Load PDA manifest from env var or file.
 *
 * On Railway: set PDA_MANIFEST env var with the full JSON string.
 * Locally: falls back to scripts/deploy/pda-manifest.json.
 */
export function loadManifest(): PDAManifest {
  const envManifest = process.env.PDA_MANIFEST;

  if (envManifest) {
    try {
      const manifest = JSON.parse(envManifest) as PDAManifest;
      console.log(
        `  Manifest: loaded from PDA_MANIFEST env var (${Object.keys(manifest.pdas).length} PDAs)`
      );
      return manifest;
    } catch (err) {
      throw new Error(
        `Failed to parse PDA_MANIFEST env var: ${String(err).slice(0, 100)}`
      );
    }
  }

  // Fallback: file
  const filePath = path.resolve(
    __dirname,
    "../deploy/pda-manifest.json"
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Manifest not found at ${filePath} and PDA_MANIFEST env var not set.\n` +
        `Set PDA_MANIFEST='{...json...}' or ensure pda-manifest.json exists locally.`
    );
  }

  const manifest = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  ) as PDAManifest;
  console.log(
    `  Manifest: loaded from file (${Object.keys(manifest.pdas).length} PDAs)`
  );
  return manifest;
}
