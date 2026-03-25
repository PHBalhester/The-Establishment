# Architecture: Bonding Curve Program Integration (v1.2)

**Domain:** Bonding Curve Launch System for Dr. Fraudsworth's Finance Factory
**Researched:** 2026-03-03
**Scope:** How the 7th program integrates with the existing 6-program protocol
**Confidence:** HIGH (based on direct source code analysis of all 6 existing programs)

---

## 1. Executive Summary

The Bonding Curve program is the **7th on-chain program** in the protocol. Unlike the existing 6 programs which operate in a tightly coupled CPI DAG during normal protocol operation, the Bonding Curve is architecturally a **pre-protocol launch system** -- it runs BEFORE the protocol goes live, then hands off to the existing programs via a graduation ceremony (execute_transition).

The v1.2 additions (sell-back, tax escrow, coupled graduation) add significant complexity to the existing buy-only spec. This document maps every integration point, analyzes CPI depth constraints, defines new PDAs, and recommends build order.

**Key architectural finding:** The CPI depth limit (4) is NOT a concern for the bonding curve program because it operates independently of the existing CPI chain. The curve's graduation instruction seeds pools via a multi-step client-side orchestration (not a single CPI chain). The curve never enters the Tax -> AMM -> Token-2022 -> Hook chain during its operation.

---

## 2. Integration Points with All 6 Existing Programs

### 2.1 Transfer Hook Program (CRITICAL -- most complex integration)

**Nature:** Bidirectional. The curve's token vaults must be whitelisted.

**During Curve Operation (buy/sell):**
- The curve holds 460M tokens per vault and distributes them to buyers
- The curve accepts tokens back from sellers (v1.2)
- Every Token-2022 transfer triggers the transfer hook
- The curve's token vaults (2 vaults: curve_token_vault_crime, curve_token_vault_fraud) MUST be whitelisted BEFORE the curve starts
- User token accounts are NOT whitelisted -- they transfer TO/FROM whitelisted curve vaults

**Hook Remaining Accounts Required:**
Per the existing protocol pattern, each Token-2022 transfer needs 4 remaining_accounts:
1. `extra_account_meta_list` PDA: `["extra-account-metas", mint.key()]` from Hook Program
2. `whitelist_source` PDA: `["whitelist", source_token.key()]` from Hook Program
3. `whitelist_destination` PDA: `["whitelist", dest_token.key()]` from Hook Program
4. Transfer Hook program ID

**For purchase (vault -> user):**
- Source = curve_token_vault (whitelisted) -- PDA exists
- Destination = user_token_account (NOT whitelisted) -- PDA does not exist, but data_is_empty() returns true which causes `is_whitelisted()` to return false
- This works because the hook checks source OR destination, and the vault is whitelisted

**For sell-back (user -> vault) [v1.2]:**
- Source = user_token_account (NOT whitelisted) -- PDA does not exist
- Destination = curve_token_vault (whitelisted) -- PDA exists
- Same logic: one party whitelisted, transfer passes

**New whitelist entries needed:** 2 (one per curve token vault, CRIME and FRAUD)

**Deployment sequence constraint:** Whitelist entries must be created BEFORE curve starts. The whitelist authority must NOT be burned before bonding curve vaults are whitelisted. Currently the authority is burned after initialize.ts completes. The bonding curve initialization must either:
- (a) Happen BEFORE whitelist authority burn (insert into existing initialize.ts), OR
- (b) Whitelist authority burn is deferred until after bonding curve setup

**Recommendation:** Option (a) -- add bonding curve vault whitelisting to initialize.ts before the burn step. This preserves the existing "initialize everything then burn" pattern.

### 2.2 AMM Program (graduation only)

**Nature:** Unidirectional. The curve creates AMM pools at graduation.

**Current AMM pool initialization pattern (from initialize_pool.rs):**
- Requires AdminConfig PDA with `has_one = admin` constraint
- Admin must sign (the admin signer, not a PDA)
- Pool PDA: `["pool", mint_a.key(), mint_b.key()]` with canonical ordering (`mint_a < mint_b`)
- Vault PDAs: `["vault", pool.key(), "a"]` and `["vault", pool.key(), "b"]`
- Seed amounts transferred from admin's token accounts to vault accounts via transfer_checked

**Critical constraint:** The AMM's `initialize_pool` requires the **admin signer** (not a PDA). The current spec's execute_transition envisions CPI from the curve program into AMM, but the AMM's admin is a regular Keypair, not a PDA. CPI cannot produce a Keypair signature -- it can only produce PDA signatures.

**Options for graduation pool seeding:**

**Option A: Client-side orchestration (RECOMMENDED)**
Split execute_transition into multiple transactions:
1. TX1: Curve program's `prepare_transition` -- marks both curves as Transitioning, transfers SOL and tokens to a staging area controlled by the admin
2. TX2: Admin calls AMM `initialize_pool` for CRIME/SOL with seed amounts
3. TX3: Admin calls AMM `initialize_pool` for FRAUD/SOL with seed amounts
4. TX4: Admin calls ConversionVault `initialize` + seeds conversion vault
5. TX5: Curve program's `finalize_transition` -- marks curves as Transitioned

**Option B: Add CPI gateway to AMM**
Add a new `initialize_pool_cpi` instruction to the AMM that accepts a PDA signer (e.g., curve_authority) instead of admin signer. This would allow the curve to CPI into AMM directly.

**Recommendation: Option A (client-side orchestration)**
Reasons:
- Does NOT require modifying the existing AMM program (huge advantage -- the AMM is battle-tested)
- The admin signer is available during graduation (the deployer orchestrates)
- Graduation is a one-time event, not a hot path
- Avoids adding CPI surface area to the AMM
- The "atomicity" concern is addressed by prepare_transition locking the curve state

**CPI depth analysis for Option A:**
Each step is an independent top-level transaction, so CPI depth is never more than 2:
- AMM::initialize_pool -> Token-2022::transfer_checked -> TransferHook (depth 2)
This is well within the depth-4 limit.

### 2.3 Conversion Vault Program (graduation only)

**Nature:** Unidirectional. The graduation seeds the conversion vault.

**Current vault initialization (from initialize.rs):**
- One-shot `initialize` instruction -- creates VaultConfig PDA + 3 vault token accounts
- Any signer can call (no stored authority)
- Mints are hardcoded via feature flags (devnet/mainnet)
- After initialization, tokens are transferred TO the vault accounts

**Integration path:** After AMM pools are seeded, the admin transfers 250M CRIME + 250M FRAUD + 20M PROFIT to the conversion vault's token accounts. This is a standard Token-2022 transfer (with hook accounts in remaining_accounts).

**New requirement:** The conversion vault must be initialized BEFORE graduation can happen. Since it is already initialized in the current deploy-all.sh pipeline, the bonding curve graduation can simply seed it with tokens.

### 2.4 Tax Program (none during curve, post-graduation only)

**Nature:** No direct integration. The Tax Program operates after the protocol launches.

After graduation, all user swaps go through Tax -> AMM -> Token-2022 -> Hook as normal. The bonding curve program has no interaction with the Tax Program during its operation.

### 2.5 Epoch Program (none during curve, post-graduation only)

**Nature:** No direct integration during curve operation.

Post-graduation, the Epoch Program's initialize_epoch_state and initialize_carnage_fund should be called as part of graduation orchestration. These are already handled by initialize.ts.

**Consideration:** Should epoch/staking initialization happen BEFORE or AFTER graduation? Currently initialize.ts does it all in one pass. With the bonding curve, the sequence would be:
1. Deploy all programs (including bonding curve)
2. Initialize mints, hook, whitelist, bonding curve vaults
3. Start curves, run until graduation
4. Graduate: seed pools, seed vault, initialize epoch/staking/carnage

**Recommendation:** Initialize epoch/staking/carnage DURING graduation (as part of the transition orchestration), not during initial deploy. This ensures these systems only come online when the protocol is actually ready for trading.

### 2.6 Staking Program (none during curve, post-graduation only)

**Nature:** No direct integration. Staking is initialized during graduation.

---

## 3. New Accounts and PDAs

### 3.1 CurveState PDA (2 instances: CRIME, FRAUD)

```
Seeds: ["curve", token_mint.key()]
Program: curve_program
Size: 8 (disc) + 1 (token) + 32 (token_mint) + 32 (token_vault) + 32 (sol_vault) + 32 (tax_escrow) + 8 (tokens_sold) + 8 (sol_raised) + 8 (tokens_returned) + 8 (tax_collected) + 1 (status) + 8 (start_slot) + 8 (deadline_slot) + 4 (participant_count) + 1 (bump) = 183 bytes

Note: v1.2 adds tokens_returned (u64) and tax_collected (u64) and tax_escrow (Pubkey) vs the original 143 bytes.
```

Updated CurveState for v1.2:
```rust
#[account]
pub struct CurveState {
    pub token: Token,              // 1 byte
    pub token_mint: Pubkey,        // 32 bytes
    pub token_vault: Pubkey,       // 32 bytes
    pub sol_vault: Pubkey,         // 32 bytes
    pub tax_escrow: Pubkey,        // 32 bytes (NEW v1.2 - separate tax escrow)
    pub tokens_sold: u64,          // 8 bytes
    pub sol_raised: u64,           // 8 bytes (NET of tax on sell-backs)
    pub tokens_returned: u64,      // 8 bytes (NEW v1.2 - total tokens sold back)
    pub tax_collected: u64,        // 8 bytes (NEW v1.2 - total sell tax collected)
    pub status: CurveStatus,       // 1 byte
    pub start_slot: u64,           // 8 bytes
    pub deadline_slot: u64,        // 8 bytes
    pub participant_count: u32,    // 4 bytes
    pub bump: u8,                  // 1 byte
}
// Total: 183 bytes (8 + 175 data)
```

### 3.2 ParticipantState PDA (per user per curve)

```
Seeds: ["participant", token_mint.key(), user_pubkey.key()]
Program: curve_program
Size: 8 (disc) + 32 (user) + 1 (token) + 8 (tokens_purchased) + 8 (tokens_sold_back) + 8 (sol_spent) + 8 (sol_received) + 4 (purchase_count) + 4 (sell_count) + 8 (first_purchase_slot) + 8 (last_purchase_slot) + 1 (refund_claimed) + 1 (bump) = 99 bytes

Note: v1.2 adds tokens_sold_back (u64), sol_received (u64), sell_count (u32) vs the original 79 bytes.
```

Updated ParticipantState for v1.2:
```rust
#[account]
pub struct ParticipantState {
    pub user: Pubkey,              // 32 bytes
    pub token: Token,              // 1 byte
    pub tokens_purchased: u64,     // 8 bytes (gross purchases)
    pub tokens_sold_back: u64,     // 8 bytes (NEW v1.2)
    pub sol_spent: u64,            // 8 bytes (total SOL spent buying)
    pub sol_received: u64,         // 8 bytes (NEW v1.2 - net SOL from sell-backs)
    pub purchase_count: u32,       // 4 bytes
    pub sell_count: u32,           // 4 bytes (NEW v1.2)
    pub first_purchase_slot: u64,  // 8 bytes
    pub last_purchase_slot: u64,   // 8 bytes
    pub refund_claimed: bool,      // 1 byte
    pub bump: u8,                  // 1 byte
}
// Total: 99 bytes (8 + 91 data)
```

### 3.3 Token Vault PDA (2 instances, one per curve)

```
Seeds: ["curve_token_vault", token_mint.key()]
Program: curve_program
Type: Token-2022 token account (owned by curve_authority PDA)
```

Holds the 460M tokens for sale. As tokens are sold, they transfer out. As tokens are sold back (v1.2), they transfer in. The vault's current balance = 460M - tokens_sold + tokens_returned.

### 3.4 SOL Vault PDA (2 instances, one per curve)

```
Seeds: ["curve_sol_vault", token_mint.key()]
Program: curve_program
Type: SystemAccount (native SOL)
```

Holds raised SOL from purchases. When users sell back tokens (v1.2), the net SOL (after 15% tax) is returned from this vault.

### 3.5 Tax Escrow PDA (2 instances, one per curve) -- NEW v1.2

```
Seeds: ["curve_tax_escrow", token_mint.key()]
Program: curve_program
Type: SystemAccount (native SOL)
```

Holds the 15% sell tax collected from sell-backs. This is deliberately separate from sol_vault because the tax has different routing based on curve outcome:
- **Graduation success:** Tax escrow transfers to carnage_sol_vault (funds the Carnage mechanism)
- **Graduation failure:** Tax escrow is distributed proportionally back to participants who paid tax (pro-rata based on sell activity)

### 3.6 Curve Authority PDA (singleton)

```
Seeds: ["curve_authority"]
Program: curve_program
```

Signs for token vault transfers (purchase distribution, sell-back acceptance). This is the authority on the curve token vault accounts.

### 3.7 WhitelistEntry (Privy replacement)

```
Seeds: ["whitelist", wallet_pubkey.key()]
Program: curve_program (NOT the transfer hook program)
```

**Important distinction:** This is a DIFFERENT whitelist from the Transfer Hook whitelist. The Transfer Hook whitelist controls which TOKEN ACCOUNTS can send/receive. The curve whitelist controls which WALLETS can buy from the curve.

The curve whitelist uses the same pattern as the existing spec (on-chain PDA existence check), but the verification backend is TBD (Privy was removed in v1.1).

### 3.8 ReserveState PDA (singleton)

```
Seeds: ["reserve"]
Program: curve_program
```

Tracks the 290M + 250M token reserves per token for pool seeding and vault seeding. Updated during graduation to mark pools_seeded = true.

---

## 4. CPI Depth Analysis

### 4.1 During Curve Operation (buy/sell)

**Purchase path (buy tokens from curve):**
```
Depth 0: Curve::purchase (entry point)
  -> Token-2022::transfer_checked (SOL user -> curve via system_program, then tokens vault -> user)
    -> TransferHook::transfer_hook (whitelist check)

Max depth: 2 (Curve -> Token-2022 -> Hook)
```

There is NO CPI chain issue. The curve calls Token-2022 transfer_checked directly (depth 1), which calls the hook (depth 2). This is the same depth as the Conversion Vault.

**Sell-back path (v1.2 -- sell tokens back to curve):**
```
Depth 0: Curve::sell
  -> Token-2022::transfer_checked (tokens user -> vault)
    -> TransferHook::transfer_hook (whitelist check)
  -> System::transfer (SOL vault -> user, net of tax)
  -> System::transfer (tax portion -> tax_escrow)

Max depth: 2 (Curve -> Token-2022 -> Hook)
```

Same as purchase. No depth issues.

### 4.2 During Graduation (execute_transition)

**With client-side orchestration (recommended):**
Each transaction is independent, max depth 2:
```
TX1: Curve::prepare_transition (depth 0, no CPI)
TX2: AMM::initialize_pool for CRIME/SOL (depth 0 -> Token-2022 depth 1 -> Hook depth 2)
TX3: AMM::initialize_pool for FRAUD/SOL (same)
TX4: Token-2022::transfer_checked to seed conversion vault (depth 1 -> Hook depth 2)
TX5: Curve::finalize_transition (depth 0, no CPI)
```

**No depth violations.** Every graduation step stays within depth 2, well under the limit.

### 4.3 Refund Path (failed curve)

```
Depth 0: Curve::claim_refund
  -> System::transfer (SOL vault -> user)

Max depth: 1 (no token transfers, just native SOL)
```

### 4.4 Tax Escrow Distribution (v1.2)

**On success (graduation):**
```
Depth 0: Curve::distribute_tax_escrow
  -> System::transfer (tax_escrow -> carnage_sol_vault)

Max depth: 1
```

**On failure (refund):**
```
Depth 0: Curve::claim_tax_refund
  -> System::transfer (tax_escrow -> user, proportional to their sell tax paid)

Max depth: 1
```

### 4.5 Summary: No CPI Depth Conflicts

The bonding curve program NEVER enters the existing CPI chain (Tax -> AMM -> Token-2022 -> Hook). It operates as a leaf node calling Token-2022 directly. Maximum CPI depth across all paths is 2, which is safe.

---

## 5. Data Flow Diagrams

### 5.1 Purchase Flow (Buy Tokens from Curve)

```
User Wallet              Curve Program             Token-2022         Hook
    |                         |                         |               |
    | purchase(sol_amount)    |                         |               |
    |------------------------>|                         |               |
    |                         |                         |               |
    |                         | 1. Validate:            |               |
    |                         |    - curve Active        |               |
    |                         |    - deadline not passed |               |
    |                         |    - whitelist check     |               |
    |                         |    - min purchase        |               |
    |                         |    - wallet cap          |               |
    |                         |                         |               |
    |                         | 2. Calculate tokens_out |               |
    |                         |    via linear integral   |               |
    |                         |                         |               |
    |                         | 3. SOL: user -> sol_vault|              |
    |                         |    (system_program)      |               |
    |                         |                         |               |
    |                         | 4. Tokens: vault -> user |               |
    |                         |    transfer_checked      |               |
    |                         |------------------------>|               |
    |                         |                         | 5. Hook call  |
    |                         |                         |-------------->|
    |                         |                         |               |
    |                         |                         | 6. Whitelist: |
    |                         |                         |  vault (src)  |
    |                         |                         |  is listed    |
    |                         |                         |<--------------|
    |                         |                         |               |
    |                         | 7. Update curve state   |               |
    |                         |    (tokens_sold, etc.)   |               |
    |                         |                         |               |
    |<------------------------|                         |               |
    | Tokens received                                                   |
```

### 5.2 Sell-Back Flow (v1.2 -- Sell Tokens to Curve)

```
User Wallet              Curve Program             Token-2022         Hook
    |                         |                         |               |
    | sell(token_amount)      |                         |               |
    |------------------------>|                         |               |
    |                         |                         |               |
    |                         | 1. Validate:            |               |
    |                         |    - curve Active        |               |
    |                         |    - deadline not passed |               |
    |                         |    - user has tokens     |               |
    |                         |    - participant exists  |               |
    |                         |                         |               |
    |                         | 2. Calculate sol_out     |               |
    |                         |    via reverse integral  |               |
    |                         |                         |               |
    |                         | 3. Calculate tax (15%)   |               |
    |                         |    net_sol = sol_out * 85%|              |
    |                         |    tax = sol_out * 15%    |              |
    |                         |                         |               |
    |                         | 4. Tokens: user -> vault |               |
    |                         |    transfer_checked      |               |
    |                         |------------------------>|               |
    |                         |                         | 5. Hook call  |
    |                         |                         |-------------->|
    |                         |                         |  vault (dst)  |
    |                         |                         |  is listed    |
    |                         |                         |<--------------|
    |                         |                         |               |
    |                         | 6. SOL: sol_vault -> user|              |
    |                         |    (net_sol, system xfer) |              |
    |                         |                         |               |
    |                         | 7. SOL: sol_vault ->     |               |
    |                         |    tax_escrow (tax amt)   |              |
    |                         |                         |               |
    |                         | 8. Update state:         |               |
    |                         |    tokens_sold -= amount  |              |
    |                         |    sol_raised -= net_sol  |              |
    |                         |    tokens_returned += amt |              |
    |                         |    tax_collected += tax   |              |
    |                         |                         |               |
    |<------------------------|                         |               |
    | SOL received (net of 15% tax)                                     |
```

**Critical design decision -- sell-back curve math:**
When a user sells tokens back, the curve price MOVES BACKWARDS along the linear curve. This means:
- `tokens_sold` decreases (effectively the curve rewinds)
- The price at the current point on the curve decreases
- Subsequent buyers get tokens at a lower price
- The seller gets SOL based on the integral from their sell-point backwards

This creates interesting dynamics:
- Selling back at a higher `tokens_sold` point gets more SOL per token
- Selling back depresses the price for the remaining curve
- The 15% tax discourages rapid in/out speculation

### 5.3 Graduation Flow (Coupled, Client-Side Orchestration)

```
Admin/Crank              Curve Program         AMM              Vault
    |                         |                  |                 |
    | check_transition_ready  |                  |                 |
    |------------------------>|                  |                 |
    |   returns: both Filled  |                  |                 |
    |                         |                  |                 |
    | TX1: prepare_transition |                  |                 |
    |------------------------>|                  |                 |
    |                         | Mark both curves |                 |
    |                         | as Transitioning |                 |
    |                         |                  |                 |
    |                         | Transfer SOL from|                 |
    |                         | curve vaults to  |                 |
    |                         | admin (or staging)|                |
    |                         |                  |                 |
    |                         | Transfer reserve |                 |
    |                         | tokens to admin  |                 |
    |                         |                  |                 |
    | TX2: AMM::init_pool     |                  |                 |
    |  (CRIME/SOL, 290M +     |                  |                 |
    |   1000 SOL, 100bps fee) |                  |                 |
    |--------------------------------------->   |                 |
    |                         |  Pool created    |                 |
    |                         |                  |                 |
    | TX3: AMM::init_pool     |                  |                 |
    |  (FRAUD/SOL, 290M +     |                  |                 |
    |   1000 SOL, 100bps fee) |                  |                 |
    |--------------------------------------->   |                 |
    |                         |                  |                 |
    | TX4: Seed conversion    |                  |                 |
    |  vault (250M CRIME +    |                  |                 |
    |  250M FRAUD + 20M PROFIT|                  |                 |
    |  via transfer_checked)  |                  |                 |
    |------------------------------------------------>            |
    |                         |                  |                 |
    | TX5: Tax escrow ->      |                  |                 |
    |  carnage_sol_vault      |                  |                 |
    |  (on success)           |                  |                 |
    |                         |                  |                 |
    | TX6: Initialize epoch,  |                  |                 |
    |  staking, carnage       |                  |                 |
    |                         |                  |                 |
    | TX7: finalize_transition|                  |                 |
    |------------------------>|                  |                 |
    |                         | Mark both curves |                 |
    |                         | as Transitioned  |                 |
    |                         |                  |                 |
    |                         | Whitelist new    |                 |
    |                         | pool vaults (if  |                 |
    |                         | not already done)|                 |
```

### 5.4 Refund Flow (Failed Curve)

```
User Wallet              Curve Program
    |                         |
    | claim_refund            |
    |------------------------>|
    |                         |
    |                         | 1. Validate:
    |                         |    - curve Failed OR
    |                         |      (curve Filled AND partner Failed)
    |                         |    - participant exists
    |                         |    - refund not claimed
    |                         |
    |                         | 2. Calculate refund:
    |                         |    sol_refund = sol_spent - sol_received
    |                         |    (net of any sell-backs)
    |                         |
    |                         | 3. SOL: sol_vault -> user
    |                         |    (system_program::transfer)
    |                         |
    |                         | 4. Mark refund_claimed = true
    |                         |
    |<------------------------|
    | SOL returned
    |
    | claim_tax_refund        |  (v1.2 -- separate for tax escrow)
    |------------------------>|
    |                         |
    |                         | 1. Validate same as above
    |                         |    + tax_refund not claimed
    |                         |
    |                         | 2. Calculate proportional tax refund:
    |                         |    user_tax_portion =
    |                         |      tax_escrow_balance *
    |                         |      user_sell_tax_paid /
    |                         |      total_tax_collected
    |                         |
    |                         | 3. SOL: tax_escrow -> user
    |                         |
    |<------------------------|
    | Tax refund (proportional)
```

---

## 6. Sell-Back Mechanics (v1.2 Deep Dive)

### 6.1 Reverse Curve Math

When a user sells tokens back, the curve effectively "rewinds." The SOL returned is the integral of the price curve from `(tokens_sold - amount)` to `tokens_sold`.

```rust
/// Calculate SOL returned for selling `token_amount` tokens back
/// at the current curve position.
fn calculate_sol_out(
    token_amount: u64,
    current_sold: u64,  // tokens_sold before this sell
) -> Result<u64> {
    // new_sold = current_sold - token_amount
    let new_sold = current_sold
        .checked_sub(token_amount)
        .ok_or(CurveError::Overflow)?;

    // SOL = integral from new_sold to current_sold of P(x)dx
    // P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE
    // This is the same linear integral formula as purchase,
    // but integrated over the sell range.
    let sol_out = solve_linear_integral_range(
        new_sold,       // lower bound
        current_sold,   // upper bound
        P_START,
        P_END,
        TOTAL_FOR_SALE,
    )?;

    Ok(sol_out)
}
```

### 6.2 Sell Constraints

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| Minimum sell | TBD (suggest 0.01 SOL equivalent) | Prevent dust spam |
| Must have purchased | Yes (ParticipantState must exist) | Can only sell what you bought |
| Sell cap | Cannot sell more than you hold | Obvious |
| Sell timing | Only while curve is Active | No selling after Filled/Failed |
| Tax rate | 15% flat | Discourages speculation |

### 6.3 Tax Escrow Accounting

The tax escrow is a simple accumulator:
```
tax_escrow_balance = sum of all 15% taxes collected from sell-backs
```

**On graduation success:**
```
entire tax_escrow -> carnage_sol_vault
```

**On graduation failure:**
Each user's refund is proportional to their contribution to the tax escrow:
```
user_tax_refund = tax_escrow_balance * (user.sol_spent_on_sells_tax / curve.tax_collected)
```

Where `user.sol_spent_on_sells_tax` tracks the total 15% tax this specific user paid across all their sell-backs.

**ParticipantState addition for tracking:**
```rust
pub sell_tax_paid: u64,  // total 15% tax this user paid on sell-backs
```

This needs to be added to ParticipantState (total size: 99 + 8 = 107 bytes).

---

## 7. Token Minting Strategy

### 7.1 Current State

Tokens are minted during initialize.ts:
- CRIME: 1B total supply
- FRAUD: 1B total supply
- PROFIT: 20M total supply

The mint authority is currently the deployer wallet. After minting, the mint authority can be set to null (no further minting) or retained.

### 7.2 Bonding Curve Token Distribution

Per-token allocation (CRIME and FRAUD each):
| Allocation | Amount | Percentage |
|-----------|--------|------------|
| Bonding Curve Sale | 460,000,000 | 46% |
| SOL Pool Seeding | 290,000,000 | 29% |
| Conversion Vault | 250,000,000 | 25% |
| **Total** | **1,000,000,000** | **100%** |

### 7.3 Recommended Approach: Pre-mint and Transfer

**Do NOT give the curve program mint authority.** Instead:

1. Mint full 1B supply to admin token accounts (as currently done in initialize.ts)
2. Transfer 460M to each curve's token_vault PDA
3. Hold 290M in admin accounts (for pool seeding at graduation)
4. Hold 250M in admin accounts (for vault seeding at graduation)
5. After all transfers, SET MINT AUTHORITY TO NULL (prevents further minting)

**Why not give the curve mint authority:**
- Attack surface: if the curve program has a bug, an attacker could mint unlimited tokens
- Complexity: CPI minting requires additional account plumbing
- Audit surface: pre-minting is simpler and more auditable
- The existing initialize.ts already handles minting

### 7.4 Fund_curve Instruction

The `fund_curve` instruction transfers 460M tokens from admin to the curve vault:

```rust
pub fn fund_curve(ctx: Context<FundCurve>) -> Result<()> {
    // Curve must be Initialized (not yet started)
    require!(
        ctx.accounts.curve_state.status == CurveStatus::Initialized,
        CurveError::InvalidStatus
    );

    // Transfer 460M tokens from admin's token account to curve vault
    // Uses transfer_checked with hook accounts in remaining_accounts
    transfer_t22_checked(
        &ctx.accounts.token_program,
        &ctx.accounts.admin_token_account,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.authority,  // admin signs
        TARGET_TOKENS,
        TOKEN_DECIMALS,
        &[],  // admin signs directly, not PDA
        ctx.remaining_accounts,  // hook accounts
    )?;

    Ok(())
}
```

---

## 8. Deployment Order and Pipeline Integration

### 8.1 Modified Deploy Pipeline

The current `deploy-all.sh` pipeline:
```
Phase 0: Generate mint keypairs
Phase 1: Build (with --devnet flag)
Phase 2: Deploy 6 programs
Phase 3: Initialize (mints, PDAs, pools, whitelist, vault)
Phase 4: Verify
```

Modified pipeline for v1.2:
```
Phase 0: Generate mint keypairs + curve program keypair
Phase 1: Build 7 programs (with --devnet flag)
Phase 2: Deploy 7 programs (existing 6 + bonding curve)
Phase 3a: Initialize Base Protocol
    - Create mints (CRIME, FRAUD, PROFIT)
    - Initialize Transfer Hook authority + ExtraAccountMetaLists
    - Initialize bonding curve PDAs (curve_state x2, vaults x4, tax_escrow x2)
    - Whitelist curve token vaults (2 new entries)
    - Fund curves (460M each)
    - Initialize whitelist entries for all known vaults
    - DO NOT initialize AMM pools, epoch, staking, carnage yet
Phase 3b: Start Curves
    - start_curve for CRIME
    - start_curve for FRAUD
    - Both curves now active for 48 hours
Phase 4: [MANUAL] Wait for curves to complete or fail
Phase 5a: If GRADUATED (both filled):
    - prepare_transition (lock curve state)
    - Initialize AMM pools with seed liquidity
    - Initialize conversion vault + seed
    - Initialize epoch state, staking pool, carnage fund
    - Whitelist pool vaults, staking vault, carnage vaults
    - distribute_tax_escrow to carnage
    - finalize_transition
    - Burn AMM admin key
    - Burn whitelist authority
    - Start crank bot
Phase 5b: If FAILED (one or both unfilled):
    - mark_failed on timed-out curves
    - Users claim refunds + tax refunds
    - Protocol does not launch
Phase 6: Verify
```

### 8.2 Feature Flag Considerations

Like the existing programs (vault, tax, epoch), the bonding curve program needs feature-gated mint addresses for devnet vs mainnet builds.

```rust
// In curve_program/src/constants.rs
#[cfg(feature = "devnet")]
pub fn crime_mint() -> Pubkey {
    pubkey!("42WFgfkX...") // devnet CRIME mint
}

#[cfg(not(feature = "devnet"))]
pub fn crime_mint() -> Pubkey {
    pubkey!("MAINNET_CRIME_MINT") // mainnet CRIME mint
}
```

The build.sh already handles patching mint addresses from keypair files. The curve program needs to be added to the two-pass build sequence (similar to vault, tax, epoch).

---

## 9. Existing Patterns to Reuse

### 9.1 Checked Arithmetic (from AMM)

The AMM uses consistent `checked_add/checked_sub/checked_mul` patterns. The curve MUST do the same. No unchecked arithmetic anywhere.

### 9.2 Transfer Hook Helper (from AMM/Staking)

Reuse the `transfer_t22_checked` pattern from `programs/amm/src/helpers/transfers.rs`. This handles:
- Building raw `spl_token_2022::instruction::transfer_checked` instruction
- Appending hook accounts to both ix.accounts and account_infos
- invoke_signed with proper signer seeds

### 9.3 ALT Pattern for Large Transactions

The sell-back instruction has ~15 named accounts + 4 hook remaining_accounts = ~19 accounts. This is within the 1232-byte legacy TX limit (the sell swap path had 23+8=31 accounts). However, the graduation orchestration transactions (AMM::initialize_pool with hook accounts) may need ALT.

**Recommendation:** Build graduation transactions with ALT support from the start. Reuse the existing `alt-helper.ts` pattern. The bonding curve should add its vault addresses to the protocol-wide ALT.

### 9.4 Box'd State Accounts (from Epoch Program)

For instructions with many accounts (execute_transition has 32 in the original spec), Box'd state accounts and AccountInfo passthroughs should be used to stay within the 4KB BPF stack frame. This pattern is proven in `execute_carnage.rs`.

### 9.5 Event Emission Pattern

Follow the existing event pattern: derive events from instruction names, include all relevant state changes, include slot/timestamp for off-chain indexing.

### 9.6 Balance-Diff Pattern (from Tax Program)

For measuring actual tokens transferred after CPI (sell-back: snapshot vault balance before, reload after, diff = actual tokens received):
```rust
let vault_before = ctx.accounts.token_vault.amount;
// ... execute transfer CPI ...
ctx.accounts.token_vault.reload()?;
let actual_received = ctx.accounts.token_vault.amount - vault_before;
```

---

## 10. New vs Modified Components

### 10.1 New Components (to build from scratch)

| Component | Type | Notes |
|-----------|------|-------|
| Bonding Curve Program | Anchor/Rust | 7th on-chain program |
| Curve math module | Rust lib | Linear integral + quadratic solver |
| CurveState account | PDA | 2 instances (CRIME, FRAUD) |
| ParticipantState account | PDA | Per-user per-curve |
| Tax Escrow accounts | PDA | 2 instances (one per curve) |
| Curve instructions | Rust | initialize, fund, start, purchase, sell, mark_failed, claim_refund, claim_tax_refund, prepare_transition, finalize_transition, check_transition_ready |
| Launch page (frontend) | Next.js | New route/modal for bonding curve UI |
| Graduation orchestration script | TypeScript | Multi-TX graduation sequence |

### 10.2 Modified Components (changes to existing code)

| Component | Change | Risk |
|-----------|--------|------|
| `deploy-all.sh` | Add bonding curve to build/deploy sequence | LOW -- additive only |
| `initialize.ts` | Add curve init steps, defer pool/epoch/staking init | MEDIUM -- reordering |
| `build.sh` | Add curve program to devnet feature build | LOW -- follows existing pattern |
| ALT (alt-helper.ts) | Add curve vault addresses | LOW -- additive |
| Transfer Hook whitelist | Add 2 new entries (curve vaults) | LOW -- additive, must happen before burn |
| Frontend routing | Add launch page | LOW -- new route, not changing existing |
| shared/constants.ts | Add curve program ID, PDA derivations | LOW -- additive |

### 10.3 Unchanged Components (no modifications needed)

| Component | Reason |
|-----------|--------|
| AMM Program | Client-side orchestration avoids needing CPI gateway |
| Tax Program | Operates post-graduation only |
| Epoch Program | Operates post-graduation only |
| Staking Program | Operates post-graduation only |
| Transfer Hook Program | Only needs new whitelist entries (additive) |
| Conversion Vault Program | Already has initialize + seed flow |

---

## 11. Suggested Build Order

### Phase 1: Core Curve Program (no sell, no tax escrow)
**Dependencies:** None (standalone program)
**Build:**
1. Anchor program scaffold with declare_id
2. CurveState, ParticipantState account structures
3. Curve math module (linear integral, quadratic solver)
4. initialize_curve instruction
5. fund_curve instruction (transfer 460M tokens to vault)
6. start_curve instruction
7. purchase instruction (with wallet cap, whitelist, deadline)
8. mark_failed instruction
9. claim_refund instruction
10. Unit tests for curve math (precision, edge cases)
11. Integration tests on localnet

### Phase 2: Sell-Back Mechanics (v1.2)
**Dependencies:** Phase 1
**Build:**
1. Add sell instruction
2. Add tax_escrow PDA
3. Reverse curve math (calculate_sol_out)
4. Tax collection (15%) and escrow routing
5. Update ParticipantState with sell tracking
6. claim_tax_refund instruction
7. Unit tests for reverse math
8. Integration tests for sell-back + refund

### Phase 3: Graduation System
**Dependencies:** Phase 1, Phase 2, existing AMM/Vault/Hook programs
**Build:**
1. check_transition_ready instruction
2. prepare_transition instruction (lock curves, stage assets)
3. finalize_transition instruction (mark Transitioned)
4. distribute_tax_escrow instruction (on success)
5. Graduation orchestration script (multi-TX)
6. Integration test: full lifecycle (init -> fund -> start -> buy -> fill -> graduate)
7. Integration test: failure path (init -> fund -> start -> buy -> timeout -> refund)

### Phase 4: Frontend Launch Page
**Dependencies:** Phase 1, Phase 2 (on-chain program)
**Build:**
1. Curve state polling / WebSocket integration
2. Purchase UI with preview
3. Sell-back UI with tax display
4. Progress visualization (both curves side by side)
5. Refund UI for failed curves
6. Real-time price display

### Phase 5: Deployment Pipeline Integration
**Dependencies:** Phase 1-3
**Build:**
1. Add curve program to build.sh
2. Add curve init to initialize.ts (with whitelist entries)
3. Update deploy-all.sh
4. Add curve addresses to ALT
5. Graduation script (separate from deploy-all)
6. Devnet end-to-end test

---

## 12. Frontend Data Flow

### 12.1 Reading Curve State

**Recommendation: Polling with Helius WebSocket hybrid**

**Polling (primary):**
- Read CurveState accounts every 5 seconds during active curve
- Read ParticipantState for current user on wallet connect
- Compute derived values client-side (price, progress %, time remaining)

**WebSocket (supplementary):**
- Subscribe to CurveState account changes via Helius WebSocket
- On change notification, fetch latest state
- Provides near-real-time updates without increasing polling frequency

**Why not pure WebSocket:**
- WebSocket can miss events or disconnect
- Polling provides guaranteed consistency baseline
- Helius WebSocket has credit costs that scale with subscribers

### 12.2 Client-Side Calculations

```typescript
interface CurveDisplay {
    token: 'CRIME' | 'FRAUD';
    status: 'upcoming' | 'active' | 'filled' | 'failed' | 'transitioning' | 'transitioned';
    tokensSold: number;         // net: purchases - sell-backs
    solRaised: number;          // net: purchases - sell-back returns
    taxCollected: number;       // sell-back tax in escrow
    currentPrice: number;       // P(tokensSold)
    percentComplete: number;    // tokensSold / TARGET
    timeRemaining: number;      // seconds until deadline
    userPurchased: number;      // gross tokens bought
    userSoldBack: number;       // tokens sold back
    userNetHolding: number;     // purchased - sold_back
    userRemaining: number;      // wallet cap - net holding
    partnerStatus: CurveDisplay; // the other curve
}

// Preview for sell-back
function previewSell(
    tokenAmount: number,
    currentSold: number,
): SellPreview {
    const grossSol = calculateSolOut(tokenAmount, currentSold);
    const tax = grossSol * 0.15;
    const netSol = grossSol - tax;

    return {
        tokensToSell: tokenAmount,
        grossSolReturn: grossSol,
        taxAmount: tax,
        netSolReturn: netSol,
        newTokensSold: currentSold - tokenAmount,
        newPrice: getCurrentPrice(currentSold - tokenAmount),
    };
}
```

---

## 13. Security Considerations Specific to Integration

### 13.1 Sell-Back Price Manipulation

**Attack:** Buy at low price, then sell at high price after others have pushed the curve up.
**Defense:** This is by design -- early buyers get better prices. The 15% sell tax creates friction. Additionally, the per-wallet cap (20M tokens) limits the scale of any single actor's position.

### 13.2 Coupled Graduation Gaming

**Attack:** Fill one curve, keep the other just below target, then sell-back on the filled curve to cause both to fail.
**Defense:** The `tokens_sold` tracks NET sold (purchases minus sell-backs). If the curve was Filled, selling back could un-fill it (status reverts to Active). This must be handled:

```rust
// After sell-back, check if curve was Filled but is no longer
if curve.tokens_sold < TARGET_TOKENS && curve.status == CurveStatus::Filled {
    curve.status = CurveStatus::Active;
    // Re-emit CurveUnfilled event
}
```

**Is this desired behavior?** This needs discussion. Options:
- (a) Allow unfilling: sell-backs can revert Filled to Active
- (b) Disallow selling when Filled: once filled, no more selling
- (c) Allow selling but don't revert status: status stays Filled even if tokens_sold drops

**Recommendation: Option (b) -- no selling when Filled.** This is simplest and prevents gaming. Once a curve fills, participants are locked in until graduation or partner failure.

### 13.3 Tax Escrow Drainage

**Attack:** Sell and rebuy repeatedly to accumulate tax escrow from your own SOL, then cause failure and claim refund.
**Defense:** The 15% tax means you lose 15% on every sell cycle. The attacker would drain their own SOL doing this. Not profitable.

### 13.4 Whitelist Authority Timing

**Risk:** If whitelist authority is burned before curve vaults are whitelisted, the curve cannot function.
**Defense:** Deploy script must whitelist curve vaults BEFORE burning authority. Explicit check in the script.

### 13.5 Transfer Hook + Sell-Back

**Risk:** When a user sells tokens back to the curve, the transfer goes user_token_account -> curve_token_vault. The hook requires one party to be whitelisted. The curve_token_vault IS whitelisted (as destination), so this works.

**Verification needed:** Confirm that the ExtraAccountMetaList resolution works correctly when the user's whitelist PDA does not exist (data_is_empty() should return true, causing is_whitelisted() to return false, which is fine since destination IS whitelisted).

---

## 14. Confidence Assessment

| Area | Confidence | Basis |
|------|-----------|-------|
| CPI depth analysis | HIGH | Direct code review of all 6 programs + Solana runtime docs |
| Transfer Hook integration | HIGH | Verified whitelist check logic in transfer_hook.rs |
| AMM pool seeding (Option A) | HIGH | Direct code review of initialize_pool.rs constraints |
| Sell-back math | MEDIUM | Based on spec + linear curve math; needs implementation testing |
| Tax escrow proportional refund | MEDIUM | Novel mechanism; needs security review |
| Frontend data flow | MEDIUM | Based on existing patterns; WebSocket behavior needs validation |
| Deployment pipeline changes | HIGH | Direct review of deploy-all.sh and initialize.ts |
| Graduation orchestration | MEDIUM | Multi-TX sequence needs careful error handling |

---

## 15. Open Questions for Discussion

1. **Sell-back when Filled:** Should selling be allowed after a curve reaches Filled status? (Section 13.2)

2. **Sell-back min/max:** What are the minimum sell amount and maximum sell amount per transaction?

3. **Tax escrow routing on partial success:** If both curves fill but graduation fails for a technical reason (e.g., AMM pool init fails), what happens to the tax escrow?

4. **Whitelist verification replacement:** The spec references Privy (removed in v1.1). What verification system replaces it for the curve whitelist?

5. **Coupled graduation atomicity:** With client-side orchestration, what happens if TX2 (CRIME pool init) succeeds but TX3 (FRAUD pool init) fails? Need a recovery/retry mechanism.

6. **Reserve token custody:** During the period between deploy and graduation, who holds the 290M+250M reserve tokens? The admin wallet? A separate reserve PDA?

7. **Post-graduation cleanup:** Should curve PDAs (CurveState, ParticipantState) be closeable after graduation to recover rent?

8. **Curve program upgrade authority:** Should the curve program's upgrade authority be burned after graduation? It has no ongoing role.

---

## 16. Sources

All findings are based on direct source code analysis of:
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/` -- Pool init, swap, transfers, constants
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/` -- Whitelist logic, hook handler, ExtraAccountMetaList
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/` -- CPI patterns, swap_exempt, swap_sol_buy
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/` -- Carnage execution, CPI depth chain
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/` -- Transfer helper pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/conversion-vault/` -- Initialize pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/` -- deploy-all.sh, initialize.ts
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Bonding_Curve_Spec.md` -- Original spec
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/architecture.md` -- System architecture
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/cpi-interface-contract.md` -- CPI interface definitions

CPI depth limit of 4 is confirmed by the existing architecture documentation and the comments in `swap_exempt.rs` (line 11-17) which explicitly document the Solana CPI depth ceiling.
