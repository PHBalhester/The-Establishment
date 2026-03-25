# Feature Landscape: Interactive Factory Scene UI & Premium DeFi Frontend

**Domain:** Interactive scene-based DeFi frontend with steampunk theming, explorable environment
**Researched:** 2026-02-22
**Overall confidence:** MEDIUM-HIGH (based on deep familiarity with crypto/gaming scene UIs, DeFi frontend patterns, and CSS/JS animation ecosystems; web verification tools were unavailable, so library version specifics should be verified before implementation)

---

## Source Limitations

WebSearch and WebFetch were unavailable during this research session. All findings draw on:
- Training data knowledge of crypto/gaming frontends (Loot Survivor, Realms, Tensor, Star Atlas, IlluviumDEX, DeFi Kingdoms, Aurory, Habbo Hotel-style web UIs)
- Deep knowledge of CSS animations, Framer Motion / Motion, canvas-based particle systems
- Analysis of the existing Dr. Fraudsworth codebase (Next.js 16.1.6, React 19, Tailwind CSS v4, no animation library currently installed)
- PROJECT.md v1.0 milestone specification (6 clickable stations, ambient animations, modal system, onboarding, mobile)

Confidence levels reflect the absence of live verification. Library APIs and version numbers should be confirmed against official documentation before implementation.

---

## Table Stakes

Features that an interactive scene-based UI MUST have to feel complete and not broken. If any of these are missing, users will perceive the experience as unfinished or amateurish.

### Scene Foundation

| Feature | Why Expected | Complexity | Dependencies | Confidence |
|---------|-------------|------------|--------------|------------|
| Full-screen background image | The entire experience IS the scene. Without it, there is nothing. Background must cover viewport without distortion (object-cover or background-size:cover with proper aspect ratio handling) | Low | High-quality MainBackground asset (hand-drawn steampunk factory) | HIGH |
| Positioned object overlays | 6 transparent PNG objects placed at specific coordinates over the background. Absolute/percentage positioning so they align with the background scene elements they represent | Medium | 6 PNG assets with transparency + position coordinate mapping for each | HIGH |
| Responsive scene scaling | Scene must scale proportionally across desktop viewport sizes (1280px to 2560px+). Objects stay aligned with background features at every size. Common approach: container with fixed aspect ratio, all children use percentage positions | Medium | Position system that uses percentages, not pixels; background and overlays scale together | HIGH |
| Cursor change on hover | Pointer cursor on interactive objects. This is the most basic affordance that something is clickable. Without it, users will not know the scene is interactive | Low | CSS `cursor: pointer` on interactive regions | HIGH |
| Click-to-action on objects | Clicking an object MUST do something immediately (open modal, navigate, trigger animation). Dead clicks destroy trust in the interface | Low | Click handlers on each overlay element, modal routing | HIGH |
| Visual feedback on hover | Some visible change when hovering an interactive object: brightness increase, glow effect, scale nudge, outline. Users need confirmation "yes, this thing is interactive" BEFORE they click | Medium | CSS filter/transform transitions or animation library | HIGH |
| Loading state for scene | High-res background + 6 PNGs = significant initial load. Users need a loading screen or progressive reveal, NOT a blank white page followed by a layout shift | Medium | Image preloading strategy, skeleton/loading screen | HIGH |
| Z-index management | Overlays, hover effects, tooltips, and modals all occupy different layers. Without explicit z-index strategy, elements will clip through each other unpredictably | Low | Defined z-index scale (scene < overlays < effects < tooltips < modal-backdrop < modal) | HIGH |

### Modal System

| Feature | Why Expected | Complexity | Dependencies | Confidence |
|---------|-------------|------------|--------------|------------|
| Backdrop overlay with blur | When modal opens, the scene behind should dim and blur. This focuses attention and communicates "you are now in an interface." Every major dApp and game UI does this (Jupiter, Tensor, Phantom itself) | Low | CSS backdrop-filter: blur() + semi-transparent overlay | HIGH |
| Smooth open/close transitions | Modals must animate in (scale+fade, slide-up, or similar) and animate out. Instant appear/disappear feels jarring and cheap | Medium | CSS transitions or animation library (Framer Motion, CSS keyframes) | HIGH |
| Close on backdrop click | Users expect clicking outside the modal to close it. Already implemented in existing ConnectModal.tsx | Low | Existing pattern in codebase | HIGH |
| Close on Escape key | Keyboard users and muscle-memory users expect Escape to close. Already implemented in ConnectModal.tsx | Low | Existing pattern in codebase | HIGH |
| Close button (X) in modal | Visual close affordance in top-right corner of every modal. Already implemented in ConnectModal.tsx | Low | Existing pattern in codebase | HIGH |
| Modal content scrolling | Some modals (Swap station with chart, staking with stats) will have more content than viewport height. Modal body must scroll independently while header/close button stay fixed | Low | CSS overflow-y: auto on modal body | HIGH |
| Return to scene on close | Closing a modal returns to the interactive scene. No navigation, no page changes. The scene is always "home" | Low | State management (which modal is open), not URL routing | HIGH |
| Only one modal at a time | Opening a new station closes the previous one. Stacking modals creates UX chaos | Low | Single activeModal state variable | HIGH |
| Themed modal chrome | Modal borders, backgrounds, and decorative elements must match steampunk aesthetic (brass borders, rivets, parchment texture, aged metal). Generic white modals destroy immersion | High | Steampunk design assets or CSS-only decorative styling | HIGH |

### Object-to-Feature Mapping (6 Stations)

| Station | Opens | Content | Complexity | Existing Feature | Confidence |
|---------|-------|---------|------------|------------------|------------|
| SwapMachine | Swap modal | TradingView chart, market caps, tax rates, token pair selector, swap form with Big Red Button | High | SwapForm, CandlestickChart, ChartControls, FeeBreakdown, SlippageConfig, RouteSelector -- all exist | HIGH |
| CarnageCauldron | Carnage modal | Carnage fund dashboard: SOL balance, last trigger, lifetime burns, recent events | Medium | CarnageCard content exists | HIGH |
| RewardsVat | Staking modal | Stake/unstake/claim tabs, pending rewards, APY, total staked | Medium | StakingForm with tabs exists | HIGH |
| ConnectWallet | Wallet modal | Two-path connection (browser wallet / social login) | Low | ConnectModal exists, works today | HIGH |
| DocumentationTable | Docs modal | Protocol explanation: how it works, token mechanics, FAQ | Medium | No existing content -- needs writing | HIGH |
| Settings (gears) | Settings modal | Slippage tolerance, priority fees, RPC endpoint (future) | Low | SlippageConfig exists, needs extraction into standalone modal | HIGH |

### Performance

| Feature | Why Expected | Complexity | Dependencies | Confidence |
|---------|-------------|------------|--------------|------------|
| Smooth 60fps scene interactions | Hover effects, cursor movement over scene, and ambient animations must not cause jank. Users in crypto are often on powerful desktops but may also be on laptops. Target 60fps for all interactions | Medium | GPU-accelerated CSS (transform, opacity, filter), avoid layout thrash. Animations on composite layers only | HIGH |
| Image optimization | Background + 6 overlays could easily be 10MB+ unoptimized. Must use WebP/AVIF with fallbacks, appropriate resolution for viewport, and lazy/priority loading | Medium | Next.js Image component or manual optimization pipeline. Consider responsive srcset for 1x/2x displays | HIGH |
| Modal content lazy loading | Chart library (lightweight-charts, 200KB+) and complex form state should not load until the Swap modal is actually opened | Medium | React lazy() + Suspense for heavy modal content | HIGH |
| No layout shift on load | Scene must not jump around as images load. Reserve space with aspect-ratio containers, use placeholder colors or low-res previews | Low | CSS aspect-ratio or padding-bottom trick, priority loading hints | HIGH |

---

## Differentiators

Features that make Dr. Fraudsworth stand out from every other DeFi frontend. These are what create the "wow" factor and viral sharing potential.

### Ambient Scene Animations

| Feature | Value Proposition | Complexity | Technical Approach | Confidence |
|---------|-------------------|------------|-------------------|------------|
| Steam/smoke particles rising | Brings the factory to life. Subtle steam wisps rising from pipes and vats create a living, breathing environment. This is what separates "image with buttons" from "explorable world" | Medium-High | Canvas overlay or CSS-only animated elements. Canvas approach: lightweight 2D particle system (no Three.js needed). CSS approach: animated div elements with opacity/transform keyframes. Recommend CSS for simplicity (10-20 particles sufficient for effect) | MEDIUM |
| Cauldron bubbling animation | The CarnageCauldron should visibly bubble, especially when Carnage fund is large. Creates visual tension around the protocol's signature mechanic | Medium | CSS keyframe animation on positioned bubble elements, or sprite sheet animation. Bubble intensity could scale with fund balance (data-driven animation) | HIGH |
| Gear rotation | Settings gears slowly rotating conveys "machinery in operation." Simple infinite CSS rotation on gear overlay elements | Low | CSS `animation: rotate 20s linear infinite` on gear overlay. Trivial but effective | HIGH |
| Flickering lights | Steampunk lab should have lights that flicker occasionally, like gas lamps or electrical discharge. Adds atmosphere without demanding attention | Low | CSS animation with opacity keyframes, random-feeling intervals (use multiple overlapping animations with different durations for pseudo-random effect) | HIGH |
| Pipe glow / energy flow | Pipes connecting machines could have subtle pulsing glow to suggest liquid/energy flowing through the system. Connects the visual elements | Medium | CSS gradient animation along pipe paths, or positioned glowing elements with animated opacity. Can use mix-blend-mode for glow effect | MEDIUM |
| Ambient sound (OPTIONAL, defer) | Factory ambience (low hum, bubbling, steam hissing) would complete the immersion. BUT audio auto-play is universally hated and technically restricted by browsers | Low if deferred | Web Audio API with user-initiated toggle. Defer to post-v1.0 unless team decides it adds enough value | HIGH |

### Interactive Object Effects

| Feature | Value Proposition | Complexity | Technical Approach | Confidence |
|---------|-------------------|------------|-------------------|------------|
| Glow effect on hover | Objects emit a colored glow when hovered. Not just brightness -- an actual aura/halo effect. This is the signature "this is interactive" signal | Medium | CSS `filter: drop-shadow(0 0 Xpx color)` with transition. drop-shadow respects PNG transparency (unlike box-shadow). Can layer multiple drop-shadows for diffuse glow. Color per object (green for Cauldron, brass for Swap, etc.) | HIGH |
| Scale nudge on hover | Slight 2-5% scale increase on hover makes objects feel physically responsive, like they're lifting off the background | Low | CSS `transform: scale(1.03)` with `transition: transform 0.2s ease-out`. Must set `transform-origin` to center of each object | HIGH |
| Click depression effect | Brief scale-down on click (scale 0.97 for 100ms) mimics physical button press. Satisfying tactile feedback | Low | CSS `:active` pseudo-class with `transform: scale(0.97)` or animation library tap handler | HIGH |
| Object-specific hover tooltips | Small label appears near object on hover: "Swap Machine," "Carnage Cauldron," "Rewards Vat," etc. Helps first-time users understand what each thing does | Low | CSS tooltip with `position: absolute`, shown on hover. Or title attribute as minimal fallback | HIGH |
| Data-driven visual states | Objects reflect live protocol data. Examples: Cauldron glows brighter when fund is large. Swap Machine shows activity when pool volumes are high. Rewards Vat fill level represents total staked | High | Map on-chain data to CSS custom properties or animation parameters. Requires the data hooks (useEpochState, useCarnageData, etc.) to feed into scene component props | MEDIUM |
| Notification badges on objects | Red dot or number badge on stations with pending actions: "Claim available" on RewardsVat, "Epoch changing soon" on SwapMachine | Medium | Positioned badge elements on overlays, driven by hook data (hasUnclaimedRewards, epochImminent) | HIGH |

### The Big Red Button

| Feature | Value Proposition | Complexity | Technical Approach | Confidence |
|---------|-------------------|------------|-------------------|------------|
| Physical button appearance | The swap execution button should look like an actual industrial button -- raised, glossy, with rim lighting. Not a flat CSS rectangle | Medium | CSS-only 3D button: radial gradients, box-shadows for depth, inner shadows for rim. The "big red button" trope is universally understood. Should feel satisfying to press | HIGH |
| Press animation | When clicked, button visually depresses (translateY + shadow reduction + color shift). Combined with haptic feedback on mobile if available | Low | CSS transition on :active, or animation library gesture handler. ~150ms depression with spring-back | HIGH |
| State-driven button appearance | Button changes appearance based on swap state: idle (red, glowing), loading (spinning indicator), confirming (pulsing amber), success (flash green), error (flash with shake) | Medium | Conditional CSS classes driven by swap.status state machine. Keyframe animations for pulse and shake | HIGH |
| "Swap executed" celebration | Brief particle burst or flash effect when swap succeeds. Dopamine hit. Games do this constantly -- DeFi almost never does | Medium | CSS keyframe explosion of small elements, or canvas confetti. Short-lived (500ms), not blocking | MEDIUM |

### Onboarding / First-Time Experience

| Feature | Value Proposition | Complexity | Technical Approach | Confidence |
|---------|-------------------|------------|-------------------|------------|
| Guided tour overlay | First-time visitors see a step-by-step walkthrough highlighting each station: "This is the Swap Machine," "This is where Carnage happens," etc. With spotlight/highlight on the relevant object and all else dimmed | High | Overlay system with spotlight mask (CSS clip-path or SVG mask revealing one area). Step state machine. "Next"/"Skip" buttons. Store completion in localStorage | MEDIUM |
| Welcome modal | Before the tour, a brief welcome: "Welcome to Dr. Fraudsworth's Finance Factory" with 2-3 sentences about what this is and a "Show Me Around" / "I Know What I'm Doing" choice | Low | Simple modal on first visit. Store in localStorage | HIGH |
| Contextual tooltips | After tour completes, subtle pulsing hints on stations user hasn't visited yet. Fades after first interaction | Medium | Per-station "visited" state in localStorage. CSS pulsing indicator that dismisses on first click | HIGH |
| Progressive disclosure | Don't show all protocol complexity at once. First visit: basic swap, basic staking. Show smart routing, fee breakdowns, advanced chart features as user engages more | High | Feature gating based on interaction count or explicit "Advanced" toggle. Risk: may confuse experienced DeFi users who expect full features immediately | LOW |

### Mobile Experience

| Feature | Value Proposition | Complexity | Technical Approach | Confidence |
|---------|-------------------|------------|-------------------|------------|
| Themed navigation menu | Mobile cannot show the interactive scene (too small, hover doesn't exist on touch). Instead, show a steampunk-themed navigation with station icons/buttons that open the same modals | Medium | Responsive breakpoint (below ~768px or ~1024px). Replace scene with vertical station list. Each station button styled as steampunk element (brass plate, rivets, engraved labels) | HIGH |
| Touch-friendly modals | Modals on mobile must be full-screen or near-full-screen, with touch-friendly input sizes (min 44px tap targets per WCAG) | Medium | Responsive modal sizing. Mobile: full viewport with slide-up animation. Desktop: centered with max-width | HIGH |
| Scene teaser on mobile | Show a static cropped/simplified version of the factory scene at the top of mobile navigation, so users understand the visual theme even without interaction | Low | Static image or CSS illustration, decorative only | HIGH |
| Swipe to close modals | On mobile, swiping down on modal header should close it (pull-to-dismiss). Standard mobile modal pattern | Medium | Touch event handling for drag-to-dismiss, or animation library gesture support | MEDIUM |

---

## Anti-Features

Features to deliberately NOT build for v1.0. Building these would waste time, add complexity, or actively harm the experience.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| WebGL / Three.js 3D scene | Massively increases complexity, bundle size, and device requirements. A well-executed 2D scene with CSS animations will look better than a mediocre 3D scene. 3D also alienates users on low-end devices | 2D scene with positioned PNGs + CSS animations. Can achieve "parallax" depth feel with layered elements at different sizes/positions |
| Full parallax scrolling | The scene is a single viewport. Adding scroll-based parallax implies vertical scrolling, which conflicts with the "full-screen explorable scene" concept. Users should click objects, not scroll past them | Fixed viewport scene. All interaction via click/hover, not scroll. Mobile uses separate navigation layout |
| Animated character / mascot | A walking Dr. Fraudsworth character would be charming but requires sprite animation, pathfinding, idle animations, and massive art investment. Diminishing returns for v1.0 | Static presence of the character in the background art. Character can be added in a future version |
| Spatial audio | Sound that changes based on mouse position (louder near cauldron, etc.) is cool but adds zero functional value and significant complexity | Defer all audio to post-v1.0. If added, simple ambient toggle only |
| Real-time scene state from blockchain | Making every visual element data-driven (pipe flow rate = trading volume, light color = epoch state, etc.) adds immense complexity to the scene layer | Start with 2-3 data-driven visuals only: Cauldron glow intensity = fund balance, notification badges = actionable states. Expand later |
| Canvas-based hit detection | Using <canvas> for the scene and calculating hit regions from pixel data is fragile, inaccessible, and harder to maintain than DOM elements | Use positioned DOM elements (divs or buttons) with transparent overlay regions for hit detection. Accessible, inspectable, debuggable |
| Custom cursor | Replacing the system cursor with a steampunk-themed cursor image sounds cool but causes: input lag (browsers render custom cursors differently), accessibility issues, confusion when cursor leaves the viewport | Standard system cursor. Change to pointer on interactive elements. Maybe a custom cursor in a very far future version |
| Drag-and-drop interactions | Dragging tokens to swap, dragging items between stations -- adds complexity, breaks mobile, and is slower than clicking | Click-to-open modals with form inputs. Standard and fast |
| Animated page transitions between stations | Smooth camera-pan from one station to another sounds cinematic but modals are faster and clearer. Users want speed, not cinematic transitions | Instant modal open with entrance animation. Close returns to scene immediately |
| Multi-language support | Internationalization is premature. Focus on English-speaking crypto audience first | English only. Structure text in components (not hardcoded inline) so i18n can be added later without rewrite |
| Persistent scene state | Remembering which gears were spinning, which lights were on, what hover state existed -- unnecessary complexity. Scene resets to default on each visit | Always-fresh scene state. Ambient animations loop from start. Only persist: onboarding completion, user preferences (settings modal) |
| Complex particle physics | Realistic fluid simulation for bubbling, cloth simulation for banners, etc. Way beyond what CSS or even a simple canvas system should attempt | Stylized, simple animations. "Good enough" bubbles (CSS circles with opacity/transform animation) beat "physically accurate" bubbles that take 10x longer to build |

---

## Feature Dependencies

```
Asset Pipeline (Background + 6 PNGs)
  |
  +--> Scene Layout System
  |     |
  |     +--> Responsive scaling (% positioning, aspect-ratio container)
  |     +--> Z-index management (layers defined)
  |     |
  |     +--> Interactive Object System
  |     |     |
  |     |     +--> Hover effects (glow, scale, cursor)
  |     |     +--> Click handlers (open modal by station ID)
  |     |     +--> Tooltip labels ("Swap Machine", etc.)
  |     |     +--> Notification badges (data-driven)
  |     |
  |     +--> Ambient Animation System
  |           |
  |           +--> Steam particles (CSS or canvas)
  |           +--> Gear rotation (CSS infinite)
  |           +--> Cauldron bubbles (CSS keyframes)
  |           +--> Light flicker (CSS opacity animation)
  |           +--> Pipe glow (CSS gradient animation)
  |
  +--> Modal System
  |     |
  |     +--> Themed modal chrome (steampunk borders, backgrounds)
  |     +--> Open/close transitions (animation)
  |     +--> Backdrop blur overlay
  |     +--> Content routing (station ID -> modal content)
  |     |
  |     +--> Station Content (re-themed existing components)
  |           |
  |           +--> Swap station (existing: SwapForm, CandlestickChart, etc.)
  |           +--> Carnage station (existing: CarnageCard content)
  |           +--> Staking station (existing: StakingForm)
  |           +--> Wallet station (existing: ConnectModal)
  |           +--> Documentation station (NEW: protocol docs content)
  |           +--> Settings station (extract from SlippageConfig)
  |
  +--> Brand System (color palette + typography)
  |     |
  |     +--> Tailwind theme extension (colors, fonts)
  |     +--> Component restyling (buttons, inputs, cards)
  |     +--> Big Red Button (custom styled swap CTA)
  |
  +--> Onboarding System
  |     |
  |     +--> Welcome modal (first visit)
  |     +--> Guided tour (spotlight overlay + step navigation)
  |     +--> localStorage persistence (tour completed, stations visited)
  |
  +--> Mobile Layout
        |
        +--> Breakpoint detection (<1024px = mobile)
        +--> Themed navigation (station list with icons)
        +--> Full-screen modals
        +--> Scene teaser image (decorative)

KEY DEPENDENCY: Art assets (background + overlays) are on the critical path.
Nothing can be finalized without them. Code scaffolding can begin with
placeholder images, but visual polish requires final assets.
```

**Critical path:** Art assets --> Scene layout --> Hover/click system --> Modal system --> Re-theme existing components --> Ambient animations --> Onboarding --> Mobile

**Parallelizable work:**
- Modal system + Brand system can be built simultaneously
- Ambient animations can be developed independently from modal content
- Mobile layout can be developed independently from desktop scene
- Documentation content can be written while scene code is in progress

---

## Real-World References & Patterns

### Crypto/Gaming Scene-Based UIs

These projects use explorable visual environments as their primary interface, providing relevant patterns:

**DeFi Kingdoms (defikingdoms.com)**
- Isometric pixel-art world map as main navigation
- Click buildings to access DeFi features (DEX in marketplace, staking in bank, etc.)
- Each building opens a themed panel/modal
- Ambient animations: moving NPCs, weather effects, water
- Pattern: Scene is the navigation layer; all functionality lives in modals
- **Takeaway:** Scene complexity is secondary to modal usability. DFK's modals are relatively plain despite the rich scene. Dr. Fraudsworth should ensure modals are BETTER than DFK's
- Confidence: MEDIUM (based on training data, DFK may have changed)

**Aurory (aurory.io)**
- Hub-world approach: central scene with clickable locations
- Hover highlights on interactive elements
- Smooth transitions to feature panels
- **Takeaway:** Hover effects are what make the scene feel interactive vs static

**Tensor (tensor.trade)**
- Not scene-based, but exemplifies premium DeFi UI quality
- Smooth animations on all state changes
- Dark theme with accent colors, consistent visual language
- Fast transitions, no jank
- **Takeaway:** Premium feel comes from consistent animation timing and zero jank, not from complexity

**Habbo Hotel / Club Penguin (classic web pattern)**
- Rooms with clickable furniture/objects
- Positioned 2D sprites on background
- Hover-to-highlight, click-to-interact
- **Takeaway:** The pattern of "positioned objects on background, click to interact" has been proven for 20+ years. It works. The key is visual clarity about what's interactive

**Star Atlas / Illuvium**
- Heavy 3D scenes -- explicitly what we should NOT do. Massive load times, GPU requirements, alienate casual users
- **Takeaway:** 2D > 3D for DeFi. Users want to swap, not render

### Premium DeFi Frontend Patterns (What Makes It Feel Polished)

Based on the strongest DeFi frontends (Jupiter, Uniswap v4, Phantom, Tensor):

| Quality Indicator | Amateur Pattern | Premium Pattern |
|-------------------|----------------|-----------------|
| Transitions | Instant appear/disappear (jarring) | 150-300ms ease-out animations on all state changes |
| Hover states | No hover effect, or color change only | Multi-property transitions: background + border + shadow + subtle scale |
| Loading states | Blank areas or raw spinners | Skeleton screens matching content shape, shimmer animation |
| Error states | Red text or alert() | Inline contextual errors with recovery suggestions, not modal interruptions |
| Button feedback | Background color change only | Physical depression effect, state colors (idle/loading/success/error), satisfying haptics |
| Typography | System fonts, single weight | Custom font family, clear weight hierarchy (bold headers, medium body, regular detail) |
| Color consistency | Random blues and grays | Defined palette with semantic mapping (primary action, success, warning, danger, muted) |
| Spacing | Inconsistent padding/margins | 4px/8px grid system, consistent whitespace rhythm |
| Border radius | Mixed values (2px here, 8px there) | Consistent radius scale (sm: 4px, md: 8px, lg: 12px, xl: 16px) |
| Shadows | Hard box-shadows or none | Layered soft shadows for depth hierarchy |
| Dark mode execution | Dark gray backgrounds (#333, #444) | Rich dark backgrounds with subtle warmth or coolness (zinc-950, slate-950, NOT pure black) |
| Data updates | Page refresh required | Smooth value transitions (numbers count up/down, new data fades in) |
| Empty states | Blank areas | Illustrated empty states with guidance ("Connect wallet to see balances") |

### Animation Timing Standards

Industry-standard animation durations that feel "right" (based on Material Design, Apple HIG, and DeFi frontend patterns):

| Interaction | Duration | Easing | Notes |
|------------|----------|--------|-------|
| Hover effect (color/shadow) | 150ms | ease-out | Fast enough to feel responsive |
| Hover effect (transform/scale) | 200ms | ease-out | Slightly slower for physical movement feel |
| Modal open | 200-300ms | ease-out or spring | Scale from 0.95 + fade, or slide-up |
| Modal close | 150-200ms | ease-in | Faster than open (users want it gone) |
| Backdrop fade in | 200ms | ease-out | Sync with modal open |
| Backdrop fade out | 150ms | ease-in | Sync with modal close |
| Button press | 100ms | linear | Must be fast for tactile feel |
| Toast/notification appear | 300ms | ease-out | Slide in from edge |
| Toast/notification dismiss | 200ms | ease-in | Faster out than in |
| Skeleton shimmer | 1500ms | ease-in-out | Slow, continuous loop |
| Loading spinner | 800ms per rotation | linear | Continuous |
| Data value transition | 300-500ms | ease-out | Number counting up/down |
| Page/view transition | 200-300ms | ease-out | Between states, not between pages |

---

## Accessibility Considerations

Interactive scene UIs create significant accessibility challenges. These are table stakes for not excluding users.

| Concern | Impact | Required Solution | Complexity |
|---------|--------|-------------------|------------|
| Keyboard navigation | Scene objects must be reachable via Tab key. Users who cannot use a mouse must still access all features | Each interactive object is a `<button>` element (not just a `<div>` with onClick). Tab order follows logical sequence (left-to-right, top-to-bottom, or custom tabindex) | Low |
| Screen reader labels | Scene objects need descriptive labels. A screen reader user should hear "Open Swap Machine" not silence | `aria-label` on each interactive button: "Open Swap Machine", "Open Carnage Cauldron", "Open Staking Vault", etc. | Low |
| Focus indicators | When tabbing to an object, visible focus ring must appear (CSS `:focus-visible`). Without this, keyboard users are blind | `outline` or custom focus ring styling that matches the glow aesthetic. Do NOT remove focus outlines globally | Low |
| Reduced motion | Users with `prefers-reduced-motion: reduce` should see a usable UI without animations. Ambient animations, hover effects with transform, and transition effects should be suppressed | `@media (prefers-reduced-motion: reduce)` to disable animations. Still show hover color changes (non-motion indicators) | Low |
| Color contrast | Tooltip text, labels, and notification badges must meet WCAG AA contrast ratio (4.5:1 for text). Steampunk aesthetic with dark backgrounds + brass/gold accents must be checked | Verify all text against background with contrast checker. Use white or bright text on dark panels | Low |
| Modal focus trap | When a modal is open, Tab should cycle within the modal only, not escape behind to the scene. This is standard modal accessibility | Focus trap implementation: on open, focus first focusable element; on Tab at last element, wrap to first; on Escape, close and return focus to triggering button | Medium |
| Touch target size | Mobile interactive elements must be minimum 44x44px (WCAG AAA) or 48x48px (Google Material) | Ensure all buttons, links, and interactive elements meet minimum size. Especially important for mobile navigation | Low |
| Alt text for scene | Background image and overlays need meaningful alt text or be marked decorative | Background: `role="img" aria-label="Dr. Fraudsworth's steampunk finance factory"`. Individual objects: described by their button labels | Low |

---

## Mobile Considerations (Detailed)

The project spec calls for "basic mobile: simplified themed navigation, no interactive scene." This section details what that means.

### What Mobile Gets

| Feature | Mobile Behavior | Desktop Behavior |
|---------|----------------|------------------|
| Scene | NOT shown. Too small for positioned overlays, no hover on touch | Full interactive scene |
| Navigation | Themed vertical list of 6 stations with steampunk styling (brass plates, icons) | Click objects in scene |
| Modals | Full-screen slide-up panels | Centered modal with backdrop |
| Ambient animations | Subtle decorative elements only (maybe a small gear rotating in the header) | Full ambient animation suite |
| Scene teaser | Static cropped image or illustration at top of navigation, establishing the theme | N/A (IS the scene) |
| All functionality | 100% feature parity via modals. Swap, stake, carnage, wallet, docs, settings | Same |

### Breakpoint Strategy

| Breakpoint | Layout |
|------------|--------|
| < 768px | Mobile: themed navigation, full-screen modals |
| 768px - 1023px | Tablet: themed navigation (could show scene if assets work at this size, but safe default is navigation) |
| >= 1024px | Desktop: full interactive scene with positioned overlays |

**Recommendation:** Use 1024px as the scene breakpoint. Below 1024px, the factory background image will be too compressed for object overlays to align properly with background features. Better to show a clean themed navigation than a cramped, misaligned scene.

### Mobile-Specific Anti-Patterns to Avoid

| Anti-Pattern | Why Bad | Instead |
|-------------|---------|---------|
| Pinch-to-zoom on scene image | Users will try to zoom into the factory image on mobile. This creates a terrible experience as overlays won't zoom with it | Don't show the interactive scene on mobile at all |
| Tiny tap targets | Station buttons smaller than 44px | Minimum 48px height for all navigation items |
| Bottom sheet overuse | Every modal as a bottom sheet gets repetitive | Full-screen modals with themed headers, close via X or swipe-down |
| Hiding the navigation | Hamburger menus require extra tap to see options. With only 6 stations, they should all be visible | Show all 6 stations in the navigation view. No hamburger needed |

---

## Image Asset Requirements

The art pipeline is the critical path. Here is what the development needs from the art side.

### Required Assets

| Asset | Type | Estimated Dimensions | Notes |
|-------|------|---------------------|-------|
| MainBackground | JPG/WebP | 3840x2160 (4K) with 1920x1080 fallback | Full factory scene. Must have clear zones where overlay objects will be placed. Needs to read well at 1920px width minimum |
| SwapMachine | PNG with transparency | ~400-800px wide | Positioned over the machine area in background. Transparency lets background show through |
| CarnageCauldron | PNG with transparency | ~300-600px wide | Positioned over cauldron in background |
| RewardsVat | PNG with transparency | ~300-600px wide | Positioned over vat in background |
| ConnectWallet | PNG with transparency | ~200-400px wide | Sign/placard overlay |
| DocumentationTable | PNG with transparency | ~300-600px wide | Table/desk overlay |
| Settings (gears) | PNG with transparency | ~200-400px wide | Gear mechanism overlay |

### Asset Optimization Requirements

| Format | Use Case | Quality | Notes |
|--------|----------|---------|-------|
| WebP | Primary format for all browsers | 80-85% quality | 30-50% smaller than JPEG at comparable quality |
| AVIF | Progressive enhancement | 60-70% quality | Even smaller than WebP, but less browser support |
| PNG | Overlay objects (need transparency) | Optimized with pngquant | Lossy PNG compression preserves transparency while reducing size |
| JPG | Background fallback | 85% quality | For browsers without WebP support (very rare in 2026) |

**Target total page weight (images):** Under 3MB for initial load (background + visible overlays). Use `loading="lazy"` for overlays not in initial viewport if scene scrolls (though it shouldn't).

### Position Mapping Approach

Each overlay needs a position definition that scales with the scene:

```
{
  "SwapMachine": { left: "55%", top: "30%", width: "20%", height: "auto" },
  "CarnageCauldron": { left: "15%", top: "25%", width: "15%", height: "auto" },
  ...
}
```

Percentage-based positioning ensures objects stay aligned with background features across viewport sizes. The exact percentages are determined by the art -- where in the background image each machine is drawn.

**Recommendation:** Create a visual position editor during development. A simple dev tool overlay that shows grid lines and lets you drag objects to find the right percentages. Remove before production.

---

## Complexity Assessment Summary

| Feature Category | Items | Avg Complexity | Critical Path? |
|-----------------|-------|----------------|----------------|
| Scene Foundation (layout, scaling, loading) | 8 | Low-Medium | YES -- everything builds on this |
| Modal System (chrome, transitions, routing) | 9 | Medium | YES -- all features live in modals |
| Object Interaction (hover, click, tooltips) | 6 | Low-Medium | YES -- this is how users navigate |
| Station Content (re-theme existing features) | 6 | Medium-High | YES -- the actual functionality |
| Ambient Animations (steam, gears, bubbles, lights) | 6 | Medium | No -- can be added incrementally |
| Big Red Button | 4 | Medium | No -- can start as normal button |
| Onboarding | 4 | Medium-High | No -- add after core flow works |
| Mobile Layout | 4 | Medium | No -- can be added after desktop |
| Brand System (colors, typography) | 2 | Medium | Partially -- needs early definition |
| Accessibility | 8 | Low | YES -- build in from start, not retrofit |

**Total v1.0 scope:** ~57 feature items across 10 categories. Substantial but achievable because most functionality already exists in v0.8/v0.9 components -- this milestone is primarily about presentation, not new protocol interactions.

---

## MVP Recommendation

For the v1.0 milestone, build in this order:

### Phase 1: Scene Foundation + Modal System
1. **Scene layout** with MainBackground + 6 positioned overlays (placeholder images OK)
2. **Responsive scaling** with percentage positioning, aspect-ratio container
3. **Modal system** with themed chrome, open/close transitions, backdrop blur
4. **Object click handlers** routing to correct modals
5. **Basic hover effects** (cursor pointer, brightness filter, drop-shadow glow)
6. **Loading screen** for initial scene load

**Rationale:** This is the structural foundation. Everything else plugs into this. Can be built with placeholder art while final assets are in progress.

### Phase 2: Station Content + Brand System
1. **Re-theme existing components** inside modal chrome (Swap, Staking, Carnage, Wallet, Settings)
2. **Brand system** (Tailwind theme extension with steampunk palette, typography, component tokens)
3. **Big Red Button** for swap execution
4. **Documentation station** content (protocol explanation, how-it-works)
5. **Notification badges** on stations (claimable rewards, epoch warning)

**Rationale:** This is where the existing functionality gets its new clothes. All the hooks and state management are already built -- this is pure presentation work. Brand system needs early definition so all re-themed components are consistent.

### Phase 3: Animations + Polish
1. **Ambient animations** (steam, gears, bubbles, lights)
2. **Enhanced hover effects** (glow color per station, scale transitions)
3. **Data-driven visuals** (cauldron intensity, station activity indicators)
4. **Transition polish** (modal spring animations, swap success celebration)
5. **Performance optimization** (image formats, lazy loading, animation perf audit)

**Rationale:** Animations are enhancement, not foundation. The app must work perfectly without them (reduced-motion users prove this). Adding them last means they polish a working product rather than decorating an incomplete one.

### Phase 4: Onboarding + Mobile
1. **Welcome modal** (first visit detection, "Show Me Around" / "Skip")
2. **Guided tour** (spotlight overlay stepping through stations)
3. **Mobile navigation** (themed station list, responsive breakpoint)
4. **Mobile modals** (full-screen, swipe-to-dismiss)
5. **Accessibility audit** (keyboard nav, screen reader, focus management, contrast)

**Rationale:** Onboarding and mobile are important but not blocking. Desktop scene users can navigate without a tour (the hover effects teach them). Mobile users can use the site on desktop while mobile layout is built.

### Defer to Post-v1.0
- Ambient sound / audio
- Animated character / mascot
- Scene parallax depth
- Data-driven animation complexity beyond 2-3 indicators
- Advanced onboarding (progressive disclosure)
- Tablet-specific layout (if different from mobile)

---

## Sources

### Primary (HIGH Confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/PROJECT.md` -- v1.0 milestone specification, target features, 6 station definitions
- `/Users/mlbob/Projects/Dr Fraudsworth/app/package.json` -- current tech stack (Next.js 16.1.6, React 19, Tailwind v4, no animation library)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/app/page.tsx` -- current landing page structure
- `/Users/mlbob/Projects/Dr Fraudsworth/app/app/swap/page.tsx` -- current swap page with chart + forms
- `/Users/mlbob/Projects/Dr Fraudsworth/app/components/wallet/ConnectModal.tsx` -- existing modal pattern (backdrop, Escape, click-outside)
- `/Users/mlbob/Projects/Dr Fraudsworth/app/components/swap/SwapForm.tsx` -- existing swap form structure
- `/Users/mlbob/Projects/Dr Fraudsworth/app/components/dashboard/DashboardGrid.tsx` -- existing data hook architecture
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/milestones/v0.8-REQUIREMENTS.md` -- all existing feature requirements (shipped)

### Secondary (MEDIUM Confidence -- training data, not currently verified)
- DeFi Kingdoms scene-based navigation patterns
- Aurory hub-world interaction patterns
- Tensor/Jupiter/Uniswap premium UI patterns
- Material Design animation timing guidelines
- Apple Human Interface Guidelines (animation durations)
- CSS `drop-shadow` vs `box-shadow` for transparent PNG glow effects
- Web Content Accessibility Guidelines (WCAG) 2.1/2.2 for touch targets, contrast, keyboard navigation
- CSS `prefers-reduced-motion` media query specification
- Framer Motion / Motion library animation patterns (spring physics, gesture handling)

### Verification Needed Before Implementation
- Current Framer Motion status: may have rebranded to "Motion" (motion.dev) with different package name -- verify before installing
- Next.js 16 Image component API for WebP/AVIF optimization pipeline
- CSS `backdrop-filter: blur()` browser support status (was experimental, likely stable by 2026)
- Performance characteristics of CSS `filter: drop-shadow()` on multiple animated elements
- Best approach for focus trap in React 19 (third-party library vs custom implementation)
- Whether Tailwind v4 theme extension syntax has changed from v3 pattern
