# Phase 107: Jupiter AMM Adapter SDK - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a Rust SDK crate that implements Jupiter's `Amm` trait so Jupiter's aggregator can route swaps through Dr. Fraudsworth's 2 SOL pools and 3 conversion vault pairs. The SDK must produce exact quotes (matching on-chain output within 1 lamport) and return complete account metas for Tax Program and Conversion Vault instructions with zero network calls. Published to crates.io with integration documentation and examples.

**Scope correction:** The original JUP-05/06 requirements reference "4 PROFIT pool swap directions" — PROFIT AMM pools do not exist. PROFIT is acquired exclusively via the Conversion Vault at fixed rates (100:1 / 1:100). Requirements should be updated to reflect: 2 SOL pools (4 directions) + 3 vault conversions (6 directions) = 10 total swap directions across 5 Amm instances.

</domain>

<decisions>
## Implementation Decisions

### Crate Structure & Modularity
- **Jupiter-first approach** — build `sdk/jupiter-adapter/` implementing Jupiter's `Amm` trait directly
- If other aggregators (Titan, etc.) request integration later, extract shared math into `sdk/core/` and build separate adapter crates on top
- No premature abstraction — we don't know other aggregators' trait interfaces yet
- **Monorepo location** — `sdk/jupiter-adapter/` in the existing repo, not a separate repo

### Math Reuse
- **Copy pure functions** from on-chain programs into the adapter crate (not a shared crate dependency)
- Copy `calculate_effective_input`, `calculate_swap_output` from `programs/amm/src/helpers/math.rs`
- Copy `calculate_tax` from `programs/tax-program/src/helpers/tax_math.rs`
- Add comments pointing to the on-chain source for traceability
- These functions are pure u64/u128 math with zero Solana deps — trivial to copy

### Dependencies
- **Minimal deps — raw byte parsing** for EpochState and PoolState deserialization
- NO anchor-lang dependency (would pull ~50 transitive deps into an off-chain SDK)
- Parse account data using known byte offsets (same approach as `epoch_state_reader.rs`)
- Only deps: `solana-sdk` (for Pubkey, AccountMeta), `jupiter-amm-interface` (for Amm trait)

### Quote Accuracy — SOL Pools
- Parse EpochState from Jupiter's passed account snapshots (Jupiter calls `quote()` with pre-fetched account data)
- Declare EpochState PDA in `get_accounts_to_update()` so Jupiter refreshes it frequently
- Tax rate changes between quote and execution handled by on-chain slippage protection (minimum_output) — standard Jupiter pattern
- **Combined fee reporting** — report LP fee (100bps) + dynamic tax as one total fee_amount in quote output

### Quote Accuracy — Conversion Vault
- **Exact deterministic quotes** — vault rates are fixed (CRIME:FRAUD 1:1, CRIME/FRAUD:PROFIT 100:1, PROFIT:CRIME/FRAUD 1:100), zero fees
- `get_accounts_to_update()` returns empty for vault instances — no on-chain state needed for quoting
- 3 vault Amm instances: CRIME<->FRAUD, CRIME<->PROFIT, FRAUD<->PROFIT

### Amm Instances (5 total)
- **2 SOL pool instances**: CRIME/SOL, FRAUD/SOL (Tax Program swaps, 100bps LP + dynamic tax)
- **3 vault conversion instances**: CRIME<->FRAUD (1:1), CRIME<->PROFIT (100:1), FRAUD<->PROFIT (100:1) (zero fees)
- Jupiter's router automatically discovers multi-hop paths (e.g., SOL -> CRIME -> vault -> PROFIT)

### Account Meta Generation
- **Hardcoded mainnet addresses** for all protocol PDAs, mints, vaults, program IDs as constants in the crate
- **Hardcoded transfer hook accounts** — all 4 per hooked mint (ExtraAccountMetaList PDA, whitelist source, whitelist dest, hook program) as constants
- For any given swap, select the correct subset of accounts
- Zero network calls for account meta generation (JUP-04)
- **Jupiter handles WSOL wrapping/unwrapping** — SDK returns only the Tax Program swap instruction, Jupiter wraps SOL before and unwraps after

### Publishing
- **crates.io** as `drfraudsworth-jupiter-adapter` — standard Rust ecosystem distribution, versioned, discoverable
- IDLs hosted on public GitHub repo (github.com/MetalLegBob/drfraudsworth) — free, versioned, already exists

### Documentation
- **README + examples** in `sdk/jupiter-adapter/`:
  - Setup instructions
  - All 5 pool types explained
  - Quote examples for each swap direction
  - Account meta walkthrough
  - Fee structure explanation (LP + dynamic tax for SOL pools, zero for vault)
  - Epoch tax dynamics explanation
- Working Rust example in `sdk/jupiter-adapter/examples/`
- Enough for Jupiter's team to integrate without contacting us

### Testing
- **LiteSVM parity tests** — deploy programs to LiteSVM, run swap on-chain, run same swap through SDK quote engine, assert outputs match within 1 lamport
- Proves JUP-02 (exact quote accuracy) — automated, repeatable
- Cover all 10 swap directions (4 SOL pool + 6 vault)

### Claude's Discretion
- Internal module organization within the adapter crate
- Exact byte offsets for raw EpochState/PoolState parsing
- LiteSVM test fixture setup and helper structure
- README formatting and example code style
- Cargo.toml metadata (description, keywords, license)

</decisions>

<specifics>
## Specific Ideas

- User wants the SDK to be modular enough that other aggregators (Titan, trading terminals) can be supported later — but Jupiter-first, don't over-engineer
- "Are we intending to implement the conversion vault in this SDK too?" — YES, include vault as routable Amm instances so Jupiter can discover SOL->PROFIT multi-hop routes
- PROFIT AMM pools do NOT exist — requirements JUP-05/06 need updating to reflect vault-based PROFIT acquisition
- Phase 106 (convert_v2) must ship first — vault convert-all with slippage protection is a dependency for accurate vault quoting

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `programs/amm/src/helpers/math.rs`: Pure swap math (calculate_effective_input, calculate_swap_output, verify_k_invariant) — copy directly
- `programs/tax-program/src/helpers/tax_math.rs`: Tax calculation (calculate_tax with 75/24/1 split) — copy directly
- `programs/tax-program/src/state/epoch_state_reader.rs`: EpochState layout with get_tax_bps(is_crime, is_buy) — reference for byte offsets
- `target/idl/*.json` and `app/idl/*.json`: All program IDLs already built
- `programs/conversion-vault/src/instructions/convert.rs`: Vault conversion logic (compute_output) — reference for vault rate math

### Established Patterns
- Transfer hook accounts = 4 per mint (ExtraAccountMetaList, whitelist_source, whitelist_dest, hook_program)
- Canonical mint ordering: `is_reversed` detection for pool mint_a/mint_b (Phase 52.1)
- EpochState raw deserialization already done in Tax Program's epoch_state_reader.rs — proven byte layout
- Tax rates: 4 independent bps values (crime_buy, crime_sell, fraud_buy, fraud_sell) from EpochState

### Integration Points
- Jupiter's `Amm` trait: `get_accounts_to_update()`, `update()`, `quote()`, `get_swap_and_account_metas()`
- Tax Program instructions: `swap_sol_buy`, `swap_sol_sell` (each ~23 accounts)
- Conversion Vault instruction: `convert` / `convert_v2` (fewer accounts, simpler)
- All mainnet addresses known and stable (program IDs, mints, pools — see PROJECT.md)

</code_context>

<deferred>
## Deferred Ideas

- **Other aggregator adapters** (Titan, trading terminals) — extract shared core if/when requested, build separate adapter crates
- **On-chain IDL publishing** — write IDLs to Anchor's on-chain IDL account for programmatic discovery (considered, chose GitHub-only for now)
- **Devnet/testnet support** — config-based address switching for non-mainnet deployments (not needed for Jupiter integration)

</deferred>

---

*Phase: 107-jupiter-amm-adapter-sdk*
*Context gathered: 2026-03-26*
