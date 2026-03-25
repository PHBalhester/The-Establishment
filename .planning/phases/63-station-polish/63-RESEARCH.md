# Phase 63: Station Polish - Research

**Researched:** 2026-02-27
**Domain:** React component restyling (CSS/JSX only), dead code removal
**Confidence:** HIGH

## Summary

Phase 63 applies the Phase 60 component kit to three remaining station modals (Carnage Cauldron, Staking/Rewards Vat, Connect Wallet) and removes the dead Dashboard grid code. This is a visual-layer-only phase -- no hook logic, state management, or business logic changes.

The research found that each station has a well-defined component tree with clear boundaries between data hooks (called in station wrappers) and presentational components (pure props). The Phase 62 SwapStation pattern provides a proven template: flip `chromeVariant` to `'kit-frame'` in ModalShell.tsx's STATION_META, then replace inner `brass-button`, `brass-input`, `lever-tab` CSS classes with kit component imports (`Button`, `Input`, `Tabs/TabList/Tab/TabPanel` from `@/components/kit`).

Dashboard removal is safe but has one dependency to resolve first: CarnageStation.tsx imports CarnageCard from `@/components/dashboard/CarnageCard`. Wave 1 (Carnage) must inline/rewrite this card content BEFORE Wave 4 (Dashboard removal) can delete the file. Additionally, `useCurrentSlot` is exclusively used by DashboardGrid and becomes dead code after removal -- it should NOT be deleted in this phase (hooks are out of scope) but should be noted for future cleanup.

**Primary recommendation:** Follow the Phase 62 pattern exactly -- flip chromeVariant per station, replace all inner components with kit equivalents, preserve all hook logic and prop interfaces unchanged. Wave ordering (1-3 stations, then 4 dashboard deletion) naturally handles the CarnageCard import dependency.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@/components/kit` | Phase 60 | Button, Input, Tabs, Card, Frame, Divider, Scrollbar, Toggle, Slider | Project's own design system -- all 9 primitives available |
| CSS classes (kit.css) | Phase 60 | `.kit-button-*`, `.kit-tab-*`, `.kit-input-*`, `.kit-frame-*`, `.kit-card-*` | Formalized equivalents of `brass-button`, `lever-tab`, `brass-input` |
| `modal-chrome-kit` class | Phase 62 | Outer 9-slice border-image frame + text color remapping | Applied via `chromeVariant: 'kit-frame'` in STATION_META |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `station-content` class (globals.css) | Phase 54 | Dark inner wrapper, automatically goes transparent under `modal-chrome-kit` | Already applied by ModalContent.tsx -- no changes needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Rewriting CarnageCard inline in CarnageStation | Moving CarnageCard to a new location | Moving preserves the component boundary but adds a rename step; inlining is simpler for a display-only component of this size (~200 lines). Either works. |

**Installation:** No new packages needed. All kit components already exist.

## Architecture Patterns

### Recommended Project Structure
```
app/components/
├── kit/              # Component kit (DO NOT MODIFY in this phase)
│   ├── index.ts      # Barrel export
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Tabs.tsx
│   ├── Card.tsx
│   ├── Frame.tsx
│   ├── Divider.tsx
│   ├── Toggle.tsx
│   ├── Slider.tsx
│   └── Scrollbar.tsx
├── station/          # Station wrappers (MODIFY in Waves 1-3)
│   ├── CarnageStation.tsx   # Wave 1
│   ├── StakingStation.tsx   # Wave 2
│   └── WalletStation.tsx    # Wave 3
├── staking/          # Staking sub-components (MODIFY in Wave 2)
│   ├── StakingForm.tsx
│   ├── StakingStats.tsx
│   ├── StakeTab.tsx
│   ├── UnstakeTab.tsx
│   ├── ClaimTab.tsx
│   └── StakingStatus.tsx
├── dashboard/        # Dead code (DELETE in Wave 4)
│   ├── DashboardGrid.tsx
│   ├── EpochCard.tsx
│   ├── TaxRatesCard.tsx
│   ├── PoolCard.tsx
│   └── CarnageCard.tsx
└── modal/
    └── ModalShell.tsx  # MODIFY: flip chromeVariant for 3 stations
```

### Pattern 1: chromeVariant Opt-In (Phase 62 Pattern)

**What:** Each station opts into the kit-frame visual treatment by changing one line in ModalShell.tsx's STATION_META record.

**When to use:** Every station being polished in this phase.

**Current state (lines 46-52 of ModalShell.tsx):**
```typescript
const STATION_META: Record<StationId, { title: string; maxWidth: string; chromeVariant: ChromeVariant }> = {
  swap:     { title: 'Swap Machine',      maxWidth: '1100px', chromeVariant: 'kit-frame' },  // Phase 62
  carnage:  { title: 'Carnage Cauldron',   maxWidth: '700px',  chromeVariant: 'classic' },    // Wave 1 -> 'kit-frame'
  staking:  { title: 'Rewards Vat',        maxWidth: '700px',  chromeVariant: 'classic' },    // Wave 2 -> 'kit-frame'
  wallet:   { title: 'Connect Wallet',     maxWidth: '500px',  chromeVariant: 'classic' },    // Wave 3 -> 'kit-frame'
  docs:     { title: 'How It Works',       maxWidth: '800px',  chromeVariant: 'classic' },
  settings: { title: 'Settings',           maxWidth: '500px',  chromeVariant: 'classic' },
};
```

**Effect of flipping to 'kit-frame':**
1. Outer modal frame switches from CSS box-shadow + corner bolts to 9-slice `riveted-paper.png` border-image
2. Classic header (title + close button) is removed; floating close button appears outside the frame
3. `.station-content` background becomes transparent, text color tokens remap to dark-ink-on-parchment
4. On mobile (<1024px), border-image is stripped (fullscreen slide-up has no visible outer frame)

### Pattern 2: Kit Component Replacement

**What:** Replace old CSS-class-based elements with typed kit component imports.

**Mapping:**
| Old Pattern | Kit Replacement | Notes |
|-------------|-----------------|-------|
| `<button className="brass-button ...">` | `<Button variant="secondary" size="sm">` | Primary CTA: variant="primary" |
| `<button className="lever-tab ...">` | `<Tabs>/<TabList>/<Tab>/<TabPanel>` compound | data-state handled internally |
| `<div className="brass-input ...">` | `<Input variant="default" suffix="PROFIT">` | Or wrap existing complex input layout |
| `<div className="bg-factory-surface rounded-lg p-6">` | `<Card frame="asset" header="Section">` | For titled sections |
| `<hr>` or border-t dividers | `<Divider variant="simple">` | Or "ornate" for prominent breaks |

**How SwapForm did it (Phase 62 reference):**
```typescript
import { Input, Toggle, Button } from "@/components/kit";
// Used: <Input suffix="SOL" ...>, <Button variant="secondary" ...>, <Toggle ...>
```

### Pattern 3: CarnageStation Rewrite (Wave 1 Critical Path)

**What:** CarnageStation currently imports CarnageCard from `@/components/dashboard/CarnageCard`. Since Wave 4 deletes that file, Wave 1 must either:
- (A) Inline the CarnageCard display logic directly into CarnageStation.tsx using kit components, OR
- (B) Move CarnageCard.tsx out of dashboard/ into station/ (or a shared location) and rewrite with kit components

**Recommendation:** Option (A) -- inline into CarnageStation.tsx. CarnageCard is ~200 lines of pure display (format helpers + JSX). Inlining it lets us directly replace all `bg-factory-surface border border-factory-border rounded-lg p-6` patterns with kit `<Card>` components and use `<Divider>` between sections. The CarnageStation wrapper is currently only 20 lines -- it will grow but remain a single self-contained component.

**Current CarnageCard structure to rewrite:**
1. Error state banner
2. Vault Balance (primary metric) -- candidate for future gauge
3. Lifetime Stats section (5 key-value rows: CRIME burned, FRAUD burned, SOL spent, triggers, last trigger)
4. Recent Events section (up to 5 event cards with date, action detail, explorer link)

### Anti-Patterns to Avoid
- **Modifying hook logic:** All `useStaking()`, `useCarnageData()`, `useCarnageEvents()`, `useEpochState()` hooks must remain untouched. This is visual-layer only.
- **Changing prop interfaces:** StakingForm, CarnageCard, etc. receive specific prop shapes from their parent hooks. Do not change what data flows through.
- **Removing `.lever-tab` or `.brass-button` CSS:** Other components still use these classes. Kit components are a parallel path; the old CSS classes will be removed later in a cleanup phase.
- **Deleting hooks used exclusively by DashboardGrid:** `useCurrentSlot` is only called by DashboardGrid. It should be left alone -- hook cleanup is out of scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tab state management | Custom data-state + state tracking | `<Tabs value={} onChange={}>` compound | Kit Tabs handles aria-selected, role=tab, role=tabpanel, data-state automatically |
| Input with label/suffix/error | Manual div wrappers + class strings | `<Input label="" suffix="" error="">` | Kit Input generates stable IDs, aria-invalid, aria-describedby |
| Framed sections with headers | `bg-factory-surface border rounded p-6` + manual h2 | `<Card frame="asset" header="Title">` | Kit Card wraps Frame with consistent padding and header rule |
| Horizontal rules between sections | `border-t border-factory-border-subtle` | `<Divider variant="simple">` | Kit Divider has proper `role="separator"` and `aria-hidden="true"` |

**Key insight:** The kit exists precisely so we don't re-implement these patterns with raw Tailwind classes. Every `bg-factory-surface border border-factory-border rounded-lg p-6` div should become a `<Card>` or `<Frame>`.

## Common Pitfalls

### Pitfall 1: Text Color Inversion on Parchment Background
**What goes wrong:** When `chromeVariant` is `'kit-frame'`, the `.modal-chrome-kit .station-content` CSS rule remaps `--color-factory-text` from light (#e8d5b0) to dark ink (#2a1f0e). Components that use `text-factory-text` will automatically get dark text. But components with their own dark backgrounds (like `bg-factory-surface-elevated`) need to locally re-set these variables or the dark ink will be invisible on dark backgrounds.
**Why it happens:** CSS custom property inheritance -- the parchment-mode overrides cascade into all children.
**How to avoid:** For any inner component that retains a dark background (e.g., amount input fields, event cards), ensure the component's container re-sets `--color-factory-text` back to light values. SwapStation Phase 62 handled this by having SwapForm's dark cards locally override the variables. Check visual appearance after each wave.
**Warning signs:** Text disappearing or becoming barely visible in the modal.

### Pitfall 2: CarnageCard Import Breaks Dashboard Deletion
**What goes wrong:** If Wave 4 deletes `@/components/dashboard/CarnageCard.tsx` before Wave 1 rewrites CarnageStation, the build breaks.
**Why it happens:** CarnageStation.tsx line 23: `import { CarnageCard } from '@/components/dashboard/CarnageCard';`
**How to avoid:** Wave ordering (1 before 4) naturally prevents this. Wave 1 must completely remove this import.
**Warning signs:** TypeScript import error in CarnageStation.tsx after dashboard file deletion.

### Pitfall 3: StakingForm Has Self-Contained Hooks
**What goes wrong:** Unlike CarnageStation (which calls hooks and passes props), StakingStation just renders `<StakingForm />`, and StakingForm internally calls `useStaking()`. The hook isn't lifted to the station level.
**Why it happens:** Phase 62 lifted `useSwap()` from SwapForm to SwapStation (Strategy B), but StakingForm was not refactored.
**How to avoid:** Do NOT attempt a state lift for staking in this phase. StakingForm and its children are the modification targets. The station wrapper (StakingStation.tsx) stays thin -- but the inner components (StakingForm, StakeTab, UnstakeTab, ClaimTab, StakingStats, StakingStatus) all need kit replacement.
**Warning signs:** Temptation to lift useStaking() -- this is out of scope.

### Pitfall 4: Compound Tabs Migration
**What goes wrong:** StakingForm currently uses raw `<button className="lever-tab">` with manual `data-state` management and conditional `{staking.activeTab === "stake" && <StakeTab .../>}` rendering. Kit Tabs uses a compound pattern with `<Tabs value={} onChange={}>` + `<TabPanel value="">`.
**Why it happens:** The old pattern predates the kit.
**How to avoid:** Replace the entire tab section:
```tsx
// OLD (StakingForm.tsx lines 117-165)
<div className="flex border-b border-factory-border-subtle">
  {TABS.map(tab => (
    <button className="lever-tab flex-1" data-state={...} onClick={...}>{tab.label}</button>
  ))}
</div>
<div className="p-4">
  {staking.activeTab === "stake" && <StakeTab ... />}
  ...
</div>

// NEW
<Tabs value={staking.activeTab} onChange={staking.setActiveTab}>
  <TabList>
    {TABS.map(tab => <Tab key={tab.key} value={tab.key} disabled={isTransacting}>{tab.label}</Tab>)}
  </TabList>
  <TabPanel value="stake"><StakeTab ... /></TabPanel>
  <TabPanel value="unstake"><UnstakeTab ... /></TabPanel>
  <TabPanel value="claim"><ClaimTab ... /></TabPanel>
</Tabs>
```
**Warning signs:** Tab selection not working after migration -- check that `staking.setActiveTab` type signature matches `onChange: (value: string) => void`.

### Pitfall 5: Mobile Border Stripping
**What goes wrong:** On mobile (<1024px / 64rem), the `modal-chrome-kit` class strips the border-image (`border: none; border-image: none`). Content should still look good without the outer frame.
**Why it happens:** Mobile uses a fullscreen slide-up with no visible outer frame.
**How to avoid:** Test each wave at mobile viewport after implementation. The inner kit components (Card, Frame with mode="css") should provide their own visual structure.
**Warning signs:** Content looking unframed/unstyled on mobile.

### Pitfall 6: Dashboard useCurrentSlot Hook Orphan
**What goes wrong:** After deleting DashboardGrid.tsx, the `useCurrentSlot` hook has zero consumers. It's not an error (unused exports compile fine), but it becomes dead code.
**Why it happens:** `useCurrentSlot` was exclusively used by DashboardGrid for epoch countdown computation.
**How to avoid:** Note it in the Wave 4 verification step. Do NOT delete the hook in this phase -- it's out of scope. Add a TODO comment or note for a future cleanup phase.
**Warning signs:** None (it silently becomes unused).

## Code Examples

### Example 1: chromeVariant Flip (all three stations)
```typescript
// ModalShell.tsx STATION_META -- change 'classic' to 'kit-frame'
const STATION_META: Record<StationId, { title: string; maxWidth: string; chromeVariant: ChromeVariant }> = {
  swap:     { title: 'Swap Machine',      maxWidth: '1100px', chromeVariant: 'kit-frame' },
  carnage:  { title: 'Carnage Cauldron',   maxWidth: '700px',  chromeVariant: 'kit-frame' },  // Wave 1
  staking:  { title: 'Rewards Vat',        maxWidth: '700px',  chromeVariant: 'kit-frame' },  // Wave 2
  wallet:   { title: 'Connect Wallet',     maxWidth: '500px',  chromeVariant: 'kit-frame' },  // Wave 3
  docs:     { title: 'How It Works',       maxWidth: '800px',  chromeVariant: 'classic' },
  settings: { title: 'Settings',           maxWidth: '500px',  chromeVariant: 'classic' },
};
```

### Example 2: Kit Component Imports Pattern
```typescript
// At the top of restyled components
import { Card, Button, Divider, Scrollbar } from '@/components/kit';
import { Tabs, TabList, Tab, TabPanel } from '@/components/kit';
import { Input } from '@/components/kit';
```

### Example 3: Wallet Station Kit Replacement
```tsx
// WalletStation.tsx -- Before (raw classes)
<button className="w-full flex items-center gap-3 rounded-lg border border-factory-border p-3 hover:brightness-110 transition-[filter] bg-factory-surface-elevated disabled:opacity-50">

// After (kit Card + Button)
<Card>
  <button className="kit-button kit-button-secondary kit-interactive kit-focus w-full flex items-center gap-3">
    ...
  </button>
</Card>
// Or wrap each wallet option in a styled card-like container using Frame
```

### Example 4: Staking Stats with Kit Card
```tsx
// StakingStats.tsx -- Before
<div className="bg-factory-surface rounded-xl p-4 mb-3">

// After
<Card frame="asset" className="mb-3">
  <div className="grid grid-cols-2 gap-3 md:gap-4">
    ...
  </div>
</Card>
```

### Example 5: StakeTab/UnstakeTab Input Replacement
```tsx
// Before (raw brass-input class)
<div className="brass-input rounded-xl p-4">
  <input className="w-full bg-transparent text-2xl ..." />
</div>

// After (kit Input or kit Frame wrapping existing input)
// Note: The staking inputs have a complex layout (label row + balance + max button + input)
// that doesn't map 1:1 to kit Input's simpler label/input/suffix/error layout.
// Two options:
// (A) Use kit Input with custom wrapperClassName for the amount, plus a separate
//     row above for balance/max
// (B) Use <Frame mode="css" padding="sm"> as the container (replacing brass-input)
//     and keep the inner layout
// Option (B) is safer -- preserves the existing layout while getting kit styling.
```

## Component-by-Component Audit

### Wave 1: CarnageStation.tsx

**Current structure:** 45 lines. Calls 3 hooks, passes props to `CarnageCard` (imported from dashboard/).

**Work required:**
1. Remove import from `@/components/dashboard/CarnageCard`
2. Inline CarnageCard's display logic directly into CarnageStation
3. Replace outer `bg-factory-surface border rounded-lg p-6` with `<Card frame="asset">`
4. Replace `border-t border-factory-border-subtle` dividers with `<Divider>`
5. Replace event card containers with `<Card>` or `<Frame>`
6. Use `<Scrollbar>` for events list if it gets long
7. Keep all format helpers (formatTokenBurned, formatSol, formatEventDate) -- they are pure functions
8. Keep all hook calls (useCarnageData, useCarnageEvents, useEpochState) unchanged

**Kit components used:** Card, Divider, Scrollbar, possibly Frame

**Estimated size:** ~250 lines after inlining (was 45 + 200 from CarnageCard)

### Wave 2: StakingStation.tsx + StakingForm + Sub-Components

**Current structure:** StakingStation (24 lines) renders `<StakingForm />`. StakingForm (179 lines) calls `useStaking()` and renders StakingStats, tab buttons, StakeTab/UnstakeTab/ClaimTab, StakingStatus.

**Files to modify (6 files):**
1. **StakingForm.tsx** (179 lines) -- Replace `lever-tab` buttons with kit `<Tabs>` compound, replace `bg-factory-surface rounded-xl` container with `<Card>`
2. **StakingStats.tsx** (177 lines) -- Replace outer `bg-factory-surface rounded-xl` with `<Card>`, replace StatItem styling
3. **StakeTab.tsx** (118 lines) -- Replace `brass-input` wrapper with kit `<Frame>` or `<Input>`, replace `brass-button` Max with kit `<Button>`
4. **UnstakeTab.tsx** (139 lines) -- Same as StakeTab plus warning banner styling
5. **ClaimTab.tsx** (129 lines) -- Replace `bg-factory-surface-elevated rounded-xl` reward display with kit `<Card>`, replace expand/collapse button with kit `<Button variant="ghost">`
6. **StakingStatus.tsx** (169 lines) -- Replace `brass-button` action button with kit `<Button variant="primary">`

**Kit components used:** Tabs, TabList, Tab, TabPanel, Card, Frame, Button, Input, Divider

**Estimated total changes:** ~6 files, moderate edits each

### Wave 3: WalletStation.tsx

**Current structure:** 70 lines. Uses `useWallet()` and `useModal()`. Lists detected wallets as clickable buttons.

**Work required:**
1. Replace outer `space-y-4` wrapper (text + wallet list) with kit-styled layout
2. Replace "no wallets detected" `rounded-lg border border-factory-border p-4` with `<Card>`
3. Replace wallet selection `<button>` elements with kit `<Button>` or styled `<Card>` containers
4. Replace `text-factory-text-*` inline classes with kit color tokens (these auto-remap under kit-frame)

**Kit components used:** Card, Button, Frame
**Estimated size:** Minimal -- this is the smallest wave (~70 lines, simple layout)

### Wave 4: Dashboard Removal

**Files to delete (5 files):**
1. `app/components/dashboard/DashboardGrid.tsx` (199 lines)
2. `app/components/dashboard/EpochCard.tsx` (117 lines)
3. `app/components/dashboard/TaxRatesCard.tsx` (85 lines)
4. `app/components/dashboard/PoolCard.tsx` (235 lines)
5. `app/components/dashboard/CarnageCard.tsx` (308 lines)

**Import analysis:**
- `DashboardGrid` -- NOT imported anywhere (confirmed via grep). Safe to delete.
- `EpochCard` -- Only imported by DashboardGrid. Safe to delete.
- `TaxRatesCard` -- Only imported by DashboardGrid. Safe to delete.
- `PoolCard` -- Only imported by DashboardGrid. Safe to delete.
- `CarnageCard` -- Imported by DashboardGrid AND CarnageStation.tsx. Must be resolved in Wave 1 first.

**Hook analysis after deletion:**
- `useCurrentSlot` -- ONLY consumer is DashboardGrid. Becomes dead code. DO NOT delete (out of scope). Note for future cleanup.
- `useSolPrice` -- Also used by SwapStatsBar.tsx. Safe (still has consumers).
- `usePoolPrices` -- Also used by SwapStatsBar.tsx and useSwap.ts. Safe.
- `useEpochState` -- Also used by CarnageStation.tsx. Safe.
- `useCarnageData` -- Also used by CarnageStation.tsx. Safe.
- `useCarnageEvents` -- Also used by CarnageStation.tsx (and its `carnageActionLabel` export). Safe.

**Type export analysis:**
- `CarnageCardProps` -- Only used internally in CarnageCard.tsx. Safe to delete.
- `EpochCardProps`, `TaxRatesCardProps`, `PoolCardProps` -- Only used internally. Safe.

**Verification steps:**
1. `grep -r "from.*@/components/dashboard" app/` should return 0 results after Wave 1+4
2. `npx tsc --noEmit` should pass (no broken imports)
3. `npm run build` should succeed

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `brass-button` CSS class | `kit Button` component | Phase 60 | Type-safe, variant API |
| `lever-tab` CSS class | `kit Tabs` compound component | Phase 60 | Accessibility (ARIA), state encapsulation |
| `brass-input` CSS class | `kit Input` component | Phase 60 | Label/suffix/error built in |
| Manual `bg-factory-surface border rounded p-6` | `kit Card` / `kit Frame` | Phase 60 | Consistent padding, header pattern |
| `border-t border-factory-border-subtle` | `kit Divider` | Phase 60 | Semantic role=separator, three variants |
| `chromeVariant: 'classic'` (box-shadow + bolts) | `chromeVariant: 'kit-frame'` (9-slice) | Phase 62 | Per-station opt-in, riveted parchment frame |

**Deprecated/outdated:**
- `brass-button`, `lever-tab`, `brass-input` CSS classes: Still in globals.css but being replaced phase-by-phase. Do NOT remove them yet.

## Open Questions

1. **Dark background inner components under parchment:**
   - What we know: SwapStation Phase 62 handled this by having inner dark-bg components locally re-set CSS variables. Carnage and Staking have similar dark-bg containers.
   - What's unclear: Exact which containers in Carnage/Staking need local variable overrides vs which look good on parchment directly.
   - Recommendation: Apply the frame, visually inspect, add local overrides where text becomes invisible. This is best resolved empirically at each wave checkpoint.

2. **StakeTab/UnstakeTab complex input layout:**
   - What we know: These inputs have a two-row header (token label + balance + Max button) above the actual input field. Kit Input's layout is label-above, input-with-suffix, error-below.
   - What's unclear: Whether to force-fit into kit Input or use Frame as a styled wrapper.
   - Recommendation: Use `<Frame mode="css" padding="sm">` as the container wrapper (replacing `brass-input` div) and keep the inner layout structure. This gets the kit visual treatment without breaking the existing complex layout. Replace the Max `<button className="brass-button">` with kit `<Button variant="secondary" size="sm">`.

3. **Gauge components (optional per CONTEXT.md):**
   - What we know: CONTEXT.md says gauges are optional -- apply frame + kit first, decide at checkpoint.
   - What's unclear: Whether any metrics in Carnage or Staking actually benefit from a gauge.
   - Recommendation: Skip gauges entirely for initial implementation. If the user wants them after seeing the kit-styled stations, they can be added in a follow-up. The bezel asset doesn't exist yet (user will create in Photoshop).

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all files listed in Architecture Patterns section
- `app/components/kit/*.tsx` -- All 9 kit components read and documented
- `app/components/kit/index.ts` -- Barrel export confirms available components
- `app/app/kit.css` -- CSS class definitions for all kit components
- `app/app/globals.css` -- `modal-chrome-kit`, `station-content`, `brass-button`, `lever-tab`, `brass-input` CSS verified
- `app/components/modal/ModalShell.tsx` -- chromeVariant mechanism fully documented
- `app/components/modal/ModalContent.tsx` -- station-content wrapper confirmed
- Grep analysis of all imports from `@/components/dashboard/` across entire app directory

### Secondary (MEDIUM confidence)
- Phase 62 SwapStation pattern (read directly from committed code -- proven working)

### Tertiary (LOW confidence)
- None. All findings are from direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all kit components inspected, CSS verified
- Architecture: HIGH -- chromeVariant pattern proven by Phase 62, import dependencies fully mapped
- Pitfalls: HIGH -- text color inversion, CarnageCard import dependency, compound tabs migration all verified by direct code reading
- Dashboard removal safety: HIGH -- grep-verified all import references, hook consumer analysis complete

**Research date:** 2026-02-27
**Valid until:** 2026-03-30 (stable -- internal codebase, no external dependency changes)
