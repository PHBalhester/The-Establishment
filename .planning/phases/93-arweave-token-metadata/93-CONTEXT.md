# Phase 93: Arweave Token Metadata - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

All three tokens (CRIME, FRAUD, PROFIT) display with proper logos, names, and descriptions in every major Solana wallet and explorer. Permanent Arweave storage via Irys, repeatable upload script, metadata URIs integrated into deploy pipeline. Requirements: META-01 through META-09.

</domain>

<decisions>
## Implementation Decisions

### Token Logo Sourcing
- User provides 3 logos as 512x512 PNG files
- Stored at `assets/logos/crime.png`, `assets/logos/fraud.png`, `assets/logos/profit.png` (committed to git -- public brand assets)
- No higher-res variants -- 512x512 only (Metaplex standard)

### Metadata Content
- Token descriptions: themed steampunk flavor text (Claude generates options, user approves each)
- External URL: `fraudsworth.fun` (same for all 3 tokens)
- Twitter/X: `@fraudsworth` / `https://x.com/fraudsworth` (same for all 3 tokens)
- All 3 tokens share the same website and Twitter links
- Metaplex standard fields: name, symbol, description, image, external_url, extensions.website, extensions.twitter

### Upload Workflow
- **Irys SDK** with SOL payment from deployer wallet
- **Real Arweave for both devnet and mainnet** -- permanent storage, same URIs work forever, tiny cost
- **Standalone script** (`upload-metadata.ts`) -- run manually before deploy-all.sh, not integrated into pipeline
- **Idempotent**: checks deployment.json for existing Arweave URIs, skips if present. `--force` flag to re-upload
- Upload order: logos first (get image URIs), then metadata JSON (references image URIs), then write all URIs

### URI Integration
- upload-metadata.ts writes URIs to **both** deployment.json (`metadata` section) AND `.env.{cluster}` files
- deployment.json is canonical source of truth; env vars are convenience
- initialize.ts reads metadata URIs with **env vars overriding deployment.json** (CRIME_METADATA_URI, FRAUD_METADATA_URI, PROFIT_METADATA_URI)
- **Hard error** if no metadata URI found (neither env var nor deployment.json) -- fail-fast, no silent placeholder fallback
- Remove hardcoded Railway placeholder URIs from initialize.ts

### Claude's Discretion
- Whether to copy logos to `app/public/tokens/` as frontend fallback (Arweave is permanent, wallets cache aggressively)
- Exact Irys SDK API usage and node selection
- Error handling and retry logic in upload-metadata.ts
- Verification step (fetch uploaded URIs and validate content)

</decisions>

<specifics>
## Specific Ideas

- Token descriptions should be in-character steampunk flavor text -- Claude generates 2-3 options per token, user picks
- Irys SDK package name needs verification during research (was formerly Bundlr, renamed)
- STATE.md flagged both "Token logo design needed before Phase 93" and "Verify Irys SDK current package name before Phase 93"

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `initialize.ts`: Already creates mints with MetadataPointer extension and calls `tokenMetadataInitializeWithRentTransfer` -- needs URI source changed from hardcoded to env var / deployment.json
- `deployment-schema.ts`: Already has `MetadataInfo` interface with crime/fraud/profit URI fields
- `deploy-all.sh`: Pipeline that upload-metadata.ts runs before (standalone, not integrated)
- `.env.devnet` / `.env.mainnet`: Env file pattern established in Phase 91/92

### Established Patterns
- Idempotent scripts (initialize.ts skips completed steps) -- upload-metadata.ts follows same pattern
- `set -a && source .env.{cluster} && set +a` for env loading
- deployment.json as canonical config, env vars as overrides (pool seeds pattern from Phase 91)
- Fail-fast on missing config (Phase 91/92 precedent)

### Integration Points
- `deployment.json` metadata section receives Arweave URIs from upload-metadata.ts
- `.env.{cluster}` files receive CRIME_METADATA_URI, FRAUD_METADATA_URI, PROFIT_METADATA_URI
- `initialize.ts` Step 4-6 (mint creation) reads URIs from env vars, falls back to deployment.json
- Phase 94/95 depend on metadata being in place for mint creation with proper logos

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 93-arweave-token-metadata*
*Context gathered: 2026-03-13*
