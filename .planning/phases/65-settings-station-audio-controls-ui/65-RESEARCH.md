# Phase 65: Settings Station + Audio Controls UI - Research

**Researched:** 2026-02-27
**Domain:** React Context providers, localStorage persistence, kit component composition, ARIA accessibility for audio controls, parchment theme migration
**Confidence:** HIGH

## Summary

This phase transforms the existing SettingsStation from a session-local preview into the canonical configuration source for the application. The work involves three primary areas: (1) creating a unified SettingsProvider with localStorage persistence that replaces the duplicated slippage/priority state in useSwap, (2) rebuilding the settings UI with kit components under the kit-frame chromeVariant, and (3) adding an audio controls UI shell (mute toggle + volume slider) that Phase 67 will wire to an AudioProvider.

The codebase already has all necessary kit primitives (Toggle, Slider, Input, Button, Divider, Frame) from Phase 60, a well-established provider pattern (ModalProvider, ToastProvider), and a proven kit-frame migration path used by 4 other stations. The primary technical challenge is not building new things, but wiring existing pieces together correctly: migrating useSwap's local slippage/priority state to a shared context, ensuring kit components render correctly on the parchment background (several kit components lack parchment CSS overrides), and maintaining proper ARIA semantics on the audio controls for accessibility.

**Primary recommendation:** Build a SettingsProvider using the same createContext + useCallback pattern as ModalProvider, with a single localStorage key for all settings serialized as JSON. Migrate useSwap to consume from this provider. Add parchment CSS overrides for kit-toggle, kit-input, kit-slider, kit-divider, and kit-button-ghost (currently missing). Audio controls use standard kit Toggle + Slider with explicit `aria-label` props.

## Standard Stack

### Core
| Library/Pattern | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React Context (createContext + useContext) | React 19.2.3 | SettingsProvider state management | Already the established pattern in this codebase (ModalProvider, ToastProvider). No external state library per D12 decision. |
| localStorage API | Browser native | Settings persistence across page refreshes | Zero-dependency, synchronous reads for hydration, universally available. |
| Kit components (Toggle, Slider, Input, Button, Divider) | Phase 60 | UI primitives for the settings form | Already built with full ARIA support, steampunk theming, and keyboard navigation. |
| `window.matchMedia('(prefers-reduced-motion: reduce)')` | Browser native | Detect user's motion preference for audio default state | Standard accessibility API, already used in globals.css `@media` queries. |

### Supporting
| Library/Pattern | Purpose | When to Use |
|---------|---------|-------------|
| useTokenBalances hook | Display SOL/CRIME/FRAUD/PROFIT balances in Wallet section | Already exists at `app/hooks/useTokenBalances.ts`. Reuse, do not rebuild. |
| useProtocolWallet hook | Wallet address, connected state, disconnect | Already exists at `app/hooks/useProtocolWallet.ts`. Reuse. |
| PriorityFeePreset type | Type-safe priority fee options | Already exported from `app/hooks/useSwap.ts`. Import the type. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React Context | Zustand | Zustand is great but D12 explicitly says "No Redux, Zustand, or Context" -- though Context IS used (ModalProvider). The pattern is hooks + Context, which is established. Adding Zustand would be inconsistent with codebase conventions. |
| localStorage | sessionStorage | sessionStorage clears on tab close. User decision says "settings survive page refresh" which implies longer persistence. localStorage is correct. |
| Single localStorage key | Multiple keys | Single key serialized as JSON is simpler: one read/write, atomic updates, no key collision risk. Multiple keys become a maintenance burden. |

**Installation:**
No new packages needed. All dependencies are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
app/
  providers/
    SettingsProvider.tsx       # New: createContext + Provider with localStorage
  hooks/
    useSettings.ts            # New: useContext(SettingsContext) with throw guard
  components/
    station/
      SettingsStation.tsx      # Rewrite: 3 sections (Wallet > Trading > Audio)
    swap/
      SlippageConfig.tsx       # Restyle: kit components, consumes useSettings
```

### Pattern 1: SettingsProvider with localStorage Persistence
**What:** A React Context provider that manages all user preferences (slippage BPS, priority fee preset, mute state, volume level) in a single state object. On mount, it reads from localStorage and initializes state. On every state change, it writes back to localStorage synchronously.
**When to use:** Always -- this replaces the scattered local state in useSwap and SettingsStation.
**Example:**
```typescript
// Source: Adapted from existing ModalProvider.tsx pattern at line 108-183

interface Settings {
  slippageBps: number;        // Default: 100 (1%)
  priorityFeePreset: PriorityFeePreset;  // Default: 'medium'
  muted: boolean;             // Default: false (or true if prefers-reduced-motion)
  volume: number;             // Default: 20 (0-100 range)
}

const STORAGE_KEY = 'dr-fraudsworth-settings';

const DEFAULT_SETTINGS: Settings = {
  slippageBps: 100,
  priorityFeePreset: 'medium',
  muted: false,
  volume: 20,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    // Validate each field, falling back to defaults for missing/invalid values
    return {
      slippageBps: typeof parsed.slippageBps === 'number' ? parsed.slippageBps : 100,
      priorityFeePreset: ['none','low','medium','high','turbo'].includes(parsed.priorityFeePreset)
        ? parsed.priorityFeePreset : 'medium',
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
      volume: typeof parsed.volume === 'number' ? parsed.volume : 20,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
```

### Pattern 2: prefers-reduced-motion Default Muted
**What:** On initial load (no existing localStorage), check `window.matchMedia('(prefers-reduced-motion: reduce)')` and default `muted: true` if the user prefers reduced motion.
**When to use:** Only for the initial default computation, before localStorage has been written.
**Example:**
```typescript
function getInitialMuted(): boolean {
  if (typeof window === 'undefined') return false; // SSR safety
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// In loadSettings(), when no localStorage exists:
const defaults = {
  ...DEFAULT_SETTINGS,
  muted: getInitialMuted(),
};
```

### Pattern 3: useSwap Migration (Consuming from SettingsProvider)
**What:** useSwap currently has local `useState` for slippageBps and priorityFeePreset (line 186-187 of useSwap.ts). These should be replaced with reads from useSettings(). The setters should call the settings context's update functions.
**When to use:** After SettingsProvider is created and placed in the component tree.
**Key constraint:** useSwap's `slippageBps` is used in quote computation (line 234, 405, 430, 470, 500, 518, 639). The migration must preserve the exact same values flowing into these calculations.

### Pattern 4: Kit-Frame Chrome Variant Switch
**What:** In ModalShell.tsx line 52, change settings chromeVariant from `'classic'` to `'kit-frame'`.
**When to use:** After the SettingsStation UI has been rebuilt with kit components.
**Side effect:** This triggers the `.modal-chrome-kit .station-content` CSS overrides (globals.css line 614-625) which remap text colors to dark-ink-on-parchment. All Tailwind `text-factory-*` classes automatically resolve to the dark values.

### Anti-Patterns to Avoid
- **Duplicating settings state:** Do NOT keep local slippage state in both useSwap and SettingsProvider. useSwap must consume from SettingsProvider only.
- **Reading localStorage on every render:** Read once on mount, then use React state. Only write to localStorage on updates.
- **useEffect for localStorage writes:** Use synchronous writes inside the setter callback, not a separate useEffect (avoids one-render-behind issues and race conditions).
- **Separate audio provider in this phase:** Phase 67 handles AudioContext wiring. This phase only provides the UI controls and stores preferences. Do not create an AudioProvider here.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toggle switch | Custom div with click handlers | Kit Toggle component | Already built with `role="switch"`, `aria-pressed`, keyboard support, brass theming |
| Volume slider | Custom div with drag handlers | Kit Slider component | Native `<input type="range">` with arrow key nav, screen reader announcements, brass knob styling |
| Section dividers | `<div className="h-px bg-...">` | Kit Divider (variant="ornate" or "riveted") | Semantic `<hr>` with `role="separator"`, themed steampunk styling |
| Form inputs | Raw `<input>` elements | Kit Input component | Recessed gauge styling, label association, error display, suffix support |
| Preset buttons | Raw `<button>` elements | Kit Button component (secondary variant, sm size) | Consistent hover glow, press feedback, disabled appearance |
| Copy/disconnect buttons | Raw styled buttons | Kit Button (secondary for Copy, ghost for Disconnect) | Part of kit-frame parchment context, pre-themed |
| JSON serialization/validation | Manual field-by-field parsing | Structured `loadSettings()` with per-field validation | Handles corrupt localStorage, missing fields, wrong types gracefully |

**Key insight:** Every UI primitive needed for this phase already exists in the kit. The work is composition and wiring, not component creation.

## Common Pitfalls

### Pitfall 1: Missing Parchment CSS Overrides for Kit Components
**What goes wrong:** Kit Toggle, Input, Slider, Divider, and Button ghost variant were built for dark backgrounds (factory-surface). When settings switches to kit-frame chromeVariant, the `.modal-chrome-kit .station-content` context remaps text colors to dark-on-parchment, BUT the kit component internals (track colors, backgrounds, borders) still use dark-mode tokens.
**Why it happens:** globals.css lines 630-668 only have parchment overrides for `.kit-tab` and `.kit-button-secondary`. No overrides exist for Toggle, Input, Slider, Divider, or Button ghost.
**How to avoid:** Add CSS overrides in globals.css for:
- `.modal-chrome-kit .station-content .kit-toggle` -- Track and knob colors that work on parchment
- `.modal-chrome-kit .station-content .kit-input` -- Background, border, and shadow that work on parchment
- `.modal-chrome-kit .station-content .kit-slider` -- Track color visible on parchment
- `.modal-chrome-kit .station-content .kit-divider` -- Brass gradient visible on parchment (may already work since it uses `--color-factory-accent`)
- `.modal-chrome-kit .station-content .kit-button-ghost` -- Border and text visible on parchment
**Warning signs:** Controls appear invisible or have no contrast on the parchment background.

### Pitfall 2: SSR Hydration Mismatch with localStorage
**What goes wrong:** Server renders with defaults (no localStorage in Node.js), client hydrates with localStorage values. React throws a hydration mismatch warning, and the UI may flash between states.
**Why it happens:** Next.js App Router renders on the server first. `localStorage` is browser-only. If the provider reads localStorage during SSR, it crashes; if it uses defaults on server but localStorage on client, the HTML differs.
**How to avoid:** SettingsProvider is a `'use client'` component that uses `useState` with a lazy initializer function. The lazy initializer runs only on the client (during hydration). Since SettingsStation is inside a modal (lazy-loaded, never rendered during SSR), hydration mismatches are not a practical concern -- but the provider might be higher in the tree. Use `typeof window !== 'undefined'` guard in `loadSettings()` for safety.
**Warning signs:** Console warnings about hydration mismatch, brief flash of default values.

### Pitfall 3: useSwap Consuming Settings Before Provider Mounts
**What goes wrong:** If useSwap is called outside the SettingsProvider's subtree (e.g., in a page component rendered before providers), useSettings() throws "must be used within SettingsProvider".
**Why it happens:** useSwap is called inside SwapStation, which is inside ModalContent, which is inside ModalRoot, which is inside providers.tsx. As long as SettingsProvider wraps ModalProvider (or is a sibling above ModalRoot), this is fine.
**How to avoid:** Place SettingsProvider in `providers.tsx` wrapping the children. It should be INSIDE ConnectionProvider/WalletProvider (since it doesn't need wallet context) but OUTSIDE ModalProvider (so modal content can access it).
**Warning signs:** "useSettings must be used within SettingsProvider" runtime error on modal open.

### Pitfall 4: Slider `aria-label` Not Passed Through
**What goes wrong:** The Kit Slider component doesn't spread rest props onto the `<input>` element. Passing `aria-label="Volume"` as a prop does nothing -- it ends up on the wrapper div (if it even accepts it).
**Why it happens:** Slider.tsx line 105-116 constructs the `<input>` with explicit props only (id, type, role, min, max, step, value, disabled, className, onChange). No `{...rest}` spread.
**How to avoid:** Two options: (a) Always use the `label` prop on Slider, which creates a `<label htmlFor={sliderId}>` association (the accessible pattern), or (b) add `aria-label` support to the Slider component as a minor enhancement. Option (a) is sufficient -- the `label` prop already provides screen reader association.
**Warning signs:** Accessibility audit finds slider with no accessible name.

### Pitfall 5: Custom Slippage Input State Desync
**What goes wrong:** SlippageConfig has internal `customSlippage` and `customValue` useState (lines 71-72). When SettingsProvider provides slippageBps, the SlippageConfig's internal "is this a custom value?" logic could get confused if the persisted value doesn't match any preset.
**Why it happens:** SlippageConfig checks `SLIPPAGE_PRESETS.some(p => p.bps === slippageBps)` to determine if the current value is a preset. If localStorage has a custom value (e.g., 150 BPS), the component renders without any preset active, but `customSlippage` state starts as `false`, so neither a preset button nor the custom input is highlighted.
**How to avoid:** Initialize `customSlippage` based on whether the incoming slippageBps matches a preset: `const [customSlippage, setCustomSlippage] = useState(!SLIPPAGE_PRESETS.some(p => p.bps === slippageBps))`.
**Warning signs:** Loading a page with custom slippage from localStorage shows no active preset and no custom input.

### Pitfall 6: Disconnect Button Inside Parchment Context Needs Red Color Override
**What goes wrong:** The Disconnect button is specified as "ghost variant with red text". In the classic dark theme, `text-red-400` works great. On parchment (kit-frame), the remapped `--color-factory-text` is dark ink (#2a1f0e) and Tailwind's `text-red-400` still works (it's not remapped). But the ghost variant's border and hover colors use factory tokens which get remapped.
**Why it happens:** `.modal-chrome-kit .station-content` remaps `--color-factory-text`, `--color-factory-text-secondary`, etc. Tailwind color utilities like `text-red-400` use fixed hex values, not CSS custom properties, so they're unaffected. But the kit-button-ghost class uses `--color-factory-text-secondary` for its color and `--color-factory-surface` for hover background.
**How to avoid:** Add a `className` override on the Disconnect button that uses `!text-red-700` (darker red for parchment contrast). The ghost button's border/hover can use the standard parchment overrides.
**Warning signs:** Red text that's too bright on parchment, or hover background that's invisible.

## Code Examples

### SettingsProvider Structure
```typescript
// Source: Follows ModalProvider.tsx pattern (app/components/modal/ModalProvider.tsx)

'use client';

import { createContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { PriorityFeePreset } from '@/hooks/useSwap';

interface Settings {
  slippageBps: number;
  priorityFeePreset: PriorityFeePreset;
  muted: boolean;
  volume: number;
}

interface SettingsContextValue {
  settings: Settings;
  setSlippageBps: (bps: number) => void;
  setPriorityFeePreset: (preset: PriorityFeePreset) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

// Provider reads from localStorage on mount, writes on every change
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Persist to localStorage on every change
  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setSlippageBps = useCallback((bps: number) => updateSettings({ slippageBps: bps }), [updateSettings]);
  const setPriorityFeePreset = useCallback((preset: PriorityFeePreset) => updateSettings({ priorityFeePreset: preset }), [updateSettings]);
  const setMuted = useCallback((muted: boolean) => updateSettings({ muted }), [updateSettings]);
  const setVolume = useCallback((volume: number) => updateSettings({ volume }), [updateSettings]);

  return (
    <SettingsContext.Provider value={{ settings, setSlippageBps, setPriorityFeePreset, setMuted, setVolume }}>
      {children}
    </SettingsContext.Provider>
  );
}
```

### useSettings Hook
```typescript
// Source: Follows useModal.ts pattern (app/hooks/useModal.ts)

'use client';

import { useContext } from 'react';
import { SettingsContext } from '@/providers/SettingsProvider';

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider.');
  }
  return context;
}
```

### Audio Controls Section (UI Shell)
```tsx
// Kit Toggle for mute, Kit Slider for volume
// All controls write to SettingsProvider; no AudioContext wiring

import { Toggle, Slider } from '@/components/kit';
import { useSettings } from '@/hooks/useSettings';

function AudioSection() {
  const { settings, setMuted, setVolume } = useSettings();

  return (
    <div className="space-y-4">
      <Toggle
        checked={!settings.muted}
        onChange={(on) => setMuted(!on)}
        label="Music"
      />
      <Slider
        value={settings.muted ? 0 : settings.volume}
        onChange={setVolume}
        min={0}
        max={100}
        step={1}
        label="Volume"
        showValue
        formatValue={(v) => `${v}%`}
        disabled={settings.muted}
      />
    </div>
  );
}
```

### Wallet Section with Kit Components
```tsx
// Kit Input (read-only) for address, Kit Button for actions

import { Input, Button } from '@/components/kit';
import { useProtocolWallet } from '@/hooks/useProtocolWallet';
import { useTokenBalances } from '@/hooks/useTokenBalances';

function WalletSection() {
  const { publicKey, connected, disconnect } = useProtocolWallet();
  const balances = useTokenBalances(publicKey);

  if (!connected || !publicKey) return null;

  return (
    <div className="space-y-3">
      {/* Wallet address */}
      <Input
        value={publicKey.toBase58()}
        readOnly
        label="Wallet Address"
        className="font-mono text-xs"
      />

      {/* Token balances grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'SOL', value: balances.sol, decimals: 4 },
          { label: 'CRIME', value: balances.crime, decimals: 2 },
          { label: 'FRAUD', value: balances.fraud, decimals: 2 },
          { label: 'PROFIT', value: balances.profit, decimals: 2 },
        ].map(item => (
          <div key={item.label} className="text-sm">
            <span className="text-factory-text-muted">{item.label}</span>{' '}
            <span className="font-mono">{item.value.toFixed(item.decimals)}</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={handleCopy}>Copy</Button>
        <Button variant="ghost" size="sm" onClick={handleDisconnect} className="!text-red-700">
          Disconnect
        </Button>
      </div>
    </div>
  );
}
```

### Trading Section (Restyled SlippageConfig)
```tsx
// Slippage presets as kit Buttons, custom input as kit Input

import { Button, Input } from '@/components/kit';
import { useSettings } from '@/hooks/useSettings';

const SLIPPAGE_PRESETS = [
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
  { label: '2%', bps: 200 },
];

function TradingSection() {
  const { settings, setSlippageBps, setPriorityFeePreset } = useSettings();

  return (
    <div className="space-y-3">
      <div>
        <span className="kit-input-label">Slippage Tolerance</span>
        <div className="flex gap-1.5 mt-1">
          {SLIPPAGE_PRESETS.map(p => (
            <Button
              key={p.bps}
              variant="secondary"
              size="sm"
              data-state={settings.slippageBps === p.bps ? 'active' : 'inactive'}
              onClick={() => setSlippageBps(p.bps)}
            >
              {p.label}
            </Button>
          ))}
          {/* Custom input button/field */}
        </div>
      </div>
      {/* Priority fee section - similar pattern with preset buttons */}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Settings are session-local preview (SettingsStation.tsx line 124-128) | Settings are canonical source with localStorage persistence | This phase | SwapForm no longer maintains its own slippage state |
| useSwap owns slippageBps/priorityFeePreset (useSwap.ts line 186-187) | SettingsProvider owns all config; useSwap reads from it | This phase | Single source of truth for trading preferences |
| Raw HTML buttons/inputs in SettingsStation | Kit components (Toggle, Slider, Input, Button, Divider) | This phase | Consistent steampunk theming, full ARIA support |
| 'classic' chromeVariant for settings | 'kit-frame' chromeVariant | This phase | Parchment border-image frame, ink-on-parchment text colors |
| Raw `<div className="h-px bg-factory-border" />` dividers | Kit Divider (ornate/riveted variants) | This phase | Semantic `<hr>`, decorative steampunk styling |

**Items being removed:**
- Session-local preview notice (amber box, line 124-128)
- "configured directly in Swap Machine" copy
- RPC Endpoint display section
- Raw HTML buttons/inputs (replaced by kit components)

## Open Questions

1. **Volume slider range and step for audio**
   - What we know: Range is 0-100, default ~20%. Step of 1 gives fine granularity.
   - What's unclear: Should the slider be non-linear (logarithmic) for volume perception? Audio volume perception is logarithmic -- a linear slider feels "all in the first 20%".
   - Recommendation: Use linear for now (standard HTML range behavior). Phase 67 can apply a logarithmic curve when converting the 0-100 value to AudioContext gain (0.0 to 1.0). The UI slider value should remain linear for simplicity.

2. **Existing SlippageConfig component: restyle or rewrite?**
   - What we know: SlippageConfig is 190 lines with preset buttons, custom input, and warning logic. It's imported by both SwapForm (via props) and SettingsStation (via props).
   - What's unclear: Should we keep SlippageConfig as a shared component that both SwapForm and SettingsStation use, or should SettingsStation inline its own version?
   - Recommendation: Keep SlippageConfig as a shared component. Restyle its internals to use kit Button + kit Input. Both SwapForm and SettingsStation consume it with the same props, but now props come from useSettings() instead of local useState.

3. **SettingsProvider placement in component tree**
   - What we know: Must wrap everything that uses useSettings() -- which includes ModalRoot (for SettingsStation and SwapStation).
   - What's unclear: Should it go inside or outside WalletProvider? SettingsProvider doesn't need wallet context.
   - Recommendation: Place inside WalletProvider but outside ModalProvider in providers.tsx. This keeps it adjacent to ModalProvider and ensures all modal content can access it. Order: ConnectionProvider > WalletProvider > SettingsProvider > ModalProvider > ToastProvider.

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** -- Direct reading of all relevant source files:
  - `app/components/station/SettingsStation.tsx` (130 lines) -- current settings implementation
  - `app/components/swap/SlippageConfig.tsx` (190 lines) -- current slippage controls
  - `app/components/kit/*.tsx` -- all 9 kit components (Toggle, Slider, Input, Button, Divider, Frame, Card, Tabs, Scrollbar)
  - `app/app/kit.css` (967 lines) -- all kit component CSS
  - `app/app/globals.css` lines 601-668 -- station-content and parchment overrides
  - `app/components/modal/ModalShell.tsx` -- chromeVariant system and STATION_META
  - `app/components/modal/ModalProvider.tsx` -- Context provider pattern reference
  - `app/hooks/useSwap.ts` -- slippageBps/priorityFeePreset local state (lines 186-187)
  - `app/hooks/useTokenBalances.ts` -- existing balance fetching hook
  - `app/providers/providers.tsx` -- provider tree structure
  - `Docs/DECISIONS/frontend.md` -- D7 (Settings scope), D12 (hooks-only state management)

### Secondary (MEDIUM confidence)
- **CONTEXT.md decisions** -- Phase 65 discussion decisions constraining implementation choices

### Tertiary (LOW confidence)
- None -- all findings are from direct codebase inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already exist in the codebase
- Architecture: HIGH -- follows established codebase patterns (ModalProvider, kit-frame migration)
- Pitfalls: HIGH -- identified by reading actual CSS overrides and component implementations
- Audio controls: HIGH -- standard kit components with standard ARIA patterns
- useSwap migration: HIGH -- traced exact lines where slippageBps is consumed

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable -- internal codebase patterns, no external dependencies)
