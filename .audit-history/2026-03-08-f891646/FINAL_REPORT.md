# Stronghold of Security - Final Audit Report

**Project:** Dr. Fraudsworth's Finance Factory
**Audit Date:** 2026-03-07/08
**Audit Number:** #2 (stacked on Audit #1: 2026-02-22)
**Auditor:** Stronghold of Security v1.0
**Scope:** Full codebase adversarial security analysis -- 7 on-chain Solana/Anchor programs
**Git Ref:** `f891646c230ed5fa5ad4e464c2d5613796c8e80b`

---

## Executive Summary

### Overall Security Posture

Dr. Fraudsworth's Finance Factory demonstrates strong security engineering across its mature core programs (AMM, Tax, Epoch, Staking, Transfer Hook). The CPI trust model -- built on 4 PDA authority chains validated via `seeds::program` -- is structurally sound and verified across both audits. Arithmetic is predominantly u128-intermediate with checked operations, the constant-product AMM invariant holds under proptest, and the Synthetix staking model is correctly implemented. Mint authorities are burned, and the AMM admin is properly gated via ProgramData upgrade authority.

However, the v1.2 addition of the **Bonding Curve program introduces a systemic CRITICAL vulnerability**: all 6 admin-labeled instructions accept ANY wallet signer with zero on-chain identity verification. This represents the single most severe finding -- an attacker can atomically steal ~2000 SOL (the full proceeds of both token launches) by bundling `prepare_transition` + two `withdraw_graduated_sol` calls in one transaction. Additionally, the **Transfer Hook initialization front-running** vulnerability from Audit #1 remains unfixed (RECURRENT), enabling permanent protocol bricking via whitelist authority capture. These two findings demand immediate remediation before any mainnet deployment.

Beyond the critical issues, the protocol faces several HIGH-severity structural concerns: staking escrow rent depletion (RECURRENT from Audit #1), sell-path zero AMM slippage enabling up to 50% sandwich extraction, initialization front-running across 4 additional programs, and cross-program struct layout coupling without compile-time enforcement. The absence of any emergency pause mechanism across all 7 programs means that if an exploit is discovered post-launch, the minimum response time is 6-120 minutes (program upgrade), during which the protocol operates undefended.

### Key Statistics

| Metric | Count |
|--------|-------|
| Total Attack Hypotheses Investigated | 142 (132 primary + 10 supplemental) |
| CONFIRMED Vulnerabilities | 19 |
| CONFIRMED Informational | 8 |
| POTENTIAL Issues | 1 |
| Investigated & Cleared | 114 |
| Requires Manual Review | 0 |

### Severity Distribution

| Severity | Count | Requires Immediate Action |
|----------|-------|---------------------------|
| CRITICAL | 4 | YES - Block deployment |
| HIGH | 5 | YES - Fix before launch |
| MEDIUM | 5 | Recommended before launch |
| LOW | 6 | Address when convenient |
| INFO | 8 | No action required |

### Top 5 Priority Items

| Priority | ID | Finding | Severity | Location |
|----------|-----|---------|----------|----------|
| 1 | H001/H002/H010 | Bonding Curve authority gap -- ~2000 SOL atomic theft | CRITICAL | `bonding_curve/src/instructions/*.rs` (6 instructions) |
| 2 | H007 | Transfer Hook init front-running -- protocol bricking (RECURRENT) | CRITICAL | `transfer-hook/src/instructions/initialize_authority.rs` |
| 3 | S006 | Combined deployment attack -- authority capture + SOL theft | CRITICAL | `transfer-hook` + `bonding_curve` |
| 4 | H008 | Sell path AMM minimum=0 -- up to 50% sandwich extraction | HIGH | `tax-program/src/instructions/swap_sol_sell.rs:147` |
| 5 | H012/S003 | Staking escrow rent depletion -- permanent tax halt (RECURRENT) | HIGH | `staking/src/instructions/claim.rs:100-145` |

---

## Audit Lineage

| # | Date | Git Ref | Confirmed | Potential | Files | Notes |
|---|------|---------|-----------|-----------|-------|-------|
| 1 | 2026-02-22 | `be95eba` | 15 | 11 | 99 | Initial audit -- 5 programs |
| 2 | 2026-03-07 | `f891646` | 19 | 1 | 129 | +2 new programs (Bonding Curve, Conversion Vault), 71 files changed |

---

## Finding Evolution

### Evolution Summary

| Classification | Count | Description |
|----------------|-------|-------------|
| NEW | 17 | First seen in this audit |
| RECURRENT | 5 | Present in Audit #1, still present |
| REGRESSION | 0 | Previously fixed, now broken again |
| RESOLVED | 4 | Was in Audit #1, now fixed |

### Recurrent Findings

> **Attention:** These findings have persisted across 2 audits without resolution.

| ID (Audit #2) | ID (Audit #1) | Title | Severity | First Seen |
|----|-------|----------|----------|------------|
| H007 | S005 | Transfer Hook init front-running -- authority ransom | CRITICAL | Audit #1 (2026-02-22) |
| H012 | S001 | Staking escrow rent depletion -- PDA destruction | HIGH | Audit #1 (2026-02-22) |
| H008 | S010 | Sell path AMM minimum_amount_out=0 sandwich | HIGH | Audit #1 (2026-02-22) |
| H027 | H060 | EpochState no padding for schema evolution | MEDIUM | Audit #1 (2026-02-22) |
| H021 | H057 | Epoch init front-running (no authority check) | LOW | Audit #1 (2026-02-22) |

> **H007 (Transfer Hook init front-running)** has persisted across 2 audits without resolution. This is a CRITICAL finding that enables permanent protocol bricking. **Prioritize this fix immediately.**

> **H012 (Staking escrow rent depletion)** has persisted across 2 audits. The correct pattern (`available = balance.saturating_sub(rent_exempt_min)`) already exists in the codebase at `execute_carnage_atomic.rs:351-356` but was never applied to the staking escrow.

### Resolved Findings (from Audit #1)

| Audit #1 ID | Title | Original Severity | Resolution |
|----|-------|-------------------|------------|
| H113 | Mint authority retention -- infinite supply risk | CRITICAL | RESOLVED -- mint authority burned in initialize.ts |
| H041 | Tax math -- incorrect fee calculation | HIGH | RESOLVED -- u128 intermediate now correctly used |
| H125 | Unauthorized pool creation | MEDIUM | RESOLVED -- `has_one = admin` constraint added |
| H011 | Profit pool fee asymmetry | MEDIUM | RESOLVED BY REMOVAL -- PROFIT pool deleted |

### New Findings (Audit #2)

| ID | Title | Severity | Program |
|----|-------|----------|---------|
| H001 | BC authority: withdraw_graduated_sol theft | CRITICAL | Bonding Curve |
| H002 | BC authority: prepare_transition forced graduation | CRITICAL | Bonding Curve |
| H010 | Graduation MEV bundle -- atomic ~2000 SOL theft | CRITICAL | Bonding Curve |
| S006 | Combined deployment attack (Hook + BC) | CRITICAL | Transfer Hook + Bonding Curve |
| H036 | Init front-running: Staking + Carnage Fund + Vault | HIGH | Staking, Epoch, Tax, Conv. Vault |
| S005 | No emergency pause -- upgrade timing analysis | HIGH | All programs |
| S007 | No cross-program layout tests | HIGH | Tax, Epoch |
| H011 | EpochState cross-program layout corruption risk | MEDIUM | Tax, Epoch |
| H018 | Mainnet Pubkey::default() placeholders | MEDIUM | Tax, BC, Conv. Vault |
| H049 | Cross-program upgrade cascade | MEDIUM | All core programs |
| H058 | CPI depth at Solana limit (Carnage chain) | MEDIUM | Epoch, Tax, AMM, Hook |
| H003 | BC authority: initialize_curve impersonation | MEDIUM (POTENTIAL) | Bonding Curve |
| H005 | BC authority: close_token_vault rent extraction | MEDIUM | Bonding Curve |
| S001 | BC authority fix requires all 6 instructions | (Supplemental) | Bonding Curve |
| S003 | Escrow destruction bricks all swaps | (Supplemental) | Staking, Tax |
| S004 | compile_error! guard implementation | (Supplemental) | Tax, BC, Conv. Vault |
| S008 | Pool AccountInfo missing owner check | (Supplemental) | Tax |

---

## Critical Findings

> **ACTION REQUIRED**: These findings MUST be addressed before any deployment.

---

### CRITICAL-001: Bonding Curve Authority Gap -- ~2000 SOL Atomic Theft

**IDs:** H001, H002, H010, S001
**Severity:** CRITICAL
**Status:** CONFIRMED (NEW)
**Location:** `programs/bonding_curve/src/instructions/` -- 6 files

#### Description

All 6 admin-labeled instructions in the Bonding Curve program (`initialize_curve`, `fund_curve`, `start_curve`, `prepare_transition`, `withdraw_graduated_sol`, `close_token_vault`) accept ANY `Signer<'info>` as the `authority` account with zero on-chain identity verification. There is no `has_one`, no `address =` constraint, no ProgramData upgrade-authority check, and no stored admin.

The most severe consequence: `withdraw_graduated_sol` transfers all withdrawable SOL (vault_balance - rent_exempt_minimum) directly to whoever signs the transaction. With both CRIME and FRAUD curves raising ~1000 SOL each, the total at risk is ~2000 SOL.

#### Attack Scenario (H010 -- Atomic Bundle)

1. Both CRIME and FRAUD bonding curves reach `Filled` status through normal user purchases (publicly observable on-chain).
2. Attacker constructs a single atomic transaction with 3 instructions:
   - IX 1: `prepare_transition` (attacker as authority) -- both curves transition Filled -> Graduated
   - IX 2: `withdraw_graduated_sol` for CRIME (attacker receives ~1000 SOL)
   - IX 3: `withdraw_graduated_sol` for FRAUD (attacker receives ~1000 SOL)
3. Transaction fits in ~35,000 CU, ~400 bytes, 7 unique accounts. Well within all limits.
4. Attacker submits via Jito bundle with tip. Cost: <0.00001 SOL + tip.
5. If landed before legitimate admin: ~2000 SOL stolen atomically.
6. Admin's subsequent withdrawal returns Ok(()) with zero SOL (idempotent check at line 73).

#### Evidence

```rust
// withdraw_graduated_sol.rs:25-28 -- NO identity verification
/// Protocol authority (deployer). Must sign. Receives SOL.
#[account(mut)]
pub authority: Signer<'info>,

// Line 80-81 -- SOL sent to unverified signer
**ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= withdrawable;
**ctx.accounts.authority.try_borrow_mut_lamports()? += withdrawable;
```

Contrast with AMM's secure pattern (`initialize_admin.rs:44-56`):
```rust
#[account(
    constraint = program_data.upgrade_authority_address == Some(authority.key())
)]
pub program_data: Account<'info, ProgramData>,
```

#### Recommended Fix

**Option A (Recommended):** Create `BcAdminConfig` PDA gated by ProgramData upgrade-authority (matching AMM's pattern), then add `has_one = admin` to all 6 instructions.

**Option B (Quick):** Add `address = deployer_pubkey()` constraint on all 6 `authority` fields using feature-gated constants.

**CRITICAL: All 6 instructions must be fixed together.** Partial coverage leaves attack surface (S001 confirms: protecting only `withdraw_graduated_sol` but not `prepare_transition` still allows forced graduation).

#### Verification Checklist
- [ ] Non-admin signers rejected for all 6 instructions
- [ ] Admin can execute all 6 after `initialize_bc_admin`
- [ ] `initialize_bc_admin` requires the program's upgrade authority
- [ ] Regression test: arbitrary signer TX fails with Unauthorized

---

### CRITICAL-002: Transfer Hook Init Front-Running -- Authority Ransom (RECURRENT)

**ID:** H007 (previously S005 in Audit #1)
**Severity:** CRITICAL (RECURRENT -- surviving 2 audits)
**Status:** CONFIRMED -- NOT FIXED
**Location:** `programs/transfer-hook/src/instructions/initialize_authority.rs:15-46`

#### Description

The `initialize_authority` instruction accepts ANY signer with zero verification against the program's upgrade authority. An attacker who front-runs this instruction during deployment captures permanent, irrevocable control of the whitelist. Since ALL CRIME/FRAUD token transfers require at least one whitelisted party, the attacker can hold the entire protocol hostage or permanently brick it by calling `burn_authority` with an incomplete whitelist.

#### Attack Scenario

1. Attacker monitors mempool for Transfer Hook program deployment.
2. Attacker submits `initialize_authority` with their wallet as signer (cost: ~0.002 SOL).
3. Anchor `init` blocks deployer's TX ("account already initialized").
4. **Protocol is DOA**: No protocol accounts whitelisted. All transfers fail.
5. **No on-chain recovery path**: Must redeploy Transfer Hook, create new mints, rebuild all 6 other programs, migrate all state.

#### Evidence

```rust
pub struct InitializeAuthority<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,  // NO upgrade authority check
    #[account(init, payer = signer, space = 8 + WhitelistAuthority::INIT_SPACE,
              seeds = [WhitelistAuthority::SEED], bump)]
    pub whitelist_authority: Account<'info, WhitelistAuthority>,
    pub system_program: Program<'info, System>,
}
```

No `program` or `program_data` accounts. No `constraint` tying signer to upgrade authority.

#### Recommended Fix

Add ProgramData upgrade-authority gate (identical to AMM's `initialize_admin`):

```rust
#[account(constraint = program.programdata_address()? == Some(program_data.key()))]
pub program: Program<'info, crate::program::TransferHook>,
#[account(constraint = program_data.upgrade_authority_address == Some(signer.key()))]
pub program_data: Account<'info, ProgramData>,
```

Defense-in-depth: Use Jito bundles for atomic deploy + initialize.

---

### CRITICAL-003: Combined Deployment Attack -- Authority Capture + SOL Theft

**ID:** S006
**Severity:** CRITICAL (NEW)
**Status:** CONFIRMED
**Location:** `transfer-hook` + `bonding_curve`

#### Description

An attacker combining H007 (Transfer Hook authority capture) with H001/H010 (Bonding Curve SOL theft) in a coordinated mainnet deployment attack achieves:

1. **Phase 1 (deploy time):** Front-run `initialize_authority` to capture whitelist control.
2. **Phase 2 (ransom):** Demand payment OR selectively whitelist only attacker-controlled addresses.
3. **Phase 3 (graduation):** When bonding curves fill, atomically steal ~2000 SOL via the authority gap.

The combination is worse than either finding alone because the attacker controls both the token transfer layer AND the fund withdrawal path.

#### Recommended Fix

Fix both CRITICAL-001 (BC authority) and CRITICAL-002 (Hook init) before mainnet. These share the same root cause: the AMM's ProgramData pattern was not replicated in newer programs.

---

## High Priority Findings

> **IMPORTANT**: These findings should be fixed before mainnet launch.

---

### HIGH-001: Sell Path AMM minimum_amount_out=0 -- Sandwich Extraction (RECURRENT)

**ID:** H008 (previously S010 in Audit #1)
**Severity:** HIGH (RECURRENT -- partially mitigated with 50% floor, core vulnerability remains)
**Status:** CONFIRMED
**Location:** `programs/tax-program/src/instructions/swap_sol_sell.rs:146-147`

#### Description

The Tax Program passes `minimum_amount_out = 0` to the AMM CPI on the sell path, completely disabling the AMM's own slippage protection. The 50% output floor (added after Audit #1) prevents catastrophic extraction but allows up to ~50% value extraction via sandwich attack. The buy path correctly passes the user's `minimum_output` to the AMM, creating an asymmetric protection gap.

#### Evidence

```rust
// swap_sol_sell.rs:146-147 -- SELL PATH: AMM minimum disabled
let amm_minimum: u64 = 0;

// swap_sol_buy.rs:262 -- BUY PATH: AMM minimum correctly forwarded
ix_data.extend_from_slice(&minimum_output.to_le_bytes());
```

#### Recommended Fix

Compute gross minimum before AMM CPI:
```rust
let gross_minimum = (minimum_output as u128)
    .checked_mul(10_000)?
    .checked_add((10_000 - tax_bps as u128) - 1)?
    .checked_div(10_000 - tax_bps as u128)?;
let amm_minimum = u64::try_from(gross_minimum).ok()?;
```

---

### HIGH-002: Staking Escrow Rent Depletion -- PDA Destruction (RECURRENT)

**ID:** H012, S003 (previously S001 in Audit #1)
**Severity:** HIGH (RECURRENT -- NOT FIXED)
**Status:** CONFIRMED
**Location:** `programs/staking/src/instructions/claim.rs:100-145`

#### Description

The staking `claim` instruction transfers SOL from the escrow vault without reserving the rent-exempt minimum (~890,880 lamports). If the escrow is destroyed (drained to 0), subsequent `deposit_rewards` CPI calls from the Tax Program succeed (system_instruction::transfer recreates the account as system-owned) but all future claims are permanently bricked (Staking program cannot modify system-owned account lamports).

S003 confirms the cascade: swaps continue depositing rewards that appear claimable, but claims silently fail. Users see phantom rewards they can never withdraw.

#### Evidence

```rust
// claim.rs:100-111 -- NO rent-exempt floor
let escrow_balance = ctx.accounts.escrow_vault.lamports();
if escrow_balance < rewards_to_claim {
    return Err(StakingError::InsufficientEscrowBalance.into());
}
// Missing: let available = escrow_balance.saturating_sub(rent_exempt_min);
```

The correct pattern exists at `execute_carnage_atomic.rs:351-356`:
```rust
let available_sol = sol_balance.saturating_sub(rent_exempt_min);
```

#### Recommended Fix

```rust
let rent_min = Rent::get()?.minimum_balance(0);
let available = escrow_balance.saturating_sub(rent_min);
require!(available >= rewards_to_claim, StakingError::InsufficientEscrowBalance);
```

Also add owner check in `deposit_rewards.rs`:
```rust
require!(ctx.accounts.escrow_vault.owner == &crate::id(), StakingError::InvalidEscrowOwner);
```

---

### HIGH-003: Init Front-Running -- Staking + Carnage Fund (Arbitrary Mint Binding)

**ID:** H036
**Severity:** HIGH (NEW)
**Status:** CONFIRMED
**Location:** `staking/src/instructions/initialize_stake_pool.rs`, `epoch-program/src/instructions/initialize_carnage_fund.rs`

#### Description

Two init instructions accept **arbitrary mint parameters** with no on-chain validation:
- **Staking init** (`initialize_stake_pool`): `profit_mint` unconstrained -- front-runner binds stake_vault to wrong mint, permanently bricking staking.
- **Carnage Fund init** (`initialize_carnage_fund`): `crime_mint` and `fraud_mint` unconstrained -- front-runner binds token vaults to wrong mints, permanently bricking buyback-and-burn. 24% of all swap taxes accumulate in SOL vault with no way to spend them.

Both instructions accept any signer with no ProgramData authority check.

#### Recommended Fix

Add mint validation constraints (same pattern as Conversion Vault):
```rust
#[account(constraint = profit_mint.key() == constants::profit_mint() @ StakingError::InvalidMint)]
pub profit_mint: InterfaceAccount<'info, Mint>,
```

Also add ProgramData upgrade-authority gating for defense-in-depth.

---

### HIGH-004: No Emergency Pause Mechanism

**ID:** S005, H071 (related)
**Severity:** HIGH (NEW)
**Status:** CONFIRMED
**Location:** All 7 programs

#### Description

Zero pause/freeze/emergency mechanisms exist across all 7 programs. The sole emergency response is a full program upgrade, which takes 6-120 minutes minimum (build, deploy, verify). During this window, an active exploit continues undefended. For a protocol with AMM pools, staking rewards, and bonding curves handling potentially thousands of SOL, this is a significant operational risk.

#### Recommended Fix

Add a protocol-wide pause flag checked by Tax Program swap entry points (`swap_sol_buy`, `swap_sol_sell`). The flag should be settable by the upgrade authority (pre-lock) or a governance mechanism (post-lock). This is a LOW-cost addition that provides critical operational safety.

---

### HIGH-005: No Cross-Program Layout Tests

**ID:** S007
**Severity:** HIGH (NEW)
**Status:** CONFIRMED
**Location:** Tax Program <-> Epoch Program, Tax/Epoch <-> AMM

#### Description

No workspace-level integration tests verify that the Tax Program's EpochState mirror matches the Epoch Program's canonical struct, or that hardcoded PoolState byte offsets match the AMM's layout. Layout drift would cause silent tax rate corruption on every swap (H011) or broken slippage floors.

#### Recommended Fix

Create workspace-level integration test:
```rust
#[test]
fn epoch_state_layouts_match() {
    let canonical = epoch_program::state::EpochState { /* all fields */ };
    let bytes = canonical.try_serialize(&mut vec![]).unwrap();
    let mirror = tax_program::state::EpochState::try_deserialize(&mut &bytes[..]).unwrap();
    assert_eq!(canonical.crime_buy_tax_bps, mirror.crime_buy_tax_bps);
    // ... all fields
}
```

---

## Medium Priority Findings

> **RECOMMENDED**: Address these before launch if possible.

| ID | Title | Location | Status | Issue |
|----|-------|----------|--------|-------|
| H011 | EpochState cross-program layout corruption | `tax-program/state/epoch_state_reader.rs` | CONFIRMED | No compile-time link between mirror structs; layout drift = silent tax corruption |
| H018 | Mainnet Pubkey::default() placeholders (7) | `tax-program`, `bonding_curve`, `conversion-vault` constants.rs | CONFIRMED | No `compile_error!` guard prevents mainnet build with zero-address placeholders |
| H049 | Cross-program upgrade cascade | All core programs | CONFIRMED | 15 hardcoded cross-program IDs; no atomic multi-program upgrade path |
| H058 | CPI depth at Solana 4-level limit | `epoch-program/execute_carnage_atomic.rs` | CONFIRMED | Carnage chain at exact depth limit; any added CPI silently breaks path |
| H003 | BC initialize_curve front-running | `bonding_curve/instructions/initialize_curve.rs` | POTENTIAL | Any signer can create curve; mitigated by mint allowlist + PDA uniqueness |

### Details

<details>
<summary>H011: EpochState Cross-Program Layout Corruption Risk</summary>

**Location:** `programs/tax-program/src/state/epoch_state_reader.rs` vs `programs/epoch-program/src/state/epoch_state.rs`

The Tax Program maintains a read-only mirror of EpochState (20 fields, 100 bytes). Currently the layouts match exactly. However, there is no compile-time enforcement linking them across crate boundaries. Any future modification to EpochState in the Epoch Program that is not identically replicated in the Tax mirror will silently produce corrupt tax rates on every swap.

The project's own `VRF_Migration_Lessons.md` documents this exact failure mode from V3 (EpochState grew from 50 to 82 bytes, breaking deserialization).

**Fix:** Add `DATA_LEN` static assertion to Tax mirror; create cross-program layout test; add 32-byte reserved padding to EpochState.

</details>

<details>
<summary>H018: Mainnet Pubkey::default() Placeholders</summary>

**Location:** 7 mainnet-path functions across 3 programs

All return `Pubkey::default()` (zero address) in non-devnet builds. The `#[cfg(feature = "devnet")]` feature flag correctly provides real addresses for devnet, but a mainnet build compiles silently with zero-address values. Impact: treasury SOL permanently irrecoverable (sent to System Program), bonding curves and conversion vault non-functional.

**Fix:** Add `compile_error!("Mainnet address not configured")` to every mainnet placeholder function body.

</details>

<details>
<summary>H049: Cross-Program Upgrade Cascade</summary>

**Location:** 15 hardcoded program ID references across 5 core programs

Circular dependencies (AMM <-> Tax, Tax <-> Staking, Tax <-> Epoch, Epoch <-> Staking) make single-pass deployment impossible. Two-pass deploy exists (`deploy-all.sh`) but creates a multi-transaction non-atomic window where some programs reference stale IDs. Struct layout changes during in-place upgrades create a deserialization mismatch window with no circuit breaker.

**Fix:** Document upgrade ordering; add pause flag for upgrade windows; consider shared on-chain registry for program IDs.

</details>

<details>
<summary>H058: CPI Depth at Solana Limit</summary>

**Location:** Carnage chain: Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook = depth 4

The Carnage swap path reaches exactly Solana's 4-level CPI depth limit. Correctly documented with "DO NOT add CPI calls" warnings in 2 files, but no compile-time or test-time enforcement. A single misplaced CPI call in any of 4 programs would silently break all Carnage execution at runtime.

**Fix:** Add depth-tracking integration test; add depth comments to AMM's swap_sol_pool.rs.

</details>

---

## Low Priority Findings

| ID | Title | Location | Recommendation |
|----|-------|----------|----------------|
| H005 | BC close_token_vault rent extraction (any signer) | `bonding_curve/instructions/close_token_vault.rs` | Fix as part of BC authority gap (CRITICAL-001); standalone impact ~0.004 SOL |
| H021 | Epoch init front-running (no authority check) | `epoch-program/instructions/initialize_epoch_state.rs` | Optional ProgramData gating; all params hardcoded, no privilege capture |
| H031 | Dual-curve grief attack (economically constrained) | `bonding_curve/instructions/sell.rs` | 15% sell tax makes attack costly (~32 SOL for 100M token gap); monitor off-chain |
| H048 | taxes_confirmed unchecked by Tax Program | `tax-program/instructions/swap_sol_buy.rs:57-78` | Intentional design choice; VRF window 1-2 slots; stale rates bounded 1-14% |
| H077 | Unchecked `as u64` casts (1 medium-risk case) | `bonding_curve/src/math.rs:236` | Add `u64::try_from()` guard to `calculate_refund` |
| H014 | Buy path 50% output floor (symmetric with sell) | `tax-program/instructions/swap_sol_buy.rs` | Frontend should default to tight slippage (1-3%); consider tightening floor for mainnet |

---

## Informational Notes

> **NO ACTION REQUIRED**: Best practice suggestions and observations.

- **H035**: Tax split comments say 75/24/1 but code correctly uses 71/24/5. Update stale comments in `lib.rs:4-7` and `swap-flow.ts:112`.
- **H022**: PoolState byte offsets re-verified correct; pool.rs modification was comment-only. INIT_SPACE comment says 224 but actual is 216 -- fix the comment.
- **H027**: No padding on any state account (protocol-wide). EpochState uniquely impacted due to cross-program mirror.
- **H039**: Admin privilege escalation investigated -- no viable escalation paths found. Admin roles properly isolated.
- **H071**: No timelock on admin actions. Acceptable given burn capability and intended upgrade authority revocation.
- **S002**: Sell path gross minimum computation has no edge cases with rounding at max tax rates.
- **S004**: `compile_error!()` is viable for all 7 mainnet placeholders without breaking devnet builds.
- **S008**: Pool AccountInfo missing owner check -- not currently exploitable (same account used for floor read and CPI), but defense-in-depth gap.

---

## Combination Attack Analysis

> **CRITICAL SECTION**: Findings that chain together for amplified impact.

### Combination Matrix

Only non-empty cells (findings with meaningful interactions) are shown:

| | H001/H002/H010 | H007 | H008 | H012/S003 | H036 | H018 | H011 | H058 |
|---|---|---|---|---|---|---|---|---|
| **H001/H002/H010** | -- | amplifies (S006) | -- | -- | enables | -- | -- | -- |
| **H007** | amplifies (S006) | -- | -- | -- | shared_pattern | -- | -- | -- |
| **H008** | -- | -- | -- | -- | -- | -- | enables | -- |
| **H012/S003** | -- | -- | -- | -- | -- | -- | -- | -- |
| **H036** | enables | shared_pattern | -- | shared_state (staking) | -- | -- | -- | -- |
| **H018** | -- | -- | -- | -- | -- | -- | -- | -- |
| **H011** | -- | -- | amplifies | -- | -- | -- | -- | -- |
| **H058** | -- | -- | -- | -- | -- | -- | -- | -- |

### Chain 1: Coordinated Deployment Attack (S006)

**Combined Severity:** CRITICAL (exceeds individual findings)

**Component Findings:**
| ID | Individual Severity | Role in Chain |
|----|---------------------|---------------|
| H007 | CRITICAL | Phase 1: Capture whitelist authority |
| H001/H010 | CRITICAL | Phase 3: Steal graduation SOL |
| H036 | HIGH | Phase 1.5: Brick staking/carnage via wrong mints |

**Combined Attack:**
1. Attacker front-runs Transfer Hook `initialize_authority` (H007) -- captures whitelist control.
2. Attacker front-runs Staking and Carnage Fund inits with wrong mints (H036) -- bricks 95% of tax distribution.
3. When bonding curves graduate, attacker steals ~2000 SOL via atomic bundle (H010).
4. Attacker calls `burn_authority` on Transfer Hook -- permanent protocol death.

**Why This Is Worse:** The combination provides the attacker with control over both the token transfer layer AND the fund withdrawal path. The protocol has zero recovery paths without full redeployment and mint recreation.

**Mitigation:** Fix H007 (add ProgramData check to Transfer Hook init) AND H001 (add authority to BC). These share the same root cause.

### Chain 2: Layout Drift + Slippage Bypass

**Combined Severity:** HIGH (amplification)

**Component Findings:**
| ID | Individual Severity | Role in Chain |
|----|---------------------|---------------|
| H011 | MEDIUM | Tax rate corruption via layout mismatch |
| H008 | HIGH | Sell path zero AMM slippage |

**Combined Attack:**
1. A protocol upgrade changes EpochState layout without updating Tax mirror (H011 trigger).
2. Tax rates become corrupted -- potentially reading 0 tax rate from misaligned bytes.
3. With 0% tax, the sell path effectively becomes a zero-slippage swap.
4. Combined with H008's zero AMM minimum, the entire sell path has ZERO protection.
5. Sandwich attackers extract maximum value from every sell transaction.

**Mitigation:** Fix H011 (cross-program layout test) to prevent the chain from starting.

### Chain 3: Staking Escrow Death Spiral

**Combined Severity:** HIGH

**Component Findings:**
| ID | Individual Severity | Role in Chain |
|----|---------------------|---------------|
| H012 | HIGH | Escrow drained below rent-exempt |
| S003 | HIGH | deposit_rewards CPI creates system-owned account |
| H036 (staking) | HIGH | If staking init front-run, wrong mint prevents restaking |

**Combined Attack:**
1. Staking escrow is drained (H012) -- PDA garbage collected.
2. Next swap's `system_instruction::transfer` recreates account as system-owned.
3. `deposit_rewards` CPI succeeds (AccountInfo, no owner check).
4. `pending_rewards` counter increments -- users see phantom rewards.
5. All `claim()` calls fail silently -- staking program cannot modify system-owned lamports.
6. **71% of all swap taxes permanently locked** with no recovery path.

**Mitigation:** Add rent-exempt floor check in `claim.rs` (single line fix).

### Findings That Enable Others

| Finding | Enables | Combined Impact |
|---------|---------|-----------------|
| H007 | H036, S006 | Protocol bricking via multi-program init front-running |
| H001/H002 | H010 | Atomic ~2000 SOL theft bundle |
| H011 | H008 amplification | Zero-protection sell path after layout drift |
| H036 (staking) | H012/S003 cascade | Staking subsystem permanently bricked |

---

## Attack Trees

### Goal 1: Steal Protocol Funds (~2000 SOL)

```
GOAL: Steal bonding curve graduation SOL (~2000 SOL)
├── PATH A: Direct Atomic Bundle (H010)
│   ├── STEP 1: Monitor both CurveState PDAs for status == Filled [PUBLIC INFO]
│   ├── STEP 2: Build TX: prepare_transition + 2x withdraw_graduated_sol [CONFIRMED]
│   └── STEP 3: Submit via Jito bundle with priority tip [TRIVIAL]
│   └── RESULT: ~2000 SOL stolen in single TX. Cost: <0.0001 SOL.
│
├── PATH B: Front-Run Graduation (H002 -> H001)
│   ├── STEP 1: Front-run prepare_transition when curves reach Filled [CONFIRMED]
│   └── STEP 2: Call withdraw_graduated_sol in same or next TX [CONFIRMED]
│
└── PATH C: Combined Deployment Attack (S006)
    ├── STEP 1: Front-run initialize_authority (H007) [CONFIRMED]
    ├── STEP 2: Ransom or selectively whitelist [CONFIRMED]
    └── STEP 3: Steal graduation SOL when available (H010) [CONFIRMED]

CRITICAL NODE: H001 authority gap — Fixing this breaks ALL 3 paths.
```

### Goal 2: Permanently Brick Protocol

```
GOAL: Make protocol permanently non-functional
├── PATH A: Transfer Hook Authority Capture (H007)
│   ├── STEP 1: Front-run initialize_authority [CONFIRMED]
│   └── STEP 2: Call burn_authority with empty whitelist [CONFIRMED]
│   └── RESULT: All CRIME/FRAUD transfers permanently blocked
│
├── PATH B: Multi-Init Front-Running (H036)
│   ├── STEP 1: Front-run initialize_stake_pool with wrong mint [CONFIRMED]
│   ├── STEP 2: Front-run initialize_carnage_fund with wrong mints [CONFIRMED]
│   └── RESULT: Staking + Carnage permanently non-functional
│
└── PATH C: Staking Death Spiral (H012 -> S003)
    ├── STEP 1: Drain escrow below rent-exempt via claim [CONFIRMED]
    ├── STEP 2: PDA garbage collected; recreated as system-owned [CONFIRMED]
    └── RESULT: 71% of swap taxes permanently locked; claims bricked

CRITICAL NODE: ProgramData authority pattern on init instructions — Fixing this breaks Paths A and B.
```

### Goal 3: Extract Value from Users (MEV/Sandwich)

```
GOAL: Extract value from swap users
├── PATH A: Sell Path Sandwich (H008)
│   ├── STEP 1: Monitor mempool for sell TXs [TRIVIAL]
│   ├── STEP 2: Front-run with large buy to move price [TRIVIAL]
│   ├── STEP 3: Victim TX executes with AMM minimum=0 [CONFIRMED]
│   └── STEP 4: Back-run to capture spread [TRIVIAL]
│   └── RESULT: Up to 50% extraction per sell TX
│
└── PATH B: Layout Drift + Zero Protection (H011 -> H008)
    ├── STEP 1: Wait for EpochState layout change (upgrade trigger) [LATENT]
    ├── STEP 2: Tax rates corrupted to 0 [CONFIRMED if triggered]
    └── STEP 3: Full value extraction with zero tax + zero AMM minimum [AMPLIFIED]

CRITICAL NODE: H008 (sell path AMM minimum) — Fixing this caps extraction and breaks Path A.
```

### Critical Fix Nodes (Summary)

| Finding | Attack Paths Broken if Fixed | Recommendation Priority |
|---------|------------------------------|------------------------|
| H001 (BC authority) | 3 of 3 fund theft paths | Fix FIRST |
| H007 (Hook init) | 2 of 3 protocol bricking paths | Fix SECOND |
| H008 (Sell AMM minimum) | 2 of 2 MEV extraction paths | Fix THIRD |
| H012 (Escrow rent) | 1 of 3 protocol bricking paths | Fix FOURTH |

---

## Severity Re-Calibration Notes

After reviewing all findings holistically, the following severity adjustments were made:

| Finding | Original Severity | Adjusted Severity | Reason |
|---------|-------------------|-------------------|--------|
| H005 | MEDIUM | MEDIUM (no change) | State guards effectively limit to rent extraction; bundled with CRITICAL-001 root cause fix |
| S005 | HIGH | HIGH (no change) | Upgrade is sole emergency response; confirmed 6-120 min minimum response time |
| H008 | HIGH | HIGH (confirmed) | RECURRENT from Audit #1; 50% floor is partial mitigation but core vulnerability persists |
| H036 (Staking) | MEDIUM-HIGH | HIGH (upgraded) | Arbitrary mint parameter creates permanent bricking vector; participates in multi-chain attacks |
| H036 (Carnage) | MEDIUM | HIGH (upgraded) | Same rationale: arbitrary mints permanently brick 24% tax distribution |
| H036 (WSOL) | LOW | LOW (no change) | SyncNative enforces correct mint at runtime |
| H036 (Vault) | LOW | LOW (no change) | Hardcoded mint constraints in production builds prevent exploitation |
| H011 | MEDIUM | MEDIUM (confirmed) | Currently safe but amplifies H008 if layout drift occurs; no active exploitation |
| H021 | MEDIUM -> LOW | LOW (downgraded in Audit #2) | All parameters hardcoded; no privilege capture; genesis_slot shift negligible |

---

## Investigated & Cleared

> **GOOD NEWS**: These attack vectors were investigated and found NOT VULNERABLE.

<details>
<summary>Click to expand cleared items (114 total)</summary>

| ID | Hypothesis | Protection Mechanism |
|----|------------|---------------------|
| H004 | BC start_curve premature activation | State gate: requires Funded status with sufficient tokens |
| H006 | BC fund_curve token injection | Token balance requirement + Funded state guard |
| H009 | Pool reserve read spoofing (Carnage) | Same pool account used for both floor read and CPI; AMM validates ownership |
| H013 | Buy path tax math regression (H041 recheck) | RESOLVED -- u128 intermediate now correctly used; 10K+ proptest |
| H015 | Tax swap_exempt access | seeds::program CPI gate correctly enforced |
| H016 | VRF consume_randomness timing | Commit-reveal prevents prediction; pending_randomness_account binding |
| H017 | Conversion vault exploit | Hardcoded mints, fixed 100:1 rate, atomic in/out |
| H019 | AMM k-invariant bypass | verify_k_invariant() post-swap check; 10K proptest |
| H020 | Emergency pause missing | Covered by S005 as consolidated finding |
| H023 | AMM admin escalation to pool | has_one = admin correctly enforced |
| H024 | Sell overflow in bonding curve | u128 intermediates with checked_mul/checked_div |
| H025 | Previous finding resolved | RESOLVED |
| H026 | Epoch transition bounty rent gap | PARTIALLY MITIGATED -- crank auto-tops-up; known TODO |
| H028 | Epoch transition edge cases | No exploitable edge cases found |
| H029 | Carnage atomic execution | Lock window + slippage floor correctly implemented |
| H030 | VRF randomness prediction | Switchboard commit-reveal prevents |
| H032 | WSOL intermediary manipulation | PDA deterministic; SyncNative validates native mint |
| H033 | First-depositor staking attack | Dead stake (MINIMUM_STAKE=1) prevents zero-share attack |
| H034 | Conversion vault precision | Fixed 100:1 rate; floor division favors protocol |
| H037 | force_carnage devnet gate | Properly gated by cfg(feature = "devnet") |
| H038 | Carnage reentrancy | Anchor reentrancy guard + sequential CPI execution |
| H040 | PoolState struct manipulation recheck | Offsets confirmed correct; comment-only modification |
| H041 | Tax math incorrect fee (recheck) | RESOLVED -- u128 correctly implemented |
| H042 | Buy tax calculation precision | u128 intermediates; proptest coverage |
| H043 | AMM slippage check ordering | Correctly implemented; caller passes wrong minimum (separate finding) |
| H044 | Whitelist state transitions | Forward-only: None -> Some -> None (burned) |
| H045 | AMM pool initialization bypass | has_one = admin + PDA uniqueness |
| H046 | Bonding curve price manipulation | Linear curve math verified; 13.5M proptest iterations |
| H047 | Sell refund precision | Floor division + bounded by actual deposits |
| H050 | Tax CPI account injection | Named accounts with PDA validation |
| H051 | BC purchase front-running | Wallet cap + deadline + price curve limit extraction |
| H052 | BC sell state manipulation | Status checks enforce forward-only transitions |
| H053 | Flash-stake attack | Unstake cooldown prevents same-block stake/claim |
| H054 | AMM reserve overflow | u128 intermediates; reserves bounded by pool balance |
| H055 | Epoch state double-init | Anchor init constraint + initialized flag |
| H056 | VRF timeout exploitation | retry_epoch_vrf creates fresh randomness; 300-slot timeout |
| H057 | Epoch init no authority (recheck) | Downgraded to LOW -- all params hardcoded, no privilege capture |
| H059 | Carnage execution ordering | Lock window prevents premature execution |
| H060 | EpochState no padding (recheck) | Covered by H027 as expanded finding |
| H061 | Claim refund dust | Bounded and favorable to last claimer |
| H062 | Extra account meta list init | Anchor init prevents re-init |
| H063 | Staking reward ordering | No exploitable ordering vulnerability |
| H064 | Epoch timing logic | Correctly implemented; slots_per_epoch boundary math sound |
| H065 | VRF anti-reroll bypass | pending_randomness_account binding prevents |
| H066 | Tax overflow on extreme values | u128 intermediate with checked operations |
| H067 | PoolState size mismatch | SAFE -- offsets confirmed correct |
| H068 | Consolidate for refund hijack | No authority account; all destinations are hardcoded PDAs |
| H069 | VRF reveal prediction | Switchboard commit-reveal prevents |
| H070 | VRF byte analysis | 32-byte randomness properly mapped to lookup tables |
| H072 | Flash loan attack on AMM | CPI-only access (Tax->AMM); per-swap tax makes arbitrage unprofitable |
| H073 | Conversion vault reentrancy | Anchor reentrancy guard; no state between CPIs |
| H074 | AMM burn_admin safety | Correctly sets admin to Pubkey::default(); has_one prevents further admin calls |
| H075 | Staking reward precision loss | Floor division; dead stake absorbs rounding dust |
| H076 | BC sell overflow | u128 checked arithmetic throughout |
| H078 | AMM fee extraction | Fee correctly bounded by MAX_LP_FEE_BPS=500 (5%) |
| H079 | Tax CPI validation | seeds::program enforced on all 4 trust boundaries |
| H080 | State transition skip | No skip-state possible; constraints enforce exact predecessor |
| H081 | Whitelist bypass | Hook validates via PDA existence check; no bypass found |
| H082 | Epoch skip handling | Correctly handled; epoch counter increments |
| H083 | Staking claim timing | Cooldown enforced; no timing exploit |
| H084 | Staking checkpoint manipulation | Cumulative reward-per-token model prevents |
| H085 | Transfer hook direct invocation | `transferring` flag prevents direct calls |
| H086 | (Investigated) | Safe |
| H087 | Pool creation parameters | Bounded by MAX_LP_FEE_BPS; PDA uniqueness per mint pair |
| H088 | Staking init re-initialization | Anchor init + PDA uniqueness |
| H089 | AMM CPI access gate | seeds::program = TAX_PROGRAM_ID correctly enforced |
| H090 | Consume randomness edge cases | Auto-expire mechanism added; RESOLVED |
| H091 | Buy path CPI ordering | Sequential CPI; state consistent |
| H092 | Pool reserve overflow | u128 intermediates; k-invariant check |
| H093 | Account ownership confusion | Anchor Account<T> validates owner + discriminator |
| H094 | Staking reward inflation | Bounded by actual deposits; floor division |
| H095 | Pool state manipulation | PDA uniqueness; init prevents re-creation |
| H096 | Conversion rate manipulation | Fixed 100:1 hardcoded; no oracle dependency |
| H097 | Unstake griefing | User can only unstake own stake; cooldown prevents timing attacks |
| H098 | Cross-account data mismatch | Known coupling risk documented in ARCHITECTURE.md |
| H099 | BC price manipulation | False positive -- terminology confusion |
| H100 | Switchboard version | Pinned v0.11.3; no immediate issue |
| H101 | AMM swap math overflow | u128 intermediates; k-invariant post-check |
| H102 | Escrow drainage via flash | Cooldown prevents; no flash path to escrow |
| H103 | Hardcoded address validation | Devnet addresses correct; mainnet = known placeholder (H018) |
| H104 | BC purchase front-running (recheck) | Wallet cap + price curve limit extraction |
| H105 | Carnage slippage floor | 50% floor correctly calculated from pool reserves |
| H106 | Epoch state field constraints | PARTIALLY ADDRESSED -- comments added, no range constraints |
| H107 | Borsh layout stability | Stable; no dynamic-length fields |
| H108 | Cross-program discriminator | Correct -- sha256("account:EpochState")[0..8] |
| H109 | CPI error propagation | Graceful failure via error propagation |
| H110 | Conversion vault account substitution | Mint constraints prevent substitution |
| H111 | VRF retry safety | Fresh randomness; new oracle assignment |
| H112 | Fee calculation consistency | Consistent across buy/sell paths |
| H113 | Mint authority retention (recheck) | RESOLVED -- mint authority burned in initialize.ts |
| H114 | BC purchase overflow | u128 checked arithmetic |
| H115 | Swap_exempt CPI validation | seeds::program correctly enforced |
| H116 | Vault rent extraction | State guards (Graduated + amount==0) prevent meaningful abuse |
| H117 | Carnage atomic CPI ordering | Pre-swap operations at depth 0; swap chain depth 1-4 |
| H118 | Claim refund double-spend | Token burn + balance check prevents |
| H119 | Epoch constants tuning (recheck) | Constants reasonable; no new concerns |
| H120 | Buy tax edge cases | u128 prevents overflow; proptest coverage |
| H121 | Conversion vault access | Permissionless by design; fixed rate |
| H122 | Unstake reward forfeiture | Design choice; documented behavior |
| H123 | Account substitution in Carnage | Named accounts with PDA validation |
| H124 | Pool creation authority delegation | has_one = admin prevents delegation |
| H125 | Unauthorized pool creation (recheck) | RESOLVED -- has_one admin added |
| H126 | Test-only seed concern | Production seeds correct |
| H127 | Cross-program precision sharing | No cross-program precision sharing exists |
| H128 | Conversion vault double-init | Anchor init prevents |
| H129 | Epoch transition safety | State guards correctly enforce |
| H130 | Buy path account validation | Named accounts with constraints |
| H131 | BC purchase safety | Price curve math verified; wallet cap enforced |
| H132 | Staking dead stake | MINIMUM_STAKE=1 correctly prevents zero-share |
| S009 | BC distribute_tax_escrow fund direction | No authority account; all destinations hardcoded PDAs |
| S010 | BC consolidate_for_refund hijack | No authority account; all destinations hardcoded PDAs |

</details>

---

## Recommendations Summary

### Immediate Actions (Before ANY Deployment)

> **BLOCKING**: Do not deploy to mainnet until these are resolved.

1. [ ] **Fix CRITICAL-001**: Add ProgramData authority pattern to ALL 6 Bonding Curve instructions (`programs/bonding_curve/src/instructions/`)
2. [ ] **Fix CRITICAL-002**: Add ProgramData gate to Transfer Hook `initialize_authority` (`programs/transfer-hook/src/instructions/initialize_authority.rs`)
3. [ ] **Add mint validation** to Staking `initialize_stake_pool` and Epoch `initialize_carnage_fund` (H036)
4. [ ] **Add rent-exempt floor check** in Staking `claim.rs` (H012 -- single line fix)

### Pre-Launch Requirements

> **REQUIRED**: Complete before mainnet launch.

1. [ ] Compute and pass gross minimum to AMM on sell path (H008)
2. [ ] Add `compile_error!()` to all 7 mainnet Pubkey::default() placeholders (H018)
3. [ ] Create cross-program layout integration tests (S007)
4. [ ] Add protocol-wide pause flag to Tax Program swap entry points (S005)
5. [ ] Add escrow owner check to `deposit_rewards.rs` (S003)
6. [ ] Add 32-byte reserved padding to EpochState in both programs (H027/H011)
7. [ ] Bundle all init instructions in single atomic TX for mainnet deploy (H036 operational)
8. [ ] Revoke program upgrade authority after deployment verification

### Post-Launch Improvements

> **RECOMMENDED**: Address after stable launch.

1. [ ] Add CPI depth integration test for Carnage chain (H058)
2. [ ] Extract PoolState byte offsets to shared constants crate (H022)
3. [ ] Fix stale tax split comments in lib.rs and swap-flow.ts (H035)
4. [ ] Fix INIT_SPACE comment in pool.rs (H022)
5. [ ] Add `u64::try_from()` guard to `calculate_refund` (H077)
6. [ ] Consider tightening MINIMUM_OUTPUT_FLOOR_BPS from 5000 to 8000-9000 (H014)

### Ongoing Security Practices

- **Code Review**: All changes to CPI chains, struct layouts, or authority patterns must be security-reviewed
- **Monitoring**: Monitor bonding curve state transitions and large claim events on-chain
- **Bug Bounty**: Launch a bug bounty program covering the BC authority gap class of issues
- **Re-Audit**: Schedule Audit #3 after CRITICAL fixes are applied to verify remediation
- **Incident Response**: Document the emergency upgrade procedure (S005 analysis shows 6-120 min window)
- **Layout Tests**: Run cross-program layout tests in CI on every build

---

## Audit Coverage

### Analysis Depth by Area

| Focus Area | Hypotheses | Confirmed | Safe | Key Findings |
|------------|-----------|-----------|------|-------------|
| Access Control | 28 | 8 | 20 | BC authority gap (CRITICAL), Hook init front-running (CRITICAL) |
| Arithmetic | 15 | 1 | 14 | Unchecked as u64 casts (INFO/MEDIUM) |
| State Machine | 18 | 3 | 15 | Dual-curve coupling, EpochState layout |
| CPI & External | 12 | 3 | 9 | CPI depth limit, pool reader no owner check |
| Token & Economic | 16 | 2 | 14 | Sell slippage, escrow rent depletion |
| Oracle & Data | 10 | 1 | 9 | taxes_confirmed design choice |
| Upgrade & Admin | 14 | 4 | 10 | Pubkey::default(), upgrade cascade, no timelock |
| Timing & Ordering | 11 | 2 | 9 | Sell sandwich, carnage MEV |
| Economic Model | 8 | 1 | 7 | Dual-curve grief (economically constrained) |
| Supplemental | 10 | 3 | 7 | BC fix completeness, escrow cascade, combined attack |

### Instruction Coverage

Every externally-callable instruction (41/41 = 100%) was analyzed by at least one investigation. 93% were analyzed by 3 or more independent hypotheses.

---

## Methodology

This audit was performed using the Stronghold of Security methodology:

### Phase 0: Pre-Scan & Handover
- Static pattern matching: 1,286 grep patterns + 275 semgrep findings across 113 files (28,308 LOC)
- Handover from Audit #1: 15 confirmed + 11 potential findings rechecked
- Delta analysis: 71 files changed, 30 new files (Bonding Curve + Conversion Vault)

### Phase 1: Parallel Context Building
- 9 specialized auditors + 8 verification agents analyzed the codebase
- Focus areas: Access Control, Arithmetic, State Machine, CPI, Token/Economic, Oracle, Upgrade/Admin, Timing, Economic Model
- Quality gate passed: 396 KB total output across all agents

### Phase 2: Architectural Synthesis
- Unified trust model with 6 trust tiers documented
- 10 critical invariants verified
- 10 critical assumptions cataloged (2 NOT ENFORCED)
- 8 novel attack surface observations identified

### Phase 3: Strategy Generation
- 132 attack hypotheses generated (28 Tier 1, 42 Tier 2, 62 Tier 3)
- 34 novel strategies (25.8%, exceeding 20% minimum)
- 25 rechecks from Audit #1 findings

### Phase 4: Parallel Investigation
- 142 hypotheses investigated across 28 batches
- 10 supplemental strategies generated from Batch 1 findings
- Each hypothesis investigated with invariant-first analysis and devil's advocate challenges
- Coverage verification: 100% instruction coverage, 100% exploit pattern coverage

### Phase 5: Final Synthesis
- N x N combination matrix for 24 actionable findings
- 3 attack trees with critical fix nodes
- Severity re-calibration (2 upgrades, 1 downgrade)
- This report generated

---

## Disclaimer

This automated security audit represents a comprehensive starting point for security hardening but does not guarantee the absence of vulnerabilities.

**This audit does NOT replace:**
- Manual expert security review
- Formal verification where applicable
- Comprehensive test coverage (13.5M proptest iterations exist but coverage gaps remain)
- Bug bounty programs
- Ongoing security monitoring

**Limitations:**
- Business logic correctness is partially out of scope (design choices documented, not contested)
- Economic attack viability requires market analysis (pool liquidity depth affects sandwich profitability)
- Some findings may be false positives requiring verification in deployment context
- New vulnerabilities may emerge after code changes

**Recommendation:** Engage a professional security firm for a manual audit before mainnet deployment, especially for the Bonding Curve and Transfer Hook programs which contain all CRITICAL findings.

---

## Report Metadata

| Field | Value |
|-------|-------|
| Report Generated | 2026-03-08 |
| Stronghold of Security Version | 1.0.0 |
| Audit Number | #2 |
| Previous Audits | 1 |
| Total Agent Invocations | 9 context + 8 verification + 28 investigation batches + 1 coverage + 1 synthesis = 47 |
| Context Files Generated | 17 (9 context + 8 verification) |
| Strategies Investigated | 142 (132 primary + 10 supplemental) |
| Files Analyzed | 129 |
| Programs in Scope | 7 (AMM, Tax, Epoch, Staking, Bonding Curve, Conversion Vault, Transfer Hook) |

---

**End of Report**
