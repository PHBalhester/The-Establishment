# Phase 78: Authority Hardening - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Every program initialization is gated by ProgramData upgrade authority, preventing front-running and unauthorized setup. Bonding Curve gets a BcAdminConfig PDA with admin-gated instructions. Authority map and burn timeline documented in PROJECT.md.

</domain>

<decisions>
## Implementation Decisions

### Bonding Curve Admin (AUTH-01)
- Create BcAdminConfig PDA following AMM's AdminConfig pattern (seeds `[b"bc_admin"]`)
- BcAdminConfig stores authority pubkey, initialized via ProgramData upgrade authority check
- 4 admin instructions gated with `has_one = authority`: initialize_curve, prepare_transition, withdraw_graduated_sol, close_token_vault
- Requirement AUTH-01 count updated from 6 to 4 (purchase, sell, claim_refund are user-facing, not admin)
- Include `burn_bc_admin` instruction to permanently disable admin operations (matches AMM's burn_admin)
- No emergency admin withdrawal from SOL vaults — upgrade authority via timelocked Squads multisig IS the safety net

### ProgramData Init Gating (AUTH-02 through AUTH-06)
- All 5 non-BC programs get ProgramData upgrade authority check on their init instructions
- Pattern: `constraint = program_data.upgrade_authority_address == Some(authority.key())` (same as AMM's initialize_admin)
- No AdminConfig PDAs for these programs — they have no ongoing admin operations
- Specific instructions to gate:
  - Transfer Hook: `initialize_authority` (AUTH-02)
  - Staking: `initialize_stake_pool` (AUTH-03)
  - Epoch: `initialize_epoch_state` (AUTH-04)
  - Epoch: `initialize_carnage_fund` (AUTH-05)
  - Conversion Vault: `initialize` (AUTH-06)
- Tax Program: `initialize_wsol_intermediary` also gets ProgramData check (consistency)

### Authority Map Documentation (AUTH-07)
- Authority map table + brief rationale added to PROJECT.md decisions table
- Authority map covers: program, authority type, holder, burn status
- Table format, concise — not a full policy document

### Authority Lifecycle Strategy
- Program upgrade authority: Transfer to 2-of-3 Squads multisig with 48-72hr timelock. Never burn — preserves ability to fix bugs.
- Admin PDAs (AMM AdminConfig, BC BcAdminConfig, Hook WhitelistAuthority): Also transfer to same Squads multisig. No immediate burn timeline — burn when ready, no pressure.
- Single security model: all authorities (upgrade + admin) under same Squads multisig

### Claude's Discretion
- Exact ProgramData account derivation approach (inline vs helper)
- Whether to add ProgramData check to Tax Program's init even though it's not in AUTH-02 through AUTH-06 list (decision: yes, for consistency)
- Test structure for authority validation (unit vs integration)

</decisions>

<specifics>
## Specific Ideas

- "What if something goes wrong in mainnet and peoples SOL gets frozen/refunds aren't working?" — Decided: upgrade authority IS the safety net. No separate emergency drain instruction.
- "Lets assume for now that upgrade auth will never be burnt, just secured by timelock squads" — No burn timeline pressure. Multisig security is sufficient.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- AMM `initialize_admin.rs` (lines 44-56): Reference implementation for ProgramData upgrade authority check
- AMM `AdminConfig` PDA pattern: `seeds = [b"admin"]`, stores admin pubkey, supports burn
- AMM `burn_admin.rs`: Reference for authority burn pattern (sets admin to None/burns PDA)

### Established Patterns
- ProgramData constraint: `program_data.upgrade_authority_address == Some(authority.key())`
- AdminConfig PDA with `has_one = authority` on admin instructions
- Anchor `init` constraint prevents re-initialization (one-shot safety)

### Integration Points
- Bonding Curve: 4 existing instructions need `has_one = authority` constraint added
- Transfer Hook: `initialize_authority` needs ProgramData account added to context
- Staking: `initialize_stake_pool` needs ProgramData account added to context
- Epoch: Both `initialize_epoch_state` and `initialize_carnage_fund` need ProgramData accounts
- Conversion Vault: `initialize` needs ProgramData account added to context
- Tax Program: `initialize_wsol_intermediary` needs ProgramData account added to context
- PROJECT.md: Authority map table to be added to Key Decisions section

</code_context>

<deferred>
## Deferred Ideas

- Squads multisig creation and authority transfers — v1.4 scope (MN-01)
- Per-program authority burn execution — future decision, no timeline set
- Emergency pause mechanism — out of scope (trust tradeoff, decided in v1.3 planning)

</deferred>

---

*Phase: 78-authority-hardening*
*Context gathered: 2026-03-08*
