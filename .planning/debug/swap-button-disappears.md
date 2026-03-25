---
status: verifying
trigger: "The Big Red Button (swap/execute button) disappears when pressed and wallet confirmation popup appears"
created: 2026-02-27T00:00:00Z
updated: 2026-02-27T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED - BigRedButton was conditionally replaced by MultiHopStatus during transacting states
test: Build succeeds, BigRedButton now always renders, pulsing glow added for transacting feedback
expecting: Button stays visible during all swap lifecycle states
next_action: User to verify visually in browser

## Symptoms

expected: The Big Red Button should always be visible in the swap UI, regardless of transaction state. It can show loading text or a spinner, but the button element itself must never disappear.
actual: When user clicks the swap button, once the wallet confirmation popup appears (Phantom), the button completely disappears from the UI. There's a dark empty rectangle where it should be. It only comes back after the TX confirms.
errors: No console errors reported — this is purely a visual/state issue.
reproduction: 1. Go to localhost:3000 swap page, 2. Enter a PROFIT to SOL swap amount, 3. Click the Big Red Button, 4. When Phantom wallet popup appears, observe the button area is empty/dark.
started: Noticed after Phase 62 changes. The button used to remain visible.

## Eliminated

## Evidence

- timestamp: 2026-02-27T00:00:30Z
  checked: SwapStation.tsx lines 108, 215-249
  found: The right column uses a ternary that REPLACES BigRedButton with MultiHopStatus when (isMultiHopRoute && isTransacting). isTransacting is true for building/signing/sending/confirming states. PROFIT->SOL is a 2-hop multi-hop route (PROFIT->CRIME via vault, CRIME->SOL via pool), so isMultiHopRoute is true.
  implication: This is the root cause. When user clicks swap on a PROFIT->SOL route, status goes to "building" then "signing" (wallet popup), making isTransacting=true. Since isMultiHopRoute is also true, BigRedButton is unmounted and replaced with MultiHopStatus spinner.

- timestamp: 2026-02-27T00:00:45Z
  checked: MultiHopStatus.tsx (full component)
  found: MultiHopStatus renders a small spinner with status text during in-progress states. Returns null for confirmed state. Much smaller visual footprint than BigRedButton.
  implication: The button area goes from the big brass-framed red button to a tiny spinner, which the user perceives as "disappearing" into a dark empty area.

- timestamp: 2026-02-27T00:00:50Z
  checked: BigRedButton.tsx component
  found: BigRedButton itself handles all statuses gracefully in its click handler. The parent unmounts it.
  implication: Fix is in SwapStation.tsx parent, not BigRedButton.tsx

- timestamp: 2026-02-27T00:01:00Z
  checked: route-engine.ts PROFIT adjacency
  found: PROFIT has no direct SOL pool. PROFIT->SOL routes through vault conversion (PROFIT->CRIME or PROFIT->FRAUD) then pool swap. Always multi-hop.
  implication: ALL PROFIT swaps trigger the disappearance bug since they are always multi-hop routes.

- timestamp: 2026-02-27T00:02:00Z
  checked: Next.js build after fix
  found: Build compiles successfully, no TypeScript errors, all imports still valid
  implication: Fix is syntactically and type-safe

## Resolution

root_cause: In SwapStation.tsx, a ternary conditional (lines 215-249) completely REPLACES BigRedButton with MultiHopStatus when isMultiHopRoute && isTransacting. PROFIT->SOL is always a multi-hop route, so clicking swap transitions status to "building"/"signing" which makes isTransacting=true, causing BigRedButton to unmount from the DOM and be replaced by a tiny spinner widget.
fix: (1) Restructured SwapStation.tsx right column to ALWAYS render BigRedButton, with MultiHopStatus only rendering below for partial failure case. (2) Added transacting visual state to BigRedButton (pulsing red glow animation via CSS class brb-centre-transacting). (3) Button is disabled during transacting but stays visible with aria-busy feedback.
verification: Build compiles successfully. Awaiting visual browser verification.
files_changed:
  - app/components/station/SwapStation.tsx
  - app/components/station/BigRedButton.tsx
  - app/app/globals.css
