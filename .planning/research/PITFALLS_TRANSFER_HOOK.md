# Transfer Hook Program Pitfalls

**Domain:** Token-2022 Transfer Hook Implementation (Whitelist-based)
**Researched:** 2026-02-05
**Confidence:** HIGH (verified with official Solana docs, Neodyme security analysis, and project-specific context)

**Context:** This document covers pitfalls specific to BUILDING the Dr. Fraudsworth transfer hook program. The v0.2 AMM already handles hook passthrough, so focus is on mistakes when building the hook itself, not the integration (which is covered in PITFALLS.md for AMM).

---

## Critical Pitfalls

Mistakes that would cause rewrites, security vulnerabilities, or protocol failure.

---

### PITFALL-01: Anchor Instruction Discriminator Mismatch

**What goes wrong:** The transfer hook is deployed with Anchor but Token-2022 cannot invoke it. Every transfer fails with "unknown instruction" or silent failure.

**Why it happens:** Anchor generates instruction discriminators differently from the Transfer Hook Interface specification. Token-2022 calls the `execute` instruction using the interface discriminator (`spl_transfer_hook_interface::instruction::ExecuteInstruction`), but Anchor expects its own discriminator format.

**Consequences:**
- All token transfers fail
- Protocol is unusable
- Requires redeployment of hook program and re-initialization of all mints

**Prevention:**
- Use the `#[interface(spl_transfer_hook_interface::execute)]` attribute macro (Anchor 0.30+)
- OR implement a fallback function that unpacks `TransferHookInstruction::Execute` and routes to your handler
- Test with real Token-2022 transfers, not just direct instruction calls

**Detection (warning signs):**
- Hook unit tests pass but integration tests with `transfer_checked` fail
- "Unknown instruction" errors in transaction logs
- Transfer succeeds when hook is disabled on mint

**Phase to address:** Phase 1 (Program Structure) - must be correct from the start

**Confidence:** HIGH - Verified in [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) and [Anchor Transfer Hook Example](https://github.com/solana-developers/anchor-transfer-hook/blob/main/programs/transfer-hook/src/lib.rs)

---

### PITFALL-02: Account Order Violation in TransferHook Struct

**What goes wrong:** ExtraAccountMeta references resolve to wrong accounts, causing transfers to fail or (worse) pass incorrect accounts to validation logic.

**Why it happens:** Token-2022 passes accounts to the transfer hook in a fixed order:
- Index 0: Source token account
- Index 1: Mint
- Index 2: Destination token account
- Index 3: Owner/authority
- Index 4: ExtraAccountMetaList PDA
- Index 5+: Extra accounts defined in ExtraAccountMetaList

If your Anchor struct reorders these (e.g., puts mint before source), the index references in ExtraAccountMeta seeds become wrong.

**Consequences:**
- Whitelist PDAs derived from wrong addresses (e.g., derived from mint instead of source)
- Validation passes/fails incorrectly
- Security vulnerability: transfers that should be blocked may succeed

**Prevention:**
- Match your Anchor struct order EXACTLY to Token-2022's expected order
- Comment the struct with explicit index annotations
- Never reorder accounts in the TransferHook struct after ExtraAccountMetaList is initialized

**Detection (warning signs):**
- "Account constraint failed" on transfers that should succeed
- Whitelist PDA addresses don't match expected values in tests
- Works in unit tests (direct call) but fails in integration tests (via Token-2022)

**Phase to address:** Phase 1 (Program Structure) - affects all subsequent work

**Confidence:** HIGH - Verified in [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook)

---

### PITFALL-03: Missing Transferring Flag Validation

**What goes wrong:** Transfer hook can be invoked outside of actual token transfers, allowing attackers to bypass whitelist validation or manipulate hook state.

**Why it happens:** Token-2022 sets a `transferring` flag on source and destination token accounts during transfer execution. If the hook doesn't verify this flag, anyone can call the hook directly with arbitrary accounts.

**Consequences:**
- Security vulnerability: attackers can invoke hook logic without real transfers
- If hook has mutable state, it can be manipulated
- Whitelist validation can be bypassed if attacker controls passed accounts

**Prevention:**
```rust
fn assert_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let source_info = ctx.accounts.source_token.to_account_info();
    let dest_info = ctx.accounts.destination_token.to_account_info();

    // Unpack and verify transferring flag
    let source_data = source_info.try_borrow_data()?;
    let dest_data = dest_info.try_borrow_data()?;

    // Use spl_token_2022::extension::transfer_hook::TransferHookAccount
    // to check the transferring flag
    require!(
        is_transferring(&source_data)? && is_transferring(&dest_data)?,
        TransferHookError::NotInTransfer
    );
    Ok(())
}
```

**Detection (warning signs):**
- Hook can be called successfully without using `transfer_checked`
- No check for `TransferHookAccount` extension in hook code

**Phase to address:** Phase 2 (Core Hook Logic) - foundational security

**Confidence:** HIGH - Verified in [Neodyme Token-2022 Security Analysis](https://neodyme.io/en/blog/token-2022/)

---

### PITFALL-04: Shared Whitelist Without Mint Validation

**What goes wrong:** Attacker creates their own Token-2022 mint pointing to our hook program, gaining unauthorized access to whitelist PDAs.

**Why it happens:** Project spec defines shared whitelist across CRIME, FRAUD, and PROFIT. The hook program uses `["whitelist", address]` seeds without mint scoping. This is intentional for the shared design, but the hook must validate that the mint being used IS one of our supported mints.

**Consequences (if mint validation missing):**
- Attacker creates their own Token-2022 mint pointing to our hook
- Attacker's tokens can be transferred to/from our whitelisted addresses
- Cross-contamination of protocol state
- Potential fund manipulation if vaults are shared

**Prevention:**
```rust
// Validate mint is one of our supported mints
const SUPPORTED_MINTS: [Pubkey; 3] = [CRIME_MINT, FRAUD_MINT, PROFIT_MINT];

require!(
    SUPPORTED_MINTS.contains(&ctx.accounts.mint.key()),
    TransferHookError::UnsupportedMint
);
```

**Detection (warning signs):**
- No mint validation in transfer_hook instruction
- Tests only use expected mints, never adversarial mints
- No explicit SUPPORTED_MINTS constant or validation logic

**Phase to address:** Phase 2 (Core Hook Logic) - must validate mints

**Confidence:** HIGH - Verified in [Neodyme Token-2022 Security Analysis](https://neodyme.io/en/blog/token-2022/): "you should restrict which mints your program supports by checking the mints present in the source and destination accounts"

---

### PITFALL-05: CPI Depth Exhaustion in Full Protocol Path

**What goes wrong:** Transfers fail in the full protocol flow (Carnage execution path) due to CPI depth limit exceeded.

**Why it happens:** Solana has a hard limit of 4 CPI levels. The Carnage execution path is:
```
Epoch::consume_randomness (entry point)
  -> Tax::swap_exempt (depth 1)
     -> AMM::swap (depth 2)
        -> Token-2022::transfer_checked (depth 3)
           -> Transfer Hook::execute (depth 4) -- LIMIT
```

Any additional CPI from within the hook would exceed the limit and fail.

**Consequences:**
- Carnage swaps fail silently or with cryptic errors
- Fallback mechanism activates repeatedly
- Protocol appears broken

**Prevention:**
- Hook logic MUST be pure validation - no CPIs to other programs
- No token transfers from within the hook
- No external account lookups via CPI
- Test the full execution path: VRF -> Carnage -> Tax -> AMM -> Token-2022 -> Hook

**Detection (warning signs):**
- Hook works in isolated tests but fails in full protocol integration
- "CallDepth" errors in transaction logs
- Works for direct user swaps but fails for Carnage swaps

**Phase to address:** Phase 1 (Architecture) and Phase 4 (Integration Testing)

**Confidence:** HIGH - Verified in [Solana Program Limitations](https://solana.com/docs/programs/limitations) and Carnage_Fund_Spec.md Section 2

---

### PITFALL-06: ExtraAccountMeta Seed Index Mismatch

**What goes wrong:** ExtraAccountMeta uses wrong account index for seed derivation, causing whitelist PDAs to be derived from wrong addresses.

**Why it happens:** When defining ExtraAccountMetas for dynamic PDA derivation, you reference accounts by index. If you use `AccountKey { index: 0 }` thinking it's the source account but Token-2022 actually puts something else at index 0, you derive the wrong PDA.

**Consequences:**
- Whitelist lookup fails for every transfer
- All transfers blocked regardless of whitelist entries
- Silent derivation of wrong PDAs that don't exist

**Prevention:**
```rust
// Correct indices for Token-2022 transfer hook:
// 0 = source_token_account
// 2 = destination_token_account
// (NOT 0 and 1, because mint is at index 1)

let account_metas = vec![
    // Whitelist PDA for source (uses source account at index 0)
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 0 },  // source_token_account
        ],
        false, false,
    )?,
    // Whitelist PDA for destination (uses dest account at index 2)
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 2 },  // destination_token_account
        ],
        false, false,
    )?,
];
```

**Detection (warning signs):**
- ExtraAccountMeta initialization succeeds but transfers fail
- "Account not found" for whitelist PDAs during transfer
- Derived PDA addresses don't match expected addresses

**Phase to address:** Phase 2 (ExtraAccountMetaList Setup)

**Confidence:** HIGH - Index values verified in [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) and Transfer_Hook_Spec.md Section 8

---

## High Pitfalls

Mistakes that cause significant delays, broken functionality, or require substantial rework.

---

### PITFALL-07: ExtraAccountMetaList Not Initialized Per Mint

**What goes wrong:** Transfers fail for one or more mints because ExtraAccountMetaList PDA doesn't exist.

**Why it happens:** ExtraAccountMetaList is derived with mint in seeds: `["extra-account-metas", mint]`. Each of CRIME, FRAUD, and PROFIT needs its own ExtraAccountMetaList initialized. Missing one means that mint's transfers always fail.

**Consequences:**
- One or more tokens completely non-transferable
- Partial protocol failure
- Requires calling `initialize_extra_account_meta_list` for missing mint(s)

**Prevention:**
- Initialization script must explicitly initialize ExtraAccountMetaList for ALL THREE mints
- Verification script checks for existence of all three ExtraAccountMetaList PDAs
- Test transfers with each mint type, not just one

**Detection (warning signs):**
- CRIME transfers work but FRAUD transfers fail
- "Account not found" errors mentioning extra-account-metas
- Only partially functioning protocol

**Phase to address:** Phase 3 (Initialization) - initialization checklist

**Confidence:** HIGH - Per Transfer_Hook_Spec.md Section 8.3 and Protocol_Initialzation_and_Launch_Flow.md Section 7.2

---

### PITFALL-08: Whitelist Entry Missing from Initialization

**What goes wrong:** Some legitimate transfers fail because a vault wasn't added to whitelist before authority burn.

**Why it happens:** There are 14 whitelist entries required (per Transfer_Hook_Spec.md Section 4):
1. CRIME/SOL pool CRIME vault
2. CRIME/SOL pool WSOL vault
3. FRAUD/SOL pool FRAUD vault
4. FRAUD/SOL pool WSOL vault
5. CRIME/PROFIT pool CRIME vault
6. CRIME/PROFIT pool PROFIT vault
7. FRAUD/PROFIT pool FRAUD vault
8. FRAUD/PROFIT pool PROFIT vault
9. Carnage CRIME vault
10. Carnage FRAUD vault
11. CRIME curve token vault
12. FRAUD curve token vault
13. Reserve vault
14. Stake vault

Missing ANY of these means that component cannot function. Authority burn makes this permanent.

**Consequences:**
- Affected component permanently broken
- May require complete protocol redeployment
- IRREVERSIBLE after authority burn

**Prevention:**
- Automated verification script checks ALL 14 entries exist before burn
- Manual review checklist with signoff
- Triple-confirm before calling `burn_authority`
- Test each component's transfers before burn

**Detection (warning signs):**
- Verification script shows missing entries
- Specific component transfers fail in testing
- Count of whitelist entries doesn't equal 14

**Phase to address:** Phase 3 (Whitelist Population) - BEFORE authority burn

**Confidence:** HIGH - Per Protocol_Initialzation_and_Launch_Flow.md Section 6.2

---

### PITFALL-09: Authority Burn Before Complete Verification

**What goes wrong:** Authority burned but whitelist is incomplete or incorrect.

**Why it happens:** Pressure to proceed, incomplete testing, or verification script has bugs. Once `burn_authority()` is called, no recovery is possible.

**Consequences:**
- Protocol permanently broken
- Complete redeployment required (new program IDs, new mints, new everything)
- All preparation work lost

**Prevention:**
- Mandatory 24-hour verification period (per Protocol_Initialzation_and_Launch_Flow.md Phase 6)
- Automated AND manual verification
- Test EVERY transfer path before burn
- Require explicit "BURN" confirmation with warning

**Detection (warning signs):**
- Rushing through initialization
- Skipping verification steps
- "We can fix it later" attitude
- Tests not covering all transfer paths

**Phase to address:** Phase 3 (Pre-Burn Verification)

**Confidence:** HIGH - Per Protocol_Initialzation_and_Launch_Flow.md Section 13.2

---

### PITFALL-10: Read-Only Account Constraint Violation

**What goes wrong:** Transfer hook tries to write to accounts, causing transfer failure.

**Why it happens:** When Token-2022 CPIs to the transfer hook, ALL accounts from the original transfer are converted to read-only. The hook cannot modify source/destination token accounts or their owners.

**Consequences:**
- All transfers fail if hook tries to mutate
- Confusing error messages (account constraint violations)

**Prevention:**
- Hook logic must be READ-ONLY for transfer accounts
- Only accounts introduced via ExtraAccountMeta (and marked writable) can be mutated
- For this whitelist hook: no state mutations needed, just validation
- Never try to `close_account`, `transfer`, or modify token accounts from hook

**Detection (warning signs):**
- "Account must be writable" errors
- Works in unit tests (where accounts are writable) but fails in integration
- Any `mut` modifiers on source/destination/mint accounts in hook code

**Phase to address:** Phase 2 (Core Hook Logic)

**Confidence:** HIGH - Verified in [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook): "all accounts from the initial transfer are converted to read-only accounts"

---

### PITFALL-11: Whitelist PDA Derivation Inconsistency

**What goes wrong:** Whitelist PDAs derived differently in hook program vs initialization vs client, causing lookup failures.

**Why it happens:** Multiple places derive whitelist PDAs:
- `add_whitelist_entry` instruction
- `transfer_hook` instruction (for validation)
- ExtraAccountMetaList seed resolution
- Client SDK for account resolution

If any of these uses different seeds (e.g., extra prefix, different order), they derive different addresses.

**Consequences:**
- Whitelist entries created but never found during validation
- Transfers fail even though whitelist "looks correct"
- Debugging nightmare - all pieces seem correct individually

**Prevention:**
```rust
// Centralize PDA derivation in one place
pub fn get_whitelist_pda(address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"whitelist", address.as_ref()],
        &crate::ID
    )
}

// Use this EVERYWHERE - never hand-write seeds
```

**Detection (warning signs):**
- Seeds defined in multiple files without central constant
- Different `seeds` attributes in different instructions
- Whitelist entry exists but transfer fails with "not whitelisted"

**Phase to address:** Phase 1 (Program Structure) - centralize seed constants

**Confidence:** HIGH - Common pattern error

---

## Medium Pitfalls

Mistakes that cause delays, require debugging, or create technical debt.

---

### PITFALL-12: Missing UncheckedAccount Documentation

**What goes wrong:** Security reviewers flag UncheckedAccount usage as vulnerability; time wasted explaining it's intentional.

**Why it happens:** Transfer hook needs to accept owner and ExtraAccountMetaList as UncheckedAccount types because Token-2022 passes them but they're not needed for validation in our whitelist design.

**Consequences:**
- Audit delays
- Wasted time explaining design decisions
- Possible rejection if not properly documented

**Prevention:**
- Document EVERY UncheckedAccount with `/// CHECK:` comment explaining why
- Include rationale in design docs
- Proactively explain in security review handoff

**Detection (warning signs):**
- UncheckedAccount without CHECK comment
- Audit findings about "missing account validation"

**Phase to address:** Phase 2 (Core Hook Logic) - documentation

**Confidence:** MEDIUM - Standard Anchor practice

---

### PITFALL-13: Compute Budget Underestimation

**What goes wrong:** Transfers fail intermittently with "exceeded CU limit" errors.

**Why it happens:** Transfer hooks add overhead to every transfer. Combined with AMM swap math and Token-2022 extension processing, default compute budget may be insufficient.

**Consequences:**
- Intermittent transfer failures
- User confusion
- Client-side workarounds needed

**Prevention:**
- Client SDK always includes explicit compute budget instruction
- Test with realistic compute scenarios
- Budget ~100-150k CU for hook execution
- Full path budget: 400k CU (per VRF_Migration_Lessons.md)

**Detection (warning signs):**
- "Computational budget exceeded" errors
- Transfers that work sometimes but fail others
- Works on localnet but fails on devnet

**Phase to address:** Phase 4 (Client Integration)

**Confidence:** MEDIUM - Per VRF_Migration_Lessons.md Pitfall 3

---

### PITFALL-14: WSOL Pool Asymmetry Misunderstanding

**What goes wrong:** Confusion about why WSOL side doesn't invoke transfer hook, leading to incorrect validation assumptions.

**Why it happens:** CRIME/SOL and FRAUD/SOL pools are "mixed" pools:
- CRIME/FRAUD side: Token-2022 (with transfer hook)
- WSOL side: SPL Token (NO transfer hook support)

WSOL vaults are whitelisted so CRIME/FRAUD tokens can transfer TO them, but WSOL transfers themselves never invoke the hook.

**Consequences:**
- Wrong assumptions about what the hook validates
- Confusion about security model
- Tests that assume hook runs on WSOL side

**Prevention:**
- Always check Token_Program_Reference.md when working with pools
- Document clearly that WSOL whitelist entries enable inbound CRIME/FRAUD, not WSOL transfers
- Test WSOL transfers separately (they bypass hook by design)

**Detection (warning signs):**
- Confusion about "why doesn't the hook run on WSOL transfers?"
- Tests expecting hook invocation on WSOL transfers
- Security concerns about WSOL vault that misunderstand the model

**Phase to address:** Phase 2 (Understanding) and Phase 4 (Testing)

**Confidence:** HIGH - Per AMM_Implementation.md Section 3.2 and Transfer_Hook_Spec.md Section 4 WSOL note

---

### PITFALL-15: Fallback Function Incorrectly Matching Instructions

**What goes wrong:** Fallback function intercepts instructions it shouldn't, causing unexpected behavior.

**Why it happens:** Fallback function is called for any instruction that doesn't match Anchor discriminators. If it doesn't properly validate that the instruction IS a TransferHookInstruction::Execute, it might try to process other things.

**Consequences:**
- Unexpected instruction execution
- Security risk if other instructions are processed incorrectly
- Hard to debug errors

**Prevention:**
```rust
pub fn fallback<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    data: &[u8],
) -> Result<()> {
    let instruction = TransferHookInstruction::unpack(data)?;
    match instruction {
        TransferHookInstruction::Execute { amount } => {
            // Route to transfer_hook
            __private::__global::transfer_hook(program_id, accounts, &amount.to_le_bytes())
        }
        _ => Err(ProgramError::InvalidInstructionData.into()),
    }
}
```

**Detection (warning signs):**
- Fallback doesn't have explicit match/reject for non-Execute instructions
- Unexpected behavior when calling non-hook instructions

**Phase to address:** Phase 1 (Program Structure) - if using fallback (Anchor < 0.30)

**Confidence:** MEDIUM - Pattern from [Anchor Transfer Hook Example](https://github.com/solana-developers/anchor-transfer-hook/blob/main/programs/transfer-hook/src/lib.rs)

---

### PITFALL-16: Token Burn Assumption About Hook Invocation

**What goes wrong:** Assumption that burns trigger the hook, leading to incorrect whitelist design.

**Why it happens:** Developers assume all token operations invoke the hook. In reality, Token-2022 `burn` instruction does NOT trigger transfer hooks.

**Consequences:**
- None for this project (burns are desired to bypass hook)
- But confusion if expecting hook to validate burns

**Prevention:**
- Understand that only `transfer_checked` invokes hooks
- Per Transfer_Hook_Spec.md Section 10.3: "Burns don't trigger transfer hooks"
- Carnage burn operations work correctly because they don't need whitelist validation

**Detection (warning signs):**
- Tests expecting hook invocation on burn operations
- Whitelist entries for "burn destination"
- Security analysis assuming burns are validated

**Phase to address:** Phase 2 (Understanding)

**Confidence:** HIGH - Per Transfer_Hook_Spec.md Section 10.3

---

### PITFALL-17: Optional Whitelist PDA as None vs Non-Existent

**What goes wrong:** Confusion between "PDA passed as None" and "PDA doesn't exist on chain", leading to incorrect validation logic.

**Why it happens:** The spec shows whitelist PDAs as Optional in the transfer_hook accounts. There's a difference between:
- Account not passed (Option::None)
- Account passed but doesn't exist on chain (data_is_empty())
- Account passed and exists

**Consequences:**
- Transfers incorrectly allowed or blocked
- Validation logic holes

**Prevention:**
```rust
fn is_whitelist_pda_valid(
    account: &Option<AccountInfo>,
    expected_address: &Pubkey
) -> bool {
    match account {
        Some(acc) => {
            // Verify PDA derivation
            let (expected_pda, _) = Pubkey::find_program_address(
                &[b"whitelist", expected_address.as_ref()],
                &crate::ID
            );

            // BOTH conditions required:
            // 1. Account address matches expected PDA
            // 2. Account has data (exists on chain)
            acc.key() == expected_pda && !acc.data_is_empty()
        }
        None => false
    }
}
```

**Detection (warning signs):**
- Only checking PDA derivation, not existence
- Only checking existence, not derivation
- Tests passing wrong accounts that happen to have data

**Phase to address:** Phase 2 (Core Hook Logic)

**Confidence:** HIGH - Per Transfer_Hook_Spec.md Section 7.4

---

### PITFALL-18: Missing Zero-Amount Transfer Rejection

**What goes wrong:** Zero-amount transfers bypass meaningful validation, potentially used for probing or DoS.

**Why it happens:** Zero-amount transfers technically have a whitelisted party (either source or dest), so they pass the whitelist check. Without explicit rejection, they succeed.

**Consequences:**
- DoS vector (spam zero transfers)
- State probing without cost
- Potential for unexpected behavior

**Prevention:**
```rust
// Block zero-amount transfers explicitly
require!(
    amount > 0,
    TransferHookError::ZeroAmountTransfer
);
```

**Detection (warning signs):**
- No explicit zero-amount check in hook
- Tests don't cover zero-amount transfers
- Missing `ZeroAmountTransfer` error variant

**Phase to address:** Phase 2 (Core Hook Logic)

**Confidence:** HIGH - Per Transfer_Hook_Spec.md Section 7 core rule

---

---

## Prevention Strategies Summary

### Architecture Phase (Phase 1)
- [ ] Confirm Anchor 0.30+ for `#[interface]` macro OR plan fallback function
- [ ] Document CPI depth constraint (max 4, hook is at depth 4 in Carnage path)
- [ ] Design hook as pure validation (no CPIs, no state mutations)
- [ ] Centralize PDA derivation seeds in one location
- [ ] Match account order EXACTLY to Token-2022 specification

### Implementation Phase (Phase 2)
- [ ] Validate `transferring` flag on token accounts
- [ ] Validate mint is one of supported mints (CRIME, FRAUD, PROFIT)
- [ ] Use correct indices in ExtraAccountMeta (0 = source, 2 = destination)
- [ ] Document all UncheckedAccount usages with CHECK comments
- [ ] Implement zero-amount transfer rejection
- [ ] Validate whitelist PDA both exists AND derives correctly

### Initialization Phase (Phase 3)
- [ ] Initialize ExtraAccountMetaList for ALL THREE mints
- [ ] Add ALL 14 whitelist entries before authority burn
- [ ] Run automated verification script
- [ ] Run manual verification checklist
- [ ] 24-hour verification period before burn
- [ ] Test EVERY transfer path before burn

### Testing Phase (Phase 4)
- [ ] Test via `transfer_checked`, not direct instruction calls
- [ ] Test all three mints
- [ ] Test both directions of all pool swaps
- [ ] Test full CPI path (VRF -> Carnage -> Tax -> AMM -> T22 -> Hook)
- [ ] Test with adversarial mints (should be rejected)
- [ ] Test direct hook invocation (should be rejected - transferring flag)
- [ ] Include compute budget in client calls

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|------------|
| Program Structure | PITFALL-01, PITFALL-02, PITFALL-05, PITFALL-11 | Use interface macro, match account order, no CPIs, centralize seeds |
| Core Hook Logic | PITFALL-03, PITFALL-04, PITFALL-10, PITFALL-17, PITFALL-18 | Validate transferring flag, validate mint, read-only logic, proper PDA validation, zero-amount check |
| ExtraAccountMeta Setup | PITFALL-06, PITFALL-07 | Correct indices (0, 2), init for all mints |
| Whitelist Population | PITFALL-08, PITFALL-09 | All 14 entries, verification before burn |
| Integration Testing | PITFALL-05, PITFALL-13, PITFALL-14 | Full path tests, compute budget, WSOL asymmetry understanding |

---

## Relationship to AMM Pitfalls

This document covers **building the hook**. The existing PITFALLS.md (AMM) covers **integrating with the hook** from the AMM side:

| This Doc (Hook Building) | PITFALLS.md (AMM Integration) |
|--------------------------|-------------------------------|
| PITFALL-01: Discriminator mismatch | P2: transfer vs transfer_checked |
| PITFALL-02: Account order | P3: Missing ExtraAccountMeta accounts |
| PITFALL-06: Seed index mismatch | P21: CPI remaining_accounts forwarding |
| PITFALL-05: CPI depth | P1: Wrong token program in CPI |

Both documents are complementary - read both for complete coverage.

---

## Sources

### Official Documentation (HIGH confidence)
- [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook)
- [Solana Program Limitations](https://solana.com/docs/programs/limitations)
- [SPL Transfer Hook Interface](https://spl.solana.com/transfer-hook-interface)

### Security Analysis (HIGH confidence)
- [Neodyme: Token-2022 Security](https://neodyme.io/en/blog/token-2022/)

### Examples (MEDIUM confidence)
- [Anchor Transfer Hook Example](https://github.com/solana-developers/anchor-transfer-hook/blob/main/programs/transfer-hook/src/lib.rs)
- [Solana Program Examples - Whitelist Hook](https://github.com/solana-developers/program-examples/blob/main/tokens/token-2022/transfer-hook/whitelist/anchor/tests/transfer-hook.ts)

### Project-Specific (HIGH confidence)
- Transfer_Hook_Spec.md - Whitelist design, PDA derivation, ExtraAccountMeta
- AMM_Implementation.md - Integration requirements, token program routing
- Carnage_Fund_Spec.md - CPI depth-4 constraint
- Protocol_Initialzation_and_Launch_Flow.md - 14 whitelist entries, authority burn
- VRF_Migration_Lessons.md - Compute budget lessons

---

*Transfer Hook pitfalls research for: Dr. Fraudsworth (v0.3 milestone)*
*Researched: 2026-02-05*
*Complements: PITFALLS.md (AMM-focused, 2026-02-03)*
