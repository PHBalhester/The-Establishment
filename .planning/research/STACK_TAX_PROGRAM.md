# Stack Research: Tax Program

**Domain:** CPI orchestrator with asymmetric taxation on Solana
**Researched:** 2026-02-06
**Confidence:** HIGH (versions verified via `cargo search` against live crates.io)

---

## Executive Summary

The Tax Program requires **zero new dependencies** beyond what is already established in the v0.2/v0.3 stack. This is a stateless CPI orchestrator -- it reads EpochState (owned by Epoch Program), routes to AMM (already built), and distributes SOL to three destinations. The existing Anchor 0.32.1 + anchor-spl stack provides everything needed.

**Key insight:** The Tax Program's complexity is in routing and validation logic, not in new technology requirements. Keep the stack minimal.

---

## Existing Stack (Already In Place -- DO NOT CHANGE)

These are validated in v0.2 (AMM) and v0.3 (Transfer Hook). The Tax Program MUST use identical versions.

| Technology | Version | Source | Notes |
|------------|---------|--------|-------|
| `anchor-lang` | 0.32.1 | AMM Cargo.toml | Matches installed CLI. Stable, not RC. |
| `anchor-spl` | 0.32.1 | AMM Cargo.toml | Token + Token-2022 + ATA helpers |
| `spl-token-2022` | 8.0 | Transfer Hook Cargo.toml | Direct dependency needed for dev-deps only |
| `spl-transfer-hook-interface` | 0.10.0 | Transfer Hook Cargo.toml | Transfer hook account resolution |
| `spl-tlv-account-resolution` | 0.10.0 | Transfer Hook Cargo.toml | ExtraAccountMetaList support |
| `litesvm` | 0.9.1 | AMM Cargo.toml | Testing framework |

**WARNING:** The latest crates.io versions are higher (spl-token-2022 = 10.0.0, spl-transfer-hook-interface = 2.1.0) but the Transfer Hook program already uses 8.0/0.10.0. Do NOT upgrade -- this would cause type conflicts across the workspace.

---

## Stack Additions for Tax Program

### Required: None

The Tax Program needs no new production dependencies. Here is why:

**CPI to AMM:**
- Uses `anchor_lang::solana_program::program::invoke_signed`
- AMM already exposes CPI-callable instructions
- Tax Program's `swap_authority` PDA signs the CPI

**Reading EpochState:**
- Epoch Program will export `EpochState` struct with `#[derive(Clone)]`
- Tax Program deserializes it via standard Anchor account loading
- Cross-program struct sharing is via Anchor IDL-based CPI client

**Tax Distribution (SOL transfers):**
- Native SOL transfers use `system_instruction::transfer` via `invoke_signed`
- No token program needed for SOL distribution to escrow/carnage/treasury
- All three are native SOL destinations (not wrapped SOL)

**Token Transfers:**
- Uses existing `anchor_spl::token` and `anchor_spl::token_2022` modules
- No new SPL crates needed

### Optional: Development Conveniences

| Library | Version | Purpose | Recommendation |
|---------|---------|---------|----------------|
| `spl-discriminator` | 0.4.1 | If manually parsing account discriminators | Already in Transfer Hook. Not needed for Tax Program -- use Anchor's automatic discriminator handling. |

---

## Tax Program Cargo.toml Recommendation

```toml
[package]
name = "tax-program"
version = "0.1.0"
description = "Tax Program - CPI orchestrator for asymmetric taxation"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[features]
default = []
no-entrypoint = []
cpi = ["no-entrypoint"]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]

[dependencies]
anchor-lang = { version = "0.32.1" }
anchor-spl = { version = "0.32.1", features = ["token", "token_2022", "associated_token"] }

# Cross-program imports
amm = { path = "../amm", features = ["cpi"] }
# epoch-program = { path = "../epoch-program", features = ["cpi"] }  # Add when Epoch Program exists

[dev-dependencies]
litesvm = "0.9.1"
solana-sdk = "2.2"
solana-account = "3.3"
solana-keypair = "~3.1"
solana-signer = "~3.0"
solana-message = "~3.0"
solana-transaction = { version = "~3.0", features = ["verify"] }
solana-instruction = "~3.1"
sha2 = "0.10"
```

**Note on cross-program dependencies:**
- `amm = { path = "../amm", features = ["cpi"] }` exposes `amm::cpi::*` for CPI calls
- The `cpi` feature exports instruction builders without the entrypoint
- Same pattern will apply to Epoch Program when built

---

## What NOT to Add

| Technology | Why NOT | What to Use Instead |
|------------|---------|---------------------|
| `spl-token-2022` 10.0.0 | Transfer Hook uses 8.0. Version mismatch causes Pubkey type conflicts. | Use 8.0 if direct import needed, prefer anchor-spl re-exports |
| `spl-transfer-hook-interface` 2.1.0 | Transfer Hook uses 0.10.0. Breaking changes between versions. | Use 0.10.0 if direct import needed |
| `switchboard-on-demand` | Tax Program does not interact with VRF. Epoch Program handles VRF. | Nothing -- Tax Program reads EpochState, does not trigger VRF |
| External math crate | Tax calculation is simple: `amount * rate_bps / 10_000`. Fits in u64, u128 intermediates if paranoid. | Native Rust checked arithmetic |
| `solana-program` direct import | Anchor re-exports it. Direct import at different version causes duplicate types. | Use `anchor_lang::solana_program::*` |

---

## CPI Patterns

### Pattern 1: Tax Program -> AMM

```rust
// Tax Program signs CPI to AMM with swap_authority PDA
let swap_authority_seeds: &[&[u8]] = &[
    b"swap_authority",
    &[ctx.bumps.swap_authority],
];

let cpi_accounts = amm::cpi::accounts::SwapSolPool {
    pool: ctx.accounts.pool.to_account_info(),
    user_input_account: ctx.accounts.user_wsol_account.to_account_info(),
    user_output_account: ctx.accounts.user_ip_account.to_account_info(),
    // ... remaining accounts
    swap_authority: ctx.accounts.swap_authority.to_account_info(),
};

let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.amm_program.to_account_info(),
    cpi_accounts,
    &[swap_authority_seeds],
);

amm::cpi::swap_sol_pool(cpi_ctx, amount_in_after_tax, min_out)?;
```

### Pattern 2: Tax Distribution (Native SOL)

```rust
// Tax Program distributes collected SOL to three destinations
// No token program needed -- these are native SOL transfers

// 75% to staking escrow
let escrow_ix = system_instruction::transfer(
    &ctx.accounts.tax_holding.key(),  // Tax collected here temporarily
    &ctx.accounts.staking_escrow.key(),
    yield_amount,
);
invoke_signed(&escrow_ix, &[...], &[holding_seeds])?;

// 24% to Carnage vault
let carnage_ix = system_instruction::transfer(
    &ctx.accounts.tax_holding.key(),
    &ctx.accounts.carnage_vault.key(),
    carnage_amount,
);
invoke_signed(&carnage_ix, &[...], &[holding_seeds])?;

// 1% to treasury
let treasury_ix = system_instruction::transfer(
    &ctx.accounts.tax_holding.key(),
    &ctx.accounts.treasury.key(),
    treasury_amount,
);
invoke_signed(&treasury_ix, &[...], &[holding_seeds])?;
```

### Pattern 3: Epoch Program -> Tax Program (swap_exempt for Carnage)

```rust
// Carnage execution: Epoch Program CPIs into Tax Program's swap_exempt
// swap_exempt skips tax collection, uses carnage_signer PDA instead of user

// In Tax Program swap_exempt instruction:
#[account(
    seeds = [b"carnage_signer"],
    bump,
    seeds::program = EPOCH_PROGRAM_ID,
)]
pub carnage_signer: Signer<'info>,  // Epoch Program's PDA signs this

// Validation: either user signed (normal swap) or carnage_signer signed (Carnage)
// swap_exempt only accepts carnage_signer, never user
```

---

## Transfer Hook Integration (Existing)

The Tax Program does not directly interact with the Transfer Hook. The hook executes automatically when Token-2022 `transfer_checked` is called.

**CPI Chain:**
```
Tax Program::swap_sol_buy
  -> AMM::swap_sol_pool
      -> Token-2022::transfer_checked (CRIME/FRAUD out to user)
          -> Transfer Hook::execute (automatic, validates whitelist)
```

The Tax Program must pass the correct extra accounts for transfer hook resolution. These accounts are already defined in the Transfer Hook spec and are resolved via `ExtraAccountMetaList`.

---

## Testing Dependencies

Identical to AMM and Transfer Hook programs:

```toml
[dev-dependencies]
litesvm = "0.9.1"
solana-sdk = "2.2"
solana-account = "3.3"
solana-keypair = "~3.1"
solana-signer = "~3.0"
solana-message = "~3.0"
solana-transaction = { version = "~3.0", features = ["verify"] }
solana-instruction = "~3.1"
sha2 = "0.10"
```

**Testing Strategy:**
1. **Unit tests** (litesvm): Tax calculation math, distribution split math, PDA derivation
2. **Integration tests** (litesvm with loaded programs): Full swap flow through Tax -> AMM -> Token-2022 -> Hook
3. **Mock EpochState**: Create test fixture with known tax rates since Epoch Program does not exist yet

---

## Version Compatibility Matrix

| This Version | Compatible With | NOT Compatible With |
|--------------|-----------------|---------------------|
| anchor-lang 0.32.1 | anchor-spl 0.32.1 | anchor-spl 1.0.0-rc.* |
| anchor-spl 0.32.1 | spl-token-2022 ~8.0 (internal pin) | spl-token-2022 10.0.0 (direct import) |
| amm (local) | Uses anchor 0.32.1 | Any different Anchor version |
| transfer-hook (local) | Uses anchor 0.32.1, spl-transfer-hook-interface 0.10.0 | spl-transfer-hook-interface 2.1.0 |

**Critical:** All programs in the workspace MUST use identical Anchor versions. Mixed versions cause IDL incompatibility and CPI signature mismatches.

---

## Integration Points Summary

| Integration | How Tax Program Connects | Stack Requirement |
|-------------|-------------------------|-------------------|
| AMM Program | CPI via `amm::cpi::*` | `amm = { path = "../amm", features = ["cpi"] }` |
| Epoch Program | Reads EpochState account directly | None until Epoch Program exists |
| Transfer Hook | Passthrough -- Token-2022 calls hook automatically | Pass extra accounts from AMM |
| Staking Program | Transfers SOL to escrow (native transfer) | `system_instruction::transfer` |
| Carnage Vault | Transfers SOL (native transfer) | `system_instruction::transfer` |
| Treasury | Transfers SOL (native transfer) | `system_instruction::transfer` |

---

## Open Questions for Phase-Specific Research

1. **EpochState Cross-Program Loading:** When Epoch Program is built, how will Tax Program import the `EpochState` struct? Options:
   - Anchor CPI client (generates from IDL)
   - Shared types crate in workspace
   - Manual deserialization from account data

   **Recommendation:** Anchor CPI client pattern -- cleanest for type safety.

2. **Tax Holding Account:** The spec shows tax collected in swap, then distributed. Should there be an intermediate PDA for tax collection, or distribute directly from user's SOL?

   **Recommendation:** Direct distribution -- user's WSOL comes in, tax portion is split immediately to three destinations, remainder goes to AMM. No intermediate holding needed.

---

## Sources

- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/Cargo.toml` -- existing AMM dependencies
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/Cargo.toml` -- existing Transfer Hook dependencies
- `cargo search anchor-lang` (2026-02-06) -- 1.0.0-rc.2 latest, using 0.32.1 (installed CLI version)
- `cargo search spl-token-2022` (2026-02-06) -- 10.0.0 latest, using 8.0 (workspace consistency)
- `cargo search spl-transfer-hook-interface` (2026-02-06) -- 2.1.0 latest, using 0.10.0 (workspace consistency)
- `cargo search litesvm` (2026-02-06) -- 0.9.1 latest (already using)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Tax_Pool_Logic_Spec.md` -- Tax Program specification
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/AMM_Implementation.md` -- AMM CPI interface
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Epoch_State_Machine_Spec.md` -- EpochState structure

---

*Stack research for: Tax Program (CPI orchestrator)*
*Researched: 2026-02-06*
