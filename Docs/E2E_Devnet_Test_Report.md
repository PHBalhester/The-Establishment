# E2E Devnet Test Report

**Generated:** 2026-03-14T18:10:51.920Z
**Cluster:** Solana Devnet
**Total Entries:** 53

## Summary

| Phase | Pass | Fail | Known Issue | Skip |
|-------|------|------|-------------|------|
| swap | 35 | 0 | 0 | 0 |
| staking | 1 | 2 | 0 | 0 |
| epoch | 7 | 0 | 0 | 0 |
| carnage | 2 | 0 | 0 | 0 |
| **Total** | **51** | **2** | **0** | **0** |

## Test Environment

| Property | Value |
|----------|-------|
| Cluster | Solana Devnet |
| Total Transactions | 18 |
| Started | 2026-03-14T18:06:28.980Z |
| Completed | 2026-03-14T18:10:51.920Z |
| Duration | 4.4 min |

## 1. Swap Flow (E2E-01 + E2E-02)

### PASS: Token sell swap executed on CRIME/SOL (attempt 1)

**TX:** [5H61RYhv7Gn1q1sY...](https://explorer.solana.com/tx/5H61RYhv7Gn1q1sYHCyuQiVuyjxHgVphVHVMLt8qGPR3reUyr6YsMDiSaUn1vLdKFZ2z4wecJQFFBNHH9rr22Pyc?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountTokens": 500000000,
  "minimumOutput": 5237,
  "isCrime": true,
  "taxBps": 400,
  "attempt": 1
}
```

### PASS: CRIME -> SOL sell PASS

**TX:** [5H61RYhv7Gn1q1sY...](https://explorer.solana.com/tx/5H61RYhv7Gn1q1sYHCyuQiVuyjxHgVphVHVMLt8qGPR3reUyr6YsMDiSaUn1vLdKFZ2z4wecJQFFBNHH9rr22Pyc?cluster=devnet)

### PASS: Token sell swap executed on FRAUD/SOL (attempt 1)

**TX:** [2Xm6DW7w4Zgy2TaU...](https://explorer.solana.com/tx/2Xm6DW7w4Zgy2TaUwd8KG4441o9BmGAu2LDAq2j4foVzC8psqmGkmgE5GjK5efxSR2SbqtN7odttv1yNNdR22v9F?cluster=devnet)

**Details:**
```json
{
  "poolName": "FRAUD/SOL",
  "amountTokens": 500000000,
  "minimumOutput": 5490,
  "isCrime": false,
  "taxBps": 1400,
  "attempt": 1
}
```

### PASS: FRAUD -> SOL sell PASS

**TX:** [2Xm6DW7w4Zgy2TaU...](https://explorer.solana.com/tx/2Xm6DW7w4Zgy2TaUwd8KG4441o9BmGAu2LDAq2j4foVzC8psqmGkmgE5GjK5efxSR2SbqtN7odttv1yNNdR22v9F?cluster=devnet)

### PASS: Swap flow complete: all 4 directions PASS

### PASS: Swap flow completed -- all 4 directions PASS

### PASS: Starting vault conversion tests -- all 4 directions + bidirectional arb loop

### PASS: Vault CRIME→PROFIT: PASS (in=1000000000, out=10000000, expected_out=10000000)

**TX:** [3znG6vwEQdjp5rUi...](https://explorer.solana.com/tx/3znG6vwEQdjp5rUijEabTWM6a1m2VGwpywLusBPxoBvKVTkxjAisP9E2cYYA6aFx7gTSp47mNGsBLsACpHpS8koF?cluster=devnet)

**Details:**
```json
{
  "inputToken": "CRIME",
  "outputToken": "PROFIT",
  "amountIn": 1000000000,
  "expectedOutput": 10000000,
  "inputDelta": 1000000000,
  "outputDelta": 10000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Vault PROFIT→CRIME: PASS (in=10000000, out=1000000000, expected_out=1000000000)

**TX:** [5UADxJbxKTZBjmPA...](https://explorer.solana.com/tx/5UADxJbxKTZBjmPA4KmobxmMCdGrmdyM6JNrmboJuJN94x9DG8KTPb3C7gaCM4aqtRmYFD3LE72nizGXWijUSayT?cluster=devnet)

**Details:**
```json
{
  "inputToken": "PROFIT",
  "outputToken": "CRIME",
  "amountIn": 10000000,
  "expectedOutput": 1000000000,
  "inputDelta": 10000000,
  "outputDelta": 1000000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Vault FRAUD→PROFIT: PASS (in=1000000000, out=10000000, expected_out=10000000)

**TX:** [4NdiDXhL7DceyaMy...](https://explorer.solana.com/tx/4NdiDXhL7DceyaMymbEjMUaHT37nRuTyiVDxxRfbNdE7TdSQDNGbBtFf6EM9Uqgg2Q3X4Y8nyEsYtb63FpsGYQJi?cluster=devnet)

**Details:**
```json
{
  "inputToken": "FRAUD",
  "outputToken": "PROFIT",
  "amountIn": 1000000000,
  "expectedOutput": 10000000,
  "inputDelta": 1000000000,
  "outputDelta": 10000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Vault PROFIT→FRAUD: PASS (in=10000000, out=1000000000, expected_out=1000000000)

**TX:** [5gbbNGT43QbzQDmM...](https://explorer.solana.com/tx/5gbbNGT43QbzQDmMDaqSL79YU6816uto7QbmdGa92MHWsy2RYXBRiDsADmViiCKdkHht5burMZ3EbFANVRFbmhji?cluster=devnet)

**Details:**
```json
{
  "inputToken": "PROFIT",
  "outputToken": "FRAUD",
  "amountIn": 10000000,
  "expectedOutput": 1000000000,
  "inputDelta": 10000000,
  "outputDelta": 1000000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Starting FORWARD arb loop: SOL→CRIME(buy)→PROFIT(vault)→FRAUD(vault)→SOL(sell)

### PASS: EpochState read: epoch=45, cheapSide=FRAUD, crimeBuyTax=1200bps

**Details:**
```json
{
  "currentEpoch": 45,
  "cheapSide": "FRAUD",
  "crimeBuyTaxBps": 1200,
  "crimeSellTaxBps": 400,
  "fraudBuyTaxBps": 200,
  "fraudSellTaxBps": 1400
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 151481073,
  "carnageSolVault": 104458578,
  "treasury": 10372580383
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "GcnLB5a2N4Lxgo2nKvZWpMhKkUBps4gmCr5UQVyrLZA4",
    "737nSZRuPefPmktyC5jqibBLPWeoH18JQ7z7gkSyTjh",
    "CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd",
    "935wcyZuFtsQKCBzspkiTgkjkBbdw6gBGAcGUv9TJRYp"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [TkYKX3QFkhsdQe3Z...](https://explorer.solana.com/tx/TkYKX3QFkhsdQe3ZyAPugoaVBCdhPTe7JJrxadH9EuAog5fjjuQVwsd1njyRGT31ErR55pwXKq7UPj6FcNLLtg1?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 50000000,
  "minimumOutput": 1083873716314,
  "isCrime": true,
  "taxBps": 1200,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 155741073,
  "carnageSolVault": 105898578,
  "treasury": 10372870383
}
```

### PASS: Tax distribution verification: PASS (71.1/24.0/4.8)

**Details:**
```json
{
  "amountIn": 50000000,
  "taxBps": 1200,
  "expectedTax": 6000000,
  "expectedStaking": 4260000,
  "expectedCarnage": 1440000,
  "expectedTreasury": 300000,
  "actualStaking": 4260000,
  "actualCarnage": 1440000,
  "actualTreasury": 290000,
  "totalReceived": 5990000,
  "stakingPct": 71.11853088480802,
  "carnagePct": 24.040066777963272,
  "treasuryPct": 4.841402337228715,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: Vault CRIME→PROFIT: PASS (in=500000000, out=5000000, expected_out=5000000)

**TX:** [3imBWnokvJQN4mRn...](https://explorer.solana.com/tx/3imBWnokvJQN4mRnMtL9BpcgqUNi9XJrtdAGhcPeiRnkpcAmrmgwDvrAafTJKzRtMvMEUFkJnbjukSL7mhbQYUCw?cluster=devnet)

**Details:**
```json
{
  "inputToken": "CRIME",
  "outputToken": "PROFIT",
  "amountIn": 500000000,
  "expectedOutput": 5000000,
  "inputDelta": 500000000,
  "outputDelta": 5000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Vault PROFIT→FRAUD: PASS (in=5000000, out=500000000, expected_out=500000000)

**TX:** [2BgaM1cAv3sKdvc1...](https://explorer.solana.com/tx/2BgaM1cAv3sKdvc15Mo1YRJvVPZpffzevY4CcpHgfxTrwCJ35ssCDEWo6MZi7EGgYzyi82brTri6YU2mA1LhLSWK?cluster=devnet)

**Details:**
```json
{
  "inputToken": "PROFIT",
  "outputToken": "FRAUD",
  "amountIn": 5000000,
  "expectedOutput": 500000000,
  "inputDelta": 5000000,
  "outputDelta": 500000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Token sell swap executed on FRAUD/SOL (attempt 1)

**TX:** [3fZ4RzW1pKTz74Ms...](https://explorer.solana.com/tx/3fZ4RzW1pKTz74Ms2CTyY3FjBTNJ1q2UWhLLHP4yWrUDbswj5eujLMXHrqaSzj4Jr8NVN3vP1R5mZUsqYWHekSy7?cluster=devnet)

**Details:**
```json
{
  "poolName": "FRAUD/SOL",
  "amountTokens": 500000000,
  "minimumOutput": 5490,
  "isCrime": false,
  "taxBps": 1400,
  "attempt": 1
}
```

### PASS: FORWARD arb loop COMPLETE: SOL→CRIME→PROFIT→FRAUD→SOL all 4 legs succeeded

**TX:** [3fZ4RzW1pKTz74Ms...](https://explorer.solana.com/tx/3fZ4RzW1pKTz74Ms2CTyY3FjBTNJ1q2UWhLLHP4yWrUDbswj5eujLMXHrqaSzj4Jr8NVN3vP1R5mZUsqYWHekSy7?cluster=devnet)

### PASS: Starting REVERSE arb loop: SOL→FRAUD(buy)→PROFIT(vault)→CRIME(vault)→SOL(sell)

### PASS: EpochState read: epoch=45, cheapSide=FRAUD, crimeBuyTax=1200bps

**Details:**
```json
{
  "currentEpoch": 45,
  "cheapSide": "FRAUD",
  "crimeBuyTaxBps": 1200,
  "crimeSellTaxBps": 400,
  "fraudBuyTaxBps": 200,
  "fraudSellTaxBps": 1400
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 155742131,
  "carnageSolVault": 105898935,
  "treasury": 10372840459
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "E3aaJFKuw5FiS32Nfm1ijQsSUG2pfHRMQAFZCdfYpJAJ",
    "5L6VUSwNcb2cBCyzsYfPjk1sh4YpgzwgJHvSk6Jau87d",
    "CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd",
    "2bwk8rMh2VxydmXKBCsb1DfrwFLT1u1FZAT3cBxJ4E6q"
  ]
}
```

### PASS: SOL buy swap executed on FRAUD/SOL (attempt 1)

**TX:** [3phRnE5BtqANdMod...](https://explorer.solana.com/tx/3phRnE5BtqANdModA6NkTWcD5y2uYFJNyCTytHCFuW9owaGdWYEpyQFH5GZJqzrj2n93Cs6H9SDJkHDYggd6FCdG?cluster=devnet)

**Details:**
```json
{
  "poolName": "FRAUD/SOL",
  "amountIn": 50000000,
  "minimumOutput": 1150689627807,
  "isCrime": false,
  "taxBps": 200,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 156452131,
  "carnageSolVault": 106138935,
  "treasury": 10372880459
}
```

### PASS: Tax distribution verification: PASS (71.7/24.2/4.0)

**Details:**
```json
{
  "amountIn": 50000000,
  "taxBps": 200,
  "expectedTax": 1000000,
  "expectedStaking": 710000,
  "expectedCarnage": 240000,
  "expectedTreasury": 50000,
  "actualStaking": 710000,
  "actualCarnage": 240000,
  "actualTreasury": 40000,
  "totalReceived": 990000,
  "stakingPct": 71.71717171717171,
  "carnagePct": 24.242424242424242,
  "treasuryPct": 4.040404040404041,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: Vault FRAUD→PROFIT: PASS (in=500000000, out=5000000, expected_out=5000000)

**TX:** [3FKqvc6kYztWS3PG...](https://explorer.solana.com/tx/3FKqvc6kYztWS3PGDib29qPiXm9ZAKQexo5ekh6JMCSPGSzmWznbQGQD9SfisWn3Ci7iXBb9PAfkm5HkCXdxWv1R?cluster=devnet)

**Details:**
```json
{
  "inputToken": "FRAUD",
  "outputToken": "PROFIT",
  "amountIn": 500000000,
  "expectedOutput": 5000000,
  "inputDelta": 500000000,
  "outputDelta": 5000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Vault PROFIT→CRIME: PASS (in=5000000, out=500000000, expected_out=500000000)

**TX:** [4aX42hy99FbdS685...](https://explorer.solana.com/tx/4aX42hy99FbdS685MYTkB4sqeBK6HXQ5rK9N9yvQnD2WYykk52r42Zswippvbgw3mycWHrBsZhywPYXPv9trSuZc?cluster=devnet)

**Details:**
```json
{
  "inputToken": "PROFIT",
  "outputToken": "CRIME",
  "amountIn": 5000000,
  "expectedOutput": 500000000,
  "inputDelta": 5000000,
  "outputDelta": 500000000,
  "inputCorrect": true,
  "outputCorrect": true
}
```

### PASS: Token sell swap executed on CRIME/SOL (attempt 1)

**TX:** [4pPKsMTTXEZVrLnE...](https://explorer.solana.com/tx/4pPKsMTTXEZVrLnEani18D5E6s5uBan5c5pE8f2t85aRYZvsbFMyMTVMqbT4mXx1xzLS6QafDYCTURAefxXWRhng?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountTokens": 500000000,
  "minimumOutput": 5320,
  "isCrime": true,
  "taxBps": 400,
  "attempt": 1
}
```

### PASS: REVERSE arb loop COMPLETE: SOL→FRAUD→PROFIT→CRIME→SOL all 4 legs succeeded

**TX:** [4pPKsMTTXEZVrLnE...](https://explorer.solana.com/tx/4pPKsMTTXEZVrLnEani18D5E6s5uBan5c5pE8f2t85aRYZvsbFMyMTVMqbT4mXx1xzLS6QafDYCTURAefxXWRhng?cluster=devnet)

### PASS: Vault tests all passed (4 standalone + 2 arb loops)

### PASS: Vault tests completed -- all 4 directions + 2 arb loops PASS


## 2. Staking Flow (E2E-03 + E2E-04)

### Stake PROFIT

**Status:** NOT EXECUTED

### Claim SOL Yield

**Status:** NOT EXECUTED

<details>
<summary>Full staking log entries</summary>

- **PASS:** Starting staking lifecycle (E2E-05): stake -> wait-for-epoch -> claim -> unstake
- **FAIL:** PROFIT balance: 0 (0 raw)
- **FAIL:** No PROFIT tokens available for staking. Need vault conversion first.

</details>

## 3. Epoch Transitions (E2E-04)

<details>
<summary>Full epoch transition log entries</summary>

- **PASS:** Observing epoch transitions from crank. Current epoch=45, cheapSide=FRAUD, lowTax=200bps, highTax=1400bps
- **PASS:** Estimated ~229s until next epoch boundary (573 slots remaining). Polling every 30s, timeout 15min.
- **PASS:** Starting epoch observation -- waiting for Railway crank to advance epoch (E2E-03)
- **PASS:** Observing epoch transitions from crank. Current epoch=45, cheapSide=FRAUD, lowTax=200bps, highTax=1400bps
- **PASS:** Estimated ~20s until next epoch boundary (51 slots remaining). Polling every 30s, timeout 15min.
- **PASS:** Epoch advanced! 45 -> 46 in 61s. Tax rates CHANGED: cheapSide=CRIME, lowTax=400bps, highTax=1300bps
- **PASS:** E2E-03 PASS: Epoch advanced 45 -> 46, tax rates changed

</details>

## 4. Carnage (E2E-05)

### Forced Carnage (execute_carnage_atomic)

### Natural Carnage (VRF Epoch Cycling)


<details>
<summary>Full Carnage log entries</summary>

- **PASS:** Carnage observation: not triggered (probabilistic). Probabilistic -- Carnage not triggered this epoch (balance delta: 0 lamports)
- **PASS:** E2E-04: Carnage not triggered (probabilistic -- normal). Probabilistic -- Carnage not triggered this epoch (balance delta: 0 lamports)

</details>

## 5. Known Issues

No known issues encountered during this run.

## 6. Mainnet Readiness Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC-1: SOL buy swap + tax distribution | PASS | [TX](https://explorer.solana.com/tx/TkYKX3QFkhsdQe3ZyAPugoaVBCdhPTe7JJrxadH9EuAog5fjjuQVwsd1njyRGT31ErR55pwXKq7UPj6FcNLLtg1?cluster=devnet) + tax verified |
| SC-2: Staking yield claim | NOT TESTED | N/A |
| SC-3: Multi-epoch VRF transitions (3+) | NOT TESTED | 0 transitions: N/A |
| SC-4: Carnage trigger | NOT TESTED | N/A |
| SC-5: E2E documentation | PASS | This report |

### Assessment

**Overall: 2/5 criteria satisfied.** Additional testing needed before mainnet.

## 7. Appendix: Full Transaction Log

| # | Phase | Status | TX Signature | Description |
|---|-------|--------|-------------|-------------|
| 1 | swap | PASS | [5H61RYhv7Gn1...](https://explorer.solana.com/tx/5H61RYhv7Gn1q1sYHCyuQiVuyjxHgVphVHVMLt8qGPR3reUyr6YsMDiSaUn1vLdKFZ2z4wecJQFFBNHH9rr22Pyc?cluster=devnet) | Token sell swap executed on CRIME/SOL (attempt 1) |
| 2 | swap | PASS | [5H61RYhv7Gn1...](https://explorer.solana.com/tx/5H61RYhv7Gn1q1sYHCyuQiVuyjxHgVphVHVMLt8qGPR3reUyr6YsMDiSaUn1vLdKFZ2z4wecJQFFBNHH9rr22Pyc?cluster=devnet) | CRIME -> SOL sell PASS |
| 3 | swap | PASS | [2Xm6DW7w4Zgy...](https://explorer.solana.com/tx/2Xm6DW7w4Zgy2TaUwd8KG4441o9BmGAu2LDAq2j4foVzC8psqmGkmgE5GjK5efxSR2SbqtN7odttv1yNNdR22v9F?cluster=devnet) | Token sell swap executed on FRAUD/SOL (attempt 1) |
| 4 | swap | PASS | [2Xm6DW7w4Zgy...](https://explorer.solana.com/tx/2Xm6DW7w4Zgy2TaUwd8KG4441o9BmGAu2LDAq2j4foVzC8psqmGkmgE5GjK5efxSR2SbqtN7odttv1yNNdR22v9F?cluster=devnet) | FRAUD -> SOL sell PASS |
| 5 | swap | PASS | [3znG6vwEQdjp...](https://explorer.solana.com/tx/3znG6vwEQdjp5rUijEabTWM6a1m2VGwpywLusBPxoBvKVTkxjAisP9E2cYYA6aFx7gTSp47mNGsBLsACpHpS8koF?cluster=devnet) | Vault CRIME→PROFIT: PASS (in=1000000000, out=10000000, expec |
| 6 | swap | PASS | [5UADxJbxKTZB...](https://explorer.solana.com/tx/5UADxJbxKTZBjmPA4KmobxmMCdGrmdyM6JNrmboJuJN94x9DG8KTPb3C7gaCM4aqtRmYFD3LE72nizGXWijUSayT?cluster=devnet) | Vault PROFIT→CRIME: PASS (in=10000000, out=1000000000, expec |
| 7 | swap | PASS | [4NdiDXhL7Dce...](https://explorer.solana.com/tx/4NdiDXhL7DceyaMymbEjMUaHT37nRuTyiVDxxRfbNdE7TdSQDNGbBtFf6EM9Uqgg2Q3X4Y8nyEsYtb63FpsGYQJi?cluster=devnet) | Vault FRAUD→PROFIT: PASS (in=1000000000, out=10000000, expec |
| 8 | swap | PASS | [5gbbNGT43Qbz...](https://explorer.solana.com/tx/5gbbNGT43QbzQDmMDaqSL79YU6816uto7QbmdGa92MHWsy2RYXBRiDsADmViiCKdkHht5burMZ3EbFANVRFbmhji?cluster=devnet) | Vault PROFIT→FRAUD: PASS (in=10000000, out=1000000000, expec |
| 9 | swap | PASS | [TkYKX3QFkhsd...](https://explorer.solana.com/tx/TkYKX3QFkhsdQe3ZyAPugoaVBCdhPTe7JJrxadH9EuAog5fjjuQVwsd1njyRGT31ErR55pwXKq7UPj6FcNLLtg1?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 10 | swap | PASS | [3imBWnokvJQN...](https://explorer.solana.com/tx/3imBWnokvJQN4mRnMtL9BpcgqUNi9XJrtdAGhcPeiRnkpcAmrmgwDvrAafTJKzRtMvMEUFkJnbjukSL7mhbQYUCw?cluster=devnet) | Vault CRIME→PROFIT: PASS (in=500000000, out=5000000, expecte |
| 11 | swap | PASS | [2BgaM1cAv3sK...](https://explorer.solana.com/tx/2BgaM1cAv3sKdvc15Mo1YRJvVPZpffzevY4CcpHgfxTrwCJ35ssCDEWo6MZi7EGgYzyi82brTri6YU2mA1LhLSWK?cluster=devnet) | Vault PROFIT→FRAUD: PASS (in=5000000, out=500000000, expecte |
| 12 | swap | PASS | [3fZ4RzW1pKTz...](https://explorer.solana.com/tx/3fZ4RzW1pKTz74Ms2CTyY3FjBTNJ1q2UWhLLHP4yWrUDbswj5eujLMXHrqaSzj4Jr8NVN3vP1R5mZUsqYWHekSy7?cluster=devnet) | Token sell swap executed on FRAUD/SOL (attempt 1) |
| 13 | swap | PASS | [3fZ4RzW1pKTz...](https://explorer.solana.com/tx/3fZ4RzW1pKTz74Ms2CTyY3FjBTNJ1q2UWhLLHP4yWrUDbswj5eujLMXHrqaSzj4Jr8NVN3vP1R5mZUsqYWHekSy7?cluster=devnet) | FORWARD arb loop COMPLETE: SOL→CRIME→PROFIT→FRAUD→SOL all 4  |
| 14 | swap | PASS | [3phRnE5BtqAN...](https://explorer.solana.com/tx/3phRnE5BtqANdModA6NkTWcD5y2uYFJNyCTytHCFuW9owaGdWYEpyQFH5GZJqzrj2n93Cs6H9SDJkHDYggd6FCdG?cluster=devnet) | SOL buy swap executed on FRAUD/SOL (attempt 1) |
| 15 | swap | PASS | [3FKqvc6kYztW...](https://explorer.solana.com/tx/3FKqvc6kYztWS3PGDib29qPiXm9ZAKQexo5ekh6JMCSPGSzmWznbQGQD9SfisWn3Ci7iXBb9PAfkm5HkCXdxWv1R?cluster=devnet) | Vault FRAUD→PROFIT: PASS (in=500000000, out=5000000, expecte |
| 16 | swap | PASS | [4aX42hy99Fbd...](https://explorer.solana.com/tx/4aX42hy99FbdS685MYTkB4sqeBK6HXQ5rK9N9yvQnD2WYykk52r42Zswippvbgw3mycWHrBsZhywPYXPv9trSuZc?cluster=devnet) | Vault PROFIT→CRIME: PASS (in=5000000, out=500000000, expecte |
| 17 | swap | PASS | [4pPKsMTTXEZV...](https://explorer.solana.com/tx/4pPKsMTTXEZVrLnEani18D5E6s5uBan5c5pE8f2t85aRYZvsbFMyMTVMqbT4mXx1xzLS6QafDYCTURAefxXWRhng?cluster=devnet) | Token sell swap executed on CRIME/SOL (attempt 1) |
| 18 | swap | PASS | [4pPKsMTTXEZV...](https://explorer.solana.com/tx/4pPKsMTTXEZVrLnEani18D5E6s5uBan5c5pE8f2t85aRYZvsbFMyMTVMqbT4mXx1xzLS6QafDYCTURAefxXWRhng?cluster=devnet) | REVERSE arb loop COMPLETE: SOL→FRAUD→PROFIT→CRIME→SOL all 4  |

---

**Final Tally:** 51 passed, 2 failed, 0 known issues, 0 skipped
**Total Transactions:** 18

*Generated by Dr. Fraudsworth E2E Devnet Validation Suite*
*Run completed: 2026-03-14T18:10:51.921Z*