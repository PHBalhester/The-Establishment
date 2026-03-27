# Architecture Patterns: v1.5 Feature Integration

**Domain:** New feature integration into live Solana DeFi protocol (Dr. Fraudsworth)
**Researched:** 2026-03-25
**Confidence:** MEDIUM-HIGH (architecture well-understood from codebase; Jupiter integration details partially verified via web research)

---

## 1. Vault Convert-All: Minimal On-Chain Change

### What Changes

The Conversion Vault's `convert` instruction gains a "convert-all" mode using `amount_in == 0` as a sentinel value, plus a new `minimum_output` parameter for on-chain slippage protection.

### Component Boundaries

| Component | Change Type | Scope |
|-----------|-------------|-------|
| `programs/conversion-vault/src/instructions/convert.rs` | MODIFY | Sentinel detection, balance read, minimum_output check |
| `programs/conversion-vault/src/error.rs` | MODIFY | Add `SlippageExceeded` variant |
| `programs/conversion-vault/src/lib.rs` | MODIFY | Update `convert` signature (add `minimum_output: u64`) |
| `app/lib/swap/multi-hop-builder.ts` | MODIFY | Pass `amount_in = 0` for multi-hop vault steps |
| `app/lib/swap/swap-builders.ts` | MODIFY | `buildVaultConvertTransaction` gains `minimumOutput` param |

### Data Flow Change

```
BEFORE (leaky):
  Client quotes AMM output -> predicts vault input (wrong) -> vault converts predicted amount -> leftover tokens leak

AFTER (clean):
  Client sends amount_in=0 -> vault reads user_input_account.amount on-chain -> converts entire balance -> zero leak
```

### Integration Points

- **Instruction signature is a breaking change**: `convert(amount_in: u64)` becomes `convert(amount_in: u64, minimum_output: u64)`. All callers (client, tests, any future CPI callers) must update simultaneously.
- **No CPI surface affected**: The Vault is a leaf node (no programs CPI into it). Only the client calls it directly. This makes the upgrade safe -- no cascading program changes.
- **Backwards compatible via sentinel**: Old behavior (`amount_in > 0`) is preserved. New convert-all behavior only activates when `amount_in == 0`.
- **Whitelist**: Vault token accounts are already whitelisted. No whitelist changes needed.

### Recommendation

**Build this first.** It is the smallest scope (one instruction change, one error variant), fixes a live UX-breaking bug (Blowfish wallet warnings on large trades), and has zero dependency on other features. Deploy via Squads timelocked upgrade. Coordinate client deploy within same maintenance window. The detailed proposal in `Docs/vault-convert-all-proposal.md` is well-specified and ready to implement as-is.

**Risk: LOW.** The sentinel pattern (0 = convert all) is well-established in DeFi (many AMMs use 0 as "use full balance"). The new `minimum_output` parameter adds safety, not complexity.

---

## 2. Jupiter / Aggregator Integration

### The Core Challenge

Jupiter needs to call Dr. Fraudsworth's swap instructions. The current architecture has a deliberate security gate: the AMM's `swap_sol_pool` instruction requires a `swap_authority` PDA derived from the Tax Program. **No external program can call the AMM directly.** This is by design -- it forces all swaps through tax collection.

Jupiter's integration model works in two layers:
1. **Off-chain SDK** (Rust crate implementing the `Amm` trait): handles quoting, account discovery, and transaction construction
2. **On-chain execution**: Jupiter's router calls the DEX program directly with the accounts specified by `get_swap_and_account_metas()`

### Which Program Does Jupiter Call?

**Jupiter must call the Tax Program, not the AMM.** This is architecturally correct because:

1. The AMM is CPI-gated -- `swap_authority` PDA is derived from Tax Program. Jupiter cannot produce this signature.
2. Tax collection is non-optional -- bypassing tax would break the economic model.
3. The Tax Program's `swap_sol_buy` and `swap_sol_sell` are already the user-facing entry points. Jupiter just becomes another "user."

### Account Structure Compatibility

The Tax Program's `SwapSolBuy` struct requires 18 named accounts plus `remaining_accounts` for transfer hook resolution:

| # | Account | Notes for Jupiter |
|---|---------|-------------------|
| 0 | user (signer, mut) | Jupiter router or user wallet |
| 1 | epoch_state | Read-only, deterministic PDA |
| 2 | swap_authority | Read-only Tax PDA (no signer needed from caller) |
| 3 | tax_authority | Read-only Tax PDA |
| 4 | pool (mut) | AMM PoolState PDA -- deterministic from mint pair |
| 5 | pool_vault_a (mut) | Derived from pool PDA |
| 6 | pool_vault_b (mut) | Derived from pool PDA |
| 7 | mint_a | WSOL mint |
| 8 | mint_b | CRIME or FRAUD mint |
| 9 | user_token_a (mut) | User's WSOL ATA |
| 10 | user_token_b (mut) | User's CRIME/FRAUD ATA |
| 11 | stake_pool (mut) | Staking PDA |
| 12 | staking_escrow (mut) | Staking escrow PDA |
| 13 | carnage_vault (mut) | Epoch Program PDA |
| 14 | treasury (mut) | Fixed address |
| 15 | amm_program | Fixed program ID |
| 16 | token_program_a | SPL Token |
| 17 | token_program_b | Token-2022 |
| 18 | system_program | System Program |
| 19 | staking_program | Fixed program ID |
| remaining | Hook accounts (4) | ExtraAccountMetaList + whitelist PDAs + hook program |

**This is a large account set (23 total with remaining_accounts).** Jupiter can handle this -- many integrated DEXes have complex account structures. The `get_swap_and_account_metas()` implementation must return all accounts correctly.

### Jupiter SDK Implementation Plan

```
jupiter-drfraudsworth-adapter/
  src/
    lib.rs          -- Implements jupiter_amm_interface::Amm trait
    accounts.rs     -- Account derivation helpers (PDAs, ATAs)
    state.rs        -- EpochState, PoolState deserialization
    quote.rs        -- Tax math + AMM math for quoting
```

Key trait methods:

| Method | What It Does |
|--------|-------------|
| `get_reserve_mints()` | Returns `[WSOL, CRIME]` or `[WSOL, FRAUD]` |
| `get_accounts_to_update()` | Returns PoolState + EpochState pubkeys |
| `update()` | Caches pool reserves + current tax rates |
| `quote()` | Applies tax math (buy: deduct from input; sell: deduct from output) then AMM constant-product math |
| `get_swap_and_account_metas()` | Returns full 23-account structure + appropriate Swap variant |

### Critical Integration Considerations

**Token-2022 + Transfer Hook support:** Jupiter Ultra v3 (launched 2025) added Token-2022 support. However, the transfer hook's `remaining_accounts` forwarding is a known pain point. The SDK must include the 4 hook-resolution accounts in `get_swap_and_account_metas()`.

**Confidence: MEDIUM.** Jupiter's docs confirm the `Amm` trait integration path. However, whether Jupiter's on-chain router correctly forwards `remaining_accounts` for Token-2022 transfer hooks in CPI chains needs validation. This is the single biggest integration risk.

**The `is_crime` parameter:** Tax Program instructions use `is_crime: bool` to select which pool to route through. Jupiter would need to model CRIME/SOL and FRAUD/SOL as separate AMM instances (each implementing `Amm`), not one AMM with two pools. Each instance hardcodes `is_crime` in its `get_swap_and_account_metas()`.

**No program changes needed for Jupiter integration.** The Tax Program already accepts external callers -- the `user` account is just a signer. Jupiter becomes a new caller. The only work is the off-chain SDK crate.

### Whitelist Implications for Jupiter

Jupiter's router will transfer tokens into/out of user wallets. The transfer hook checks that either source or destination is whitelisted. Currently whitelisted addresses are protocol PDAs (pool vaults, carnage vaults, staking vault, conversion vault, bonding curve vaults).

**Jupiter does NOT need whitelisting** because:
- Buy path: WSOL goes IN to pool vault (whitelisted), CRIME/FRAUD goes OUT from pool vault (whitelisted) to user. The pool vault is whitelisted, so the hook passes.
- Sell path: CRIME/FRAUD goes IN from user to pool vault (whitelisted). Pool vault is whitelisted, hook passes.

The whitelist checks `source OR destination` -- as long as one side is a whitelisted PDA, the transfer succeeds. Since all AMM pool vaults are whitelisted, Jupiter swaps through Tax Program work without any whitelist additions.

**Confidence: HIGH.** Verified from transfer hook source: `programs/transfer-hook/src/instructions/transfer_hook.rs` checks either source or destination has a WhitelistEntry PDA.

---

## 3. USDC Pool Pairs

### Architecture Decision: Same AMM Program, New PoolState PDAs

The AMM is **already mint-agnostic**. The `initialize_pool` instruction:
- Accepts any two mints with canonical ordering (`mint_a < mint_b`)
- Infers pool type from token programs (MixedPool vs PureT22Pool)
- Creates unique PoolState PDA from `["pool", mint_a, mint_b]` seeds

USDC (SPL Token, address `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) paired with CRIME or FRAUD (Token-2022) would create MixedPool instances -- the same type as existing SOL pools.

**Recommendation: Use the existing AMM program.** No new AMM program needed. Just call `initialize_pool` with USDC + CRIME mints (and USDC + FRAUD mints). The AMM AdminConfig authority (retained, now in Squads multisig) can create these pools.

### Tax Program: The Hard Part

The Tax Program is **deeply wired for native SOL**:

1. **Tax collection uses `system_instruction::transfer`** -- native SOL transfers from user to staking_escrow, carnage_vault, treasury. USDC taxes would need SPL token transfers instead.
2. **WSOL wrapping/unwrapping** -- the sell path has a complex Transfer-Close-Distribute-Reinit cycle for extracting WSOL taxes. USDC has no wrapping ceremony.
3. **Hardcoded program references** -- `staking_program_id()`, `epoch_program_id()` are compile-time constants.
4. **Staking rewards are SOL-denominated** -- the staking escrow holds native SOL. USDC taxes would need to feed into the same SOL-denominated staking system (requiring a USDC-to-SOL swap) or into a separate USDC reward pool.

### Two Approaches for USDC Tax Routing

#### Approach A: New Tax-USDC Program (Recommended)

Deploy a separate `tax-usdc` program that:
- Mirrors the Tax Program's structure but uses SPL Token transfers for USDC
- Reads the SAME EpochState for tax rates (tax parity per the futarchy spec)
- Has its own `swap_authority_usdc` PDA to call the AMM
- Routes USDC taxes: 71% to staking (requires USDC-to-SOL conversion), 24% to USDC carnage fund, 5% to treasury

**Pros:** Clean separation, no risk to existing SOL swap paths, can iterate independently.
**Cons:** Code duplication, two programs to maintain, USDC-to-SOL conversion adds complexity.

#### Approach B: Extend Existing Tax Program

Add `swap_usdc_buy` and `swap_usdc_sell` instructions to the current Tax Program:
- New instruction handlers that use SPL token transfers instead of system_instruction
- Share tax math, EpochState reading, and distribution logic
- Reuse existing swap_authority PDA (AMM validates `seeds::program = TAX_PROGRAM_ID`, which is unchanged)

**Pros:** Single program, shared logic, no duplication, existing swap_authority works.
**Cons:** Tax Program grows significantly, increased audit surface, any bug risks both SOL and USDC paths.

**Recommendation: Approach A (separate program) for risk isolation, BUT Approach B deserves serious consideration.** The key advantage of Approach B is that the existing `swap_authority` PDA already works -- no AMM changes needed. With Approach A, the AMM must be modified to accept a second caller (see AMM authorized_callers below). If the team is confident in testing, Approach B avoids touching the AMM entirely.

### AMM Caller Authorization (Required for Approach A only)

The AMM's `swap_sol_pool` validates `swap_authority` via `seeds::program = TAX_PROGRAM_ID` (hardcoded constant in the AMM). A new Tax-USDC program would have a different program ID. Options:

1. **Option 1:** Add a second hardcoded `TAX_USDC_PROGRAM_ID` check in AMM
2. **Option 2:** Make AMM's caller validation configurable via AdminConfig (list of authorized programs)
3. **Option 3:** Use Approach B (extend existing Tax Program) to avoid this entirely

If Approach A is chosen, Option 2 is recommended. Add an `authorized_callers: Vec<Pubkey>` (or fixed-size array) to AdminConfig. The AMM admin registers Tax-USDC as a second authorized caller.

**Risk: MEDIUM.** This requires an AMM program upgrade, which touches live SOL pool infrastructure. Must be extensively tested.

### Staking Reward Denomination

**Staking rewards MUST remain SOL-denominated.** The staking program accumulates SOL in its escrow and distributes via cumulative reward-per-token math. Adding USDC rewards would require dual accumulators, dual claims -- massive complexity for minimal gain.

**Recommendation: Convert USDC taxes to SOL before staking deposit.** The Tax-USDC program's 71% staking portion gets buffered in a USDC holding account. A crank process periodically swaps USDC->SOL (via Jupiter API or a USDC/SOL pool) and deposits the SOL to the staking escrow via `deposit_rewards`.

The 24% carnage portion could stay as USDC in a separate USDC carnage fund, or also be converted to SOL. The futarchy spec (Docs/FutureFutarchy.md) implies separate carnage operations per denomination.

### Whitelist Implications for USDC Pools

New USDC pool vaults need whitelisting. The transfer hook only fires on Token-2022 transfers (CRIME, FRAUD, PROFIT). USDC is SPL Token, so the USDC side of the pool does not trigger the hook. Only the CRIME/FRAUD vault side needs whitelisting.

**2 new WhitelistEntry PDAs needed:**
- CRIME/USDC pool vault_b (CRIME side, Token-2022)
- FRAUD/USDC pool vault_b (FRAUD side, Token-2022)

The whitelist authority is in Squads multisig -- adding entries requires a multisig transaction.

If a Tax-USDC program is deployed (Approach A), any intermediary token accounts it creates for CRIME/FRAUD also need whitelisting. Estimate: 2-4 additional entries.

### Conversion Vault Implications

The existing Conversion Vault only handles CRIME<->PROFIT and FRAUD<->PROFIT. USDC pools do not change the vault -- users still convert through the same vault regardless of which pool they used to acquire CRIME/FRAUD. **No vault changes for USDC pools.**

### CPI Depth for USDC Pools

USDC pool swaps through Tax(-USDC) -> AMM -> Token-2022 -> Transfer Hook = depth 4 total (same as SOL pools). The USDC side uses SPL Token (no hook), so only the CRIME/FRAUD side hits depth 4. **No depth issue.**

### Data Flow: USDC Buy Swap

```
User calls Tax-USDC::swap_usdc_buy(amount_in, minimum_output, is_crime)
  1. Read EpochState (same PDA, same rates -- tax parity)
  2. Calculate tax in USDC terms
  3. SPL Token transfer: user -> staking_usdc_buffer (71%)
  4. SPL Token transfer: user -> carnage_usdc_vault (24%)
  5. SPL Token transfer: user -> treasury_usdc (5%)
  6. CPI: AMM::swap_sol_pool (generic MixedPool swap)
     with swap_authority_usdc PDA signing
  7. User receives CRIME/FRAUD from pool vault

  [Async/crank]: staking_usdc_buffer swaps USDC->SOL via Jupiter,
                  then deposits SOL to staking escrow
```

**Note on AMM naming:** The AMM instruction is called `swap_sol_pool` but it is actually generic for any MixedPool. It swaps between token_program_a and token_program_b sides regardless of mint identity. The name is misleading but the logic works for USDC pools without modification.

---

## 4. Crank Hardening

### Current Architecture

The crank bot runs on Railway as a Node.js process. It handles:
- Epoch transitions (trigger_epoch_transition, VRF commit/reveal/consume)
- Carnage execution (execute_carnage_atomic, execute_carnage, expire_carnage)
- Staking update (update_cumulative via epoch consumption)
- Switchboard randomness account rent reclaim

### Integration Points

Crank hardening is isolated from the other features. Changes are purely operational:

| Component | Change Type | Notes |
|-----------|-------------|-------|
| Crank bot process | MODIFY | Retry logic, monitoring, error recovery |
| Railway config | MODIFY | Health checks, restart policies |
| Sentry integration | MODIFY | Better error categorization |

**No on-chain program changes for crank hardening.** The crank calls existing instructions. Hardening is purely operational (retry strategies, monitoring, alerting).

### Dependency: None

Crank hardening has zero dependencies on vault convert-all, Jupiter, or USDC pools. It can proceed in parallel with any other work.

---

## 5. Recommended Architecture: Component Boundaries

### New Components (USDC Pools -- Approach A)

| Component | Program | Responsibility | Communicates With |
|-----------|---------|---------------|-------------------|
| Tax-USDC | New program | USDC-denominated tax collection + distribution | AMM (swap CPI), Staking (deposit CPI), EpochState (read) |
| USDC Staking Buffer | New PDA (in Tax-USDC) | Holds 71% USDC tax pending conversion | Jupiter API (off-chain conversion) |
| USDC Carnage Vault | New PDA (in Epoch or standalone) | Holds 24% USDC tax for Carnage | Epoch Program or new Carnage-USDC logic |

### New Components (Jupiter)

| Component | Type | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| jupiter-drfraudsworth-adapter | Off-chain Rust crate | Amm trait implementation | Tax Program (on-chain swap), AMM (state reading) |

### Modified Components

| Component | Change | Risk |
|-----------|--------|------|
| AMM AdminConfig | Add authorized_callers for Tax-USDC (Approach A only) | MEDIUM -- touches live program |
| Conversion Vault convert instruction | Add convert-all mode + minimum_output | LOW -- leaf node, no CPI callers |
| Transfer Hook whitelist | Add 2-6 entries for USDC pool vaults + Tax-USDC intermediaries | LOW -- admin operation via Squads, no code change |

### Unchanged Components

| Component | Why Unchanged |
|-----------|---------------|
| Staking Program | Continues receiving SOL deposits; USDC converted off-chain first |
| Epoch Program | Tax rates are per-token, denomination-agnostic |
| Transfer Hook Program | Logic is mint-agnostic; only needs new whitelist entries (admin op) |
| Bonding Curve | Launch phase complete, not affected |

---

## 6. Build Order (Dependency-Driven)

```
Phase 1: Vault Convert-All + Crank Hardening (parallel, zero deps)
  |
  |-- Vault: on-chain change, client change, deploy via Squads
  |-- Crank: operational hardening, monitoring improvements
  |
Phase 2: Jupiter SDK (depends on nothing, but benefits from stable protocol)
  |
  |-- Off-chain Rust crate implementing Amm trait
  |-- No on-chain changes needed
  |-- Submit to Jupiter team for review
  |
Phase 3: USDC Pool Infrastructure (largest scope, most risk)
  |
  |-- 3a: Design decision -- Approach A vs B (confirm with owner)
  |-- 3b: AMM authorized_callers upgrade (if Approach A)
  |-- 3c: Tax-USDC program development + testing (if Approach A)
  |       OR Tax Program extension + testing (if Approach B)
  |-- 3d: USDC pool creation (initialize_pool with USDC mints)
  |-- 3e: Whitelist additions for new pool vaults
  |-- 3f: USDC tax-to-SOL conversion pipeline (crank addition)
  |-- 3g: Frontend route engine updates for USDC pools
  |-- 3h: Jupiter SDK update to include USDC pool instances
```

### Phase Ordering Rationale

1. **Vault convert-all first** because it fixes a live bug affecting real users and is the smallest scope.
2. **Crank hardening in parallel** because it has zero dependencies and improves operational reliability.
3. **Jupiter SDK second** because it requires no on-chain changes and can proceed while USDC work is designed. Also, having Jupiter integration ready means USDC pools are routable from day one.
4. **USDC pools last** because they have the biggest scope, touch the most components, potentially require an AMM upgrade, and benefit from Jupiter SDK being ready.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Deploying a Separate AMM for USDC Pools
**What:** New AMM program instance just for USDC pools.
**Why bad:** Fragments liquidity infrastructure, doubles maintenance burden, requires duplicating the entire AMM codebase. The AMM is already mint-agnostic.
**Instead:** Use the existing AMM with either extended Tax Program or new Tax-USDC with authorized_callers.

### Anti-Pattern 2: Converting USDC Taxes On-Chain via CPI
**What:** Having Tax-USDC swap USDC->SOL atomically within the tax instruction via Jupiter CPI.
**Why bad:** CPI depth is already at 4. Adding a Jupiter CPI leg is impossible (Solana limit). Also, Jupiter does not expose a CPI interface -- it is client-side / instruction-level only.
**Instead:** Buffer USDC taxes and convert off-chain via crank/keeper.

### Anti-Pattern 3: Making Staking Dual-Denomination
**What:** Modifying the Staking Program to track both SOL and USDC rewards.
**Why bad:** Doubles complexity of reward math, claim logic, and escrow management. Users do not want to claim two currencies. The staking program is security-critical and heavily audited.
**Instead:** Convert USDC to SOL before staking deposit. Single denomination, single claim.

### Anti-Pattern 4: Burning Whitelist Authority Before USDC Pools
**What:** Burning the transfer hook's whitelist authority before all future pool vaults are whitelisted.
**Why bad:** Once burned, no new addresses can be whitelisted. USDC pool vaults would be permanently unable to receive Token-2022 tokens.
**Instead:** Keep whitelist authority in Squads multisig until all future pools are created and whitelisted. This is already the current strategy.

### Anti-Pattern 5: Jupiter CPI Integration (On-Chain Router)
**What:** Trying to make Jupiter's on-chain program CPI into the Tax Program.
**Why bad:** Jupiter's on-chain router constructs instruction calls from the off-chain SDK's `get_swap_and_account_metas()`. It does not CPI into DEX programs -- it calls them as top-level instructions within a transaction. Designing for CPI compatibility would be solving the wrong problem.
**Instead:** Implement the off-chain `Amm` trait correctly. Jupiter handles the rest.

---

## Scalability Considerations

| Concern | Current (2 pools) | With USDC (4 pools) | Future (8+ pools) |
|---------|--------------------|---------------------|--------------------|
| Whitelist entries | 14 | 16-20 | Grows linearly per pool |
| AMM PoolState PDAs | 2 | 4 | One per unique mint pair |
| Tax Programs | 1 | 1-2 (depending on approach) | One per quote denomination |
| CPI depth | 4/4 (maxed) | 4/4 (maxed) | Cannot grow -- Solana limit |
| Jupiter SDK instances | 0 | 2 (CRIME/SOL, FRAUD/SOL) | One per pool |
| Crank complexity | Low | Medium (USDC conversion) | Higher (more pools to monitor) |

---

## Open Questions (Require Owner Decision)

1. **Tax-USDC: Approach A (new program) vs Approach B (extend existing)?**
   - A isolates risk but requires AMM changes
   - B avoids AMM changes but increases Tax Program surface
   - Recommendation: Discuss tradeoffs with owner before committing

2. **USDC Carnage: SOL-denominated or USDC-denominated?**
   - If USDC stays as USDC: simpler, but Carnage burns need USDC->token path
   - If USDC converts to SOL: unified Carnage fund, but adds conversion step
   - The futarchy spec implies separate denomination handling

3. **Jupiter review timeline: Is there urgency?**
   - Jupiter requires security review and traction demonstration
   - The off-chain SDK can be built immediately, but Jupiter team review adds unknown lead time
   - Start early to avoid blocking on their review cycle

4. **USDC pool liquidity source?**
   - SOL pools were seeded from bonding curve proceeds (500 SOL each)
   - USDC pools need a liquidity source -- protocol treasury? External LPs? Market making?
   - Architecture is ready regardless, but business decision needed

---

## Sources

- Codebase analysis: `programs/amm/src/`, `programs/tax-program/src/`, `programs/conversion-vault/src/`, `programs/transfer-hook/src/`
- [Jupiter AMM Interface](https://github.com/jup-ag/jupiter-amm-interface) -- Amm trait, Swap enum, integration pattern
- [Jupiter DEX Integration Docs](https://dev.jup.ag/docs/routing/dex-integration) -- Integration requirements and process
- [Jupiter AMM Interface DeepWiki](https://deepwiki.com/jup-ag/jupiter-amm-interface) -- Trait method details
- [Jupiter Ultra v3 Deep Dive](https://medium.com/@Scoper/solana-defi-deep-dives-jupiter-ultra-v3-next-gen-dex-aggregator-late-2025-2cef75c97301) -- Token-2022 support confirmation
- [Jupiter Ultra v3 Announcement](https://www.theblock.co/post/375184/solana-decentralized-exchange-aggregator-jupiter-unveils-ultra-v3-improved-trade-execution-mev-protections-gasless-support) -- Feature set
- `Docs/vault-convert-all-proposal.md` -- Detailed vault convert-all specification
- `Docs/FutureFutarchy.md` -- USDC pool architecture, tax parity requirements
- `Docs/cpi-interface-contract.md` -- CPI chain, PDA gates, account structures
- `Docs/account-layout-reference.md` -- PDA seeds, account sizes
- `Docs/architecture.md` -- System architecture, CPI depth analysis

### Confidence Levels

| Finding | Confidence | Reason |
|---------|------------|--------|
| Vault convert-all design | HIGH | Proposal doc is detailed and well-specified, codebase verified |
| Jupiter calls Tax Program not AMM | HIGH | AMM PDA gate verified in code (`seeds::program = TAX_PROGRAM_ID`) |
| Jupiter Token-2022 support | MEDIUM | Web search confirms Ultra v3 support, but transfer hook remaining_accounts forwarding through Jupiter router is unverified |
| USDC pools in same AMM | HIGH | AMM code is mint-agnostic (`infer_pool_type` accepts any combo), verified |
| Tax-USDC as separate program | HIGH | Tax Program SOL-wiring verified in code (system_instruction throughout), separation is architecturally clean |
| AMM authorized_callers approach | MEDIUM | Requires AMM upgrade to live program -- design is sound but implementation needs care |
| USDC tax-to-SOL off-chain conversion | MEDIUM | CPI depth prevents on-chain; off-chain path is standard but adds operational complexity |
| Whitelist needs for USDC pools | HIGH | Hook code verified: src OR dst must be whitelisted; 2 new Token-2022 vault entries needed |
| No whitelist needed for Jupiter | HIGH | Jupiter swaps go through pool vaults which are already whitelisted |
| Crank hardening isolation | HIGH | No on-chain changes, purely operational |
