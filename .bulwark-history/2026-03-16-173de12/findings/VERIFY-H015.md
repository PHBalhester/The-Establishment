# VERIFY-H015: No MEV Protection
**Status:** PARTIALLY_FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

### 1. Default slippage remains 500 BPS (5%)
`app/providers/SettingsProvider.tsx:170` still returns `slippageBps: 500` as the default. The audit recommended reducing to 100-200 BPS (1-2%). No change since round 2.

### 2. No Jito integration
No references to Jito bundles, private mempools, or MEV-aware transaction submission anywhere in the codebase. No change since round 2.

### 3. On-chain slippage floors exist (pre-existing)
- **User swaps:** `MINIMUM_OUTPUT_FLOOR_BPS = 5000` (50%) in `programs/tax-program/src/constants.rs:40` — the on-chain program rejects any swap where output falls below 50% of expected. This is a hard floor, not configurable by users.
- **Carnage atomic:** `CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500` (85%) in `programs/epoch-program/src/constants.rs:127`.
- **Carnage fallback:** `CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500` (75%) in `programs/epoch-program/src/constants.rs:132`.

### 4. UI slippage presets are reasonable
`app/components/swap/SlippageConfig.tsx:43-47` offers presets of 0.5%, 1%, and 2% (50, 100, 200 BPS). Users who open settings will see sensible options. However, the **default** for users who never open settings is still 5%.

### 5. Priority fees implemented (pre-existing)
`SlippageConfig.tsx` and `SettingsProvider.tsx` support priority fee presets (None/Low/Medium/High/Turbo) with Medium as default. This provides some MEV resistance by increasing transaction inclusion priority.

### 6. New: Tax-as-MEV-defense rationale documented (Phase 90)
`Docs/tax-mev-defense.md` (commit c4126eb) provides a formal argument that the protocol's 3-14% variable epoch-based tax on every SOL pool swap makes sandwich attacks unprofitable. Key argument: a round-trip sandwich costs the bot at minimum 6% of position size in taxes (two legs x 3% minimum rate), while typical sandwich profit is 0.1-0.5%. The document frames this as a **structural MEV defense** inherent to the protocol design, superior to Jito bundles because it is on-chain and unavoidable.

## Assessment

**Status remains PARTIALLY_FIXED.** Phase 90 added substantive documentation (`Docs/tax-mev-defense.md`) making a credible case that the tax structure is itself an MEV defense. The argument is sound: a minimum 6% round-trip tax cost on sandwich attacks far exceeds typical sandwich profits of 0.1-0.5%, making the attack economically irrational.

This changes the classification of the remaining gaps:

**Documented accepted risk (Jito integration):** The tax-as-MEV-defense document explicitly compares against Jito and argues the tax is superior because it is on-chain and unavoidable. This is a reasonable design decision, not an oversight. Jito integration is no longer a gap — it is a documented architectural choice.

**Still an open gap (default slippage):** The default slippage of 500 BPS (5%) is still higher than the recommended 100-200 BPS. While the tax structure protects against sandwich attacks specifically, high default slippage still exposes users to unnecessary price impact on legitimate swaps (e.g., large trades in thin liquidity). The UI presets (0.5%, 1%, 2%) are sensible but only help users who actively change their settings.

### Remaining action item
1. **Reduce default slippage to 100-200 BPS** (`app/providers/SettingsProvider.tsx:170`). This is a one-line change with no on-chain impact. The `SwapForm.tsx:455` comment already references "1% slippage" as the intended default.
