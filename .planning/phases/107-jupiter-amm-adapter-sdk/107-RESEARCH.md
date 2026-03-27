# Phase 107: Jupiter AMM Adapter SDK - Research

**Researched:** 2026-03-26
**Domain:** Jupiter DEX aggregator integration via Rust SDK (Amm trait)
**Confidence:** HIGH

## Summary

Phase 107 builds a Rust SDK crate implementing Jupiter's `Amm` trait so Jupiter's Metis routing engine can route swaps through Dr. Fraudsworth's 2 SOL pools (via Tax Program) and 3 Conversion Vault pairs. The SDK must produce exact quotes (matching on-chain output within 1 lamport) and return complete account metas with zero network calls.

The standard approach is: implement the `jupiter-amm-interface` crate's `Amm` trait in a standalone crate, copy pure math from the on-chain programs, hardcode all mainnet addresses, and prove parity with LiteSVM tests. Jupiter's process requires the SDK be forkable by their team. The Swap enum variant is added on Jupiter's side during their integration review.

**Primary recommendation:** Use `jupiter-amm-interface v0.5.0` (the last version compatible with `solana-sdk 2.x` used by this project). The SDK crate lives at `sdk/jupiter-adapter/` as a workspace member excluded from BPF builds. Five `Amm` instances: 2 SOL pools, 3 vault conversions.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jupiter-amm-interface | 0.5.0 | Amm trait, Quote, SwapParams, SwapAndAccountMetas | Required by Jupiter. **v0.5.0** is the last version compatible with solana-sdk 2.x. v0.6.1 requires solana-pubkey 4.0 (Solana v3/v4 crate split) which is incompatible. |
| solana-sdk | 2.2 | Pubkey, AccountMeta, Account | Same version as rest of project. Required for type compatibility. |
| rust_decimal | 1.36.0 | Decimal type for Quote.fee_pct | Required by jupiter-amm-interface (Quote struct uses Decimal) |
| ahash | 0.8 | AccountMap HashMap hasher | Required by jupiter-amm-interface (AccountMap type alias) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| serde / serde_json | 1.0 | Serialization for KeyedAccount.params | Required transitive dep |
| anyhow | 1 | Error handling (Amm trait returns anyhow::Result) | All trait methods |
| borsh | >=0.10 | Account deserialization compatibility | Transitive from interface |
| sha2 | 0.10 | Anchor discriminator computation | Computing EpochState discriminator for validation |

### Dev Dependencies
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| litesvm | 0.9.1 | Lightweight Solana VM for parity tests | Proving SDK quotes match on-chain |
| solana-program | 2.2 | Account types for test setup | Test fixtures |
| spl-token / spl-token-2022 | 8.0 | Mint/account creation in tests | LiteSVM test setup |
| solana-account | 3.3 | Account struct for litesvm | Type bridge in tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| jupiter-amm-interface 0.6.1 | v0.5.0 | v0.6.1 requires solana-pubkey 4.0 (Solana v3/v4 crate split). Project uses solana-sdk 2.2. Version 0.5.0 requires solana-sdk >=2.1 -- perfect fit. |
| anchor-lang for deserialization | Raw byte parsing | Context decision: no anchor-lang dep. Copy proven byte offsets from pool_reader.rs and epoch_state_reader.rs. |
| Shared math crate | Copied pure functions | Context decision: copy pure functions, add source comments. No premature abstraction. |

**Installation:**
```toml
# sdk/jupiter-adapter/Cargo.toml
[dependencies]
jupiter-amm-interface = "0.5.0"
solana-sdk = "2.2"
rust_decimal = "1.36.0"
ahash = "0.8"
anyhow = "1"
sha2 = "0.10"
```

## Architecture Patterns

### Recommended Project Structure
```
sdk/
  jupiter-adapter/
    Cargo.toml
    src/
      lib.rs                 # Crate root, exports SolPoolAmm + VaultAmm
      sol_pool_amm.rs        # Amm impl for CRIME/SOL and FRAUD/SOL
      vault_amm.rs           # Amm impl for vault conversions (CRIME<->FRAUD, *<->PROFIT)
      math/
        mod.rs               # Re-exports
        amm_math.rs          # Copied from programs/amm/src/helpers/math.rs
        tax_math.rs           # Copied from programs/tax-program/src/helpers/tax_math.rs
        vault_math.rs         # Vault conversion logic (divide/multiply by 100)
      state/
        mod.rs               # Re-exports
        pool_state.rs         # Raw byte parser for PoolState (offsets from pool_reader.rs)
        epoch_state.rs        # Raw byte parser for EpochState (offsets from epoch_state_reader.rs)
      accounts/
        mod.rs               # Re-exports
        addresses.rs          # All hardcoded mainnet addresses
        sol_pool_accounts.rs  # Account meta builders for swap_sol_buy / swap_sol_sell
        vault_accounts.rs     # Account meta builders for convert_v2
        hook_accounts.rs      # Transfer hook extra account metas (4 per hooked mint)
      constants.rs            # Seeds, discriminators, fee BPS, conversion rate
    tests/
      parity_sol_pool.rs     # LiteSVM: SDK quote vs on-chain swap for SOL pools
      parity_vault.rs         # LiteSVM: SDK quote vs on-chain vault convert
    examples/
      quote_example.rs        # Standalone quote demo
    README.md                 # Integration documentation (JUP-07)
```

### Workspace Integration
The SDK crate must NOT be compiled for BPF. The root `Cargo.toml` workspace currently uses `members = ["programs/*", "tests/cross-crate"]`. Add `sdk/jupiter-adapter` to the workspace members list. Since it is outside `programs/*`, Anchor's `anchor build` will never attempt to compile it as a BPF program.

```toml
# Root Cargo.toml
[workspace]
members = ["programs/*", "tests/cross-crate", "sdk/jupiter-adapter"]
resolver = "2"
```

### Pattern 1: Five Amm Instances
**What:** Each pool/vault pair gets its own Amm instance. Jupiter's router calls `from_keyed_account` for each, creating 5 independent quoting engines.
**When to use:** Always -- this is how Jupiter discovers and routes through pools.

The 5 instances:
1. **SolPoolAmm (CRIME/SOL)** -- key = CRIME/SOL pool PDA
2. **SolPoolAmm (FRAUD/SOL)** -- key = FRAUD/SOL pool PDA
3. **VaultAmm (CRIME<->FRAUD)** -- key = VaultConfig PDA (or synthetic key)
4. **VaultAmm (CRIME<->PROFIT)** -- key = VaultConfig PDA (or synthetic key)
5. **VaultAmm (FRAUD<->PROFIT)** -- key = VaultConfig PDA (or synthetic key)

For vault instances, since all 3 share the same VaultConfig PDA but serve different mint pairs, use `KeyedAccount.params` (a `serde_json::Value`) to pass the mint pair identifier. Or use synthetic unique keys derived from the mint pair.

### Pattern 2: SOL Pool Quote Flow
**What:** Replicate the exact on-chain Tax Program swap math.
**When to use:** For SOL pool quotes (4 directions).

Buy flow (SOL -> CRIME/FRAUD):
```rust
// 1. Read tax rate from EpochState (parsed from Jupiter's cached accounts)
let tax_bps = epoch_state.get_tax_bps(is_crime, true); // is_buy=true
// 2. Calculate tax
let tax_amount = calculate_tax(amount_in, tax_bps);
// 3. SOL to swap = amount_in - tax
let sol_to_swap = amount_in - tax_amount;
// 4. Apply LP fee (100 bps)
let effective_input = calculate_effective_input(sol_to_swap, 100); // LP_FEE_BPS=100
// 5. Constant-product swap
let out_amount = calculate_swap_output(reserve_in, reserve_out, effective_input);
// 6. Quote: in=amount_in, out=out_amount, fee=tax_amount (combined LP+tax)
```

Sell flow (CRIME/FRAUD -> SOL):
```rust
// 1. Apply LP fee to token input (100 bps)
let effective_input = calculate_effective_input(amount_in, 100);
// 2. Constant-product swap to get gross SOL output
let gross_sol = calculate_swap_output(reserve_in, reserve_out, effective_input);
// 3. Read tax rate from EpochState
let tax_bps = epoch_state.get_tax_bps(is_crime, false); // is_buy=false
// 4. Calculate sell tax on gross output
let tax_amount = calculate_tax(gross_sol, tax_bps);
// 5. Net output = gross - tax
let out_amount = gross_sol - tax_amount;
// 6. Quote: in=amount_in, out=out_amount, fee=tax_amount
```

### Pattern 3: Vault Quote Flow
**What:** Fixed-rate conversion at 100:1 ratios with zero fees.
**When to use:** For vault conversions (6 directions).

```rust
// CRIME/FRAUD -> PROFIT: divide by 100
let out_amount = amount_in / 100;
// PROFIT -> CRIME/FRAUD: multiply by 100
let out_amount = amount_in.checked_mul(100);
// CRIME <-> FRAUD: 1:1
let out_amount = amount_in;
// fee_amount = 0, fee_pct = 0
```

### Pattern 4: Raw Byte Parsing for Account State
**What:** Parse PoolState and EpochState from raw account bytes without anchor-lang dependency.
**When to use:** In `update()` when Jupiter passes cached account data.

PoolState byte layout (proven in pool_reader.rs):
```
[0..8]     Anchor discriminator
[8]        pool_type (1 byte, PoolType enum)
[9..41]    mint_a (Pubkey, 32 bytes)
[41..73]   mint_b (Pubkey, 32 bytes)
[73..105]  vault_a (Pubkey, 32 bytes)
[105..137] vault_b (Pubkey, 32 bytes)
[137..145] reserve_a (u64 LE, 8 bytes)
[145..153] reserve_b (u64 LE, 8 bytes)
[153..155] lp_fee_bps (u16 LE, 2 bytes)
```

EpochState byte layout (172 bytes total including discriminator):
```
[0..8]     Anchor discriminator
[8..16]    genesis_slot (u64)
[16..20]   current_epoch (u32)
[20..28]   epoch_start_slot (u64)
[28]       cheap_side (u8: 0=CRIME, 1=FRAUD)
[29..31]   low_tax_bps (u16 LE)
[31..33]   high_tax_bps (u16 LE)
[33..35]   crime_buy_tax_bps (u16 LE)
[35..37]   crime_sell_tax_bps (u16 LE)
[37..39]   fraud_buy_tax_bps (u16 LE)
[39..41]   fraud_sell_tax_bps (u16 LE)
```

### Pattern 5: Hardcoded Account Metas
**What:** Pre-compute all AccountMeta vectors for each swap direction using hardcoded mainnet addresses.
**When to use:** In `get_swap_and_account_metas()`.

The key insight: Jupiter calls this method AFTER `quote()` to build the actual swap instruction. The SDK returns the complete set of accounts needed for the Tax Program's swap_sol_buy or swap_sol_sell instruction, including all transfer hook accounts.

### Anti-Patterns to Avoid
- **Network calls in quote() or update():** Jupiter explicitly prohibits this. All data comes from cached AccountMap.
- **anchor-lang as dependency:** Would pull ~50 transitive deps. Use raw byte parsing instead.
- **Shared crate dependency with on-chain programs:** Creates BPF compilation entanglement. Copy math functions.
- **Single Amm instance for all pools:** Jupiter needs separate instances per pool for independent routing.
- **ExactOut support for vaults:** Vault conversions with integer division (CRIME->PROFIT = divide by 100) lose information. ExactOut would need ceiling division which doesn't match on-chain behavior. Set `supports_exact_out()` to false.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Quote math | Custom swap formula | Copy `calculate_effective_input` + `calculate_swap_output` from AMM | These exact functions run on-chain. Any deviation = wrong quotes. |
| Tax calculation | Custom tax formula | Copy `calculate_tax` from tax_math.rs | Exact on-chain match required |
| Tax distribution split | Custom split | Copy `split_distribution` from tax_math.rs | Not needed for quoting, but useful for fee reporting |
| Anchor discriminator | Manual hash | `sha2::Sha256` with "account:EpochState" | Must match exactly for validation |
| Transfer hook account resolution | PDA derivation at runtime | Hardcoded constants from mainnet.json | Zero network calls requirement. PDAs are deterministic and never change. |
| AccountMeta ordering | Trial and error | Copy exact order from swap_sol_buy.rs / swap_sol_sell.rs account structs | Wrong order = runtime error |

**Key insight:** Every math function must be an exact byte-for-byte copy of the on-chain version. The SDK is a mirror of on-chain logic, not an approximation.

## Common Pitfalls

### Pitfall 1: solana-sdk Version Incompatibility
**What goes wrong:** Using `jupiter-amm-interface 0.6.1` (latest) which requires `solana-pubkey 4.0` from the Solana v3/v4 crate split. The project uses `solana-sdk 2.2`.
**Why it happens:** jupiter-amm-interface recently upgraded to Solana's new modular crate architecture. The project hasn't.
**How to avoid:** Pin to `jupiter-amm-interface = "0.5.0"` which requires `solana-sdk >= 2.1` -- perfect match.
**Warning signs:** Compilation errors about `Pubkey` type mismatches, `solana-pubkey` not found.

### Pitfall 2: Buy vs Sell Tax Application Point
**What goes wrong:** Applying tax at the wrong point in the calculation, producing quotes that don't match on-chain output.
**Why it happens:** Buy tax is on INPUT (SOL), sell tax is on OUTPUT (SOL). Different math flow.
**How to avoid:**
- **Buy:** tax = calculate_tax(amount_in, bps) --> sol_to_swap = amount_in - tax --> AMM swap(sol_to_swap) --> output
- **Sell:** AMM swap(amount_in) --> gross_sol --> tax = calculate_tax(gross_sol, bps) --> net = gross_sol - tax
**Warning signs:** Quote off by the tax amount. Parity tests failing by exactly the tax percentage.

### Pitfall 3: Canonical Mint Ordering (is_reversed)
**What goes wrong:** Assuming SOL is always mint_a. Getting reserve_a/reserve_b backwards.
**Why it happens:** AMM stores pools in canonical order (mint_a < mint_b byte-wise). NATIVE_MINT (0x06...) sorts before all project mints, so SOL IS mint_a for current pools. But the code must handle both cases.
**How to avoid:** Read mint_a from bytes [9..41], compare to NATIVE_MINT. If equal, reserve_a=SOL; else reserve_b=SOL. Copy the exact logic from pool_reader.rs.
**Warning signs:** Reserves swapped, output calculation wildly wrong (token amount where SOL should be).

### Pitfall 4: Vault Conversion -- CRIME<->FRAUD Missing
**What goes wrong:** Only implementing CRIME<->PROFIT and FRAUD<->PROFIT, forgetting CRIME<->FRAUD 1:1 conversion.
**Why it happens:** The original on-chain `compute_output_with_mints` only handles `*<->PROFIT` pairs. CRIME<->FRAUD is NOT in the original code because it was a later addition.
**How to avoid:** Verify against CONTEXT.md: 3 vault Amm instances including CRIME<->FRAUD at 1:1. Check if `compute_output_with_mints` handles CRIME<->FRAUD -- if not, add it in the SDK copy.
**Warning signs:** Jupiter can't find a route for CRIME->FRAUD.

### Pitfall 5: Transfer Hook Accounts Ordering
**What goes wrong:** Returning transfer hook accounts in wrong order, causing on-chain error 3005 (AccountNotEnoughKeys).
**Why it happens:** AMM splits remaining_accounts as [INPUT hooks, OUTPUT hooks], NOT [side A, side B]. For sell (BtoA), input=B, output=A, so hooks are [B_hooks, A_hooks].
**How to avoid:** Match the exact ordering from the proven client code. Per project memory: "Buy (AtoB): send [A, B]. Sell (BtoA): send [B, A]."
**Warning signs:** Swaps work for buy but fail for sell, or vice versa.

### Pitfall 6: SwapSolSell Has Extra Accounts
**What goes wrong:** Returning wrong account count for sell instructions.
**Why it happens:** swap_sol_sell has additional accounts vs swap_sol_buy: `wsol_intermediary` PDA. Buy has 21 named accounts, sell has 22 named accounts.
**How to avoid:** Count accounts from the actual struct definitions. SwapSolBuy = 21 accounts, SwapSolSell = 22 accounts (adds wsol_intermediary), plus remaining_accounts for transfer hooks.
**Warning signs:** Missing account errors only on sell direction.

### Pitfall 7: Vault Instances Sharing Same Key
**What goes wrong:** Jupiter's `from_keyed_account` receives the account key (pool PDA for SOL pools, VaultConfig PDA for vaults). All 3 vault instances share the same VaultConfig PDA, but Jupiter needs unique keys per Amm instance.
**Why it happens:** VaultConfig is a singleton PDA.
**How to avoid:** Use `KeyedAccount.params` to pass mint pair info, or derive synthetic unique keys. The `key()` method must return a unique Pubkey per instance. Options: (a) use a deterministic hash of the mint pair as the key, (b) use the VaultConfig PDA but differentiate via params.
**Warning signs:** Jupiter only discovers 1 vault instance instead of 3.

### Pitfall 8: Vault convert_v2 Amount Semantics
**What goes wrong:** Using `amount_in=0` sentinel in SDK quotes (which means "use full balance" on-chain).
**Why it happens:** convert_v2 has a special `amount_in=0` mode for convert-all. The SDK should always use explicit amounts.
**How to avoid:** SDK always passes the actual `amount_in` from QuoteParams. The `amount_in=0` sentinel is a client convenience, not relevant for Jupiter routing.
**Warning signs:** Quote returns 0 output.

## Code Examples

### Amm Trait Implementation Skeleton (SOL Pool)
```rust
// Source: jupiter-amm-interface 0.5.0 + on-chain Tax Program math
use jupiter_amm_interface::{
    Amm, AmmContext, KeyedAccount, Quote, QuoteParams, SwapAndAccountMetas,
    SwapMode, SwapParams, AccountMap, try_get_account_data,
};
use solana_sdk::pubkey::Pubkey;
use anyhow::Result;

#[derive(Clone)]
pub struct SolPoolAmm {
    key: Pubkey,           // Pool PDA address
    is_crime: bool,        // true = CRIME/SOL, false = FRAUD/SOL
    reserve_sol: u64,      // SOL reserve (from PoolState)
    reserve_token: u64,    // Token reserve (from PoolState)
    lp_fee_bps: u16,       // LP fee (100 bps = 1%)
    // Tax rates (from EpochState)
    buy_tax_bps: u16,
    sell_tax_bps: u16,
}

impl Amm for SolPoolAmm {
    fn from_keyed_account(keyed_account: &KeyedAccount, _context: &AmmContext) -> Result<Self> {
        // Parse PoolState from raw bytes
        let data = &keyed_account.account.data;
        // ... parse mint_a, reserves, lp_fee_bps from known offsets
        todo!()
    }

    fn label(&self) -> String {
        "Dr Fraudsworth".to_string()
    }

    fn program_id(&self) -> Pubkey {
        // Tax Program ID (the program Jupiter calls for swaps)
        addresses::TAX_PROGRAM_ID
    }

    fn key(&self) -> Pubkey {
        self.key
    }

    fn get_reserve_mints(&self) -> Vec<Pubkey> {
        if self.is_crime {
            vec![addresses::NATIVE_MINT, addresses::CRIME_MINT]
        } else {
            vec![addresses::NATIVE_MINT, addresses::FRAUD_MINT]
        }
    }

    fn get_accounts_to_update(&self) -> Vec<Pubkey> {
        vec![
            self.key,                    // PoolState (reserves change)
            addresses::EPOCH_STATE_PDA,  // EpochState (tax rates change)
        ]
    }

    fn update(&mut self, account_map: &AccountMap) -> Result<()> {
        // Parse PoolState reserves from account_map
        let pool_data = try_get_account_data(account_map, &self.key)?;
        self.reserve_sol = u64::from_le_bytes(pool_data[137..145].try_into()?);
        self.reserve_token = u64::from_le_bytes(pool_data[145..153].try_into()?);
        // Parse EpochState tax rates
        let epoch_data = try_get_account_data(account_map, &addresses::EPOCH_STATE_PDA)?;
        // ... parse tax bps from known offsets
        Ok(())
    }

    fn quote(&self, params: &QuoteParams) -> Result<Quote> {
        // Determine direction and apply correct tax flow
        // ... (see Pattern 2 above)
        todo!()
    }

    fn get_swap_and_account_metas(&self, params: &SwapParams) -> Result<SwapAndAccountMetas> {
        // Build complete AccountMeta list for Tax Program swap instruction
        // ... (see Pattern 5 above)
        todo!()
    }

    fn supports_exact_out(&self) -> bool { false }
}
```

### Raw EpochState Parsing
```rust
// Source: programs/tax-program/src/state/epoch_state_reader.rs byte offsets
pub struct ParsedEpochState {
    pub crime_buy_tax_bps: u16,
    pub crime_sell_tax_bps: u16,
    pub fraud_buy_tax_bps: u16,
    pub fraud_sell_tax_bps: u16,
}

impl ParsedEpochState {
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        // Validate minimum length: 8 (disc) + 164 (data) = 172
        anyhow::ensure!(data.len() >= 172, "EpochState data too short");
        // Validate Anchor discriminator (sha256("account:EpochState")[0..8])
        // ... discriminator check ...
        Ok(Self {
            crime_buy_tax_bps: u16::from_le_bytes(data[33..35].try_into()?),
            crime_sell_tax_bps: u16::from_le_bytes(data[35..37].try_into()?),
            fraud_buy_tax_bps: u16::from_le_bytes(data[37..39].try_into()?),
            fraud_sell_tax_bps: u16::from_le_bytes(data[39..41].try_into()?),
        })
    }

    pub fn get_tax_bps(&self, is_crime: bool, is_buy: bool) -> u16 {
        match (is_crime, is_buy) {
            (true, true) => self.crime_buy_tax_bps,
            (true, false) => self.crime_sell_tax_bps,
            (false, true) => self.fraud_buy_tax_bps,
            (false, false) => self.fraud_sell_tax_bps,
        }
    }
}
```

### SwapSolBuy Account Metas (23 named + 8 remaining)
```rust
// Source: programs/tax-program/src/instructions/swap_sol_buy.rs SwapSolBuy struct
fn build_buy_account_metas(
    user: &Pubkey,
    source_token_account: &Pubkey,    // user WSOL ATA
    destination_token_account: &Pubkey, // user CRIME/FRAUD ATA
    is_crime: bool,
) -> Vec<AccountMeta> {
    let pool = if is_crime { &CRIME_SOL_POOL } else { &FRAUD_SOL_POOL };
    let pool_vault_a = if is_crime { &CRIME_SOL_VAULT_A } else { &FRAUD_SOL_VAULT_A };
    let pool_vault_b = if is_crime { &CRIME_SOL_VAULT_B } else { &FRAUD_SOL_VAULT_B };
    let mint_b = if is_crime { &CRIME_MINT } else { &FRAUD_MINT };

    vec![
        // SwapSolBuy struct order (21 named accounts):
        AccountMeta::new(*user, true),                          // user (signer, mut)
        AccountMeta::new_readonly(EPOCH_STATE_PDA, false),      // epoch_state
        AccountMeta::new_readonly(SWAP_AUTHORITY_PDA, false),   // swap_authority
        AccountMeta::new_readonly(TAX_AUTHORITY_PDA, false),    // tax_authority
        AccountMeta::new(*pool, false),                         // pool
        AccountMeta::new(*pool_vault_a, false),                 // pool_vault_a
        AccountMeta::new(*pool_vault_b, false),                 // pool_vault_b
        AccountMeta::new_readonly(NATIVE_MINT, false),          // mint_a (WSOL)
        AccountMeta::new_readonly(*mint_b, false),              // mint_b (CRIME/FRAUD)
        AccountMeta::new(*source_token_account, false),         // user_token_a (WSOL)
        AccountMeta::new(*destination_token_account, false),    // user_token_b (CRIME/FRAUD)
        AccountMeta::new(STAKE_POOL_PDA, false),                // stake_pool
        AccountMeta::new(STAKING_ESCROW_PDA, false),            // staking_escrow
        AccountMeta::new(CARNAGE_SOL_VAULT_PDA, false),         // carnage_vault
        AccountMeta::new(TREASURY, false),                      // treasury
        AccountMeta::new_readonly(AMM_PROGRAM_ID, false),       // amm_program
        AccountMeta::new_readonly(SPL_TOKEN_PROGRAM, false),    // token_program_a
        AccountMeta::new_readonly(TOKEN_2022_PROGRAM, false),   // token_program_b
        AccountMeta::new_readonly(SYSTEM_PROGRAM, false),       // system_program
        AccountMeta::new_readonly(STAKING_PROGRAM_ID, false),   // staking_program
        // Transfer hook remaining accounts (4 per hooked mint):
        // Buy (AtoB): input=A(SOL/SPL), output=B(token/T22)
        // SOL (SPL Token) has no transfer hooks, so only output mint hooks
        // But AMM expects hooks for BOTH sides -- SOL side passes empty/padding
        // ... hook accounts per established pattern
    ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jupiter-amm-interface 0.4.x (solana-sdk 1.x) | v0.5.0 (solana-sdk >=2.1) | 2024 | Project uses solana-sdk 2.2, so v0.5.0 is required |
| v0.5.0 (solana-sdk 2.x) | v0.6.1 (solana-pubkey 4.0, Solana v3/v4 split) | Early 2026 | NOT compatible with project. Pin to 0.5.0. |
| Quote struct: no min fields | Quote has min_in_amount, min_out_amount (Optional) | v0.5.0 | Set to None for standard ExactIn quotes |
| update() takes &AccountMap | Same in v0.5.0 | -- | HashMap<Pubkey, Account, ahash::RandomState> |

**Deprecated/outdated:**
- `jupiter-amm-interface 0.4.x`: Uses `solana-sdk < 2.1.0`. Incompatible with project's 2.2.
- `jupiter-amm-interface 0.6.1`: Uses `solana-pubkey 4.0`. Incompatible with project's 2.2.

## Jupiter Integration Process

Based on official docs and the DEX integration guide:

1. **Build SDK crate** implementing `Amm` trait (this phase)
2. **Publish to crates.io** as `drfraudsworth-jupiter-adapter`
3. **Publish IDLs** to public GitHub repo (github.com/MetalLegBob/drfraudsworth)
4. **Submit to Jupiter team** for review:
   - SDK must be forkable (Jupiter maintains their own copy)
   - Pass security audit requirements
   - Demonstrate traction (trading volume)
5. **Jupiter adds Swap variant** to their enum (e.g., `DrFraudsworthBuy`, `DrFraudsworthSell`, `DrFraudsworthVaultConvert`)
6. **Jupiter adds to `PROGRAM_ID_TO_AMM_LABEL_WITH_AMM_FROM_KEYED_ACCOUNT`** mapping
7. **Jupiter tests integration** with their snapshot testing framework

**Critical constraint from Jupiter docs:** "There might be multiple calls to quote using the same cache so we do not allow any network calls in the entire implementation."

## Swap Variant Strategy

The `Swap` enum in `jupiter-amm-interface` is a closed enum maintained by Jupiter. New DEX integrations require Jupiter to add variants. Based on the existing patterns (e.g., `MoonshotWrappedBuy`/`MoonshotWrappedSell`, `PumpdotfunWrappedBuy`/`PumpdotfunWrappedSell`), Dr. Fraudsworth would likely need:

- For SOL pools: The adapter can use existing patterns since the Tax Program is the "program that Jupiter calls" -- it wraps the AMM swap with tax.
- For vault conversions: A separate variant since the instruction format differs.

In the `get_swap_and_account_metas()` return, we use a placeholder Swap variant. Jupiter's team replaces it with the real variant during integration. For now, use `Swap::TokenSwap` as a development placeholder (it has the right AccountMeta-only shape) -- Jupiter's team will assign the real variant.

## Account Counts

### SwapSolBuy (Tax Program)
21 named accounts + 4-8 remaining (transfer hooks):
1. user (signer, mut)
2. epoch_state
3. swap_authority
4. tax_authority
5. pool (mut)
6. pool_vault_a (mut)
7. pool_vault_b (mut)
8. mint_a (WSOL)
9. mint_b (CRIME/FRAUD)
10. user_token_a (WSOL ATA, mut)
11. user_token_b (token ATA, mut)
12. stake_pool (mut)
13. staking_escrow (mut)
14. carnage_vault (mut)
15. treasury (mut)
16. amm_program
17. token_program_a (SPL Token)
18. token_program_b (Token-2022)
19. system_program
20. staking_program
+ remaining: 4 per hooked mint (SOL is SPL Token = no hooks, token side = 4 hooks)

### SwapSolSell (Tax Program)
22 named accounts + 4-8 remaining (transfer hooks):
Same as buy + wsol_intermediary (between treasury and amm_program in struct order)

### Convert / ConvertV2 (Conversion Vault)
9 named accounts + 8 remaining (transfer hooks for both mints):
1. user (signer)
2. vault_config
3. user_input_account (mut)
4. user_output_account (mut)
5. input_mint
6. output_mint
7. vault_input (mut)
8. vault_output (mut)
9. token_program (Token-2022)
+ remaining: 4 input hooks + 4 output hooks = 8

## Mainnet Addresses (from deployments/mainnet.json)

All addresses that must be hardcoded in the SDK:

**Programs:**
- AMM: `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR`
- Transfer Hook: `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd`
- Tax Program: `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj`
- Epoch Program: `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2`
- Staking: `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH`
- Conversion Vault: `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ`

**Mints:**
- CRIME: `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc`
- FRAUD: `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5`
- PROFIT: `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR`
- NATIVE_MINT (WSOL): `So11111111111111111111111111111111111111112`

**PDAs:**
- Epoch State: `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU`
- Swap Authority: `CoCdbornGtiZ8tLxF5HD2TdGidfgfwbbiDX79BaZGJ2D`
- Tax Authority: `8zijSBnoiGQzwccQkdNuAwbZCieDZsxdn2GgKDErCemQ`
- Stake Pool: `5BdRPPwEDpHEtRgdp4MfywbwmZnrf6u23bXMnG1w8ViN`
- Escrow Vault: `E68zPDgzMqnycj23g9T74ioHbDdvq3Npj5tT2yPd1SY`
- Carnage SOL Vault: `5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT`
- Treasury: `3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv`
- WSOL Intermediary: derived from seeds ["wsol_intermediary"] + Tax Program ID
- Vault Config: `8vFpSBnCVt8dfX57FKrsGwy39TEo1TjVzrj9QYGxCkcD`
- Vault CRIME: `Gh9QHMY3J2NGyaHFH2XQCWxedf4G7kBfyu7Jonwn1bHA`
- Vault FRAUD: `DLciB9t3qEuRcndGyjRmu1Z34NCwTPvNwbv7eUsFxTZG`
- Vault PROFIT: `DBMaWgfUW8WBb8VVvqDFkrMpEkPkCPTcLpSpyzHAiwp3`
- Whitelist Authority: `J3cjg1HFPda9tfCFEUx1vqKqmeDeda8s76RVweLeYpJe`

**Pools:**
- CRIME/SOL Pool: `ZWUZ3PzGk6bg6g3BS3WdXKbdAecUgZxnruKXQkte7wf`
- CRIME/SOL Vault A: `14rFLiXzXk7aXLnwAz2kwQUjG9vauS84AQLu6LH9idUM`
- CRIME/SOL Vault B: `6s6cprCGxTAYCk9LiwCpCsdHzReW7CLZKqy3ZSCtmV1b`
- FRAUD/SOL Pool: `AngvViTVGd2zxP8KoFUjGU3TyrQjqeM1idRWiKM8p3mq`
- FRAUD/SOL Vault A: `3sUDyw1k61NSKgn2EA9CaS3FbSZAApGeCRNwNFQPwg8o`
- FRAUD/SOL Vault B: `2nzqXn6FivXjPSgrUGTA58eeVUDjGhvn4QLfhXK1jbjP`

**Hook Accounts (ExtraAccountMetaList PDAs):**
- CRIME: `CStTzemevJvk8vnjw57Wjzk5EFwN12Nmniz6R7qXWykr`
- FRAUD: `7QGodnZAYGgastQMXcitcQjraYCMMNDgbp2uL73qjGkd`
- PROFIT: `J4dubfKw7vnZLhpPfMHqz8PcYWaChugnnSGUgGDzQ9AB`

**Standard Programs:**
- SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Token-2022: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- System: `11111111111111111111111111111111`

## Open Questions

1. **Swap Variant Assignment**
   - What we know: Jupiter's Swap enum is closed. New DEXes need variants added by Jupiter's team.
   - What's unclear: What placeholder to use during development. Options: `Swap::TokenSwap` (simple, no extra fields) or a dummy variant.
   - Recommendation: Use `Swap::TokenSwap` as placeholder in development/tests. Document that Jupiter will assign real variant(s) during integration review. The `get_swap_and_account_metas()` return value's `swap` field is only used by Jupiter's on-chain program routing, not by the SDK itself.

2. **Vault Amm Instance Keying**
   - What we know: 3 vault instances share one VaultConfig PDA. Jupiter needs unique `key()` per Amm.
   - What's unclear: Whether Jupiter supports params-based differentiation or needs truly unique keys.
   - Recommendation: Derive synthetic keys via `Pubkey::find_program_address(&[b"jup_vault", input_mint, output_mint], &VAULT_PROGRAM_ID)`. These are deterministic, unique per pair, and don't need to be real on-chain accounts. Jupiter's `from_keyed_account` receives the `KeyedAccount` which includes `.key` -- use `params` to pass the mint pair if synthetic keys aren't viable.

3. **CRIME<->FRAUD Vault Conversion**
   - What we know: CONTEXT.md says 3 vault Amm instances including CRIME<->FRAUD at 1:1.
   - What's unclear: The on-chain `compute_output_with_mints` does NOT handle CRIME<->FRAUD -- it only handles `*<->PROFIT` pairs and returns `InvalidMintPair` for CRIME<->FRAUD.
   - Recommendation: Verify whether Phase 106 (convert_v2) adds CRIME<->FRAUD support. If not, check if there's a separate on-chain path. **This must be validated at phase start.** If CRIME<->FRAUD conversion doesn't exist on-chain, the SDK cannot route it.

4. **Transfer Hook Accounts for SOL (SPL Token) Side**
   - What we know: SOL uses SPL Token (not Token-2022), so it has no transfer hooks.
   - What's unclear: Does the AMM still expect hook remaining_accounts for the SPL Token side? Per HOOK_ACCOUNTS_PER_MINT=4, the AMM partitions remaining_accounts at midpoint.
   - Recommendation: Review the AMM swap code to determine if SPL Token side passes empty/zero hooks or skips them entirely. The project memory says "Hook accounts per mint = 4" -- this may mean 4 accounts for the Token-2022 side only, with the AMM detecting SPL Token mints and skipping hooks for them.

5. **Jupiter Version Migration Timeline**
   - What we know: v0.5.0 works now. v0.6.1 requires Solana v3/v4 crate architecture.
   - What's unclear: When Jupiter will deprecate v0.5.0 support. When the project will upgrade to Solana v3/v4.
   - Recommendation: Build against v0.5.0 now. The Amm trait interface is very similar between versions -- migration to v0.6.1 later is a dependency version bump, not a rewrite.

## Sources

### Primary (HIGH confidence)
- `jupiter-amm-interface v0.5.0 Cargo.toml` via [docs.rs source](https://docs.rs/crate/jupiter-amm-interface/0.5.0/source/Cargo.toml) -- confirmed solana-sdk >=2.1
- `jupiter-amm-interface v0.6.1 Cargo.toml` via [raw GitHub](https://raw.githubusercontent.com/jup-ag/jupiter-amm-interface/main/Cargo.toml) -- confirmed solana-pubkey 4.0
- `jupiter-amm-interface v0.5.0 lib.rs` via [docs.rs source](https://docs.rs/crate/jupiter-amm-interface/0.5.0/source/src/lib.rs) -- Amm trait, Quote, SwapParams definitions
- `jupiter-amm-interface v0.5.0 swap.rs` via [docs.rs source](https://docs.rs/crate/jupiter-amm-interface/0.5.0/source/src/swap.rs) -- 69 Swap variants (closed enum)
- On-chain source: `programs/amm/src/helpers/math.rs` -- pure swap math to copy
- On-chain source: `programs/tax-program/src/helpers/tax_math.rs` -- tax calculation to copy
- On-chain source: `programs/tax-program/src/helpers/pool_reader.rs` -- PoolState byte offsets
- On-chain source: `programs/tax-program/src/state/epoch_state_reader.rs` -- EpochState layout
- On-chain source: `programs/conversion-vault/src/instructions/convert.rs` -- vault conversion logic
- On-chain source: `programs/tax-program/src/instructions/swap_sol_buy.rs` -- buy account struct (21 accounts)
- On-chain source: `programs/tax-program/src/instructions/swap_sol_sell.rs` -- sell account struct (22 accounts)
- `deployments/mainnet.json` -- all mainnet addresses

### Secondary (MEDIUM confidence)
- [Jupiter DEX Integration Guide](https://dev.jup.ag/docs/routing/dex-integration.md) -- integration requirements and process
- [Jupiter rust-amm-implementation README](https://github.com/jup-ag/rust-amm-implementation/blob/main/README.md) -- reference implementation guidance
- [DeepWiki jupiter-amm-interface](https://deepwiki.com/jup-ag/jupiter-amm-interface) -- architecture overview

### Tertiary (LOW confidence)
- [Swap variant proposal](https://discuss.jup.ag/t/proposal-add-a-generic-passthrough-swap-variant-for-custom-amm-execution/40039) -- community proposal for generic passthrough (not yet implemented)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- jupiter-amm-interface version compatibility verified against actual Cargo.toml sources, solana-sdk version confirmed matching
- Architecture: HIGH -- based on existing on-chain code (byte offsets, math functions, account structs all verified from source)
- Pitfalls: HIGH -- drawn from project's documented issues (canonical ordering, hook accounts, sell vs buy tax) plus verified version incompatibility
- Jupiter process: MEDIUM -- based on official docs but submission details may vary

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (jupiter-amm-interface versions are stable; the v0.5.0 pin is the critical finding)
