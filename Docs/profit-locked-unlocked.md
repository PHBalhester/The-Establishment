# PROFIT: Locked vs Unlocked Explained

How Dr. Fraudsworth's Finance Factory displays staked PROFIT in two categories — **Locked** and **Unlocked** — and how to replicate this on an analytics dashboard.

---

## TL;DR

- Users stake PROFIT to earn SOL rewards from protocol fees
- After **claiming rewards**, a user's staked PROFIT enters a **12-hour cooldown** during which it cannot be unstaked
- **Locked PROFIT** = staked PROFIT where the user claimed rewards less than 12 hours ago
- **Unlocked PROFIT** = staked PROFIT where the user has never claimed, OR claimed 12+ hours ago

---

## The Cooldown Mechanic

Every user who stakes PROFIT has a `UserStake` account on-chain (PDA). The key field is:

| Field | Type | Description |
|-------|------|-------------|
| `last_claim_ts` | `i64` (Unix seconds) | Timestamp of the user's most recent reward claim |

### Rules

1. **On claim**: `last_claim_ts` is set to the current Solana clock timestamp
2. **Cooldown check**: If `now - last_claim_ts < 43,200` (12 hours in seconds), the user **cannot unstake** — their PROFIT is **Locked**
3. **Never-claimed users**: `last_claim_ts == 0` means the user has never claimed. They can unstake at any time — their PROFIT is **Unlocked**
4. **Full unstake resets cooldown**: When a user unstakes their entire balance, `last_claim_ts` resets to `0`

### Decision Tree

```
Has user ever claimed rewards?
├── NO (last_claim_ts == 0)  →  UNLOCKED
└── YES
    ├── now - last_claim_ts >= 43,200s  →  UNLOCKED
    └── now - last_claim_ts <  43,200s  →  LOCKED
```

---

## How to Calculate Global Locked / Unlocked

To get the total Locked and Unlocked PROFIT across all stakers:

### 1. Fetch all UserStake accounts

Use `getProgramAccounts` on the Staking program with the UserStake account discriminator.

**Staking Program ID (mainnet)**: `12b3XSQnhAGbmuinrgWNzPYXPwQBaYWMfTGnGDvvD7E`

**UserStake discriminator**: First 8 bytes of `sha256("account:UserStake")` = `[214, 220, 154, 255, 20, 99, 34, 114]`

### 2. Decode each account

UserStake account layout (after 8-byte discriminator):

| Offset | Size | Field | Type |
|--------|------|-------|------|
| 8 | 32 | `owner` | Pubkey |
| 40 | 8 | `staked_balance` | u64 (LE) |
| 48 | 16 | `rewards_per_token_paid` | u128 (LE) |
| 64 | 8 | `rewards_earned` | u64 (LE) |
| 72 | 8 | `total_claimed` | u64 (LE) |
| 80 | 8 | `first_stake_slot` | u64 (LE) |
| 88 | 8 | `last_update_slot` | u64 (LE) |
| 96 | 8 | `last_claim_ts` | i64 (LE) |
| 104 | 1 | `bump` | u8 |

### 3. Classify each staker

```
COOLDOWN_SECONDS = 43200
now_seconds = current_unix_timestamp()

for each user_stake:
    if user_stake.staked_balance == 0:
        skip (no active stake)

    if user_stake.last_claim_ts == 0:
        unlocked_total += user_stake.staked_balance
    elif (now_seconds - user_stake.last_claim_ts) >= COOLDOWN_SECONDS:
        unlocked_total += user_stake.staked_balance
    else:
        locked_total += user_stake.staked_balance
```

### 4. Convert to human-readable

PROFIT has **9 decimals**. Divide raw values by `10^9`:

```
displayed_locked   = locked_total   / 1_000_000_000
displayed_unlocked = unlocked_total / 1_000_000_000
```

---

## How the Website Does It

The website polls every **30 seconds** using the same `getProgramAccounts` approach:

1. **Backend** (`ws-subscriber.ts`): Scans all UserStake accounts, classifies each as locked/unlocked, sums the totals
2. **SSE broadcast**: Pushes `{ stakerCount, lockedProfit, unlockedProfit }` to connected clients via Server-Sent Events
3. **Frontend** (`useStaking` hook): Reads the SSE data and displays it in the staking panel

### Per-User Cooldown Timer

For the connected user's own stake, the frontend shows a live countdown:

```
expiry_ms = (last_claim_ts + 43200) * 1000
remaining_ms = expiry_ms - Date.now()

if remaining_ms > 0:
    show "Cooldown: Xh Ym"    // LOCKED
else:
    show "Eligible to Unstake" // UNLOCKED
```

---

## Why the Cooldown Exists

The 12-hour cooldown after claiming prevents **mercenary capital** — users who would:

1. Stake PROFIT just before a large fee distribution
2. Claim the rewards
3. Immediately unstake and leave

By locking the stake for 12 hours post-claim, users are incentivized to stay committed rather than enter-claim-exit in a single block.

---

## Edge Cases

| Scenario | Locked or Unlocked? |
|----------|-------------------|
| User staked but never claimed | **Unlocked** (`last_claim_ts == 0`) |
| User claimed 6 hours ago | **Locked** (6h < 12h) |
| User claimed 13 hours ago | **Unlocked** (13h >= 12h) |
| User fully unstaked then re-staked | **Unlocked** (full unstake resets `last_claim_ts` to 0) |
| User partially unstaked (balance > 0) | Cooldown state unchanged — still determined by `last_claim_ts` |

---

## Quick Reference

| Constant | Value |
|----------|-------|
| Cooldown duration | 43,200 seconds (12 hours) |
| PROFIT decimals | 9 |
| PROFIT total supply | 20,000,000 |
| PROFIT mint (mainnet) | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` |
| Staking program (mainnet) | `12b3XSQnhAGbmuinrgWNzPYXPwQBaYWMfTGnGDvvD7E` |
| UserStake discriminator | `[214, 220, 154, 255, 20, 99, 34, 114]` |
| Website poll interval | 30 seconds |
