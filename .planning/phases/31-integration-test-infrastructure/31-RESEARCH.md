# Phase 31: Integration Test Infrastructure - Research

**Researched:** 2026-02-10
**Domain:** Solana multi-program integration testing (Anchor + Token-2022 + CPI chains)
**Confidence:** HIGH

## Summary

This phase requires loading all 5 programs (AMM, Transfer Hook, Tax, Epoch, Staking) into a single test environment, initializing the full protocol state, and running smoke tests proving both major CPI paths work. No new on-chain code is needed -- this is purely test infrastructure.

The codebase already has two testing approaches: **TypeScript tests** (via `anchor test` with `solana-test-validator`) for the Staking/TransferHook integration, and **Rust LiteSVM tests** for per-program CPI testing of AMM and Tax. The TypeScript tests already use `anchor.workspace.*` to access programs and `AnchorProvider.env()` for connection management. The LiteSVM tests manually load `.so` files and construct raw instructions.

The key recommendation is to use **TypeScript + `anchor test`** (solana-test-validator) for integration tests. This is the path of least resistance: `anchor test` automatically deploys all workspace programs as upgradeable BPF programs (critical for AMM's `initialize_admin` which requires ProgramData), the existing TS test patterns handle Token-2022 transfer hooks via `createTransferCheckedWithTransferHookInstruction`, and we already have a working `init-localnet.ts` script that demonstrates the full initialization sequence for staking + hook. LiteSVM would require enormous boilerplate to replicate Token-2022 transfer hook resolution and manual upgradeable program deployment for every program.

**Primary recommendation:** Use TypeScript + `anchor test` with `solana-test-validator`, building on the existing `init-localnet.ts` pattern as a reusable protocol initialization helper.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@coral-xyz/anchor` | ^0.32.1 | Program interaction, IDL types, workspace | Already used in all TS tests; `anchor.workspace.*` auto-loads all programs |
| `@solana/web3.js` | ^1.95.5 | Connection, keypair management, transactions | Already used everywhere |
| `@solana/spl-token` | ^0.4.9 | Token-2022 mint creation, transfer hook resolution | Already used; provides `createTransferCheckedWithTransferHookInstruction` |
| `ts-mocha` | ^10.0.0 | Test runner | Already configured in `Anchor.toml` scripts |
| `chai` | ^4.3.10 | Assertions | Already used in all TS tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `solana-test-validator` | CLI | Local validator for integration tests | Launched automatically by `anchor test` |
| `tsx` | ^4.21.0 | TypeScript execution for scripts | Already used for `verify-ids` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `solana-test-validator` (via `anchor test`) | LiteSVM (Rust) | LiteSVM is faster but requires manual upgradeable program deployment, raw instruction serialization, and cannot use `createTransferCheckedWithTransferHookInstruction` for hook account resolution. The boilerplate cost for 5 programs + Token-2022 hooks is prohibitive. |
| `solana-test-validator` | bankrun | bankrun uses `solana-program-test` under the hood. Not currently in the project dependencies. Would require learning a new framework. No advantage over `anchor test` for this use case. |

**Installation:** No new packages needed. Everything is already in `package.json`.

## Architecture Patterns

### Recommended Project Structure
```
tests/
├── staking.ts                    # Existing: per-program tests (keep separate)
├── cross-program-integration.ts  # Existing: per-program tests (keep separate)
├── token-flow.ts                 # Existing: per-program tests (keep separate)
├── security.ts                   # Existing: per-program tests (keep separate)
├── devnet-vrf.ts                 # Existing: devnet VRF tests
└── integration/
    ├── helpers/
    │   ├── protocol-init.ts      # Full protocol initialization helper
    │   ├── test-wallets.ts       # Role-based wallet creation
    │   └── constants.ts          # Shared seeds, program IDs, amounts
    └── smoke.test.ts             # Phase 31 smoke tests
```

### Pattern 1: Shared Protocol Initialization (before() hook)
**What:** Single `before()` block initializes the entire protocol state once for all tests in the file.
**When to use:** Integration tests where all programs must be initialized together.
**Why:** The PDA singleton pattern means StakePool, AdminConfig, EpochState can only be initialized once per validator. A shared `before()` avoids conflicts.

```typescript
// Source: Existing pattern from init-localnet.ts + token-flow.ts
describe("Integration Smoke Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // All 5 programs from anchor workspace
  const ammProgram = anchor.workspace.Amm as Program<Amm>;
  const hookProgram = anchor.workspace.TransferHook as Program<TransferHook>;
  const taxProgram = anchor.workspace.TaxProgram as Program<TaxProgram>;
  const epochProgram = anchor.workspace.EpochProgram as Program<EpochProgram>;
  const stakingProgram = anchor.workspace.Staking as Program<Staking>;

  before(async () => {
    // Full protocol init: mints, hook, pools, epoch, staking
    await initializeProtocol(provider, {
      ammProgram, hookProgram, taxProgram, epochProgram, stakingProgram
    });
  });

  it("SOL buy swap through full CPI chain", async () => { ... });
  it("Stake PROFIT tokens", async () => { ... });
});
```

### Pattern 2: Protocol Initialization Sequence
**What:** Ordered initialization matching production deployment flow.
**When to use:** Every integration test setup.
**Why:** Dependencies between programs create a strict ordering requirement.

The full initialization sequence (derived from `init-localnet.ts` + domain analysis):

```
Phase 1: Mints & Hook Foundation
  1. Create CRIME mint (Token-2022 with TransferHook extension -> hook program)
  2. Create FRAUD mint (Token-2022 with TransferHook extension -> hook program)
  3. Create PROFIT mint (Token-2022 with TransferHook extension -> hook program)
  4. Initialize Transfer Hook WhitelistAuthority
  5. Initialize ExtraAccountMetaList for each mint (CRIME, FRAUD, PROFIT)

Phase 2: AMM Infrastructure
  6. Initialize AMM AdminConfig (requires upgradeable deploy for ProgramData)
  7. Create admin WSOL + token accounts for seed liquidity
  8. Initialize CRIME/SOL pool (seed liquidity)
  9. Initialize FRAUD/SOL pool (seed liquidity)
  10. Initialize CRIME/PROFIT pool (seed liquidity)
  11. Initialize FRAUD/PROFIT pool (seed liquidity)
  12. Whitelist all pool vault addresses in Transfer Hook

Phase 3: Epoch + Staking
  13. Initialize EpochState (creates genesis tax config)
  14. Initialize StakePool (creates StakeVault, EscrowVault, dead stake)
  15. Whitelist StakeVault in Transfer Hook

Phase 4: Staking CPI Integration
  16. Initialize Carnage Fund (CarnageFundState, vaults)
  17. Whitelist Carnage vaults in Transfer Hook

Phase 5: Test Wallets
  18. Create trader wallet (SOL + all tokens)
  19. Create staker wallet (PROFIT for staking)
  20. Create authority wallet (protocol admin)
  21. Create attacker wallet (unauthorized caller)
```

### Pattern 3: Hook Account Resolution for Swaps
**What:** Resolve Transfer Hook ExtraAccountMetas before calling Tax Program swap instructions.
**When to use:** Any swap test involving Token-2022 tokens with hooks.
**Why:** Token-2022 transfer_checked requires ExtraAccountMetas passed as remaining_accounts. The Tax -> AMM CPI chain forwards these.

```typescript
// Source: Existing pattern from token-flow.ts and security.ts
const transferIx = await createTransferCheckedWithTransferHookInstruction(
  connection,
  userTokenAccount,    // source
  crimeMint,           // mint
  poolVaultB,          // destination
  user.publicKey,      // authority
  BigInt(amount),
  CRIME_DECIMALS,
  [],                  // multiSigners
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);

// Extract hook accounts (everything after first 4 keys)
const hookAccounts = transferIx.keys.slice(4).map((key) => ({
  pubkey: key.pubkey,
  isSigner: key.isSigner,
  isWritable: key.isWritable,
}));
```

### Pattern 4: Anchor Test Run Command Configuration
**What:** Separate `anchor test` scripts for unit vs integration tests.
**When to use:** To avoid PDA conflicts between test suites.
**Why:** StakePool is a singleton PDA. Existing staking.ts and token-flow.ts each init with different mints, so they MUST run in separate validator instances. Integration tests need their own validator instance too.

```toml
# Anchor.toml scripts section
[scripts]
test = "npx ts-mocha -p ./tsconfig.json -t 1000000 tests/staking.ts tests/cross-program-integration.ts"
test-security = "npx ts-mocha -p ./tsconfig.json -t 1000000 tests/security.ts"
test-integration = "npx ts-mocha -p ./tsconfig.json -t 1000000 tests/integration/**/*.test.ts"
```

### Anti-Patterns to Avoid
- **Mixing per-program tests with integration tests in the same validator**: StakePool singleton PDA means only one test suite can initialize it per validator. Keep them separate.
- **Hardcoding program IDs in test files**: Use `program.programId` from workspace, not string literals. The integration test must work with whatever IDs are in `Anchor.toml`.
- **Skipping Transfer Hook setup**: Even in tests, Token-2022 mints with TransferHook extension MUST have ExtraAccountMetaList initialized and whitelist entries created before any transfer_checked can succeed.
- **Using `anchor_spl::token_interface::transfer_checked` for Token-2022 with hooks**: This does NOT forward remaining_accounts for hooks. Must use manual `invoke_signed` with hook accounts (already established pattern in the codebase).
- **Initializing AdminConfig without upgradeable deploy**: AMM's `initialize_admin` requires ProgramData account with upgrade_authority matching the signer. `anchor test` handles this automatically via `--upgradeable-program`; LiteSVM requires manual setup.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transfer Hook account resolution | Manual PDA derivation for ExtraAccountMetas | `createTransferCheckedWithTransferHookInstruction` from `@solana/spl-token` | Resolves ExtraAccountMetas dynamically; handles all hook account ordering correctly |
| Mint creation with extensions | Raw SystemProgram + Token-2022 instructions | `createInitializeTransferHookInstruction` + `createInitializeMintInstruction` from `@solana/spl-token` | Extension sizing, ordering, and initialization are error-prone |
| Program workspace loading | Manual IDL parsing, program instantiation | `anchor.workspace.*` | Automatic IDL-based program instances with type safety |
| Test validator management | Manual `solana-test-validator` spawn | `anchor test` | Handles startup, program deployment, shutdown, port management |
| PDA derivation | Manual sha256 + find_program_address | `PublicKey.findProgramAddressSync` | Standard, verified, no risk of seed ordering bugs |

**Key insight:** The existing codebase already has battle-tested patterns for every component of protocol initialization. The init-localnet.ts script, token-flow.ts, and security.ts contain all the building blocks. The integration test's job is to compose them, not rebuild them.

## Common Pitfalls

### Pitfall 1: AMM initialize_admin Requires ProgramData
**What goes wrong:** AMM's `InitializeAdmin` accounts struct requires a `ProgramData` account with `upgrade_authority_address == signer`. If the program is deployed as non-upgradeable (the default for `--bpf-program`), there is no ProgramData account, and initialization fails.
**Why it happens:** `anchor test` deploys programs as upgradeable by default, but if you switch to LiteSVM or manual deployment, you must explicitly create ProgramData accounts.
**How to avoid:** Use `anchor test` which deploys as upgradeable. If custom deployment is needed, ensure `[test] upgradeable = true` in Anchor.toml.
**Warning signs:** "Error processing Instruction" on `initialize_admin` call.

### Pitfall 2: Mint Ordering for Pool PDA Derivation
**What goes wrong:** AMM pools require `mint_a < mint_b` (canonical ordering enforced by `MintsNotCanonicallyOrdered` error). If test mints are created in the wrong order, pool initialization fails.
**Why it happens:** Keypair.generate() creates random pubkeys. The canonical ordering check means you must sort mints before creating pools.
**How to avoid:** After creating mints, compare pubkeys and assign mint_a/mint_b accordingly: `const [mintA, mintB] = [mint1, mint2].sort((a, b) => a.toBuffer().compare(b.toBuffer()));`
**Warning signs:** `MintsNotCanonicallyOrdered` error on `initialize_pool`.

### Pitfall 3: PDA Singleton Conflicts Across Test Files
**What goes wrong:** StakePool, EpochState, and AdminConfig are all singleton PDAs (seeds = ["stake_pool"], ["epoch_state"], ["admin"]). If multiple test files run in the same validator, the first file initializes them and the second gets "account already in use" errors.
**Why it happens:** `anchor test` runs ALL test files in the `[scripts] test` command against ONE validator instance.
**How to avoid:** Integration tests must have their own `test-integration` script in Anchor.toml that runs in a separate validator instance. Existing per-program tests (staking.ts, token-flow.ts, security.ts) already follow this pattern -- they each have separate scripts.
**Warning signs:** "Account already in use" errors when running tests.

### Pitfall 4: Token-2022 Transfer Hook Requires Whitelist Before Any Transfer
**What goes wrong:** Any `transfer_checked` on a Token-2022 mint with TransferHook extension will invoke the hook program. If the whitelist entries aren't set up (source or dest not whitelisted), the hook rejects with `NoWhitelistedParty`.
**Why it happens:** The Transfer Hook enforces that at least one party is whitelisted. In testing, pool vaults and staking vaults must be whitelisted BEFORE any transfers involving those accounts.
**How to avoid:** Follow the initialization sequence strictly: create mints -> init hook authority -> init ExtraAccountMetaList -> create vaults -> whitelist vaults -> then do transfers.
**Warning signs:** `NoWhitelistedParty` error on first transfer_checked call.

### Pitfall 5: SOL Buy Swap Requires Full Account Graph
**What goes wrong:** The `swap_sol_buy` instruction on Tax Program requires ~20 accounts including EpochState (from Epoch Program), swap_authority PDA, tax_authority PDA, pool state, pool vaults, mints, user token accounts, staking escrow, carnage vault, treasury, and 4 program references. Missing any one causes constraint failures.
**Why it happens:** The swap CPI chain is Tax -> AMM -> Token-2022 -> Hook, with simultaneous tax distribution to staking/carnage/treasury. Each leg needs its own accounts.
**How to avoid:** Build a comprehensive `buildSwapSolBuyAccounts()` helper that derives ALL needed accounts from the protocol state. Reference the `SwapSolBuy` struct in `programs/tax-program/src/instructions/swap_sol_buy.rs` for the complete account list.
**Warning signs:** Constraint violation errors, "AccountNotFound" errors, seeds mismatch errors.

### Pitfall 6: WSOL Handling in SOL Pools
**What goes wrong:** SOL pools use wrapped SOL (WSOL) for Token A. Users need a WSOL token account with SOL pre-wrapped. Standard SPL Token, not Token-2022.
**Why it happens:** Native SOL cannot be used directly in token swaps. The AMM uses `spl_token::native_mint` (standard SPL Token, NOT Token-2022).
**How to avoid:** Create WSOL accounts using standard SPL Token program, sync native SOL into them using `syncNative`. The WSOL mint is `So11111111111111111111111111111111111111112`.
**Warning signs:** Token program mismatch errors, "incorrect program" errors on vault operations.

### Pitfall 7: CPI Depth 4 Limit on Carnage Path
**What goes wrong:** The Carnage execution path reaches exactly Solana's CPI depth limit: Epoch -> Tax -> AMM -> Token-2022 -> Hook (depth 4). Any additional CPI call in this chain causes `CallDepth` error.
**Why it happens:** Transfer hooks add an extra CPI level to every token transfer. The Carnage path has the deepest CPI nesting in the protocol.
**How to avoid:** This is a known constraint documented in PITFALLS.md. Phase 31 smoke tests should NOT test Carnage execution (deferred to Phase 32). The SOL buy swap smoke test only reaches depth 3 (Tax -> AMM -> Token-2022 -> Hook) which is fine.
**Warning signs:** `CallDepth` error in transaction logs.

## Code Examples

### Full Protocol Initialization Helper Skeleton

```typescript
// Source: Derived from init-localnet.ts + token-flow.ts + security.ts patterns
export interface ProtocolState {
  // Mints
  crimeMint: PublicKey;
  fraudMint: PublicKey;
  profitMint: PublicKey;

  // AMM
  adminConfig: PublicKey;
  crimeSolPool: PublicKey;
  fraudSolPool: PublicKey;
  crimeProfitPool: PublicKey;
  fraudProfitPool: PublicKey;

  // Vaults (per pool)
  poolVaults: Map<string, { vaultA: PublicKey; vaultB: PublicKey }>;

  // Hook
  whitelistAuthority: PublicKey;
  extraAccountMetaLists: Map<string, PublicKey>; // mint -> EAM PDA

  // Epoch
  epochState: PublicKey;

  // Staking
  stakePool: PublicKey;
  escrowVault: PublicKey;
  stakeVault: PublicKey;

  // Carnage
  carnageState: PublicKey;
  carnageSolVault: PublicKey;

  // Authority
  authority: Keypair;
}

export interface TestWallets {
  trader: { keypair: Keypair; tokenAccounts: Map<string, PublicKey> };
  staker: { keypair: Keypair; profitAccount: PublicKey };
  admin: { keypair: Keypair };
  attacker: { keypair: Keypair };
}
```

### Swap SOL Buy Account Assembly

```typescript
// Source: Derived from programs/tax-program/src/instructions/swap_sol_buy.rs
function buildSwapSolBuyAccounts(
  protocol: ProtocolState,
  user: PublicKey,
  userWsolAccount: PublicKey,
  userTokenAccount: PublicKey,
  isCrime: boolean,
) {
  const poolKey = isCrime ? protocol.crimeSolPool : protocol.fraudSolPool;
  const vaults = protocol.poolVaults.get(poolKey.toBase58());
  const mint = isCrime ? protocol.crimeMint : protocol.fraudMint;

  // Derive Tax Program PDAs
  const [swapAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_authority")], taxProgram.programId
  );
  const [taxAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("tax_authority")], taxProgram.programId
  );

  return {
    user,
    epochState: protocol.epochState,
    swapAuthority,
    taxAuthority,
    pool: poolKey,
    poolVaultA: vaults.vaultA,     // WSOL vault
    poolVaultB: vaults.vaultB,     // CRIME/FRAUD vault
    mintA: NATIVE_MINT,            // WSOL
    mintB: mint,                   // CRIME or FRAUD
    userTokenA: userWsolAccount,
    userTokenB: userTokenAccount,
    stakePool: protocol.stakePool,
    stakingEscrow: protocol.escrowVault,
    carnageVault: protocol.carnageSolVault,
    treasury: protocol.authority.publicKey, // Or separate treasury
    ammProgram: ammProgram.programId,
    tokenProgramA: TOKEN_PROGRAM_ID,       // SPL Token for WSOL
    tokenProgramB: TOKEN_2022_PROGRAM_ID,  // Token-2022 for CRIME/FRAUD
    systemProgram: SystemProgram.programId,
    stakingProgram: stakingProgram.programId,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `solana-program-test` (Rust) | LiteSVM (Rust) or `anchor test` (TS) | 2024-2025 | LiteSVM is 10-100x faster than solana-program-test; anchor test is standard for multi-program |
| Manual `.so` deployment in tests | `anchor.workspace.*` auto-loading | Anchor 0.28+ | Programs are automatically available in TS tests via workspace |
| Per-program test isolation only | Integration tests with full CPI chains | Standard practice | Essential for protocols with cross-program dependencies |

**Deprecated/outdated:**
- `solana-program-test`: Slower than LiteSVM, harder to set up. LiteSVM is the replacement.
- `bankrun`: Alternative to solana-program-test but not widely adopted in the Anchor ecosystem. Not in this project's deps.

## Discretion Recommendations

Based on the research, here are recommendations for the items left to Claude's discretion:

### Validator approach: `anchor test` (solana-test-validator)
**Rationale:** The existing TS tests already use this approach. It automatically deploys all 8 workspace programs as upgradeable (critical for AMM's initialize_admin). LiteSVM would require 500+ lines of boilerplate for upgradeable deployment + Token-2022 hook resolution that `@solana/spl-token` handles for free.

### Instance lifecycle: Shared per-file, fresh per `anchor test` run
**Rationale:** The PDA singleton pattern (StakePool, EpochState, AdminConfig) means we can only initialize once per validator. A shared `before()` hook initializes everything, then all tests in the file share that state. Each `anchor test` invocation starts a fresh validator.

### Existing test migration: Keep per-program tests separate
**Rationale:** Existing staking.ts, token-flow.ts, security.ts each create their own PROFIT mints and StakePool with different configurations. They cannot share a validator with integration tests. Keep them as-is with their own `anchor test` script entries.

### Test language: TypeScript
**Rationale:** All existing TS tests use `anchor.workspace.*`, `AnchorProvider.env()`, and `@solana/spl-token` for hook resolution. LiteSVM Rust tests require manual instruction serialization (anchor_discriminator + AnchorSerialize). The existing init-localnet.ts script is a direct prototype for the integration init helper.

### Init helper design: Reusable module in `tests/integration/helpers/`
**Rationale:** The `protocol-init.ts` helper can be imported by both integration tests AND (with minor adaptation) the Phase 33 deployment scripts. The helper should return a `ProtocolState` struct with all PDAs and account addresses.

### Test file location: `tests/integration/`
**Rationale:** Separating integration tests from per-program tests prevents accidental inclusion in the wrong `anchor test` script. The `tests/integration/helpers/` subdirectory houses shared utilities.

### Run command: `test-integration` script in Anchor.toml
**Rationale:** Must be a separate script from `test` to get its own validator instance (PDA singleton conflicts). Use `npx ts-mocha -p ./tsconfig.json -t 1000000 tests/integration/**/*.test.ts`.

### Timeout strategy: Generous timeout (1000000ms already set), no retries
**Rationale:** The existing tests already use `-t 1000000` (1000 seconds). CPI depth adds latency but is deterministic on solana-test-validator. Retries would mask real failures.

### Smoke test validation depth: Assert success + check key amounts
**Rationale:** Phase 31 is about proving infrastructure works. Check transaction success AND verify key state changes (e.g., pool reserves changed after swap, staked balance increased after stake). This catches silent failures.

### Epoch transition in smoke test: Defer to Phase 32
**Rationale:** Epoch transitions require VRF (Switchboard On-Demand), which adds complexity beyond Phase 31's scope. The genesis EpochState with fixed tax rates is sufficient for swap smoke tests.

### Failure diagnostics: Standard output with transaction logs on failure
**Rationale:** `anchor test` already captures transaction logs. Add `console.log` of transaction signature on test failure so logs can be inspected. No custom CPI diagnostic framework needed for Phase 31.

## Open Questions

1. **WSOL Token Account Management in Tests**
   - What we know: SOL pools use WSOL (native_mint) for Token A. Users need WSOL token accounts with pre-wrapped SOL. The `@solana/spl-token` `createWrappedNativeAccount` helper exists.
   - What's unclear: Whether `syncNative` must be called explicitly after SOL transfer, or if `createWrappedNativeAccount` handles it atomically.
   - Recommendation: Use `createWrappedNativeAccount` which creates account + wraps SOL atomically. Test this in the smoke test.

2. **AMM Pool Vault Whitelisting for All 4 Pools**
   - What we know: Each pool has vault_a and vault_b, so 4 pools = 8 vault accounts to whitelist. Plus staking vault + carnage vaults.
   - What's unclear: Whether the Transfer Hook's ExtraAccountMetaList must be initialized per mint before the pool using that mint is created, or if it can be done after.
   - Recommendation: Initialize ExtraAccountMetaList for ALL 3 mints in Phase 1 (before any pool creation). Then whitelist vaults as they are created.

3. **Existing AMM and Tax Test Failures**
   - What we know: From project context: "19 AMM swap test failures -- need swap_authority in test helpers" and "10 Tax Program SOL swap test failures -- AMM pool vault setup issue."
   - What's unclear: Whether these failures block integration test work or are independent.
   - Recommendation: Integration tests are independent of existing per-program test failures. The integration helper creates its own protocol state from scratch. These pre-existing failures should be fixed in Phase 31-32 but are not blockers for the integration test infrastructure task (INTEG-01).

## Sources

### Primary (HIGH confidence)
- Codebase analysis: 80+ files examined including all 5 program lib.rs, constants.rs, instruction files, existing test files, Cargo.toml, Anchor.toml, package.json
- `scripts/init-localnet.ts` -- working initialization script for staking + hook subsystem
- `tests/token-flow.ts`, `tests/security.ts` -- proven patterns for Transfer Hook ExtraAccountMeta resolution
- `tests/cross-program-integration.ts` -- existing CPI gating tests showing PDA verification patterns
- `programs/amm/tests/test_cpi_access_control.rs` -- LiteSVM multi-program loading pattern (AMM + MockTax + FakeTax)
- `programs/tax-program/tests/test_swap_sol_buy.rs` -- LiteSVM Tax+AMM CPI test with mock EpochState
- Anchor official docs (via MCP) -- Anchor.toml configuration for test.genesis, test.validator, upgradeable deployment
- Anchor testing docs (via MCP) -- LiteSVM usage patterns and program deployment

### Secondary (MEDIUM confidence)
- Anchor CLI reference (via MCP) -- `anchor test` behavior with solana-test-validator
- Solana Stack Exchange -- multi-program testing with `[[test.genesis]]` pattern
- `.planning/research/PITFALLS.md` -- documented pitfalls for CPI depth, cross-program ID consistency

### Tertiary (LOW confidence)
- None. All findings verified against codebase evidence.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use in the project
- Architecture: HIGH - Patterns directly derived from existing working code
- Pitfalls: HIGH - 6 of 7 pitfalls observed in existing test failures or documented in PITFALLS.md

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable -- no library upgrades expected)
