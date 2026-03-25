# VERIFY-H106: No Emergency Pause Mechanism
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence

The absence of an emergency pause mechanism is a deliberate, well-documented architectural decision. It is codified as **Decision D5** in `Docs/DECISIONS/architecture.md` (lines 44-48):

> **Choice:** No pause mechanism. No `is_paused` flag, no `set_paused` instruction, no pause checks in any program.
> **Rationale:** An emergency pause is a centralisation vector that contradicts the decentralized protocol ethos.
> **Alternatives considered:** Global pause flag with pause authority (rejected — centralisation), rate limiting / per-epoch volume caps (discussed, not pursued).

The decision is referenced consistently across at least 8 documents:

- `Docs/security-model.md` (line 575): "No pause mechanism: No `is_paused` flag in any program"
- `Docs/architecture.md` (line 644): "No pause | No `is_paused` flag in any program | Decentralization over intervention."
- `Docs/project-overview.md` (line 69): "No emergency pause | No `is_paused` flag, no kill switch, no governance intervention"
- `Docs/PROJECT_BRIEF.md` (line 37): "[arch] No emergency pause — decentralisation over intervention"
- `Docs/upgrade-cascade.md` (line 185): "There is no pause mechanism, no governance, and no admin intervention path. This is by design."
- `Docs/mainnet-readiness-assessment.md` (lines 205-209): Explicitly flags no-pause as a risk requiring thorough pre-burn verification.
- `.planning/PROJECT.md` (line 359): "Decided against admin-triggered pause mechanism."
- `.planning/REQUIREMENTS.md` (line 149): "Emergency pause mechanism | Trust tradeoff — admin pause perceived as rug pull vector."

Operational mitigations remain unchanged from round 2:
- Pre-burn: upgrade authority allows program patches via timelocked 2-of-3 Squads multisig
- Crank circuit breaker (H019, FIXED) provides off-chain halt for epoch transitions
- Post-burn: protocol is immutable; users exit through existing swap paths

## Assessment

Accepted risk, unchanged. The no-pause decision is one of the most thoroughly documented architectural choices in the project, referenced in requirements, architecture, security model, deployment, and planning documents. The team explicitly rejected pause mechanisms as a centralisation vector incompatible with the protocol's trust model. The timelocked multisig upgrade authority provides a pre-burn emergency response path (slower than a dedicated pause, but without the trust implications). No code changes expected or needed — this is a permanent design constraint.
