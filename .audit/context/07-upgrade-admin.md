---
task_id: sos-phase1-upgrade-admin
provides: [upgrade-admin-findings, upgrade-admin-invariants]
focus_area: upgrade-admin
files_analyzed: [
  "programs/amm/src/instructions/initialize_admin.rs",
  "programs/amm/src/instructions/transfer_admin.rs",
  "programs/amm/src/instructions/burn_admin.rs",
  "programs/amm/src/instructions/initialize_pool.rs",
  "programs/amm/src/state/admin.rs",
  "programs/bonding_curve/src/instructions/initialize_bc_admin.rs",
  "programs/bonding_curve/src/instructions/transfer_bc_admin.rs",
  "programs/bonding_curve/src/instructions/burn_bc_admin.rs",
  "programs/bonding_curve/src/instructions/fund_curve.rs",
  "programs/bonding_curve/src/instructions/start_curve.rs",
  "programs/bonding_curve/src/instructions/prepare_transition.rs",
  "programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs",
  "programs/bonding_curve/src/instructions/close_token_vault.rs",
  "programs/bonding_curve/src/state.rs",
  "programs/bonding_curve/src/constants.rs",
  "programs/transfer-hook/src/instructions/initialize_authority.rs",
  "programs/transfer-hook/src/instructions/transfer_authority.rs",
  "programs/transfer-hook/src/instructions/burn_authority.rs",
  "programs/transfer-hook/src/state/whitelist_authority.rs",
  "programs/epoch-program/src/instructions/initialize_epoch_state.rs",
  "programs/epoch-program/src/instructions/initialize_carnage_fund.rs",
  "programs/epoch-program/src/instructions/force_carnage.rs",
  "programs/epoch-program/src/constants.rs",
  "programs/staking/src/instructions/initialize_stake_pool.rs",
  "programs/conversion-vault/src/instructions/initialize.rs",
  "programs/conversion-vault/src/constants.rs",
  "programs/tax-program/src/instructions/initialize_wsol_intermediary.rs",
  "programs/tax-program/src/constants.rs",
  "programs/tax-program/src/instructions/swap_sol_buy.rs",
  "scripts/deploy/build.sh",
  "Anchor.toml"
]
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 6, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Upgrade & Admin — Condensed Summary

## Key Findings (Top 10)

1. **Treasury pubkey H018 recheck: FIXED** — The mainnet build branch of `treasury_pubkey()` now returns `3ihhw...` (dedicated mainnet treasury), not `8kPzh...` (devnet wallet) or `Pubkey::default()`. The previous audit finding H018 is resolved. — `tax-program/src/constants.rs:146-149`

2. **Cross-program ID stale in source but patched at build time** — `tax-program/src/constants.rs:100` has AMM ID `5JsS...` while `amm/src/lib.rs:12` declares `J7Jx...`. These are reconciled by `sync-program-ids.ts` during `build.sh` step [0/4], but auditing the git-committed source will show wrong IDs. — `tax-program/src/constants.rs:100`, `scripts/deploy/build.sh:86`

3. **No pause/emergency mechanism exists** — There is zero pause functionality across all 7 programs. No `is_paused`, no `frozen`, no emergency stop. Once deployed, the only circuit breaker is a full program upgrade via the upgrade authority. — All program source files

4. **No on-chain parameter update mechanism** — All economic parameters (tax rates, fee BPS, slippage floors, deadlines) are hardcoded constants. The only way to change them is a full program upgrade. No `set_fee`, `update_config`, or `set_params` instructions exist. — All `constants.rs` files

5. **force_carnage devnet-only instruction is properly gated** — `#[cfg(feature = "devnet")]` on both the module include and the instruction entry point. IDL exclusion test confirms it does not appear in non-devnet builds. — `epoch-program/src/instructions/force_carnage.rs:261`, `epoch-program/src/lib.rs:274-294`

6. **Bonding curve and conversion vault mainnet mint addresses are stale in source** — `bonding_curve/src/constants.rs:176-178` mainnet branch returns devnet CRIME mint `DtbD...` instead of mainnet vanity mint `cRiME...`. Same for FRAUD. Build-time `patch-mint-addresses.ts` fixes this but git source is misleading. — `bonding_curve/src/constants.rs:176-195`, `conversion-vault/src/constants.rs:35-68`

7. **H049 recheck: Cross-program upgrade cascade NOT FIXED (structural)** — All 7 programs reference each other's program IDs via hardcoded constants. Upgrading one program does not change its ID, but if an upgrade changes instruction interfaces (account layouts, discriminators), all dependent programs must be upgraded simultaneously. No on-chain version check exists. — All `constants.rs` files

8. **Burn-admin pattern uses Pubkey::default() as sentinel** — All three burn instructions (AMM, BondingCurve, TransferHook) use `Pubkey::default()` (or `None` for TransferHook) as the burned state. Since nobody can sign as `Pubkey::default()`, `has_one` constraints fail permanently. Correct pattern. — `amm/src/instructions/burn_admin.rs:22`, `bonding_curve/src/instructions/burn_bc_admin.rs:21`

9. **Admin SOL withdrawal to authority wallet (centralization)** — `withdraw_graduated_sol` directly credits the admin's wallet via lamport manipulation. The admin can drain all SOL from graduated curve vaults. Proper state checks (Graduated status) are enforced. — `bonding_curve/src/instructions/withdraw_graduated_sol.rs:88-89`

10. **WhitelistAuthority burn is idempotent** — `burn_authority` returns `Ok(())` if authority is already `None`. This prevents errors on retry but means any signer can call it after burning (the signer check is skipped). Not exploitable since burned state is already the terminal state. — `transfer-hook/src/instructions/burn_authority.rs:26-29`

## Critical Mechanisms

- **Upgrade Authority Gating**: All 7 initialization instructions verify `program_data.upgrade_authority_address == Some(signer.key())`. This is the standard Anchor pattern for deployer-only functions. If the upgrade authority is burned on-chain, these instructions become permanently uncallable. — `amm/src/instructions/initialize_admin.rs:53-55`, `bonding_curve/src/instructions/initialize_bc_admin.rs:53-55`, `epoch-program/src/instructions/initialize_epoch_state.rs:126-128`, etc.

- **Admin Config PDA Pattern (AMM + BondingCurve)**: A global PDA stores the admin pubkey. Admin-gated instructions use `has_one = admin/authority` to verify the signer. Admin can be transferred (to multisig) or burned (to `Pubkey::default()`). Transfer rejects `Pubkey::default()` to prevent accidental burns. — `amm/src/state/admin.rs`, `bonding_curve/src/state.rs:21-27`

- **Build-Time ID Synchronization**: `sync-program-ids.ts` reads keypairs from `keypairs/` and patches all `declare_id!`, cross-program constants, and `Anchor.toml` entries. `patch-mint-addresses.ts` patches mint addresses in `constants.rs` files. This means the git-committed source code does NOT reflect the deployed binary. — `scripts/deploy/build.sh:85-99`

- **Feature-Flag Partitioning**: Constants use `#[cfg(feature = "devnet")]`, `#[cfg(feature = "localnet")]`, and `#[cfg(not(any(devnet, localnet)))]` to select cluster-specific values. The mainnet build is the `not(any(...))` branch. There is no explicit `feature = "mainnet"` flag. — All `constants.rs` files

## Invariants & Assumptions

- INVARIANT: AdminConfig.admin can only be modified by the current admin signer — enforced at `amm/src/instructions/transfer_admin.rs:52` via `has_one = admin`
- INVARIANT: Once AdminConfig.admin is set to `Pubkey::default()`, no admin instructions can execute — enforced by `has_one` constraint (no signer can match `Pubkey::default()`)
- INVARIANT: Initialization instructions can only be called once per program — enforced by Anchor's `init` constraint (PDA already exists check)
- INVARIANT: All initialization instructions require upgrade authority — enforced at `program_data.upgrade_authority_address == Some(signer.key())` in all 7 programs
- ASSUMPTION: Build-time `sync-program-ids.ts` and `patch-mint-addresses.ts` are always run before deployment — UNVALIDATED on-chain; if skipped, programs use stale IDs
- ASSUMPTION: The upgrade authority key is secure and not compromised — UNVALIDATED; no timelock or multisig enforcement on-chain
- ASSUMPTION: The `#[cfg(feature = "devnet")]` gate on `force_carnage` is always correctly applied during mainnet builds — validated by IDL exclusion test at `epoch-program/src/lib.rs:274-294`

## Risk Observations (Prioritized)

1. **No emergency pause**: If a critical vulnerability is found post-launch, there is no way to stop the protocol short of upgrading all affected programs. This requires the upgrade authority key and time to compile+deploy. During that window, attackers could drain funds. — All programs
2. **Build-time ID patching is a deployment-integrity risk**: If the build script is not run (manual `anchor build` without `build.sh`), the deployed programs will have mismatched cross-program IDs, causing silent CPI failures or potentially routing to wrong programs. — `scripts/deploy/build.sh:85-99`
3. **Centralized admin over bonding curve funds**: Admin can `withdraw_graduated_sol` (all SOL) and `close_token_vault` (recover rent) on graduated curves. This is by design but represents admin key compromise risk. — `bonding_curve/src/instructions/withdraw_graduated_sol.rs:88-89`
4. **No timelock on admin transfers**: `transfer_admin` and `transfer_bc_admin` take effect immediately. A compromised admin key can instantly transfer authority to an attacker's address. — `amm/src/instructions/transfer_admin.rs:31`, `bonding_curve/src/instructions/transfer_bc_admin.rs:29`
5. **Hardcoded discriminators create fragile CPI coupling**: `DEPOSIT_REWARDS_DISCRIMINATOR`, `UPDATE_CUMULATIVE_DISCRIMINATOR`, `SWAP_EXEMPT_DISCRIMINATOR` are hardcoded bytes. If the target program's instruction name changes during an upgrade, these become invalid with no runtime safety net. — `tax-program/src/constants.rs:156`, `epoch-program/src/constants.rs:117,177`

## Novel Attack Surface

- **Build pipeline as attack vector**: The protocol relies on `sync-program-ids.ts` and `patch-mint-addresses.ts` to patch source code at build time. An attacker with access to the keypairs directory or the build scripts could inject arbitrary program IDs or mint addresses. The deployed binary would contain the attacker's addresses, routing CPI calls or mint validations to malicious programs. This is not a typical smart contract vulnerability but a supply chain risk unique to this codebase's architecture.
- **Admin key transfer with no two-step pattern**: Transfer is immediate (no pending + accept pattern). If admin accidentally transfers to a typo'd address, admin control is permanently lost. The `Pubkey::default()` rejection prevents the most obvious mistake but doesn't protect against other invalid addresses.

## Cross-Focus Handoffs

- **-> Access Control Agent**: Verify that all admin-gated instructions (8 in bonding_curve, 1 in AMM, 0 in epoch/staking/vault) consistently use the `has_one = authority/admin` pattern. Check that `update_cumulative` in staking has proper caller validation (it accepts CPI from epoch program's `staking_authority` PDA).
- **-> Token/Economic Agent**: All economic parameters (tax BPS rates, LP fees, slippage floors, bonding curve prices) are hardcoded constants with no admin update mechanism. Verify these constants produce correct economic outcomes. Admin cannot change fees at runtime.
- **-> State Machine Agent**: Admin triggers state transitions: `start_curve` (Initialized -> Active), `prepare_transition` (Filled -> Graduated). Verify these cannot be called out of order or re-called after completion.
- **-> CPI Agent**: Cross-program ID constants are patched at build time. Verify that all CPI calls validate the target program via `address =` constraints using these constants. Check that hardcoded discriminators match the target instruction names.

## Trust Boundaries

The protocol has a single trust boundary: the **admin/deployer wallet**. This wallet holds: (1) the upgrade authority for all 7 programs, (2) the admin authority for AMM's AdminConfig, (3) the admin authority for BondingCurve's BcAdminConfig, and (4) the whitelist authority for Transfer Hook's WhitelistAuthority. All initialization, admin, and upgrade operations flow through this single key. The plan is to transfer these to a Squads 2-of-3 multisig with timelock (documented in project memory), but this has not been implemented on-chain yet. There is no on-chain governance — all authority changes are direct key operations.
<!-- CONDENSED_SUMMARY_END -->

---

# Upgrade & Admin — Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol implements a straightforward admin authority pattern across 7 on-chain programs. Each program's initialization instruction is gated by the BPF Loader's upgrade authority check (`program_data.upgrade_authority_address == Some(signer.key())`). Two programs (AMM and BondingCurve) additionally implement a persistent AdminConfig PDA that separates the operational admin from the upgrade authority, allowing the admin role to be transferred to a multisig. The Transfer Hook program has a similar WhitelistAuthority PDA.

All authority management instructions follow the same tri-pattern: initialize (upgrade-authority-gated, one-time), transfer (current-admin-gated, rejects `Pubkey::default()`), and burn (current-admin-gated, sets to `Pubkey::default()` or `None`). This pattern is sound and consistently applied.

The most significant architectural observations are: (1) complete absence of emergency pause/freeze mechanisms, (2) all economic parameters are hardcoded constants with no runtime update capability, and (3) a build-time script pipeline patches cross-program IDs and mint addresses, meaning the git-committed source does not match deployed binaries. The previous finding H018 (mainnet Pubkey::default() placeholders) has been FIXED — the treasury pubkey now correctly returns the mainnet treasury address. Finding H049 (cross-program upgrade cascade) remains NOT FIXED and is structural — upgrading one program requires careful coordination across all dependent programs.

## Scope

### Files Analyzed (Layer 3 — Full Source Read)
- `programs/amm/src/instructions/initialize_admin.rs` (60 lines)
- `programs/amm/src/instructions/transfer_admin.rs` (56 lines)
- `programs/amm/src/instructions/burn_admin.rs` (51 lines)
- `programs/amm/src/state/admin.rs` (19 lines)
- `programs/bonding_curve/src/instructions/initialize_bc_admin.rs` (60 lines)
- `programs/bonding_curve/src/instructions/transfer_bc_admin.rs` (54 lines)
- `programs/bonding_curve/src/instructions/burn_bc_admin.rs` (45 lines)
- `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs` (100 lines)
- `programs/bonding_curve/src/instructions/close_token_vault.rs` (107 lines)
- `programs/bonding_curve/src/state.rs` (281 lines)
- `programs/bonding_curve/src/constants.rs` (242 lines)
- `programs/transfer-hook/src/instructions/initialize_authority.rs` (59 lines)
- `programs/transfer-hook/src/instructions/transfer_authority.rs` (63 lines)
- `programs/transfer-hook/src/instructions/burn_authority.rs` (66 lines)
- `programs/transfer-hook/src/state/whitelist_authority.rs` (26 lines)
- `programs/epoch-program/src/instructions/initialize_epoch_state.rs` (134 lines)
- `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` (144 lines)
- `programs/epoch-program/src/instructions/force_carnage.rs` (85 lines)
- `programs/epoch-program/src/constants.rs` (491 lines)
- `programs/staking/src/instructions/initialize_stake_pool.rs` (169 lines)
- `programs/conversion-vault/src/instructions/initialize.rs` (113 lines)
- `programs/conversion-vault/src/constants.rs` (69 lines)
- `programs/tax-program/src/instructions/initialize_wsol_intermediary.rs` (139 lines)
- `programs/tax-program/src/constants.rs` (257 lines)
- `scripts/deploy/build.sh` (partial)
- `Anchor.toml`

### Files Analyzed (Layer 2 — Signature Scan Only)
- `programs/bonding_curve/src/instructions/fund_curve.rs` (first 40 lines)
- `programs/bonding_curve/src/instructions/start_curve.rs` (first 40 lines)
- `programs/bonding_curve/src/instructions/prepare_transition.rs` (first 40 lines)
- `programs/amm/src/instructions/initialize_pool.rs` (lines 195-225)
- `programs/tax-program/src/instructions/swap_sol_buy.rs` (line 462 — amm_program_id constraint)
- `programs/tax-program/src/instructions/swap_sol_sell.rs` (line 636 — amm_program_id constraint)
- `programs/epoch-program/src/lib.rs` (lines 255-294 — force_carnage gate)

### Estimated Coverage
- Admin/authority initialization: 100% (all 7 programs)
- Admin transfer/burn: 100% (all 3 programs with admin transfer)
- Admin-gated instructions: 100% (all `has_one = admin/authority` sites)
- Constants/parameters: 100% (all constants.rs files)
- Emergency mechanisms: 100% (confirmed none exist)

## Key Mechanisms

### 1. Upgrade Authority Gating Pattern

**Location:** All 7 initialization instructions

**Purpose:** Ensures only the program deployer (upgrade authority holder) can perform one-time initialization.

**How it works:**
1. The instruction requires three special accounts: the program itself, its ProgramData account, and the signer.
2. Anchor constraint: `program.programdata_address()? == Some(program_data.key())` — verifies the ProgramData belongs to this program.
3. Anchor constraint: `program_data.upgrade_authority_address == Some(signer.key())` — verifies the signer IS the upgrade authority.
4. The `init` constraint on the target PDA ensures this can only be called once.

**Programs using this pattern:**
| Program | Instruction | File:Line |
|---------|------------|-----------|
| AMM | `initialize_admin` | `initialize_admin.rs:45-55` |
| BondingCurve | `initialize_bc_admin` | `initialize_bc_admin.rs:45-55` |
| EpochProgram | `initialize_epoch_state` | `initialize_epoch_state.rs:119-128` |
| EpochProgram | `initialize_carnage_fund` | `initialize_carnage_fund.rs:129-138` |
| Staking | `initialize_stake_pool` | `initialize_stake_pool.rs:88-97` |
| ConversionVault | `initialize` | `initialize.rs:83-92` |
| TransferHook | `initialize_authority` | `initialize_authority.rs:45-54` |
| TaxProgram | `initialize_wsol_intermediary` | `initialize_wsol_intermediary.rs:124-133` |

**Assumptions:**
- The upgrade authority has not been burned on-chain (if burned, `upgrade_authority_address` is `None`, and `Some(signer.key())` will never match `None`)
- ProgramData accounts are correctly deserialized by Anchor's `Account<'info, ProgramData>` type
- The BPF Loader correctly sets the upgrade authority at deploy time

**Invariants:**
- Each initialization instruction can only be called exactly once (Anchor `init` prevents PDA re-creation)
- Only the upgrade authority holder can call initialization instructions

**Concerns:**
- If the upgrade authority is transferred to a multisig (Squads) but the AdminConfig/BcAdminConfig has not been initialized yet, the multisig would need to call initialize. This is an operational ordering dependency.
- If the upgrade authority is burned (to make the program immutable) BEFORE initialization, the initialization instruction becomes permanently uncallable.

---

### 2. Admin Config PDA Pattern (AMM)

**Location:** `programs/amm/src/state/admin.rs`, `programs/amm/src/instructions/{initialize_admin,transfer_admin,burn_admin}.rs`

**Purpose:** Separate admin authority from upgrade authority. Admin gates pool creation.

**How it works:**
- `AdminConfig` PDA stores a single `admin: Pubkey` and a `bump: u8`.
- Seeds: `[b"admin"]` — singleton global PDA.
- `initialize_admin`: Upgrade authority calls, sets `admin` to any pubkey (can be different from upgrade authority).
- `transfer_admin`: Current admin signs, sets `admin` to `new_admin`. Rejects `Pubkey::default()`.
- `burn_admin`: Current admin signs, sets `admin` to `Pubkey::default()`. Emits `AdminBurned` event.
- `initialize_pool`: Requires `has_one = admin @ AmmError::Unauthorized` — only admin can create pools.

**Assumptions:**
- After `burn_admin`, the admin field is `Pubkey::default()`. Since nobody can sign as `Pubkey::default()`, all admin-gated instructions become permanently uncallable.
- `transfer_admin` has no two-step (propose + accept) pattern. Transfer is immediate and irreversible.
- There is no "recover admin" mechanism. If transferred to a wrong address, admin is lost.

**Invariants:**
- `admin_config.admin` can only be modified by the current `admin_config.admin` signer
- `admin_config.bump` is set once during initialization and never changes
- PDA derivation is deterministic from `[ADMIN_SEED]`

**Concerns:**
- Single-step transfer: If admin key is compromised, attacker can immediately transfer to their own key.
- No timelock on transfer or burn operations.
- After burn, `initialize_pool` becomes permanently uncallable — no new pools can ever be created.

---

### 3. Bonding Curve Admin Config Pattern

**Location:** `programs/bonding_curve/src/state.rs:21-27`, `programs/bonding_curve/src/instructions/{initialize_bc_admin,transfer_bc_admin,burn_bc_admin}.rs`

**Purpose:** Separate admin authority from upgrade authority. Admin gates curve lifecycle operations.

**How it works:**
- `BcAdminConfig` PDA stores `authority: Pubkey` and `bump: u8`.
- Seeds: `[b"bc_admin"]` — singleton global PDA.
- Same tri-pattern as AMM: initialize (upgrade-authority-gated), transfer (rejects default), burn (sets to default).

**Admin-gated instructions (8 total):**
| Instruction | Effect | File |
|-------------|--------|------|
| `initialize_curve` | Creates CurveState PDA | `initialize_curve.rs:25` |
| `fund_curve` | Transfers tokens to vault | `fund_curve.rs:29` |
| `start_curve` | Activates curve (Initialized -> Active) | `start_curve.rs:24` |
| `prepare_transition` | Transitions curves (Filled -> Graduated) | `prepare_transition.rs:26` |
| `withdraw_graduated_sol` | Drains SOL from graduated vault | `withdraw_graduated_sol.rs:34` |
| `close_token_vault` | Closes empty token vault | `close_token_vault.rs:34` |
| `transfer_bc_admin` | Transfers authority | `transfer_bc_admin.rs:50` |
| `burn_bc_admin` | Burns authority | `burn_bc_admin.rs:41` |

**Concerns:**
- `withdraw_graduated_sol` allows admin to drain ALL SOL (minus rent-exempt) from graduated curve vaults. This is by design for graduation flow, but admin key compromise = fund theft.
- `close_token_vault` only works on empty vaults (`constraint = token_vault.amount == 0`), so it cannot be used to steal tokens. Correct.
- `prepare_transition` transitions BOTH curves simultaneously. If admin is compromised, attacker could prematurely graduate curves, but only if both are in Filled status.

---

### 4. Whitelist Authority Pattern (Transfer Hook)

**Location:** `programs/transfer-hook/src/state/whitelist_authority.rs`, `programs/transfer-hook/src/instructions/{initialize_authority,transfer_authority,burn_authority}.rs`

**Purpose:** Control who can add addresses to the transfer whitelist. Burned = immutable whitelist.

**How it works:**
- `WhitelistAuthority` PDA stores `authority: Option<Pubkey>` and `initialized: bool`.
- Seeds: `[b"authority"]` — singleton global PDA.
- `initialize_authority`: Upgrade-authority-gated (ProgramData check). Caller becomes authority.
- `transfer_authority`: Current authority signs. Validates `auth.authority == Some(signer.key())`. Rejects `Pubkey::default()`.
- `burn_authority`: Sets `authority` to `None`. **Idempotent**: if already `None`, returns `Ok(())` without checking signer.

**Notable difference from AMM/BC pattern:**
- Uses `Option<Pubkey>` instead of `Pubkey` for burned state (more semantically clear).
- `burn_authority` is idempotent — returns success even if already burned. The signer check is skipped when authority is already `None`.
- The `transfer_authority` instruction does NOT use Anchor's `has_one` constraint for authority validation. Instead, it manually checks `auth.authority == Some(ctx.accounts.authority.key())` in the handler body. This is functionally equivalent but less idiomatic.

**Concerns:**
- The manual authority check in `transfer_authority` (line 30-33) rather than `has_one` is a pattern deviation. It works correctly but is easier to accidentally break during refactoring.
- `burn_authority` idempotent path (line 26-29) means ANY signer can call `burn_authority` after it's already burned (the handler returns `Ok` before checking the signer). Not exploitable since the state is already terminal, but unusual.

---

### 5. Feature-Gated Constants Architecture

**Location:** All `constants.rs` files across all programs

**Purpose:** Different parameter values for devnet, localnet, and mainnet builds.

**How it works:**
Three-branch `#[cfg]` pattern:
```rust
#[cfg(feature = "devnet")]
pub fn some_value() -> Type { devnet_value }

#[cfg(feature = "localnet")]  // or #[cfg(all(feature = "localnet", not(feature = "devnet")))]
pub fn some_value() -> Type { localnet_value }

#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub fn some_value() -> Type { mainnet_value }
```

**Parameters that vary by cluster:**
| Parameter | Devnet | Localnet | Mainnet | File |
|-----------|--------|----------|---------|------|
| `P_START` | 5 | 450 | 450 | `bonding_curve/constants.rs:29-35` |
| `P_END` | 17 | 1725 | 1725 | `bonding_curve/constants.rs:40-46` |
| `TARGET_SOL` | 5 SOL | 500 SOL | 500 SOL | `bonding_curve/constants.rs:63-69` |
| `DEADLINE_SLOTS` | 27,000 | 500 | 432,000 | `bonding_curve/constants.rs:103-109` |
| `MIN_PURCHASE_SOL` | 0.001 SOL | 0.05 SOL | 0.05 SOL | `bonding_curve/constants.rs:82-88` |
| `SLOTS_PER_EPOCH` | 750 | (same as mainnet) | 4,500 | `epoch-program/constants.rs:58-61` |
| `treasury_pubkey()` | `8kPzh...` | `Pubkey::default()` | `3ihhw...` | `tax-program/constants.rs:135-149` |
| `crime_mint()` | `DtbD...` | `Pubkey::default()` | patched at build | `bonding_curve/constants.rs:166-178` |
| `SWITCHBOARD_PROGRAM_ID` | `ON_DEMAND_DEVNET_PID` | (same as mainnet) | `ON_DEMAND_MAINNET_PID` | `epoch-program/constants.rs:46-49` |

**Concerns:**
- Localnet uses `Pubkey::default()` for mints and treasury — this is fine for testing but means localnet builds cannot be accidentally deployed to mainnet (instructions would fail with wrong addresses).
- The mainnet branch for `crime_mint()` and `fraud_mint()` in both `bonding_curve/constants.rs` and `conversion-vault/constants.rs` contains stale devnet addresses. These are patched at build time by `patch-mint-addresses.ts`. If the patch script is not run, mainnet programs would validate against wrong mint addresses.
- There is no `#[cfg(feature = "mainnet")]` — mainnet is the "else" case. This means any build without explicit `--features devnet` or `--features localnet` becomes a mainnet build. This is intentional but requires operational discipline.

---

### 6. Build-Time ID Synchronization

**Location:** `scripts/deploy/build.sh:85-99`, `scripts/deploy/sync-program-ids.ts`, `scripts/deploy/patch-mint-addresses.ts`

**Purpose:** Keep cross-program ID references consistent with actual keypair-derived program IDs.

**How it works:**
1. `build.sh` step [0/4]: Runs `sync-program-ids.ts` which reads keypairs from `keypairs/` and patches:
   - `declare_id!()` in each program's `lib.rs`
   - Cross-program ID constants in `constants.rs` files
   - `Anchor.toml` program IDs
   - `target/deploy/` keypair files
2. `build.sh` step [0b/4]: Runs `patch-mint-addresses.ts` which reads mint keypairs and patches:
   - Mint address constants in `constants.rs` files

**Security implications:**
- The git-committed source code does NOT reflect the deployed binary. An auditor reading `tax-program/src/constants.rs` will see `amm_program_id() = 5JsS...` but the deployed version uses `J7Jx...`.
- If `build.sh` is bypassed (e.g., manual `anchor build`), the deployed programs will have mismatched IDs.
- The keypairs directory is the single source of truth for program identity. Compromise of keypairs = compromise of deployment integrity.
- There are no compile-time assertions that cross-program IDs match (unlike the `const _: () = assert!(...)` pattern used for bonding curve invariants in `bonding_curve/constants.rs:230-241`).

---

## Trust Model

### Trusted Entities
1. **Upgrade Authority (deployer wallet)** — Can upgrade all 7 programs. Can call all initialization instructions. Currently a single key (`23g7x...` on mainnet, `8kPzh...` on devnet). Plan to transfer to Squads multisig with timelock, but not yet done.
2. **Admin Key (AMM AdminConfig)** — Gates pool creation. Currently held by deployer. Plan to transfer to multisig but retain (not burn).
3. **Admin Key (BC BcAdminConfig)** — Gates all bonding curve lifecycle operations. Currently held by deployer.
4. **Whitelist Authority (Transfer Hook)** — Gates whitelist modifications. Plan to transfer to Squads (not burn).
5. **Build Pipeline** — `sync-program-ids.ts` and `patch-mint-addresses.ts` determine what gets compiled. Must be trusted.

### Untrusted Entities
1. **Any external caller** — Can call permissionless instructions (buy/sell/swap, epoch transitions, claims).
2. **Switchboard Oracle** — Trusted for randomness but verified via `owner = SWITCHBOARD_PROGRAM_ID` constraint.

### Trust Boundary Summary
All authority flows through a single deployer key. There are no timelocks, no multisig enforcement on-chain, and no governance mechanisms. The planned Squads migration (Phase 97) would add a 2-of-3 multisig with 300s timelock, but this is not yet implemented on mainnet. Until then, the protocol's security model is "trust the deployer key."

## State Analysis

### Authority State Accounts
| Account | Type | Seeds | Who Modifies | Terminal State |
|---------|------|-------|--------------|----------------|
| `AdminConfig` (AMM) | PDA, 50 bytes | `["admin"]` | admin signer via `transfer_admin`, `burn_admin` | `admin = Pubkey::default()` |
| `BcAdminConfig` (BC) | PDA, 42 bytes | `["bc_admin"]` | authority signer via `transfer_bc_admin`, `burn_bc_admin` | `authority = Pubkey::default()` |
| `WhitelistAuthority` (Hook) | PDA, 42 bytes | `["authority"]` | authority signer via `transfer_authority`, `burn_authority` | `authority = None` |
| `EpochState` | PDA, 172 bytes | `["epoch_state"]` | Various instructions (permissionless after init) | N/A (no admin field) |
| `CarnageFundState` | PDA, variable | `["carnage_fund"]` | Various instructions (permissionless after init) | N/A (no admin field) |
| `StakePool` | PDA, variable | `["stake_pool"]` | Various instructions (permissionless after init) | N/A (no admin field) |
| `VaultConfig` | PDA, variable | `["vault_config"]` | Permissionless after init | N/A (no admin field) |

### Key Observation
Only 3 of 7 programs (AMM, BondingCurve, TransferHook) have persistent admin authority PDAs. The other 4 programs (EpochProgram, Staking, ConversionVault, TaxProgram) rely solely on the upgrade authority for initialization and have no ongoing admin functions. Once initialized, these 4 programs are fully permissionless — the only way to modify their behavior is via program upgrade.

## Dependencies

### Cross-Program ID Dependencies
| Source Program | References | Target Program | Constant Location |
|---------------|------------|----------------|-------------------|
| TaxProgram | `amm_program_id()` | AMM | `tax-program/constants.rs:99-101` |
| TaxProgram | `epoch_program_id()` | EpochProgram | `tax-program/constants.rs:50-52` |
| TaxProgram | `staking_program_id()` | Staking | `tax-program/constants.rs:126-128` |
| EpochProgram | `amm_program_id()` | AMM | `epoch-program/constants.rs:25-27` |
| EpochProgram | `tax_program_id()` | TaxProgram | `epoch-program/constants.rs:17-19` |
| EpochProgram | `staking_program_id()` | Staking | `epoch-program/constants.rs:33-35` |
| BondingCurve | `epoch_program_id()` | EpochProgram | `bonding_curve/constants.rs:205-219` |

### Hardcoded CPI Discriminators
| Discriminator | Target | Source Location |
|--------------|--------|-----------------|
| `DEPOSIT_REWARDS_DISCRIMINATOR` | Staking::deposit_rewards | `tax-program/constants.rs:156` |
| `UPDATE_CUMULATIVE_DISCRIMINATOR` | Staking::update_cumulative | `epoch-program/constants.rs:117` |
| `SWAP_EXEMPT_DISCRIMINATOR` | TaxProgram::swap_exempt | `epoch-program/constants.rs:177` |

Each discriminator has a unit test verifying it matches `sha256("global:{instruction_name}")[0..8]`. These tests ensure correctness at build time but cannot detect if the target program renames the instruction after deployment.

## Focus-Specific Analysis

### Admin Capability Inventory

| Instruction | Program | What It Changes | Who Can Call | Timelock? | Impact if Malicious |
|-------------|---------|----------------|--------------|-----------|---------------------|
| `initialize_admin` | AMM | Creates AdminConfig PDA | Upgrade authority | No | Sets initial admin; one-time only |
| `transfer_admin` | AMM | Changes AdminConfig.admin | Current admin | No | Transfers admin to attacker; can create rogue pools |
| `burn_admin` | AMM | Sets admin to Pubkey::default() | Current admin | No | Permanently disables pool creation |
| `initialize_pool` | AMM | Creates new trading pool | Admin | No | Could create pools with malicious parameters |
| `initialize_bc_admin` | BondingCurve | Creates BcAdminConfig PDA | Upgrade authority | No | Sets initial admin; one-time only |
| `transfer_bc_admin` | BondingCurve | Changes BcAdminConfig.authority | Current authority | No | Transfers authority to attacker |
| `burn_bc_admin` | BondingCurve | Sets authority to Pubkey::default() | Current authority | No | Permanently disables curve operations |
| `initialize_curve` | BondingCurve | Creates CurveState PDA | Authority | No | Could create curves for rogue tokens |
| `fund_curve` | BondingCurve | Transfers tokens to curve vault | Authority | No | Authority provides tokens; self-harm only |
| `start_curve` | BondingCurve | Activates curve (sets Active) | Authority | No | Premature activation |
| `prepare_transition` | BondingCurve | Transitions Filled -> Graduated | Authority | No | Premature graduation |
| `withdraw_graduated_sol` | BondingCurve | Drains SOL from graduated vault | Authority | No | **Direct fund access**: All SOL from graduated curves flows to admin wallet |
| `close_token_vault` | BondingCurve | Closes empty token vault (rent recovery) | Authority | No | Rent recovery only (vault must be empty) |
| `initialize_authority` | TransferHook | Creates WhitelistAuthority PDA | Upgrade authority | No | Sets initial authority; one-time only |
| `transfer_authority` | TransferHook | Changes WhitelistAuthority.authority | Current authority | No | Transfers whitelist control |
| `burn_authority` | TransferHook | Sets authority to None | Current authority | No | Makes whitelist immutable |
| `force_carnage` | EpochProgram | Manually triggers Carnage state | Hardcoded devnet admin | No | **DEVNET ONLY** — forces Carnage event |

### Centralization Risk Assessment

**Single Points of Failure:**
1. **Deployer wallet** — Controls upgrade authority for all 7 programs and admin authority for AMM + BondingCurve + TransferHook. If compromised, attacker can:
   - Upgrade any program to a malicious version (draining all protocol funds)
   - Transfer admin to their own key (creating rogue pools, draining graduated SOL)
   - Burn admin to permanently disable pool creation or curve management
   - Modify the whitelist (adding any address)

2. **Build pipeline** — The `sync-program-ids.ts` and `patch-mint-addresses.ts` scripts are trusted to produce correct patches. If the build machine or keypairs directory is compromised, the deployed programs could reference attacker-controlled program IDs or mint addresses.

**Key Person Risk:**
- All authority is held by a single entity (mlbob/deployer). There is no on-chain enforcement of multi-party control.
- The planned Squads 2-of-3 multisig would mitigate this but is not yet deployed on mainnet.

**Admin Rug-Pull Capability:**
- **Direct fund drain via `withdraw_graduated_sol`**: Admin can withdraw all SOL from any graduated curve. However, this is only after graduation (terminal state), so user purchase SOL is intended to flow to the admin for AMM pool seeding. The risk is if admin graduates curves and withdraws SOL without seeding pools.
- **Program upgrade as universal rug vector**: The upgrade authority can deploy any arbitrary code, including code that drains all protocol-held tokens and SOL. This is the most powerful authority and the primary centralization risk.
- **No timelock on any admin operation**: All transfers and burns take effect in the same transaction. A compromised key can instantly transfer authority and drain funds before detection.

### Upgrade Analysis

**Are programs upgradeable?** Yes, all 7 programs are deployed as upgradeable BPF programs. The `ProgramData` account for each program stores the `upgrade_authority_address`. As of the current state:
- All programs are upgradeable (upgrade authority is set, not burned)
- The deployer wallet holds the upgrade authority

**Upgrade process:**
1. Build new binary with `scripts/deploy/build.sh` (which runs sync-program-ids + patch-mints + anchor build)
2. Deploy with `solana program deploy` using the upgrade authority key
3. No on-chain timelock or notification
4. No on-chain governance vote
5. Changes take effect immediately

**Risks of upgrade:**
- **Uninitialized state after upgrade (EP-117, Ronin V2 pattern)**: If an upgrade changes account layout and adds new fields, existing accounts may have uninitialized data in the new fields. The protocol uses `reserved: [0u8; 64]` in `EpochState` for future schema evolution, which is good foresight. Other accounts (`AdminConfig`, `BcAdminConfig`, `CurveState`, `PoolState`) do not have reserved space.
- **Discriminator stability**: Anchor programs use 8-byte discriminators derived from `sha256("account:{TypeName}")`. If an upgrade renames an account type, the discriminator changes, and existing accounts become undeserializable. The protocol would need to manually handle migration.
- **Cross-program cascade (H049)**: Upgrading one program may change its instruction interface (adding accounts, changing discriminators). All programs that CPI into it must be upgraded simultaneously. The hardcoded discriminators (`DEPOSIT_REWARDS_DISCRIMINATOR`, etc.) would become invalid if the target instruction is renamed.

### Parameter Change Impact

Since ALL parameters are hardcoded constants with no runtime update mechanism, the only way to change them is via program upgrade. There are no admin-callable set_parameter instructions.

| Parameter | Current Value | Range/Extreme | Impact if Extreme |
|-----------|--------------|---------------|-------------------|
| `STAKING_BPS` | 7,100 (71%) | 0-10,000 | 0: No staking rewards. 10,000: All tax to staking, none to carnage/treasury |
| `CARNAGE_BPS` | 2,400 (24%) | 0-10,000 | 0: No carnage fund. 10,000: All tax to carnage |
| `TREASURY_BPS` | 500 (5%) | 0-10,000 | Remainder after staking+carnage; not directly enforced |
| `MINIMUM_OUTPUT_FLOOR_BPS` | 5,000 (50%) | 0-10,000 | 0: Allow 100% slippage. 10,000: Require exact output (all swaps fail) |
| `CARNAGE_TRIGGER_THRESHOLD` | 11 (~4.3%) | 0-255 | 0: Never triggers. 255: Always triggers |
| `MAX_CARNAGE_SWAP_LAMPORTS` | 1,000 SOL | 0-u64::MAX | 0: Carnage does nothing. MAX: Could drain pool in one swap |
| `SELL_TAX_BPS` (BC) | 1,500 (15%) | 0-10,000 | 0: No sell tax. 10,000: 100% tax (sellers get nothing) |
| `LP_FEE_BPS` (AMM) | Set per pool (100 bps default) | 0-500 (MAX_LP_FEE_BPS) | Capped at 500bps by AMM validation |

**Key observation**: The `LP_FEE_BPS` is the only parameter with an on-chain cap (`MAX_LP_FEE_BPS = 500` in `amm/constants.rs`). All other parameters have no runtime validation because they're compile-time constants.

## Cross-Focus Intersections

### With Access Control
- All admin authorization uses Anchor's `has_one` constraint (AMM, BondingCurve) or manual `require!` checks (TransferHook). The Access Control agent should verify these are correctly applied in all admin-gated instructions.
- The `force_carnage` instruction uses a hardcoded `DEVNET_ADMIN` pubkey (`8kPzh...`) with a constraint check. This is the ONLY instruction with a hardcoded admin key. All others use PDA-stored authority.

### With Token/Economic
- Admin controls all economic parameter changes via program upgrade. There are no runtime parameter adjustments.
- Admin can drain SOL from graduated curves via `withdraw_graduated_sol`. This is part of the graduation flow but represents concentrated fund access.
- Tax distribution ratios (71/24/5 split) are hardcoded. Admin cannot change these without upgrading the tax program.

### With State Machine
- Admin triggers two state transitions: `start_curve` (Initialized -> Active) and `prepare_transition` (Filled -> Graduated).
- Both are admin-only and have state preconditions (curve must be in correct status).
- `burn_admin` effectively disables the state machine for new curves (no new curves can be created or started).

### With CPI/External
- Cross-program IDs are hardcoded constants patched at build time.
- Hardcoded discriminators create fragile CPI coupling.
- No on-chain version negotiation between programs.

## Cross-Reference Handoffs

### -> Access Control Agent
1. Verify all 8 `has_one = authority` constraints in BondingCurve instructions consistently reference `BcAdminConfig` and use `CurveError::Unauthorized`.
2. Verify `update_cumulative` in Staking program validates the CPI caller is the Epoch program's `staking_authority` PDA.
3. Check that `WhitelistAuthority` manual authority check in `transfer_authority.rs:30-33` is equivalent to `has_one` semantics.

### -> Token/Economic Agent
1. All tax rates (`STAKING_BPS`, `CARNAGE_BPS`, `TREASURY_BPS`) are hardcoded with no admin update. Verify the sum equals `BPS_DENOMINATOR` (it does: 7100 + 2400 + 500 = 10,000).
2. `MINIMUM_OUTPUT_FLOOR_BPS` at 5000 (50%) is extremely generous. Verify this doesn't allow excessive MEV extraction.
3. `MAX_LP_FEE_BPS = 500` in AMM is the only parameter with an on-chain cap. Verify it's enforced during `initialize_pool`.

### -> State Machine Agent
1. `prepare_transition` transitions BOTH curves simultaneously. Verify it correctly checks both are `Filled` before transitioning.
2. `start_curve` sets `deadline_slot = clock.slot + DEADLINE_SLOTS`. Verify clock.slot is loaded correctly and the addition is checked.

### -> CPI Agent
1. Cross-program ID constants in `tax-program/constants.rs` and `epoch-program/constants.rs` are patched at build time. Verify `address =` constraints use these constants consistently.
2. Three hardcoded discriminators exist. Verify each matches `sha256("global:{name}")[0..8]` via the existing unit tests.

## Risk Observations

### HIGH

1. **No emergency pause mechanism**: All 7 programs have zero pause/freeze capability. If a critical vulnerability is discovered, the only response is a full program upgrade. During the upgrade window (compile, deploy, verify across all 7 programs), an attacker could exploit the vulnerability freely. This is a conscious design choice but represents significant operational risk for a mainnet protocol.

2. **Single deployer key controls everything**: The deployer wallet is the upgrade authority for 7 programs and the initial admin for 3 programs. No on-chain multisig or timelock enforcement exists. This is acknowledged in the project planning (Squads Phase 97) but not yet implemented on mainnet.

### MEDIUM

3. **Build-time patching creates audit-deploy gap**: The source code in git does not match the deployed binary. Cross-program IDs and mint addresses are patched by TypeScript scripts during build. An auditor reviewing git source would see wrong program IDs. A deployment without running `build.sh` would compile with wrong IDs.

4. **No two-step admin transfer**: All three admin transfer instructions take effect immediately. A compromised admin key can instantly transfer authority to an attacker's address. A propose-accept pattern would provide a recovery window.

5. **Stale source addresses mislead auditors**: The mainnet branch of `crime_mint()` in `bonding_curve/constants.rs:176-178` returns `DtbDMB2dU8veALKTB12fi2HYBKMEVoKxYTbLp9VAvAxR` (a devnet address), not the mainnet vanity mint `cRiME...`. Same for FRAUD. Same in `conversion-vault/constants.rs`. These are build-time patched but the source is misleading.

6. **Hardcoded discriminators create upgrade fragility**: Three CPI discriminators are hardcoded bytes with unit tests but no runtime validation against the target program's actual instruction layout. If a target program renames an instruction during upgrade, the CPI caller silently sends the wrong discriminator.

7. **Cross-program upgrade cascade (H049 recheck)**: Upgrading one program may require simultaneous upgrades of all dependent programs if instruction interfaces change. There is no on-chain version check or compatibility negotiation. The hardcoded discriminators and program IDs create tight coupling between all 7 programs.

8. **WhitelistAuthority burn idempotent path skips signer check**: In `burn_authority.rs:26-29`, if authority is already `None`, the function returns `Ok(())` without checking the signer. This means any signer can call `burn_authority` after it's already burned. Not exploitable (state is already terminal) but violates the principle of least authority.

### LOW

9. **Localnet uses Pubkey::default() for mints and treasury**: Localnet builds have `Pubkey::default()` for critical addresses. While these builds should never be deployed to devnet/mainnet, there is no compile-time assertion preventing it. The `#[cfg]` gates are the only protection.

10. **No compile-time assertion for cross-program ID consistency**: The bonding curve constants have compile-time assertions for curve invariants (`P_END > P_START`, `TOTAL_FOR_SALE > 0`), but there are no similar assertions for cross-program ID consistency. Adding `const _: () = assert!(...)` for ID relationships is not possible since the IDs are runtime functions, not constants.

11. **Treasury comment is stale**: `tax-program/constants.rs:133` says "MAINNET: Replace Pubkey::default() with the actual mainnet treasury address" but the mainnet branch already has the correct address (`3ihhw...`). The comment references a state that no longer exists.

12. **force_carnage error code reuse**: `force_carnage.rs:28` uses `EpochError::NotInitialized` as the error when the signer is not `DEVNET_ADMIN`. This is semantically wrong — the authority check failure should use an unauthorized error. Not exploitable since the gate is feature-flagged, but confusing.

## Novel Attack Surface Observations

1. **Build pipeline as deployment attack vector**: The protocol's reliance on `sync-program-ids.ts` and `patch-mint-addresses.ts` to patch source code at build time creates a novel supply chain attack surface. An attacker who compromises the build machine (or the keypairs directory) could inject arbitrary program IDs into the source, causing the deployed programs to CPI into attacker-controlled programs instead of legitimate ones. This would not be detectable by auditing the git source alone. The keypairs are JSON files — there is no hardware security module or key ceremony documented.

2. **Upgrade-without-init gap on account schema changes**: If a program upgrade adds new fields to an account struct (e.g., adding a `paused: bool` to `AdminConfig`), existing accounts would have uninitialized bytes in the new field positions. `EpochState` has `reserved: [0u8; 64]` for future expansion, but `AdminConfig` (50 bytes) and `BcAdminConfig` (42 bytes) have no reserved space. An upgrade adding fields would require either account reallocation or a migration instruction — neither is currently implemented.

3. **Admin authority as graduation extortion vector**: The admin-gated `prepare_transition` instruction is the ONLY path from Filled to Graduated. If the admin key is compromised or lost BEFORE both curves fill, bonding curve participants' SOL is locked indefinitely (curves are Filled but can never Graduate or be marked Failed because they met the target). There is no timeout-based fallback to Graduate without admin intervention.

## Questions for Other Focus Areas

- **For Arithmetic focus**: The `SELL_TAX_BPS` (1500 = 15%) and `STAKING_BPS`/`CARNAGE_BPS`/`TREASURY_BPS` (7100/2400/500) define the revenue split. Verify that `tax_amount * STAKING_BPS / BPS_DENOMINATOR` produces correct results without truncation issues, especially for small tax amounts near `MICRO_TAX_THRESHOLD` (4 lamports).

- **For CPI focus**: The `SWAP_EXEMPT_DISCRIMINATOR` is used for Carnage Fund CPI to Tax Program. Verify the instruction name "swap_exempt" is the correct target instruction and the discriminator matches.

- **For State Machine focus**: The `prepare_transition` instruction checks both curves are Filled. What happens if one curve is Filled and the other is Failed? The `is_refund_eligible` function handles this case, but does `prepare_transition` have a guard against this state?

- **For Oracle focus**: `force_carnage` bypasses VRF randomness entirely. While it's devnet-only, verify the `#[cfg(feature = "devnet")]` gate cannot be accidentally included in mainnet builds via feature flag misconfiguration in `Cargo.toml`.

## Raw Notes

### Previous Findings Recheck

**H018 (MEDIUM) — Mainnet Pubkey::default() placeholders in tax, bc, vault constants.rs**
- **Status: FIXED**
- `treasury_pubkey()` mainnet branch at `tax-program/src/constants.rs:146-149` now returns `Pubkey::from_str("3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv").unwrap()` — the correct mainnet treasury.
- Previous audit noted `Pubkey::default()` or devnet wallet as placeholders. Both are now replaced.
- The `compile_error!` approach mentioned in the previous fix was NOT used. Instead, the correct mainnet address was hardcoded directly. This is acceptable because the address is known and stable.
- Bonding curve and conversion vault mint addresses still show devnet values in the source but are build-time patched. This is a different issue (stale source, not missing addresses).

**H049 (MEDIUM) — Cross-program upgrade cascade**
- **Status: NOT FIXED (structural)**
- All 7 programs reference each other via hardcoded program IDs in constants.rs files.
- Three hardcoded CPI discriminators create additional coupling.
- The `sync-program-ids.ts` script ensures ID consistency at BUILD time, but there is no RUNTIME version check.
- Upgrading one program that changes its instruction interface requires simultaneous upgrades of all dependent programs.
- This is structural to the protocol's multi-program architecture and unlikely to be "fixed" without adding on-chain version negotiation (significant complexity increase).

### Admin Authority Count

At full deployment, there are 13 distinct authorities (from project memory - "Authority strategy v2"):
1. AMM upgrade authority
2. BondingCurve upgrade authority
3. EpochProgram upgrade authority
4. Staking upgrade authority
5. ConversionVault upgrade authority
6. TaxProgram upgrade authority
7. TransferHook upgrade authority
8. AMM AdminConfig.admin
9. BondingCurve BcAdminConfig.authority
10. TransferHook WhitelistAuthority.authority
11. CRIME metadata update authority
12. FRAUD metadata update authority
13. PROFIT metadata update authority

All 13 are currently held by the deployer wallet. The plan is to transfer all to Squads 2-of-3 multisig with 300s timelock. Whitelist authority is explicitly NOT to be burned (transferred to Squads for future flexibility). AMM admin is retained (not burned) for future pool creation (USDC pools idea).
