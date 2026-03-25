# Phase 51: Program Rebuild & Devnet Deploy - Research

**Researched:** 2026-02-20
**Domain:** Solana/Anchor build, test, deploy pipeline; cross-program ID management; on-chain verification
**Confidence:** HIGH (based entirely on direct codebase investigation and test execution)

## Summary

Phase 51 is a build-test-deploy integration phase, not a code authoring phase. The primary domain is fixing 37 pre-existing test failures caused by Phase 46-50 on-chain changes that made the LiteSVM integration tests stale, then building all 5 programs with devnet feature flags, deploying fresh to devnet with new program IDs, and verifying all security hardening on-chain.

The test failures have been confirmed by running the actual test suites: all failures are in LiteSVM integration tests where the test harnesses have not been updated to match new account struct layouts (e.g., new accounts added like `wsol_intermediary`, `swap_authority` PDA validation changes, `pool_vault_b` now requiring Token-2022 data). The on-chain code is authoritative; tests need updating.

**Primary recommendation:** Work in strict sequential order: (1) fix AMM tests, (2) fix Tax tests, (3) confirm Epoch tests still pass, (4) build with devnet flags, (5) generate new keypairs + deploy, (6) initialize protocol, (7) verify on-chain, (8) run Carnage hunter + continuous runner.

## Standard Stack

### Core (Already in codebase -- no new installs)
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Anchor CLI | 0.32.1 | Build, deploy, IDL generation | Already locked in Cargo.toml |
| Solana CLI | 2.x | Program deployment, `solana program show` | Already installed at ~/.local/share/solana/ |
| LiteSVM | 0.9.1 | Lightweight Solana VM for Rust integration tests | Already a dev-dependency in all programs |
| cargo test | std | Run Rust unit + integration tests | Standard Rust testing |
| ts-mocha | npm | TypeScript integration tests on local validator | Already in Anchor.toml scripts |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `anchor keys sync` | 0.32.1 | Sync declare_id! macros with keypair files | After generating new program keypairs |
| `npx tsx` | npm | Run TypeScript deploy/verify scripts | For initialize.ts, verify.ts, carnage-hunter.ts |
| `solana-keygen new` | 2.x | Generate new program keypair files | Fresh deploy needs 5 new keypairs |
| `scripts/deploy/build.sh` | local | Build pipeline with devnet feature support | Wraps `anchor build` with verification |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fresh deploy (new keypairs) | Upgrade in-place | Too many struct changes (EpochState LEN change, new accounts) -- fresh is safer |
| LiteSVM tests | Anchor test on local validator | LiteSVM is 10-100x faster, already established pattern |

## Architecture Patterns

### Recommended Task Structure
```
Phase 51 Task Flow:
1. Fix tests (per-program)
   ├── AMM tests (19 failures)
   │   ├── test_swap_sol_pool.rs (7 failures)
   │   └── test_swap_profit_pool.rs (12 failures)
   ├── Tax tests (10 failures)
   │   ├── test_swap_sol_buy.rs (5 failures)
   │   └── test_swap_sol_sell.rs (5 failures)
   └── Epoch tests (8 failures -- verify, may be 0 now)
       └── Inline tests in src/ files (confirmed 80+ #[test])
2. Full regression sweep (all test suites)
3. Build all 5 programs (build.sh --devnet)
4. Generate new keypairs + sync IDs
5. Deploy to devnet
6. Initialize protocol (initialize.ts)
7. Generate new ALT
8. On-chain verification
9. Carnage hunter (6 paths)
10. Continuous runner restart (10+ epochs)
```

### Pattern 1: Test Fix Strategy -- Update Test Harness to Match New Code
**What:** The 37 failures are ALL "test harness stale" -- the on-chain code changed but the LiteSVM test setup code was not updated. The code is authoritative; tests adapt.
**When to use:** Every test fix task in this phase.

**Root causes confirmed by test execution:**

**AMM tests (19 failures):**
- `test_swap_sol_pool.rs` (7 fail): Error `AccountNotSigner` on `swap_authority` (error 3010). The swap_sol_pool instruction now requires `swap_authority` to be a PDA signer (from Tax Program), but the test harness passes it as a regular account. Tests need to derive the swap_authority PDA from Tax Program and include it correctly.
- `test_swap_profit_pool.rs` (12 fail): Same `AccountNotSigner` on `swap_authority` (error 3010). Same root cause.

**Tax tests (10 failures):**
- `test_swap_sol_buy.rs` (5 fail): Error `InvalidAccountData` on `pool_vault_b`. The test creates pool vaults as SPL Token accounts but the on-chain code now expects Token-2022 InterfaceAccounts. Tests need to create vaults under TOKEN_2022_PROGRAM_ID.
- `test_swap_sol_sell.rs` (5 fail): Same `InvalidAccountData` on `pool_vault_b`. Same root cause. Additionally, the sell handler now requires the `wsol_intermediary` account (Phase 48), which tests don't provide.

**Epoch tests (8 failures per MAINT-02):**
- Phase 50 verification says "81/81 epoch tests passed." The 8 Epoch failures may have been fixed during Phase 50 work. Must verify by running `cargo test -p epoch-program` -- if they pass, the 37 count drops to 29 (19 AMM + 10 Tax) and Epoch tests are already green.

### Pattern 2: Fresh Deploy with New Program IDs
**What:** Generate 5 new keypairs, update all cross-program references, deploy from scratch.
**When to use:** This specific deployment (too many struct changes for upgrade-in-place).

**Cross-Program ID Reference Map (CRITICAL -- all must update for new IDs):**

For each of the 5 program IDs (AMM, Tax, Epoch, Staking, Transfer Hook), the following files reference them:

| File Category | Files | What Changes |
|---------------|-------|-------------|
| Keypair files | `keypairs/*.json` (5 program keypairs) | New keypairs generated |
| `declare_id!` macros | `programs/*/src/lib.rs` (5 files) | `anchor keys sync` updates these |
| Anchor.toml | `[programs.localnet]` and `[programs.devnet]` | `anchor keys sync` updates these |
| Cross-program constants (Rust) | `programs/amm/src/constants.rs` (TAX_PROGRAM_ID), `programs/epoch-program/src/constants.rs` (tax_program_id, amm_program_id, staking_program_id), `programs/tax-program/src/constants.rs` (epoch_program_id, amm_program_id via amm crate), `programs/staking/src/constants.rs` (epoch_program_id) | Manual update required |
| Test files (Rust) | `programs/amm/tests/test_*.rs`, `programs/tax-program/tests/test_*.rs` | Hardcoded program IDs in test harnesses |
| Shared constants (TS) | `shared/constants.ts` (PROGRAM_IDS, MINTS) | Manual update |
| Deploy scripts | `scripts/deploy/pda-manifest.json` | Regenerated by initialize.ts |
| IDL files | `target/idl/*.json`, `app/idl/*.json` | Rebuilt by `anchor build`, synced manually |
| App types | `app/idl/types/*.ts` | Rebuilt by `anchor build` |
| E2E scripts | `scripts/e2e/devnet-e2e-validation.ts`, `scripts/e2e/overnight-runner.ts`, `scripts/vrf/devnet-vrf-validation.ts` | Load from pda-manifest.json (auto-updated) |
| Verify script | `scripts/verify-program-ids.ts` | Checks consistency (runs after sync) |
| Frontend | `app/lib/event-parser.ts`, `tests/cross-program-integration.ts`, `tests/devnet-vrf.ts` | Reference program IDs |
| Mock programs | `programs/mock-tax-program/src/lib.rs` | shares Tax Program ID (intentional for testing) |
| Stub programs | `programs/stub-staking/src/lib.rs` | References epoch_program_id |

**Total touchpoints for AMM ID alone: 23 files.** Use `verify-program-ids.ts` as the guardrail.

### Pattern 3: Build Pipeline
**What:** `build.sh --devnet` handles the complete build process.
**Current state:** Already handles both epoch_program and tax_program devnet features (Phase 50 added tax_program support).

```bash
# build.sh already does:
# 1. anchor build (all programs)
# 2. anchor build -p epoch_program -- --features devnet
# 3. anchor build -p tax_program -- --features devnet
# 4. Verify .so artifacts exist
# 5. Run verify-program-ids.ts
```

### Pattern 4: Protocol Initialization (20 Steps)
**What:** `scripts/deploy/initialize.ts` bootstraps the full protocol in strict dependency order.
**What it does (from source):**
1. Token-2022 mints with Transfer Hook extensions (3 mints: CRIME, FRAUD, PROFIT)
2. Transfer Hook whitelist authority + ExtraAccountMetaLists
3. AMM AdminConfig
4. 4 AMM pools with seed liquidity
5. All vault whitelist entries
6. Epoch state machine
7. Staking pool with dead stake
8. Carnage fund with 3 vaults
9. WSOL intermediary (Step 19, added in Phase 48)
10. PDA manifest generation (Step 20)

**Key detail:** Mint keypairs are persisted in `scripts/deploy/mint-keypairs/`. For fresh deploy, NEW mint keypairs should be generated (delete the old ones or use different directory). This ensures completely fresh PDAs.

**LP sizing:** Context says ~2 SOL per pool (CRIME/SOL and FRAUD/SOL). This is a parameter in initialize.ts that needs adjusting from whatever the current default is.

### Anti-Patterns to Avoid
- **Updating program IDs piecemeal:** Use a systematic sweep. The `verify-program-ids.ts` script checks 3 layers (keypair files, declare_id!, Anchor.toml) but does NOT check cross-program constants in Rust files. Those must be updated manually.
- **Deploying without the devnet feature flag:** Tax Program treasury_pubkey() returns Pubkey::default() without devnet flag, causing all swaps to fail with InvalidTreasury. Epoch Program SWITCHBOARD_PROGRAM_ID uses mainnet PID without devnet flag, causing ConstraintOwner on all VRF operations.
- **Reusing old mint keypairs:** If old mint keypairs are reused with new program IDs, the pool PDAs will be derived from new program IDs but token accounts may reference old pool addresses. Fresh mint keypairs for a fresh deploy.
- **Forgetting to regenerate ALT:** Old ALT contains old program addresses. Must create a new ALT with new addresses.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Program ID consistency | Manual grep-and-replace | `anchor keys sync` + `verify-program-ids.ts` | Catches declare_id!/Anchor.toml mismatches automatically |
| PDA derivation | Manual address computation | `scripts/deploy/lib/pda-manifest.ts` | Canonical seed constants shared between test/deploy |
| ALT creation | Manual AddressLookupTable setup | `scripts/e2e/lib/alt-helper.ts` (getOrCreateProtocolALT) | Handles batching (30 per extend), activation wait, caching |
| Protocol initialization | Custom deployment script | `scripts/deploy/initialize.ts` | Already has 20-step idempotent sequence |
| Build verification | Manual .so checks | `scripts/deploy/build.sh` | Checks artifacts + ID consistency |

**Key insight:** The deployment infrastructure already exists and is battle-tested. The planner should NOT create tasks to write new scripts -- instead, tasks should use/update the existing scripts.

## Common Pitfalls

### Pitfall 1: Epoch Tests May Already Be Green
**What goes wrong:** Phase 50 verification claims 81/81 epoch tests passing. The MAINT-02 count of "8 Epoch failures" may be outdated.
**Why it happens:** The 37-failure count was from pre-Phase-50 audit. Phase 50 changes (feature-gated SLOTS_PER_EPOCH, bounty payment, etc.) may have fixed the Epoch tests as a side effect.
**How to avoid:** Run `cargo test -p epoch-program` FIRST before spending time on "fixing" Epoch tests. If they pass, adjust the plan accordingly.
**Warning signs:** If all 80+ Epoch inline tests pass, skip Epoch test fixes entirely.

### Pitfall 2: Token-2022 vs SPL Token in LiteSVM Test Harnesses
**What goes wrong:** Tax test failures show `InvalidAccountData` on `pool_vault_b`. The AMM's pool vaults were changed to use `InterfaceAccount<TokenAccount>` (supporting both SPL Token and Token-2022), but the test harnesses create vaults using the old SPL Token program.
**Why it happens:** The test helper functions use `spl_token::instruction::initialize_account` instead of `spl_token_2022::instruction::initialize_account3`.
**How to avoid:** When fixing Tax tests, update the test helper to create Token-2022 token accounts for pool vaults. The mint might still be SPL Token (WSOL/SOL), but the vault accounts themselves need Token-2022 compatibility for the InterfaceAccount constraint.
**Warning signs:** Error `InvalidAccountData` on any token account = wrong token program version.

### Pitfall 3: swap_authority PDA Derivation in Tests
**What goes wrong:** AMM tests fail with `AccountNotSigner` (3010) on `swap_authority`. The AMM swap instructions require `swap_authority` to be a PDA signer derived from the Tax Program.
**Why it happens:** Tests call AMM swap directly (not via Tax Program CPI). Since swap_authority is a PDA of Tax Program, only Tax Program can sign for it. Tests need to either (a) pass swap_authority correctly and skip the signer check somehow, or (b) restructure to test via the Tax Program CPI path.
**How to avoid:** The test harness needs to derive the swap_authority PDA, include it in remaining_accounts, and the test may need to use LiteSVM's ability to add the Tax Program for proper CPI simulation.
**Warning signs:** Error 3010 (AccountNotSigner) = PDA signing issue in test harness.

### Pitfall 4: Cross-Program ID Circular Updates
**What goes wrong:** Changing program IDs creates a circular dependency: Epoch Program references Tax/AMM/Staking IDs, Tax references Epoch/AMM IDs, AMM references Tax ID.
**Why it happens:** Each program hardcodes the other programs' IDs for security constraints.
**How to avoid:** Generate ALL 5 new keypairs first, THEN update ALL cross-program references at once, THEN build. Do NOT build incrementally after each ID change.
**Warning signs:** Compilation errors mentioning "wrong ID" or test failures with wrong program address.

### Pitfall 5: ALT Cache Invalidation
**What goes wrong:** Old ALT address cached at `scripts/deploy/alt-address.json` points to stale addresses.
**Why it happens:** ALT helper checks cache file first. If old cache exists, it loads old ALT.
**How to avoid:** Delete `scripts/deploy/alt-address.json` before running any e2e script with new program IDs. The helper will create a new ALT automatically.
**Warning signs:** Transaction failures with "account not found" in ALT-compressed transactions.

### Pitfall 6: Devnet SOL Budget for Fresh Deploy
**What goes wrong:** Fresh deploy needs significant SOL for: program deploy rent (~5 SOL total for 5 programs), account initialization (~2 SOL for mints/pools/PDAs), pool liquidity (~4 SOL for 2 pools at 2 SOL each), and Carnage hunter/continuous runner operations.
**Why it happens:** Devnet faucet rate-limits aggressively. Memory note says ~1.5-3 SOL/day for continuous runner.
**How to avoid:** Ensure devnet wallet has 15+ SOL before starting deployment. Use devnet faucet liberally in advance. Pool liquidity of 2 SOL per pool (per context decision) is intentionally small.
**Warning signs:** "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit."

## Code Examples

### Verified: Current Test Failure Patterns

**AMM swap_authority failure (from actual test output):**
```
Error Code: AccountNotSigner. Error Number: 3010.
Error Message: The given account did not sign.
Caused by account: swap_authority
```
Fix: Test must derive swap_authority PDA from Tax Program ID using `SWAP_AUTHORITY_SEED = b"swap_authority"` and either simulate CPI signing or restructure the test to go through Tax Program.

**Tax pool_vault_b failure (from actual test output):**
```
ProgramError caused by account: pool_vault_b.
Error Code: InvalidAccountData. Error Number: 17179869184.
```
Fix: Test creates pool vaults with wrong token program. Use Token-2022 program for vault creation, or match whatever token program the InterfaceAccount constraint expects.

### Verified: Deploy Command Sequence
```bash
# 1. Generate new keypairs
solana-keygen new -o keypairs/amm-keypair.json --force --no-bip39-passphrase
solana-keygen new -o keypairs/tax-program-keypair.json --force --no-bip39-passphrase
solana-keygen new -o keypairs/transfer-hook-keypair.json --force --no-bip39-passphrase
solana-keygen new -o keypairs/epoch-program.json --force --no-bip39-passphrase
solana-keygen new -o keypairs/staking-keypair.json --force --no-bip39-passphrase

# 2. Sync IDs to declare_id! and Anchor.toml
anchor keys sync

# 3. Manual update: cross-program constants in Rust
# - programs/amm/src/constants.rs (TAX_PROGRAM_ID)
# - programs/epoch-program/src/constants.rs (tax_program_id, amm_program_id, staking_program_id)
# - programs/tax-program/src/constants.rs (epoch_program_id)
# - programs/staking/src/constants.rs (epoch_program_id)
# - programs/stub-staking/src/lib.rs (epoch_program_id reference)
# - programs/mock-tax-program/src/lib.rs (declare_id should still match tax_program)

# 4. Manual update: shared TypeScript constants
# - shared/constants.ts (PROGRAM_IDS)

# 5. Build with devnet features
./scripts/deploy/build.sh --devnet

# 6. Deploy all 5 programs
solana program deploy target/deploy/transfer_hook.so --program-id keypairs/transfer-hook-keypair.json --url devnet
solana program deploy target/deploy/amm.so --program-id keypairs/amm-keypair.json --url devnet
solana program deploy target/deploy/tax_program.so --program-id keypairs/tax-program-keypair.json --url devnet
solana program deploy target/deploy/epoch_program.so --program-id keypairs/epoch-program.json --url devnet
solana program deploy target/deploy/staking.so --program-id keypairs/staking-keypair.json --url devnet

# 7. Delete old mint keypairs + ALT cache
rm scripts/deploy/mint-keypairs/*.json
rm scripts/deploy/alt-address.json

# 8. Initialize protocol
CLUSTER_URL=<helius-devnet> npx tsx scripts/deploy/initialize.ts

# 9. Verify deployment
CLUSTER_URL=<helius-devnet> npx tsx scripts/deploy/verify.ts

# 10. Verify on-chain (security tests)
# Custom script or manual testing for each Phase 46-50 fix
```

### Verified: On-Chain Security Verification Tests
Per CONTEXT.md, these must be verified:
1. **Phase 46 - fake staking_escrow:** Call swap_sol_buy with wrong staking_escrow address -> expect revert
2. **Phase 46 - fake amm_program:** Call swap_sol_buy with wrong amm_program address -> expect revert
3. **Phase 46 - fake randomness:** Call trigger_epoch_transition with non-Switchboard randomness -> expect revert
4. **Phase 48 - sell tax from WSOL:** Execute sell swap, verify tax deducted from WSOL output (user SOL unchanged)
5. **Phase 49 - minimum output floor:** Call swap with minimum_output=0 -> expect MinimumOutputFloorViolation
6. **Phase 50 - VRF bounty:** Trigger epoch transition, verify 0.001 SOL transferred to triggerer from carnage_sol_vault

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `anchor build` | `build.sh --devnet` with dual feature rebuild | Phase 50 | Must always use build.sh for devnet deployment |
| SPL Token vaults | Token-2022 InterfaceAccount vaults | Phase 46-48 | Test harnesses must use Token-2022 |
| Direct AMM swap calls | CPI via Tax Program (swap_authority PDA) | Phase 46 | Tests must simulate CPI path or adapt harness |
| Upgrade in-place | Fresh deploy | Phase 51 decision | New keypairs, new program IDs, new PDAs |

**Deprecated/outdated:**
- Old devnet program IDs (zFW9mo, FV3kWD, AH7yaW, Bb8ist, 9UyWsQ) will be replaced
- Old ALT (EyUncwUhSwCVyTnbeoKe7Ug33sUDGAQDLDBQ5fVP9Vuf) will be abandoned
- Old mint addresses will change (new mint keypairs)
- Old pda-manifest.json will be regenerated

## Open Questions

1. **Exact Epoch test failure count**
   - What we know: Phase 50 verification says "81/81 epoch tests passed" and "44/44 tax lib tests passed." The 8 Epoch failures in MAINT-02 may already be fixed.
   - What's unclear: Whether the 8 Epoch failures were inline unit tests or integration tests. No integration test files exist for epoch-program (`programs/epoch-program/tests/` is empty).
   - Recommendation: Run `cargo test -p epoch-program` as the first task. If all pass, the effective count is 29 (not 37). Update MAINT-02 accordingly.

2. **LP sizing for initialize.ts**
   - What we know: Context says "~2 SOL per pool" for CRIME/SOL and FRAUD/SOL.
   - What's unclear: What the current default in initialize.ts is, and whether PROFIT pools need liquidity too.
   - Recommendation: Check initialize.ts liquidity constants and adjust to 2 SOL per SOL pool. PROFIT pools need some liquidity for swap_profit_* tests but amount is less critical.

3. **Placeholder token metadata**
   - What we know: Context says "Placeholder token metadata (names, logos, website, socials) -- real assets go in at final deploy."
   - What's unclear: Whether token metadata is set during mint creation or separately. Token-2022 metadata extensions can be set at mint creation time.
   - Recommendation: Use simple placeholder names ("Dr. Fraudsworth CRIME Token", etc.) with no URI for now. Final metadata in a later phase.

4. **Test harness swap_authority strategy**
   - What we know: AMM swap tests fail because swap_authority requires Tax Program PDA signing.
   - What's unclear: Whether LiteSVM supports multi-program CPI testing, or whether the test harness should mock the PDA signing.
   - Recommendation: Research LiteSVM's multi-program loading. If it supports loading both AMM and Tax Program, restructure tests to CPI through Tax Program. If not, the tests may need to use a simplified mock or adjust the AMM to accept swap_authority differently in test mode (not recommended -- would weaken security).

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: all file paths, constants, and test outputs verified
- `cargo test -p amm --tests` output: 19 failures confirmed (7 sol_pool + 12 profit_pool)
- `cargo test -p tax-program --tests` output: 10 failures confirmed (5 sol_buy + 5 sol_sell)
- Phase 46-50 verification reports (all passed with code evidence)
- `build.sh` source code: confirmed devnet dual-build pattern
- `initialize.ts` source code: confirmed 20-step idempotent sequence
- `alt-helper.ts` source code: confirmed ALT creation/extension/caching pattern
- `connection.ts` source code: confirmed IDL-based program loading

### Secondary (MEDIUM confidence)
- Phase 50 verification claims "81/81 epoch tests passed" -- needs reconfirmation
- MAINT-02 count of "37 = 19 + 10 + 8" may need adjustment if Epoch tests are already green

### Tertiary (LOW confidence)
- Token-2022 InterfaceAccount compatibility with SPL Token vaults -- need to verify exact constraint behavior in Anchor 0.32.1 to understand why `pool_vault_b` fails with InvalidAccountData

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already in codebase, no new dependencies
- Architecture: HIGH -- deployment infrastructure exists and is well-documented
- Test failures: HIGH -- confirmed by running actual test suites with exact error messages
- Pitfalls: HIGH -- derived from actual failure patterns and codebase analysis
- Cross-program ID map: HIGH -- built from grep of actual codebase references

**Research date:** 2026-02-20
**Valid until:** Indefinite (codebase-specific, not version-dependent)
