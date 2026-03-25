# Phase 58: Mobile Navigation - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the interactive factory scene with a steampunk-themed vertical navigation for viewports below 1024px. Mobile users get full access to all 6 stations via touch-friendly list items that open the same modal content as desktop. No new station content -- this phase builds the mobile entry points only.

</domain>

<decisions>
## Implementation Decisions

### Navigation Layout
- Compact list rows (~56-60px tall) with small icon + station name -- all 6 visible without scrolling on most phones
- Names only, no live data previews -- all data lives inside the modal once opened
- Ordered by importance: Swap, Carnage, Staking, Connect Wallet, Docs, Settings (DeFi actions at top, utility at bottom)
- Fully steampunk themed: rivets, pipe decorations, textured backgrounds -- the mobile nav IS the factory experience

### Header Illustration
- Small fixed header (~120px) that stays pinned at top during scroll
- Wallet connection status badge in the header corner (connected/disconnected indicator)
- Claude's Discretion: image treatment (cropped factory scene vs logo lockup -- pick what works best with existing assets)

### Mobile Modal Behavior
- Full-screen slide-up from bottom -- covers entire screen, feels native like iOS sheets
- No swipe-down dismiss -- close via buttons only to avoid accidental dismissal while scrolling content
- Top-left back arrow for close button (follows iOS convention, natural thumb reach)
- No cross-station navigation from within modal -- close first, return to nav list, tap another station

### Breakpoint Transition
- Hard CSS media query swap at 1024px -- no animation between modes
- Everything below 1024px gets mobile nav (tablets included, no special tablet treatment)
- Live responsive switching -- crossing 1024px in either direction swaps the view immediately
- Landscape phones always get mobile nav regardless of orientation

### Claude's Discretion
- Header image treatment (cropped factory scene vs logo lockup)
- Exact icon choices for each station in the mobile list
- Slide-up animation timing and easing
- Steampunk decoration details on the nav list (pipe styles, rivet placement, textures)
- Minimum 48px tap targets throughout (per success criteria)

</decisions>

<specifics>
## Specific Ideas

- Mobile nav should feel like a steampunk control panel menu, not just a generic mobile list with brass colors
- Back arrow close button on modals (iOS convention) rather than top-right X
- Wallet status in header saves users from having to open wallet station just to check connection

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 58-mobile-navigation*
*Context gathered: 2026-02-24*
