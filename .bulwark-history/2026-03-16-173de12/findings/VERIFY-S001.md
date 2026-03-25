# VERIFY-S001: Chained Supply Chain Attack
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12
**Previous:** PARTIALLY_FIXED

## Finding Summary
S001 describes a chained supply chain attack combining H003 (lockfile not committed), H002 (API key in client bundle), H001 (webhook auth fail-open), and H016 (transfer hook init front-running). The strategy requires multiple links to be viable.

## Evidence

### H001 (Webhook Auth Fail-Open): FIXED
Fail-open replaced with fail-closed in production. The timing side-channel via `!==` instead of `crypto.timingSafeEqual` is a theoretical concern but not exploitable over network latency for a webhook secret comparison (response time is dominated by I/O, not comparison). Verified fixed in prior rounds.

### H002 (API Key in Client Bundle): FIXED
RPC proxy keeps the RPC URL server-side. The `HELIUS_API_KEY` reference in shared/constants.ts is a server-side constant used only in API routes -- Next.js tree-shaking ensures it does not reach client bundles unless explicitly imported by a client component. Verified fixed in prior rounds.

### H003 (Lockfile Not Committed): FIXED
package-lock.json is committed and tracked. Railway/Nixpacks uses `npm ci` by default, which enforces exact versions from the lockfile. Verified fixed in prior rounds.

### H016 (Transfer Hook Init Front-Running): FIXED
Commit a5ccf54 (Phase 90) added:
1. **Ownership verification on skip path**: `initialize.ts` lines 341-355 deserialize existing WhitelistAuthority and compare `storedAuthority` against deployer pubkey. Mismatch throws `SECURITY: Possible front-run attack`.
2. **program + programData in accountsStrict**: Lines 218-232 derive programData PDAs for all 5 programs via `BPF_LOADER_UPGRADEABLE`. Lines 359-365 (and equivalents for epoch, staking, vault, tax) pass these to `accountsStrict`, enforcing on-chain upgrade-authority == signer constraint.
3. **On-chain constraints verified**: `initialize_authority.rs` lines 46-55 enforce `program.programdata_address() == Some(program_data.key())` and `program_data.upgrade_authority_address == Some(signer.key())`.

This was the last residual gap cited in the S001 chain. With H016 now FIXED, all four constituent findings are closed.

## Assessment

All four links in the chain attack are now individually fixed:
- H001: fail-closed webhook auth
- H002: API key server-side only
- H003: lockfile committed + `npm ci` enforcement
- H016: upgrade-authority verification on all init instructions + client-side ownership checks

The chained attack strategy is no longer viable. Upgrading from PARTIALLY_FIXED to **FIXED**.
