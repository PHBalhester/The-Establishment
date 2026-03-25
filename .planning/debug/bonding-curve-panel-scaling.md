---
status: resolved
trigger: "bonding curve panel scaling - content panel doesn't maintain proportional sizing relative to steampunk background"
created: 2026-03-23T00:00:00Z
updated: 2026-03-23T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - scale() transform + fixed px constraints (max-w-[380px], min-h-[380px]) cause panel to break out of proportion
test: Analyzed layout math at various viewport sizes
expecting: Removing scale() hack and making panel fill container with relative units fixes the issue
next_action: Apply fix - remove scale() approach, make BuySellPanel fill its container responsively

## Symptoms

expected: Content panel scales proportionally with background image, staying within the glass/metal frame area at all viewport sizes
actual: Content panel breaks out of proportion at different screen sizes - too wide/narrow or mispositioned relative to background
errors: None (CSS/layout issue)
reproduction: Resize browser window to different widths
started: Got screwed up recently, was working before

## Eliminated

## Evidence

- timestamp: 2026-03-23T00:01:00Z
  checked: LaunchScene.tsx container sizing
  found: Overlay container uses min(100vw, calc(100vh*1.78)) / min(100vh, calc(100vw/1.78)) - correctly scales with viewport
  implication: The scene container itself is fine

- timestamp: 2026-03-23T00:02:00Z
  checked: page.tsx center panel positioning and scale logic
  found: Center div uses absolute left-[34%] right-[34%] top-[15%] bottom-[14%] = 32% width, 71% height. ResizeObserver computes centerScale = min(1, w/614) and applies CSS scale() transform
  implication: scale() does NOT change layout box - content overflows at smaller viewports because layout dimensions remain unchanged

- timestamp: 2026-03-23T00:03:00Z
  checked: BuySellPanel.tsx sizing constraints
  found: max-w-[380px] on panel (only 62% of 614px design width), min-h-[380px] on content area (commit a1d0e56 bumped from 200px to fix resize glitch)
  implication: Panel doesn't fill glass area width-wise, and min-height makes total panel ~500px+ which exceeds container height at smaller viewports

- timestamp: 2026-03-23T00:04:00Z
  checked: git log for recent layout changes
  found: a1d0e56 increased min-height from 200px to 380px and removed sm:max-h-[250px]. This is likely when scaling broke.
  implication: The min-h increase was needed to fix resize glitch but created the scaling problem

## Resolution

root_cause: The center panel used a CSS scale() transform (ResizeObserver measuring width vs 614px design width) to shrink content at smaller viewports. scale() does NOT change layout dimensions -- the element's layout box stays full-size while only the visual rendering shrinks. Combined with BuySellPanel's fixed max-w-[380px] (only 62% of the 614px design width) and min-h-[380px] (making total panel ~500px+), the content would overflow or misalign at viewport sizes where the overlay container was smaller than the content's layout box. The min-h-[380px] was introduced in commit a1d0e56 to fix a resize glitch but created this scaling problem.
fix: 1) Removed the ResizeObserver/scale() mechanism entirely from page.tsx. 2) Changed center panel div from scale-based to pure flexbox layout (flex-col + overflow-hidden). 3) Made BuySellPanel use flex-col internally with flex-1 min-h-0 on its content area (instead of fixed min-h-[380px]) so it fills available space and scrolls when needed. 4) Removed max-w-[380px] from BuySellPanel (desktop fills its %-positioned container naturally). 5) Added max-w-[420px] via className prop for mobile layout only. 6) Desktop BuySellPanel gets flex-1 min-h-0 w-full via className to fill the center panel.
verification: Build passes (next build compiles successfully, no TS errors)
files_changed:
  - app/app/launch/page.tsx
  - app/components/launch/BuySellPanel.tsx
