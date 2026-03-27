# Jupiter DEX Integration Roadmap

Post-mainnet guide for getting Dr. Fraudsworth's AMM integrated into Jupiter's Iris routing engine.

## What This Means

When integrated, any user swapping on Jupiter (jup.ag) can be routed through our pools. Jupiter's router picks the best price across all integrated DEXes — if our pool offers the best rate, the swap flows through us. This gives our tokens massive discoverability without users needing to visit our frontend directly.

## Prerequisites (Jupiter's 4 Criteria)

Jupiter evaluates DEX applications on four dimensions. Here's where we stand and what we need:

### 1. Code Quality
**Status**: Strong foundation
- Clean Anchor/Rust codebase with CEI ordering
- Proptest property-based testing (10,000 iterations)
- Pure math module separated from instruction logic
- Reentrancy guards, k-invariant verification

**Action**: Keep it clean. Jupiter will fork our SDK — they need to maintain it.

### 2. Security Audit
**Status**: Not yet audited
- Jupiter requires a third-party security audit before integration
- This protects Jupiter users' funds routed through our pools

**Action**: Budget for an audit firm (OtterSec, Sec3, Neodyme, Trail of Bits are well-regarded in Solana). Do this post-mainnet once the protocol is stable. Typical Solana audit: 2-6 weeks, $30k-$150k+ depending on scope.

### 3. Market Traction
**Status**: Pre-launch
- Jupiter wants to see genuine adoption and user activity
- They're looking for real demand, not bot volume

**Action**: Build organic volume on mainnet first. Run for a few weeks/months before applying.

### 4. Team Credibility
**Status**: Pseudonymous project
- Established/verifiable teams strengthen applications
- Not a hard blocker but helps

**Action**: Build reputation through transparent operations, open-source code, community engagement.

## The Technical Integration: `jupiter-amm-interface`

This is the core work. We implement a Rust crate that tells Jupiter's routing engine how to quote and execute swaps through our AMM.

### Required Trait Methods

Our implementation must satisfy the `Amm` trait from the `jupiter-amm-interface` crate:

| Method | What It Does | Our Implementation |
|--------|-------------|-------------------|
| `from_keyed_account` | Deserialize a `PoolState` from on-chain account data | Parse our 232-byte PoolState struct |
| `label` | Return DEX name | `"Dr. Fraudsworth"` |
| `program_id` | Return AMM program ID | Our deployed AMM program pubkey |
| `key` | Return the pool's account address | Pool PDA address |
| `get_reserve_mints` | Return both mint addresses | `[pool.mint_a, pool.mint_b]` |
| `get_accounts_to_update` | Return accounts Jupiter should fetch | Pool account + vault accounts |
| `update` | Update local state from fetched account data | Refresh reserves from vault balances |
| `quote` | Calculate swap output for a given input | Call our `calculate_effective_input` + `calculate_swap_output` |
| `get_swap_and_account_metas` | Return the instruction + accounts for executing the swap | Build our `SwapSolPool` instruction |

### Critical Constraint: No Network Calls

Jupiter's integration **prohibits any network calls** in the implementation. All data comes from pre-fetched accounts that Jupiter batches and caches. This is why `get_accounts_to_update` exists — you tell Jupiter what to fetch, then `update` receives the data.

Our math module is already pure (no Solana runtime deps), so this maps cleanly.

### Transfer Hooks Consideration

Our tokens use Token-2022 transfer hooks. This adds complexity to the Jupiter integration:

- The `get_swap_and_account_metas` method must include all extra accounts required by the transfer hook
- Jupiter needs to know about the hook's `extra_account_meta_list` PDA and whitelist accounts
- Our `HOOK_ACCOUNTS_PER_MINT = 4` extra accounts per transfer must be included

This is unusual for Jupiter-integrated DEXes. We should test thoroughly and may need to discuss with the Jupiter team whether their execution engine handles Token-2022 hooks correctly in the routing path.

### Tax Program CPI

Our swaps involve CPI to the Tax Program (not just a simple token transfer). The Jupiter integration needs to either:
1. Include the tax CPI accounts in `get_swap_and_account_metas` — Jupiter executes the full flow
2. Or ensure the tax is handled transparently at the token transfer level (via transfer hook)

Since our transfer hooks handle taxation, option 2 is likely cleaner — Jupiter just does a normal swap and the hooks handle the rest.

## Implementation Steps (Post-Mainnet)

### Phase 1: Preparation (While Building Traction)
1. Fork Jupiter's reference implementation: `github.com/jup-ag/rust-amm-implementation`
2. Study the SPL Token Swap example at `jupiter-core/src/amms/spl_token_swap_amm.rs`
3. Create a new crate: `fraudsworth-jupiter-adapter` (or similar)
4. Implement the `Amm` trait for our `PoolState`

### Phase 2: Local Testing
1. Add our AMM to `PROGRAM_ID_TO_AMM_LABEL_WITH_AMM_FROM_KEYED_ACCOUNT`
2. Run `cargo test` against snapshot data from our mainnet pools
3. Snapshot creation: `cargo run -r -- --rpc-url <RPC-URL> snapshot-amm --amm-id <POOL-ADDRESS>`
4. Verify quotes match our own math exactly

### Phase 3: Audit
1. Get security audit completed
2. Fix any findings
3. Document the audit results

### Phase 4: Application
1. Reach out to Jupiter team (Discord or application form)
2. Provide:
   - Link to our fork with the Amm trait implementation
   - Audit report
   - Mainnet program addresses
   - Pool addresses with meaningful liquidity
   - Volume/traction metrics
3. Jupiter reviews code quality, runs their own tests
4. If accepted, our pools appear in Jupiter routing

## Market Listing (After DEX Integration)

Once our AMM is integrated into Jupiter's Iris router, our pools become eligible for market listing. Jupiter checks liquidity every 30 minutes:

- **Instant routing**: Tokens < 30 days old on integrated DEXes get auto-listed
- **Normal routing**: Must satisfy:
  - < 30% loss on $500 round-trip swap, OR
  - < 20% price impact comparing $1k vs $500 trade

Note: Our tokens use Token-2022 transfer hooks with custom tax logic. They cannot be listed on external DEXes (Raydium, Meteora, etc.) because those pools would either reject the hooks or bypass the tax system entirely. Full Jupiter DEX integration is the only path — there is no interim shortcut.

## Timeline Estimate

| Milestone | Rough Timing |
|-----------|-------------|
| Mainnet launch | TBD |
| Build organic traction | 1-3 months post-launch |
| Begin adapter implementation | Can start anytime |
| Security audit | 2-6 weeks (schedule early, firms have backlogs) |
| Submit application | After audit + traction evidence |
| Jupiter review + integration | 2-4 weeks (depends on Jupiter team) |

## Key Resources

- Reference implementation: https://github.com/jup-ag/rust-amm-implementation
- `jupiter-amm-interface` crate (on crates.io)
- Jupiter Discord for integration support
- Jupiter docs: https://dev.jup.ag/docs/routing/dex-integration
- Integration is FREE — Jupiter does not charge fees

## Open Questions for Jupiter Team (When We Apply)

1. Does your execution engine handle Token-2022 transfer hooks in the routing path?
2. How do you handle extra accounts from transfer hooks in `get_swap_and_account_metas`?
3. Are there any special considerations for mixed pools (SPL Token + Token-2022)?
4. What volume/traction thresholds are you looking for in practice?
