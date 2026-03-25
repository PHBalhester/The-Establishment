/**
 * Burn Excess Token Supply
 *
 * After a deployment where initialize.ts ran multiple times (creating tokens
 * twice), this script corrects the total supply by burning excess tokens from
 * admin-owned token accounts.
 *
 * Target supply (per CONTEXT.md):
 *   CRIME:  1,000,000,000 (1B)   = 460M bonding curve + 290M pool + 250M vault
 *   FRAUD:  1,000,000,000 (1B)   = 460M bonding curve + 290M pool + 250M vault
 *   PROFIT:    20,000,000 (20M)  = 20M vault
 *
 * Usage:
 *   CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=... \
 *     npx tsx scripts/deploy/burn-excess-supply.ts
 *
 * Safety: Only burns from accounts owned by the admin wallet. Pool and vault
 * accounts are program-owned and will not be touched.
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { burn, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const TOKEN_DECIMALS = 6;

const TARGET_SUPPLY: Record<string, number> = {
  CRIME:  1_000_000_000_000_000, // 1B * 10^6
  FRAUD:  1_000_000_000_000_000, // 1B * 10^6
  PROFIT:    20_000_000_000_000, // 20M * 10^6
};

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function main() {
  const clusterUrl = process.env.CLUSTER_URL || "https://api.devnet.solana.com";
  const connection = new Connection(clusterUrl, "confirmed");

  const walletPath = path.resolve(__dirname, "../../keypairs/devnet-wallet.json");
  const authority = loadKeypair(walletPath);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Cluster:   ${clusterUrl}\n`);

  const mintKeypairsDir = path.resolve(__dirname, "mint-keypairs");
  const mints: { name: string; pubkey: PublicKey }[] = [
    { name: "CRIME", pubkey: loadKeypair(path.join(mintKeypairsDir, "crime-mint.json")).publicKey },
    { name: "FRAUD", pubkey: loadKeypair(path.join(mintKeypairsDir, "fraud-mint.json")).publicKey },
    { name: "PROFIT", pubkey: loadKeypair(path.join(mintKeypairsDir, "profit-mint.json")).publicKey },
  ];

  for (const { name, pubkey } of mints) {
    const target = TARGET_SUPPLY[name];
    const targetHuman = target / 10 ** TOKEN_DECIMALS;

    // Get current total supply from mint account
    const mintInfo = await connection.getAccountInfo(pubkey);
    if (!mintInfo) {
      console.log(`${name}: Mint account not found -- skipping`);
      continue;
    }
    const currentSupply = Number(Buffer.from(mintInfo.data.subarray(36, 44)).readBigUInt64LE());
    const currentHuman = currentSupply / 10 ** TOKEN_DECIMALS;

    if (currentSupply <= target) {
      console.log(`${name}: Supply ${currentHuman} <= target ${targetHuman} -- no burn needed`);
      continue;
    }

    let toBurn = currentSupply - target;
    console.log(`${name}: Supply ${currentHuman}, target ${targetHuman}, excess ${toBurn / 10 ** TOKEN_DECIMALS}`);

    // Find all Token-2022 accounts for this mint owned by the admin wallet
    const tokenAccounts = await connection.getTokenAccountsByOwner(
      authority.publicKey,
      { mint: pubkey },
      { commitment: "confirmed" }
    );

    console.log(`  Found ${tokenAccounts.value.length} admin-owned token account(s)`);

    for (const { pubkey: accountPubkey, account } of tokenAccounts.value) {
      if (toBurn <= 0) break;

      // Read balance from account data (offset 64, 8 bytes LE)
      const balance = Number(Buffer.from(account.data.subarray(64, 72)).readBigUInt64LE());
      if (balance === 0) continue;

      const burnAmount = Math.min(balance, toBurn);
      const burnHuman = burnAmount / 10 ** TOKEN_DECIMALS;

      console.log(`  Burning ${burnHuman} from ${accountPubkey.toBase58()}...`);

      const sig = await burn(
        connection,
        authority,
        accountPubkey,
        pubkey,
        authority,
        burnAmount,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      console.log(`    TX: ${sig}`);
      toBurn -= burnAmount;
    }

    if (toBurn > 0) {
      console.log(`  WARNING: Could not burn all excess -- ${toBurn / 10 ** TOKEN_DECIMALS} remaining`);
      console.log(`  (Some tokens may be in pool/vault accounts not owned by admin)`);
    } else {
      console.log(`  Done -- supply corrected to ${targetHuman}`);
    }
    console.log();
  }

  // Final verification
  console.log("=== Final Supply Verification ===");
  for (const { name, pubkey } of mints) {
    const mintInfo = await connection.getAccountInfo(pubkey);
    if (!mintInfo) continue;
    const supply = Number(Buffer.from(mintInfo.data.subarray(36, 44)).readBigUInt64LE());
    const target = TARGET_SUPPLY[name];
    const status = supply === target ? "CORRECT" : `MISMATCH (expected ${target / 10 ** TOKEN_DECIMALS})`;
    console.log(`  ${name}: ${supply / 10 ** TOKEN_DECIMALS} -- ${status}`);
  }
}

main().catch((err) => {
  console.error("Burn failed:", err);
  process.exit(1);
});
