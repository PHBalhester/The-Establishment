# Phase 2: Token Program Audit - Research

**Researched:** 2026-02-01
**Domain:** Solana Token Programs (SPL Token vs Token-2022), Transfer Hooks, ATA Derivation
**Confidence:** HIGH

## Summary

This research addresses the v3 failure root cause: token program assumptions were not explicitly validated. The Dr. Fraudsworth protocol has 4 liquidity pools with mixed token programs - the SOL pools (IPA/SOL, IPB/SOL) pair Token-2022 tokens with SPL Token (WSOL), while OP4 pools (IPA/OP4, IPB/OP4) are pure Token-2022.

The key technical finding is that **WSOL uses the original SPL Token program, NOT Token-2022**. This creates "mixed program pools" where transfer hooks only fire on the Token-2022 side (IPA, IPB, OP4), leaving WSOL transfers unprotected by the whitelist enforcement mechanism. Additionally, ATA derivation differs between programs - the token program ID is part of the PDA seeds.

**Primary recommendation:** Create a comprehensive token program matrix documenting every pool side, its token program, hook coverage, and ATA derivation method. Document the security implications of unhooked WSOL transfers explicitly in specs.

## Standard Stack

### Core Programs

| Program | Address | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SPL Token Program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Original token program, used by WSOL | Battle-tested since 2020, no extensions |
| Token-2022 Program | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Extended token program with hooks | Required for transfer hook functionality |
| Associated Token Program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | Derives deterministic ATAs | Single program serves both token programs |

### Key Constants

| Constant | Value | Notes |
|----------|-------|-------|
| WSOL Native Mint | `So11111111111111111111111111111111111111112` | Fixed address, SPL Token program |
| SPL Token Account Size | 165 bytes | Base account without extensions |
| Token-2022 Account Size | 165+ bytes | Base + extension data after byte 165 |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `spl-token-2022` | Latest | Instruction builders, state parsing | All token operations |
| `spl-transfer-hook-interface` | Latest | Hook implementation helpers | Implementing transfer hooks |
| `spl-associated-token-account` | Latest | ATA derivation | Creating/finding token accounts |

## Architecture Patterns

### Token Program Matrix Pattern

For each pool, document both sides with explicit token program assignment:

```
Pool: IPA/SOL
├── Side A (IPA): Token-2022 + Transfer Hook
│   ├── Mint: <IPA_MINT>
│   ├── Program: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
│   ├── Hook: Yes (whitelist enforcement)
│   └── ATA Derivation: [wallet, TOKEN_2022_PROGRAM, mint]
│
└── Side B (WSOL): SPL Token (NO hooks)
    ├── Mint: So11111111111111111111111111111111111111112
    ├── Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
    ├── Hook: NO (SPL Token has no hook support)
    └── ATA Derivation: [wallet, TOKEN_PROGRAM, mint]
```

### Mixed Program Swap Pattern

When handling swaps in mixed pools, must invoke the correct token program for each side:

```rust
// Source: Solana Token-2022 On-chain Guide
// For mixed pools, each side needs its own token program
let source_token_program = next_account_info(account_info_iter)?;
let destination_token_program = next_account_info(account_info_iter)?;

// Transfer from Token-2022 side (with hook)
Self::token_transfer_with_hook(
    source_token_program.clone(),  // Token-2022
    source_info.clone(),
    ...
)?;

// Transfer to SPL Token side (no hook)
Self::token_transfer(
    destination_token_program.clone(),  // SPL Token
    destination_info.clone(),
    ...
)?;
```

### ATA Derivation Pattern

Critical difference in ATA derivation between programs:

```rust
// Source: spl-associated-token-account interface
pub fn get_associated_token_address_and_bump_seed_internal(
    wallet_address: &Pubkey,
    token_mint_address: &Pubkey,
    program_id: &Pubkey,           // Associated Token Program
    token_program_id: &Pubkey,     // SPL Token OR Token-2022 - THIS MATTERS
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            &wallet_address.to_bytes(),
            &token_program_id.to_bytes(),  // <-- Different for T22 vs SPL
            &token_mint_address.to_bytes(),
        ],
        program_id,
    )
}
```

**Implication:** A WSOL ATA and an IPA ATA for the same wallet have different derivation paths because `token_program_id` differs.

### Anti-Patterns to Avoid

- **Assuming single token program:** Never hardcode `spl_token::id()` - always parameterize
- **Ignoring hook asymmetry:** Don't assume hooks fire on both sides of mixed pools
- **Wrong ATA derivation:** Always include correct token_program_id in ATA lookup
- **Using deprecated `transfer`:** Must use `transfer_checked` for Token-2022 compatibility

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ATA derivation | Custom PDA logic | `get_associated_token_address_with_program_id` | Handles program ID correctly |
| Token state parsing | Manual deserialization | `StateWithExtensions::<Account>::unpack` | Handles extensions properly |
| Transfer hook resolution | Manual account resolution | `spl-transfer-hook-interface` helpers | Complex TLV parsing |
| Token program detection | Account data parsing | Check `account_info.owner` against known program IDs | Official pattern |

**Key insight:** The complexity of supporting both token programs simultaneously is well-documented in official guides. Use the official patterns from `token-2022/onchain.rs`.

## Common Pitfalls

### Pitfall 1: WSOL Hook Assumption
**What goes wrong:** Assuming transfer hooks enforce whitelist on WSOL transfers
**Why it happens:** All protocol tokens (IPA, IPB, OP4) have hooks, so developers assume WSOL does too
**How to avoid:** Document explicitly that WSOL is SPL Token, hooks don't exist, transfers are unprotected
**Warning signs:** Specs mention "all tokens have hooks" without WSOL exception

### Pitfall 2: Mixed Program CPI Failure
**What goes wrong:** `ProgramError::IncorrectProgramId` when calling wrong token program
**Why it happens:** Using single token program ID for all operations in mixed pool
**How to avoid:** Pass separate `token_program_id` for each token in instruction accounts
**Warning signs:** Tests pass with all-Token-2022 but fail with mixed pools

### Pitfall 3: ATA Address Mismatch
**What goes wrong:** Derived ATA doesn't match actual account, transfers fail
**Why it happens:** Using wrong token_program_id in derivation (e.g., using T22 for WSOL)
**How to avoid:** Always verify token program before ATA derivation
**Warning signs:** "Account not found" errors for ATAs that should exist

### Pitfall 4: Extension Size Calculation Errors
**What goes wrong:** `Account::unpack` fails for Token-2022 accounts with extensions
**Why it happens:** SPL Token expects exactly 165 bytes, T22 accounts have extension data
**How to avoid:** Use `StateWithExtensions::<Account>::unpack` which handles variable sizes
**Warning signs:** Deserialization failures only with Token-2022 accounts

### Pitfall 5: Transfer Hook Account Resolution
**What goes wrong:** Transfer fails because extra accounts not provided
**Why it happens:** Token-2022 hooks require ExtraAccountMetaList accounts
**How to avoid:** Use `add_extra_accounts_for_execute_cpi` helper
**Warning signs:** "Missing required account" errors on Token-2022 transfers

## Code Examples

### Checking Token Program Owner

```rust
// Source: Token-2022 On-chain Guide
use spl_token_2022::check_spl_token_program_account;

// Check if account is owned by either token program
if check_spl_token_program_account(token_account_info.owner).is_err() {
    return Err(ProgramError::IncorrectProgramId);
}
```

### ATA Derivation with Correct Program

```rust
// Source: spl-associated-token-account
use spl_associated_token_account::get_associated_token_address_with_program_id;

// For WSOL (SPL Token)
let wsol_ata = get_associated_token_address_with_program_id(
    &wallet,
    &NATIVE_MINT,  // So11111111111111111111111111111111111111112
    &spl_token::id(),  // TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
);

// For IPA (Token-2022)
let ipa_ata = get_associated_token_address_with_program_id(
    &wallet,
    &IPA_MINT,
    &spl_token_2022::id(),  // TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
);
```

### Transfer with Hook Support

```rust
// Source: token-2022/program/src/onchain.rs
use spl_token_2022::onchain::invoke_transfer_checked;

// For Token-2022 tokens with potential hooks
invoke_transfer_checked(
    token_program_id,
    source_info.clone(),
    mint_info.clone(),
    destination_info.clone(),
    authority_info.clone(),
    additional_accounts,  // Includes hook-related accounts
    amount,
    decimals,
    signer_seeds,
)?;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `transfer` instruction | `transfer_checked` required | Token-2022 | Must provide mint and decimals |
| Single token program | Per-token program routing | Token-2022 | Mixed pools require multiple programs |
| `Account::unpack` | `StateWithExtensions::unpack` | Token-2022 | Handles extension data |
| Assumed hook coverage | Explicit per-mint hook config | Token-2022 | Must check mint for hook program |

**Deprecated/outdated:**
- `spl_token::instruction::transfer`: Use `transfer_checked` for T22 compatibility
- Hardcoded `spl_token::id()`: Always parameterize token program

## Token Program Matrix for Dr. Fraudsworth

### Complete Pool Matrix

| Pool | Side | Token | Token Program | Has Hook | Hook Protected |
|------|------|-------|---------------|----------|----------------|
| IPA/SOL | A | IPA | Token-2022 | Yes | Yes |
| IPA/SOL | B | WSOL | SPL Token | No | **NO** |
| IPB/SOL | A | IPB | Token-2022 | Yes | Yes |
| IPB/SOL | B | WSOL | SPL Token | No | **NO** |
| IPA/OP4 | A | IPA | Token-2022 | Yes | Yes |
| IPA/OP4 | B | OP4 | Token-2022 | Yes | Yes |
| IPB/OP4 | A | IPB | Token-2022 | Yes | Yes |
| IPB/OP4 | B | OP4 | Token-2022 | Yes | Yes |

### Transfer Hook Coverage Summary

| Token | Program | Hook Coverage | Notes |
|-------|---------|---------------|-------|
| IPA | Token-2022 | Full | Whitelist enforced on all transfers |
| IPB | Token-2022 | Full | Whitelist enforced on all transfers |
| OP4 | Token-2022 | Full | Whitelist enforced on all transfers |
| WSOL | SPL Token | **NONE** | No hook support in SPL Token |

### Security Implications of Unhooked WSOL

**Critical finding:** The transfer hook whitelist enforcement does NOT apply to WSOL movements.

1. **Direct WSOL transfers are possible:** Users can transfer WSOL between wallets freely
2. **Pool integrity maintained by:** AMM program access control (Tax Program PDA signer requirement), not hooks
3. **Vault protection:** WSOL vaults are whitelisted for IPA/IPB transfers TO them, but WSOL FROM vault is controlled by AMM, not hook
4. **Potential attack vectors:**
   - Someone sending unexpected WSOL to vaults (benign, increases pool liquidity)
   - Cannot extract WSOL from vaults without AMM authorization (protected by PDA ownership)

**Mitigation documented in existing specs:** AMM requires Tax Program PDA signature for all swaps, preventing direct user calls that could bypass tax collection.

## Open Questions

1. **WSOL vault extraction security**
   - What we know: AMM vaults are PDAs owned by AMM program, require authorized CPI
   - What's unclear: Are there any edge cases where WSOL could leak from vaults?
   - Recommendation: Verify in Phase 5 that all WSOL withdrawal paths require Tax Program authorization

2. **Native SOL sync timing**
   - What we know: WSOL requires `sync_native` after lamport transfers
   - What's unclear: Is this handled correctly in bonding curve -> pool seeding transition?
   - Recommendation: Verify initialization flow handles sync correctly

## Sources

### Primary (HIGH confidence)
- Solana Program Library Token-2022 On-chain Guide: https://www.solana-program.com/docs/token-2022/onchain
- Transfer Hook Interface Specification: https://www.solana-program.com/docs/transfer-hook-interface/specification
- Token-2022 Extension Guide: https://www.solana-program.com/docs/token-2022/extensions
- SPL Token Documentation: https://www.solana-program.com/docs/token

### Secondary (MEDIUM confidence)
- GitHub token-2022/program/src/onchain.rs - CPI helpers for transfer hooks
- GitHub spl-associated-token-account/interface/src/address.rs - ATA derivation
- Anchor Token Extensions Documentation: https://www.anchor-lang.com/docs/tokens/extensions

### Tertiary (LOW confidence)
- Stack Exchange discussions on mixed program pools (verified against official docs)

## Metadata

**Confidence breakdown:**
- Token program differences: HIGH - Verified against official Solana docs
- Transfer hook behavior: HIGH - Confirmed in interface specification
- ATA derivation: HIGH - Verified in spl-associated-token-account source
- Security implications: MEDIUM - Requires validation against actual implementation

**Research date:** 2026-02-01
**Valid until:** 30 days (stable domain, Solana token programs don't change frequently)
