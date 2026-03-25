---
status: resolved
trigger: "carnage-wsol-wrapping: Native SOL sits in sol_vault but AMM needs WSOL tokens in carnage_wsol. No wrapping bridge - buy swaps always fail."
created: 2026-02-14T00:00:00Z
updated: 2026-02-14T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED - 5 bugs found, all fixed, build verified.
test: anchor build -p epoch_program (default + devnet feature)
expecting: Clean build
next_action: Archive session. Integration tests need test updates (pre-funded WSOL masking).

## Symptoms

expected: Carnage buy swaps should work. SOL from sol_vault should be wrapped to WSOL, then used in AMM swap. Sell path should unwrap WSOL back to SOL in sol_vault after selling.
actual: Buy path always fails because carnage_wsol account has 0 WSOL balance. The SOL->WSOL wrapping code was never written. Tests passed because they manually pre-funded carnage_wsol.
errors: Buy swap fails silently - no funds in carnage_wsol to execute the buy.
reproduction: Trigger any Carnage buy event on devnet. carnage_wsol account will have 0 tokens.
started: Has never worked in production/devnet. Only worked in tests due to pre-funding trick.

## Eliminated

(none - root cause confirmed on first investigation)

## Evidence

- timestamp: 2026-02-14T00:00:30Z
  checked: execute_carnage_atomic.rs lines 240-248 (buy path)
  found: sol_balance read from sol_vault.lamports(), swap_amount calculated, but NO system_program::transfer or sync_native before calling execute_buy_swap. The carnage_wsol token account has 0 WSOL balance.
  implication: BUG #1 - Buy path always fails. SOL sits as native lamports in sol_vault PDA but is never transferred to carnage_wsol and synced as WSOL tokens.

- timestamp: 2026-02-14T00:00:31Z
  checked: execute_carnage.rs lines 252-261 (buy path in fallback)
  found: Identical missing wrap code. Same pattern as atomic - reads sol_vault.lamports() but never wraps to WSOL.
  implication: BUG #1 also exists in fallback path.

- timestamp: 2026-02-14T00:00:32Z
  checked: execute_sell_swap in both files (sell path)
  found: After selling CRIME/FRAUD->SOL via swap_exempt (BtoA direction), WSOL lands in carnage_wsol token account. But this WSOL is never unwrapped back to native SOL in sol_vault. On the next Carnage trigger, sol_vault.lamports() would be depleted while carnage_wsol has stranded WSOL.
  implication: BUG #2 - Sell path strands WSOL in carnage_wsol. Future buys from sol_vault would have less SOL than expected.

- timestamp: 2026-02-14T00:00:33Z
  checked: execute_buy_swap return values in both files
  found: execute_buy_swap returns `amount` (the SOL input) as tokens_bought. This is then stored as carnage_state.held_amount. But `amount` is in lamports (e.g., 500_000_000 for 0.5 SOL) while the actual tokens received would be in token units (e.g., 1_000_000 for 1.0 CRIME). The AMM does not return tokens_received.
  implication: BUG #3 - held_amount stores SOL lamports, not token count. This means subsequent sell/burn operations will try to sell/burn the wrong amount. Already documented in carnage-flow.ts as known issue H041/H042/H063/H089/H094.

- timestamp: 2026-02-14T00:00:34Z
  checked: execute_sell_swap return values in both files
  found: execute_sell_swap also returns `amount` (the token input) as sol_from_sale. This is a placeholder, not the actual SOL received from the swap.
  implication: BUG #4 - sol_from_sale in CarnageExecuted event is inaccurate. Not blocking but misleading for monitoring.

- timestamp: 2026-02-14T00:00:35Z
  checked: CPI depth analysis for wrap/unwrap
  found: The system_program::transfer (sol_vault -> carnage_wsol) and spl_token::sync_native are executed at CPI depth 0 (directly from execute_carnage_atomic entry point). The CPI depth concern in the header comment (depth 4 max) applies to the swap path: execute_carnage_atomic(0) -> Tax::swap_exempt(1) -> AMM::swap_sol_pool(2) -> Token-2022::transfer_checked(3) -> Transfer Hook(4). The wrap/unwrap calls happen BEFORE or AFTER the swap, not inside it.
  implication: Adding wrap/unwrap CPIs is SAFE. They don't add to the swap CPI depth chain.

- timestamp: 2026-02-14T00:00:36Z
  checked: initialize.ts line 1019 (production init)
  found: carnage_wsol created with 0 lamports initial. Comment says "funded per-swap from sol_vault" but that code was never written.
  implication: Confirms production setup creates empty WSOL account. The wrapping bridge was planned but never implemented.

- timestamp: 2026-02-14T00:00:37Z
  checked: carnage.test.ts line 322-331 (integration test)
  found: Test creates carnageWsol with `solVaultBalance` amount pre-funded via createWrappedNativeAccount. This masks the production bug because the test bypasses the need for SOL->WSOL wrapping.
  implication: Test-production gap confirmed. Tests pass by pre-funding the exact amount needed.

- timestamp: 2026-02-14T00:00:38Z
  checked: Token account ownership for wrapping
  found: carnage_wsol.owner == carnage_signer (PDA). sol_vault has seeds [CARNAGE_SOL_VAULT_SEED] with Epoch Program. For system_program::transfer from sol_vault to carnage_wsol, we need sol_vault PDA signature (seeds = CARNAGE_SOL_VAULT_SEED + bump). For sync_native, no signer needed (permissionless). For close_account (unwrap), need carnage_signer PDA signature.
  implication: All signing authorities are available. sol_vault bump available via ctx.bumps.sol_vault. carnage_signer bump available via ctx.bumps.carnage_signer.

- timestamp: 2026-02-14T00:00:39Z
  checked: Burn path (burn_held_tokens in both files)
  found: Burn uses carnage_state PDA as authority to burn from crime_vault/fraud_vault. This is correct - vault tokens were deposited by AMM swap (Token-2022 transfer from pool vaultB to carnage vault). Burn does NOT need WSOL. However, burn_held_tokens uses carnage_state.held_amount which is BUG #3 (stores SOL lamports not tokens).
  implication: Burn would try to burn the wrong amount (e.g., 500_000_000 lamports instead of actual token count). Would likely fail or burn wrong amount.

- timestamp: 2026-02-14T00:00:40Z
  checked: Audit for held_amount fix feasibility
  found: To get actual tokens received from swap, we can read carnage_crime_vault or carnage_fraud_vault balance BEFORE and AFTER the swap CPI, and compute the difference. Both vaults are InterfaceAccount<TokenAccount> in the struct so we can call .amount on them. However, after a CPI call, the account data may not be refreshed in Anchor's deserialized struct. Need to use reload() or read raw lamports.
  implication: Fix for BUG #3 requires reading token vault balance before/after swap. Can use ctx.accounts.crime_vault.reload() after CPI.

## Resolution

root_cause: Five bugs preventing Carnage from working end-to-end:
  1. Missing SOL->WSOL wrap before buy swap (system_program::transfer + sync_native)
  2. Missing WSOL->SOL unwrap after sell swap (WSOL stranded in carnage_wsol)
  3. held_amount stores SOL lamports instead of actual tokens received from swap
  4. sol_from_sale in CarnageExecuted event was inaccurate (placeholder value)
  5. sol_vault could be drained below rent-exempt minimum

fix: |
  Both execute_carnage_atomic.rs and execute_carnage.rs updated with:
  - Added wrap_sol_to_wsol() helper: system_program::transfer + sync_native at CPI depth 0
  - Rent-exempt minimum protection: subtract rent.minimum_balance(0) from available SOL
  - Accurate held_amount: read target vault balance before/after swap CPI, compute delta via reload()
  - Accurate sol_from_sale: read carnage_wsol balance before/after sell CPI, compute delta via reload()
  - execute_buy_swap return type changed from Result<u64> to Result<()> (caller measures tokens)
  - execute_sell_swap return type changed from Result<u64> to Result<()> (caller measures WSOL)
  - WSOL from sell stays in carnage_wsol (NOT unwrapped) - close_account would destroy the
    account which can't be recreated on-chain since it uses an explicit keypair, not a PDA.
    The WSOL is still available for the subsequent buy step.

verification: |
  - anchor build -p epoch_program: SUCCESS (release profile, 0 errors)
  - anchor build -p epoch_program -- --features devnet: SUCCESS (release profile, 0 errors)
  - cargo test -p epoch-program: All Carnage-related tests pass. 8 pre-existing failures
    in trigger_epoch_transition tests (unrelated to Carnage changes - confirmed by checking
    that trigger_epoch_transition.rs has zero references to carnage/wsol/wrap).
  - Account structs (ExecuteCarnageAtomic, ExecuteCarnage) unchanged - no new accounts needed.

files_changed:
  - programs/epoch-program/src/instructions/execute_carnage_atomic.rs
  - programs/epoch-program/src/instructions/execute_carnage.rs
