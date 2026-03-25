# Phase 59: Onboarding - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

First-time visitors see a welcome modal that introduces Dr. Fraudsworth's Finance Factory, explains the protocol concept in under 10 seconds of reading, and offers two entry paths (explore or connect wallet). The modal uses the existing modal system, persists dismissal in localStorage, and never blocks returning users. No guided tours, no multi-step wizards, no new capabilities beyond the welcome gate.

</domain>

<decisions>
## Implementation Decisions

### Welcome Content & Tone
- Title: "Welcome to Dr. Fraudsworth's Finance Factory" (per roadmap requirement)
- Subtitle/tagline: one line capturing the value prop (real yield from trading friction, steampunk-flavored)
- Body: 2-3 sentences maximum — what the three tokens are, what Carnage does, what staking yields. Enough to orient, not enough to bore
- Tone: Dr. Fraudsworth as character — theatrical, slightly grandiose Victorian inventor, but the actual information is clear and honest. Think "eccentric professor" not "carnival barker"
- No technical jargon in the welcome copy (no "AMM", "liquidity pools", "transfer hooks"). Save that for the docs station

### Action Choices & Flow
- Two action buttons at the bottom of the modal:
  1. **"Enter the Factory"** — dismisses modal, user sees factory scene (desktop) or mobile nav (mobile). Pure exploration path.
  2. **"Connect Wallet"** — dismisses modal AND triggers Privy wallet connection flow. Action path for users ready to transact.
- Both buttons set the localStorage flag — modal never appears again regardless of which was chosen
- No third option, no "skip", no "learn more". Two clear paths. The factory itself teaches through interaction.
- After dismissal: user lands on the standard factory view. No follow-up tooltips, no highlight animations, no hand-holding. The glowing station hover effects (Phase 55) are the implicit guidance.

### Visual Presentation
- Uses existing ModalShell with steampunk chrome (brass borders, bolts, themed header) — no special modal variant
- Decorative header element inside the modal: factory crest/emblem or simplified factory silhouette. Static image, not animated. Establishes brand identity before user reads.
- The factory scene visible behind the backdrop blur creates the "reveal" moment — closing the welcome modal unveils the factory. This IS the theatrical moment; the modal itself should be restrained.
- Typography follows existing theme: Cinzel heading, system body, IBM Plex Mono for any token names
- No confetti, no particle effects, no entrance animation beyond the standard iris-open (desktop) or slide-up (mobile)

### Return Visitor Handling
- localStorage key: simple boolean flag (e.g., `dr-fraudsworth-welcomed`)
- Check on app mount (client-side only — SSR renders without modal, hydration adds it)
- No "show welcome again" toggle in Settings station — unnecessary complexity
- No cross-device sync — localStorage per browser is sufficient
- If user clears browser data, they see it again — this is acceptable and even useful as a re-orientation
- Same modal content on mobile and desktop — responsive styling handled by existing modal system (fullscreen slide-up on mobile, centered iris-open on desktop)

### Claude's Discretion
- Exact welcome copy wording (within the tone and length constraints above)
- Choice of decorative header image/element
- Button styling details (both should use existing brass-button / big-red-button patterns)
- localStorage key naming convention
- Whether "Connect Wallet" button uses primary or secondary visual weight relative to "Enter the Factory"

</decisions>

<specifics>
## Specific Ideas

- The welcome modal should feel like a "title card" — the opening frame of a Victorian-era show. Brief, grand, then the curtain rises (modal closes, factory appears).
- The factory background visible through the backdrop blur is the key visual hook. The modal itself doesn't need to carry the entire visual weight.
- "Enter the Factory" should feel like the primary/default action — exploration-first, not transaction-first. New users should feel invited to look around before connecting.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 59-onboarding*
*Context gathered: 2026-02-24*
