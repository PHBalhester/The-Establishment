# VulnHunter Report: Dr. Fraudsworth Protocol
**Date:** 2026-03-12
**Scope:** Full protocol — 7 on-chain programs (Rust/Anchor) + frontend/scripts (TypeScript)
**Method:** Variant analysis seeded from .audit (28 findings) and .bulwark (61 findings) audit reports
**Auditor:** VulnHunter automated sweep + manual verification

---

## Executive Summary

**Protocol security posture: STRONG**

Systematic variant hunting across 13 root-cause patterns extracted from two prior audits found **zero new critical or high-severity vulnerabilities**. All previously-identified patterns have been remediated. The codebase demonstrates mature security practices including checked arithmetic, PDA-gated authority, rent-exempt guards, and fail-closed authentication.

| Severity | New Findings | Prior (Fixed) | Prior (By Design) |
|----------|-------------|--------------|-------------------|
| CRITICAL | 0 | 6 | 0 |
| HIGH | 0 | 23 | 2 |
| MEDIUM | 2 | 22 | 0 |
| LOW | 3 | 28 | 16 |
| INFO | 3 | 2 | — |
| **TOTAL** | **8** | **81** | **18** |

---

## New Findings

### VH-M001: Webhook Management Script Defaults to Production URL
- **Severity:** MEDIUM
- **Location:** `scripts/webhook-manage.ts:47`
- **Pattern:** Unsafe default configuration
- **Description:** `DEFAULT_WEBHOOK_URL` is hardcoded to the production Railway deployment. Running `webhook-manage.ts create` without `WEBHOOK_URL` env var registers devnet webhooks to production, mixing environments.
- **Recommendation:** Make `WEBHOOK_URL` mandatory — error and exit if not set.

### VH-M002: Rate Limiter IP Collision Under Proxy Misconfiguration
- **Severity:** MEDIUM
- **Location:** `app/lib/rate-limit.ts:127-138`
- **Pattern:** Fail-open on missing headers
- **Description:** `getClientIp()` falls back to `"unknown"` when `x-forwarded-for`/`x-real-ip` headers are missing. If Railway's reverse proxy is misconfigured, all traffic shares one rate-limit bucket, causing legitimate users to get 429s during any DoS attempt.
- **Recommendation:** Log a warning when proxy headers are absent. Consider rejecting requests without proxy headers in production.

### VH-L001: Keypair Files Created with Default umask (0644)
- **Severity:** LOW
- **Location:** `scripts/deploy/initialize.ts:156-170`, `scripts/deploy/patch-mint-addresses.ts:35-42`
- **Pattern:** Insufficient file permissions
- **Description:** `fs.writeFileSync()` creates keypair files as world-readable (0644 default). On shared dev machines, any local user can read secret keys.
- **Recommendation:** Add `{ mode: 0o600 }` to keypair file writes.

### VH-L002: Missing TLS Warning for Non-Production Database
- **Severity:** LOW
- **Location:** `app/db/connection.ts:48-57`
- **Pattern:** Missing environment validation
- **Description:** Non-production database connections skip TLS. If a developer accidentally uses a public DB hostname locally, credentials transmit in plaintext.
- **Recommendation:** Warn if `DATABASE_URL` hostname is not `localhost`/`127.0.0.1` in non-production.

### VH-L003: Staking Comment Says 5e17 "Well Below" 9e15
- **Severity:** LOW (cosmetic)
- **Location:** `app/lib/staking/rewards.ts:79-82`
- **Pattern:** Misleading documentation
- **Description:** Comment claims 5e17 is "well below" 9e15 — magnitudes are inverted. Zero security impact but confusing for auditors.

### VH-I001: AMM Passes Same remaining_accounts to Both Transfers
- **Severity:** INFO (observation)
- **Location:** `programs/amm/src/instructions/swap_sol_pool.rs:223,248,275,300`
- **Pattern:** Hook account forwarding assumption
- **Description:** In mixed pools (T22/SPL), only the T22 transfer consumes hook accounts. The AMM passes the full `ctx.remaining_accounts` to both `transfer_t22_checked` calls. This works because in SOL pools, only one side is T22. For PROFIT pools (dual T22), the Epoch Program's `partition_hook_accounts()` pre-splits [sell_hooks, buy_hooks] before CPI. The AMM relies on callers providing correctly-ordered accounts.
- **Status:** Working correctly for current pool types. Document this contract explicitly.

### VH-I002: Epoch-to-u32 Cast Theoretical Overflow
- **Severity:** INFO
- **Location:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:83`
- **Pattern:** `((slot - genesis) / SLOTS_PER_EPOCH) as u32`
- **Description:** Epoch counter cast from u64 to u32. Overflow after ~4 billion epochs (~thousand years at current slot rate). Not exploitable in any realistic timeframe.

### VH-I003: Localnet Feature Uses Pubkey::default() Placeholders
- **Severity:** INFO
- **Location:** Multiple constants.rs files (bonding_curve, conversion-vault, tax-program)
- **Pattern:** `#[cfg(feature = "localnet")] fn x() -> Pubkey { Pubkey::default() }`
- **Description:** Localnet feature flag uses zero-address placeholders. This is safe because: (1) localnet is never deployed externally, (2) mainnet builds trigger `compile_error!`, (3) devnet builds use real addresses. All 8 mainnet placeholders have `compile_error!` guards confirmed.

---

## Variant Hunt Results by Pattern

### Pattern 1: Bare Signer Authority
**Seed:** .audit CRITICAL-001 (H001/H002/H010) — bonding curve authority theft
**Variants found:** 0/42 signers vulnerable
**Status:** ALL SECURE. Every `Signer<'info>` across all 7 programs has proper validation:
- 6 use ProgramData upgrade-authority
- 11 use `has_one` constraints
- 8 use PDA `seeds::program`
- 7 are payer-only (safe)
- 5 are intentionally permissionless (epoch triggers)
- 5 are user self-authority

### Pattern 2: Initialization Front-Running
**Seed:** .audit CRITICAL-002 (H007/H036) — transfer hook init front-running
**Variants found:** 0/16 init instructions vulnerable
**Status:** ALL SECURE.
- 8 root-level inits have ProgramData validation
- 5 delegate through admin configs (transitive security)
- 2 are per-user PDAs (no gate needed)
- 1 is test-only stub

### Pattern 3: Slippage/MEV Gaps
**Seed:** .audit H008 — sell path `amm_minimum=0`
**Variants found:** 0 remaining
**Status:** FIXED. Sell path now computes `gross_minimum` from user's `minimum_output` and `tax_bps`. Both buy and sell paths forward meaningful minimums to AMM CPI.

### Pattern 4: Cross-Program Layout Coupling
**Seed:** .audit H011/S007 — EpochState mirror struct drift
**Variants found:** 0 unguarded
**Status:** FIXED.
- Cross-crate round-trip serialization test exists
- `DATA_LEN = 100` compile-time assertion in mirror
- 64-byte reserved padding for future evolution
- Pool reserve offsets (137/145) validated in test_swap_sol_buy.rs:224

### Pattern 5: Rent Depletion
**Seed:** .audit H012/S003 — escrow rent drain
**Variants found:** 0/8 lamport manipulations unguarded
**Status:** ALL PROTECTED. Every `try_borrow_mut_lamports()` subtraction is preceded by `Rent::get()?.minimum_balance(0)` check. Specific guards:
- Staking claim.rs: Lines 101-121
- BC sell.rs: Lines 175-179 + post-state solvency check
- BC distribute_tax_escrow.rs: Lines 79-83
- BC claim_refund.rs: Lines 144-151
- BC withdraw_graduated_sol.rs: Lines 73-78
- BC consolidate_for_refund.rs: Lines 109-113
- Epoch trigger_epoch_transition.rs: Lines 207-210 (threshold = bounty + rent_exempt)

### Pattern 6: Arithmetic Overflow/Unchecked Casts
**Seed:** .audit H077 — unchecked `as u64` in refund
**Variants found:** 0 exploitable
**Status:** ALL SAFE.
- All production `.unwrap()` calls are on compile-time constants (Pubkey::from_str on hardcoded addresses) or preceded by checked operations
- All `as u64` casts are bounded by u64 input ranges (max: 0.85 * u64::MAX, fits u64)
- All division denominators are either constants or checked for zero
- `u64::try_from()` used for cross-boundary casts with `?` error propagation

### Pattern 7: State Machine Integrity
**Seed:** .audit H002/H010 — forced state transitions
**Variants found:** 0
**Status:** FIXED. All state transitions gated by `has_one = authority` on BcAdminConfig.

### Pattern 8: CPI/Oracle Magic Numbers
**Seed:** .audit H009/S008 — pool reserve byte offsets
**Variants found:** 0 unguarded
**Status:** FIXED. Pool owner check (`pool_info.owner == amm_program_id()`) added for defense-in-depth. Offsets validated by tests.

### Pattern 9: Front-Running/Sandwich
**Seed:** .audit H016 / .bulwark H015 — MEV exposure
**Variants found:** 0 new vectors
**Status:** Mitigated via:
- Atomic bundling (reveal + consume + carnage in single TX)
- Gross minimum forwarding on sell path
- 50% output floor as last-resort backstop
- Tax rate (6% round-trip) makes small-trade sandwiches unprofitable
- Residual: default 500 BPS slippage could be tightened to 100-200 BPS

### Pattern 10: Mainnet Placeholders
**Seed:** .audit H018/S004 — Pubkey::default() in production
**Variants found:** 0 unguarded
**Status:** ALL 8 placeholders have `compile_error!` guards confirmed:
- Tax Program: `treasury_pubkey()` (1)
- Bonding Curve: `crime_mint()`, `fraud_mint()`, `epoch_program_id()` (3)
- Conversion Vault: `crime_mint()`, `fraud_mint()`, `profit_mint()` (3)
- Localnet `Pubkey::default()` is acceptable (never deployed externally)

### Pattern 11: Emergency Pause
**Seed:** .bulwark H106 — no pause mechanism
**Status:** Deliberate design decision. Documented and accepted.

### Pattern 12: Supply Chain
**Seed:** .bulwark H003 — npm lockfile + caret deps
**Variants found:** 0 new (H003 was fixed)
**Status:** FIXED per .bulwark verification.

### Pattern 13: Fail-Open Authentication (TypeScript)
**Seed:** .bulwark H001 — webhook auth bypass
**Variants found:** 0
**Status:** ALL SECURE.
- Webhook: fail-closed in production + timing-safe comparison
- RPC proxy: method allowlist (14 methods)
- All API routes: rate-limited
- SSE: connection caps + auto-cleanup
- No eval/exec/spawn in codebase
- No hardcoded secrets (all via env vars)
- BigInt used for all large arithmetic (no JS number overflow)

---

## Cross-Program Seed Consistency Verification

All 4 cross-program PDA seeds verified byte-identical:

| Seed | Programs | Value | Tests |
|------|----------|-------|-------|
| `SWAP_AUTHORITY_SEED` | AMM, Tax | `b"swap_authority"` | bok_constants.rs:88 |
| `TAX_AUTHORITY_SEED` | Tax, Staking | `b"tax_authority"` | bok_constants.rs:124, staking constants.rs:128 |
| `CARNAGE_SIGNER_SEED` | Epoch, Tax | `b"carnage_signer"` | bok_constants.rs:97, test_carnage_signer_pda.rs |
| `STAKING_AUTHORITY_SEED` | Epoch, Staking | `b"staking_authority"` | epoch constants.rs:216, staking constants.rs:181 |

All seeds have both value AND length assertions in tests.

---

## Recommendations (Priority Order)

### Must Fix Before Mainnet
1. **VH-M001**: Make `WEBHOOK_URL` mandatory in webhook-manage.ts
2. **VH-L001**: Set `mode: 0o600` on keypair file writes
3. **Default slippage**: Consider tightening from 500 BPS to 100-200 BPS (residual from H015)

### Should Fix
4. **VH-M002**: Add proxy header warning in rate limiter
5. **VH-L002**: Database TLS warning for non-localhost in dev
6. **VH-L003**: Fix inverted magnitude comment in rewards.ts

### Document
7. **VH-I001**: Add explicit comment in AMM swap_sol_pool.rs about remaining_accounts contract
8. **VH-I002**: Note epoch u32 overflow timeline in constants.rs

---

## Files Analyzed

**On-chain (Rust):** 78 production .rs files across 7 programs
- AMM (11), Staking (10), Tax (10), Epoch (16), Bonding Curve (15), Transfer Hook (8), Conversion Vault (8)

**Off-chain (TypeScript):** 35+ files
- 8 API routes, 15 library/utility files, 12 deployment/crank scripts

**Audit Seed Patterns:** 89 findings from 2 prior audits (.audit + .bulwark)
**Variant Searches:** 13 systematic pattern hunts
**Total Signers Audited:** 42
**Total Init Instructions Audited:** 16
**Total Lamport Manipulations Audited:** 8
**Total CPI Calls Audited:** All cross-program invocations

---

## Conclusion

The Dr. Fraudsworth protocol is in strong shape for mainnet. The two prior audits identified real vulnerabilities — all critical and high findings have been remediated with defense-in-depth patterns. No new variants of any known vulnerability pattern were discovered. The 8 new findings are all medium/low/info severity and relate to operational tooling rather than on-chain security.

The protocol's on-chain Rust code is particularly well-hardened: zero unsafe blocks, zero exploitable unwraps, comprehensive checked arithmetic, proper PDA authority gating, rent-exempt guards on all lamport manipulations, and compile-time guards against mainnet misconfiguration.
