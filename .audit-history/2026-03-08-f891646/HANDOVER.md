# Audit Handover Document

**Previous Audit:** #1 — 2026-02-22 @ `be95eba`
**Current Audit:** #2 — 2026-03-07 @ `f891646`
**Generated:** 2026-03-07

---

## Delta Summary

**Since previous audit:** 71 files changed, 5,630 insertions(+), 6,175 deletions(-)

| Status | Count | Description |
|--------|-------|-------------|
| NEW | 30 | New Rust source files added |
| MODIFIED | 35 | Existing files changed |
| DELETED | 6 | Files removed |
| UNCHANGED | 58 | Files with no changes |

### New Files (30)
All `programs/bonding_curve/` source + tests (19 files) — **entire new program**
All `programs/conversion-vault/` source + tests (10 files) — **entire new program**
`programs/staking/src/instructions/test_helpers.rs` (1 file)

### Deleted Files (6)
- `programs/amm/src/instructions/swap_profit_pool.rs` — PROFIT pool swap removed
- `programs/amm/tests/test_swap_profit_pool.rs` — corresponding test
- `programs/tax-program/src/instructions/swap_profit_buy.rs` — PROFIT buy removed
- `programs/tax-program/src/instructions/swap_profit_sell.rs` — PROFIT sell removed
- `programs/tax-program/tests/test_swap_profit_buy.rs` — corresponding test
- `programs/tax-program/tests/test_swap_profit_sell.rs` — corresponding test

### Modified Files (35)
AMM: constants.rs, instructions/mod.rs, lib.rs, state/pool.rs, 4 test files
Epoch Program: constants.rs, lib.rs
Staking: constants.rs, errors.rs, events.rs, helpers/math.rs, instructions/{claim,mod,stake,unstake}.rs, lib.rs, state/user_stake.rs
Tax Program: constants.rs, events.rs, helpers/{pool_reader,tax_math}.rs, instructions/{mod,swap_sol_buy,swap_sol_sell}.rs, lib.rs, 3 test files
Transfer Hook: lib.rs, test_transfer_hook.rs
Mock/Stub: mock-tax-program/lib.rs, stub-staking/lib.rs

---

## Previous Findings Digest

### Confirmed Findings (15)

| ID | Severity | Description | File | Delta | Tag |
|----|----------|-------------|------|-------|-----|
| H001 | CRITICAL | Bounty transfer drains vault below rent-exempt | epoch-program/trigger_epoch_transition.rs | MODIFIED | RECHECK |
| H113 | CRITICAL | Mint authority retention — infinite supply risk | scripts/deploy/initialize.ts | N/A (TS) | RECHECK |
| S005 | CRITICAL | Initialization front-running — whitelist authority ransom | transfer-hook/initialize_authority.rs | MODIFIED | RECHECK |
| H041 | HIGH | Tax math — incorrect fee calculation | tax-program/swap_sol_buy.rs | MODIFIED | RECHECK |
| S001 | HIGH | Staking escrow rent-exempt accounting | staking/claim.rs | MODIFIED | RECHECK |
| S010 | HIGH | Slippage bypass in buy path | tax-program/swap_sol_buy.rs | MODIFIED | RECHECK |
| H011 | MEDIUM | Profit pool fee asymmetry | tax-program/swap_profit_buy.rs | DELETED | RESOLVED_BY_REMOVAL |
| H043 | MEDIUM | AMM slippage check ordering | amm/swap_sol_pool.rs | MODIFIED | RECHECK |
| H057 | MEDIUM | Epoch state init — no upgrade authority check | epoch-program/initialize_epoch_state.rs | MODIFIED | RECHECK |
| H060 | MEDIUM | EpochState no padding for schema evolution | epoch-program | MODIFIED | RECHECK |
| H064 | MEDIUM | Epoch transition timing | epoch-program/trigger_epoch_transition.rs | MODIFIED | RECHECK |
| H106 | MEDIUM | Epoch state field constraints | epoch-program/epoch_state.rs | MODIFIED | RECHECK |
| H125 | MEDIUM | Unauthorized pool creation | amm/initialize_pool | MODIFIED | RECHECK |
| H090 | LOW | Consume randomness edge cases | epoch-program/consume_randomness.rs | MODIFIED | RECHECK |
| H119 | LOW | Epoch constants tuning | epoch-program/constants.rs | MODIFIED | RECHECK |

### Potential Findings (11)

| ID | Severity | Description | Tag |
|----|----------|-------------|-----|
| H003 | POTENTIAL | Init front-running (general) | RECHECK |
| H004 | POTENTIAL | force_carnage devnet gate | RECHECK |
| H010 | POTENTIAL | Carnage atomic execution | RECHECK |
| H037 | POTENTIAL | Admin privilege escalation paths | RECHECK |
| H063 | POTENTIAL | Transfer hook init front-running variant | RECHECK |
| H067 | POTENTIAL | PoolState struct manipulation | RECHECK |
| H075 | POTENTIAL | Staking reward precision loss | RECHECK |
| H084 | POTENTIAL | Tax math rounding | RECHECK |
| H092 | POTENTIAL | Pool reserve overflow | RECHECK |
| H104 | POTENTIAL | Whitelist entry state | RECHECK |
| H124 | POTENTIAL | Pool creation authority delegation | RECHECK |

---

## Previous False Positive Log

58 hypotheses dismissed as NOT VULNERABLE in audit #1. Key dismissals on **unchanged** files retained:

| ID | Description | File | Reason |
|----|-------------|------|--------|
| H002 | PDA seed collision | Multiple | Seeds are unique per program/context |
| H005 | CPI return value manipulation | AMM | Anchor CpiContext validates return |
| H006 | Token-2022 close authority abuse | Transfer Hook | Close authority not set |
| H007 | VRF outcome prediction front-running | Epoch Program | Switchboard commit-reveal prevents |
| H008 | Whitelist bypass (by design) | Transfer Hook | Designed behavior |
| H009 | Pool drain via CPI re-entrancy | AMM/Tax | Anchor reentrancy guard |
| H012 | Double-spend via parallel TX | Multiple | Solana runtime prevents |
| H013 | PDA authority spoofing | Multiple | Seeds + program validation |
| H014 | Token account ownership confusion | Multiple | Anchor constraint validation |
| H015 | Reward distribution manipulation | Staking | Cumulative math prevents |

*Note: 48 additional dismissals omitted for brevity. All dismissals on MODIFIED files dropped — must be re-evaluated.*

---

## Architecture Snapshot (from Audit #1)

### Trust Boundaries
- User -> Tax Program (entry point) -> AMM (swaps)
- Epoch Program -> Tax Program (carnage) -> AMM (carnage swaps)
- Epoch Program -> Staking (epoch rewards)
- Token-2022 Runtime -> Transfer Hook (whitelist on every transfer)

### Key PDA Authority Chains
1. `swap_authority` [TAX] -> AMM validates via `seeds::program = TAX_PROGRAM_ID`
2. `carnage_signer` [EPOCH] -> Tax validates via `seeds::program = EPOCH_PID`
3. `tax_authority` [TAX] -> Staking validates via `seeds::program = TAX_PROGRAM_ID`
4. `staking_authority` [EPOCH] -> Staking validates via `seeds::program = EPOCH_PID`

### Top Invariants
1. All programs non-upgradeable after deployment (deploy-and-lock)
2. Pool funds PDA-controlled — admin key compromise cannot drain pools
3. VRF commit-reveal prevents Carnage outcome prediction
4. Checked arithmetic throughout (no unchecked blocks)
5. Transfer hook enforces whitelist on every CRIME/FRAUD/PROFIT transfer
6. Tax redistribution: 15% tax split across treasury/staking/carnage
7. Staking uses Synthetix cumulative reward-per-token model
8. Single admin can only: update treasury address, modify whitelist, force carnage (devnet)

### New Programs Since Audit #1
- **Bonding Curve** (AGhdA): Dual bonding curves for token launch — entirely new attack surface
- **Conversion Vault** (6WwVA): Token conversion with hook integration — new CPI paths

---

## Audit Lineage

| # | Date | Git Ref | Confirmed | Potential | Files | Status |
|---|------|---------|-----------|-----------|-------|--------|
| 1 | 2026-02-22 | be95eba | 15 | 11 | 99 | Complete |
| 2 | 2026-03-07 | f891646 | — | — | — | Starting |
