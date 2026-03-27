# Domain Pitfalls

**Domain:** Adding Jupiter integration, USDC pools, vault convert-all, and crank hardening to a live Solana DeFi protocol with Token-2022 transfer hooks
**Researched:** 2026-03-25
**Context:** Dr. Fraudsworth is LIVE ON MAINNET. All program upgrades go through Squads 2-of-3 multisig with 1hr timelock. CPI depth is maxed at 4. Three T22 tokens (CRIME, FRAUD, PROFIT) with whitelist-based transfer hooks.

---

## Critical Pitfalls

Mistakes that cause fund loss, broken swaps for live users, or require emergency upgrades.

### Pitfall 1: Instruction Signature Change Breaks Live Clients During Upgrade Window

**What goes wrong:** The vault convert-all proposal changes `convert(amount_in: u64)` to `convert(amount_in: u64, minimum_output: u64)`. This is a breaking instruction signature change -- Anchor discriminators stay the same (instruction name unchanged), but the deserialization expects 16 bytes of args instead of 8. During the window between program upgrade and client deploy, every existing vault convert call fails because the instruction data length does not match.

**Why it happens:** Anchor deserializes instruction args positionally. Adding a parameter changes the expected byte layout. Old clients send 8 bytes, new program expects 16. Deserialization fails with a confusing borsh error, not a clean custom error.

**Consequences:** All multi-hop swaps (SOL<->PROFIT) break for however long the gap lasts between program upgrade and client deploy. On mainnet with Squads timelock, the program upgrade has a 1hr delay, making coordination harder.

**Prevention:**
- Use a versioned instruction approach: add `convert_v2(amount_in: u64, minimum_output: u64)` as a NEW instruction alongside the existing `convert(amount_in: u64)`. Old clients continue working with `convert`. New clients use `convert_v2`.
- Alternatively, coordinate program + client deploy within a single maintenance window. Stop the crank, deploy program (wait for timelock), deploy client immediately after. But this still leaves a gap where users with cached frontend see failures.
- The `convert_v2` approach is strictly safer for a live protocol. Deprecate `convert` later once all clients have migrated.

**Detection:** Test the upgrade sequence on devnet first: deploy new program, verify old client calls still work, then deploy new client.

**Confidence:** HIGH -- verified from Formfunction's backwards-compatibility guide and project's own `upgrade-cascade.md` which explicitly documents this as Category B (MEDIUM RISK) breaking change.

**Phase:** Vault convert-all phase. Must be decided before implementation begins.

---

### Pitfall 2: USDC (SPL Token) + Token-2022 Mixed Pool Creates Wrong Transfer Path

**What goes wrong:** USDC on Solana is SPL Token (program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), not Token-2022. Creating a CRIME/USDC or FRAUD/USDC pool means one side is T22 (with transfer hook) and the other is SPL (no hook). The AMM already handles this pattern for SOL pools (MixedPool type), but the transfer helper functions hardcode which side gets hook accounts. If the USDC pool has the opposite canonical mint ordering from SOL pools, the transfer code could route USDC through `transfer_t22_checked` (which requires hook accounts and validates Token-2022 program ID) or route CRIME through `transfer_spl` (which strips hook accounts).

**Why it happens:** The AMM uses canonical mint ordering (`mint_a < mint_b` byte-wise). For SOL pools, NATIVE_MINT (0x06...) is always mint_a because it starts with a low byte. For USDC, the mint address `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` starts with 0x04... which is ALSO low, so USDC would likely be mint_a (SPL side). But this depends on the exact byte comparison with CRIME/FRAUD mints. If the ordering flips, the AMM's assumption about which side has hooks breaks.

**Consequences:** Swaps fail with `InvalidTokenProgram` or `AccountNotEnoughKeys` (hook error 3005). Or worse: if the wrong transfer function is called, the transfer hook is bypassed entirely, allowing unauthorized transfers.

**Prevention:**
- The AMM already stores `token_program_a` and `token_program_b` in PoolState and dispatches transfers based on these stored values, NOT hardcoded assumptions. Verify this is actually used in the swap instruction handler -- look at `swap_sol_pool.rs` to confirm it reads `pool.token_program_a/b` and routes accordingly.
- Write explicit test cases for USDC pool ordering: create a pool where mint_a is SPL and mint_b is T22, AND where mint_a is T22 and mint_b is SPL. Both orderings must work.
- The `is_reversed` pattern from Phase 52.1 (canonical mint ordering fix) applies here too. The client's `toPoolReserves()` must remap correctly for USDC pools.

**Detection:** Check `programs/amm/src/instructions/swap_sol_pool.rs` for hardcoded token program assumptions vs dynamic dispatch from PoolState.

**Confidence:** MEDIUM -- the AMM's PoolState stores token programs per side, which suggests dynamic dispatch exists, but the swap handler's actual dispatch logic has not been fully verified.

**Phase:** USDC pool pairs phase. Requires investigation before any pool creation code is written.

---

### Pitfall 3: Jupiter AMM Interface Cannot Make Network Calls -- Stale Hook Account Resolution

**What goes wrong:** Jupiter's AMM interface (`Amm` trait) explicitly forbids network calls: "We do not allow any network calls" during `quote()`, `update()`, or `get_swap_and_account_metas()`. The Dr. Fraudsworth protocol requires transfer hook extra accounts (ExtraAccountMetaList PDA, whitelist PDAs, hook program) to be included in every swap transaction. These accounts must be resolved from on-chain data. If the Jupiter SDK implementation tries to resolve hook accounts via RPC in `get_swap_and_account_metas()`, it will be rejected.

**Why it happens:** Standard AMMs only need pool vaults, mints, and authority accounts -- all derivable from seeds without network calls. Transfer hook accounts require reading the ExtraAccountMetaList PDA to know which additional accounts to include. For Dr. Fraudsworth's whitelist-based hooks, the extra accounts are deterministic (derivable from seeds), but Jupiter's interface may not have a pattern for including them.

**Consequences:** Jupiter either rejects the integration (SDK fails health check) or the generated swap transactions miss hook accounts, causing every routed swap to fail with `AccountNotEnoughKeys` (error 3005).

**Prevention:**
- Pre-compute all hook accounts in `from_keyed_account()` or `update()` (which receives account data, not network calls). The ExtraAccountMetaList PDA seeds are `["extra-account-metas", mint]` -- derivable without network access.
- The whitelist PDAs use seeds `["whitelist", token_account]` -- also derivable from the pool vault addresses stored in PoolState.
- Include hook accounts as additional `AccountMeta` entries in the `SwapAndAccountMetas` return value from `get_swap_and_account_metas()`.
- Use `has_dynamic_accounts() -> true` if the hook accounts depend on user wallet (they do -- whitelist PDAs are derived from source/destination token accounts).

**Detection:** Build the Jupiter SDK implementation on devnet, test with Jupiter's local routing engine, verify swap transactions include all hook accounts.

**Confidence:** MEDIUM -- Jupiter SDK documentation confirms no-network-call constraint, but exact pattern for T22 hook accounts in the Amm trait is not documented. Other T22 protocols must have solved this (Fluxbeam was integrated with T22 support in 2023). Needs deeper research into existing T22 Jupiter integrations.

**Phase:** Jupiter/aggregator SDK phase. Research existing T22 Jupiter integrations (Fluxbeam, BERN) before writing SDK.

---

### Pitfall 4: Jupiter Routes Through Tax Program, Not AMM Directly -- Account Count Explosion

**What goes wrong:** Dr. Fraudsworth's AMM is PDA-gated: only the Tax Program's `swap_authority` PDA can call `swap_sol_pool`. Jupiter cannot route through the AMM directly. Jupiter must route through the Tax Program's `swap_sol_buy` / `swap_sol_sell` instructions instead. But these instructions read EpochState for dynamic tax rates, distribute tax to 3 destinations (staking, carnage, treasury), and have different account requirements than a standard AMM swap. The Jupiter SDK's `get_swap_and_account_metas()` must return ALL of these accounts, not just pool accounts.

**Why it happens:** The protocol's CPI architecture intentionally prevents direct AMM access to enforce taxation. This is a security feature, not a bug. But it means Jupiter integration is fundamentally more complex than a standard AMM -- the "swap" from Jupiter's perspective is really a "taxed swap through an orchestrator program."

**Consequences:**
- If Jupiter routes through AMM directly: `ConstraintSeeds` error (swap_authority PDA check fails).
- If Jupiter routes through Tax Program but misses accounts: transaction fails with missing account errors.
- If tax distribution accounts (staking_escrow, carnage_vault, treasury) are wrong: SOL goes to wrong addresses or tx fails.
- The sell path already requires 23+ named accounts plus 8 remaining accounts (hook accounts). This exceeds Solana's base transaction limit and requires ALT. Jupiter may need to use the protocol's ALT or its own.

**Prevention:**
- The Jupiter SDK implementation must target the Tax Program as the swap program, not the AMM.
- `get_swap_and_account_metas()` must include: user wallet, WSOL intermediary, EpochState, pool accounts, staking_escrow, carnage_sol_vault, treasury, AMM program, Token-2022, SPL Token, System Program, AND hook accounts.
- Jupiter's `get_accounts_len()` should return an accurate count so the routing engine can estimate transaction feasibility.
- Verify the total account count fits within Solana's transaction size limit (1232 bytes). If not, the protocol's existing ALT must be included, or the SDK must declare that it requires an ALT via Jupiter's integration mechanisms.

**Detection:** Count accounts required for a Tax Program swap instruction. Compare against Solana's transaction limits. Test with Jupiter's routing engine.

**Confidence:** HIGH -- this is architecturally certain from the CPI interface contract. The Tax Program is the only valid entry point for taxed swaps.

**Phase:** Jupiter/aggregator SDK phase. This is the single hardest integration challenge.

---

### Pitfall 5: Whitelist Expansion for USDC Pools and Jupiter Creates Security Surface

**What goes wrong:** Adding USDC pools requires whitelisting new token accounts (USDC pool vaults for CRIME/FRAUD side). Adding Jupiter integration may require whitelisting Jupiter's intermediate token accounts or routing program accounts. Each new whitelist entry expands the set of addresses that can send/receive CRIME, FRAUD, and PROFIT without restriction. A mistakenly whitelisted address could allow unauthorized token transfers, bypassing the transfer hook's protection.

**Why it happens:** The transfer hook allows transfers where EITHER source OR destination is whitelisted. Whitelisting an address that an attacker can control (or that has a different security model) creates a bridge for unauthorized transfers.

**Consequences:** If Jupiter's program-owned accounts are whitelisted and Jupiter has a vulnerability (or if the wrong account is whitelisted), tokens could be transferred outside the protocol's intended flow. This is a permanent security expansion -- whitelist entries cannot be removed (only the authority can add, and authority transfer to Squads means additions require multisig approval).

**Prevention:**
- USDC pool vaults: These are PDAs owned by the AMM program. Safe to whitelist -- same pattern as existing SOL pool vaults.
- Jupiter routing accounts: Do NOT whitelist Jupiter's program accounts. Instead, ensure Jupiter routes through the Tax Program, which already has whitelisted pool vaults as source/destination. The Tax Program's CPI to AMM uses pool vaults that are already whitelisted.
- User ATAs: Users need ATAs for USDC (SPL Token). These do NOT need whitelisting because USDC has no transfer hook. Only CRIME/FRAUD/PROFIT ATAs need whitelist consideration, and user ATAs for these tokens are already handled by the existing whitelist pattern (the pool vault is whitelisted, so transfers from pool vault to any user ATA work).
- Audit every new whitelist entry: document why it is needed, what program owns it, whether an attacker could control it.

**Detection:** Before adding any whitelist entry, verify: (1) the address is a PDA with known seeds, (2) the owning program is trusted, (3) no user can directly control the account's token transfers.

**Confidence:** HIGH -- the whitelist security model is well-documented in the transfer hook spec.

**Phase:** USDC pool pairs phase AND Jupiter phase. Each must audit whitelist additions independently.

---

### Pitfall 6: Vault Convert-All Sentinel (amount_in=0) Interacts Badly with Token-2022 Transfer Hooks

**What goes wrong:** The convert-all proposal uses `amount_in == 0` as a sentinel to trigger "read user balance and convert all." But Token-2022's `transfer_checked` with amount=0 is rejected by the transfer hook program's own `ZeroAmountTransfer` check. If the vault reads a user balance of 0 (e.g., previous AMM step failed silently, or user has no tokens), the vault would attempt a `transfer_checked` with amount=0, which the hook rejects with error 6001.

**Why it happens:** The sentinel value (0) has a dual meaning: "convert all" for the vault instruction args, and "invalid transfer" for the transfer hook. The vault's `ZeroAmount` guard should catch this before reaching the transfer, but only if the guard checks the resolved effective_amount, not the original amount_in.

**Consequences:** Confusing error (hook error 6001 instead of vault error) if the guard is ordered wrong. But no fund loss -- the transaction just fails.

**Prevention:**
- The convert-all implementation MUST check `effective_amount > 0` (the resolved balance) BEFORE attempting any transfer. The proposal already shows this: `require!(balance > 0, VaultError::ZeroAmount)`. This is correct.
- Additionally, the `compute_output` function already rejects amounts that produce zero output (dust check). This is a second safety net.
- Write explicit test: call convert with `amount_in=0` when user balance is 0. Expect `VaultError::ZeroAmount`, NOT `TransferHookError::ZeroAmountTransfer`.

**Detection:** Unit test with zero balance + sentinel value.

**Confidence:** HIGH -- the proposal document already addresses this edge case correctly.

**Phase:** Vault convert-all phase. Include in test plan.

---

## Moderate Pitfalls

Mistakes that cause delays, failed deployments, or technical debt.

### Pitfall 7: CPI Depth Ceiling Prevents Adding Any New Intermediate CPI to Swap Path

**What goes wrong:** The protocol's deepest CPI chain is already at Solana's maximum (depth 4): `Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook`. If any NEW intermediate CPI is added to the swap path (e.g., a USDC wrapper, oracle price feed, additional validation step, or Jupiter wrapper program), it will exceed depth 4 and fail with a runtime error.

**Good news:** USDC is SPL Token (no transfer hook), so the USDC side of a mixed pool swap does NOT consume the hook CPI level. The USDC pool Carnage path would be: `Epoch -> Tax -> AMM -> Token-2022 (T22 side) -> Transfer Hook` = depth 4 (same as today). Safe.

**Prevention:**
- Do NOT add any new CPI calls to the swap path. The depth ceiling is permanent.
- USDC pools use the same Tax -> AMM -> Token-2022 path. No new depth required.
- If Jupiter integration requires a wrapper program, it CANNOT be in the CPI chain. Jupiter must call the Tax Program directly (depth 0 from Jupiter's perspective).

**Confidence:** HIGH -- CPI depth 4 is a hard Solana runtime limit, documented in architecture.md.

**Phase:** USDC pool pairs phase AND Jupiter phase. Architectural constraint to validate early.

---

### Pitfall 8: Switchboard VRF Gateway Rotation Does Not Work -- Mainnet May Have Same Issue

**What goes wrong:** On devnet, each Switchboard randomness account is assigned to a specific oracle. Attempting to use an alternative gateway serves a different oracle whose signature fails on-chain (error 0x1780). The project already knows this and works around it by only retrying the default gateway, with timeout recovery creating fresh randomness (which may get assigned to a different, working oracle).

The risk: if the assigned mainnet oracle goes down, the same issue occurs. VRF timeout recovery works (300 slots wait, fresh randomness, retry), but during that window (~2 minutes), no epoch can advance, no tax rates update, no Carnage executes.

**Prevention:**
- The crank already implements timeout recovery with fresh randomness. This is the correct approach.
- For crank hardening: add monitoring/alerting when VRF timeout recovery triggers. Track frequency of timeouts to detect oracle degradation.
- Consider pre-creating a pool of randomness accounts so the crank can immediately switch to a fresh one when timeout occurs, rather than waiting 300 slots.
- Mainnet Switchboard may have better oracle availability than devnet. Validate this assumption during early mainnet operation.

**Detection:** Crank logs should distinguish between normal VRF reveal and timeout recovery. Sentry alerts on consecutive timeout recoveries.

**Confidence:** HIGH -- documented in project memory. Devnet behavior confirmed. Mainnet behavior is an assumption that needs validation.

**Phase:** Crank hardening phase.

---

### Pitfall 9: Upgrade of Live Programs Requires Stopping the Crank -- Epoch Timing Risk

**What goes wrong:** The upgrade cascade doc says "stop the crank runner" before upgrading. But if the crank stops mid-epoch (after VRF commit but before reveal), the VRF commitment may expire. If the crank stops during Carnage execution (between sell and buy legs), the Carnage state machine may be in an intermediate state.

**Consequences:** After restart, the crank must handle stale VRF state (timeout recovery) and potentially incomplete Carnage execution (fallback path). These are handled by existing logic, but only if the crank is written to detect and recover from these states on startup.

**Prevention:**
- Time the maintenance window to start immediately AFTER an epoch completes (Carnage done, new epoch started, before VRF commit).
- The crank should have a "drain" mode: finish current epoch, then pause before starting the next VRF commit.
- After program upgrade, the crank's first action should be a state check: read EpochState, verify VRF status, and handle any stale state before resuming normal operation.

**Detection:** Add a `/health` or status endpoint to the crank that reports current epoch phase. Use this to time maintenance windows.

**Confidence:** HIGH -- the upgrade cascade doc already documents this requirement.

**Phase:** Crank hardening phase. Build drain mode before any program upgrades.

---

### Pitfall 10: Jupiter SDK Must Handle Dynamic Tax Rates from EpochState

**What goes wrong:** Jupiter's `quote()` function must return accurate pricing. Dr. Fraudsworth's tax rates change every epoch (VRF-derived, 100-400 bps buy / 1100-1400 bps sell). If the Jupiter SDK caches tax rates from `update()` but the epoch flips between quote and execution, the actual tax will differ from the quoted amount.

**Consequences:** Users see a different price than quoted. If actual tax is higher than quoted, the slippage check may fail, causing the transaction to revert. Jupiter may deprioritize the route if it frequently fails.

**Prevention:**
- In `update()`, read the current EpochState and cache tax rates.
- In `quote()`, apply cached tax rates to the swap math.
- Accept that quotes are approximate -- this is inherent to any dynamic-fee DEX. Jupiter handles this via slippage settings.
- Set `supports_exact_out() -> false` if exact output cannot be guaranteed due to dynamic taxes.
- Document the tax rate variability so Jupiter can flag it in their UI.

**Detection:** Monitor Jupiter route success rate after integration. High failure rate indicates stale tax rate caching.

**Confidence:** MEDIUM -- Jupiter handles dynamic fees for other protocols (e.g., Orca concentrated liquidity has variable fees), but the magnitude of Dr. Fraudsworth's tax variation (100-1400 bps) is larger than typical.

**Phase:** Jupiter/aggregator SDK phase.

---

### Pitfall 11: USDC Pool Pair Requires New Tax Program Instructions or Parallel Program Stack

**What goes wrong:** The Tax Program currently has `swap_sol_buy` and `swap_sol_sell` which are specific to SOL-paired pools. They handle WSOL wrapping/unwrapping, native SOL transfers for tax distribution, and SOL-denominated slippage. USDC pools would need analogous `swap_usdc_buy` and `swap_usdc_sell` instructions that handle USDC transfers instead of SOL, or a generalized instruction that handles any quote token.

**Why it happens:** The Tax Program was designed specifically for SOL as the quote asset. Tax distribution (71/24/5) transfers SOL via `system_program::transfer`. For USDC pools, tax would need to be collected in USDC and either distributed as USDC or converted to SOL first.

**Consequences:** Either the Tax Program needs new instructions (code duplication, more attack surface) or a refactor to generalize quote-asset handling (risky change to a live program).

**Prevention:**
- Design USDC pool tax flow before writing code. Key decision: are taxes collected in USDC or converted to SOL? If USDC, the staking escrow needs to handle USDC rewards alongside SOL rewards. If converted, an additional swap step is needed (which may hit CPI depth limits).
- Consider a parallel Tax Program for USDC pools rather than modifying the existing one. This isolates risk -- existing SOL pool swaps are unaffected.
- The memory note says "Parallel program stack, same PROFIT stakers" -- this suggests the intended design is a separate program stack for USDC pools.

**Detection:** Map the full USDC swap flow (buy and sell) through all CPI layers before writing code. Identify every point where SOL-specific logic exists.

**Confidence:** HIGH -- Tax Program source confirms SOL-specific logic throughout.

**Phase:** USDC pool pairs phase. Architecture decision needed before implementation.

---

## Minor Pitfalls

Mistakes that cause annoyance or minor delays but are fixable.

### Pitfall 12: Jupiter AMM Interface Requires Rust SDK -- TypeScript Frontend Code Cannot Be Reused

**What goes wrong:** The Jupiter AMM interface (`jupiter-amm-interface` crate) is a Rust trait. The project's swap math, route engine, and account resolution logic is in TypeScript (`app/lib/swap/`). None of this can be reused for the Jupiter SDK. The swap math must be reimplemented in Rust, matching the on-chain logic exactly.

**Prevention:** Base the Rust SDK's swap math on the on-chain program source (Rust), not the TypeScript frontend (which may have approximations). Use the AMM's `compute_output` and Tax Program's tax calculation as the canonical source.

**Phase:** Jupiter/aggregator SDK phase.

---

### Pitfall 13: Address Lookup Table Must Be Updated for USDC Pool Accounts

**What goes wrong:** The protocol uses an ALT with 55 addresses for large transactions (sell path, Carnage). Adding USDC pools introduces new accounts (pool PDA, vault PDAs, USDC mint, USDC token program). These must be added to the ALT or a new ALT created. If the ALT is not updated, USDC pool transactions that exceed the base transaction size limit will fail.

**Prevention:** Extend the existing ALT with USDC pool addresses before deploying USDC pool functionality. The ALT update is a client-side operation, no program changes needed.

**Phase:** USDC pool pairs phase.

---

### Pitfall 14: Crank Hardening Must Not Change Epoch Program Instruction Signatures

**What goes wrong:** Crank hardening improvements (better retry logic, health monitoring, rent reclaim optimization) are off-chain changes. But if any crank improvement requires an on-chain change to the Epoch Program (e.g., new instruction for batch operations, modified bounty logic), it triggers the full upgrade cascade with Squads timelock and CPI dependency verification.

**Prevention:** Keep crank hardening strictly off-chain wherever possible. The existing permissionless instruction set (trigger_epoch, commit_randomness, reveal_randomness, consume_randomness, execute_carnage_atomic/fallback) should be sufficient for all crank improvements.

**Phase:** Crank hardening phase. Verify all improvements are off-chain before starting.

---

### Pitfall 15: USDC Has 6 Decimals, Not 9 -- Slippage and Display Math Differences

**What goes wrong:** SOL and all three protocol tokens use 9 decimals. USDC uses 6 decimals. Any hardcoded `10^9` divisor in the frontend, swap math, or display logic will produce wrong values for USDC amounts (off by 1000x). The AMM's on-chain math works with raw amounts (u64) and is decimal-agnostic, but the frontend and Jupiter SDK quote math must handle the decimal mismatch.

**Prevention:** Parameterize decimal handling everywhere. Never hardcode `10^9`. Read decimals from mint account data.

**Phase:** USDC pool pairs phase. Easy to miss, easy to fix.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Vault convert-all | Instruction signature breaking change (P1) | Use `convert_v2` instruction, not modified `convert` |
| Vault convert-all | Sentinel value + zero balance (P6) | Guard effective_amount > 0 before transfer |
| Jupiter SDK | Tax Program as entry point, not AMM (P4) | SDK targets Tax Program instructions |
| Jupiter SDK | No network calls in Amm trait (P3) | Pre-compute hook accounts from seeds |
| Jupiter SDK | Dynamic tax rates stale between quote and execution (P10) | Cache in update(), accept approximation |
| Jupiter SDK | Rust reimplementation needed (P12) | Base on on-chain Rust, not TS frontend |
| USDC pools | Mixed SPL/T22 transfer routing (P2) | Verify AMM's dynamic dispatch from PoolState |
| USDC pools | Tax Program SOL-specific logic (P11) | Decide: parallel program stack vs generalize |
| USDC pools | Whitelist security expansion (P5) | Audit every new entry, only PDA-owned accounts |
| USDC pools | ALT update needed (P13) | Extend ALT before pool deployment |
| USDC pools | Decimal mismatch (P15) | Parameterize decimal handling |
| Crank hardening | VRF gateway rotation (P8) | Implement monitoring, pre-create randomness pool |
| Crank hardening | Upgrade window timing (P9) | Build drain mode, time after epoch completion |
| Crank hardening | Keep changes off-chain (P14) | Verify no on-chain changes needed |
| ALL program upgrades | CPI depth ceiling (P7) | No new CPI calls in swap path |

---

## Sources

- [Jupiter DEX Integration Guide](https://dev.jup.ag/docs/routing/dex-integration) -- AMM trait requirements, no-network-call constraint, security requirements (HIGH confidence)
- [Jupiter AMM Interface Repository](https://github.com/jup-ag/jupiter-amm-interface) -- Rust SDK trait definition, Swap enum (HIGH confidence)
- [Jupiter Token-2022 Support Discussion (Archived)](https://discuss.jup.ag/t/archived-jupiter-token-2022-support/21711) -- T22 support status, Fluxbeam integration history (MEDIUM confidence)
- [Formfunction: Backwards Compatible Solana Program Changes](https://formfunction.medium.com/how-to-make-backwards-compatible-changes-to-a-solana-program-45015dd8ff82) -- Adding args is NOT backwards compatible, use versioned instructions (HIGH confidence)
- [Helius: Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security) -- Program upgrade security patterns (HIGH confidence)
- [Solana Token Extensions: Transfer Hook](https://solana.com/developers/guides/token-extensions/transfer-hook) -- ExtraAccountMetaList resolution, hook account ordering (HIGH confidence)
- Project internal: `Docs/upgrade-cascade.md` -- CPI dependency graph, breaking change categories, safe upgrade order (HIGH confidence)
- Project internal: `Docs/vault-convert-all-proposal.md` -- Convert-all design, sentinel value, edge cases (HIGH confidence)
- Project internal: `Docs/transfer-hook-spec.md` -- Whitelist security model, 4 accounts per mint (HIGH confidence)
- Project internal: `Docs/architecture.md` -- CPI depth ceiling at 4, program interaction map (HIGH confidence)
- Project internal: `Docs/cpi-interface-contract.md` -- All CPI call sites, discriminators (HIGH confidence)
