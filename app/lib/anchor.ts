/**
 * Anchor Program Factory
 *
 * Creates read-only Anchor Program instances for all 7 production programs.
 * No wallet/provider needed -- these are for account deserialization and
 * PDA derivation only. Wallet-dependent operations come in Phase 40+.
 *
 * IDL JSON files are synced from target/idl/ to app/idl/ by the predev hook
 * (scripts/sync-idl.mjs). Type files provide full TypeScript type safety.
 *
 * CLUSTER-AWARE: The IDL files may contain program IDs from any cluster
 * (whichever was last built). We override the embedded `address` field
 * with the cluster-correct program ID from protocol-config.ts so the
 * frontend always uses the right program regardless of which IDL is on disk.
 */

import { Program } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import { getConnection } from "@/lib/connection";
import { PROGRAM_IDS } from "@/lib/protocol-config";

// IDL JSON imports (synced from target/idl/ by predev hook)
import ammIdl from "@/idl/amm.json";
import bondingCurveIdl from "@/idl/bonding_curve.json";
import vaultIdl from "@/idl/conversion_vault.json";
import epochIdl from "@/idl/epoch_program.json";
import stakingIdl from "@/idl/staking.json";
import taxIdl from "@/idl/tax_program.json";
import hookIdl from "@/idl/transfer_hook.json";

// Anchor-generated TypeScript types for full type safety.
// These are pure type exports (no runtime imports) from target/types/.
import type { Amm } from "@/idl/types/amm";
import type { BondingCurve } from "@/idl/types/bonding_curve";
import type { ConversionVault } from "@/idl/types/conversion_vault";
import type { EpochProgram } from "@/idl/types/epoch_program";
import type { Staking } from "@/idl/types/staking";
import type { TaxProgram } from "@/idl/types/tax_program";
import type { TransferHook } from "@/idl/types/transfer_hook";

/**
 * Override an IDL's embedded program address with the cluster-correct one.
 * The IDL schema/instructions/accounts are identical across clusters —
 * only the program ID differs.
 */
function withClusterAddress<T extends { address: string }>(
  idl: T,
  clusterAddress: { toBase58(): string },
): T {
  return { ...idl, address: clusterAddress.toBase58() };
}

/**
 * Get a read-only AMM Program instance.
 * Can deserialize AdminConfig, PoolState, and other AMM accounts.
 */
export function getAmmProgram(connection?: Connection): Program<Amm> {
  return new Program(withClusterAddress(ammIdl, PROGRAM_IDS.AMM) as unknown as Amm, {
    connection: connection ?? getConnection(),
  });
}

/**
 * Get a read-only Bonding Curve Program instance.
 * Can deserialize CurveState accounts and derive curve PDAs.
 */
export function getBondingCurveProgram(
  connection?: Connection
): Program<BondingCurve> {
  return new Program(withClusterAddress(bondingCurveIdl, PROGRAM_IDS.BONDING_CURVE) as unknown as BondingCurve, {
    connection: connection ?? getConnection(),
  });
}

/**
 * Get a read-only Epoch Program instance.
 * Can deserialize EpochState, CarnageFund accounts.
 */
export function getEpochProgram(
  connection?: Connection
): Program<EpochProgram> {
  return new Program(withClusterAddress(epochIdl, PROGRAM_IDS.EPOCH_PROGRAM) as unknown as EpochProgram, {
    connection: connection ?? getConnection(),
  });
}

/**
 * Get a read-only Staking Program instance.
 * Can deserialize StakePool, UserStake accounts.
 */
export function getStakingProgram(
  connection?: Connection
): Program<Staking> {
  return new Program(withClusterAddress(stakingIdl, PROGRAM_IDS.STAKING) as unknown as Staking, {
    connection: connection ?? getConnection(),
  });
}

/**
 * Get a read-only Tax Program instance.
 * Can deserialize TaxAuthority accounts.
 */
export function getTaxProgram(
  connection?: Connection
): Program<TaxProgram> {
  return new Program(withClusterAddress(taxIdl, PROGRAM_IDS.TAX_PROGRAM) as unknown as TaxProgram, {
    connection: connection ?? getConnection(),
  });
}

/**
 * Get a read-only Transfer Hook Program instance.
 * Can deserialize WhitelistEntry accounts.
 */
export function getHookProgram(
  connection?: Connection
): Program<TransferHook> {
  return new Program(withClusterAddress(hookIdl, PROGRAM_IDS.TRANSFER_HOOK) as unknown as TransferHook, {
    connection: connection ?? getConnection(),
  });
}

/**
 * Get a read-only Conversion Vault Program instance.
 * Can deserialize VaultConfig accounts.
 */
export function getVaultProgram(
  connection?: Connection
): Program<ConversionVault> {
  return new Program(withClusterAddress(vaultIdl, PROGRAM_IDS.VAULT) as unknown as ConversionVault, {
    connection: connection ?? getConnection(),
  });
}
