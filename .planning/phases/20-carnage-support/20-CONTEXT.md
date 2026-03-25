# Phase 20: Tax Program Carnage Support - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable Epoch Program to execute tax-exempt swaps via `swap_exempt` instruction for Carnage rebalancing operations. Direct user calls must fail. CPI depth 4 (Solana maximum) when called via Carnage flow.

Requirements from roadmap: TAX-09, AUTH-01, AUTH-02, ERR-04

</domain>

<decisions>
## Implementation Decisions

### Instruction Design
- No slippage parameter — Carnage executes without minimum output (per Carnage_Fund_Spec.md Section 9.3)
- User context: "Carnage will never buy from PROFIT pools" — instruction can be scoped to SOL pools only

### CPI Depth Constraint
- Document depth 4 as architectural constraint in code comments
- This is the Solana hard limit — future changes cannot add CPI levels to this path
- Path: `Epoch::consume_randomness -> Tax::swap_exempt -> AMM::swap -> Token-2022::transfer_checked -> Transfer Hook::execute`

### Claude's Discretion
- **Instruction variants**: Whether to use single generic `swap_exempt` or separate per-operation variants (e.g., `swap_exempt_buy`, `swap_exempt_sell`)
- **Pool scope**: SOL pools only (matching current Carnage behavior) vs. all pools (future flexibility) — lean toward simplicity
- **Event emission**: Whether swap_exempt emits its own event or relies on Epoch Program's CarnageExecuted event
- **Program ID source**: Hardcode EPOCH_PROGRAM_ID constant vs pass as account
- **PDA verification method**: Re-derive Carnage PDA vs trust with owner check
- **Bump seed storage**: Derive fresh vs store in state
- **Error granularity**: Single UnauthorizedCarnageCall vs multiple specific errors
- **PROFIT pool handling**: Explicit InvalidPoolType error vs silent routing
- **CPI error handling**: Propagate AMM errors vs wrap in Tax-specific errors
- **Input validation**: Check non-zero upfront vs let AMM handle

</decisions>

<specifics>
## Specific Ideas

**From specs (authoritative):**
- Carnage signer PDA seeds: `["carnage_signer"]` from Epoch Program (Tax_Pool_Logic_Spec Section 13.3)
- swap_exempt requires Carnage Fund PDA as signer, cryptographically enforced via invoke_signed (Carnage_Fund_Spec Section 16.1)
- UnauthorizedCarnageCall error already defined in Tax_Pool_Logic_Spec Section 19.1
- 0% tax, standard LP fee (1% for SOL pools) (Carnage_Fund_Spec Section 9.2)

**CPI chain per Carnage_Fund_Spec Section 2:**
```
Epoch::vrf_callback (entry point)
  |-> Tax::swap_exempt (depth 1)
      |-> AMM::swap (depth 2)
          |-> Token-2022::transfer_checked (depth 3)
              |-> Transfer Hook::execute (depth 4) -- SOLANA LIMIT
```

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-carnage-support*
*Context gathered: 2026-02-06*
