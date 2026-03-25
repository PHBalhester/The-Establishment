---
task_id: sos-phase1-upgrade-admin
provides: [upgrade-admin-findings, upgrade-admin-invariants]
focus_area: upgrade-admin
files_analyzed: [amm/src/lib.rs, amm/src/constants.rs, amm/src/instructions/initialize_admin.rs, amm/src/instructions/burn_admin.rs, amm/src/state/admin.rs, bonding_curve/src/lib.rs, bonding_curve/src/constants.rs, bonding_curve/src/instructions/initialize_curve.rs, bonding_curve/src/instructions/fund_curve.rs, bonding_curve/src/instructions/start_curve.rs, bonding_curve/src/instructions/prepare_transition.rs, bonding_curve/src/instructions/withdraw_graduated_sol.rs, bonding_curve/src/instructions/close_token_vault.rs, epoch-program/src/lib.rs, epoch-program/src/constants.rs, epoch-program/src/instructions/initialize_epoch_state.rs, epoch-program/src/instructions/initialize_carnage_fund.rs, epoch-program/src/instructions/force_carnage.rs, staking/src/lib.rs, staking/src/constants.rs, staking/src/instructions/test_helpers.rs, tax-program/src/lib.rs, tax-program/src/constants.rs, transfer-hook/src/lib.rs, transfer-hook/src/instructions/initialize_authority.rs, transfer-hook/src/instructions/burn_authority.rs, transfer-hook/src/state/whitelist_authority.rs, conversion-vault/src/lib.rs, conversion-vault/src/constants.rs, conversion-vault/src/state.rs, conversion-vault/src/instructions/initialize.rs]
finding_count: 11
severity_breakdown: {critical: 1, high: 2, medium: 4, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Upgrade & Admin -- Condensed Summary

## Key Findings (Top 10)

1. **Bonding curve admin instructions have NO authority validation**: ANY signer can call `withdraw_graduated_sol` and receive ~1000 SOL from graduated curve vaults, and `close_token_vault` to receive rent. Only requires curve to be in Graduated state. -- `bonding_curve/src/instructions/withdraw_graduated_sol.rs:25-48`
2. **Bonding curve `prepare_transition` accepts any signer**: Any account can transition curves from Filled to Graduated. While state guards (both curves must be Filled) prevent premature graduation, an attacker could front-run the admin to execute this first. -- `bonding_curve/src/instructions/prepare_transition.rs:17-38`
3. **force_carnage devnet test helper present in production branch**: Feature-gated by `#[cfg(feature = "devnet")]` but the devnet feature IS the production deployment feature. Must be gated differently or removed for mainnet. -- `epoch-program/src/instructions/force_carnage.rs:1-77`
4. **Staking `test_deposit_and_distribute` bypasses CPI gating**: Feature-gated by `#[cfg(feature = "test")]` which is separate from "devnet"/"localnet", so properly excluded from production. Correct pattern. -- `staking/src/instructions/test_helpers.rs:7`
5. **Mainnet Pubkey::default() placeholders in 3 programs**: Conversion vault, bonding curve, and tax program use `Pubkey::default()` for mainnet mints/treasury. Deploying without updating these would allow any mint or send treasury funds to an unrecoverable address. -- `tax-program/src/constants.rs:141-144`, `conversion-vault/src/constants.rs:31-33`, `bonding_curve/src/constants.rs:128-132`
6. **No pause/emergency mechanism exists across entire protocol**: Zero grep hits for pause/frozen/emergency in all program source. No circuit breaker if an exploit is discovered post-launch. -- all programs
7. **No timelock on any admin operation**: All admin actions (pool creation, curve graduation, SOL withdrawal, parameter initialization) execute immediately. No delay between proposal and execution. -- all admin instructions
8. **AMM admin uses programdata authority gate (correct pattern)**: `initialize_admin` validates signer against program's upgrade authority via ProgramData constraint. This is the secure standard. -- `amm/src/instructions/initialize_admin.rs:44-56`
9. **Authority burn patterns are irreversible and correct**: AMM (`burn_admin`), Transfer Hook (`burn_authority`) both implement one-way authority destruction. AMM sets to `Pubkey::default()`, Hook sets to `None`. Both prevent new operations permanently. -- `amm/src/instructions/burn_admin.rs`, `transfer-hook/src/instructions/burn_authority.rs`
10. **Cross-program IDs are hardcoded and unit-tested**: All 82 hardcoded pubkeys/declare_id patterns have corresponding unit tests verifying consistency. This is robust but means any program redeployment requires rebuilding all dependent programs. -- all constants.rs files

## Critical Mechanisms

- **AMM Admin System**: AdminConfig PDA stores admin pubkey, gated by upgrade authority on init. Admin gates pool creation. `burn_admin` permanently revokes by setting to `Pubkey::default()`. Has_one constraint ensures only current admin can burn. -- `amm/src/instructions/initialize_admin.rs:27-59`, `burn_admin.rs:37-50`
- **Bonding Curve Authority Pattern**: Uses bare `Signer<'info>` named `authority` with NO validation against any stored key or programdata. Any signer satisfies the constraint for ALL admin instructions including SOL withdrawal. -- `bonding_curve/src/instructions/withdraw_graduated_sol.rs:25-51`
- **Transfer Hook Authority**: Uses `Option<Pubkey>` with `None` = burned. Authority gates whitelist mutation. Once burned, whitelist is immutable. Burn is idempotent. -- `transfer-hook/src/state/whitelist_authority.rs:14-20`
- **Feature-Gated Test Helpers**: `force_carnage` (#[cfg(feature = "devnet")]) and `test_deposit_and_distribute` (#[cfg(feature = "test")]) allow bypassing normal flows. The devnet gate is concerning because devnet IS the deployment target currently. -- `epoch-program/src/lib.rs:261`, `staking/src/lib.rs:111`
- **Cross-Program ID Mesh**: 7 production programs with 15+ cross-references via hardcoded pubkeys. Any program redeployment breaks the mesh. No on-chain registry -- all IDs are compile-time constants. -- all constants.rs files

## Invariants & Assumptions

- INVARIANT: AMM admin can only be set once (Anchor `init` prevents re-initialization of AdminConfig PDA) -- enforced at `amm/src/instructions/initialize_admin.rs:35-42`
- INVARIANT: Once AMM admin is burned, no new pools can be created (`has_one = admin` fails against `Pubkey::default()`) -- enforced at `amm/src/instructions/burn_admin.rs:22`
- INVARIANT: Transfer hook whitelist is immutable after authority burn (`authority.is_none()` check blocks add_whitelist_entry) -- enforced at `transfer-hook/src/instructions/add_whitelist_entry.rs` (need to verify exact line)
- INVARIANT: Bonding curve graduation requires BOTH curves to be Filled -- enforced at `bonding_curve/src/instructions/prepare_transition.rs:55-63`
- ASSUMPTION: Bonding curve `authority` signer is the deployer -- NOT ENFORCED ON-CHAIN. Any signer accepted.
- ASSUMPTION: Programs remain upgradeable (standard Solana BPF loader) -- program upgrade authority not verified to be multisig
- ASSUMPTION: Feature flags correctly exclude test code from production -- validated for `test` feature, questionable for `devnet` feature
- ASSUMPTION: All cross-program IDs match deployed program addresses -- validated by unit tests but not by on-chain checks at runtime for hardcoded IDs

## Risk Observations (Prioritized)

1. **Bonding curve SOL theft via unprotected withdraw**: `withdraw_graduated_sol.rs:80-81` -- Anyone can call after graduation and receive ~1000 SOL per curve (2000 SOL total). No authority check. Race condition with legitimate admin.
2. **No emergency pause across protocol**: All programs -- If a vulnerability is discovered post-launch, there is no circuit breaker. The only remediation is program upgrade (requires rebuild + deploy), which has no timelock and depends on a single upgrade authority.
3. **force_carnage available on devnet deployment**: `epoch-program/src/instructions/force_carnage.rs:19` -- Hardcoded DEVNET_ADMIN key can force arbitrary carnage. While the DEVNET_ADMIN constraint limits who can call it, the instruction's existence in the deployed binary is a concern for mainnet migration.
4. **Mainnet placeholders are Pubkey::default()**: Multiple programs -- Deploying to mainnet without updating these would either (a) allow arbitrary mints to be used in conversion vault / bonding curve, or (b) send treasury funds to an unrecoverable all-zeros address.
5. **No on-chain governance or multisig enforcement**: All admin operations use single-signer patterns. The comments mention multisig as a possibility but nothing enforces it on-chain.

## Novel Attack Surface

- **Bonding curve graduation front-running**: Since `prepare_transition` and `withdraw_graduated_sol` accept any signer, an attacker monitoring mempool for a curve reaching Filled status could bundle: (1) `prepare_transition` to graduate both curves, (2) `withdraw_graduated_sol` for CRIME curve, (3) `withdraw_graduated_sol` for FRAUD curve -- stealing ~2000 SOL before the legitimate admin acts.
- **Cross-program ID ossification**: The mesh of 15+ hardcoded cross-program IDs means upgrading any single program to a new address requires rebuilding and redeploying ALL programs that reference it. This creates operational fragility and makes emergency patches difficult.
- **Conversion vault no-authority design**: The conversion vault stores no authority at all. Once initialized, it operates purely on PDA logic. This is secure for the vault itself but means there is no way to pause, upgrade parameters, or recover tokens if a bug is found.

## Cross-Focus Handoffs

- **Access Control Agent**: Bonding curve admin instructions lack authority validation -- verify if any other mechanism (e.g., off-chain orchestration) was intended to protect these. Also investigate whether `fund_curve` and `start_curve` being callable by anyone creates attack surface.
- **Token/Economic Agent**: `withdraw_graduated_sol` allows anyone to extract ~1000 SOL per graduated curve. Verify the economic impact and whether this is intended to be a permissionless action (comments say "admin-only" but code does not enforce).
- **State Machine Agent**: Bonding curve state transitions (Initialized -> Active -> Filled -> Graduated) are partially admin-gated but the graduation step has no authority check. Verify the full state machine is correctly protected.
- **CPI Agent**: `force_carnage` directly manipulates epoch_state fields that normally only `consume_randomness` can set. Verify the devnet feature flag is sufficient protection.

## Trust Boundaries

The protocol has a clear centralization bottleneck: a single deployer key controls all admin functions. The AMM is the only program that validates its admin against the program upgrade authority. All other programs accept any signer for admin operations (bonding curve) or have no admin at all post-initialization (epoch, staking, tax, conversion vault). The transfer hook has a proper authority model with burn capability. There is no governance, no multisig enforcement on-chain, and no timelock on any operation. The upgrade authority for all 7 programs is presumably the same deployer wallet, giving that single key the power to upgrade all program logic at any time.
<!-- CONDENSED_SUMMARY_END -->

---

# Upgrade & Admin -- Full Analysis

## Executive Summary

This analysis examines the upgrade and administrative patterns across all 7 production programs in the Dr Fraudsworth protocol (AMM, Bonding Curve, Epoch Program, Staking, Tax Program, Transfer Hook, Conversion Vault). The codebase uses Anchor 0.32.1 throughout, and all programs are deployed as upgradeable BPF programs on devnet.

The most significant finding is that the bonding curve program -- which manages ~2000 SOL in graduated curve vaults -- has admin-labeled instructions that accept ANY signer without validation. This means anyone can withdraw SOL from graduated curves and close token vaults, extracting value that should be admin-restricted.

Beyond this critical gap, the protocol lacks any emergency pause mechanism, timelock on admin operations, or on-chain governance enforcement. The AMM program demonstrates the correct admin pattern (programdata authority gate), but this pattern was not replicated in the newer bonding curve program. The cross-program dependency mesh of 15+ hardcoded pubkeys creates operational fragility that could complicate emergency responses.

## Scope

### Files Analyzed (Layer 3 -- Full Source)
- `programs/amm/src/instructions/initialize_admin.rs` -- AMM admin creation
- `programs/amm/src/instructions/burn_admin.rs` -- AMM admin destruction
- `programs/amm/src/state/admin.rs` -- AdminConfig state
- `programs/amm/src/lib.rs` -- AMM program entry
- `programs/amm/src/constants.rs` -- AMM constants including TAX_PROGRAM_ID
- `programs/bonding_curve/src/lib.rs` -- All 12 instructions
- `programs/bonding_curve/src/constants.rs` -- Feature-gated mints, cross-program IDs
- `programs/bonding_curve/src/instructions/initialize_curve.rs` -- Curve creation
- `programs/bonding_curve/src/instructions/fund_curve.rs` -- Curve funding
- `programs/bonding_curve/src/instructions/start_curve.rs` -- Curve activation
- `programs/bonding_curve/src/instructions/prepare_transition.rs` -- Graduation trigger
- `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs` -- SOL extraction
- `programs/bonding_curve/src/instructions/close_token_vault.rs` -- Vault closure
- `programs/epoch-program/src/lib.rs` -- Epoch entry with force_carnage
- `programs/epoch-program/src/constants.rs` -- All cross-program IDs + timing
- `programs/epoch-program/src/instructions/initialize_epoch_state.rs` -- Epoch init
- `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` -- Carnage init
- `programs/epoch-program/src/instructions/force_carnage.rs` -- Devnet test helper
- `programs/staking/src/lib.rs` -- Staking entry with test helper
- `programs/staking/src/constants.rs` -- Cross-program IDs
- `programs/staking/src/instructions/test_helpers.rs` -- Test-only bypass
- `programs/tax-program/src/lib.rs` -- Tax entry
- `programs/tax-program/src/constants.rs` -- Treasury, cross-program IDs
- `programs/transfer-hook/src/lib.rs` -- Hook entry
- `programs/transfer-hook/src/instructions/initialize_authority.rs` -- Authority init
- `programs/transfer-hook/src/instructions/burn_authority.rs` -- Authority burn
- `programs/transfer-hook/src/state/whitelist_authority.rs` -- Authority state
- `programs/conversion-vault/src/lib.rs` -- Vault entry
- `programs/conversion-vault/src/constants.rs` -- Feature-gated mints
- `programs/conversion-vault/src/state.rs` -- No-authority design
- `programs/conversion-vault/src/instructions/initialize.rs` -- No-authority init

### Files Analyzed (Layer 2 -- Signatures Only)
- All `errors.rs` files -- error variant inventory
- All `events.rs` files -- event inventory for admin operations
- `programs/staking/src/instructions/deposit_rewards.rs` -- seeds::program gate
- `programs/staking/src/instructions/update_cumulative.rs` -- seeds::program gate
- `programs/tax-program/src/instructions/swap_exempt.rs` -- seeds::program gate

### Estimated Coverage
- Admin/upgrade patterns: 95%+ (all admin-labeled instructions fully read)
- Feature flag analysis: 100% (all cfg(feature) patterns checked)
- Cross-program ID mesh: 100% (all hardcoded IDs verified)
- Emergency/pause mechanisms: 100% (confirmed absent)

## Key Mechanisms

### 1. AMM Admin System

**Location:** `programs/amm/src/instructions/initialize_admin.rs:27-59`, `programs/amm/src/instructions/burn_admin.rs:37-50`, `programs/amm/src/state/admin.rs`

**Purpose:** Manages admin authority for pool creation in the AMM program.

**How it works:**
1. `initialize_admin` (line 27-59): Creates `AdminConfig` PDA. Requires signer to be the program's upgrade authority (verified via `ProgramData` constraint at line 53-55: `program_data.upgrade_authority_address == Some(authority.key())`). Accepts an `admin` parameter that can be different from the upgrade authority (e.g., a multisig).
2. `burn_admin` (line 37-50): Sets `admin_config.admin = Pubkey::default()`. Uses `has_one = admin` constraint to verify the current admin is signing. Irreversible.

**Assumptions:**
- The program upgrade authority is trusted to set the initial admin correctly.
- `Pubkey::default()` can never be a valid signer (nobody holds the private key for the all-zeros address).
- Once admin is burned, pool creation is permanently disabled (desired behavior).

**Invariants:**
- AdminConfig PDA can only be initialized once (Anchor `init` constraint).
- After `burn_admin`, `has_one = admin` against `Pubkey::default()` always fails.

**Concerns:**
- No admin transfer mechanism. If the admin key is compromised, the only option is to burn it (preventing all future pool creation).
- No two-step admin transfer (propose + accept pattern).

### 2. Bonding Curve Authority Pattern (CRITICAL)

**Location:** `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs:24-51`, `prepare_transition.rs:17-38`, `close_token_vault.rs:24-55`, `initialize_curve.rs:14-84`, `fund_curve.rs:19-40`, `start_curve.rs:15-46`

**Purpose:** Admin-only operations for managing bonding curve lifecycle.

**How it works:**
ALL admin instructions in the bonding curve program use this pattern:
```rust
pub authority: Signer<'info>,
```
With NO additional constraints -- no `has_one`, no `constraint`, no programdata check. The only "protection" is that the account is named `authority` and documented as "deployer / protocol authority."

**5 Whys:**
1. Why does this exist? To gate admin operations during curve lifecycle.
2. Why was it implemented this way? The bonding curve was built in Phase 70-77 (v1.2 milestone), and may have followed a simplified pattern assuming operational security rather than on-chain enforcement.
3. Why here? Each admin instruction has its own `authority: Signer` field rather than referencing a shared admin config.
4. Why these specific values? No stored admin key means no on-chain reference to validate against.
5. Why would this fail? Anyone can sign as "authority" and execute these operations.

**Impact Analysis:**
- `withdraw_graduated_sol`: Lines 80-81 transfer lamports to `authority`. An attacker calls this and receives ~1000 SOL per graduated curve. Two curves = ~2000 SOL at risk.
- `close_token_vault`: Rent SOL goes to `authority` signer. Small amount (~0.002 SOL per vault) but still unauthorized value extraction.
- `prepare_transition`: Any signer can graduate curves. While both curves must be Filled (a legitimate state), front-running the admin to graduate first is possible.
- `initialize_curve`, `fund_curve`, `start_curve`: These have natural protections:
  - `initialize_curve`: Anchor `init` prevents double-init. Anyone can init but the PDA is deterministic.
  - `fund_curve`: Requires the signer to have 460M tokens in their ATA. Only the deployer has these.
  - `start_curve`: Requires curve in Initialized state with funded vault. Timing-limited.

**5 Hows:**
1. How does this work? Signer satisfies `Signer<'info>` without further checks.
2. How could this be exploited? Attacker monitors for Graduated curves, calls `withdraw_graduated_sol` with themselves as authority.
3. How does this interact? Once SOL is withdrawn, the admin gets nothing. The vault is left with only rent-exempt minimum.
4. How could this fail? The idempotent check (line 73: `if withdrawable == 0 { return Ok(()) }`) means only the first caller gets the SOL.
5. How would an attacker approach? Bundle `prepare_transition` + `withdraw_graduated_sol` x2 in one transaction when both curves are Filled.

### 3. Transfer Hook Authority System

**Location:** `programs/transfer-hook/src/instructions/initialize_authority.rs:15-46`, `burn_authority.rs:21-65`, `state/whitelist_authority.rs:14-25`

**Purpose:** Controls whitelist mutation for the transfer hook.

**How it works:**
1. `initialize_authority`: Creates `WhitelistAuthority` PDA with `authority = Some(signer.key())`. One-shot via `init`.
2. `add_whitelist_entry`: Checks `authority == Some(signer)` and `authority.is_some()` (not burned).
3. `burn_authority`: Sets `authority = None`. Idempotent (returns Ok if already None). Checks signer is current authority before burning.

**Assumptions:**
- The first caller to `initialize_authority` becomes the permanent authority.
- Once burned, the whitelist is permanently immutable.

**Invariants:**
- Authority can only transition: `Some(key)` -> `None`. Never `None` -> `Some(key)`.
- No `has_one` on `burn_authority` -- uses manual `require!` check at line 32-35. This is functionally equivalent but less idiomatic Anchor.

**Concerns:**
- `initialize_authority` accepts any signer as the first caller. If an attacker front-runs the deployer during initialization, they become the whitelist authority.
- The `burn_authority` check order is correct: idempotent check before authority validation (line 26-29 before 32-35). This prevents an error when an unauthorized user calls burn on an already-burned authority.

### 4. Feature-Gated Test Helpers

**Location:** `programs/epoch-program/src/instructions/force_carnage.rs:1-77`, `programs/staking/src/instructions/test_helpers.rs:1-101`

**Purpose:** Allow testing without full CPI chain.

**How it works:**
- `force_carnage`: Gated by `#[cfg(feature = "devnet")]` at both module import level (`instructions/mod.rs:7,18`) and instruction level (`lib.rs:261`). Hardcodes `DEVNET_ADMIN = pubkey!("8kPzh...")` at line 19. Only this specific key can call.
- `test_deposit_and_distribute`: Gated by `#[cfg(feature = "test")]` at module and instruction level.

**5 Whys for force_carnage:**
1. Why does this exist? To test carnage execution paths without waiting for VRF triggers.
2. Why devnet feature? Because devnet is the deployment target for testing.
3. Why hardcoded admin? To prevent arbitrary users from manipulating epoch state.
4. Why not just remove for mainnet? The code comments say "MUST BE REMOVED BEFORE MAINNET DEPLOYMENT."
5. Why would this fail? If the devnet feature is accidentally included in a mainnet build, the DEVNET_ADMIN key holder could force arbitrary carnage.

**Concerns:**
- The `devnet` feature is NOT a test-only feature -- it IS the production feature for devnet deployment. This means `force_carnage` is available on all devnet deployments.
- The mainnet build path (`cfg(not(feature = "devnet"))`) correctly excludes it, but the comment "MUST BE REMOVED" suggests the team plans to remove it entirely rather than relying on feature flags.

### 5. Cross-Program ID Mesh

**Location:** All `constants.rs` files across 7 programs.

**Purpose:** Compile-time cross-program references for CPI access control.

**How it works:**
Each program that calls or is called by another program hardcodes the other's program ID. The mesh:

| Referencing Program | Referenced Program | Constant Location |
|---|---|---|
| AMM | Tax Program | `amm/constants.rs:10` (TAX_PROGRAM_ID) |
| Staking | Tax Program | `staking/constants.rs:99` |
| Staking | Epoch Program | `staking/constants.rs:114` |
| Tax Program | Epoch Program | `tax-program/constants.rs:51` |
| Tax Program | AMM | `tax-program/constants.rs:100` |
| Tax Program | Staking | `tax-program/constants.rs:127` |
| Epoch Program | Tax Program | `epoch-program/constants.rs:18` |
| Epoch Program | AMM | `epoch-program/constants.rs:26` |
| Epoch Program | Staking | `epoch-program/constants.rs:34` |
| Bonding Curve | Epoch Program | `bonding_curve/constants.rs:160` |

All IDs have corresponding unit tests verifying string equality (e.g., `test_tax_program_id()`, `test_amm_program_id()`). The `declare_id!` in each program matches the Anchor.toml and the cross-references.

**Concerns:**
- Redeploying any single program to a new address requires rebuilding and redeploying all programs that reference it. This is an N-program cascade.
- The bonding curve uses feature-gated functions (`epoch_program_id()`) with `Pubkey::default()` for mainnet. This is a placeholder that must be updated.

### 6. Epoch/Staking/Tax Initialization Pattern

**Location:** `epoch-program/instructions/initialize_epoch_state.rs:32-116`, `epoch-program/instructions/initialize_carnage_fund.rs:28-131`, `staking/instructions/initialize_stake_pool.rs`, `tax-program/instructions/initialize_wsol_intermediary.rs`

**Purpose:** One-time setup for global state PDAs.

**How it works:**
All initialization instructions use Anchor's `init` constraint to create PDA accounts. None enforce who the initializer is -- any signer with SOL for rent can call them. Protection comes from:
1. `init` prevents re-initialization (PDA already exists).
2. EpochState has a manual `require!(!epoch_state.initialized)` as defense-in-depth.
3. CarnageFundState has a manual `require!(!carnage_state.initialized)` as defense-in-depth.

**Concerns:**
- Front-running risk: If an attacker front-runs initialization, they pay rent but the state is initialized with default/genesis values (not attacker-controlled values since there are no parameters). The state will be correct but the attacker wastes the admin's effort.
- EpochState init does NOT validate the caller is the deployer. The genesis values are all hardcoded, so this is functionally safe but architecturally inconsistent with the AMM's programdata authority pattern.

## Trust Model

### Trusted Entities
1. **Program Upgrade Authority**: Can upgrade any program's logic at any time. Assumed to be a single deployer key (wallet `8kPzh...` on devnet). Not verified to be a multisig.
2. **AMM Admin**: Set during `initialize_admin`, validated against upgrade authority. Can be different from upgrade authority (intended for multisig). Controls pool creation.
3. **Transfer Hook Authority**: Set to first caller of `initialize_authority`. Controls whitelist mutation. Can be permanently burned.

### Untrusted Entities
1. **Any Signer (Bonding Curve)**: All bonding curve admin operations accept any signer. The "authority" name is misleading -- it's not validated.
2. **Any Signer (Epoch/Staking/Tax Init)**: Initialization instructions accept any signer but are one-shot operations with no attacker-controllable parameters.

### Trust Boundary Gaps
- No governance program integration (SPL Governance, Squads, Realms).
- No timelock mechanism anywhere in the protocol.
- No emergency pause capability.
- Upgrade authority is presumably a hot wallet (the devnet wallet file is in the repo at `keypairs/devnet-wallet.json`).

## State Analysis

### Admin State Accounts
| Account | Program | Type | Fields | Mutable By |
|---|---|---|---|---|
| AdminConfig | AMM | PDA | admin: Pubkey, bump: u8 | initialize_admin (once), burn_admin (once) |
| WhitelistAuthority | Transfer Hook | PDA | authority: Option<Pubkey>, initialized: bool | initialize_authority (once), burn_authority (once) |
| VaultConfig | Conversion Vault | PDA | bump: u8 | initialize (once) |

### Programs With No Admin State
- Bonding Curve: No stored admin key. Authority is an unchecked signer parameter.
- Epoch Program: No admin config. Admin operations use bare signers.
- Staking: No admin config. CPI access control via seeds::program.
- Tax Program: No admin config. CPI access control via seeds::program.

## Dependencies

### Anchor Version
All programs use Anchor 0.32.1. This is the latest stable version as of the analysis date. No known security issues specific to 0.32.1 (see `anchor-version-gotchas.md`).

### Feature Flags
| Feature | Programs | Effect |
|---|---|---|
| `devnet` | Epoch, Bonding Curve, Conversion Vault, Tax | Enables devnet program IDs, mint addresses, and `force_carnage` |
| `localnet` | Bonding Curve | Relaxes mint validation, shortens deadlines |
| `test` | Staking | Enables `test_deposit_and_distribute` bypass |
| `init-if-needed` | AMM, Bonding Curve, Staking, Conversion Vault, Tax, Epoch | Anchor feature for conditional init |

### Mainnet Migration Concerns
The following must be updated for mainnet:
1. `bonding_curve/constants.rs:128-132`: `crime_mint()`, `fraud_mint()` return `Pubkey::default()`
2. `bonding_curve/constants.rs:169-173`: `epoch_program_id()` returns `Pubkey::default()`
3. `conversion-vault/constants.rs:31-33,42-44,51-53`: All three mints return `Pubkey::default()`
4. `tax-program/constants.rs:141-144`: `treasury_pubkey()` returns `Pubkey::default()`
5. `epoch-program/constants.rs:48-49`: SWITCHBOARD_PROGRAM_ID switches to mainnet PID
6. `force_carnage` must be removed or re-gated

## Focus-Specific Analysis

### Admin Capability Inventory

| Instruction | Program | What It Changes | Who Can Call | Timelock? | Impact if Malicious |
|---|---|---|---|---|---|
| initialize_admin | AMM | Creates AdminConfig | Upgrade authority (verified) | No | Sets AMM admin key |
| burn_admin | AMM | Zeros admin key | Current admin (has_one) | No | Permanent: no more pools |
| initialize_pool | AMM | Creates pool + vaults | Current admin (has_one) | No | Could create malicious pool parameters (fee capped at 500bps) |
| initialize_curve | Bonding Curve | Creates CurveState + vaults | **ANYONE** | No | First caller pays rent, values are hardcoded |
| fund_curve | Bonding Curve | Transfers 460M tokens to vault | Anyone with tokens | No | Requires token balance |
| start_curve | Bonding Curve | Activates curve | **ANYONE** | No | Requires Initialized + funded state |
| prepare_transition | Bonding Curve | Graduates both curves | **ANYONE** | No | Requires both curves Filled |
| withdraw_graduated_sol | Bonding Curve | Extracts ~1000 SOL | **ANYONE** (receives SOL) | No | **SOL theft** |
| close_token_vault | Bonding Curve | Closes empty vault | **ANYONE** (receives rent) | No | Rent extraction (~0.002 SOL) |
| initialize_epoch_state | Epoch | Creates EpochState | **ANYONE** | No | Hardcoded genesis values |
| initialize_carnage_fund | Epoch | Creates CarnageFundState + vaults | **ANYONE** | No | Hardcoded initial values |
| force_carnage | Epoch | Sets carnage_pending | DEVNET_ADMIN only | No | Forces arbitrary carnage action |
| initialize_stake_pool | Staking | Creates StakePool + vaults | **ANYONE** | No | Requires MINIMUM_STAKE tokens |
| initialize_wsol_intermediary | Tax | Creates WSOL PDA | **ANYONE** | No | One-shot PDA creation |
| initialize_authority | Transfer Hook | Creates WhitelistAuthority | **ANYONE** (becomes authority) | No | First caller becomes authority |
| add_whitelist_entry | Transfer Hook | Adds whitelist address | Current authority | No | Controls transfer restrictions |
| burn_authority | Transfer Hook | Burns authority permanently | Current authority | No | Makes whitelist immutable |
| initialize (vault) | Conversion Vault | Creates VaultConfig + token vaults | **ANYONE** | No | One-shot, no authority stored |

### Centralization Risk Assessment

**Single Points of Failure:**
1. Deployer wallet (`8kPzh...` on devnet) holds upgrade authority for all 7 programs.
2. No multisig enforcement on-chain. The AMM admin CAN be a multisig address, but this is optional and not enforced.
3. No backup authority or recovery mechanism for any program.

**Key Person Risk:**
- If the deployer key is lost: cannot upgrade programs, cannot create AMM pools (until admin is burned), cannot call force_carnage.
- If the deployer key is compromised: attacker can upgrade all program logic, create malicious pools, force carnage.

**Admin Rug-Pull Capability:**
- Upgrade authority can replace any program with a drainer.
- AMM admin can create pools with manipulated parameters (capped at 500bps fee but still).
- Transfer hook authority can add any address to whitelist (enables unrestricted transfers).
- Bonding curve "admin" can withdraw SOL (but so can anyone -- this is the bug).

### Upgrade Analysis

All 7 production programs are deployed as standard upgradeable BPF programs:
- Upgrade authority: presumed to be the deployer wallet.
- No on-chain governance verification (no Squads, SPL Governance, or Realms integration).
- No timelock on upgrades.
- Conversion vault state comment mentions "Upgrade authority managed by Squads multisig on the program itself" (`conversion-vault/src/state.rs:8`) but no on-chain enforcement of this.

The upgrade authority can:
1. Replace program logic entirely (including removing safety checks).
2. Change program IDs would require full mesh rebuild.
3. Upgrade without any notice period.

### Parameter Change Impact

| Parameter | Current Value | Location | Changeable? | Impact if Extreme |
|---|---|---|---|---|
| LP_FEE_BPS | 100 (1%) | amm/constants.rs | Only via pool creation (admin) | Max 500bps. 5% fee on swaps. |
| STAKING_BPS | 7100 (71%) | tax-program/constants.rs | Only via program upgrade | Tax distribution skew |
| CARNAGE_BPS | 2400 (24%) | tax-program/constants.rs | Only via program upgrade | Tax distribution skew |
| TREASURY_BPS | 500 (5%) | tax-program/constants.rs | Only via program upgrade | Tax distribution skew |
| SELL_TAX_BPS | 1500 (15%) | bonding_curve/constants.rs | Only via program upgrade | Higher tax on curve sells |
| SLOTS_PER_EPOCH | 750/4500 | epoch-program/constants.rs | Only via program upgrade | Changes epoch timing |
| TRIGGER_BOUNTY | 1M lamports | epoch-program/constants.rs | Only via program upgrade | Crank incentive |
| COOLDOWN_SECONDS | 43200 (12h) | staking/constants.rs | Only via program upgrade | Unstake cooldown |

All parameters are compile-time constants. None are stored in mutable on-chain state (except tax rates which are VRF-derived per epoch). This means parameter changes require program upgrades.

## Cross-Focus Intersections

### Access Control (Focus 1)
- The bonding curve's lack of authority validation is primarily an access control issue. This analysis documents the admin intent; the access control agent should verify the full permission model.
- The AMM's `has_one = admin` pattern is a good reference for how the bonding curve should work.

### State Machine (Focus 3)
- The bonding curve state machine (Initialized -> Active -> Filled -> Graduated) serves as the primary guard for admin operations. Even without authority checks, state constraints prevent most abuse. Exception: `withdraw_graduated_sol` where the terminal Graduated state IS the unlock condition.

### Token/Economic (Focus 5)
- The treasury_pubkey() returning `Pubkey::default()` for mainnet means 5% of all swap taxes would be sent to an unrecoverable address.
- `withdraw_graduated_sol` vulnerability directly impacts the economic model -- ~2000 SOL of pool seeding capital could be stolen.

### CPI (Focus 4)
- The `seeds::program` access control pattern used by Staking and Tax programs is a well-designed admin mechanism. It replaces traditional signer-based admin with cryptographic proof of caller identity.

## Cross-Reference Handoffs

- **Access Control Agent**: Verify bonding curve admin instructions for full attack surface. Specifically: can `fund_curve` be called by anyone who acquires 460M tokens (e.g., via market purchase)? Can `start_curve` be called by anyone to prematurely activate a partially-funded curve?
- **Token/Economic Agent**: Analyze the economic impact of `withdraw_graduated_sol` being permissionless. ~2000 SOL at stake. Also verify treasury_pubkey() mainnet placeholder.
- **State Machine Agent**: Verify that the bonding curve Graduated state is truly terminal and irreversible. If it can somehow be reverted, the SOL withdrawal vulnerability extends to active curves.
- **Timing Agent**: Analyze the race condition in `withdraw_graduated_sol` -- once both curves are Filled, the first entity to call `prepare_transition` + `withdraw_graduated_sol` wins the SOL.

## Risk Observations

1. **CRITICAL -- Bonding curve SOL theft**: `withdraw_graduated_sol` and `close_token_vault` accept any signer and transfer value to them. Anyone monitoring for Graduated curves can extract ~2000 SOL. This contradicts the comments ("admin-only") and likely represents a missing authority check.

2. **HIGH -- No emergency pause mechanism**: The entire protocol has no circuit breaker. If an exploit is discovered, the only response is program upgrade. With no timelock, a compromised upgrade authority could make things worse instead of better.

3. **HIGH -- No timelock on upgrades**: Program upgrade authority can replace any program logic instantly. Combined with a single-key upgrade authority, this creates a rug-pull vector and eliminates user trust.

4. **MEDIUM -- force_carnage on devnet builds**: The `devnet` feature flag includes `force_carnage` which can artificially trigger carnage events. While admin-gated, this instruction should not exist in any non-test build.

5. **MEDIUM -- Mainnet Pubkey::default() placeholders**: Multiple programs have unset mainnet addresses. Deploying without updating these creates multiple failure modes (invalid mints, lost treasury funds).

6. **MEDIUM -- Transfer hook authority front-running**: `initialize_authority` accepts any signer as the first caller. An attacker could front-run deployment to become the whitelist authority.

7. **MEDIUM -- No admin transfer mechanism**: Neither the AMM admin nor the transfer hook authority can be transferred. The only options are "keep" or "burn." If a key rotation is needed, there's no path.

8. **LOW -- Cross-program ID ossification**: The 15+ hardcoded cross-program references make emergency program redeployment operationally complex.

9. **LOW -- VaultConfig no-authority design**: Conversion vault stores no authority. While intentional, this means there's no way to pause conversions if a bug is found.

10. **LOW -- Inconsistent admin patterns**: AMM uses programdata authority gate. Bonding curve uses bare signer. Epoch/Staking/Tax use no admin at all for initialization. Transfer hook uses stored authority. This inconsistency increases the likelihood of bugs.

11. **LOW (Recheck H119)**: Epoch constants tuning. The constants in `epoch-program/src/constants.rs` have been reviewed and the values are reasonable (SLOTS_PER_EPOCH=750 devnet/4500 mainnet, VRF_TIMEOUT=300, CARNAGE_DEADLINE=300, BOUNTY=0.001 SOL). The feature flags correctly differentiate devnet/mainnet timing. No new concerns beyond what H119 originally identified.

## Novel Attack Surface Observations

1. **Bonding curve graduation MEV bundle**: An attacker can construct a single Solana transaction containing: (a) `prepare_transition` (graduates both curves), (b) `withdraw_graduated_sol` for CRIME curve, (c) `withdraw_graduated_sol` for FRAUD curve. This extracts ~2000 SOL atomically. The state guards (both curves must be Filled) mean the attacker just needs to monitor for the second curve reaching Filled status, then submit before the admin. On Solana with Jito tips, the attacker can outbid the admin's transaction.

2. **Cross-program upgrade cascade denial-of-service**: If a critical bug is found in one program (say AMM), fixing it requires: (a) deploying new AMM at new address, (b) updating AMM ID in Tax, Epoch, and any other referencing programs, (c) rebuilding and redeploying all updated programs. During this multi-step process, the protocol is in an inconsistent state where some programs reference the old ID and some the new one. This multi-transaction upgrade is not atomic and creates a window of vulnerability.

3. **Conversion vault irrecoverability**: The conversion vault has no admin, no pause, and no emergency withdrawal mechanism. If a bug is found in the conversion logic (e.g., the 100:1 rate math), the only fix is to upgrade the program. But if the bug allows token extraction, there's no way to freeze the vault during the upgrade window.

## Questions for Other Focus Areas

- **For Arithmetic focus**: Are the bonding curve math calculations in `math.rs` correct for the ~1000 SOL target? If there's a precision bug that causes curves to never reach Filled status, the graduation vulnerability becomes moot. But if curves overshoot, the SOL withdrawal vulnerability becomes more valuable.
- **For CPI focus**: Does the `seeds::program` pattern in Staking/Tax truly prevent unauthorized callers? If there's a way to bypass `seeds::program`, it would affect the entire CPI access control model.
- **For State Machine focus**: Can the Graduated status ever be reverted? If so, the `withdraw_graduated_sol` vulnerability extends beyond graduation.
- **For Token/Economic focus**: What is the exact SOL amount at risk in graduated curves? The TARGET_SOL is 1000 SOL per curve (2000 total), but actual raises may differ.

## Raw Notes

### declare_id! Consistency Check
All 7 production programs have consistent declare_id values matching Anchor.toml:
- AMM: `EsbMMZtyK4QuEEETj58GRf2wA5Cq1UK9ZBnnrbg6jyst`
- Bonding Curve: `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1`
- Epoch: `5q1X9zGskp8WxpqHyD32vcXJ7Fy5kYJR2YsM1qFuLSeJ`
- Staking: `HLVyXH5QophmQsTZfZS1N3ZHP8QQ476k3JsnWvrHacr8`
- Tax: `Eufdhhek6L1cxrYPvXAgJRVzckuzWVVBLckjNwyggViV`
- Transfer Hook: `FnwnSxgieKBYogwD45KbwtpZMWsdzapg3VwkxTqiaihB`
- Conversion Vault: `EA1tKNmHFs4KH1V3cyZP3CD66GLLJ7Yb9cseeMxR9tv8`

Note: Conversion vault declare_id (`EA1t...`) differs from the project memory's listed ID (`6WwVA...`). This may indicate a redeployment or stale memory entry.

### Mock Program Notes
- `mock-tax-program` declares ID as `Eufdhhek6L1cxrYPvXAgJRVzckuzWVVBLckjNwyggViV` (same as real Tax Program). This is intentional -- deployed at the real address in LiteSVM tests.
- `fake-tax-program` has a different ID (`7i38T...`). Used to test CPI rejection.

### init-if-needed Usage
Multiple programs enable the `init-if-needed` Anchor feature. This is used for `UserStake` creation in the staking program. The feature enables `init_if_needed` attribute which can be a reinitialization vector if not carefully guarded. The staking program's `Stake` instruction uses this for per-user account creation on first stake, which is the correct use case.
