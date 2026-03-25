# Phase 65: Settings Station + Audio Controls UI - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Polish the Settings modal with kit components, add audio controls UI (mute toggle + volume slider), create a unified SettingsProvider with localStorage persistence, and wire SwapForm to consume shared slippage/priority settings. Audio controls are UI-only shells in this phase -- AudioContext wiring happens in Phase 67.

</domain>

<decisions>
## Implementation Decisions

### Audio Controls Shape
- Single audio category: background music only (no SFX in v1.1)
- Controls: mute/unmute toggle + volume slider
- Default state: unmuted at ~20% volume (quiet ambient background)
- No track info display, no separate music/SFX sliders
- `prefers-reduced-motion` should default to muted (accessibility)

### Section Layout
- Three sections only: Wallet > Trading > Audio (RPC endpoint display REMOVED, session-local preview notice REMOVED)
- Settings is now the canonical configuration source (not a preview)
- All sections visible without scrolling -- no tabs needed, content is minimal
- Section headers above each group ("Wallet", "Trading", "Audio")
- Kit GaugeDivider between sections
- Back navigation arrow stays as text link, updated to kit token colors

### Wallet Section Enhancement
- Token balances display added: SOL, CRIME, FRAUD, PROFIT balances shown below wallet address
- Wallet address in kit Input (read-only)
- Copy button = kit Button secondary variant
- Disconnect button = kit Button ghost variant with red text (destructive action)

### Kit Component Styling
- chromeVariant: 'kit-frame' (riveted parchment, consistent with swap/carnage/staking/wallet)
- SlippageConfig internals restyled with kit components (kit Input for custom slippage, kit Button for presets)
- Priority fee presets restyled with kit Buttons
- Audio mute toggle = kit Toggle
- Audio volume = kit Slider
- All raw divs/buttons replaced with kit equivalents

### Shared Settings Context
- Unified SettingsProvider managing ALL preferences: slippage BPS, priority fee preset, mute state, volume level
- localStorage persistence -- settings survive page refresh
- SwapForm consumes slippage/priority from SettingsProvider (no more local state duplication)
- Audio controls write to SettingsProvider -- Phase 67 AudioProvider reads from it
- Single localStorage key for all settings

### Claude's Discretion
- localStorage key naming and serialization format
- SettingsProvider placement in component tree
- Exact volume slider range/step values
- Balance display formatting (decimal places, abbreviation thresholds)
- How to handle SwapForm's existing local slippage state migration

</decisions>

<specifics>
## Specific Ideas

- "Settings are configured directly in Settings now" -- the session-local preview notice and "configured directly in Swap Machine" copy must both be removed
- Volume default at ~20% -- "very light background noise" feel
- Balance display covers exactly 4 tokens: SOL, CRIME, FRAUD, PROFIT

</specifics>

<deferred>
## Deferred Ideas

- None -- discussion stayed within phase scope

</deferred>

---

*Phase: 65-settings-station-audio-controls-ui*
*Context gathered: 2026-02-27*
