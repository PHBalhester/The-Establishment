# Technology Stack: Transfer Hook Program Additions

**Project:** Dr. Fraudsworth's Finance Factory - Transfer Hook
**Researched:** 2026-02-05
**Confidence:** HIGH (verified against official docs.rs Cargo.toml sources)

---

## Executive Summary

The transfer hook program requires **two additional crates** beyond what the existing AMM uses: `spl-transfer-hook-interface` for the hook interface types and `spl-tlv-account-resolution` for ExtraAccountMetaList management.

**Critical version decision:** Use version **0.10.0** of both crates (not 2.1.0). Version 2.1.0 requires Solana SDK v3 which conflicts with the existing Anchor 0.32.1 / solana-sdk 2.2 stack.

---

## Stack Additions (Beyond Existing AMM)

### Production Dependencies

| Crate | Version | Purpose | Why This Version |
|-------|---------|---------|------------------|
| `spl-transfer-hook-interface` | **0.10.0** | Hook interface types: `ExecuteInstruction`, `TransferHookInstruction`, discriminator computation | Last version using solana 2.2.1 modular crates; compatible with existing stack |
| `spl-tlv-account-resolution` | **0.10.0** | `ExtraAccountMeta`, `Seed` enum, `ExtraAccountMetaList` for dynamic account resolution | Companion crate; must match transfer-hook-interface version |

### Dev Dependencies

No new dev dependencies required. Existing AMM test infrastructure (litesvm 0.9.1, spl-token-2022 8.0) supports transfer hook testing.

---

## Version Constraints (CRITICAL)

### Why 0.10.0 and NOT 2.1.0

The `spl-transfer-hook-interface` crate underwent a major SDK migration:

| Version | Solana SDK | Status |
|---------|------------|--------|
| **0.10.0** | 2.2.1 (modular crates) | **Use this** - Compatible with Anchor 0.32.1 |
| 2.1.0 | 3.0.0 (modular crates) | Do NOT use - Requires full SDK v3 migration |

**Verified dependency chain for v0.10.0** (from [docs.rs Cargo.toml](https://docs.rs/crate/spl-transfer-hook-interface/0.10.0/source/Cargo.toml.orig)):

```
spl-transfer-hook-interface 0.10.0
  -> solana-account-info 2.2.1
  -> solana-cpi 2.2.1
  -> solana-pubkey 2.2.1
  -> spl-tlv-account-resolution 0.10.0
  -> spl-discriminator 0.4.0
```

**This aligns with existing project dependencies:**
- AMM uses `solana-sdk = "2.2"` in dev-dependencies
- AMM uses `spl-token-2022 = "8.0"` in dev-dependencies
- litesvm 0.9.1 uses compatible Solana 2.x/3.x modular crates

**Verified dependency chain for spl-tlv-account-resolution 0.10.0** (from [docs.rs Cargo.toml](https://docs.rs/crate/spl-tlv-account-resolution/0.10.0/source/Cargo.toml.orig)):

```
spl-tlv-account-resolution 0.10.0
  -> solana-account-info 2.2.1
  -> solana-pubkey 2.2.1
  -> spl-discriminator 0.4.0
  -> spl-pod 0.5.1
```

---

## Integration Patterns

### Pattern 1: Anchor #[interface] Macro (Recommended)

Anchor 0.32.1 supports the `#[interface]` attribute (added in 0.30.0) which automatically generates the correct SPL Transfer Hook discriminator:

```rust
use anchor_lang::prelude::*;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("TransferHookProgramId11111111111111111111");

#[program]
pub mod transfer_hook {
    use super::*;

    // Anchor generates discriminator: sha256("spl-transfer-hook-interface:execute")[..8]
    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        // Whitelist validation logic
        Ok(())
    }

    #[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>
    ) -> Result<()> {
        // ExtraAccountMeta initialization
        Ok(())
    }
}
```

**Source:** [Anchor 0.30.0 Release Notes](https://www.anchor-lang.com/docs/updates/release-notes/0-30-0)

### Pattern 2: Fallback Function (Alternative)

If `#[interface]` causes issues with IDL generation or testing, use explicit fallback:

```rust
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub fn fallback<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    data: &[u8],
) -> Result<()> {
    let instruction = TransferHookInstruction::unpack(data)?;
    match instruction {
        TransferHookInstruction::Execute { amount } => {
            __private::__global::transfer_hook(program_id, accounts, &amount.to_le_bytes())
        }
        _ => Err(ProgramError::InvalidInstructionData.into()),
    }
}
```

**Recommendation:** Start with `#[interface]`. Fall back to explicit fallback only if issues arise.

### Pattern 3: ExtraAccountMetaList Initialization

```rust
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

// Per Transfer_Hook_Spec.md Section 8.2
let extra_metas = vec![
    // Whitelist PDA for source (index 0 = source_account)
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 0 },  // source token account
        ],
        false,  // is_signer
        false,  // is_writable
    )?,
    // Whitelist PDA for destination (index 2 = destination_account)
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 2 },  // destination token account
        ],
        false,
        false,
    )?,
];

ExtraAccountMetaList::init::<ExecuteInstruction>(
    &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
    &extra_metas,
)?;
```

**Source:** [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook)

### Execute Instruction Account Indices

The SPL specification defines fixed positions:

| Index | Account | Description |
|-------|---------|-------------|
| 0 | source_token | Source token account (read-only) |
| 1 | mint | Token mint (read-only) |
| 2 | destination_token | Destination token account (read-only) |
| 3 | owner | Source token account authority (read-only) |
| 4 | extra_account_meta_list | Validation PDA (read-only) |
| 5+ | extra_accounts | Resolved from ExtraAccountMetaList |

**Source:** [Transfer Hook Interface Specification](https://www.solana-program.com/docs/transfer-hook-interface/specification)

---

## Cargo.toml Template

```toml
[package]
name = "transfer-hook"
version = "0.1.0"
description = "Dr Fraudsworth Transfer Hook - Whitelist-based transfer validation"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.32.1", features = ["token", "token_2022"] }
spl-transfer-hook-interface = "0.10.0"
spl-tlv-account-resolution = "0.10.0"

[dev-dependencies]
# Match existing AMM test stack
litesvm = "0.9.1"
solana-sdk = "2.2"
solana-program = "2.2"
spl-token-2022 = "8.0"
spl-associated-token-account = "7.0"
# Modular Solana 3.x crates for litesvm type compatibility
solana-address = "2.0"
solana-keypair = "~3.1"
solana-signer = "~3.0"
solana-message = "~3.0"
solana-transaction = { version = "~3.0", features = ["verify"] }
solana-account = "3.3"
solana-instruction = "~3.1"
sha2 = "0.10"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

---

## What NOT to Add

| Crate/Version | Why Not | What to Do Instead |
|---------------|---------|-------------------|
| `spl-transfer-hook-interface` 2.1.0 | Requires Solana SDK v3; breaks with existing Anchor 0.32.1 stack | Use 0.10.0 |
| `spl-tlv-account-resolution` 0.11.x | Must match transfer-hook-interface version | Use 0.10.0 |
| `spl-token-2022` as production dependency | Only needed in tests; AMM approach uses anchor-spl re-exports | Keep in dev-dependencies only |
| Custom discriminator computation | `#[interface]` macro handles this automatically | Use `#[interface]` attribute |
| `solana-program` as production dependency | Anchor re-exports it; direct import causes version conflicts | Use via `anchor_lang::solana_program` |

---

## Testing Strategy

### Transfer Hook Testing with LiteSVM

The existing AMM test pattern supports transfer hooks. Additional setup required:

1. **Deploy transfer hook program** using same upgradeable BPF pattern as AMM
2. **Create mint with TransferHook extension** (requires different space calculation)
3. **Initialize ExtraAccountMetaList PDA** before any transfers
4. **Resolve extra accounts** manually in tests (client helper not needed)

### Mint Creation with Hook Extension

```rust
// Calculate space: base mint + TransferHook extension
// ExtensionType::TransferHook adds: 1 (type) + 2 (length) + 64 (pubkey + additional data)
let base_mint_space = 82; // Token-2022 Mint::LEN
let extension_space = spl_token_2022::extension::ExtensionType::try_calculate_account_len::<
    spl_token_2022::state::Mint
>(&[spl_token_2022::extension::ExtensionType::TransferHook])?;

// Initialize hook extension BEFORE mint
// Instruction: spl_token_2022::instruction::initialize_transfer_hook
```

### Extra Account Resolution in Tests

```rust
// Derive whitelist PDAs for test verification
let (source_whitelist_pda, _) = Pubkey::find_program_address(
    &[b"whitelist", source_token_account.as_ref()],
    &transfer_hook_program_id,
);
let (dest_whitelist_pda, _) = Pubkey::find_program_address(
    &[b"whitelist", dest_token_account.as_ref()],
    &transfer_hook_program_id,
);

// Include in transfer instruction's remaining_accounts
```

---

## Key Types Reference

```rust
// From spl-transfer-hook-interface 0.10.0
use spl_transfer_hook_interface::{
    instruction::{ExecuteInstruction, TransferHookInstruction},
    get_extra_account_metas_address,
    get_extra_account_metas_address_and_bump_seed,
};

// From spl-tlv-account-resolution 0.10.0
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,  // Literal, InstructionData, AccountKey, AccountData variants
    state::ExtraAccountMetaList,
};
```

---

## Confidence Assessment

| Area | Confidence | Evidence |
|------|------------|----------|
| Version selection (0.10.0) | HIGH | Verified Cargo.toml on docs.rs shows solana 2.2.1 dependencies |
| Anchor #[interface] support | HIGH | Official Anchor 0.30.0 release notes |
| ExtraAccountMeta pattern | HIGH | Official Solana developer guide |
| Account indices | HIGH | SPL specification document |
| Test integration | MEDIUM | Pattern proven for AMM; hook-specific extensions need validation |

---

## Sources

**Primary (verified current):**
- [spl-transfer-hook-interface 0.10.0 Cargo.toml](https://docs.rs/crate/spl-transfer-hook-interface/0.10.0/source/Cargo.toml.orig) - Dependency versions
- [spl-tlv-account-resolution 0.10.0 Cargo.toml](https://docs.rs/crate/spl-tlv-account-resolution/0.10.0/source/Cargo.toml.orig) - Dependency versions
- [Anchor 0.30.0 Release Notes](https://www.anchor-lang.com/docs/updates/release-notes/0-30-0) - #[interface] macro documentation
- [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) - Implementation patterns
- [Transfer Hook Interface Specification](https://www.solana-program.com/docs/transfer-hook-interface/specification) - Account indices

**Secondary (cross-referenced):**
- [solana-program/transfer-hook Releases](https://github.com/solana-program/transfer-hook/releases) - Version history showing v2.1.0 SDK v3 upgrade

---

## Integration with Existing Stack

This research **extends** the existing STACK.md (AMM research from 2026-02-03). The transfer hook program:

- Uses identical Anchor version (0.32.1)
- Uses identical anchor-spl version (0.32.1)
- Uses identical dev-dependency versions
- Adds only two production dependencies

**No modifications to existing AMM Cargo.toml required.** The transfer hook is a separate program in the workspace.

---

*Stack research for: Dr. Fraudsworth Transfer Hook Program*
*Researched: 2026-02-05*
*Extends: STACK.md (AMM, 2026-02-03)*
