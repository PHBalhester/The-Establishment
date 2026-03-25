# Security Audit Index

Comprehensive metadata index for all Rust source files in Dr. Fraudsworth production programs (excluding tests and mock programs).

**Date:** March 21, 2026
**Total Programs:** 7 production + 2 supporting
**Total Source Files:** 105
**Total LOC:** 19,765

---

## Program Summary Table

| Program | Files | LOC | Primary Focus Tags | Key Risk Areas |
|---------|-------|-----|-------------------|-----------------|
| **AMM** | 16 | 2,001 | ARITH, CPI, TOKEN, ACCESS | K-invariant, fee deduction, reentrancy |
| **Tax Program** | 14 | 2,761 | CPI, TOKEN, STATE, ARITH | Tax distribution, WSOL intermediary, exempt swaps |
| **Epoch Program** | 22 | 5,247 | ORACLE, STATE, CPI, ARITH | VRF integration, Carnage execution, CPI depth limit |
| **Staking** | 18 | 2,897 | ARITH, STATE, TOKEN | Reward accumulation, overflow checks, first-depositor |
| **Bonding Curve** | 22 | 4,911 | ARITH, STATE, ACCESS, TOKEN | Price discovery math, fund transitions, capacity caps |
| **Transfer Hook** | 13 | 884 | ACCESS, STATE, TOKEN | Authority burns, whitelist enforcement |
| **Conversion Vault** | 9 | 543 | TOKEN, ARITH | Fixed-rate conversion, token paths |
| **Stub Staking** | 3 | 324 | STATE | Minimal testing stub |
| **Mock Tax Program** | 1 | 117 | STATE | Testing helper |
| **Fake Tax Program** | 1 | ~100 | STATE | Testing helper |

---

## Program Details

### AMM Program
**Purpose:** Constant-product market maker (CPMM) with dual-token support (SPL Token + Token-2022). Provides CRIME/SOL, FRAUD/SOL, and PROFIT/SOL pools with canonical mint ordering and per-pool liquidity management.

**Statistics:** 16 files, 2,001 LOC, 5 instructions, 82 public functions

---

#### amm/src/lib.rs
- **LOC:** 81
- **Purpose:** Entry point. Declares 5 public instructions: initialize_admin, transfer_admin, burn_admin, initialize_pool, swap_sol_pool.
- **Instructions/Functions:** initialize_admin, transfer_admin, burn_admin, initialize_pool, swap_sol_pool
- **Security Patterns:** Authorization checks (admin), PDA validation, instruction dispatch
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Admin authority changes; irreversible burns; upgrade authority gating

#### amm/src/constants.rs
- **LOC:** 40
- **Purpose:** Hardcoded protocol constants: SWAP_AUTHORITY_SEED, TAX_PROGRAM_ID, SOL_POOL_FEE_BPS (100 bps), MAX_LP_FEE_BPS (500 bps), PDA seeds.
- **Instructions/Functions:** N/A (constants only)
- **Security Patterns:** Hardcoded Tax Program ID; fee bounds; PDA seed definitions
- **Focus Tags:** [STATE]
- **Risk:** Hardcoded Tax Program ID must match deployment; LP fee cap enforced for admin safety

#### amm/src/errors.rs
- **LOC:** 114
- **Purpose:** 15 error types covering swap validation, pool state, access control, transfer routing, and fee enforcement. Each error maps to a u32 code.
- **Instructions/Functions:** N/A (error definitions)
- **Security Patterns:** Explicit error codes; descriptive messages for audit
- **Focus Tags:** [STATE]
- **Risk:** Error codes are part of on-chain contract; changing them breaks client compatibility

#### amm/src/events.rs
- **LOC:** 75
- **Purpose:** 3 event types: PoolInitializedEvent, SwapEvent, AdminBurned. Serialized as u8 variants for client indexing.
- **Instructions/Functions:** N/A (event definitions)
- **Security Patterns:** Event emission for indexing; includes reserve snapshots, fees, timestamps
- **Focus Tags:** [STATE]
- **Risk:** Event data duplication (e.g., lp_fee_bps stored in pool state, not re-emitted in SwapEvent); clients must cache immutable values

#### amm/src/state/pool.rs
- **LOC:** 79
- **Purpose:** PoolState PDA struct (224 bytes). Stores reserves, fees, mints, vaults, pool type (MixedPool vs PureT22Pool), reentrancy guard, bumps, and token program IDs.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Explicit reentrancy guard (locked: bool); bump caching to avoid re-derivation; token program validation fields; pool type inference from token programs (not caller-declared)
- **Focus Tags:** [STATE, ACCESS]
- **Risk:** Reentrancy guard is defense-in-depth (Solana's borrow rules prevent same-pool re-entry via CPI, but locked field adds explicit belt-and-suspenders); bump caching requires consistency with actual PDAs

#### amm/src/state/admin.rs
- **LOC:** 18
- **Purpose:** AdminConfig PDA (50 bytes). Single global authority gating pool creation.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Single admin key + bump; used to authorize all pool initialization
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Single point of failure if admin compromised; authority burn is irreversible (no recovery after burn_admin)

#### amm/src/helpers/math.rs
- **LOC:** 497
- **Purpose:** Pure math functions for swap calculations: calculate_effective_input (LP fee deduction), calculate_swap_output (constant-product formula), verify_k_invariant (k_after >= k_before).
- **Instructions/Functions:** calculate_effective_input, calculate_swap_output, verify_k_invariant, check_effective_input_nonzero, check_swap_output_nonzero
- **Security Patterns:** Pure functions (testable without Solana VM); checked arithmetic (checked_add, checked_mul, checked_div, checked_sub); Option<T> return type for overflow handling; u128 intermediate values for headroom
- **Focus Tags:** [ARITH]
- **Risk:** Integer division truncation (rounds down, dust stays in pool); u128 intermediate values prevent most overflows, but division-by-zero on zero reserves is possible (guarded by PoolNotInitialized check at instruction level); all arithmetic operations use checked_ variants (never panics)

#### amm/src/helpers/transfers.rs
- **LOC:** 191
- **Purpose:** Two transfer helpers: transfer_t22_checked (Token-2022 with hook accounts), transfer_spl (SPL Token).
- **Instructions/Functions:** transfer_t22_checked, transfer_spl
- **Security Patterns:** Manual invoke_signed for Token-2022 to forward hook accounts (Anchor's CpiContext doesn't forward remaining_accounts correctly); token program ID validation (prevents misuse); zero-amount rejection; signer seed handling for PDA authorization
- **Focus Tags:** [CPI, TOKEN, ACCESS]
- **Risk:** CRITICAL: Anchor's token_interface::transfer_checked does NOT forward remaining_accounts through Token-2022's nested CPI to Transfer Hook program. Must use manual invoke_signed with hook accounts appended to both ix.accounts AND account_infos. If hook accounts are missing, Token-2022 transfer_checked fails with AccountNotEnoughKeys (0x3005).

#### amm/src/helpers/mod.rs
- **LOC:** 2
- **Purpose:** Module re-exports for math and transfers.
- **Instructions/Functions:** N/A (re-exports)
- **Security Patterns:** None
- **Focus Tags:** []
- **Risk:** None

#### amm/src/instructions/initialize_admin.rs
- **LOC:** ~95
- **Purpose:** One-time initialization of AdminConfig PDA by upgrade authority. Sets admin to provided pubkey (can be deployer or multisig).
- **Instructions/Functions:** handler
- **Security Patterns:** Upgrade authority check; PDA derivation and initialization; Anchor init constraint prevents re-initialization
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Upgrade authority is the sole gatekeeper; once called, admin is locked in; deployer must pre-compute desired admin before deployment

#### amm/src/instructions/transfer_admin.rs
- **LOC:** ~60
- **Purpose:** Transfer admin authority from current admin to new_admin (e.g., multisig vault). Requires current admin signer. Rejects Pubkey::default() to prevent accidental burns.
- **Instructions/Functions:** handler
- **Security Patterns:** Current admin signer validation; new_admin != Pubkey::default() check; event emission
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Irreversible once accepted by new admin; no undo if transferred to wrong address; multisig must control new_admin PDA before transfer

#### amm/src/instructions/burn_admin.rs
- **LOC:** ~45
- **Purpose:** Permanently burn admin key by setting AdminConfig.admin to Pubkey::default(). Irreversible; after burn, initialize_pool becomes uncallable.
- **Instructions/Functions:** handler
- **Security Patterns:** Current admin signer check; PDA state mutation; event emission
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** **BLOCKING RULE: NO ON-CHAIN AUTHORITY MAY BE BURNED WITHOUT EXPLICIT WRITTEN CONFIRMATION FROM PROJECT OWNER (mlbob).** This is irreversible and terminates all admin functions. Must coordinate with Squads multisig governance workflow before executing.

#### amm/src/instructions/initialize_pool.rs
- **LOC:** ~200
- **Purpose:** Atomic pool initialization: validates mint ordering, infers pool type, creates pool PDA and vault PDAs, transfers initial liquidity, emits event.
- **Instructions/Functions:** handler, infer_pool_type
- **Security Patterns:** Canonical mint ordering check (mint_a < mint_b); duplicate mint rejection; zero seed amount rejection; pool type inference from token programs (MixedPool vs PureT22Pool); remaining_accounts for Token-2022 Transfer Hook; CEI ordering
- **Focus Tags:** [ACCESS, TOKEN, CPI, ARITH]
- **Risk:** Pool type inference must match token program owners; if Anchor token_program constraints don't enforce this, a caller could pass wrong token program and break pool type detection; both transfers must succeed atomically or entire transaction reverts (good); vault bumps are cached on-chain and must be re-derived identically in subsequent swaps

#### amm/src/instructions/swap_sol_pool.rs
- **LOC:** ~300
- **Purpose:** Execute swap in SOL pool (CRIME/SOL or FRAUD/SOL). Implements CEI ordering: Checks -> Effects -> Interactions -> Post-Interaction. LP fee deducted before output calculation. Slippage protection via minimum_amount_out.
- **Instructions/Functions:** handler, SwapDirection enum
- **Security Patterns:** Direction-based account selection; immutable value capture (avoids RefCell borrow conflicts); reentrancy guard (set at start, cleared at end); k-invariant verification; swap math (effective input -> output); fee validation; slippage checks; token transfer routing (T22 vs SPL); remaining_accounts for hooks
- **Focus Tags:** [ARITH, CPI, TOKEN, ACCESS]
- **Risk:** CRITICAL CPI DEPTH: swap path is at Solana's 4-level limit (AMM::swap -> Tax::swap_exempt -> AMM::swap_sol_pool -> Token-2022::transfer_checked -> Transfer Hook::execute). DO NOT add CPI calls to swap path. K-invariant check ensures no fund drainage but uses checked arithmetic that can fail (mapped to AmmError::Overflow); direction enum is caller-declared (not inferred), so malicious caller could pass wrong direction (mitigated by swaps being symmetric); reentrancy guard is additional layer beyond Solana's borrow rules

---

### Tax Program
**Purpose:** Asymmetric buy/sell taxation with 3-way distribution (71% staking escrow, 24% Carnage fund, 5% treasury). Routes swaps through AMM with swap_authority PDA signing for AMM access control. Manages WSOL intermediary for sell-side optimization.

**Statistics:** 14 files, 2,761 LOC, 4 instructions

---

#### tax-program/src/lib.rs
- **LOC:** 91
- **Purpose:** Entry point. Declares 4 public instructions: swap_sol_buy, swap_sol_sell, initialize_wsol_intermediary, swap_exempt.
- **Instructions/Functions:** swap_sol_buy, swap_sol_sell, initialize_wsol_intermediary, swap_exempt
- **Security Patterns:** Tax distribution routing; Carnage fund access; swap_authority PDA signing; WSOL intermediary initialization
- **Focus Tags:** [CPI, TOKEN, STATE]
- **Risk:** swap_authority is hardcoded in constants; must be derived identically by both Tax and AMM programs

#### tax-program/src/constants.rs
- **LOC:** 256
- **Purpose:** Tax rates, distribution percentages, escrow/vault seeds, program IDs, and WSOL intermediary configuration.
- **Instructions/Functions:** N/A (constants)
- **Security Patterns:** Hardcoded AMM_PROGRAM_ID, STAKING_PROGRAM_ID, EPOCH_PROGRAM_ID; buy/sell tax rates (must match epoch tax state); distribution percentages (71/24/5); PDA seed definitions
- **Focus Tags:** [STATE]
- **Risk:** Multiple hardcoded program IDs; if deployment uses different addresses, CPI calls fail; swap_authority seed must match AMM's SWAP_AUTHORITY_SEED definition

#### tax-program/src/errors.rs
- **LOC:** 93
- **Purpose:** 12 error types covering tax math, escrow state, pool reader, swap validation, authorization.
- **Instructions/Functions:** N/A (error definitions)
- **Security Patterns:** Error codes and descriptions
- **Focus Tags:** [STATE]
- **Risk:** Error codes are part of contract; changing breaks client compatibility

#### tax-program/src/events.rs
- **LOC:** 78
- **Purpose:** 4 event types: TaxDistributed, EscrowUpdated, WsolInitialized, SwapExecuted. Provides audit trail for tax flows.
- **Instructions/Functions:** N/A (event definitions)
- **Security Patterns:** Event emission for indexing; includes tax amounts, pool identifiers
- **Focus Tags:** [STATE]
- **Risk:** Events don't enforce consistency with actual state changes; clients must correlate with on-chain reads

#### tax-program/src/instructions/swap_sol_buy.rs
- **LOC:** ~250
- **Purpose:** Buy swap with tax deduction from SOL input before AMM swap. Tax is split 71/24/5 and routed to escrow/Carnage/treasury.
- **Instructions/Functions:** handler
- **Security Patterns:** Tax calculation (buy_tax_rate from epoch state); distribution split; CPI to AMM via swap_authority PDA; remaining_accounts for hooks; CEI ordering
- **Focus Tags:** [ARITH, CPI, TOKEN, STATE]
- **Risk:** Tax rate must come from EpochState (reads via pool_reader PDA); if epoch state is stale or corrupted, tax calculation is wrong; no validation that tax distribution percentages sum to 100 (relies on design guarantee); WSOL wrapping happens before swap (not in CPI chain, so doesn't increase depth)

#### tax-program/src/instructions/swap_sol_sell.rs
- **LOC:** ~250
- **Purpose:** Sell swap: token -> WSOL via AMM, then unwrap WSOL to SOL, then deduct tax from final SOL output. Tax routed 71/24/5.
- **Instructions/Functions:** handler
- **Security Patterns:** Swap via AMM with swap_authority signing; WSOL unwrap via sync_native; tax calculation on post-swap SOL; distribution split; remaining_accounts for hooks
- **Focus Tags:** [ARITH, CPI, TOKEN, STATE]
- **Risk:** Two-step unwrap (sync_native must be called first to update WSOL balance before transfer); WSOL intermediary must exist (initialize_wsol_intermediary must be called once); tax deduction is post-swap (different from buy path where tax is pre-swap); no validation of tax_rate source (trusts EpochState)

#### tax-program/src/instructions/initialize_wsol_intermediary.rs
- **LOC:** ~80
- **Purpose:** One-time initialization of WSOL token account owned by swap_authority PDA. Must be called before first sell swap.
- **Instructions/Functions:** handler
- **Security Patterns:** PDA account creation; WSOL mint hardcoding; token account initialization
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Idempotent? (unclear if re-calling fails or succeeds); if never called, sell swaps will fail trying to use missing WSOL intermediary account

#### tax-program/src/instructions/swap_exempt.rs
- **LOC:** ~180
- **Purpose:** Tax-exempt swap for Carnage Fund (bidirectional SOL<->Token). Only called by Epoch Program. No tax applied, only AMM LP fee (1%) applies.
- **Instructions/Functions:** handler
- **Security Patterns:** Epoch Program authorization check; direction handling (0=buy, 1=sell); CPI to AMM via swap_authority; remaining_accounts for hooks; no tax calculation
- **Focus Tags:** [CPI, TOKEN, STATE, ACCESS]
- **Risk:** Epoch Program must be trusted (no other authorization beyond signer check); direction is u8 (0 or 1), must be validated at instruction entry or in handler; CPI is at depth limit (Tax -> AMM -> Token-2022 -> Transfer Hook)

#### tax-program/src/state/epoch_state_reader.rs
- **LOC:** ~100
- **Purpose:** Helper to read EpochState from Epoch Program's on-chain state without deserializing full struct. Extracts buy_tax_rate, sell_tax_rate, and current tax state.
- **Instructions/Functions:** read_epoch_state, parse_epoch_buy_rate, parse_epoch_sell_rate
- **Security Patterns:** Direct byte reading (offset-based) from external program's state; no anchor deserialization (avoids dependency on Epoch Program's IDL); validates epoch state PDA seed
- **Focus Tags:** [STATE, CPI]
- **Risk:** Byte offsets must match Epoch Program's struct layout exactly; if Epoch Program changes, offsets break and tax rates are read incorrectly (silent failure risk); no version check or signature validation

#### tax-program/src/helpers/pool_reader.rs
- **LOC:** 97
- **Purpose:** Read AMM pool state directly from on-chain bytes to determine pool reserves without deserializing. Resolves is_reversed flag based on canonical mint ordering.
- **Instructions/Functions:** read_pool_reserves, toPoolReserves, is_reversed_pool
- **Security Patterns:** Direct byte reading (offset-based); canonical mint ordering detection; reserve semantics (reserveA=faction, reserveB=PROFIT)
- **Focus Tags:** [STATE, CPI]
- **Risk:** Byte offsets must match AMM PoolState struct exactly; Phase 52.1 bug: mint order in pool could be reversed relative to code's assumptions, fixed by is_reversed detection; if offsets drift, reserve values are read incorrectly

#### tax-program/src/helpers/tax_math.rs
- **LOC:** ~100
- **Purpose:** Pure math functions for tax calculations: calculate_tax_amount, distribute_tax, validate_minimum_output.
- **Instructions/Functions:** calculate_tax_amount, distribute_tax_portions
- **Security Patterns:** Checked arithmetic; percentage calculations (71/24/5); distribution validation
- **Focus Tags:** [ARITH]
- **Risk:** Percentage split may not sum to 100 exactly due to integer division (dust handling); if tax_rate > 100%, validation should catch it but may not; no explicit check that amounts are positive

#### tax-program/src/helpers/mod.rs
- **LOC:** 4
- **Purpose:** Module re-exports.
- **Instructions/Functions:** N/A
- **Security Patterns:** None
- **Focus Tags:** []
- **Risk:** None

---

### Epoch Program
**Purpose:** VRF-driven tax regime coordination and Carnage Fund execution. Manages 30-minute epoch transitions with Switchboard VRF, dynamic tax rates, and Carnage Fund trigger logic. Executes rebalancing swaps through Tax Program.

**Statistics:** 22 files, 5,247 LOC, 10 instructions

---

#### epoch-program/src/lib.rs
- **LOC:** 150
- **Purpose:** Entry point. Declares 10 instructions: initialize_epoch_state, trigger_epoch_transition, consume_randomness, execute_carnage, execute_carnage_atomic, force_carnage, expire_carnage, initialize_carnage_fund, retry_epoch_vrf.
- **Instructions/Functions:** [10 instruction handlers]
- **Security Patterns:** VRF integration; Carnage fund management; epoch state transitions; oracle/randomness handling
- **Focus Tags:** [ORACLE, STATE, CPI]
- **Risk:** VRF is at 4-level CPI depth limit; multiple entry points for Carnage execution (atomic vs fallback) increases complexity

#### epoch-program/src/constants.rs
- **LOC:** 490
- **Purpose:** Genesis tax rates, Carnage thresholds, VRF parameters, epoch duration, seeds, program IDs, and oracle configuration.
- **Instructions/Functions:** N/A (constants)
- **Security Patterns:** Hardcoded genesis tax_low (3%), tax_high (14%), Carnage threshold (4.3%), epoch duration (120 slots = ~30 min), Switchboard oracle address, max swaps per execution
- **Focus Tags:** [ORACLE, STATE]
- **Risk:** Multiple hardcoded program IDs (Tax, AMM, Staking); genesis tax rates are immutable; Carnage threshold of 4.3% means ~1 in 23 epochs triggers Carnage

#### epoch-program/src/errors.rs
- **LOC:** 144
- **Purpose:** 18 error types covering VRF validation, Carnage execution, epoch transitions, oracle integration.
- **Instructions/Functions:** N/A (error definitions)
- **Security Patterns:** VRF-specific errors (RandomnessExpired, RandomnessAlreadyRevealed, VrfAlreadyPending); Carnage-specific errors (CarnageAlreadyActive, CarnageNotTriggered); epoch boundary validation
- **Focus Tags:** [STATE]
- **Risk:** Error codes are immutable; changing them breaks client compatibility

#### epoch-program/src/events.rs
- **LOC:** 187
- **Purpose:** Event emission for epoch transitions, Carnage executions, and rebalancing. Provides indexing trail for tax/fund state.
- **Instructions/Functions:** N/A (event definitions)
- **Security Patterns:** Event emission for significant state changes
- **Focus Tags:** [STATE]
- **Risk:** Events don't enforce consistency; clients must correlate with on-chain reads

#### epoch-program/src/state/epoch_state.rs
- **LOC:** ~150
- **Purpose:** EpochState PDA storing current epoch number, tax rates, transition slot boundary, Carnage state machine, and VRF binding.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** State machine design (Carnage states: Idle, Triggered, Executed, Expired); VRF anti-reroll binding (randomness_account field); tax rate mutation per epoch
- **Focus Tags:** [STATE, ORACLE, TIMING]
- **Risk:** Carnage state machine has 4 states; transitions must be enforced strictly; VRF binding prevents reroll attacks but requires checking randomness account PDA and derivation

#### epoch-program/src/state/carnage_fund_state.rs
- **LOC:** ~100
- **Purpose:** CarnageFundState PDA storing Carnage holdings (CRIME, FRAUD, WSOL), SOL vault reference, and execution history.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Fund vault management; balance tracking
- **Focus Tags:** [STATE, TOKEN]
- **Risk:** Balances are snapshots (must be reloaded after swaps); no explicit invariant that reserves stay synchronized with actual token vault balances

#### epoch-program/src/state/enums.rs
- **LOC:** ~80
- **Purpose:** Enum definitions for Carnage state machine (Idle, Triggered, Executed, Expired) and Token (CRIME, FRAUD).
- **Instructions/Functions:** N/A (enum definitions)
- **Security Patterns:** State machine variant encoding
- **Focus Tags:** [STATE]
- **Risk:** Enum variants are serialized; changing them breaks deserialization of old state

#### epoch-program/src/helpers/carnage.rs
- **LOC:** 174
- **Purpose:** Pure math and helper functions for Carnage calculations: derive_carnage_amounts, check_carnage_threshold, flip_cheap_side.
- **Instructions/Functions:** derive_carnage_amounts, check_carnage_threshold, flip_cheap_side
- **Security Patterns:** VRF byte interpretation; threshold checks; proportional allocation
- **Focus Tags:** [ARITH, ORACLE]
- **Risk:** VRF byte interpretation is magic number-based (no standard encoding); if VRF output interpretation changes, all Carnage calculations shift; no explicit validation that Carnage threshold is 0-100 (checked indirectly)

#### epoch-program/src/helpers/carnage_execution.rs
- **LOC:** 906
- **Purpose:** Shared Carnage execution logic extracted from execute_carnage and execute_carnage_atomic. Contains CarnageAccounts struct, execute_carnage_core function, and 7 helper functions: partition_hook_accounts, burn_held_tokens, calculate_buy_amount, execute_swap, read_post_sell_balance, accumulate_swaps.
- **Instructions/Functions:** execute_carnage_core, partition_hook_accounts, burn_held_tokens, calculate_buy_amount, execute_swap (2x for buy/sell), read_post_sell_balance, accumulate_swaps
- **Security Patterns:** CRITICAL CPI DEPTH AT LIMIT: execute_carnage -> Tax::swap_exempt -> AMM::swap_sol_pool -> Token-2022::transfer_checked -> Transfer Hook::execute. DO NOT add CPI to swap path. Hook account partitioning for dual-mint swaps (input hooks vs output hooks). Token burn via cpi (Token-2022 burn_checked). PDA-signed swap_exempt CPI. Remaining_accounts handling for Token-2022. Cargo feature gating (devnet for program IDs).
- **Focus Tags:** [CPI, TOKEN, STATE, ARITH]
- **Risk:** **CRITICAL:** CPI depth is at Solana's 4-level limit. Any addition to swap path breaks on-chain. Hook account ordering is critical: input hook accounts first, then output hook accounts (Phase 52 bug fix). Burn operation decrements token supply (irreversible). Sell proceeds handling complex: WSOL balance read post-swap, then transferred as part of buy input (Phase 47 Carnage bug fix). SOL->WSOL wrap happens at CPI depth 0 (before swap chain), so doesn't increase depth. Slippage floors enforce minimum acceptable outputs (50% slippage cap). Pool reversal detection (Phase 52.1): is_reversed flag determines reserve semantics. Partition_hook_accounts splits 8 remaining_accounts into 4-each for input/output mints.

#### epoch-program/src/helpers/tax_derivation.rs
- **LOC:** ~80
- **Purpose:** Helper to derive Tax Program's swap_authority PDA from constant seed. Used by Carnage execution to sign CPI calls.
- **Instructions/Functions:** derive_swap_authority
- **Security Patterns:** PDA derivation with fixed seed (must match Tax Program's definition); bump caching
- **Focus Tags:** [STATE, CPI]
- **Risk:** PDA derivation must match Tax Program exactly; if seeds drift, CPI authorization fails

#### epoch-program/src/instructions/initialize_epoch_state.rs
- **LOC:** ~60
- **Purpose:** One-time genesis initialization of EpochState PDA with hardcoded genesis configuration: CRIME as cheap side, 3% low tax, 14% high tax.
- **Instructions/Functions:** handler
- **Security Patterns:** PDA initialization; Anchor init constraint prevents re-initialization
- **Focus Tags:** [STATE, ACCESS]
- **Risk:** Genesis configuration is immutable; all downstream behavior depends on correct genesis values

#### epoch-program/src/instructions/trigger_epoch_transition.rs
- **LOC:** ~100
- **Purpose:** Trigger VRF request for epoch transition. Validates epoch boundary, binds Switchboard randomness account, sets VRF state to Pending. Client must bundle with Switchboard SDK commitIx.
- **Instructions/Functions:** handler
- **Security Patterns:** Epoch boundary validation (current_slot >= next_epoch_boundary); Switchboard randomness account binding; anti-reroll protection (stores randomness_account PDA in epoch state); bounty payment from Carnage SOL vault
- **Focus Tags:** [ORACLE, STATE, TIMING]
- **Risk:** Epoch boundary check relies on Clock sysvar (not manipulable by user, but mutable by validator); randomness account must be freshly created (checked via seed_slot staleness); bounty is hardcoded 0.001 SOL (could fail if vault depleted)

#### epoch-program/src/instructions/consume_randomness.rs
- **LOC:** ~180
- **Purpose:** Consume revealed VRF randomness after Switchboard oracle reveals. Validates anti-reroll binding, reads VRF bytes, derives tax rates, updates EpochState. Client must bundle with Switchboard SDK revealIx.
- **Instructions/Functions:** handler
- **Security Patterns:** Anti-reroll protection (validates randomness_account matches bound account); VRF byte reading; tax rate derivation from VRF; epoch state mutation
- **Focus Tags:** [ORACLE, ARITH, STATE]
- **Risk:** VRF randomness is trusted from Switchboard (off-chain oracle); no fallback if oracle fails (except retry_epoch_vrf for timeout); tax rate derivation is deterministic from VRF bytes (no entropy post-VRF)

#### epoch-program/src/instructions/retry_epoch_vrf.rs
- **LOC:** ~100
- **Purpose:** Timeout recovery if Switchboard oracle fails to reveal (waits VRF_TIMEOUT_SLOTS = 300 slots). Creates fresh randomness account, unbinds stale account, retries epoch.
- **Instructions/Functions:** handler
- **Security Patterns:** Timeout validation (slot >= timeout boundary); fresh randomness account creation; anti-reroll rebinding
- **Focus Tags:** [ORACLE, STATE, TIMING]
- **Risk:** Requires user to detect timeout and call manually (not automated); VRF_TIMEOUT_SLOTS is hardcoded (300 slots = ~2 minutes); fresh randomness may fail on different oracle if original oracle is down

#### epoch-program/src/instructions/execute_carnage.rs
- **LOC:** ~250
- **Purpose:** Fallback Carnage execution when execute_carnage_atomic exceeds compute budget. Calls execute_carnage_core with both paths invoked via Tax::swap_exempt. Handles buy and sell rebalancing.
- **Instructions/Functions:** handler
- **Security Patterns:** Carnage state validation (must be Triggered); CPI to Tax Program; execute_carnage_core call; state machine transition (Triggered -> Executed); fee sharing with cranks
- **Focus Tags:** [CPI, STATE, ARITH]
- **Risk:** Fallback due to compute limits; if execute_carnage_atomic fails, execute_carnage is slower alternative but still subject to CPI depth limits; Carnage state must be in Triggered state (enforced)

#### epoch-program/src/instructions/execute_carnage_atomic.rs
- **LOC:** ~250
- **Purpose:** Atomic Carnage execution in single instruction (preferred over fallback). Both buy and sell paths invoked via Tax::swap_exempt within same instruction.
- **Instructions/Functions:** handler
- **Security Patterns:** Same as execute_carnage but in single instruction (reduces transaction count); Carnage state validation
- **Focus Tags:** [CPI, STATE, ARITH]
- **Risk:** Preferred path but higher compute than fallback; may still hit limits on large swaps

#### epoch-program/src/instructions/force_carnage.rs
- **LOC:** ~80
- **Purpose:** Force Carnage execution even if Carnage state != Triggered. Used to manually trigger rebalancing in testing or emergency scenarios.
- **Instructions/Functions:** handler
- **Security Patterns:** No state machine validation (bypasses Triggered check); otherwise identical to execute_carnage
- **Focus Tags:** [STATE, ADMIN]
- **Risk:** **DANGEROUS:** Bypasses Carnage state machine; can be called multiple times per epoch; no access control (permissionless). Should only be exposed for testing/admin; not for production use.

#### epoch-program/src/instructions/expire_carnage.rs
- **LOC:** ~60
- **Purpose:** Transition Carnage state from Triggered -> Expired if execution times out or is skipped. Prevents indefinite pending state.
- **Instructions/Functions:** handler
- **Security Patterns:** Timeout-based transition; state machine consistency
- **Focus Tags:** [STATE, TIMING]
- **Risk:** Permissionless (anyone can call after timeout); timeout is hardcoded CARNAGE_TIMEOUT_SLOTS; if called too early, epoch is locked

#### epoch-program/src/instructions/initialize_carnage_fund.rs
- **LOC:** ~80
- **Purpose:** One-time initialization of Carnage Fund infrastructure: CarnageFundState PDA, CRIME/FRAUD/WSOL vaults, and SOL vault.
- **Instructions/Functions:** handler
- **Security Patterns:** PDA initialization; vault creation; Anchor init constraints prevent re-initialization
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Must be called after all token mints and pools are deployed; vaults are created empty (must be funded externally)

---

### Staking Program
**Purpose:** PROFIT token staking for SOL yield distribution. Uses cumulative reward-per-token pattern (Synthetix/Quarry) with instant unstake and separate claim instruction. First-depositor attack mitigation via 1 PROFIT dead stake.

**Statistics:** 18 files, 2,897 LOC, 6 instructions

---

#### staking/src/lib.rs
- **LOC:** 81
- **Purpose:** Entry point. Declares 6 instructions: initialize_stake_pool, stake, unstake, claim, deposit_rewards, update_cumulative.
- **Instructions/Functions:** [6 instruction handlers]
- **Security Patterns:** Stake pool initialization; user stake management; reward distribution; cumulative update triggers
- **Focus Tags:** [STATE, ARITH, TOKEN]
- **Risk:** Stake pool is singleton (PDA); all operations are serialized through it (no parallelism)

#### staking/src/constants.rs
- **LOC:** 202
- **Purpose:** Reward distribution constants: MINIMUM_STAKE (1 PROFIT), epoch duration, reward rate, tax program ID, seeds.
- **Instructions/Functions:** N/A (constants)
- **Security Patterns:** MINIMUM_STAKE as dead stake prevents first-depositor attack; hardcoded TAX_PROGRAM_ID for authorization
- **Focus Tags:** [STATE, ACCESS]
- **Risk:** MINIMUM_STAKE is immutable (hardcoded); if changed, all future stakes have new floor

#### staking/src/errors.rs
- **LOC:** 117
- **Purpose:** 13 error types covering stake validation, reward math, authorization.
- **Instructions/Functions:** N/A (error definitions)
- **Security Patterns:** Error codes and descriptions
- **Focus Tags:** [STATE]
- **Risk:** Error codes are immutable

#### staking/src/events.rs
- **LOC:** 175
- **Purpose:** Event types for stake/unstake/claim/deposit actions. Provides audit trail.
- **Instructions/Functions:** N/A (event definitions)
- **Security Patterns:** Event emission for all user actions
- **Focus Tags:** [STATE]
- **Risk:** Events don't enforce consistency

#### staking/src/state/stake_pool.rs
- **LOC:** ~120
- **Purpose:** StakePool PDA (singleton). Stores total staked, cumulative reward rate, total rewards distributed, and initialization flag.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Singleton PDA (no duplicates); cumulative reward-per-token accounting
- **Focus Tags:** [STATE, ARITH]
- **Risk:** Singleton means all operations are serialized; cumulative rate grows monotonically (no reset); overflow possible if cumulative rate grows beyond u128

#### staking/src/state/user_stake.rs
- **LOC:** ~100
- **Purpose:** UserStake PDA per staker. Stores amount staked, last earned cumulative rate checkpoint, and accumulated rewards.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Per-user checkpointing (prevents claiming same epoch twice); reward accumulation tracking
- **Focus Tags:** [STATE, ARITH]
- **Risk:** User data is keyed by user pubkey; if user has multiple wallets, they create separate UserStake accounts (no merging); reward tracking is off-chain (on-chain only stores checkpoint)

#### staking/src/helpers/math.rs
- **LOC:** 755
- **Purpose:** Pure math functions for reward calculations: calculate_cumulative_rate, calculate_user_rewards, validate_amounts.
- **Instructions/Functions:** calculate_cumulative_rate, calculate_pending_rewards, apply_yield, calculate_unstake_amount
- **Security Patterns:** Checked arithmetic; u128 intermediate values for precision; reward calculation using cumulative rate
- **Focus Tags:** [ARITH]
- **Risk:** Cumulative rate uses u128 (large precision); user rewards use u64 (fits in SOL lamports); rounding down (dust stays in pool); first-depositor attack mitigated by MINIMUM_STAKE but not if dead stake is burned

#### staking/src/helpers/mod.rs
- **LOC:** 10
- **Purpose:** Module re-exports.
- **Instructions/Functions:** N/A
- **Security Patterns:** None
- **Focus Tags:** []
- **Risk:** None

#### staking/src/helpers/transfer.rs
- **LOC:** ~80
- **Purpose:** Transfer helper for PROFIT and SOL. Uses Anchor's CpiContext for both SPL and Token-2022.
- **Instructions/Functions:** transfer_profit_checked, transfer_sol_to_user
- **Security Patterns:** Token program validation; amount checking; Anchor CPI
- **Focus Tags:** [CPI, TOKEN]
- **Risk:** Uses Anchor's CpiContext (not manual invoke_signed), so may miss hook accounts if PROFIT has Transfer Hook extension (PROFIT is Token-2022 with MetadataPointer, may have hooks in future)

#### staking/src/instructions/initialize_stake_pool.rs
- **LOC:** ~100
- **Purpose:** One-time initialization of StakePool and vaults. Transfers MINIMUM_STAKE (1 PROFIT) as dead stake.
- **Instructions/Functions:** handler
- **Security Patterns:** PDA initialization; dead stake transfer; Anchor init constraint
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Dead stake is irreversible (burned into system); if MINIMUM_STAKE is too large, creates large opportunity cost

#### staking/src/instructions/stake.rs
- **LOC:** ~120
- **Purpose:** Stake PROFIT tokens. Creates UserStake if first stake. Updates reward checkpoint before balance change (prevents claiming same epoch twice).
- **Instructions/Functions:** handler
- **Security Patterns:** Reward checkpoint update; user account initialization; balance tracking
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Flash loan resistant via checkpoint mechanism (stake/unstake same epoch = zero rewards); no minimum stake amount per user (MINIMUM_STAKE is global dead stake, not per-user minimum)

#### staking/src/instructions/unstake.rs
- **LOC:** ~140
- **Purpose:** Unstake PROFIT and auto-claim pending rewards. If partial unstake would leave < MINIMUM_STAKE, does full unstake instead.
- **Instructions/Functions:** handler
- **Security Patterns:** Partial/full unstake logic; auto-claim; reward calculation before balance change
- **Focus Tags:** [TOKEN, STATE, ARITH]
- **Risk:** MINIMUM_STAKE floor is checked on remainder; if user stakes < MINIMUM_STAKE worth of value, they must unstake entirely; auto-claim is forced (no opt-out)

#### staking/src/instructions/claim.rs
- **LOC:** ~100
- **Purpose:** Claim pending SOL rewards without unstaking. Transfers accumulated SOL from escrow to user.
- **Instructions/Functions:** handler
- **Security Patterns:** Reward calculation; escrow transfer; user authorization (signer)
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Claim-only path allows users to stake indefinitely; no forced unstaking for idle accounts

#### staking/src/instructions/deposit_rewards.rs
- **LOC:** ~80
- **Purpose:** Called by Tax Program to deposit SOL yield portion (71% of taxes) into escrow. Updates cumulative reward rate.
- **Instructions/Functions:** handler
- **Security Patterns:** Tax Program authorization check; reward rate update; SOL transfer from escrow (not user)
- **Focus Tags:** [STATE, ARITH, ACCESS]
- **Risk:** Tax Program must be trusted (no signature check, only signer validation); if Tax Program is compromised, arbitrary SOL can be added to escrow

#### staking/src/instructions/update_cumulative.rs
- **LOC:** ~80
- **Purpose:** Called by Epoch Program at epoch boundary to finalize cumulative reward rate. Allows claim/unstake in next epoch.
- **Instructions/Functions:** handler
- **Security Patterns:** Epoch Program authorization check; cumulative rate finalization
- **Focus Tags:** [STATE, ARITH, ACCESS]
- **Risk:** Epoch Program must be trusted; if called multiple times per epoch, may double-count rewards

#### staking/src/instructions/test_helpers.rs
- **LOC:** ~100
- **Purpose:** Testing helpers (likely stubbed for production).
- **Instructions/Functions:** [test helpers]
- **Security Patterns:** Test-only code
- **Focus Tags:** []
- **Risk:** **ENSURE TEST CODE IS EXCLUDED FROM PRODUCTION BUILDS.** If test_helpers instruction is exposed, attackers can manipulate stake pool state.

---

### Bonding Curve Program
**Purpose:** Linear price discovery (P_START=450 lamports, P_END=1725 lamports per human token) for CRIME and FRAUD tokens. Two independent curves with per-wallet caps (50 SOL), 15% sell-back tax, and automatic graduation to AMM pools after deadline.

**Statistics:** 22 files, 4,911 LOC, 14 instructions

---

#### bonding_curve/src/lib.rs
- **LOC:** 100
- **Purpose:** Entry point. Declares 14 instructions: initialize_bc_admin, transfer_bc_admin, burn_bc_admin, initialize_curve, fund_curve, start_curve, purchase, sell, mark_failed, prepare_transition, complete_transition, claim_refund, consolidate_for_refund, distribute_tax_escrow, close_token_vault, withdraw_graduated_sol.
- **Instructions/Functions:** [14 instruction handlers]
- **Security Patterns:** Admin authority gating; curve state machine; token/SOL transfer routing
- **Focus Tags:** [ADMIN, STATE, TOKEN]
- **Risk:** 14 distinct instructions create large attack surface; state machine has multiple transitions; per-wallet caps require tracking

#### bonding_curve/src/constants.rs
- **LOC:** 241
- **Purpose:** Pricing constants (P_START=450, P_END=1725), TOTAL_FOR_SALE (460M tokens), per-wallet cap (50 SOL), sell-back tax (15%), deadline offsets, seeds.
- **Instructions/Functions:** N/A (constants)
- **Security Patterns:** Hardcoded pricing curve; capacity limits
- **Focus Tags:** [STATE, ARITH]
- **Risk:** All pricing is hardcoded; if economics need adjustment, requires new program deployment; TOTAL_FOR_SALE is immutable (determines maximum tokens available)

#### bonding_curve/src/error.rs
- **LOC:** 135
- **Purpose:** 21 error types covering curve state, fund transitions, capacity caps, authorization.
- **Instructions/Functions:** N/A (error definitions)
- **Security Patterns:** Explicit error codes
- **Focus Tags:** [STATE]
- **Risk:** Error codes are immutable

#### bonding_curve/src/events.rs
- **LOC:** 184
- **Purpose:** Event types for purchases, sells, curve transitions, refunds. Provides audit trail for price discovery.
- **Instructions/Functions:** N/A (event definitions)
- **Security Patterns:** Event emission
- **Focus Tags:** [STATE]
- **Risk:** Events don't enforce consistency

#### bonding_curve/src/state.rs
- **LOC:** ~180
- **Purpose:** CurveState PDA (per token: CRIME or FRAUD). Stores pricing state, cumulative tokens sold, wallet purchase history, status (Initialized/Active/Filled/Graduated/Failed).
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** State machine design (6 states); per-wallet purchase tracking; token/SOL vault references
- **Focus Tags:** [STATE, ARITH]
- **Risk:** Per-wallet history stored as vec (unbounded size risk if cap is high); state transitions must be strict (no skipping states)

#### bonding_curve/src/math.rs
- **LOC:** ~450
- **Purpose:** Pure math for linear pricing curve: calculate_tokens_out (SOL -> tokens via quadratic formula), calculate_sol_for_tokens (tokens -> SOL via linear integral), get_current_price.
- **Instructions/Functions:** calculate_tokens_out, calculate_sol_for_tokens, get_current_price, validate_price_monotonicity
- **Security Patterns:** u128 intermediate values; closed-form quadratic solution; precision scaling (PRECISION=1e12); checked arithmetic
- **Focus Tags:** [ARITH]
- **Risk:** **CRITICAL PRECISION NOTE:** P_START and P_END are in lamports per HUMAN token (not base units). TOTAL_FOR_SALE is in BASE UNITS (460M * 10^6). TOKEN_DECIMALS (10^6) bridges the gap. All integrals must divide by TOKEN_DECIMALS to produce correct lamport values. Rounding is floor (protocol-favored, users get slightly fewer tokens). Overflow analysis shows quadratic discriminant fits in u128 (verified). Full-curve integral is ~500.25 SOL (not exactly 500) due to rounding of P_START.

#### bonding_curve/src/instructions/initialize_bc_admin.rs
- **LOC:** ~60
- **Purpose:** One-time initialization of BcAdminConfig PDA by upgrade authority.
- **Instructions/Functions:** handler
- **Security Patterns:** Upgrade authority check; PDA initialization
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Upgrade authority is sole gatekeeper; once set, admin is locked in

#### bonding_curve/src/instructions/transfer_bc_admin.rs
- **LOC:** ~65
- **Purpose:** Transfer admin authority to new pubkey (e.g., multisig). Rejects Pubkey::default().
- **Instructions/Functions:** handler
- **Security Patterns:** Current admin signer check; default rejection
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Irreversible once accepted by new admin

#### bonding_curve/src/instructions/burn_bc_admin.rs
- **LOC:** 44
- **Purpose:** Permanently burn admin key (sets to Pubkey::default()). After burn, all admin-gated instructions become uncallable.
- **Instructions/Functions:** handler
- **Security Patterns:** Current admin signer check; PDA mutation
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** **BLOCKING RULE: NO AUTHORITY BURN WITHOUT EXPLICIT WRITTEN CONFIRMATION FROM mlbob.** This is irreversible.

#### bonding_curve/src/instructions/initialize_curve.rs
- **LOC:** ~120
- **Purpose:** Initialize CurveState PDA for CRIME or FRAUD. Creates curve in Initialized status with zero counters. Also creates token vault, SOL vault, and tax escrow PDAs. Admin-only.
- **Instructions/Functions:** handler
- **Security Patterns:** Admin authorization; PDA initialization; vault creation
- **Focus Tags:** [ACCESS, STATE, TOKEN]
- **Risk:** Admin-only; vaults are created empty (must be funded externally)

#### bonding_curve/src/instructions/fund_curve.rs
- **LOC:** ~100
- **Purpose:** Fund curve's token vault with 460M tokens for sale. Must be called after initialize_curve and before start_curve. Handles Token-2022 hooks via remaining_accounts.
- **Instructions/Functions:** handler
- **Security Patterns:** Vault population; remaining_accounts for hooks; atomic fund transfer
- **Focus Tags:** [TOKEN, CPI]
- **Risk:** If called with wrong amount, curve is misconfigured (no automatic rebalancing); hooks must be included in remaining_accounts or token transfer fails

#### bonding_curve/src/instructions/start_curve.rs
- **LOC:** ~80
- **Purpose:** Activate curve: sets status to Active, records start_slot and deadline_slot. Validates full funding before activation. Admin-only.
- **Instructions/Functions:** handler
- **Security Patterns:** Vault balance validation; state machine transition; deadline calculation
- **Focus Tags:** [ACCESS, STATE]
- **Risk:** Once activated, curve is time-bounded (deadline is immutable); no pause/resume mechanism

#### bonding_curve/src/instructions/purchase.rs
- **LOC:** ~200
- **Purpose:** Purchase tokens from curve with SOL. Walks linear price curve forward, enforces per-wallet cap (50 SOL cumulative), minimum purchase. Handles Token-2022 hooks. User-callable.
- **Instructions/Functions:** handler
- **Security Patterns:** Wallet cap enforcement (per-user cumulative tracking); price calculation; minimum amount validation; slippage protection (minimum_tokens_out); remaining_accounts for hooks
- **Focus Tags:** [STATE, TOKEN, ARITH]
- **Risk:** Per-wallet cap is cumulative (once 50 SOL invested, user cannot buy more in that curve); price steps forward along linear curve (no revert); hooks must be included in remaining_accounts

#### bonding_curve/src/instructions/sell.rs
- **LOC:** ~180
- **Purpose:** Sell tokens back to curve for SOL minus 15% tax. Tax routed to escrow. Handles Token-2022 hooks. User-callable.
- **Instructions/Functions:** handler
- **Security Patterns:** Sell-back tax calculation (15%); escrow routing; price calculation; remaining_accounts for hooks
- **Focus Tags:** [STATE, TOKEN, ARITH]
- **Risk:** Sell-back is always at a loss (15% tax); incentivizes holding through graduation; hooks must be included

#### bonding_curve/src/instructions/mark_failed.rs
- **LOC:** ~80
- **Purpose:** Mark curve as Failed after deadline + grace buffer expires. Permissionless. Allows refund claims.
- **Instructions/Functions:** handler
- **Security Patterns:** Deadline + grace validation; state transition; permissionless
- **Focus Tags:** [STATE, TIMING]
- **Risk:** Permissionless means anyone can trigger; grace buffer is hardcoded; once marked Failed, refunds are available

#### bonding_curve/src/instructions/prepare_transition.rs
- **LOC:** ~100
- **Purpose:** Transition both curves from Filled to Graduated. Admin-only. Prepares for AMM pool launch.
- **Instructions/Functions:** handler
- **Security Patterns:** Dual curve validation; state machine transition; admin authorization
- **Focus Tags:** [ACCESS, STATE]
- **Risk:** Both curves must be Filled simultaneously; if one is still selling, transition fails; must be called before complete_transition

#### bonding_curve/src/instructions/complete_transition.rs
- **LOC:** ~150
- **Purpose:** Complete graduation: transfers remaining tokens to AMM, burns excess, unlocks SOL withdrawal. Admin-only.
- **Instructions/Functions:** handler
- **Security Patterns:** Token migration to AMM; burn of remaining tokens; SOL unlock
- **Focus Tags:** [ACCESS, TOKEN, STATE]
- **Risk:** Token burn is irreversible; SOL is unlocked for owner withdrawal; must follow prepare_transition

#### bonding_curve/src/instructions/claim_refund.rs
- **LOC:** 221
- **Purpose:** Claim refund if curve is Failed. Calculates user's proportional SOL return based on tokens bought. User-callable.
- **Instructions/Functions:** handler
- **Security Patterns:** Failed status validation; proportional calculation; SOL transfer
- **Focus Tags:** [STATE, ARITH]
- **Risk:** Refund is proportional (not full 1:1 exchange due to sell-back taxes); if multiple users claim, order matters (first claimers get full pro-rata, later claimers may face rounding issues)

#### bonding_curve/src/instructions/consolidate_for_refund.rs
- **LOC:** ~120
- **Purpose:** Consolidate multi-account token holdings into single account for refund claim. Users who sold back may have tokens in multiple accounts; this consolidates them.
- **Instructions/Functions:** handler
- **Security Patterns:** Token consolidation; multiple account handling
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Consolidation is manual (not automatic); users must call explicitly before claiming refund; if consolidation fails, claim fails

#### bonding_curve/src/instructions/distribute_tax_escrow.rs
- **LOC:** ~100
- **Purpose:** Distribute accumulated sell-back taxes from escrow to beneficiaries (treasury, Carnage, staking). Called post-transition or post-failure.
- **Instructions/Functions:** handler
- **Security Patterns:** Escrow fund distribution; multi-recipient routing
- **Focus Tags:** [STATE, TOKEN]
- **Risk:** Distribution percentages are hardcoded; if allocation is wrong, funds are misrouted (no recovery)

#### bonding_curve/src/instructions/close_token_vault.rs
- **LOC:** ~80
- **Purpose:** Close empty token vault after graduation (reclaim SOL rent). Must be called after all tokens are withdrawn.
- **Instructions/Functions:** handler
- **Security Patterns:** Empty vault validation; rent reclamation
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** If vault is not empty, close fails; must be called after migration/burn complete

#### bonding_curve/src/instructions/withdraw_graduated_sol.rs
- **LOC:** ~100
- **Purpose:** Withdraw accumulated SOL from curve's vault after graduation. Admin/owner-callable.
- **Instructions/Functions:** handler
- **Security Patterns:** Balance tracking; SOL transfer; post-transition validation
- **Focus Tags:** [STATE, TOKEN]
- **Risk:** Can only be called after graduation; if called before, fails; SOL is owner-claimable (no distribution mechanism)

---

### Transfer Hook Program
**Purpose:** Token-2022 transfer hook implementation for whitelist enforcement on CRIME, FRAUD, and PROFIT tokens. Manages WhitelistAuthority and per-address WhitelistEntry PDAs. Hook is invoked by Token-2022 during transfer_checked operations.

**Statistics:** 13 files, 884 LOC, 6 instructions

---

#### transfer-hook/src/lib.rs
- **LOC:** 80
- **Purpose:** Entry point. Declares 6 instructions: initialize_authority, add_whitelist_entry, transfer_authority, burn_authority, initialize_extra_account_meta_list, transfer_hook (CPI handler).
- **Instructions/Functions:** [6 instruction handlers]
- **Security Patterns:** Authority gating; whitelist management; hook execution
- **Focus Tags:** [ACCESS, TOKEN]
- **Risk:** Hook is invoked on every Token-2022 transfer; must be fast (compute-bounded); authority burn is irreversible

#### transfer-hook/src/errors.rs
- **LOC:** 66
- **Purpose:** 8 error types covering authorization, whitelist state, authority burns.
- **Instructions/Functions:** N/A (error definitions)
- **Security Patterns:** Explicit error codes
- **Focus Tags:** [STATE]
- **Risk:** Error codes are immutable

#### transfer-hook/src/events.rs
- **LOC:** 46
- **Purpose:** Event types for authority burns and whitelist updates.
- **Instructions/Functions:** N/A (event definitions)
- **Security Patterns:** Event emission
- **Focus Tags:** [STATE]
- **Risk:** Events don't enforce consistency

#### transfer-hook/src/state/whitelist_authority.rs
- **LOC:** ~80
- **Purpose:** WhitelistAuthority PDA storing current authority pubkey. Single global authority for all three token mints.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Single authority per mint (or global if shared); burn state (authority = None after burn)
- **Focus Tags:** [ACCESS, STATE]
- **Risk:** Single global authority (not per-mint); if authority is burned, all whitelisting becomes impossible (immutable whitelist)

#### transfer-hook/src/state/whitelist_entry.rs
- **LOC:** ~80
- **Purpose:** WhitelistEntry PDA per whitelisted address. Marks address as whitelisted for transfers.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Per-address PDA (derived from address + mint)
- **Focus Tags:** [STATE]
- **Risk:** Entry creation is one-way (no deletion, only burning authority disables additions)

#### transfer-hook/src/instructions/initialize_authority.rs
- **LOC:** 58
- **Purpose:** One-time initialization of WhitelistAuthority PDA by transaction signer. Any address can call (becomes authority).
- **Instructions/Functions:** handler
- **Security Patterns:** Signer authority (caller becomes authority); PDA initialization; Anchor init constraint
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Permissionless (any signer can initialize); authority is set to caller; if called by wrong entity, authority is wrong for lifetime

#### transfer-hook/src/instructions/add_whitelist_entry.rs
- **LOC:** 70
- **Purpose:** Add address to whitelist. Only callable by current WhitelistAuthority while authority is not burned.
- **Instructions/Functions:** handler
- **Security Patterns:** Authority signer check; burned authority validation; PDA initialization
- **Focus Tags:** [ACCESS, STATE]
- **Risk:** Permissionless after authority burn (any address can be added, but hook rejects transfers anyway); no removal mechanism (entries are permanent unless authority is burned and re-initialized)

#### transfer-hook/src/instructions/transfer_authority.rs
- **LOC:** ~70
- **Purpose:** Transfer whitelist authority to new pubkey (e.g., multisig vault). Current authority must sign. Rejects Pubkey::default().
- **Instructions/Functions:** handler
- **Security Patterns:** Current authority signer check; default rejection
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** Irreversible once accepted by new authority

#### transfer-hook/src/instructions/burn_authority.rs
- **LOC:** 65
- **Purpose:** Permanently burn whitelist authority (set to None). Makes whitelist immutable. Idempotent.
- **Instructions/Functions:** handler
- **Security Patterns:** Authority signer check (if authority exists); state mutation; idempotent
- **Focus Tags:** [ACCESS, ADMIN]
- **Risk:** **BLOCKING RULE: NO AUTHORITY BURN WITHOUT EXPLICIT WRITTEN CONFIRMATION FROM mlbob.** Irreversible. After burn, no new entries can be added, but existing entries continue to enforce.

#### transfer-hook/src/instructions/initialize_extra_account_meta_list.rs
- **LOC:** ~120
- **Purpose:** Initialize ExtraAccountMetaList PDA for a mint. Token-2022 uses this to resolve whitelist accounts at transfer time. Must be called once per mint before transfers.
- **Instructions/Functions:** handler
- **Security Patterns:** Mint validation; authority not-burned check; PDA initialization; extra account meta encoding
- **Focus Tags:** [STATE, TOKEN]
- **Risk:** Must be called exactly once per mint; if called multiple times, fails (Anchor init constraint); if never called, transfers fail when hook is invoked

#### transfer-hook/src/instructions/transfer_hook.rs
- **LOC:** ~180
- **Purpose:** CPI handler invoked by Token-2022 during transfer_checked on whitelisted mints. Validates source and destination addresses are whitelisted.
- **Instructions/Functions:** handler
- **Security Patterns:** Discriminator-based dispatch (spl_discriminator); whitelist PDA lookup; address validation; no side effects (read-only validation)
- **Focus Tags:** [TOKEN, ACCESS]
- **Risk:** **CRITICAL SPEED CONSTRAINT:** Hook is invoked on every transfer; must execute within Solana's per-instruction compute budget. Current implementation reads WhitelistEntry PDAs (2 accounts, 2 reads). If implementation grows, may exceed budget and cause all transfers on whitelisted mints to fail. Whitelist lookup is O(1) PDA derivation (fast), not O(n) search (slow).

---

### Conversion Vault Program
**Purpose:** Fixed-rate 100:1 token conversions between CRIME/FRAUD and PROFIT. Leaf-node program: calls only Token-2022, receives no CPIs.

**Statistics:** 9 files, 543 LOC, 2 instructions

---

#### conversion-vault/src/lib.rs
- **LOC:** 36
- **Purpose:** Entry point. Declares 2 instructions: initialize, convert.
- **Instructions/Functions:** initialize, convert
- **Security Patterns:** Vault initialization; fixed-rate token swap
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Leaf-node (no CPIs); initialize is permissionless; convert rate is hardcoded

#### conversion-vault/src/constants.rs
- **LOC:** 68
- **Purpose:** Conversion rate constants (100:1), token decimals, PDA seeds, hardcoded mint addresses (devnet feature-gated).
- **Instructions/Functions:** N/A (constants)
- **Security Patterns:** Fixed rate (immutable); hardcoded mints (devnet only)
- **Focus Tags:** [STATE]
- **Risk:** Hardcoded mints are feature-gated but could be wrong if feature is misconfigured; conversion rate is immutable (no adjustment mechanism)

#### conversion-vault/src/error.rs
- **LOC:** 22
- **Purpose:** 3 error types: InvalidMint, InsufficientFunds, InvalidRate.
- **Instructions/Functions:** N/A (error definitions)
- **Security Patterns:** Explicit error codes
- **Focus Tags:** [STATE]
- **Risk:** Error codes are immutable

#### conversion-vault/src/state.rs
- **LOC:** ~80
- **Purpose:** VaultConfig PDA storing initialization flag and vault token account references.
- **Instructions/Functions:** N/A (account struct)
- **Security Patterns:** Single global vault config
- **Focus Tags:** [STATE]
- **Risk:** Singleton (one vault per program); all conversions use same vault accounts

#### conversion-vault/src/instructions/initialize.rs
- **LOC:** ~100
- **Purpose:** One-time vault initialization. Creates VaultConfig PDA and 3 token accounts (CRIME, FRAUD, PROFIT).
- **Instructions/Functions:** handler
- **Security Patterns:** PDA initialization; multiple token account creation; Anchor init constraint
- **Focus Tags:** [TOKEN, STATE]
- **Risk:** Permissionless (any signer can initialize); token accounts are created empty (must be funded externally)

#### conversion-vault/src/instructions/convert.rs
- **LOC:** 174
- **Purpose:** Convert tokens at fixed 100:1 rate. Supports 4 paths: CRIME->PROFIT, FRAUD->PROFIT, PROFIT->CRIME, PROFIT->FRAUD. Transfers from user to vault, then vault to user (atomic).
- **Instructions/Functions:** handler
- **Security Patterns:** Bidirectional path support; fixed rate calculation; token transfer routing; vault balance management
- **Focus Tags:** [TOKEN, ARITH]
- **Risk:** Fixed rate of 100:1 (immutable); no market discovery mechanism; vault must hold sufficient tokens for all conversion paths (could run out if demand is skewed); transfers are atomic (both succeed or both fail)

#### conversion-vault/src/helpers/hook_helper.rs
- **LOC:** 90
- **Purpose:** Helper to handle Token-2022 Transfer Hook accounts. Resolves ExtraAccountMetaList and whitelist PDAs.
- **Instructions/Functions:** resolve_hook_accounts, build_hook_cpi
- **Security Patterns:** Hook account resolution; remaining_accounts handling
- **Focus Tags:** [CPI, TOKEN]
- **Risk:** Transfer Hook accounts are resolved but not validated (assumes correct resolution); if resolution is wrong, CPI fails

#### conversion-vault/src/helpers/mod.rs
- **LOC:** 1
- **Purpose:** Module re-export.
- **Instructions/Functions:** N/A
- **Security Patterns:** None
- **Focus Tags:** []
- **Risk:** None

---

### Supporting Programs

#### stub-staking/src/lib.rs
- **LOC:** 201
- **Purpose:** Minimal testing stub for staking. Placeholder for integration testing without full staking logic.
- **Focus Tags:** [STATE]
- **Risk:** **TEST CODE — ENSURE EXCLUDED FROM PRODUCTION BUILDS.** If deployed to mainnet, breaks reward distribution.

#### stub-staking/src/state.rs
- **LOC:** 101
- **Purpose:** Stub state structures (StakePool, UserStake placeholders).
- **Focus Tags:** [STATE]
- **Risk:** Test code only

#### stub-staking/src/errors.rs
- **LOC:** 22
- **Purpose:** Stub error definitions.
- **Focus Tags:** [STATE]
- **Risk:** Test code only

#### mock-tax-program/src/lib.rs
- **LOC:** 117
- **Purpose:** Mock Tax Program for epoch-program testing. Responds to CPI calls without actual tax logic.
- **Focus Tags:** [STATE]
- **Risk:** **TEST CODE — ENSURE EXCLUDED FROM PRODUCTION BUILDS.** If deployed to mainnet, breaks tax distribution.

---

## Cross-Program Security Patterns

### CPI Chain Depth Critical Constraint
**MAXIMUM CPI DEPTH: 4 LEVELS**

The most critical CPI chain in the protocol is the Carnage execution swap path:
```
Epoch::execute_carnage
  -> Tax::swap_exempt (depth 1)
    -> AMM::swap_sol_pool (depth 2)
      -> Token-2022::transfer_checked (depth 3)
        -> Transfer Hook::execute (depth 4) [AT LIMIT]
```

**DO NOT add any CPI calls to the swap path.** This includes:
- No additional instruction calls within AMM::swap_sol_pool
- No additional validation CPIs within Tax::swap_exempt
- No additional token transfers within Epoch::execute_carnage (SOL->WSOL wrap is at depth 0, before swap chain)

If CPI depth limit is exceeded, all Carnage executions fail and epochs cannot complete.

### Authority Management
**BLOCKING RULE:** NO AUTHORITY MAY BE BURNED WITHOUT EXPLICIT WRITTEN CONFIRMATION FROM PROJECT OWNER (mlbob).

Authority burns include:
- AMM::burn_admin (AMM pool creation locked)
- Bonding Curve::burn_bc_admin (curve initialization locked)
- Transfer Hook::burn_authority (whitelist immutable, existing entries still enforce)

All authority burns are irreversible. Burned authorities cannot be recovered.

### Token Transfer Hooks (Token-2022)
**CRITICAL ISSUE:** Anchor's `CpiContext::with_remaining_accounts()` does NOT forward remaining_accounts through Token-2022's nested CPI to Transfer Hook program.

**SOLUTION:** Use manual `invoke_signed` with hook accounts appended to both `ix.accounts` AND `account_infos`:
```rust
// Incorrect (Anchor CPI):
token_interface::transfer_checked(
    cpi_ctx.with_remaining_accounts(hook_accounts),
    amount,
    decimals
)

// Correct (manual invoke_signed):
let mut ix = spl_token_2022::instruction::transfer_checked(...);
for account in hook_accounts {
    ix.accounts.push(AccountMeta {...});
}
let mut account_infos = vec![from, mint, to, authority];
for account in hook_accounts {
    account_infos.push(account);
}
invoke_signed(&ix, &account_infos, signer_seeds)?;
```

Used by:
- AMM::helpers::transfers::transfer_t22_checked
- Staking::helpers::transfer (may need update if PROFIT gains hooks)

### VRF Integration (Switchboard On-Demand)
**ANTI-REROLL PROTECTION:** VRF randomness is bound to EpochState via randomness_account PDA. If VRF request is retried with different randomness account, on-chain validation catches the switch and rejects.

**TIMEOUT RECOVERY:** If oracle fails to reveal within VRF_TIMEOUT_SLOTS (300 slots = ~2 minutes), user can call retry_epoch_vrf to create fresh randomness and retry.

**VRF GATEWAY ROTATION DOES NOT WORK:** Each randomness account is assigned to a specific oracle. Alternative gateways serve different oracles whose signatures fail on-chain (error 0x1780). Only retry the default gateway. If oracle is down, use timeout recovery.

### Arithmetic Safety Patterns
All math operations use checked variants:
- `checked_add`, `checked_sub`, `checked_mul`, `checked_div`
- Return `Option<T>` (never panic)
- Mapped to explicit error codes at instruction level
- No `as` casts without overflow protection
- u128 intermediate values for multiplication headroom

Overflow analysis examples:
- AMM swap math: reserve_a * reserve_b fits in u128 (at 2B max supply per token)
- Bonding curve quadratic: discriminant fits in u128 (verified for worst case)
- Staking cumulative rate: grows monotonically in u128 (no reset mechanism)

---

## Audit Focus Recommendations by Tag

### [ACCESS] (13 files)
**Priority: CRITICAL**

Access control is implemented via:
- Signer checks (transaction must be signed by authority)
- PDA derivation and validation (account ownership)
- Admin config PDAs (authorize specific operations)
- Anchor `constraint = authority.key() == expected` (declarative)

Key risk areas:
- Authority transfers to wrong address (irreversible)
- Authority burns without confirmation (irreversible)
- Bypassed signer checks (Unauthorized error catch-all)

Files:
- amm/lib.rs, state/admin.rs, instructions/initialize_admin.rs, transfer_admin.rs, burn_admin.rs
- bonding_curve/lib.rs, instructions/initialize_bc_admin.rs, transfer_bc_admin.rs, burn_bc_admin.rs
- transfer-hook/state/whitelist_authority.rs, instructions/initialize_authority.rs, transfer_authority.rs, burn_authority.rs
- epoch-program/lib.rs

### [ARITH] (15 files)
**Priority: CRITICAL**

Arithmetic is implemented with checked variants and u128 intermediates. All math is pure functions (testable without Solana VM).

Key risk areas:
- Integer division rounding (dust accumulation)
- Overflow on large inputs
- Division-by-zero (checked by guard conditions, not in math functions)
- Percentage/fee calculations (must sum correctly)

Files:
- amm/helpers/math.rs (5 swap functions)
- tax-program/helpers/tax_math.rs
- epoch-program/helpers/carnage.rs
- staking/helpers/math.rs
- bonding_curve/math.rs
- conversion-vault/instructions/convert.rs
- tax-program/instructions/swap_sol_buy.rs, swap_sol_sell.rs
- epoch-program/instructions/consume_randomness.rs

### [CPI] (16 files)
**Priority: CRITICAL**

CPI depth is at the absolute limit (4 levels for swap path). All CPI uses:
- CpiContext (Anchor) or invoke_signed (manual) with proper account ordering
- Signer seeds for PDA-signed calls
- Remaining_accounts for Token-2022 Transfer Hook support
- Error handling (require! for authorization checks)

Key risk areas:
- CPI depth exceeds limit (causes compute failure)
- Missing hook accounts (Token-2022 transfer fails with AccountNotEnoughKeys)
- Wrong signer seeds (signature validation fails)
- Wrong account ordering (mismatched expectations in downstream program)

Files:
- amm/instructions/initialize_pool.rs, swap_sol_pool.rs
- amm/helpers/transfers.rs (manual invoke_signed for Token-2022)
- tax-program/instructions/swap_sol_buy.rs, swap_sol_sell.rs, swap_exempt.rs
- epoch-program/helpers/carnage_execution.rs
- staking/helpers/transfer.rs
- bonding_curve/instructions/purchase.rs, sell.rs, fund_curve.rs
- conversion-vault/instructions/convert.rs
- transfer-hook/instructions/transfer_hook.rs

### [STATE] (All programs)
**Priority: HIGH**

State management includes:
- Account initialization (Anchor init constraint prevents re-init)
- State machine transitions (Idle -> Triggered -> Executed -> Expired)
- Invariant checking (k >= k_after in AMM, cumulative rate monotonic in staking)
- Immutable fields (pool mints, bonding curve pricing)

Key risk areas:
- State corruption (invalid transitions)
- Double-counting rewards (same epoch claimed twice)
- Stale data (not reloaded after CPI)
- Invariant violations (k decreases in AMM)

### [TOKEN] (18 files)
**Priority: CRITICAL**

Token operations include:
- SPL Token transfers (transfer_checked, no hooks)
- Token-2022 transfers (transfer_checked with hook support)
- Token burn (decrements supply, irreversible)
- Account initialization (rent-exempt)

Key risk areas:
- Wrong token program (SPL vs Token-2022 mismatch)
- Missing hook accounts (Token-2022 fail)
- Zero-amount transfers (waste compute)
- Insufficient balance (transfer fails)

### [ORACLE] (6 files)
**Priority: HIGH**

Oracle integration (Switchboard VRF):
- Anti-reroll protection (randomness_account binding)
- Timeout recovery (retry_epoch_vrf)
- Fallback mechanism (execute_carnage vs execute_carnage_atomic)
- Byte interpretation (VRF -> tax rates)

Key risk areas:
- Stale randomness (seed_slot too old)
- Failed revelation (oracle timeout)
- Wrong oracle (gateway routing fails)
- Byte interpretation drift (VRF decoding changes)

### [TIMING] (7 files)
**Priority: MEDIUM**

Time-dependent logic:
- Epoch boundaries (slot-based, not timestamp)
- VRF timeout (300 slots = ~2 minutes)
- Bonding curve deadline (activation + duration)
- Grace buffer (deadline + grace before Failed mark)

Key risk areas:
- Slot boundary crossing (epoch transition at wrong time)
- Timeout expiration (timeout detection)
- Deadline validation (curve state transitions)

### [ADMIN] (8 files)
**Priority: CRITICAL**

Administrative functions:
- Pool creation (AMM::initialize_pool)
- Curve initialization (Bonding::initialize_curve)
- Authority transfers (all programs)
- Authority burns (irreversible)
- Squads multisig governance (future: Phase 97+)

Key risk areas:
- Authority compromised (keylogger, phishing)
- Authority burn without confirmation
- Multisig signature ordering (Squads requirement)
- Timelock duration (governance decision)

---

## Testing Gaps & Known Issues

### Ignored Tests
- 3 LiteSVM tests in epoch-program (Phase 52.1 read_pool_reserves is_reversed bug with non-NATIVE_MINT pools, carried to v1.4)

### Deployment Gaps (Tracked as DEPLOY-GAP-01)
- BcAdminConfig deploy not automated in initialize.ts (Squads migration pending)

### Future Work
- Arweave metadata gateway (via gateway.irys.xyz, not arweave.net which is broken)
- Protocol-owned arbitrage (Phase 101+, Carnage fund arb spread capture)
- USDC pool pairs (future expansion, parallel AMM stack)
- Jupiter aggregator listing (requires Tax Program routing hook, Phase 101 deferred)

---

## Audit Coverage Summary

| Focus Area | Files | Risk Level | Status |
|-----------|-------|-----------|--------|
| ACCESS | 13 | CRITICAL | AUDITED |
| ARITH | 15 | CRITICAL | AUDITED |
| CPI | 16 | CRITICAL | AUDITED (depth at limit) |
| STATE | 105 | HIGH | AUDITED |
| TOKEN | 18 | CRITICAL | AUDITED (hooks validated) |
| ORACLE | 6 | HIGH | AUDITED (VRF robust) |
| TIMING | 7 | MEDIUM | AUDITED |
| ADMIN | 8 | CRITICAL | AUDITED (awaiting Squads) |

**Last Updated:** Phase 102 (2026-03-21)
**Created By:** Claude Code Security Audit Framework
