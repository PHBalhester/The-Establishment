# Strategy Combination Verification (Stacked Audit #2)

**Auditor**: Claude Opus 4.6 (1M context)
**Date**: 2026-03-21
**Scope**: Verify 4 strategy findings (S002, S005, S009, S010) still hold after DBS infrastructure and Phase 102 changes.

---

## Methodology

For each strategy finding:
1. Identified constituent on-chain and off-chain files.
2. Checked git history since 2026-03-01 for modifications to those files.
3. Assessed whether new DBS infrastructure (ws-subscriber, protocol-store, SSE routes, webhook handler) introduces new entry points for the attack chains.
4. Verified on-chain guards remain intact and unmodified.

---

## S002 — Crank Wallet Drain Loop (FIXED)

**Attack chain**: H004 (vault top-up loop) + H029 (unbounded crank spending) + H013 (vault cap bypass)
**Status**: **STILL FIXED**

### Constituent file modifications since 2026-03-01

| File | Modified? | Commit |
|------|-----------|--------|
| `scripts/crank/crank-runner.ts` | YES | `755a01c` (configurable epoch slots), `872bf6f` (pubkey-only WSOL, mask RPC URL) |
| `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` | NO | Unchanged |

### Verification

**Circuit breaker** (lines 84-93 of crank-runner.ts): `CIRCUIT_BREAKER_THRESHOLD = 5` consecutive errors halts the crank. Reset to 0 on each successful epoch cycle (line 505). Verified intact.

**Spending cap** (lines 96-150): Rolling 1-hour window, `MAX_HOURLY_SPEND_LAMPORTS = 500_000_000` (0.5 SOL). `recordSpend()` returns false when cap exceeded, causing `break` at lines 430 and 500. Verified intact.

**Vault top-up ceiling** (lines 79-82): `MAX_TOPUP_LAMPORTS = 100_000_000` (0.1 SOL max per top-up). `Math.min(requestedTopUp, MAX_TOPUP_LAMPORTS)` at line 421. Verified intact.

**On-chain rent-exempt guard** (trigger_epoch_transition.rs lines 210-248): Vault balance must exceed `TRIGGER_BOUNTY_LAMPORTS + rent_exempt_min` before bounty transfer. If insufficient, bounty is skipped (not failed). Verified intact.

**Recent changes assessed**:
- `755a01c`: Added `MIN_EPOCH_SLOTS_OVERRIDE` and `CRANK_LOW_BALANCE_SOL` env vars for configurable timing. Does NOT affect spending/circuit breaker logic. No new drain vector.
- `872bf6f`: Changed WSOL loading to pubkey-only (env var, no keypair file). RPC URL masking in logs. No effect on spending paths.

**DBS infrastructure assessment**: The ws-subscriber, protocol-store, and SSE routes run in the Next.js frontend process on Railway. The crank runner is a separate `npx tsx` process. No shared state, no communication channel between them. The crank cannot be triggered or influenced via DBS infrastructure. **No new entry points.**

### Verdict: STILL_FIXED

---

## S005 — Staking + Crank Cascade (FIXED)

**Attack chain**: Concurrent staking actions (stake/unstake/claim) + crank error cascade causing infinite retry loops.
**Status**: **STILL FIXED**

### Constituent file modifications since 2026-03-01

| File | Modified? | Commit |
|------|-----------|--------|
| `programs/staking/src/instructions/stake.rs` | NO | Unchanged on-chain logic |
| `programs/staking/src/instructions/unstake.rs` | YES | `a251ef4` (cooldown gate + forfeiture), `39eadc1` (last_claim_ts) |
| `programs/staking/src/instructions/claim.rs` | YES | `39eadc1` (last_claim_ts in claim), `5cbdd3d` (rent-exempt guard) |
| `scripts/crank/crank-runner.ts` | YES | See S002 above |

### Verification

**Staking concurrency safety**: All three staking instructions (stake, unstake, claim) operate on per-user PDA accounts (`UserStake` with seeds `[USER_STAKE_SEED, user_pubkey]`). Solana's runtime serializes transactions that touch the same accounts, so concurrent operations from the same user are serialized at the validator level. Different users have different PDAs and cannot interfere with each other. The `StakePool` singleton is also serialized by the runtime. This is unchanged.

**Cooldown gate** (unstake.rs lines 124-134): Added since original finding. `COOLDOWN_SECONDS` enforcement on unstake after claim. Prevents rapid stake/claim/unstake cycling. This is a STRENGTHENING of the fix.

**Claim rent-exempt guard** (claim.rs lines 101-121): `available = escrow_balance - rent_exempt_min`. Prevents draining escrow PDA below rent-exempt threshold. This is a STRENGTHENING of the fix.

**Crank circuit breaker**: Still intact per S002 analysis. 5 consecutive errors halt the crank.

**Crank spending cap**: Still intact per S002 analysis. 0.5 SOL/hour rolling cap.

**DBS infrastructure assessment**: The ws-subscriber polls staker data via `getProgramAccounts` (read-only) and stores it in protocol-store. The SSE route streams this data to browsers. None of these paths can invoke on-chain staking instructions. The staker poll in ws-subscriber (lines 368-432) only reads `UserStake` accounts -- it cannot modify them. **No new entry points.**

The Helius webhook handler receives account change notifications for `StakePool` PDA and stores decoded state in protocol-store. This is read-only data flow. No write path from webhook to on-chain programs.

### Verdict: STILL_FIXED (strengthened by cooldown gate and rent-exempt guard)

---

## S009 — Graduation Race (FIXED)

**Attack chain**: Concurrent execution of `graduate.ts` causing double pool seeding or double token minting.
**Status**: **STILL FIXED**

### Constituent file modifications since 2026-03-01

| File | Modified? | Commit |
|------|-----------|--------|
| `scripts/graduation/graduate.ts` | YES | Working tree: whitelist burn disabled |
| `programs/bonding_curve/src/instructions/prepare_transition.rs` | NO | Unchanged |

### Verification

**On-chain idempotency (prepare_transition.rs)**:
- Lines 62-71: Both curves MUST be in `CurveStatus::Filled` state. `prepare_transition` sets both to `CurveStatus::Graduated` (terminal state).
- A second call to `prepare_transition` after graduation fails because `status == CurveStatus::Filled` check fails (they're now `Graduated`). This is the critical on-chain gate.

**Script-level checkpoint+resume** (graduate.ts): The script saves progress to `graduation-state.json` after each step (documented in header comment lines 12-14). Re-running skips completed steps. Pool initialization via `initialize_pool` uses PDA seeds derived from mint pair, so attempting to create an already-existing pool fails with Anchor's `init` constraint (account already exists at that address).

**Working tree change**: The only uncommitted change to graduate.ts is disabling the whitelist authority burn (step 13). The `burnWhitelistAuthority` function now throws an error immediately. This does not affect graduation race safety -- it's a post-graduation housekeeping step.

**DBS infrastructure assessment**: `graduate.ts` is a manual admin script run via CLI (`npx tsx scripts/graduation/graduate.ts`). It is not triggered by webhooks, SSE, or any DBS infrastructure. The ws-subscriber does monitor `CurveState` PDAs, but only reads their state -- it cannot invoke graduation instructions. **No new entry points.**

### Verdict: STILL_FIXED

---

## S010 — VRF Recovery MEV Window (NOT_VULNERABLE)

**Attack chain**: During VRF timeout recovery (retry_epoch_vrf), an attacker could front-run the fresh randomness reveal to manipulate Carnage outcomes.
**Status**: **STILL NOT_VULNERABLE**

### Constituent file modifications since 2026-03-01

| File | Modified? | Commit |
|------|-----------|--------|
| `programs/epoch-program/src/instructions/retry_epoch_vrf.rs` | NO | Unchanged |
| `programs/epoch-program/src/instructions/consume_randomness.rs` | YES | `bc609f6` (carnage_lock_slot), `1684fc9` (checked Token::from_u8) |
| `programs/epoch-program/src/instructions/execute_carnage.rs` | YES | `bc609f6` (lock window guard) |
| `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` | NO | Core logic unchanged |
| `scripts/crank/crank-runner.ts` | YES | See S002 above |

### Verification

**Anti-reroll protection** (consume_randomness.rs lines 153-157): `randomness_account.key() == epoch_state.pending_randomness_account`. The randomness account is bound at commit time (trigger/retry) and verified at consume time. An attacker cannot substitute a different randomness account.

**Switchboard On-Demand atomic bundling**: The crank bundles `revealIx + consume_randomness + execute_carnage_atomic` in a single v0 VersionedTransaction (documented in crank-runner.ts header comment lines 15-17). This means:
1. The reveal and consume happen in the same transaction
2. No on-chain `CarnagePending` event is visible before the swap executes
3. An attacker cannot see the VRF result and front-run the Carnage swap

**Carnage lock window** (added since original finding, STRENGTHENING):
- `consume_randomness.rs` lines 297-300: Sets `carnage_lock_slot = current_slot + CARNAGE_LOCK_SLOTS` (50 slots).
- `execute_carnage.rs` lines 202-208: The non-atomic `execute_carnage` instruction requires `clock.slot > epoch_state.carnage_lock_slot`. During the first 50 slots (~20 seconds), ONLY the atomic path (bundled in the same TX as consume_randomness) can execute Carnage.
- This is a defense-in-depth layer: even if the atomic bundle somehow fails, the non-atomic fallback path is locked out for 50 slots, preventing MEV front-running.

**Retry path freshness** (retry_epoch_vrf.rs lines 82-90): Fresh randomness account seed_slot must be within 1 slot of current. Cannot reuse stale randomness. Timeout requires 300+ slots elapsed. After retry, the same atomic bundling protections apply.

**DBS infrastructure assessment**: The ws-subscriber monitors `EpochState` PDA changes (lines 73, BATCH_ACCOUNTS). The Helius webhook handler receives `EpochState` account updates. Both are read-only consumers of on-chain state. They broadcast state changes to SSE clients (browsers). None of these paths can:
1. Submit transactions
2. Influence VRF randomness
3. Front-run Carnage execution

The SSE protocol endpoint broadcasts `EpochState` changes including `carnage_pending`, `carnage_target`, and `carnage_action` to connected browsers. In theory, an attacker monitoring SSE could see `CarnagePending` state BEFORE the atomic Carnage swap executes if the non-atomic path is used. However:
- The carnage_lock_slot guard (50 slots) prevents non-atomic execution during the critical window
- The crank always uses atomic bundling (reveal+consume+execute in one TX), so the pending state and execution happen in the same transaction
- SSE latency (Helius webhook -> Next.js -> SSE -> browser) adds seconds of delay, making real-time front-running impractical

**No new vulnerability introduced by DBS infrastructure.**

### Verdict: STILL_NOT_VULNERABLE (strengthened by carnage_lock_slot guard)

---

## Summary

| Finding | Original Status | Verification Result | Notes |
|---------|----------------|-------------------|-------|
| S002 | FIXED | STILL_FIXED | All 3 guards (circuit breaker, spending cap, vault ceiling) intact. No DBS entry points. |
| S005 | FIXED | STILL_FIXED | Strengthened by cooldown gate + rent-exempt guard. Solana runtime serializes concurrent PDA access. No DBS entry points. |
| S009 | FIXED | STILL_FIXED | On-chain `prepare_transition` CurveStatus gate is idempotent. Script checkpointing intact. No DBS entry points. |
| S010 | NOT_VULNERABLE | STILL_NOT_VULNERABLE | Strengthened by carnage_lock_slot (50-slot atomic-only window). Anti-reroll + atomic bundling intact. SSE broadcasts are read-only, cannot influence execution. |

**NEEDS_FULL_RECHECK**: None. While several constituent files were modified since 2026-03-01, all modifications either:
- Strengthened existing protections (cooldown gate, rent-exempt guard, carnage_lock_slot)
- Added unrelated functionality (configurable epoch slots, pubkey-only WSOL loading)
- Were in the DBS read-only data pipeline (ws-subscriber, protocol-store)

No modifications weakened any of the defenses that close these strategy findings.
