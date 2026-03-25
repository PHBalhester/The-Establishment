# Phase 53: Asset Pipeline + Brand Foundation - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Optimize existing scene images (19.5MB PNGs) for web delivery under 2MB total page weight, define the steampunk visual language (palette, typography, z-index layering) as Tailwind v4 @theme tokens, and establish loading/placeholder infrastructure. The Swap Station asset is not yet available and will be provided later -- plan around its absence. Zero new npm dependencies.

</domain>

<decisions>
## Implementation Decisions

### Steampunk Palette
- Warm & polished tone -- brass, copper, amber, rich browns (Bioshock Infinite gentleman's workshop, not Dishonored grimdark)
- Interactive/clickable elements use amber/gold glow on hover -- gaslight illumination feel
- Status colors: classic green/red with steampunk treatment (muted, aged tones -- not neon)
- Surface textures: subtle aged parchment style (da Vinci notebook aesthetic) -- readable, not gritty
- CSS-achievable textures preferred; any texture images must be tiny

### Typography
- Primary font: Victorian/serif family (e.g., Playfair Display, Cinzel, EB Garamond -- researcher to evaluate options)
- Financial data (prices, balances, percentages): distinct monospace/tabular font for instrument-readout feel and column alignment
- Headings: bold & dramatic -- large Victorian serif with brass/gold color treatment, like engraved nameplates
- Font loading: Google Fonts (1-2 families), self-hosted subsets if performance warrants
- Body text must remain highly readable despite decorative heading style

### Image Treatment
- Overlay objects: transparent cutouts floating over the scene (not framed panels, not baked-in hotspots)
- Hover effect: bright edge highlight with soft amber glow emanating outward (combination of outline + glow)
- Existing assets in WebsiteAssets/ are full-scene dimensions -- need cropping to bounding boxes before optimization
- Blur placeholder: tiny blurred thumbnail of the actual scene for progressive reveal
- Swap Station (SwapMachine) asset: not yet available, user will provide -- use placeholder dimensions for now

### Loading Experience
- Page load sequence: solid dark warm background -> blurred thumbnail fades in -> full scene sharpens
- Overlay reveal: all 6 objects appear at once (no staggered animation)
- Failed overlay loads: retry automatically, show themed placeholder while retrying
- Page spinner: small steampunk-themed gear/gauge animation during initial page load
- No explicit progress bar

### Claude's Discretion
- Exact Tailwind @theme token naming conventions
- Z-index scale values and naming
- Blur placeholder generation method (blurhash, tiny inline base64, etc.)
- Specific WebP compression quality levels (as long as targets are met)
- Retry logic details for failed image loads
- Gear spinner implementation (CSS animation approach)

</decisions>

<specifics>
## Specific Ideas

- Da Vinci notebook aesthetic for surface textures -- aged parchment, not industrial rust
- Bioshock Infinite as tonal reference for the warm/polished steampunk direction
- Hover glow is a combination effect: bright edge highlight (sharp outline) PLUS soft amber outer glow (not one or the other)
- Existing assets inventory (WebsiteAssets/):
  - MainBackground.png (12MB) -- factory scene background
  - CarnageCauldron.png (947KB)
  - ConnectWallet.png (2.1MB)
  - DocumentationTable.png (1.6MB)
  - RewardsVat.png (1.8MB)
  - Settings.png (1.1MB)
  - **Missing:** SwapMachine/SwapStation overlay (user providing later)
- All overlay PNGs are full-scene dimensions and need bounding-box cropping + WebP conversion

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 53-asset-pipeline-brand-foundation*
*Context gathered: 2026-02-22*
