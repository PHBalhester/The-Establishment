/**
 * Token Metadata Templates
 *
 * Contains the canonical metadata content for all three Dr. Fraudsworth tokens.
 * Descriptions are steampunk-themed and in-character for the project universe.
 *
 * Usage: Called by upload-metadata.ts to build Metaplex-standard JSON for Arweave upload.
 *
 * Description options are provided as comments. The default selection can be changed
 * during Plan 02 review. Keep descriptions concise (1-2 sentences max).
 *
 * Source: .planning/phases/93-arweave-token-metadata/93-01-PLAN.md
 */

// =============================================================================
// Types
// =============================================================================

export interface TokenMetadataTemplate {
  name: string;
  symbol: string;
  description: string;
  imagePath: string;
}

// =============================================================================
// Metaplex-Standard JSON Builder
// =============================================================================

/**
 * Build a Metaplex fungible token standard JSON object.
 *
 * Fields: name, symbol, description, image, external_url, extensions (website, twitter).
 * This is the off-chain JSON file that wallets and explorers fetch from the URI
 * stored in the on-chain Token-2022 metadata.
 *
 * @param tokenKey - Token key in TOKENS record (crime, fraud, profit)
 * @param imageUri - Permanent Arweave URI for the token logo PNG
 * @returns Complete Metaplex-standard metadata JSON object
 */
export function buildMetadataJson(
  tokenKey: string,
  imageUri: string,
): Record<string, unknown> {
  const token = TOKENS[tokenKey.toLowerCase()];
  if (!token) {
    throw new Error(`Unknown token: ${tokenKey}. Expected: crime, fraud, profit`);
  }

  return {
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    image: imageUri,
    external_url: EXTERNAL_URL,
    extensions: {
      website: EXTERNAL_URL,
      twitter: TWITTER_URL,
    },
  };
}

// =============================================================================
// Constants
// =============================================================================

const EXTERNAL_URL = "https://fraudsworth.fun";
const TWITTER_URL = "https://x.com/fraudsworth";

// =============================================================================
// Token Templates
// =============================================================================

/**
 * CRIME Description Options:
 *
 * Option A (selected):
 *   "The preferred currency of the underworld's most distinguished criminal enterprises.
 *    Every transaction powers Dr. Fraudsworth's magnificent contraptions."
 *
 * Option B:
 *   "Minted in the steam-powered vaults beneath Dr. Fraudsworth's laboratory.
 *    A token for those who appreciate the finer things in larceny."
 *
 * Option C:
 *   "Forged in brass and ambition. CRIME fuels the gears of Dr. Fraudsworth's
 *    grandest schemes and rewards those bold enough to participate."
 */

/**
 * FRAUD Description Options:
 *
 * Option A (selected):
 *   "The twin engine of Dr. Fraudsworth's steam-powered empire.
 *    Where there is CRIME, FRAUD is never far behind."
 *
 * Option B:
 *   "Distilled from the finest deceptions and bottled in brass.
 *    FRAUD greases the gears of Dr. Fraudsworth's grandest contraptions."
 *
 * Option C:
 *   "A token of impeccable duplicity, crafted by Dr. Fraudsworth himself.
 *    The backbone of every well-executed confidence scheme."
 */

/**
 * PROFIT Description Options:
 *
 * Option A (selected):
 *   "The yield of Dr. Fraudsworth's perpetual motion engine.
 *    Stakers earn PROFIT from the friction of every trade."
 *
 * Option B:
 *   "Real yield, distilled from real trading friction.
 *    Dr. Fraudsworth's most elegant invention -- money that makes money."
 *
 * Option C:
 *   "The golden output of Dr. Fraudsworth's yield apparatus.
 *    Earned through staking, powered by protocol revenue."
 */

export const TOKENS: Record<string, TokenMetadataTemplate> = {
  crime: {
    name: "CRIME",
    symbol: "CRIME",
    description:
      "Minted in the steam-powered vaults beneath Dr. Fraudsworth's laboratory. A token for those who appreciate the finer things in larceny.",
    imagePath: "assets/logos/crime.png",
  },
  fraud: {
    name: "FRAUD",
    symbol: "FRAUD",
    description:
      "A token of impeccable duplicity, crafted by Dr. Fraudsworth himself. The backbone of every well-executed confidence scheme.",
    imagePath: "assets/logos/fraud.png",
  },
  profit: {
    name: "PROFIT",
    symbol: "PROFIT",
    description:
      "The spoils of Dr. Fraudsworth's perpetual motion engine. Stake your tokens, earn your rewards. Crime does pay, after all.",
    imagePath: "assets/logos/profit.png",
  },
};
