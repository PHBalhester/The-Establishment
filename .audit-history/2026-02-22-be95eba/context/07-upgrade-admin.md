# Focus 07: Upgrade & Admin Analysis

**Auditor:** Stronghold of Security (Opus 4.6)
**Date:** 2026-02-22
**Scope:** All admin/governance functions, upgrade authority management, parameter change controls, immutability guarantees, admin privilege scope, operational security patterns
**Programs:** AMM, Tax Program, Epoch Program, Transfer Hook, Staking (+ Stub Staking)

---

<!-- CONDENSED_SUMMARY_START -->

## Condensed Summary

### Architecture Overview

Dr Fraudsworth uses a **deploy-and-lock** admin model rather than ongoing governance. There are two distinct admin roles across the protocol:

1. **AMM Admin** (AdminConfig PDA): Controls pool creation only. Initialized by upgrade authority holder. Can be set to a multisig. Can be permanently burned via `burn_admin`.
2. **Transfer Hook Authority** (WhitelistAuthority PDA): Controls whitelist entry additions. Can be permanently burned via `burn_authority`.

All other programs (Tax, Epoch, Staking) have **no ongoing admin capabilities** -- they are initialized once and operate autonomously via CPI-gated interactions. The protocol operates via a series of one-time initialization instructions followed by parameter-frozen autonomous operation.

### Critical Findings

| ID | Severity | Title | Location |
|----|----------|-------|----------|
| UA-001 | HIGH | Mainnet treasury defaults to Pubkey::default() (all zeros) | `tax-program/src/constants.rs:144` |
| UA-002 | HIGH | force_carnage devnet backdoor must be removed before mainnet | `epoch-program/src/instructions/force_carnage.rs:1-78` |
| UA-003 | MEDIUM | No emergency pause mechanism across entire protocol | All programs |
| UA-004 | MEDIUM | No admin key rotation (two-step transfer) for AMM admin | `amm/src/state/admin.rs:1-18` |
| UA-005 | MEDIUM | Upgrade authorities are unaddressed for mainnet | `Docs/mainnet-checklist.md:115` |
| UA-006 | LOW | constraint = true placeholder on staking_escrow/carnage_vault | `tax-program/src/instructions/swap_sol_buy.rs:436`, `swap_sol_sell.rs:575` |
| UA-007 | LOW | Transfer Hook initialize_authority has no upgrade-authority gate | `transfer-hook/src/instructions/initialize_authority.rs:15-25` |
| UA-008 | INFO | No timelock on pool creation parameters (lp_fee_bps) | `amm/src/instructions/initialize_pool.rs:134` |

### Admin Capability Map (Post-Initialization)

| Program | Admin Capabilities | Can Be Burned? | Timelock? | Multisig? |
|---------|-------------------|----------------|-----------|-----------|
| AMM | Create pools (set fee, seed liquidity) | YES (irreversible) | NO | Supported (admin can be multisig address) |
| Transfer Hook | Add whitelist entries | YES (irreversible) | NO | Not enforced |
| Tax Program | None (autonomous) | N/A | N/A | N/A |
| Epoch Program | force_carnage (devnet only) | N/A | N/A | N/A |
| Staking | None (autonomous) | N/A | N/A | N/A |

### Maximum Damage Assessment (Key Compromise)

**If AMM admin key is compromised** (before burn):
- Attacker can create new pools with arbitrary fee settings (capped at 5% by MAX_LP_FEE_BPS)
- Attacker can seed pools with manipulated initial liquidity ratios
- Cannot modify existing pools, drain vaults, or change tax parameters
- **Mitigation**: Burn admin after all pools are created

**If Transfer Hook authority key is compromised** (before burn):
- Attacker can whitelist arbitrary addresses (bypassing transfer restrictions)
- Cannot remove existing whitelist entries
- Cannot modify the transfer hook logic itself
- **Mitigation**: Burn authority after all entries are whitelisted

**If program upgrade authority is compromised**:
- Attacker can upgrade any program to malicious code, draining all funds
- This is the single highest-risk key in the protocol
- **Mitigation**: Set upgrade authority to multisig, or burn (set to null) for immutability

### Key Invariants

1. `AdminConfig.admin == Pubkey::default()` implies no new pools can ever be created
2. `WhitelistAuthority.authority == None` implies whitelist is permanently frozen
3. No instruction exists to modify pool parameters after initialization (fee, reserves are immutable by admin)
4. No instruction exists to withdraw pool liquidity (no LP token mechanism)
5. Tax distribution ratios (75/24/1) are compile-time constants, not admin-configurable
6. Epoch timing parameters (SLOTS_PER_EPOCH, VRF_TIMEOUT_SLOTS) are compile-time constants
7. `force_carnage` is only compiled when `devnet` feature flag is enabled (double-gated: module + instruction)

### Cross-Focus Handoffs

- **Focus 01 (Access Control)**: `constraint = true` placeholders on staking_escrow and carnage_vault (UA-006) -- the seeds::program constraint is the real validation, `constraint = true` is a no-op. Low severity but should be cleaned up.
- **Focus 04 (CPI & External)**: CPI-gated access for deposit_rewards and update_cumulative is properly enforced via `seeds::program` constraints. The admin cannot bypass these gates.
- **Focus 05 (Token & Economic)**: Treasury address is hardcoded per feature flag. Mainnet uses `Pubkey::default()` which would send 1% of all tax to an unrecoverable address (UA-001).
- **Focus 03 (State Machine)**: force_carnage bypasses the normal VRF state machine. Properly feature-gated but represents a risk if deployed with devnet features enabled.

<!-- CONDENSED_SUMMARY_END -->

---

## Full Analysis

### 1. Admin Role Inventory

#### 1.1 AMM Program Admin

**State**: `AdminConfig` PDA (seeds: `[b"admin"]`)
**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/state/admin.rs`

```rust
pub struct AdminConfig {
    pub admin: Pubkey,  // The authorized admin
    pub bump: u8,       // PDA bump
}
```

**Initialization** (`initialize_admin.rs:1-60`):
- Only callable by the program's upgrade authority
- Verified via `ProgramData` constraint: `program_data.upgrade_authority_address == Some(authority.key())`
- Uses Anchor `init` constraint -- can only be called once (discriminator prevents re-init)
- The `admin` parameter can be set to any pubkey including a multisig address
- Separation of concerns: upgrade authority (deployer) and admin (pool creator) can be different keys

**Powers**:
- `initialize_pool`: Create new AMM pools with specified LP fee and initial liquidity
  - Fee is bounded by `MAX_LP_FEE_BPS = 500` (5%)
  - Pool type is inferred from token programs (not attacker-controllable)
  - Pool PDA is derived from canonical mint ordering (prevents duplicate pools)
- No other admin-gated instructions exist in the AMM

**Burn** (`burn_admin.rs:1-51`):
- Sets `admin_config.admin = Pubkey::default()`
- Requires current admin to sign (`has_one = admin`)
- Truly irreversible: `Pubkey::default()` (all zeros) cannot be signed by any wallet
- After burn, `initialize_pool`'s `has_one = admin` constraint will always fail
- Emits `AdminBurned` event with burned_by and slot
- **Analysis**: The burn is sound. No bypass path exists because:
  1. No instruction to modify AdminConfig.admin exists (only initialize and burn)
  2. AdminConfig PDA uses Anchor discriminator preventing external account substitution
  3. There is no `close` constraint that could destroy the PDA for re-initialization

**Missing Capabilities** (by design):
- No `update_pool_fee` instruction -- fees are set at creation and immutable
- No `remove_liquidity` or `withdraw` -- pool vaults are PDA-owned, no admin drain path
- No `pause` or `emergency_stop` on the AMM

#### 1.2 Transfer Hook Authority

**State**: `WhitelistAuthority` PDA (seeds: `[b"authority"]`)
**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/src/state/whitelist_authority.rs`

```rust
pub struct WhitelistAuthority {
    pub authority: Option<Pubkey>,  // None = burned
    pub initialized: bool,
}
```

**Initialization** (`initialize_authority.rs:1-47`):
- Sets `authority = Some(signer.key())`
- Uses Anchor `init` -- one-time only
- **Finding UA-007** (LOW): No upgrade-authority gate. Any signer can call this before anyone else. On a fresh deploy, a front-runner could theoretically call `initialize_authority` before the deployer. However, this is mitigated by:
  1. The deployer controls when the program is deployed
  2. The PDA is deterministic -- there's no race condition risk if deployed in the same transaction
  3. In practice, initialization scripts bundle all init calls

**Powers**:
- `add_whitelist_entry`: Add addresses to the whitelist (one PDA per address)
  - Validates authority is not burned (`constraint = whitelist_authority.authority.is_some()`)
  - Validates signer matches stored authority
  - Rejects system program and null pubkey as whitelist targets
  - Each entry is its own PDA -- cannot be overwritten or removed
- `initialize_extra_account_meta_list`: Set up token hook resolution metadata per mint
  - Also gated by whitelist authority (not burned, signer matches)

**Burn** (`burn_authority.rs:1-66`):
- Sets `authority = None`
- Idempotent: calling on already-burned authority succeeds silently (no error on re-burn)
- Only emits `AuthorityBurned` event on first burn
- **Analysis**: Sound irreversible burn. After burn:
  1. `add_whitelist_entry` fails at `authority.is_some()` constraint
  2. `initialize_extra_account_meta_list` fails at same constraint
  3. No instruction exists to restore the authority
  4. The `WhitelistAuthority` PDA cannot be closed (no `close` constraint) so it cannot be re-initialized

**Missing Capabilities** (by design):
- No `remove_whitelist_entry` -- entries are permanent once created
- No `update_authority` or transfer mechanism
- After burn, the whitelist is permanently frozen

#### 1.3 Tax Program

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/lib.rs`

**Admin Capabilities**: NONE

The Tax Program has no admin role whatsoever. All operations are either:
- **User-initiated**: `swap_sol_buy`, `swap_sol_sell`, `swap_profit_buy`, `swap_profit_sell` (any signer)
- **CPI-gated**: `swap_exempt` (only callable via Epoch Program's `carnage_signer` PDA)
- **One-time setup**: `initialize_wsol_intermediary` (any signer, but PDA prevents re-creation)

All parameters are compile-time constants:
- Tax rates: Read from EpochState (set by VRF, not admin)
- Distribution split: 75/24/1 (`STAKING_BPS`, `CARNAGE_BPS`, `TREASURY_BPS`)
- Treasury address: `treasury_pubkey()` (hardcoded per feature flag)
- Output floor: `MINIMUM_OUTPUT_FLOOR_BPS = 5000` (50%)
- Micro tax threshold: `MICRO_TAX_THRESHOLD = 4`

#### 1.4 Epoch Program

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/lib.rs`

**Admin Capabilities**: None in production. One devnet-only backdoor.

- `initialize_epoch_state`: One-time setup, any signer, PDA prevents re-init
- `initialize_carnage_fund`: One-time setup, any signer, PDA + initialized flag prevents re-init
- `trigger_epoch_transition`: Permissionless (anyone can trigger when epoch boundary reached)
- `consume_randomness`: Permissionless (anti-reroll via randomness binding)
- `retry_epoch_vrf`: Permissionless (timeout-gated)
- `execute_carnage_atomic`: Permissionless (when carnage_pending = true)
- `execute_carnage`: Permissionless (fallback, window-gated)
- `expire_carnage`: Permissionless (deadline-gated)
- **`force_carnage`**: DEVNET ONLY -- see Finding UA-002

All parameters are compile-time constants:
- `SLOTS_PER_EPOCH`: 750 (devnet) / 4500 (mainnet), feature-gated
- `VRF_TIMEOUT_SLOTS`: 300
- `CARNAGE_DEADLINE_SLOTS`: 300
- `TRIGGER_BOUNTY_LAMPORTS`: 1,000,000 (0.001 SOL)
- `MAX_CARNAGE_SWAP_LAMPORTS`: 1,000,000,000,000 (1000 SOL)
- `CARNAGE_SLIPPAGE_BPS_ATOMIC`: 8500 (85%)
- `CARNAGE_SLIPPAGE_BPS_FALLBACK`: 7500 (75%)
- Genesis tax rates: 300/1400 bps

#### 1.5 Staking Program

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/lib.rs`

**Admin Capabilities**: NONE

- `initialize_stake_pool`: One-time setup, any signer, `init` + initialized flag
- `stake` / `unstake` / `claim`: User operations
- `deposit_rewards`: CPI-gated (Tax Program only, via `seeds::program = tax_program_id()`)
- `update_cumulative`: CPI-gated (Epoch Program only, via `seeds::program = epoch_program_id()`)

All parameters are compile-time constants:
- `MINIMUM_STAKE`: 1,000,000 (1 PROFIT)
- `PRECISION`: 1e18

---

### 2. Detailed Findings

#### UA-001: Mainnet Treasury Defaults to Pubkey::default() [HIGH]

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/constants.rs:140-145`

```rust
#[cfg(not(feature = "devnet"))]
pub fn treasury_pubkey() -> Pubkey {
    // MAINNET PLACEHOLDER: Must be set before mainnet deployment.
    // Using default (all zeros) to make it obvious if accidentally deployed.
    Pubkey::default()
}
```

**Impact**: If the Tax Program is deployed to mainnet without the `devnet` feature flag and without setting the correct treasury address, the 1% treasury share of all tax revenue will be sent to `Pubkey::default()` (all zeros = address `11111111111111111111111111111111`). This is the System Program address, which is on the reserved account list and **cannot receive lamports via writable demotion** (see solana-runtime-quirks.md EP-106). The result would be either:
1. All taxed swaps fail silently (if runtime demotes the write), or
2. Lamports are sent to an unrecoverable address

**Root Cause**: Intentional placeholder for safety (better to fail obviously than deploy with wrong address), but creates a footgun if deployment automation doesn't set the correct address.

**Recommendation**: The developer comment acknowledges this is intentional. For mainnet, this MUST be set to a real multisig treasury address. Consider adding a compile-time assertion:
```rust
#[cfg(not(feature = "devnet"))]
compile_error!("Mainnet treasury address not configured. Set treasury_pubkey() before mainnet build.");
```

**Cross-Reference**: Mainnet checklist item `TREASURY_PUBKEY` (`Docs/mainnet-checklist.md:18`).

**Note**: The PROFIT mint address follows the same pattern (`profit_mint()` defaults to `Pubkey::default()` on non-devnet). This would cause all PROFIT pool swaps to fail on mainnet if not updated.

---

#### UA-002: force_carnage Devnet Backdoor [HIGH]

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/force_carnage.rs:1-78`

```rust
const DEVNET_ADMIN: Pubkey = pubkey!("8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4");
```

**Description**: The `force_carnage` instruction allows the devnet admin wallet to artificially set `carnage_pending = true` on EpochState, bypassing the normal VRF-driven trigger mechanism. This is a test helper that directly manipulates critical protocol state.

**Feature Gate Analysis**:
The instruction is double-gated:
1. **Module level** (`instructions/mod.rs:7-8`): `#[cfg(feature = "devnet")] pub mod force_carnage;`
2. **Instruction level** (`lib.rs:261`): `#[cfg(feature = "devnet")] pub fn force_carnage(...)`

Both gates use `#[cfg(feature = "devnet")]` which means the code is completely excluded from non-devnet builds. The Cargo.toml feature definition (`Cargo.toml:24-25`):
```toml
[features]
default = []
devnet = []
```

The `devnet` feature is empty (no dependencies) and not in `default`. This means:
- Standard `anchor build` does NOT include force_carnage
- Only `anchor build -p epoch_program -- --features devnet` includes it
- The build.sh script referenced in MEMORY.md uses `--features devnet` explicitly

**Risk Assessment**: The feature gate is correctly implemented. However:
1. If someone accidentally deploys with `--features devnet` to mainnet, the backdoor is active
2. The DEVNET_ADMIN key (`8kPzh...`) is a devnet wallet whose keypair is in `keypairs/devnet-wallet.json` (committed to git per mainnet checklist)
3. On mainnet, even if force_carnage were compiled in, the attacker would need the devnet wallet keypair to call it

**Recommendation**:
- Remove the entire `force_carnage` module before mainnet deployment (as noted in codebase comments and INDEX.md)
- Alternatively, add a second gate: `#[cfg(all(feature = "devnet", not(feature = "mainnet")))]`
- Move the test logic to integration test harness where it belongs

**False Positive Note**: Per FP-011 (common-false-positives.md), "Program can be upgraded" is sometimes safe when upgrade authority is properly managed. However, a compiled-in backdoor is different from upgradeability -- it's an active risk if the wrong binary is deployed.

---

#### UA-003: No Emergency Pause Mechanism [MEDIUM]

**Files**: All programs

**Description**: The protocol has no emergency pause capability across any of its 5 programs. There is no `is_paused` flag, no `pause` instruction, no circuit breaker. Per SP-018 (secure-patterns.md), DeFi protocols should have an emergency pause mechanism callable by an operator role.

**Impact**: If a vulnerability is discovered in production:
- Swaps cannot be halted
- Tax distribution continues
- Epoch transitions continue
- Staking/unstaking continues
- Carnage execution continues

The only way to stop the protocol would be to upgrade the programs (requires upgrade authority), which takes time and coordination.

**Counter-Arguments** (why the team may have intentionally omitted this):
1. The protocol design philosophy is "deploy-and-lock" -- admin burns make the protocol immutable
2. A pause mechanism itself is an admin privilege that could be abused
3. All state-changing operations have proper access controls via CPI gating
4. The protocol is designed to be fully permissionless after initialization

**Recommendation**: Consider adding a granular pause (pause swaps but allow unstaking/claims) controlled by a multisig, with the ability to burn the pause authority post-stabilization. At minimum, document the decision not to include pause as an intentional design choice.

**EP Reference**: EP-072 (No Emergency Pause)

---

#### UA-004: No Admin Key Rotation [MEDIUM]

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/state/admin.rs:1-18`

**Description**: The AdminConfig struct only stores `admin` and `bump`. There is no `pending_admin` field for two-step authority transfer. The only admin operations available are:
1. `initialize_admin` -- sets admin (one-time)
2. `burn_admin` -- permanently removes admin

There is no `transfer_admin` or `propose_new_admin` instruction. Per SP-017 (secure-patterns.md), two-step authority transfer prevents accidental transfer to wrong address or null key.

**Impact**: If the admin key needs to be rotated (e.g., key compromise suspicion, team member departure), the only option is to:
1. Burn the admin (permanently disabling pool creation)
2. Redeploy the program with a new AdminConfig (requires upgrade authority)

**Counter-Arguments**:
1. The admin's only power is pool creation, which is a one-time setup activity
2. After all pools are created, admin should be burned anyway
3. The time window where admin is active is short (deployment phase only)
4. Adding key rotation adds attack surface (two-step mechanism is more code to audit)

**Recommendation**: Acceptable if the admin is burned immediately after pool creation. Document the expected lifecycle: deploy -> initialize_admin(multisig) -> create all pools -> burn_admin.

**EP Reference**: EP-069 (No Admin Key Rotation)

---

#### UA-005: Upgrade Authority Strategy Unaddressed [MEDIUM]

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/Docs/mainnet-checklist.md:115`

```
| Determine Update Authorities and strategy for mainnet
```

**Description**: The mainnet checklist has a placeholder item for determining upgrade authority strategy, but no decision has been documented. Each of the 5 programs has an upgrade authority (set during deployment). The upgrade authority is the most powerful key in the protocol -- it can replace any program's code.

**Current State**:
- The AMM's `initialize_admin` correctly validates the upgrade authority via ProgramData
- No other programs reference the upgrade authority
- The devnet wallet (`8kPzh...`) is likely the current upgrade authority for all programs
- Its keypair is committed to the git repository

**Risk**: On mainnet, a single-key upgrade authority means one compromised key can drain the entire protocol.

**Recommendation**:
1. Set upgrade authority to a Squads multisig (3-of-5 or similar) for all programs
2. Consider a timelocked upgrade process (announce upgrade, wait period, execute)
3. For maximum trust: burn upgrade authority (set to null) for immutable programs after stabilization
4. NEVER commit mainnet keypairs to git (the mainnet checklist already notes this)

**EP Reference**: EP-071 (Unprotected Upgrade Authority), EP-083 (Upgrade Without Notice)

---

#### UA-006: constraint = true Placeholder [LOW]

**Files**:
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_buy.rs:436`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_sell.rs:575`

```rust
#[account(
    mut,
    seeds = [ESCROW_VAULT_SEED],
    bump,
    seeds::program = staking_program_id(),
    constraint = true @ TaxError::InvalidStakingEscrow,  // Always-true
)]
pub staking_escrow: AccountInfo<'info>,
```

**Description**: The `constraint = true` check is a no-op -- it always passes. The real validation is the `seeds + seeds::program` constraint which validates the PDA is derived from the correct program with the correct seeds. The `constraint = true` appears to be a leftover from development where a more specific check was planned.

**Impact**: None. The seeds::program constraint provides full validation. The `constraint = true` is dead code that adds confusion but no security risk.

**Cross-Reference**: Flagged in HOT_SPOTS.md at lines 575/586 (swap_sol_sell) and 436/447 (swap_sol_buy) with note "always-true placeholder!"

**Recommendation**: Remove the `constraint = true` lines to reduce confusion for future auditors. The seeds + seeds::program constraint is sufficient.

---

#### UA-007: Transfer Hook initialize_authority Has No Upgrade Authority Gate [LOW]

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/src/instructions/initialize_authority.rs:15-25`

**Description**: Unlike the AMM's `initialize_admin` which verifies the caller is the program's upgrade authority via ProgramData, the Transfer Hook's `initialize_authority` allows any signer to become the whitelist authority. The only protection is the Anchor `init` constraint (one-time only).

**Impact**: In theory, a front-runner could call `initialize_authority` before the deployer, setting themselves as the whitelist authority. In practice:
1. Deployment scripts typically bundle initialization in the same transaction or immediately after deploy
2. The program is not usable until ExtraAccountMetaList is initialized (which requires authority)
3. An attacker gaining authority could only add whitelist entries, not drain funds

**Recommendation**: Consider adding ProgramData validation (matching the AMM pattern) for defense-in-depth. However, since:
- The authority can be burned (permanently frozen)
- The impact of a compromised authority is limited to whitelist additions
- The time window is extremely small (deployment only)

This is LOW severity.

---

#### UA-008: No Timelock on Pool Creation Parameters [INFO]

**File**: `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/instructions/initialize_pool.rs:134`

**Description**: Pool creation sets `lp_fee_bps` immediately with no timelock or community notice period. The admin can create a pool with up to 5% fee (MAX_LP_FEE_BPS = 500) without any waiting period.

**Impact**: Minimal. Pool creation is a one-time event per token pair. Users can inspect the pool's fee before trading. There is no instruction to change the fee after creation.

**EP Reference**: EP-074 (No Timelock on Parameter Changes)

**False Positive Note**: Per the protocol design, all parameters are immutable after initialization. Timelocks are primarily important for parameter changes, not initial setup. Since no parameter change instructions exist, this is informational only.

---

### 3. Program Upgrade Analysis

#### 3.1 Upgrade Authority Flow

All 5 programs are deployed as upgradeable BPF programs:

| Program | declare_id! | Upgrade Authority (Current) |
|---------|-------------|---------------------------|
| AMM | `5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj` | Unknown (likely devnet wallet) |
| Tax Program | `DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj` | Unknown (likely devnet wallet) |
| Epoch Program | `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz` | Unknown (likely devnet wallet) |
| Transfer Hook | `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce` | Unknown (likely devnet wallet) |
| Staking | `EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu` | Unknown (likely devnet wallet) |

The Anchor.toml shows all programs are configured for devnet deployment using the devnet wallet (`keypairs/devnet-wallet.json`).

#### 3.2 Cross-Program ID Validation

The protocol uses hardcoded program IDs for cross-program validation:

| Constant Location | Value | Verified Against |
|-------------------|-------|-----------------|
| AMM `TAX_PROGRAM_ID` | `DRjNCjt4...` | Tax Program `declare_id!` |
| Tax `epoch_program_id()` | `G6dmJTdC...` | Epoch Program `declare_id!` |
| Tax `amm_program_id()` | `5ANTHFtg...` | AMM `declare_id!` |
| Tax `staking_program_id()` | `EZFeU613...` | Staking `declare_id!` |
| Epoch `tax_program_id()` | `DRjNCjt4...` | Tax Program `declare_id!` |
| Epoch `amm_program_id()` | `5ANTHFtg...` | AMM `declare_id!` |
| Epoch `staking_program_id()` | `EZFeU613...` | Staking `declare_id!` |
| Staking `tax_program_id()` | `DRjNCjt4...` | Tax Program `declare_id!` |
| Staking `epoch_program_id()` | `G6dmJTdC...` | Epoch Program `declare_id!` |

**Analysis**: All cross-references are consistent with the `declare_id!` values. An upgrade that changes a program ID would break the entire CPI chain, requiring all referencing programs to be redeployed. This is a natural protection against partial upgrades.

#### 3.3 Feature Flag Analysis

The `devnet` feature flag controls:

| Location | What It Controls |
|----------|-----------------|
| `epoch-program/constants.rs:45-49` | SWITCHBOARD_PROGRAM_ID (devnet vs mainnet PID) |
| `epoch-program/constants.rs:57-61` | SLOTS_PER_EPOCH (750 vs 4500) |
| `epoch-program/instructions/mod.rs:7-8` | force_carnage module inclusion |
| `epoch-program/lib.rs:261` | force_carnage instruction dispatch |
| `tax-program/constants.rs:135-145` | treasury_pubkey() (devnet wallet vs Pubkey::default()) |
| `tax-program/constants.rs:157-165` | profit_mint() (devnet mint vs Pubkey::default()) |

The feature flag system is clean: `devnet` is not in the `default` feature set, so standard builds exclude devnet-only code.

---

### 4. Initialization Security

#### 4.1 One-Time Initialization Matrix

| Instruction | Program | Protection | Re-Init Possible? |
|------------|---------|------------|-------------------|
| `initialize_admin` | AMM | Anchor `init` (discriminator) | NO |
| `initialize_pool` | AMM | Anchor `init` + PDA seeds (one per mint pair) | NO (per pair) |
| `initialize_authority` | Transfer Hook | Anchor `init` (discriminator) | NO |
| `add_whitelist_entry` | Transfer Hook | Anchor `init` + PDA seeds (one per address) | NO (per address) |
| `initialize_extra_account_meta_list` | Transfer Hook | Manual `create_account` + PDA seeds | NO (account exists check) |
| `initialize_epoch_state` | Epoch | Anchor `init` + `!initialized` check (defense-in-depth) | NO |
| `initialize_carnage_fund` | Epoch | Anchor `init` + `!initialized` check (defense-in-depth) | NO |
| `initialize_stake_pool` | Staking | Anchor `init` (discriminator) | NO |
| `initialize_wsol_intermediary` | Tax | PDA `create_account` (fails if exists) | NO |

All initialization instructions are properly protected against re-initialization. The Epoch Program uses a defense-in-depth approach with both Anchor's `init` constraint AND an explicit `!initialized` flag check.

#### 4.2 Initialization Order Dependencies

The protocol has an implicit initialization order:

1. Deploy all programs
2. `initialize_admin` (AMM) -- requires upgrade authority
3. `initialize_authority` (Transfer Hook) -- any signer
4. `add_whitelist_entry` for all protocol addresses (Transfer Hook)
5. `initialize_extra_account_meta_list` per mint (Transfer Hook)
6. `initialize_epoch_state` (Epoch)
7. `initialize_carnage_fund` (Epoch)
8. `initialize_stake_pool` (Staking) -- requires PROFIT tokens
9. `initialize_pool` for all pools (AMM) -- requires admin + tokens
10. `initialize_wsol_intermediary` (Tax)
11. `burn_authority` (Transfer Hook) -- freezes whitelist
12. `burn_admin` (AMM) -- freezes pool creation

This order is not enforced on-chain but is documented in deployment scripts.

---

### 5. Hardcoded Address Analysis

#### 5.1 Treasury Address

**Devnet**: `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` (same as devnet wallet)
**Mainnet**: `Pubkey::default()` (PLACEHOLDER -- see UA-001)

The treasury receives 1% of all tax revenue. The address is validated in swap instructions:
```rust
#[account(
    mut,
    address = treasury_pubkey() @ TaxError::InvalidTreasury,
)]
pub treasury: AccountInfo<'info>,
```

This is an `address` constraint (exact match), not a PDA derivation. The address cannot be changed after compile time without redeploying the Tax Program.

#### 5.2 DEVNET_ADMIN

**File**: `epoch-program/src/instructions/force_carnage.rs:19`

```rust
const DEVNET_ADMIN: Pubkey = pubkey!("8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4");
```

Only used within `force_carnage` which is feature-gated. Not a risk on mainnet builds.

#### 5.3 Switchboard Program ID

Feature-gated between devnet and mainnet Switchboard PIDs. This is standard practice for VRF integration.

---

### 6. What the Admin CANNOT Do

This is as important as what the admin CAN do:

1. **Cannot modify pool parameters** -- No update_fee, update_reserves, or reconfigure instruction exists
2. **Cannot withdraw pool liquidity** -- Vaults are PDA-owned with no admin withdrawal path
3. **Cannot change tax rates** -- Rates are derived from VRF, not admin-controlled
4. **Cannot change tax distribution** -- 75/24/1 split is compile-time constant
5. **Cannot modify staking rewards** -- deposit_rewards and update_cumulative are CPI-gated to Tax/Epoch programs only
6. **Cannot pause the protocol** -- No pause mechanism exists (see UA-003)
7. **Cannot front-run VRF** -- Anti-reroll protection binds randomness at trigger time
8. **Cannot redirect Carnage funds** -- Carnage vaults are PDA-derived, not admin-configurable
9. **Cannot remove whitelist entries** -- Once created, entries are permanent
10. **Cannot restore burned admin/authority** -- Burns are irreversible

---

### 7. Operational Security Assessment

#### 7.1 Keypair Management

**Current State** (devnet):
- All keypairs committed to git in `keypairs/` directory
- Devnet wallet serves as: deployer, upgrade authority, AMM admin, treasury, DEVNET_ADMIN
- This is acceptable for devnet but MUST change for mainnet

**Mainnet Requirements** (from mainnet-checklist.md):
- NEVER commit mainnet keys to git
- Use environment variables for keypairs
- Add `keypairs/` to `.gitignore` before mainnet
- Use dedicated wallets for different roles (crank, treasury, admin)

#### 7.2 Role Separation (Mainnet Recommended)

| Role | Current (Devnet) | Recommended (Mainnet) |
|------|----------------|-----------------------|
| Upgrade Authority | Single devnet wallet | 3-of-5 Squads multisig |
| AMM Admin | Single devnet wallet | Separate multisig (or burn immediately) |
| Transfer Hook Authority | Single devnet wallet | Same as upgrade authority (or burn) |
| Treasury | Single devnet wallet | Cold wallet or timelock multisig |
| Crank Runner | Single devnet wallet | Dedicated hot wallet (minimal SOL) |

---

### 8. False Positive Notes

#### FP: "Programs can be upgraded" (FP-011)
The ability to upgrade programs is a feature, not a bug, during the development and stabilization phase. It becomes a risk when:
- Upgrade authority is a single EOA (currently the case for devnet)
- No notice period before upgrades
- Programs claim to be immutable but aren't

**Status**: The protocol is in active development (Phase 52). Upgradeability is expected and appropriate. For mainnet, the upgrade authority strategy must be decided (UA-005).

#### FP: "No admin key rotation" (UA-004)
While technically a finding per SP-017, the AMM admin's only power is pool creation -- a one-time activity. The design intent is: initialize -> create pools -> burn. Key rotation adds complexity to a lifecycle that should be minutes, not months.

#### FP: "Treasury address hardcoded"
This is intentional for the deploy-and-lock model. Making the treasury configurable would require an admin instruction, which adds attack surface. The trade-off (redeploy to change treasury) is acceptable for a protocol with this admin philosophy.

#### FP: "constraint = true" (UA-006)
While flagged in HOT_SPOTS.md, the `seeds::program` constraint on the same account provides full validation. The `constraint = true` is a code smell, not a security vulnerability.

---

### 9. Invariants

| ID | Invariant | Verification |
|----|-----------|-------------|
| INV-UA-01 | After `burn_admin`, AdminConfig.admin == Pubkey::default() | `burn_admin.rs:22` |
| INV-UA-02 | After `burn_authority`, WhitelistAuthority.authority == None | `burn_authority.rs:38` |
| INV-UA-03 | No instruction modifies PoolState.lp_fee_bps after initialization | Grep for `pool.lp_fee_bps =` -- only in `initialize_pool.rs:135` |
| INV-UA-04 | No instruction withdraws from pool vaults (no drain path) | Grep for `close =` -- zero results across all programs |
| INV-UA-05 | Tax distribution ratios are compile-time constants | `tax-program/constants.rs:18-25` |
| INV-UA-06 | force_carnage excluded from non-devnet builds | `#[cfg(feature = "devnet")]` at module and instruction level |
| INV-UA-07 | All initialization instructions use Anchor `init` or PDA-based one-time creation | See Section 4.1 matrix |
| INV-UA-08 | Cross-program IDs are consistent across all 5 programs | See Section 3.2 table |
| INV-UA-09 | No `realloc`, `close`, or `set_authority` instructions exist | Grep returns zero matches |

---

### 10. Recommendations Summary

| Priority | Recommendation | Finding |
|----------|---------------|---------|
| **CRITICAL** | Set mainnet treasury address before deployment (not Pubkey::default()) | UA-001 |
| **CRITICAL** | Set mainnet PROFIT mint address before deployment | UA-001 (related) |
| **HIGH** | Remove force_carnage entirely or verify devnet feature is excluded from mainnet build | UA-002 |
| **HIGH** | Decide and implement upgrade authority strategy (multisig, timelock, or immutability) | UA-005 |
| **MEDIUM** | Consider adding emergency pause mechanism for stabilization period | UA-003 |
| **MEDIUM** | Move keypairs out of git before mainnet | Operational |
| **LOW** | Clean up `constraint = true` placeholders | UA-006 |
| **LOW** | Add upgrade authority gate to Transfer Hook initialize_authority | UA-007 |
| **INFO** | Document the deploy-and-lock admin philosophy as a design decision | General |

---

### 11. Cross-Focus Handoff Summary

| Target Focus | Handoff Item | Priority |
|-------------|-------------|----------|
| Focus 01 (Access Control) | `constraint = true` on staking_escrow/carnage_vault is redundant with seeds::program | LOW |
| Focus 03 (State Machine) | force_carnage bypasses VRF state machine -- verify feature gate exclusion in build pipeline | HIGH |
| Focus 05 (Token & Economic) | Treasury/PROFIT mint Pubkey::default() on mainnet would disrupt all taxed swaps | HIGH |
| Focus 06 (Oracle & Timing) | VRF timeout and epoch parameters are non-configurable (compile-time) -- no admin can manipulate timing | INFO |
| General | No `close` constraints found -- protocol does not support account closure. This is consistent with the deploy-and-lock model but means rent is never recoverable. | INFO |
