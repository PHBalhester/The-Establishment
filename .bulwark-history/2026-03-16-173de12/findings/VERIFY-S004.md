# VERIFY-S004: Launch Day Attack Bundle
**Status:** FIXED
**Round:** 3
**Date:** 2026-03-12

## Evidence

S004 bundles four component findings (H010, H009, H016, H005). All are now resolved:

### H010 — Bonding Curve Missing Authority Check: FIXED (unchanged from round 2)
`prepare_transition` and `withdraw_graduated_sol` both enforce `has_one = authority @ CurveError::Unauthorized` against `BcAdminConfig` PDA.

### H009 — Devnet Fallback in Frontend: FIXED (unchanged from round 2)
Browser RPC unconditionally routes through `/api/rpc` proxy. No `NEXT_PUBLIC_RPC_URL` env var dependency or devnet fallback in the browser path.

### H016 — WhitelistAuthority Init Front-Running: FIXED (newly closed in round 3)
Commit `a5ccf54` ("fix initialize.ts program/programData + ownership verification (H016)") closes both client-side gaps identified in round 2:

**Gap 1 — Ownership verification on skip path:** `scripts/deploy/initialize.ts` lines 341-355 now deserializes existing WhitelistAuthority via `programs.transferHook.account.whitelistAuthority.fetch()` and checks `storedAuthority.equals(authority.publicKey)`. Mismatch throws `SECURITY: ... Possible front-run attack`, aborting initialization. The same pattern is applied to all other init skip paths (AMM AdminConfig line 428, VaultConfig line 871, EpochState line 1069, StakePool line 1116, CarnageFundState line 1226, CurveStates lines 1423/1474).

**Gap 2 — Missing program/programData in accountsStrict:** All init calls now include `program` and `programData` accounts. ProgramData PDAs are derived for all 5 programs at lines 218-232 using `BPF_LOADER_UPGRADEABLE`. These are passed to `initializeAuthority` (line 363), `initialize` vault (line 892), `initializeEpochState` (line 1083), `initializeStakePool` (line 1160), `initializeCarnageFund` (line 1245), and tax `initialize` (line 1326).

The on-chain constraints (upgrade authority == signer) were already solid from round 2. The client now matches.

### H005 — Keypairs in Git: ACCEPTED RISK
Mainnet keypairs are gitignored (`keypairs/mainnet-*`). Devnet keypairs remain tracked but are not a launch-day attack vector — devnet keys have no mainnet value, and the protocol will be deployed with fresh mainnet keypairs.

## Assessment

The launch-day attack bundle is now fully closed. The critical gap from round 2 — H016's stale client code in `initialize.ts` — has been resolved by commit `a5ccf54`, which added ProgramData PDA derivation, program/programData accounts to all init calls, and ownership verification on every skip path. All four component findings are either FIXED or represent accepted non-risks (devnet keypairs). An attacker can no longer front-run protocol initialization, exploit missing authority checks, or leverage devnet RPC fallbacks.
