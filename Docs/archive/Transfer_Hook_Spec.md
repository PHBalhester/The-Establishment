# Dr. Fraudsworth's Finance Factory
## Transfer Hook Program Specification

---

## 1. Purpose

This document defines the **Transfer Hook Program** that enforces transfer restrictions on CRIME, FRAUD, and PROFIT tokens.

The hook ensures all token movement routes through protocol-controlled addresses (pool vaults, Carnage Fund, bonding curve), preventing:
- Direct wallet-to-wallet transfers
- OTC trades
- Unauthorized token movement

This is a **security-critical program**. All tokens in the system depend on it.

---

## 2. Design Constraints (Hard)

- Single hook program serves all three tokens (CRIME, FRAUD, PROFIT)
- Shared whitelist across all mints
- Whitelist is immutable after initialization
- No admin functions post-deployment
- No upgradability

---

## 3. Core Rule

**Transfer Validation Rule:**

A transfer is allowed if and only if:
1. Amount is greater than zero, AND
2. At least one of (source, destination) is a whitelisted address

All other transfers are rejected.

```
if amount == 0:
    REJECT (ZeroAmountTransfer)

if source IN whitelist OR destination IN whitelist:
    ALLOW
else:
    REJECT (NoWhitelistedParty)
```

---

## 4. Whitelisted Addresses

The following addresses are whitelisted at initialization:

| # | Address Type | Purpose |
|---|--------------|---------|
| 1 | CRIME/SOL pool CRIME vault | Pool holds CRIME tokens |
| 2 | CRIME/SOL pool WSOL vault | Pool holds WSOL |
| 3 | FRAUD/SOL pool FRAUD vault | Pool holds FRAUD tokens |
| 4 | FRAUD/SOL pool WSOL vault | Pool holds WSOL |
| 5 | CRIME/PROFIT pool CRIME vault | Pool holds CRIME tokens |
| 6 | CRIME/PROFIT pool PROFIT vault | Pool holds PROFIT tokens |
| 7 | FRAUD/PROFIT pool FRAUD vault | Pool holds FRAUD tokens |
| 8 | FRAUD/PROFIT pool PROFIT vault | Pool holds PROFIT tokens |
| 9 | Carnage CRIME vault | Holds CRIME for Carnage burns |
| 10 | Carnage FRAUD vault | Holds FRAUD for Carnage burns |
| 11 | CRIME bonding curve token vault | Bonding curve holds CRIME during launch |
| 12 | FRAUD bonding curve token vault | Bonding curve holds FRAUD during launch |
| 13 | Reserve vault | Protocol reserve for transition distribution |
| 14 | Stake vault PDA | Receives staked PROFIT from Staking Program |

**Total: 14 addresses**

> **Why 14 entries:**
> - Carnage needs separate vaults for CRIME and FRAUD tokens (2 entries, not 1 shared PDA)
> - Bonding curves need separate token vaults per mint (2 entries, not 1 shared PDA)
> - Reserve vault requires whitelisting for transition distribution of tokens to pools
> - Stake vault requires whitelisting so users can transfer PROFIT into the staking pool (see New_Yield_System_Spec.md Section 12.3)

> **Note:** No burn address is needed. Carnage uses native Token-2022 burn instruction which does not trigger transfer hooks.

> **v1.2 Update:** Bonding curve token vaults (CRIME + FRAUD, entries #11-12) require whitelist entries for both buy (vault -> user) and sell-back (user -> vault) transfers. Tax escrow PDAs do NOT need whitelisting -- they hold SOL only, no token transfers pass through them. The CRIME/PROFIT and FRAUD/PROFIT pool vault entries (#5-8) listed above were replaced by Conversion Vault token accounts in v1.1. See `Protocol_Initialzation_and_Launch_Flow.md` for current deployment. The total whitelist entry count may change when reconciling v1.1 Conversion Vault changes (pre-existing issue, not a v1.2 change).

> **Important (WSOL vaults):** Entries #2 and #4 (wSOL pool vaults) are whitelisted so that CRIME/FRAUD/PROFIT tokens can be transferred TO these vaults during swaps. However, **WSOL itself uses the SPL Token program (not Token-2022) and has no transfer hook support**. WSOL transfers do not invoke this hook program. WSOL vault security relies on AMM access control (PDA ownership), not whitelist enforcement. See `Docs/Token_Program_Reference.md` for the authoritative token program matrix.

---

## 5. Whitelist Storage

### 5.1 Storage Pattern

Whitelist uses **existence-based PDA pattern**:
- Each whitelisted address has a corresponding PDA
- PDA existence = address is whitelisted
- PDA non-existence = address is not whitelisted

### 5.2 PDA Derivation

```
seeds = ["whitelist", address]
program = transfer_hook_program
```

### 5.3 Whitelist Entry Account

```rust
#[account]
pub struct WhitelistEntry {
    pub address: Pubkey,      // The whitelisted address
    pub created_at: i64,      // Timestamp for audit trail
}
```

Size: 32 + 8 = 40 bytes (+ 8 byte discriminator = 48 bytes)

### 5.4 Lookup Logic

```rust
fn is_whitelisted(address: &Pubkey) -> bool {
    let (pda, _bump) = Pubkey::find_program_address(
        &[b"whitelist", address.as_ref()],
        &TRANSFER_HOOK_PROGRAM_ID
    );
    
    // Account exists = whitelisted
    account_exists(&pda)
}
```

---

## 6. Authority Model

### 6.1 Whitelist Authority

```rust
#[account]
pub struct WhitelistAuthority {
    pub authority: Option<Pubkey>,  // None = burned
    pub initialized: bool,
}
```

PDA derivation:
```
seeds = ["authority"]
program = transfer_hook_program
```

### 6.2 Authority Lifecycle

1. **Initialization:** Authority set to deployer pubkey
2. **Whitelist population:** Authority adds all 14 entries
3. **Burn:** Authority set to `None`, permanently
4. **Post-burn:** No new whitelist entries possible

### 6.3 Burn Mechanism

```rust
pub fn burn_authority(ctx: Context<BurnAuthority>) -> Result<()> {
    let authority_account = &mut ctx.accounts.whitelist_authority;
    
    require!(
        authority_account.authority.is_some(),
        TransferHookError::AuthorityAlreadyBurned
    );
    
    authority_account.authority = None;
    
    emit!(AuthorityBurned {
        burned_by: ctx.accounts.signer.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 7. Instructions

### 7.1 initialize_authority

Initializes the whitelist authority account.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer |
| whitelist_authority | Init PDA | Authority state |
| system_program | Program | System program |

**Logic:**
- Create WhitelistAuthority PDA
- Set authority to signer
- Set initialized to true

**Callable:** Once, by deployer

---

### 7.2 add_whitelist_entry

Adds an address to the whitelist.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Must match stored authority |
| whitelist_authority | PDA | Authority state (read) |
| whitelist_entry | Init PDA | New whitelist entry |
| address_to_whitelist | UncheckedAccount | Address being whitelisted |
| system_program | Program | System program |

**Logic:**
```rust
pub fn add_whitelist_entry(ctx: Context<AddWhitelistEntry>) -> Result<()> {
    let auth = &ctx.accounts.whitelist_authority;
    
    require!(
        auth.authority == Some(ctx.accounts.authority.key()),
        TransferHookError::Unauthorized
    );
    
    let entry = &mut ctx.accounts.whitelist_entry;
    entry.address = ctx.accounts.address_to_whitelist.key();
    entry.created_at = Clock::get()?.unix_timestamp;
    
    emit!(AddressWhitelisted {
        address: entry.address,
        added_by: ctx.accounts.authority.key(),
        timestamp: entry.created_at,
    });
    
    Ok(())
}
```

**Callable:** Only while authority is not burned

---

### 7.3 burn_authority

Permanently disables whitelist modifications.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Must match stored authority |
| whitelist_authority | Mut PDA | Authority state |

**Logic:** See Section 6.3

**Callable:** Once, by authority holder

---

### 7.4 transfer_hook (Entry Point)

Called by Token-2022 program on every transfer of CRIME, FRAUD, or PROFIT.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| source_account | TokenAccount | Sending token account |
| mint | Mint | Token mint |
| destination_account | TokenAccount | Receiving token account |
| owner | UncheckedAccount | Owner of source account |
| extra_account_meta_list | PDA | Required by Token-2022 |
| whitelist_entry_source | Optional PDA | Whitelist PDA for source |
| whitelist_entry_dest | Optional PDA | Whitelist PDA for dest |

**Logic:**
```rust
pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // Block zero-amount transfers
    require!(
        amount > 0,
        TransferHookError::ZeroAmountTransfer
    );
    
    let source = ctx.accounts.source_account.key();
    let dest = ctx.accounts.destination_account.key();
    
    let source_whitelisted = is_whitelist_pda_valid(
        &ctx.accounts.whitelist_entry_source,
        &source
    );
    
    let dest_whitelisted = is_whitelist_pda_valid(
        &ctx.accounts.whitelist_entry_dest,
        &dest
    );
    
    require!(
        source_whitelisted || dest_whitelisted,
        TransferHookError::NoWhitelistedParty
    );
    
    Ok(())
}

fn is_whitelist_pda_valid(
    account: &Option<AccountInfo>,
    expected_address: &Pubkey
) -> bool {
    match account {
        Some(acc) => {
            // Verify PDA derivation
            let (expected_pda, _) = Pubkey::find_program_address(
                &[b"whitelist", expected_address.as_ref()],
                &crate::ID
            );
            
            acc.key() == expected_pda && !acc.data_is_empty()
        }
        None => false
    }
}
```

---

## 8. ExtraAccountMetaList

Token-2022 transfer hooks require an ExtraAccountMetaList PDA that specifies additional accounts needed during transfers.

### 8.1 PDA Derivation

```
seeds = ["extra-account-metas", mint]
program = transfer_hook_program
```

### 8.2 Required Extra Accounts

The hook requires whitelist PDAs for both source and destination to be passed. These are derived dynamically:

```rust
ExtraAccountMeta::new_with_seeds(
    &[
        Seed::Literal { bytes: b"whitelist".to_vec() },
        Seed::AccountKey { index: 0 },  // source_account
    ],
    false,  // is_signer
    false,  // is_writable
)?;

ExtraAccountMeta::new_with_seeds(
    &[
        Seed::Literal { bytes: b"whitelist".to_vec() },
        Seed::AccountKey { index: 2 },  // destination_account
    ],
    false,
    false,
)?;
```

### 8.3 Initialization

ExtraAccountMetaList must be initialized for each mint (CRIME, FRAUD, PROFIT) before transfers can occur.

```rust
pub fn initialize_extra_account_meta_list(
    ctx: Context<InitializeExtraAccountMetaList>
) -> Result<()> {
    let extra_metas = vec![
        // Whitelist PDA for source
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"whitelist".to_vec() },
                Seed::AccountKey { index: 0 },
            ],
            false,
            false,
        )?,
        // Whitelist PDA for destination
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"whitelist".to_vec() },
                Seed::AccountKey { index: 2 },
            ],
            false,
            false,
        )?,
    ];
    
    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
        &extra_metas,
    )?;
    
    Ok(())
}
```

---

## 9. Mint Configuration

Each token mint (CRIME, FRAUD, PROFIT) must be configured with:

### 9.1 Transfer Hook Extension

```rust
// During mint creation
initialize_transfer_hook(
    mint_account,
    authority,           // Temporary, will be burned
    transfer_hook_program_id,
)?;
```

### 9.2 Authority Burning

After mint initialization and hook configuration:

```rust
// Burn transfer hook authority (cannot change hook program)
set_transfer_hook_authority(
    mint_account,
    current_authority,
    None,  // New authority = None
)?;

// Burn mint authority (cannot mint more tokens)
set_authority(
    mint_account,
    current_authority,
    AuthorityType::MintTokens,
    None,
)?;
```

### 9.3 Token-2022 Extension Configuration

**CRIME, FRAUD, and PROFIT mints use ONLY the Transfer Hook extension.**

No other Token-2022 extensions are configured on these mints:

| Extension | Status | Rationale |
|-----------|--------|-----------|
| Transfer Hook | ✅ Enabled | Required for whitelist enforcement |
| Transfer Fees | ❌ Not used | Protocol uses custom tax logic via AMM, not mint-level fees |
| Permanent Delegate | ❌ Not used | Would create centralization risk |
| Non-Transferable | ❌ Not used | Tokens must be tradeable through pools |
| Interest-Bearing | ❌ Not used | Yield is handled separately via Yield System |
| Default Account State | ❌ Not used | No frozen-by-default requirement |
| CPI Guard | ❌ Not used | Would interfere with AMM/hook interactions |
| Memo Required | ❌ Not used | No memo requirements for transfers |

**Why this matters:**
- Simplifies security analysis (only one extension to audit)
- Prevents unexpected interactions between extensions
- Transfer Hook alone provides all required access control
- No hidden fee mechanisms or delegate powers exist on the mints

---

## 10. Errors

```rust
#[error_code]
pub enum TransferHookError {
    #[msg("Neither source nor destination is whitelisted")]
    NoWhitelistedParty,
    
    #[msg("Zero amount transfers are not allowed")]
    ZeroAmountTransfer,
    
    #[msg("Unauthorized: signer is not the authority")]
    Unauthorized,
    
    #[msg("Whitelist authority has already been burned")]
    AuthorityAlreadyBurned,
    
    #[msg("Address is already whitelisted")]
    AlreadyWhitelisted,
    
    #[msg("Invalid whitelist PDA derivation")]
    InvalidWhitelistPDA,
    
    #[msg("Extra account meta list already initialized")]
    ExtraAccountMetaListAlreadyInitialized,
}
```

---

## 11. Events

```rust
#[event]
pub struct AuthorityBurned {
    pub burned_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AddressWhitelisted {
    pub address: Pubkey,
    pub added_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TransferBlocked {
    pub source: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub reason: String,
}
```

---

## 12. Initialization Sequence

Complete initialization order:

```
1. Deploy Transfer Hook Program

2. Initialize whitelist authority
   → Authority = deployer

3. Deploy AMM Program

4. Initialize all 4 pools (creates vault PDAs)
   → CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT

5. Initialize Carnage Fund (creates Carnage PDA)

6. Initialize Bonding Curve (creates Bonding Curve PDA)

7. Add all 14 whitelist entries:
   → add_whitelist_entry(CRIME/SOL pool CRIME vault)
   → add_whitelist_entry(CRIME/SOL pool WSOL vault)
   → add_whitelist_entry(FRAUD/SOL pool FRAUD vault)
   → add_whitelist_entry(FRAUD/SOL pool WSOL vault)
   → add_whitelist_entry(CRIME/PROFIT pool CRIME vault)
   → add_whitelist_entry(CRIME/PROFIT pool PROFIT vault)
   → add_whitelist_entry(FRAUD/PROFIT pool FRAUD vault)
   → add_whitelist_entry(FRAUD/PROFIT pool PROFIT vault)
   → add_whitelist_entry(Carnage CRIME vault)
   → add_whitelist_entry(Carnage FRAUD vault)
   → add_whitelist_entry(CRIME curve token vault)
   → add_whitelist_entry(FRAUD curve token vault)
   → add_whitelist_entry(Reserve vault)
   → add_whitelist_entry(Stake vault)

8. Create token mints with transfer hook extension:
   → CRIME mint (hook = transfer_hook_program)
   → FRAUD mint (hook = transfer_hook_program)
   → PROFIT mint (hook = transfer_hook_program)

9. Initialize ExtraAccountMetaList for each mint:
   → initialize_extra_account_meta_list(CRIME)
   → initialize_extra_account_meta_list(FRAUD)
   → initialize_extra_account_meta_list(PROFIT)

10. Mint initial token supplies

11. Seed pools and bonding curve with tokens

12. Burn all authorities:
    → burn_authority() on transfer hook program
    → Burn mint authority on CRIME
    → Burn mint authority on FRAUD
    → Burn mint authority on PROFIT
    → Burn transfer hook authority on CRIME
    → Burn transfer hook authority on FRAUD
    → Burn transfer hook authority on PROFIT

13. Protocol is now immutable
```

---

## 13. Security Considerations

### 13.1 Whitelist Integrity

- Whitelist PDAs are derived deterministically
- Cannot be spoofed (PDA derivation is cryptographic)
- Cannot be modified after authority burn
- Existence check prevents deleted entries from being valid

### 13.2 Cross-Mint Safety

- Shared whitelist contains addresses for all tokens
- Solana Token program enforces mint matching on token accounts
- CRIME cannot be sent to FRAUD vaults (mint mismatch at runtime)
- Hook approval is necessary but not sufficient for transfer

### 13.3 Authority Safety

- Authority burn is irreversible (sets to None)
- No backdoor admin functions
- No upgrade authority on program

### 13.4 Reentrancy

- Transfer hooks execute synchronously
- No external calls from hook logic
- No state modifications except validation
- Reentrancy not a concern for this design

---

## 14. Testing Requirements

### 14.1 Unit Tests

- Whitelist PDA derivation correctness
- Authority initialization and burning
- Whitelist entry creation

### 14.2 Integration Tests

**Allowed transfers:**
- User wallet → Pool vault (selling)
- Pool vault → User wallet (buying)
- Pool vault → Carnage Fund (Carnage buy)
- Carnage Fund → Pool vault (Carnage sell, 2% path)
- Bonding curve → User wallet (curve purchase)
- User wallet → Bonding curve token vault (curve sale / sell-back)

> **v1.2 Update:** The sell-back test case (user -> curve token vault) validates that users can return tokens to the bonding curve during the Active phase. This uses the same whitelist entries (#11-12) as the buy path but in reverse direction. Both directions must be tested independently.

**Blocked transfers:**
- User wallet → User wallet (direct transfer)
- User wallet → Random address
- Zero amount transfer
- Transfer after authority burned (should still work, just can't add new entries)

### 14.3 Negative Tests

- Add whitelist entry with wrong signer
- Add whitelist entry after authority burned
- Burn authority twice
- Transfer to non-whitelisted address
- Transfer with amount = 0

### 14.4 Edge Cases

- Transfer maximum u64 amount (should work if whitelisted)
- Close account with dust balance (blocked, wallet-to-wallet)
- Self-transfer (blocked, wallet-to-wallet)

---

## 15. Invariants Summary

1. **Whitelist is immutable after burn** - All 14 entries frozen, no additions or removals
2. **All transfers require whitelist participation** - At least one side whitelisted
3. **Zero transfers blocked** - Explicit rejection
4. **One program serves all tokens** - Shared logic, shared whitelist
5. **No admin escape hatches** - Authority burn is permanent
6. **Hook is additive security** - Works alongside Token program's mint checks

---

## Audit Trail

- **Updated:** T22/WSOL validation (Phase 2 audit) - Added clarification that WSOL vaults are whitelisted for CRIME/FRAUD/PROFIT token transfers TO them, but WSOL itself (SPL Token) has no hook support
- **Updated:** Phase 5 GAP-057 resolution - Whitelist corrected from 10 to 13 entries. Added separate Carnage CRIME/FRAUD vaults (was single PDA), separate curve token vaults per mint, and Reserve vault. Aligned with Protocol_Initialzation_and_Launch_Flow.md Section 6.2. Cross-reference: [Protocol Init](./Protocol_Initialzation_and_Launch_Flow.md) Section 6.2
- **Updated:** Whitelist corrected from 13 to 14 entries. Added Stake Vault PDA (entry #14) for Staking Program PROFIT deposits. Cross-reference: New_Yield_System_Spec.md Section 12.3
- **Updated (v1.2):** Added v1.2 cross-reference notes: bonding curve sell-back test case clarified, tax escrow PDAs confirmed as SOL-only (no whitelisting needed), CRIME/PROFIT and FRAUD/PROFIT pool entries (#5-8) noted as replaced by Conversion Vault in v1.1. Cross-reference: Bonding_Curve_Spec.md Section 16.