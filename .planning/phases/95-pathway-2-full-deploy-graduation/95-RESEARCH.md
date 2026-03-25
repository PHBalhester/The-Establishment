# Phase 95: Pathway 2 Full Deploy + Graduation - Research

**Researched:** 2026-03-14
**Domain:** Solana protocol deployment, bonding curve lifecycle, AMM graduation
**Confidence:** HIGH

## Summary

Phase 95 is a full end-to-end lifecycle test of the entire Dr. Fraudsworth protocol: clean-room deploy from zero, fill both bonding curves to capacity, graduate into AMM pools, seed the conversion vault, start the crank, and toggle the frontend to live trading mode. This phase exercises every script and program built across 94 prior phases.

The standard approach is entirely established -- all tools exist (`deploy-all.sh`, `graduate.ts`, `verify.ts`, `create-alt.ts`, `generate-constants.ts`). The new work is: (1) a curve-filling script that generates organic traffic (buys + sells across both curves), (2) a post-graduation verification script, (3) a formal pathway2-report.md, and (4) Railway env var updates + SITE_MODE toggle.

**Primary recommendation:** Lean heavily on existing scripts. The fill script follows the pathway1-test.ts pattern (generate wallets, fund them, execute bonding curve instructions). The verification script extends verify.ts patterns. New code is minimal.

## Standard Stack

### Core (Already in project)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@coral-xyz/anchor` | In package.json | Program interaction, IDL loading | Existing |
| `@solana/web3.js` | In package.json | Connection, Transaction, Keypair | Existing |
| `@solana/spl-token` | In package.json | Token-2022 operations, ATA creation | Existing |

### Supporting Scripts (Already exist)

| Script | Path | Purpose |
|--------|------|---------|
| `deploy-all.sh` | `scripts/deploy/deploy-all.sh` | 7-phase deploy pipeline (Phase 0-6) |
| `graduate.ts` | `scripts/graduation/graduate.ts` | 11-step graduation with checkpoint/resume |
| `verify.ts` | `scripts/deploy/verify.ts` | Deep on-chain state verification |
| `generate-constants.ts` | `scripts/deploy/generate-constants.ts` | Writes `shared/constants.ts` from deployment.json |
| `create-alt.ts` | `scripts/deploy/create-alt.ts` | Address Lookup Table creation |
| `pathway1-test.ts` | `scripts/test/pathway1-test.ts` | Reference pattern for fill script |
| `crank-runner.ts` | `scripts/crank/crank-runner.ts` | 24/7 epoch advancement |

### No New Dependencies Needed

All required libraries are already installed. The fill script and verification script use the same Anchor + web3.js stack as pathway1-test.ts.

## Architecture Patterns

### Existing Pipeline Flow

```
deploy-all.sh devnet (no --partial)
  Phase 0: Generate mint keypairs (fresh)
  Phase 1: Build with --devnet flag
  Phase 2: Deploy all 7 programs
  Phase 3: Initialize (mints, PDAs, pools, whitelist, seed liquidity)
  Phase 4: Generate constants (shared/constants.ts)
  Phase 5: Create/extend ALT
  Phase 6: Verify all on-chain state
```

### Phase 95 Execution Flow

```
1. Pre-check: Wallet SOL balance (user manually collects devnet SOL)
2. Clean deploy: deploy-all.sh devnet (full, no --partial)
3. Frontend update: Rebuild with new constants
4. Railway update: Env vars for new addresses + start crank
5. User manual buy: 0.1 SOL on each curve via frontend (UX test)
6. User runs fill script: Fills both curves to ~5 SOL each
7. Frontend confirmation: Both gauges show 100% filled
8. User runs graduate.ts: 11-step graduation sequence
9. Verify: Post-graduation verification script
10. SITE_MODE toggle: launch -> live on Railway
11. Test swap: One CRIME/SOL buy via frontend
12. Report: Write Docs/pathway2-report.md
```

### Fill Script Architecture (New)

Based on pathway1-test.ts pattern with modifications for filling to capacity:

```typescript
// Key differences from pathway1-test.ts:
// 1. Goal is FILLING (not failure path testing)
// 2. Mixed buys AND sells for organic traffic
// 3. Alternating CRIME/FRAUD curves
// 4. Randomized spacing (1-5s between ops)
// 5. Target ~30s total fill time
// 6. Parallel execution across wallets

// Wallet generation: ~8-10 wallets
// Each funded with ~0.8-1.0 SOL (need ~5.06 SOL per curve = ~10.12 SOL total + gas)
// Buy amounts: varied (0.1-1.5 SOL per buy)
// Sell amounts: small (10-20% of held tokens) to create organic sell pressure
// Interleave: CRIME buy, FRAUD buy, CRIME sell, FRAUD buy, etc.
```

### Curve Parameters (Devnet)

| Parameter | Value | Notes |
|-----------|-------|-------|
| P_START | 5 lamports/human token | Start price |
| P_END | 17 lamports/human token | End price |
| TOTAL_FOR_SALE | 460M tokens (460e12 base units) | Per curve |
| TARGET_SOL | ~5.06 SOL per curve | (5+17)/2 * 460M / 1e6 |
| TARGET_TOKENS | 460,000,000,000,000 | Fill threshold |
| DEADLINE_SLOTS | 4,500 slots (~30 min) | Must fill within deadline |
| MIN_PURCHASE_SOL | 0.001 SOL | Devnet minimum |
| MAX_TOKENS_PER_WALLET | 20M tokens (20e12 base units) | Wallet cap |
| SELL_TAX_BPS | 1,500 (15%) | Tax on sells |

### SOL Budget for Full Deploy + Fill

| Item | SOL | Notes |
|------|-----|-------|
| 7 program deploys | ~7-10 SOL | Program rent + deploy fees |
| Mint creation (3) | ~0.1 SOL | Rent-exempt |
| PDA creation | ~0.5 SOL | Pools, vaults, whitelists |
| Pool seeding (2 SOL pools) | 5.0 SOL | SOL_POOL_SEED_SOL_OVERRIDE=2.5B lamports * 2 |
| Token minting + distribution | ~0.1 SOL | TX fees |
| ALT creation | ~0.05 SOL | Rent + TX fees |
| Curve filling (~10 SOL total) | ~10.5 SOL | 5.06 * 2 + gas + sells |
| Fill script wallet funding | ~0.5 SOL | Gas for ~10 test wallets |
| Graduation (11 steps) | ~0.1 SOL | TX fees for graduation |
| Post-graduation AMM seeding | ~10.12 SOL | Dynamic from curve withdrawal |
| Conversion vault seeding | ~0.05 SOL | TX fees only (tokens from admin) |
| Crank operation | ~0.1 SOL | First few epochs |
| **Total estimate** | **~35-40 SOL** | User should have 40+ SOL |

### Railway Environment Variables to Update

After fresh deploy, these Railway env vars need new values:

```
# From deployment.json (Claude derives, user updates Railway)
CLUSTER_URL          = (unchanged, same Helius devnet)
COMMITMENT           = finalized
PDA_MANIFEST         = {full JSON from pda-manifest.json}
CARNAGE_WSOL_PUBKEY  = (from new deployment)
NEXT_PUBLIC_SITE_MODE = launch  (later toggle to 'live')

# Crank wallet (same keypair, just needs to be set)
WALLET_KEYPAIR       = [byte array from devnet-wallet.json]
# or WALLET path if running locally
```

### Frontend Polling Adjustment for Recording

```typescript
// useCurveState.ts line 369: Change 5_000 to 1_000 for devnet test session
const interval = setInterval(() => {
  fetchBothCurves();
}, 1_000); // Was 5_000, temporarily 1_000 for screen recording responsiveness
```

Revert to 5_000 after recording is complete.

### Post-Graduation Verification Checks

| Check | What to Verify | How |
|-------|---------------|-----|
| AMM pools exist | Both CRIME/SOL and FRAUD/SOL pools initialized | Read pool accounts from deployment.json |
| Pool reserves correct | 290M tokens + ~5 SOL per pool | Read pool state, compare reserves |
| Conversion vault funded | 250M CRIME + 250M FRAUD + 20M PROFIT | Read vault token accounts |
| Tax escrow distributed | Both curve tax escrows -> carnage vault | Check escrow balances = rent-exempt only |
| Crank operational | Advance one epoch with VRF | Call advanceEpochWithVRF, verify epoch increments |
| Curve status | Both curves show "graduated" | Read curve state accounts |
| Frontend accessible | SITE_MODE=live serves trading page | HTTP request to Railway URL |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deploy pipeline | Custom deploy steps | `deploy-all.sh devnet` | 7-phase pipeline handles everything including preflight |
| PDA derivation | Manual seed computation | `constants.ts` helpers + deployment.json | Single source of truth |
| Graduation sequence | Manual TX steps | `graduate.ts` with checkpoint/resume | 11-step idempotent pipeline, handles failures |
| On-chain verification | Manual account reads | Extend `verify.ts` pattern | Already handles programs, mints, PDAs, pools |
| ALT creation | Manual lookup table | `create-alt.ts` | Handles all 46 addresses |
| Hook accounts | Manual derivation | `getHookAccounts()` from pathway1-test.ts | Proven pattern with correct 4-account structure |
| Token transfers | Raw instructions | `@solana/spl-token` helpers | Handles Token-2022 correctly |

**Key insight:** This phase is 95% orchestration of existing tools. The only new code is the fill script and verification script, both following established patterns.

## Common Pitfalls

### Pitfall 1: Forgetting to delete old mint keypairs
**What goes wrong:** `deploy-all.sh` Phase 0 skips keypair generation if files exist. Old mint keypairs produce addresses that match stale compiled-in constants.
**How to avoid:** Delete `scripts/deploy/mint-keypairs/*.json` before running deploy-all.sh for a clean-room deploy. The script regenerates them.

### Pitfall 2: Not sourcing .env.devnet before initialize.ts
**What goes wrong:** Pool seed amounts default to test values (10 SOL / 10K tokens) instead of correct values (2.5 SOL / 290M tokens). Pools can't be re-seeded -- requires full redeploy.
**How to avoid:** `deploy-all.sh` handles this automatically with `set -a && source .env.devnet && set +a`. Never run initialize.ts manually without sourcing.

### Pitfall 3: Curve deadline expires during testing
**What goes wrong:** Devnet deadline is 4,500 slots (~30 min). If the user delays between deploy and fill, curves expire.
**How to avoid:** Start the fill script promptly after deployment. The ~30-minute window is generous for scripted filling (~30 seconds), but don't wait too long for manual testing.

### Pitfall 4: Insufficient SOL for full lifecycle
**What goes wrong:** Deploy + fill + graduation + pool seeding requires ~35-40 SOL. Devnet faucet rate-limits aggressively.
**How to avoid:** User must manually collect SOL from faucets before starting. Check balance first. Budget 40+ SOL.

### Pitfall 5: Wallet cap blocks fill script
**What goes wrong:** Each wallet can hold max 20M tokens (20e12 base units). A single wallet can buy ~0.22 SOL worth before hitting the cap.
**How to avoid:** Use 8-10 wallets, distribute buys across them. Each wallet buys 0.5-1.0 SOL worth, staying well under the 20M cap.

### Pitfall 6: Crank not stopped before deploying
**What goes wrong:** If the old crank is running on Railway, it tries to interact with old (now non-existent) program IDs, causing errors.
**How to avoid:** Stop the Railway crank service before deploying. Restart with new env vars after deployment.

### Pitfall 7: Frontend serves stale constants
**What goes wrong:** `shared/constants.ts` is regenerated by deploy-all.sh Phase 4, but the Next.js dev server caches old values.
**How to avoid:** Rebuild the frontend after deploy-all.sh completes. For Railway, redeploy with new constants committed.

### Pitfall 8: graduation-state.json from previous run
**What goes wrong:** graduate.ts uses checkpoint/resume. Old state file from pathway 1 or prior runs causes it to skip steps.
**How to avoid:** Delete `scripts/graduation/graduation-state.json` before running graduation for this fresh deployment.

### Pitfall 9: Railway NEXT_PUBLIC vars require rebuild
**What goes wrong:** Next.js bakes NEXT_PUBLIC_* vars at build time. Changing NEXT_PUBLIC_SITE_MODE on Railway requires a redeploy, not just a restart.
**How to avoid:** Trigger a Railway redeploy (not just restart) when changing NEXT_PUBLIC_SITE_MODE from 'launch' to 'live'.

### Pitfall 10: Fill script sends sells before buys
**What goes wrong:** Attempting to sell tokens before buying them results in zero-balance errors.
**How to avoid:** Structure the fill script to always buy first, then interleave sells. Each wallet must have a positive balance before selling.

## Code Examples

### Fill Script: Wallet Setup Pattern (from pathway1-test.ts)

```typescript
// Source: scripts/test/pathway1-test.ts (lines 229-275)
const testWallets: Keypair[] = [];
for (let i = 0; i < WALLET_COUNT; i++) {
  testWallets.push(Keypair.generate());
}

// Fund each wallet
const FUND_AMOUNT = 0.8 * LAMPORTS_PER_SOL;
for (const wallet of testWallets) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: wallet.publicKey,
      lamports: FUND_AMOUNT,
    }),
  );
  await sendAndConfirmTransaction(connection, tx, [funder]);
}

// Create ATAs for both CRIME and FRAUD (Token-2022)
for (const wallet of testWallets) {
  for (const mint of [crimeMint, fraudMint]) {
    const ata = getAssociatedTokenAddressSync(
      mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
    );
    const ataInfo = await connection.getAccountInfo(ata);
    if (!ataInfo) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          funder.publicKey, ata, wallet.publicKey, mint, TOKEN_2022_PROGRAM_ID,
        ),
      );
      await sendAndConfirmTransaction(connection, tx, [funder]);
    }
  }
}
```

### Fill Script: Purchase Pattern (from pathway1-test.ts)

```typescript
// Source: scripts/test/pathway1-test.ts (lines 302-365)
const hookAccounts = getHookAccounts(hookProgramId, mint, pdas.tokenVault, userAta);

const sig = await bondingCurve.methods
  .purchase(new anchor.BN(solAmount), new anchor.BN(0))
  .accountsStrict({
    user: wallet.publicKey,
    curveState: pdas.curveState,
    userTokenAccount: userAta,
    tokenVault: pdas.tokenVault,
    solVault: pdas.solVault,
    tokenMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts(hookAccounts)
  .signers([wallet])
  .rpc();
```

### Fill Script: Sell Pattern (from pathway1-test.ts)

```typescript
// Source: scripts/test/pathway1-test.ts (lines 394-410)
// Hook accounts for sell: user -> vault (reversed from buy)
const hookAccounts = getHookAccounts(hookProgramId, mint, userAta, pdas.tokenVault);

const sig = await bondingCurve.methods
  .sell(new anchor.BN(sellAmount), new anchor.BN(0))
  .accountsStrict({
    user: wallet.publicKey,
    curveState: pdas.curveState,
    userTokenAccount: userAta,
    tokenVault: pdas.tokenVault,
    solVault: pdas.solVault,
    taxEscrow: pdas.taxEscrow,
    tokenMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts(hookAccounts)
  .signers([wallet])
  .rpc();
```

### Hook Account Derivation (from pathway1-test.ts)

```typescript
// Source: scripts/test/pathway1-test.ts (lines 139-163)
function getHookAccounts(
  hookProgramId: PublicKey, mint: PublicKey,
  source: PublicKey, destination: PublicKey,
): anchor.web3.AccountMeta[] {
  const [metaList] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()], hookProgramId);
  const [wlSource] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), source.toBuffer()], hookProgramId);
  const [wlDest] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), destination.toBuffer()], hookProgramId);
  return [
    { pubkey: metaList, isSigner: false, isWritable: false },
    { pubkey: wlSource, isSigner: false, isWritable: false },
    { pubkey: wlDest, isSigner: false, isWritable: false },
    { pubkey: hookProgramId, isSigner: false, isWritable: false },
  ];
}
```

### Graduation Script Invocation

```bash
# Source: scripts/graduation/graduate.ts header comments
# Delete old state first (clean run)
rm -f scripts/graduation/graduation-state.json

# Run graduation
set -a && source .env.devnet && set +a
npx tsx scripts/graduation/graduate.ts
```

### SITE_MODE Toggle

```
# On Railway dashboard:
# 1. Change NEXT_PUBLIC_SITE_MODE from 'launch' to 'live'
# 2. Trigger redeploy (not just restart -- NEXT_PUBLIC vars are build-time)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded pool seeding SOL | Dynamic from vault withdrawal | Phase 94.1-03 | graduate.ts reads actual balance delta |
| 1000 SOL curve target | 500 SOL (mainnet) / 5 SOL (devnet) | Phase 94.1-02 | P_START/P_END halved |
| Single .env file | Cluster-specific .env.devnet/.env.mainnet | Phase 91 | Prevents cross-cluster leaks |
| Manual deploy steps | deploy-all.sh 7-phase pipeline | Phase 91 | Single command deploy |

## Open Questions

1. **Phase 94.1-03 completion status**
   - What we know: The graduation script code already has dynamic pool seeding (adminBalanceBefore/After pattern). The 94.1-03 SUMMARY.md doesn't exist, but the code changes appear to be in place.
   - What's unclear: Whether the Rust tests were updated and pass (the second task in 94.1-03).
   - Recommendation: Verify `cargo test --workspace --features devnet` passes before starting Phase 95. If 94.1-03 is truly incomplete, complete it first.

2. **Devnet SOL availability**
   - What we know: Faucet rate-limits aggressively. Full lifecycle needs ~35-40 SOL.
   - What's unclear: Current wallet balance.
   - Recommendation: Check balance before planning. User may need to collect SOL over multiple faucet requests.

3. **Railway rebuild timing**
   - What we know: NEXT_PUBLIC_* vars are build-time. shared/constants.ts must be committed before Railway rebuild.
   - What's unclear: Whether Railway auto-deploys on git push or requires manual trigger.
   - Recommendation: Commit updated constants, push to trigger Railway rebuild, verify before proceeding.

## Sources

### Primary (HIGH confidence)
- Project codebase: `scripts/deploy/deploy-all.sh`, `scripts/graduation/graduate.ts`, `scripts/test/pathway1-test.ts` -- direct code reading
- Project codebase: `programs/bonding_curve/src/constants.rs` -- devnet parameters verified
- Project codebase: `app/hooks/useCurveState.ts` -- polling interval location confirmed
- Project codebase: `scripts/crank/crank-runner.ts`, `scripts/crank/crank-provider.ts` -- env var requirements confirmed
- Project codebase: `.env.devnet` -- current env var values confirmed

### Secondary (MEDIUM confidence)
- Phase 94.1 plans and summaries -- context for graduation script changes
- Pathway 1 report (`Docs/pathway1-report.md`) -- reference for report format

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools exist and are proven in prior phases
- Architecture: HIGH -- follows established pathway1-test.ts pattern exactly
- Pitfalls: HIGH -- based on documented project history (MEMORY.md, Phase 69 lessons)
- Fill script design: MEDIUM -- new script, but pattern is well-established
- SOL budget: MEDIUM -- estimates based on prior deploy experience, exact amounts vary

**Research date:** 2026-03-14
**Valid until:** 2026-03-28 (stable -- no external dependency changes expected)
