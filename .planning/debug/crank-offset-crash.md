---
status: resolved
trigger: "Crank runner on Railway crashes immediately after loading configuration with: RangeError [ERR_OUT_OF_RANGE]: The value of \"offset\" is out of range. It must be >= 0 and <= 99. Received 100"
created: 2026-03-08T00:00:00Z
updated: 2026-03-08T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - IDL updated with reserved padding but on-chain account not reallocated
test: n/a - root cause confirmed
expecting: n/a
next_action: Return diagnosis

## Symptoms

expected: Crank should start up, load configuration, and begin its epoch advancement loop
actual: Crank crash-loops every ~3 seconds. Successfully loads config then hits FATAL RangeError trying to read buffer at offset 100 when buffer is only 100 bytes (max offset 99)
errors: `RangeError [ERR_OUT_OF_RANGE]: The value of "offset" is out of range. It must be >= 0 and <= 99. Received 100`
reproduction: Deploy to Railway - crash-loops on startup. Appeared after commit 37222c6 (IDL updates)
started: After most recent deploy including commit 37222c6

## Eliminated

## Evidence

- timestamp: 2026-03-08T00:01:00Z
  checked: crank-runner.ts crash location
  found: Crash occurs at line 253-256, calling readEpochState() which uses Anchor's epochProgram.account.epochState.fetch()
  implication: Anchor IDL deserialization is the source of the Buffer read, not manual offsets

- timestamp: 2026-03-08T00:02:00Z
  checked: EpochState Rust struct (epoch_state.rs)
  found: Phase 80 (commit 5344657) added `reserved: [u8; 64]` padding field, changing DATA_LEN from 100 to 164 bytes (108 to 172 with discriminator)
  implication: On-chain struct expects 172-byte account

- timestamp: 2026-03-08T00:03:00Z
  checked: IDL diff in commit 37222c6
  found: app/idl/epoch_program.json was updated to include `reserved` field, changing documented size from "8 + 100 = 108 bytes" to "8 + 164 = 172 bytes". This was committed and pushed to Railway.
  implication: The IDL pushed to production now expects 172-byte EpochState accounts

- timestamp: 2026-03-08T00:04:00Z
  checked: Deployment history
  found: Last deploy was Phase 69 (commit c2e0301). Phase 80 struct changes were never deployed on-chain. The on-chain EpochState account is still 108 bytes (8 discriminator + 100 data).
  implication: IDL/client expects 172 bytes, on-chain account is 108 bytes. Anchor fetch() strips 8-byte discriminator leaving 100-byte buffer, then tries to read `reserved` field at offset 100 -- exactly matching the error "offset must be >= 0 and <= 99. Received 100"

## Resolution

root_cause: Commit 37222c6 pushed updated IDLs (app/idl/epoch_program.json) that include the Phase 80 `reserved: [u8; 64]` padding field to Railway. The on-chain EpochState account was never redeployed/reallocated, so it remains at 100 bytes of data. When Anchor's fetch() strips the 8-byte discriminator and tries to deserialize 164 bytes from a 100-byte buffer, it crashes at byte offset 100 (the start of the `reserved` field).
fix: No action needed — self-resolves when epoch program is redeployed with account reallocation in v1.4. Crank downtime accepted during v1.3 (no active devnet testing).
verification: Crank will recover after v1.4 redeploy cycle
files_changed: []
