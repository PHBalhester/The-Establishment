# Phase 9: Pool Initialization - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the four AMM pools with correct vaults, token programs, fee rates, and PDA derivations. Includes AdminConfig initialization as a prerequisite instruction. Swaps, transfer routing, and access control are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Initial Liquidity Seeding
- Caller-provided amounts: deployer passes `amount_a` and `amount_b` as instruction arguments
- Atomic initialization: vault creation and liquidity transfer happen in a single `initialize_pool` instruction (not split into separate steps)
- Deployer provides source token accounts; instruction transfers tokens into newly created vaults
- Pre-computed vault PDAs allow transfer hook whitelisting before pool accounts exist on-chain (no ordering conflict with whitelist setup)

### Deployer Authority Model
- Config PDA pattern: an `AdminConfig` account stores the admin pubkey
- `initialize_admin` instruction: only callable by program upgrade authority, takes admin pubkey as an argument (allows setting a multisig from day one)
- AdminConfig initialization is part of Phase 9 as a prerequisite to `initialize_pool`
- **Document this as a step** in the plan so it's not missed

### Mint Validation Strategy
- Mint-agnostic: AMM accepts any mint pair, does NOT validate against hardcoded protocol mint addresses
- Security relies on admin gate (only admin can call `initialize_pool`) + PDA collision (prevents duplicate pools)
- Token program validation: instruction DOES verify that provided token programs match the actual mint owners
- Fee rate passed as parameter per pool (not derived from pool type) -- allows flexible fee configuration
- **Spec deviation:** PoolType enum changes from protocol-specific (CRIME_SOL, FRAUD_SOL, etc.) to behavioral (MixedPool, PureT22Pool). This captures the meaningful distinction (how transfers are routed) without coupling AMM to specific token names. **Must verify this doesn't conflict with Phases 10-13 during planning.**

### Pool Type Resolution
- Pool type inferred automatically from token programs -- instruction inspects mint account ownership to determine MixedPool vs PureT22Pool
- Canonical mint ordering (mint_a < mint_b) enforced via auto-sort -- caller can pass mints in any order, program normalizes internally
- Deployer does NOT need to declare pool type explicitly

### Claude's Discretion
- Minimum seed amount enforcement (non-zero vs threshold)
- Admin rotation support (initialize-only vs include update_admin)
- Token program account requirements (both always vs only what's needed per pool type)
- Exact AdminConfig PDA seeds and account structure
- Error message wording and error code assignments

</decisions>

<specifics>
## Specific Ideas

- Launch ordering: mint keypairs generated first -> compute vault PDAs -> whitelist in transfer hook -> create mints -> initialize pools. Vault addresses are deterministic, so whitelisting happens before pool accounts exist.
- The behavioral PoolType is an architectural decision that deviates from AMM_Implementation.md Section 4.1. The spec defines four protocol-specific variants; we're replacing with two behavioral variants. This must be well-documented and cross-checked against downstream phases.
- "Keeping things modular at this level makes sense" -- user values AMM being a general-purpose swap machine, not coupled to specific protocol tokens.

</specifics>

<deferred>
## Deferred Ideas

- Launchpad expansion (creating pools for arbitrary token pairs beyond the four protocol pools) -- potential future capability, not in scope for v0.2
- Fee rate modification post-initialization -- not discussed, but could be a future admin function

</deferred>

---

*Phase: 09-pool-initialization*
*Context gathered: 2026-02-04*
