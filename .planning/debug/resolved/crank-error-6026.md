---
status: resolved
trigger: "crank-error-6026 - Custom error 6026 at instruction index 3 on every epoch advancement"
created: 2026-03-14T00:00:00Z
updated: 2026-03-14T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Carnage WSOL account owned by OLD CarnageSigner PDA, not current one
test: Decoded on-chain WSOL account, compared token owner to current CarnageSigner PDA
expecting: Mismatch confirmed
next_action: Create new WSOL account owned by current CarnageSigner PDA, update CARNAGE_WSOL_PUBKEY

## Symptoms

expected: Crank should advance epochs by creating randomness, commit+trigger VRF, wait for oracle, reveal, consume VRF, advance epoch
actual: Every attempt fails with Custom error 6026 at instruction index 3. Recovery also fails. Circuit breaker trips after 5 attempts.
errors: {"InstructionError":[3,{"Custom":6026}]}
reproduction: Deploy crank on Railway after Phase 95 clean deploy, first epoch advancement attempt fails
started: After Phase 95 clean deploy (2026-03-14)

## Eliminated

## Evidence

- timestamp: 2026-03-14T00:01
  checked: epoch_program IDL error codes
  found: Error 6026 = InvalidCarnageWsolOwner ("Carnage WSOL account not owned by CarnageSigner PDA")
  implication: The WSOL token account's owner field doesn't match the CarnageSigner PDA

- timestamp: 2026-03-14T00:02
  checked: TX structure in vrf-flow.ts sendRevealAndConsume()
  found: Instruction index 3 = executeCarnageAtomic (index 0=ComputeBudget, 1=reveal, 2=consume, 3=carnage)
  implication: Error is in the carnage execution, not VRF

- timestamp: 2026-03-14T00:03
  checked: On-chain WSOL account FdsfyLHmV4aD3JYi6xXLs1sqkxHfoFs61dDMEHr3sK8y
  found: Token owner = FEVYenFYHnWSK7ucRtiRoChkFSpVjgwV3dLrw7Fwxj1d (OLD CarnageSigner PDA). Current PDA = HZXUKjKoMdL1ov872Wzyp1H8GENqn3YptgkdVV2tnfp1. MISMATCH.
  implication: Phase 95 clean deploy changed epoch program ID, which changed CarnageSigner PDA. initialize.ts idempotency guard skipped WSOL re-creation because the old account still existed on-chain.

- timestamp: 2026-03-14T00:04
  checked: initialize.ts line 1408
  found: `if (await accountExists(connection, carnageWsolKeypair.publicKey))` skips creation. But the existing account was created for a different PDA owner.
  implication: Idempotency guard is too coarse - it checks existence but not correctness of the owner field.

## Resolution

root_cause: Phase 95 clean deploy generated new epoch program ID (4Heq...), which changed CarnageSigner PDA from FEVYen... to HZXUKj.... The Carnage WSOL token account (FdskyL...) was created under the old deploy with the old PDA as token owner. initialize.ts idempotency guard saw the account exists and skipped re-creation. On-chain constraint `carnage_wsol.owner == carnage_signer.key()` correctly rejects because the owners don't match.
fix: (1) Created new WSOL account (Ci1CP7nHhUXLgGSs5qed7LRsfkbHsBVtPnnWTzvLuzut) with correct CarnageSigner PDA (HZXUKj...) as owner, (2) Extended ALT to include new address (56 addresses), (3) Fixed initialize.ts idempotency guard to validate owner field not just existence, (4) User must update CARNAGE_WSOL_PUBKEY on Railway to Ci1CP7nHhUXLgGSs5qed7LRsfkbHsBVtPnnWTzvLuzut
verification: On-chain constraint check verified -- new WSOL account token owner matches CarnageSigner PDA derived from current Epoch Program ID
files_changed:
  - scripts/deploy/initialize.ts (owner validation in idempotency guard)
  - scripts/deploy/fix-carnage-wsol.ts (new one-time repair script)
  - keypairs/carnage-wsol.json (regenerated with new keypair)
