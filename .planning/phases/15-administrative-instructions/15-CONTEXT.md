# Phase 15: Administrative Instructions - Context

**Gathered:** 2026-02-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Three instructions that manage the whitelist before the transfer hook goes live: initialize_authority (create authority), add_whitelist_entry (populate whitelist), and burn_authority (permanently disable modifications). This phase does NOT include the transfer hook logic itself.

</domain>

<decisions>
## Implementation Decisions

### Authority Lifecycle
- Transaction signer becomes authority (no explicit parameter)
- Return explicit AuthorityAlreadyInitialized error on re-init attempt (don't rely on Anchor init constraint alone)
- No authority transfer capability — init then only burn is possible
- No event emission on initialization (account creation is sufficient signal)

### Entry Creation Flow
- Single address per instruction (no batching — caller can batch in transaction)
- No event emission on entry creation
- Basic validation: reject system program address and null pubkey
- Append-only whitelist — no removal capability

### Burn Mechanics
- Single call burns authority immediately (no two-phase confirmation)
- Emit AuthorityBurned event (important milestone worth tracking)
- Keep WhitelistAuthority account with authority=None (don't close)
- Idempotent: succeed silently if already burned (not an error)

### Error Surfaces
- Minimal error messages — short codes only (e.g., "AlreadyWhitelisted")
- Specific UnauthorizedCaller error for non-authority attempts
- Single InvalidAddress error covers all bad address cases
- No extra logging of rejected values

### Claude's Discretion
- Exact account sizing calculations
- PDA seed format for WhitelistEntry
- Order of validation checks within instructions

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard Anchor patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 15-administrative-instructions*
*Context gathered: 2026-02-05*
