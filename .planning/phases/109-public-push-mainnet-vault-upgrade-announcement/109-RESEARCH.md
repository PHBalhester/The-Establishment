# Phase 109: Public Push + Mainnet Vault Upgrade + Announcement - Research

**Researched:** 2026-03-26
**Domain:** Public repository sync, Squads governance upgrade, mainnet smoke testing, OtterSec re-verification
**Confidence:** HIGH

## Summary

This phase combines three sequenced operations: (1) syncing the public GitHub repo with v1.5 changes, (2) deploying the conversion vault convert_v2 upgrade to mainnet via Squads governance, and (3) verifying the upgrade with mainnet smoke tests. User handles all announcements separately -- Claude handles technical execution only.

The public repo sync follows the exact Phase 104 pattern: rsync from private to staging, apply-sanitization.sh, run the 6-phase Docs/public-push-checklist.md, then squash-commit and push. The delta since 946703f (last push) includes Phase 105 (crank hardening -- already partially in public repo), Phase 106 (vault convert-all -- new on-chain + client code), Phase 106.1 (skipPreflight centralization), and Phase 108 (zAuth remediation). Phase 107 (Jupiter SDK) is explicitly excluded per CONTEXT.md.

The mainnet Squads upgrade is well-proven: test-upgrade.ts executed 2 complete cycles on devnet (Phase 97). The conversion vault binary is 376KB (~2.6 SOL buffer write cost). The mainnet Squads multisig is 2-of-3 with 15-minute (900s) timelock at `F7axBNUg...` with vault PDA `4SMcPtix...`. After upgrade, OtterSec will automatically unverify the conversion vault program -- re-verification requires the new source code to be in the public repo first, then export-pda-tx through the Squads multisig, then remote submit-job.

**Primary recommendation:** Sequence as: public repo push first (code visible for community review) -> mainnet build + buffer write -> Squads upgrade proposal -> timelock + execute -> smoke test wave -> frontend deploy -> OtterSec re-verification. This ordering satisfies both the transparency goal and the OtterSec re-verification dependency (public repo must contain new code before re-verify).

## Standard Stack

The established tools for this domain:

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| rsync | system | Curated file copy from private to staging dir | Proven in Phase 104 with exclude list |
| apply-sanitization.sh | Phase 104 | Idempotent sanitization of staging directory | Captures all sed patterns, redactions, file removals |
| Docs/public-push-checklist.md | Phase 104 | 6-phase secret scanning checklist | Military-grade, catches base58 keys, audit doc secrets |
| git | system | Squashed commit to public repo | Single commit approach from Phase 104 |
| @sqds/multisig | 4.x | Squads SDK for vault TX, proposal, approve, execute | Used in test-upgrade.ts, proven on devnet |
| solana-verify | 0.4.12+ | OtterSec re-verification after upgrade | Used in Phase 104-06 for initial verification |
| solana CLI | v2/v3 | Buffer write, authority verification | Standard deploy tooling |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| gh CLI | latest | Verify public repo state | Post-push verification |
| anchor build | 0.32.1 | Mainnet binary compilation | Must build WITHOUT --devnet flag |
| verify-authority.ts | Phase 97 | Confirm upgrade authority still held by vault | Post-upgrade verification |

**No new tools needed.** Everything is established from Phases 97, 100, 101, and 104.

## Architecture Patterns

### Operation Sequencing (Critical Path)

```
1. Public Repo Sync
   ├── rsync private -> staging
   ├── apply-sanitization.sh (updated for new phases)
   ├── 6-phase checklist (Docs/public-push-checklist.md)
   ├── user manual verification pass
   └── squashed commit + push

2. Mainnet Build
   ├── build.sh (NO --devnet flag, mainnet code paths)
   ├── verify conversion_vault.so matches expected binary
   └── record binary hash for post-upgrade verification

3. Buffer Write + Authority Transfer
   ├── solana program write-buffer conversion_vault.so
   ├── solana program set-buffer-authority -> vault PDA
   └── verify buffer authority is vault PDA

4. Squads Upgrade Proposal
   ├── Create vault transaction (BPFLoaderUpgradeable::Upgrade)
   ├── Create proposal
   ├── Approve with signer 1
   ├── Approve with signer 2 (threshold met)
   ├── Wait 15-minute timelock (900s)
   └── Execute upgrade

5. Post-Upgrade Verification
   ├── solana program show (last_deploy_slot changed)
   ├── verify-authority.ts (vault still holds authority)
   └── on-chain convert_v2 instruction callable

6. Mainnet Smoke Tests (User-Led)
   ├── 8 multi-hop routes at 0.05 SOL each
   ├── User reports TX signatures
   ├── Claude verifies each TX
   └── Blowfish gate: 40+ SOL simulation in Phantom (preview only)

7. Frontend Deploy
   ├── Railway mainnet service updated
   ├── NEXT_PUBLIC_CLUSTER=mainnet confirmed
   └── Health check passes

8. OtterSec Re-Verification
   ├── export-pda-tx with Squads uploader
   ├── Execute PDA TX through Squads multisig
   └── remote submit-job for conversion vault only
```

### Pattern 1: Phase 104 Public Repo Sync (Reuse)
**What:** Curated file copy from private to public staging directory
**When to use:** Every public push
**How it works:**
1. rsync with comprehensive exclude list -> `/tmp/drfraudsworth-public/`
2. `apply-sanitization.sh` applies all file sanitizations (sed replacements, file removals)
3. Run all 6 phases of `Docs/public-push-checklist.md`
4. User manual verification
5. Squashed commit covering all v1.5 changes

**Key difference from Phase 104:** Phase 104 was a fresh repo with zero git history. Phase 109 is an incremental push to an existing repo. The staging directory at `/tmp/drfraudsworth-public/` already has the v1.4 codebase with git history. The approach is:
- rsync the entire private repo over the staging dir (updates/adds files)
- Re-run apply-sanitization.sh (idempotent)
- Run the full checklist (catches any new secrets)
- Commit the delta as a single squashed commit

### Pattern 2: Squads Mainnet Upgrade (Adapted from test-upgrade.ts)
**What:** Timelocked program upgrade through Squads multisig
**When to use:** Any mainnet program upgrade
**Key adaptation for mainnet:**
- test-upgrade.ts deploys a fresh test program. For mainnet, the conversion vault already exists with vault PDA as authority
- The `executeUpgradeCycle()` function is directly reusable -- it takes program ID, vault PDA, multisig PDA, signers, and binary path
- Mainnet uses .env.mainnet with SQUADS_TIMELOCK_SECONDS=900
- Mainnet RPC via CLUSTER_URL (Helius mainnet)

### Pattern 3: OtterSec Re-Verification After Upgrade
**What:** Re-establishing verified build status after program upgrade
**Critical detail:** OtterSec automatically unverifies a program when its on-chain bytecode changes. Re-verification requires:
1. Source code changes already pushed to public repo (new commit hash)
2. `solana-verify export-pda-tx` with `--uploader YOUR_MULTISIG_ADDRESS` generates a base58 transaction
3. That transaction must be executed through the Squads multisig (not the deployer wallet)
4. `solana-verify remote submit-job --uploader YOUR_MULTISIG_ADDRESS` triggers OtterSec remote builder
5. Only the conversion vault program needs re-verification (other 5 programs unchanged)

**Source:** [Solana Verified Builds documentation](https://solana.com/docs/programs/verified-builds)

### Anti-Patterns to Avoid
- **Pushing to public repo AFTER upgrade:** Breaks the transparency model AND prevents OtterSec re-verification (needs commit hash in public repo first)
- **Using --devnet flag for mainnet build:** Produces a binary with wrong feature flags, would deploy devnet code paths to mainnet
- **Re-using Phase 104's initial commit approach:** The public repo now has history. Use an incremental commit, not a force-push
- **Skipping the 6-phase checklist:** Even if "nothing secret changed," new files from Phases 105/106/108 may contain audit findings with secrets
- **Forgetting to re-verify with OtterSec:** Community will see "unverified" badge on Solscan after upgrade -- must re-verify promptly

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret scanning | Custom grep patterns | Docs/public-push-checklist.md (6-phase) | Already catches base58 keys, audit doc secrets, keypair arrays -- learned from Phase 104 leak |
| File sanitization | Manual sed one-offs | apply-sanitization.sh | Idempotent, captures all known secret patterns including partial key references |
| Squads upgrade TX | Manual instruction building | test-upgrade.ts `executeUpgradeCycle()` | Proven on devnet, handles buffer write, authority transfer, proposal, approval, timelock, execute, verify |
| Mainnet build | Manual anchor commands | build.sh (without --devnet) | Handles sync-program-ids, patch-mint-addresses, build, artifact check, ID verification |
| Authority verification | Manual solana program show | verify-authority.ts | Checks all 11 authorities in one run |

**Key insight:** Every component of this phase has been built and proven in previous phases. The risk is in sequencing and coordination, not in building new tools.

## Common Pitfalls

### Pitfall 1: New Files From v1.5 Phases May Contain Secrets
**What goes wrong:** Phases 105, 106, 108 generated new audit findings (.audit/, .bulwark/) and planning docs that may quote actual secret values as evidence (the exact bug from Phase 104 that leaked a devnet private key for 10 days).
**Why it happens:** AI auditors (SOS, Bulwark) quote actual secret values as evidence of findings.
**How to avoid:** apply-sanitization.sh already has redaction patterns for known secrets (steps 6a-6j). But NEW secrets may have been introduced. Must run the full 6-phase checklist, especially Phase 3 (Audit & Bulwark Findings Deep Scan).
**Warning signs:** Base58 strings 44+ chars in .bulwark/findings/ that are not known public addresses.

### Pitfall 2: Conversion Vault Feature Flags
**What goes wrong:** Building with --devnet flag produces a binary with devnet Switchboard addresses and devnet cross-program references compiled in.
**Why it happens:** conversion_vault has `[features] devnet = []` and uses `#[cfg(feature = "devnet")]` in constants.rs.
**How to avoid:** Use `build.sh` without --devnet flag. Verify declare_id matches mainnet ID (`5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ`). Verify cross-program constants.rs references are mainnet addresses.
**Warning signs:** `grep 'declare_id!' programs/conversion-vault/src/lib.rs` showing anything other than `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ`.

### Pitfall 3: OtterSec Re-Verification Requires Squads TX (Not Deployer)
**What goes wrong:** After upgrade, trying to re-verify with `solana-verify verify-from-repo` using the deployer wallet fails because the PDA uploader doesn't match the program's current authority chain.
**Why it happens:** The verification PDA must be uploaded by the multisig authority (or via a Squads vault transaction using `export-pda-tx`), not the deployer.
**How to avoid:** Use `solana-verify export-pda-tx --uploader <SQUADS_VAULT_PDA>`, execute through Squads, then `remote submit-job --uploader <SQUADS_VAULT_PDA>`.
**Warning signs:** OtterSec status showing "unverified" for conversion vault after upgrade. Note: Phase 104-06 used the deployer for INITIAL verification (authority had just been transferred), but for re-verification after upgrade, the Squads uploader flow may be required. This needs validation during execution.

### Pitfall 4: Buffer Write SOL Cost
**What goes wrong:** Deployer wallet doesn't have enough SOL for the buffer write.
**Why it happens:** Conversion vault binary is 376KB. Buffer accounts require rent-exempt balance (~2.6 SOL). Plus priority fees.
**How to avoid:** Check deployer wallet balance before buffer write. Need at least 3 SOL available (2.6 for buffer + fees + margin). Deployer has ~6.87 SOL per MEMORY.md but may have spent some since.
**Warning signs:** `Error: Account ... has insufficient funds for spend`.

### Pitfall 5: Railway Frontend Deploy Timing
**What goes wrong:** Frontend goes live before the on-chain program upgrade, causing convert_v2 calls to fail.
**Why it happens:** Railway auto-deploys on git push. If the frontend code is pushed before the Squads upgrade is executed, users hitting the new client code will try to call convert_v2 which doesn't exist yet.
**How to avoid:** The convert_v2 instruction is additive -- the existing convert instruction is untouched. But the client code (swap-builders.ts) now calls convertV2 instead of convert. So the frontend MUST NOT deploy until after the Squads upgrade is confirmed.
**Warning signs:** If Railway mainnet service auto-deploys from the main branch, ensure the code is pushed to a separate branch first, or deploy frontend manually after upgrade confirmation.

### Pitfall 6: Public Repo Staging Directory State
**What goes wrong:** The staging directory at `/tmp/drfraudsworth-public/` has stale state from v1.4 that conflicts with v1.5 changes.
**Why it happens:** rsync updates/adds files but doesn't delete files that were removed from the private repo. Deleted files from private repo remain in staging.
**How to avoid:** Use `rsync --delete` flag to remove files in staging that no longer exist in private repo. But be careful -- the staging dir has its own .git/ and sanitized files that shouldn't be deleted. Better approach: delete everything except .git/ in staging, then rsync fresh, then re-apply sanitization.
**Warning signs:** Files that no longer exist in private repo still present in public push.

### Pitfall 7: Mainnet Timelock Timing
**What goes wrong:** Squads timelock expires overnight or when user is unavailable, leaving the upgrade unexecuted.
**Why it happens:** 15-minute timelock on mainnet. User needs to be present to monitor after execution.
**How to avoid:** Per CONTEXT.md: "Squads timelock (1hr) must expire during user's waking hours." Note: CONTEXT.md says 1hr but actual mainnet timelock is 15 minutes (900s). User must initiate the proposal at a time when they can execute + monitor 15+ minutes later.
**Warning signs:** Proposal created close to user's bedtime or away period.

## Code Examples

Verified patterns from the existing codebase:

### Buffer Write + Authority Transfer (from test-upgrade.ts)
```typescript
// Source: scripts/deploy/test-upgrade.ts lines 208-241
const bufferAddress = writeBuffer(binaryPath, walletPath, cluster);
setBufferAuthority(bufferAddress, vaultPda.toBase58(), walletPath, cluster);
```

### Squads Upgrade Vault TX (from test-upgrade.ts)
```typescript
// Source: scripts/deploy/test-upgrade.ts lines 341-371
const upgradeIx = makeUpgradeIx(
  programId,
  programData,
  new PublicKey(bufferAddress),
  vaultPda, // spill address
  vaultPda  // authority
);

const txMessage = new TransactionMessage({
  payerKey: vaultPda,
  recentBlockhash: blockhash,
  instructions: [upgradeIx],
});

await multisig.rpc.vaultTransactionCreate({
  connection,
  feePayer: deployer,
  multisigPda,
  transactionIndex: txIndex,
  creator: signers[0].publicKey,
  vaultIndex: 0,
  ephemeralSigners: 0,
  transactionMessage: txMessage,
  memo: "Upgrade conversion vault to convert_v2",
  signers: [deployer, signers[0]],
  sendOptions: { skipPreflight: true },
});
```

### OtterSec Re-Verification (from official docs)
```bash
# Source: https://solana.com/docs/programs/verified-builds
# Step 1: Export PDA transaction for Squads execution
solana-verify export-pda-tx https://github.com/MetalLegBob/drfraudsworth \
  --program-id 5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ \
  --uploader 4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ \
  --encoding base58 \
  --compute-unit-price 0

# Step 2: Import base58 TX into Squads UI and execute

# Step 3: Submit remote verification job
solana-verify remote submit-job \
  --program-id 5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ \
  --uploader 4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ
```

### Rsync for Incremental Public Push
```bash
# Source: Phase 104-01 pattern, adapted for incremental push
# Delete everything except .git/ in staging, then rsync fresh
cd /tmp/drfraudsworth-public
find . -maxdepth 1 ! -name '.git' ! -name '.' -exec rm -rf {} +
rsync -av --exclude-from=/tmp/drfraudsworth-exclude.txt \
  "/Users/mlbob/Projects/Dr Fraudsworth/" /tmp/drfraudsworth-public/
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deployer wallet signs OtterSec PDA | Squads multisig signs PDA (export-pda-tx) | After authority transfer | Must use Squads flow for re-verification |
| Initial commit (zero history) | Incremental commit (squashed) | Phase 109 vs Phase 104 | Need to handle file deletions and git history |
| verify-from-repo (deployer signer) | export-pda-tx (multisig signer) | Solana docs updated | Re-verification requires Squads TX execution |

**Important note on OtterSec re-verification:** Phase 104-06 successfully used the deployer wallet to sign verification PDAs even after authority transfer to Squads vault. The official docs suggest using `export-pda-tx` with the multisig uploader for post-upgrade re-verification. It is possible the deployer approach still works for re-verification -- this should be attempted first (simpler), falling back to the Squads export-pda-tx approach if it fails. Confidence: MEDIUM.

## Open Questions

Things that couldn't be fully resolved:

1. **Can deployer wallet re-verify after upgrade, or must Squads sign?**
   - What we know: Phase 104-06 used deployer wallet successfully for initial verification. Official docs describe an export-pda-tx Squads flow.
   - What's unclear: Whether the deployer approach still works after the on-chain bytecode changes (upgrade invalidates the old PDA).
   - Recommendation: Try deployer approach first (verify-from-repo as in Phase 104-06). If OtterSec rejects it, use the export-pda-tx Squads flow.

2. **Railway mainnet auto-deploy behavior**
   - What we know: Railway devnet auto-deploys on push to main. Railway mainnet service exists separately.
   - What's unclear: Whether Railway mainnet auto-deploys from the same branch or requires manual trigger.
   - Recommendation: During execution, check Railway mainnet service configuration. If auto-deploy, ensure the timing: push frontend code AFTER Squads upgrade confirmed. If manual, deploy explicitly after upgrade.

3. **apply-sanitization.sh coverage for v1.5 secrets**
   - What we know: The script covers known secrets from v1.4 (Helius keys, crank wallet, webhook secret, Supermemory key).
   - What's unclear: Whether Phases 105, 106, 108 introduced new secret values in audit findings or planning docs.
   - Recommendation: Update apply-sanitization.sh if new secrets are found during the 6-phase checklist scan. The checklist is designed to catch unknowns.

4. **CONTEXT.md says "1hr timelock" but actual mainnet timelock is 15 minutes**
   - What we know: .env.mainnet has SQUADS_TIMELOCK_SECONDS=900 (15 min). CONTEXT.md says "Squads timelock (1hr)."
   - What's unclear: Whether user intends to increase timelock to 1hr before this phase, or CONTEXT.md is approximate.
   - Recommendation: Use actual on-chain timelock (query Squads account). Plan for 15-minute wait, not 1 hour.

## Sources

### Primary (HIGH confidence)
- Phase 104 execution artifacts: 104-01-PLAN.md, 104-01-SUMMARY.md, 104-04-SUMMARY.md, 104-05-SUMMARY.md, 104-06-SUMMARY.md, apply-sanitization.sh
- Phase 97 Squads governance: scripts/deploy/test-upgrade.ts (775 lines, proven on devnet)
- Phase 106 verification: 106-VERIFICATION.md (5/6 must-haves verified, Blowfish deferred to mainnet)
- Docs/public-push-checklist.md (6-phase military-grade sanitization)
- Docs/mainnet-governance.md (Section 5: Performing a Program Upgrade)
- deployments/mainnet.json (all mainnet addresses, Squads config)

### Secondary (MEDIUM confidence)
- [Solana Verified Builds documentation](https://solana.com/docs/programs/verified-builds) -- re-verification after upgrade, export-pda-tx flow
- [OtterSec solana-verify GitHub](https://github.com/otter-sec/solana-verify) -- CLI reference

### Tertiary (LOW confidence)
- Exact OtterSec re-verification behavior after upgrade (deployer vs Squads signer) -- needs validation during execution

## Metadata

**Confidence breakdown:**
- Public repo sync: HIGH -- exact repeat of Phase 104 pattern with well-documented process
- Mainnet Squads upgrade: HIGH -- test-upgrade.ts proven on devnet, mainnet governance doc covers full procedure
- Smoke testing: HIGH -- Phase 106 devnet verification (8/8 routes) establishes the test matrix, user-led wave checkpoint is straightforward
- OtterSec re-verification: MEDIUM -- official docs describe the flow, but Phase 104-06 used a simpler approach (deployer wallet) that may or may not work post-upgrade
- Frontend deploy timing: MEDIUM -- Railway config details need confirmation during execution

**Research date:** 2026-03-26
**Valid until:** 2026-04-10 (14 days -- tools and processes stable, no expected changes)
