# Dr. Fraudsworth's Finance Factory
## VRF Migration Lessons & Spec Discrepancy Register

---

## 1. Purpose

This document captures the lessons learned from the v3 Switchboard VRF migration -- the painful journey from abandoned crates to a working client-side commit-reveal integration.

**Companion document:** `Docs/VRF_Implementation_Reference.md` covers the technical details of what works (Rust patterns, TypeScript client flow, account structures, security tests). This document covers **what didn't work**, **why**, and **what decisions remain open**.

**Spec discrepancy register:** Section 5 catalogues every point where `Docs/Epoch_State_Machine_Spec.md` (the intended design) differs from the v3-archive implementation (the proven working code). Each discrepancy requires a human decision before reimplementation begins. All are presented neutrally -- neither version is assumed correct.

---

## 2. Migration Timeline

### 2.1 Initial Attempt: `solana-randomness-service-lite`

**Pattern:** CPI-callback. The on-chain program sends a CPI to the Switchboard randomness service to request randomness. The service later calls back into the program with the result.

**What happened:** The crate references account `DCe143sY8nC6SNwZWwi7qeFco7FxSvKrGrZ62vsufTJa`, which does not exist on devnet or mainnet. Every transaction attempting to use this account fails immediately.

**Root cause:** Switchboard deprecated the old callback-based randomness service and shut down the infrastructure. However, the crate `solana-randomness-service-lite` remained published on crates.io with no deprecation notice, no warning in the README, and no updated documentation pointing to the replacement. It compiled fine -- it just referenced ghost infrastructure.

**Time lost:** Several days of debugging "account not found" errors before realizing the entire service was abandoned.

### 2.2 Second Attempt: `solana-randomness-service` / `switchboard-v2`

**Pattern:** Legacy VRF v2. On-chain proof verification requiring 276 individual instructions split across approximately 48 transactions.

**What happened:** Two compounding problems:
1. **Version mismatch:** `solana-randomness-service` was built with Anchor 0.29. The project uses Anchor 0.32. Incompatible IDL formats and account discriminators caused build failures.
2. **Extreme complexity:** VRF v2 required submitting 276 instructions across ~48 transactions for a single randomness proof. This is not a practical design for per-epoch randomness.

**Root cause:** VRF v2 was designed before Switchboard's SGX TEE infrastructure existed. The on-chain proof verification was a necessary evil at the time, but the approach was deprecated in favor of On-Demand (SGX-based attestation).

**Abandoned:** The combination of version incompatibility and prohibitive transaction count made this approach unviable.

### 2.3 Successful Approach: `switchboard-on-demand` v0.11.3

**Pattern:** Client-side commit-reveal using SGX Trusted Execution Environment (TEE).

**How it works:** The Switchboard oracle runs inside an SGX enclave. The client creates a randomness account, commits to a request, and the oracle (running in SGX) attests the randomness. The client then reveals and the on-chain program simply reads the attested value -- no CPI to Switchboard needed.

**Three-transaction flow:**

| Transaction | Purpose | Key Detail |
|-------------|---------|------------|
| 1. Create | Initialize randomness account | Must finalize before Tx 2 |
| 2. Commit | Lock randomness request + program commit | Bundles SDK commitIx + program commitEpochRandomness |
| 3. Reveal + Consume | Oracle reveals + program reads result | Bundles SDK revealIx + program consumeRandomness |

**Result:** Successfully tested on devnet with real Switchboard oracles. Epoch advanced from 1 to 2 with VRF-derived tax rates. The integration proved stable and the approach was validated.

---

## 3. Pitfall Catalog

### Pitfall 1: Abandoned Crate (`solana-randomness-service-lite`)

| Aspect | Detail |
|--------|--------|
| **What happened** | `solana-randomness-service-lite` compiled successfully but every transaction failed at runtime. The crate references account `DCe143sY8nC6SNwZWwi7qeFco7FxSvKrGrZ62vsufTJa` which does not exist on any Solana cluster. |
| **Root cause** | Switchboard deprecated the CPI-callback randomness service and shut down the backing infrastructure. The crate was never marked deprecated on crates.io. No error at compile time -- only at runtime. |
| **How to avoid** | Always use `switchboard-on-demand` (currently v0.11.3). Before adopting any Solana/Switchboard crate, check: (1) last update date on crates.io, (2) GitHub repo activity, (3) whether referenced accounts actually exist on devnet. |
| **Warning signs** | Crate not updated in >6 months. References unknown account addresses. No recent issues or PRs on the GitHub repo. README doesn't mention "On-Demand" or "SGX". |

### Pitfall 2: SDK Requires Account to Exist Before `commitIx`

| Aspect | Detail |
|--------|--------|
| **What happened** | Attempting to create the randomness account and call `commitIx()` in the same transaction fails with "Account not found" errors. |
| **Root cause** | `Randomness.create()` returns a `createIx` instruction, but the SDK's `commitIx()` method fetches the account's on-chain data *client-side* before constructing the commit instruction. If the account hasn't been finalized on-chain yet, the SDK cannot read it. |
| **How to avoid** | Always send `createIx` in a **separate transaction** and wait for **finalization** (not just confirmation) before calling `commitIx()`. This is non-negotiable -- the SDK architecture requires it. |
| **Warning signs** | "Account not found" or "Account does not exist" errors when calling `commitIx()`. Especially confusing because `createIx` was already sent "successfully" in the same or previous transaction. |

### Pitfall 3: Compute Unit Underestimation

| Aspect | Detail |
|--------|--------|
| **What happened** | VRF transactions fail with "Exceeded maximum compute units" using default compute budgets. |
| **Root cause** | Switchboard's `createIx` needs ~150-200k CU. The commit bundle (`commitIx` + program `commitEpochRandomness`) needs ~400k CU. Default Solana compute budget (200k CU) is insufficient. |
| **How to avoid** | Always include `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` as the first instruction in VRF transaction bundles. Budget generously -- the cost of over-budgeting is zero (unused CU is not charged). |
| **Warning signs** | "Exceeded maximum compute units" or "Computational budget exceeded" errors. Transactions that work on localnet but fail on devnet (different default limits or runtime behavior). |

### Pitfall 4: `revealIx` Not Ready Immediately

| Aspect | Detail |
|--------|--------|
| **What happened** | Calling `randomness.revealIx()` immediately after commit fails. The oracle has not yet processed the commitment. |
| **Root cause** | The Switchboard oracle (running in SGX) needs time to observe the commitment on-chain and produce the attested randomness. This requires at minimum ~3 slot advancements after the commit transaction is confirmed. |
| **How to avoid** | Implement retry logic with backoff. V3 used up to 10 retries with 2-second delays between attempts. Wait for slot advancement before the first attempt: `await waitForSlotAdvance(3)`. |
| **Warning signs** | "Reveal not ready" or similar errors from the SDK. The error is transient -- retrying after a delay resolves it. If it persists beyond ~20 seconds, the oracle may be down (see Pitfall 5). |

### Pitfall 5: Timeout Recovery Required

| Aspect | Detail |
|--------|--------|
| **What happened** | If the randomness request is never fulfilled by the oracle (oracle down, rotated, or network congestion), the epoch state becomes permanently stuck with `randomness_pending = true`. No new epoch can advance. |
| **Root cause** | Without a timeout mechanism, a failed VRF request creates a permanent deadlock. The program waits for randomness that will never arrive. |
| **How to avoid** | Implement timeout recovery. V3 uses `RANDOMNESS_TIMEOUT = 3600` seconds (1 hour). After the timeout elapses, the program allows a new `commitEpochRandomness` even if `randomness_pending = true`. The stale request is abandoned and a fresh one starts. |
| **Warning signs** | `randomness_pending = true` persisting for more than an hour. Monitoring should alert on this condition. The epoch number stops incrementing despite elapsed time. |

### Pitfall 6: Epoch State Account Resize on Migration

| Aspect | Detail |
|--------|--------|
| **What happened** | Adding VRF tracking fields to `EpochState` changed the account size from 50 bytes to 82 bytes. Existing accounts on devnet could no longer be deserialized -- Anchor's borsh deserializer expected the new, larger layout but encountered the old, smaller data. |
| **Root cause** | Anchor's `init` constraint creates accounts at a fixed size determined at initialization time. Adding fields to the struct changes the expected size, but existing on-chain accounts retain their original allocation. |
| **How to avoid** | V3 created a dedicated `resize_epoch` instruction that uses `realloc` to grow the account to the new size, zero-initializing the new fields. This pattern should be used for any future account schema changes. Plan for schema evolution from the start by reserving extra space or having a versioned account format. |
| **Warning signs** | "Failed to deserialize account" or "Unexpected account data length" errors after deploying a program upgrade that adds fields to an existing account struct. |

---

## 4. Deprecated Approaches (Don't Use)

| Library / Approach | Status | Problem | Use Instead |
|--------------------|--------|---------|-------------|
| `solana-randomness-service-lite` | **Abandoned** | References account `DCe143s...` that doesn't exist on devnet or mainnet. Service infrastructure shut down. | `switchboard-on-demand` v0.11.3+ |
| `solana-randomness-service` | **Outdated** | Built with Anchor 0.29; incompatible IDL/discriminators with Anchor 0.32. Not maintained for current Anchor versions. | `switchboard-on-demand` v0.11.3+ |
| `switchboard-v2` | **Deprecated** | Legacy VRF v2 requiring 276 instructions across ~48 transactions for a single proof verification. Prohibitively complex and expensive. | `switchboard-on-demand` v0.11.3+ |
| CPI callback pattern | **Superseded** | Relies on external callback infrastructure that can silently fail or be deprecated. More fragile than client-side patterns. The backing infrastructure for this pattern has been shut down. | Client-side commit-reveal via `switchboard-on-demand` SDK |

**Summary:** All roads lead to `switchboard-on-demand`. The On-Demand pattern using SGX TEE attestation is the only currently maintained and viable approach for Switchboard randomness on Solana.

---

## 5. Spec Discrepancy Register

The following discrepancies exist between `Docs/Epoch_State_Machine_Spec.md` (the current specification on main) and the v3-archive implementation (proven working on devnet). Each requires a human decision before reimplementation begins.

**Legend:**
- **Status: PENDING** -- No decision made yet. Requires human review.
- **Status: RESOLVED:SPEC** -- Decision made: spec version adopted for v4 reimplementation.
- **Spec** = `Docs/Epoch_State_Machine_Spec.md` (intended design)
- **V3** = `v3-archive` branch (working implementation)

---

### DISC-01: Timing Model

| Field | Detail |
|-------|--------|
| **Aspect** | How epoch duration and boundaries are determined |
| **Spec says** | Slot-based timing. `SLOTS_PER_EPOCH = 4,500` (~30 minutes at 400ms/slot). Epoch boundaries calculated from slot numbers relative to a genesis slot. |
| **V3 implemented** | Timestamp-based timing. `DEFAULT_DURATION = 3,600` seconds (1 hour). Epoch boundaries calculated from `Clock::unix_timestamp`. |
| **Analysis** | Slot-based timing is more deterministic: slot numbers are monotonically increasing and not subject to clock drift or validator time disagreements. Timestamp-based timing is simpler to implement and reason about, and avoids assumptions about slot rate (which varies under load). The spec argues that slot-based timing creates predictable windows for arbitrageurs (they know exactly when the epoch changes). Timestamp-based timing may have edge cases around validator clock skew, though Solana's `Clock` sysvar is generally reliable. The epoch duration also differs: ~30 minutes (spec) vs 1 hour (v3). |
| **Decision needed** | Choose timing mechanism (slot-based or timestamp-based) and epoch duration (~30 min or 1 hour). |
| **Status** | **RESOLVED:SPEC** -- Spec version adopted for v4 reimplementation. Keep slot-based timing (4,500 slots, ~30 min). |

---

### DISC-02: Tax Model

| Field | Detail |
|-------|--------|
| **Aspect** | How VRF randomness maps to tax rates |
| **Spec says** | "Cheap side" regime with discrete bands. One token is designated "cheap" (low tax: 1-4% in 4 steps) and the other "expensive" (high tax: 11-14% in 4 steps). A VRF byte determines which token is cheap and the magnitude within each band. Creates clear directional arbitrage signals. |
| **V3 implemented** | Independent continuous rates per pool. Each pool gets its own buy and sell tax rate, independently derived from a random byte via linear interpolation across 0.75%-14.75% (75-1475 bps). No "cheap side" concept -- rates are uncorrelated. |
| **Analysis** | The spec model is more game-theoretically structured: traders always know which token is "cheap" and can calculate arbitrage opportunities. This creates predictable flow patterns that sustain volume. The v3 model is simpler and was proven working, but without the "cheap side" mechanic, arbitrage opportunities are less systematic and harder to predict. The v3 model has wider range (0.75% vs 1% minimum) and no enforced relationship between the two tokens' rates. |
| **Decision needed** | Choose between "cheap side" discrete bands (spec) or independent continuous rates (v3), considering impact on arbitrage dynamics and implementation complexity. |
| **Status** | **RESOLVED:SPEC** -- Spec version adopted for v4 reimplementation. Keep "cheap side" discrete bands. |

---

### DISC-03: VRF Byte Usage

| Field | Detail |
|-------|--------|
| **Aspect** | How many bytes of VRF output are consumed and what they control |
| **Spec says** | 6 bytes consumed: (1) flip decision (which token is cheap), (2) low-band magnitude, (3) high-band magnitude, (4) Carnage trigger probability, (5) Carnage action selection, (6) Carnage target selection. Integrates Carnage directly into the VRF callback. |
| **V3 implemented** | 4 bytes consumed: one per tax rate (pool A buy, pool A sell, pool B buy, pool B sell). Carnage is not part of the VRF flow at all. |
| **Analysis** | The spec's 6-byte approach tightly couples Carnage triggering with epoch transitions, ensuring Carnage decisions are made atomically with tax regime changes. This prevents MEV-based front-running of Carnage events. However, it increases compute budget requirements for the VRF callback instruction (already ~400k CU without Carnage). The v3's 4-byte approach keeps VRF simple and treats Carnage as a separate concern, but leaves Carnage triggering undefined and potentially vulnerable to MEV if implemented separately. |
| **Decision needed** | Determine VRF byte allocation: 4 bytes (tax only, Carnage separate) or 6 bytes (tax + Carnage atomic). This decision is coupled with DISC-07 (Carnage integration). |
| **Status** | **RESOLVED:SPEC** -- Spec version adopted for v4 reimplementation. Keep 6-byte allocation (with Carnage). |

---

### DISC-04: VRF Integration Pattern

| Field | Detail |
|-------|--------|
| **Aspect** | How the on-chain program interacts with Switchboard for randomness |
| **Spec says** | CPI to Switchboard. The program calls Switchboard's VRF v2 contract via cross-program invocation to request randomness, and Switchboard calls back with the result. |
| **V3 implemented** | Client-side commit-reveal using Switchboard On-Demand (SGX TEE). The program never CPIs to Switchboard -- it only reads a passed-in randomness account that the client orchestrates. Three-transaction flow: create, commit, reveal+consume. |
| **Analysis** | The spec describes a VRF integration pattern that **no longer exists**. The CPI callback infrastructure has been shut down. The `solana-randomness-service-lite` and `switchboard-v2` crates that supported this pattern are abandoned/deprecated (see Section 4). The v3 client-side commit-reveal approach using `switchboard-on-demand` is the **only currently viable** integration pattern with Switchboard. This discrepancy is essentially already resolved by external circumstances -- the spec's approach is no longer possible. |
| **Decision needed** | Confirm adoption of v3's client-side commit-reveal pattern (the spec's CPI callback pattern is no longer available). Update the Epoch spec to reflect the On-Demand integration pattern. |
| **Status** | **RESOLVED:SPEC** -- Spec version adopted for v4 reimplementation. Keep spec's VRF integration intent. The implementation uses the On-Demand client-side commit-reveal pattern. **Epoch_State_Machine_Spec.md updated 2026-02-03:** Section 7 rewritten for On-Demand, `vrf_callback` renamed to `consume_randomness`, `trigger_epoch_transition` now validates client-provided randomness account, anti-reroll and stale-randomness protections specified. |

---

### DISC-05: Trigger Bounty

| Field | Detail |
|-------|--------|
| **Aspect** | Reward paid to the account that triggers an epoch transition |
| **Spec says** | Fixed bounty: `TRIGGER_BOUNTY_LAMPORTS = 10,000,000` (0.01 SOL). Same reward regardless of treasury size or protocol stage. |
| **V3 implemented** | Dynamic bounty: `ADVANCER_REWARD_BPS = 10` (0.1% of treasury), capped at `MAX_ADVANCER_REWARD = 50,000,000` (0.05 SOL). Reward scales with protocol growth. |
| **Analysis** | Fixed bounty (spec) is simpler and more predictable for trigger bots. However, 0.01 SOL may become too small to cover transaction fees as the protocol grows (making triggering unprofitable), or too large relative to a small treasury in early days. Dynamic bounty (v3) scales naturally: small treasury = small bounty, large treasury = larger bounty (up to cap). The 0.05 SOL cap prevents excessive extraction. The tradeoff is slightly more complex calculation on-chain. |
| **Decision needed** | Choose between fixed bounty (0.01 SOL) or dynamic bounty (0.1% of treasury, capped at 0.05 SOL). |
| **Status** | **RESOLVED:SPEC** -- Spec version adopted for v4 reimplementation. Keep fixed 0.01 SOL bounty. |

---

### DISC-06: Tax Rate Range

| Field | Detail |
|-------|--------|
| **Aspect** | The numeric range and granularity of tax rates |
| **Spec says** | Discrete bands with 4 steps each. Low band: 1%, 2%, 3%, 4% (100, 200, 300, 400 bps). High band: 11%, 12%, 13%, 14% (1100, 1200, 1300, 1400 bps). Only 8 possible tax values exist. |
| **V3 implemented** | Continuous range: 0.75% to 14.75% (75-1475 bps). Linear interpolation from random byte: `rate = MIN + (byte * RANGE / 255)`. Any value in the continuous range is possible. |
| **Analysis** | Discrete bands (spec) create predictable regimes that traders can prepare for. With only 8 possible values, arbitrage calculations are simpler and strategy development is more accessible. Continuous range (v3) provides more variety and unpredictability, but makes arbitrage calculations harder and creates less clear "signals" for traders. The spec's discrete approach also has a notable gap: no rates exist between 4% and 11%, creating a strong binary "cheap or expensive" signal. The v3 approach fills this gap, meaning some epochs may have moderate taxes that don't create strong arbitrage incentives. |
| **Decision needed** | Choose between discrete bands (8 possible values with intentional gap) or continuous range (any value from 0.75% to 14.75%). This decision is coupled with DISC-02 (tax model). |
| **Status** | **RESOLVED:SPEC** -- Spec version adopted for v4 reimplementation. Keep discrete 1-4%/11-14% bands. |

---

### DISC-07: Carnage Integration

| Field | Detail |
|-------|--------|
| **Aspect** | Whether Carnage Fund execution is part of the VRF/epoch transition flow |
| **Spec says** | Atomic within VRF callback. Carnage trigger probability, action, and target are determined by VRF bytes (see DISC-03) and executed in the same instruction as the tax regime update. This prevents MEV between knowing the Carnage action and its execution. |
| **V3 implemented** | Not integrated. V3's VRF flow handles only tax rate derivation. Carnage was a separate, unintegrated concern -- the v3 implementation never reached the point of connecting VRF to Carnage execution. |
| **Analysis** | Atomic Carnage execution (spec) provides MEV protection: no one can front-run a Carnage event because the decision and execution happen in the same instruction. However, the spec was written assuming the old CPI callback pattern. Under the On-Demand commit-reveal pattern (v3), the `consumeRandomness` instruction already uses ~400k CU. Adding Carnage execution (which involves market buys and token burns via CPI, reaching CPI depth 4 per `Docs/Carnage_Fund_Spec.md`) may exceed compute limits or require creative instruction batching. Separating Carnage into its own instruction (closer to v3's approach) is simpler but creates a window between knowing the Carnage decision and executing it. |
| **Decision needed** | Determine whether Carnage execution is atomic with VRF consumption or a separate instruction. If separate, define MEV mitigation strategy. This decision is coupled with DISC-03 (VRF byte usage). |
| **Status** | **RESOLVED:SPEC** -- Spec version adopted for v4 reimplementation. Keep atomic Carnage in VRF callback. Note: Two-instruction atomic bundle approach (VRF consumeRandomness + Carnage execute as separate instructions within the same transaction) to be explored if single-instruction compute budget is exceeded. See Docs/Carnage_Fund_Spec.md Section 9.5. |

---

## 6. Open Questions

These questions do not require immediate decisions but should be tracked for the implementation phase.

### 6.1 Switchboard SDK Version Stability

`switchboard-on-demand` v0.11.3 was the working version in v3 (January 2026). The crate is actively developed and now includes `solana-v2` and `solana-v3` feature flags, suggesting a Solana SDK version transition is in progress. The version used during reimplementation may differ from v0.11.3, and API changes are possible.

**Action:** Pin to v0.11.3 for initial implementation. Test for breaking changes if upgrading. Note: Burning program upgrade authority locks compiled code, not SDK crate dependency. Switchboard on-chain data format backward compatibility is the real dependency -- monitor Switchboard's deprecation policies.

### 6.2 Mainnet VRF Cost Per Request

Devnet testing confirmed the three-transaction flow works. However, the exact SOL cost per VRF request on mainnet is unknown. Historical estimates suggest ~0.002 SOL per request, but this has not been verified with current Switchboard pricing.

**Action:** Test on devnet during implementation phase. Factor VRF cost into trigger bounty economics (see DISC-05, resolved as fixed 0.01 SOL).

### 6.3 Compute Budget for Combined VRF + Carnage

If Carnage is integrated atomically into the VRF callback (DISC-07), the combined compute budget may exceed Solana's per-instruction limit. VRF consumption alone needs ~400k CU. Carnage execution involves CPI calls to the AMM and token programs, reaching CPI depth 4.

**Action:** Two-instruction atomic bundle is the preferred approach: VRF consumeRandomness + Carnage execution as separate instructions within the same transaction. This preserves MEV protection (both execute atomically) while staying within per-instruction compute limits. See Docs/Carnage_Fund_Spec.md Section 9.5 for compute budget analysis.

---

*Document created: 2026-02-03*
*Source: v3-archive branch analysis, 06-RESEARCH.md*
*Companion: Docs/VRF_Implementation_Reference.md*
