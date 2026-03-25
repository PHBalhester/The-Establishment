# Protocol-Owned Arbitrage — Final Spec

**Status:** Post-launch upgrade — do NOT implement before mainnet is live and stable
**Authors:** Joe + Claude
**Date:** March 2026
**Prerequisite:** 2-4 weeks of live mainnet data to validate spread patterns and arb economics

---

## The Problem

Every epoch flip creates a price spread between CRIME and FRAUD pools. External arbitrage bots buy the cheap token, convert through the vault, sell the expensive token, and extract the SOL profit from the ecosystem. They pay taxes and LP fees (which is good), but the profit leaves forever.

## The Solution

The protocol does the exact same arbitrage — buying, converting, selling — paying the exact same taxes and LP fees. The only difference: the SOL profit stays in the Carnage Fund instead of leaving the ecosystem.

This creates a volume multiplier: organic trading pushes the spread apart, the protocol arb trades it closed. That arb volume generates:
- **Staking rewards** — 71% of tax on both legs
- **Carnage Fund growth** — 24% of tax + the full arb profit
- **Treasury funding** — 5% of tax
- **Pool depth** — 1% LP fee on both legs stays in reserves

External bots get nothing — the spread is already compressed when they look.

---

## Two Approaches: Small Scale vs Large Scale

We designed two approaches because they serve different pool sizes. The protocol should launch with Approach A and upgrade to Approach B when pool depth warrants it.

### Approach A: Carnage-Funded (launch first)

The Carnage Fund acts as the arb bot. It spends SOL from its own vault to buy cheap tokens, converts them through the conversion vault, and sells the expensive tokens back for more SOL.

**How it works:**
1. Carnage SOL vault provides the buy-leg capital
2. Buys cheap token via `Tax::swap_exempt` (tax calculated and paid separately)
3. Converts cheap→expensive via `Vault::protocol_swap`
4. Sells expensive token via `Tax::swap_exempt`
5. Net WSOL profit stays in Carnage

**Advantages:**
- Simpler — reuses existing `swap_exempt` CPI path (already proven in Carnage execution)
- Only 2 programs change (Epoch + Vault), AMM and Tax unchanged
- Lower risk for first deployment

**Limitation:**
- Carnage SOL vault balance caps the arb size
- At small pool depths (2.5-50 SOL), this isn't a problem — Carnage easily funds the arb
- At large pool depths (1,000+ SOL), Carnage may not have enough capital to compress the full spread

```
Capital scaling:
  Pool depth    Optimal arb     Carnage can fund?
  2.5 SOL       0.20 SOL        Yes — easily
  50 SOL        4 SOL           Yes — Carnage accumulates tax revenue
  500 SOL       40 SOL          Maybe — depends on accumulated balance
  5,000 SOL     400 SOL         No — partial arb only, bots get the rest
```

### Approach B: Pool-Funded (upgrade when pools grow)

Instead of using external capital, the protocol moves tokens and SOL directly between the pools and the conversion vault. The expensive pool's excess SOL funds the rebalance — no Carnage capital needed.

**How it works:**
1. Move tokens from cheap pool token vault → conversion vault → expensive pool token vault
2. Move WSOL from expensive pool SOL vault → cheap pool SOL vault
3. Skim the spread value (profit + tax) from the expensive pool's excess SOL
4. Distribute taxes, deposit profit into Carnage
5. Update both pools' reserves

**Advantages:**
- No capital constraint — scales with pool depth infinitely
- More CPI headroom (max depth 3 vs depth 4)
- Economically identical to Approach A

**Additional complexity:**
- Requires AMM program changes (new `protocol_rebalance` instruction)
- AMM needs to sign with both pool PDAs
- Tax distribution from WSOL requires an intermediary unwrap step
- 3 programs change instead of 2

**Recommendation:** Launch with Approach A. Monitor pool growth. When pools consistently exceed 500 SOL depth and Carnage can't fund full arbs, upgrade to Approach B. Both approaches are implementable via upgrade authority at any time.

---

## Upgradeability Guarantee

**This can be implemented after pools are live, with 100% certainty.** Here's why:

### What the upgrade does

| Program | Change | Why it works on existing accounts |
|---------|--------|----------------------------------|
| Epoch Program | Add `protocol_arb` instruction, +1 byte on EpochState | Reads/writes same EpochState fields. New `rebalance_done` bool added via standard Anchor realloc. |
| Conversion Vault | Add `protocol_swap` instruction | Uses same `vault_config` PDA, same `vault_crime`/`vault_fraud` accounts. VaultConfig struct unchanged. |
| AMM (Approach B only) | Add `protocol_rebalance` instruction | Reads/writes same `reserve_a`/`reserve_b` on existing PoolState. Same PDA seeds, same vault PDAs. PoolState struct unchanged. |

### What must remain true at launch (all confirmed)

1. **Upgrade authority retained** — All programs behind Squads 2-of-3 timelocked multisig. Designed for exactly this scenario.
2. **PoolState layout stable** — No fields added to PoolState. New instructions read/write existing fields at existing byte offsets.
3. **All token accounts exist and are whitelisted** — Vault accounts (250M CRIME, 250M FRAUD), pool vaults, Carnage vaults — all created at init, all whitelisted. No new whitelist entries needed. Whitelist authority CAN be burned at launch.
4. **PDA derivations are deterministic** — Pool PDAs, vault PDA, Carnage PDAs all derive from fixed seeds. New instructions in the same program sign with the same PDAs.

### What could block it (none of these will happen)

| Blocker | Risk | Why it won't happen |
|---------|------|---------------------|
| Upgrade authority burned | Would prevent any program changes | Explicitly retained behind Squads multisig. Only burned after external audit. |
| PoolState struct changed | New instruction couldn't deserialize old accounts | No planned changes to PoolState layout. |
| Vault accounts drained | No tokens to swap through vault | 250M each side, arb uses ~25M/epoch, alternates direction. |
| Whitelist authority needed | Can't whitelist new accounts | No new accounts needed — all transfers between existing whitelisted accounts. |

---

## Concurrent Trading and Front-Running

### Do we need to pause trading during the rebalance?

**No.** Solana handles this naturally:

- **Within a transaction:** Instructions execute sequentially. While `protocol_arb` runs, no other code touches those pool accounts.
- **Across transactions in the same slot:** The validator orders them. Solana's runtime locks mutable accounts — two transactions touching the same pool can't execute concurrently.
- **After the rebalance TX lands:** Pools have new reserves. The next swap uses them. No stale state window.

No pause mechanism, no `locked` flag, no coordination needed. This is identical to how two users submitting swaps in the same slot already works.

### Can the rebalance be front-run?

**Practically no.** The arb direction depends on the VRF result, which is unknown until the Switchboard reveal:

```
Before epoch TX:  VRF sealed in Switchboard oracle. Nobody knows new tax rates
                  or which side becomes cheap. Can't predict arb direction.

Epoch TX lands:   IX 1: Switchboard revealIx (VRF revealed)
                  IX 2: consume_randomness (tax rates derived)
                  IX 3: execute_carnage_atomic (if triggered)
                  IX 4: protocol_arb (spread compressed)

After TX lands:   Spread already compressed. Nothing profitable left for bots.
```

A front-runner would need to predict the VRF output — that's the whole point of Switchboard randomness.

**If protocol_arb is in a separate TX** (fallback if TX size exceeds 1232 bytes):

```
TX 1: revealIx + consume_randomness + execute_carnage_atomic  (existing, unchanged)
TX 2: protocol_arb                                             (new, separate)

Window: 1-2 slots (~400-800ms) between TX 1 landing and TX 2 landing.
```

A bot would need to: detect the epoch flip, read new tax rates, calculate the arb, build a TX, and land it — all in under 800ms. Difficult but theoretically possible. The protocol arb in TX 2 captures whatever spread remains. Even if a bot grabs 30% of the spread, the protocol gets 70%. Still a massive improvement over today (bots get 100%).

### Does this affect Carnage atomicity?

**No.** The protocol arb is a **separate instruction** from Carnage execution. Two designs, both safe:

**Design 1 — Same TX (preferred):**
All four instructions in one TX. If protocol_arb fails, the entire TX reverts — which also reverts consume_randomness and Carnage. To prevent this, protocol_arb should be designed to never fail: return Ok() on any error condition (no spread, insufficient balance, vault empty, etc.).

**Design 2 — Separate TX (fallback):**
TX 1 is identical to today's epoch transition. TX 2 is protocol_arb alone. If TX 2 fails, TX 1 already landed. Epoch still transitioned, Carnage still worked. Bots arb the spread this epoch. No harm — the protocol just missed one arb opportunity.

**Recommendation:** Design 1 (same TX) with protocol_arb coded to never revert — all error paths return Ok() with a descriptive event explaining why the arb was skipped.

---

## Approach A: Detailed Design

This is the initial implementation — Carnage-funded arb.

### Programs Modified

| Program | Change |
|---------|--------|
| Epoch Program | New `protocol_arb` instruction + `rebalance_done` field on EpochState |
| Conversion Vault | New `protocol_swap` instruction |
| AMM | None |
| Tax Program | None |
| Transfer Hook | None |
| Staking | None |

### Transaction Structure

```
TX: Epoch Transition (same as today + one new instruction)
├── IX 1: Switchboard revealIx                    (existing)
├── IX 2: consume_randomness                       (existing)
├── IX 3: execute_carnage_atomic                   (existing)
└── IX 4: protocol_arb                             (NEW)
```

### CPI Depth Map

```
Epoch::protocol_arb (depth 0)
  │
  ├── system_program::transfer ×3 (depth 1)      buy tax: SOL → staking/treasury
  ├── Staking::deposit_rewards (depth 1)          notify staking of new rewards
  │
  ├── Tax::swap_exempt [buy leg] (depth 1)
  │     └── AMM::swap_sol_pool (depth 2)
  │           └── Token-2022::transfer_checked (depth 3)
  │                 └── Transfer Hook::execute (depth 4)  ← SOLANA LIMIT
  │
  ├── Vault::protocol_swap [convert] (depth 1)
  │     └── Token-2022::transfer_checked (depth 2)
  │           └── Transfer Hook::execute (depth 3)
  │
  ├── Tax::swap_exempt [sell leg] (depth 1)
  │     └── AMM::swap_sol_pool (depth 2)
  │           └── Token-2022::transfer_checked (depth 3)
  │                 └── Transfer Hook::execute (depth 4)  ← SOLANA LIMIT
  │
  ├── system_program::transfer ×2 (depth 1)      sell tax: SOL → staking/treasury
  └── Staking::deposit_rewards (depth 1)          notify staking of new rewards
```

Max depth: 4 at the buy and sell legs. Identical to existing Carnage execution depth.

### The Arb Flow — What Happens Step by Step

Using real launch parameters: pools seeded with 2.5 SOL + 290M tokens, 1% LP fee.

**Scenario:** After one epoch of organic trading, CRIME is overpriced and FRAUD is underpriced. Epoch flips — CRIME becomes expensive side, FRAUD becomes cheap side.

```
BEFORE:
  CRIME pool:  2.82 SOL  |  259.5M tokens  |  price = 0.01087 SOL/M tokens
  FRAUD pool:  2.19 SOL  |  319.8M tokens  |  price = 0.00685 SOL/M tokens
  Spread: 1.587:1 (58.7%)
  Carnage SOL vault: 50 SOL

NEW TAX RATES (from VRF):
  FRAUD buy tax:   100 bps (1%)   ← cheap to buy
  CRIME sell tax:  200 bps (2%)   ← cheap to sell
```

**Step 1 — Calculate optimal arb size**

Binary search on constant product formula. Find the SOL input that compresses the spread to ~1.06:1 (the arb threshold). Result: 0.20 SOL.

**Step 2 — Pay buy tax from Carnage SOL vault**

```
Input:      0.20 SOL
Tax rate:   100 bps (1%)
Tax amount: 0.002 SOL
  → 0.00142 SOL to staking_escrow (71%) + deposit_rewards CPI
  → 0.00048 SOL to carnage_sol_vault (24%, self-transfer — skipped)
  → 0.00010 SOL to treasury (5%)
Net to swap: 0.198 SOL
```

**Step 3 — Buy cheap token via swap_exempt**

```
Wrap 0.198 SOL → WSOL in carnage_wsol
CPI: Tax::swap_exempt (FRAUD pool, direction AtoB, amount 0.198 SOL)
  → AMM charges 1% LP fee internally
  → Carnage receives ~26,515,410 FRAUD in carnage_fraud_vault
```

**Step 4 — Convert through vault via protocol_swap**

```
CPI: Vault::protocol_swap (amount: 26,515,410)
  Transfer 1: 26.5M FRAUD from carnage_fraud_vault → vault_fraud_account
  Transfer 2: 26.5M CRIME from vault_crime_account → carnage_crime_vault

Vault balance change: +26.5M FRAUD, -26.5M CRIME
  (same as a bot doing two convert calls — tokens physically go through vault)
```

**Step 5 — Sell expensive token via swap_exempt**

```
CPI: Tax::swap_exempt (CRIME pool, direction BtoA, amount 26,515,410 tokens)
  → AMM charges 1% LP fee internally
  → Carnage receives ~0.262 WSOL in carnage_wsol
```

**Step 6 — Pay sell tax from Carnage SOL vault**

```
Gross output: 0.262 SOL (in WSOL)
Tax rate:     200 bps (2%)
Tax amount:   0.00524 SOL (paid from SOL vault as native SOL)
  → 0.00372 SOL to staking_escrow (71%) + deposit_rewards CPI
  → 0.00126 SOL to carnage_sol_vault (24%, self-transfer — skipped)
  → 0.00026 SOL to treasury (5%)
```

**Final accounting:**

```
Carnage SOL vault:  50.000 → 49.795 SOL  (spent 0.20 + 0.00152 buy tax + 0.00398 sell tax)
Carnage WSOL:        0.000 →  0.262 SOL  (sell proceeds)
──────────────────────────────────────────
Net Carnage gain:              +0.057 SOL

Tax distributed to ecosystem:
  Staking:    0.00514 SOL (71% of 0.00724)
  Treasury:   0.00036 SOL (5% of 0.00724)
  Total:      0.00550 SOL leaving Carnage

LP fees retained in pools:
  FRAUD pool: ~0.00198 SOL (1% of buy leg)
  CRIME pool: ~0.00265 SOL (1% of sell leg)

Volume generated: 0.198 + 0.262 = 0.460 SOL

AFTER:
  CRIME pool:  2.558 SOL  |  286.0M tokens  |  price = 0.00894 SOL/M tokens
  FRAUD pool:  2.388 SOL  |  293.3M tokens  |  price = 0.00814 SOL/M tokens
  New spread: 1.098:1 (9.8% — compressed from 58.7%)
```

The spread isn't fully compressed to 1.06 because taxes and LP fees eat into the arb. A real bot faces identical friction — the protocol captures the same profit a bot would.

### Where the tokens go

```
BEFORE protocol_swap:
  Carnage FRAUD vault:         26.5M FRAUD (just bought from pool)
  Conversion vault FRAUD:     250.0M FRAUD
  Conversion vault CRIME:     250.0M CRIME

AFTER protocol_swap:
  Carnage CRIME vault:         26.5M CRIME (ready to sell into pool)
  Conversion vault FRAUD:     276.5M FRAUD (+26.5M received)
  Conversion vault CRIME:     223.5M CRIME (-26.5M sent out)
```

The FRAUD tokens go INTO the vault. The CRIME tokens come OUT of the vault. This is exactly what happens when a bot calls `convert` twice (FRAUD→PROFIT→CRIME) — the vault receives FRAUD, gives out CRIME. The PROFIT intermediary is an implementation detail that nets to zero.

### Vault balance sustainability

The vault starts with 250M of each IP token. Each arb moves ~25-50M tokens. But the direction alternates with `cheap_side` (75% flip probability each epoch). Over time, the vault stays roughly balanced. Worst case: 10 consecutive same-direction epochs would shift ~250M tokens — but even then the opposite side still has reserves, and user conversions naturally rebalance.

---

## New Instruction: `protocol_swap` (Conversion Vault)

A direct 1:1 swap of IP tokens through the vault's reserves. FRAUD in, CRIME out (or vice versa). No PROFIT intermediary because the conversion rate cancels out: ÷100 × 100 = 1:1.

### Why not use existing `convert` twice?

1. **No PROFIT account** — Carnage doesn't have a PROFIT token vault. Two `convert` calls would require creating and whitelisting one.
2. **Truncation loss** — `convert` loses tokens to integer division: 26,515,410 ÷ 100 = 265,154 PROFIT × 100 = 26,515,400 CRIME (10 tokens lost). `protocol_swap` is exact.
3. **One CPI instead of two** — Half the compute, half the hook account forwarding.
4. **Same vault balance change** — Net result identical: vault gains one IP token, loses the other.

### Account struct

```rust
#[derive(Accounts)]
pub struct ProtocolSwap<'info> {
    /// Authority for source_account token transfers
    pub authority: Signer<'info>,

    #[account(seeds = [VAULT_CONFIG_SEED], bump = vault_config.bump)]
    pub vault_config: Account<'info, VaultConfig>,

    /// Token account holding input tokens (e.g., carnage_fraud_vault)
    #[account(mut)]
    pub source_account: InterfaceAccount<'info, TokenAccount>,

    /// Token account to receive output tokens (e.g., carnage_crime_vault)
    #[account(mut)]
    pub destination_account: InterfaceAccount<'info, TokenAccount>,

    pub input_mint: InterfaceAccount<'info, Mint>,
    pub output_mint: InterfaceAccount<'info, Mint>,

    /// Vault's account for input mint (receives tokens from source)
    #[account(mut, token::authority = vault_config, token::mint = input_mint)]
    pub vault_input: InterfaceAccount<'info, TokenAccount>,

    /// Vault's account for output mint (sends tokens to destination)
    #[account(mut, token::authority = vault_config, token::mint = output_mint)]
    pub vault_output: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    // remaining_accounts: [input_hook_accounts(4), output_hook_accounts(4)]
}
```

### Handler logic

```rust
pub fn handler(ctx: Context<ProtocolSwap>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);

    // Validate both mints are IP tokens (CRIME or FRAUD), not PROFIT
    require!(is_ip_token(&ctx.accounts.input_mint.key()), VaultError::InvalidMintPair);
    require!(is_ip_token(&ctx.accounts.output_mint.key()), VaultError::InvalidMintPair);
    require!(ctx.accounts.input_mint.key() != ctx.accounts.output_mint.key(), VaultError::SameMint);

    // Validate vault has enough output tokens
    require!(ctx.accounts.vault_output.amount >= amount, VaultError::InsufficientVaultBalance);

    // Split hook accounts: [input_hooks(4), output_hooks(4)]
    let (input_hooks, output_hooks) = ctx.remaining_accounts.split_at(ctx.remaining_accounts.len() / 2);

    // Transfer 1: source → vault_input (authority signs via CPI propagation)
    transfer_t22_checked(source → vault_input, authority signs, amount, input_hooks);

    // Transfer 2: vault_output → destination (vault_config PDA signs)
    transfer_t22_checked(vault_output → destination, vault_config signs, amount, output_hooks);

    emit!(ProtocolSwapExecuted { authority, input_mint, output_mint, amount });
    Ok(())
}
```

### Security

Permissionless — anyone can call it. Safe because:
- Caller must own source_account (signs the input transfer)
- 1:1 rate — no profit extraction (give X tokens, get X tokens back)
- Users can already achieve this via two `convert` calls (with slight truncation loss)
- Vault IP balances shift but naturally rebalance from opposite-direction arbs and user conversions

---

## New Instruction: `protocol_arb` (Epoch Program)

### Gating

```rust
// Only runs once per epoch, only after taxes are confirmed
require!(epoch_state.taxes_confirmed, EpochError::NoEpochTransition);
require!(!epoch_state.rebalance_done, EpochError::RebalanceAlreadyDone);
```

`rebalance_done` is set to `true` at the end of `protocol_arb` (whether it executed an arb or no-op'd). Reset to `false` by `consume_randomness` when the next epoch begins.

### Error handling — never reverts

Every error path returns Ok() with a descriptive event. This prevents protocol_arb from reverting the epoch transition TX:

```rust
if spread_ratio < ARB_THRESHOLD {
    emit!(ArbSkipped { reason: "spread_below_threshold", spread_ratio });
    ctx.accounts.epoch_state.rebalance_done = true;
    return Ok(());
}

if available_sol < MIN_ARB_AMOUNT {
    emit!(ArbSkipped { reason: "insufficient_carnage_balance", available_sol });
    ctx.accounts.epoch_state.rebalance_done = true;
    return Ok(());
}

// ... same pattern for vault balance checks, etc.
```

### Tax handling

Taxes are calculated and distributed by `protocol_arb` itself, then the actual swaps use `Tax::swap_exempt` (0% tax at the Tax layer). This is economically identical to a bot calling `swap_sol_buy` + `swap_sol_sell` — same rates, same distribution, same LP fees.

**Why not call `swap_sol_buy`/`swap_sol_sell` directly?** Those instructions expect a user wallet with native SOL (for buy tax) and a WSOL ATA (for swaps). The Carnage fund's accounts are spread across multiple PDAs (sol_vault, carnage_signer, carnage_wsol). Reusing `swap_exempt` + manual tax distribution avoids this mismatch.

**The 24% Carnage self-transfer:** When distributing tax, 24% would go to carnage_sol_vault — but that's where the tax payment comes from. Skip the self-transfer. The effective tax leaving Carnage is 76% (71% staking + 5% treasury).

### Account struct

```rust
#[derive(Accounts)]
pub struct ProtocolArb<'info> {
    pub caller: Signer<'info>,                              // crank wallet
    #[account(mut)] pub epoch_state: Account<'info, EpochState>,

    // Carnage Fund (same accounts as execute_carnage_atomic)
    pub carnage_signer: AccountInfo<'info>,                  // signs swap_exempt CPIs
    #[account(mut)] pub carnage_sol_vault: AccountInfo<'info>, // pays tax, wraps SOL
    #[account(mut)] pub carnage_wsol: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)] pub carnage_crime_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)] pub carnage_fraud_vault: InterfaceAccount<'info, TokenAccount>,

    // Both pools (read reserves + CPI passthrough)
    #[account(mut)] pub crime_pool: AccountInfo<'info>,
    #[account(mut)] pub crime_pool_vault_a: AccountInfo<'info>,
    #[account(mut)] pub crime_pool_vault_b: AccountInfo<'info>,
    #[account(mut)] pub fraud_pool: AccountInfo<'info>,
    #[account(mut)] pub fraud_pool_vault_a: AccountInfo<'info>,
    #[account(mut)] pub fraud_pool_vault_b: AccountInfo<'info>,

    // Mints
    pub wsol_mint: AccountInfo<'info>,
    pub crime_mint: AccountInfo<'info>,
    pub fraud_mint: AccountInfo<'info>,

    // Conversion Vault
    pub vault_config: AccountInfo<'info>,
    #[account(mut)] pub vault_crime_account: AccountInfo<'info>,
    #[account(mut)] pub vault_fraud_account: AccountInfo<'info>,

    // Tax distribution targets
    #[account(mut)] pub staking_escrow: AccountInfo<'info>,
    #[account(mut)] pub treasury: AccountInfo<'info>,
    #[account(mut)] pub stake_pool: AccountInfo<'info>,

    // Programs
    pub tax_program: AccountInfo<'info>,
    pub amm_program: AccountInfo<'info>,
    pub vault_program: AccountInfo<'info>,
    pub staking_program: AccountInfo<'info>,
    pub swap_authority: AccountInfo<'info>,
    pub token_program_spl: AccountInfo<'info>,
    pub token_program_22: AccountInfo<'info>,
    pub system_program: Program<'info, System>,

    // remaining_accounts: [cheap_buy_hooks(4), expensive_sell_hooks(4),
    //                      vault_input_hooks(4), vault_output_hooks(4)]
}
```

~30 named accounts + 16 remaining = 46 total. Existing ALT (55 addresses) covers most of these — heavy overlap with execute_carnage_atomic accounts.

### Account state change

EpochState gains one field:

```rust
pub struct EpochState {
    // ... existing 164 bytes unchanged ...
    pub rebalance_done: bool,  // +1 byte, total = 165 bytes
}
```

Migration: one-time `migrate_epoch_state` instruction that reallocs from 172 → 173 bytes (including discriminator) and sets `rebalance_done = false`.

---

## Approach B: Pool-Funded Design (Future Upgrade)

When pools grow large enough that Carnage can't fund full arbs, upgrade to this approach. The expensive pool's own excess SOL funds the rebalance — zero external capital.

### How it differs from Approach A

| Aspect | A: Carnage-Funded | B: Pool-Funded |
|--------|-------------------|----------------|
| Capital source | Carnage SOL vault | Expensive pool's excess SOL |
| Scaling | Limited by Carnage balance | Unlimited — scales with pool depth |
| AMM changes | None | New `protocol_rebalance` instruction |
| CPI max depth | 4 (at Solana limit) | 3 or 4 (more headroom) |
| Tax payment source | Carnage native SOL | Expensive pool WSOL (unwrapped via intermediary) |
| Token movement | Carnage vault ↔ pools ↔ conversion vault | Pool vaults ↔ conversion vault (direct) |

### Pool-funded flow

```
1. AMM::protocol_rebalance reads both pool reserves
2. Calculates token delta and SOL delta
3. CPI: Vault::protocol_swap
   → Moves tokens: cheap pool vault → vault → expensive pool vault
   → AMM signs with cheap pool PDA (source authority)
4. SPL Token transfer: WSOL from expensive pool vault → cheap pool vault
   → AMM signs with expensive pool PDA
5. Extract profit + tax WSOL from expensive pool → intermediary
6. Close intermediary → unwrap to native SOL
7. Distribute: staking (71%), treasury (5%), Carnage (24% + profit)
8. CPI: Staking::deposit_rewards
9. Update reserves on both pools
```

### CPI depth (pool-funded)

```
AMM::protocol_rebalance (depth 0 if top-level, depth 1 if called from Epoch)
  ├── Vault::protocol_swap (depth 1/2) → Token-2022(2/3) → Hook(3/4)
  ├── SPL Token::transfer (depth 1/2) → WSOL pool-to-pool
  └── SPL Token::close_account (depth 1/2) → unwrap intermediary

If top-level (depth 0): max depth = 3. Very comfortable.
If via Epoch CPI (depth 1): max depth = 4. At Solana limit but valid.
```

### Additional AMM account struct (Approach B)

```rust
#[derive(Accounts)]
pub struct ProtocolRebalance<'info> {
    pub rebalance_authority: Signer<'info>,  // Epoch PDA or crank with gating
    #[account(mut)] pub crime_pool: Account<'info, PoolState>,
    #[account(mut)] pub fraud_pool: Account<'info, PoolState>,
    #[account(mut)] pub crime_pool_sol_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)] pub crime_pool_token_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)] pub fraud_pool_sol_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)] pub fraud_pool_token_vault: InterfaceAccount<'info, TokenAccount>,
    pub vault_config: AccountInfo<'info>,
    #[account(mut)] pub vault_crime_account: AccountInfo<'info>,
    #[account(mut)] pub vault_fraud_account: AccountInfo<'info>,
    pub crime_mint: AccountInfo<'info>,
    pub fraud_mint: AccountInfo<'info>,
    pub wsol_mint: AccountInfo<'info>,
    #[account(mut)] pub wsol_intermediary: AccountInfo<'info>,  // for WSOL unwrap
    #[account(mut)] pub staking_escrow: AccountInfo<'info>,
    #[account(mut)] pub carnage_sol_vault: AccountInfo<'info>,
    #[account(mut)] pub treasury: AccountInfo<'info>,
    pub vault_program: AccountInfo<'info>,
    pub token_program_22: Interface<'info, TokenInterface>,
    pub token_program_spl: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: hook accounts
}
```

---

## Configuration

```rust
/// Minimum spread to trigger arb. At 6%, the worst-case tax combination
/// (4% buy + 4% sell + 2% LP = 10%) still leaves the arb with margin on
/// any spread above 10%. The 6% threshold provides early entry before
/// the spread reaches the break-even point.
pub const ARB_THRESHOLD_SCALED: u64 = 10_600;  // 1.06:1

/// Maximum pool reserve percentage to move per arb. Safety cap against
/// massive single-operation reserve swings.
pub const MAX_ARB_BPS: u64 = 1_000;  // 10%

/// Minimum SOL to retain in Carnage vault after arb.
/// Covers rent-exempt minimum (~0.89 SOL) + runway for epoch bounties.
pub const MIN_CARNAGE_RESERVE: u64 = 1_000_000_000;  // 1 SOL

/// Maximum SOL for a single arb buy leg. Hard ceiling even if spread
/// is enormous. Can be increased via program upgrade as pools grow.
pub const MAX_ARB_SOL: u64 = 5_000_000_000;  // 5 SOL (Approach A)
```

### Why 6% threshold?

The arb path pays: buy tax (1-4%) + sell tax (1-4%) + LP fee (1%) on each leg. Minimum friction: 1% + 1% + 1% + 1% = 4%. Maximum friction: 4% + 4% + 1% + 1% = 10%. At 6% spread, the best-case profit is 2% (enough to be worth executing). Some tax rolls make 6% unprofitable — the instruction detects this and skips those epochs (net-positive check before executing).

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No spread / below threshold | Return Ok(), set `rebalance_done = true`, emit `ArbSkipped` |
| Spread in opposite direction (FRAUD > CRIME) | Instruction reads `cheap_side` from EpochState, swaps in correct direction |
| Carnage SOL vault near-empty | Cap arb at available balance minus `MIN_CARNAGE_RESERVE`. If zero available, skip. |
| Vault doesn't have enough tokens | Cap token amount to vault's available balance. If zero, skip. |
| Carnage already executed this epoch | Pool reserves already changed. protocol_arb reads post-Carnage reserves — correct by construction. |
| Carnage is holding tokens from Carnage execution | Only convert arb-bought tokens (snapshot balance before buy, use delta). Carnage holdings are separate. |
| TX too large for one transaction | Split into TX1 (epoch transition) and TX2 (protocol_arb). Brief bot window but protocol captures remaining spread. |
| First epoch after launch | Pools have identical reserves, no spread. Returns Ok() immediately. |
| Epoch skipped (crank delayed) | Larger spread accumulated. Arb captures more profit. Previous missed epochs were bot-arbed (same as today). |
| Integer overflow in arb math | All k-invariant calculations use u128. Max k with 10,000 SOL pool: ~3.2 × 10^24, within u128 range (~3.4 × 10^38). |

---

## Existing Infrastructure Reused

| Component | Status | Used for |
|-----------|--------|----------|
| Carnage WSOL account | Exists | Buy/sell swap intermediary |
| Carnage CRIME/FRAUD vaults | Exist | Hold tokens between convert and sell |
| Carnage SOL vault | Exists | Funds buy leg + tax payments |
| `Tax::swap_exempt` | Exists | Both swap legs (Carnage already uses this) |
| `execute_swap_exempt_cpi` helper | Exists | CPI builder in `carnage_execution.rs` |
| `split_distribution` math | Exists | Tax splitting (copy/inline from tax-program) |
| `calculate_tax` math | Exists | Tax calculation (copy/inline from tax-program) |
| `read_pool_reserves` | Exists | Raw byte reading of PoolState reserves |
| Hook account forwarding | Exists | `HOOK_ACCOUNTS_PER_MINT = 4`, partition logic |
| Address Lookup Table | Exists | 55 addresses covering pools/mints/programs |
| Crank TX builder | Exists | Already builds multi-instruction epoch TXs |

### New code estimate

| Component | Lines (approx) |
|-----------|---------------|
| `protocol_swap` handler + accounts (Vault) | ~90 |
| `protocol_arb` handler + accounts (Epoch) | ~250 |
| `calculate_optimal_buy` arb math | ~50 |
| `execute_protocol_swap_cpi` helper | ~60 |
| EpochState migration instruction | ~30 |
| Crank TX builder update | ~50 |
| Unit tests (arb math) | ~200 |
| Integration tests (LiteSVM) | ~400 |
| **Total** | **~1,130** |

---

## Testing and Deployment Plan

### Phase 1: Develop (devnet)
1. Implement `protocol_swap` on Vault
2. Implement `protocol_arb` on Epoch
3. Unit test arb math (binary search, edge cases, overflow)
4. LiteSVM integration tests (full arb flow with mock pools/vault)

### Phase 2: Validate (devnet)
1. Deploy updated programs to devnet
2. Run live epoch transitions with arb enabled
3. Verify: taxes distributed correctly, pool reserves update, vault balances shift
4. Verify: `rebalance_done` prevents double-arb, resets on epoch flip
5. Verify: no-op behavior when spread below threshold

### Phase 3: Audit
1. SOS audit on `protocol_swap` and `protocol_arb`
2. BOK formal verification on arb math (constant product preservation)
3. Fix any findings

### Phase 4: Deploy (mainnet)
1. Deploy updated Vault via timelocked Squads multisig
2. Deploy updated Epoch via timelocked Squads multisig
3. Wait timelock period
4. Execute upgrades
5. Update crank
6. Monitor first few epochs — verify arb executes correctly
7. Tune `ARB_THRESHOLD` based on observed data

---

## Economic Impact Estimates

Based on launch parameters (2.5 SOL pools, 290M tokens, 30-min epochs).

### Per epoch (moderate 10% organic spread)

```
Arb input:          ~0.05-0.10 SOL
Volume generated:   ~0.10-0.20 SOL (buy + sell)
Tax generated:      ~0.003-0.006 SOL
  Staking (71%):    ~0.002-0.004 SOL
  Carnage (24%):    ~0.001-0.001 SOL
  Treasury (5%):    ~0.0002-0.0003 SOL
LP deepening:       ~0.001-0.002 SOL per pool
Carnage profit:     ~0.005-0.015 SOL
```

### Daily (48 epochs)

```
Arb volume:             4.8-9.6 SOL/day
Staking reward boost:   0.10-0.21 SOL/day
Carnage growth:         0.24-0.72 SOL/day (profit) + 0.03-0.07 SOL/day (24% tax)
Pool deepening:         0.048-0.096 SOL/day
```

### The flywheel

```
Carnage SOL grows → more token burns → less PROFIT supply
→ higher PROFIT value → better staking yield
→ more stakers → more organic volume
→ bigger spreads → more arb profit → more Carnage SOL
```

Without protocol arb: bots extract the spread, breaking the flywheel.
With protocol arb: 100% of spread value recycled into the ecosystem.

---

## Decisions Made

These were open questions during design. Documenting the decisions here.

| Question | Decision | Rationale |
|----------|----------|-----------|
| Same TX or separate TX? | Same TX preferred, separate TX as fallback | Same TX eliminates front-running window entirely. protocol_arb coded to never revert (all errors → Ok + event). If TX size exceeds 1232 bytes, fall back to separate TX. |
| Which tax rates for the arb? | New epoch's rates | The spread was created under old rates. Bots would arb using the new cheap rates. Protocol should match bot behavior. consume_randomness sets new rates before protocol_arb runs. |
| Carnage holding tokens from same epoch? | Snapshot before buy, use delta only | protocol_arb snapshots Carnage token balance before the buy leg. Only converts the delta (newly bought tokens). Carnage's pre-existing holdings from execute_carnage_atomic are left untouched. |
| ARB_THRESHOLD value? | 6% initial, tune with mainnet data | Conservative start. Lower thresholds capture more spread but risk unprofitable arbs on high-tax epochs. Can be adjusted via program upgrade. |
| Approach A or B first? | A first, B when pools exceed ~500 SOL | Approach A is simpler, lower risk, sufficient for launch-scale pools. Approach B adds AMM complexity but eliminates capital constraint. Both deployable via upgrade authority. |
| Implement before launch? | No — post-launch upgrade only | Too complex to rush. Protocol works fine without it (bots handle spread). 2-4 weeks of mainnet data needed to validate arb economics before building. |
