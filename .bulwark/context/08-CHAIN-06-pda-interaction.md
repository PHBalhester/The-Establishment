---
task_id: db-phase1-chain-06
provides: [chain-06-findings, chain-06-invariants]
focus_area: chain-06
files_analyzed: [app/lib/swap/swap-builders.ts, app/lib/swap/hook-resolver.ts, app/lib/swap/multi-hop-builder.ts, app/lib/curve/hook-accounts.ts, app/lib/curve/curve-tx-builder.ts, app/lib/staking/staking-builders.ts, app/lib/protocol-config.ts, app/lib/anchor.ts, app/lib/ws-subscriber.ts, app/hooks/useTokenBalances.ts, shared/constants.ts, scripts/deploy/fix-carnage-wsol.ts, scripts/deploy/lib/pda-manifest.ts]
finding_count: 8
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# CHAIN-06: Program Account & PDA Interaction -- Condensed Summary

## Key Findings (Top 8)

1. **Pre-computed PDA addresses used verbatim without runtime derivation verification**: All transaction builders (swap, staking, vault) consume pre-computed PDA addresses from `DEVNET_PDAS_EXTENDED` / `DEVNET_POOL_CONFIGS` (loaded from `shared/constants.ts` via `protocol-config.ts`) without re-deriving them to confirm they match the current program IDs. If `generate-constants.ts` produces stale addresses or program IDs change without regenerating constants, transactions will fail silently or target wrong accounts. -- `app/lib/swap/swap-builders.ts:263-281`, `shared/constants.ts:392-406`

2. **WSOL_INTERMEDIARY seed missing from shared SEEDS object**: The `SEEDS` export in `shared/constants.ts` does NOT include `WSOL_INTERMEDIARY`. This seed (`"wsol_intermediary"`) only exists in `pda-manifest.ts` as a local constant (`WSOL_INTERMEDIARY_SEED`). If any new code needs to derive this PDA dynamically, it must hardcode the string, risking drift from the on-chain constant. -- `shared/constants.ts:81-118` (absent)

3. **Vault PDA double-derivation re-derives vaultConfig every call**: `deriveVaultTokenAccount()` in swap-builders.ts re-derives the vaultConfig PDA on each invocation. When called twice for a vault convert (input + output), vaultConfig is derived twice unnecessarily. No correctness issue, but the pattern invites copy-paste errors if seeds diverge. -- `app/lib/swap/swap-builders.ts:150-160`

4. **Hook resolver uses hardcoded string seeds, not shared SEEDS constant**: `resolveHookAccounts()` in `hook-resolver.ts` derives ExtraAccountMetaList using `Buffer.from("extra-account-metas")` and whitelist using `Buffer.from("whitelist")`, while `getCurveHookAccounts()` in `hook-accounts.ts` uses `SEEDS.EXTRA_ACCOUNT_META` and `SEEDS.WHITELIST_ENTRY` from the shared module. Both resolve to the same values, but the inconsistency means a seed rename in shared constants would NOT propagate to hook-resolver.ts. -- `app/lib/swap/hook-resolver.ts:54-67` vs `app/lib/curve/hook-accounts.ts:44-56`

5. **Anchor account type names assume camelCase convention (AIP pitfall)**: ws-subscriber.ts line 65 documents that Anchor 0.32's `convertIdlToCamelCase()` requires camelCase account type names for `coder.accounts.decode()`. The BATCH_ACCOUNTS array uses `"epochState"`, `"poolState"`, `"curveState"`, `"stakePool"`, `"carnageFundState"` -- all correct. If an IDL update changes account naming, the mismatch would cause "Account not found" errors that mask as missing accounts rather than decode failures. -- `app/lib/ws-subscriber.ts:62-84`

6. **allowOwnerOffCurve inconsistency between swap builders and curve builder**: `getToken2022Ata()` in `swap-builders.ts` and `staking-builders.ts` uses `allowOwnerOffCurve = false`, while `deriveUserAta()` in `curve-tx-builder.ts` uses `allowOwnerOffCurve = true`. For regular user wallets this produces the same result. However, if a PDA-based wallet interacts with the bonding curve (e.g., a governance PDA purchasing tokens), the swap path would fail while the curve path would succeed. -- `app/lib/swap/swap-builders.ts:124` vs `app/lib/curve/curve-tx-builder.ts:67-72`

7. **No runtime validation that program ID constants match on-chain deployment**: `anchor.ts` uses `withClusterAddress()` to override IDL program addresses from `protocol-config.ts` constants. If the constants file has wrong IDs (e.g., after a deploy that didn't re-run `generate-constants.ts`), all Anchor operations will target the wrong programs. The only safeguard is the manual `generate-constants.ts` run during deployment. -- `app/lib/anchor.ts:46-51`, `app/lib/protocol-config.ts:27-31`

8. **Cluster config env var controls ALL addresses with no fallback validation**: `protocol-config.ts` reads `NEXT_PUBLIC_CLUSTER` and if unset defaults to `"devnet"`. On Railway, if this env var is missing or misspelled, mainnet traffic would silently route to devnet program IDs and PDAs. No runtime check validates that returned addresses are initialized accounts on the target cluster. -- `app/lib/protocol-config.ts:25-27`

## Critical Mechanisms

- **PDA Derivation Architecture**: Two patterns coexist: (1) Pre-computed addresses stored in `shared/constants.ts` and loaded via cluster config (`DEVNET_PDAS_EXTENDED`, `DEVNET_POOL_CONFIGS`, `DEVNET_CURVE_PDAS`), used for singleton PDAs (EpochState, StakePool, CarnageSolVault, pools, vaults). (2) Runtime derivation using `PublicKey.findProgramAddressSync()` for user-specific PDAs (UserStake, vault token accounts) and hook accounts (ExtraAccountMetaList, whitelist entries). The pre-computed addresses are the single source of truth for all transaction builders. -- `shared/constants.ts:188-406`, `app/lib/swap/swap-builders.ts:40-50`

- **Transfer Hook Account Resolution**: Two parallel resolvers exist: `resolveHookAccounts()` (swap/staking path) and `getCurveHookAccounts()` (bonding curve path). Both produce identical 4-element AccountMeta arrays [metaList, sourceWL, destWL, hookProgram]. Direction correctness is critical: buy = pool->user, sell = user->pool. Both resolvers correctly handle direction. All AccountMeta entries are `{isSigner: false, isWritable: false}`. -- `app/lib/swap/hook-resolver.ts:46-78`, `app/lib/curve/hook-accounts.ts:36-68`

- **Vault Conversion PDA Derivation**: Vault token account PDAs use a two-level derivation: first derive vaultConfig from `["vault_config"]`, then derive each vault from `[mintSeed, vaultConfig.toBuffer()]`. Seeds come from `VAULT_SEEDS` constant. The vault convert builder correctly resolves both input and output vaults, and assembles `remainingAccounts` as `[inputHooks(4), outputHooks(4)]`. -- `app/lib/swap/swap-builders.ts:150-160, 451-501`

- **Cluster-Aware Address Resolution**: `protocol-config.ts` acts as the single entry point for all cluster-specific addresses. It reads `NEXT_PUBLIC_CLUSTER`, maps to a `ClusterConfig` object, and re-exports all addresses using the same names as the legacy direct imports. Consuming files only need to change import source. Mainnet and devnet have fully distinct address sets. -- `app/lib/protocol-config.ts:1-73`

## Invariants & Assumptions

- INVARIANT: All PDA seed strings in `shared/constants.ts` SEEDS and VAULT_SEEDS must match on-chain `constants.rs` exactly (byte-for-byte). -- Enforced by manual sync, documented source mapping at `shared/constants.ts:72-80`. NOT enforced at compile time.
- INVARIANT: Transfer hook remaining_accounts must be exactly 4 accounts per mint in order [metaList, sourceWL, destWL, hookProgram]. -- Enforced by `resolveHookAccounts()` at `hook-resolver.ts:72-77` and `getCurveHookAccounts()` at `hook-accounts.ts:62-67`.
- INVARIANT: Hook account direction (source/dest) must match the actual Token-2022 transfer direction (buy: pool->user, sell: user->pool). -- Enforced by caller convention in each builder, documented in comments at `swap-builders.ts:243-249, 352-360`, `staking-builders.ts:198-204, 290-297`, `curve-tx-builder.ts:107-108, 159-160`.
- INVARIANT: Pre-computed PDA addresses in `shared/constants.ts` must match derivation from current program IDs. -- NOT enforced at runtime. Relies on `generate-constants.ts` being run after every deploy.
- INVARIANT: NEXT_PUBLIC_CLUSTER env var must be set correctly for the target environment ("devnet" or "mainnet"). -- NOT enforced beyond default to "devnet". No validation that addresses resolve to live accounts.
- ASSUMPTION: All protocol tokens (CRIME, FRAUD, PROFIT) use TOKEN_2022_PROGRAM_ID. -- Validated in `TOKEN_PROGRAM_FOR_MINT` map at `shared/constants.ts:247-252` and `protocol-config.ts:49-54`.
- ASSUMPTION: Anchor's `accountsStrict()` will reject transactions with wrong account addresses via on-chain PDA constraints. -- VALIDATED: on-chain `seeds` and `has_one` constraints provide a safety net for PDA mismatches.
- ASSUMPTION: UserStake PDA uses `["user_stake", user_pubkey]` seed derivation and the Staking program ID. -- Validated at `staking-builders.ts:122-127`, matches on-chain Stake struct.

## Risk Observations (Prioritized)

1. **Pre-computed PDA staleness risk (HIGH for mainnet)**: `shared/constants.ts` contains ~30 hardcoded PDA addresses. After any program redeploy, these must be regenerated via `generate-constants.ts`. Forgetting this step means all transactions target stale addresses. The on-chain constraints will reject mismatches, so this causes denial-of-service (all swaps fail) rather than fund loss. But on mainnet launch day, this would be catastrophic for availability. -- `shared/constants.ts:188-406`

2. **Duplicate hook resolver with divergent seed sourcing (MEDIUM)**: `hook-resolver.ts` hardcodes seed strings while `hook-accounts.ts` imports from SEEDS. If SEEDS values ever change (e.g., a transfer hook v2), only one resolver would update. Both are critical paths (swap vs curve). -- `app/lib/swap/hook-resolver.ts:54-67`

3. **No cross-validation between cluster config addresses and on-chain state (MEDIUM)**: The ws-subscriber does a batch `getMultipleAccountsInfo` on startup using the pre-computed addresses. If an address is wrong, it gets `null` and silently skips it. There is no alarm or circuit-breaker if core PDAs (EpochState, StakePool) fail to resolve. -- `app/lib/ws-subscriber.ts:113-165`

4. **Vault derivation exposes internal consistency dependency (MEDIUM)**: The vault convert path derives vaultConfig then uses it as a seed for vault token accounts. This is correct, but if `VAULT_SEEDS.CONFIG` ever diverges from the on-chain `"vault_config"` seed, the derived address silently changes. No cross-check exists between the derived address and the pre-computed addresses. -- `app/lib/swap/swap-builders.ts:150-160`

5. **BcAdminConfig PDA derivation absent from app layer (LOW)**: The bonding curve admin PDA (`["bc_admin_config"]`) is only derived in deploy scripts (`initialize.ts:1562`, `verify-authority.ts:266`), never in the app layer. If any frontend bonding curve admin operations are added later, the seed will need to be added to the SEEDS object. Currently safe because bonding curve admin ops are deploy-only. -- Scripts only, not in app/

## Novel Attack Surface

- **Cluster config poisoning via env var**: If an attacker can influence the `NEXT_PUBLIC_CLUSTER` environment variable (e.g., via a malicious `.env` file committed to the repo, or a CI/CD misconfiguration), they could force the frontend to resolve all addresses to a different cluster's set. Since program IDs differ between clusters, transactions built with wrong IDs would fail on-chain. However, if an attacker deployed malicious programs at those IDs on the target cluster, they could potentially intercept transactions. This is a defense-in-depth concern -- the env var is build-time in Next.js, so it's baked into the bundle and not runtime-configurable.

- **Pre-computed address table as single point of failure**: The Address Lookup Table (ALT) address is also pre-computed and cached. If the ALT is deactivated or replaced, the cached version in `multi-hop-builder.ts` (module-level `cachedALT`) would serve stale data until the Next.js process restarts. This affects v0 transactions (sell path, multi-hop) but not legacy transactions.

## Cross-Focus Handoffs

- --> **CHAIN-04 (Instruction Building)**: The account list construction in `swap-builders.ts` uses `.accountsStrict()` which requires exact account matching. If any PDA address is wrong, the on-chain constraint check catches it. Verify that all `.accountsStrict()` calls use the same address source as the on-chain expectations.
- --> **DATA-01 (Data Persistence)**: The protocol store (`protocol-store.ts`) caches account state keyed by pre-computed PDA addresses. If addresses change (post-deploy), stale cache keys would persist until process restart. The ws-subscriber uses these same addresses for batch fetching.
- --> **LOGIC-01 (Business Logic)**: The `resolvePool()` and `resolveRoute()` functions in `protocol-config.ts` / `shared/constants.ts` determine which pool addresses are used for swap routing. If pool configs are stale, the route engine would produce routes targeting non-existent pools.
- --> **ERR-01 (Slot Availability)**: The ws-subscriber silently skips PDAs that return `null` from `getMultipleAccountsInfo`. If a core PDA (EpochState) is unavailable, the protocol store never gets seeded, and SSE clients receive no data. No alarm is raised.
- --> **SEC-02 (Signature Verification)**: The `carnage-signer` PDA derivation in `fix-carnage-wsol.ts` cross-validates against the pda-manifest. This is the only script that performs runtime PDA verification. The pattern should be replicated for other critical PDAs.

## Trust Boundaries

The PDA interaction trust model relies on a three-layer architecture: (1) Pre-computed addresses in `shared/constants.ts` serve as the offline source of truth, generated from deployment artifacts by `generate-constants.ts`. (2) The on-chain programs enforce PDA constraints (`seeds`, `has_one`, `seeds::program`) which act as a safety net -- any off-chain PDA mismatch is caught at transaction execution time, causing the TX to fail rather than interact with wrong accounts. (3) The cluster config layer (`protocol-config.ts`) gates all address resolution behind a single env var (`NEXT_PUBLIC_CLUSTER`), ensuring the frontend cannot accidentally mix devnet and mainnet addresses. The critical trust boundary is between the pre-computed addresses and the on-chain state: if `generate-constants.ts` is not re-run after a program redeploy, the entire off-chain system operates with stale addresses, causing universal transaction failures. The on-chain constraints prevent fund loss in this scenario, but availability is compromised.
<!-- CONDENSED_SUMMARY_END -->

---

# CHAIN-06: Program Account & PDA Interaction -- Full Analysis

## Executive Summary

This analysis covers all off-chain PDA derivation, account construction, and program interaction patterns across the Dr. Fraudsworth codebase. The codebase uses a mature two-tier architecture: pre-computed PDA addresses for protocol singletons and runtime derivation for user-specific and per-transfer accounts. The primary risk is operational (address staleness after redeployment) rather than exploitable (on-chain constraints prevent wrong-account interactions). Eight observations are documented, ranging from consistency concerns to operational risk.

## Scope

**Files analyzed (13 total):**
- App-layer transaction builders: `swap-builders.ts`, `multi-hop-builder.ts`, `staking-builders.ts`, `curve-tx-builder.ts`
- Hook account resolvers: `hook-resolver.ts`, `hook-accounts.ts`
- Configuration: `protocol-config.ts`, `anchor.ts`, `shared/constants.ts`
- Server-side state: `ws-subscriber.ts`, `protocol-store.ts`
- Balance queries: `useTokenBalances.ts`
- Deploy scripts: `fix-carnage-wsol.ts`, `pda-manifest.ts`

**Out of scope:** On-chain Anchor programs (programs/ directory), UI components, test files.

## Key Mechanisms

### 1. Pre-Computed PDA Address System

The protocol uses `shared/constants.ts` as the canonical source for all protocol PDA addresses. These are organized into:

- `DEVNET_PDAS` (3 entries): EpochState, CarnageFund, CarnageSolVault
- `DEVNET_PDAS_EXTENDED` (6 more): SwapAuthority, TaxAuthority, StakePool, EscrowVault, StakeVault, WsolIntermediary
- `DEVNET_POOL_CONFIGS` (2 pools): CRIME_SOL, FRAUD_SOL (each with pool, vaultA, vaultB addresses)
- `DEVNET_CURVE_PDAS` (2 curves): crime, fraud (each with curveState, tokenVault, solVault, taxEscrow)
- Mainnet equivalents: `MAINNET_PDAS`, `MAINNET_PDAS_EXTENDED`, `MAINNET_POOL_CONFIGS`, `MAINNET_CURVE_PDAS`

These are generated by `scripts/deploy/generate-constants.ts` from `deployments/devnet.json` (or `mainnet.json`). The generation pipeline runs `pda-manifest.ts` which re-derives all PDAs from the deployed program IDs and verifies they match.

**Cluster-aware resolution**: `app/lib/protocol-config.ts` imports `getClusterConfig()` from shared, resolves based on `NEXT_PUBLIC_CLUSTER` env var, and re-exports all addresses. All app-layer code imports from `protocol-config.ts` rather than directly from `shared/constants.ts`.

### 2. Runtime PDA Derivation

Several PDAs are derived at transaction build time rather than pre-computed:

| PDA | Seeds | Program | Derivation Location |
|-----|-------|---------|-------------------|
| UserStake | `["user_stake", user_pubkey]` | Staking | `staking-builders.ts:122` |
| VaultConfig | `["vault_config"]` | Vault | `swap-builders.ts:151` |
| VaultTokenAccount | `[mintSeed, vaultConfig]` | Vault | `swap-builders.ts:155` |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | TransferHook | `hook-resolver.ts:54`, `hook-accounts.ts:44` |
| WhitelistEntry | `["whitelist", address]` | TransferHook | `hook-resolver.ts:60-66`, `hook-accounts.ts:50-56` |
| CurveState | `["curve", mint]` | BondingCurve | `curve-tx-builder.ts:35` |
| TokenVault (curve) | `["curve_token_vault", mint]` | BondingCurve | `curve-tx-builder.ts:42` |
| SolVault (curve) | `["curve_sol_vault", mint]` | BondingCurve | `curve-tx-builder.ts:49` |
| TaxEscrow | `["tax_escrow", mint]` | BondingCurve | `curve-tx-builder.ts:56` |
| CarnageSigner | `["carnage_signer"]` | EpochProgram | `fix-carnage-wsol.ts:52` |

**Key observation**: The curve-tx-builder derives ALL its PDAs at runtime from the Anchor `program.programId`, while swap-builders uses pre-computed addresses for pool/staking PDAs. This is a design difference: the bonding curve builder is designed to work with any program deployment (it takes the Program instance as a parameter), while the swap builder is tied to the current deployment's constants.

### 3. Transfer Hook Account Resolution

Two parallel hook resolvers exist:

**`resolveHookAccounts()` (swap/staking path):**
- Located at `app/lib/swap/hook-resolver.ts`
- Uses hardcoded strings: `Buffer.from("extra-account-metas")`, `Buffer.from("whitelist")`
- Sources hook program ID from `PROGRAM_IDS.TRANSFER_HOOK`
- Used by: `swap-builders.ts` (buy/sell/vault), `staking-builders.ts` (stake/unstake)

**`getCurveHookAccounts()` (bonding curve path):**
- Located at `app/lib/curve/hook-accounts.ts`
- Uses shared constants: `SEEDS.EXTRA_ACCOUNT_META`, `SEEDS.WHITELIST_ENTRY`
- Sources hook program ID from `PROGRAM_IDS.TRANSFER_HOOK`
- Used by: `curve-tx-builder.ts` (purchase/sell)

Both produce identical output for the same inputs. The divergence in seed sourcing is a consistency risk documented in findings.

### 4. Account Metadata (isSigner, isWritable)

All hook remaining_accounts are set to `{isSigner: false, isWritable: false}`. This is correct because:
- ExtraAccountMetaList is read-only (Token-2022 reads it to discover required accounts)
- Whitelist entries are read-only (existence check only)
- Hook program is invoked by Token-2022 via CPI, not directly by the transaction

The main transaction accounts use Anchor's `.accountsStrict()` which enforces the correct metadata from the IDL definition. No manual AccountMeta construction is needed for named accounts.

### 5. Anchor Program Instance Creation

`app/lib/anchor.ts` creates Program instances for all 7 programs using `withClusterAddress()` to override the IDL's embedded program address with the cluster-correct one from `protocol-config.ts`. This handles the IDL-cluster mismatch problem (IDL files may contain any cluster's IDs).

The `getAmmProgram()`, `getTaxProgram()`, etc. factory functions are used by:
- Transaction builders (to create instructions via `.methods.*()`)
- ws-subscriber (to decode account data via `.coder.accounts.decode()`)
- Webhook handler (to decode account data from Helius payloads)

## Trust Model

### Address Source Trust Chain

```
deployments/devnet.json
  |
  v
generate-constants.ts (derives PDAs, writes shared/constants.ts)
  |
  v
shared/constants.ts (pre-computed addresses, SEEDS, VAULT_SEEDS)
  |
  v
protocol-config.ts (cluster-aware re-export via NEXT_PUBLIC_CLUSTER)
  |
  v
Transaction builders (swap-builders, staking-builders, curve-tx-builder)
  |
  v
Anchor .accountsStrict() (compiles to AccountMeta list)
  |
  v
On-chain program constraints (seeds, has_one, program_id checks)
```

**Trust boundary 1**: `generate-constants.ts` -> `shared/constants.ts`. If the generator produces wrong addresses, everything downstream is wrong. Mitigated by on-chain constraints catching mismatches at TX execution time.

**Trust boundary 2**: `NEXT_PUBLIC_CLUSTER` env var -> `protocol-config.ts`. If the env var is wrong, all addresses resolve to the wrong cluster's set. Mitigated by the env var being baked into the Next.js build (not runtime-configurable in the browser).

**Trust boundary 3**: `protocol-config.ts` -> transaction builders. All builders trust that the imported addresses are correct for the current cluster. No runtime verification.

### On-Chain Safety Net

Solana's account model provides a strong safety net for PDA mismatches:
- Anchor's `#[account]` constraints verify PDA seeds at instruction execution time
- `seeds::program` constraints verify the correct deriving program
- `has_one` constraints verify account relationships
- Account owner checks verify the correct program owns each account
- If any off-chain PDA is wrong, the transaction fails with a constraint violation error

This means PDA mismatches cause denial-of-service (failed transactions) rather than fund loss. The exception would be if an attacker could substitute a different account that passes all constraints -- but for PDA-based accounts, this is cryptographically infeasible.

## State Analysis

### Pre-Computed Address Caching

- Module-level caches: `multi-hop-builder.ts` caches the ALT (`cachedALT`) at module level
- Protocol store: `protocol-store.ts` caches decoded account state keyed by PDA address strings
- No invalidation mechanism: Cached addresses persist until Node.js process restart
- Implication: After a program redeploy, the Next.js server must be restarted to pick up new addresses (they're compile-time constants in the bundle)

### Seed Constant Locations

| Seed Set | Location | Used By |
|----------|----------|---------|
| SEEDS | `shared/constants.ts:81-118` | staking-builders, curve-tx-builder, hook-accounts |
| VAULT_SEEDS | `shared/constants.ts:64-69` | swap-builders |
| Hardcoded strings | `hook-resolver.ts:54-66` | hook-resolver |
| Hardcoded strings | `fix-carnage-wsol.ts:53` | deploy script |
| Local constants | `pda-manifest.ts:20-55` | deploy script (duplicates SEEDS) |

**Observation**: `pda-manifest.ts` defines its own local seed constants that duplicate the shared SEEDS. This is a potential drift source, though it's only used during deployment.

## Dependencies

### External: Solana Web3.js
- `PublicKey.findProgramAddressSync()` -- Core PDA derivation. Deterministic, no network call.
- `getAssociatedTokenAddress()` / `getAssociatedTokenAddressSync()` -- ATA derivation. Deterministic.
- `Connection.getMultipleAccountsInfo()` -- Batch account fetching in ws-subscriber.

### External: Anchor
- `Program.methods.*().accountsStrict()` -- Account list compilation from IDL.
- `Program.coder.accounts.decode()` -- Account data deserialization.
- `withClusterAddress()` -- IDL program ID override.

### Internal: shared/constants.ts
- All PDA addresses, seed constants, program IDs, mint addresses flow from this file.
- Generated by `generate-constants.ts` from deployment artifacts.

## Focus-Specific Analysis

### PDA Derivation Correctness

**All runtime derivations verified against on-chain seed expectations:**

| PDA | Off-Chain Seeds | Expected On-Chain Seeds | Match? |
|-----|----------------|------------------------|--------|
| UserStake | `[SEEDS.USER_STAKE, user.toBuffer()]` | `[b"user_stake", user.key()]` | YES |
| VaultConfig | `[VAULT_SEEDS.CONFIG]` | `[b"vault_config"]` | YES |
| VaultToken | `[mintSeed, vaultConfig.toBuffer()]` | `[vault_seed, vault_config.key()]` | YES |
| ExtraAccountMeta | `["extra-account-metas", mint.toBuffer()]` | `[b"extra-account-metas", mint.key()]` | YES |
| WhitelistEntry | `["whitelist", address.toBuffer()]` | `[b"whitelist", address.key()]` | YES |
| CurveState | `[SEEDS.CURVE, mint.toBuffer()]` | `[b"curve", token_mint.key()]` | YES |
| CurveTokenVault | `[SEEDS.CURVE_TOKEN_VAULT, mint.toBuffer()]` | `[b"curve_token_vault", token_mint.key()]` | YES |
| CurveSolVault | `[SEEDS.CURVE_SOL_VAULT, mint.toBuffer()]` | `[b"curve_sol_vault", token_mint.key()]` | YES |
| TaxEscrow | `[SEEDS.TAX_ESCROW, mint.toBuffer()]` | `[b"tax_escrow", token_mint.key()]` | YES |
| CarnageSigner | `["carnage_signer"]` | `[b"carnage_signer"]` | YES |

All seeds are UTF-8 string buffers (no numeric encoding). No `toArrayLike("le")` patterns needed. This avoids the AIP-060 pitfall entirely.

### SwapAuthority PDA Derivation Program

**Critical**: The SwapAuthority PDA is derived from the **Tax Program**, not the AMM. This is correct per MEMORY.md and the architecture document (Section 2, Trust Tier 1). The AMM validates it with `seeds::program = TAX_PROGRAM_ID`.

In the app layer, SwapAuthority is consumed as a pre-computed address (`DEVNET_PDAS_EXTENDED.SwapAuthority`). In E2E scripts, it's derived at runtime from the Tax Program ID:
```
const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("swap_authority")],
  taxProgramId  // NOT ammProgramId
);
```
This matches the on-chain expectation. The pre-computed address in `shared/constants.ts` is generated by `pda-manifest.ts` which also uses the Tax Program ID.

### Hook Account Direction Correctness

Verified all transfer hook resolution calls for correct source/dest direction:

| Operation | Source (sends tokens) | Dest (receives tokens) | Correct? |
|-----------|----------------------|----------------------|----------|
| SOL Buy | poolConfig.vaultB | userTokenB | YES (pool -> user) |
| SOL Sell | userTokenB | poolConfig.vaultB | YES (user -> pool) |
| Vault Convert (input) | userInputAccount | vaultInput | YES (user -> vault) |
| Vault Convert (output) | vaultOutput | userOutputAccount | YES (vault -> user) |
| Stake | userProfitAta | StakeVault | YES (user -> vault) |
| Unstake | StakeVault | userProfitAta | YES (vault -> user) |
| BC Purchase | tokenVault | userTokenAccount | YES (vault -> user) |
| BC Sell | userTokenAccount | tokenVault | YES (user -> vault) |

All directions are correct. The comments in each builder explicitly document the direction, which is a good practice.

### Remaining Accounts Layout

For vault convert (dual-token transfer): `[inputHooks(4), outputHooks(4)]` -- matches on-chain AMM pattern per MEMORY.md (dual-hook ordering).

For single-token operations (buy, sell, stake, unstake): `[hooks(4)]` -- single set.

For bonding curve claim_refund: No remaining_accounts (burn doesn't trigger hooks).

### Cluster Config Resolution

`protocol-config.ts` resolves addresses via:
```typescript
const rawCluster = process.env.NEXT_PUBLIC_CLUSTER || "devnet";
const clusterName = rawCluster === "mainnet" ? "mainnet-beta" : rawCluster;
const config = getClusterConfig(clusterName);
```

**Observations:**
1. Default is "devnet" -- safe fallback (won't accidentally target mainnet)
2. "mainnet" maps to "mainnet-beta" -- handles common user input
3. Any other value (e.g., "testnet", "localnet", "DEVNET") would fail in `getClusterConfig()` since `CLUSTER_CONFIG` only has "devnet" and "mainnet-beta" keys. Per MEMORY.md, env var casing matters -- Railway values may be uppercase, but `protocol-config.ts` does handle the "mainnet" -> "mainnet-beta" mapping.

### ws-subscriber Account Batch Fetching

The ws-subscriber uses pre-computed addresses for its BATCH_ACCOUNTS array:
- `DEVNET_PDAS.EpochState`, `DEVNET_PDAS.CarnageFund`, `DEVNET_PDAS.CarnageSolVault`
- `DEVNET_POOLS.CRIME_SOL.pool`, `DEVNET_POOLS.FRAUD_SOL.pool`
- `DEVNET_CURVE_PDAS.crime.curveState`, `DEVNET_CURVE_PDAS.fraud.curveState`
- `DEVNET_PDAS_EXTENDED.StakePool`

These are imported from `protocol-config.ts` so they're cluster-aware. The batch seed function calls `getMultipleAccountsInfo()` and decodes each account using the mapped Anchor program. If any account returns `null`, it's silently skipped. No error is raised if a critical PDA (like EpochState) is missing.

## Cross-Focus Intersections

### CHAIN-01 (Slot/RPC)
The ws-subscriber's batch seed uses `getMultipleAccountsInfo()` without specifying commitment level, defaulting to the connection's configured commitment. If the connection is configured for "processed", batch-seeded account data could be rolled back.

### CHAIN-02 (Accounts & State)
The protocol store caches decoded account data keyed by PDA address. If two different clusters' PDAs happen to have the same base58 representation (astronomically unlikely but theoretically possible), they would collide in the cache. More practically, if the cluster config changes at runtime (which it can't in production since it's build-time), stale cache entries from the old cluster would persist.

### CHAIN-04 (Instruction Building)
All `.accountsStrict()` calls are verified to match the on-chain struct expectations. The Anchor SDK enforces that all accounts in the struct are provided. Missing accounts cause a client-side error before the transaction is even submitted.

### LOGIC-01 (Business Logic)
The `resolvePool()` function in protocol-config.ts delegates to shared constants' `resolvePoolWithConfig()`. If pool configs contain wrong addresses (e.g., vaultA/vaultB swapped), the transaction would fail on-chain due to PDA constraints on the vault accounts.

## Cross-Reference Handoffs

| Target Auditor | Item | Context |
|----------------|------|---------|
| CHAIN-04 | Verify `.accountsStrict()` usage across all builders | Ensure no accounts are accidentally omitted or misordered |
| DATA-01 | Protocol store cache invalidation on cluster change | Stale cache keys if deployment changes addresses |
| LOGIC-01 | Pool config vaultA/vaultB ordering | Canonical mint ordering (MEMORY.md Phase 52.1) affects which mint is A vs B |
| ERR-01 | ws-subscriber silent skip of null PDAs | Missing EpochState would break protocol state feed |
| SEC-02 | fix-carnage-wsol.ts PDA verification pattern | Should be replicated for other critical deploy operations |

## Risk Observations

### R1: Pre-computed Address Staleness (HIGH for mainnet launch)
**File**: `shared/constants.ts:188-406`
**Why risky**: ~30 hardcoded PDA addresses must be regenerated after every program redeploy. Forgetting `generate-constants.ts` causes all transactions to fail. On mainnet launch day, this is a single point of failure for availability.
**Mitigation**: Deploy pipeline (`deploy-all.sh`) includes constant regeneration. But manual deploys (e.g., hotfixes) could skip it.
**Recommendation**: Add a startup health check that re-derives a few critical PDAs (EpochState, StakePool) from program IDs and compares against pre-computed values. Alarm if mismatch.

### R2: Duplicate Hook Resolver with Divergent Seed Source (MEDIUM)
**File**: `app/lib/swap/hook-resolver.ts:54-67`
**Why risky**: Uses hardcoded strings instead of shared SEEDS constants. If a hook seed changes, only one resolver updates.
**Recommendation**: Refactor hook-resolver.ts to import SEEDS from `@dr-fraudsworth/shared` like hook-accounts.ts does.

### R3: No Runtime Cluster Validation (MEDIUM)
**File**: `app/lib/protocol-config.ts:25-27`
**Why risky**: Unset or misspelled NEXT_PUBLIC_CLUSTER silently defaults to devnet. On Railway mainnet deployment, missing env var = all user transactions fail.
**Recommendation**: Add a build-time or startup validation that logs a clear error if NEXT_PUBLIC_CLUSTER is not explicitly set.

### R4: WSOL_INTERMEDIARY Seed Missing from SEEDS (MEDIUM)
**File**: `shared/constants.ts:81-118`
**Why risky**: The `wsol_intermediary` seed is only defined locally in `pda-manifest.ts`. Any new code needing this PDA must hardcode the string.
**Recommendation**: Add `WSOL_INTERMEDIARY: Buffer.from("wsol_intermediary")` to the SEEDS object.

### R5: ws-subscriber Silent Skip on Missing PDAs (MEDIUM)
**File**: `app/lib/ws-subscriber.ts:127-165`
**Why risky**: If EpochState returns null from `getMultipleAccountsInfo`, the subscriber silently skips it. The protocol store never gets seeded with epoch data, causing the frontend to show stale/missing epoch info without any error.
**Recommendation**: Track how many accounts were successfully seeded vs expected. Log a warning if critical accounts (EpochState, StakePool) are missing.

### R6: allowOwnerOffCurve Inconsistency (LOW)
**File**: `app/lib/curve/curve-tx-builder.ts:67` vs `app/lib/swap/swap-builders.ts:124`
**Why risky**: Bonding curve allows PDA-owned ATAs, swap builders don't. Unlikely to cause issues in practice (users are EOAs), but creates inconsistent behavior for programmatic callers.
**Recommendation**: Document the intentional difference or standardize to `false` for all user-facing operations.

### R7: pda-manifest.ts Duplicates SEEDS (LOW)
**File**: `scripts/deploy/lib/pda-manifest.ts:20-55`
**Why risky**: Local seed constants in pda-manifest duplicate shared SEEDS. If one is updated and the other isn't, generated constants could be wrong.
**Recommendation**: Import SEEDS from shared instead of defining local constants.

### R8: Module-Level ALT Cache Without Invalidation (LOW)
**File**: `app/lib/swap/multi-hop-builder.ts:261-277`
**Why risky**: `cachedALT` is a module-level variable that persists for the lifetime of the Node.js process. If the ALT is extended (new addresses added), the cached version won't include them until restart.
**Recommendation**: Add a TTL or invalidation mechanism. Alternatively, document that ALT changes require server restart.

## Novel Attack Surface Observations

1. **Cluster config as build artifact attack surface**: Since `NEXT_PUBLIC_CLUSTER` is a build-time env var in Next.js, it's embedded in the JavaScript bundle served to users. An attacker inspecting the bundle can determine which cluster the frontend targets. Combined with the full address set in the bundle (all PDA addresses, program IDs, etc.), this gives attackers a complete map of the protocol's on-chain footprint. This is information disclosure but not exploitable beyond what's already public on-chain.

2. **Address Lookup Table deactivation DoS**: If an attacker could somehow deactivate the protocol's ALT (which requires the ALT authority's signature), all v0 transactions (sell path, multi-hop) would fail. The cached ALT in multi-hop-builder.ts would still try to use the deactivated table. Legacy transactions (buy path, simple swaps) would be unaffected.

3. **Seed constant drift across audit boundaries**: The SEEDS object and VAULT_SEEDS object are manually synced with on-chain `constants.rs`. There is no compile-time or CI/CD check that verifies byte-for-byte equivalence. If a Rust program changes a seed string (e.g., from `"whitelist"` to `"wl"`), the off-chain code would continue deriving PDAs with the old seed, causing all token transfers to fail (wrong ExtraAccountMetaList / whitelist entry addresses).

## Questions for Other Focus Areas

1. **For CHAIN-04**: Does `buildStepTransaction()` in `multi-hop-builder.ts` correctly pass `minimumOutput` through to each step's builder? The slippage is applied per-step based on the route's overall slippage, but intermediate steps' outputs feed the next step's input. In an atomic transaction this is safe, but verify the math.

2. **For ERR-02**: What happens when `connection.getAccountInfo()` calls in the swap builders return null for user ATAs? The builders handle this by creating the ATA, but if the RPC itself fails (connection error), the error propagation path should be traced.

3. **For LOGIC-01**: The vault conversion builder derives vaultConfig at runtime but the swap builders use pre-computed pool addresses. Is there a reason the swap builders don't also derive pool addresses at runtime? (Answer: pools have compound seeds `["pool", mint_a, mint_b]` that require knowing the canonical mint ordering, which is complex to compute client-side.)

4. **For DATA-01**: Are the pre-computed addresses in `shared/constants.ts` ever validated against the deployment artifacts (`deployments/devnet.json`) during CI/CD? Finding H084 from Audit #1 noted "constants drift" as NOT_FIXED.

## Raw Notes

- The codebase has excellent documentation. Every PDA derivation includes comments mapping to the on-chain source file and seed structure.
- The transfer hook direction (source/dest) is explicitly documented in every builder, reducing the risk of AIP-060-style errors.
- No numeric PDA seeds exist in this protocol -- all seeds are UTF-8 strings or pubkey buffers. This eliminates the most common PDA mismatch class (endianness errors).
- The `accountsStrict()` pattern (vs `accounts()`) is used consistently, which prevents silent account substitution.
- Curve-tx-builder takes `Program<BondingCurve>` as a parameter and derives all PDAs from `program.programId`. This is the most flexible pattern and would survive program redeployment without constant regeneration.
- The hook-resolver's approach of manual PDA derivation (vs spl-token's `createTransferCheckedWithTransferHookInstruction`) is well-justified -- avoids browser Buffer polyfill issues and eliminates an RPC round-trip. The trade-off is that any changes to the hook's extra account meta structure require manual updates to the resolver.
