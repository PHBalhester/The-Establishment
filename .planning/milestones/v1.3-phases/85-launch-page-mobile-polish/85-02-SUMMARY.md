---
phase: 85-launch-page-mobile-polish
plan: 02
status: complete
started: 2026-03-08
completed: 2026-03-08
---

## Summary

Comprehensive mobile responsive pass across all station modals and launch page, driven by iterative user review on iPhone Chrome. The user tested each section live on their phone, flagged issues, and fixes were applied in real-time.

## Key Changes

### Mobile Wallet Deep Links (WalletStation)
- Added mobile wallet deep-link support (Phantom, Solflare, Backpack) matching ConnectModal
- Extracted shared `MOBILE_WALLETS` constant to `app/lib/mobile-wallets.ts`
- Added local wallet icons to `app/public/wallets/` (avoids CSP issues with external CDNs)
- Used `kit-button-secondary` class for parchment-aware styling on deep-link buttons

### Modal Layout Fixes
- Restored parchment gradient background on `.modal-chrome-kit` for mobile (was transparent after desktop `border-image: none`)
- Added `padding-top: 3.5rem` to kit-frame modal body to clear floating back button
- Centered classic modal header title with equal horizontal padding
- Fixed Whitepaper title overlapping back button

### Station Renaming & Reordering
- Renamed: Connect Wallet → Connect, Swap Machine → Swap, Carnage Cauldron → Carnage, Rewards Vat → Rewards, Documentation Table → Whitepaper
- Reordered mobile nav: Connect → Swap → Rewards → Carnage → Whitepaper → Settings
- Updated header subtitle to "Fantastical Finance Factory"

### Other Fixes
- Hidden charts from Swap on mobile (`hidden lg:block`)
- Added spacer on `/launch` page to clear fixed-position header buttons
- Updated `app/next.config.ts` CSP to use local wallet icons only

## Key Files

### Created
- `app/lib/mobile-wallets.ts` — Shared mobile wallet deep-link definitions
- `app/public/wallets/phantom.png` — Official Phantom icon (128x128)
- `app/public/wallets/solflare.ico` — Solflare favicon
- `app/public/wallets/backpack.ico` — Backpack favicon

### Modified
- `app/app/globals.css` — Mobile parchment bg, modal padding, header centering
- `app/app/launch/page.tsx` — Header spacer for mobile
- `app/components/mobile/MobileNav.tsx` — Station reorder + subtitle update
- `app/components/modal/ModalShell.tsx` — Station title renaming
- `app/components/scene/scene-data.ts` — Station label renaming
- `app/components/station/SwapStation.tsx` — Hide charts on mobile
- `app/components/station/WalletStation.tsx` — Mobile wallet deep links
- `app/components/wallet/ConnectModal.tsx` — Import shared MOBILE_WALLETS

## Decisions
- Local wallet icons over external CDN URLs (cleaner CSP, no broken links)
- Parchment background on mobile kit-frame modals (desktop uses 9-slice border-image which doesn't exist on mobile)
- Charts hidden on mobile rather than responsive-ified (user preference, can re-add if requested)

## Lessons Learned
- Turbopack persistent cache requires `rm -rf app/.next` when CSS changes don't appear
- Phantom icon URL redirects are broken; use official Integration Assets ZIP
- Blanket CSS overrides for mobile can cascade to unexpected stations — scope carefully

## Self-Check: PASSED
- [x] User reviewed and approved all stations on iPhone Chrome
- [x] No horizontal overflow at 375px viewport
- [x] Wallet deep links work on mobile (Phantom, Solflare, Backpack)
- [x] All tap targets >= 48px
- [x] Station labels and order match user specification
- [x] Parchment background renders correctly on all kit-frame modals
