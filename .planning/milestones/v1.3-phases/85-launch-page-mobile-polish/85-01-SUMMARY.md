---
phase: 85-launch-page-mobile-polish
plan: 01
status: complete
started: 2026-03-08
completed: 2026-03-08
---

## Summary

Replaced baked-in gauge needles with CSS-rotated arrow images. User provided CrimeArrow.png, FraudArrow.png (full-canvas 2560x1440 with needle at 0% position), and a clean CurveOverlay.png without baked-in needles. Also added CurveOverlay1.png text label layer.

Each arrow image is overlaid at full size with `transform-origin` set to the Photoshop-measured gauge hub center (Crime: 25.9%, 50.1%; Fraud: 74.7%, 49.4%). CSS rotation of 0-270 degrees maps linearly to 0-100% fill. Smooth 0.8s cubic-bezier transition animates needle movement.

## Key Files

### Created
- `app/public/scene/launch/CrimeArrow.png` — Crime gauge needle asset
- `app/public/scene/launch/FraudArrow.png` — Fraud gauge needle asset
- `app/public/scene/launch/CurveOverlay1.png` — CRIME/FRAUD text labels overlay

### Modified
- `app/public/scene/launch/curve-overlay.png` — Replaced with clean version (no baked-in needles)
- `app/app/launch/page.tsx` — Added needle rotation logic, arrow Image layers, text overlay

## Decisions
- Used full-canvas arrow approach (not cropped needles) — preserves Photoshop positioning, no manual offset math needed
- Pivot points measured in Photoshop by user, converted to percentages for CSS transform-origin
- LP-03 (docs button repositioning) left deferred per CONTEXT.md

## Self-Check: PASSED
- [x] `next build` succeeds with no TS errors
- [x] Needle rotation math: 270-degree sweep from NEEDLE_MIN to NEEDLE_MAX
- [x] Both CRIME and FRAUD gauges have independently rotating needles
- [x] Smooth CSS transition on needle rotation
- [x] Assets placed in public/scene/launch/
