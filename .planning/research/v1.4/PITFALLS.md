# Domain Pitfalls: v1.4 Pre-Mainnet Deployment

**Domain:** Solana DeFi Protocol Mainnet Deployment (Token-2022, Squads Multisig, Arweave Metadata, Deployment Pipeline)
**Researched:** 2026-03-12
**Confidence:** MEDIUM (based on project documentation analysis, codebase inspection, and domain knowledge; web verification was unavailable for Squads v4 specifics and Arweave upload patterns)

**Note on sources:** WebSearch and WebFetch were unavailable during this research session. Claims about Squads v4 PDA layout and Arweave upload specifics are based on training data (cutoff ~May 2025) and should be verified against current documentation before implementation. Claims about this project's specific architecture, deployment pipeline, and known issues are HIGH confidence (verified from codebase and project docs).

---

## Critical Pitfalls

Mistakes that cause fund loss, permanent lockout, or require full redeployment.

### Pitfall 1: Squads Authority Transfer Before Verifying Multisig Round-Trip

**What goes wrong:** You transfer all 7 program upgrade authorities to a Squads multisig address, but the multisig is misconfigured (wrong threshold, wrong member keys, wrong vault PDA). You now cannot upgrade any program. On mainnet with real funds, this is catastrophic.

**Why it happens:** `solana program set-upgrade-authority` is a one-way operation. Once the upgrade authority is set to an address, only that address can change it again. If the address is a Squads vault that cannot produce valid signatures (wrong members, wrong threshold, wrong vault derivation), the authority is effectively burned prematurely.

**Consequences:** All 7 programs become permanently immutable before intended. No ability to patch bugs. No ability to adjust timelock. Equivalent to premature authority burn without safety testing. The entire tiered-timelock strategy (2hr -> 24hr -> burn) documented in `Docs/deployment-sequence.md` is destroyed.

**Prevention:**
1. Create the Squads multisig on **devnet first** and complete a full governance cycle: propose upgrade, approve 2-of-3, execute after timelock, verify program bytecode changed.
2. Transfer authority for ONE non-critical program first (e.g., Conversion Vault). Verify you can propose and execute an upgrade through the multisig before touching the remaining 6.
3. Only after the round-trip is proven do you transfer the remaining authorities.
4. Document the exact Squads vault PDA (this is NOT the multisig address -- see Pitfall 12). Verify with `solana program show <PROGRAM_ID>` after each transfer.
5. Keep the deployer wallet keypair backed up until ALL round-trips are verified. If anything goes wrong before the first transfer, you can still recover.

**Detection:** `solana program show <PROGRAM_ID>` shows an unexpected upgrade authority, or Squads UI shows "no proposals possible" for program upgrade.

**Phase recommendation:** Dedicated Squads setup phase with devnet dry run BEFORE any mainnet authority transfers.

---

### Pitfall 2: Building Mainnet Binaries with --devnet Flag (or Vice Versa)

**What goes wrong:** You accidentally build with `--devnet` for mainnet deployment. Four programs have feature-gated constants: Tax Program (`treasury_pubkey()`), Epoch Program (Switchboard PID, `SLOTS_PER_EPOCH`), Conversion Vault (mint addresses), Bonding Curve (mint addresses, Epoch Program ID).

**Why it happens:** The `build.sh` script takes a `--devnet` flag; default (no flag) is mainnet. A simple typo, stale shell history, or copy-paste error deploys wrong binaries. The `compile_error!` guards in `constants.rs` only catch missing placeholder addresses -- they do NOT catch deploying devnet-compiled binaries to mainnet.

**Consequences:**
- **Tax Program with devnet flag on mainnet:** `treasury_pubkey()` returns `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` (devnet wallet). All 5% treasury tax goes to this address on mainnet, which is accessible but is the devnet wallet -- not the mainnet treasury. Funds recoverable but wrong destination.
- **Epoch Program with devnet flag on mainnet:** Switchboard PID is devnet. VRF calls fail with `ConstraintOwner`. Epochs cannot advance. Carnage never fires. Protocol is functionally dead while appearing deployed.
- **Epoch Program with devnet SLOTS_PER_EPOCH on mainnet:** 750 slots (~5 min) instead of 4500 (~30 min). Protocol runs 6x faster than intended. Tax rates change too frequently. Economic model diverges from design.
- **Conversion Vault / Bonding Curve with devnet mints on mainnet:** Compile-time guards should catch this via `compile_error!`, but only if the mainnet mint addresses haven't been prematurely set to devnet values during testing.

**Prevention:**
1. Add a `--mainnet` verification mode to `build.sh` that: (a) confirms no `--devnet` flag, (b) greps the compiled `.so` files for known devnet addresses (devnet wallet `8kPzh`, devnet Switchboard PID), (c) aborts if any are found.
2. Post-build check: `strings target/deploy/tax_program.so | grep -c "8kPzh"` should return 0 for mainnet builds.
3. Post-build check: verify the Switchboard PID embedded in `epoch_program.so` matches `switchboard_on_demand::ON_DEMAND_MAINNET_PID`.
4. Deploy script should refuse to deploy to mainnet-beta if binary verification fails.

**Detection:** After deployment, trigger a test swap and verify the treasury receives funds at the correct mainnet address. Or: trigger an epoch transition -- if VRF fails with `ConstraintOwner`, the Switchboard PID is wrong.

**Phase recommendation:** Build verification step in deploy pipeline, run BEFORE deploy.

---

### Pitfall 3: Whitelist Authority Burned Before All Mainnet Accounts Whitelisted

**What goes wrong:** On mainnet, you follow the devnet initialization sequence which burns whitelist authority after creating 13 entries. But mainnet requires additional entries for bonding curve vaults that don't exist on devnet's current deployment.

**Why it happens:** The whitelist burn is irreversible (`WhitelistAuthority.authority = None`). The current devnet whitelist has 13 entries (3 admin + 3 vault + 4 pool + 1 stake + 2 carnage). Mainnet bonding curve launch creates additional token vaults: `curve_token_vault` for CRIME, `curve_token_vault` for FRAUD, `curve_tax_escrow` for CRIME, `curve_tax_escrow` for FRAUD -- potentially 4 more entries that need whitelisting before the bonding curve can transact.

**Consequences:** Any un-whitelisted token account cannot participate in `transfer_checked` calls. If a bonding curve vault is missed, that curve's buy/sell operations are permanently broken. With burned upgrade authority, this cannot be fixed.

**Prevention:**
1. Enumerate ALL accounts that need whitelisting on mainnet, including bonding curve accounts. Cross-reference against the bonding curve program's instruction accounts (specifically `buy_tokens` and `sell_tokens` which move Token-2022 tokens).
2. Do NOT include whitelist authority burn in `initialize.ts` for mainnet. Separate it into a distinct manual step.
3. Run a full lifecycle test covering ALL paths (swap, stake, unstake, bonding curve buy/sell, conversion vault, Carnage all 6 paths) BEFORE burning.
4. Count expected whitelist entries: 13 (current) + bonding curve vaults. Verify the on-chain count matches before burning.

**Detection:** Any `transfer_checked` involving an un-whitelisted account fails. Test every single path before burning.

**Phase recommendation:** Whitelist burn should be a separate, late-stage phase with its own verification gate. Never bundled with initialization.

---

### Pitfall 4: Mainnet Vanity Mint Keypairs Leaked or Lost

**What goes wrong:** The vanity mainnet mint keypairs (`cRiME...`, `FraUd...`, `pRoFiT...`) are accidentally committed, leaked, or lost. These took enormous compute to generate (PROFIT key: 1-in-850T match, per MEMORY.md).

**Why it happens:** Files are at `keypairs/mainnet-*-mint.json`, documented as git-ignored. But git-ignore mistakes happen (wrong glob pattern, `.gitignore` edited, force-add). If leaked before mainnet deployment, an attacker could create mints at those vanity addresses with wrong parameters (wrong decimals, no transfer hook, wrong extensions).

**Consequences:**
- **Leaked:** Attacker front-runs mint creation at your vanity addresses. All branding compromised. Must use non-vanity addresses.
- **Lost:** Vanity addresses gone forever. Cosmetic loss, no functional impact.
- **Accidentally committed:** Permanent in git history even if removed later.

**Prevention:**
1. Verify `keypairs/mainnet-*-mint.json` appears in `.gitignore`: `git check-ignore keypairs/mainnet-crime-mint.json` should return the path.
2. Run `git log --all --diff-filter=A -- 'keypairs/mainnet-*'` to verify these files were never committed.
3. Back up to encrypted offline storage (not cloud, not git).
4. Before deployment day, verify keypairs match expected addresses: `solana-keygen pubkey keypairs/mainnet-crime-mint.json`.

**Detection:** `git log --all -- keypairs/mainnet-*` returns nothing. `git status` shows no tracked mainnet keypair files.

---

### Pitfall 5: Bonding Curve Launch Sniped by MEV Bots

**What goes wrong:** The `start_curve` transaction is visible in the mempool. Bots immediately buy maximum allocation (20M tokens per wallet) across many wallets at the lowest price (0.0000009 SOL/token), then sell back at higher prices as legitimate buyers push the curve up.

**Why it happens:** Solana transactions are public in the mempool. The bonding curve has a linear price increase from 0.0000009 to 0.00000345 SOL/token (~3.83x). Early buyers get the best price. The 20M-token wallet cap limits per-wallet sniping but not per-entity sniping across multiple wallets.

**Consequences:** Bots capture the best prices. Legitimate users enter at artificially inflated prices. "Fair launch" perception destroyed. The 15% sell tax escrow provides deterrence (bots lose 15% on quick sell-backs) but may not be sufficient against sophisticated multi-wallet MEV.

**Prevention:**
1. **Jito bundles** for the `start_curve` transaction: lands atomically without public mempool visibility.
2. **Stealth launch window:** Announce a 2-hour window, not an exact block. Reduces bot positioning.
3. **The 15% sell tax escrow is your primary defense:** Bots that buy-and-sell rapidly lose 15% of their position to the escrow. Sniping is only profitable if the price rises >18% (15% tax + gas) before they sell. On a 3.83x curve, this means bots must hold through significant curve fill to profit -- reducing their advantage.
4. **Post-launch monitoring:** Watch for suspicious patterns (many wallets buying max in same block, funded from same source). The 20M wallet cap (checked via ATA balance reads) limits individual wallet exposure.
5. **Consider delaying curve start announcement** until after both curves are initialized and funded on-chain, minimizing the window between "curve exists" and "curve is buyable."

**Detection:** Post-launch analysis of early buyers. Cross-reference wallet funding sources.

**Phase recommendation:** Bonding curve launch as its own phase with explicit MEV mitigation checklist.

---

### Pitfall 6: Deploying to Wrong Cluster

**What goes wrong:** Run `deploy-all.sh` with devnet URL but mainnet-built binaries, or mainnet URL with devnet binaries. Programs deploy to the wrong environment.

**Why it happens:** Shell history, stale `.env`, copy-paste errors. `CLUSTER_URL` in `.env` may point to one cluster while the CLI command targets another.

**Consequences:** All consequences from Pitfall 2, plus potential deployment of mainnet programs to devnet (wasting the deployment slot -- program IDs are tied to keypairs, so you cannot redeploy to the same address on a different cluster without the same keypair).

**Prevention:**
1. `deploy-all.sh` should detect cluster from URL and cross-validate against build artifacts. URL containing `mainnet` should refuse devnet-flagged artifacts.
2. Add confirmation prompt: "Deploying to MAINNET-BETA. Type 'mainnet' to confirm."
3. The version gate in `mainnet-checklist.md` Section 0 (verify `solana cluster-version` matches CLI) is a good start. Extend to also verify artifact-cluster consistency.

**Detection:** Immediate on first VRF call if Switchboard PID mismatches cluster.

---

## Moderate Pitfalls

Mistakes that cause delays, rework, or operational issues but don't lose funds.

### Pitfall 7: Arweave Metadata JSON in Wrong Format

**What goes wrong:** Metadata JSON uploaded to Arweave is missing required fields, has wrong field names, or the `image` field points to a URL that hasn't been uploaded yet. Wallets and explorers show broken/missing token information.

**Why it happens:** Token-2022 metadata follows the Metaplex token metadata standard. The off-chain JSON must include specific fields: `name`, `symbol`, `description`, `image`, `external_url`, `attributes`, etc. The `image` field must point to an already-uploaded Arweave asset (uploaded separately before the JSON). Wallet adapters (Phantom, Solflare) and explorers (Solscan, Solana Explorer) parse this JSON differently -- some require fields others don't.

**Prevention:**
1. Upload images to Arweave FIRST. Get permanent `ar://` or `https://arweave.net/<TX_ID>` URIs.
2. Create metadata JSON referencing image URIs. Validate against Metaplex metadata standard.
3. Upload JSON to Arweave. Use the Arweave transaction ID in the on-chain metadata URI.
4. Test rendering in Phantom, Solflare, Backpack, Solscan, and Solana Explorer BEFORE burning mint update authority.
5. Note: `ar://` URIs are the most permanent form. `https://arweave.net/<TX_ID>` depends on a specific gateway but is more universally supported by wallets.

**Detection:** Open token in any Solana wallet. If logo is missing, name is wrong, or description is blank, the metadata is incorrect.

**Phase recommendation:** Arweave upload phase should include a verification step that fetches the URI and validates JSON before updating on-chain.

---

### Pitfall 8: IDL Files Not Synced After Mainnet Build

**What goes wrong:** Programs rebuilt for mainnet (without `--devnet`), deployed, but `app/idl/` still contains devnet-build IDLs. Frontend constructs transactions with stale account layouts or wrong program addresses.

**Why it happens:** This already happened during Phase 51 and is documented in `Docs/mainnet-checklist.md` Section 6. The IDL JSON files contain the program address in the `"address"` field. After `anchor build`, IDLs in `target/idl/` are regenerated but `app/idl/` copies are NOT automatically updated.

**Consequences:** All frontend transactions fail. The `Program` constructor uses the IDL's embedded address to build instructions. Mismatched addresses produce transactions to wrong programs.

**Prevention:**
1. `deploy-all.sh` should include automatic IDL sync: `cp target/idl/*.json app/idl/ && cp target/types/*.ts app/idl/types/`
2. Already documented in mainnet checklist Section 6. Elevate from checklist item to hard gate in pipeline.
3. Add CI check: `app/idl/*.json` addresses must match `Anchor.toml` program IDs.

**Detection:** All frontend operations fail immediately with unhelpful RPC errors.

---

### Pitfall 9: ALT Created with Stale (Devnet) Addresses on Mainnet

**What goes wrong:** The ALT helper reads from `scripts/deploy/pda-manifest.json` which still contains devnet addresses. Or a cached `scripts/deploy/alt-address.json` from devnet is reused. The mainnet ALT contains devnet addresses.

**Why it happens:** ALT creation uses the PDA manifest as source of truth. If the manifest wasn't regenerated after mainnet initialization (Step 23 of `initialize.ts` does this), it contains devnet addresses. The cached ALT file short-circuits creation.

**Consequences:** Carnage atomic execution (which requires ALT for 23+ named accounts) sends wrong addresses. Any v0 transaction using the ALT includes garbage. With `skipPreflight: true` (required for v0), the error may not be caught until state inspection.

**Prevention:**
1. Delete `scripts/deploy/alt-address.json` before mainnet ALT creation.
2. Verify PDA manifest was regenerated by `initialize.ts` (check file timestamp, compare program IDs).
3. After ALT creation, verify contents: `solana address-lookup-table get <ALT_ADDRESS>` and cross-reference every address against mainnet PDA manifest.
4. Update `shared/programs.ts` ALT constant to mainnet address.

**Detection:** Carnage execution fails. `solana address-lookup-table get` shows addresses that don't match mainnet PDAs.

---

### Pitfall 10: Environment Variable Leakage Between Clusters

**What goes wrong:** `.env` still has devnet `CLUSTER_URL` when running mainnet operations. Railway env vars still point to devnet. `NEXT_PUBLIC_RPC_URL` routes to devnet Helius endpoint.

**Why it happens:** Shared `.env` file between local dev and deployment. Railway env vars manually updated (easy to miss one). No automated validation that ALL environment variables are consistent with target cluster.

**Consequences:**
- Frontend on devnet, programs on mainnet: all transactions fail.
- Crank bot on devnet, mainnet needs cranking: epochs stall on mainnet.
- RPC proxy routes to devnet: all frontend transactions hit wrong cluster.

**Prevention:**
1. Separate `.env.mainnet` and `.env.devnet` files. Deploy script sources the correct one.
2. Railway: create separate service/environment for mainnet. Don't modify devnet env vars in place.
3. Crank runner startup: verify cluster URL returns expected version via `getVersion()`.
4. Frontend: visible cluster badge ("DEVNET" / "MAINNET") based on `NEXT_PUBLIC_SOLANA_CLUSTER`.

**Detection:** `solana cluster-version --url <URL>` returns wrong cluster. Frontend badge shows wrong network.

---

### Pitfall 11: Pool Seeding with Wrong Amounts (Phase 69 Repeat)

**What goes wrong:** `initialize.ts` runs without `.env` sourced, falling back to test defaults (10 SOL / 10,000 tokens) instead of production values (2.5 SOL / 290M tokens for devnet, or 1,000 SOL / 290M tokens for mainnet via bonding curve). Pools cannot be re-seeded.

**Why it happens:** This exact mistake already happened (Phase 69, cost ~50 SOL, required full redeploy). `.env` contains `SOL_POOL_SEED_SOL_OVERRIDE` and `SOL_POOL_SEED_TOKEN_OVERRIDE`. Without sourcing, script silently uses test defaults.

**Consequences:** On mainnet: pools initialized with toy liquidity. First swap has extreme price impact. Cannot fix without full redeployment (new mints, new programs, new everything). On mainnet this would be catastrophic.

**Prevention:**
1. `initialize.ts` MUST refuse to run if seed override env vars are unset AND target cluster is not localhost. Hard error, not silent fallback.
2. `deploy-all.sh` already sources `.env`, but verify the pipeline still does this.
3. Note: on mainnet, SOL pools are seeded from bonding curve proceeds (1,000 SOL per pool), not from env vars. The initialize.ts seed amounts are only for the initial empty pool creation. Clarify whether mainnet pools are created empty and filled by bonding curve graduation, or pre-seeded.
4. Check pool reserves immediately after initialization.

**Detection:** `solana account <POOL_PDA>` -- inspect reserve fields at known byte offsets.

---

### Pitfall 12: Squads Vault PDA vs Multisig Address Confusion

**What goes wrong:** Program upgrade authority set to the Squads multisig account address instead of the Squads vault PDA. The multisig account is the governance configuration. The vault PDA is what actually holds authorities and signs transactions.

**Why it happens:** Squads v4 has multiple PDAs. Members interact with the multisig at one address. The vault that holds assets and can sign for upgrade authority is at a different PDA, typically derived as `[b"multisig", multisig_pubkey, b"vault", vault_index.to_le_bytes()]` on the Squads v4 program. Confusing these two addresses is easy.

**Consequences:** Authority transferred to an address that cannot produce the signatures needed for `solana program deploy`. Programs become effectively immutable. Identical outcome to Pitfall 1.

**Prevention:**
1. In the Squads UI or SDK, explicitly identify the **vault** PDA -- not the multisig config PDA.
2. Before authority transfer: have the vault PDA sign a test transaction on devnet (e.g., a simple SOL transfer) to prove it can sign.
3. After transfer: `solana program show <PROGRAM_ID>` should display the vault PDA as upgrade authority. Compare character-by-character.
4. Document: "Multisig address: X, Vault PDA: Y, Upgrade authority set to: Y"

**Detection:** `solana program show` upgrade authority != intended vault PDA.

**Confidence:** MEDIUM -- Squads v4 PDA derivation based on training data. Must verify against current Squads documentation and SDK.

---

### Pitfall 13: On-Chain Metadata URI Not Updated After Arweave Upload

**What goes wrong:** Token metadata JSON uploaded to Arweave correctly, but on-chain metadata URI (in Token-2022 MetadataPointer extension) still points to Railway placeholder endpoint (`/api/metadata/crime`). Wallets show placeholder or broken metadata.

**Why it happens:** The URI is set during `initialize.ts` (Step 1). Updating requires `tokenMetadataUpdateField` instruction signed by the mint's update authority. If forgotten, or if update authority was already burned/transferred to Squads, the URI remains permanently stale.

**Prevention:**
1. Do NOT burn or transfer mint update authority until metadata URIs are verified correct and rendering properly in wallets.
2. Create a dedicated `update-metadata-uri.ts` script that updates all 3 mints.
3. After update, verify on-chain: decode the mint account's TokenMetadata extension and confirm the URI field.
4. Test in Phantom, Solflare, Solscan before proceeding to authority burn/transfer.

**Detection:** Token in any wallet shows wrong logo, no description, or "CRIME" with placeholder text.

---

### Pitfall 14: Crank Bot Fails to Land Transactions on Mainnet

**What goes wrong:** Crank reliably lands on devnet (low contention) but fails on mainnet during congestion. Epoch transitions stall. Carnage doesn't fire.

**Why it happens:** Mainnet validators prioritize by priority fee. Without dynamic priority fees, crank transactions queue indefinitely during congestion. The crank bounty is 0.001 SOL -- may be less than the required priority fee.

**Consequences:** Epochs don't advance. Tax rates stale. Carnage never fires. Staking rewards accumulate but aren't distributed. Protocol degrades gracefully (no funds lost, per architecture design) but appears broken to users. This is documented as open question OQ1 in `Docs/mainnet-readiness-assessment.md`.

**Prevention:**
1. Implement dynamic priority fees: query `getPriorityFeeEstimate` from Helius before each crank transaction.
2. Set a priority fee budget: even if fee exceeds bounty, protocol health is worth the cost. Log a warning.
3. Monitor epoch transition frequency. Alert if >2x expected interval (~60 min on mainnet).
4. Consider Jito bundle tips as alternative for reliable landing.
5. v1.3 added circuit breaker and spending cap to the crank (per `Docs/mainnet-readiness-assessment.md`). Verify these limits are appropriate for mainnet fee levels.

**Detection:** Epoch number stops advancing. Crank logs show "TransactionExpiredBlockheightExceededError" or repeated retries.

---

### Pitfall 15: BcAdminConfig Not Initialized on Mainnet

**What goes wrong:** The Bonding Curve's `BcAdminConfig` PDA is not included in `initialize.ts` automation (documented as DEPLOY-GAP-01 in MEMORY.md). If skipped, the bonding curve program has no admin configured and cannot call `start_curve`.

**Why it happens:** BcAdminConfig initialization was added in Phase 78 (v1.3) but the deploy pipeline wasn't updated to include it. It requires a manual step. On mainnet, forgetting this means the bonding curve cannot launch.

**Consequences:** Bonding curve is deployed but non-functional. `start_curve` fails because BcAdminConfig doesn't exist. Must be initialized before bonding curve launch. Not catastrophic (can be initialized after deployment) but delays launch.

**Prevention:**
1. Add BcAdminConfig initialization to `initialize.ts` or create a dedicated `initialize-bonding-curve.ts` script.
2. Include in `verify.ts` checks: verify BcAdminConfig PDA exists and has correct authority.
3. This is already tracked as DEPLOY-GAP-01. Resolve it in v1.4.

**Detection:** `start_curve` instruction fails with "Account not found" for BcAdminConfig PDA.

---

## Minor Pitfalls

Mistakes that cause annoyance or cosmetic issues but are fixable.

### Pitfall 16: Explorer Links Still Append ?cluster=devnet

**What goes wrong:** After mainnet migration, all transaction confirmation links send users to devnet explorer views where transactions don't exist.

**Prevention:** Make cluster parameter environment-aware: `NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? '?cluster=devnet' : ''`. Files: `SwapStatus.tsx`, `CarnageCard.tsx`, `BalanceDisplay.tsx` (tracked in mainnet-checklist Section 2).

---

### Pitfall 17: Devnet Faucet Link Visible on Mainnet

**What goes wrong:** "Get Devnet SOL" link visible to mainnet users. Confusing and unprofessional.

**Prevention:** Conditional render on `NEXT_PUBLIC_SOLANA_CLUSTER`. Already tracked in mainnet-checklist Section 2.

---

### Pitfall 18: DEVNET_ Prefix in Production Constants

**What goes wrong:** Constants named `DEVNET_PDAS`, `DEVNET_POOL_CONFIGS`, `DEVNET_ALT` used in production. Confuses auditors, reviewers, new contributors.

**Prevention:** Rename to `PDAS`, `POOL_CONFIGS`, `PROTOCOL_ALT` or make them environment-aware. Recommended in mainnet-checklist Section 1.

---

### Pitfall 19: Insufficient SOL for Mainnet Deployment

**What goes wrong:** Deployer wallet runs out of SOL mid-deployment. Partially initialized state requires careful resume.

**Why it happens:** Mainnet has no faucets. Deployment needs ~15 SOL (7 programs + mints + PDAs + pools + vault + ALT + priority fees). Congestion increases priority fee costs unpredictably.

**Prevention:**
1. Budget 25+ SOL (15 base + 10 buffer for priority fees, retries, and bonding curve initialization).
2. The pipeline is idempotent (resume-safe), but verify this on devnet first.
3. Have a second SOL source ready.

---

### Pitfall 20: Privy Wallet Chain Configuration Not Updated

**What goes wrong:** Frontend uses Privy for embedded wallets. The `chain` parameter in `signTransaction` is hardcoded to `"solana:devnet"` (per MEMORY.md). On mainnet, transactions are signed for devnet chain context.

**Prevention:** Make chain parameter environment-aware: `chain: NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'solana:devnet' : 'solana:mainnet'`. Also update `config.solana.rpcs` key from `"solana:devnet"` to `"solana:mainnet"` (CAIP-2 format, per MEMORY.md).

**Detection:** Wallet transactions fail or are signed for wrong cluster.

---

## Compound Risk: The Ordering Problem

Several pitfalls interact dangerously when sequenced incorrectly:

**Dangerous sequence 1: Whitelist burn before bonding curve accounts exist**
If bonding curve creates new token vaults needing whitelisting, and you burn whitelist authority before launching the bonding curve, those vaults can never be whitelisted. The bonding curve cannot transact Token-2022 tokens.

**Dangerous sequence 2: Authority transfer before metadata update**
If mint update authority is transferred to Squads before updating metadata URIs, every URI update requires a multisig governance cycle. Operationally painful but not fatal.

**Dangerous sequence 3: IDL sync before constants update**
If IDLs are synced to frontend but shared constants still point to devnet, transactions are built with mixed devnet/mainnet addresses.

**Dangerous sequence 4: Crank started before full initialization**
Already documented as a Phase 69 lesson: partially-deployed programs + running crank = errors and potentially locked state. Stop crank before deploying, restart after full verification.

**Recommended mainnet deployment ordering:**
```
1.  Build mainnet binaries (verify no --devnet, binary inspection)
2.  Deploy all 7 programs (verify cluster, verify program IDs)
3.  Initialize (verify env vars, verify seed amounts, verify whitelist count)
4.  Initialize BcAdminConfig (DEPLOY-GAP-01)
5.  Generate PDA manifest
6.  Create ALT (delete cached devnet ALT first, verify addresses)
7.  Sync IDLs to frontend
8.  Update shared constants (rename DEVNET_ prefixes)
9.  Upload images to Arweave
10. Upload metadata JSON to Arweave
11. Update on-chain metadata URIs (verify in wallets)
12. Deploy frontend with mainnet configuration
13. Full lifecycle test (ALL swap/stake/convert/carnage paths)
14. Launch bonding curves (Jito bundles, stealth timing)
15. Verify bonding curve accounts are whitelisted
16. Burn whitelist authority (after ALL paths verified)
17. Burn AMM admin
18. Transfer upgrade authorities to Squads (one at a time, verify round-trip each)
19. Start crank bot (with dynamic priority fees)
20. Begin tiered timelock progression (2hr -> 24hr -> burn post-audit)
```

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Squads Multisig Setup | Vault PDA confusion (#12), lockout (#1) | CRITICAL | Full devnet dry run with round-trip upgrade proof |
| Arweave Metadata Upload | Stale on-chain URI (#13), wrong JSON format (#7) | MODERATE | Upload, update, verify in wallets, THEN burn update authority |
| Mainnet Build | Wrong feature flag (#2), wrong cluster (#6) | CRITICAL | Binary verification step, cluster detection in deploy script |
| Mainnet Initialize | Wrong seed amounts (#11), missing whitelist (#3), BcAdminConfig gap (#15) | CRITICAL | Mandatory env var validation, complete account enumeration |
| ALT Creation | Stale devnet addresses (#9) | MODERATE | Delete cached ALT, verify against manifest |
| Bonding Curve Launch | Front-running/MEV (#5) | CRITICAL | Jito bundles, stealth window, 15% sell tax as deterrent |
| Authority Transfer | Wrong address (#1, #12) | CRITICAL | One program at a time, verify round-trip |
| Whitelist Authority Burn | Missing accounts (#3) | CRITICAL | Full lifecycle test, separate phase |
| Crank Mainnet Migration | No priority fees (#14), wrong cluster (#10) | MODERATE | Dynamic fees, cluster startup check |
| Frontend Migration | Stale constants (#10), stale IDLs (#8), devnet links (#16-17), Privy chain (#20) | MODERATE | Environment-aware constants, automated IDL sync |
| Credential Rotation | Leaked keypairs (#4), env leakage (#10) | CRITICAL | Fresh everything, git history audit |

---

## Sources

- `Docs/mainnet-readiness-assessment.md` -- v1.3 readiness state, blockers B1/B2, risks R1-R4, open questions OQ1-OQ3
- `Docs/mainnet-checklist.md` -- 12-section devnet-to-mainnet switch inventory with Phase 69 lessons
- `Docs/deployment-sequence.md` -- Full deployment pipeline, authority burn sequence, bonding curve launch, ALT setup
- `Docs/architecture.md` -- System architecture, CPI chains, MEV protection patterns
- Project MEMORY.md -- Phase 69 lessons, authority strategy, Switchboard VRF patterns, Privy configuration, wallet-adapter issues, vanity mint details
- Codebase inspection: `compile_error!` guards in `bonding_curve/src/constants.rs`, `tax-program/src/constants.rs`, `conversion-vault/src/constants.rs`, `epoch-program/src/constants.rs`
- **Confidence caveat:** Squads v4 PDA derivation (Pitfall 12) and Arweave upload patterns (Pitfall 7) based on training data cutoff ~May 2025. Verify against current documentation before implementation.
