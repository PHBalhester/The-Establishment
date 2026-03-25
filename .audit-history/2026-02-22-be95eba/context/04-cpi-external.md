# Focus Area 04: CPI & External Calls
<!-- Context auditor output for Stronghold of Security Phase 1 -->
<!-- Generated: 2026-02-22 -->
<!-- Auditor: CPI & External Calls Analyzer -->

---

## CONDENSED_SUMMARY

### Architecture Overview

Five Anchor programs interact via CPI in a hub-and-spoke topology:
- **AMM** (5ANTHFtg): Constant-product swap engine. Entry only via Tax Program's `swap_authority` PDA.
- **Tax Program** (DRjNCjt4): User-facing swap router. Applies taxes, distributes SOL, CPIs into AMM and Staking.
- **Epoch Program** (G6dmJTdC): VRF-driven epoch transitions and Carnage execution. CPIs into Tax (swap_exempt) and Staking (update_cumulative).
- **Staking** (EZFeU613): Reward distribution. Entry-gated by Tax (`tax_authority` PDA) and Epoch (`staking_authority` PDA).
- **Transfer Hook** (CmNyuLdM): Whitelist-based transfer hook invoked by Token-2022 runtime during `transfer_checked`.

### CPI Call Graph (Depth Chain)

```
User TX
  |
  +-- Tax::swap_sol_buy/sell (depth 0)
  |     +-- Staking::deposit_rewards (depth 1) [via tax_authority PDA]
  |     +-- AMM::swap_sol_pool (depth 1) [via swap_authority PDA]
  |           +-- Token-2022::transfer_checked (depth 2)
  |                 +-- Transfer Hook::execute (depth 3)
  |
  +-- Tax::swap_profit_buy/sell (depth 0)
  |     +-- AMM::swap_profit_pool (depth 1) [via swap_authority PDA]
  |           +-- Token-2022::transfer_checked x2 (depth 2, dual-hook)
  |                 +-- Transfer Hook::execute (depth 3, per side)
  |
  +-- Tax::swap_exempt (depth 0, called by Epoch only)
  |     +-- AMM::swap_sol_pool (depth 1) [via swap_authority PDA]
  |           +-- Token-2022::transfer_checked (depth 2)
  |                 +-- Transfer Hook::execute (depth 3)
  |
  +-- Epoch::execute_carnage_atomic (depth 0, permissionless)
  |     +-- Tax::swap_exempt (depth 1) [via carnage_signer PDA]
  |           +-- AMM::swap_sol_pool (depth 2)
  |                 +-- Token-2022::transfer_checked (depth 3)
  |                       +-- Transfer Hook::execute (depth 4) ** SOLANA LIMIT **
  |
  +-- Epoch::execute_carnage [fallback] (depth 0, permissionless)
  |     +-- Tax::swap_exempt (depth 1) [via carnage_signer PDA]
  |           +-- AMM::swap_sol_pool (depth 2)
  |                 +-- Token-2022::transfer_checked (depth 3)
  |                       +-- Transfer Hook::execute (depth 4) ** SOLANA LIMIT **
  |
  +-- Epoch::consume_randomness (depth 0)
        +-- Staking::update_cumulative (depth 1) [via staking_authority PDA]
```

Max observed CPI depth: **4** (execute_carnage_atomic/fallback -> Tax -> AMM -> T22 -> Hook). This hits the current Solana runtime limit exactly. Agave 3.0 raises this to 8, providing headroom but no new attack surface since the protocol does not allow arbitrary CPI nesting.

### Cross-Program PDA Validation Matrix

| PDA Name | Seed | Derived By | Validated By | Mechanism |
|----------|------|------------|-------------|-----------|
| swap_authority | `b"swap_authority"` | Tax Program | AMM | `seeds::program = TAX_PROGRAM_ID` (hardcoded pubkey in AMM constants) |
| carnage_signer | `b"carnage_signer"` | Epoch Program | Tax (swap_exempt) | `seeds::program = epoch_program_id()` |
| staking_authority | `b"staking_authority"` | Epoch Program | Staking (update_cumulative) | `seeds::program = epoch_program_id()` |
| tax_authority | `b"tax_authority"` | Tax Program | Staking (deposit_rewards) | `seeds::program = tax_program_id()` |

All seeds are consistent across programs. Program IDs cross-reference correctly:
- AMM: `TAX_PROGRAM_ID = "DRjNCjt4..."` (hardcoded `Pubkey`)
- Tax: `amm_program_id() = "5ANTHFtg..."`, `epoch_program_id() = "G6dmJTdC..."`, `staking_program_id() = "EZFeU613..."`
- Epoch: `tax_program_id() = "DRjNCjt4..."`, `amm_program_id() = "5ANTHFtg..."`, `staking_program_id() = "EZFeU613..."`
- Staking: `tax_program_id() = "DRjNCjt4..."`, `epoch_program_id() = "G6dmJTdC..."`

### CPI Program Target Validation

| Caller | Target | Validation Mechanism |
|--------|--------|---------------------|
| Tax -> AMM | `address = amm_program_id()` | Hardcoded address check on `amm_program` AccountInfo |
| Tax -> Staking | `address = staking_program_id()` | Hardcoded address check on `staking_program` AccountInfo |
| Epoch -> Tax | `address = tax_program_id()` | Hardcoded address check on `tax_program` AccountInfo |
| Epoch -> AMM | `address = amm_program_id()` | Hardcoded address check on `amm_program` AccountInfo |
| Epoch -> Staking | `address = staking_program_id()` | Hardcoded address check on `staking_program` AccountInfo |
| AMM -> T22 | Pool stores `token_program_a/b`; constraint validates against stored value | Defense-in-depth: `require!(*token_program.key == T22_ID)` in transfer helper |
| Tax -> T22 | `Interface<TokenInterface>` type | Accepts both Token and Token-2022 |
| Staking -> T22 | `Interface<TokenInterface>` type | No defense-in-depth ID check in transfer helper (unlike AMM) |

### Findings Summary

| ID | Severity | Title | Location |
|----|----------|-------|----------|
| CPI-01 | INFO | `constraint = true` placeholder constraints | swap_sol_buy.rs:436,447; swap_sol_sell.rs:575,586 |
| CPI-02 | LOW | Staking transfer helper lacks defense-in-depth token program ID check | staking/helpers/transfer.rs |
| CPI-03 | INFO | force_carnage devnet instruction must be removed before mainnet | epoch-program/instructions/force_carnage.rs |
| CPI-04 | INFO | swap_exempt passes minimum_amount_out=0 to AMM (by design) | tax-program/instructions/swap_exempt.rs |
| CPI-05 | INFO | swap_sol_sell passes amm_minimum=0 to AMM (by design, Tax checks post-CPI) | tax-program/instructions/swap_sol_sell.rs |
| CPI-06 | INFO | CPI depth 4/4 on Carnage path -- zero headroom on current runtime | epoch-program/instructions/execute_carnage_atomic.rs, execute_carnage.rs |
| CPI-07 | INFO | Pool accounts in execute_carnage are AccountInfo CPI passthroughs | epoch-program/instructions/execute_carnage.rs, execute_carnage_atomic.rs |
| CPI-08 | KNOWN | Bounty rent-exempt bug in trigger_epoch_transition | epoch-program/instructions/trigger_epoch_transition.rs |

### Exploit Pattern Coverage

| Pattern | ID | Status | Notes |
|---------|----|--------|-------|
| Arbitrary CPI Program Substitution | EP-042 | CLEAR | All CPI targets validated via `address =` constraints with hardcoded program IDs |
| CPI Signer Authority Escalation | EP-043 | CLEAR | PDA signers scoped to specific seeds; no user key forwarding to untrusted programs |
| Privilege Propagation Through CPI | EP-044 | CLEAR | Signer privileges properly scoped via PDA seeds with program-specific derivation |
| Error Propagation / Silent Failure | EP-045 | CLEAR | All `invoke_signed` calls use `?` operator; no silent error swallowing |
| Stale State After CPI | EP-046 | CLEAR | All balance reads after CPI use `.reload()` (swap_sol_buy, swap_sol_sell, swap_profit_buy, swap_profit_sell, execute_carnage, execute_carnage_atomic) |
| Unverified Token Program in CPI | EP-047 | CLEAR (AMM), LOW (Staking) | AMM has defense-in-depth check; Staking relies only on Interface<> type constraint |
| Account Injection via remaining_accounts | EP-048 | CLEAR | remaining_accounts forwarded as CPI passthroughs; validated downstream by Token-2022 and Transfer Hook |
| CPI Reentrancy | EP-049 | CLEAR | AMM reentrancy guard (pool.locked); Solana runtime prevents same-program re-entry during CPI |
| CPI Depth Exhaustion | EP-050 | INFO | Carnage path hits exactly 4/4 depth; no failure observed but zero headroom |

---

## FULL ANALYSIS

### 1. CPI Chain Tracing

#### 1.1 User Swap Paths (Tax -> AMM -> T22 -> Hook)

**swap_sol_buy** (`/programs/tax-program/src/instructions/swap_sol_buy.rs`):
- Depth 0: Tax Program handler
  - Tax calculation (checked arithmetic throughout)
  - System transfer to staking_escrow (75%), carnage_vault (24%), treasury (1%)
  - CPI to Staking::deposit_rewards via `invoke_signed` with tax_authority PDA (depth 1)
  - CPI to AMM::swap_sol_pool via `invoke_signed` with swap_authority PDA (depth 1)
    - AMM executes swap, CPIs to Token-2022 (depth 2)
      - T22 invokes Transfer Hook (depth 3)
  - Post-CPI: `.reload()` on user_token_b and pool_vault_b for balance measurement

**swap_sol_sell** (`/programs/tax-program/src/instructions/swap_sol_sell.rs`):
- Same depth profile as swap_sol_buy
- Notable: passes `amm_minimum: u64 = 0` to AMM. This is intentional -- Tax Program checks slippage AFTER the CPI and AFTER extracting tax from the output. If AMM enforced its own minimum, it would conflict with the tax extraction flow.
- Raw `invoke()` for user-signed SPL transfers (lines 282, 444) -- user is the signer, not a PDA, so `invoke()` (not `invoke_signed`) is correct.

**swap_profit_buy** (`/programs/tax-program/src/instructions/swap_profit_buy.rs`):
- Untaxed path (no tax distribution, no Staking CPI)
- CPI to AMM::swap_profit_pool via `invoke_signed` with swap_authority PDA
- Dual T22 hooks: remaining_accounts forwarded entirely, AMM splits at midpoint
- Post-CPI: `.reload()` on output token account

**swap_profit_sell** (`/programs/tax-program/src/instructions/swap_profit_sell.rs`):
- Mirror of swap_profit_buy with reversed direction
- Same CPI and remaining_accounts forwarding pattern

**swap_exempt** (`/programs/tax-program/src/instructions/swap_exempt.rs`):
- Called ONLY by Epoch Program (gated by `carnage_authority: Signer` with `seeds::program = epoch_program_id()`)
- No tax applied, MINIMUM_OUTPUT = 0 (intentional per Carnage spec -- protocol-owned funds)
- CPI to AMM::swap_sol_pool via `invoke_signed` with swap_authority PDA
- Adds depth 1 when called from execute_carnage_atomic (total chain reaches depth 4)

#### 1.2 Carnage Execution Path (CRITICAL -- Max Depth)

**execute_carnage_atomic** (`/programs/epoch-program/src/instructions/execute_carnage_atomic.rs`):

Pre-swap operations at depth 0 (no impact on CPI chain):
1. Token-2022 burn (if action=Burn): `invoke_signed` to token_program_b
2. Token-2022 approve delegate (if action=Sell): `invoke_signed` to token_program_b
3. System transfer + SyncNative (SOL -> WSOL wrap): `invoke_signed` to system_program + token_program_a

Swap CPI chain:
```
execute_carnage_atomic (depth 0)
  -> Tax::swap_exempt (depth 1) via carnage_signer PDA
    -> AMM::swap_sol_pool (depth 2) via swap_authority PDA
      -> Token-2022::transfer_checked (depth 3)
        -> Transfer Hook::execute (depth 4)  ** EXACTLY AT LIMIT **
```

For the Sell path, there are TWO sequential swap_exempt CPIs (sell held tokens, then buy target tokens), each independently reaching depth 4. They are sequential, not nested.

remaining_accounts partitioning:
- Sell action: `remaining_accounts[..4]` = sell hook accounts, `remaining_accounts[4..]` = buy hook accounts
- Burn/BuyOnly: `remaining_accounts[..0]` = empty (no sell), `remaining_accounts[..]` = buy hook accounts
- Constant: `HOOK_ACCOUNTS_PER_MINT = 4` (extra_account_meta_list, whitelist_source, whitelist_dest, hook_program)

Slippage protection:
- Atomic path: 85% floor (CARNAGE_SLIPPAGE_BPS = 8500)
- Fallback path: 75% floor (CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500)
- MAX_CARNAGE_SWAP_LAMPORTS = 1000 SOL cap

**execute_carnage** [fallback] (`/programs/epoch-program/src/instructions/execute_carnage.rs`):
- Identical CPI chain as atomic, with same depth profile
- Additional lock window validation: `clock.slot > epoch_state.carnage_lock_slot` (prevents front-running of atomic path)
- More lenient slippage (75% vs 85%) -- prioritizes execution in recovery mode
- Same remaining_accounts partitioning logic

#### 1.3 Epoch -> Staking Path

**consume_randomness** (`/programs/epoch-program/src/instructions/consume_randomness.rs`):
- CPI to Staking::update_cumulative via `invoke_signed` with staking_authority PDA (depth 1)
- Staking program validated via `address = staking_program_id()`
- Manual instruction building with precomputed discriminator (verified by unit test)

**trigger_epoch_transition** (`/programs/epoch-program/src/instructions/trigger_epoch_transition.rs`):
- Bounty payment via `invoke_signed` from carnage_sol_vault PDA
- KNOWN BUG: Does not account for rent-exempt minimum when checking vault balance (documented in MEMORY.md)

### 2. Program Account Validation Analysis

#### 2.1 AMM Access Control

File: `/programs/amm/src/instructions/swap_sol_pool.rs`

The AMM is the innermost program in the CPI chain. Its access control is the most critical:

```rust
#[account(
    seeds = [SWAP_AUTHORITY_SEED],
    bump,
    seeds::program = TAX_PROGRAM_ID,
)]
pub swap_authority: Signer<'info>,
```

`TAX_PROGRAM_ID` is a hardcoded `Pubkey` in `/programs/amm/src/constants.rs`. This means:
1. Only the Tax Program can derive this PDA
2. Only the Tax Program can sign CPIs with this PDA
3. The AMM cannot be called directly by users for swaps (they must go through Tax)

Additional AMM validations:
- Pool vaults: `constraint = vault_a.key() == pool.vault_a` and `constraint = vault_b.key() == pool.vault_b`
- Mints: `constraint = mint_a.key() == pool.mint_a` and `constraint = mint_b.key() == pool.mint_b`
- Token programs: `constraint = token_program_a.key() == pool.token_program_a` and `token_program_b.key() == pool.token_program_b`
- Reentrancy: `constraint = !pool.locked` + set locked=true during swap, released at end

#### 2.2 Staking Access Control

File: `/programs/staking/src/instructions/deposit_rewards.rs`

```rust
#[account(
    seeds = [TAX_AUTHORITY_SEED],
    bump,
    seeds::program = tax_program_id(),
)]
pub tax_authority: Signer<'info>,
```

File: `/programs/staking/src/instructions/update_cumulative.rs`

```rust
#[account(
    seeds = [STAKING_AUTHORITY_SEED],
    bump,
    seeds::program = epoch_program_id(),
)]
pub epoch_authority: Signer<'info>,
```

Both entry points are properly gated by cross-program PDA signers.

#### 2.3 Tax Program (swap_exempt) Access Control

File: `/programs/tax-program/src/instructions/swap_exempt.rs`

```rust
#[account(
    seeds = [CARNAGE_SIGNER_SEED],
    bump,
    seeds::program = epoch_program_id(),
)]
pub carnage_authority: Signer<'info>,
```

Only the Epoch Program can sign CPIs with the carnage_signer PDA.

### 3. Token Program Validation

#### 3.1 AMM Transfer Helper (Defense-in-Depth)

File: `/programs/amm/src/helpers/transfers.rs`

```rust
pub fn transfer_t22_checked<'info>(...) -> Result<()> {
    // Defense-in-depth: explicitly verify token program ID
    require!(
        *token_program.key == anchor_spl::token_2022::ID
            || *token_program.key == anchor_spl::token::ID,
        AmmError::InvalidTokenProgram
    );
    // ... builds manual invoke_signed for T22 transfer_checked
}
```

This is exemplary -- even though the pool stores the token program and the constraint validates it, the transfer helper double-checks. It also rejects zero amounts (`require!(amount > 0, AmmError::ZeroAmountSwap)`).

#### 3.2 Staking Transfer Helper (No Defense-in-Depth)

File: `/programs/staking/src/helpers/transfer.rs`

The staking transfer helper builds a manual `spl_token_2022::instruction::transfer_checked` instruction using the passed `token_program` AccountInfo key, but does NOT include an explicit program ID validation like the AMM helper does. It relies solely on the `Interface<TokenInterface>` type constraint at the Accounts struct level.

This is not a vulnerability because `Interface<TokenInterface>` validates that the account is either the SPL Token or Token-2022 program. However, it lacks the defense-in-depth that the AMM helper provides. If the Accounts struct constraint were ever weakened (e.g., switching to `AccountInfo`), the transfer helper would not catch it.

**Finding CPI-02 (LOW)**: Staking transfer helper should add defense-in-depth token program ID validation to match the AMM pattern.

### 4. remaining_accounts Analysis

#### 4.1 SOL Pool Swaps (Single Hook)

In SOL pool swaps (`swap_sol_pool.rs`, `swap_sol_buy.rs`, `swap_sol_sell.rs`), only the Token-2022 side (side B) has a transfer hook. All remaining_accounts are forwarded to the single T22 transfer.

Token-2022 validates the hook accounts itself -- the ExtraAccountMetaList PDA is derived from the mint, and the hook program verifies it matches. The AMM doesn't need to validate remaining_accounts because it's just a passthrough.

#### 4.2 PROFIT Pool Swaps (Dual Hook)

In PROFIT pool swaps (`swap_profit_pool.rs`, `swap_profit_buy.rs`, `swap_profit_sell.rs`), both sides are Token-2022 with hooks. The remaining_accounts are split at the midpoint:

```rust
let midpoint = ctx.remaining_accounts.len() / 2;
let hook_accounts_a = &ctx.remaining_accounts[..midpoint];
let hook_accounts_b = &ctx.remaining_accounts[midpoint..];
```

The first half goes to the input transfer, the second half to the output transfer. The split is convention-based (client must provide them in correct order). This is safe because:
1. If the wrong accounts are in the wrong half, Token-2022 will reject the transfer (hook PDA mismatch)
2. The client resolves hook accounts per-mint, so the ordering is deterministic

#### 4.3 Carnage Execution (Partitioned)

In execute_carnage_atomic and execute_carnage, remaining_accounts are partitioned based on the action:

```rust
const HOOK_ACCOUNTS_PER_MINT: usize = 4;
if action == Sell && remaining.len() >= 8 {
    sell_hook = remaining[..4];
    buy_hook = remaining[4..];
} else {
    sell_hook = empty;
    buy_hook = remaining[..]; // all for buy
}
```

Each swap_exempt CPI gets only its relevant hook accounts. This prevents cross-contamination and ensures each T22 transfer sees the correct ExtraAccountMetaList for its specific mint.

#### 4.4 Security Assessment

Per EP-048 (Account Injection via remaining_accounts) and FP-015 (remaining_accounts usage):

The remaining_accounts in this protocol are exclusively used as CPI passthroughs for Token-2022 Transfer Hook resolution. They are never used for sensitive operations (transfers, authority checks) within the calling program. Token-2022 itself validates the hook accounts against the ExtraAccountMetaList PDA derived from the mint. The Transfer Hook program further validates:
- `mint.owner == Token-2022 ID` (line-level check)
- `transferring` flag is set (prevents direct invocation)
- Whitelist PDA derivation matches the token accounts

**Assessment: CLEAR** -- remaining_accounts are properly isolated as CPI passthroughs with downstream validation.

### 5. Signer Propagation Analysis

#### 5.1 PDA Signer Chains

**User -> Tax -> AMM**: User signs the outer TX. Tax derives `swap_authority` PDA and signs the AMM CPI with `invoke_signed`. User signer is also forwarded to AMM (as `user` account) but AMM validates user via pool constraints, not signer privilege.

**Epoch -> Tax -> AMM**: Epoch derives `carnage_signer` PDA and signs the Tax CPI. Tax derives `swap_authority` PDA and signs the AMM CPI. No user signer -- Carnage is protocol-owned.

**Epoch -> Staking**: Epoch derives `staking_authority` PDA and signs the Staking CPI. Only epoch_authority is a signer.

**Tax -> Staking**: Tax derives `tax_authority` PDA and signs the Staking CPI. Only tax_authority is a signer.

#### 5.2 Signer Escalation Check (EP-043)

No user-provided signers are forwarded to untrusted programs. All CPI targets are hardcoded program IDs. PDA signers are scoped to specific seeds that only the deriving program can produce.

In `swap_profit_buy` and `swap_profit_sell`, both `swap_authority` (PDA signer) and `user` (TX signer) are forwarded to AMM. The AMM validates both:
- `swap_authority` via `seeds::program = TAX_PROGRAM_ID`
- `user` is marked `Signer<'info>` in AMM (validated by runtime)

This is safe because the AMM is a trusted, hardcoded program. The user's signer privilege reaching the AMM is by design (user needs to authorize their token transfers).

### 6. Error Handling Analysis

All `invoke_signed` calls use the `?` operator, which propagates errors up the call stack. There is no silent error swallowing.

Specific patterns verified:
- `invoke_signed(&ix, &account_infos, &[seeds])?;` -- in all CPI calls across all programs
- `.reload()?` -- all post-CPI balance reads
- `checked_sub`, `checked_add`, `checked_mul`, `checked_div` -- all financial arithmetic

The only unchecked arithmetic observed is the `as u64` truncation after u128 intermediate calculations. These are safe because the intermediate results are bounded by token supply (u64 max) and the division ensures the result fits in u64.

### 7. Detailed Findings

#### CPI-01: `constraint = true` Placeholder Constraints (INFO)

**Location**:
- `/programs/tax-program/src/instructions/swap_sol_buy.rs:436` (staking_escrow)
- `/programs/tax-program/src/instructions/swap_sol_buy.rs:447` (carnage_vault)
- `/programs/tax-program/src/instructions/swap_sol_sell.rs:575` (staking_escrow)
- `/programs/tax-program/src/instructions/swap_sol_sell.rs:586` (carnage_vault)

**Description**: Four accounts have `constraint = true @ TaxError::InvalidXxx` which always passes. These appear to be placeholder constraints that were never replaced with real validation logic.

**Impact**: None. The accounts are already fully validated by their `seeds` + `seeds::program` constraints, which deterministically verify the PDA address. The `constraint = true` is dead code.

**Recommendation**: Remove the dead constraints or replace with meaningful validation for code clarity. The error types (`InvalidStakingEscrow`, `InvalidCarnageVault`) will never be triggered.

#### CPI-02: Staking Transfer Helper Lacks Defense-in-Depth Token Program Check (LOW)

**Location**: `/programs/staking/src/helpers/transfer.rs`

**Description**: The staking program's `transfer_checked_with_hook` helper builds a Token-2022 CPI using the `token_program` AccountInfo key directly, without verifying it is actually the Token-2022 or SPL Token program ID. The AMM's equivalent helper (`transfer_t22_checked` in `/programs/amm/src/helpers/transfers.rs`) includes an explicit `require!(*token_program.key == T22_ID || *token_program.key == SPL_TOKEN_ID)` check.

**Impact**: Low. The `Interface<TokenInterface>` constraint at the Accounts struct level already validates the program ID. This finding is about defense-in-depth consistency rather than an exploitable vulnerability.

**Recommendation**: Add `require!(*token_program.key == spl_token_2022::ID)` at the top of the staking transfer helper, matching the AMM pattern.

#### CPI-03: force_carnage Devnet Instruction Must Be Removed (INFO)

**Location**: `/programs/epoch-program/src/instructions/force_carnage.rs`

**Description**: A devnet-only instruction that allows the deployer wallet (`8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4`) to force-set `carnage_pending` state on EpochState without VRF trigger.

**Mitigations**: Gated by `#[cfg(feature = "devnet")]` at module level, and constrained to the specific devnet admin pubkey. The file header states "MUST BE REMOVED BEFORE MAINNET DEPLOYMENT."

**Impact**: None on devnet. If the devnet feature flag were accidentally enabled on mainnet, the admin key constraint would still prevent unauthorized use (unless the deployer key is compromised).

**Recommendation**: Add to mainnet deployment checklist. Consider a CI check that `force_carnage` is not compiled into non-devnet builds.

#### CPI-04: swap_exempt Passes minimum_amount_out=0 (INFO)

**Location**: `/programs/tax-program/src/instructions/swap_exempt.rs`

**Description**: The `MINIMUM_OUTPUT` constant is set to 0, meaning the AMM swap has no slippage floor from Tax's perspective.

**Justification**: This is by design. Carnage execution operates on protocol-owned funds. The Epoch Program applies its own slippage check (85% atomic / 75% fallback) AFTER the swap completes, calculated against pre-swap pool reserves. The zero minimum at the AMM level avoids double-checking and potential interference with the Epoch-level slippage logic.

#### CPI-05: swap_sol_sell Passes amm_minimum=0 (INFO)

**Location**: `/programs/tax-program/src/instructions/swap_sol_sell.rs`

**Description**: The AMM CPI uses `minimum_amount_out = 0` for the swap.

**Justification**: By design. Tax Program extracts tax from the output AFTER the swap, then checks the user's minimum against the net (post-tax) amount. If the AMM enforced its own minimum, it would need to account for tax, creating tight coupling. The Tax Program's post-CPI slippage check is the authoritative one.

#### CPI-06: CPI Depth 4/4 on Carnage Path (INFO)

**Location**:
- `/programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- `/programs/epoch-program/src/instructions/execute_carnage.rs`

**Description**: The Carnage execution path reaches exactly CPI depth 4 (Epoch -> Tax -> AMM -> T22 -> Hook), which is the current Solana runtime limit.

**Impact**: Zero headroom means:
1. No additional CPI can be added to the Carnage swap path without redesign
2. Any future change that adds depth (e.g., wrapping the hook) would fail
3. Agave 3.0 (CPI depth 8) resolves this but is not yet universally deployed

**Note**: Pre-swap operations (burn, approve, wrap_sol, sync_native) execute at depth 0 BEFORE the swap CPI chain, so they do NOT consume CPI depth. This is documented in the code comments and is correct.

#### CPI-07: Pool Accounts as AccountInfo CPI Passthroughs (INFO)

**Location**:
- `/programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- `/programs/epoch-program/src/instructions/execute_carnage.rs`

**Description**: Pool accounts (crime_pool, fraud_pool, pool_vault_a, pool_vault_b) are `AccountInfo` with only `/// CHECK: Validated by Tax Program during swap_exempt CPI` documentation.

**Justification**: The Epoch Program never reads pool data directly (except `read_pool_reserves` which reads raw bytes for slippage calculation). These accounts are CPI passthroughs to Tax::swap_exempt, which then forwards them to AMM::swap_sol_pool. The AMM validates pool vaults against pool state (`constraint = vault_a.key() == pool.vault_a`).

**Risk**: If a malicious account were substituted for a pool account, the Tax Program's `swap_exempt` would forward it to AMM, which would reject it due to vault/mint constraints. The attack would fail at depth 2.

**Note**: The `read_pool_reserves` function in `execute_carnage.rs` reads raw bytes from the pool AccountInfo for slippage calculation. It only checks `data.len() >= 153` but does NOT validate the pool account's owner (AMM program). A malicious account with crafted data could cause an incorrect slippage calculation. However, this is mitigated by:
1. The pool account must still pass AMM validation during the actual swap CPI
2. An attacker who provides a fake pool for slippage calculation would only affect the slippage check -- either making it pass (allowing a worse price) or fail (reverting the transaction)
3. Making the slippage check pass with a fake pool would only matter if the actual swap returns fewer tokens than expected, but the swap uses the real pool (validated by AMM), so the actual output is independent of the slippage pre-read

#### CPI-08: Bounty Rent-Exempt Bug (KNOWN)

**Location**: `/programs/epoch-program/src/instructions/trigger_epoch_transition.rs`

**Description**: The bounty payment checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` but doesn't account for the rent-exempt minimum. After transferring the bounty, the vault can drop below the rent-exempt threshold (~890,880 lamports for a 0-data SystemAccount), causing the runtime to reject the transaction.

**Status**: Already documented in project MEMORY.md as a known bug. Fix: check `vault_balance >= bounty + rent_exempt_minimum`.

### 8. Discriminator Verification

All cross-program CPI instructions use precomputed Anchor discriminators (first 8 bytes of `sha256("global:<instruction_name>")`):

| Instruction | Discriminator | Verification |
|------------|---------------|-------------|
| swap_sol_pool | Hardcoded bytes | Used in swap_sol_buy, swap_sol_sell, swap_exempt |
| swap_profit_pool | `[0xce, 0xa3, 0x0b, 0x22, 0xf1, 0x6c, 0x24, 0xa6]` | Used in swap_profit_buy, swap_profit_sell |
| swap_exempt | `[0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c]` | Used in execute_carnage_atomic, execute_carnage |
| deposit_rewards | `DEPOSIT_REWARDS_DISCRIMINATOR` | Unit test verifies sha256 hash |
| update_cumulative | `UPDATE_CUMULATIVE_DISCRIMINATOR` | Unit test verifies sha256 hash |

Discriminators for deposit_rewards and update_cumulative are verified by unit tests in constants.rs. The swap discriminators are hardcoded with comments showing the verification command.

### 9. Post-CPI State Management

Every file that reads token account balances after a CPI correctly calls `.reload()`:

| File | Account Reloaded | Purpose |
|------|-----------------|---------|
| swap_sol_buy.rs | user_token_b, pool_vault_b | Measure tokens received |
| swap_sol_sell.rs | carnage_wsol, user_wsol | Measure WSOL received, tax extraction |
| swap_profit_buy.rs | user_token_a or user_token_b (direction-dependent) | Measure output |
| swap_profit_sell.rs | user_token_a or user_token_b (direction-dependent) | Measure output |
| execute_carnage_atomic.rs | carnage_wsol, crime_vault/fraud_vault | Measure sell proceeds, bought tokens |
| execute_carnage.rs | carnage_wsol, crime_vault/fraud_vault | Same as atomic |

**Assessment: CLEAR** -- No stale state reads after CPI (EP-046).

### 10. Transfer Hook Security

File: `/programs/transfer-hook/src/instructions/transfer_hook.rs`

The Transfer Hook program validates:
1. Zero-amount transfers are rejected
2. Mint owner is Token-2022 program (prevents fake mint injection)
3. `transferring` flag is set on the source account (prevents direct invocation -- only Token-2022 runtime sets this flag during transfer_checked)
4. Either source OR destination must be whitelisted (protocol vaults are whitelisted)
5. Whitelist PDAs are verified via seed derivation

The hook adds depth only when called by Token-2022 during a transfer. It cannot be called directly because the `transferring` flag check would fail.

---

## Appendix: Files Analyzed

| File | Program | CPI Role |
|------|---------|----------|
| programs/amm/src/helpers/transfers.rs | AMM | CPI initiator (T22 transfers) |
| programs/amm/src/instructions/swap_sol_pool.rs | AMM | CPI target (from Tax) |
| programs/amm/src/instructions/swap_profit_pool.rs | AMM | CPI target (from Tax) |
| programs/amm/src/constants.rs | AMM | Cross-program IDs |
| programs/tax-program/src/instructions/swap_sol_buy.rs | Tax | CPI initiator (AMM, Staking) |
| programs/tax-program/src/instructions/swap_sol_sell.rs | Tax | CPI initiator (AMM, Staking) |
| programs/tax-program/src/instructions/swap_profit_buy.rs | Tax | CPI initiator (AMM) |
| programs/tax-program/src/instructions/swap_profit_sell.rs | Tax | CPI initiator (AMM) |
| programs/tax-program/src/instructions/swap_exempt.rs | Tax | CPI target (from Epoch), CPI initiator (AMM) |
| programs/tax-program/src/constants.rs | Tax | Cross-program IDs, PDA seeds |
| programs/epoch-program/src/instructions/execute_carnage_atomic.rs | Epoch | CPI initiator (Tax) |
| programs/epoch-program/src/instructions/execute_carnage.rs | Epoch | CPI initiator (Tax) |
| programs/epoch-program/src/instructions/consume_randomness.rs | Epoch | CPI initiator (Staking) |
| programs/epoch-program/src/instructions/trigger_epoch_transition.rs | Epoch | CPI initiator (system_program) |
| programs/epoch-program/src/instructions/force_carnage.rs | Epoch | Devnet-only admin instruction |
| programs/epoch-program/src/constants.rs | Epoch | Cross-program IDs, PDA seeds |
| programs/staking/src/helpers/transfer.rs | Staking | CPI initiator (T22 transfers) |
| programs/staking/src/instructions/deposit_rewards.rs | Staking | CPI target (from Tax) |
| programs/staking/src/instructions/update_cumulative.rs | Staking | CPI target (from Epoch) |
| programs/staking/src/constants.rs | Staking | Cross-program IDs, PDA seeds |
| programs/transfer-hook/src/instructions/transfer_hook.rs | Hook | CPI target (from T22 runtime) |

---
<!-- END OF FOCUS AREA 04 ANALYSIS -->
