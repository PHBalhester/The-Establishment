# Feature Landscape: Epoch/VRF Program

**Domain:** Epoch state machine with VRF-determined parameters for DeFi protocol
**Researched:** 2026-02-06
**Confidence:** HIGH (existing specs + industry patterns verified)

---

## Overview

This document categorizes features for the Epoch/VRF Program subsystem of Dr. Fraudsworth's Finance Factory. The program manages:
- 30-minute epochs with slot-based timing
- VRF-determined tax rates (cheap_side regime)
- Carnage Fund triggering (~1/24 epochs)
- Permissionless epoch advancement with bounty incentive

**Existing integration points:**
- Tax Program: reads `EpochState` for current tax rates, uses `swap_exempt` for Carnage
- Staking Program: receives `update_cumulative` CPI at epoch end
- AMM: receives swaps routed through Tax Program

---

## Table Stakes

Features users/operators expect. Missing = protocol feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Slot-based epoch boundaries** | Deterministic timing for arbitrageurs | Low | 4,500 slots (~30 min), avoids clock drift issues |
| **VRF-determined tax rates** | Core protocol mechanic for dynamic taxes | Medium | Switchboard On-Demand commit-reveal, 6 bytes consumed |
| **Permissionless epoch triggering** | No single point of failure, protocol liveness | Low | Anyone can call `trigger_epoch_transition` |
| **Trigger bounty mechanism** | Incentivizes reliable cranking | Low | Fixed 0.01 SOL from treasury |
| **Anti-reroll protection** | Prevents VRF manipulation by committing then rerolling | Medium | Bind randomness account at commit, verify at consume |
| **Stale randomness prevention** | Prevents pre-generated randomness attacks | Low | seed_slot freshness check (within 1 slot) |
| **VRF timeout recovery** | Protocol cannot be permanently stuck | Medium | 300-slot timeout, allows new commit with fresh account |
| **Carnage trigger probability** | ~4.3% per epoch (~2x/day) creates volatility events | Low | VRF byte 3 < 11 threshold |
| **Atomic Carnage execution** | No MEV window between knowing and executing Carnage | High | Execute within `consume_randomness` or 2-instruction bundle |
| **Carnage fallback mechanism** | Graceful degradation if atomic fails | Medium | 100-slot deadline, permissionless `execute_carnage` |
| **Tax rate caching** | Efficient tax lookups for swaps | Low | Pre-computed crime_buy/sell, fraud_buy/sell in EpochState |
| **Event emission** | Off-chain indexing and UI updates | Low | All state changes emit events |
| **Genesis initialization** | Hardcoded first-epoch taxes, no VRF needed | Low | CRIME cheap, 3%/14% initial rates |

### Why These Are Table Stakes

**Slot-based timing:** The spec explicitly rejects timestamp-based timing due to clock drift (up to 25% fast, 150% slow). For 30-minute epochs with time-sensitive arbitrage, deterministic slot boundaries are non-negotiable.

**Anti-reroll protection:** Without this, an attacker could commit VRF, see unfavorable result, commit again with different account. This is a well-documented VRF attack vector (see [Neodyme secure randomness research](https://neodyme.io/en/blog/secure-randomness-part-1/)).

**Permissionless triggering:** Single-point-of-failure in epoch advancement would halt the entire protocol's tax regime changes. DeFi best practice is permissionless cranking with economic incentive.

---

## Differentiators

Features that set the protocol apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **"Cheap side" regime model** | Creates predictable arbitrage signals vs random independent rates | Low | One token cheap (1-4%), other expensive (11-14%) |
| **75% flip probability** | High regime volatility creates trading opportunities | Low | VRF byte 0 < 192 triggers flip |
| **Discrete tax bands** | Only 8 possible tax values makes arbitrage math simple | Low | Low: 1/2/3/4%, High: 11/12/13/14% |
| **Carnage burn/sell decision** | 98% burn (deflationary) vs 2% sell (chaos injection) | Medium | VRF byte 4 determines action |
| **VRF-determined Carnage target** | Unpredictable which token gets bought | Low | 50/50 CRIME vs FRAUD |
| **Carnage expiration with SOL retention** | Failed Carnage doesn't lose funds, accumulates | Low | SOL stays in vault for next trigger |
| **1000 SOL swap cap** | Bounds compute, spreads extreme accumulation | Low | Prevents "too big to execute" failures |
| **Two-instruction atomic bundle** | VRF + Carnage in same tx without CU overflow | High | Separate instructions, same atomic tx |
| **Cumulative yield update at epoch end** | Staking rewards finalized atomically with epoch | Medium | CPI to Staking Program in consume_randomness |
| **Independent state dimensions** | vrf_pending and carnage_pending are independent | Low | Neither blocks the other |

### Why These Differentiate

**"Cheap side" regime:** Most VRF-based tax systems use independent random rates. The cheap-side model creates coherent arbitrage loops: when CRIME is cheap to buy, FRAUD is cheap to sell. This directional signal is the core trading mechanic.

**Discrete bands with gap:** The intentional 5-10% gap between bands (no rate possible there) creates strong "cheap or expensive" signals. This is unusual -- most protocols use continuous ranges.

**Carnage burn/sell decision:** The 98/2 split creates mostly deflationary events (burns) but rare chaotic events (sells followed by immediate rebuy). This unpredictability is explicitly a feature.

---

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Timestamp-based epoch timing** | Clock drift (25% fast to 150% slow) makes boundaries unpredictable | Use slot-based timing (4,500 slots) |
| **CPI callback VRF pattern** | Switchboard deprecated this; infrastructure shut down | Use client-side commit-reveal (On-Demand) |
| **Single-transaction VRF flow** | SDK requires account to exist before commitIx | Three-transaction flow: create, commit, reveal+consume |
| **Admin override of tax rates** | Protocol claims "no admin intervention post-deployment" | Remove admin functions entirely |
| **Slippage protection on Carnage** | Carnage is designed to cause price disruption | No minimum output; let arbitrageurs restore peg |
| **Carnage deadline extension on failure** | Could be exploited to delay indefinitely | Fixed 100-slot deadline, no extensions |
| **Per-pool tax configuration** | Creates inconsistent arbitrage dynamics | Single global regime governs all pools |
| **Continuous tax range** | Makes arbitrage math complex, signals unclear | Use discrete bands with intentional gap |
| **Carnage as separate program** | Would exceed CPI depth limit (5 > 4 allowed) | Inline Carnage in Epoch Program |
| **Optimistic VRF verification** | Assumes randomness is valid without checks | Always verify seed_slot freshness and reveal status |
| **Double-commit without timeout** | Allows reroll attacks | Only allow re-commit after VRF_TIMEOUT_SLOTS elapsed |
| **Blocking swaps during VRF pending** | Users cannot trade while waiting for VRF | Old taxes remain active; swaps always work |

### Why These Are Anti-Features

**Timestamp-based timing:** This was tried in v3 (1-hour epochs). The spec explicitly documents why slot-based is required: "Slot-based timing provides deterministic epoch boundaries... Wall-clock time can drift up to 25% fast or 150% slow."

**CPI callback VRF:** The VRF_Migration_Lessons.md documents this thoroughly: "The crate references account DCe143s... which does not exist on devnet or mainnet." The entire callback infrastructure was shut down.

**Carnage as separate program:** The Carnage_Fund_Spec.md CPI depth analysis shows: `Epoch::vrf_callback -> Tax::swap_exempt -> AMM::swap -> Token-2022::transfer_checked -> Transfer Hook::execute = depth 4`. Adding a Carnage program would exceed Solana's hard limit.

---

## Dependencies on Existing Features

The Epoch/VRF Program has critical dependencies on already-built subsystems.

### Tax Program Dependencies

| Dependency | How Epoch Uses It | Verification Needed |
|------------|-------------------|---------------------|
| `swap_exempt` instruction | Carnage executes tax-free swaps | Tax Program must validate Carnage PDA signer |
| Tax rate reading | Swaps read from EpochState | Tax Program reads epoch_state account |
| Tax distribution | 24% to Carnage, 75% to staking | Tax Program routes correctly |

**swap_exempt is critical:** This instruction exists specifically for Carnage. It must:
- Require Carnage Fund PDA as signer (cryptographically enforced)
- Apply 0% tax but standard LP fee (1%)
- Route through AMM via CPI

### Staking Program Dependencies

| Dependency | How Epoch Uses It | Verification Needed |
|------------|-------------------|---------------------|
| `update_cumulative` instruction | Called at epoch end to finalize rewards | Must accept EpochState as authority |
| `deposit_rewards` instruction | Tax Program deposits 75% yield | Called during swaps, not by Epoch |

### AMM Program Dependencies

| Dependency | How Epoch Uses It | Verification Needed |
|------------|-------------------|---------------------|
| CPI-only access control | AMM requires Tax PDA signer | Prevents direct AMM access bypassing taxes |
| Pool state reading | Carnage reads pool reserves | For swap execution |

### Transfer Hook Dependencies

| Dependency | How Epoch Uses It | Verification Needed |
|------------|-------------------|---------------------|
| Carnage vault whitelist | CRIME/FRAUD vaults must be whitelisted | Entries #9 and #10 per spec |
| Hook execution | Triggers on Token-2022 transfers | Adds 1 CPI depth (depth 4 total) |

---

## VRF-Specific Features

### Commit-Reveal Flow

| Phase | What Happens | Who Does It | Failure Handling |
|-------|--------------|-------------|------------------|
| **Create** | Fresh keypair, randomness account created | Client (TX 1) | Must finalize before commit |
| **Commit** | SDK commitIx + trigger_epoch_transition | Client (TX 2) | Validate freshness, bind account |
| **Reveal** | SDK revealIx + consume_randomness | Client (TX 3) | Retry up to 10x with 2s delays |

### VRF Byte Allocation

| Byte | Purpose | Interpretation | Complexity |
|------|---------|----------------|------------|
| 0 | Regime flip | < 192 (75%) = flip cheap side | Low |
| 1 | Low tax magnitude | 100 + (byte % 4) * 100 = 1-4% | Low |
| 2 | High tax magnitude | 1100 + (byte % 4) * 100 = 11-14% | Low |
| 3 | Carnage trigger | < 11 (~4.3%) = trigger | Low |
| 4 | Carnage action | < 5 (2%) = sell, else burn | Low |
| 5 | Carnage buy target | < 128 (50%) = CRIME, else FRAUD | Low |
| 6-31 | Reserved | Future use | N/A |

### Timeout Recovery

| Scenario | Timeout | Recovery Action |
|----------|---------|-----------------|
| VRF not revealed | 300 slots (~2 min) | Anyone can call `retry_epoch_vrf` with fresh account |
| Carnage atomic failed | 100 slots (~40 sec) | Anyone can call `execute_carnage` |
| Carnage deadline expired | After 100 slots | Anyone can call `expire_carnage`, SOL retained |

---

## Feature Dependencies (Build Order)

```
1. EpochState account structure
   |-- genesis initialization
       |-- hardcoded first-epoch taxes

2. Slot-based epoch calculation
   |-- epoch_start_slot, current_epoch, next_epoch_boundary

3. trigger_epoch_transition
   |-- epoch boundary validation
   |-- randomness account validation (freshness, not-revealed)
   |-- bounty payment from treasury

4. consume_randomness
   |-- anti-reroll verification
   |-- tax derivation from VRF bytes
   |-- CPI to Staking::update_cumulative
   |-- Carnage trigger check

5. Carnage execution (within consume_randomness)
   |-- burn path (98%)
   |-- sell path (2%)
   |-- buy target token

6. Fallback instructions
   |-- retry_epoch_vrf (timeout recovery)
   |-- execute_carnage (atomic failure recovery)
   |-- expire_carnage (deadline passed)
```

---

## MVP Recommendation

For MVP, prioritize in this order:

### Must Have (Phase 1)

1. **EpochState account + initialization** - Foundation
2. **Slot-based epoch timing** - Core mechanic
3. **trigger_epoch_transition** - Protocol liveness
4. **consume_randomness with tax derivation** - Core mechanic
5. **Anti-reroll and freshness validation** - Security critical

### Should Have (Phase 2)

6. **Carnage trigger + atomic execution** - Differentiating feature
7. **VRF timeout recovery** - Protocol resilience
8. **CPI to Staking::update_cumulative** - Yield integration

### Nice to Have (Phase 3)

9. **Carnage fallback (execute_carnage, expire_carnage)** - Edge case handling
10. **Two-instruction atomic bundle optimization** - Performance

### Defer to Post-MVP

- Dynamic bounty (percentage-based vs fixed) - v3 had this but spec chose fixed 0.01 SOL
- Extended VRF byte usage (bytes 6-31 reserved)
- Monitoring/analytics events beyond core state changes

---

## Complexity Assessment

| Feature Category | Estimated LOC | Risk Level | Notes |
|------------------|---------------|------------|-------|
| EpochState + timing | ~200 | Low | Well-defined spec |
| VRF integration | ~400 | Medium | Switchboard SDK quirks documented |
| Tax derivation | ~100 | Low | Pure math, well-specified |
| Carnage execution | ~500 | High | CPI depth 4, compute budget concerns |
| Fallback mechanisms | ~300 | Medium | Edge case handling |
| **Total** | ~1,500 | Medium-High | Carnage is the complexity driver |

---

## Permissionless Epoch Transitions: Expected Behavior

### Trigger Mechanics

1. **Anyone can trigger** - No special authority required
2. **Economic incentive** - 0.01 SOL bounty paid from treasury
3. **Validation requirements:**
   - Epoch boundary must be reached (current_slot >= next_epoch_boundary)
   - No VRF already pending (vrf_pending = false)
   - Randomness account must be fresh (seed_slot within 1 slot)
   - Randomness must not be revealed yet

### Timing Guarantees

- **Epoch boundary is deterministic:** `epoch_start_slot + SLOTS_PER_EPOCH`
- **No grace period:** Transition can occur immediately at boundary
- **No late penalty:** Transition can occur any time after boundary
- **Old taxes remain active:** Until `consume_randomness` completes

### Cranking Expectations

| Scenario | Expected Behavior |
|----------|-------------------|
| Normal operation | Bot triggers within seconds of boundary |
| Congested network | Bot retries until success |
| No bots active | Anyone can trigger to claim bounty |
| Extended delay (hours) | Protocol continues with old taxes; next trigger jumps to current epoch |

### Resilience Features

1. **Epoch number calculation is stateless:** Based on `(current_slot - genesis_slot) / SLOTS_PER_EPOCH`
2. **Missed epochs are skipped:** If boundary N and N+1 both passed, trigger advances to N+1
3. **Swaps never blocked:** Users trade with current taxes regardless of epoch state
4. **Treasury liveness:** Must maintain SOL for bounties (~0.5 SOL/day)

---

## Sources

**Project Documentation (HIGH confidence):**
- Epoch_State_Machine_Spec.md - Authoritative spec for epoch transitions
- VRF_Implementation_Reference.md - Proven working v3 patterns
- VRF_Migration_Lessons.md - Pitfalls and discrepancy resolution
- Carnage_Fund_Spec.md - Carnage subsystem specification
- Tax_Pool_Logic_Spec.md - Tax Program integration points
- New_Yield_System_Spec.md - Staking integration points

**External References (MEDIUM confidence):**
- [Switchboard Documentation](https://docs.switchboard.xyz/) - On-Demand VRF patterns
- [Solana VRF Course](https://solana.com/developers/courses/connecting-to-offchain-data/verifiable-randomness-functions) - VRF fundamentals
- [Neodyme Secure Randomness](https://neodyme.io/en/blog/secure-randomness-part-1/) - Security best practices
- [Adevar Labs On-Chain Randomness](https://www.adevarlabs.com/blog/on-chain-randomness-on-solana-predictability-manipulation-safer-alternatives-part-1) - Attack vectors
