---
topic: "Account Structure"
topic_slug: "account-structure"
status: complete
interview_date: 2026-02-20
decisions_count: 5
provides: ["account-structure-decisions"]
requires: ["architecture-decisions", "token-model-decisions"]
verification_items: []
---

# Account Structure — Decisions

## Summary
The protocol uses 24 PDA types across 6 programs, overwhelmingly singleton (20/24). State is kept minimal — no on-chain analytics counters beyond what's already deployed. Account layouts are permanent (upgrade authority will be burned). UserStake is the only unbounded account type and is never closed.

## Decisions

### D1: Minimal On-Chain State — Derive Stats Off-Chain
**Choice:** No additional lifetime statistics fields on any account struct. All analytics (total volume, swap counts, epoch history) are derived off-chain from transaction history via Helius webhooks or RPC indexing.
**Rationale:** Less state = less surface area for bugs, less compute per instruction, less rent. Since upgrade authority is burned, you'd be locked into whatever stat fields you chose. Off-chain derivation is infinitely flexible and can be changed post-burn.
**Note:** CarnageFundState already has 4 write-only lifetime counters (`total_sol_spent`, `total_crime_burned`, `total_fraud_burned`, `total_triggers`). These are legacy — never read for program logic, cost negligible compute (4 saturating adds per Carnage), and can't be removed post-burn. Harmless but not a pattern to replicate.
**Alternatives considered:** Adding lifetime stats to EpochState and PoolState (rejected — derive off-chain instead).
**Affects docs:** [data-model, account-layout-reference, token-economics-model]

### D2: Canonical Mint Ordering Enforced On-Chain
**Choice:** AMM pool PDAs use lexicographic mint ordering (`mint_a.key() < mint_b.key()`) enforced on-chain in `initialize_pool`. Pool creation rejects misordered or identical mints.
**Rationale:** Ensures exactly one canonical PDA per mint pair. On-chain enforcement means clients can't accidentally create duplicate pools with swapped ordering.
**Alternatives considered:** Client-side convention only (rejected — on-chain enforcement is trivial and eliminates a class of bugs).
**Affects docs:** [data-model, account-layout-reference, cpi-interface-contract]

### D3: UserStake Accounts Persist Forever
**Choice:** UserStake accounts are never closed, even after full unstake. Account persists with `staked_balance: 0`, costing ~0.00114 SOL in permanent rent per user.
**Rationale:** Simplicity. Avoiding account closure eliminates edge cases around PDA re-initialization. Users can re-stake without paying rent again. The rent cost is negligible. For a protocol burning upgrade authority, fewer code paths = fewer bugs.
**Alternatives considered:** Close on full unstake and return rent (rejected — adds re-initialization complexity for negligible rent savings).
**Affects docs:** [data-model, account-layout-reference, frontend-spec]

### D4: No Account Versioning
**Choice:** No version fields or migration logic in any account struct. Layouts are final.
**Rationale:** Upgrade authority will be burned. There will never be a program update that needs to read old vs new account formats. Versioning would be dead code.
**Alternatives considered:** Adding a version byte for safety (rejected — adds complexity with zero utility post-burn).
**Affects docs:** [data-model, account-layout-reference]

### D5: Conversion Vault Account Structure
**Choice:** Conversion Vault uses PDA-derived token accounts rather than external ATAs. VaultConfig PDA (seeds `[b"vault_config"]`) holds the conversion rate (100:1) and bump. Vault token accounts use seeds `[b"vault", mint.key()]` for each of CRIME, FRAUD, and PROFIT mints.
**Rationale:** PDA-derived token accounts are owned by the program and require no external ATA creation or management. The vault is a closed system — tokens flow in (PROFIT deposited) and out (CRIME/FRAUD dispensed) through program-controlled accounts. Using PDAs keeps the vault self-contained with no dependency on associated token program conventions.
**Alternatives considered:** Using standard ATAs owned by the vault PDA (rejected — adds associated_token_program dependency and ATA creation overhead for no benefit in a program-controlled context).
**Affects docs:** [data-model, account-layout-reference, architecture]

## Open Questions
(None — all account structure decisions are firm.)

## Raw Notes
- 24 PDA types total: 20 singleton, 4 per-instance (PoolState x4, Vault x8, WhitelistEntry x14, UserStake x unbounded). The Conversion Vault adds 4 PDAs: VaultConfig x1, vault token accounts x3 (CRIME, FRAUD, PROFIT)
- 9 custom state structs: AdminConfig, PoolState, WhitelistAuthority, WhitelistEntry, EpochState, CarnageFundState, StakePool, UserStake, VaultConfig
- 4 cross-program PDAs (SwapAuthority, TaxAuthority, StakingAuthority, CarnageSigner) are derived from one program but validated by another — these are the CPI glue between the 5 CPI-connected programs. Conversion Vault has no cross-program PDAs (it is a standalone leaf program)
- Tax Program stores no state of its own — reads EpochState from Epoch Program for current tax rates
