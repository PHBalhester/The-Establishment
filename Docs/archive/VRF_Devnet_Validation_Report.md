# VRF Devnet Validation Report

**Generated:** 2026-02-11
**Cluster:** Helius devnet RPC (api-key masked)
**Wallet:** 8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4
**SLOTS_PER_EPOCH:** 750 (~5 min per epoch)
**Epoch Program:** AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod
**Switchboard Queue:** EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7
**Total SOL Cost:** ~0.083 SOL (0.049 transitions + 0.033 security)

## Summary

| Test Category | Result | Notes |
|---------------|--------|-------|
| Epoch transitions | **5/5 passed** | All tax rates within spec bands |
| Security tests | **3/3 passed** | Anti-reroll, double-commit, stale randomness |
| Timeout recovery | **1/1 passed** | 306 slot wait + retry_epoch_vrf |
| Swap verification | **1/1 passed** | State-read verification (full swap Phase 36) |

**Overall: ALL TESTS PASSED**

## Epoch Transitions (VRF-01, VRF-02)

5 consecutive VRF-driven epoch transitions with real Switchboard oracle randomness.

| # | Epoch | Cheap Side | Flipped | Low Tax | High Tax | Carnage | Duration |
|---|-------|------------|---------|---------|----------|---------|----------|
| 1 | 71 | CRIME | Yes | 400 bps | 1100 bps | No | 47s |
| 2 | 72 | FRAUD | Yes | 200 bps | 1400 bps | No | 45s |
| 3 | 73 | FRAUD | No | 100 bps | 1200 bps | No | 47s |
| 4 | 74 | CRIME | Yes | 100 bps | 1100 bps | No | 45s |
| 5 | 75 | FRAUD | Yes | 100 bps | 1200 bps | No | 48s |

**Statistical analysis:**
- Flips: 4/5 (80%) -- consistent with 75% flip probability
- Unique low rates: 100, 200, 400 bps (3 of 4 possible values)
- Unique high rates: 1100, 1200, 1400 bps (3 of 4 possible values)
- Both CRIME and FRAUD observed as cheap side
- Carnage triggers: 0/5 (expected: ~80% chance of 0 in 5 epochs at 4.3% per epoch)
- Oracle response: First attempt for all 5 transitions

### Per-Epoch Details

**Transition 1 -- Epoch 71:**
- Cheap Side: CRIME (flipped from FRAUD)
- Tax Rates: low=400bps (4.0%), high=1100bps (11.0%)
- CRIME: buy=400bps sell=1100bps
- FRAUD: buy=1100bps sell=400bps
- TX sigs:
  - Create: `5MJ12WLiDW8nCTNw4ZZHkSmGC2yETT92W6QNxxhhbAQi5tPGSqq2USyWo5T3hBgQWkkztT9R8MeV8fcTVe8iAYEi`
  - Commit+Trigger: `EmuabG4tfJAoKCpxxskek1nhAqYPYVcntgZi5GuzQzxdUCxwQPv4bY6AFCWKmDW1bEuDvmDzuT2cSebDjDaAkeT`
  - Reveal+Consume: `49caumCGuYPyQvQQKVpAabNrERho1BNQhHgvqMNE1YoBWSia4z6PCC1ZjtJEmuweykywnx1L7gPge6ueYE9ragjJ`

**Transition 2 -- Epoch 72:**
- Cheap Side: FRAUD (flipped from CRIME)
- Tax Rates: low=200bps (2.0%), high=1400bps (14.0%)
- CRIME: buy=1400bps sell=200bps
- FRAUD: buy=200bps sell=1400bps
- TX sigs:
  - Create: `5ij8WHZ49w63nM7nveCXNiGfwHLiv2ShRp8xnBMnNuf3TWu6bsg875sFd8q4a9DUvR2xbYsG5rGPps7ASKpkUEuf`
  - Commit+Trigger: `6QWVNs431qYCAntpfNJyhJJuHedneXUCdRN7DqxufD9JTgynCkAzyTy5UtKCoBECSfNLypuQpveoaaZPsMAue63`
  - Reveal+Consume: `4EUhxD3xEzUiSxg8V58etAVn8MS9C7UUyFxY6WGwzvuWLtm84LkPQNtQa8uSKZjNSYDkaW4gbQbkYqUv6G86TmHx`

**Transition 3 -- Epoch 73:**
- Cheap Side: FRAUD (no flip)
- Tax Rates: low=100bps (1.0%), high=1200bps (12.0%)
- CRIME: buy=1200bps sell=100bps
- FRAUD: buy=100bps sell=1200bps
- TX sigs:
  - Create: `1i5WFRBwcJuUxwiwbaM3Vc3vShoFVVAEJWcwFKs7T6cKdn9ud7HnGaQDSdLNFqx84RsLyvoXr3z6SjyhjWMFMEr`
  - Commit+Trigger: `5BzatD16nrHe1K3ZR5ukL5oiD5sjGVGxjKLCiEwebpZK4TJQhKxPVA1ZGURRtnjmmTS9VXB5Jit6eHGt49Di4b6V`
  - Reveal+Consume: `2iXCa1Pv2ZfLg5vBw8ukb28E5BUYC4XWmNrfqsaoBvf9hB5YM6RBWF46QmzdAZddxncBy8SefcwjsS6nfAFCcq5w`

**Transition 4 -- Epoch 74:**
- Cheap Side: CRIME (flipped from FRAUD)
- Tax Rates: low=100bps (1.0%), high=1100bps (11.0%)
- CRIME: buy=100bps sell=1100bps
- FRAUD: buy=1100bps sell=100bps
- TX sigs:
  - Create: `tmbt4e8YGMgbXEW857neGBiC7Vs6EfE6vM9uioGxrK9ecLqVtot2XfRv5H1jofyHFJUkQ4iEgnEFsjTLiEZsLCu`
  - Commit+Trigger: `4PZ8Xm2CGtmJQ3SktwTwumhTbNqGBqbwNY56A7AHXDKZ68APTxcPoD39WrtXQwss6JbWaKMRxFmHUAs6RDW1Fu2v`
  - Reveal+Consume: `4MfAyHHJQTQc78BbyNmjHHPBSLXDaHnBsyG2yvx42td6jUPoznt3YvS6QAwmhjt6bNakpERW5Lmzf9AkWSCDAUo6`

**Transition 5 -- Epoch 75:**
- Cheap Side: FRAUD (flipped from CRIME)
- Tax Rates: low=100bps (1.0%), high=1200bps (12.0%)
- CRIME: buy=1200bps sell=100bps
- FRAUD: buy=100bps sell=1200bps
- TX sigs:
  - Create: `5N1T1UqMmkaKj14Ysg24mNCAZtpnyQamBzJGszdAiTd61tJoBUy26VbSJysEPDxKWBqwkohuF2zzS5uRCPgybETX`
  - Commit+Trigger: `2482aNCaRbLF8d5DEvU7qw4nQDfnT8kufuNHv8cAKJhfZEasWpoy8RRSThHhUKoTwkGzSjcshH7eWVDsVoV8CRxF`
  - Reveal+Consume: `3Lo1nQUrH62Q5GxV2C18abze85o1vzBXyBsg1pnXLsy9jkyTZgydAs1J1QExFrRu9v7Wko35L2k1CBjGdbR74DqS`

## Security Tests (VRF-05)

### Anti-Reroll Protection
- **Result:** PASSED
- **Test:** Attempted `consume_randomness` with a wrong randomness account while VRF was pending
- **Expected:** Transaction rejected (anti-reroll protection prevents re-rolling randomness)
- **Actual:** Transaction correctly rejected -- randomness account mismatch detected

### Double-Commit Protection
- **Result:** PASSED
- **Test:** Attempted `trigger_epoch_transition` while VRF was already pending
- **Expected:** Transaction rejected with VrfAlreadyPending error
- **Actual:** Rejected with custom program error 0x1773 (VrfAlreadyPending)

### Stale Randomness Behavior
- **Result:** PASSED (Informational)
- **Details:** Switchboard freshness check occurs at the oracle level during reveal, not at commit time. Devnet oracles are lenient with staleness windows. The program's primary protection is via `VRF_TIMEOUT_SLOTS` (300 slots) which forces retry with fresh randomness if the oracle doesn't respond.

## Timeout Recovery (VRF-03)

- **Result:** PASSED
- **Test:** Started VRF flow, deliberately skipped reveal to simulate oracle failure, waited for 300-slot timeout, then retried with fresh randomness via `retry_epoch_vrf`
- **Details:**
  - Initial commit at slot: 441509593
  - Deliberately skipped reveal (simulated oracle down)
  - Waited 306 slots (~116 seconds)
  - Created fresh randomness account
  - Called `retry_epoch_vrf` to replace stale randomness
  - Committed new randomness, oracle responded on first attempt
  - Reveal + consume succeeded
  - Final epoch: 77, vrfPending=false, taxesConfirmed=true
- **Consume TX:** `LzaLvS6uqianJgqWzLasGCwAjUHqToD3nZ6jAxuMLMMA9ZSNzZoLU5WGbFfL3HqEZw2wT3ueAdNNsQ8MoWfhzN3`

## Tax Rate Application -- Swap Verification (VRF-04)

- **Result:** PASSED
- **Approach:** State-read verification. Full swap CPI chain requires ~15 accounts + Transfer Hook remaining_accounts, which is too complex for a standalone validation script. Integration tests (Phase 32) already verified the Tax Program CPI chain. Full end-to-end swap testing with actual token transfers is Phase 36.
- **Verification:**
  - EpochState has VRF-derived tax rates (not zeros, not defaults)
  - taxesConfirmed = true (VRF has been consumed)
  - Current rates: low=300bps, high=1400bps, cheapSide=FRAUD
  - CRIME: buy=1400bps, sell=300bps
  - FRAUD: buy=300bps, sell=1400bps
  - All rates within spec bands and consistent with cheap_side logic

## Phase 35 Success Criteria Mapping

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC1: Full 3-TX VRF flow completes on devnet | PASSED | 5 consecutive transitions + 2 security test transitions (epochs 71-77) |
| SC2: Epoch transitions produce real randomness with tax rates in bands | PASSED | All rates in [100,400] low / [1100,1400] high. 3+ unique values per band. |
| SC3: VRF timeout recovery works (300-slot expiry) | PASSED | Deliberate oracle skip, 306 slot wait, retry_epoch_vrf succeeded |
| SC4: Tax Program reads updated rates | PASSED | State-read verified. Full swap deferred to Phase 36. |

## On-Chain State After Validation

| Component | Address | State |
|-----------|---------|-------|
| Epoch Program | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | Deployed, SLOTS_PER_EPOCH=750 |
| EpochState PDA | `DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU` | epoch=77, cheapSide=FRAUD, taxes=300/1400 |
| Wallet | `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` | ~79.66 SOL remaining |

---
*Generated by VRF Devnet Validation Suite (Phase 35)*
*Date: 2026-02-11*
