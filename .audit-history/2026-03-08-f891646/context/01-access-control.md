---
task_id: sos-phase1-access-control
provides: [access-control-findings, access-control-invariants]
focus_area: access-control
files_analyzed: [amm/initialize_admin.rs, amm/initialize_pool.rs, amm/swap_sol_pool.rs, amm/burn_admin.rs, epoch-program/initialize_epoch_state.rs, epoch-program/trigger_epoch_transition.rs, epoch-program/initialize_carnage_fund.rs, epoch-program/force_carnage.rs, epoch-program/expire_carnage.rs, epoch-program/execute_carnage.rs, epoch-program/execute_carnage_atomic.rs, epoch-program/consume_randomness.rs, staking/initialize_stake_pool.rs, staking/deposit_rewards.rs, staking/update_cumulative.rs, staking/stake.rs, staking/unstake.rs, staking/claim.rs, tax-program/swap_sol_buy.rs, tax-program/swap_sol_sell.rs, tax-program/swap_exempt.rs, tax-program/initialize_wsol_intermediary.rs, transfer-hook/initialize_authority.rs, transfer-hook/add_whitelist_entry.rs, transfer-hook/burn_authority.rs, transfer-hook/transfer_hook.rs, transfer-hook/initialize_extra_account_meta_list.rs, bonding_curve/initialize_curve.rs, bonding_curve/fund_curve.rs, bonding_curve/start_curve.rs, bonding_curve/purchase.rs, bonding_curve/sell.rs, bonding_curve/mark_failed.rs, bonding_curve/prepare_transition.rs, bonding_curve/distribute_tax_escrow.rs, bonding_curve/consolidate_for_refund.rs, bonding_curve/claim_refund.rs, bonding_curve/withdraw_graduated_sol.rs, bonding_curve/close_token_vault.rs, conversion-vault/initialize.rs, conversion-vault/convert.rs]
finding_count: 12
severity_breakdown: {critical: 1, high: 3, medium: 5, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# Access Control & Account Validation -- Condensed Summary

## Key Findings (Top 10)

1. **Bonding Curve `authority` is unbound -- ANY signer can call admin instructions**: `initialize_curve.rs`, `start_curve.rs`, `prepare_transition.rs`, `withdraw_graduated_sol.rs`, `close_token_vault.rs`, `fund_curve.rs` all accept a bare `Signer<'info>` named `authority` with NO `has_one`, NO hardcoded pubkey check, and NO ProgramData constraint. Anyone who signs can call these instructions. -- `bonding_curve/src/instructions/*.rs`

2. **Transfer Hook `initialize_authority` is front-runnable**: Any signer can call, first caller becomes permanent authority. No ProgramData upgrade-authority gate. Previous finding S005 is NOT FIXED. -- `transfer-hook/src/instructions/initialize_authority.rs:15-46`

3. **Epoch `initialize_epoch_state` has no authority check**: Any signer can initialize. Previous finding H057 is NOT FIXED. First caller pays rent and sets genesis parameters. Mitigated by `init` uniqueness (PDA can only be created once), but a front-runner becomes the payer/creator. -- `epoch-program/src/instructions/initialize_epoch_state.rs:97-116`

4. **seeds::program CPI gating is well-implemented**: The four cross-program trust boundaries (AMM<-Tax, Staking<-Tax, Staking<-Epoch, Tax<-Epoch) all use `seeds::program` with correct seed constants. This is the strongest access control pattern in the codebase. -- `amm/swap_sol_pool.rs:367-372`, `staking/deposit_rewards.rs:37-41`, `staking/update_cumulative.rs:37-41`, `tax-program/swap_exempt.rs:193-197`

5. **AMM admin pattern is robust**: `initialize_admin` requires ProgramData upgrade authority. `initialize_pool` uses `has_one = admin` against AdminConfig PDA. `burn_admin` irreversibly zeroes the admin key. -- `amm/src/instructions/initialize_admin.rs:27-59`

6. **EpochState cross-program deserialization in Tax Program properly validates owner + discriminator**: Manual owner check against `epoch_program_id()` plus `try_deserialize` discriminator validation prevents fake EpochState attacks. -- `tax-program/src/instructions/swap_sol_buy.rs:58-76`

7. **Conversion Vault `initialize` has no authority check**: Comment says "Any signer can initialize." This is intentional per comment, but means front-running is possible. No stored authority means no admin functions post-init. -- `conversion-vault/src/instructions/initialize.rs:10-11`

8. **Staking `initialize_stake_pool` has no authority check**: Same pattern as Epoch init -- any signer, protected only by PDA uniqueness of `init`. -- `staking/src/instructions/initialize_stake_pool.rs:27-31`

9. **`initialize_carnage_fund` has no authority check**: Same open-init pattern. Any signer can initialize. -- `epoch-program/src/instructions/initialize_carnage_fund.rs:71-74`

10. **Bonding curve permissionless instructions (`mark_failed`, `distribute_tax_escrow`, `consolidate_for_refund`, `claim_refund`) are correctly permissionless**: These are intentionally callable by anyone, with proper state guards (status checks, deadline checks, refund eligibility). No signer abuse vector. -- Various bonding_curve instructions

## Critical Mechanisms

- **seeds::program CPI Access Control**: Four cross-program boundaries use PDA + `seeds::program` to gate CPI calls. The Tax Program signs as `swap_authority` for AMM swaps, `tax_authority` for Staking deposits. Epoch Program signs as `staking_authority` for cumulative updates, `carnage_signer` for tax-exempt swaps. Each has bidirectional seed agreement (caller and callee agree on seed constants). -- `amm/swap_sol_pool.rs:367-372`, `staking/deposit_rewards.rs:37-41`

- **AMM Admin Lifecycle**: AdminConfig PDA created by upgrade authority, stores admin pubkey, gates pool creation via `has_one`. Admin can be burned (set to `Pubkey::default()`), permanently disabling pool creation. This is the model pattern. -- `amm/initialize_admin.rs`, `amm/burn_admin.rs`

- **Whitelist Authority Burn Pattern**: Transfer Hook authority stored as `Option<Pubkey>`. `None` = burned. `burn_authority` is idempotent and irreversible. `add_whitelist_entry` checks `authority.is_some()`. This pattern makes the whitelist immutable post-burn. -- `transfer-hook/burn_authority.rs`, `transfer-hook/add_whitelist_entry.rs`

- **EpochState Manual Deserialization**: Tax Program reads EpochState as raw `AccountInfo`, manually validates owner (must be Epoch Program) and discriminator (via `try_deserialize`). This prevents attackers from passing a fake EpochState with 0% tax rates. -- `tax-program/swap_sol_buy.rs:58-76`

- **Reentrancy Guard**: AMM pool has a `locked` boolean field. Set to `true` at swap entry, cleared at exit. Anchor constraint `!pool.locked` rejects concurrent swaps. -- `amm/swap_sol_pool.rs:381`

## Invariants & Assumptions

- INVARIANT: Only Tax Program can invoke AMM `swap_sol_pool` -- enforced at `amm/swap_sol_pool.rs:367-372` via `seeds::program = TAX_PROGRAM_ID`
- INVARIANT: Only Tax Program can invoke Staking `deposit_rewards` -- enforced at `staking/deposit_rewards.rs:37-41` via `seeds::program = tax_program_id()`
- INVARIANT: Only Epoch Program can invoke Staking `update_cumulative` -- enforced at `staking/update_cumulative.rs:37-41` via `seeds::program = epoch_program_id()`
- INVARIANT: Only Epoch Program can invoke Tax `swap_exempt` -- enforced at `tax-program/swap_exempt.rs:193-197` via `seeds::program = epoch_program_id()`
- INVARIANT: AMM pools can only be created by the admin stored in AdminConfig -- enforced at `amm/initialize_pool.rs:205-208` via `has_one = admin`
- INVARIANT: AdminConfig can only be created by the program's upgrade authority -- enforced at `amm/initialize_admin.rs:46-56`
- INVARIANT: Whitelist entries can only be added while authority is not burned -- enforced at `transfer-hook/add_whitelist_entry.rs:52`
- ASSUMPTION: Bonding curve `authority` signer is the deployer -- **NOT ENFORCED on-chain** in any bonding curve instruction
- ASSUMPTION: `initialize_epoch_state` will be called by the deployer before any attacker -- **NOT ENFORCED**, relies on deployment ordering
- ASSUMPTION: Cross-program seed constants match between callers and callees -- validated in constants.rs files, but fragile if one side changes
- ASSUMPTION: `force_carnage` is only present in devnet builds -- enforced by `#[cfg(feature = "devnet")]` at module level

## Risk Observations (Prioritized)

1. **CRITICAL -- Bonding Curve has no authority verification**: `prepare_transition`, `withdraw_graduated_sol`, `close_token_vault`, `start_curve`, `initialize_curve`, `fund_curve` all accept ANY signer as `authority`. An attacker could call `prepare_transition` to graduate curves prematurely (if both are Filled), or call `withdraw_graduated_sol` to extract SOL from graduated vaults, or call `start_curve` on an unfunded curve. The state guards (status == Filled, status == Graduated, vault.amount >= TARGET_TOKENS) provide some defense, but the authority bypass is a fundamental access control gap.

2. **HIGH -- Initialization front-running across 5 programs**: `initialize_epoch_state`, `initialize_carnage_fund`, `initialize_stake_pool`, `initialize_authority` (transfer hook), and `initialize` (conversion vault) all lack upgrade-authority gating. An attacker watching the mempool could front-run deployment. The impact varies: for Epoch/Staking/CarnageFund, the attacker only becomes the payer (no stored authority). For Transfer Hook, the attacker becomes the permanent whitelist authority (CRITICAL impact -- can ransom the protocol by refusing to whitelist necessary addresses).

3. **HIGH -- Transfer Hook authority ransom (S005 re-check)**: If front-run, attacker becomes whitelist authority. They could demand payment to whitelist protocol accounts, or burn the authority with an incomplete whitelist, bricking all token transfers. The `init` uniqueness prevents re-initialization, so the protocol would need to redeploy the Transfer Hook program and create new mints.

4. **MEDIUM -- Bounty payment can drain vault below rent-exempt**: `trigger_epoch_transition.rs:194-227` checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` but does not check whether the post-transfer balance remains above rent-exempt minimum. The carnage_sol_vault is a SystemAccount PDA, and draining below rent-exempt could destroy it. Previous finding H001 -- the code now gracefully skips bounty if balance insufficient, which mitigates the drain-to-zero case, but does not protect against drain-to-below-rent.

5. **MEDIUM -- No timelock on any admin parameter changes**: The protocol has no on-chain timelock mechanism. Admin actions (pool creation, curve graduation, SOL withdrawal) execute immediately.

## Novel Attack Surface

- **Bonding curve authority-less admin pattern**: The bonding curve program has 6 instructions that accept a bare `Signer<'info>` named `authority` with zero on-chain verification that this signer is the deployer. This is unusual because the AMM program in the same codebase correctly implements the `ProgramData` upgrade-authority pattern. The bonding curve was added later (v1.2) and appears to have skipped this pattern. An attacker could call `withdraw_graduated_sol` on a graduated curve to steal the raised SOL, or call `prepare_transition` to force graduation of filled curves before the intended orchestration timing.

- **Cross-program seed constant fragility**: The protocol relies on 4 pairs of programs agreeing on PDA seed constants (e.g., `SWAP_AUTHORITY_SEED = b"swap_authority"` in both Tax and AMM constants.rs). If a program is upgraded and the seed constant changes, the CPI gating silently breaks. There is no on-chain mechanism to verify seed agreement at initialization time.

- **Bonding curve `prepare_transition` lacks partner validation**: The instruction accepts two CurveState PDAs and requires both to be Filled. But it does not validate that one is CRIME and one is FRAUD (only that they are different PDAs). If two curves for the same token somehow existed (impossible with current seeds, but worth noting), an attacker could pass both.

## Cross-Focus Handoffs

- -> **CPI Agent**: The `swap_exempt` instruction passes `carnage_authority` signer privileges through to AMM via CPI. Verify AMM validates the `user` signer independently.
- -> **Upgrade/Admin Agent**: 6 bonding curve instructions have no admin verification. Assess whether the deployment script handles this operationally (e.g., calling these instructions before an attacker can observe the deployment TX).
- -> **Token/Economic Agent**: `withdraw_graduated_sol` extracts ALL SOL minus rent from graduated vaults. Verify the graduation orchestration (Phase 74) properly sequences this with pool seeding.
- -> **State Machine Agent**: Bonding curve status transitions are the primary defense against unauthorized admin actions (e.g., `withdraw_graduated_sol` requires status == Graduated). Verify the status state machine cannot be manipulated.
- -> **Timing Agent**: Transfer Hook `initialize_authority` front-running is a deployment-time timing vulnerability. Assess whether bundled deployment transactions can mitigate.

## Trust Boundaries

The protocol has three trust tiers: (1) **Fully trusted**: The protocol deployer/admin, who holds upgrade authority and is assumed to be the caller of initialization instructions and bonding curve admin instructions -- but this trust is NOT enforced on-chain for bonding curve instructions. (2) **CPI-trusted**: Programs that can invoke each other via seeds::program PDA gating -- Tax<->AMM, Tax<->Staking, Epoch<->Staking, Epoch<->Tax. This is the strongest enforcement. (3) **Untrusted**: All user-facing instructions (purchase, sell, swap_sol_buy, swap_sol_sell, stake, unstake, claim) properly validate user identity via Signer and ownership constraints. Permissionless instructions (mark_failed, distribute_tax_escrow, expire_carnage, trigger_epoch_transition) are correctly gated by state conditions rather than identity.
<!-- CONDENSED_SUMMARY_END -->

---

# Access Control & Account Validation -- Full Analysis

## Executive Summary

This analysis covers all access control mechanisms across 10 programs (7 production + 3 test mocks) in the Dr Fraudsworth protocol. The codebase demonstrates a split maturity level: the AMM, Tax Program, Staking, and Epoch Program have robust access control using `seeds::program` CPI gating, `has_one` authority constraints, and ProgramData upgrade-authority verification. However, the Bonding Curve program (added in v1.2) has a systematic access control gap where 6 admin-gated instructions accept a bare `Signer<'info>` with no on-chain authority verification.

The protocol's cross-program trust model is well-designed, using PDA-based CPI gating that is structurally secure (an unauthorized program cannot derive the correct PDA seeds). The initialization pattern across programs is weaker -- 5 of 10 programs use open initialization (any signer can call `init`), relying on PDA uniqueness and deployment ordering for security rather than on-chain authority checks.

The previous audit identified 8 findings in the access control domain. Of these: H001 (bounty drain) is partially mitigated (graceful skip when balance insufficient, but rent-exempt check still missing); S005 (transfer hook init front-running) is NOT FIXED; H057 (epoch state init no authority) is NOT FIXED; H125 (unauthorized pool creation) is FIXED (has_one admin constraint); H003/H037/H063/H124 need evaluation in context of current code.

## Scope

### Files Analyzed (Full Read - Layer 3)
- `programs/amm/src/instructions/initialize_admin.rs`
- `programs/amm/src/instructions/initialize_pool.rs`
- `programs/amm/src/instructions/swap_sol_pool.rs`
- `programs/amm/src/instructions/burn_admin.rs`
- `programs/epoch-program/src/instructions/initialize_epoch_state.rs`
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`
- `programs/epoch-program/src/instructions/initialize_carnage_fund.rs`
- `programs/epoch-program/src/instructions/force_carnage.rs`
- `programs/epoch-program/src/instructions/expire_carnage.rs`
- `programs/staking/src/instructions/deposit_rewards.rs`
- `programs/staking/src/instructions/update_cumulative.rs`
- `programs/staking/src/instructions/initialize_stake_pool.rs`
- `programs/staking/src/instructions/stake.rs`
- `programs/staking/src/instructions/claim.rs`
- `programs/tax-program/src/instructions/swap_sol_buy.rs`
- `programs/tax-program/src/instructions/swap_sol_sell.rs`
- `programs/tax-program/src/instructions/swap_exempt.rs`
- `programs/transfer-hook/src/instructions/initialize_authority.rs`
- `programs/transfer-hook/src/instructions/add_whitelist_entry.rs`
- `programs/transfer-hook/src/instructions/burn_authority.rs`
- `programs/transfer-hook/src/instructions/transfer_hook.rs`
- `programs/bonding_curve/src/instructions/initialize_curve.rs`
- `programs/bonding_curve/src/instructions/start_curve.rs`
- `programs/bonding_curve/src/instructions/fund_curve.rs`
- `programs/bonding_curve/src/instructions/purchase.rs` (partial - account struct)
- `programs/bonding_curve/src/instructions/prepare_transition.rs`
- `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs`
- `programs/bonding_curve/src/instructions/close_token_vault.rs`
- `programs/bonding_curve/src/instructions/mark_failed.rs`
- `programs/bonding_curve/src/instructions/distribute_tax_escrow.rs`
- `programs/bonding_curve/src/instructions/consolidate_for_refund.rs`
- `programs/conversion-vault/src/instructions/initialize.rs`
- `programs/epoch-program/src/instructions/initialize_carnage_fund.rs`

### Files Analyzed (Signature Scan - Layer 2)
- `programs/bonding_curve/src/instructions/sell.rs`
- `programs/bonding_curve/src/instructions/claim_refund.rs`
- `programs/staking/src/instructions/unstake.rs`
- `programs/conversion-vault/src/instructions/convert.rs`
- `programs/tax-program/src/instructions/initialize_wsol_intermediary.rs`
- `programs/transfer-hook/src/instructions/initialize_extra_account_meta_list.rs`
- `programs/epoch-program/src/instructions/consume_randomness.rs`
- `programs/epoch-program/src/instructions/execute_carnage.rs`
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`

### Estimated Coverage
~95% of access-control relevant code paths.

## Key Mechanisms

### 1. AMM Admin Lifecycle (Model Pattern)

**Location:** `programs/amm/src/instructions/initialize_admin.rs:27-59`, `burn_admin.rs:37-50`, `initialize_pool.rs:196-214`

**Purpose:** Secure admin setup for pool creation authorization.

**How it works:**
1. `initialize_admin`: Requires ProgramData account. Constraint `program_data.upgrade_authority_address == Some(authority.key())` ensures only the deployer can initialize. Stores an `admin` pubkey (can be different from deployer, e.g., multisig). `init` constraint prevents double-initialization.
2. `initialize_pool`: AdminConfig PDA loaded with `has_one = admin`. The `admin` account must be a `Signer<'info>` matching `admin_config.admin`. Separate `payer` (can be different from admin).
3. `burn_admin`: Sets `admin_config.admin = Pubkey::default()`. Since no one can sign as `Pubkey::default()`, this permanently disables `has_one = admin` checks, making pool creation impossible.

**Assumptions:**
- ProgramData account correctly reflects upgrade authority
- `Pubkey::default()` (all zeros) is unsignable

**Invariants:**
- AdminConfig can only be created once (PDA uniqueness)
- After burn, no new pools can be created
- Pool creation requires admin signature

**Concerns:** None. This is the model access control pattern. Other programs should follow this.

### 2. seeds::program CPI Access Control

**Location:** Four cross-program boundaries

**Purpose:** Ensure only authorized programs can call CPI-gated instructions.

**How it works:**
The Anchor `seeds::program` constraint verifies that a `Signer<'info>` PDA is derived from a specific program. The calling program uses `invoke_signed` with PDA seeds to produce the signer, and the callee verifies the derivation.

**Trust boundaries:**

| Callee Instruction | Authorized Caller | PDA Seed | Callee Verification Location |
|---|---|---|---|
| AMM `swap_sol_pool` | Tax Program | `SWAP_AUTHORITY_SEED` | `swap_sol_pool.rs:367-372` |
| Staking `deposit_rewards` | Tax Program | `TAX_AUTHORITY_SEED` | `deposit_rewards.rs:37-41` |
| Staking `update_cumulative` | Epoch Program | `STAKING_AUTHORITY_SEED` | `update_cumulative.rs:37-41` |
| Tax `swap_exempt` | Epoch Program | `CARNAGE_SIGNER_SEED` | `swap_exempt.rs:193-197` |

**Assumptions:**
- Seed constants match between caller and callee (verified: both define same seed strings in their constants.rs)
- Program IDs are correct (verified: feature-gated constants with different values for devnet vs mainnet)

**Invariants:**
- A program cannot produce a valid PDA signer for another program's seed space
- `seeds::program` constraint rejects PDAs derived from wrong programs

**Concerns:**
- If either program is upgraded and seed constants change, the CPI gating silently breaks. There is no on-chain mechanism to detect this.
- The seed constants are duplicated across programs (e.g., `SWAP_AUTHORITY_SEED` exists in both Tax and AMM constants). This is fragile.

### 3. Bonding Curve Authority Pattern (BROKEN)

**Location:** `bonding_curve/src/instructions/initialize_curve.rs:17-18`, `start_curve.rs:17-18`, `fund_curve.rs:23`, `prepare_transition.rs:20-21`, `withdraw_graduated_sol.rs:27-28`, `close_token_vault.rs:27-28`

**Purpose:** Restrict admin operations to the protocol deployer.

**How it works:** It does NOT work correctly. All 6 instructions declare:
```rust
pub authority: Signer<'info>,
```
There is NO:
- `has_one` constraint linking to a stored authority
- `address =` constraint with a hardcoded pubkey
- ProgramData upgrade-authority verification
- Any stored admin account

The `authority` is a bare signer -- anyone who signs the transaction can call these instructions.

**Assumptions:**
- The deployer calls these instructions during deployment before anyone else can
- The bonding curve lifecycle (Initialized -> Active -> Filled -> Graduated) provides state-based defense

**Invariants:** NONE for authority verification.

**Concerns:**
- **CRITICAL**: `withdraw_graduated_sol` transfers all SOL from a graduated curve vault to the `authority` signer. An attacker can call this after graduation to steal the raised SOL.
- **HIGH**: `prepare_transition` transitions both curves from Filled to Graduated. An attacker can call this to force early graduation.
- **HIGH**: `start_curve` activates a curve. An attacker could activate a curve before it's fully funded (mitigated by `token_vault.amount >= TARGET_TOKENS` check).
- **MEDIUM**: `close_token_vault` closes an empty vault and sends rent to `authority`. Low impact (only rent-exempt SOL).

### 4. Transfer Hook Whitelist Authority

**Location:** `transfer-hook/src/instructions/initialize_authority.rs:15-46`, `add_whitelist_entry.rs:44-70`, `burn_authority.rs:54-65`

**Purpose:** Control who can add addresses to the transfer whitelist.

**How it works:**
1. `initialize_authority`: First caller becomes authority. `init` prevents re-initialization.
2. `add_whitelist_entry`: Requires signer == stored `whitelist_authority.authority`, AND `authority.is_some()` (not burned).
3. `burn_authority`: Sets `authority = None`. Idempotent. Irreversible.

**Assumptions:**
- Deployer initializes before any attacker
- All necessary addresses are whitelisted before authority is burned

**Invariants:**
- Authority can be set exactly once
- After burn, no new whitelist entries can be added
- Whitelist entries are permanent (no remove instruction exists)

**Concerns:**
- Front-running vulnerability (S005 from previous audit): If an attacker calls `initialize_authority` before the deployer, they become the permanent whitelist authority. This is a protocol-bricking attack -- the attacker can refuse to whitelist necessary addresses (pool vaults, user accounts), preventing all token transfers.

### 5. EpochState Cross-Program Validation

**Location:** `tax-program/src/instructions/swap_sol_buy.rs:58-76`

**Purpose:** Prevent attackers from passing a fake EpochState with 0% tax rates.

**How it works:**
1. Owner check: `epoch_state.owner == &epoch_program_id()` -- verifies the account is owned by Epoch Program
2. Discriminator check: `EpochState::try_deserialize()` validates the 8-byte Anchor discriminator
3. Initialized check: `epoch_state.initialized == true` -- defense-in-depth

**Assumptions:**
- `epoch_program_id()` returns the correct Epoch Program ID
- Anchor discriminator is collision-resistant (SHA-256 first 8 bytes)

**Invariants:**
- Tax rates can only come from a legitimate, initialized EpochState

**Concerns:** The `epoch_state` is passed as raw `AccountInfo` (not validated by Anchor constraints). This is intentional -- it avoids a circular dependency between Tax and Epoch programs. The manual validation is thorough.

## Complete Role Matrix

| Role | Who | What Instructions | What Accounts | Trust Level |
|------|-----|-------------------|---------------|-------------|
| AMM Upgrade Authority | Deployer wallet | `initialize_admin` | ProgramData | FULL |
| AMM Admin | Pubkey stored in AdminConfig | `initialize_pool`, `burn_admin` | AdminConfig PDA | FULL |
| Tax Program (PDA) | Tax Program's swap_authority PDA | AMM `swap_sol_pool` | Pool state, vaults | CPI-TRUSTED |
| Tax Program (PDA) | Tax Program's tax_authority PDA | Staking `deposit_rewards` | StakePool, escrow | CPI-TRUSTED |
| Epoch Program (PDA) | Epoch Program's staking_authority PDA | Staking `update_cumulative` | StakePool | CPI-TRUSTED |
| Epoch Program (PDA) | Epoch Program's carnage_signer PDA | Tax `swap_exempt` | Pool, vaults | CPI-TRUSTED |
| Whitelist Authority | First initializer of WhitelistAuthority | `add_whitelist_entry`, `burn_authority` | WhitelistAuthority PDA | FULL |
| Bonding Curve "Authority" | **ANY SIGNER** | `initialize_curve`, `fund_curve`, `start_curve`, `prepare_transition`, `withdraw_graduated_sol`, `close_token_vault` | CurveState, vaults | **NONE (BROKEN)** |
| Devnet Admin | Hardcoded pubkey `8kPzh...` | `force_carnage` | EpochState | FULL (devnet only) |
| User (Staker) | Token account owner | `stake`, `unstake`, `claim` | UserStake PDA | LIMITED |
| User (Swapper) | Transaction signer | `swap_sol_buy`, `swap_sol_sell` | Token accounts | LIMITED |
| User (Curve Buyer) | Transaction signer | `purchase`, `sell` | CurveState, token accounts | LIMITED |
| Permissionless | Anyone | `trigger_epoch_transition`, `mark_failed`, `distribute_tax_escrow`, `consolidate_for_refund`, `expire_carnage` | Various | NONE (state-gated) |

## Authority Transfer Analysis

| Authority | Transfer Mechanism | Steps | Timelock |
|-----------|-------------------|-------|----------|
| AMM Admin | Not transferable | Admin is set once in `initialize_admin`. No update instruction. Can only be burned. | N/A |
| Whitelist Authority | Not transferable | Set once in `initialize_authority`. No update instruction. Can only be burned. | N/A |
| Bonding Curve Authority | N/A | No stored authority exists. Any signer is accepted. | N/A |
| Epoch State | N/A | No stored authority. Genesis is one-time. | N/A |
| Program Upgrade Authority | Solana BPF Loader | Standard `set-authority` via CLI. One-step. | None |

Observation: No authority in the protocol supports rotation. The only transition is burn (irreversible). This eliminates transfer attacks but means key compromise requires redeployment.

## Missing Check Inventory

| Instruction | Program | Issue | Severity |
|-------------|---------|-------|----------|
| `initialize_curve` | Bonding Curve | `authority` signer not verified against any stored key or ProgramData | HIGH |
| `fund_curve` | Bonding Curve | Same as above | HIGH |
| `start_curve` | Bonding Curve | Same as above (mitigated by vault balance check) | MEDIUM |
| `prepare_transition` | Bonding Curve | Same as above (mitigated by Filled status check on both curves) | HIGH |
| `withdraw_graduated_sol` | Bonding Curve | Same as above (mitigated by Graduated status, but attacker gets the SOL) | CRITICAL |
| `close_token_vault` | Bonding Curve | Same as above (low impact -- only rent recovery) | LOW |
| `initialize_authority` | Transfer Hook | No upgrade-authority check; first caller wins | HIGH |
| `initialize_epoch_state` | Epoch Program | No upgrade-authority check | MEDIUM |
| `initialize_stake_pool` | Staking | No upgrade-authority check | MEDIUM |
| `initialize_carnage_fund` | Epoch Program | No upgrade-authority check | MEDIUM |
| `initialize` | Conversion Vault | No upgrade-authority check | LOW |
| `initialize_extra_account_meta_list` | Transfer Hook | No upgrade-authority check | MEDIUM |

## Key Management Assessment

- **No multisig**: No instruction in the codebase references multisig, Squads, or governance programs
- **Single key**: All admin operations (AMM admin, deployment) use a single wallet
- **Devnet wallet**: The hardcoded devnet admin (`8kPzh...`) is a single keypair at `keypairs/devnet-wallet.json`
- **No key rotation**: No instruction exists to change any stored authority
- **Burn patterns**: AMM admin and whitelist authority can be irreversibly burned
- **Centralization risk**: The deployer has full control during the bonding curve lifecycle (assuming they are the first caller). Post-graduation and post-burn, admin capabilities are eliminated.

## Trust Model

**Trusted entities:**
1. Protocol deployer (upgrade authority holder) -- can upgrade all programs, assumed to call init instructions first
2. CPI PDA signers (Tax->AMM, Tax->Staking, Epoch->Staking, Epoch->Tax) -- structurally secure via seeds::program

**Semi-trusted entities:**
3. AMM admin (stored in AdminConfig) -- can create pools but cannot modify existing ones
4. Whitelist authority -- can add whitelist entries but not remove them

**Untrusted entities:**
5. Users (swappers, stakers, curve buyers) -- all actions validated by constraints
6. Permissionless callers (epoch triggerers, failure markers) -- gated by state conditions

**Trust boundary weaknesses:**
- Bonding curve "authority" is effectively untrusted (no verification) but treated as trusted
- Init instructions across 5 programs assume deployment ordering

## State Analysis

Access-control-relevant state:
- `AdminConfig.admin: Pubkey` -- AMM admin pubkey, set once, can be zeroed
- `WhitelistAuthority.authority: Option<Pubkey>` -- hook authority, set once, can be set to None
- `PoolState.locked: bool` -- reentrancy guard for swaps
- `EpochState.initialized: bool` -- prevents re-initialization
- `CarnageFundState.initialized: bool` -- prevents re-initialization
- `StakePool.initialized: bool` -- prevents re-initialization
- `CurveState.status: CurveStatus` -- state machine gating admin operations
- `UserStake.owner: Pubkey` -- staker identity for claim/unstake authorization

## Dependencies

- Anchor framework handles discriminator validation for `Account<'info, T>` types
- SPL Token / Token-2022 handle transfer authority validation during CPI
- Solana runtime handles `Signer<'info>` validation (signature verification)
- Switchboard handles VRF randomness account ownership

## Focus-Specific Analysis

### UncheckedAccount Audit

| File | Account | CHECK Comment | Actually Safe? | Risk |
|------|---------|---------------|----------------|------|
| `staking/claim.rs` | `escrow_vault` | PDA seeds validated | Yes -- program-owned PDA, lamport manipulation only | LOW |
| `staking/deposit_rewards.rs` | `escrow_vault` | PDA seeds validated | Yes -- read-only balance check | LOW |
| `tax-program/swap_sol_buy.rs` | `epoch_state` | Manual owner+discriminator validation | Yes -- thorough 3-step validation | LOW |
| `tax-program/swap_sol_buy.rs` | `swap_authority` | PDA seeds | Yes -- never written to | LOW |
| `tax-program/swap_sol_buy.rs` | `pool` | "Validated in AMM CPI" | Acceptable -- AMM validates via own constraints | MEDIUM |
| `bonding_curve/distribute_tax_escrow.rs` | `carnage_fund` | Validated by find_program_address | Yes -- explicit PDA derivation check | LOW |
| `transfer-hook/transfer_hook.rs` | `owner` | "Validated by Token-2022" | Yes -- T22 passes this as the token authority | LOW |
| `transfer-hook/transfer_hook.rs` | `whitelist_source/dest` | "Derivation checked in handler" | Yes -- `is_whitelisted()` verifies PDA derivation | LOW |
| `epoch-program/trigger_epoch_transition.rs` | `randomness_account` | Owner validated against SWITCHBOARD_PROGRAM_ID | Yes -- explicit owner check | LOW |

### PDA Derivation Catalog

| PDA | Seeds | Program | Bump Handling | Predictability |
|-----|-------|---------|---------------|----------------|
| AdminConfig | `[b"admin"]` | AMM | Stored in `admin_config.bump` | Deterministic, global singleton |
| PoolState | `[b"pool", mint_a, mint_b]` | AMM | Stored in `pool.bump` | Deterministic per mint pair |
| SwapAuthority | `[b"swap_authority"]` | Tax Program | Computed at use time | Deterministic, global singleton |
| TaxAuthority | `[b"tax_authority"]` | Tax Program | Computed at use time | Deterministic, global singleton |
| StakingAuthority | `[b"staking_authority"]` | Epoch Program | Computed at use time | Deterministic, global singleton |
| CarnageSigner | `[b"carnage_signer"]` | Epoch Program | Computed at use time | Deterministic, global singleton |
| EpochState | `[b"epoch_state"]` | Epoch Program | Stored in `epoch_state.bump` | Deterministic, global singleton |
| StakePool | `[b"stake_pool"]` | Staking | Stored in `stake_pool.bump` | Deterministic, global singleton |
| UserStake | `[b"user_stake", user_pubkey]` | Staking | Stored in `user_stake.bump` | Deterministic per user |
| WhitelistAuthority | `[b"authority"]` | Transfer Hook | Computed at use time | Deterministic, global singleton |
| WhitelistEntry | `[b"whitelist", address]` | Transfer Hook | Computed at use time | Deterministic per address |
| CurveState | `[b"curve", token_mint]` | Bonding Curve | Stored in `curve.bump` | Deterministic per token |

All PDAs use canonical bump (Anchor default). No seed collision risk identified -- all PDAs use unique seed prefixes within their respective programs.

## Previous Findings Re-Check

### H001 CRITICAL: Bounty transfer drains vault below rent-exempt

**Status: PARTIALLY MITIGATED**

The current code at `trigger_epoch_transition.rs:194-227` now checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` and skips the bounty if insufficient. This prevents drain-to-zero. However, it does NOT check whether the post-transfer balance remains above rent-exempt minimum. If `vault_balance = TRIGGER_BOUNTY_LAMPORTS + 1`, the transfer succeeds but leaves only 1 lamport, below rent-exempt.

The carnage_sol_vault is declared as `SystemAccount<'info>` -- it's owned by the system program. System-owned accounts below rent-exempt minimum are garbage-collected. If the vault is destroyed, all future tax distributions to it fail, breaking the protocol.

**Risk reduced from CRITICAL to HIGH** -- the skip-when-insufficient guard prevents the most common case, but edge cases remain.

### S005 CRITICAL: Initialization front-running -- whitelist authority ransom

**Status: NOT FIXED**

`initialize_authority` at `transfer-hook/src/instructions/initialize_authority.rs:15-46` still accepts any signer as authority with no ProgramData constraint. The mitigation would be to add `program` and `program_data` accounts with the same upgrade-authority constraint used in `amm/initialize_admin.rs`.

### H057 MEDIUM: Epoch state init -- no upgrade authority check

**Status: NOT FIXED**

`initialize_epoch_state` at `epoch-program/src/instructions/initialize_epoch_state.rs:97-116` still accepts any `payer: Signer<'info>` with no authority verification. Impact is limited because the payer only pays rent and cannot control genesis parameters (all hardcoded). But a front-runner could create the PDA at a different genesis_slot.

### H125 MEDIUM: Unauthorized pool creation

**Status: FIXED**

`initialize_pool` at `amm/src/instructions/initialize_pool.rs:203-214` now has `has_one = admin @ AmmError::Unauthorized` constraint against AdminConfig PDA. Pool creation requires the admin stored in AdminConfig to sign.

### H003 POTENTIAL: Init front-running (general)

**Status: PARTIALLY ADDRESSED**

AMM uses ProgramData constraint for `initialize_admin`. Other programs (Epoch, Staking, Transfer Hook, Conversion Vault, Bonding Curve) do not.

### H037 POTENTIAL: Admin privilege escalation paths

**Status: OBSERVATION**

No privilege escalation path exists because no authority can be transferred or updated. The only risk is the bonding curve's complete lack of authority verification (anyone is already "admin").

### H063 POTENTIAL: Transfer hook init front-running variant

**Status: NOT FIXED** -- Same as S005.

### H124 POTENTIAL: Pool creation authority delegation

**Status: ADDRESSED**

AdminConfig stores a separate `admin` pubkey that can differ from the upgrade authority. This is intentional delegation (e.g., to a multisig). The admin cannot be changed after initialization, only burned.

## Cross-Focus Intersections

- **Arithmetic**: Tax BPS rates come from EpochState -- if the manual deserialization in Tax Program reads wrong offsets, tax rates could be wrong. The `EpochState` mirror type in `tax-program/src/state/epoch_state_reader.rs` must match the Epoch Program's layout exactly.
- **CPI**: The `swap_exempt` instruction passes signer privileges to AMM. The AMM validates the `user` signer independently (it's listed in the AMM's account struct).
- **Token/Economic**: `withdraw_graduated_sol` and `close_token_vault` in bonding curve directly handle protocol funds with no authority verification.
- **State Machine**: Bonding curve status checks (`Graduated`, `Filled`, `Active`) are the ONLY defense for admin instructions. If a status transition can be forced, admin protection falls.
- **Timing**: All open-init instructions are front-runnable during deployment.

## Cross-Reference Handoffs

- -> **CPI Agent**: Verify that AMM's `swap_sol_pool` independently validates the `user` signer, even when called from Tax `swap_exempt` (which passes `carnage_authority` as user). Currently AMM requires `user: Signer<'info>` -- need to confirm it's not just forwarded.
- -> **Upgrade/Admin Agent**: The bonding curve program has no stored admin. Assess whether `#[cfg(feature = "devnet")]` gating on `force_carnage` is sufficient to prevent mainnet inclusion.
- -> **Token/Economic Agent**: `withdraw_graduated_sol` extracts ALL SOL minus rent. Verify the protocol's off-chain orchestration properly handles this (calls it exactly once per curve, with correct destination).
- -> **State Machine Agent**: CurveStatus transitions are the primary defense. Verify: (a) `Filled` can only be reached via `purchase` when target is met, (b) `Graduated` can only be reached via `prepare_transition`, (c) no instruction can revert a terminal state.
- -> **Error Handling Agent**: `burn_authority` in Transfer Hook is idempotent (returns Ok when already burned). Verify this doesn't mask errors in deployment scripts.

## Risk Observations

1. **Bonding curve authority gap (CRITICAL)**: 6 instructions accept any signer. `withdraw_graduated_sol` directly transfers SOL to the caller. State guards (status checks) are the only defense.

2. **Transfer Hook init front-running (HIGH)**: Attacker becomes permanent whitelist authority. Protocol bricking possible.

3. **Multi-program init front-running (MEDIUM)**: 5 programs vulnerable. Impact varies from low (payer only) to high (authority capture in Transfer Hook).

4. **Bounty rent-exempt gap (MEDIUM)**: Carnage vault can be drained below rent-exempt minimum, potentially destroying the PDA.

5. **No timelock anywhere (MEDIUM)**: All admin actions are immediate. Post-burn, this is irrelevant. Pre-burn, admin has unchecked power.

6. **Cross-program seed constant fragility (LOW)**: Seed constants duplicated across programs. A mismatch after upgrade silently breaks CPI gating.

7. **force_carnage devnet-only guard (LOW)**: `#[cfg(feature = "devnet")]` at Rust level. If mainnet build accidentally includes devnet feature, hardcoded `DEVNET_ADMIN` pubkey could force arbitrary carnage states.

## Novel Attack Surface Observations

1. **Bonding curve "steal graduated SOL" attack**: After both curves graduate (status == Graduated), an attacker can call `withdraw_graduated_sol` for each curve, extracting all raised SOL. The `authority` signer is not verified. The attacker just needs to sign the transaction. The state guard (Graduated status) is not a defense -- it ENABLES the attack by making the instruction callable. This is a direct fund theft vector.

2. **Cascading front-run deployment attack**: An attacker monitoring mempool during deployment could: (a) front-run `initialize_authority` to capture whitelist authority, (b) refuse to whitelist any addresses, (c) all CRIME/FRAUD transfers fail because Transfer Hook blocks non-whitelisted parties. The deployer would need to redeploy the Transfer Hook program and create new token mints.

3. **`prepare_transition` race after natural fill**: Once both curves naturally reach Filled status, ANYONE can call `prepare_transition` to graduate them. This is fine if the deployer intends to call it immediately. But if there's a delay (e.g., deployer wants to verify off-chain conditions first), an attacker can force graduation and then immediately call `withdraw_graduated_sol`.

## Questions for Other Focus Areas

- For **State Machine focus**: Can `CurveStatus::Graduated` ever be set outside of `prepare_transition`? Is there any instruction that could revert Graduated to a non-terminal state?
- For **CPI focus**: When Tax Program calls AMM via CPI in `swap_exempt`, the `user` (carnage_authority) signer is forwarded. Does the AMM independently validate this signer, or could CPI signer forwarding be exploited?
- For **Arithmetic focus**: The `EpochState` mirror type in Tax Program (`epoch_state_reader.rs`) -- do field offsets match exactly? A mismatch could read wrong tax rates.
- For **Timing focus**: What is the deployment transaction ordering? Are init instructions bundled atomically? If not, the front-running window is significant.
- For **Token/Economic focus**: After `withdraw_graduated_sol`, is the SOL used to seed AMM pools? If the SOL is stolen by an attacker, does the graduation process fail gracefully?

## Raw Notes

### Grep Pattern Results (Access Control)

- `Signer<'info>` appears in 28 locations across production programs
- `has_one` appears in 2 locations (AMM initialize_pool, AMM burn_admin)
- `seeds::program` appears in 6 locations (4 production, 2 test mocks)
- `UncheckedAccount` appears in ~30 locations, all with `/// CHECK:` comments
- `access_control` attribute: 0 uses (not used in this codebase)
- `require_keys_eq!`: 0 uses (constraints used instead)
- Hardcoded pubkeys: `DEVNET_ADMIN` in force_carnage.rs (feature-gated), treasury_pubkey() in Tax Program constants, mint addresses in feature-gated constants

### Anchor Version

The project uses Anchor 0.32.1 (`/Users/mlbob/.avm/bin/anchor-0.32.1`). This version supports:
- Type-safe bumps (0.29+)
- Token Extensions (0.30+)
- Custom discriminators (0.32+)
- `seeds::program` constraint (all modern versions)

No Anchor-version-specific access control issues identified.
