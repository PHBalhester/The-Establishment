# Technology Stack

**Project:** Dr. Fraudsworth v1.5 Feature Additions
**Researched:** 2026-03-25
**Focus:** Stack additions for Jupiter integration, USDC pools, Switchboard gateway failover, Vault convert-all

## Current Stack Baseline (DO NOT CHANGE)

| Technology | Version | Role |
|------------|---------|------|
| Anchor | 0.32.1 | On-chain framework |
| anchor-lang | 0.32.1 | Rust program SDK |
| anchor-spl | 0.32.1 | SPL/T22 token helpers |
| solana-sdk (dev) | 2.2 | Test infrastructure |
| switchboard-on-demand (Rust) | =0.11.3 | VRF on-chain accounts |
| @switchboard-xyz/on-demand (JS) | ^3.7.3 | VRF client-side flow |
| @coral-xyz/anchor (JS) | 0.32.1 | Client Anchor SDK |
| Next.js | 16.1.6 | Frontend |

---

## Recommended Stack Additions

### 1. Jupiter AMM SDK (`jupiter-amm-interface`) -- OFF-CHAIN ONLY

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| jupiter-amm-interface | 0.6.1 | Implement `Amm` trait for Jupiter routing | Required by Jupiter DEX integration program; this is the only path to get listed |

**CRITICAL: This is an off-chain crate, NOT an on-chain dependency.**

The `jupiter-amm-interface` does NOT compile to BPF. It runs in Jupiter's off-chain routing engine (Metis). Jupiter forks your SDK repo and runs it server-side to quote prices and build swap instructions. Your on-chain programs remain unchanged -- Jupiter constructs transactions that call your existing Tax Program instructions.

**Architecture:**
```
Jupiter Metis Engine (off-chain, Rust)
  -> loads your Amm trait impl (jupiter-amm-interface crate)
  -> calls quote() to get price
  -> calls get_swap_and_account_metas() to build IX
  -> submits TX to Solana
  -> TX calls your Tax Program's swap_sol_buy / swap_sol_sell (unchanged)
```

**Dependency compatibility concern:** The crate uses Solana modular crates v3.x-4.x (`solana-pubkey` 4.0.0, `solana-account` 3.4.0). This is **NOT a problem** because:
- The Jupiter SDK lives in a **separate Rust crate/workspace** from your on-chain programs
- It never links against `solana-program` or `anchor-lang`
- It only needs to know your program ID, account layouts, and instruction formats
- You deserialize your `PoolState` and `EpochState` manually (from raw bytes), not via Anchor's `Account<>` derive

**What you implement (the `Amm` trait):**

| Method | What it does |
|--------|-------------|
| `from_keyed_account()` | Deserialize your PoolState from account data |
| `label()` | Return `"Dr Fraudsworth"` |
| `program_id()` | Return Tax Program ID |
| `key()` | Return pool address |
| `get_reserve_mints()` | Return `[mint_a, mint_b]` from PoolState |
| `get_accounts_to_update()` | Return pool + epoch_state addresses (for tax rates) |
| `update()` | Cache deserialized pool reserves + current tax rates |
| `quote()` | Compute output with constant-product math + tax deduction |
| `get_swap_and_account_metas()` | Build full instruction accounts for `swap_sol_buy`/`swap_sol_sell` |

**New dependencies introduced (off-chain crate only):**

| Dependency | Version | Purpose |
|------------|---------|---------|
| jupiter-amm-interface | 0.6.1 | Amm trait definition |
| rust_decimal | 1.36.0 | Required by jupiter-amm-interface for `QuoteParams` |
| serde / serde_json | 1.x | Serialization (already transitive) |
| solana-pubkey | 4.0.0 | Pubkey type (jupiter's version) |
| solana-account | 3.4.0 | KeyedAccount type |
| solana-instruction | 3.1.0 | AccountMeta/Instruction types |

**Confidence:** HIGH -- verified from [Cargo.toml on GitHub](https://github.com/jup-ag/jupiter-amm-interface/blob/main/Cargo.toml) via WebFetch. Verified this is purely off-chain from [DeepWiki analysis](https://deepwiki.com/jup-ag/jupiter-amm-interface) and [Jupiter DEX integration docs](https://dev.jup.ag/docs/routing/dex-integration).

**Non-technical requirements for Jupiter listing:**

| Requirement | Status | Notes |
|-------------|--------|-------|
| Security audit | DONE | 5 audits completed, OtterSec verified |
| Code health | GOOD | Open source on GitHub |
| Market traction | PENDING | Need live trading volume data |
| Team & backers | PENDING | Jupiter evaluates this |
| Fork permission | REQUIRED | Must allow Jupiter to fork SDK repo |
| No network calls | REQUIRED | All quoting from cached accounts only |
| Market quality | REQUIRED | <30% price diff on $500 round-trip, <20% impact $500-$1000 |

---

### 2. USDC Pool Support -- NO NEW DEPENDENCIES

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| (none new) | -- | USDC is standard SPL Token, same as WSOL | Existing `MixedPool` type already handles T22+SPL pairs |

**USDC is an SPL Token (NOT Token-2022).**

USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, owned by `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (original SPL Token program).

**This means USDC pools work exactly like SOL pools architecturally:**
- Pool type: `MixedPool` (CRIME=T22 + USDC=SPL, FRAUD=T22 + USDC=SPL)
- Transfer routing: Same as SOL pools -- T22 transfer_checked for CRIME/FRAUD, SPL transfer for USDC
- Transfer hooks: Fire on the T22 side (CRIME/FRAUD), no hook on USDC side -- identical to SOL pools
- Whitelist: Same ExtraAccountMetaList resolution as SOL pools

**What DOES change (program-level, no new deps):**

| Change | Where | Why |
|--------|-------|-----|
| New pool initialization | AMM `initialize_pool` | Create CRIME/USDC and FRAUD/USDC pools |
| New Tax Program swap instructions | Tax Program | `swap_usdc_buy`, `swap_usdc_sell` (mirror SOL versions but with USDC ATA, no WSOL wrap/unwrap) |
| Tax distribution in USDC | Tax Program | 75% staking, 24% carnage, 1% treasury -- but denominated in USDC not SOL |
| Staking escrow USDC account | Staking Program | Needs USDC escrow ATA alongside SOL escrow |
| Carnage fund USDC vault | Epoch Program | Carnage buys/sells from USDC pools too |
| Price oracle for USDC/SOL | Client-side | Need SOL/USD price to normalize yields across SOL and USDC pools |

**Key architectural decision needed:** Does the staking yield stay dual-denominated (SOL yield from SOL pools, USDC yield from USDC pools), or is everything converted to a single denomination? This is a design decision, not a stack decision. The programs can handle either.

**The biggest difference vs SOL pools: no WSOL wrap/unwrap.** SOL pools require wrapping native SOL into WSOL (SPL Token) before swapping and unwrapping after. USDC is already an SPL Token, so swaps are simpler -- standard SPL Token transfers, no sync_native or close-account dance.

**No new Rust crates needed.** `anchor-spl` already has all SPL Token transfer helpers. USDC uses the standard SPL Token program which is already imported.

**Confidence:** HIGH -- USDC mint program verified via [Solana token documentation](https://solana.com/docs/tokens). AMM `PoolState` and `PoolType::MixedPool` verified from source code at `programs/amm/src/state/pool.rs`.

---

### 3. Switchboard Gateway Failover -- NO NEW ON-CHAIN DEPENDENCIES

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| (none new on-chain) | -- | Gateway failover is purely client-side | On-chain `switchboard-on-demand =0.11.3` stays pinned |
| @switchboard-xyz/on-demand (JS) | ^3.7.3 (existing) | Already installed, has retry macros | No version change needed |

**The problem and solution are entirely client-side (crank scripts).**

Current behavior (from `scripts/vrf/lib/vrf-flow.ts`):
1. `randomness.revealIx()` contacts the oracle's assigned gateway
2. If gateway is down, exponential backoff retry (3s, 6s, 9s) up to `maxAttempts`
3. If all attempts fail, falls through to VRF timeout recovery
4. Timeout recovery creates fresh randomness (may get a different oracle/gateway)

**Why gateway rotation does NOT work (already documented in MEMORY.md):**
Each randomness account is assigned to a specific oracle during commit. The reveal verifies that oracle's signature on-chain. Alternative gateways serve different oracles, so their signatures fail verification (error `0x1780`). Only the assigned oracle's gateway can produce a valid reveal.

**What CAN be improved (no new deps):**

| Improvement | Where | How |
|-------------|-------|-----|
| Pre-check gateway health before commit | `vrf-flow.ts` | HTTP HEAD to gateway URL before creating randomness; if down, delay epoch transition |
| Oracle selection awareness | `vrf-flow.ts` | After `Randomness.create()`, check which oracle was assigned; log it for monitoring |
| Faster timeout recovery | `vrf-flow.ts` | Reduce `VRF_TIMEOUT_SLOTS` from 300 to minimum safe value; create fresh randomness sooner |
| Multiple randomness pre-creation | `vrf-flow.ts` | Create 2-3 randomness accounts, pick the one assigned to a healthy oracle |
| Gateway health monitoring | New script | Periodic pings to known gateways, alerting when one goes down |

**The multi-randomness approach is the most robust failover:**
1. Create 2-3 randomness accounts (each gets assigned an oracle)
2. Check which gateways are healthy
3. Commit with the randomness that has a healthy oracle
4. If commit succeeds but reveal fails, fall through to timeout recovery as today

**Cost:** Each randomness account creation costs ~0.008 SOL rent (reclaimable). Creating 2-3 per epoch and closing the unused ones is negligible cost given the existing rent reclaim infrastructure.

**No Rust crate changes needed.** The on-chain epoch program accepts any valid randomness account -- it doesn't care which oracle was assigned. All failover logic is in the TypeScript crank.

**Confidence:** HIGH -- Verified from source code in `scripts/vrf/lib/vrf-flow.ts` lines 234-276. Gateway rotation impossibility confirmed by project memory (MEMORY.md) and on-chain behavior.

---

### 4. Vault Convert-All -- NO NEW DEPENDENCIES

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| (none new) | -- | Pure instruction logic change | Sentinel value `amount_in=0` triggers balance read |

**This is a small on-chain logic change, not a stack change.**

Per the proposal at `Docs/vault-convert-all-proposal.md`:
- Add `minimum_output: u64` parameter to `convert` instruction
- When `amount_in == 0`, read `user_input_account.amount` on-chain
- Add `VaultError::SlippageExceeded` error variant
- No new imports, no new crates, no new accounts

**Existing dependencies are sufficient:**
- `anchor-spl` token_2022 feature already provides `InterfaceAccount<TokenAccount>` which exposes `.amount`
- `anchor-lang` `require!()` macro handles the slippage guard
- No additional Solana SDK crates needed

**The instruction signature changes from 1 to 2 parameters, which is a breaking IDL change.** All callers (client multi-hop builder, test scripts) must update simultaneously.

**Confidence:** HIGH -- Verified from vault proposal doc and `programs/conversion-vault/Cargo.toml` source.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Jupiter integration | jupiter-amm-interface 0.6.1 (off-chain crate) | Jupiter Ultra V3 API (HTTP) | Jupiter requires the Rust Amm trait for DEX listing in Metis; API is for consumers, not providers |
| USDC transfers | Standard SPL Token (anchor-spl) | Token-2022 USDC | USDC is SPL Token, not T22. No choice here. |
| VRF failover | Multi-randomness pre-creation + gateway health check | Switch to different oracle network | Switchboard is the only VRF provider on Solana; no alternative exists |
| Vault convert-all | Sentinel value (amount_in=0) | New `convert_v2` instruction | Sentinel is simpler, backwards-compatible for `amount_in > 0`, and 0 was already an error |

---

## What NOT to Add

| Temptation | Why Not |
|------------|---------|
| `jupiter-core` or `jup-ag` Rust crate | These are Jupiter internals, not for DEX integrators |
| `solana-sdk` v3.x in on-chain programs | Anchor 0.32.1 requires solana-program 2.x; mixing versions breaks BPF compilation |
| `spl-token` in on-chain deps | Already have `anchor-spl` which wraps it; adding both causes duplicate types |
| Pyth/Chainlink price feeds | Not needed yet; USDC is $1 stable, SOL/USD price only needed client-side for display |
| `rust_decimal` in on-chain programs | BPF has no float; your existing u128 checked math is correct and more efficient |
| New oracle crate for gateway failover | The problem is client-side, not on-chain |
| Anchor 0.33+ upgrade | Not needed for these features; would require re-testing all 6 programs |

---

## Installation

### Jupiter SDK (new separate crate)

```bash
# Create new crate in workspace (NOT in programs/)
mkdir -p sdk/jupiter-adapter
cd sdk/jupiter-adapter
cargo init --lib

# Add to workspace Cargo.toml members (NOT in programs/* glob)
# members = ["programs/*", "tests/cross-crate", "sdk/jupiter-adapter"]
```

```toml
# sdk/jupiter-adapter/Cargo.toml
[package]
name = "drfraudsworth-jupiter"
version = "0.1.0"
edition = "2021"
rust-version = "1.85.0"

[dependencies]
jupiter-amm-interface = "0.6.1"
rust_decimal = "1.36.0"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
solana-pubkey = "4.0.0"
solana-account = { version = "3.4.0", features = ["serde"] }
solana-instruction = "3.1.0"
solana-clock = "3.0.0"
solana-program-error = "3.0.0"
anyhow = "1"
```

### USDC Pools
```bash
# No new packages. USDC uses existing anchor-spl SPL Token support.
```

### Gateway Failover
```bash
# No new packages. Improvements are TypeScript changes to scripts/vrf/lib/vrf-flow.ts.
```

### Vault Convert-All
```bash
# No new packages. Changes to programs/conversion-vault/src/instructions/convert.rs only.
```

---

## Workspace Isolation Strategy

The Jupiter adapter MUST be in a separate workspace member (e.g., `sdk/jupiter-adapter`), NOT inside `programs/`. Reasons:

1. **Different Solana SDK versions**: On-chain programs use `solana-program` 2.2 via Anchor 0.32.1. Jupiter SDK uses modular Solana crates 3.x-4.x. These cannot coexist in the same compilation unit.
2. **Different compilation targets**: On-chain = BPF/SBF. Jupiter SDK = native x86_64.
3. **Jupiter forks your repo**: They need to build just the SDK crate, not your entire program workspace.

Cargo workspace resolver 2 handles the version split correctly as long as the crates are in separate workspace members that don't depend on each other.

---

## Net Impact Summary

| Feature | New Rust Crates | New JS Packages | On-Chain Changes | Off-Chain Changes |
|---------|----------------|-----------------|------------------|-------------------|
| Jupiter SDK | 7 (off-chain only, separate crate) | 0 | NONE | New `sdk/jupiter-adapter/` crate |
| USDC Pools | 0 | 0 | AMM + Tax + Staking + Epoch | Frontend pool routing + display |
| Gateway Failover | 0 | 0 | NONE | `vrf-flow.ts` improvements |
| Vault Convert-All | 0 | 0 | Conversion Vault only | Multi-hop builder + swap builders |

**Total new on-chain dependencies: ZERO.** All four features use existing crates. The only new Rust dependency is `jupiter-amm-interface` in an isolated off-chain crate.

---

## Sources

- [jupiter-amm-interface Cargo.toml (v0.6.1)](https://github.com/jup-ag/jupiter-amm-interface/blob/main/Cargo.toml) -- verified dependency versions via WebFetch (HIGH confidence)
- [Jupiter DEX Integration Guide](https://dev.jup.ag/docs/routing/dex-integration) -- listing requirements (MEDIUM confidence, WebSearch summary)
- [jupiter-amm-implementation README](https://github.com/jup-ag/jupiter-amm-implementation/blob/main/README.md) -- SDK structure reference (HIGH confidence)
- [jupiter-amm-interface crates.io](https://crates.io/crates/jupiter-amm-interface) -- current version 0.6.1 (HIGH confidence)
- [Switchboard on-demand crate](https://crates.io/crates/switchboard-on-demand) -- v0.11.3, anchor-lang >=0.31.0 (HIGH confidence)
- [Switchboard on-demand docs.rs](https://docs.rs/switchboard-on-demand/latest/switchboard_on_demand/) -- retry macros exist (MEDIUM confidence)
- [USDC mint program](https://solana.com/docs/tokens) -- USDC is SPL Token, not T22 (HIGH confidence)
- [Transfer Hook guide](https://solana.com/developers/guides/token-extensions/transfer-hook) -- CPI and re-entrancy constraints (HIGH confidence)
- Project source: `programs/amm/src/state/pool.rs` -- PoolType::MixedPool handles T22+SPL (HIGH confidence)
- Project source: `scripts/vrf/lib/vrf-flow.ts` -- gateway retry and timeout recovery (HIGH confidence)
- Project source: `Docs/vault-convert-all-proposal.md` -- convert-all design (HIGH confidence)
- Project source: `programs/conversion-vault/Cargo.toml` -- current deps (HIGH confidence)
- Project MEMORY.md -- VRF gateway rotation impossibility documented (HIGH confidence)
