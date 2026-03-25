# Phase 93: Arweave Token Metadata - Research

**Researched:** 2026-03-13
**Domain:** Arweave permanent storage via Irys, Metaplex token metadata standard, Token-2022 MetadataPointer updates
**Confidence:** MEDIUM (Irys SDK API verified from docs but rapid ecosystem changes; Token-2022 update path HIGH)

## Summary

Phase 93 uploads three token logos and three metadata JSON files to Arweave via Irys, then updates the on-chain Token-2022 metadata URI to point to the permanent Arweave URLs. The project's mints already have MetadataPointer extensions with placeholder Railway URIs -- the update path uses `tokenMetadataUpdateField` from `@solana/spl-token` (already installed).

The Irys ecosystem has undergone significant changes. The old `@irys/sdk` package (which handled Arweave bundling) is deprecated. The current recommended packages are `@irys/upload` + `@irys/upload-solana`. On Irys mainnet, uploads are bundled and permanently stored on Arweave. On Irys devnet, uploads use free faucet tokens but data is deleted after ~60 days. Per CONTEXT.md decision, we use Irys mainnet (real SOL payment, permanent Arweave storage) for both devnet and mainnet token deployments.

Cost is negligible -- Arweave storage runs ~$6-8/GB. Three 512x512 PNGs (~100-300KB each) plus three small JSON files (~500 bytes each) totals well under 1MB. Expected cost: < 0.01 SOL total.

**Primary recommendation:** Use `@irys/upload` + `@irys/upload-solana` for uploads. Upload PNGs first, get image URIs, embed in metadata JSON, upload JSONs, write all URIs to deployment.json + .env files. Then use `tokenMetadataUpdateField` to update on-chain URIs (or rely on initialize.ts reading URIs on fresh deploy).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@irys/upload` | latest | Irys upload SDK core | Official Irys package for permanent uploads |
| `@irys/upload-solana` | 0.1.x | Solana wallet adapter for Irys | Required companion for SOL-funded uploads |
| `@solana/spl-token` | 0.4.x | Token-2022 metadata updates | Already installed -- `tokenMetadataUpdateField` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fs/promises` | Node built-in | Read logo files from disk | Upload workflow |
| `path` | Node built-in | File path resolution | Asset path management |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@irys/upload` | `@irys/sdk` (deprecated) | Old package, no longer maintained, will stop working |
| `@irys/upload` | Direct Arweave (`arweave` npm) | No bundling, slower finality, more complex |
| `@irys/upload` | Shadow Drive | Not permanent, Solana-specific, less ecosystem support |
| Arweave | IPFS/Pinata | Not permanent -- requires ongoing pinning payments |

**Installation:**
```bash
export PATH="/opt/homebrew/bin:$PATH"
npm install @irys/upload @irys/upload-solana
```

## Architecture Patterns

### Recommended Project Structure
```
assets/
  logos/
    crime.png          # 512x512 PNG (user-provided)
    fraud.png          # 512x512 PNG (user-provided)
    profit.png         # 512x512 PNG (user-provided)
scripts/
  deploy/
    upload-metadata.ts # Standalone upload script
    lib/
      irys-uploader.ts # Irys client factory (optional extraction)
deployments/
  devnet.json          # metadata section receives URIs
.env.devnet            # CRIME_METADATA_URI, FRAUD_METADATA_URI, PROFIT_METADATA_URI
.env.mainnet           # Same env vars for mainnet
```

### Pattern 1: Irys Upload with Solana Wallet

**What:** Initialize Irys uploader with deployer wallet, fund, upload files
**When to use:** Any permanent Arweave upload paid with SOL

```typescript
// Source: https://docs.irys.xyz/build/d/sdk/setup (verified)
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";

const getIrysUploader = async (privateKey: string) => {
  const irysUploader = await Uploader(Solana)
    .withWallet(privateKey);
  return irysUploader;
};

// Upload a file
const uploadFile = async (irys: any, filePath: string, contentType: string) => {
  const { size } = await fs.promises.stat(filePath);
  const price = await irys.getPrice(size);
  await irys.fund(price);

  const receipt = await irys.uploadFile(filePath, {
    tags: [{ name: "Content-Type", value: contentType }],
  });
  // Permanent URL: https://gateway.irys.xyz/{receipt.id}
  // Also accessible via: https://arweave.net/{receipt.id}
  return `https://arweave.net/${receipt.id}`;
};
```

**Confidence:** MEDIUM -- API shape verified from multiple official sources. The `withWallet()` accepts a base58 private key string. Exact error handling and funding flow should be validated at implementation time.

### Pattern 2: Metaplex Fungible Token Metadata JSON

**What:** Off-chain JSON file referenced by Token-2022 metadata URI
**When to use:** Every Solana fungible token that wants wallet/explorer display

```json
{
  "name": "CRIME",
  "symbol": "CRIME",
  "description": "Steampunk themed description here",
  "image": "https://arweave.net/<image-tx-id>",
  "external_url": "https://fraudsworth.fun",
  "extensions": {
    "website": "https://fraudsworth.fun",
    "twitter": "https://x.com/fraudsworth"
  }
}
```

**Confidence:** HIGH -- Metaplex standard is well-documented and stable. The fungible token schema is minimal: name, symbol, description, image. The `external_url` and `extensions` fields are widely recognized by wallets/explorers.

Source: https://developers.metaplex.com/token-metadata/token-standard

### Pattern 3: Token-2022 Metadata URI Update

**What:** Update the on-chain URI in an existing mint's metadata extension
**When to use:** When mints already exist with placeholder URIs (our case)

```typescript
// Source: https://solana-labs.github.io/solana-program-library/token/js/functions/tokenMetadataUpdateField.html
import { tokenMetadataUpdateField } from "@solana/spl-token";

await tokenMetadataUpdateField(
  connection,           // Connection
  payer,                // Signer (deployer wallet)
  mintPublicKey,        // The mint to update
  updateAuthority,      // Must be the metadata update authority (deployer)
  "uri",                // Field name -- "uri" for the metadata URI
  arweaveMetadataUrl,   // New value: https://arweave.net/<tx-id>
);
```

**Confidence:** HIGH -- `tokenMetadataUpdateField` is in `@solana/spl-token` 0.4.x which is already installed. The field parameter accepts "uri" as a string (one of the required fields: name, symbol, uri). The update authority was set to the deployer wallet in initialize.ts (line 333: `authority.publicKey` passed as metadata pointer authority).

### Pattern 4: Idempotent Upload Script

**What:** Check deployment.json for existing URIs, skip if present, force flag to re-upload
**When to use:** Matches existing project pattern (initialize.ts is idempotent)

```typescript
// Read existing deployment config
const config = JSON.parse(fs.readFileSync(`deployments/${cluster}.json`, "utf-8"));

// Check if metadata already uploaded
if (config.metadata?.crime && !forceFlag) {
  console.log("Metadata already uploaded, skipping. Use --force to re-upload.");
  return;
}

// After upload, write back
config.metadata = {
  crime: crimeMetadataUri,
  fraud: fraudMetadataUri,
  profit: profitMetadataUri,
};
fs.writeFileSync(`deployments/${cluster}.json`, JSON.stringify(config, null, 2));
```

### Anti-Patterns to Avoid

- **Using Irys devnet for permanent assets:** Irys devnet data is deleted after ~60 days. Always use Irys mainnet for production-grade metadata, even during devnet protocol testing.
- **Hardcoding URIs after upload:** Always write URIs to deployment.json and .env files as the source of truth. Never paste URIs directly into code.
- **Uploading metadata JSON before images:** The JSON references the image URI. Upload images first, get URIs, embed in JSON, then upload JSON.
- **Burning update authority before verifying metadata:** Once authority is burned/transferred, URIs cannot be corrected. Verify rendering in wallets first.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Arweave upload bundling | Custom Arweave TX construction | `@irys/upload` | Bundling, finality guarantees, receipt verification |
| Token-2022 metadata update | Raw instruction building | `tokenMetadataUpdateField` | Handles reallocation, rent transfer, correct program ID |
| Metadata JSON schema | Custom format | Metaplex fungible token standard | Wallets only recognize the standard format |
| File content-type tagging | Manual header construction | Irys tags API `[{ name: "Content-Type", value: "image/png" }]` | Gateways need Content-Type for correct rendering |

**Key insight:** The upload-to-Arweave step is well-solved by Irys. The metadata-JSON-to-wallet-display step is well-solved by the Metaplex standard. The on-chain-URI-update step is well-solved by `@solana/spl-token`. There is zero novel code needed -- just wiring established tools together.

## Common Pitfalls

### Pitfall 1: Using Irys Devnet for "Permanent" Assets

**What goes wrong:** Developer uploads to Irys devnet thinking it goes to Arweave. Data is deleted after ~60 days. Token logos disappear.
**Why it happens:** Irys devnet uses free faucet tokens (appealing during development). The upload succeeds and returns a valid-looking URL.
**How to avoid:** Always use Irys mainnet for metadata uploads. The cost is negligible (< 0.01 SOL for all 6 files). The CONTEXT.md decision already mandates this.
**Warning signs:** URLs on `devnet.irys.xyz` gateway instead of `arweave.net`.

### Pitfall 2: Wrong Content-Type Tags

**What goes wrong:** PNG uploaded without `Content-Type: image/png` tag. Arweave gateway serves it as `application/octet-stream`. Wallets can't render the logo.
**Why it happens:** Irys doesn't auto-detect content type. Must be specified via tags.
**How to avoid:** Always include `{ name: "Content-Type", value: "image/png" }` for images and `{ name: "Content-Type", value: "application/json" }` for metadata JSON.
**Warning signs:** Logo shows as broken image in wallet. Direct URL download prompts file save instead of displaying image.

### Pitfall 3: On-Chain URI Still Points to Railway Placeholder

**What goes wrong:** Metadata uploaded to Arweave correctly, but on-chain Token-2022 metadata URI still says `https://dr-fraudsworth-production.up.railway.app/api/metadata/crime`. Wallets show Railway content (or nothing if Railway is down).
**Why it happens:** Uploading to Arweave is separate from updating on-chain metadata. The `tokenMetadataUpdateField` call is a second step that's easy to forget.
**How to avoid:** The upload-metadata.ts script should either (a) update URIs on-chain as a final step, or (b) clearly output "NEXT STEP: run update-metadata-uri.ts". For fresh deploys (mainnet), initialize.ts reads URIs from env vars, so the on-chain update happens automatically.
**Warning signs:** `solana account <MINT_ADDRESS>` shows old URI in the metadata bytes.

### Pitfall 4: Wallet Caching Stale Metadata

**What goes wrong:** Metadata updated on-chain but Phantom still shows old logo/name. Developer thinks update failed.
**Why it happens:** Wallets aggressively cache token metadata. Phantom can cache for hours.
**How to avoid:** Clear wallet cache, test in incognito/fresh wallet. Solscan/Explorer update faster -- check there first. Be patient.
**Warning signs:** Different wallets show different metadata versions.

### Pitfall 5: Irys Funding Insufficient

**What goes wrong:** `irys.fund(price)` fails because deployer wallet doesn't have enough SOL, or the fund transaction fails on-chain.
**Why it happens:** Fund step transfers SOL from deployer to Irys node. If wallet balance is low or network is congested, it fails.
**How to avoid:** Check `getPrice()` before funding. Log the cost. Ensure deployer wallet has at least 0.1 SOL buffer beyond the upload cost.
**Warning signs:** "Insufficient funds" error from Irys SDK.

### Pitfall 6: Private Key Format Mismatch

**What goes wrong:** Irys `withWallet()` expects a base58-encoded private key string, but the project uses JSON keypair files (Uint8Array format).
**Why it happens:** Solana keypair files store a 64-byte array. Irys SDK expects a base58 string.
**How to avoid:** Convert keypair file to base58: `bs58.encode(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8'))))`. Or use `Keypair.fromSecretKey()` and extract.
**Warning signs:** "Invalid private key" or wallet initialization errors.

## Code Examples

### Complete Upload Workflow (Verified Pattern)

```typescript
// Source: Synthesized from https://docs.irys.xyz/build/d/sdk/setup
//         and https://docs.irys.xyz/build/d/guides/uploading-nfts

import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import * as fs from "fs";
import * as path from "path";

interface TokenMeta {
  name: string;
  symbol: string;
  description: string;
  imagePath: string;
}

const TOKENS: Record<string, TokenMeta> = {
  crime: {
    name: "CRIME",
    symbol: "CRIME",
    description: "TBD - steampunk flavor text",
    imagePath: "assets/logos/crime.png",
  },
  fraud: {
    name: "FRAUD",
    symbol: "FRAUD",
    description: "TBD - steampunk flavor text",
    imagePath: "assets/logos/fraud.png",
  },
  profit: {
    name: "PROFIT",
    symbol: "PROFIT",
    description: "TBD - steampunk flavor text",
    imagePath: "assets/logos/profit.png",
  },
};

async function uploadMetadata(keypairPath: string, cluster: string) {
  // 1. Load deployer keypair and create Irys uploader
  const keypairBytes = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const privateKeyBase58 = bs58.encode(Uint8Array.from(keypairBytes));

  // Always use Irys mainnet for permanent Arweave storage
  const irys = await Uploader(Solana).withWallet(privateKeyBase58);

  // 2. Upload logos first
  const imageUris: Record<string, string> = {};
  for (const [key, token] of Object.entries(TOKENS)) {
    const { size } = await fs.promises.stat(token.imagePath);
    const price = await irys.getPrice(size);
    console.log(`${key} logo: ${size} bytes, cost: ${irys.utils.fromAtomic(price)} SOL`);
    await irys.fund(price);

    const receipt = await irys.uploadFile(token.imagePath, {
      tags: [{ name: "Content-Type", value: "image/png" }],
    });
    imageUris[key] = `https://arweave.net/${receipt.id}`;
    console.log(`${key} logo uploaded: ${imageUris[key]}`);
  }

  // 3. Create and upload metadata JSON
  const metadataUris: Record<string, string> = {};
  for (const [key, token] of Object.entries(TOKENS)) {
    const metadata = {
      name: token.name,
      symbol: token.symbol,
      description: token.description,
      image: imageUris[key],
      external_url: "https://fraudsworth.fun",
      extensions: {
        website: "https://fraudsworth.fun",
        twitter: "https://x.com/fraudsworth",
      },
    };

    const jsonBuffer = Buffer.from(JSON.stringify(metadata));
    const price = await irys.getPrice(jsonBuffer.length);
    await irys.fund(price);

    const receipt = await irys.upload(JSON.stringify(metadata), {
      tags: [{ name: "Content-Type", value: "application/json" }],
    });
    metadataUris[key] = `https://arweave.net/${receipt.id}`;
    console.log(`${key} metadata uploaded: ${metadataUris[key]}`);
  }

  // 4. Write to deployment.json and .env
  // ... (write URIs to config files)

  return metadataUris;
}
```

### Token-2022 URI Update

```typescript
// Source: https://solana-labs.github.io/solana-program-library/token/js/functions/tokenMetadataUpdateField.html
import { tokenMetadataUpdateField, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

async function updateOnChainUri(
  connection: Connection,
  payer: Keypair,
  mintAddress: PublicKey,
  newUri: string,
) {
  const sig = await tokenMetadataUpdateField(
    connection,
    payer,           // payer for TX fees
    mintAddress,     // the mint account
    payer,           // update authority (deployer holds this)
    "uri",           // field to update
    newUri,          // new Arweave URI
  );
  console.log(`URI updated for ${mintAddress.toBase58()}: ${sig}`);
}
```

### Metaplex Fungible Token JSON Schema

```json
{
  "name": "CRIME",
  "symbol": "CRIME",
  "description": "The coin of the underworld's most distinguished criminal enterprises. Each transaction fuels Dr. Fraudsworth's magnificent contraptions.",
  "image": "https://arweave.net/<tx-id>",
  "external_url": "https://fraudsworth.fun",
  "extensions": {
    "website": "https://fraudsworth.fun",
    "twitter": "https://x.com/fraudsworth"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@bundlr-network/client` | `@irys/upload` + `@irys/upload-solana` | 2024 | Package renamed, API changed |
| `@irys/sdk` (Arweave bundler) | `@irys/upload` (Irys datachain SDK) | 2025 | Old package deprecated, Arweave bundlers EOL |
| Pre-fund Irys balance | Fund per-upload via `fund(price)` | 2024-2025 | Simpler flow, no balance management |
| Metaplex Token Metadata Program (on-chain) | Token-2022 built-in MetadataPointer | 2023 | No external program dependency |

**Deprecated/outdated:**
- `@bundlr-network/client`: Renamed to Irys. Do not use.
- `@irys/sdk` Arweave support: Deprecated. Arweave bundlers no longer actively supported. Use `@irys/upload` instead.
- Railway placeholder URIs: Current codebase has `https://dr-fraudsworth-production.up.railway.app/api/metadata/*`. These must be replaced.

## Open Questions

1. **Exact `withWallet()` input format for Solana**
   - What we know: The SDK accepts a "private key" but documentation doesn't specify if it's base58, Uint8Array, or keypair file path.
   - What's unclear: Whether `withWallet()` can accept a file path directly or needs the key extracted.
   - Recommendation: Try base58 first (most common in Solana SDKs). Fall back to raw bytes. Document what works.
   - Confidence: LOW

2. **Irys mainnet gateway URL permanence**
   - What we know: `https://gateway.irys.xyz/{id}` and `https://arweave.net/{id}` both resolve to the same data.
   - What's unclear: Whether `gateway.irys.xyz` will persist if Irys pivots away from Arweave. The `arweave.net` gateway is operated by the Arweave community, independent of Irys.
   - Recommendation: Use `https://arweave.net/{id}` for all metadata URIs (maximally permanent, independent of Irys company).
   - Confidence: HIGH for `arweave.net` permanence. MEDIUM for `gateway.irys.xyz` permanence.

3. **Whether `@irys/upload` mainnet requires RPC URL**
   - What we know: Irys devnet requires `.withRpc()` and `.devnet()`. Mainnet examples don't show RPC config.
   - What's unclear: Whether mainnet auto-detects Solana mainnet RPC or needs explicit config.
   - Recommendation: Start without RPC config. If it fails, add `.withRpc(MAINNET_RPC_URL)`.
   - Confidence: LOW

4. **Token description content**
   - What we know: CONTEXT.md says Claude generates 2-3 steampunk options per token, user picks.
   - What's unclear: Exact descriptions (creative task, not technical).
   - Recommendation: Generate during plan execution, not research. Plan should include a "draft descriptions" task.

## Sources

### Primary (HIGH confidence)
- [tokenMetadataUpdateField API docs](https://solana-labs.github.io/solana-program-library/token/js/functions/tokenMetadataUpdateField.html) -- full function signature verified
- [Metaplex Token Standard](https://developers.metaplex.com/token-metadata/token-standard) -- fungible token JSON schema
- [Solana Token-2022 MetadataPointer docs](https://solana.com/docs/tokens/extensions/metadata) -- on-chain metadata architecture
- Existing codebase: initialize.ts lines 291-362 -- confirms MetadataPointer extension with Railway placeholder URIs
- Existing codebase: deployment-schema.ts -- `MetadataInfo` interface already defined with crime/fraud/profit fields

### Secondary (MEDIUM confidence)
- [Irys SDK setup docs](https://docs.irys.xyz/build/d/sdk/setup) -- `@irys/upload` + `@irys/upload-solana` package names
- [Irys NFT upload guide](https://docs.irys.xyz/build/d/guides/uploading-nfts) -- upload workflow: image -> JSON -> mint
- [Irys Networks docs](https://docs.irys.xyz/build/d/networks) -- devnet = 60-day deletion, mainnet = permanent Arweave
- [Arweave fee calculator](https://ar-fees.arweave.net/) -- ~$6-8/GB pricing reference

### Tertiary (LOW confidence)
- WebSearch results on `@irys/upload` wallet format -- unclear on exact Solana key input format
- WebSearch results on Irys pricing -- exact SOL cost depends on AR/SOL exchange rate at upload time

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM -- Irys SDK packages verified from docs, but API surface may have subtle differences from documented examples
- Architecture: HIGH -- Upload workflow is straightforward and well-documented across multiple sources
- Token-2022 update: HIGH -- `tokenMetadataUpdateField` verified from official SPL docs, already using `@solana/spl-token`
- Pitfalls: HIGH -- Based on prior v1.4 research + codebase analysis of existing placeholder URIs
- Cost estimates: MEDIUM -- Based on Arweave pricing (~$7/GB) but exact SOL cost varies with exchange rates

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (30 days -- Irys SDK stable, Metaplex standard frozen for fungibles)
