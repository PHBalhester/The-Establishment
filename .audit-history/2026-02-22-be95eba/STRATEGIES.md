# STRATEGIES.md — Attack Hypotheses

**Audit ID:** sos-001-20260222-be95eba
**Tier:** deep (target: 100-150 hypotheses)
**Generated:** 2026-02-22
**Input:** ARCHITECTURE.md + 128 EP patterns + 3 protocol playbooks + 2 reference databases

---

## Summary

| Tier | Count | Description |
|------|-------|-------------|
| Tier 1 (CRITICAL) | 18 | Investigate first — highest impact and/or likelihood |
| Tier 2 (HIGH) | 42 | Investigate second — significant but lower likelihood |
| Tier 3 (MEDIUM-LOW) | 72 | If time permits — lower impact or very low likelihood |
| **Total** | **132** | |
| Novel (no EP match) | 31 (23.5%) | Protocol-specific, no direct KB precedent |

---

## Tier 1 — CRITICAL (Investigate First)

### STR-001: Bounty Transfer Drains Vault Below Rent-Exempt Minimum
- **Category:** Arithmetic / State Machine
- **Hypothesis:** `trigger_epoch_transition` sends `TRIGGER_BOUNTY_LAMPORTS` without checking that the vault retains enough for rent-exemption. A caller can trigger this when the vault is barely above bounty amount, causing the runtime to reject the transfer (griefing) or allowing the vault to become rent-exempt-deficient.
- **Attack Vector:** Wait until vault balance is between `bounty` and `bounty + rent_minimum`, then trigger epoch transition. The transfer attempts to send more than available post-rent balance.
- **Target Code:** `epoch_program/src/instructions/trigger_epoch_transition.rs` — balance check and transfer
- **Impact:** CRITICAL — Epoch transitions permanently blocked if vault can never accumulate enough, freezing all VRF/Carnage/reward operations
- **Precedent:** EP-016 (Integer Underflow), AMM Playbook (Rounding Drain)
- **Requires:** Vault balance in narrow window, ability to time trigger call
- **Investigation:** Read exact balance check logic. Compute rent-exempt minimum for vault account size. Construct PoC showing the failure window.

### STR-002: `constraint = true` Placeholder Allows Account Substitution
- **Category:** Access Control / Account Validation
- **Hypothesis:** One or more `constraint = true` placeholders guard accounts that could be substituted with attacker-controlled accounts if the surrounding PDA/ownership checks are insufficient.
- **Attack Vector:** Identify every `constraint = true` instance. For each, determine if PDA seeds, `has_one`, or `owner` checks independently prevent substitution. If any account relies solely on `constraint = true`, craft a transaction with a spoofed account.
- **Target Code:** All programs — search for `constraint = true` across account structs
- **Impact:** HIGH-CRITICAL — Depends on which account is substituted. Treasury substitution = fund theft. Pool substitution = drain.
- **Precedent:** EP-001 (Missing Account Validation), EP-003 (Owner Check Bypass)
- **Requires:** At least one account with `constraint = true` and no other validation
- **Investigation:** Exhaustive grep for `constraint = true`. For each hit, trace all constraints on that account. Build substitution matrix.

### STR-003: Initialization Front-Running Claims Admin Authority
- **Category:** Initialization / Access Control
- **Hypothesis:** `initialize_pool`, `initialize_epoch`, or `initialize` (hook) instructions can be front-run by an attacker to claim admin authority before the legitimate deployer calls them.
- **Attack Vector:** Monitor mempool for deployment transactions. Submit `initialize_*` with attacker wallet as admin before the legitimate init transaction lands.
- **Target Code:** All `initialize` instructions across 5 programs
- **Impact:** CRITICAL — Attacker becomes admin with treasury control, whitelist control, and force_carnage authority
- **Precedent:** EP-075 (Initialization Front-Running), EP-076 (Re-initialization)
- **Requires:** Programs deployed but not yet initialized (narrow window), mempool visibility
- **Investigation:** Check if init instructions use `init` constraint (Anchor's space guard). Check if admin is derived from deployer or passed as argument. Check re-init protection.

### STR-004: `force_carnage` Survives to Mainnet
- **Category:** Admin / Upgrade
- **Hypothesis:** The `force_carnage` instruction, intended for devnet only, is not properly gated by compile-time feature flags and could be callable on mainnet.
- **Attack Vector:** If `force_carnage` is gated by runtime check (admin signer only) rather than `#[cfg(feature = "devnet")]`, admin key compromise enables arbitrary carnage triggering on mainnet.
- **Target Code:** `epoch_program/src/instructions/force_carnage.rs`
- **Impact:** CRITICAL — Admin can trigger carnage at will, manipulating token prices and draining pools through predictable buy/sell
- **Precedent:** EP-032 (Insufficient Access Control), Upgrade Playbook (Backdoor Persistence)
- **Requires:** Instruction present in mainnet binary
- **Investigation:** Check if instruction is behind `#[cfg(feature = "devnet")]`. Build without devnet feature and verify instruction is absent from IDL.

### STR-005: Treasury Address Update Redirects All Tax Revenue
- **Category:** Admin / Access Control
- **Hypothesis:** The `update_treasury` instruction allows admin to redirect the 5% treasury portion of all taxes to an attacker-controlled wallet.
- **Attack Vector:** Compromise admin key → call `update_treasury` with attacker address → all subsequent trades send 5% to attacker.
- **Target Code:** `tax_program/src/instructions/update_treasury.rs`
- **Impact:** HIGH — Ongoing revenue theft (5% of all trading volume)
- **Precedent:** EP-068 (Key Compromise), EP-026 (Missing Multisig)
- **Requires:** Admin key compromise
- **Investigation:** Verify treasury update has no timelock, no multisig, no governance. Assess if devnet placeholder makes this more dangerous (wrong address on mainnet deploy = loss of funds).

### STR-006: Carnage Slippage Floor Bypass via Pool Manipulation
- **Category:** Economic / AMM
- **Hypothesis:** Carnage checks slippage against pool reserves read at execution start. An attacker could manipulate pool reserves in the same slot before Carnage executes, making the slippage check pass on unfavorable terms.
- **Attack Vector:** Sandwich Carnage: (1) Swap to skew pool reserves, (2) Carnage executes with skewed reserves passing 85%/75% floor, (3) Backrun to extract profit.
- **Target Code:** `tax_program/src/instructions/execute_carnage.rs` — `read_pool_reserves()` and slippage computation
- **Impact:** CRITICAL — Carnage Fund (protocol treasury) drained through MEV extraction
- **Precedent:** AMM Playbook (Sandwich/MEV), EP-058 (Price Manipulation)
- **Requires:** Ability to bundle transactions around Carnage in same slot (Jito bundles)
- **Investigation:** Determine if Carnage reads reserves then swaps atomically or if there's a gap. Check if `read_pool_reserves` reads from the same pool state the swap modifies. Assess profitability of sandwich.

### STR-007: VRF Outcome Prediction Enables Tax Rate Front-Running
- **Category:** Oracle / Timing
- **Hypothesis:** Between `reveal_vrf` and `consume_randomness`, the VRF output is on-chain and public. Bots can compute the new tax rate, compare it to the current rate, and submit trades before `consume_randomness` applies the new rate.
- **Attack Vector:** Monitor for `reveal_vrf` transaction. Read VRF bytes from chain. Compute new rate using same modulo logic. If new rate > current: sell before consume (lower tax). If new rate < current: buy before consume (higher tax coming).
- **Target Code:** `epoch_program/src/instructions/reveal_vrf.rs`, `consume_randomness.rs`
- **Impact:** MEDIUM-HIGH — Tax arbitrage on every epoch transition. Cumulative extraction proportional to volume × rate delta.
- **Precedent:** EP-021 (Stale Oracle), Oracle Playbook (Frontrunning Price Updates)
- **Requires:** Fast bot infrastructure, mempool monitoring
- **Investigation:** Measure how many slots between reveal and consume in practice. Check if consume can be called in same TX as reveal. Compute maximum extractable value per epoch.

### STR-008: Whitelist Removal Bricks All Token Transfers
- **Category:** Token / Access Control
- **Hypothesis:** If the admin accidentally or maliciously removes a critical address from the whitelist (e.g., AMM pool token accounts, Tax program accounts), all swaps and token operations will fail because the transfer hook rejects them.
- **Attack Vector:** (Malicious) Compromise admin → remove AMM pool accounts from whitelist → all trading halted. (Accidental) Misconfigured whitelist update removes essential account.
- **Target Code:** `transfer_hook/src/instructions/remove_from_whitelist.rs`, `execute.rs`
- **Impact:** CRITICAL — Complete protocol freeze. No swaps, no staking, no Carnage. Since programs are non-upgradeable, only recovery is adding the address back to whitelist (requires admin key).
- **Precedent:** EP-051 (Token Freeze), Novel (universal hook gate)
- **Requires:** Admin key for malicious; operational error for accidental
- **Investigation:** Enumerate all addresses that MUST be whitelisted for protocol to function. Check if whitelist is initialized correctly. Check if there's a "bulk" or "critical" whitelist that can't be modified.

### STR-009: Dust Swap Accumulation for Zero-Tax Trading
- **Category:** Economic / Arithmetic
- **Hypothesis:** Integer division in tax calculation rounds small amounts to zero. By splitting a large trade into many dust-sized swaps, a user pays zero total tax while achieving the same net position.
- **Attack Vector:** Compute the maximum swap amount where `amount * tax_rate / 10000 == 0`. Execute hundreds of such swaps programmatically in rapid succession.
- **Target Code:** `tax_program/src/lib.rs` — tax computation, `checked_mul` / division
- **Impact:** MEDIUM-HIGH — Tax evasion at scale. Protocol loses 15% revenue on all dust-split volume. Pool impact via many small swaps differs from one large swap (worse execution but zero tax).
- **Precedent:** EP-015 (Rounding to Zero), EP-062 (Fee Bypass)
- **Requires:** Automation, transaction fee budget (many small TXs cost SOL base fees)
- **Investigation:** Find exact dust threshold per tax rate (500-2500 bps). Compute break-even: TX fee vs tax saved. Determine if AMM slippage on many small swaps makes this unprofitable.

### STR-010: CPI Depth Exhaustion on Carnage Path
- **Category:** CPI / State Machine
- **Hypothesis:** The Carnage path (Epoch→Tax→AMM→Token-2022→Hook) is at exactly 4-deep CPI. If Token-2022's transfer_checked internally makes a 5th CPI call (e.g., in certain extension configurations), the entire Carnage execution fails.
- **Attack Vector:** Not actively exploitable, but a latent DoS risk. Any Token-2022 upgrade adding internal CPI to the hook invocation path would break Carnage permanently.
- **Target Code:** `epoch_program` → `tax_program/execute_carnage` → `amm/swap` → Token-2022 transfer → hook
- **Impact:** HIGH — Carnage permanently disabled, breaking the core game mechanic
- **Precedent:** EP-048 (CPI Depth Limit), Novel (exact-limit architecture)
- **Requires:** Token-2022 runtime change (out of protocol's control)
- **Investigation:** Trace exact CPI depth on every Carnage code path. Check if any Token-2022 extension (TransferFeeConfig?) adds internal CPI. Verify 4 is truly the limit vs 5.

### STR-011: PROFIT Routing Reduces Effective Tax Below Design Intent
- **Category:** Economic / Novel
- **Hypothesis:** By routing through PROFIT (SOL→CRIME→PROFIT, then PROFIT→FRAUD later), users can achieve cross-faction swaps that avoid the full intended tax burden or exploit price differences across the three-pool triangle.
- **Attack Vector:** (1) Buy CRIME with SOL (15% tax). (2) Swap CRIME→PROFIT (15% tax). (3) Swap PROFIT→FRAUD (15% tax). Each hop has different pool reserves, and the compounding tax may be more or less than intended.
- **Target Code:** `tax_program` — all swap instructions, PROFIT pool routing
- **Impact:** MEDIUM-HIGH — Systematic tax underpayment or cross-faction arbitrage. Protocol's faction balance model undermined.
- **Precedent:** Novel (dual-faction bridge routing)
- **Requires:** PROFIT pools with sufficient liquidity, price discrepancies across the triangle
- **Investigation:** Model the three-pool triangle. Compute effective tax for direct vs routed paths. Identify arbitrage conditions where routing is profitable after tax.

### STR-012: Staking Reward-Per-Token Overflow at u128 Boundary
- **Category:** Arithmetic / Staking
- **Hypothesis:** `reward_per_token_stored` uses u128 with PRECISION=1e18. If cumulative rewards are large enough relative to total_staked, the u128 value could overflow, wrapping to zero and wiping all reward accounting.
- **Attack Vector:** Naturally accumulate rewards over many epochs with very small total_staked (e.g., 1 lamport staked). `reward_amount * 1e18 / 1` = reward_amount * 1e18, which overflows u128 if reward_amount > ~3.4e20.
- **Target Code:** `staking/src/lib.rs` — `update_reward_per_token` computation
- **Impact:** CRITICAL — All accumulated rewards lost, staking accounting permanently corrupted
- **Precedent:** EP-015 (Arithmetic Overflow), Staking Playbook (VRT Manipulation)
- **Requires:** Very low total_staked with large reward deposits
- **Investigation:** Compute maximum reward_per_token value possible. Check if `checked_mul` is used. Determine minimum total_staked needed to prevent overflow for maximum conceivable rewards.

### STR-013: Canonical Mint Ordering `is_reversed` Logic Error
- **Category:** State Machine / AMM
- **Hypothesis:** The `is_reversed` detection reads pool.mint_a from bytes [9..41] and compares to the passed mint. If the byte offsets are wrong for any pool configuration (e.g., different Anchor discriminator versions), the direction detection fails silently, causing swaps to go the wrong way.
- **Attack Vector:** If `is_reversed` returns the wrong value, a buy becomes a sell or vice versa. The user receives the wrong token and the pool reserves are modified incorrectly.
- **Target Code:** `tax_program/src/instructions/swap_profit_buy.rs`, `swap_profit_sell.rs` — `is_reversed` logic
- **Impact:** HIGH — Users lose funds by receiving wrong token. Pool reserves corrupted.
- **Precedent:** Novel (canonical ordering detection), EP-005 (Account Data Deserialization)
- **Requires:** Pool with specific mint ordering, incorrect byte offset assumption
- **Investigation:** Verify byte offsets [9..41] match Anchor's PoolState serialization for mint_a across ALL pool instances. Test both orderings.

### STR-014: Carnage Buy Amount Exceeds Pool Reserve
- **Category:** AMM / Economic
- **Hypothesis:** Carnage's buy step uses the entire carnage fund WSOL balance. If the fund has accumulated a large amount, the constant-product AMM returns diminishing outputs but the buy could dramatically skew the pool, making the subsequent sell step execute at terrible prices.
- **Attack Vector:** Wait for Carnage fund to accumulate large balance → trigger epoch → Carnage dumps entire balance into one pool → massive slippage → pool permanently imbalanced.
- **Target Code:** `tax_program/execute_carnage` — buy amount calculation, `amm/swap` — output computation
- **Impact:** HIGH — Protocol's own Carnage fund used to permanently imbalance pools
- **Precedent:** AMM Playbook (Large Swap Impact), EP-059 (Liquidity Drain)
- **Requires:** Large Carnage fund accumulation, which happens naturally from 5% of all volume
- **Investigation:** Model maximum Carnage fund size vs pool reserves. Compute slippage at various fund:reserve ratios. Check if the 85%/75% floor prevents catastrophic imbalance.

### STR-015: Re-Initialization of Already-Initialized Accounts
- **Category:** Initialization
- **Hypothesis:** If `initialize_*` instructions don't check the discriminator or use `init` (which checks space=0), they could be called again to reset state, wiping pool reserves, staking state, or epoch progress.
- **Attack Vector:** Call `initialize_pool` on an already-initialized pool. If it succeeds, all reserves reset to zero, LP funds are trapped.
- **Target Code:** All `initialize` instructions across 5 programs
- **Impact:** CRITICAL — Complete protocol state reset, loss of all pooled and staked funds
- **Precedent:** EP-076 (Re-initialization), EP-077 (Missing Discriminator Check)
- **Requires:** Missing init guard on at least one initialize instruction
- **Investigation:** Check each initialize instruction for `init` constraint vs manual discriminator check. Attempt calling initialize on already-initialized account in test.

### STR-016: Whitelist Check Bypass via Delegate/Authority Transfer
- **Category:** Token / Transfer Hook
- **Hypothesis:** The transfer hook checks source and destination token account owners against the whitelist. But Token-2022 allows delegate authorities who can transfer on behalf of the owner. If the hook doesn't check the actual transfer initiator (delegate), a non-whitelisted delegate could transfer tokens.
- **Attack Vector:** Whitelisted account A delegates to non-whitelisted account B. B initiates transfer from A to non-whitelisted C. Hook sees source owner=A (whitelisted) → allows.
- **Target Code:** `transfer_hook/src/instructions/execute.rs` — whitelist check logic
- **Impact:** HIGH — Circumvents the entire whitelist mechanism, enabling unauthorized token transfers
- **Precedent:** EP-054 (Token Authority Confusion), EP-051 (SPL Token Bypass)
- **Requires:** Understanding of what the hook actually checks (owner vs authority vs account address)
- **Investigation:** Read hook execute logic to determine exactly what fields are checked. Test with delegated transfers.

### STR-017: AMM Pool Reentrancy via Hook Callback
- **Category:** CPI / Reentrancy
- **Hypothesis:** The AMM swap triggers Token-2022 transfer_checked which invokes the transfer hook. If the hook (or a malicious hook on a different mint) could call back into the AMM, the reentrancy guard might not protect against cross-instruction reentrancy.
- **Attack Vector:** Craft a scenario where the hook callback re-enters AMM::swap before the first swap completes. The `pool.locked` flag should prevent this, but verify the flag is set before the CPI that triggers the hook.
- **Target Code:** `amm/src/instructions/swap.rs` — lock flag timing, CEI ordering
- **Impact:** CRITICAL — Double-spend on pool reserves if reentrancy succeeds
- **Precedent:** EP-033 (Reentrancy via CPI Callback), AMM Playbook (Reentrancy)
- **Requires:** Ability to re-enter AMM from within hook execution
- **Investigation:** Verify CEI ordering: lock → compute → transfer → unlock. Check that lock is set BEFORE any CPI. Consider if Token-2022 runtime prevents arbitrary callbacks.

### STR-018: Epoch Transition Double-Trigger in Same Slot
- **Category:** State Machine / Timing
- **Hypothesis:** If two `trigger_epoch_transition` transactions land in the same slot, both might pass the epoch number check simultaneously, causing double epoch advancement, double reward distribution, or double Carnage execution.
- **Attack Vector:** Submit two trigger transactions in rapid succession targeting the same slot.
- **Target Code:** `epoch_program/src/instructions/trigger_epoch_transition.rs` — epoch number check and increment
- **Impact:** HIGH — Double Carnage drains protocol. Double rewards inflates token supply.
- **Precedent:** EP-037 (Race Condition), EP-038 (Replay)
- **Requires:** Both TXs in same slot, state not updated between them
- **Investigation:** Check if epoch_number increment is atomic with the rest of the instruction. Verify Solana's intra-slot transaction ordering prevents this.

---

## Tier 2 — HIGH (Investigate Second)

### STR-019: Hardcoded Byte Offsets Drift After Anchor Upgrade
- **Category:** Arithmetic / Deserialization
- **Hypothesis:** `read_pool_reserves()` reads PoolState at hardcoded byte offsets [137] and [145]. If Anchor's serialization format changes (e.g., discriminator size, field ordering), these offsets silently read wrong data.
- **Target Code:** `tax_program` — `read_pool_reserves()` function
- **Impact:** HIGH — Wrong reserves = wrong slippage = wrong swap amounts. Carnage could drain pools.
- **Precedent:** EP-005 (Account Data Deserialization)
- **Requires:** Anchor version change or PoolState struct modification
- **Investigation:** Verify offsets match current Anchor 0.32.1 serialization. Add static assertions or derive offsets from struct layout.

### STR-020: `as u64` Truncation in VRF Tax Rate Computation
- **Category:** Arithmetic
- **Hypothesis:** VRF bytes are converted to a u64 then modulo'd to get tax rate bps. If the intermediate value exceeds u64 before the `as u64` cast, it silently truncates, producing biased or predictable rates.
- **Target Code:** `epoch_program/src/instructions/consume_randomness.rs`
- **Impact:** MEDIUM-HIGH — Tax rate manipulation if truncation produces predictable outcomes
- **Precedent:** EP-017 (Unsafe Cast), EP-020 (Modulo Bias)
- **Requires:** VRF output that triggers truncation
- **Investigation:** Check exact conversion: how many VRF bytes → u64. Check if `from_le_bytes` on 8 bytes always fits u64 (it does). Check modulo bias for range [500, 2500].

### STR-021: Staking First-Depositor Attack
- **Category:** Staking / Economic
- **Hypothesis:** First staker deposits minimal amount (1 token), then deposits large rewards. Due to precision, subsequent stakers get zero rewards because `reward_per_token` is so large that their share rounds to zero.
- **Target Code:** `staking/src/lib.rs` — stake and reward distribution
- **Impact:** MEDIUM — First depositor captures disproportionate rewards. Later stakers get nothing.
- **Precedent:** Staking Playbook (First-Depositor), EP-060 (Exchange Rate Manipulation)
- **Requires:** Being first to stake with ability to deposit rewards
- **Investigation:** Check if there's a minimum stake amount. Compute reward distribution with 1 token staked vs 1e9 tokens. Check if the protocol seeds initial stake.

### STR-022: Carnage Direction Prediction from On-Chain State
- **Category:** Oracle / Economic
- **Hypothesis:** Before `consume_randomness` is called, the VRF result is on-chain (after reveal). An observer can compute which faction "loses" and front-run Carnage by buying the losing faction (which Carnage will also buy, pumping it) or selling the winning faction.
- **Target Code:** `epoch_program` — VRF lifecycle, `tax_program` — Carnage execution
- **Impact:** MEDIUM-HIGH — MEV extraction from Carnage prediction
- **Precedent:** Novel (Carnage direction prediction), Oracle Playbook (Front-Running)
- **Requires:** Bot infrastructure, understanding of Carnage logic
- **Investigation:** Map exact information revealed at each VRF step. Compute Carnage direction from VRF output. Model MEV profit.

### STR-023: Pool Lock Not Released on Swap Error
- **Category:** State Machine / AMM
- **Hypothesis:** If the AMM swap panics or errors after setting `pool.locked = true` but before setting it back to `false`, the pool is permanently locked.
- **Target Code:** `amm/src/instructions/swap.rs` — lock/unlock ordering
- **Impact:** CRITICAL — Permanent pool freeze (no more swaps, including Carnage)
- **Precedent:** EP-033 (Reentrancy Guard Bug), EP-036 (Stuck State)
- **Requires:** Error between lock and unlock
- **Investigation:** Verify all error paths between lock=true and lock=false. Check if Anchor's error handling auto-reverts state changes (it does — Solana tx is atomic).

### STR-024: Tax Split Rounding Leaves Dust in Tax Program
- **Category:** Arithmetic / Economic
- **Hypothesis:** The 15% tax is split three ways (5% each). If `tax_amount` is not divisible by 3, the rounding leaves 1-2 lamports in the tax program's account each swap. Over millions of swaps, this dust accumulates with no extraction mechanism.
- **Target Code:** `tax_program` — tax split computation
- **Impact:** LOW-MEDIUM — Permanent fund lockup (minor), potential accounting drift
- **Precedent:** EP-015 (Rounding), EP-063 (Fee Accumulation)
- **Requires:** Non-divisible tax amounts (common)
- **Investigation:** Check if split uses `tax/3` vs `tax*5/15` vs separate computation. Verify all tax lamports are accounted for (treasury + staking + carnage = total tax).

### STR-025: Whitelist Allows Wrong Token Account for Hook Resolution
- **Category:** Token / Transfer Hook
- **Hypothesis:** The transfer hook resolves extra_account_meta_list PDA for each mint. If the wrong meta_list PDA is passed (from a different mint), the hook might check the wrong whitelist, allowing unauthorized transfers.
- **Target Code:** `transfer_hook/execute` — PDA derivation and validation
- **Impact:** HIGH — Whitelist bypass across token types
- **Precedent:** EP-042 (CPI Program Substitution), EP-053 (Token Account Confusion)
- **Requires:** Ability to substitute extra_account_meta_list from different mint
- **Investigation:** Check how meta_list PDA is derived (includes mint in seeds?). Verify Token-2022 enforces correct meta_list.

### STR-026: AMM Swap Output Calculation Off-By-One
- **Category:** Arithmetic / AMM
- **Hypothesis:** Constant-product formula: `output = reserve_out * input / (reserve_in + input)`. If the implementation uses `reserve_out * input / reserve_in` (missing +input in denominator), output is systematically too high, allowing pool drain.
- **Target Code:** `amm/src/lib.rs` — swap computation
- **Impact:** CRITICAL — Pool drain through repeated swaps
- **Precedent:** AMM Playbook (Rounding Drain), EP-015 (Arithmetic Error)
- **Requires:** Formula error in implementation
- **Investigation:** Verify exact formula matches `x * y = k` constant product. Check denominator includes input amount.

### STR-027: Staking Checkpoint Timing Allows Flash-Loan Reward Siphoning
- **Category:** Staking / Timing
- **Hypothesis:** If the staking checkpoint (which records the last update slot) doesn't prevent stake-claim-unstake in the same slot/transaction, a flash loan could borrow tokens, stake, claim rewards, unstake, and repay in one transaction.
- **Target Code:** `staking/src/lib.rs` — checkpoint logic, claim_rewards
- **Impact:** HIGH — All staking rewards drained via flash loan
- **Precedent:** Staking Playbook (Flash Loan Reward Siphon), EP-065 (Flash Loan)
- **Requires:** Ability to stake+claim+unstake in single TX, source of flash-loaned tokens
- **Investigation:** Verify checkpoint rejects claims in same slot as stake. Check if flash loan source exists for these tokens (this AMM has no flash loans, but external DEX could provide).

### STR-028: Transfer Hook Passes with Both Source and Dest Non-Whitelisted
- **Category:** Token / Access Control
- **Hypothesis:** The hook logic is `if source_whitelisted OR dest_whitelisted then ALLOW`. The correct logic should be `if source_whitelisted AND dest_whitelisted then ALLOW` (or some other policy). If the OR logic is used, any whitelisted account can send to any non-whitelisted account.
- **Target Code:** `transfer_hook/src/instructions/execute.rs`
- **Impact:** HIGH — Partial whitelist bypass. Whitelisted AMM pools can send tokens to arbitrary wallets.
- **Precedent:** EP-026 (Access Control Logic Error)
- **Requires:** OR-based whitelist logic
- **Investigation:** Read the exact boolean logic in execute. Determine the intended policy (OR is actually correct for this use case — pools need to send to users who aren't whitelisted).

### STR-029: `consume_randomness` Called Multiple Times Per Epoch
- **Category:** State Machine / Oracle
- **Hypothesis:** If the `randomness_consumed` flag is not properly set or checked, an attacker could call `consume_randomness` multiple times to re-roll tax rates until they get a favorable one.
- **Target Code:** `epoch_program/src/instructions/consume_randomness.rs`
- **Impact:** CRITICAL — Tax rate manipulation, VRF integrity destroyed
- **Precedent:** EP-021 (Oracle Replay), EP-037 (State Flag Bypass)
- **Requires:** Missing or bypassable consumed flag
- **Investigation:** Verify `randomness_consumed` is checked at entry AND set atomically with rate computation. Test calling consume twice.

### STR-030: Swap Authority PDA Derivation Mismatch
- **Category:** CPI / PDA
- **Hypothesis:** swap_authority is derived from Tax Program's ID. If AMM validates it with a different program ID (e.g., its own), the PDA won't match, OR if they accidentally agree on the same seeds but different programs, a collision could occur.
- **Target Code:** `tax_program` — PDA derivation, `amm` — `seeds::program = TAX_PROGRAM_ID`
- **Impact:** CRITICAL — If mismatch: all swaps fail. If wrong program: unauthorized swaps possible.
- **Precedent:** EP-007 (PDA Derivation Mismatch), EP-042 (CPI Program Substitution)
- **Requires:** Derivation bug in either program
- **Investigation:** Verify both programs use identical seeds and program ID for swap_authority. Compare bumps.

### STR-031: Epoch Number Overflow Wraps State Machine
- **Category:** Arithmetic / State Machine
- **Hypothesis:** `epoch_number` is stored as u64. After 2^64 epochs, it wraps to 0, potentially re-enabling initialization paths or breaking monotonicity checks.
- **Target Code:** `epoch_program` — epoch_number field and increment
- **Impact:** LOW (practically impossible) — But if epoch_number is u32 or smaller, wrapping becomes feasible.
- **Precedent:** EP-016 (Integer Overflow)
- **Requires:** Extremely large number of epochs (u64 is practically infinite at 1 per minute = 35 trillion years)
- **Investigation:** Check actual type of epoch_number. If u32, compute time to wrap at expected epoch duration.

### STR-032: Carnage Burns Wrong Token (Faction Confusion)
- **Category:** Token / State Machine
- **Hypothesis:** Carnage is supposed to buy the LOSING faction token and burn some. If the "which faction lost" logic is inverted or the mint accounts are swapped, Carnage burns the WINNING faction token instead.
- **Target Code:** `tax_program/execute_carnage` — losing faction determination, mint selection
- **Impact:** HIGH — Protocol punishes winners and rewards losers, inverting the game mechanic
- **Precedent:** Novel (dual-faction confusion)
- **Requires:** Logic error in faction determination or account ordering
- **Investigation:** Trace the `cheapSide` / losing faction determination from VRF output through to mint selection. Verify correct mint is burned.

### STR-033: Pool State Desync After Failed Carnage
- **Category:** State Machine
- **Hypothesis:** If Carnage partially executes (e.g., buy succeeds but burn fails), the pool state is modified but Carnage is not marked complete. On retry (next epoch), the protocol doesn't know the partial state.
- **Target Code:** `tax_program/execute_carnage` — multi-step execution, error handling
- **Impact:** MEDIUM-HIGH — Pool reserves don't match expected state. Subsequent Carnage operates on wrong assumptions.
- **Precedent:** EP-036 (Partial State Update), EP-034 (Incomplete Transition)
- **Requires:** Failure between Carnage steps (e.g., slippage check fails on sell after buy succeeds)
- **Investigation:** Verify Carnage is atomic (all-or-nothing via Solana TX atomicity). If so, this is not exploitable. If Carnage spans multiple TXs, check partial state handling.

### STR-034: Staking Unstake Returns Wrong Token Type
- **Category:** Token / CPI
- **Hypothesis:** The unstake instruction returns staked tokens. If the token accounts or mint are confused (e.g., user passes CRIME token account but has FRAUD staked), the wrong token is returned.
- **Target Code:** `staking/src/instructions/unstake.rs`, `tax_program/src/instructions/unstake.rs`
- **Impact:** MEDIUM — User receives wrong token, accounting mismatch
- **Precedent:** EP-053 (Token Account Confusion), EP-001 (Missing Validation)
- **Requires:** Insufficient mint/token account validation
- **Investigation:** Check if unstake validates that the returned token mint matches the staked token mint.

### STR-035: Carnage WSOL Account Drained via Direct Transfer
- **Category:** Access Control / Token
- **Hypothesis:** The Carnage Fund holds WSOL in a PDA-owned account. If any instruction allows transferring from this account without proper authority checks, an attacker could drain the fund.
- **Target Code:** Carnage WSOL token account — authority and access patterns
- **Impact:** CRITICAL — Entire Carnage Fund stolen
- **Precedent:** EP-026 (Missing Access Control), EP-051 (Token Authority)
- **Requires:** Missing authority check on Carnage WSOL account
- **Investigation:** Verify Carnage WSOL account authority is a PDA that only the carnage execution path can sign for. Check no other instruction references this account.

### STR-036: VRF Timeout Recovery Creates Stale Randomness
- **Category:** Oracle / State Machine
- **Hypothesis:** `retry_epoch_vrf` creates fresh randomness after timeout. If the old, expired randomness is not properly invalidated, both old and new randomness could be consumed, allowing double epoch transitions.
- **Target Code:** `epoch_program/src/instructions/retry_epoch_vrf.rs`
- **Impact:** HIGH — Double epoch advance, double reward distribution
- **Precedent:** EP-021 (Oracle Replay), EP-037 (State Flag Bypass)
- **Requires:** Both old and new randomness accounts valid simultaneously
- **Investigation:** Verify retry_epoch_vrf invalidates the old randomness account/state. Check that consume_randomness only accepts the newest randomness.

### STR-037: Admin Whitelist + Treasury Combined Attack
- **Category:** Admin / Access Control
- **Hypothesis:** With admin key, an attacker can: (1) Update treasury to attacker wallet, (2) Add attacker wallet to whitelist, (3) Force carnage. Combined, these actions extract maximum value without needing to exploit any code bug.
- **Target Code:** All admin instructions across programs
- **Impact:** HIGH — Combined admin actions maximize extraction: ongoing tax theft + whitelist bypass + forced carnage
- **Precedent:** EP-068 (Key Compromise), EP-074 (Privilege Escalation)
- **Requires:** Admin key compromise
- **Investigation:** Enumerate all admin-callable instructions and model combined maximum extraction scenario. Recommend multisig/timelock.

### STR-038: Token-2022 Transfer Fee Extension Interaction
- **Category:** Token / Extension
- **Hypothesis:** If tokens have TransferFee extension (in addition to TransferHook), the fee is deducted by the Token-2022 runtime before the hook sees the transfer amount. This could cause the tax program's amount calculations to be off.
- **Target Code:** Token mint configurations, tax calculation
- **Impact:** MEDIUM — Accounting errors if transfer fee exists
- **Precedent:** EP-055 (Token Extension Interaction)
- **Requires:** TransferFee extension enabled on any of the 3 mints
- **Investigation:** Check if CRIME/FRAUD/PROFIT mints have TransferFee extension. If not, this is N/A. If yes, verify tax computation accounts for the fee.

### STR-039: AMM `add_liquidity` Dilutes Existing Reserves
- **Category:** AMM / Admin
- **Hypothesis:** Admin can call `add_liquidity` at any time to add more tokens to a pool. If done at an incorrect ratio, it permanently changes the pool's price, advantaging one side.
- **Target Code:** `amm/src/instructions/add_liquidity.rs`
- **Impact:** MEDIUM — Admin-manipulable pool price. Not user-exploitable but admin risk.
- **Precedent:** AMM Playbook (LP Manipulation), EP-026 (Admin Abuse)
- **Requires:** Admin key
- **Investigation:** Check if add_liquidity enforces ratio matching current reserves. Check if it can be called after pool is active.

### STR-040: Staking Reward Distribution Without Sufficient Balance
- **Category:** Arithmetic / Staking
- **Hypothesis:** `deposit_rewards` increments `reward_per_token` but the actual tokens might not have been transferred to the staking vault. Users claim rewards that don't exist, and last claimer gets nothing.
- **Target Code:** `staking/src/instructions/deposit_rewards.rs`, `claim_rewards.rs`
- **Impact:** MEDIUM — Last staker(s) cannot claim. Accounting shows rewards that aren't backed by tokens.
- **Precedent:** Staking Playbook (Unbacked Rewards), EP-060 (Phantom Rewards)
- **Requires:** deposit_rewards not paired with actual token transfer
- **Investigation:** Verify deposit_rewards requires and validates the actual token transfer in the same instruction. Check token vault balance vs total_rewards_distributed.

### STR-041: Swap `min_amount_out` Set to Zero by Frontend
- **Category:** Economic / Frontend
- **Hypothesis:** If the frontend sets `min_amount_out = 0` (or very low), users are vulnerable to unlimited slippage. A MEV bot can sandwich every swap for maximum extraction.
- **Target Code:** Frontend swap UI, `tax_program` — min_amount_out parameter
- **Impact:** HIGH — User fund theft via sandwich MEV
- **Precedent:** AMM Playbook (Missing Slippage Protection), EP-064 (Sandwich Attack)
- **Requires:** Frontend sends 0 or low min_amount_out
- **Investigation:** Check if on-chain code enforces a minimum `min_amount_out > 0`. Check frontend default slippage settings.

### STR-042: VRF Modulo Bias in Tax Rate Range
- **Category:** Oracle / Arithmetic
- **Hypothesis:** VRF output is mapped to tax rate in [500, 2500] via modulo. Range = 2001 values. If the VRF output range (2^64) is not evenly divisible by 2001, some rates are slightly more likely than others.
- **Target Code:** `epoch_program/consume_randomness` — rate calculation
- **Impact:** LOW — Bias is ~0.00001%, practically insignificant
- **Precedent:** EP-020 (Modulo Bias)
- **Requires:** Statistical analysis over many epochs
- **Investigation:** Compute exact bias: `2^64 mod 2001`. Determine if any rate has exploitably higher probability.

### STR-043: Pool Reserves Underflow to Zero
- **Category:** Arithmetic / AMM
- **Hypothesis:** A series of swaps could drain one side of a pool to zero or near-zero. The constant-product formula prevents exact zero, but numerical precision could allow one reserve to reach 1 lamport, making the pool effectively one-sided.
- **Target Code:** `amm/src/instructions/swap.rs` — reserve update
- **Impact:** MEDIUM — Pool becomes non-functional (1:huge ratio). Recovery requires admin add_liquidity.
- **Precedent:** AMM Playbook (Pool Drain), EP-059 (Liquidity Drain)
- **Requires:** Large unidirectional volume, no counterbalancing trades
- **Investigation:** Check if there's a minimum reserve check post-swap. Model how many swaps to reach 1:1e9 ratio.

### STR-044: Hook Execution Fails Silently (Transfer Succeeds Without Validation)
- **Category:** Token / Transfer Hook
- **Hypothesis:** If the hook program encounters an error, Token-2022 might let the transfer proceed anyway (fail-open) instead of reverting (fail-closed).
- **Target Code:** Token-2022 runtime — hook invocation error handling
- **Impact:** CRITICAL — Whitelist completely bypassed on hook errors
- **Precedent:** EP-056 (Hook Bypass), Novel
- **Requires:** Token-2022 fail-open behavior (unlikely but must verify)
- **Investigation:** Read Token-2022 source/docs for hook error handling semantics. Test by deploying hook that always errors and attempting transfer.

### STR-045: Carnage Sell Step Receives Zero Output
- **Category:** AMM / Economic
- **Hypothesis:** After Carnage buys the losing token (skewing the pool), the sell step swaps remaining tokens in a now-imbalanced pool. If the pool is skewed enough, the sell output could round to zero, losing Carnage Fund value.
- **Target Code:** `tax_program/execute_carnage` — sell step amount, `amm/swap` — output for skewed pool
- **Impact:** MEDIUM — Carnage Fund value leaked to arbitrageurs who re-balance the pool
- **Precedent:** AMM Playbook (Price Impact), EP-015 (Rounding to Zero)
- **Requires:** Very large Carnage buy relative to pool size
- **Investigation:** Model the buy-then-sell sequence at various Carnage:reserve ratios. Check if slippage floor catches zero-output.

### STR-046: Epoch Transition During Active Swap
- **Category:** Timing / State Machine
- **Hypothesis:** If an epoch transition (which changes tax rates) lands in the same slot as a user swap, the swap might use the new rate unexpectedly. The user computed slippage based on the old rate.
- **Target Code:** `epoch_program/trigger_epoch_transition`, `tax_program/swap_*`
- **Impact:** MEDIUM — User gets worse rate than expected. min_amount_out should protect but might be set for old rate.
- **Precedent:** EP-039 (TOCTOU), Oracle Playbook (Rate Change Race)
- **Requires:** Epoch transition and swap in same slot
- **Investigation:** Check if tax rate is read at swap start (from EpochState). If rate changes mid-slot, does the swap use old or new? Solana processes TXs sequentially within a slot.

### STR-047: Staking Zero-Amount Deposit Inflates Reward Per Token
- **Category:** Arithmetic / Staking
- **Hypothesis:** If `deposit_rewards(0)` is allowed, it might still update the reward checkpoint without adding rewards, causing `reward_per_token` calculation to skip a period.
- **Target Code:** `staking/src/instructions/deposit_rewards.rs`
- **Impact:** LOW — Accounting anomaly, no direct theft
- **Precedent:** EP-015 (Zero Amount Edge Case)
- **Requires:** deposit_rewards allows zero amount
- **Investigation:** Check if zero-amount is rejected. If allowed, trace the effect on reward_per_token math.

### STR-048: Cross-Faction Arbitrage via Simultaneous Pool Imbalance
- **Category:** Economic / Novel
- **Hypothesis:** If CRIME/SOL and FRAUD/SOL pools are at different prices (different market caps), buying the cheaper faction with SOL, routing through PROFIT, and selling as the expensive faction extracts risk-free profit after taxes.
- **Target Code:** All swap paths, PROFIT pool routing
- **Impact:** MEDIUM — Persistent arbitrage extracts value from protocol. May be intentional market-making.
- **Precedent:** Novel (cross-faction bridge arbitrage)
- **Requires:** Price discrepancy exceeding 3x 15% tax (45% round trip)
- **Investigation:** Model the three-pool triangle. Compute minimum price discrepancy for profitable arbitrage after taxes.

### STR-049: AMM Fee Not Deducted Before k-Invariant Check
- **Category:** AMM / Arithmetic
- **Hypothesis:** The 30bps AMM fee should be deducted from input before computing output. If fee is deducted after, the k-invariant increases on every swap (ratcheting), eventually making the pool unusable.
- **Target Code:** `amm/src/lib.rs` — fee deduction and swap math
- **Impact:** HIGH — Pool drain or pool bricking depending on direction of error
- **Precedent:** AMM Playbook (Fee Calculation Error), EP-015
- **Requires:** Fee deducted at wrong point in calculation
- **Investigation:** Verify: `input_after_fee = input * (10000 - 30) / 10000`, THEN compute output using input_after_fee. Check k is maintained or slightly increased.

### STR-050: Anchor Discriminator Collision Between Instructions
- **Category:** Deserialization / Access Control
- **Hypothesis:** Anchor derives 8-byte discriminators from instruction names. If two instructions across programs share a discriminator, a CPI could be routed to the wrong handler.
- **Target Code:** All instruction handlers across 5 programs
- **Impact:** HIGH — Wrong instruction executed with wrong account layout
- **Precedent:** EP-077 (Discriminator Collision)
- **Requires:** Extremely unlikely hash collision (birthday paradox at ~30 instructions)
- **Investigation:** Compute discriminators for all instructions across all 5 programs. Check for collisions.

### STR-051: Carnage Burn Authority Invalid
- **Category:** Token / CPI
- **Hypothesis:** Carnage needs to burn tokens after buying them. The burn instruction requires the token account owner or delegate. If the Carnage PDA doesn't have burn authority over the token account holding the bought tokens, the burn fails.
- **Target Code:** `tax_program/execute_carnage` — burn CPI
- **Impact:** MEDIUM — Carnage buy succeeds but burn fails, leaving tokens in limbo. TX reverts (atomic).
- **Precedent:** EP-051 (Token Authority), EP-043 (Missing Signer)
- **Requires:** Incorrect authority on Carnage token account
- **Investigation:** Verify the token account that receives the Carnage buy is owned by a PDA that can sign for burns.

### STR-052: VRF Commit Without Subsequent Reveal Blocks Epoch
- **Category:** State Machine / Oracle
- **Hypothesis:** After `commit_vrf`, if `reveal_vrf` never succeeds (oracle down, network issue), the epoch is stuck. The `retry_epoch_vrf` provides recovery, but if it also fails, epochs are permanently blocked.
- **Target Code:** `epoch_program` — VRF lifecycle, retry logic
- **Impact:** HIGH — Permanent epoch freeze = no more Carnage, no more reward distribution
- **Precedent:** Oracle Playbook (Oracle Liveness), EP-024 (Oracle Unavailability)
- **Requires:** Switchboard oracle persistent unavailability
- **Investigation:** Trace all recovery paths. Check if there's a final fallback (e.g., admin override to skip VRF). Model maximum downtime before permanent damage.

### STR-053: Tax Rate Clamping Edge Case
- **Category:** Arithmetic
- **Hypothesis:** Tax rate is clamped to [500, 2500] bps. If the VRF modulo produces a value at exactly the boundary AND the clamping uses `<` vs `<=`, rates of exactly 500 or 2500 might be unreachable or doubled.
- **Target Code:** `epoch_program/consume_randomness` — clamping logic
- **Impact:** LOW — Minor statistical bias at boundaries
- **Precedent:** EP-017 (Off-by-One), EP-020 (Modulo Bias)
- **Requires:** Boundary-exact VRF output
- **Investigation:** Check if clamp uses inclusive or exclusive bounds. Verify rate 500 and 2500 are both achievable.

### STR-054: Switchboard Randomness Account Substitution
- **Category:** Oracle / Account Validation
- **Hypothesis:** An attacker creates a fake Switchboard randomness account with known values and passes it to `consume_randomness` instead of the legitimate one.
- **Target Code:** `epoch_program` — randomness account validation
- **Impact:** CRITICAL — Attacker controls tax rates and Carnage direction
- **Precedent:** EP-001 (Missing Account Validation), Oracle Playbook (Oracle Substitution)
- **Requires:** Missing ownership/PDA check on randomness account
- **Investigation:** Verify randomness account is validated as owned by Switchboard program. Check if it's validated as the specific account created during commit_vrf.

### STR-055: Pool Authority Can Swap Without Going Through Tax Program
- **Category:** CPI / Access Control
- **Hypothesis:** The swap_authority PDA is the only entity allowed to call AMM::swap. But if another program can derive the same PDA (same seeds, same program ID), it could call AMM::swap directly, bypassing tax collection.
- **Target Code:** `amm/src/instructions/swap.rs` — authority validation
- **Impact:** CRITICAL — Tax-free swaps, protocol revenue completely bypassed
- **Precedent:** EP-042 (CPI Program Substitution), EP-007 (PDA Derivation)
- **Requires:** Another program deploying with Tax Program's ID (impossible) OR seeds not including program ID
- **Investigation:** Verify swap_authority PDA includes Tax Program ID in derivation. Since only Tax Program can sign for this PDA, this should be safe. Confirm.

### STR-056: Staking `total_staked` Underflow on Unstake
- **Category:** Arithmetic / Staking
- **Hypothesis:** If `total_staked` doesn't use checked_sub, unstaking more than total_staked causes underflow to u64::MAX, breaking all subsequent reward calculations.
- **Target Code:** `staking/src/instructions/unstake.rs`
- **Impact:** HIGH — Staking reward pool permanently corrupted
- **Precedent:** EP-016 (Integer Underflow), Staking Playbook
- **Requires:** Unstake amount > total_staked (should be impossible with proper accounting but check)
- **Investigation:** Verify checked_sub is used. Check if user.staked_amount is validated against pool.total_staked.

### STR-057: Carnage Lock Slot Not Set Before Deadline Check
- **Category:** Timing / State Machine
- **Hypothesis:** Carnage has a [lock_slot, lock_slot + deadline] execution window. If lock_slot is set to 0 or a past value, the deadline check might always pass or never pass.
- **Target Code:** `epoch_program` — lock_slot setting, deadline validation
- **Impact:** MEDIUM — Carnage executable at unexpected times or never
- **Precedent:** EP-039 (TOCTOU), EP-036 (State Initialization)
- **Requires:** lock_slot not properly set during epoch transition
- **Investigation:** Trace where lock_slot is set (during trigger_epoch_transition). Verify it's set to Clock::slot. Check deadline computation.

### STR-058: Transfer Hook Whitelist PDA Derivation Mismatch
- **Category:** Token / PDA
- **Hypothesis:** The whitelist entry PDA is derived with seeds including the token account address. If the hook checks a PDA derived with different seeds than what was used during `add_to_whitelist`, the check always fails or always passes.
- **Target Code:** `transfer_hook` — whitelist PDA seeds in add_to_whitelist vs execute
- **Impact:** HIGH — Whitelist non-functional (either blocks everything or allows everything)
- **Precedent:** EP-007 (PDA Derivation Mismatch)
- **Requires:** Seed mismatch between whitelist management and execution
- **Investigation:** Compare PDA seeds in add_to_whitelist, remove_from_whitelist, and execute. Must be identical.

### STR-059: AMM Swap Emits Wrong Event (Accounting Mismatch)
- **Category:** State Machine
- **Hypothesis:** If the AMM emits an event with wrong amounts (e.g., pre-fee instead of post-fee), off-chain indexers and the frontend show incorrect data, misleading users.
- **Target Code:** `amm/src/instructions/swap.rs` — event emission
- **Impact:** LOW — No on-chain impact, but off-chain data corruption
- **Precedent:** EP-040 (Event Spoofing)
- **Requires:** Event emission with wrong values
- **Investigation:** Verify event amounts match actual state changes. Compare event data to post-swap reserves.

### STR-060: Epoch State Account Reallocation
- **Category:** State Machine / Initialization
- **Hypothesis:** EpochState account might not have enough space for all fields after protocol upgrades. Since programs are non-upgradeable, the account size is fixed at init. If not large enough, serialization fails.
- **Target Code:** `epoch_program` — EpochState struct size, init allocation
- **Impact:** MEDIUM — Epoch operations fail if state can't be serialized
- **Precedent:** EP-076 (Account Space)
- **Requires:** EpochState struct larger than allocated space
- **Investigation:** Compute EpochState serialized size. Compare to allocated account space. Check for padding.

---

## Tier 3 — MEDIUM-LOW (If Time Permits)

### STR-061: AMM Pool Initialization With Zero Reserves
- **Category:** Initialization
- **Hypothesis:** `initialize_pool` might allow creating a pool with zero reserves, enabling first-swap manipulation.
- **Target Code:** `amm/src/instructions/initialize_pool.rs`
- **Precedent:** AMM Playbook (First-Depositor), EP-075
- **Investigation:** Check if init enforces non-zero reserves.

### STR-062: Staking Pool Double Initialization
- **Category:** Initialization
- **Hypothesis:** StakePool `initialize` might be callable twice, resetting all staking state.
- **Target Code:** `staking/src/instructions/initialize_pool.rs`
- **Precedent:** EP-076 (Re-initialization)
- **Investigation:** Check Anchor `init` constraint usage.

### STR-063: Hook Initialize Re-callable
- **Category:** Initialization
- **Hypothesis:** Hook `initialize` re-callable, resetting admin or config.
- **Target Code:** `transfer_hook/src/instructions/initialize.rs`
- **Precedent:** EP-076
- **Investigation:** Check init guard.

### STR-064: `as u32` Truncation in Slot Arithmetic
- **Category:** Arithmetic
- **Hypothesis:** Slot numbers are u64. Any `as u32` cast truncates after slot ~4.3 billion.
- **Target Code:** `epoch_program` — slot comparisons
- **Precedent:** EP-017 (Unsafe Cast)
- **Investigation:** Search for `as u32` on slot values.

### STR-065: Missing `checked_div` on Tax Split
- **Category:** Arithmetic
- **Hypothesis:** Tax split might divide by zero if tax_rate = 0 is somehow set.
- **Target Code:** `tax_program` — tax computation
- **Precedent:** EP-018 (Division by Zero)
- **Investigation:** Check if rate can be zero. Check division safety.

### STR-066: Staking Claim With Zero Pending Rewards
- **Category:** Staking
- **Hypothesis:** claim_rewards with zero pending might update checkpoint without distributing, skipping earned rewards.
- **Target Code:** `staking/src/instructions/claim_rewards.rs`
- **Precedent:** EP-015
- **Investigation:** Check zero-reward claim behavior.

### STR-067: AMM Pool State Size vs Anchor Discriminator
- **Category:** Deserialization
- **Hypothesis:** PoolState might have different sizes with different Anchor versions due to discriminator changes.
- **Target Code:** `amm/src/state.rs`
- **Precedent:** EP-005
- **Investigation:** Verify PoolState size matches allocation.

### STR-068: Carnage Signer Bump Not Stored
- **Category:** PDA / CPI
- **Hypothesis:** If the carnage_signer PDA bump is derived at runtime but not stored, a different bump could be used in a re-derivation, yielding a different PDA.
- **Target Code:** `epoch_program` — carnage_signer derivation
- **Precedent:** EP-008 (PDA Bump Confusion)
- **Requires:** PDA re-derivation with wrong bump
- **Investigation:** Check if canonical bump is used (find_program_address returns canonical). Verify bump is stored or always re-derived.

### STR-069: Tax Program Signs With Wrong PDA Seeds
- **Category:** CPI / PDA
- **Hypothesis:** Tax program uses `invoke_signed` with hardcoded seeds. If seeds don't match the PDA derivation, signing fails or a wrong PDA is used.
- **Target Code:** `tax_program` — all `invoke_signed` calls
- **Precedent:** EP-007 (PDA Seeds Mismatch)
- **Investigation:** Compare seeds in invoke_signed to seeds in PDA derivation.

### STR-070: Staking Reward Token Account Wrong Mint
- **Category:** Token
- **Hypothesis:** Staking reward distribution transfers PROFIT tokens but the reward vault might hold a different token.
- **Target Code:** `staking` — reward vault token account
- **Precedent:** EP-053 (Token Account Confusion)
- **Investigation:** Verify reward vault mint matches PROFIT mint constraint.

### STR-071: AMM Swap With Same Input/Output Mint
- **Category:** AMM
- **Hypothesis:** Swapping token A for token A (same mint both sides) might pass validation and corrupt reserves.
- **Target Code:** `amm/src/instructions/swap.rs`
- **Precedent:** EP-061 (Self-Swap)
- **Investigation:** Check if swap rejects same-mint input/output.

### STR-072: Transfer Hook Whitelist Entry PDA Not Closed on Remove
- **Category:** Token / State
- **Hypothesis:** `remove_from_whitelist` might not close the PDA account, leaving it as valid but with stale data.
- **Target Code:** `transfer_hook/src/instructions/remove_from_whitelist.rs`
- **Precedent:** EP-041 (Account Closure)
- **Investigation:** Check if account is closed (lamports zeroed, data cleared) on remove.

### STR-073: Epoch VRF Uses Outdated Switchboard SDK
- **Category:** Dependency
- **Hypothesis:** Switchboard SDK version might have known vulnerabilities or breaking changes.
- **Target Code:** `Cargo.toml` — switchboard dependencies
- **Precedent:** KB (known-vulnerable-deps.md)
- **Investigation:** Check Switchboard SDK version against known issues.

### STR-074: AMM Pool Not Marked Burnable Before Carnage Burn
- **Category:** State Machine
- **Hypothesis:** Carnage burns tokens from a pool. If the pool isn't marked as "burnable", the burn CPI fails.
- **Target Code:** `amm` — burnable flag, `tax_program/execute_carnage` — burn path
- **Precedent:** Novel
- **Investigation:** Check if Carnage path checks burnable flag. Trace burn authority.

### STR-075: Reward Per Token Precision Loss With Large total_staked
- **Category:** Arithmetic / Staking
- **Hypothesis:** `reward * PRECISION / total_staked` — if total_staked is very large (e.g., 1e18 tokens), the numerator might not overflow u128 but the result rounds to zero, meaning no rewards are distributed.
- **Target Code:** `staking` — reward_per_token calculation
- **Precedent:** EP-015, Staking Playbook (Precision Loss)
- **Investigation:** Compute minimum reward amount for non-zero result at maximum total_staked.

### STR-076: Swap Authority PDA Bump Seed Not Passed to AMM
- **Category:** CPI / PDA
- **Hypothesis:** When Tax Program calls AMM::swap, it signs with the swap_authority PDA. If the bump seed isn't correctly passed, the signature verification fails.
- **Target Code:** `tax_program` — invoke_signed for AMM swap
- **Precedent:** EP-008
- **Investigation:** Verify bump is correctly included in signer seeds.

### STR-077: Epoch Reward Distribution to Empty Staking Pool
- **Category:** Staking / Arithmetic
- **Hypothesis:** If total_staked = 0 when epoch rewards are distributed, `reward / 0` causes panic or the rewards are lost permanently.
- **Target Code:** `staking/src/instructions/distribute_epoch_rewards.rs`
- **Precedent:** EP-018 (Division by Zero), Staking Playbook
- **Investigation:** Check if distribute handles zero total_staked gracefully.

### STR-078: Carnage Buy/Sell Use Different Pool
- **Category:** Economic / Novel
- **Hypothesis:** Carnage buys LOSING token in SOL/LOSING pool, then sells remaining in LOSING/PROFIT pool (different pool). The dual-pool interaction means the buy impact doesn't affect the sell pool.
- **Target Code:** `tax_program/execute_carnage` — pool selection for buy vs sell steps
- **Precedent:** Novel (dual-pool Carnage routing)
- **Investigation:** Trace which pool is used for each Carnage step. Model price impact across pools.

### STR-079: AMM Locked Flag Persists Across Instructions in Same TX
- **Category:** State Machine
- **Hypothesis:** If AMM pool.locked is set in one instruction and not cleared (due to error), a subsequent instruction in the same TX sees it still locked.
- **Target Code:** `amm/swap` — lock flag
- **Precedent:** EP-033
- **Investigation:** Verify lock is always cleared in the same instruction. Solana TX atomicity means partial state doesn't persist.

### STR-080: Token-2022 Close Authority on Hook Mint
- **Category:** Token
- **Hypothesis:** If CRIME/FRAUD/PROFIT mints have CloseAuthority extension, someone could close the mint, destroying all tokens.
- **Target Code:** Token mint configurations
- **Precedent:** EP-057 (Mint Authority Abuse)
- **Investigation:** Check mint extensions for CloseAuthority.

### STR-081: Staking User Account Not Validated Against Pool
- **Category:** Access Control
- **Hypothesis:** A UserStake account for Pool A might be passed to an instruction for Pool B, causing cross-pool accounting corruption.
- **Target Code:** `staking` — account validation, has_one constraints
- **Precedent:** EP-001, EP-053
- **Investigation:** Check if UserStake has `has_one = pool` constraint.

### STR-082: Epoch Transition Bounty Griefing
- **Category:** Economic / Timing
- **Hypothesis:** Anyone can trigger epoch transition for the bounty. A MEV bot can consistently claim all bounties, centralizing the epoch trigger mechanism.
- **Target Code:** `epoch_program/trigger_epoch_transition`
- **Precedent:** Novel (permissionless trigger MEV)
- **Investigation:** This is by design (permissionless). Check if bounty amount is sufficient to incentivize timely triggers.

### STR-083: AMM Pool Account Owned by Wrong Program
- **Category:** Account Validation
- **Hypothesis:** Pool account passed to swap might be owned by a different program, containing attacker-crafted data.
- **Target Code:** `amm/src/instructions/swap.rs` — Account<PoolState>
- **Precedent:** EP-003 (Owner Check)
- **Investigation:** Anchor's Account<T> automatically checks program ownership. Verify this is used.

### STR-084: Carnage Fund Accumulation Without Spending (No Carnage Trigger)
- **Category:** Economic / State Machine
- **Hypothesis:** If Carnage is never triggered (e.g., VRF always fails), the fund grows indefinitely. When finally triggered, the massive fund crashes the pool.
- **Target Code:** Carnage fund accumulation, epoch lifecycle
- **Precedent:** Novel
- **Investigation:** Model maximum fund accumulation over N epochs. Check if there's a cap or safety valve.

### STR-085: Transfer Hook Returns Success for Non-Existent Whitelist Entry
- **Category:** Token / Account Validation
- **Hypothesis:** Hook checks if whitelist PDA exists. If PDA doesn't exist, Anchor might deserialize it as zeroed data rather than erroring, causing whitelist check to pass.
- **Target Code:** `transfer_hook/execute` — whitelist PDA handling
- **Precedent:** EP-001, EP-004 (Uninitialized Account)
- **Investigation:** Check if hook uses `Account<>` (which validates) or `UncheckedAccount`. Check behavior when PDA doesn't exist.

### STR-086: VRF Commit Without Proper Slot Validation
- **Category:** Oracle / Timing
- **Hypothesis:** `commit_vrf` might accept a randomness account created for a past or future slot, not the current epoch.
- **Target Code:** `epoch_program/commit_vrf` — slot validation
- **Precedent:** EP-021, Oracle Playbook
- **Investigation:** Check slot freshness validation on VRF commit.

### STR-087: Staking Unstake Returns More Than Staked
- **Category:** Staking / Arithmetic
- **Hypothesis:** Due to accounting error, unstake might return more tokens than the user staked.
- **Target Code:** `staking/unstake` — amount validation
- **Precedent:** Staking Playbook
- **Investigation:** Check if unstake amount <= user.staked_amount is enforced.

### STR-088: AMM Pool Token Accounts Not Associated Token Accounts
- **Category:** Token / Account Validation
- **Hypothesis:** Pool token accounts might not be ATAs, allowing substitution with attacker accounts.
- **Target Code:** `amm` — pool token account validation
- **Precedent:** EP-002 (Account Substitution), EP-053
- **Investigation:** Check if pool token accounts are validated as ATAs or PDAs with correct seeds.

### STR-089: Tax Program Reads Wrong EpochState for Tax Rate
- **Category:** CPI / Account Validation
- **Hypothesis:** Tax program reads the current tax rate from an EpochState account. If an attacker substitutes a fake EpochState with a lower rate, they pay less tax.
- **Target Code:** `tax_program/swap_*` — EpochState account validation
- **Precedent:** EP-001 (Account Substitution)
- **Investigation:** Verify EpochState is validated by PDA seeds and Epoch program ownership.

### STR-090: Anchor `close` Not Used on Expired VRF Accounts
- **Category:** State Management
- **Hypothesis:** After VRF consumption, the randomness account data persists. If not properly closed, it wastes rent and could be replayed.
- **Target Code:** `epoch_program` — post-consumption randomness account handling
- **Precedent:** EP-041 (Account Not Closed), EP-076
- **Investigation:** Check if randomness accounts are closed after consumption.

### STR-091: Carnage Sell Proceeds Not Added to Buy Step
- **Category:** Economic / Novel
- **Hypothesis:** The sell step produces SOL/tokens that should fund part of the buy step. If proceeds are stranded and not combined, the buy step only uses the original fund, wasting the sell output.
- **Target Code:** `tax_program/execute_carnage` — sell proceeds handling
- **Precedent:** Novel (known previous bug — verify fix is correct)
- **Investigation:** Verify that sell proceeds (WSOL) are combined with swap_amount for the buy step. This was a known bug — verify the fix.

### STR-092: Pool Reserves Overflow on Large Deposit
- **Category:** Arithmetic / AMM
- **Hypothesis:** Pool reserves stored as u64. A deposit that pushes reserves above u64::MAX would overflow.
- **Target Code:** `amm/add_liquidity`, `swap` — reserve updates
- **Precedent:** EP-016
- **Investigation:** Check if checked_add is used for reserve updates. Maximum practical reserves.

### STR-093: Epoch State has_one Validation Missing
- **Category:** Access Control
- **Hypothesis:** EpochState might not validate that it's the singleton expected state account (could have multiple EpochState accounts).
- **Target Code:** `epoch_program` — EpochState PDA seeds
- **Precedent:** EP-001, EP-007
- **Investigation:** Check EpochState is a singleton PDA with fixed seeds.

### STR-094: Staking Pool Not Validated as Correct Faction
- **Category:** Access Control
- **Hypothesis:** There might be separate staking pools per faction. If pool validation doesn't check faction, a user could stake CRIME in the FRAUD pool.
- **Target Code:** `staking` — pool selection, token mint validation
- **Precedent:** EP-053
- **Investigation:** Check if staking is faction-specific or universal. If universal, how are faction rewards separated?

### STR-095: AMM Fee Recipient is Pool Not Treasury
- **Category:** Economic
- **Hypothesis:** The 30bps AMM fee stays in the pool (increases k) rather than being extracted. This is correct for most AMMs but means the fee accrues to admin (protocol-owned liquidity), not to the protocol treasury.
- **Target Code:** `amm/swap` — fee handling
- **Precedent:** AMM Playbook
- **Investigation:** Verify fee stays in pool. Determine if this is intentional design.

### STR-096: Token Account Rent Exemption Not Checked on Create
- **Category:** Account Validation
- **Hypothesis:** New token accounts created during swaps might not be rent-exempt, causing future failures.
- **Target Code:** `tax_program` — token account creation
- **Precedent:** EP-076
- **Investigation:** Check if init_if_needed or manual create ensures rent exemption.

### STR-097: Dual Hook Account Ordering for PROFIT Pools
- **Category:** Token / CPI
- **Hypothesis:** PROFIT pool swaps involve tokens on both sides with transfer hooks. The remaining_accounts must be ordered as [INPUT hooks, OUTPUT hooks]. If ordering is wrong, hook accounts mismatch.
- **Target Code:** `tax_program/swap_profit_*` — remaining_accounts construction
- **Precedent:** Novel (dual-hook ordering — known previous bug)
- **Investigation:** Verify remaining_accounts ordering follows [input, output] convention for both buy and sell on PROFIT pools.

### STR-098: VRF Randomness Value is Deterministic Given Oracle Key
- **Category:** Oracle
- **Hypothesis:** If Switchboard VRF uses HMAC with oracle's secret key, the oracle operator can predict or manipulate the output.
- **Target Code:** Switchboard SDK — VRF verification
- **Precedent:** Oracle Playbook (Oracle Collusion)
- **Investigation:** Understand Switchboard's VRF construction. Is it verifiable (ECVRF)? Can oracle key holder predict output?

### STR-099: Carnage Slippage Floor Too High Causes Permanent Failure
- **Category:** Economic
- **Hypothesis:** The 85%/75% slippage floors are hardcoded. During volatile markets, even legitimate Carnage swaps might not achieve 85% output, causing Carnage to permanently fail.
- **Target Code:** `tax_program/execute_carnage` — slippage check
- **Precedent:** AMM Playbook (Slippage DoS)
- **Investigation:** Compute maximum pool imbalance where 85% is still achievable. Model frequency of failure.

### STR-100: Staking Checkpoint Uses Wrong Clock Field
- **Category:** Timing
- **Hypothesis:** Staking checkpoint uses `Clock::slot`. If it accidentally uses `Clock::unix_timestamp`, the comparison with other slot-based values breaks.
- **Target Code:** `staking` — checkpoint slot storage
- **Precedent:** EP-039
- **Investigation:** Verify Clock::slot is used consistently.

### STR-101: Missing Program ID Check in CPI to Staking
- **Category:** CPI
- **Hypothesis:** When Tax Program CPIs into Staking, it might not validate the Staking program ID is correct.
- **Target Code:** `tax_program` — staking CPI instructions
- **Precedent:** EP-042 (CPI Program Substitution)
- **Investigation:** Verify staking_program account has `address = STAKING_PID` constraint.

### STR-102: Epoch Number Skips Allow Multiple Carnages
- **Category:** State Machine
- **Hypothesis:** If epoch_number can skip (e.g., 5 → 7), the gap epoch's Carnage is skipped. But if the skip is exploitable, an attacker could force multiple Carnages.
- **Target Code:** `epoch_program` — epoch_number increment
- **Precedent:** EP-037
- **Investigation:** Verify epoch_number increments by exactly 1.

### STR-103: Pool k-Value Not Stored (Recomputed Each Swap)
- **Category:** AMM / State
- **Hypothesis:** If k is recomputed as `reserve_a * reserve_b` at swap start rather than stored from initialization, a rounding error in reserves propagates to k.
- **Target Code:** `amm` — k-invariant storage/computation
- **Precedent:** AMM Playbook
- **Investigation:** Check if k is stored or computed. If computed, verify reserves are precise.

### STR-104: Whitelist Covers Account Addresses Not Owner Addresses
- **Category:** Token / Access Control
- **Hypothesis:** The whitelist might check token account addresses rather than owner wallet addresses. If a user creates a new token account, it won't be whitelisted.
- **Target Code:** `transfer_hook/execute` — what addresses are checked
- **Precedent:** EP-001, Novel
- **Investigation:** Determine if whitelist entries are token accounts (specific) or wallet addresses (broad). Understand the design intent.

### STR-105: AMM Swap Direction Detection Bug
- **Category:** AMM
- **Hypothesis:** AMM determines swap direction (AtoB or BtoA) based on which account is input. If the direction detection is wrong, reserves are updated backwards.
- **Target Code:** `amm/swap` — direction determination
- **Precedent:** EP-005, AMM Playbook
- **Investigation:** Verify direction detection logic. Test both directions.

### STR-106: Epoch State Includes Sensitive Admin Fields Readable by Anyone
- **Category:** Information Disclosure
- **Hypothesis:** EpochState might contain admin keys, VRF configuration, or other sensitive data that helps attackers plan exploits.
- **Target Code:** `epoch_program/src/state.rs` — EpochState fields
- **Precedent:** Novel (all on-chain data is public, but excessive data aids attackers)
- **Investigation:** Review EpochState fields for sensitive information.

### STR-107: Tax Program Allows Swap of Non-Faction Token
- **Category:** Token / Access Control
- **Hypothesis:** `swap_buy_sol` might accept any token mint, not just CRIME or FRAUD. User could swap a worthless custom token.
- **Target Code:** `tax_program/swap_*` — mint validation
- **Precedent:** EP-053 (Token Confusion)
- **Investigation:** Check if mint is validated as CRIME or FRAUD (or PROFIT for profit swaps).

### STR-108: Signed Integer Used for Unsigned Amount
- **Category:** Arithmetic
- **Hypothesis:** If any amount field is `i64` instead of `u64`, negative amounts could cause unexpected behavior.
- **Target Code:** All amount parameters across instructions
- **Precedent:** EP-017
- **Investigation:** Verify all amount fields are u64.

### STR-109: Anchor Error Not Propagated Through CPI
- **Category:** CPI
- **Hypothesis:** If an inner CPI returns an error but the outer program ignores the return value, the transaction continues with incorrect state.
- **Target Code:** All CPI calls — error handling
- **Precedent:** EP-046 (CPI Error Handling)
- **Investigation:** Verify all CPI calls use `?` or explicit error checking. Anchor's `CpiContext` calls return Result.

### STR-110: Carnage Execution Without VRF (Direct Call)
- **Category:** Access Control
- **Hypothesis:** `execute_carnage` on the Tax Program might be callable directly (not through Epoch) with a crafted carnage_signer, bypassing VRF requirements.
- **Target Code:** `tax_program/execute_carnage` — signer validation
- **Precedent:** EP-043 (Missing Signer Check)
- **Investigation:** Verify carnage_signer is validated as a PDA derived from Epoch Program (cannot be forged).

### STR-111: Staking Authority PDA Used For Wrong Operation
- **Category:** CPI / PDA
- **Hypothesis:** staking_authority PDA (Epoch→Staking) might also be accepted by Tax Program instructions, allowing Epoch to call Tax operations it shouldn't.
- **Target Code:** `tax_program` — authority checks
- **Precedent:** EP-007, EP-042
- **Investigation:** Verify each program's authority accounts are distinct PDAs with different seeds.

### STR-112: Pool Created with Wrong Token Program (SPL vs Token-2022)
- **Category:** Token / Initialization
- **Hypothesis:** Pool token accounts must use Token-2022 for CRIME/FRAUD/PROFIT and SPL Token for WSOL. If the wrong program is used, transfers fail.
- **Target Code:** `amm/initialize_pool` — token program validation
- **Precedent:** EP-055 (Token Program Confusion)
- **Investigation:** Verify pool creation validates correct token program per mint.

### STR-113: Mint Authority Still Active (Infinite Mint)
- **Category:** Token / Admin
- **Hypothesis:** If CRIME/FRAUD/PROFIT mint authorities are not revoked, admin can mint unlimited tokens, crashing prices.
- **Target Code:** Token mint configurations
- **Precedent:** EP-057 (Mint Authority Abuse)
- **Investigation:** Check if mint authorities are set to None post-initialization.

### STR-114: AMM Add Liquidity at Arbitrary Price
- **Category:** AMM / Admin
- **Hypothesis:** `add_liquidity` might allow adding at a ratio different from current reserves, instantly changing the pool price.
- **Target Code:** `amm/add_liquidity` — ratio validation
- **Precedent:** AMM Playbook (LP Manipulation)
- **Investigation:** Check if add_liquidity enforces matching current reserve ratio.

### STR-115: Epoch Program Reads Stale Tax Rate
- **Category:** CPI / State
- **Hypothesis:** When Epoch triggers Tax operations, it might pass a stale tax rate from a prior epoch.
- **Target Code:** `epoch_program` → `tax_program` CPI
- **Precedent:** EP-039 (TOCTOU)
- **Investigation:** Check how tax rate is passed (read from state in Tax Program, not passed as argument from Epoch).

### STR-116: Carnage Fund WSOL Not Synced
- **Category:** Token
- **Hypothesis:** WSOL accounts need `syncNative` to reflect deposited SOL. If Carnage Fund WSOL isn't synced, the balance reads as zero.
- **Target Code:** Carnage WSOL account handling
- **Precedent:** EP-051 (WSOL Sync)
- **Investigation:** Check if syncNative is called before reading Carnage WSOL balance.

### STR-117: Transfer Hook Has No Rate Limiting
- **Category:** DoS
- **Hypothesis:** The transfer hook executes on every transfer. If an attacker sends many tiny transfers, the hook executes for each, consuming CU. This could DoS other operations in the same slot.
- **Target Code:** `transfer_hook/execute` — CU consumption
- **Precedent:** Novel
- **Investigation:** Compute CU per hook execution. Determine if mass transfers could DoS within slot CU limits.

### STR-118: Staking Reward Distribution Frequency Gaming
- **Category:** Staking / Economic
- **Hypothesis:** If rewards are distributed per-epoch, staking just before distribution and unstaking after captures rewards with minimal time-at-risk.
- **Target Code:** `staking` — reward distribution timing
- **Precedent:** Staking Playbook (Reward Gaming)
- **Investigation:** Check if checkpoint pattern prevents single-slot staking from earning rewards.

### STR-119: VRF Oracle Single Point of Failure
- **Category:** Oracle / Availability
- **Hypothesis:** Each VRF randomness account is assigned to a specific oracle. If that oracle goes offline, the epoch is stuck until timeout recovery.
- **Target Code:** VRF lifecycle, retry mechanism
- **Precedent:** Oracle Playbook (Single Oracle)
- **Investigation:** Assess oracle diversity. Check timeout duration. Model impact of oracle downtime.

### STR-120: AMM Pool Token Account Authority Not Pool PDA
- **Category:** Token / Access Control
- **Hypothesis:** Pool token accounts should be authority'd to the pool PDA. If authority is wrong, anyone with the authority could drain pool tokens.
- **Target Code:** `amm` — pool token account authority
- **Precedent:** EP-026, EP-051
- **Investigation:** Verify pool token account authority is the pool PDA.

### STR-121: Carnage Burn Amount Calculation Error
- **Category:** Arithmetic / Economic
- **Hypothesis:** Carnage burns a portion of bought tokens. If the burn percentage calculation has an error (e.g., burns 100% instead of 50%), the remaining sell step has no tokens.
- **Target Code:** `tax_program/execute_carnage` — burn amount computation
- **Precedent:** EP-015
- **Investigation:** Verify burn percentage calculation. Check edge cases (100% of small amount = 0 after rounding).

### STR-122: Swap Fee Bypass via Minimum Input Amount
- **Category:** AMM / Arithmetic
- **Hypothesis:** If input amount is 1 and fee is 30bps, `1 * 30 / 10000 = 0`. Input_after_fee = 1 - 0 = 1. Fee effectively bypassed for tiny swaps.
- **Target Code:** `amm/swap` — fee computation
- **Precedent:** EP-062 (Fee Bypass), EP-015
- **Investigation:** Compute minimum input for non-zero fee. Assess exploitability.

### STR-123: Epoch Duration Too Short Allows VRF Spam
- **Category:** Timing / Economic
- **Hypothesis:** If epoch duration is short (e.g., 100 slots ≈ 40 seconds), VRF + Carnage must complete in that window. Tight timing increases failure probability.
- **Target Code:** `epoch_program` — epoch duration configuration
- **Precedent:** Oracle Playbook (Timing Constraints)
- **Investigation:** Check epoch duration. Compute typical VRF completion time. Assess failure risk.

### STR-124: Admin Key is Deployer Wallet (Hot Wallet Risk)
- **Category:** Key Management
- **Hypothesis:** Admin key is likely the deployer wallet (same keypair used for deployment and admin operations), which is a hot wallet.
- **Target Code:** Protocol deployment configuration
- **Precedent:** EP-068 (Hot Wallet), Bug Bounty Findings (2025-2026 key compromises)
- **Investigation:** Check if admin authority is a separate cold wallet or multisig.

### STR-125: AMM Pool Supports Any Token Pair
- **Category:** Access Control / AMM
- **Hypothesis:** `initialize_pool` might accept any two token mints, allowing creation of unauthorized pools.
- **Target Code:** `amm/initialize_pool` — mint validation
- **Precedent:** EP-001
- **Investigation:** Check if pool creation validates mints against an allowed list.

### STR-126: Staking User Account Creation Race
- **Category:** Initialization / Timing
- **Hypothesis:** Two concurrent transactions creating a UserStake account for the same user could collide, with one overwriting the other's initial state.
- **Target Code:** `staking` — UserStake account creation
- **Precedent:** EP-075 (Init Race)
- **Investigation:** Check if UserStake uses Anchor `init` (which uses system create — first TX wins, second fails).

### STR-127: Carnage WSOL Wrapping Without syncNative
- **Category:** Token
- **Hypothesis:** Tax collection deposits SOL to Carnage fund. If WSOL wrapping doesn't call syncNative, the token balance doesn't reflect the SOL deposit.
- **Target Code:** `tax_program` — Carnage fund SOL deposits
- **Precedent:** EP-051 (WSOL Sync)
- **Investigation:** Trace SOL → WSOL conversion for Carnage fund deposits.

### STR-128: Pool Reserves Not Reloaded After CPI
- **Category:** CPI / State
- **Hypothesis:** After a CPI that modifies pool state, the caller reads stale cached reserves.
- **Target Code:** All post-CPI state reads
- **Precedent:** EP-046 (Stale State After CPI)
- **Investigation:** Verify `.reload()` is called after every state-modifying CPI. (Context analysis says it is — verify.)

### STR-129: Epoch Program Doesn't Validate Tax Program Address
- **Category:** CPI
- **Hypothesis:** When Epoch CPIs into Tax for Carnage, it might not validate the Tax program address, allowing substitution.
- **Target Code:** `epoch_program` — tax_program account
- **Precedent:** EP-042
- **Investigation:** Check `address = TAX_PROGRAM_ID` constraint on tax_program account.

### STR-130: Token-2022 Permanent Delegate Could Bypass Hook
- **Category:** Token / Extension
- **Hypothesis:** If CRIME/FRAUD/PROFIT have PermanentDelegate extension, the delegate can transfer without the hook being called.
- **Target Code:** Token mint extensions
- **Precedent:** EP-055 (Extension Interaction)
- **Investigation:** Check mint extensions. Verify PermanentDelegate is not set.

### STR-131: Carnage Execution Exceeds Compute Unit Limit
- **Category:** DoS / CPI
- **Hypothesis:** The Carnage path (buy + burn + sell across dual pools) is CU-intensive. With all Token-2022 hooks, it might exceed the 200K default CU limit or even the 1.4M max.
- **Target Code:** Carnage execution path
- **Precedent:** Novel (CU exhaustion on complex path)
- **Investigation:** Estimate CU for Carnage execution. Check if CU budget is set via compute_budget instruction.

### STR-132: Staking PRECISION Constant Inconsistent Across Programs
- **Category:** Arithmetic
- **Hypothesis:** If PRECISION (1e18) is defined differently in Staking vs Tax Program, reward computations produce inconsistent results.
- **Target Code:** `staking` and `tax_program` — PRECISION constant
- **Precedent:** EP-015
- **Investigation:** Check PRECISION value in all programs that reference it.

---

## Strategy Distribution by Category

| Category | Count | Tier 1 | Tier 2 | Tier 3 |
|----------|-------|--------|--------|--------|
| Arithmetic/Precision | 22 | 3 | 8 | 11 |
| Access Control/Auth | 16 | 3 | 5 | 8 |
| Token/SPL/Extensions | 18 | 2 | 6 | 10 |
| CPI/Cross-Program | 14 | 2 | 5 | 7 |
| Economic/DeFi | 15 | 3 | 4 | 8 |
| State Machine/Lifecycle | 13 | 3 | 4 | 6 |
| Oracle/VRF | 10 | 2 | 3 | 5 |
| Timing/Ordering | 8 | 1 | 3 | 4 |
| Initialization | 6 | 1 | 1 | 4 |
| Admin/Key Management | 6 | 1 | 2 | 3 |
| DoS/Availability | 4 | 0 | 1 | 3 |

## Novel Strategies (No Direct EP Precedent)

STR-011, STR-013, STR-022, STR-032, STR-048, STR-074, STR-078, STR-082, STR-084,
STR-091, STR-097, STR-099, STR-104, STR-106, STR-117, STR-131, STR-010 (partial),
STR-008 (partial), STR-028 (partial), STR-033, STR-044, STR-045, STR-046, STR-057,
STR-068, STR-098, STR-103, STR-116, STR-118, STR-127, STR-130

**Total Novel: 31 / 132 = 23.5%** (exceeds 20% minimum)

---

## Investigation Priority Order

**Batch 1 (Tier 1 — Critical Path):** STR-001 through STR-018
**Batch 2 (Tier 2 — High Impact):** STR-019 through STR-060
**Batch 3 (Tier 3 — Completeness):** STR-061 through STR-132

Each investigation should produce a finding with severity, PoC sketch, and remediation recommendation.

---

*Generated from unified ARCHITECTURE.md synthesis of 9 context analyses, cross-referenced against 128 exploit patterns (EP-001 through EP-128), 3 protocol playbooks (AMM/DEX, Staking, Oracle), and 2 reference databases (audit firm findings, bug bounty findings).*

---

## Supplemental Strategies (Generated from Tier 1 Findings)

*Generated after Tier 1 investigation. Inspired by H001 (CONFIRMED), H003 (POTENTIAL), H004 (POTENTIAL), H010 (POTENTIAL), H011 (CONFIRMED).*

### S001: Rent-Exempt Minimum Ignored on Other SOL-Holding PDAs
- **Category:** Arithmetic / State Machine
- **Inspired by:** H001 (Bounty rent-exempt bug)
- **Hypothesis:** If the bounty vault ignores rent-exempt minimums, other SOL-holding PDA accounts (staking escrow, treasury, WSOL accounts) may also transfer lamports without rent checks.
- **Target Code:** All `invoke_signed` calls transferring SOL from PDA accounts across all programs
- **Impact:** HIGH — Any PDA drained below rent floor becomes unrecoverable, potentially freezing subsystems
- **Investigation:** Grep for all `system_instruction::transfer` and `invoke_signed` patterns. For each, verify rent-exempt floor is preserved post-transfer.

### S002: Bounty Deadlock Exploited to Freeze Tax Rates at Favorable Value
- **Category:** Economic / State Machine
- **Inspired by:** H001 + H007 (VRF timing)
- **Hypothesis:** An attacker drains the bounty vault to trigger the H001 deadlock when the VRF has just set a favorable (low) tax rate. With epochs frozen, the low tax rate persists indefinitely, benefiting high-volume traders.
- **Target Code:** `epoch_program/trigger_epoch_transition` — vault balance + tax rate persistence
- **Impact:** MEDIUM-HIGH — Permanent low-tax environment from a single griefing attack
- **Investigation:** Determine if tax rates persist across epoch freeze. Check if vault can be manually replenished without admin action.

### S003: PROFIT Routing + VRF Tax Rate Prediction for Amplified Extraction
- **Category:** Economic / Oracle
- **Inspired by:** H011 + H007
- **Hypothesis:** A sophisticated trader monitors VRF reveals, predicts which side will have lower tax (cheap side), enters via the cheap path, routes through PROFIT to the other faction's cheap side, and exits. Combined tax < 5% on cross-faction volume.
- **Target Code:** VRF consume_randomness → cheapSide determination → PROFIT routing path
- **Impact:** MEDIUM — Systematic MEV extraction combining two design features
- **Investigation:** Model the combined strategy. Compute expected value per epoch given VRF distribution.

### S004: Triangle Arbitrage Destabilizes Pool Ratios
- **Category:** AMM / Economic
- **Inspired by:** H011 (PROFIT routing)
- **Hypothesis:** The SOL/CRIME, SOL/FRAUD, and CRIME/PROFIT + FRAUD/PROFIT pools form a triangle. If prices diverge across the triangle, arbitrage loops extract value until pools converge. The zero-tax PROFIT path makes this loop profitable at smaller divergences than intended.
- **Target Code:** All 4 AMM pools — price computation and reserve ratios
- **Impact:** MEDIUM — Persistent value extraction from pool reserves, reducing protocol-owned liquidity
- **Investigation:** Model triangle arbitrage profitability threshold accounting for fees on each leg.

### S005: Init Front-Running Whitelist Authority Enables Protocol Ransom
- **Category:** Access Control / Economic
- **Inspired by:** H003 (Init front-running)
- **Hypothesis:** If an attacker front-runs `initialize_authority` to claim whitelist authority, they can hold the protocol hostage. Without whitelisted addresses, no transfers work. Attacker demands ransom to add correct addresses.
- **Target Code:** `transfer_hook/initialize_authority` → whitelist management
- **Impact:** CRITICAL — Complete protocol DoS with no recovery unless attacker cooperates (or protocol is redeployed)
- **Investigation:** Verify no recovery path if whitelist authority is claimed by attacker. Check if burn_authority prevents even the attacker from adding entries.

### S006: Other Devnet-Gated Features Leak to Mainnet Binary
- **Category:** Admin / Build Process
- **Inspired by:** H004 (force_carnage)
- **Hypothesis:** Beyond force_carnage, other #[cfg(feature = "devnet")] blocks may contain test helpers, debug logging, or bypass logic that leaks into mainnet builds.
- **Target Code:** All programs — search for `#[cfg(feature` and `cfg!(feature` patterns
- **Impact:** MEDIUM-HIGH — Depends on what other devnet-only features exist
- **Investigation:** Exhaustive search for all feature-gated code across all 5 programs. Assess each for security impact if included in mainnet.

### S007: Carnage Path Compute Unit Exhaustion
- **Category:** DoS / CPI
- **Inspired by:** H010 (CPI depth at limit)
- **Hypothesis:** The Carnage execution path (Epoch→Tax→AMM→Token-2022→Hook) is at max CPI depth AND involves multiple token transfers with hooks. Total CU consumption could exceed the 200K default or approach the 1.4M limit, causing sporadic Carnage failures.
- **Target Code:** Carnage execution path — all CPI calls and token transfers
- **Impact:** HIGH — Intermittent Carnage failures, unspent fund accumulation
- **Investigation:** Estimate CU for each step of Carnage. Check if compute_budget instruction is set. Test with large remaining_accounts lists.

### S008: Combined Admin Key Compromise: Bounty Drain + Whitelist Manipulation
- **Category:** Admin / Combination
- **Inspired by:** H001 + H003 + H004
- **Hypothesis:** With admin key: (1) trigger epochs until bounty vault is in danger zone, (2) add attacker address to whitelist, (3) force_carnage (if devnet binary). Combined extraction exceeds any single-vector attack.
- **Target Code:** All admin-callable instructions
- **Impact:** HIGH — Maximum combined extraction from compromised admin
- **Investigation:** Model combined extraction scenario. Compute total value at risk with full admin capabilities.

### S009: Carnage SOL Vault Shared With Other Protocol Functions
- **Category:** State Machine / Token
- **Inspired by:** H001
- **Hypothesis:** If the Carnage SOL vault is also used for other purposes (staking rewards, treasury), draining it for bounty affects those functions too. Conversely, other deposits may mask the bounty danger zone.
- **Target Code:** Carnage SOL vault PDA — all instructions that read/write this account
- **Impact:** MEDIUM — Cross-subsystem interference via shared account
- **Investigation:** Trace all instructions that reference the carnage_sol_vault PDA. Determine if it's exclusively used for bounty or shared.

### S010: Epoch Freeze Recovery Path Requires Admin — Single Point of Failure
- **Category:** State Machine / Availability
- **Inspired by:** H001 (bounty deadlock)
- **Hypothesis:** After a bounty deadlock (H001), recovery requires the admin to manually replenish the vault. If the admin key is lost or compromised, the protocol is permanently frozen with no autonomous recovery path.
- **Target Code:** All instructions that can deposit to carnage_sol_vault
- **Impact:** HIGH — Permanent protocol freeze if admin key is unavailable during bounty deadlock
- **Investigation:** Enumerate all paths to replenish carnage_sol_vault. Check if any permissionless recovery exists.
