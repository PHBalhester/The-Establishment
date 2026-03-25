# Phase 70: Specification Update - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Update Bonding_Curve_Spec.md to reflect the complete v1.2 design: sell-back mechanics with curve rollback, 15% tax escrow, burn-and-claim refunds, coupled graduation, and open access (no whitelist). Cross-reference Protocol_Initialization_and_Launch_Flow.md and Transfer_Hook_Spec.md for consistency. This is the single source of truth for all subsequent implementation phases (71-75).

</domain>

<decisions>
## Implementation Decisions

### Sell-back pricing & curve rollback
- Selling walks the curve backward: `tokens_sold` decreases, price drops for the next buyer
- Sell price computed via reverse integral (same math as buy, applied in reverse direction)
- 15% tax deducted from all curve sells, consistent with protocol's existing sell tax rate
- A sell+rebuy cycle costs ~15% minimum, making wash-trading unprofitable on the curve
- Per-wallet 20M cap applies to NET holdings (selling frees up cap space)

### No ParticipantState PDA
- ParticipantState eliminated entirely -- no per-user on-chain PDA
- Cap enforcement: read user's ATA balance directly during buy instruction (`current_balance + tokens_to_receive <= 20M`)
- Refund: burn-and-claim model (user burns tokens from ATA, receives proportional SOL)
- Purchase history available via emitted events (indexable off-chain)
- Transfer Hook whitelist prevents wallet-to-wallet transfers during curve phase, making ATA balance reads safe (no token shuffling exploits)

### Refund mechanics (burn-and-claim)
- User-initiated: user calls `claim_refund`, program reads ATA balance, burns tokens, sends proportional SOL
- Refund formula: `user_balance / tokens_sold * (sol_vault_balance + tax_escrow_balance)`
- After each claim, `tokens_sold` decreases by burned amount -- subsequent claimers get correct proportional share
- Sellers keep their sell proceeds AND get proportional refund on remaining tokens -- they took the 15% tax hit, fair game
- Combined refund pool: SOL vault + tax escrow merged for distribution
- Pure buyers may get back slightly less than deposited (bounded by total sell volume * 15%) -- accepted as shared risk pool
- No on-chain claim deadline -- refunds available forever; frontend removed after ~30 days
- Consolidate escrow into sol_vault before refund claims begin (`consolidate_for_refund` instruction)

### Tax escrow lifecycle
- Per-curve escrow PDAs -- separate for CRIME curve and FRAUD curve
- On sell: 15% of SOL payout transferred to curve's tax escrow PDA
- On graduation success: tax escrow SOL routes to carnage fund atomically during transition TX
- On failure: `consolidate_for_refund` merges escrow into sol_vault, then standard burn-and-claim
- Escrow balance read from PDA lamports directly -- no duplicated state field in CurveState (safer, no desync bugs)

### Whitelist removal (open access)
- Remove ALL whitelist/Privy references: WhitelistEntry PDA, add_to_whitelist instruction, all purchase checks
- 20M token cap per wallet per curve is the sole sybil resistance -- deliberate design choice
- Remove security sections 12.1 (whitelist bypass) and 12.3 (Privy friction) -- no longer applicable
- No rate limiting -- trivially bypassed by wallet switching; bots not a realistic day-one concern for a new custom program

### Reserve management
- ReserveState PDA removed from bonding curve program
- Reserve tokens (290M pool seed + 250M vault seed per token) managed by existing protocol infrastructure
- Curve program only handles: 460M sale tokens per curve, SOL vault, tax escrow
- Client-side graduation orchestration moves reserve tokens during transition (existing multi-TX pattern)

### Claude's Discretion
- Exact integer math precision scaling for reverse integral
- `participant_count` tracking approach (event-based or lightweight counter)
- CurveState field layout optimization and size calculation
- Cross-reference updates to Protocol_Initialization_and_Launch_Flow.md and Transfer_Hook_Spec.md
- Security section rewrites for new threat model (front-running analysis with 20M cap, sell manipulation bounds)
- Event schema updates for sell and refund instructions

</decisions>

<specifics>
## Specific Ideas

- Sell math is the inverse of buy math: "reverse integral" means the integral from `tokens_sold` back to `tokens_sold - tokens_being_sold`
- Burn-and-claim is the standard pattern for trustless DeFi refunds (pump.fun, Raydium launchpad precedent)
- `consolidate_for_refund` is a separate instruction that must be called BEFORE any `claim_refund` calls -- simplifies claim logic to read from one account
- The Transfer Hook whitelist naturally prevents token shuffling during the curve phase (only protocol PDAs are whitelisted), which is what makes the "read ATA balance" approach safe

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 70-specification-update*
*Context gathered: 2026-03-03*
