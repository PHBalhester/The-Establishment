# Phase 74: Protocol Integration - Research

**Researched:** 2026-03-04
**Domain:** Solana deploy pipeline extension, Transfer Hook whitelist management, multi-TX graduation orchestration, lifecycle testing
**Confidence:** HIGH

## Summary

Phase 74 wires the bonding curve program (built in Phases 71-73) into the existing 6-program Dr. Fraudsworth protocol. This is a systems integration phase -- no new on-chain logic is needed (all instructions exist), but the deploy pipeline, whitelist management, graduation orchestration, ALT, and testing must be carefully extended.

The integration has two distinct operational moments: (1) deploy-time setup (build/deploy/init the 7th program, whitelist curve vaults, burn whitelist authority), and (2) post-fill graduation (days/weeks later -- prepare_transition, seed AMM pools, seed Conversion Vault, distribute tax escrow, finalize). These are completely separate scripts.

**Primary recommendation:** Extend the existing pipeline files (build.sh, deploy.sh, initialize.ts, patch-mint-addresses.ts, pda-manifest.ts, alt-helper.ts, connection.ts) with bonding curve support, then create a new standalone `scripts/graduation/graduate.ts` script with checkpoint+resume for the post-fill graduation sequence. Testing via a comprehensive localnet integration test that exercises the full lifecycle.

## Standard Stack

### Core

The "stack" for Phase 74 is the existing project tooling -- no new libraries needed.

| Tool | Version | Purpose | Already In Use |
|------|---------|---------|----------------|
| Anchor CLI | 0.32.1 | Build bonding curve with feature flags | Yes (6 programs) |
| @coral-xyz/anchor | 0.32.1 | TS client for program interaction | Yes (initialize.ts) |
| @solana/web3.js | 1.x | Transactions, PDAs, ALT management | Yes (throughout) |
| @solana/spl-token | latest | Token-2022 transfers with hooks | Yes (initialize.ts) |
| npx tsx | latest | Run TS scripts without compilation | Yes (all scripts) |
| ts-mocha | latest | Anchor test runner | Yes (Anchor.toml) |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| LiteSVM | Lightweight localnet for proptest | Only if unit-testing graduation math |
| fs.writeFileSync/readFileSync | Checkpoint file for graduation resume | Graduation script state persistence |

### Alternatives Considered

None -- this phase exclusively extends existing patterns. No new libraries or frameworks.

## Architecture Patterns

### Recommended File Structure

```
scripts/
  deploy/
    build.sh              # EXTEND: add bonding_curve as 7th program
    deploy.sh             # EXTEND: add bonding_curve deploy step
    initialize.ts         # EXTEND: add curve init + whitelist + burn steps
    patch-mint-addresses.ts # EXTEND: patch bonding_curve/src/constants.rs
    lib/
      connection.ts       # EXTEND: add BondingCurve type import
      pda-manifest.ts     # EXTEND: add curve PDAs to manifest
    verify.ts             # EXTEND: verify curve accounts
  graduation/
    graduate.ts           # NEW: checkpoint+resume graduation script
    graduation-state.json # NEW: checkpoint file (written at runtime)
  e2e/
    lib/
      alt-helper.ts       # EXTEND: add curve addresses to ALT
tests/
  integration/
    lifecycle.test.ts     # NEW: comprehensive lifecycle test (happy + failure + edge)
```

### Pattern 1: Deploy Pipeline Extension (Adding the 7th Program)

**What:** The existing deploy pipeline handles 6 programs with a well-established pattern. The bonding curve is added as the 7th following identical conventions.

**Key files to extend and how:**

1. **build.sh** -- Add `anchor build -p bonding_curve -- --features devnet` to the devnet rebuild section (line ~80). Add `"bonding_curve"` to the PROGRAMS array for artifact verification (line ~96).

2. **deploy.sh** -- Add `"bonding_curve:keypairs/bonding-curve-keypair.json"` to the PROGRAMS array (line ~136). Requires creating `keypairs/bonding-curve-keypair.json` first.

3. **initialize.ts** -- The bulk of the work. New steps added AFTER existing step 16 (whitelist carnage vaults) but BEFORE a new final step for whitelist authority burn + PDA manifest:
   - Step N: Initialize CRIME curve (initialize_curve with Token::Crime)
   - Step N+1: Initialize FRAUD curve (initialize_curve with Token::Fraud)
   - Step N+2: Fund CRIME curve (fund_curve -- 460M tokens from admin)
   - Step N+3: Fund FRAUD curve (fund_curve -- 460M tokens from admin)
   - Step N+4: Start CRIME curve (start_curve)
   - Step N+5: Start FRAUD curve (start_curve)
   - Step N+6: Whitelist CRIME curve token vault (addWhitelistEntry)
   - Step N+7: Whitelist FRAUD curve token vault (addWhitelistEntry)
   - Step N+8: Burn whitelist authority (burn_authority -- IRREVERSIBLE, must be LAST whitelist step)

4. **patch-mint-addresses.ts** -- Add patches for `programs/bonding_curve/src/constants.rs` (crime_mint, fraud_mint functions, and epoch_program_id).

5. **connection.ts** -- Add `BondingCurve` type import and `bondingCurve` to the Programs interface and loadPrograms.

6. **pda-manifest.ts** -- Add curve PDA derivations (CurveState CRIME, CurveState FRAUD, token vaults, SOL vaults, tax escrows).

7. **alt-helper.ts** -- Add curve addresses to collectProtocolAddresses.

**Critical sequencing insight:**

```
Existing init steps 1-16 (mints, hooks, pools, vault, epoch, staking, carnage)
  |
  v
NEW: Initialize curves (needs mints to exist)
  |
  v
NEW: Fund curves (needs admin token accounts with 460M tokens each -- but mint authority is ALREADY BURNED in step 10!)
  |
  v
NEW: Start curves
  |
  v
NEW: Whitelist curve token vaults (needs whitelist authority active)
  |
  v
NEW: Burn whitelist authority (IRREVERSIBLE -- must be after ALL whitelist entries)
  |
  v
PDA Manifest + Verify
```

### Pattern 2: Mint Authority Timing Problem (CRITICAL)

**What:** The existing initialize.ts burns mint authority in Step 10. But funding the bonding curve requires minting 460M tokens per curve to an admin account, then transferring. The current flow mints ALL token supply (1B CRIME, 1B FRAUD, 20M PROFIT) upfront in Step 5, then burns mint authority in Step 10.

**Implication:** The bonding curve's 460M tokens per curve must come from the tokens minted in Step 5. The existing supply allocation is:
- CRIME: 1B total = 460M (curve) + 290M (pool seed) + 250M (vault seed) = 1B (exact)
- FRAUD: 1B total = 460M (curve) + 290M (pool seed) + 250M (vault seed) = 1B (exact)

Wait -- the current initialize.ts mints 1B CRIME and distributes: 290M to pool seed + 250M to vault = 540M. That leaves 460M in the admin account. These 460M ARE the bonding curve allocation.

BUT: The existing Step 7 seeds pools with `SOL_POOL_SEED_TOKEN` (defaults to 10K tokens for tests, 290M for devnet via env override), and Step 10 seeds vault with 250M. So the admin account should have 460M CRIME and 460M FRAUD remaining after steps 7+10. This is exactly what fund_curve needs.

**Key issue:** The admin token accounts created in Step 5 are ephemeral (fresh Keypair each run). By the time we get to the curve funding steps, we need to either:
(a) Reuse the same admin token accounts from Step 5 (they still hold 460M after pool+vault seeding)
(b) Create new admin token accounts and mint additional tokens (impossible -- authority burned)

The answer is (a). The admin token accounts created in Step 5 will have their remaining balance (460M) available for curve funding in the new steps. The variable `adminCrimeAccount` / `adminFraudAccount` are already in scope for the new steps.

**BUT there's a timing subtlety:** The existing Step 10 burns MINT authority. However, Step 5 already minted the full 1B supply. So after Step 5, the admin holds 1B tokens. After Step 7 (pool seeding): admin holds ~710M (1B - 290M). After Step 10 (vault seeding): admin holds ~460M (710M - 250M). After Step 10 mint authority burn: admin STILL holds 460M. So fund_curve just transfers these 460M from admin to curve vault. No new minting needed.

**This means the curve steps MUST come after step 10 (vault seeding) but before whitelist authority burn.**

### Pattern 3: Whitelist Authority Burn (CRITICAL SEQUENCING)

**What:** The whitelist authority burn (`burn_authority`) is currently NOT called anywhere in the deploy pipeline. The Transfer Hook whitelist authority is still active on devnet. Phase 74 must add this as the FINAL step, after all whitelist entries are created.

**Current whitelist entries (from initialize.ts):**
1. Step 6: Admin CRIME/FRAUD/PROFIT token accounts (3 entries)
2. Step 9: Conversion Vault token accounts (3 entries: crime, fraud, profit)
3. Step 11: Pool vault addresses (4 entries: CRIME/SOL vaultA/vaultB, FRAUD/SOL vaultA/vaultB)
4. Step 14: StakeVault (1 entry)
5. Step 16: Carnage CRIME+FRAUD vaults (2 entries)

**New whitelist entries for bonding curve:**
6. CRIME curve token vault PDA (1 entry)
7. FRAUD curve token vault PDA (1 entry)

**Total whitelist entries before burn:** 13 existing + 2 curve = 15

**After burn_authority, NO MORE entries can ever be added.** This is the security guarantee: the whitelist becomes immutable. Therefore burn_authority MUST be the absolute last whitelist-related step.

**Question: Do curve SOL vaults need whitelisting?** No. SOL vaults are plain SOL-only PDAs (space = 0). They receive/send native SOL via lamport manipulation, not Token-2022 transfers. Only token accounts that participate in Token-2022 transfers need whitelist entries.

**Question: Do admin token accounts used for fund_curve need whitelisting?** Yes. The admin token accounts hold CRIME/FRAUD (Token-2022 tokens with Transfer Hook). Transferring from admin -> curve vault triggers the Transfer Hook, which checks both source and destination whitelist entries. The admin accounts are ALREADY whitelisted in Step 6. The curve vault accounts are the NEW entries needed.

### Pattern 4: Graduation Script (Checkpoint + Resume)

**What:** A standalone script run manually when both curves fill. Uses a state file to track progress through the multi-TX graduation sequence.

**Graduation sequence (from 74-CONTEXT.md):**
1. prepare_transition (both curves) -- on-chain: Filled -> Graduated
2. Transfer tokens from curve vaults to admin wallet (off-chain: close/withdraw)
3. AMM pool seeding: 290M tokens + 1,000 SOL per pool (CRIME/SOL + FRAUD/SOL)
4. Conversion Vault seeding: 250M CRIME + 250M FRAUD + 20M PROFIT
5. distribute_tax_escrow (CRIME curve -> carnage fund)
6. distribute_tax_escrow (FRAUD curve -> carnage fund)
7. finalize_transition (both curves) -- if this instruction exists, or just verification

**Token flow detail:**
After prepare_transition, both curves are in `Graduated` status. The curve token vaults still hold the unsold tokens (ideally 0 since both curves filled with 460M sold = 0 remaining in vault). Wait -- if the curve sold exactly 460M tokens, the vault is empty. The 290M for pool seeding and 250M for vault seeding come from RESERVE tokens that were held separately during the initial deployment.

**CRITICAL RE-EXAMINATION:** Looking at 74-CONTEXT.md: "Admin intermediary -- prepare_transition releases assets to admin wallet first, then admin script seeds pools/vault from admin's token accounts (two-hop)."

But looking at the on-chain `prepare_transition` instruction -- it ONLY sets status to Graduated. It does NOT release any assets. The instruction takes no vault accounts. So "releases assets" must mean the admin SEPARATELY withdraws from the curve vaults.

Actually wait -- the curve sold 460M tokens and raised ~1000 SOL. After graduation:
- Curve token vault: EMPTY (all 460M sold to users)
- Curve SOL vault: Holds ~1000 SOL (raised from sales)
- Tax escrow: Holds sell tax SOL

The graduation needs:
- 1000 SOL from curve SOL vault -> pool seeding
- 290M tokens for pool seeding -> from WHERE?

**KEY INSIGHT:** The token allocation is: 1B total = 460M (curve sale) + 290M (pool reserve) + 250M (vault reserve). The 290M and 250M are NOT in the curve program. They come from the ADMIN's token supply during deployment. The existing initialize.ts mints 1B, seeds 290M to AMM pools and 250M to conversion vault. But those pools and vault are the EXISTING ones that are already seeded.

**Wait -- that's the current deployment without bonding curves.** With bonding curves, the flow changes:
- At deploy time: mint 1B, seed 460M to each curve vault, hold 540M in admin (290M + 250M).
- After curves fill: admin uses the held 540M (290M -> new pools, 250M -> vault) plus 1000 SOL from each curve's SOL vault.

**This means the deploy-time initialization must NOT seed AMM pools or Conversion Vault.** Those are seeded AFTER graduation with bonding curve proceeds.

**CORRECTION:** Re-reading the requirements and context more carefully. The graduation sequence explicitly states "AMM pool seeding (290M tokens + 1,000 SOL per pool)". This means:
- At deploy time: AMM pools are NOT seeded (they don't exist yet until graduation)
- At deploy time: Conversion Vault is NOT seeded (seeded during graduation)
- At deploy time: Only curves are initialized and funded
- After graduation: Admin creates and seeds pools + vault from held reserves + curve proceeds

**This requires RETHINKING the initialize.ts flow.** In the bonding curve world:
1. Mints are created (same)
2. Transfer Hook is initialized (same)
3. Curves are initialized + funded + started (NEW)
4. Curve vaults are whitelisted (NEW)
5. Whitelist authority is burned (NEW)
6. AMM pools are NOT created yet (CHANGE from current)
7. Conversion Vault is NOT seeded yet (CHANGE from current)
8. Epoch/Staking/Carnage ARE initialized (same -- needed for protocol to function post-graduation)

Wait -- but this means the existing pool-dependent infrastructure (Carnage, tax swaps, etc.) won't work until graduation. That's correct -- the protocol doesn't become fully operational until after graduation. During the bonding curve phase, the only active programs are the bonding curve (buy/sell) and the Transfer Hook (whitelist checks on curve transfers).

**EVEN MORE CRITICAL:** Looking at `initialize.ts` Step 7 -- it creates AMM pools WITH seed liquidity. If we don't seed pools at deploy time, we need to create them during graduation. But creating pools requires the AMM AdminConfig to exist. The AdminConfig can be initialized at deploy time (Step 4 in current flow) without creating any pools.

**Graduation script token flow (revised understanding):**
1. `prepare_transition` -- both curves Filled -> Graduated
2. Admin withdraws SOL from curve SOL vaults (1000 SOL each, ~2000 SOL total)
   -- But how? There's no "withdraw SOL" instruction on the bonding curve program. The SOL vault is a program-owned PDA.

**ANOTHER KEY INSIGHT:** Looking at prepare_transition again -- it ONLY changes status. There's no instruction to withdraw SOL from the curve vaults. The 74-CONTEXT.md says "prepare_transition releases assets to admin wallet first" -- but the current on-chain code does NOT do this.

This means either:
(a) A new on-chain instruction is needed to withdraw from graduated curve vaults (OUT OF SCOPE for Phase 74 since it modifies the on-chain program -- that would be Phase 71-73 territory), OR
(b) The graduation script uses a different mechanism

Looking at the Phase 73 docs context: "prepare_transition releases assets to admin wallet first". This suggests the on-chain instruction SHOULD release assets but the current implementation doesn't. Since Phase 73 is complete and the instruction is deployed, we need to check if there's an unreleased instruction or if this is a gap.

**RE-EXAMINATION of token sources for graduation:**
Actually -- re-reading the CONTEXT.md: "Token flow: Admin intermediary -- prepare_transition releases assets to admin wallet first"

But the on-chain prepare_transition instruction (which I read in full) does NOT transfer any assets. It ONLY sets both curves to Graduated status. There must be a separate mechanism for asset release.

**The answer is: The admin held back the 290M (pool reserve) + 250M (vault reserve) tokens at deploy time.** They are NOT in the curve vaults. The curves only ever hold 460M sale tokens. The reserves are held in admin token accounts throughout the bonding curve phase.

For SOL: The curve SOL vaults hold ~1000 SOL each (raised from sales). After graduation, the admin needs this SOL for pool seeding. The question is how to withdraw it.

**This reveals a gap that needs discussion.** The prepare_transition instruction does not include asset withdrawal. The 74-CONTEXT.md mentions "transfer assets to admin" as a separate step, which implies there are additional instructions or the admin can directly withdraw from graduated curve vaults. But there's no `withdraw_sol` instruction in the bonding curve program.

**Possible resolution:** A new on-chain instruction `withdraw_graduated_assets` could be added to the bonding curve program. This was likely planned as part of Phase 73 or needs to be built as part of Phase 74. Since the CONTEXT.md explicitly mentions "prepare_transition releases assets to admin wallet first, then admin script seeds pools/vault from admin's token accounts (two-hop)", this instruction likely needs to exist.

**Alternatively:** Close the curve's SOL vault PDA. When a program-owned account is "closed" (all lamports transferred), the program can do this in an instruction. This would need a `withdraw_from_graduated` instruction.

### Pattern 5: ALT Extension Strategy

**What:** The existing ALT has 46 addresses. Solana ALTs support up to 256 entries. Adding bonding curve addresses:

New addresses to add:
- Bonding Curve program ID (1)
- CurveState CRIME PDA (1)
- CurveState FRAUD PDA (1)
- CRIME token vault PDA (1)
- FRAUD token vault PDA (1)
- CRIME SOL vault PDA (1)
- FRAUD SOL vault PDA (1)
- CRIME tax escrow PDA (1)
- FRAUD tax escrow PDA (1)

Total new: ~9 addresses. 46 + 9 = 55, well under the 256 limit.

**Recommendation:** Extend the existing ALT. No need for a separate curve ALT. The alt-helper.ts `collectProtocolAddresses` function already collects from the PDA manifest -- adding curve PDAs to the manifest will automatically include them.

### Pattern 6: Feature-Gated Mint Addresses

**What:** The bonding curve program ALREADY has the correct feature-gate pattern in `programs/bonding_curve/src/constants.rs`:
- `crime_mint()` with `#[cfg(feature = "devnet")]` returning the devnet address
- `fraud_mint()` with `#[cfg(feature = "devnet")]` returning the devnet address
- `epoch_program_id()` with `#[cfg(feature = "devnet")]` returning the devnet address

The `patch-mint-addresses.ts` script needs to be extended to also patch these functions in `programs/bonding_curve/src/constants.rs`, using the same pattern it uses for `conversion-vault/src/constants.rs` and `tax-program/src/constants.rs`.

### Anti-Patterns to Avoid

- **Seeding AMM pools at deploy time with bonding curves:** In the bonding curve flow, AMM pools are created and seeded DURING GRADUATION, not at deploy time. The deploy-time init must skip pool creation.
- **Calling burn_authority before all whitelist entries are added:** This is irreversible. Once burned, no more whitelist entries can ever be created. Must be the absolute last whitelist step.
- **Assuming curve vaults have withdraw instructions:** The current on-chain prepare_transition does NOT withdraw assets. This is a gap that needs resolution.
- **Creating a separate ALT for curve:** The existing ALT has plenty of capacity (46/256 used). Extend, don't duplicate.
- **Running graduation during deploy:** Deploy and graduation are separated by days/weeks. Do not merge them into one script.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA derivation | Manual seed construction | `deriveWhitelistEntryPDA`, `PublicKey.findProgramAddressSync` | Already canonical in constants.ts |
| Transfer Hook accounts | Manual account list building | Follow existing `hookRemainingAccounts` pattern in initialize.ts | 4-account pattern is established (extraMeta, wlSource, wlDest, hookProgramId) |
| ALT management | New ALT creation logic | `getOrCreateProtocolALT` in alt-helper.ts | Already handles creation, extension, caching |
| Idempotent checks | Custom re-run logic | `accountExists()`, `mintExists()` from lib/account-check.ts | Already in use throughout initialize.ts |
| Canonical mint ordering | Manual byte comparison | `canonicalOrder()` from pda-manifest.ts | Already handles mint ordering for pool PDAs |

**Key insight:** Phase 74 is an integration phase, not a building phase. Every mechanism needed already exists in the codebase. The work is wiring, not creation.

## Common Pitfalls

### Pitfall 1: Whitelist Authority Burn Order

**What goes wrong:** If burn_authority is called before curve vault whitelist entries are created, no more entries can ever be added. The curve's Token-2022 transfers will fail with "WhitelistCheckFailed" because the vault isn't whitelisted.

**Why it happens:** The burn is irreversible and the current initialize.ts doesn't call it at all. Easy to accidentally place it too early in the sequence.

**How to avoid:** Make burn_authority the ABSOLUTE LAST whitelist-related step. Add a comment like `// WARNING: IRREVERSIBLE -- must be after ALL whitelist entries including curve vaults`.

**Warning signs:** Transfer Hook error 0x1770 (WhitelistCheckFailed) on any Token-2022 transfer involving curve vaults.

### Pitfall 2: Admin Token Balance After Pool + Vault Seeding

**What goes wrong:** If the admin token accounts don't have exactly 460M remaining after pool seeding (290M) and vault seeding (250M), the fund_curve call will fail with insufficient balance.

**Why it happens:** The SOL_POOL_SEED_TOKEN env var override might be wrong, or the VAULT_SEED amounts don't add up.

**How to avoid:** Add an explicit balance assertion before fund_curve: verify admin holds >= 460M tokens. Log the balance.

**Warning signs:** Token transfer error on fund_curve. Or worse: if less than 460M is available, the curve is underfunded and start_curve will reject it.

### Pitfall 3: Missing .env Sourcing for Graduation Script

**What goes wrong:** Graduation script uses default test values instead of production seed amounts (290M tokens per pool, 1000 SOL per pool).

**Why it happens:** Learned lesson from Phase 69 -- SOL_POOL_SEED_SOL_OVERRIDE and SOL_POOL_SEED_TOKEN_OVERRIDE must be set via .env. If .env isn't sourced, the defaults are 10 SOL / 10K tokens.

**How to avoid:** Graduation script must source .env at startup, OR hardcode the graduation amounts (since they're not configurable -- the spec requires 290M tokens + 1000 SOL per pool).

**Warning signs:** Pools seeded with tiny amounts. Barely any liquidity.

### Pitfall 4: Curve SOL Vault Withdrawal Gap

**What goes wrong:** After prepare_transition, the admin needs ~1000 SOL from each curve's SOL vault to seed AMM pools. But there's no on-chain instruction to withdraw from graduated curve SOL vaults.

**Why it happens:** The prepare_transition instruction only changes status -- it doesn't move any assets. The 74-CONTEXT.md mentions "transfer assets to admin" but no instruction exists for this.

**How to avoid:** This is an **open question** that must be resolved before planning. Either:
(a) Add a `withdraw_graduated` instruction to the bonding curve program (may need Phase 71 amendment), OR
(b) Use the existing `close` mechanism if the runtime allows programs to close their own PDAs, OR
(c) Redesign the graduation flow to seed pools directly from curve vaults (CPI from bonding curve program to AMM).

**Warning signs:** Graduation script reaches the "transfer SOL to admin" step and has no way to execute it.

### Pitfall 5: Bonding Curve Keypair Missing

**What goes wrong:** deploy.sh tries to deploy bonding_curve but there's no `keypairs/bonding-curve-keypair.json`.

**Why it happens:** The bonding curve program ID `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1` is already declared in `lib.rs` and `Anchor.toml`, but there's no keypair file in the keypairs directory.

**How to avoid:** Either generate a keypair that matches the declared ID (if one exists in `target/deploy/`), or use `anchor keys sync` to align keypairs with declare_id macros.

**Warning signs:** Deploy fails with address mismatch between keypair and declare_id.

### Pitfall 6: Two-Pass Deploy for Feature-Gated Programs

**What goes wrong:** Bonding curve compiles with default (mainnet) mint addresses instead of devnet addresses.

**Why it happens:** The two-pass deploy pattern requires: first `anchor build` (generates IDL), then `anchor build -p bonding_curve -- --features devnet` (rebuilds with correct addresses). If the second pass is skipped, initialize_curve will reject mint addresses.

**How to avoid:** build.sh already handles this pattern for epoch_program, tax_program, and conversion_vault. Just add `anchor build -p bonding_curve -- --features devnet` to the same section.

**Warning signs:** ConstraintRaw error on initialize_curve because the compiled-in mint address doesn't match the actual devnet mint.

### Pitfall 7: Transfer Hook Remaining Accounts for fund_curve

**What goes wrong:** fund_curve transfers 460M Token-2022 tokens from admin to curve vault. This triggers the Transfer Hook. If remaining_accounts aren't provided correctly, the transfer fails.

**Why it happens:** The fund_curve instruction accepts `remaining_accounts` for Transfer Hook support. The admin token account (source) and curve token vault (destination) both need whitelist entries, and the extra_account_meta_list for the mint must be provided.

**How to avoid:** Follow the exact pattern from initialize.ts Step 10 (vault seeding): build the 4-account hook array [extraMeta, wlSource, wlDest, hookProgramId] and pass as remaining_accounts.

**Warning signs:** Transfer Hook error 3005 (AccountNotEnoughKeys) or 0x1770 (WhitelistCheckFailed).

## Code Examples

### Example 1: Initialize a Bonding Curve in TypeScript

```typescript
// Source: Derived from programs/bonding_curve/src/instructions/initialize_curve.rs

const CURVE_SEED = Buffer.from("curve");
const CURVE_TOKEN_VAULT_SEED = Buffer.from("curve_token_vault");
const CURVE_SOL_VAULT_SEED = Buffer.from("curve_sol_vault");
const TAX_ESCROW_SEED = Buffer.from("tax_escrow");

// Derive PDAs for CRIME curve
const [crimeState] = PublicKey.findProgramAddressSync(
  [CURVE_SEED, crimeMint.toBuffer()],
  bondingCurveProgram.programId
);
const [crimeTokenVault] = PublicKey.findProgramAddressSync(
  [CURVE_TOKEN_VAULT_SEED, crimeMint.toBuffer()],
  bondingCurveProgram.programId
);
const [crimeSolVault] = PublicKey.findProgramAddressSync(
  [CURVE_SOL_VAULT_SEED, crimeMint.toBuffer()],
  bondingCurveProgram.programId
);
const [crimeTaxEscrow] = PublicKey.findProgramAddressSync(
  [TAX_ESCROW_SEED, crimeMint.toBuffer()],
  bondingCurveProgram.programId
);

// Initialize curve
await bondingCurveProgram.methods
  .initializeCurve({ crime: {} })  // Token enum
  .accountsStrict({
    authority: authority.publicKey,
    curveState: crimeState,
    tokenVault: crimeTokenVault,
    solVault: crimeSolVault,
    taxEscrow: crimeTaxEscrow,
    tokenMint: crimeMint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([authority])
  .rpc();
```

### Example 2: Fund Curve with Transfer Hook Remaining Accounts

```typescript
// Source: Pattern from initialize.ts Step 10 (vault seeding) adapted for fund_curve

const [extraMeta] = PublicKey.findProgramAddressSync(
  [EXTRA_ACCOUNT_META_SEED, crimeMint.toBuffer()],
  hookProgramId
);
const [wlSource] = deriveWhitelistEntryPDA(adminCrimeAccount, hookProgramId);
const [wlDest] = deriveWhitelistEntryPDA(crimeTokenVault, hookProgramId);

const hookAccounts = [
  { pubkey: extraMeta, isSigner: false, isWritable: false },
  { pubkey: wlSource, isSigner: false, isWritable: false },
  { pubkey: wlDest, isSigner: false, isWritable: false },
  { pubkey: hookProgramId, isSigner: false, isWritable: false },
];

await bondingCurveProgram.methods
  .fundCurve()
  .accountsStrict({
    authority: authority.publicKey,
    curveState: crimeState,
    authorityTokenAccount: adminCrimeAccount,
    tokenVault: crimeTokenVault,
    tokenMint: crimeMint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .remainingAccounts(hookAccounts)
  .signers([authority])
  .rpc();
```

### Example 3: Whitelist a Curve Vault

```typescript
// Source: Pattern from initialize.ts Step 11 (pool vault whitelisting)

const [whitelistEntry] = deriveWhitelistEntryPDA(crimeTokenVault, hookProgramId);

if (!(await accountExists(connection, whitelistEntry))) {
  await transferHookProgram.methods
    .addWhitelistEntry()
    .accountsStrict({
      authority: authority.publicKey,
      whitelistAuthority,
      whitelistEntry,
      addressToWhitelist: crimeTokenVault,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
}
```

### Example 4: Burn Whitelist Authority

```typescript
// Source: programs/transfer-hook/src/instructions/burn_authority.rs

await transferHookProgram.methods
  .burnAuthority()
  .accountsStrict({
    authority: authority.publicKey,
    whitelistAuthority,
  })
  .signers([authority])
  .rpc();

// IRREVERSIBLE -- no more whitelist entries can ever be added
```

### Example 5: Graduation Checkpoint Pattern

```typescript
// Source: 74-CONTEXT.md decision: "Checkpoint + resume"

interface GraduationState {
  steps: {
    name: string;
    completed: boolean;
    txSig?: string;
    timestamp?: string;
  }[];
}

const STATE_FILE = "scripts/graduation/graduation-state.json";

function loadState(): GraduationState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return { steps: GRADUATION_STEPS.map(name => ({ name, completed: false })) };
}

function saveState(state: GraduationState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// For each step:
for (const step of state.steps) {
  if (step.completed) {
    console.log(`  SKIP: ${step.name} (completed at ${step.timestamp})`);
    continue;
  }

  // Execute step...
  step.completed = true;
  step.txSig = sig;
  step.timestamp = new Date().toISOString();
  saveState(state);  // Checkpoint after each step
}
```

### Example 6: Distribute Tax Escrow

```typescript
// Source: programs/bonding_curve/src/instructions/distribute_tax_escrow.rs

const [carnageSolVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("carnage_sol_vault")],
  epochProgramId
);

await bondingCurveProgram.methods
  .distributeTaxEscrow()
  .accountsStrict({
    curveState: crimeState,
    taxEscrow: crimeTaxEscrow,
    carnageFund: carnageSolVault,
  })
  .rpc();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 6-program deploy | 7-program deploy (+ bonding curve) | Phase 74 | build.sh, deploy.sh, initialize.ts all extended |
| No whitelist burn | Whitelist authority burned after all entries | Phase 74 | Whitelist becomes immutable post-deploy |
| Pools seeded at deploy time | Pools seeded during graduation | Phase 74 | Deploy-time init skips AMM pool creation |
| Vault seeded at deploy time | Vault seeded during graduation | Phase 74 | Deploy-time init skips vault seeding |
| No graduation script | Checkpoint+resume graduation script | Phase 74 | New scripts/graduation/graduate.ts |

## Open Questions

### 1. **How does the admin withdraw SOL from graduated curve vaults?**
- **What we know:** prepare_transition only changes status (Filled -> Graduated). It does not transfer any SOL. The curve SOL vault is a program-owned PDA. The admin needs ~1000 SOL per curve for pool seeding.
- **What's unclear:** No on-chain instruction exists to withdraw from graduated curve vaults. The 74-CONTEXT.md mentions "transfer assets to admin" as a step but doesn't specify the mechanism.
- **Recommendation:** This MUST be resolved before planning. Options: (a) Add a `withdraw_graduated_sol` instruction to the bonding curve program (may require Phase 71-73 amendment), (b) The graduation script creates pools with a CPI from the bonding curve program, (c) Close the SOL vault PDAs in a new instruction that sends lamports to the admin.

### 2. **What happens to the 460M tokens in curve vaults at graduation?**
- **What we know:** If both curves sell exactly 460M tokens each, the token vaults are empty (all tokens sold to users). But if slightly fewer tokens sold (partial fills that still hit TARGET_TOKENS), there might be dust remaining.
- **What's unclear:** Whether there's a mechanism to recover unsold tokens from curve vaults after graduation, or if they stay locked forever.
- **Recommendation:** The amounts are likely zero or negligible. But for correctness, a `close_graduated_vault` instruction should exist or be documented as not needed.

### 3. **Deploy-time initialization: Skip pools + vault seeding?**
- **What we know:** In the bonding curve flow, AMM pools and Conversion Vault are seeded AFTER graduation. The current initialize.ts seeds them at deploy time.
- **What's unclear:** Does initialize.ts need to be restructured to skip pool/vault steps when bonding curves are in use? Or do we create a separate initialization path?
- **Recommendation:** The simplest approach is to create conditional logic in initialize.ts based on a BONDING_CURVE_MODE=true env var. When true, skip Steps 7 (pool init), 8-10 (vault init + seeding), and the pool-related whitelist steps. OR, more cleanly: create a new `initialize-curve-mode.ts` that does only the curve-specific setup.

### 4. **Bonding curve keypair generation**
- **What we know:** No `keypairs/bonding-curve-keypair.json` exists. The program ID `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1` is declared in lib.rs and Anchor.toml. The keypair likely exists in `target/deploy/bonding_curve-keypair.json` (auto-generated by Anchor).
- **What's unclear:** Whether to copy the target keypair to keypairs/ or generate a new one with a vanity address.
- **Recommendation:** Copy `target/deploy/bonding_curve-keypair.json` to `keypairs/bonding-curve-keypair.json` and verify the pubkey matches the declare_id. Add to deploy.sh PROGRAMS array.

### 5. **Integration test validator configuration**
- **What we know:** The current Anchor.toml test scripts use ts-mocha. Integration tests use a shared validator with all 6 programs.
- **What's unclear:** Whether the lifecycle test should run in the existing `test-integration` config or a new one. The bonding curve program needs to be loaded alongside the other 6.
- **Recommendation:** Add `bonding_curve` to the localnet programs in Anchor.toml. The lifecycle test can be a new file in `tests/integration/lifecycle.test.ts`.

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/deploy-all.sh` -- Full deploy pipeline
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/build.sh` -- Build script with devnet feature pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/deploy.sh` -- Deploy with keypair-based addressing
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/initialize.ts` -- Complete 17-step initialization sequence
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/patch-mint-addresses.ts` -- Feature-gate patching logic
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/bonding_curve/src/` -- All on-chain instructions, state, constants
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/src/instructions/burn_authority.rs` -- Whitelist burn mechanism
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/e2e/lib/alt-helper.ts` -- ALT creation and management
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/lib/pda-manifest.ts` -- PDA manifest generation
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/lib/connection.ts` -- Program loading pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/Anchor.toml` -- Program IDs and test configuration
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Bonding_Curve_Spec.md` -- Spec with token allocation and pricing
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/archive/Protocol_Initialzation_and_Launch_Flow.md` -- Deployment runbook

### Secondary (MEDIUM confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/phases/74-protocol-integration/74-CONTEXT.md` -- Phase decisions
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/phases/71-curve-foundation/71-CONTEXT.md` -- Curve design decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools/libraries already in use, verified from codebase
- Architecture: HIGH - All patterns derived from reading actual source code
- Pitfalls: HIGH - Identified from real code analysis (whitelist burn ordering, mint authority timing, etc.)
- Open questions: HIGH confidence that these ARE genuine gaps - identified from code vs. context discrepancies

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- all patterns are project-internal, not external library dependent)
