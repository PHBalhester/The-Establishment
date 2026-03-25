# Phase 16: ExtraAccountMetaList Setup - Context

**Gathered:** 2026-02-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Configure Token-2022's dynamic PDA resolution so the transfer hook can find whitelist entries at runtime. This phase creates the "wiring" that tells Token-2022: "when checking transfers, here's how to derive the extra accounts (whitelist PDAs) you need."

This is infrastructure setup — the actual whitelist validation logic is Phase 17.

</domain>

<decisions>
## Implementation Decisions

### Authority Model
- WhitelistAuthority signer required for `initialize_extra_account_meta_list`
- Blocked after authority burn (same restriction as `add_whitelist_entry`)
- WhitelistAuthority must exist — Anchor constraint enforces this (no custom error needed)
- Consistent admin model: all setup operations require same authority, all blocked post-burn

### Initialization Timing
- No ordering dependency — whitelist entries can exist before or after ExtraAccountMetaList
- Documented setup sequence is sufficient; self-correcting failure mode if wrong order
- Validate mint is Token-2022 (fail if SPL Token)
- Validate mint's transfer hook extension points to our program (fail if wrong program or missing)

### Per-Mint Behavior
- Any mint with valid hook extension accepted (generic, not hardcoded to CRIME/FRAUD/PROFIT)
- Single mint per instruction call (standard SPL pattern — call once per mint)
- Signer pays rent for ExtraAccountMetaList account (standard Anchor init)

### Event Emission
- Emit `ExtraAccountMetaListInitialized { mint: Pubkey }` on successful initialization
- Matches event pattern from Phase 15 (AddressWhitelisted, AuthorityBurned)

### Idempotency & Errors
- Re-initialization fails — Anchor constraint handles "already in use"
- New error: `InvalidTransferHook` — mint's hook extension points to wrong program
- New error: `NotToken2022Mint` — mint is not a Token-2022 mint

### Claude's Discretion
- Exact ExtraAccountMetaList seed configuration structure
- Helper function organization for mint validation
- Test fixture design for T22 mints with hook extensions

</decisions>

<specifics>
## Specific Ideas

- Authority model mirrors Phase 15 — one authority controls all admin operations
- Generic mint acceptance allows future flexibility without code changes
- Validate early, fail clearly — check T22 and hook extension before creating account

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-extra-account-meta-list*
*Context gathered: 2026-02-05*
