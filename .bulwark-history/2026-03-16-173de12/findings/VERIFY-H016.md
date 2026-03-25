# VERIFY-H016: Transfer Hook Init Front-Running
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

### Gap 1 — Ownership verification on existing WhitelistAuthority (FIXED)

`scripts/deploy/initialize.ts` lines 341-355: When WhitelistAuthority already exists, the script now deserializes the account via `programs.transferHook.account.whitelistAuthority.fetch()` and checks `storedAuthority.equals(authority.publicKey)`. If the authority does not match the deployer, it throws a `SECURITY: ... Possible front-run attack` error, aborting initialization. This closes the first-caller-wins bypass where an attacker could front-run initialization and the script would silently skip.

### Gap 2 — accountsStrict includes program and programData (FIXED)

`scripts/deploy/initialize.ts` lines 359-365: `accountsStrict` now passes `program: hookProgramId` and `programData: hookProgramDataPda`. The PDA is correctly derived at line 218 using `[hookProgramId.toBuffer()]` seeded against `BPF_LOADER_UPGRADEABLE`.

### On-chain constraint verification (SOLID)

`programs/transfer-hook/src/instructions/initialize_authority.rs` lines 46-55:

- `program` account has constraint `program.programdata_address()? == Some(program_data.key())` — verifies the programData belongs to this program.
- `program_data` account has constraint `program_data.upgrade_authority_address == Some(signer.key())` — verifies the signer is the program's upgrade authority.

Together these constraints ensure only the program's upgrade authority can initialize WhitelistAuthority. The `init` constraint on `whitelist_authority` (line 36-42) ensures the account can only be created once (Anchor's `init` fails if the PDA already exists).

### Regression check

- The `initializeExtraAccountMetaList` instruction (line 390+) still uses a simple `accountExists` skip without ownership verification. However, that instruction requires `authority` to match WhitelistAuthority's stored authority, so it is gated behind the already-secured WhitelistAuthority.
- No bypasses found. The on-chain program enforces upgrade-authority == signer, and the client-side script enforces stored-authority == deployer on the skip path.

## Assessment

The fix is complete. Both original gaps from round 2 are now closed:

1. **Client-side ownership check**: Existing WhitelistAuthority is deserialized and its `authority` field is compared against the deployer's public key before skipping. A mismatch throws an error.
2. **Client-side accountsStrict**: The `initializeAuthority` call now includes `program` and `programData` accounts, matching the on-chain instruction requirements. Fresh deployments will succeed.
3. **On-chain** (unchanged, already solid from round 2): The `InitializeAuthority` instruction requires `program` and `programData` with constraints enforcing signer == upgrade authority.
