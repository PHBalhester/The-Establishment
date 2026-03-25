# 01 - Access Control & Account Validation
<!-- Focus Area: Access Control & Account Validation -->
<!-- Auditor: Stronghold of Security - Context Auditor -->
<!-- Date: 2026-02-22 -->
<!-- Anchor Version: 0.32.1 | Solana: Agave 2.x | Programs: 5 (AMM, Tax, Epoch, Transfer Hook, Staking) -->

<!-- CONDENSED_SUMMARY_START -->

## Condensed Summary

### Architecture Overview

Dr Fraudsworth is a 5-program Solana/Anchor DeFi protocol with a layered CPI trust model:

```
User -> Tax Program -> AMM (swap execution)
User -> Staking (stake/claim/unstake)
Crank -> Epoch Program -> Tax Program -> AMM (carnage execution)
Epoch Program -> Staking (update_cumulative)
Tax Program -> Staking (deposit_rewards)
Transfer Hook (called by Token-2022 on every CRIME/FRAUD transfer)
```

Cross-program authorization uses **PDA signer** pattern: the calling program derives a PDA with known seeds, signs the CPI with `invoke_signed`, and the receiving program validates the PDA via `seeds::program` constraint. This is the correct pattern (SP-031).

### Findings Summary

| ID | Severity | Title | Location | EP Reference |
|----|----------|-------|----------|-------------|
| AC-001 | HIGH | Initialization front-running (3 programs) | hook/initialize_authority.rs:15, epoch/initialize_epoch_state.rs:32, staking/initialize_stake_pool.rs | EP-075, EP-076 |
| AC-002 | MEDIUM | `constraint = true` placeholder validation | tax/swap_sol_buy.rs:436,447; tax/swap_sol_sell.rs:575,586 | EP-007 |
| AC-003 | MEDIUM | No emergency pause mechanism | All 5 programs | EP-072 |
| AC-004 | MEDIUM | No admin key rotation (two-step transfer) | amm/state/admin.rs | EP-068, EP-069 |
| AC-005 | MEDIUM | Mainnet treasury/mint placeholders are Pubkey::default() | tax/constants.rs:144,164 | EP-026 |
| AC-006 | LOW | force_carnage devnet-only must be removed | epoch/instructions/force_carnage.rs | EP-071 |
| AC-007 | LOW | Bounty rent-exempt bug (known) | epoch/trigger_epoch_transition.rs | EP-106 |
| AC-008 | LOW | burn_authority manual check instead of has_one | hook/burn_authority.rs | Style |
| AC-009 | INFO | swap_authority unvalidated AccountInfo (CPI passthrough) | epoch/execute_carnage_atomic.rs:179 | FP-014 |
| AC-010 | INFO | 13x AccountInfo CPI passthroughs in execute_carnage | epoch/execute_carnage_atomic.rs:120-175 | FP-015 (mitigated) |

### Cross-Program PDA Chain Verification: PASS

All 4 PDA authority chains verified consistent:

| Chain | Seed | Deriving Program | Verifying Program | Status |
|-------|------|------------------|-------------------|--------|
| swap_authority | `b"swap_authority"` | Tax Program (DRjNCjt4) | AMM (5ANTHFtg) | MATCH |
| carnage_signer | `b"carnage_signer"` | Epoch Program (G6dmJTdC) | Tax Program (DRjNCjt4) | MATCH |
| tax_authority | `b"tax_authority"` | Tax Program (DRjNCjt4) | Staking (EZFeU613) | MATCH |
| staking_authority | `b"staking_authority"` | Epoch Program (G6dmJTdC) | Staking (EZFeU613) | MATCH |

All program IDs match across all constants files. All seed strings are byte-identical. Unit tests exist verifying seed values and PDA derivation consistency.

### Critical Invariants That Must Hold

1. **INV-AC-01**: Only Tax Program can execute AMM swaps (swap_authority PDA + seeds::program)
2. **INV-AC-02**: Only Epoch Program can call Tax::swap_exempt (carnage_signer PDA + seeds::program)
3. **INV-AC-03**: Only Tax Program can call Staking::deposit_rewards (tax_authority PDA + seeds::program)
4. **INV-AC-04**: Only Epoch Program can call Staking::update_cumulative (staking_authority PDA + seeds::program)
5. **INV-AC-05**: Initialization PDAs can only be created once (Anchor `init` constraint)
6. **INV-AC-06**: Admin burn is irreversible (Pubkey::default() cannot sign)
7. **INV-AC-07**: Whitelist authority burn is irreversible (Option::None cannot match)
8. **INV-AC-08**: Pool vaults match pool state (vault_a.key() == pool.vault_a, etc.)
9. **INV-AC-09**: Token program matches mint owner (validated in pool init + swap)

### Cross-Focus Handoffs

- **-> 02-arithmetic.md**: Staking reward math (update_rewards, rewards_per_token_stored) needs overflow/precision analysis
- **-> 03-economic-model.md**: Tax BPS bounds, carnage action economics, dead stake sizing
- **-> 04-cpi-reentrancy.md**: CEI compliance in swap handlers, CPI depth chain (Epoch->Tax->AMM = 3 levels), stale data after CPI
- **-> 05-token-extensions.md**: Transfer Hook validation (transfer_hook.rs), Token-2022 accounting in swap vaults
- **-> 06-oracle-timing.md**: VRF freshness check (slot_diff <= 1), epoch boundary timing, pending_randomness_account binding

### False Positives Identified

| Pattern | Location | Why Safe | FP Reference |
|---------|----------|----------|-------------|
| AccountInfo CPI passthroughs | execute_carnage_atomic.rs | Validated by downstream Tax/AMM programs via pool/vault/mint constraints | FP-014, FP-015 |
| UncheckedAccount for PDAs | deposit_rewards.rs:36, update_cumulative.rs:36 | seeds + seeds::program constraint validates address deterministically | FP-014 |
| init_if_needed for UserStake | staking/stake.rs:43-50 | PDA seeds include user.key(), so per-user; Anchor checks discriminator; new-user detection via Pubkey::default() is safe because fresh accounts zero-initialize | FP-004 |
| No owner check on swap vaults | amm/swap_sol_pool.rs | Account<'info, TokenAccount> auto-validates owner; vault key == pool.vault constraint prevents substitution | FP-001, FP-007 |
| Permissionless trigger_epoch_transition | epoch/trigger_epoch_transition.rs | Intentionally permissionless (crank design); epoch boundary + VRF + slot constraints prevent abuse | FP-003 |
| Permissionless execute_carnage_atomic | epoch/execute_carnage_atomic.rs | Intentionally permissionless; no-op guard when carnage_pending=false; all sensitive state validated via PDA constraints | FP-003 |
| Redundant manual ownership check | staking/claim.rs | constraint + manual check = redundant but harmless | FP-018 |

<!-- CONDENSED_SUMMARY_END -->

---

## Full Analysis

### 1. Methodology

This analysis covers **Access Control & Account Validation** across all 5 programs in the Dr Fraudsworth protocol. The methodology follows:

1. **Index review**: Read `.audit/INDEX.md` for codebase structure, CPI call graph, and risk profiles
2. **Hot spot identification**: Read `.audit/HOT_SPOTS.md` for pre-scanned access control patterns
3. **Focus manifest**: Read `.audit/kb/focus-manifests/01-access-control.md` for target exploit patterns
4. **KB reference**: Read 6 knowledge base files (secure-patterns, false-positives, runtime-quirks, anchor-gotchas, token-extensions, staking-attacks)
5. **3-layer search**: Layer 1 (file identification via grep), Layer 2 (pattern matching), Layer 3 (deep read of critical files)
6. **Cross-program PDA validation**: Verify all 4 PDA authority chains for seed/program-id consistency

Exploit patterns checked: EP-001 (Missing Signer), EP-002 (Missing Owner), EP-007 (Account Relationship Not Verified), EP-009 (Duplicate Mutable Accounts), EP-010 (Unchecked Token Mint), EP-026 (Missing Authority Constraint), EP-027 (Confused Deputy), EP-032 (PDA Authority Without Derivation Check), EP-068 (Single Admin Key), EP-071 (Unprotected Upgrade Authority), EP-075 (Double Initialization), EP-126 (Multisig/ACL Role Escalation).

---

### 2. Program-by-Program Analysis

#### 2.1 AMM Program (`programs/amm/`)

**Admin Model:**
- AdminConfig PDA (`seeds = [b"admin"]`) stores single admin pubkey and bump
- Initialization gated by upgrade authority via ProgramData account: `program_data.upgrade_authority_address == Some(authority.key())` (`initialize_admin.rs`)
- Admin can create pools, but cannot modify pool parameters after creation
- Admin burn (`burn_admin.rs`) sets admin to `Pubkey::default()`, permanently disabling pool creation

**Pool Access Control:**
- `initialize_pool.rs`: Gated by `has_one = admin` on AdminConfig. Validated:
  - Canonical mint ordering: `mint_a.key() < mint_b.key()` (prevents duplicate pools)
  - Pool type inferred from token programs (not caller-declared): `if mint_a_owner == spl_token::ID { SolToken } else { ProfitToken }`
  - Vault accounts: `init`, PDA with pool seeds, authority = pool PDA
  - Fee cap: `lp_fee_bps <= MAX_LP_FEE_BPS (500)`
  - Mint owner validation: `mint_a.to_account_info().owner == token_program_a.key`

**Swap Access Control:**
- `swap_sol_pool.rs` and `swap_profit_pool.rs`: swap_authority is `Signer<'info>` validated via:
  ```
  seeds = [SWAP_AUTHORITY_SEED],
  bump,
  seeds::program = TAX_PROGRAM_ID,
  ```
  This ensures ONLY the Tax Program can derive and sign with this PDA. Hardcoded `TAX_PROGRAM_ID` in constants.rs.
- Pool validated via seeds + `pool.initialized` + `!pool.locked`
- Vault substitution prevented: `vault_a.key() == pool.vault_a`, `vault_b.key() == pool.vault_b`
- Mint validation: `mint_a.key() == pool.mint_a`, `mint_b.key() == pool.mint_b`
- Token program validation: `token_program_a.key() == pool.token_program_a`
- CEI compliant: state updated before vault transfers

**Assessment:** AMM access control is well-structured. The upgrade-authority check on admin init is the strongest initialization pattern in the protocol.

---

#### 2.2 Tax Program (`programs/tax-program/`)

**Authority Model:**
- No dedicated admin -- acts as orchestrator between user, AMM, Staking, and Epoch programs
- swap_authority PDA (`seeds = [b"swap_authority"]`) owned by Tax Program, used to sign AMM CPIs
- tax_authority PDA (`seeds = [b"tax_authority"]`) owned by Tax Program, used to sign Staking::deposit_rewards CPIs
- carnage_signer validated via `seeds::program = epoch_program_id()` (receiving end of Epoch -> Tax CPI)

**Swap Buy/Sell Access Control (swap_sol_buy.rs, swap_sol_sell.rs):**
- User must be `Signer<'info>`
- EpochState manually validated: owner check against `epoch_program_id()`, discriminator via `try_deserialize`, `initialized` flag
- Cross-program PDA validation for staking: `stake_pool` and `staking_escrow` use `seeds::program = staking_program_id()`
- Cross-program PDA validation for epoch: `carnage_vault` uses `seeds::program = epoch_program_id()`
- Treasury validated via `address = treasury_pubkey()`
- AMM and Staking programs validated via `address = amm_program_id()` and `address = staking_program_id()`

**FINDING AC-002: `constraint = true` Placeholders**
File: `programs/tax-program/src/instructions/swap_sol_buy.rs` lines 436, 447
File: `programs/tax-program/src/instructions/swap_sol_sell.rs` lines 575, 586

```rust
// swap_sol_buy.rs:434-437
#[account(
    mut,
    constraint = true @ TaxError::InvalidStakingEscrow,
    seeds = [ESCROW_VAULT_SEED],
    seeds::program = staking_program_id(),
    bump,
)]
pub staking_escrow: AccountInfo<'info>,

// swap_sol_buy.rs:445-448
#[account(
    mut,
    constraint = true @ TaxError::InvalidCarnageVault,
    seeds = [CARNAGE_SOL_VAULT_SEED],
    seeds::program = epoch_program_id(),
    bump,
)]
pub carnage_vault: SystemAccount<'info>,
```

The `constraint = true` evaluates to always-true and provides zero validation. The error codes `TaxError::InvalidStakingEscrow` and `TaxError::InvalidCarnageVault` can never be triggered. While the PDA `seeds + seeds::program` constraint does validate the account address, the `constraint = true` is misleading -- it suggests validation is happening when none is. This pattern appears in 4 locations across 2 files.

**Severity: MEDIUM** -- The PDA seeds provide the actual validation, so funds are not at risk. However, the misleading constraint could cause auditors to trust the error code and skip deeper analysis. The `constraint` attribute should either be removed (rely on seeds alone) or replaced with a meaningful check.

**Swap Exempt Access Control (swap_exempt.rs):**
- Carnage authority: `Signer<'info>` with `seeds = [CARNAGE_SIGNER_SEED], seeds::program = epoch_program_id()`
- Only Epoch Program can call this (PDA signer requirement)
- Pool and vault accounts are AccountInfo CPI passthroughs (validated by AMM during CPI)
- MINIMUM_OUTPUT = 0 is intentional per spec for carnage operations

---

#### 2.3 Epoch Program (`programs/epoch-program/`)

**Authority Model:**
- No admin for normal operations -- designed as permissionless state machine
- EpochState PDA (`seeds = [b"epoch_state"]`) is global singleton
- CarnageFundState PDA (`seeds = [b"carnage_fund"]`) stores vault addresses
- carnage_signer PDA (`seeds = [b"carnage_signer"]`) signs Tax::swap_exempt CPIs
- staking_authority PDA (`seeds = [b"staking_authority"]`) signs Staking::update_cumulative CPIs

**FINDING AC-001: Initialization Front-Running (HIGH)**

Three programs have initialization instructions that accept **any Signer** without verifying they are the deployer/upgrade authority:

**1. Transfer Hook - initialize_authority.rs:15**
```rust
pub fn handler(ctx: Context<InitializeAuthority>) -> Result<()> {
    let auth = &mut ctx.accounts.whitelist_authority;
    auth.authority = Some(ctx.accounts.signer.key()); // Any signer becomes authority
    auth.initialized = true;
    ...
}
```
Any account can call this first and become the whitelist authority. Since the whitelist controls which accounts can send/receive CRIME and FRAUD tokens, this is critical infrastructure. A front-runner could:
1. Monitor the mempool for the protocol deployment transaction
2. Front-run with `initialize_authority` to claim whitelist control
3. Refuse to whitelist protocol vaults, effectively DoS-ing the entire protocol
4. Or whitelist attacker-controlled accounts for illegitimate transfers

**2. Epoch Program - initialize_epoch_state.rs:32**
```rust
pub fn handler(ctx: Context<InitializeEpochState>) -> Result<()> {
    ...
    epoch_state.genesis_slot = clock.slot;
    epoch_state.cheap_side = 0; // CRIME
    epoch_state.low_tax_bps = GENESIS_LOW_TAX_BPS; // 300 bps
    epoch_state.high_tax_bps = GENESIS_HIGH_TAX_BPS; // 1400 bps
    ...
}
```
While the genesis parameters are hardcoded (reducing manipulation risk), a front-runner could claim the genesis slot, affecting epoch timing. More critically, if any parameter were configurable, this would be exploitable.

**3. Staking - initialize_stake_pool.rs**
Same pattern -- any signer can initialize the stake pool. The dead stake (MINIMUM_STAKE) transfer during init is paid by the caller, which acts as a mild economic deterrent but not a security control.

**Mitigating factor:** All three use Anchor `init` which prevents re-initialization (the PDA can only be created once). The race condition window is limited to the deployment transaction block. In practice, the deployer typically runs all initialization in a single transaction or script immediately after deployment.

**Recommendation:** Add upgrade-authority verification (like AMM's `initialize_admin.rs` pattern) to all three initialization instructions. This is the strongest defense against front-running:
```rust
#[account(
    constraint = program_data.upgrade_authority_address == Some(authority.key())
)]
pub program_data: Account<'info, ProgramData>,
```

**Trigger Epoch Transition (trigger_epoch_transition.rs):**
- Intentionally permissionless (crank-operated)
- VRF randomness account validated: `owner = SWITCHBOARD_PROGRAM_ID`
- Slot freshness: `slot_diff <= 1` (prevents stale randomness)
- Anti-reroll: `epoch_state.pending_randomness_account` binding prevents re-triggering
- Epoch boundary: minimum slots since last epoch enforced
- Bounty transfer to caller (incentive for cranking)

**FINDING AC-007: Bounty Rent-Exempt Bug (LOW, Known)**
File: `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`

The bounty transfer checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` but does not account for the rent-exempt minimum. After transfer, the sol_vault can drop below rent-exempt threshold (~890,880 lamports), causing a runtime rejection. This is documented in the project's TODO list.

**Execute Carnage Atomic (execute_carnage_atomic.rs):**
- Permissionless (no-op when `carnage_pending = false`)
- EpochState and CarnageFundState validated via seeds + bump + initialized
- carnage_signer PDA: `seeds = [CARNAGE_SIGNER_SEED], bump`
- Vault validation: `crime_vault.key() == carnage_state.crime_vault`, `fraud_vault.key() == carnage_state.fraud_vault`
- Mint validation: `crime_mint.key() == crime_vault.mint`, `fraud_mint.key() == fraud_vault.mint`
- Programs validated: `address = tax_program_id()`, `address = amm_program_id()`
- Token interfaces validated via `Interface<'info, TokenInterface>` (FP-007)

**AC-009/AC-010: AccountInfo CPI Passthroughs (INFO)**
13 AccountInfo accounts in execute_carnage_atomic are CPI passthroughs to Tax::swap_exempt:
- `crime_pool`, `crime_pool_vault_a`, `crime_pool_vault_b`
- `fraud_pool`, `fraud_pool_vault_a`, `fraud_pool_vault_b`
- `mint_a` (WSOL mint)
- `swap_authority`

These are **not validated** in the Epoch Program itself. However:
1. Tax Program validates `swap_authority` via `seeds = [SWAP_AUTHORITY_SEED], bump` (PDA constraint)
2. Tax Program validates pools/vaults via AMM CPI which enforces pool.vault_a/vault_b matching
3. If wrong accounts are passed, the CPI chain will fail at the receiving program

This matches FP-014 and FP-015: AccountInfo passthroughs that are validated by downstream programs are safe. The `/// CHECK:` comments correctly document this delegation of validation. However, the `swap_authority` (line 179) has no constraints at all -- not even a `/// CHECK:` that references specific downstream validation. This is the weakest link in the passthrough chain, though it is ultimately validated by the Tax Program.

**FINDING AC-006: force_carnage Devnet-Only Instruction (LOW)**
File: `programs/epoch-program/src/instructions/force_carnage.rs`

A `#[cfg(feature = "devnet")]` gated instruction that allows a hardcoded `DEVNET_ADMIN` pubkey to force carnage execution without VRF. This MUST be verified absent from mainnet builds. The `#[cfg(feature = "devnet")]` conditional compilation should exclude this entirely, but:
- Build process must be verified to NOT include `--features devnet` for mainnet
- The hardcoded admin key should be audited to ensure it's not a mainnet key

---

#### 2.4 Transfer Hook Program (`programs/transfer-hook/`)

**Authority Model:**
- WhitelistAuthority PDA (`seeds = [b"authority"]`) stores `authority: Option<Pubkey>`
- Authority can add whitelist entries and burn their own authority
- After burn, `authority = None` and whitelist is frozen (no new entries)

**Transfer Hook Validation (transfer_hook.rs):**
4-layer validation:
1. Zero amount: skip hook for zero transfers
2. Mint owner: `mint_account.owner == &spl_token_2022::ID` (Token-2022 only)
3. Transferring flag: `source.is_transferring()` prevents direct invocation
4. Whitelist: both source and destination must have WhitelistEntry PDAs

The `is_whitelisted` function uses `find_program_address` to derive the expected PDA and compares:
- Checks remaining_accounts for the expected PDA address
- Verifies the PDA derivation matches (prevents passing arbitrary accounts)

**FINDING AC-008: burn_authority Manual Check (LOW)**
File: `programs/transfer-hook/src/instructions/burn_authority.rs`

The `burn_authority` instruction validates authority via manual check in the handler rather than `has_one` constraint:
```rust
// No has_one constraint on the struct:
#[account(mut, seeds = [WhitelistAuthority::SEED], bump)]
pub whitelist_authority: Account<'info, WhitelistAuthority>,
pub authority: Signer<'info>,

// Manual check in handler:
require!(auth.authority == Some(authority.key()), ...);
```

While functionally equivalent, this deviates from the protocol's own pattern (AMM uses `has_one = admin` consistently). The manual check runs AFTER account deserialization, meaning the transaction pays compute for deserialization even when unauthorized. With `has_one`, the check happens during constraint evaluation, failing earlier.

**Severity: LOW** -- No security impact, but inconsistent patterns increase audit surface.

---

#### 2.5 Staking Program (`programs/staking/`)

**Authority Model:**
- StakePool PDA (`seeds = [b"stake_pool"]`) is global singleton
- No admin -- pool parameters are set once during init
- CPI-gated operations:
  - `deposit_rewards`: Only Tax Program via tax_authority PDA
  - `update_cumulative`: Only Epoch Program via staking_authority PDA
- User operations (stake/claim/unstake): User signer + UserStake PDA ownership

**CPI Gating Pattern (deposit_rewards.rs, update_cumulative.rs):**
```rust
// deposit_rewards.rs
#[account(
    seeds = [TAX_AUTHORITY_SEED],      // b"tax_authority"
    bump,
    seeds::program = tax_program_id(), // DRjNCjt4...
)]
pub tax_authority: Signer<'info>,
```
This is the correct pattern (SP-031). The `Signer<'info>` + `seeds::program` combination ensures:
1. The account IS a signer (runtime check)
2. The PDA derivation uses the Tax Program as the owning program
3. Only the Tax Program can produce a valid `invoke_signed` with these seeds

Same pattern for `update_cumulative` with `STAKING_AUTHORITY_SEED` + `epoch_program_id()`.

**init_if_needed for UserStake (stake.rs:43-50):**
```rust
#[account(
    init_if_needed,
    payer = user,
    space = UserStake::LEN,
    seeds = [USER_STAKE_SEED, user.key().as_ref()],
    bump,
)]
pub user_stake: Account<'info, UserStake>,
```

Analysis per FP-004:
- Seeds include `user.key()` making it user-specific (one UserStake per user)
- Anchor's `init_if_needed` checks discriminator -- if account exists with valid discriminator, it loads it; if zero-initialized, it creates it
- New user detection: `user.owner == Pubkey::default()` -- fresh Anchor accounts have zero-initialized fields, so owner=Pubkey::default() correctly identifies new accounts
- If UserStake already exists, the initialization block is skipped, and existing state is preserved
- Risk: If a user's UserStake somehow had `owner = Pubkey::default()` but was not new (corrupted state), the initialization block would reset their `rewards_per_token_paid`. This is theoretically impossible because: (a) the owner is set to `user.key()` on first stake, and (b) no instruction ever sets owner back to default

**Assessment: Safe** -- This is a correct use of `init_if_needed` for user-facing PDAs.

**Claim/Unstake Ownership (claim.rs, unstake.rs):**
```rust
#[account(
    mut,
    seeds = [USER_STAKE_SEED, user.key().as_ref()],
    bump = user_stake.bump,
    constraint = user_stake.owner == user.key() @ StakingError::UnauthorizedAccess,
)]
pub user_stake: Account<'info, UserStake>,
```

Dual validation: PDA seeds include user key (address derivation) + explicit owner constraint (data validation). The seeds constraint alone would be sufficient (since the PDA address uniquely maps to the user), but the explicit ownership check adds defense-in-depth.

---

### 3. Cross-Program PDA Chain Verification

This is the most critical validation for the protocol's security model. Every cross-program CPI is authorized via PDA signer patterns.

#### Chain 1: Tax -> AMM (Swap Execution)

```
Tax Program derives: PDA = find_program_address([b"swap_authority"], TAX_PROGRAM_ID)
Tax Program signs CPI to AMM with: invoke_signed([b"swap_authority", &[bump]])
AMM validates: seeds = [SWAP_AUTHORITY_SEED], bump, seeds::program = TAX_PROGRAM_ID
```

Verification:
- Tax `SWAP_AUTHORITY_SEED` = `b"swap_authority"` (tax-program/constants.rs:11)
- AMM `SWAP_AUTHORITY_SEED` = `b"swap_authority"` (amm/constants.rs:5)
- AMM `TAX_PROGRAM_ID` = `pubkey!("DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj")` (amm/constants.rs)
- Tax Program ID = `DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj` (declared in tax program)
- **MATCH** -- Seeds identical, program IDs identical

#### Chain 2: Epoch -> Tax (Carnage Execution)

```
Epoch Program derives: PDA = find_program_address([b"carnage_signer"], EPOCH_PROGRAM_ID)
Epoch Program signs CPI to Tax with: invoke_signed([b"carnage_signer", &[bump]])
Tax validates: seeds = [CARNAGE_SIGNER_SEED], bump, seeds::program = epoch_program_id()
```

Verification:
- Epoch `CARNAGE_SIGNER_SEED` = `b"carnage_signer"` (epoch-program/constants.rs:91)
- Tax `CARNAGE_SIGNER_SEED` = `b"carnage_signer"` (tax-program/constants.rs:66)
- Tax `epoch_program_id()` = `"G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz"` (tax-program/constants.rs)
- Epoch Program ID = `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz`
- **MATCH** -- Seeds identical, program IDs identical
- Additional: `test_carnage_signer_pda.rs` has unit tests verifying seed value and PDA derivation consistency

#### Chain 3: Tax -> Staking (Reward Distribution)

```
Tax Program derives: PDA = find_program_address([b"tax_authority"], TAX_PROGRAM_ID)
Tax Program signs CPI to Staking with: invoke_signed([b"tax_authority", &[bump]])
Staking validates: seeds = [TAX_AUTHORITY_SEED], bump, seeds::program = tax_program_id()
```

Verification:
- Tax `TAX_AUTHORITY_SEED` = `b"tax_authority"` (tax-program/constants.rs:110)
- Staking `TAX_AUTHORITY_SEED` = `b"tax_authority"` (staking/constants.rs:73)
- Staking `tax_program_id()` = `"DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj"` (staking/constants.rs)
- **MATCH** -- Seeds identical, program IDs identical
- Additional: `staking/constants.rs` has unit tests asserting `TAX_AUTHORITY_SEED == b"tax_authority"` and length = 13

#### Chain 4: Epoch -> Staking (Cumulative Update)

```
Epoch Program derives: PDA = find_program_address([b"staking_authority"], EPOCH_PROGRAM_ID)
Epoch Program signs CPI to Staking with: invoke_signed([b"staking_authority", &[bump]])
Staking validates: seeds = [STAKING_AUTHORITY_SEED], bump, seeds::program = epoch_program_id()
```

Verification:
- Epoch `STAKING_AUTHORITY_SEED` = `b"staking_authority"` (epoch-program/constants.rs:112)
- Staking `STAKING_AUTHORITY_SEED` = `b"staking_authority"` (staking/constants.rs:64)
- Staking `epoch_program_id()` = `"G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz"` (staking/constants.rs)
- **MATCH** -- Seeds identical, program IDs identical
- Additional: `epoch-program/constants.rs` has unit tests asserting seed value and length = 17

**Overall PDA chain assessment:** All 4 cross-program PDA authority chains are correctly implemented and consistent. The protocol uses the recommended `Signer<'info>` + `seeds::program` pattern throughout, which is the strongest form of CPI access control on Solana.

---

### 4. Detailed Findings

#### AC-001: Initialization Front-Running (HIGH)

**Affected files:**
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/src/instructions/initialize_authority.rs:15`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/initialize_epoch_state.rs:32`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/initialize_stake_pool.rs`

**EP Reference:** EP-075 (Double Initialization -- mitigated by `init`), EP-076 (Missing Deployer Check)

**Root cause:** These initialization instructions accept any `Signer<'info>` as the caller/payer without verifying they hold the program's upgrade authority. While Anchor's `init` prevents re-initialization (the PDA can only be created once), the first caller sets critical protocol state.

**Risk assessment:**
- **Transfer Hook** (highest risk): First caller becomes whitelist authority with power over all CRIME/FRAUD token transfers
- **Epoch Program** (moderate risk): Genesis parameters are hardcoded constants, limiting manipulation. But genesis_slot timing could be influenced.
- **Staking** (lower risk): Pool parameters are derived from constants. Dead stake amount is fixed.

**Contrast with AMM:** The AMM's `initialize_admin.rs` correctly verifies `program_data.upgrade_authority_address == Some(authority.key())`, meaning only the program's upgrade authority can initialize. This is the gold standard pattern.

**Exploit scenario (Transfer Hook):**
1. Attacker monitors mempool for protocol deployment transaction
2. Attacker front-runs with `initialize_authority` in same block, paying rent
3. Attacker is now the whitelist authority
4. Attacker can refuse to whitelist protocol vaults -> complete protocol DoS
5. Or whitelist attacker accounts -> unauthorized token movement

**Mitigation status:** Partially mitigated by deployment script timing (initialize in same transaction as deploy). Not mitigated at the program level.

**Recommendation:** Add `ProgramData` upgrade authority check to all three initialization instructions.

---

#### AC-002: `constraint = true` Placeholder Validation (MEDIUM)

**Affected files:**
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_buy.rs:436,447`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_sell.rs:575,586`

**EP Reference:** EP-007 (Account Relationship Not Verified)

**Code:**
```rust
#[account(
    mut,
    constraint = true @ TaxError::InvalidStakingEscrow,
    seeds = [ESCROW_VAULT_SEED],
    seeds::program = staking_program_id(),
    bump,
)]
pub staking_escrow: AccountInfo<'info>,
```

**Analysis:** The `constraint = true` is a no-op that can never trigger the associated error. The PDA seeds + seeds::program constraint is what actually validates the account address. This appears to be a placeholder from development where a more specific constraint was intended but never added.

**Impact:** No direct security impact (PDA seeds provide validation). But:
1. Dead error codes (`TaxError::InvalidStakingEscrow`, `TaxError::InvalidCarnageVault`) create false audit confidence
2. If the seeds constraint were ever removed or weakened, the `constraint = true` would provide zero fallback protection
3. Inconsistent with the rest of the codebase which uses meaningful constraints

**Recommendation:** Either remove the `constraint = true` line (rely on seeds alone) or replace with a meaningful check such as validating the account's data or owner.

---

#### AC-003: No Emergency Pause Mechanism (MEDIUM)

**Affected:** All 5 programs

**EP Reference:** EP-072 (Missing Circuit Breaker)

**Analysis:** No program in the protocol implements an emergency pause or circuit breaker mechanism. If a vulnerability is discovered:
- AMM swaps cannot be paused (pool has a `locked` field but no instruction to set it)
- Tax collection continues
- Epoch transitions continue
- Staking operations continue
- Transfer Hook whitelist enforcement continues (cannot be modified after authority burn)

**Comparison to secure pattern SP-018:**
```rust
// SP-018: Emergency Pause Pattern (NOT PRESENT)
#[account(constraint = !protocol_state.paused @ ErrorCode::ProtocolPaused)]
pub protocol_state: Account<'info, ProtocolState>,
```

**Risk:** In a crisis scenario, the only option to halt operations would be to upgrade programs (requires upgrade authority + deployment time) or halt the network (not feasible). The admin burn mechanism (AMM) and authority burn mechanism (Transfer Hook) further limit emergency response capabilities.

**Recommendation:** Add a pause mechanism controlled by a multisig/governance system. The AMM's `pool.locked` field already exists but has no instruction to toggle it -- consider adding a `lock_pool`/`unlock_pool` admin instruction before admin burn.

---

#### AC-004: No Admin Key Rotation (MEDIUM)

**Affected files:**
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/state/admin.rs`

**EP Reference:** EP-068 (Single Admin Key), EP-069 (No Key Rotation)

**Analysis:** The AdminConfig struct stores only:
```rust
pub struct AdminConfig {
    pub admin: Pubkey,
    pub bump: u8,
}
```

There is no `pending_admin` field for two-step authority transfer (SP-017 pattern). If the admin key is compromised:
1. There is no way to rotate to a new admin
2. The only option is `burn_admin` which permanently disables pool creation
3. A compromised admin could create malicious pools before the burn

The admin key could be a multisig (stored pubkey can be any valid address), which mitigates single-point-of-failure. But there's no on-chain enforcement of multisig.

**Recommendation:** Before admin burn, consider implementing two-step transfer:
```rust
pub struct AdminConfig {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub bump: u8,
}
```

---

#### AC-005: Mainnet Treasury/Mint Placeholders (MEDIUM)

**Affected files:**
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/constants.rs:144,164`

**Code:**
```rust
// Line 133-144
/// MAINNET: Replace Pubkey::default() with the actual mainnet treasury
pub fn treasury_pubkey() -> Pubkey {
    #[cfg(feature = "devnet")]
    { pubkey!("8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4") }
    #[cfg(not(feature = "devnet"))]
    { Pubkey::default() }  // <-- MAINNET PLACEHOLDER
}

// Line 155-164
/// MAINNET: Replace Pubkey::default() with the mainnet PROFIT mint.
pub fn profit_mint() -> Pubkey {
    #[cfg(feature = "devnet")]
    { pubkey!("8y7Mat...") }
    #[cfg(not(feature = "devnet"))]
    { Pubkey::default() }  // <-- MAINNET PLACEHOLDER
}
```

**Risk:** If deployed to mainnet without updating:
- `treasury_pubkey()` returns `Pubkey::default()` -- tax revenue would be sent to an unrecoverable address (system program owns the zero address)
- `profit_mint()` returns `Pubkey::default()` -- PROFIT token operations would reference a nonexistent mint

These are effectively **deployment footguns** that are harmless on devnet but catastrophic on mainnet.

**Recommendation:** Add compile-time assertions in the mainnet build that treasury and mint are not `Pubkey::default()`:
```rust
#[cfg(not(feature = "devnet"))]
const _: () = assert!(treasury_pubkey() != Pubkey::default(), "Set mainnet treasury!");
```

---

### 5. EP Pattern Coverage

| EP | Pattern | Status | Notes |
|----|---------|--------|-------|
| EP-001 | Missing Signer | PASS | All authority accounts use `Signer<'info>`. CPI authorities use PDA + Signer. |
| EP-002 | Missing Owner | PASS | `Account<'info, T>` validates owner automatically (FP-001). Manual owner checks for cross-program AccountInfo. |
| EP-007 | Account Relationship Not Verified | PARTIAL | `constraint = true` placeholders (AC-002). All other relationships verified via has_one, seeds, or key comparison. |
| EP-009 | Duplicate Mutable Accounts | PASS | Pool vaults use distinct PDA seeds (vault_a vs vault_b). Mints ordered canonically (mint_a < mint_b). |
| EP-010 | Unchecked Token Mint | PASS | All vault accounts use `token::mint = ...` constraint. Mint owner validated via token program matching. |
| EP-026 | Missing Authority Constraint | FINDING | `constraint = true` on staking_escrow/carnage_vault (AC-002). |
| EP-027 | Confused Deputy | PASS | CPI authorization uses PDA signer (not user signer forwarding). AMM refuses non-Tax callers. |
| EP-032 | PDA Authority Without Derivation Check | PASS | All PDA authorities use `seeds::program` for cross-program validation. |
| EP-068 | Single Admin Key | FINDING | AMM AdminConfig has single admin (AC-004). No multisig enforcement. |
| EP-071 | Unprotected Upgrade Authority | PARTIAL | AMM checks upgrade authority for admin init. Other programs don't (AC-001). |
| EP-075 | Double Initialization | PASS | All init instructions use Anchor `init` constraint (prevents re-initialization). |
| EP-076 | Missing Deployer Verification | FINDING | 3 init instructions accept any signer (AC-001). |
| EP-126 | Multisig/ACL Role Escalation | N/A | No multisig implementation exists. Single admin model. |

---

### 6. Test Coverage Assessment

The protocol has strong test coverage for access control:
- **AMM**: `test_cpi_access_control.rs` explicitly tests fake-tax-program rejection, wrong PDA seeds, and seeds::program mismatch
- **Tax Program**: `test_carnage_signer_pda.rs` verifies PDA derivation consistency between Tax and Epoch programs
- **Tax Program**: `test_swap_exempt.rs` tests unauthorized carnage signer rejection
- **Staking**: Test count of 38 includes CPI gating tests

Notable gaps:
- No tests for initialization front-running (attempting init from non-deployer)
- No tests for the `constraint = true` patterns (they can't fail, so no test exists)
- No integration tests for the full CPI chain (Epoch -> Tax -> AMM) with wrong accounts

---

### 7. Recommendations Priority

| Priority | Recommendation | Effort |
|----------|---------------|--------|
| P1 (Pre-mainnet) | Add upgrade authority check to Transfer Hook, Epoch, and Staking init instructions | Low |
| P1 (Pre-mainnet) | Replace mainnet Pubkey::default() placeholders with real addresses + compile-time assertions | Low |
| P1 (Pre-mainnet) | Verify force_carnage is excluded from mainnet build | Low |
| P2 (Pre-mainnet) | Fix bounty rent-exempt bug in trigger_epoch_transition | Low |
| P2 (Pre-mainnet) | Replace `constraint = true` with meaningful checks or remove | Low |
| P3 (Enhancement) | Add emergency pause mechanism (at least for AMM pool.locked toggle) | Medium |
| P3 (Enhancement) | Add two-step admin transfer before admin burn | Medium |
| P4 (Nice-to-have) | Use has_one for burn_authority consistency | Low |

---

### 8. Appendix: Files Analyzed

| File | Program | Risk Level | Key Patterns Found |
|------|---------|------------|-------------------|
| `amm/src/instructions/initialize_admin.rs` | AMM | Core | Upgrade authority check (gold standard) |
| `amm/src/instructions/burn_admin.rs` | AMM | Core | Irreversible admin burn |
| `amm/src/instructions/initialize_pool.rs` | AMM | Core | Admin gating, canonical ordering, vault creation |
| `amm/src/instructions/swap_sol_pool.rs` | AMM | Critical | PDA signer, vault/mint/program validation |
| `amm/src/instructions/swap_profit_pool.rs` | AMM | Critical | PDA signer (identical pattern) |
| `amm/src/constants.rs` | AMM | Reference | TAX_PROGRAM_ID, SWAP_AUTHORITY_SEED |
| `amm/src/state/admin.rs` | AMM | Core | AdminConfig struct (no pending_admin) |
| `tax-program/src/instructions/swap_sol_buy.rs` | Tax | Critical | constraint=true, cross-program PDA validation |
| `tax-program/src/instructions/swap_sol_sell.rs` | Tax | Critical | constraint=true, cross-program PDA validation |
| `tax-program/src/instructions/swap_exempt.rs` | Tax | Critical | Carnage signer PDA validation |
| `tax-program/src/constants.rs` | Tax | Reference | All cross-program IDs and seeds |
| `epoch-program/src/instructions/initialize_epoch_state.rs` | Epoch | Core | No deployer check |
| `epoch-program/src/instructions/trigger_epoch_transition.rs` | Epoch | Critical | Permissionless, VRF validation |
| `epoch-program/src/instructions/execute_carnage_atomic.rs` | Epoch | Critical | 13x AccountInfo passthroughs |
| `epoch-program/src/instructions/force_carnage.rs` | Epoch | Core | Devnet-only admin override |
| `epoch-program/src/constants.rs` | Epoch | Reference | Cross-program IDs and seeds |
| `transfer-hook/src/instructions/initialize_authority.rs` | Hook | Core | No deployer check |
| `transfer-hook/src/instructions/add_whitelist_entry.rs` | Hook | Core | Authority + whitelist validation |
| `transfer-hook/src/instructions/burn_authority.rs` | Hook | Core | Manual authority check |
| `transfer-hook/src/instructions/transfer_hook.rs` | Hook | Critical | 4-layer validation |
| `transfer-hook/src/state/whitelist_authority.rs` | Hook | Reference | Authority state structure |
| `staking/src/instructions/initialize_stake_pool.rs` | Staking | Core | No deployer check |
| `staking/src/instructions/deposit_rewards.rs` | Staking | Critical | CPI gating via tax_authority PDA |
| `staking/src/instructions/update_cumulative.rs` | Staking | Critical | CPI gating via staking_authority PDA |
| `staking/src/instructions/stake.rs` | Staking | Core | init_if_needed, user detection |
| `staking/src/instructions/claim.rs` | Staking | Core | Ownership validation, reward distribution |
| `staking/src/instructions/unstake.rs` | Staking | Core | Ownership validation, partial unstake |
| `staking/src/constants.rs` | Staking | Reference | Cross-program IDs and seeds |

---
<!-- END OF FULL ANALYSIS -->
