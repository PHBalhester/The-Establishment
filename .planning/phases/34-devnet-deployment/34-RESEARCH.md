# Phase 34: Devnet Deployment - Research

**Researched:** 2026-02-11
**Domain:** Solana devnet deployment, Token-2022, BPF program deployment
**Confidence:** HIGH

## Summary

Phase 34 deploys the 5 Dr. Fraudsworth programs to Solana devnet and initializes the full protocol state using the automated scripts built in Phase 33. No new program code is written -- this phase runs the existing deployment pipeline (`deploy-all.sh`) against a live devnet cluster using the Helius free tier RPC.

The deployment pipeline has been verified working on localnet (34/34 checks passed). The primary challenges for devnet are: (1) SOL cost management (program deployment is expensive), (2) Helius free tier rate limits (10 req/s, 1 sendTransaction/s), (3) the `solana program deploy` command sending hundreds of write-buffer transactions per program, and (4) the connection.ts currently uses `confirmed` commitment but CONTEXT.md specifies `finalized`.

**Primary recommendation:** Run `deploy-all.sh` with the Helius devnet RPC URL, but deploy programs one at a time (not via the orchestrator's build.sh `anchor build` then batch deploy) to manage rate limits. Use `--with-compute-unit-price` on `solana program deploy` for reliability. Budget ~15 SOL for program deployment rent + buffer overhead, plus ~55 SOL for pool liquidity. The user's 100+ SOL is sufficient.

## Standard Stack

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `solana program deploy` | CLI 2.x | Deploy .so files to deterministic addresses | Direct BPF loader interaction with `--program-id` flag ensures deterministic addresses matching `declare_id!` |
| Helius devnet RPC | Free tier | RPC endpoint for devnet | User's chosen provider; stored in `.env` as `HELIUS_API_KEY` |
| `@coral-xyz/anchor` | 0.32.x | TypeScript program interaction | Already used by initialize.ts and verify.ts |
| `@solana/spl-token` | Latest | Token-2022 mint/transfer operations | Already used by initialize.ts for T22 mint creation |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `solana program show` | Verify program deployment status | Post-deploy verification (already in deploy.sh) |
| `solana program show --buffers` | List orphaned buffer accounts | Recovery if deployment fails midway |
| `solana program close <buffer>` | Reclaim SOL from failed buffers | If deployment partially fails and buffers are left |
| `solana balance` | Check wallet SOL balance | Pre-flight check before deployment |
| Solana Explorer (devnet) | Visual verification | `https://explorer.solana.com/address/<ID>?cluster=devnet` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `solana program deploy` | `anchor deploy` | `anchor deploy` generates NEW keypairs each time; we need deterministic addresses from keypairs/ directory |
| Helius free tier | Public RPC `api.devnet.solana.com` | Public RPC has aggressive rate limits and no SLA; Helius free tier gives 10 req/s vs ~2 req/s on public |

## Architecture Patterns

### Recommended Deployment Flow

```
1. Pre-flight checks
   ├── Verify wallet balance (>15 SOL for programs + >55 SOL for pools)
   ├── Verify Helius RPC connectivity
   ├── Verify .env has HELIUS_API_KEY
   └── Verify programs are built (target/deploy/*.so exist)

2. Program deployment (deploy.sh)
   ├── Deploy amm.so          (~2.94 SOL rent)
   ├── Deploy epoch_program.so (~3.00 SOL rent)
   ├── Deploy staking.so      (~2.59 SOL rent)
   ├── Deploy tax_program.so   (~2.31 SOL rent)
   └── Deploy transfer_hook.so (~1.98 SOL rent)
   Total: ~12.82 SOL (returned if programs are closed later)
   Note: Buffer accounts temporarily double this during deploy

3. Protocol initialization (initialize.ts)
   ├── Create 3 T22 mints with TransferHook extension
   ├── Initialize WhitelistAuthority
   ├── Initialize 3 ExtraAccountMetaLists
   ├── Initialize AMM AdminConfig
   ├── Create admin token accounts + mint 1B each
   ├── Whitelist admin T22 accounts
   ├── Initialize 4 AMM pools with seed liquidity
   ├── Whitelist all pool vault addresses
   ├── Initialize EpochState
   ├── Initialize StakePool (with dead stake)
   ├── Whitelist StakeVault
   ├── Initialize Carnage Fund
   ├── Whitelist Carnage token vaults
   ├── Fund Carnage SOL vault (rent-exempt minimum)
   └── Generate PDA manifest

4. Post-deployment verification (verify.ts)
   └── 34 checks across 5 categories
```

### Pattern 1: Helius RPC URL Construction

**What:** Build the Helius devnet RPC URL from the API key in `.env`
**When to use:** Every script that connects to devnet

The Helius devnet endpoint format is:
```
https://devnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>
```

The `.env` file currently only has `SUPERMEMORY_CC_API_KEY`. It needs `HELIUS_API_KEY` added. The `CLUSTER_URL` env var should be set to the full Helius URL.

### Pattern 2: Deploy Script Invocation for Devnet

**What:** The deploy-all.sh orchestrator accepts the cluster URL as the first argument or via CLUSTER_URL env var.
**When to use:** Running the full deployment pipeline

```bash
# Option A: Pass as argument
CLUSTER_URL="https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" \
  ./scripts/deploy/deploy-all.sh

# Option B: Export env vars
export CLUSTER_URL="https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY"
export WALLET="keypairs/devnet-wallet.json"
./scripts/deploy/deploy-all.sh
```

### Pattern 3: Commitment Level Configuration

**What:** CONTEXT.md specifies `finalized` commitment for devnet, but connection.ts currently uses `confirmed`.
**When to use:** All devnet RPC interactions

The `loadProvider()` in `scripts/deploy/lib/connection.ts` currently creates connections with `confirmed` commitment. For devnet deployment with `finalized` commitment (as specified in CONTEXT.md), either:
1. Update connection.ts to accept a commitment parameter, or
2. Update the hardcoded commitment to `finalized` for devnet runs

Note: `finalized` is slower (~6.4 seconds per confirmation vs ~0.5 seconds for `confirmed`) but provides maximum certainty that transactions are permanently recorded. For a one-time deployment, the extra latency is acceptable.

### Pattern 4: Seed Liquidity Amounts for Devnet

**What:** The constants.ts file currently uses TEST defaults (10 SOL per pool, 10K tokens). CONTEXT.md specifies mainnet amounts (25 SOL per pool, 290M tokens).
**When to use:** Devnet initialization

Current test values in constants.ts:
- `SOL_POOL_SEED_SOL = 10 * LAMPORTS_PER_SOL` (10 SOL)
- `SOL_POOL_SEED_TOKEN = 10_000_000_000` (10K tokens at 6 decimals)
- `PROFIT_POOL_SEED_A = 10_000_000_000` (10K tokens)
- `PROFIT_POOL_SEED_B = 10_000_000_000` (10K tokens)

CONTEXT.md specifies:
- SOL pools: 290M tokens / 25 SOL each
- PROFIT pools: 250M CRIME or FRAUD / 25M PROFIT each

**This is a key decision point:** The initialize.ts imports these constants from `tests/integration/helpers/constants.ts`. To use mainnet amounts on devnet, we need a way to override them. Options:
1. Create devnet-specific constants and import conditionally
2. Use environment variables to override amounts
3. Create a devnet-specific initialize script
4. Modify constants.ts with the correct mainnet values (breaking test compatibility)

### Anti-Patterns to Avoid

- **Using `anchor deploy` instead of `solana program deploy`:** `anchor deploy` generates new keypairs. We must use `solana program deploy --program-id <keypair>` to deploy to deterministic addresses.
- **Ignoring buffer account cleanup:** If deployment fails midway, buffer accounts hold SOL hostage. Always check `solana program show --buffers` after failures.
- **Skipping pre-flight balance check:** Deploying 5 programs requires ~25 SOL in buffer overhead during deployment (refunded after). Insufficient SOL mid-deploy leaves orphaned buffers.
- **Running all programs through the public RPC:** The public `api.devnet.solana.com` has very aggressive rate limits. Use Helius for reliability.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Program deployment | Custom BPF upload logic | `solana program deploy` CLI | Handles buffer creation, chunked writes (~1232 bytes/tx), and deployment atomically |
| Buffer recovery | Manual account closing | `solana program close <buffer>` | Safely recovers rent SOL from failed deployments |
| Deployment verification | Custom account queries | verify.ts (already built) | 34 comprehensive checks across all protocol components |
| PDA manifest | Manual address derivation | pda-manifest.ts (already built) | Deterministic derivation from canonical constants |
| Idempotent init | Custom "already done" tracking | initialize.ts on-chain checks | Checks account existence before each step; safe to re-run |

**Key insight:** The Phase 33 scripts were purpose-built for exactly this deployment scenario. The work is in configuring them correctly for devnet (RPC URL, commitment level, pool amounts), not building new tooling.

## Common Pitfalls

### Pitfall 1: Helius Free Tier Rate Limiting (1 sendTransaction/s)

**What goes wrong:** `solana program deploy` sends hundreds of write-buffer transactions to upload a single .so file. At the Helius free tier limit of 1 sendTransaction/s, a 420KB program requires ~340 transactions (1232 bytes payload per tx), taking ~6 minutes per program. With 5 programs, that's ~30 minutes just for deployment writes. If rate-limited, transactions fail with "blockhash expired" errors.

**Why it happens:** Program deployment splits the .so file into chunks and writes each chunk in a separate transaction. The Solana CLI retries expired blockhashes, but aggressive rate limiting causes cascading failures.

**How to avoid:**
1. Use `--with-compute-unit-price 1` flag on `solana program deploy` to add minimal priority fee (helps transaction landing)
2. The deploy.sh script deploys sequentially (not in parallel), which naturally paces requests
3. If a program deployment fails with "blockhash expired", check `solana program show --buffers` to find the buffer account, then resume with `solana program deploy <.so> --buffer <buffer-address>`
4. Consider upgrading to Helius Developer tier ($49/mo) temporarily if free tier is too slow

**Warning signs:** "Blockahash expired. N retries remaining" messages during deployment

### Pitfall 2: Buffer Account SOL Lock-up

**What goes wrong:** During deployment, a buffer account is created with enough SOL to hold the entire program. If deployment fails (rate limit, network issue, insufficient SOL), the buffer account remains with SOL locked in it. The deployer's wallet balance drops without a successful deployment.

**Why it happens:** The deployment process is: (1) create buffer account (costs SOL), (2) write program data to buffer (~340 txs), (3) finalize deployment (atomic swap). Failure at step 2 leaves an orphaned buffer.

**How to avoid:**
- After any failed deployment, immediately run: `solana program show --buffers -k keypairs/devnet-wallet.json --url <HELIUS_URL>`
- Close orphaned buffers to reclaim SOL: `solana program close <buffer-address> -k keypairs/devnet-wallet.json --url <HELIUS_URL>`
- Budget for temporary double-allocation: during deploy, both buffer + program account hold SOL

**Warning signs:** Wallet balance drops significantly but `solana program show <program-id>` shows program not deployed

### Pitfall 3: Seed Liquidity Constant Mismatch

**What goes wrong:** initialize.ts imports pool amounts from `tests/integration/helpers/constants.ts` which has test values (10 SOL, 10K tokens). CONTEXT.md specifies mainnet values (25 SOL, 290M tokens). Deploying with test values means the devnet pools won't mirror mainnet pricing.

**Why it happens:** Constants were designed for integration tests, not production deployment. The deployment scripts correctly import from the canonical source, but the canonical source has test-appropriate values.

**How to avoid:** Either (a) create devnet-specific constants that override the test values, or (b) parametrize the amounts via environment variables. This needs to be resolved during planning -- it's a Claude's Discretion item.

**Warning signs:** Pool reserves showing 10B base units instead of expected 290T base units

### Pitfall 4: WSOL Account Creation on Devnet

**What goes wrong:** initialize.ts creates a fresh WSOL account each run using `createWrappedNativeAccount()`. On devnet, this wraps SOL from the wallet. With mainnet pool amounts (25 SOL per pool x 2 = 50 SOL), the wallet needs 55+ SOL just for WSOL wrapping (2 pools x 25 SOL + buffer).

**Why it happens:** WSOL accounts are funded by wrapping native SOL. The amount wrapping is `SOL_POOL_SEED_SOL * 2 + 5 * 1e9` (currently 25 SOL with 10 SOL pools, would be 55 SOL with 25 SOL pools).

**How to avoid:** Verify wallet balance covers: program deployment (~25 SOL temp, ~12.82 final) + WSOL wrapping (~55 SOL) + init tx fees (~0.1 SOL). Total needed: ~70 SOL minimum. User has 100+ SOL, which is sufficient.

**Warning signs:** "Authority balance too low" error in initialize.ts

### Pitfall 5: Devnet Network Instability

**What goes wrong:** Devnet occasionally experiences downtime, resets, or degraded performance. Transactions that succeed locally may timeout or fail on devnet due to network conditions.

**Why it happens:** Devnet is a public test network without mainnet's stability guarantees. The Solana Foundation occasionally resets devnet state.

**How to avoid:**
- Use `finalized` commitment (as specified in CONTEXT.md) for maximum certainty
- Build on Phase 33's idempotency: if initialization fails midway, re-run safely
- Check devnet status at https://status.solana.com before starting deployment
- Devnet slots are ~400ms (same as mainnet), but epochs may be shorter

**Warning signs:** RPC timeouts, "transaction was not confirmed in X seconds" errors

### Pitfall 6: deploy.sh Passes CLUSTER_URL but initialize.ts Reads from Process.env

**What goes wrong:** deploy.sh passes the cluster URL as a positional argument, but initialize.ts and verify.ts read `CLUSTER_URL` from `process.env`. If the env var isn't exported, initialize.ts defaults to `http://localhost:8899`.

**Why it happens:** Different scripts use different configuration patterns. deploy-all.sh exports `CLUSTER_URL` but needs to be verified that child processes inherit it.

**How to avoid:** deploy-all.sh already does `export CLUSTER_URL=...` which should propagate to child processes including `npx tsx scripts/deploy/initialize.ts`. Verify this works before the full deployment.

**Warning signs:** initialize.ts connects to localhost instead of devnet

## Code Examples

### Checking Wallet Balance Before Deployment

```bash
# Source: deploy.sh (already implemented)
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

HELIUS_URL="https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
WALLET="keypairs/devnet-wallet.json"

solana balance --url "$HELIUS_URL" --keypair "$WALLET"
# Expected: >70 SOL for full deployment
```

### Deploying a Single Program with Priority Fee

```bash
# If rate limiting is an issue, deploy with priority fee
solana program deploy \
  target/deploy/amm.so \
  --program-id keypairs/amm-keypair.json \
  --keypair keypairs/devnet-wallet.json \
  --url "$HELIUS_URL" \
  --with-compute-unit-price 1
```

### Recovering from Failed Deployment

```bash
# Check for orphaned buffer accounts
solana program show --buffers \
  --keypair keypairs/devnet-wallet.json \
  --url "$HELIUS_URL"

# Close a specific buffer to reclaim SOL
solana program close <BUFFER_ADDRESS> \
  --keypair keypairs/devnet-wallet.json \
  --url "$HELIUS_URL"
```

### Verifying a Deployed Program

```bash
# Check program is deployed and executable
solana program show <PROGRAM_ID> --url "$HELIUS_URL"

# Expected output includes:
# Program Id: <PROGRAM_ID>
# Owner: BPFLoaderUpgradeab1e11111111111111111111111
# Authority: 8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4
# Executable: true
```

### Viewing Deployment on Solana Explorer

```
# Programs
https://explorer.solana.com/address/zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa?cluster=devnet
https://explorer.solana.com/address/9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ?cluster=devnet
https://explorer.solana.com/address/FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu?cluster=devnet
https://explorer.solana.com/address/AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod?cluster=devnet
https://explorer.solana.com/address/Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi?cluster=devnet
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Programs allocated 2x .so file size | Programs allocated at exact .so file size | Solana CLI >1.18 (commit 5cb30cf) | Halves deployment rent cost |
| `anchor deploy` for Anchor programs | `solana program deploy --program-id` | Always preferred for deterministic addresses | Ensures declare_id! matches deployed address |
| Devnet airdrop for funding | Pre-funded wallet (user has 100+ SOL) | N/A | No airdrop rate limit concerns |

**Important note on program sizing:** In newer Solana CLI versions (>1.18), the program data account is allocated at the exact .so file size, NOT 2x as many older answers suggest. This was fixed in commit `5cb30cf`. Our rent calculations above reflect the actual .so file sizes. However, during deployment, a temporary buffer account is also created at the same size, so the wallet needs enough SOL for both program + buffer simultaneously (buffer is closed and SOL refunded upon successful deploy).

## SOL Budget Analysis

### Program Deployment Costs (rent-exempt minimum)

| Program | .so Size | Rent (SOL) |
|---------|----------|------------|
| amm.so | 421,936 bytes | 2.94 |
| epoch_program.so | 430,632 bytes | 3.00 |
| staking.so | 371,488 bytes | 2.59 |
| tax_program.so | 332,344 bytes | 2.31 |
| transfer_hook.so | 284,816 bytes | 1.98 |
| **Total** | | **12.82 SOL** |

Note: During deployment, buffer accounts temporarily double this to ~25.64 SOL. The buffer SOL is refunded upon successful deployment. If deployment fails, use `solana program close` to reclaim.

### Initialization Costs

| Item | SOL Cost |
|------|----------|
| WSOL wrapping (2 SOL pools x 25 SOL each + buffer) | ~55 SOL |
| Mint creation (3 mints, rent-exempt) | ~0.015 SOL |
| PDA creation (WhitelistAuthority, AdminConfig, EpochState, StakePool, etc.) | ~0.05 SOL |
| Token account creation (admin accounts, vaults) | ~0.1 SOL |
| Transaction fees (~32 init transactions) | ~0.005 SOL |
| Carnage SOL vault rent-exempt minimum | ~0.001 SOL |
| Dead stake (1 PROFIT token, no SOL cost) | 0 |
| **Total** | **~55.2 SOL** |

### Grand Total

| Category | SOL Required |
|----------|-------------|
| Program deployment (temporary) | ~25.64 |
| Program deployment (permanent) | ~12.82 |
| Initialization | ~55.2 |
| **Peak wallet requirement** | **~80.8 SOL** |
| **Final permanent allocation** | **~68.0 SOL** |

User has 100+ SOL. **Sufficient with comfortable margin.**

### With Test Amounts (if using current constants.ts values)

If we use the current test constants (10 SOL per pool instead of 25), the initialization cost drops to:
- WSOL wrapping: ~25 SOL (10 SOL x 2 pools + 5 SOL buffer)
- Peak wallet requirement: ~50.6 SOL
- This is significantly less pressure on the wallet

## Open Questions

Things that couldn't be fully resolved:

1. **Seed liquidity amounts: test values vs mainnet values**
   - What we know: CONTEXT.md specifies mainnet amounts (25 SOL/pool, 290M tokens). constants.ts has test values (10 SOL/pool, 10K tokens). initialize.ts imports from constants.ts.
   - What's unclear: How to override constants.ts values for devnet without breaking test compatibility
   - Recommendation: Create a separate devnet constants file or use environment variable overrides. This is a planning decision -- the CONTEXT.md says "exact mainnet token amounts" so the planner should ensure the override mechanism is clean.

2. **Commitment level: confirmed vs finalized**
   - What we know: connection.ts uses `confirmed`. CONTEXT.md says `finalized`.
   - What's unclear: Whether to update connection.ts globally or only for devnet
   - Recommendation: Add a `COMMITMENT` env var to connection.ts, defaulting to `confirmed` but overridable to `finalized` for devnet deployment. This preserves test compatibility.

3. **deploy.sh and priority fees**
   - What we know: Helius free tier limits sendTransaction to 1/sec. `solana program deploy` doesn't add priority fees by default. The `--with-compute-unit-price` flag exists.
   - What's unclear: Whether 1 sendTransaction/s is sufficient for deployment or if priority fees are needed on devnet
   - Recommendation: First try without priority fees. If "blockhash expired" errors occur, add `--with-compute-unit-price 1` to the deploy command in deploy.sh.

4. **Helius API key in .env**
   - What we know: .env currently only has `SUPERMEMORY_CC_API_KEY`. The user mentioned Helius is configured but the key isn't in .env yet.
   - What's unclear: Whether the key needs to be added or if it's stored elsewhere
   - Recommendation: Add `HELIUS_API_KEY=<key>` to .env and construct the URL in deploy scripts. Or add `CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=<key>` directly.

5. **Mint keypair reuse across localnet/devnet**
   - What we know: initialize.ts persists mint keypairs to `scripts/deploy/mint-keypairs/`. These were generated during localnet dry run and produce specific PDA addresses.
   - What's unclear: Should we reuse the same mint keypairs for devnet (same mint addresses as localnet) or generate fresh ones?
   - Recommendation: Generate fresh mint keypairs for devnet by deleting or renaming the existing `mint-keypairs/` directory. Localnet and devnet should have independent mint addresses since they're separate clusters with separate state. However, if we want PDA manifest consistency between dry-run and devnet, we could reuse them. This is a planning decision.

## Sources

### Primary (HIGH confidence)
- Solana Stack Exchange: Program deployment costs, buffer accounts, rate limits (multiple verified answers)
- Helius docs (helius.dev/docs): Free tier rate limits (10 req/s, 1 sendTransaction/s), pricing page
- Project codebase: deploy.sh, initialize.ts, verify.ts, connection.ts, constants.ts, Anchor.toml, pda-manifest.json
- Solana CLI `solana rent` command output: Verified rent costs for all 5 programs on devnet

### Secondary (MEDIUM confidence)
- Solana devnet airdrop limit: ~24 SOL/day per address (Stack Exchange community answer, not official docs)
- Program data account sizing: No longer 2x in CLI >1.18 (referenced GitHub commit 5cb30cf, Stack Exchange answer)
- Token-2022 transfer hooks work identically on devnet and mainnet (no reports of devnet-specific issues)

### Tertiary (LOW confidence)
- Helius free tier credit limit: 1M credits/month (from pricing page, but "credit" definition unclear for sendTransaction)
- Devnet epoch length differences from mainnet: Unverified, but generally shorter epochs on devnet

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools are the same ones used in localnet dry run; well-documented Solana CLI
- Architecture: HIGH - The deployment pipeline exists and passed 34/34 checks on localnet; devnet is a configuration change
- Pitfalls: HIGH - Rate limiting and buffer recovery are well-documented issues; SOL budget calculated from real data
- Open questions: MEDIUM - Seed liquidity amount override and commitment level changes need planning decisions

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (30 days - stable domain, Solana devnet infrastructure rarely changes)
