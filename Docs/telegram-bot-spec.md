# Dr. Fraudsworth Telegram Bot — Technical Specification

**Date:** 2026-03-26
**Status:** Draft
**Author:** mlbob + Claude
**Target Audience:** Any developer building this bot (may not have access to the private repo)

---

## 1. Executive Summary

A custodial Telegram trading bot that allows users to interact with the Dr. Fraudsworth's Finance Factory protocol directly from Telegram. Users create an in-bot wallet, fund it with SOL, and can swap SOL <-> PROFIT, stake/unstake PROFIT, claim/compound rewards, and receive notifications — all without needing a browser wallet.

**Why:** Jupiter routing integration is pending and the current browser-only UX limits accessibility. Telegram bots are the standard DeFi onramp on Solana (BonkBot, Trojan, Photon). This bot bridges the gap.

---

## 2. Architecture Overview

```
+------------------+      +-------------------+      +-------------------+
|   Telegram API   | <--> |  Dr. Fraudsworth  | <--> |   Solana RPC      |
|   (webhooks)     |      |   Bot (Railway)   |      |   (Helius)        |
+------------------+      +-------------------+      +-------------------+
                                   |    |
                                   |    +---> SSE Feed (website backend)
                                   |              for display data
                                   v
                          +-------------------+
                          |   PostgreSQL      |
                          |   (Railway)       |
                          +-------------------+
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Custody model | Custodial (one Solana keypair per Telegram user) | Standard for Solana TG bots, simplest UX |
| Hosting | Railway (separate service from website) | Isolated env vars, separate attack surface |
| Database | PostgreSQL on Railway | Mature, column-level encryption, relational |
| Bot framework | grammY (TypeScript) | TS-first, modern middleware, active maintenance |
| Language | TypeScript | Reuse route engine, swap builders, staking builders from public repo |
| Key encryption | Per-user derived keys (envelope encryption) | DB dump alone cannot decrypt; see Section 9 |
| RPC | Helius (dedicated API key, separate from website) | Separate rate limits and billing |
| Interaction model | Inline keyboard buttons (not slash commands) | Standard Telegram bot UX pattern |
| DM only | Yes | Security — no accidental key exposure in groups |

---

## 3. On-Chain References (Mainnet)

All addresses below are from the **public repository** at `deployments/mainnet.json`.

### 3.1 Program IDs

| Program | Address |
|---------|---------|
| AMM | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` |
| Transfer Hook | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` |
| Tax Program | `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj` |
| Epoch Program | `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2` |
| Staking | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` |
| Conversion Vault | `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` |
| Bonding Curve | `DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV` |

### 3.2 Mints

| Token | Address | Decimals | Token Program |
|-------|---------|----------|---------------|
| CRIME | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` | 6 | Token-2022 |
| FRAUD | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` | 6 | Token-2022 |
| PROFIT | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` | 6 | Token-2022 |

### 3.3 Pools

| Pool | Pool Address | Vault A | Vault B |
|------|-------------|---------|---------|
| CRIME/SOL | `ZWUZ3PzGk6bg6g3BS3WdXKbdAecUgZxnruKXQkte7wf` | `14rFLiXzXk7aXLnwAz2kwQUjG9vauS84AQLu6LH9idUM` | `6s6cprCGxTAYCk9LiwCpCsdHzReW7CLZKqy3ZSCtmV1b` |
| FRAUD/SOL | `AngvViTVGd2zxP8KoFUjGU3TyrQjqeM1idRWiKM8p3mq` | `3sUDyw1k61NSKgn2EA9CaS3FbSZAApGeCRNwNFQPwg8o` | `2nzqXn6FivXjPSgrUGTA58eeVUDjGhvn4QLfhXK1jbjP` |

### 3.4 Key PDAs

| PDA | Address | Purpose |
|-----|---------|---------|
| EpochState | `FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU` | Current epoch, tax rates, Carnage state |
| StakePool | `5BdRPPwEDpHEtRgdp4MfywbwmZnrf6u23bXMnG1w8ViN` | Global staking pool state |
| EscrowVault | `E68zPDgzMqnycj23g9T74ioHbDdvq3Npj5tT2yPd1SY` | SOL rewards escrow |
| StakeVault | `9knYFeYSupqdhQv6yyMv6q1FGpD5L3q3yaym7N5Lwafo` | Staked PROFIT vault |
| SwapAuthority | `CoCdbornGtiZ8tLxF5HD2TdGidfgfwbbiDX79BaZGJ2D` | Signs AMM CPI calls |
| TaxAuthority | `8zijSBnoiGQzwccQkdNuAwbZCieDZsxdn2GgKDErCemQ` | Tax PDA signer |
| VaultConfig | `8vFpSBnCVt8dfX57FKrsGwy39TEo1TjVzrj9QYGxCkcD` | Conversion vault config |
| WsolIntermediary | `2HPNULWVVdTcRiAm2DkghLA6frXxA2Nsu4VRu8a4qQ1s` | WSOL intermediary for tax |
| CarnageFund | `CX9Xx2vwSheqMY7zQZUDfAexXg2XHcQmZ45wLgHZDNhV` | Carnage fund state |

### 3.5 Address Lookup Table (Mainnet)

`7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h`

Required for sell-path transactions that exceed the 1232-byte TX limit.

### 3.6 Key Constants

| Constant | Value | Source |
|----------|-------|--------|
| Token decimals (all 3) | 6 | `shared/constants.ts` |
| Vault conversion rate | 100:1 (100 CRIME/FRAUD = 1 PROFIT) | `shared/constants.ts` |
| SOL pool LP fee | 100 bps (1%) | `shared/constants.ts` |
| Staking cooldown | 43,200 seconds (12 hours) | `shared/constants.ts` |
| Tax split | 71% staking / 24% Carnage / 5% treasury | `programs/tax-program` |
| Epoch duration | ~30 minutes (4,500 slots mainnet) | `programs/epoch-program` |
| Tax range (low side) | 1-4% (100-400 bps) | `programs/epoch-program` |
| Tax range (high side) | 11-14% (1100-1400 bps) | `programs/epoch-program` |

---

## 4. User Functions

### 4.1 Wallet Management

#### Create Wallet (automatic on `/start`)
- Generate a new Solana Keypair
- Encrypt private key with per-user derived key (see Section 9)
- Store encrypted key in PostgreSQL
- Display the wallet's public address in copyable format (`` `address` ``)
- Show welcome message in Dr. Fraudsworth character voice

#### Fund Wallet
- Show deposit address (copyable, wrapped in backticks)
- No QR code
- Bot detects incoming SOL via polling or webhook and notifies user

#### Withdraw SOL
- User provides a destination wallet address and SOL amount
- Bot builds and signs a native SOL transfer
- Sends Solscan link on confirmation
- SOL reserve (see Section 4.6) still enforced — user cannot withdraw below reserve

#### Export Private Key
- User taps "Export Private Key" button
- Bot sends warning message: "Your private key gives FULL control of your wallet. NEVER share it with anyone — not even Dr. Fraudsworth himself."
- User must tap "CONFIRM EXPORT" button
- Bot sends the Base58 private key as a Telegram spoiler message (`||key_here||`) — blurred until tapped
- Bot auto-deletes the message after **30 seconds**

#### Balance
- SOL balance (minus reserved amount)
- PROFIT balance (wallet, unstaked)
- PROFIT staked balance
- Lock status (LOCKED with countdown, or UNLOCKED)
- Pending rewards (in SOL)
- Lifetime rewards claimed (in SOL)

### 4.2 Swap: Buy PROFIT (SOL -> PROFIT)

**Route:** SOL -> Tax Program -> AMM (CRIME/SOL and/or FRAUD/SOL) -> Conversion Vault (convert_v2) -> PROFIT

The bot uses the **same smart routing engine** as the website:

1. **Quote both pools**: Get quotes from CRIME/SOL and FRAUD/SOL pools
2. **Split routing**: For larger amounts, split across both pools for better price (identical to `split-router.ts` in public repo)
3. **Convert via Vault**: Use `convert_v2` (amount_in=0 sentinel) so the vault converts the user's entire intermediate CRIME/FRAUD balance — zero token leakage
4. **Auto-slippage**: Calculate slippage based on trade size (same algorithm as website)

**User flow:**
1. User taps **Buy PROFIT** button
2. Bot asks for SOL amount (or "MAX" for full balance minus reserve)
3. Bot computes quote and displays preview:
   ```
   Buy PROFIT Quote

   Spend:        5.000 SOL
   Receive:      ~1,247.83 PROFIT
   Route:        60% via CRIME pool, 40% via FRAUD pool
   Tax (buy):    ~2.0% (100 bps CRIME) / ~12.0% (1200 bps FRAUD)
   Slippage:     1.0%
   Min. receive: 1,235.35 PROFIT

   [Confirm]  [Cancel]
   ```
4. User taps **Confirm**
5. Bot builds, signs, and submits transaction
6. On confirmation, sends Solscan link: "Swap confirmed! [View on Solscan](https://solscan.io/tx/...)"
7. On failure, sends friendly error (see Section 11)

### 4.3 Swap: Sell PROFIT (PROFIT -> SOL)

**Route:** PROFIT -> Conversion Vault (convert_v2) -> AMM (CRIME/SOL and/or FRAUD/SOL) via Tax Program -> SOL

Reverse of buy. Same smart routing with split support.

**User flow:** Same as buy but reversed — user specifies PROFIT amount, preview shows SOL received after tax.

### 4.4 Staking

#### Stake PROFIT
1. User taps **Stake** button
2. Enters PROFIT amount (or "MAX")
3. Preview shows amount being staked
4. Confirm -> build and submit stake TX
5. Solscan link on success

#### Unstake PROFIT
1. User taps **Unstake** button
2. If user is in cooldown (last claim < 12h ago): show "You can unstake in Xh Ym" and abort
3. If unlocked: enter amount, preview, confirm, submit
4. Solscan link on success

#### Claim Rewards
1. User taps **Claim** button
2. Preview shows pending reward amount in SOL
3. Warning: "Claiming starts a 12-hour cooldown on unstaking"
4. Confirm -> submit claim TX
5. Solscan link on success
6. Note: Claiming resets the 12h cooldown timer

#### Compound (Claim + Buy + Stake)
1. User taps **Compound** button
2. Bot builds a sequence: Claim SOL rewards -> Swap SOL -> PROFIT (smart route) -> Stake PROFIT
3. Preview shows: "Claim X SOL -> Buy ~Y PROFIT -> Stake Y PROFIT"
4. These are **3 separate transactions** (claim, swap, stake) — the bot executes them sequentially
5. If any step fails, the bot reports which step failed and the user retains whatever completed

### 4.5 Auto-Claim & Auto-Compound

Users can enable automated reward management from the **Settings** menu.

#### Modes
| Mode | Behavior |
|------|----------|
| Off (default) | No automatic actions |
| Auto-Claim | Claims rewards automatically on a schedule |
| Auto-Compound | Claims rewards + swaps to PROFIT + stakes, automatically |

#### Schedule
- Runs on a **per-user timer**, checking every minute from the bot's scheduler
- Frequency: the bot claims as frequently as possible (aims for shortly after cooldown expiry) to keep the user closer to cooldown expiring at any given time
- In practice this means claiming roughly every 12 hours (since the cooldown is 12 hours, there's no benefit to claiming more often than that — rewards accrue continuously)

#### Minimum Threshold
- User-configurable minimum SOL threshold before auto-claim/compound fires
- Default: **0.1 SOL**
- If pending rewards < threshold, skip this cycle (saves TX fees on dust amounts)
- User sets this in Settings

#### Notifications
- On each auto-claim: "Auto-claimed 0.52 SOL in rewards"
- On each auto-compound: "Auto-compounded: Claimed 0.52 SOL -> Bought 130.5 PROFIT -> Staked"
- On failure: "Auto-compound failed (insufficient SOL for fees). Retrying next cycle."

### 4.6 SOL Reserve

The bot reserves **0.01 SOL** in every user wallet that cannot be swapped or withdrawn. This ensures the user always has SOL available for transaction fees (unstake, claim, compound, withdraw).

- All "MAX" buy/withdraw operations deduct 0.01 SOL from available balance
- If user's balance drops below 0.01 SOL, warn: "Your SOL balance is low. Fund your wallet to continue transacting."

---

## 5. Home Screen (Main Menu)

After onboarding, the user sees the main menu. This is the "home" view they return to after any action.

```
Dr. Fraudsworth's Finance Factory

SOL Balance:     12.345 SOL
PROFIT (wallet): 500.00
PROFIT (staked): 2,500.00 (UNLOCKED)
Pending Rewards: 0.42 SOL
Total Claimed:   3.21 SOL

CRIME MCAP: $1.2M | FRAUD MCAP: $890K

[Buy PROFIT]    [Sell PROFIT]
[Stake]         [Unstake]
[Claim]         [Compound]
[Wallet]        [Settings]
```

**Wallet** submenu: Fund (show address), Withdraw, Export Key, View on Solscan
**Settings** submenu: Auto-compound toggle, threshold, slippage, priority fee level

---

## 6. Notifications

The bot proactively messages users for the following events:

### 6.1 Cooldown Expiry
When a user's 12-hour unstake cooldown expires:
> "Your PROFIT is now UNLOCKED. You can unstake at any time."

### 6.2 Auto-Claim/Compound Execution
See Section 4.5.

### 6.3 Carnage Events
When a Carnage event executes on-chain, notify all users:
> "CARNAGE TRIGGERED!
>
> The Carnage Fund spent 2.45 SOL to buy 1,230,000 CRIME.
> 980,000 FRAUD was burned.
>
> Next epoch starts shortly..."

**Details to include:**
- Which token was **bought** and how much
- Which token was **burned** (if Burn action) and how much, OR which token was **sold** (if Sell action, ~2% chance) and how much SOL was recovered
- If BuyOnly action (no existing holdings): just show what was bought

**How to detect:** Monitor the `CarnageExecuted` event from the Epoch Program. The event contains: action taken, target token, tokens bought, tokens burned/sold, SOL spent.

---

## 7. Onboarding Flow

When a user first messages the bot:

1. **Welcome message** (in character):
   > "Ah, a new investor approaches the Factory! Welcome to Dr. Fraudsworth's Finance Factory, where the profits are real and the fraud is... well, let's not dwell on semantics.
   >
   > I've created a personal vault for your assets. Fund it with SOL to begin your journey into questionable finance."

2. **Auto-create wallet** — keypair generated, encrypted, stored

3. **Show deposit address:**
   > "Your deposit address:
   > `<base58_address>`
   > (tap to copy)
   >
   > Send SOL to this address to fund your wallet. Once funded, you can buy PROFIT, stake for rewards, and more."

4. **Brief tutorial** (inline buttons):
   > "What would you like to do first?"
   > [How It Works] [Buy PROFIT] [View Balance]

   "How It Works" shows a brief explainer:
   > "Here's how the Factory operates:
   >
   > 1. Buy PROFIT by swapping SOL (routed through CRIME/FRAUD pools automatically)
   > 2. Stake PROFIT to earn SOL rewards from protocol trading fees
   > 3. Claim rewards anytime (starts a 12h unstake cooldown)
   > 4. Compound to auto-reinvest rewards into more staked PROFIT
   >
   > Tax rates shift every ~30 minutes via VRF randomness, and Carnage events burn tokens regularly. It's chaos — profitable chaos."

---

## 8. Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Runtime | Node.js (TypeScript) | |
| Bot framework | grammY | TS-first, webhook mode |
| Database | PostgreSQL (Railway addon) | Encrypted columns for keys |
| Hosting | Railway (separate service) | Own env vars, own deploy |
| RPC | Helius (dedicated API key) | Separate from website key |
| Solana SDK | `@solana/web3.js` | For TX building & submission |
| Anchor | `@coral-xyz/anchor` | For program IDL interaction |
| SPL Token | `@solana/spl-token` | Token-2022 operations |
| Display data | SSE feed from website backend | Pool reserves, epoch state, prices |
| TX building data | Direct Helius RPC calls | Fresh account data for accurate quotes |

### 8.1 Repository

**Separate repository** from the main Dr. Fraudsworth project. The bot imports shared code by referencing:

- **Route engine logic**: Port/adapt from `app/lib/swap/route-engine.ts`, `quote-engine.ts`, `split-router.ts` in the public repo
- **Swap builders**: Port/adapt from `app/lib/swap/swap-builders.ts`, `multi-hop-builder.ts`
- **Staking builders**: Port/adapt from `app/lib/staking/staking-builders.ts`
- **Hook resolver**: Port/adapt from `app/lib/swap/hook-resolver.ts`
- **Constants**: Import from `shared/constants.ts` (or copy the relevant values)
- **Mainnet addresses**: From `deployments/mainnet.json`

The website's builders import from `@/lib/protocol-config` which resolves cluster-specific addresses. The bot should build a similar config layer that reads from `deployments/mainnet.json` (or env vars) to resolve all addresses.

### 8.2 Key Public Repo Files to Reference

| Purpose | File Path (public repo) |
|---------|------------------------|
| All mainnet addresses | `deployments/mainnet.json` |
| Constants (decimals, rates, seeds, fees) | `shared/constants.ts` |
| Route engine (path enumeration, quoting) | `app/lib/swap/route-engine.ts` |
| Quote engine (BigInt AMM math) | `app/lib/swap/quote-engine.ts` |
| Split router (multi-pool splitting) | `app/lib/swap/split-router.ts` |
| Route types (TypeScript interfaces) | `app/lib/swap/route-types.ts` |
| Swap TX builders | `app/lib/swap/swap-builders.ts` |
| Multi-hop TX builder | `app/lib/swap/multi-hop-builder.ts` |
| Hook account resolver | `app/lib/swap/hook-resolver.ts` |
| WSOL helpers | `app/lib/swap/wsol.ts` |
| Staking TX builders | `app/lib/staking/staking-builders.ts` |
| Rewards calculation | `app/lib/staking/rewards.ts` |
| Error maps (swap) | `app/lib/swap/error-map.ts` |
| Error maps (staking) | `app/lib/staking/error-map.ts` |
| Program IDLs | `app/lib/idl/` (generated by Anchor) |

### 8.3 Cluster Configuration

The bot targets **mainnet only**. All addresses should be loaded from `deployments/mainnet.json` or hardcoded from that file. The public repo's `shared/constants.ts` contains a `CLUSTER_CONFIG` map with `"mainnet-beta"` entries that can be used directly.

---

## 9. Security

### 9.1 Private Key Encryption (Per-User Derived Keys)

```
Master Key (env var: BOT_ENCRYPTION_MASTER_KEY)
        |
        v
HMAC-SHA256(master_key, telegram_user_id)
        |
        v
Per-User Encryption Key
        |
        v
AES-256-GCM encrypt(user_private_key)
        |
        v
Store: { telegram_id, encrypted_privkey, nonce, auth_tag }
```

**Why per-user derived keys:**
- A database dump alone cannot decrypt any wallet (attacker needs the master key too)
- The master key alone cannot decrypt without knowing which user IDs to derive for (attacker needs the DB too)
- Both are needed — defense in depth
- Upgrade path: swap master key storage to KMS (AWS/GCP) later without re-encrypting

**Implementation:**
```typescript
import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function deriveUserKey(masterKey: Buffer, telegramUserId: string): Buffer {
  return createHmac('sha256', masterKey)
    .update(telegramUserId)
    .digest();
}

function encryptPrivateKey(userKey: Buffer, privateKeyBase58: string): {
  encrypted: Buffer;
  nonce: Buffer;
  authTag: Buffer;
} {
  const nonce = randomBytes(12); // 96-bit nonce for GCM
  const cipher = createCipheriv('aes-256-gcm', userKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(privateKeyBase58, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { encrypted, nonce, authTag };
}

function decryptPrivateKey(
  userKey: Buffer,
  encrypted: Buffer,
  nonce: Buffer,
  authTag: Buffer,
): string {
  const decipher = createDecipheriv('aes-256-gcm', userKey, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}
```

### 9.2 Telegram Webhook Security

1. **Webhook mode only** — bot token never sent in outbound polling requests
2. **Secret token header** — set via `bot.api.setWebhook(url, { secret_token: process.env.WEBHOOK_SECRET })`. Reject all requests without valid `X-Telegram-Bot-Api-Secret-Token` header.
3. **IP allowlisting** — Telegram webhook source IPs are published. Reject connections from other IPs at the middleware level.
4. **HTTPS only** — Railway provides TLS by default

### 9.3 Export Key Safety

1. Warning message before export
2. Confirmation button required
3. Key sent as Telegram spoiler (blurred `||text||`)
4. Message auto-deleted after 30 seconds
5. Bot uses `deleteMessage()` API to remove the key message

### 9.4 Rate Limiting

| Action | Limit | Rationale |
|--------|-------|-----------|
| Swaps | 5 per minute per user | Prevents fee-burning spam |
| Stake/Unstake/Claim | 3 per minute per user | On-chain rate is the real limiter |
| Export key | 1 per 5 minutes per user | Anti-phishing cooldown |
| Any action (global) | 100 per minute total | Protect RPC credits |

### 9.5 Concurrency Model

- **Per-user sequential locking**: If the same user submits two actions simultaneously, the second queues behind the first (their balance/nonce depends on the first TX confirming)
- **Cross-user parallel**: Different users' transactions fire in parallel — no shared state between user wallets
- Simple per-user mutex (e.g. `Map<telegramUserId, Promise>`)

### 9.6 Additional Security Measures

- **DM-only mode**: Bot rejects all group chat interactions
- **No inline mode**: Bot does not respond to inline queries
- **Input validation**: All user-provided amounts sanitized (positive numbers, valid decimals, within balance)
- **Destination address validation**: Withdrawal addresses validated as valid Base58 Solana public keys
- **No external URLs**: Bot never sends links to anything except Solscan transaction pages

---

## 10. Database Schema

### 10.1 Users Table

```sql
CREATE TABLE users (
  id                  SERIAL PRIMARY KEY,
  telegram_id         BIGINT UNIQUE NOT NULL,
  wallet_address      VARCHAR(44) NOT NULL,         -- Base58 public key
  encrypted_privkey   BYTEA NOT NULL,               -- AES-256-GCM encrypted
  encryption_nonce    BYTEA NOT NULL,               -- 12-byte GCM nonce
  encryption_auth_tag BYTEA NOT NULL,               -- 16-byte GCM auth tag
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);
```

### 10.2 User Settings Table

```sql
CREATE TABLE user_settings (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER REFERENCES users(id) ON DELETE CASCADE,
  auto_mode               VARCHAR(20) DEFAULT 'off', -- 'off', 'auto_claim', 'auto_compound'
  auto_threshold_lamports BIGINT DEFAULT 100000000,   -- 0.1 SOL in lamports
  slippage_bps            INTEGER DEFAULT 100,         -- 1% default
  priority_fee_level      VARCHAR(10) DEFAULT 'normal', -- 'normal', 'fast', 'turbo'
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);
```

### 10.3 Auto-Compound Schedule Table

```sql
CREATE TABLE auto_schedule (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
  next_action_at    TIMESTAMP NOT NULL,             -- When to next attempt claim/compound
  last_executed_at  TIMESTAMP,                      -- When last successfully executed
  last_error        TEXT,                            -- Last error message (for debugging)
  consecutive_fails INTEGER DEFAULT 0,              -- Back-off after repeated failures
  UNIQUE(user_id)
);
```

### 10.4 No Transaction History

Transaction history is NOT stored in the database. On each confirmed transaction, the bot sends a Solscan link to the user. On-chain data is the source of truth. This is standard practice for Solana Telegram bots.

---

## 11. Error Handling

All errors shown to users must be **friendly and actionable**. Never expose raw error codes or stack traces.

| Error Scenario | User Message |
|---------------|-------------|
| Slippage exceeded | "Swap failed — the price moved too much between your quote and execution. Try again, or increase your slippage in Settings." |
| Insufficient SOL | "Not enough SOL. You need at least {amount} SOL for this transaction (including fees and reserve)." |
| Insufficient PROFIT | "You don't have enough PROFIT for this. Your balance: {balance} PROFIT." |
| Cooldown active | "Your PROFIT is locked for {Xh Ym} after your last reward claim. You can unstake after the cooldown." |
| No pending rewards | "No rewards to claim yet. Rewards accrue from protocol trading fees." |
| Network congestion | "Transaction didn't confirm in time. Solana may be congested — try again in a moment." |
| RPC error | "Something went wrong connecting to Solana. Please try again." |
| Invalid amount | "Please enter a valid number greater than 0." |
| Invalid address | "That doesn't look like a valid Solana wallet address. Please check and try again." |
| Below dust threshold (compound) | "Pending rewards ({amount} SOL) are below your auto-compound threshold ({threshold} SOL). Skipping this cycle." |

---

## 12. Transaction Priority Fees

Users can select a priority fee level in Settings:

| Level | Behavior |
|-------|----------|
| Normal (default) | Use Helius priority fee API for median recent fee |
| Fast | 75th percentile of recent fees |
| Turbo | 95th percentile of recent fees |

The website uses dynamic priority fees from Helius — the bot should use the same `getRecentPrioritizationFees` RPC method.

---

## 13. Swap Routing Details

### 13.1 How the Route Engine Works

The protocol has a diamond topology:

```
        SOL
       /   \
    CRIME   FRAUD     (AMM pools with dynamic tax)
       \   /
       PROFIT          (Conversion vault, fixed 100:1 rate)
```

**SOL -> PROFIT** (buy) always goes: SOL -> Tax Program -> AMM (buy CRIME or FRAUD) -> Conversion Vault (convert to PROFIT)

**PROFIT -> SOL** (sell) always goes: PROFIT -> Conversion Vault (convert to CRIME or FRAUD) -> Tax Program -> AMM (sell for SOL)

### 13.2 Smart Routing Algorithm

1. **Quote both paths**: SOL->CRIME->PROFIT and SOL->FRAUD->PROFIT
2. **Check if splitting improves output**: Try 50/50, 60/40, 70/30 etc. splits across both pools
3. **Select best route**: Single pool or split, whichever gives the most PROFIT output
4. **Apply slippage**: Auto-calculated based on price impact, same as `route-engine.ts`

### 13.3 Tax Awareness

Tax rates are **dynamic** — they change every ~30 minutes via VRF. The bot must read the current `EpochState` account to get current tax rates before quoting.

Each pool has independent tax rates:
- CRIME may have 2% buy / 12% sell
- FRAUD may have 13% buy / 3% sell
- The route engine accounts for these when comparing paths

The route engine in the public repo (`app/lib/swap/route-engine.ts`) already handles all of this. It takes `EpochTaxState` as input and produces correctly-taxed quotes.

### 13.4 Convert V2 (amount_in=0 Sentinel)

The Conversion Vault's `convert_v2` instruction accepts `amount_in = 0` as a sentinel meaning "convert my entire balance of the input token." This eliminates intermediate token leakage in multi-hop routes.

**For the bot:** Always use `amount_in = 0` for vault convert steps in multi-hop routes. Pass `minimum_output` as the on-chain slippage guard.

### 13.5 Transfer Hook Remaining Accounts

All three tokens (CRIME, FRAUD, PROFIT) use Token-2022 Transfer Hooks. Every `transfer_checked` instruction requires **4 additional accounts** per mint:
1. `extra_account_meta_list` PDA
2. Whitelist entry for source
3. Whitelist entry for destination
4. Hook program ID

The hook resolver (`app/lib/swap/hook-resolver.ts`) computes these. The bot must include them in all swap and staking transactions.

### 13.6 Versioned Transactions + ALT

Sell-path transactions (23+ accounts) exceed Solana's 1232-byte legacy TX limit. The bot MUST use **VersionedTransaction v0** with the Address Lookup Table for sell transactions.

Use `skipPreflight: true` when submitting v0 transactions (devnet/some RPCs reject v0 simulation). Check `confirmation.value.err` after confirmation to detect failures.

---

## 14. Staking Integration Details

### 14.1 Staking Instructions

All staking instructions are on the Staking Program (`12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH`).

| Instruction | Accounts | Hook accounts | TX type |
|-------------|----------|---------------|---------|
| `stake` | 8 named | 4 (PROFIT transfer hook) | Legacy |
| `unstake` | 8 named | 4 (PROFIT transfer hook, reversed direction) | Legacy |
| `claim` | 5 named | 0 (native SOL, no hooks) | Legacy |

All three fit in legacy transactions — no ALT needed.

### 14.2 UserStake PDA

Each user's staking state is stored in a `UserStake` PDA:
- Seeds: `["user_stake", user_pubkey]`
- Program: Staking

Key fields:
| Field | Type | Description |
|-------|------|-------------|
| `staked_balance` | u64 | PROFIT staked (6 decimals) |
| `last_claim_ts` | i64 | Unix timestamp of last claim (0 if never claimed) |
| `rewards_earned` | u64 | Pending unclaimed rewards |
| `total_claimed` | u64 | Lifetime claimed rewards |

### 14.3 Cooldown Logic

```
if last_claim_ts == 0:
    UNLOCKED (never claimed)
elif (now - last_claim_ts) >= 43200:
    UNLOCKED (cooldown expired)
else:
    LOCKED (cooldown active)
    remaining = 43200 - (now - last_claim_ts)
```

### 14.4 Pending Rewards Calculation

The staking program uses a cumulative `rewards_per_token` model. To calculate pending rewards off-chain:

```
pending = user.staked_balance * (pool.rewards_per_token - user.rewards_per_token_paid) / PRECISION + user.rewards_earned
```

See `app/lib/staking/rewards.ts` in the public repo for the exact implementation.

---

## 15. Carnage Event Detection

### 15.1 On-Chain Event

The Epoch Program emits a `CarnageExecuted` event with:
- `action`: BuyOnly (0), Burn (1), or Sell (2)
- `target`: CRIME (0) or FRAUD (1)
- `tokens_bought`: amount of target token purchased
- `tokens_disposed`: amount burned or sold (0 for BuyOnly)
- `sol_spent`: SOL used for the buy
- `sol_recovered`: SOL from sell (0 for BuyOnly/Burn)

### 15.2 Detection Method

Options (in order of preference):
1. **Helius webhook**: Subscribe to Epoch Program transaction events, filter for CarnageExecuted
2. **Poll EpochState**: Check `carnage_pending` field, detect transitions from true -> false
3. **Consume the SSE feed**: If the website backend already broadcasts Carnage events

### 15.3 Notification Format

**Burn action (98% of events):**
> "CARNAGE TRIGGERED!
>
> Burned: 980,000 FRAUD
> Bought: 1,230,000 CRIME (spent 2.45 SOL)
>
> The Factory's furnaces burn bright..."

**Sell action (~2% of events):**
> "CARNAGE TRIGGERED!
>
> Sold: 500,000 CRIME for 1.2 SOL
> Bought: 1,100,000 FRAUD (spent 3.65 SOL)
>
> A rare Sell event! Dr. Fraudsworth is diversifying..."

**BuyOnly action (no existing holdings):**
> "CARNAGE TRIGGERED!
>
> Bought: 1,500,000 CRIME (spent 2.8 SOL)
>
> The Doctor is accumulating..."

---

## 16. Auto-Compound Scheduler

### 16.1 Architecture

The scheduler runs **inside the bot process** (no separate worker). It uses a database-driven approach:

1. Every **60 seconds**, the scheduler queries: `SELECT * FROM auto_schedule WHERE next_action_at <= NOW()`
2. For each due user:
   a. Read their `UserStake` account on-chain to get `last_claim_ts` and pending rewards
   b. Check if cooldown has expired (can claim)
   c. Check if pending rewards >= user's threshold
   d. If both conditions met: execute claim (or compound)
   e. Update `next_action_at` to `NOW() + 12 hours` (next check after cooldown)
   f. On failure: increment `consecutive_fails`, back off exponentially (max 1 hour)
3. On bot startup: query all users with auto-mode enabled, compute `next_action_at` from their on-chain `last_claim_ts`

### 16.2 Claiming Strategy

The bot claims **as soon as the cooldown expires** to maximize time staked and keep the user as close to cooldown expiry as possible at any point. The sequence:

1. Cooldown expires at time T
2. Scheduler fires at T (or within 60s of T)
3. Claims rewards
4. If auto-compound: swap claimed SOL -> PROFIT, stake PROFIT
5. New cooldown starts (12h from claim)
6. Next auto-action scheduled at T + 12h

### 16.3 Startup Recovery

On bot restart:
1. Query all users where `auto_mode != 'off'`
2. For each: read on-chain `UserStake.last_claim_ts`
3. Compute next action time: `last_claim_ts + 43200` (cooldown expiry)
4. If already past: schedule immediately
5. If in future: schedule at that time

This ensures no auto-compound cycles are missed due to restarts.

---

## 17. Admin Panel

Admin commands are accessible only from a specific Telegram user ID (the project owner). Set via env var `ADMIN_TELEGRAM_ID`.

### 17.1 Admin Commands (via inline buttons after admin sends any message)

| Command | Description |
|---------|-------------|
| Stats | Total users, active users (last 24h), total SOL held across all wallets, total PROFIT staked |
| Recent Activity | Last 20 transactions across all users (type, user, amount, status) |
| User Lookup | Look up a specific user by Telegram ID — their balances, settings, last action |
| Pause Trading | Emergency kill switch — disables all swap/stake/unstake/claim commands. Withdrawals still work. |
| Resume Trading | Re-enables trading after pause |
| Scheduler Status | Auto-compound scheduler health — users enrolled, last run, errors |
| Broadcast | Send a message to all bot users (for announcements) |

### 17.2 Admin Authentication

- Only the Telegram user ID matching `ADMIN_TELEGRAM_ID` env var can access admin functions
- Admin menu appears as a separate button only for the admin user
- All admin actions are logged to console/Sentry

---

## 18. Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `BOT_TOKEN` | Telegram Bot API token | `123456:ABC-DEF...` |
| `WEBHOOK_SECRET` | Secret token for Telegram webhook validation | Random 64-char string |
| `WEBHOOK_URL` | Public URL for Telegram to send updates | `https://bot.drfraudsworth.com/webhook` |
| `BOT_ENCRYPTION_MASTER_KEY` | 32-byte hex master key for wallet encryption | 64-char hex string |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `HELIUS_API_KEY` | Dedicated Helius API key for bot | (separate from website key) |
| `HELIUS_RPC_URL` | Full Helius RPC URL | `https://mainnet.helius-rpc.com/?api-key=...` |
| `SSE_FEED_URL` | Website backend SSE endpoint for display data | `https://drfraudsworth.com/api/sse` |
| `ADMIN_TELEGRAM_ID` | Telegram user ID for admin access | `123456789` |
| `SOLSCAN_BASE_URL` | Base URL for transaction links | `https://solscan.io` |
| `CLUSTER` | Solana cluster | `mainnet-beta` |

---

## 19. Build Phases

### Phase 1: Wallet Core
- grammY bot scaffold with webhook mode
- PostgreSQL schema + migrations
- Wallet creation, encryption, storage
- Fund detection (poll for SOL balance changes)
- Withdraw SOL to external address
- Export private key (spoiler + auto-delete)
- Balance display (SOL only initially)
- Onboarding flow with Dr. Fraudsworth character
- Admin: basic stats command

### Phase 2: Swap Engine
- Port route engine, quote engine, split router from public repo
- Port swap builders + multi-hop builder
- Port hook resolver
- Load mainnet addresses from `deployments/mainnet.json`
- Read EpochState for current tax rates
- SOL -> PROFIT buy flow with quote preview
- PROFIT -> SOL sell flow with quote preview
- Auto-slippage calculation
- Priority fee selection (Normal/Fast/Turbo)
- Versioned TX + ALT for sell path
- ATA creation (silent, from user SOL)
- 0.01 SOL reserve enforcement
- Solscan links on confirmation
- Friendly error messages

### Phase 3: Staking
- Port staking builders from public repo
- Stake PROFIT flow
- Unstake PROFIT flow (with cooldown check + countdown)
- Claim rewards flow
- Compound flow (claim -> swap -> stake)
- Balance display: staked balance, lock status, pending rewards, lifetime claimed

### Phase 4: Automation & Notifications
- Auto-claim scheduler
- Auto-compound scheduler
- User settings (mode, threshold, slippage, priority)
- Startup recovery (re-schedule from on-chain state)
- Cooldown expiry notifications
- Carnage event notifications (Helius webhook or SSE)
- Auto-claim/compound execution notifications

### Phase 5: Admin & Polish
- Full admin panel (stats, user lookup, pause/resume, broadcast)
- Rate limiting (per-user + global)
- Sentry error reporting
- Health check endpoint
- Home screen with CRIME/FRAUD MCAPs
- Character voice polish across all messages
- Edge case hardening (zero balances, dust amounts, concurrent actions)

### Phase 6: Security Audit
- SOS audit on any on-chain interaction patterns
- DB (Dinh's Bulwark) audit on the bot codebase:
  - Key encryption implementation
  - Webhook validation
  - Input sanitization
  - Rate limiting effectiveness
  - Admin authentication
  - TX building correctness (wrong accounts = lost funds)
  - Concurrent action safety

---

## 20. Important Terminology

| Term | Use | Do NOT Use |
|------|-----|-----------|
| Rewards | SOL earned from staking PROFIT | Yield, APY, interest, returns |
| Claim rewards | Collect pending SOL rewards | Harvest, collect yield |
| Compound | Claim + buy + stake | Auto-harvest, reinvest |
| Cooldown | 12h unstake lockout after claiming | Lock period, vesting |
| Carnage | Protocol buyback/burn event | Rebalancing, redistribution |

**Legal note:** Never display APY, yield percentages, or projected returns. Only show actual earned/pending reward amounts in SOL.

---

## 21. Solscan Links

All transaction links must point to **Solscan** (not Solana Explorer or other explorers):

```
https://solscan.io/tx/{signature}
```

For wallet addresses:
```
https://solscan.io/account/{address}
```

---

## 22. Open Questions / Future Considerations

| Item | Status | Notes |
|------|--------|-------|
| CRIME/FRAUD direct swaps | Deferred | Only SOL <-> PROFIT for v1. Could add later. |
| Referral system | Not planned | No protocol-level fees to share. Revisit if bot-specific fees added. |
| Multi-language | Not planned | English only for v1. |
| Group chat support | Not planned | DM only for security. |
| Jupiter routing | Parallel effort | If Jupiter lists the protocol, bot could use Jupiter API as an alternative route source. |
| Bonding curve interaction | Not included | Bonding curves are a one-time launch event, not ongoing. |
