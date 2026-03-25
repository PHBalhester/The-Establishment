/**
 * Solscan URL builders (cluster-aware).
 *
 * Single source of truth for explorer links across the app (toasts, inline
 * banners, account pages). Uses NEXT_PUBLIC_CLUSTER env var to determine the
 * cluster parameter. Mainnet URLs omit the cluster param (Solscan default).
 *
 * Backward compat: falls back to NEXT_PUBLIC_SOLANA_CLUSTER if the new
 * NEXT_PUBLIC_CLUSTER env var is not set.
 */

/**
 * Get the current cluster name from env vars.
 * Reads NEXT_PUBLIC_CLUSTER first, falls back to NEXT_PUBLIC_SOLANA_CLUSTER.
 * Defaults to 'devnet' when neither is set.
 */
export function getCluster(): string {
  return (
    process.env.NEXT_PUBLIC_CLUSTER ??
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ??
    "devnet"
  );
}

/** Append cluster query param for non-mainnet clusters */
function clusterSuffix(): string {
  const cluster = getCluster();
  if (cluster === "mainnet-beta") return "";
  return `?cluster=${cluster}`;
}

/** Solscan transaction URL */
export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}${clusterSuffix()}`;
}

/** Solscan account/address URL */
export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}${clusterSuffix()}`;
}

/** Solscan token page URL */
export function solscanTokenUrl(mint: string): string {
  return `https://solscan.io/token/${mint}${clusterSuffix()}`;
}
