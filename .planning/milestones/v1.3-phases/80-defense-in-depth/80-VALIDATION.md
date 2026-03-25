---
phase: 80
slug: defense-in-depth
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 80 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Anchor test (Rust unit tests + TypeScript integration) |
| **Config file** | `Anchor.toml` / `programs/*/Cargo.toml` |
| **Quick run command** | `cargo test -p {program} -- {test_name}` |
| **Full suite command** | `source "$HOME/.cargo/env" && export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH" && cargo test --workspace` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p {affected_program}`
- **After every plan wave:** Run full workspace test
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 80-01-01 | 01 | 1 | DEF-01 | unit | `cargo test -p tax-program -- test_read_pool_rejects_wrong_owner` | ❌ W0 | ⬜ pending |
| 80-01-02 | 01 | 1 | DEF-02 | unit | `cargo test -p tax-program -- test_read_pool_is_reversed` | ❌ W0 | ⬜ pending |
| 80-01-03 | 01 | 1 | DEF-06 | unit | `cargo test -p epoch-program -- test_carnage_pool_owner_constraint` | ❌ W0 | ⬜ pending |
| 80-02-01 | 02 | 1 | DEF-04 | unit | `cargo test -p staking -- test_checked_cast_overflow` | ❌ W0 | ⬜ pending |
| 80-02-02 | 02 | 1 | DEF-04 | unit | `cargo test -p tax-program -- test_floor_checked_cast` | ❌ W0 | ⬜ pending |
| 80-02-03 | 02 | 1 | DEF-04 | unit | `cargo test -p bonding-curve -- test_checked_casts` | ❌ W0 | ⬜ pending |
| 80-02-04 | 02 | 1 | DEF-07 | unit | `cargo test -p epoch-program -- test_invalid_cheap_side` | ❌ W0 | ⬜ pending |
| 80-03-01 | 03 | 2 | DEF-03 | unit | `cargo test -p epoch-program -- test_epoch_state_size` | ❌ W0 | ⬜ pending |
| 80-03-02 | 03 | 2 | DEF-08 | unit | `cargo test -p tax-program -- test_layout_match` | ❌ W0 | ⬜ pending |
| 80-03-03 | 03 | 2 | DEF-05 | unit | `cargo test -p bonding-curve -- test_remaining_accounts_count` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Unit tests for DEF-01 owner check rejection (spoofed account)
- [ ] Unit tests for DEF-02 is_reversed detection
- [ ] Unit tests for DEF-04 overflow on u128::MAX inputs
- [ ] Compile-time assertion for DEF-08 struct size match

*Existing Anchor test infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DEF-03 redeploy compat | DEF-03 | Account size change requires devnet redeploy | Deploy to devnet, verify EpochState deserializes at new size |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
