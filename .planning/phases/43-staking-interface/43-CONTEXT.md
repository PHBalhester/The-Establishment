# Phase 43: Staking Interface - Context

**Gathered:** 2026-02-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can stake PROFIT tokens, unstake (with partial amounts), claim pending SOL rewards, and see their yield stats -- completing the protocol's value proposition of real SOL yield from real trading friction. This is the interactive staking form and stats display. Read-only protocol data is Phase 41, swap is Phase 42, charts/indexer are Phase 44.

</domain>

<decisions>
## Implementation Decisions

### Staking interaction model
- Tabbed form (Stake | Unstake | Claim) -- single card, one action visible at a time, same visual pattern as swap form
- Partial unstake supported: user types an amount (confirmed on-chain: `unstake(amount)` with auto-full-unstake if remaining < MINIMUM_STAKE)
- Page location: alongside swap interface on the same page (tech prototype). Production version will use clickable asset -> popup (deferred)
- Claim tab: one-click "Claim X.XX SOL" button with expandable detail breakdown (consistent with swap form expandable fee pattern)

### Rewards display
- Epoch-refresh model: rewards only change when `update_cumulative` runs (step function, not ramp). Display refreshes on poll, not live ticker
- SOL only -- no USD conversion for rewards
- Poll interval and reward placement: Claude's discretion (see below)

### Yield stats & reward rate
- Personal + protocol stats visible: your staked balance, pending rewards, lifetime claimed, PLUS protocol-wide total staked, total distributed, reward rate
- Label as "Reward Rate" (NOT "APY") -- this is variable protocol revenue sharing, not guaranteed returns
- Recent epoch average for reward rate calculation (last N epochs of actual deposits)
- Show per-epoch as primary, annualized as secondary in smaller text ("0.05 SOL/epoch ~ ~12% annualized")
- Show "Your share: X.X% of pool" indicator

### Transaction feedback
- Unstake success shows both amounts: "Unstaked 500 PROFIT + claimed 0.234 SOL rewards. View on Explorer ->"
- Full error map for all staking-specific errors (ZeroAmount, InsufficientBalance, NothingToClaim, InsufficientEscrowBalance, Unauthorized, etc.) -- same pattern as swap error map

### Claude's Discretion
- Transaction feedback style: reuse swap inline pattern vs simpler status line (leaning consistency with swap)
- Confirmation step before unstake: confirm dialog vs direct action (leaning confirm dialog for consequential action)
- Poll interval for staking data refresh (likely 30s to match dashboard)
- Reward stats placement relative to the tabbed form (prominent header vs separate stats row)
- Exact debounce and loading state animations
- Disabled state styling during transaction

</decisions>

<specifics>
## Specific Ideas

- Expandable claim detail follows the same UX pattern as swap fee breakdown -- collapsed by default, expand to see epochs since last claim, reward rate, etc.
- Reward rate wording matters for production: avoid "APY" or "yield" language that implies guaranteed returns. "Reward Rate" is the safe term. Final copy is a design phase concern
- On-chain reward math is Synthetix/Quarry cumulative reward-per-token pattern. Client-side calculation mirrors `update_rewards()`: `pending = (global_cumulative - user_checkpoint) * balance / PRECISION`
- PROFIT tokens use Token-2022 with transfer hook -- stake/unstake transactions need hook account resolution (4 remaining_accounts per mint, same pattern as swap)

</specifics>

<deferred>
## Deferred Ideas

- Production staking UX: clickable asset on homepage producing popup interface (mentioned by user, belongs in design/UX phase)
- USD equivalent for rewards display (decided SOL-only for now, could add later)
- Historical yield graph/chart (could be part of Phase 44 charts or a separate feature)

</deferred>

---

*Phase: 43-staking-interface*
*Context gathered: 2026-02-16*
