# Phase 37: E2E Bug Fixes -- RESEARCH

> **Researcher**: Claude Opus 4.6 (GSD Phase Researcher)
> **Date**: 2026-02-13
> **Status**: COMPLETE
> **Scope**: P0/P1/P2 security fixes, E2E bug fixes, independent tax rolls, rebuild + verify

---

## 1. Current Code State

### 1.1 Tax Program -- Swap Instructions (Destination PDA Validation)

**Files affected:**
- `programs/tax-program/src/instructions/swap_sol_buy.rs` (lines 388-405)
- `programs/tax-program/src/instructions/swap_sol_sell.rs` (lines 410-429)
- `programs/tax-program/src/instructions/swap_exempt.rs` (line 237)
- `programs/tax-program/src/instructions/swap_profit_buy.rs` (line 215)
- `programs/tax-program/src/instructions/swap_profit_sell.rs` (line 215)

**Current state (VULNERABLE -- P0):**

In `swap_sol_buy.rs` and `swap_sol_sell.rs`, tax destination accounts have NO PDA seeds constraints:

```rust
// swap_sol_buy.rs lines 388-405
/// CHECK: Validated by staking program on deposit
#[account(mut)]
pub staking_escrow: AccountInfo<'info>,

/// CHECK: External account, any valid account can receive SOL
#[account(mut)]
pub carnage_vault: AccountInfo<'info>,

/// CHECK: External account, any valid account can receive SOL
#[account(mut)]
pub treasury: AccountInfo<'info>,

/// CHECK: Program ID validated in CPI
pub amm_program: AccountInfo<'info>,
```

**Correct pattern already in the same file:**
```rust
// swap_sol_buy.rs lines 417-419
#[account(address = staking_program_id())]
pub staking_program: AccountInfo<'info>,
```

This means anyone calling swap_sol_buy/sell can redirect tax revenue to arbitrary accounts.

**`amm_program` is also unconstrained in ALL 5 swap instruction files.** A malicious caller could pass a fake AMM program that returns favorable swap rates while absorbing real tokens.

### 1.2 Epoch Program -- VRF Owner Check (P0)

**Files affected:**
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` (line 49)
- `programs/epoch-program/src/instructions/consume_randomness.rs` (line 49)
- `programs/epoch-program/src/instructions/retry_epoch_vrf.rs` (line 37)

**Current state (VULNERABLE -- P0):**

```rust
// trigger_epoch_transition.rs line 45-49
/// Switchboard On-Demand randomness account.
/// CHECK: Validated via RandomnessAccountData::parse(). This is a Switchboard
/// account, not a program account - we read and validate its data manually.
pub randomness_account: AccountInfo<'info>,
```

No `owner` constraint. `RandomnessAccountData::parse()` validates the data format but does NOT check `randomness_account.owner`. An attacker could create a program that writes data matching the Switchboard format but containing attacker-chosen "randomness" bytes.

The same pattern exists in `consume_randomness.rs` (line 49) and `retry_epoch_vrf.rs` (line 37).

### 1.3 Epoch Program -- CPI Program Target Validation (P0)

**Files affected:**
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` (lines 117-123)
- `programs/epoch-program/src/instructions/execute_carnage.rs` (lines 112-118)

**Current state (VULNERABLE -- P0):**

```rust
// execute_carnage_atomic.rs lines 117-123
/// Tax Program (for swap_exempt CPI)
/// CHECK: Program ID validated during CPI
pub tax_program: AccountInfo<'info>,

/// AMM Program (passed to Tax for swap)
/// CHECK: Program ID validated during CPI
pub amm_program: AccountInfo<'info>,
```

Both `tax_program` and `amm_program` lack `address` constraints. Comment says "validated during CPI" but CPI will call whatever program_id is passed -- there's no runtime validation.

### 1.4 Epoch Program -- Fallback Carnage Path (P1)

**File:** `programs/epoch-program/src/instructions/execute_carnage.rs`

**Bug 1 -- Missing `swap_authority` account:**

The `ExecuteCarnage` struct (fallback) is missing the `swap_authority` account that exists in `ExecuteCarnageAtomic`:

```rust
// execute_carnage_atomic.rs has (line 125-127):
/// Tax Program's swap_authority PDA (signs AMM CPI within Tax::swap_exempt)
/// CHECK: PDA derived from Tax Program seeds, validated during Tax CPI
pub swap_authority: AccountInfo<'info>,

// execute_carnage.rs DOES NOT have swap_authority between:
pub amm_program: AccountInfo<'info>,  // line 118
pub token_program_a: ...              // line 121
```

The CPI call in `execute_swap_exempt_cpi` (fallback version, lines 464-466) consequently skips `swap_authority` in the account metas:

```rust
// Fallback (WRONG, execute_carnage.rs lines 464-466) -- jumps straight from carnage_signer to pool:
AccountMeta::new_readonly(ctx.accounts.carnage_signer.key(), true), // carnage_authority
AccountMeta::new(ctx.accounts.target_pool.key(), false),            // pool
AccountMeta::new(ctx.accounts.pool_vault_a.key(), false),           // pool_vault_a

// Atomic (CORRECT, execute_carnage_atomic.rs lines 458-460) -- includes swap_authority:
AccountMeta::new_readonly(ctx.accounts.carnage_signer.key(), true), // carnage_authority
AccountMeta::new_readonly(ctx.accounts.swap_authority.key(), false), // swap_authority
AccountMeta::new(ctx.accounts.target_pool.key(), false),            // pool
```

This causes an account ordering mismatch -- the Tax Program's `SwapExempt` struct expects `swap_authority` as the second account.

**Bug 2 -- Wrong discriminator:**

```rust
// execute_carnage.rs line 451 (WRONG):
const SWAP_EXEMPT_DISCRIMINATOR: [u8; 8] = [0xf3, 0x5b, 0x9e, 0x48, 0xd3, 0x8a, 0x1c, 0x27];

// execute_carnage_atomic.rs line 444 (CORRECT):
const SWAP_EXEMPT_DISCRIMINATOR: [u8; 8] = [0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c];
```

Both bugs together mean the fallback Carnage path is completely non-functional. Any Carnage event that fails atomic execution will silently fail on fallback too.

### 1.5 AMM Program -- LP Fee Cap (P1)

**File:** `programs/amm/src/instructions/initialize_pool.rs` (line 134)

**Current state:**
```rust
pool.lp_fee_bps = lp_fee_bps;
```

No upper bound validation. `lp_fee_bps` is `u16`, so a value up to 65,535 (655%) could be set. The constants file has reference values but they're not enforced:

```rust
// amm/src/constants.rs
pub const SOL_POOL_FEE_BPS: u16 = 100;    // 1% -- reference only
pub const PROFIT_POOL_FEE_BPS: u16 = 50;   // 0.5% -- reference only
```

### 1.6 Staking Program -- deposit_rewards Balance Reconciliation (P2)

**File:** `programs/staking/src/instructions/deposit_rewards.rs`

**Current state:**
```rust
#[derive(Accounts)]
pub struct DepositRewards<'info> {
    #[account(seeds = [TAX_AUTHORITY_SEED], bump, seeds::program = tax_program_id())]
    pub tax_authority: Signer<'info>,
    #[account(mut, seeds = [STAKE_POOL_SEED], bump = stake_pool.bump)]
    pub stake_pool: Account<'info, StakePool>,
}
```

The instruction updates `pending_rewards` counter but does NOT include `escrow_vault` to verify actual SOL balance. Tax Program transfers SOL to escrow first, then calls `deposit_rewards` via CPI. If the transfer fails silently or short-changes the amount, `pending_rewards` would be inflated beyond what's actually available.

The escrow vault uses seed `b"escrow_vault"` (`ESCROW_VAULT_SEED` in staking constants).

### 1.7 Event Emissions (P2)

**Missing events:**
- `swap_exempt.rs` -- No `emit!()` call at all. Every other swap instruction emits either `TaxedSwap` or `UntaxedSwap`.
- This means Carnage swap activity is invisible to off-chain monitoring.

**Existing event pattern for reference:**
```rust
// swap_sol_buy.rs line 285
emit!(TaxedSwap { ... });

// swap_profit_sell.rs line 144
emit!(UntaxedSwap { ... });
```

### 1.8 Carnage WSOL Ownership Validation (P2)

**Files:** `execute_carnage.rs` (lines 73-75), `execute_carnage_atomic.rs` (lines 77-80)

```rust
/// Carnage's WSOL token account (for swap_exempt user_token_a)
#[account(mut)]
pub carnage_wsol: InterfaceAccount<'info, TokenAccount>,
```

No ownership or authority constraint on `carnage_wsol`. Should validate that the token account's authority matches the CarnageSigner PDA, ensuring only Carnage-controlled WSOL is used for swaps.

---

## 2. PDA Seeds Reference

### 2.1 Tax Program PDAs (`programs/tax-program/src/constants.rs`)

| PDA | Seed | Program |
|-----|------|---------|
| Tax Authority | `b"tax_authority"` | Tax Program |
| Swap Authority | `b"swap_authority"` | Tax Program |
| Epoch State (remote) | `b"epoch_state"` | Epoch Program |
| Carnage Signer (remote) | `b"carnage_signer"` | Epoch Program |
| Stake Pool (remote) | `b"stake_pool"` | Staking Program |

**Derivation helpers:**
```rust
pub fn get_carnage_signer_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CARNAGE_SIGNER_SEED], &epoch_program_id())
}
```

### 2.2 Epoch Program PDAs (`programs/epoch-program/src/constants.rs`)

| PDA | Seed | Program |
|-----|------|---------|
| Epoch State | `b"epoch_state"` | Epoch Program |
| Carnage Signer | `b"carnage_signer"` | Epoch Program |
| Staking Authority | `b"staking_authority"` | Epoch Program |
| Carnage Fund State | `b"carnage_fund"` | Epoch Program |
| Carnage SOL Vault | `b"carnage_sol_vault"` | Epoch Program |
| Carnage CRIME Vault | `b"carnage_crime_vault"` | Epoch Program |
| Carnage FRAUD Vault | `b"carnage_fraud_vault"` | Epoch Program |

### 2.3 Staking Program PDAs (`programs/staking/src/constants.rs`)

| PDA | Seed | Program |
|-----|------|---------|
| Stake Pool | `b"stake_pool"` | Staking Program |
| User Stake | `b"user_stake"` | Staking Program |
| Escrow Vault | `b"escrow_vault"` | Staking Program |
| Stake Vault | `b"stake_vault"` | Staking Program |
| Tax Authority (remote) | `b"tax_authority"` | Tax Program |
| Staking Authority (remote) | `b"staking_authority"` | Epoch Program |

### 2.4 AMM Program PDAs (`programs/amm/src/constants.rs`)

| PDA | Seed | Program |
|-----|------|---------|
| Swap Authority (remote) | `b"swap_authority"` | Tax Program |

AMM also has pool/vault seeds but those aren't relevant to the fix scope.

### 2.5 Tax Destination PDAs for Fixing

For the P0 tax destination fix, these accounts need PDA seeds constraints:

| Account | Current | Fix |
|---------|---------|-----|
| `staking_escrow` | bare `AccountInfo` | Add PDA derivation using `ESCROW_VAULT_SEED` from Staking Program |
| `carnage_vault` | bare `AccountInfo` | Add PDA derivation using `CARNAGE_SOL_VAULT_SEED` from Epoch Program |
| `treasury` | bare `AccountInfo` | Needs treasury PDA definition (currently deferred per Phase 25 comment) |

**Key consideration:** `staking_escrow` is a PDA of the Staking Program. `carnage_vault` is a PDA of the Epoch Program. The Tax Program has helper functions `staking_program_id()` and `epoch_program_id()` that can be used with `seeds::program` constraints.

---

## 3. Program ID Reference

### 3.1 Cross-Program ID Constants

**Tax Program** (`programs/tax-program/src/constants.rs`):
```rust
pub fn epoch_program_id() -> Pubkey {
    Pubkey::from_str("AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod").unwrap()
}
pub fn staking_program_id() -> Pubkey {
    Pubkey::from_str("Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi").unwrap()
}
// NOTE: No amm_program_id() function exists -- MUST BE ADDED for address constraints
```

**Staking Program** (`programs/staking/src/constants.rs`):
```rust
// Uses pubkey! macro (not Pubkey::from_str)
pub fn tax_program_id() -> Pubkey {
    pubkey!("FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu")
}
pub fn epoch_program_id() -> Pubkey {
    pubkey!("AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod")
}
```

**AMM Program** (`programs/amm/src/constants.rs`):
```rust
pub const TAX_PROGRAM_ID: Pubkey = pubkey!("FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu");
```

**Epoch Program** (`programs/epoch-program/src/constants.rs`):
```rust
// NO cross-program ID constants exist -- MUST BE ADDED for:
// - Tax Program address constraint (execute_carnage)
// - AMM Program address constraint (execute_carnage)
// - Switchboard On-Demand program ID (VRF owner check)
```

### 3.2 Missing Program ID Functions (Must Add)

1. **Tax Program needs:** `amm_program_id()` -- for `address` constraint on `amm_program` in all 5 swap files
2. **Epoch Program needs:** `tax_program_id()` -- for `address` constraint on `tax_program` in both execute_carnage files
3. **Epoch Program needs:** `amm_program_id()` -- for `address` constraint on `amm_program` in both execute_carnage files
4. **Epoch Program needs:** Switchboard program ID constant -- for VRF owner check

---

## 4. Switchboard Integration

### 4.1 Current Dependency

```toml
# programs/epoch-program/Cargo.toml
switchboard-on-demand = "=0.11.3"
```

Currently only uses `RandomnessAccountData` from this crate (imported in 3 instruction files).

### 4.2 Available Constants for Owner Check

The `switchboard-on-demand` crate v0.11.3 exports from its `program_id` module:

- `ON_DEMAND_DEVNET_PID` -- Switchboard On-Demand program ID for devnet
- `ON_DEMAND_MAINNET_PID` -- Switchboard On-Demand program ID for mainnet
- `get_switchboard_on_demand_program_id()` -- returns appropriate PID based on feature flags

### 4.3 Recommended Owner Check Pattern

**Option A: Anchor `owner` constraint (cleanest)**
```rust
/// Switchboard randomness account
/// CHECK: Owner validated + data validated via parse()
#[account(owner = switchboard_on_demand::ON_DEMAND_MAINNET_PID)]
pub randomness_account: AccountInfo<'info>,
```

Problem: Must hardcode devnet vs mainnet PID. The crate's `get_switchboard_on_demand_program_id()` uses feature flags at compile time.

**Option B: Runtime `require!` check (flexible)**
```rust
// In handler:
require!(
    randomness_account.owner == &switchboard_program_id(),
    EpochError::InvalidRandomnessOwner
);
let randomness_data = RandomnessAccountData::parse(
    randomness_account.data.borrow()
)?;
```

Where `switchboard_program_id()` is a new constant in epoch-program constants that can be changed per environment.

**Option C: Feature-flagged constant (best of both)**
```rust
// In epoch-program/src/constants.rs:
#[cfg(feature = "devnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_DEVNET_PID;

#[cfg(not(feature = "devnet"))]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_MAINNET_PID;
```

Then use `#[account(owner = SWITCHBOARD_PROGRAM_ID)]` in the struct.

**Recommendation:** Option C. Feature-flagged compile-time constant avoids runtime overhead and matches how the crate itself resolves the PID. The `devnet` feature flag already has precedent in the project.

### 4.4 Important Caveat

The `owner` field of a Solana account is the program that owns the account data. For Switchboard, randomness accounts are owned by the Switchboard On-Demand program. The `owner` check ensures the account was created and is managed by the legitimate Switchboard program, preventing a fake program from creating accounts with crafted "randomness" data.

---

## 5. Tax Derivation Current State

### 5.1 Current Byte Allocation

**File:** `programs/epoch-program/src/helpers/tax_derivation.rs`

```
VRF Result: [B0][B1][B2][B3][B4][B5][B6]...[B31]
             |    |    |    |    |    |
             |    |    |    |    |    +-- Carnage: Target (< 128 = CRIME)
             |    |    |    |    +------ Carnage: Action (< 5 = Sell)
             |    |    |    +---------- Carnage: Trigger (< 11 = triggered)
             |    |    +-------------- Tax: High magnitude (% 4 -> 1100-1400 bps)
             |    +------------------ Tax: Low magnitude (% 4 -> 100-400 bps) [SHARED]
             +---------------------- Tax: Flip decision (< 192 = 75% flip)
```

**Problem: Byte 1 and Byte 2 are SHARED for both CRIME and FRAUD.** The current `derive_taxes` function picks one low rate and one high rate, then assigns them symmetrically:

```rust
// Line 92-95
let (crime_buy, crime_sell, fraud_buy, fraud_sell) = match cheap_side {
    Token::Crime => (low_bps, high_bps, high_bps, low_bps),
    Token::Fraud => (high_bps, low_bps, low_bps, high_bps),
};
```

This means if CRIME has 200 bps buy / 1300 bps sell, then FRAUD MUST have 1300 bps buy / 200 bps sell. The rates are perfectly mirrored, not independently random.

### 5.2 Independent Tax Rolls -- Proposed Byte Reallocation

For independent CRIME and FRAUD tax magnitudes, we need 4 bytes instead of 2:

```
VRF Result: [B0][B1][B2][B3][B4][B5][B6][B7]...[B31]
             |    |    |    |    |    |    |    |
             |    |    |    |    |    |    |    +-- (unused)
             |    |    |    |    |    |    +------ Carnage: Target
             |    |    |    |    |    +---------- Carnage: Action
             |    |    |    |    +-------------- Carnage: Trigger
             |    |    |    +------------------ Tax: FRAUD high mag (% 4)
             |    |    +---------------------- Tax: FRAUD low mag (% 4)
             |    +-------------------------- Tax: CRIME high mag (% 4)
             +------------------------------- Tax: Flip + CRIME low mag combined
```

**Alternative (cleaner, what I recommend):**

```
Byte 0: Flip decision (< 192 = 75%)
Byte 1: CRIME low tax magnitude (% 4 -> 100-400 bps)
Byte 2: CRIME high tax magnitude (% 4 -> 1100-1400 bps)
Byte 3: FRAUD low tax magnitude (% 4 -> 100-400 bps)
Byte 4: FRAUD high tax magnitude (% 4 -> 1100-1400 bps)
Byte 5: Carnage trigger (< 11)
Byte 6: Carnage action (< 5 = sell)
Byte 7: Carnage target (< 128 = CRIME)
```

This shifts Carnage bytes from 3-5 to 5-7. Total VRF consumption: 8 bytes (of 32 available). Well within budget.

### 5.3 Changes Required for Independent Rolls

1. **`tax_derivation.rs`**: Change `derive_taxes()` to use bytes 1-4 (4 bytes instead of 2). Return independently derived rates per token.
2. **`TaxConfig` struct**: Already has separate fields for `crime_buy_tax_bps`, `crime_sell_tax_bps`, `fraud_buy_tax_bps`, `fraud_sell_tax_bps` -- no struct change needed.
3. **`carnage.rs`**: Shift byte indices from [3]/[4]/[5] to [5]/[6]/[7].
4. **`consume_randomness.rs`**: Update `MIN_VRF_BYTES` from 6 to 8.
5. **All unit tests**: Update `make_vrf()` helpers and expectations.

### 5.4 Impact on EpochState

The `EpochState` already stores individual rates:
```rust
pub crime_buy_tax_bps: u16,
pub crime_sell_tax_bps: u16,
pub fraud_buy_tax_bps: u16,
pub fraud_sell_tax_bps: u16,
```

No state layout change needed.

---

## 6. VRF Gateway Rotation

### 6.1 Current Retry Logic

**File:** `scripts/vrf/lib/vrf-flow.ts` (lines 152-174)

```typescript
async function tryReveal(
  randomness: any,
  maxAttempts: number
): Promise<any | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const revealIx = await randomness.revealIx();
      return revealIx;
    } catch (e) {
      if (i < maxAttempts - 1) {
        await sleep(3000);
      }
    }
  }
  return null;
}
```

**Problem:** `randomness.revealIx()` is called on the same `randomness` object every time, which internally contacts the same Switchboard gateway/oracle. If that gateway is down or slow, all 20 attempts (60 seconds total) will fail against the same endpoint.

### 6.2 SDK Setup Pattern

The current code uses dynamic Switchboard resolution:
```typescript
const switchboardProgramId = await sb.getProgramId(connection);
const queue = await sb.getDefaultQueue(connection.rpcEndpoint);
```

The `queue` object has access to the queue's gateway list, but the current code never cycles through alternative gateways.

### 6.3 SDK Gateway Architecture (Verified)

**SDK version installed:** `@switchboard-xyz/on-demand` v3.8.2 (TypeScript); Rust crate `switchboard-on-demand` v0.11.3.

**Critical finding from SDK source (`node_modules/@switchboard-xyz/on-demand/dist/esm/accounts/randomness.js`):**

The oracle (and thus gateway) is **locked at commit time**, stored in the on-chain randomness account data. `revealIx()` reads the oracle from the committed data, NOT from a configurable parameter:

```javascript
// Actual SDK code path in revealIx():
const data = yield this.loadData();                   // Reads on-chain randomness account
const oracle = new Oracle(this.program, data.oracle); // Oracle is FROM the committed data
oracleData = yield oracle.loadData();
const gatewayUrl = String.fromCharCode(...oracleData.gatewayUri).replace(/\0+$/, '');
const gateway = new Gateway(gatewayUrl);
const gatewayRevealResponse = yield gateway.fetchRandomnessReveal({...});
```

**Implication:** Creating a new `Randomness` object targeting an alternative gateway is NOT possible for the same randomness account. The oracle is baked into the account at commit time via `queueAccount.fetchOracleByLatestVersion()` (called during `commitIx()`).

### 6.4 Actual Rotation Strategy

The only way to "rotate" to a different oracle/gateway is to create a **fresh randomness account** and re-commit, which selects a new oracle from the queue. This is exactly what `retry_epoch_vrf` already implements:

1. Wait `VRF_TIMEOUT_SLOTS` (300 slots, ~2 min) for the original reveal to time out
2. Create a new `Randomness` keypair
3. Call `retry_epoch_vrf` on-chain (binds the new randomness account to epoch state)
4. Bundle with `commitIx()` targeting the new randomness (which picks a fresh oracle)
5. Proceed with `revealIx()` on the new randomness object

The existing `vrf-flow.ts` already implements this pattern in its recovery flow (lines 269-392). No additional gateway rotation logic is needed within `tryReveal()` -- the existing retry-with-fresh-randomness approach IS the correct rotation strategy.

**Recommended improvement:** Reduce the initial retry count in `tryReveal()` from 20 attempts (60 seconds) to 10 attempts (30 seconds) before falling through to the timeout recovery path. This reduces wasted time retrying a potentially dead oracle.

---

## 7. CarnageSigner WSOL Account

### 7.1 Current State -- Placeholder

**File:** `scripts/e2e/lib/carnage-flow.ts` (line 442)

```typescript
carnageWsol: user.wsolAccount,  // Uses USER's WSOL as placeholder!
```

The E2E flow passes the user's personal WSOL account as the Carnage WSOL account. This is a placeholder that works in happy-path testing because both accounts have SOL, but:
- Carnage should own and control its own WSOL account
- The WSOL account authority should be the CarnageSigner PDA
- Using user accounts means Carnage swaps drain user funds, not Carnage funds

### 7.2 Initialization Gap

**File:** `scripts/deploy/initialize.ts`

Steps 15-17 in the initialize script create:
- Step 15: CarnageFundState PDA (`b"carnage_fund"`)
- Step 16: Carnage SOL vault PDA (`b"carnage_sol_vault"`)
- Step 17: Carnage CRIME/FRAUD token vaults

**Missing:** No Carnage WSOL account creation step.

### 7.3 WSOL Creation Pattern (From Admin WSOL)

The initialize script already shows the correct pattern for PDA-adjacent WSOL:

```typescript
// scripts/deploy/initialize.ts lines 371-379
adminWsolAccount = await createWrappedNativeAccount(
  connection,
  authority,            // payer
  authority.publicKey,  // owner
  wsolAmount,           // lamports to wrap
  Keypair.generate(),   // explicit keypair (ATA rejects off-curve owners)
  undefined,            // confirmOptions
  TOKEN_PROGRAM_ID      // WSOL uses original SPL Token, not Token-2022
);
```

**Critical pattern for Carnage WSOL:**
- **Owner:** Must be the CarnageSigner PDA (off-curve)
- **Cannot use ATA:** Associated Token Account rejects off-curve owners
- **Must use explicit Keypair:** `createWrappedNativeAccount()` with `Keypair.generate()`
- **Token Program:** Must be `TOKEN_PROGRAM_ID` (SPL Token), NOT Token-2022
- **Must store address:** The WSOL account pubkey must be stored somewhere accessible (CarnageFundState or passed as account)

### 7.4 On-Chain Validation

The on-chain `carnage_wsol` account in execute_carnage should be validated:

```rust
// Recommended constraint:
#[account(
    mut,
    constraint = carnage_wsol.owner == carnage_signer.key()
        @ EpochError::InvalidCarnageWsolOwner,
)]
pub carnage_wsol: InterfaceAccount<'info, TokenAccount>,
```

This ensures the WSOL account is controlled by the CarnageSigner PDA, preventing an attacker from substituting their own WSOL account.

### 7.5 Sell-Side Minimum Output Floor (P2)

**Verified mechanism:** The AMM's `swap_sol_pool.rs` enforces `amount_out >= minimum_amount_out` at line 146 (`AmmError::SlippageExceeded`). However, `swap_exempt.rs` hardcodes `MINIMUM_OUTPUT: u64 = 0` at line 111, effectively bypassing the AMM's slippage protection for all Carnage swaps.

This is by design -- Carnage swaps are internal protocol rebalancing operations that should always execute regardless of slippage. Sandwich attack risk was explicitly evaluated and **DECLINED per scope (H064)**. The rationale is that Carnage operations are bounded by `MAX_CARNAGE_SWAP_LAMPORTS` (1000 SOL) and the economic incentive to sandwich a protocol-internal swap is limited by the on-chain visibility of the Carnage trigger.

No code changes needed for this item.

---

## 8. Implementation Notes

### 8.1 Fix Dependencies

```
DEPENDENCY GRAPH (must fix in order):

1. Add program ID constants (Tax: amm_program_id, Epoch: tax_program_id + amm_program_id + switchboard)
   ^-- Required by ALL subsequent P0 fixes

2. P0 fixes can proceed in parallel after constants:
   2a. Tax destination PDA constraints (swap_sol_buy, swap_sol_sell)
   2b. CPI program address constraints (all swap files + execute_carnage files)
   2c. VRF owner check (trigger, consume, retry)

3. P1 fixes (independent of P0 but should follow):
   3a. Fallback Carnage: add swap_authority + fix discriminator
   3b. LP fee cap in initialize_pool

4. P2 fixes (independent):
   4a. deposit_rewards balance reconciliation
   4b. Event emissions (swap_exempt)
   4c. carnage_wsol ownership constraint
   4d. Independent tax rolls (byte reallocation)

5. E2E fixes (after on-chain fixes):
   5a. Carnage WSOL account creation in initialize.ts
   5b. VRF reveal retry tuning in vrf-flow.ts (reduce from 20 to 10 attempts)
   5c. Update carnage-flow.ts to use proper WSOL account

6. Rebuild + Verify (after all fixes)
```

### 8.2 Gotchas and Risks

1. **Treasury PDA undefined (VERIFIED):** `trigger_epoch_transition.rs` (lines 39-41) has `/// CHECK: Treasury will be a PDA validated in Phase 25`. `swap_sol_buy.rs` (lines 397-400) has `/// CHECK: External account, any valid account can receive SOL` -- no validation at all. The treasury is currently a bare `#[account(mut)] pub treasury: AccountInfo<'info>` with no validation. In `trigger_epoch_transition.rs`, the bounty payment logic (lines 191-199) is DEFERRED -- it checks balance but does not actually transfer. **Recommended approach for Phase 37:** Use an `address` constraint referencing a stored treasury pubkey (e.g., `address = epoch_state.treasury @ EpochError::InvalidTreasury`), since the treasury design is not finalized and a PDA seed would lock us into a specific derivation. The `EpochState` struct could store a `treasury: Pubkey` field set during initialization. This defers the full treasury infrastructure to a later phase while still preventing arbitrary account substitution.

2. **Staking escrow PDA derivation from Tax Program:** The escrow vault is `seeds = [ESCROW_VAULT_SEED]` in the Staking Program. Tax Program would need `seeds::program = staking_program_id()` to validate it, plus `ESCROW_VAULT_SEED` constant must be added to Tax Program constants.

3. **WSOL account persistence (VERIFIED):** `CarnageFundState` currently has NO `wsol_account` field (struct is 147 bytes: 8 discriminator + 139 data). Adding a `Pubkey` field (32 bytes) would require account reallocation from 147 to 179 bytes. **Recommended approach:** Do NOT add a field to `CarnageFundState`. Instead: (a) create the WSOL account during `initialize.ts` with `Keypair.generate()` and CarnageSigner PDA as owner, (b) store the keypair/pubkey in deployment config (e.g., `keypairs/carnage-wsol.json`), (c) validate ownership on-chain with `constraint = carnage_wsol.owner == carnage_signer.key()` as shown in Section 7.4. This avoids reallocation complexity and matches how other non-PDA accounts (like the admin WSOL) are managed. The WSOL account address is passed as an account in the instruction, not stored on-chain.

4. **Account size changes:** Adding `swap_authority` to `ExecuteCarnage` struct adds one account to the transaction. Verify transaction size limits are still within bounds. Current atomic path already has `swap_authority` so this should be fine.

5. **Independent tax rolls change epoch behavior:** With shared magnitudes, CRIME and FRAUD always have perfectly mirrored rates. With independent rolls, they could have unrelated rates. This changes the economic dynamics significantly -- both could be cheap simultaneously, both could be expensive, etc. The flip decision (byte 0) still determines the "cheap side" but the actual rates would vary independently.

6. **Carnage byte shift breaks existing tests:** Shifting carnage bytes from [3-5] to [5-7] will break all existing integration tests, E2E scripts, and unit tests that construct VRF byte arrays. Must update systematically.

7. **Existing E2E scripts reference user WSOL:** Besides `carnage-flow.ts`, check `swap-flow.ts` and `staking-flow.ts` for any Carnage WSOL references that need updating.

8. **Discriminator fix is the easier bug:** The discriminator in `execute_carnage.rs` can be fixed by simply copying the correct value from `execute_carnage_atomic.rs`. The `swap_authority` fix requires adding an account to the struct and to the CPI call.

### 8.3 Test Impact

- **Unit tests (`tax_derivation.rs`):** All `make_vrf()` calls need byte index updates for independent rolls
- **Unit tests (`carnage.rs`):** All `make_vrf()` calls need byte index updates (3->5, 4->6, 5->7)
- **Integration tests:** Any test that constructs VRF byte arrays needs updating
- **E2E scripts:** `carnage-flow.ts`, `vrf-flow.ts`, potentially `swap-flow.ts`
- **Proptest properties:** Need updating if they generate VRF bytes

### 8.4 Files Requiring Modification (Complete List)

**On-chain (Rust):**
1. `programs/tax-program/src/constants.rs` -- Add `amm_program_id()`, add `ESCROW_VAULT_SEED`
2. `programs/tax-program/src/instructions/swap_sol_buy.rs` -- PDA constraints on destinations + amm_program address
3. `programs/tax-program/src/instructions/swap_sol_sell.rs` -- PDA constraints on destinations + amm_program address
4. `programs/tax-program/src/instructions/swap_exempt.rs` -- amm_program address + add event emission
5. `programs/tax-program/src/instructions/swap_profit_buy.rs` -- amm_program address
6. `programs/tax-program/src/instructions/swap_profit_sell.rs` -- amm_program address
7. `programs/epoch-program/src/constants.rs` -- Add `tax_program_id()`, `amm_program_id()`, `SWITCHBOARD_PROGRAM_ID`
8. `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` -- VRF owner check
9. `programs/epoch-program/src/instructions/consume_randomness.rs` -- VRF owner check + MIN_VRF_BYTES
10. `programs/epoch-program/src/instructions/retry_epoch_vrf.rs` -- VRF owner check
11. `programs/epoch-program/src/instructions/execute_carnage.rs` -- Add swap_authority, fix discriminator, add program address constraints, add carnage_wsol constraint
12. `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` -- Add program address constraints, add carnage_wsol constraint
13. `programs/epoch-program/src/helpers/tax_derivation.rs` -- Independent tax rolls (bytes 1-4)
14. `programs/epoch-program/src/helpers/carnage.rs` -- Shift bytes 3-5 to 5-7
15. `programs/amm/src/instructions/initialize_pool.rs` -- LP fee cap
16. `programs/staking/src/instructions/deposit_rewards.rs` -- Add escrow_vault balance check

**Off-chain (TypeScript):**
17. `scripts/deploy/initialize.ts` -- Add Carnage WSOL creation step
18. `scripts/vrf/lib/vrf-flow.ts` -- Reduce tryReveal retry count (20 -> 10 attempts)
19. `scripts/e2e/lib/carnage-flow.ts` -- Use proper Carnage WSOL account

**Tests (Rust + TS):**
20. All unit tests in `tax_derivation.rs` and `carnage.rs`
21. Integration tests that construct VRF byte arrays
22. E2E tests and scripts
