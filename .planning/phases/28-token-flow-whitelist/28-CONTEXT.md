# Phase 28: Token Flow and Whitelist - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect Staking Program to Transfer Hook whitelist so PROFIT token transfers succeed through stake/unstake flows. Validate the full token flow works end-to-end with escrow solvency invariants.

</domain>

<decisions>
## Implementation Decisions

### Deployment Targets
- Localnet only — devnet deployment handled in future milestone
- TypeScript scripts — reuses existing test infrastructure and Anchor patterns
- Test suite setup — initialization runs in beforeAll hooks (single source of truth)
- Use existing devnet-wallet keypair — preserve accumulated SOL in that wallet

### Initialization Sequence
- Same admin as Transfer Hook adds StakeVault whitelist entry (entry #14)
- No strict dependency — StakePool can initialize without whitelist entry existing
- Order: Transfer Hook init → StakePool init → Add StakeVault to whitelist
- Tests verify full initialization sequence works end-to-end

### Escrow Validation
- Assertion after each operation — every stake/unstake/claim test asserts escrow >= sum(pending)
- On-chain invariant check in claim instruction — verify escrow balance >= claim amount before transfer
- Hard fail with InsufficientEscrow error if escrow somehow insufficient
- Emit EscrowInsufficientAttempt event on failure only — success implicit in ClaimRewards event

### Testing Scope
- Happy path + key edge cases (zero stake, mid-epoch stake, multiple users)
- Full integration with real Transfer Hook — tests prove whitelist actually works
- Explicit negative test — stake fails cleanly when StakeVault not whitelisted
- Time warp with warp_to_slot for epoch advancement — tests complete quickly

### Claude's Discretion
- remaining_accounts array structure for Transfer Hook passthrough
- Exact test helper implementations
- Error message wording for InsufficientEscrow

</decisions>

<specifics>
## Specific Ideas

- Use existing devnet-wallet keypair (keypairs/devnet-wallet.json) to preserve accumulated SOL
- Whitelist entry #14 follows pattern of entries #1-13 already in Transfer Hook
- Test initialization matches production order: Hook → Pool → Whitelist

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 28-token-flow-whitelist*
*Context gathered: 2026-02-08*
