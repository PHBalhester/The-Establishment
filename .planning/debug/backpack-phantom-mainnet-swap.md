---
status: diagnosed
trigger: "Backpack wallet InstructionError:[5,{Custom:1}] on swap + Phantom malicious transaction warning"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T01:00:00Z
---

## Current Focus

hypothesis: TWO separate root causes identified -- see Resolution section
test: N/A -- investigation complete
expecting: N/A
next_action: Present findings to user for discussion before any fixes

## Symptoms

expected: Users should be able to swap tokens on mainnet without errors or warnings
actual:
  - Backpack: Transaction fails with InstructionError:[5,{Custom:1}] (instruction index 5, custom error code 1)
  - Phantom: Shows "malicious transaction" warning before swap completes
errors: Transaction failed on-chain: {"InstructionError":[5,{"Custom":1}]}
reproduction: Use Backpack wallet for SOL swap on mainnet (fails). Use Phantom for any SOL swap (warning).
started: First user reports after mainnet deployment

## Eliminated

- hypothesis: Backpack injects extra instructions into the transaction (shifting indices)
  evidence: No evidence found that Backpack modifies TX instructions. sign-then-send pattern returns signed TX unmodified. The on-chain error (not client-side rejection) confirms TX structure reaches chain intact.
  timestamp: 2026-03-24T00:35:00Z

- hypothesis: Bonding curve purchase path causes the error
  evidence: BuyForm.tsx builds a TX with only 1 instruction (index 0). The error at index 5 requires 6+ instructions, ruling out the bonding curve path entirely.
  timestamp: 2026-03-24T00:40:00Z

- hypothesis: On-chain swap_sol_buy logic has insufficient WSOL balance
  evidence: WSOL ATA receives amount_in lamports via wrap. AMM CPI transfers sol_to_swap = amount_in - tax. Since tax > 0, sol_to_swap < amount_in. WSOL balance always sufficient for single-hop direct swaps.
  timestamp: 2026-03-24T00:45:00Z

- hypothesis: Bug is wallet-specific (Backpack handles signTransaction differently)
  evidence: useProtocolWallet.ts has zero wallet-specific code. All wallets use identical signTransaction() + sendRawTransaction() path. The on-chain error confirms TX was properly signed and submitted. Issue is likely route-specific, not wallet-specific.
  timestamp: 2026-03-24T00:50:00Z

## Evidence

- timestamp: 2026-03-24T00:10:00Z
  checked: Error code mapping
  found: Custom:1 = SPL Token InsufficientFunds (error code 1). NOT an Anchor error (those start at 6000+).
  implication: A token transfer CPI within instruction 5 is failing because a token account lacks sufficient balance.

- timestamp: 2026-03-24T00:15:00Z
  checked: Instruction index mapping for SOL buy with priority fee
  found: |
    With priority > 0, existing WSOL ATA, no token ATA: 0=CU limit, 1=CU price, 2=transfer, 3=sync, 4=createATA, 5=swap_sol_buy
    With priority > 0, no WSOL ATA, existing token ATA: 0=CU limit, 1=CU price, 2=createATA(WSOL), 3=transfer, 4=sync, 5=swap_sol_buy
    Instruction 5 = swap_sol_buy in both common scenarios
  implication: The swap instruction itself is failing due to InsufficientFunds in a CPI token transfer.

- timestamp: 2026-03-24T00:20:00Z
  checked: swap_sol_buy on-chain logic
  found: |
    Tax is paid via native SOL transfers (System Program), WSOL ATA keeps full amount_in.
    AMM CPI only transfers sol_to_swap = amount_in - tax (< amount_in).
    WSOL ATA should always have enough for the swap portion.
  implication: On-chain logic appears sound IF the WSOL wrap completed correctly.

- timestamp: 2026-03-24T00:25:00Z
  checked: Phantom malicious transaction warning
  found: |
    Already acknowledged in UI with a warning banner (SwapStation.tsx line 185-192).
    Banner says "Phantom may flag swaps as suspicious/malicious due to custom tax mechanism."
    The tax mechanism splits fees to staking/carnage/treasury -- Blowfish scanner likely flags this.
  implication: Phantom warning is a known Blowfish/simulation issue, separate from Backpack failure.

- timestamp: 2026-03-24T00:30:00Z
  checked: useProtocolWallet sign-then-send pattern
  found: |
    All wallets use signTransaction() + connection.sendRawTransaction() (our Helius RPC).
    No wallet-specific code paths. Same flow for Phantom, Backpack, Solflare.
  implication: If Backpack's signTransaction modifies the TX (adds instructions), all instruction indices shift.

- timestamp: 2026-03-24T00:35:00Z
  checked: Multi-hop atomic route builder (multi-hop-builder.ts)
  found: |
    Multi-hop routes (SOL->PROFIT, CRIME->FRAUD, etc.) use buildAtomicRoute which builds
    step transactions using QUOTED amounts from the route engine. Each step's inputAmount
    is the EXPECTED output of the previous step, computed at quote time. The actual on-chain
    output of step N may differ from the quoted amount due to pool reserve changes between
    quoting and execution. executeAtomicRoute uses skipPreflight:true, so TXs land on-chain
    even if they would fail simulation.
  implication: |
    CRITICAL BUG: If step N produces fewer tokens than quoted (but above minimumOutput),
    step N+1 tries to use the full quoted amount, exceeding the user's actual balance.
    Result: Token-2022 InsufficientFunds (Custom:1).

- timestamp: 2026-03-24T00:40:00Z
  checked: Instruction index mapping for SOL->PROFIT multi-hop (user has all ATAs)
  found: |
    0=CU limit, 1=CU price, 2=SystemProgram.transfer(SOL->WSOL), 3=syncNative,
    4=swap_sol_buy, 5=vault_convert.
    Index 5 = vault convert instruction. Custom:1 = CRIME token InsufficientFunds
    because AMM (index 4) produced fewer CRIME tokens than the vault convert (index 5) expects.
  implication: Perfectly matches the reported error InstructionError:[5,{"Custom":1}].

- timestamp: 2026-03-24T00:45:00Z
  checked: processInstructionsForAtomic dedup behavior
  found: |
    ATA creates are converted to CreateIdempotent (harmless if exists).
    Intermediate WSOL closeAccount instructions are removed (only last kept).
    ComputeBudget instructions are stripped and replaced with combined set.
    NO adjustment is made to step input amounts based on actual outputs.
  implication: The multi-hop builder has no mechanism to use actual step outputs as next-step inputs.

- timestamp: 2026-03-24T00:50:00Z
  checked: Phantom Blowfish warning cause
  found: |
    Tax mechanism in swap_sol_buy distributes SOL to 3 addresses (staking escrow 71%,
    carnage vault 24%, treasury 5%) BEFORE the AMM swap. Blowfish/Phantom transaction
    scanner sees SOL leaving user wallet to unfamiliar PDAs and flags as suspicious.
    UI already has a warning banner (SwapStation.tsx lines 185-192).
  implication: |
    This is a known Blowfish classification issue. Protocol programs need to be registered
    with Blowfish as "known safe" or Phantom's transaction simulation API needs whitelisting.

- timestamp: 2026-03-24T00:55:00Z
  checked: Whether issue is truly Backpack-specific
  found: |
    The error can happen with ANY wallet doing a multi-hop swap when pool reserves change
    between quoting and execution. Backpack may simply be the wallet users reported the
    issue with. Or Backpack users may be more likely to do SOL->PROFIT (multi-hop) swaps.
    Phantom users succeed because: (a) they might be doing single-hop swaps, or (b) they
    dismiss the Blowfish warning and the pool hasn't moved since their quote.
  implication: This is NOT a Backpack-specific bug. It's a multi-hop route builder bug that any wallet can trigger.

## Resolution

root_cause: |
  TWO SEPARATE ISSUES:

  ISSUE 1 (Backpack Custom:1 -- actually affects ALL wallets on multi-hop routes):
  The multi-hop atomic route builder (multi-hop-builder.ts) uses QUOTED step output amounts
  as the next step's input amounts. In an atomic v0 transaction, the actual on-chain output
  from step N (e.g., AMM swap_sol_buy) may be LESS than the quoted amount due to pool reserve
  changes between quoting and execution. Step N+1 (e.g., vault convert) then tries to transfer
  more tokens than the user actually received, causing Token-2022 InsufficientFunds (Custom:1).

  Example: SOL -> PROFIT (2-hop route, user has all ATAs existing):
    - Index 0: setComputeUnitLimit
    - Index 1: setComputeUnitPrice
    - Index 2: SystemProgram.transfer (SOL -> WSOL ATA)
    - Index 3: syncNative
    - Index 4: swap_sol_buy (AMM, produces ACTUAL_CRIME tokens, may be < QUOTED_CRIME)
    - Index 5: vault convert (tries to transfer QUOTED_CRIME tokens -- FAILS if ACTUAL < QUOTED)

  This is NOT wallet-specific. It happens with any wallet when multi-hop routes are used
  and pool reserves change even slightly between quoting and execution. The error surfaces
  because executeAtomicRoute uses skipPreflight:true (required for v0 TX on devnet, carried
  to mainnet), so the TX lands on-chain and fails instead of being caught in simulation.

  ISSUE 2 (Phantom malicious transaction warning):
  Phantom's Blowfish transaction scanner flags the Tax Program's swap instructions as
  suspicious because they distribute SOL to multiple unfamiliar PDA addresses (staking
  escrow, carnage vault, treasury) before executing the actual AMM swap. This is a
  Blowfish classification issue -- the protocol is legitimate, but the programs are not
  registered in Blowfish's known-safe database.

fix: |
  NOT APPLIED (investigation only mode). Suggested fix directions:

  ISSUE 1: Multi-hop route builder needs to use ACTUAL step outputs, not QUOTED amounts.
  Options:
  (a) Use user's FULL token balance as step N+1 input (most resilient):
      For vault convert after AMM buy, use all CRIME tokens in user ATA, not the quoted amount.
  (b) Add a "use remaining balance" flag to on-chain instructions (requires program upgrade).
  (c) Quote more conservatively: use minimumOutput as step N+1 input instead of expectedOutput.
      This guarantees step N+1 never exceeds what step N actually produced (but reduces output).
  (d) Re-enable preflight simulation (remove skipPreflight:true for mainnet) so simulation
      catches the error before on-chain submission. However, this doesn't fix the root cause.

  ISSUE 2: Register protocol programs with Blowfish's whitelist.
  See: https://docs.blowfish.xyz/docs/whitelisting-transactions
  Alternative: Phantom's developer console may allow registering verified dApps.

verification:
files_changed: []
