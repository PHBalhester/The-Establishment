# Entities Cross-Reference Matrix

**Generated:** 2026-02-01
**Source:** 00-concept-inventory.md (ENT-XXX entries)

## Normalization Rules

- Token names: CRIME, FRAUD, PROFIT, WSOL, SOL (use consistent capitalization)
- Pool names: CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT (use forward slash)
- Account types: Use CamelCase for PDA names (EpochState, CarnageFund)

---

## Entities Matrix

### ENT-001: CRIME Token

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | Token-2022 with transfer hook | Section "Token Structure" | "CRIME" listed as one of three tokens |
| Tax_Pool_Logic_Spec.md | IP token A | Throughout | Referenced in tax and swap contexts |
| Epoch_State_Machine_Spec.md | Token enum member | Section 4.2 | "Token::CRIME" enum variant |
| AMM_Implementation.md | Token-2022 | Section 3.1 | "CRIME - Token-2022, has hook" |
| Carnage_Fund_Spec.md | IP token | Throughout | Carnage can buy/burn CRIME |
| Yield_System_Spec.md | - | - | Not directly mentioned (focuses on PROFIT) |
| Soft_Peg_Arbitrage_Spec.md | IP token | Throughout | Part of arbitrage loop |
| Bonding_Curve_Spec.md | 1B total supply | Section 3.1 | "Total Supply: 1,000,000,000 (100%)" |
| Transfer_Hook_Spec.md | Transfer hook protected | Section 1 | "CRIME, FRAUD, and PROFIT tokens" |
| Token_Program_Reference.md | Token-2022 | Section 1, 5.2 | "CRIME - Token-2022 - Full hook coverage" |
| Protocol_Initialization.md | Token-2022 mint | Section 7 | Mint creation with transfer hook |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** All documents consistently describe CRIME as a Token-2022 token with transfer hook. 1B total supply. Part of the twin IP token pair.

---

### ENT-002: FRAUD Token

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | Token-2022 with transfer hook | Section "Token Structure" | "FRAUD" listed as one of three tokens |
| Tax_Pool_Logic_Spec.md | IP token B | Throughout | Referenced in tax and swap contexts |
| Epoch_State_Machine_Spec.md | Token enum member | Section 4.2 | "Token::FRAUD" enum variant |
| AMM_Implementation.md | Token-2022 | Section 3.1 | "FRAUD - Token-2022, has hook" |
| Carnage_Fund_Spec.md | IP token | Throughout | Carnage can buy/burn FRAUD |
| Yield_System_Spec.md | - | - | Not directly mentioned |
| Soft_Peg_Arbitrage_Spec.md | IP token | Throughout | Part of arbitrage loop |
| Bonding_Curve_Spec.md | 1B total supply | Section 3.1 | "Total Supply: 1,000,000,000 (100%)" |
| Transfer_Hook_Spec.md | Transfer hook protected | Section 1 | "CRIME, FRAUD, and PROFIT tokens" |
| Token_Program_Reference.md | Token-2022 | Section 1, 5.2 | "FRAUD - Token-2022 - Full hook coverage" |
| Protocol_Initialization.md | Token-2022 mint | Section 7 | Mint creation with transfer hook |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Identical to CRIME in structure. Both IP tokens are interchangeable except for their tax regime assignment (cheap vs expensive side).

---

### ENT-003: PROFIT Token

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | Yield-bearing, Token-2022 | Section "Token Structure" | "PROFIT (yield-bearing)" |
| Tax_Pool_Logic_Spec.md | - | - | Mentioned only in pool context |
| Epoch_State_Machine_Spec.md | - | - | Not directly mentioned |
| AMM_Implementation.md | Token-2022 | Section 3.1 | "PROFIT - Token-2022, has hook" |
| Carnage_Fund_Spec.md | - | - | Not involved in Carnage |
| Yield_System_Spec.md | 50M fixed supply | Throughout | Central focus: "PROFIT's value proposition depends entirely on reliable yield distribution" |
| Soft_Peg_Arbitrage_Spec.md | Intermediary token | Throughout | "CRIME and FRAUD are softly pegged through PROFIT" |
| Bonding_Curve_Spec.md | 50M total supply | Section 3.5 | "100% allocated to pool seeding, no bonding curve" |
| Transfer_Hook_Spec.md | Transfer hook protected | Section 1 | "CRIME, FRAUD, and PROFIT tokens" |
| Token_Program_Reference.md | Token-2022 | Section 1, 5.2 | "PROFIT - Token-2022 - Full hook coverage" |
| Protocol_Initialization.md | Token-2022 mint | Section 7 | Mint creation with transfer hook |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** 50M fixed supply. No bonding curve (100% goes to pool seeding). Earns 75% of taxes as yield. Token-2022 with transfer hook.

---

### ENT-004: WSOL (Wrapped SOL)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Token_Program_Reference.md | SPL Token (NOT Token-2022) | Section 3.1 | "WSOL uses SPL Token Program (NOT Token-2022)" - CRITICAL |
| AMM_Implementation.md | SPL Token | Section 3.1, 9.1 | "SOL - WSOL (wrapped) - SPL Token Program - No hook" |
| Transfer_Hook_Spec.md | No hook protection | Section 4 note | "WSOL uses SPL Token program (not Token-2022) and has no transfer hook support" |
| DrFraudsworth_Overview.md | - | - | Refers to "SOL" not "WSOL" specifically |
| Tax_Pool_Logic_Spec.md | - | - | Refers to "SOL" generically |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | SOL vault | Section 4.3 | Uses native SOL, not WSOL |
| Yield_System_Spec.md | - | - | SOL yield, not WSOL specific |
| Soft_Peg_Arbitrage_Spec.md | - | - | Refers to SOL generically |
| Bonding_Curve_Spec.md | - | - | Raises SOL, not WSOL specific |
| Protocol_Initialization.md | - | - | References WSOL mint address |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT (CRITICAL)
**Notes:** WSOL is the native mint (So111...) owned by original SPL Token program. This is the critical fact from v3 failure. WSOL has NO transfer hook support. Pool security for WSOL side relies on AMM access control.

---

### ENT-005: EpochState Account

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Epoch_State_Machine_Spec.md | Global singleton PDA | Section 4.1 | Full struct definition with 61+ bytes, seeds = ["epoch_state"] |
| Tax_Pool_Logic_Spec.md | Referenced for tax reads | Section 10 | "Swap instructions read from EpochState" |
| Carnage_Fund_Spec.md | Contains Carnage pending flags | Section 4 | References carnage_pending, carnage_target in EpochState |
| DrFraudsworth_Overview.md | - | - | Not mentioned by name |
| AMM_Implementation.md | - | - | Not mentioned (AMM is epoch-agnostic) |
| Yield_System_Spec.md | Referenced for epoch number | Section 7.3 | update_cumulative reads epoch_state |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | Initialized in Phase 4 | Section 8 | "Initialize Epoch State" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Single global PDA governing all pools. Seeds = ["epoch_state"]. Stores tax config, VRF state, Carnage state.

---

### ENT-006: CarnageFundState Account

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Carnage_Fund_Spec.md | PDA with SOL/CRIME/FRAUD vaults | Section 4.1 | Full struct definition, seeds = ["carnage_fund"] |
| Epoch_State_Machine_Spec.md | Referenced in VRF callback | Section 8.3 | carnage_fund account in vrf_callback |
| DrFraudsworth_Overview.md | - | - | Mentions Carnage Fund concept, not account |
| Tax_Pool_Logic_Spec.md | - | - | Mentions Carnage Fund as tax destination |
| AMM_Implementation.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | Carnage Fund PDA whitelisted | Section 4 | "Carnage Fund PDA - Holds IP tokens between triggers" |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | Initialized in Phase 4 | Section 8 | "Initialize Carnage Fund" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Owned by Epoch Program (Carnage logic is inline). Seeds = ["carnage_fund"]. Tracks held tokens and stats.

---

### ENT-007: YieldState Account

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | Global singleton PDA | Section 4.1 | Full struct definition, seeds = ["yield_state"] |
| DrFraudsworth_Overview.md | - | - | Mentions Merkle claims, not YieldState |
| Tax_Pool_Logic_Spec.md | Referenced for yield deposit | Section 4 | "75% -> PROFIT Yield Escrow" |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned directly |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | Initialized in Phase 4 | Section 8 | "Initialize Yield System" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Yield_System_Spec.md defines fully)
**Notes:** Stores cumulative_yield_per_op4 (u128), pending_epoch_yield, etc. Seeds = ["yield_state"].

---

### ENT-008: UserYieldAccount

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | Per-user PDA | Section 4.4 | Full struct definition, seeds = ["user_yield", user_pubkey] |
| DrFraudsworth_Overview.md | - | - | Not mentioned |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | Created on first PROFIT purchase | Section 8 | init_if_needed pattern |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Yield_System_Spec.md)
**Notes:** User pays ~0.002 SOL rent on first PROFIT purchase. Stores last_claimed_cumulative checkpoint.

---

### ENT-009: Pool State Account

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| AMM_Implementation.md | PDA per pool | Section 4.2 | Seeds = ["pool", token_a_mint, token_b_mint] |
| DrFraudsworth_Overview.md | - | - | Mentions pools, not Pool account |
| Tax_Pool_Logic_Spec.md | Referenced in swap | Section 9 | Pool state read for reserves |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | target_pool in execute | Section 13.3 | Pool account for Carnage buy |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned by account name |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Pool vaults whitelisted, not Pool state |
| Token_Program_Reference.md | - | - | References pool sides, not Pool account |
| Protocol_Initialization.md | Created in Phase 4 | Section 8 | "Initialize all 4 pools" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (AMM_Implementation.md)
**Notes:** Stores pool type, mints, vaults, cached reserves, LP fee. Mints must be canonically ordered.

---

### ENT-010: WhitelistEntry Account

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Transfer_Hook_Spec.md | PDA marking whitelisted address | Section 5.2 | Seeds = ["whitelist", address], existence = whitelisted |
| DrFraudsworth_Overview.md | - | - | Mentions whitelist concept |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned (has its own whitelist) |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | 13 entries added in Phase 2 | Section 6 | "Add all 13 whitelist entries" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Transfer_Hook_Spec.md)
**Notes:** Existence-based PDA pattern. 10-13 addresses whitelisted before authority burn.

---

### ENT-011: CurveState Account

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Bonding_Curve_Spec.md | PDA per token | Section 5.1 | Full struct definition, seeds = ["curve", token_mint] |
| Protocol_Initialization.md | Initialized in Phase 5 | Section 9 | "Initialize curves" |
| DrFraudsworth_Overview.md | - | - | Mentions bonding curve concept |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | - | - | Not mentioned |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | Curve PDAs whitelisted | Section 4 | "Bonding Curve PDA" in whitelist |
| Token_Program_Reference.md | - | - | Not mentioned |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** SINGLE-SOURCE (Bonding_Curve_Spec.md)
**Notes:** One per token (CRIME, FRAUD). Tracks tokens_sold, sol_raised, status, deadline.

---

### ENT-012: Tax Program

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Tax_Pool_Logic_Spec.md | Program wrapping AMM swaps | Section 1 | "Provides swap_authority PDA that AMM requires" |
| AMM_Implementation.md | Caller of AMM via CPI | Section 15.1, 18 | "All swaps must route through Tax Program" |
| Epoch_State_Machine_Spec.md | Called for exempt swaps | Section 9 | Carnage uses tax_program::swap_exempt |
| Carnage_Fund_Spec.md | Provides exempt swap | Section 9.2, 18 | "swap_exempt instruction in Tax Program" |
| DrFraudsworth_Overview.md | - | - | Not mentioned by name |
| Yield_System_Spec.md | Deposits yield | Section 8.1 | "Tax Program must call Yield Program" |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | Provides swap_authority | Section 6.1 | "Tax Program PDA signature requirement" |
| Protocol_Initialization.md | Deployed in Phase 1 | Section 5 | "Deploy tax_program.so" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Critical component - all swaps route through Tax Program. Provides swap_authority PDA that AMM requires as signer.

---

### ENT-013: Epoch Program

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Epoch_State_Machine_Spec.md | Program managing epochs | Section 1 | Full specification |
| Carnage_Fund_Spec.md | Contains Carnage logic | Section 2 | "Carnage Fund is not a separate program. It is implemented... inline within the Epoch Program" |
| Yield_System_Spec.md | Calls update_cumulative | Section 8.2 | "Epoch Program must call update_cumulative during VRF callback" |
| DrFraudsworth_Overview.md | - | - | Not mentioned by name |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| AMM_Implementation.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Transfer_Hook_Spec.md | - | - | Not mentioned |
| Token_Program_Reference.md | - | - | Not mentioned |
| Protocol_Initialization.md | Deployed in Phase 1 | Section 5 | "Deploy epoch_program.so" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Manages epochs, VRF integration, tax regime, Carnage execution. Carnage Fund logic is inline (not separate program) due to CPI depth constraints.

---

### ENT-014: Transfer Hook Program

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Transfer_Hook_Spec.md | Program enforcing whitelist | Section 1 | Full specification |
| AMM_Implementation.md | Required for T22 transfers | Section 9.2 | "Must include... Transfer-hook program" |
| Token_Program_Reference.md | Configured on mints | Section 1 | "CRIME, FRAUD, PROFIT use Transfer Hook extension" |
| DrFraudsworth_Overview.md | Enforces restrictions | Section "Transfer Restrictions" | "Transfer hooks enforce that CRIME, FRAUD, and PROFIT may only be..." |
| Tax_Pool_Logic_Spec.md | - | - | Not mentioned |
| Epoch_State_Machine_Spec.md | - | - | Not mentioned |
| Carnage_Fund_Spec.md | Burns don't trigger | Section 10.3 | "Token-2022 burn instruction does not trigger transfer hooks" |
| Yield_System_Spec.md | - | - | Not mentioned |
| Soft_Peg_Arbitrage_Spec.md | - | - | Not mentioned |
| Bonding_Curve_Spec.md | - | - | Not mentioned |
| Protocol_Initialization.md | Deployed first | Section 5 | "Deploy transfer_hook.so" |
| SolanaSetup.md | - | - | Not mentioned |

**Status:** AGREEMENT
**Notes:** Single hook serves all three Token-2022 tokens. Shared whitelist. Authority burned after initialization.

---

## Summary Table

| Concept ID | Name | Status | Single-Source? | Key Properties |
|------------|------|--------|----------------|----------------|
| ENT-001 | CRIME Token | AGREEMENT | No | Token-2022, hook, 1B supply |
| ENT-002 | FRAUD Token | AGREEMENT | No | Token-2022, hook, 1B supply |
| ENT-003 | PROFIT Token | AGREEMENT | No | Token-2022, hook, 50M supply, yield |
| ENT-004 | WSOL | AGREEMENT (CRITICAL) | No | SPL Token (NOT T22), no hook |
| ENT-005 | EpochState | AGREEMENT | No | Global singleton, tax config |
| ENT-006 | CarnageFundState | AGREEMENT | No | Owned by Epoch Program |
| ENT-007 | YieldState | SINGLE-SOURCE | Yes | Cumulative yield tracking |
| ENT-008 | UserYieldAccount | SINGLE-SOURCE | Yes | Per-user checkpoint |
| ENT-009 | Pool State | SINGLE-SOURCE | Yes | Per-pool reserves/config |
| ENT-010 | WhitelistEntry | SINGLE-SOURCE | Yes | Existence-based PDA |
| ENT-011 | CurveState | SINGLE-SOURCE | Yes | Per-token curve tracking |
| ENT-012 | Tax Program | AGREEMENT | No | Wraps AMM, provides authority |
| ENT-013 | Epoch Program | AGREEMENT | No | Epochs, VRF, Carnage inline |
| ENT-014 | Transfer Hook Program | AGREEMENT | No | Whitelist enforcement |

**Total Entities:** 14
**Agreements:** 9
**Discrepancies:** 0
**Single-Source (expected - implementation details):** 5

---

*Matrix generated for Phase 3 Plan 02*
*Cross-reference methodology: .planning/research/CROSS_REFERENCING.md*
