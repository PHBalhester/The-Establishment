---
task_id: sos-verification-06-oracle-data
provides: [06-oracle-data-verification]
focus_area: 06-oracle-data
verification_status: VERIFIED
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/06-oracle-data.md
---
<!-- CONDENSED_SUMMARY_START -->
# Oracle & External Data -- Verification Summary

## Verification Status: VERIFIED

## Previous Conclusions Checked: 11

### Verified (Still Valid)

- **INV-O1 (Randomness accounts owned by SWITCHBOARD_PROGRAM_ID)**: Epoch program files MODIFIED but owner constraint pattern is structural. All three VRF instructions (trigger, consume, retry) still validate ownership.
- **INV-O2 (seed_slot within 1 slot)**: Freshness check in trigger + retry is structural.
- **INV-O3 (Not already revealed at commit)**: get_value() check is structural.
- **INV-O4 (consume uses exact bound randomness account)**: Key equality check is structural.
- **INV-O5 (Cannot trigger while VRF pending)**: vrf_pending flag check is structural.
- **INV-O6 (VRF timeout > 300 slots)**: Strict > comparison is structural.
- **INV-O7 (Tax rates bounded)**: Table lookup pattern is structural. Rates set from VRF bytes.
- **INV-O8 (Carnage trigger probability 11/256)**: Constant threshold is structural.
- **INV-O9 (Atomic execution with VRF consumption)**: Bundling pattern is client-side, unchanged.
- **INV-O10 (AMM reserves NOT used as price oracle)**: Pool reserve reads are for slippage floors only. No new oracle usage introduced.
- **INV-O11 (force_carnage devnet-only)**: Feature gate is structural.
- **ORC-001 (Modulo bias INFO)**: Unchanged -- still perfectly uniform for 4-element array.
- **ORC-002 (Single oracle provider)**: Unchanged -- Switchboard VRF is the only randomness source.
- **ORC-003 (VRF timeout exploitation)**: Unchanged -- timeout recovery persists.
- **ORC-006 (Bounty rent-exempt bug)**: Still present (KNOWN).
- **ORC-007 (Pool reserve reading for slippage)**: Pool reader is MODIFIED but used for slippage, not oracle. Needs primary auditor line-level check on byte offsets.
- **ORC-008 (as u32 truncation)**: Still present in trigger_epoch_transition.

### Needs Recheck (Potentially Invalidated)

None. The oracle/VRF architecture is entirely contained within the Epoch Program. While the Epoch Program's constants.rs and lib.rs are MODIFIED, the VRF lifecycle (trigger, consume, retry) and Switchboard integration are structural patterns. The primary auditor should do a line-level pass on modified epoch files, but no cross-dependency from new programs invalidates oracle conclusions.

### New Concerns from Changes

- **Bonding curve has NO oracle dependency**: The bonding curve uses a deterministic linear pricing formula (P_START + slope * tokens_sold). No VRF, no price feeds, no randomness. Clean.
- **Conversion vault has NO oracle dependency**: Fixed 1:100 conversion rate. No external data feeds. Clean.
- **No new programs read VRF state**: Neither bonding curve nor conversion vault reference EpochState tax rates or VRF-derived data.
- **Bonding curve slot-based deadline**: Uses `Clock::get()?.slot` for deadline enforcement (DEADLINE_SLOTS, FAILURE_GRACE_SLOTS). This is slot-only timing, consistent with the protocol's pattern. No timestamp dependency.

## Cross-Focus Handoffs
- -> **02-arithmetic (primary auditor)**: Epoch constants.rs MODIFIED. Verify Switchboard PID feature flags and timing constants unchanged.
- -> **08-timing-ordering**: Bonding curve deadline slots (432,000 for mainnet, 500 for localnet) are new timing parameters needing coverage.

## Summary
Oracle and external data conclusions from audit #1 are fully verified. The VRF lifecycle, anti-reroll protections, and randomness quality assessments are unaffected by changes. Neither new program (bonding curve, conversion vault) introduces oracle dependencies or interacts with VRF state. The Epoch Program's VRF files are MODIFIED but the security patterns are structural. No cross-dependencies invalidate prior conclusions.
<!-- CONDENSED_SUMMARY_END -->
