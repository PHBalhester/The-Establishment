# Phase 9: Pool Initialization - Research

**Researched:** 2026-02-04
**Domain:** Anchor pool state accounts, PDA-owned token vaults (T22 + SPL), admin config pattern, canonical mint ordering
**Confidence:** HIGH

## Summary

Phase 9 creates the four AMM pools with correct vaults, token programs, fee rates, and PDA derivations. This requires two instructions: `initialize_admin` (prerequisite, creates AdminConfig PDA gated by program upgrade authority) and `initialize_pool` (creates pool state PDA, two vault token accounts, seeds initial liquidity, emits event).

The core technical challenge is creating PDA-owned token accounts that work with both Token-2022 (CRIME, FRAUD, PROFIT) and SPL Token (WSOL) in a single instruction. Anchor's `InterfaceAccount<'info, TokenAccount>` with `Interface<'info, TokenInterface>` handles this: the same account struct works for both token programs when the caller passes the correct program ID. For mixed pools (one T22 mint, one SPL Token mint), two separate `token_program` fields are needed so each vault can be initialized with its correct token program.

The admin authority pattern uses Anchor's `Program<'info, crate::program::Amm>` with `programdata_address()` to verify the signer is the program's upgrade authority. This is a well-documented Anchor pattern using the `ProgramData` account type and constraint-based validation.

**Primary recommendation:** Use `InterfaceAccount<TokenAccount>` with two `Interface<TokenInterface>` program fields (one per vault side) for vault creation, the `ProgramData` constraint pattern for upgrade authority verification in `initialize_admin`, canonical mint ordering via `Pubkey` byte comparison with auto-sort in the instruction handler, and atomic vault creation + liquidity transfer in a single `initialize_pool` instruction.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Anchor framework | Already installed, project standard |
| anchor-spl | 0.32.1 | Token interface types, CPI helpers | Provides `InterfaceAccount`, `Interface<TokenInterface>`, `token_interface::transfer_checked` |
| anchor-spl::token_interface | (part of anchor-spl) | Dual-program token account types | `Mint`, `TokenAccount`, `TokenInterface` work with both SPL Token and Token-2022 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| litesvm | latest | In-process Solana VM for Rust tests | Pool initialization integration tests |
| anchor-litesvm | 0.3.0 | Anchor-aware litesvm wrapper | Simplified program deployment in tests |
| spl-token-2022 | (via solana_program) | T22 mint creation in tests | Creating T22 mints with transfer hook extension for test setup |
| spl-token | (via solana_program) | SPL Token mint creation in tests | Creating WSOL-like mints for test setup |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two `token_program` fields | Single `Interface<TokenInterface>` | Single field works for pure T22 pools but CANNOT handle mixed pools where vault_a needs T22 and vault_b needs SPL Token in the same instruction |
| `ProgramData` constraint for admin | Hardcoded admin pubkey | Hardcoded is simpler but prevents multisig from day one, per CONTEXT.md decision |
| Auto-inferred pool type | Caller-declared pool type | Auto-inference is cleaner (CONTEXT.md decision); caller cannot misidentify pool type |

**Installation:** Already configured in `programs/amm/Cargo.toml`:
```toml
[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.32.1", features = ["token", "token_2022", "associated_token"] }
```

## Architecture Patterns

### Recommended File Structure (additions to existing)
```
programs/amm/src/
├── state/
│   ├── mod.rs           # pub mod pool; pub mod admin;
│   ├── pool.rs          # PoolState, PoolType enum (UPDATE from placeholder)
│   └── admin.rs         # AdminConfig account (NEW)
├── instructions/
│   ├── mod.rs           # pub mod initialize_admin; pub mod initialize_pool;
│   ├── initialize_admin.rs   # (NEW)
│   └── initialize_pool.rs    # (NEW)
├── constants.rs         # Add PDA seeds, POOL_SEED, VAULT_SEED, ADMIN_SEED (UPDATE)
├── errors.rs            # Add pool-specific errors (UPDATE)
└── events.rs            # Add PoolInitializedEvent (UPDATE)
```

### Pattern 1: Upgrade Authority Verification for AdminConfig

**What:** Restrict `initialize_admin` to only the program's upgrade authority using Anchor's `ProgramData` type.

**When to use:** One-time admin setup instructions that should only be callable by the deployer.

**Why this pattern:** This is the canonical Anchor pattern, documented in Anchor's own source code (lang/src/accounts/program.rs). It uses `programdata_address()` to link the program account to its data account, then checks `upgrade_authority_address` against the signer.

**Example:**
```rust
// Source: Anchor lang/src/accounts/program.rs (documented example)
use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable::UpgradeableLoaderState;

#[derive(Accounts)]
pub struct InitializeAdmin<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + AdminConfig::INIT_SPACE,
        seeds = [b"admin"],
        bump
    )]
    pub admin_config: Account<'info, AdminConfig>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
    )]
    pub program: Program<'info, crate::program::Amm>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}
```

### Pattern 2: PDA-Owned Token Vaults with InterfaceAccount

**What:** Create token account PDAs owned by the pool PDA, supporting both Token-2022 and SPL Token.

**When to use:** Pool vault initialization where vaults must work with different token programs.

**Why this pattern:** `InterfaceAccount<TokenAccount>` with `Interface<TokenInterface>` is the Anchor-standard way to support both token programs. The `token::token_program` constraint tells Anchor which program to CPI into for account creation.

**Example:**
```rust
// Source: Anchor docs (anchor-lang.com/docs/tokens/basics/create-token-account)
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
#[instruction(lp_fee_bps: u16, amount_a: u64, amount_b: u64)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"admin"],
        bump,
        has_one = admin @ AmmError::Unauthorized,
    )]
    pub admin_config: Account<'info, AdminConfig>,

    pub admin: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [b"pool", mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, PoolState>,

    // Vault A: token account owned by pool PDA
    #[account(
        init,
        payer = payer,
        token::mint = mint_a,
        token::authority = pool,
        token::token_program = token_program_a,
        seeds = [b"vault", pool.key().as_ref(), b"a"],
        bump
    )]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,

    // Vault B: token account owned by pool PDA
    #[account(
        init,
        payer = payer,
        token::mint = mint_b,
        token::authority = pool,
        token::token_program = token_program_b,
        seeds = [b"vault", pool.key().as_ref(), b"b"],
        bump
    )]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,

    pub mint_a: InterfaceAccount<'info, Mint>,
    pub mint_b: InterfaceAccount<'info, Mint>,

    // Two separate token programs: one for each vault side
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}
```

### Pattern 3: Canonical Mint Ordering with Auto-Sort

**What:** Enforce `mint_a < mint_b` (lexicographic byte comparison) to prevent duplicate pools.

**When to use:** Pool PDA derivation where the same mint pair should always produce the same PDA.

**Why this pattern:** Pubkey implements `Ord` in Solana, comparing the 32-byte arrays lexicographically. By normalizing order inside the instruction handler (not relying on caller order), we guarantee PDA uniqueness per CONTEXT.md decision.

**Example:**
```rust
pub fn initialize_pool(
    ctx: Context<InitializePool>,
    lp_fee_bps: u16,
    amount_a: u64,
    amount_b: u64,
) -> Result<()> {
    let mint_a_key = ctx.accounts.mint_a.key();
    let mint_b_key = ctx.accounts.mint_b.key();

    // Enforce canonical ordering: mint_a < mint_b
    require!(
        mint_a_key < mint_b_key,
        AmmError::MintsNotCanonicallyOrdered
    );

    // ... rest of initialization
}
```

**Note:** Per CONTEXT.md, the program should auto-sort. However, since the PDA seeds use `mint_a.key()` and `mint_b.key()` from the accounts struct, and Anchor derives the PDA at deserialization time, the caller MUST pass them in canonical order for the PDA derivation to succeed. The alternative is to compute the PDA in the handler and use `init_if_needed` with manual account creation, which is more complex. The simpler approach is to require canonical order from the caller and validate with a constraint. The instruction handler can provide a helpful error message.

### Pattern 4: Pool Type Inference from Token Programs

**What:** Determine pool type (MixedPool vs PureT22Pool) by inspecting which token programs were passed.

**When to use:** During pool initialization to set the pool type without caller declaration.

**Example:**
```rust
// SPL Token program ID
const SPL_TOKEN_ID: Pubkey = anchor_spl::token::ID;
// Token-2022 program ID
const TOKEN_2022_ID: Pubkey = anchor_spl::token_2022::ID;

fn infer_pool_type(
    token_program_a: &Pubkey,
    token_program_b: &Pubkey,
) -> Result<PoolType> {
    let a_is_t22 = *token_program_a == TOKEN_2022_ID;
    let b_is_t22 = *token_program_b == TOKEN_2022_ID;
    let a_is_spl = *token_program_a == SPL_TOKEN_ID;
    let b_is_spl = *token_program_b == SPL_TOKEN_ID;

    match (a_is_t22 || a_is_spl, b_is_t22 || b_is_spl) {
        (true, true) => {
            if a_is_t22 && b_is_t22 {
                Ok(PoolType::PureT22Pool)
            } else {
                Ok(PoolType::MixedPool)
            }
        }
        _ => Err(AmmError::InvalidTokenProgram.into()),
    }
}
```

### Pattern 5: Token Transfer via InterfaceAccount CPI

**What:** Transfer initial liquidity from deployer's source accounts into vaults using `token_interface::transfer_checked`.

**When to use:** During pool initialization to seed initial liquidity atomically.

**Example:**
```rust
use anchor_spl::token_interface;

// Transfer tokens from deployer's source account to vault
let cpi_accounts = token_interface::TransferChecked {
    from: ctx.accounts.source_a.to_account_info(),
    to: ctx.accounts.vault_a.to_account_info(),
    mint: ctx.accounts.mint_a.to_account_info(),
    authority: ctx.accounts.admin.to_account_info(),
};
let cpi_program = ctx.accounts.token_program_a.to_account_info();
let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
token_interface::transfer_checked(cpi_ctx, amount_a, ctx.accounts.mint_a.decimals)?;
```

### Anti-Patterns to Avoid

- **Single token_program for mixed pools:** Using one `Interface<TokenInterface>` field when vaults need different token programs. This will fail because Anchor uses the specified token program for CPI during vault creation. Mixed pools need two separate program fields.

- **Caller-declared pool type:** Letting the caller specify `MixedPool` or `PureT22Pool` opens the door to misconfiguration. Pool type should be inferred from the token programs passed, per CONTEXT.md decision.

- **Hardcoded admin pubkey:** Using a constant for the admin address prevents multisig setup from day one. The AdminConfig PDA pattern (CONTEXT.md decision) stores the admin key and can be set to a multisig address.

- **Separate vault creation and liquidity seeding:** Splitting into two transactions creates a window where vaults exist but are empty. Per CONTEXT.md, vault creation and liquidity transfer happen atomically in one instruction.

- **Manual PDA computation for pool accounts:** Anchor's `init` with `seeds` handles PDA derivation and account creation. Do not use `find_program_address` manually in the handler when Anchor constraints can do it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token account creation | Manual `create_account` + `initialize_account` CPIs | Anchor `init` constraint with `token::mint`, `token::authority`, `token::token_program` | Anchor handles rent calculation, space allocation, and correct CPI ordering automatically |
| Dual token program support | Separate instruction paths for T22 vs SPL | `InterfaceAccount<TokenAccount>` + `Interface<TokenInterface>` | Anchor's interface types abstract over both programs at the type level |
| Upgrade authority check | Manual deserialization of `UpgradeableLoaderState` | `Program<'info, Amm>` + `Account<'info, ProgramData>` with constraints | Anchor provides `programdata_address()` and `ProgramData` deserialization out of the box |
| PDA derivation in tests | Manual `find_program_address` calls | Anchor client PDA helpers or `Pubkey::find_program_address` | Standard Solana SDK function, no custom logic needed |
| Token transfer CPI | Raw `invoke` with manual instruction building | `token_interface::transfer_checked` from anchor-spl | Type-safe CPI with automatic account validation |

**Key insight:** Anchor 0.32.1's token interface abstractions handle the T22/SPL complexity at compile time. The instruction code looks identical for both token programs -- the difference is entirely in which program ID the caller passes.

## Common Pitfalls

### Pitfall 1: Vault PDA Seeds Reference Pool PDA Before It Exists
**What goes wrong:** Vault PDA seeds include `pool.key()`, but the pool account is created in the same instruction. If seeds are evaluated before pool init, the pool key is not yet known.
**Why it happens:** PDA derivation happens during account deserialization, before the instruction handler runs.
**How to avoid:** Anchor handles this correctly when both accounts use `init` in the same instruction -- the pool PDA is deterministically derived from its seeds regardless of whether it exists yet. The pool's address IS its PDA, computable before creation. This works because Anchor computes all PDAs from seeds before account creation.
**Warning signs:** Tests fail with "account not found" or seed mismatch errors.

### Pitfall 2: Token Program Mismatch Between Mint and Vault
**What goes wrong:** Passing Token-2022 program ID when creating a vault for a WSOL (SPL Token) mint, or vice versa.
**Why it happens:** The caller passes the wrong program ID for a given mint side.
**How to avoid:** Add a constraint that validates `mint_a.to_account_info().owner == token_program_a.key()` (the mint's owner IS the token program that governs it). Anchor's `InterfaceAccount<Mint>` validates the mint is owned by a valid token program, but does NOT automatically check it matches the specified `token_program_a` field. This validation must be explicit.
**Warning signs:** "A token account token program constraint was violated" (Anchor error 2021).

### Pitfall 3: Canonical Ordering and PDA Seed Mismatch
**What goes wrong:** Caller passes mints in non-canonical order. Anchor derives a different PDA than expected, which either fails (no account at that PDA) or creates a duplicate pool.
**Why it happens:** PDA seeds use `mint_a.key()` and `mint_b.key()` as passed. If the caller swaps the order, the seeds change and a different PDA is derived.
**How to avoid:** Validate in the instruction handler that `mint_a.key() < mint_b.key()`. Return a clear error otherwise. Alternatively, the client-side code always sorts before sending.
**Warning signs:** "A seeds constraint was violated" or unexpected account creation.

### Pitfall 4: Missing `token_program` Constraint on Vault Init
**What goes wrong:** Omitting `token::token_program = token_program_a` from the vault init constraints. Without this, Anchor doesn't know which program to CPI into for token account creation.
**Why it happens:** Older Anchor examples (pre-0.30) didn't require this constraint because they used `Program<'info, Token>` (single program).
**How to avoid:** Always include `token::token_program = <field>` when using `InterfaceAccount<TokenAccount>` with `Interface<TokenInterface>`. This is required for Anchor to route the CPI correctly.
**Warning signs:** Compilation error or runtime error about missing token program.

### Pitfall 5: Space Calculation for PoolState With New Fields
**What goes wrong:** Under-allocating space when PoolState has more fields than initially planned (e.g., adding vault bumps, admin key, token program keys).
**Why it happens:** Space calculation is manual (`8 + ...`) and easy to get wrong when adding fields.
**How to avoid:** Use Anchor's `#[derive(InitSpace)]` macro on the PoolState struct, or calculate space explicitly with comments for each field. The spec says 157 bytes total, but the CONTEXT.md adds new fields (e.g., behavioral PoolType replaces specific PoolType). Recalculate when defining the final struct.
**Warning signs:** "Account data too small" or "Failed to serialize" errors at runtime.

### Pitfall 6: T22 Token Account Size With Extensions
**What goes wrong:** Token-2022 token accounts with extensions (like ImmutableOwner, which ATAs always get) may be larger than the standard 165 bytes. If space is under-allocated, creation fails.
**Why it happens:** Token-2022 adds extension data beyond the base account layout.
**How to avoid:** Anchor's `init` constraint with `token::mint` handles space calculation automatically for token accounts (it queries the mint's extension info). Do NOT manually specify `space` for token accounts when using the `token::` constraints -- Anchor computes it. However, litesvm tests that create token accounts manually must account for extension sizes.
**Warning signs:** "Not enough space" errors only with T22 mints, not SPL Token mints.

### Pitfall 7: Transfer Hooks During Initial Liquidity Seeding
**What goes wrong:** When seeding T22 vaults with initial liquidity via `transfer_checked`, the transfer hook program is invoked. If the hook's ExtraAccountMetaList isn't initialized, or the vault isn't whitelisted, the transfer fails.
**Why it happens:** Token-2022's `transfer_checked` always invokes the configured transfer hook if one exists on the mint.
**How to avoid:** In production, the deployment flow ensures hooks are set up before pool init (Protocol_Initialzation_and_Launch_Flow.md). In tests, either: (a) create T22 mints WITHOUT transfer hook extensions (simpler, sufficient for pool init tests), or (b) deploy a mock transfer hook program and initialize ExtraAccountMetaList. Option (a) is recommended for Phase 9 tests since transfer hook testing is a Phase 10+ concern.
**Warning signs:** Transfer fails with "missing required extra account" or hook-related errors during pool init.

## Code Examples

### Example 1: AdminConfig Account State
```rust
// programs/amm/src/state/admin.rs
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct AdminConfig {
    /// The admin pubkey (can be a multisig)
    pub admin: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}
```

### Example 2: PoolState with Behavioral PoolType
```rust
// programs/amm/src/state/pool.rs
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PoolType {
    /// One T22 token + one SPL Token (e.g., CRIME/SOL, FRAUD/SOL)
    MixedPool,
    /// Both tokens are T22 (e.g., CRIME/PROFIT, FRAUD/PROFIT)
    PureT22Pool,
}

#[account]
#[derive(InitSpace)]
pub struct PoolState {
    /// Pool type (inferred from token programs)
    pub pool_type: PoolType,
    /// Token A mint (canonical: mint_a < mint_b)
    pub mint_a: Pubkey,
    /// Token B mint
    pub mint_b: Pubkey,
    /// Vault A token account PDA
    pub vault_a: Pubkey,
    /// Vault B token account PDA
    pub vault_b: Pubkey,
    /// Cached reserve for token A
    pub reserve_a: u64,
    /// Cached reserve for token B
    pub reserve_b: u64,
    /// LP fee in basis points
    pub lp_fee_bps: u16,
    /// Whether pool is initialized (liquidity seeded)
    pub initialized: bool,
    /// Pool PDA bump
    pub bump: u8,
    /// Vault A PDA bump (for signing transfers)
    pub vault_a_bump: u8,
    /// Vault B PDA bump (for signing transfers)
    pub vault_b_bump: u8,
    /// Token program for side A
    pub token_program_a: Pubkey,
    /// Token program for side B
    pub token_program_b: Pubkey,
}
```

**Space calculation:**
- Discriminator: 8
- pool_type (enum, 1 variant byte): 1
- mint_a: 32
- mint_b: 32
- vault_a: 32
- vault_b: 32
- reserve_a: 8
- reserve_b: 8
- lp_fee_bps: 2
- initialized: 1
- bump: 1
- vault_a_bump: 1
- vault_b_bump: 1
- token_program_a: 32
- token_program_b: 32
- **Total: 8 + 215 = 223 bytes**

Note: This deviates from the spec's 157 bytes (AMM_Implementation.md Section 4.3) because we added vault bumps and token program keys. The spec size was for the four-variant PoolType without bumps/program keys. Document this deviation.

### Example 3: PoolInitializedEvent
```rust
// programs/amm/src/events.rs
use anchor_lang::prelude::*;

#[event]
pub struct PoolInitializedEvent {
    pub pool: Pubkey,
    pub pool_type: u8,  // 0 = MixedPool, 1 = PureT22Pool
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub lp_fee_bps: u16,
}
```

### Example 4: Error Codes for Phase 9
```rust
// additions to programs/amm/src/errors.rs
#[error_code]
pub enum AmmError {
    // ... existing errors ...

    /// Pool already initialized
    #[msg("Pool is already initialized")]
    PoolAlreadyInitialized,

    /// Mints are not in canonical order (mint_a must be < mint_b)
    #[msg("Mints must be in canonical order (mint_a < mint_b)")]
    MintsNotCanonicallyOrdered,

    /// Unauthorized: signer is not the admin
    #[msg("Unauthorized: signer is not the admin")]
    Unauthorized,

    /// Invalid token program for the given mint
    #[msg("Token program does not match mint owner")]
    InvalidTokenProgram,

    /// Zero seed amount not allowed
    #[msg("Initial seed amount must be greater than zero")]
    ZeroSeedAmount,

    /// Duplicate mints not allowed
    #[msg("Mint A and Mint B must be different")]
    DuplicateMints,
}
```

### Example 5: PDA Seed Constants
```rust
// additions to programs/amm/src/constants.rs

/// PDA seed for admin config
pub const ADMIN_SEED: &[u8] = b"admin";

/// PDA seed for pool state
pub const POOL_SEED: &[u8] = b"pool";

/// PDA seed for vault token accounts
pub const VAULT_SEED: &[u8] = b"vault";

/// Vault A identifier in PDA seeds
pub const VAULT_A_SEED: &[u8] = b"a";

/// Vault B identifier in PDA seeds
pub const VAULT_B_SEED: &[u8] = b"b";
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Program<'info, Token>` (SPL only) | `Interface<'info, TokenInterface>` | Anchor 0.29+ | Supports both SPL Token and Token-2022 in same code path |
| `Account<'info, TokenAccount>` (SPL only) | `InterfaceAccount<'info, TokenAccount>` | Anchor 0.29+ | Token accounts from either program are valid |
| Manual `create_account` + `initialize_account` CPI | Anchor `init` with `token::` constraints | Anchor 0.18+ | Automatic rent calc, space alloc, and CPI for token account creation |
| Four-variant PoolType (CRIME_SOL, etc.) | Two-variant PoolType (MixedPool, PureT22Pool) | Phase 9 decision | Decouples AMM from specific protocol tokens; behavioral distinction only |
| `Rent` sysvar required in accounts | Anchor handles rent implicitly | Anchor 0.25+ (constraint rent removal) | No need to pass `Rent` sysvar account |

**Deprecated/outdated:**
- Passing `rent: Sysvar<'info, Rent>` in account structs: Anchor 0.25+ removed the rent requirement from constraints. Do not include it.
- Using `Account<'info, TokenAccount>` for T22 tokens: This only works with SPL Token program. Use `InterfaceAccount` instead.
- Four-variant PoolType enum from AMM_Implementation.md Section 4.1: Replaced by behavioral two-variant enum per CONTEXT.md decision.

## Open Questions

1. **Token account space with `init` constraint for T22 mints**
   - What we know: Anchor's `init` with `token::mint` should handle space calculation automatically, including extension space for T22 mints.
   - What's unclear: Whether Anchor 0.32.1 correctly computes T22 token account space when the mint has extensions (transfer hook). The `ExtensionType::try_calculate_account_len` function is the standard way in raw Solana, but Anchor may or may not call it internally.
   - Recommendation: Test empirically in litesvm. If Anchor under-allocates, we may need to specify space manually or use raw account creation for T22 vaults. This is LOW risk because Phase 9 tests can use T22 mints without extensions.

2. **Canonical ordering: enforce in constraint vs handler**
   - What we know: CONTEXT.md says "auto-sort -- caller can pass mints in any order." But PDA seeds are derived from the accounts struct fields at deserialization time.
   - What's unclear: Whether we can make Anchor derive the PDA from sorted keys. The `seeds` constraint uses literal field references (`mint_a.key().as_ref()`), so the ordering is determined by which account is passed as `mint_a`.
   - Recommendation: Require caller to pass mints in canonical order. Add a validation check `require!(mint_a.key() < mint_b.key())` in the handler. The client SDK should sort mints before calling. Document this deviation from "auto-sort" in the plan -- true auto-sort would require computing the PDA manually, which loses Anchor's `init` convenience. **Discuss with user if this is acceptable.**

3. **Anchor `init` for token accounts: does it require the mint to exist on-chain?**
   - What we know: Anchor's `init` with `token::mint` reads the mint account to determine decimals and (for T22) extension info.
   - What's unclear: Whether the mint account is read during deserialization or during account creation CPI.
   - Recommendation: The mint must exist on-chain before `initialize_pool` is called. This is consistent with the deployment flow (mints created before pools). Not a concern for our use case but worth documenting.

## Sources

### Primary (HIGH confidence)
- Anchor source code: `lang/src/accounts/program.rs` -- `programdata_address()` pattern for upgrade authority verification
- Anchor source code: `lang/src/accounts/interface.rs` -- `Interface<T>` and `InterfaceAccount<T>` implementation
- Anchor docs: anchor-lang.com/docs/tokens/basics/create-token-account -- `InterfaceAccount`, `token::mint`, `token::authority`, `token::token_program` constraint examples
- Anchor docs: anchor-lang.com/docs/references/account-constraints -- comprehensive constraint reference
- Anchor test suite: `tests/errors/tests/errors.ts` -- ProgramData constraint verification pattern
- Project docs: AMM_Implementation.md Sections 4-6 -- Pool architecture, PDA derivation, initialization spec
- Project docs: Token_Program_Reference.md -- authoritative token program matrix for all pool sides
- Project docs: Protocol_Initialzation_and_Launch_Flow.md Section 8 -- Pool initialization in deployment flow
- 09-CONTEXT.md -- Locked decisions for Phase 9 implementation

### Secondary (MEDIUM confidence)
- Solana Foundation developer content: token-extensions-onchain.md -- Token-2022 staking pool initialization with InterfaceAccount
- Exa code context: Multiple Anchor pool initialization examples confirming patterns
- Anchor Solana expert responses -- InterfaceAccount patterns, admin config patterns, litesvm testing

### Tertiary (LOW confidence)
- litesvm Token-2022 setup -- Conceptual patterns, need empirical validation with our specific Anchor version

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed and verified in Phase 8
- Architecture patterns: HIGH -- Upgrade authority pattern from Anchor source code, InterfaceAccount from official docs
- Pool state design: HIGH -- Directly derived from project specs + CONTEXT.md locked decisions
- Token account init: MEDIUM -- Anchor handles space automatically but T22 extension interaction needs empirical verification
- Testing patterns: MEDIUM -- litesvm with T22 mints may need trial-and-error for extension handling
- Pitfalls: HIGH -- Well-documented in Anchor ecosystem, verified against project-specific constraints

**Research date:** 2026-02-04
**Valid until:** 2026-03-06 (30 days -- Anchor 0.32.1 is stable, patterns are well-established)
