# External Arbitrage Bot Specification — Dr. Fraudsworth's Finance Factory

**Purpose:** This document contains everything needed to build an off-chain arbitrage bot that exploits price spreads between the CRIME/SOL and FRAUD/SOL pools by routing through the PROFIT conversion vault.

**Date:** March 2026

---

## Table of Contents

1. [Protocol Overview](#1-protocol-overview)
2. [The Arbitrage Opportunity](#2-the-arbitrage-opportunity)
3. [On-Chain Addresses (Mainnet)](#3-on-chain-addresses-mainnet)
4. [Pool Mechanics (AMM)](#4-pool-mechanics-amm)
5. [Tax System](#5-tax-system)
6. [Epoch System & Tax Rate Discovery](#6-epoch-system--tax-rate-discovery)
7. [Conversion Vault](#7-conversion-vault)
8. [Transfer Hook & Whitelist](#8-transfer-hook--whitelist)
9. [Swap Instructions — Full Account Structs](#9-swap-instructions--full-account-structs)
10. [The Arb Route — Step by Step](#10-the-arb-route--step-by-step)
11. [Quoting & Profitability Calculation](#11-quoting--profitability-calculation)
12. [Transaction Construction](#12-transaction-construction)
13. [Address Lookup Table (ALT)](#13-address-lookup-table-alt)
14. [Monitoring & Timing Strategy](#14-monitoring--timing-strategy)
15. [Edge Cases & Gotchas](#15-edge-cases--gotchas)
16. [Reference Implementation Pointers](#16-reference-implementation-pointers)
17. [Appendix: PDA Derivation Reference](#17-appendix-pda-derivation-reference)

---

## 1. Protocol Overview

Dr. Fraudsworth's Finance Factory is a Solana DeFi protocol with three tokens:

| Token | Mint Address | Decimals | Role |
|-------|-------------|----------|------|
| **CRIME** | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` | 6 | Faction token (IP token) |
| **FRAUD** | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` | 6 | Faction token (IP token) |
| **PROFIT** | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` | 6 | Staking/governance token |

**All three tokens are Token-2022 (SPL Token 2022) with Transfer Hook extensions.** This is critical — every transfer of these tokens triggers the Transfer Hook program, which enforces a whitelist. Standard SPL Token transfer instructions will fail.

The protocol has two AMM pools (CRIME/SOL and FRAUD/SOL) and a Conversion Vault that converts between faction tokens and PROFIT at a fixed 100:1 rate. A dynamic tax system changes rates every ~30 minutes (epoch), creating price dislocations between the two pools that can be arbitraged.

---

## 2. The Arbitrage Opportunity

### Why It Exists

Every epoch (~30 minutes on mainnet), a VRF (Verifiable Random Function) determines new tax rates. One faction becomes "cheap" (low buy tax, high sell tax) and the other becomes "expensive" (high buy tax, low sell tax). This asymmetry, combined with organic trading, creates price spreads between the CRIME/SOL and FRAUD/SOL pools.

### The Two Routes

**Route A: SOL → CRIME → PROFIT → FRAUD → SOL**
1. Buy CRIME with SOL (via Tax Program's `swap_sol_buy`)
2. Convert CRIME → PROFIT (via Conversion Vault's `convert`, 100 CRIME = 1 PROFIT)
3. Convert PROFIT → FRAUD (via Conversion Vault's `convert`, 1 PROFIT = 100 FRAUD)
4. Sell FRAUD for SOL (via Tax Program's `swap_sol_sell`)

**Route B: SOL → FRAUD → PROFIT → CRIME → SOL**
1. Buy FRAUD with SOL (via Tax Program's `swap_sol_buy`)
2. Convert FRAUD → PROFIT (via Conversion Vault's `convert`, 100 FRAUD = 1 PROFIT)
3. Convert PROFIT → CRIME (via Conversion Vault's `convert`, 1 PROFIT = 100 CRIME)
4. Sell CRIME for SOL (via Tax Program's `swap_sol_sell`)

**The bot checks both routes and executes whichever returns more SOL than the input.**

### Friction Costs (Per Round Trip)

| Cost Component | Buy Leg | Sell Leg | Total |
|---------------|---------|----------|-------|
| Tax (dynamic) | 1-4% of SOL input | 1-4% of SOL output | 2-8% |
| LP Fee (fixed) | 1% of post-tax input | 1% of token input | ~2% |
| Vault Conversion | Free (but integer division truncation on CRIME/FRAUD→PROFIT) | Free | ~0% |
| **Total Friction** | | | **~4-10%** |

The spread between pools must exceed total friction for the arb to be profitable.

---

## 3. On-Chain Addresses (Mainnet)

### Program IDs

| Program | Address |
|---------|---------|
| AMM | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` |
| Tax Program | `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj` |
| Epoch Program | `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2` |
| Conversion Vault | `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` |
| Transfer Hook | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` |
| Staking | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| System Program | `11111111111111111111111111111111` |
| NATIVE_MINT (wSOL) | `So11111111111111111111111111111111111111112` |

### Token Mints

| Token | Address | Token Program |
|-------|---------|--------------|
| CRIME | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` | Token-2022 |
| FRAUD | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` | Token-2022 |
| PROFIT | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` | Token-2022 |
| wSOL | `So11111111111111111111111111111111111111112` | SPL Token (legacy) |

### Pool Accounts

**CRIME/SOL Pool:**
| Account | Address |
|---------|---------|
| Pool State PDA | `ZWUZ3PzGk6bg6g3BS3WdXKbdAecUgZxnruKXQkte7wf` |
| Vault A (wSOL side) | `14rFLiXzXk7aXLnwAz2kwQUjG9vauS84AQLu6LH9idUM` |
| Vault B (CRIME side) | `6s6cprCGxTAYCk9LiwCpCsdHzReW7CLZKqy3ZSCtmV1b` |

**FRAUD/SOL Pool:**
| Account | Address |
|---------|---------|
| Pool State PDA | `AngvViTVGd2zxP8KoFUjGU3TyrQjqeM1idRWiKM8p3mq` |
| Vault A (wSOL side) | `3sUDyw1k61NSKgn2EA9CaS3FbSZAApGeCRNwNFQPwg8o` |
| Vault B (FRAUD side) | `2nzqXn6FivXjPSgrUGTA58eeVUDjGhvn4QLfhXK1jbjP` |

> **IMPORTANT — Canonical Mint Ordering:** The AMM stores pools with mints sorted by raw byte value. `NATIVE_MINT (0x06...)` is always less than any other mint, so for SOL pools, Vault A = wSOL and Vault B = token. Always verify by reading the pool state's `mint_a` field at bytes [9..41].

### Key PDAs

| PDA | Address | Program |
|-----|---------|---------|
| Swap Authority | `CoCdbornGtiZ8tLxF5HD2TdGidfgfwbbiDX79BaZGJ2D` | Tax Program |
| Tax Authority | `8zijSBnoiGQzwccQkdNuAwbZCieDZsxdn2GgKDErCemQ` | Tax Program |
| wSOL Intermediary | `2HPNULWVVdTcRiAm2DkghLA6frXxA2Nsu4VRu8a4qQ1s` | Tax Program |
| Epoch State | `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU` | Epoch Program |
| Stake Pool | `5BdRPPwEDpHEtRgdp4MfywbwmZnrf6u23bXMnG1w8ViN` | Staking |
| Escrow Vault (Staking) | `E68zPDgzMqnycj23g9T74ioHbDdvq3Npj5tT2yPd1SY` | Staking |
| Vault Config | `8vFpSBnCVt8dfX57FKrsGwy39TEo1TjVzrj9QYGxCkcD` | Conversion Vault |
| Vault CRIME Account | `Gh9QHMY3J2NGyaHFH2XQCWxedf4G7kBfyu7Jonwn1bHA` | Conversion Vault |
| Vault FRAUD Account | `DLciB9t3qEuRcndGyjRmu1Z34NCwTPvNwbv7eUsFxTZG` | Conversion Vault |
| Vault PROFIT Account | `DBMaWgfUW8WBb8VVvqDFkrMpEkPkCPTcLpSpyzHAiwp3` | Conversion Vault |
| Carnage SOL Vault | `5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT` | Epoch Program |
| Treasury | `3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv` | (wallet) |
| Whitelist Authority | `J3cjg1HFPda9tfCFEUx1vqKqmeDeda8s76RVweLeYpJe` | Transfer Hook |
| Staking Authority | `2b73P2EmjmYMi6jiUYEhn3DMW6aXeBuSnV4Jx8wjqWBt` | Staking |

### Hook ExtraAccountMetaList PDAs

| Mint | ExtraAccountMetaList Address |
|------|------------------------------|
| CRIME | `CStTzemevJvk8vnjw57Wjzk5EFwN12Nmniz6R7qXWykr` |
| FRAUD | `7QGodnZAYGgastQMXcitcQjraYCMMNDgbp2uL73qjGkd` |
| PROFIT | `J4dubfKw7vnZLhpPfMHqz8PcYWaChugnnSGUgGDzQ9AB` |

---

## 4. Pool Mechanics (AMM)

### Constant Product Formula

The AMM uses a standard `x * y = k` constant product invariant.

```
effective_input = amount_in × (10,000 - lp_fee_bps) / 10,000
amount_out = reserve_out × effective_input / (reserve_in + effective_input)
```

- **LP Fee:** 100 bps (1%) — deducted from input before the swap. Stays in pool reserves (deepens liquidity).
- **All math uses u128 intermediates** to prevent overflow.
- **k-invariant enforced:** `k_after >= k_before` checked after every swap.
- **Reentrancy guard:** Pool has a `locked` flag set during swap execution.

### Reading Pool Reserves

Pool reserves are stored in the `PoolState` account. The layout (from byte offset 0, after the 8-byte Anchor discriminator):

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | `locked` (bool) |
| 1 | 8 | `mint_a` (first 8 bytes... actually 32 bytes) |

**Corrected PoolState layout (after 8-byte discriminator):**

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | `locked` (bool) |
| 1 | 32 | `mint_a` (Pubkey) |
| 33 | 32 | `mint_b` (Pubkey) |
| 65 | 32 | `vault_a` (Pubkey) |
| 97 | 32 | `vault_b` (Pubkey) |
| 129 | 8 | `reserve_a` (u64, little-endian) |
| 137 | 8 | `reserve_b` (u64, little-endian) |
| 145 | 2 | `lp_fee_bps` (u16) |
| ... | ... | remaining fields |

**To read reserves:** Fetch the pool account data, skip the 8-byte discriminator, then read `reserve_a` at byte offset 129 and `reserve_b` at offset 137 (both as little-endian u64).

**Verify mint ordering:** Read `mint_a` at offset 1 (32 bytes). For SOL pools, `NATIVE_MINT` (starting with `0x06...`) is always `mint_a`, and the faction token is `mint_b`. This means `reserve_a` = SOL reserves, `reserve_b` = token reserves.

---

## 5. Tax System

All swaps go through the **Tax Program** — you cannot swap directly on the AMM. The Tax Program wraps AMM swaps with dynamic tax collection.

### Tax on Buy (SOL → Token)

Tax is deducted from **INPUT** (SOL) before the swap:

```
tax = amount_in × tax_bps / 10,000         (u128 intermediate)
sol_to_swap = amount_in - tax
→ sol_to_swap goes to AMM
→ tax is distributed immediately
```

### Tax on Sell (Token → SOL)

Tax is deducted from **OUTPUT** (SOL) after the swap:

```
→ Full token amount sent to AMM
gross_sol_output = AMM swap result
tax = gross_sol_output × tax_bps / 10,000   (u128 intermediate)
net_sol_output = gross_sol_output - tax
→ net_sol_output goes to user
→ tax is distributed
```

### Tax Distribution (71/24/5 Split)

Every tax payment is split:

| Destination | Share | Account |
|-------------|-------|---------|
| Staking Escrow | 71% | `E68zPDgzMqnycj23g9T74ioHbDdvq3Npj5tT2yPd1SY` |
| Carnage SOL Vault | 24% | `5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT` |
| Treasury | 5% | `3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv` |

Distribution math:
```
staking = floor(total_tax × 7100 / 10,000)
carnage = floor(total_tax × 2400 / 10,000)
treasury = total_tax - staking - carnage    (absorbs rounding dust)

// Micro-tax edge case: if total_tax < 4 lamports → (total_tax, 0, 0)
```

### Minimum Output Floor (SEC-10)

The Tax Program enforces a **50% minimum output floor** as sandwich protection:

```
expected_output = reserve_out × amount_in / (reserve_in + amount_in)
floor = expected_output × 5000 / 10,000   (50%)
require!(user_minimum_output >= floor)
```

For your arb bot, set `minimum_amount_out` to something reasonable (e.g., 95% of expected output). Setting it too low risks sandwich attacks against you; setting it too high risks failed transactions from natural slippage.

---

## 6. Epoch System & Tax Rate Discovery

### EpochState Account

**Address:** `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU`
**Owner:** Epoch Program (`4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2`)
**Total size:** 172 bytes (8 discriminator + 164 data)

**Layout (after 8-byte Anchor discriminator):**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 8 | `genesis_slot` | Slot when protocol launched |
| 8 | 4 | `current_epoch` | Current epoch number |
| 12 | 8 | `epoch_start_slot` | Slot when current epoch began |
| 20 | 1 | `cheap_side` | **0 = CRIME is cheap, 1 = FRAUD is cheap** |
| 21 | 2 | `low_tax_bps` | Low tax rate (100-400 bps, i.e., 1-4%) |
| 23 | 2 | `high_tax_bps` | High tax rate (1100-1400 bps, i.e., 11-14%) |
| 25 | 2 | `crime_buy_tax_bps` | Current CRIME buy tax |
| 27 | 2 | `crime_sell_tax_bps` | Current CRIME sell tax |
| 29 | 2 | `fraud_buy_tax_bps` | Current FRAUD buy tax |
| 31 | 2 | `fraud_sell_tax_bps` | Current FRAUD sell tax |
| 33 | 8 | `vrf_request_slot` | Slot of last VRF request |
| 41 | 1 | `vrf_pending` | VRF result pending |
| 42 | 1 | `taxes_confirmed` | New tax rates confirmed |
| 43 | 32 | `pending_randomness_account` | Switchboard VRF account |
| 75 | 1 | `carnage_pending` | Carnage execution pending |
| 76 | 1 | `carnage_target` | 0=CRIME, 1=FRAUD |
| 77 | 1 | `carnage_action` | 0=buy+burn, 1=sell |
| 78 | 8 | `carnage_deadline_slot` | Carnage must execute by this slot |
| 86 | 8 | `carnage_lock_slot` | Carnage lock slot |
| 94 | 4 | `last_carnage_epoch` | Last epoch Carnage triggered |
| 98 | 64 | `reserved` | Padding for future use |
| 162 | 1 | `initialized` | Account initialized flag |
| 163 | 1 | `bump` | PDA bump seed |

**All multi-byte values are little-endian.**

### Tax Rate Logic

The `cheap_side` field determines which token has low taxes:

| cheap_side | CRIME Buy | CRIME Sell | FRAUD Buy | FRAUD Sell |
|------------|-----------|------------|-----------|------------|
| 0 (CRIME cheap) | `low_tax_bps` | `high_tax_bps` | `high_tax_bps` | `low_tax_bps` |
| 1 (FRAUD cheap) | `high_tax_bps` | `low_tax_bps` | `low_tax_bps` | `high_tax_bps` |

You can also just read the pre-computed fields directly: `crime_buy_tax_bps`, `crime_sell_tax_bps`, `fraud_buy_tax_bps`, `fraud_sell_tax_bps`.

### Tax Rate Ranges

- **Low tax:** 100, 200, 300, or 400 bps (1-4%)
- **High tax:** 1100, 1200, 1300, or 1400 bps (11-14%)
- **Genesis rates** (before first VRF): low=300, high=1400

### Epoch Timing

- **Mainnet epoch duration:** 4,500 slots (~30 minutes at 400ms/slot)
- **Rate change:** Happens when `consume_randomness` is called (by the crank) after VRF reveal
- Rates change with ~75% probability each epoch (flip of `cheap_side`)

### Arb Implications

**Buy the cheap side, sell the expensive side.** The optimal direction is:
- If `cheap_side == 0` (CRIME cheap): Buy CRIME (1-4% tax), convert → FRAUD, sell FRAUD (1-4% sell tax)
- If `cheap_side == 1` (FRAUD cheap): Buy FRAUD (1-4% tax), convert → CRIME, sell CRIME (1-4% sell tax)

The "expensive" buy tax (11-14%) and the "cheap" sell tax (11-14%) make the reverse direction prohibitively expensive.

---

## 7. Conversion Vault

### Overview

The Conversion Vault converts between faction tokens (CRIME/FRAUD) and PROFIT at a **fixed 100:1 rate with zero fees**.

| Direction | Rate | Example |
|-----------|------|---------|
| CRIME → PROFIT | ÷ 100 (integer division) | 26,515,410 CRIME → 265,154 PROFIT |
| FRAUD → PROFIT | ÷ 100 (integer division) | 26,515,410 FRAUD → 265,154 PROFIT |
| PROFIT → CRIME | × 100 | 265,154 PROFIT → 26,515,400 CRIME |
| PROFIT → FRAUD | × 100 | 265,154 PROFIT → 26,515,400 FRAUD |

**WARNING — Truncation Loss:** Converting faction→PROFIT→faction loses tokens to integer division. `26,515,410 ÷ 100 = 265,154` then `265,154 × 100 = 26,515,400` — you lose 10 tokens. To minimise this, ensure your faction token amount is a multiple of 100, OR accept the tiny dust loss.

### Convert Instruction

The `convert` instruction on the Conversion Vault program handles all four conversion directions.

**Account structure (9 named accounts + 8 remaining):**

| # | Account | Writable | Signer | Description |
|---|---------|----------|--------|-------------|
| 0 | `user` | No | Yes | Your wallet |
| 1 | `vault_config` | No | No | Vault Config PDA (seeds: `[b"vault_config"]`) |
| 2 | `user_input_account` | Yes | No | Your token account for the input mint |
| 3 | `user_output_account` | Yes | No | Your token account for the output mint |
| 4 | `input_mint` | No | No | Mint of the token you're sending |
| 5 | `output_mint` | No | No | Mint of the token you're receiving |
| 6 | `vault_input` | Yes | No | Vault's token account for input mint |
| 7 | `vault_output` | Yes | No | Vault's token account for output mint |
| 8 | `token_program` | No | No | Token-2022 program ID |

**remaining_accounts (8 accounts):** `[input_hook_accounts(4), output_hook_accounts(4)]`

The vault splits remaining_accounts at the midpoint. First 4 = hook accounts for the input transfer, last 4 = hook accounts for the output transfer.

### Two Conversions Required for Arb

To go from CRIME → FRAUD (or vice versa), you need **two convert calls**:

1. `convert(crime_amount)` — CRIME → PROFIT (input=CRIME, output=PROFIT)
2. `convert(profit_amount)` — PROFIT → FRAUD (input=PROFIT, output=FRAUD)

You need token accounts for all three mints (CRIME, FRAUD, PROFIT) in your wallet.

---

## 8. Transfer Hook & Whitelist

### The Whitelist Rule

Every transfer of CRIME, FRAUD, or PROFIT tokens triggers the Transfer Hook program. The hook enforces: **at least one party (source OR destination token account) must be whitelisted.**

### What This Means for Your Bot

Your bot's token accounts are NOT whitelisted. But that's fine — all swaps route through the Tax Program, whose accounts (pool vaults, swap authority, etc.) ARE whitelisted. As long as you interact through the Tax Program's `swap_sol_buy` / `swap_sol_sell` instructions and the Conversion Vault's `convert` instruction, the counterparty in every transfer is a whitelisted protocol account.

**You do NOT need to be whitelisted to run the arb bot.** You just can't do direct peer-to-peer token transfers.

### Hook Account Resolution

Every Token-2022 transfer requires 4 extra accounts appended as "remaining accounts":

| # | Account | How to Derive |
|---|---------|---------------|
| 0 | ExtraAccountMetaList | PDA: seeds `[b"extra-account-metas", mint.as_ref()]` @ Transfer Hook program |
| 1 | Source Whitelist Entry | PDA: seeds `[b"whitelist", source_token_account.as_ref()]` @ Transfer Hook program |
| 2 | Dest Whitelist Entry | PDA: seeds `[b"whitelist", dest_token_account.as_ref()]` @ Transfer Hook program |
| 3 | Transfer Hook Program | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` (read-only) |

**The whitelist entry PDAs may or may not exist on-chain.** If the account doesn't exist (empty/zeroed), the hook interprets it as "not whitelisted." The PDA is still passed — you're passing the *address* where the entry *would* be. The hook program checks if that address has data.

**All 4 hook accounts are derived deterministically** — no RPC calls needed. Just compute the PDAs.

---

## 9. Swap Instructions — Full Account Structs

### swap_sol_buy (SOL → Token)

**Program:** Tax Program (`43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj`)
**Instruction discriminator:** `sha256("global:swap_sol_buy")[0..8]`
**Args:** `(amount_in: u64, minimum_output: u64, is_crime: bool)`

| # | Account | Writable | Signer | Address / Derivation |
|---|---------|----------|--------|---------------------|
| 0 | `user` | Yes | Yes | Your wallet |
| 1 | `epoch_state` | No | No | `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU` |
| 2 | `swap_authority` | No | No | `CoCdbornGtiZ8tLxF5HD2TdGidfgfwbbiDX79BaZGJ2D` |
| 3 | `tax_authority` | No | No | `8zijSBnoiGQzwccQkdNuAwbZCieDZsxdn2GgKDErCemQ` |
| 4 | `pool` | Yes | No | Pool State PDA (CRIME or FRAUD pool) |
| 5 | `pool_vault_a` | Yes | No | Pool's wSOL vault |
| 6 | `pool_vault_b` | Yes | No | Pool's token vault |
| 7 | `mint_a` | No | No | `So11111111111111111111111111111111111111112` (wSOL) |
| 8 | `mint_b` | No | No | CRIME or FRAUD mint |
| 9 | `user_token_a` | Yes | No | Your wSOL ATA |
| 10 | `user_token_b` | Yes | No | Your CRIME/FRAUD token ATA |
| 11 | `stake_pool` | Yes | No | `5BdRPPwEDpHEtRgdp4MfywbwmZnrf6u23bXMnG1w8ViN` |
| 12 | `staking_escrow` | Yes | No | `E68zPDgzMqnycj23g9T74ioHbDdvq3Npj5tT2yPd1SY` |
| 13 | `carnage_vault` | Yes | No | `5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT` |
| 14 | `treasury` | Yes | No | `3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv` |
| 15 | `amm_program` | No | No | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` |
| 16 | `token_program_a` | No | No | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (SPL Token) |
| 17 | `token_program_b` | No | No | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token-2022) |
| 18 | `system_program` | No | No | `11111111111111111111111111111111` |
| 19 | `staking_program` | No | No | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` |

**remaining_accounts (4):** Hook accounts for the faction token mint (the token being transferred).

> **Note:** `token_program_a` is SPL Token (for wSOL), `token_program_b` is Token-2022 (for CRIME/FRAUD). Getting these backwards will fail.

### swap_sol_sell (Token → SOL)

**Program:** Tax Program
**Instruction discriminator:** `sha256("global:swap_sol_sell")[0..8]`
**Args:** `(amount_in: u64, minimum_output: u64, is_crime: bool)`

| # | Account | Writable | Signer | Address / Derivation |
|---|---------|----------|--------|---------------------|
| 0 | `user` | Yes | Yes | Your wallet |
| 1 | `epoch_state` | No | No | `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU` |
| 2 | `swap_authority` | Yes | No | `CoCdbornGtiZ8tLxF5HD2TdGidfgfwbbiDX79BaZGJ2D` |
| 3 | `tax_authority` | No | No | `8zijSBnoiGQzwccQkdNuAwbZCieDZsxdn2GgKDErCemQ` |
| 4 | `pool` | Yes | No | Pool State PDA |
| 5 | `pool_vault_a` | Yes | No | Pool's wSOL vault |
| 6 | `pool_vault_b` | Yes | No | Pool's token vault |
| 7 | `mint_a` | No | No | `So11111111111111111111111111111111111111112` (wSOL) |
| 8 | `mint_b` | No | No | CRIME or FRAUD mint |
| 9 | `user_token_a` | Yes | No | Your wSOL ATA |
| 10 | `user_token_b` | Yes | No | Your CRIME/FRAUD token ATA |
| 11 | `stake_pool` | Yes | No | `5BdRPPwEDpHEtRgdp4MfywbwmZnrf6u23bXMnG1w8ViN` |
| 12 | `staking_escrow` | Yes | No | `E68zPDgzMqnycj23g9T74ioHbDdvq3Npj5tT2yPd1SY` |
| 13 | `carnage_vault` | Yes | No | `5988CYMcvJpNtGbtCDnAMxrjrLxRCq3qPME7w2v36aNT` |
| 14 | `treasury` | Yes | No | `3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv` |
| 15 | `amm_program` | No | No | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` |
| 16 | `token_program_a` | No | No | SPL Token |
| 17 | `token_program_b` | No | No | Token-2022 |
| 18 | `system_program` | No | No | System Program |
| 19 | `staking_program` | No | No | Staking Program |
| 20 | `wsol_intermediary` | Yes | No | `2HPNULWVVdTcRiAm2DkghLA6frXxA2Nsu4VRu8a4qQ1s` |

**remaining_accounts (4):** Hook accounts for the faction token mint.

> **Note:** `swap_sol_sell` has 21 named accounts (one more than buy — the `wsol_intermediary`). The sell path uses an intermediary PDA to atomically extract tax WSOL, close it to unwrap, distribute native SOL, then recreate it.

---

## 10. The Arb Route — Step by Step

### Example: CRIME is cheap (cheap_side == 0)

**Route: SOL → CRIME → PROFIT → FRAUD → SOL**

#### Transaction 1: Buy CRIME with SOL

```
Instruction: Tax::swap_sol_buy(amount_in, minimum_output, is_crime=true)

Pre-requisites:
  - Have SOL in wallet
  - Have wSOL ATA (create + wrap SOL + syncNative if needed)
  - Have CRIME token ATA (create if needed — Token-2022 ATA)

What happens on-chain:
  1. Tax deducted from amount_in (e.g., 1% buy tax)
  2. Post-tax SOL swapped via AMM (1% LP fee internally)
  3. CRIME tokens deposited to your CRIME ATA
  4. Tax distributed: 71% staking, 24% carnage, 5% treasury
```

#### Transaction 2: Convert CRIME → PROFIT

```
Instruction: Vault::convert(crime_amount)

Accounts:
  - user_input_account = your CRIME ATA
  - user_output_account = your PROFIT ATA (create if needed — Token-2022 ATA)
  - input_mint = CRIME mint
  - output_mint = PROFIT mint
  - vault_input = Vault CRIME account (Gh9QHMY3J2NGyaHFH2XQCWxedf4G7kBfyu7Jonwn1bHA)
  - vault_output = Vault PROFIT account (DBMaWgfUW8WBb8VVvqDFkrMpEkPkCPTcLpSpyzHAiwp3)

remaining_accounts: [CRIME_hook_accounts(4), PROFIT_hook_accounts(4)]

What happens:
  - crime_amount ÷ 100 = profit_amount (integer division)
  - CRIME transferred: your ATA → vault
  - PROFIT transferred: vault → your ATA
```

#### Transaction 3: Convert PROFIT → FRAUD

```
Instruction: Vault::convert(profit_amount)

Accounts:
  - user_input_account = your PROFIT ATA
  - user_output_account = your FRAUD ATA (create if needed — Token-2022 ATA)
  - input_mint = PROFIT mint
  - output_mint = FRAUD mint
  - vault_input = Vault PROFIT account (DBMaWgfUW8WBb8VVvqDFkrMpEkPkCPTcLpSpyzHAiwp3)
  - vault_output = Vault FRAUD account (DLciB9t3qEuRcndGyjRmu1Z34NCwTPvNwbv7eUsFxTZG)

remaining_accounts: [PROFIT_hook_accounts(4), FRAUD_hook_accounts(4)]

What happens:
  - profit_amount × 100 = fraud_amount
  - PROFIT transferred: your ATA → vault
  - FRAUD transferred: vault → your ATA
```

#### Transaction 4: Sell FRAUD for SOL

```
Instruction: Tax::swap_sol_sell(fraud_amount, minimum_output, is_crime=false)

What happens on-chain:
  1. Full fraud_amount sent to AMM
  2. AMM returns gross wSOL (minus 1% LP fee)
  3. Tax deducted from gross output (e.g., 1% sell tax)
  4. Net wSOL deposited to your wSOL ATA
  5. Tax distributed
  6. Unwrap wSOL → SOL if desired
```

### Combining Transactions

You can combine steps into fewer transactions for speed:

- **2 TXs:** TX1 = buy + convert1, TX2 = convert2 + sell
- **1 TX (ideal):** All 4 instructions in one transaction if it fits within the 1232-byte limit. This eliminates the risk of prices moving between TXs.

Using an ALT (see Section 13) makes it much more feasible to fit everything in one transaction.

---

## 11. Quoting & Profitability Calculation

### Step-by-Step Quote

Use BigInt (u64 equivalent) for all calculations. Here's the math for Route A (buy CRIME, sell FRAUD):

```typescript
function quoteArbRoute(
  solInput: bigint,           // lamports
  crimePoolReserveSOL: bigint,
  crimePoolReserveToken: bigint,
  fraudPoolReserveSOL: bigint,
  fraudPoolReserveToken: bigint,
  crimeBuyTaxBps: number,
  fraudSellTaxBps: number,
  lpFeeBps: number = 100,     // 1%
): bigint {

  // Step 1: Buy tax on SOL input
  const buyTax = solInput * BigInt(crimeBuyTaxBps) / 10000n;
  const solToSwap = solInput - buyTax;

  // Step 2: AMM buy (SOL → CRIME)
  const effectiveInput = solToSwap * (10000n - BigInt(lpFeeBps)) / 10000n;
  const crimeOut = crimePoolReserveToken * effectiveInput
                   / (crimePoolReserveSOL + effectiveInput);

  // Step 3: Convert CRIME → PROFIT → FRAUD
  // CRIME → PROFIT: integer division by 100
  const profitAmount = crimeOut / 100n;
  // PROFIT → FRAUD: multiply by 100
  const fraudAmount = profitAmount * 100n;
  // Note: truncation loss = crimeOut % 100 tokens (negligible)

  // Step 4: AMM sell (FRAUD → SOL)
  const effectiveSellInput = fraudAmount * (10000n - BigInt(lpFeeBps)) / 10000n;
  const grossSolOut = fraudPoolReserveSOL * effectiveSellInput
                      / (fraudPoolReserveToken + effectiveSellInput);

  // Step 5: Sell tax on SOL output
  const sellTax = grossSolOut * BigInt(fraudSellTaxBps) / 10000n;
  const netSolOut = grossSolOut - sellTax;

  // Profit = output - input
  return netSolOut - solInput;  // negative = loss, positive = profit
}
```

### Optimal Input Size (Binary Search)

The optimal input is NOT "as much as possible." Larger inputs move the pool price more, reducing marginal returns. Use binary search:

```typescript
function findOptimalInput(
  minInput: bigint,  // e.g., 10_000_000n (0.01 SOL)
  maxInput: bigint,  // e.g., wallet balance or pool depth cap
  ...poolAndTaxParams
): bigint {
  let bestInput = 0n;
  let bestProfit = 0n;

  let lo = minInput;
  let hi = maxInput;

  while (hi - lo > 1_000_000n) {  // 0.001 SOL precision
    const mid = (lo + hi) / 2n;
    const profitAtMid = quoteArbRoute(mid, ...params);
    const profitAboveMid = quoteArbRoute(mid + 1_000_000n, ...params);

    if (profitAtMid > bestProfit) {
      bestProfit = profitAtMid;
      bestInput = mid;
    }

    if (profitAboveMid > profitAtMid) {
      lo = mid;  // profit still increasing
    } else {
      hi = mid;  // past the peak
    }
  }

  return bestInput;
}
```

### Quick Profitability Check

Before running the full binary search, do a quick check:

```typescript
// Read both pool reserves
const crimePrice = crimeReserveSOL / crimeReserveToken;  // SOL per token
const fraudPrice = fraudReserveSOL / fraudReserveToken;

// Calculate spread ratio
const spreadRatio = Math.max(crimePrice, fraudPrice) / Math.min(crimePrice, fraudPrice);

// Read current tax rates from EpochState
const minFriction = (buyTaxBps + sellTaxBps + 200) / 10000;  // +200 for 2% total LP fees

// Quick check
if (spreadRatio - 1.0 < minFriction) {
  // Spread too small, skip
  return;
}
```

---

## 12. Transaction Construction

### wSOL Handling

SOL must be wrapped to wSOL (SPL Token) for AMM interaction:

**Before buying:**
1. Create wSOL ATA if it doesn't exist: `createAssociatedTokenAccountInstruction(wallet, wallet, NATIVE_MINT, TOKEN_PROGRAM_ID)`
2. Transfer SOL to the wSOL ATA: `SystemProgram.transfer(wallet, wsolATA, amount)`
3. Sync native balance: `createSyncNativeInstruction(wsolATA)`

**After selling:**
- wSOL is deposited to your wSOL ATA
- To unwrap: `createCloseAccountInstruction(wsolATA, wallet, wallet)` — closes the account and sends all lamports (token balance + rent) to your wallet

### Token-2022 ATA Creation

CRIME, FRAUD, and PROFIT use Token-2022. Their ATAs must be created with the Token-2022 program:

```typescript
createAssociatedTokenAccountInstruction(
  payer,          // your wallet
  ata,            // derived ATA address
  owner,          // your wallet
  mint,           // CRIME/FRAUD/PROFIT mint
  TOKEN_2022_PROGRAM_ID  // NOT TOKEN_PROGRAM_ID
)
```

### Instruction Building with Anchor

If using Anchor's TypeScript SDK:

```typescript
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { TaxProgram } from "./idl/tax_program";  // generated types

const taxProgram = new Program<TaxProgram>(idl, provider);

const ix = await taxProgram.methods
  .swapSolBuy(
    new BN(amountIn),       // lamports
    new BN(minimumOutput),  // minimum tokens out
    true                    // is_crime
  )
  .accounts({
    user: wallet.publicKey,
    epochState: EPOCH_STATE,
    swapAuthority: SWAP_AUTHORITY,
    // ... all 20 accounts
  })
  .remainingAccounts(hookAccounts)  // 4 hook AccountMeta[]
  .instruction();
```

### Manual Instruction Building (Without Anchor)

If building raw instructions:

```typescript
// Anchor discriminator = sha256("global:swap_sol_buy")[0..8]
const discriminator = Buffer.from(
  sha256("global:swap_sol_buy").slice(0, 8)
);

// Serialize args: amount_in (u64 LE) + minimum_output (u64 LE) + is_crime (u8)
const data = Buffer.alloc(8 + 8 + 8 + 1);
data.set(discriminator, 0);
data.writeBigUInt64LE(BigInt(amountIn), 8);
data.writeBigUInt64LE(BigInt(minimumOutput), 16);
data.writeUInt8(isCrime ? 1 : 0, 24);

const instruction = new TransactionInstruction({
  keys: [
    { pubkey: wallet, isSigner: true, isWritable: true },
    { pubkey: EPOCH_STATE, isSigner: false, isWritable: false },
    // ... all accounts with correct signer/writable flags
    // ... then hook accounts (all non-signer, non-writable except meta list)
  ],
  programId: TAX_PROGRAM_ID,
  data,
});
```

---

## 13. Address Lookup Table (ALT)

### Why You Need It

A full arb transaction (buy + 2 converts + sell) involves 40+ unique accounts. Without an ALT, the transaction exceeds Solana's 1232-byte limit.

### Protocol ALT

**Mainnet ALT:** `7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h`

This ALT contains ~55 addresses including all program IDs, mints, pool accounts, vault accounts, and key PDAs. Using it, each account reference costs 1 byte (index) instead of 32 bytes (full pubkey).

### Using v0 Transactions

```typescript
import {
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount
} from "@solana/web3.js";

// Fetch ALT
const altAccount = await connection.getAddressLookupTable(ALT_ADDRESS);

// Build message
const message = new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: blockhash,
  instructions: [
    computeBudgetIx,
    wsolWrapIx,
    buyIx,
    convert1Ix,
    convert2Ix,
    sellIx,
    wsolUnwrapIx,
  ],
}).compileToV0Message([altAccount.value!]);

const tx = new VersionedTransaction(message);
tx.sign([wallet]);

const sig = await connection.sendRawTransaction(tx.serialize(), {
  skipPreflight: true,  // v0 TXs can fail preflight on some RPC nodes
});
```

> **IMPORTANT:** When using `skipPreflight: true`, always check `connection.confirmTransaction(sig)` and inspect `confirmation.value.err` — a "confirmed" transaction on Solana can still be a failed transaction.

### Build Your Own ALT (Optional)

If you need accounts not in the protocol ALT (e.g., your own token ATAs), create a supplementary ALT:

```typescript
const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
  authority: wallet.publicKey,
  payer: wallet.publicKey,
  recentSlot: await connection.getSlot(),
});

const extendIx = AddressLookupTableProgram.extendLookupTable({
  payer: wallet.publicKey,
  authority: wallet.publicKey,
  lookupTable: altAddress,
  addresses: [yourCrimeATA, yourFraudATA, yourProfitATA, yourWsolATA],
});
```

You can pass multiple ALTs to `compileToV0Message()`.

---

## 14. Monitoring & Timing Strategy

### When to Check for Arb Opportunities

1. **After every epoch transition** (~30 min) — Tax rates change, creating fresh spreads
2. **After large trades** — Organic trading pushes prices apart
3. **After Carnage execution** — Carnage buys/burns tokens, shifting reserves

### Monitoring Approach

```
LOOP:
  1. Fetch EpochState account data
  2. Fetch both pool PoolState account data
  3. Compute spread between pools
  4. If spread > friction threshold:
     a. Determine direction (buy cheap, sell expensive)
     b. Calculate optimal input via binary search
     c. Quote both routes (A and B)
     d. Execute the profitable route
  5. Sleep 2-5 seconds (or use WebSocket subscription)
```

### WebSocket Monitoring (Faster)

Subscribe to account changes on:
- `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU` (EpochState) — detect epoch transitions
- `ZWUZ3PzGk6bg6g3BS3WdXKbdAecUgZxnruKXQkte7wf` (CRIME pool) — detect reserve changes
- `AngvViTVGd2zxP8KoFUjGU3TyrQjqeM1idRWiKM8p3mq` (FRAUD pool) — detect reserve changes

```typescript
connection.onAccountChange(EPOCH_STATE, (accountInfo) => {
  const data = accountInfo.data;
  // Parse EpochState, check for new epoch / rate change
  // Trigger arb check
});

connection.onAccountChange(CRIME_POOL, (accountInfo) => {
  // Parse reserves, check spread
});
```

### Competing with Other Bots

- The protocol may eventually implement its own on-chain arb (see `protocol-arb-spec.md`), which would compress spreads before external bots can act
- Speed matters — submit transactions as fast as possible after detecting a spread
- Use `skipPreflight: true` to save ~200ms of RPC simulation time
- Use a dedicated RPC node (not public endpoints) for lower latency
- Consider priority fees (`ComputeBudgetProgram.setComputeUnitPrice`) to get your TX included faster

---

## 15. Edge Cases & Gotchas

### Critical Technical Issues

1. **Canonical mint ordering in pools.** The AMM stores mints sorted by raw byte value. For SOL pools, `NATIVE_MINT (0x06...)` is always mint_a, but always verify by reading pool state bytes [9..41]. Getting this wrong means you read reserves backwards.

2. **Token-2022 vs SPL Token.** wSOL uses SPL Token (legacy). CRIME/FRAUD/PROFIT use Token-2022. The Tax Program accounts have `token_program_a` = SPL Token and `token_program_b` = Token-2022. Swapping these causes failures.

3. **Hook accounts ordering.** For Conversion Vault `convert`, remaining_accounts must be `[input_hook_accounts(4), output_hook_accounts(4)]`. Getting this wrong causes error 3005 (AccountNotEnoughKeys).

4. **Integer truncation in vault.** CRIME/FRAUD → PROFIT divides by 100. Remainder is lost. A 26,515,410 CRIME input becomes 26,515,400 FRAUD output (10 token dust loss). Ensure inputs are multiples of 100 to avoid this.

5. **50% minimum output floor.** The Tax Program rejects any swap where `minimum_output < 50% of expected_output`. Don't set minimum_output to 0 — it will fail.

6. **Sell path intermediary.** The sell instruction uses a wSOL intermediary PDA for atomic tax extraction. This is handled internally — you just need to pass the `wsol_intermediary` account.

7. **v0 transactions + skipPreflight.** Failed v0 transactions are still "confirmed" on Solana. Always check `confirmation.value.err` after confirmation.

### Economic Edge Cases

8. **Zero spread after Carnage.** If Carnage just executed (bought/burned tokens), reserves may be temporarily shifted. Arb spread could be in the opposite direction from what taxes suggest.

9. **High-tax epochs.** When both buy and sell taxes are high (4% each + LP fees = 10%), spreads below 10% are unprofitable. The bot should calculate exact friction per epoch.

10. **Vault balance limits.** The vault has 250M of each faction token. At extreme scales, the vault could run low on one side. Check `vault_output.amount >= required_amount` before transacting.

11. **Concurrent transactions.** If another arb bot or the protocol arb executes simultaneously, reserves change mid-flight. Your minimum_output protects against this — the transaction simply fails if slippage exceeds your tolerance.

---

## 16. Reference Implementation Pointers

These files in the Dr. Fraudsworth codebase contain reference implementations of the swap mechanics:

| File | What It Shows |
|------|---------------|
| `app/lib/swap/hook-resolver.ts` | Client-side PDA derivation for hook accounts (4 accounts per mint) |
| `app/lib/swap/swap-builders.ts` | Transaction construction for buy/sell swaps |
| `app/lib/swap/route-engine.ts` | Route quoting with BigInt math, path enumeration |
| `scripts/e2e/lib/swap-flow.ts` | End-to-end swap execution with balance verification |
| `scripts/e2e/lib/alt-helper.ts` | ALT creation and management |
| `programs/tax-program/src/instructions/swap_sol_buy.rs` | On-chain buy logic (account validation, tax math, AMM CPI) |
| `programs/tax-program/src/instructions/swap_sol_sell.rs` | On-chain sell logic (intermediary pattern, tax extraction) |
| `programs/tax-program/src/helpers/tax_math.rs` | Tax calculation and distribution math |
| `programs/tax-program/src/helpers/pool_reader.rs` | Raw byte reading of pool reserves |
| `programs/amm/src/instructions/swap_sol_pool.rs` | AMM constant-product swap implementation |
| `programs/conversion-vault/src/instructions/convert.rs` | Vault conversion logic |
| `Docs/protocol-arb-spec.md` | Full protocol arb specification (the protocol's own planned arb) |

### IDL Files

Anchor IDL files (JSON) for all programs are in the `target/idl/` directory after building. These can be used with Anchor's TypeScript SDK to generate type-safe instruction builders.

---

## 17. Appendix: PDA Derivation Reference

All PDAs used in the arb route, with their derivation seeds:

```typescript
import { PublicKey } from "@solana/web3.js";

const AMM_PROGRAM = new PublicKey("5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR");
const TAX_PROGRAM = new PublicKey("43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj");
const EPOCH_PROGRAM = new PublicKey("4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2");
const VAULT_PROGRAM = new PublicKey("5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ");
const HOOK_PROGRAM = new PublicKey("CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd");
const STAKING_PROGRAM = new PublicKey("12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH");

// Pool State PDA
// Seeds: ["pool", min(mintA, mintB), max(mintA, mintB)]
// Program: AMM
const [crimePool] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool"), NATIVE_MINT.toBuffer(), CRIME_MINT.toBuffer()],
  AMM_PROGRAM
);

// Tax Program PDAs
const [swapAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("swap_authority")], TAX_PROGRAM
);
const [taxAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("tax_authority")], TAX_PROGRAM
);
const [wsolIntermediary] = PublicKey.findProgramAddressSync(
  [Buffer.from("wsol_intermediary")], TAX_PROGRAM
);

// Epoch Program PDAs
const [epochState] = PublicKey.findProgramAddressSync(
  [Buffer.from("epoch_state")], EPOCH_PROGRAM
);

// Conversion Vault PDAs
const [vaultConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_config")], VAULT_PROGRAM
);
// Note: vault token accounts use compound seeds
const [vaultCrime] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_crime"), vaultConfig.toBuffer()], VAULT_PROGRAM
);
const [vaultFraud] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_fraud"), vaultConfig.toBuffer()], VAULT_PROGRAM
);
const [vaultProfit] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_profit"), vaultConfig.toBuffer()], VAULT_PROGRAM
);

// Staking PDAs
const [stakePool] = PublicKey.findProgramAddressSync(
  [Buffer.from("stake_pool")], STAKING_PROGRAM
);
const [escrowVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow_vault")], STAKING_PROGRAM
);

// Transfer Hook PDAs (per-mint)
function getHookAccounts(
  mint: PublicKey,
  sourceTokenAccount: PublicKey,
  destTokenAccount: PublicKey,
): AccountMeta[] {
  const [metaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    HOOK_PROGRAM
  );
  const [wlSource] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), sourceTokenAccount.toBuffer()],
    HOOK_PROGRAM
  );
  const [wlDest] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), destTokenAccount.toBuffer()],
    HOOK_PROGRAM
  );

  return [
    { pubkey: metaList, isSigner: false, isWritable: false },
    { pubkey: wlSource, isSigner: false, isWritable: false },
    { pubkey: wlDest, isSigner: false, isWritable: false },
    { pubkey: HOOK_PROGRAM, isSigner: false, isWritable: false },
  ];
}
```

### Hook Accounts for Each Step

**Buy CRIME (user wSOL → pool wSOL vault, pool CRIME vault → user CRIME ATA):**
- Only CRIME side has hooks (wSOL is SPL Token, no hooks)
- remaining_accounts = `getHookAccounts(CRIME_MINT, crimePoolVaultB, userCrimeATA)`

**Sell FRAUD (user FRAUD ATA → pool FRAUD vault, pool wSOL vault → user wSOL ATA):**
- Only FRAUD side has hooks
- remaining_accounts = `getHookAccounts(FRAUD_MINT, userFraudATA, fraudPoolVaultB)`

**Convert CRIME → PROFIT (user CRIME → vault CRIME, vault PROFIT → user PROFIT):**
- remaining_accounts = `[...getHookAccounts(CRIME_MINT, userCrimeATA, vaultCrime), ...getHookAccounts(PROFIT_MINT, vaultProfit, userProfitATA)]`

**Convert PROFIT → FRAUD (user PROFIT → vault PROFIT, vault FRAUD → user FRAUD):**
- remaining_accounts = `[...getHookAccounts(PROFIT_MINT, userProfitATA, vaultProfit), ...getHookAccounts(FRAUD_MINT, vaultFraud, userFraudATA)]`

---

## Summary Checklist for Bot Implementation

- [ ] Set up wallet with SOL
- [ ] Create Token-2022 ATAs for CRIME, FRAUD, and PROFIT
- [ ] Create SPL Token ATA for wSOL
- [ ] Fetch and cache the protocol ALT
- [ ] Poll EpochState for current tax rates every few seconds (or use WebSocket)
- [ ] Poll both pool states for current reserves
- [ ] Calculate spread and determine direction
- [ ] Calculate optimal input size via binary search
- [ ] Quote both routes (CRIME→FRAUD and FRAUD→CRIME)
- [ ] Execute profitable route as v0 transaction with ALT
- [ ] Verify confirmation and check for errors
- [ ] Unwrap wSOL proceeds back to SOL
- [ ] Log results, repeat
