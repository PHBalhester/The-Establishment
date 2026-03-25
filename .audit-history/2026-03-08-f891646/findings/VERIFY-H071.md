# Verification: H071 - No timelock on admin actions

**Original Severity:** INFO
**Verification Status:** NOT_FIXED (By Design)

## Changes Found

No timelock mechanism has been added to any admin instructions. Admin actions (pool initialization, admin burn, curve management) execute immediately upon signing.

## Verification Analysis

Per v1.3 decisions documented in project memory: "Authorities kept unburnt at launch, gradual burn via timelocked 2-of-3 Squads multisig." The approach is:

1. Deploy with admin authority active (necessary for launch operations)
2. Transfer upgrade authority to a 2-of-3 Squads multisig with timelock
3. Gradually burn admin capabilities per program as the protocol stabilizes

This is an operational/governance solution rather than an on-chain timelock. The original finding acknowledged this was "acceptable given burn capability and intended upgrade authority revocation."

## Regression Check

No regression. Admin instruction structure is unchanged. The burn capabilities remain available for each program that has an admin role (AMM, Bonding Curve).
