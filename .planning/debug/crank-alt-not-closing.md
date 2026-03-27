---
status: diagnosed
trigger: "crank-alt-not-closing - mainnet crank not closing Switchboard RandomnessInit ALTs after epoch change, causing SOL bleed"
created: 2026-03-27T00:00:00Z
updated: 2026-03-27T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Switchboard randomnessClose deactivates ALT but cannot close it in same TX (Solana cooldown). Crank has no follow-up close logic. ALT address unrecoverable after randomness data deleted.
test: Traced full code path from crank-runner.ts -> closeRandomnessAccount -> randomness.closeIx() -> on-chain randomnessClose
expecting: N/A - root cause confirmed
next_action: Report root cause

## Symptoms

expected: After each epoch VRF cycle, the ALT created by Switchboard's RandomnessInit should be closed to reclaim rent SOL
actual: ALTs are not being closed after each epoch, causing crank wallet F84X to slowly bleed SOL
errors: Previous close TX 2vLZA3VCkTbBNi9H1FFWCxSfs6dY77gjXnDeNFLvKFZ9Woww3KTKPPapqEuaVDrxvBaMwWbBdmDxpHGPEpzZzgSN may not have executed
reproduction: Run crank on mainnet, observe ALT accounts persist after epoch change
started: Ongoing on mainnet

## Eliminated

- hypothesis: closeRandomnessAccount is failing entirely (TX not landing)
  evidence: User confirmed "Randomness account closing works (~0.008 SOL reclaimed)". The closeIx() constructs a valid TX that closes the randomness account. The issue is specifically ALTs persisting, not randomness close failure.
  timestamp: 2026-03-27

## Evidence

- timestamp: 2026-03-27
  checked: Switchboard SDK randomness.closeIx() implementation (node_modules/@switchboard-xyz/on-demand/dist/esm/accounts/randomness.js:361-382)
  found: closeIx reads data.lutSlot from randomness account, derives lutKey via getLutKey(lutSigner, data.lutSlot), constructs randomnessClose instruction with lut, lutSigner, and addressLookupTableProgram accounts
  implication: The on-chain randomnessClose IS aware of the ALT and passes it as an account

- timestamp: 2026-03-27
  checked: Solana ALT lifecycle constraints
  found: ALTs require two-step close: (1) deactivateLookupTable, (2) closeLookupTable after cooldown (~512 slots). Cannot close in same TX/slot as deactivation.
  implication: The on-chain randomnessClose can only deactivate (not close) the ALT. The ALT remains in deactivated state holding rent.

- timestamp: 2026-03-27
  checked: crank-runner.ts line 602-610 and vrf-flow.ts closeRandomnessAccount (1072-1105)
  found: After advanceEpochWithVRF returns, crank calls closeRandomnessAccount which calls randomness.closeIx(). This succeeds (randomness account closed, ~0.008 SOL reclaimed). But the ALT is only deactivated, not closed.
  implication: After randomnessClose, the randomness account data (containing lutSlot) is deleted. The ALT address becomes unrecoverable without lutSlot.

- timestamp: 2026-03-27
  checked: getLutKey derivation (node_modules/@switchboard-xyz/on-demand/dist/esm/utils/lookupTable.js)
  found: lutKey requires both lutSigner (derivable from randomnessPubkey) and lutSlot (stored in randomness account data). Without randomness data, ALT address cannot be re-derived.
  implication: After randomnessClose deletes the randomness account, there is no way to find the ALT to close it later.

- timestamp: 2026-03-27
  checked: crank-runner.ts sweepStaleRandomnessAccounts (318-371)
  found: Sweep only targets Switchboard randomness accounts (getProgramAccounts on sbProgramId). No sweep for orphaned ALTs exists.
  implication: No existing mechanism to find or close orphaned deactivated ALTs.

- timestamp: 2026-03-27
  checked: ALT rent cost estimate
  found: An ALT with ~10 addresses = ~448 bytes = ~0.003 SOL rent. Each epoch cycle creates one ALT. At mainnet 4500 slots/epoch (~30 min), that's ~48 epochs/day = ~0.144 SOL/day leaked.
  implication: Significant SOL bleed over time

## Resolution

root_cause: |
  Switchboard's randomnessClose on-chain instruction deactivates the per-randomness ALT but cannot close it in the same transaction (Solana requires a cooldown of ~512 slots between deactivateLookupTable and closeLookupTable). After randomnessClose succeeds, the randomness account data is deleted, making the ALT address unrecoverable (it requires lutSlot from randomness data for derivation). The crank has no follow-up logic to close deactivated ALTs after cooldown. Each epoch cycle leaks one ALT (~0.003 SOL rent).

  Fix requires two changes:
  1. BEFORE calling closeRandomnessAccount, read the randomness data to extract lutSlot and derive the ALT address. Store ALT address + deactivation timestamp in a queue.
  2. Add periodic sweep logic that closes deactivated ALTs from the queue after cooldown (512+ slots, ~3.5 min).

  For already-leaked ALTs: write a one-time sweep script that finds ALTs by scanning for AddressLookupTable accounts where the authority is a lutSigner PDA derived from known crank randomness pubkeys (from past logs or getProgramAccounts).

fix:
verification:
files_changed: []
