# Deployment Sequence

This document describes the initialization order for the Dr. Fraudsworth staking + Transfer Hook system. The order is critical because each step depends on state created by the previous step.

## Why Order Matters

The system has three programs that must be initialized in a specific sequence:

1. **Transfer Hook** creates the WhitelistAuthority PDA that controls who can modify the whitelist
2. **Staking Program** creates the StakeVault PDA (PROFIT token account) during StakePool initialization
3. **Transfer Hook** whitelists the StakeVault so that stake/unstake transfers pass the hook check

If you initialize out of order:
- Whitelisting before StakePool init fails because StakeVault PDA doesn't exist yet
- StakePool init before WhitelistAuthority fails because the dead stake transfer needs hook accounts
- Stake/unstake before whitelisting fails with `NoWhitelistedParty` (error 0x1770)

## Initialization Steps

### Step 1: Transfer Hook - Initialize WhitelistAuthority

Creates the global authority PDA that controls whitelist additions.

- **Instruction:** `initializeAuthority()`
- **PDA:** `["authority"]` -> WhitelistAuthority
- **Signer:** Admin (becomes the whitelist authority)
- **Must complete before:** ExtraAccountMetaList init and any addWhitelistEntry calls

### Step 2: Staking Program - Create PROFIT Mint + Initialize StakePool

This step has multiple sub-steps that must happen in order:

**2a. Create PROFIT mint** (Token-2022 with Transfer Hook extension)
- Mint must point to our Transfer Hook program via the TransferHook extension
- This tells Token-2022 to invoke our hook on every `transfer_checked` call

**2b. Initialize ExtraAccountMetaList** for the PROFIT mint
- Creates the PDA that Token-2022 uses to resolve whitelist accounts at transfer time
- Seeds: `["extra-account-metas", mint_pubkey]`
- Must exist before any `transfer_checked` with this mint

**2c. Create admin token account + mint PROFIT**
- Admin needs PROFIT tokens to provide the dead stake during StakePool init

**2d. Whitelist admin's token account**
- The dead stake transfer (admin -> stakeVault) goes through the hook
- Admin's token account must be whitelisted as the source

**2e. Initialize StakePool**
- **Instruction:** `initializeStakePool()`
- **Creates PDAs:**
  - `["stake_pool"]` -> StakePool (global state)
  - `["escrow_vault"]` -> EscrowVault (native SOL for rewards)
  - `["stake_vault"]` -> StakeVault (Token-2022 PROFIT vault)
- **Dead stake:** Transfers MINIMUM_STAKE (1 PROFIT = 1,000,000 base units) to prevent first-depositor attack
- **Hook accounts:** Must be passed as `remainingAccounts` because stakeVault doesn't exist yet when building the instruction (manual derivation pattern from 28-01)

### Step 3: Transfer Hook - Add StakeVault to Whitelist (Entry #14)

Whitelists the StakeVault PDA so that all stake/unstake transfers pass the hook check.

- **Instruction:** `addWhitelistEntry()`
- **PDA:** `["whitelist", stake_vault_pubkey]` -> WhitelistEntry
- **Why only StakeVault:** The Transfer Hook checks source OR destination. Since stakeVault is always one end of the transfer (destination for stake, source for unstake), only it needs whitelisting. User token accounts do NOT need individual whitelist entries.

## Whitelist Entries

| Entry | Address | Purpose |
|-------|---------|---------|
| 1-13 | (existing AMM pools, treasury, etc.) | AMM and protocol operations |
| 14 | StakeVault PDA | Staking program PROFIT vault |

StakeVault whitelist entry #14 enables:
- **Stake:** User token account -> StakeVault (dest whitelisted)
- **Unstake:** StakeVault -> User token account (source whitelisted)

## Localnet Usage

### Prerequisites
- Local validator running: `solana-test-validator` or via `anchor localnet`
- Programs built and deployed: `anchor build && anchor deploy --provider.cluster localnet`
- Admin wallet funded: `keypairs/devnet-wallet.json` with SOL (airdrop handled by script if < 0.5 SOL)

### Run Initialization
```bash
npx ts-node scripts/init-localnet.ts
```

The script is **idempotent** - safe to run multiple times. It checks if each account already exists and skips with a "SKIP:" message if already initialized.

### Expected Output (First Run)
```
=== Dr. Fraudsworth Localnet Initialization ===

Admin: 8kPzhQ...
Admin SOL balance: 2 SOL
Staking Program: StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF
Transfer Hook Program: 9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ

=== Step 1: Initialize Transfer Hook WhitelistAuthority ===
OK: WhitelistAuthority initialized at ...

=== Step 2: Create PROFIT Mint + Initialize StakePool ===
  Creating PROFIT mint with Transfer Hook extension...
  OK: PROFIT mint created: ...
  ...
  OK: StakePool initialized with 1000000 dead stake

=== Step 3: Whitelist StakeVault (entry #14) ===
OK: StakeVault whitelisted at ...

=== Initialization Complete ===
System ready for stake/unstake operations.
```

### Expected Output (Re-Run)
```
=== Step 1: ... ===
SKIP: WhitelistAuthority already initialized at ...

=== Step 2: ... ===
SKIP: StakePool already initialized

=== Step 3: ... ===
SKIP: StakeVault already whitelisted at ...
```

## Verification After Initialization

Check these on-chain to confirm successful initialization:

1. **StakePool account exists and is initialized:**
   - `stakePool.initialized == true`
   - `stakePool.totalStaked == 1,000,000` (MINIMUM_STAKE dead stake)

2. **StakeVault has dead stake tokens:**
   - Token account balance == 1,000,000 (1 PROFIT)

3. **WhitelistEntry PDA exists for StakeVault:**
   - `whitelistEntry.address == stakeVault pubkey`

4. **Test stake/unstake works:**
   - Run the token-flow test suite: `anchor test` (uses separate validator)
   - Or manually stake via the staking program after init

## Program IDs

| Program | ID |
|---------|-----|
| Staking | StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF |
| Transfer Hook | 9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ |
| Token-2022 | TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb |

## PDA Seeds Reference

| PDA | Seeds | Program |
|-----|-------|---------|
| StakePool | `["stake_pool"]` | Staking |
| EscrowVault | `["escrow_vault"]` | Staking |
| StakeVault | `["stake_vault"]` | Staking |
| WhitelistAuthority | `["authority"]` | Transfer Hook |
| WhitelistEntry | `["whitelist", address]` | Transfer Hook |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | Transfer Hook |

## Pre-Mainnet: Create Protocol Address Lookup Table (ALT)

**Required for Carnage execution.** The `execute_carnage_atomic` instruction uses 23+ named accounts plus up to 6 Transfer Hook remaining_accounts (3 for sell + 3 for buy on the Sell path). This exceeds Solana's 1232-byte legacy transaction limit.

An Address Lookup Table (ALT) compresses account pubkeys from 32 bytes to 1 byte each in VersionedTransaction (v0) format. The on-chain programs are unaffected -- ALTs are purely a client-side wire format optimization.

**Tasks:**
- [ ] Create ALT on mainnet using `scripts/e2e/lib/alt-helper.ts` (or equivalent)
- [ ] Populate with all protocol addresses: PDAs, pool accounts, mints, program IDs, whitelist PDAs, ExtraAccountMetaList PDAs
- [ ] Record the ALT address in `pda-manifest.json` under a new `alt` key
- [ ] Update the Carnage keeper bot to use VersionedTransaction (v0) with the ALT
- [ ] Publish the ALT address so third-party keepers can also call `execute_carnage_atomic`

**Why this matters:**
- Without ALT: BuyOnly (98%+) and Burn paths work, but the 2% Sell path transaction is too large
- Without ALT for Sell: Sell Carnage expires via `expire_carnage` deadline (no damage, but the action is lost)
- With ALT: all paths fit comfortably, and the bundled `consume_randomness + execute_carnage_atomic` transaction also fits
- ALT costs ~0.003 SOL rent, persists indefinitely, and is reusable by any caller

**Devnet ALT:** Created automatically by `carnage-hunter.ts` and cached at `scripts/deploy/alt-address.json`

## Pre-Mainnet: VRF Reveal Retry Handling

**Not yet implemented.** The current VRF flow in `scripts/vrf/lib/vrf-flow.ts` has a gap in the happy path: if the Switchboard gateway returns a reveal instruction but the on-chain reveal fails (e.g. oracle field still null due to a race condition), the error bubbles up unhandled. The runner self-heals on the next epoch iteration via the stale VRF recovery path, but this wastes one epoch cycle (~5 min on devnet).

**Observed on devnet:** TX `3RwGsAUEEAx3iGCx8KQNExMwfp7mYKHYgyk1PmYyqYXZXqesCYpJDA6Q1rHeifmZCgcXoTbZ5piutFiPbt1LHJUU` — Switchboard `RandomnessReveal` failed with `ConstraintHasOne` (error 2001) because the randomness account's oracle field was still System Program (uninitialized) despite the gateway returning a reveal instruction.

**Tasks:**
- [ ] Wrap the happy-path `sendRevealAndConsume` call in a try/catch (around line 501 in vrf-flow.ts)
- [ ] On failure, fall back to VRF timeout recovery immediately instead of deferring to the next iteration
- [ ] This ensures epoch transitions recover within the same cycle — critical for mainnet where each missed epoch has real economic impact

## Pre-Mainnet: Upgrade Authority Multisig

**Not yet implemented.** Before mainnet deployment, transfer upgrade authority for all 5 programs to a Squads multisig with 48-72 hour timelock. This is an operational step, not a code change.

**Tasks:**
- [ ] Create Squads multisig (determine signer set + threshold)
- [ ] Transfer upgrade authority for all 5 programs: `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_MULTISIG>`
- [ ] Separate admin roles: different keys for upgrade authority, AMM admin, whitelist authority
- [ ] Remove keypair files from repository (or move to secure vault)
- [ ] Verify on-chain that all programs show the multisig as upgrade authority

**Audit reference:** H014 (CRIT-04), P0 recommendation #4

---
*Source: .planning/phases/28-token-flow-whitelist/28-03-PLAN.md*
*Script: scripts/init-localnet.ts*
