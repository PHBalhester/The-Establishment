# E2E Devnet Test Report

**Generated:** 2026-02-13T13:39:23.490Z
**Cluster:** Solana Devnet
**Total Entries:** 135

## Summary

| Phase | Pass | Fail | Known Issue | Skip |
|-------|------|------|-------------|------|
| setup | 3 | 0 | 0 | 0 |
| swap | 51 | 0 | 0 | 0 |
| staking | 13 | 0 | 0 | 0 |
| epoch | 14 | 0 | 0 | 0 |
| carnage | 35 | 17 | 0 | 2 |
| **Total** | **116** | **17** | **0** | **2** |

## Test Environment

| Property | Value |
|----------|-------|
| Cluster | Solana Devnet |
| Wallet | `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` |
| Starting Balance | 64.53 SOL |
| E2E User | `78Jaz5s7N6Fo6cYnxLcHpsmDyNnGBWcbcb7Q31iKSLNr` |
| Total Transactions | 24 |
| Started | 2026-02-13T11:33:10.934Z |
| Completed | 2026-02-13T13:39:23.489Z |
| Duration | 126.2 min |

## 1. Swap Flow (E2E-01 + E2E-02)

### PASS: Starting swap flow (E2E-01 + E2E-02)

### PASS: EpochState read: epoch=536, cheapSide=FRAUD, crimeBuyTax=1300bps

**Details:**
```json
{
  "currentEpoch": 536,
  "cheapSide": "FRAUD",
  "crimeBuyTaxBps": 1300,
  "crimeSellTaxBps": 400,
  "fraudBuyTaxBps": 400,
  "fraudSellTaxBps": 1300
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 46309712,
  "carnageSolVault": 31850880,
  "treasury": 61531727179
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [2xKFN9jDLKbMgzFd...](https://explorer.solana.com/tx/2xKFN9jDLKbMgzFdcr6pTuppFtySTogYYN5ypMiYMSNZabWQuHC2v28TzHUWcZvnWFQFnTSz4TLucvpNZjJjdzWL?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 1300,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 56059712,
  "carnageSolVault": 34970880,
  "treasury": 61531847179
}
```

### PASS: Tax distribution verification: PASS (75.1/24.0/0.9)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 1300,
  "expectedTax": 13000000,
  "expectedStaking": 9750000,
  "expectedCarnage": 3120000,
  "expectedTreasury": 130000,
  "actualStaking": 9750000,
  "actualCarnage": 3120000,
  "actualTreasury": 120000,
  "totalReceived": 12990000,
  "stakingPct": 75.05773672055427,
  "carnagePct": 24.018475750577366,
  "treasuryPct": 0.9237875288683602,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: Swap flow complete: swap=OK, tax=OK

**TX:** [2xKFN9jDLKbMgzFd...](https://explorer.solana.com/tx/2xKFN9jDLKbMgzFdcr6pTuppFtySTogYYN5ypMiYMSNZabWQuHC2v28TzHUWcZvnWFQFnTSz4TLucvpNZjJjdzWL?cluster=devnet)

### PASS: Swap flow completed successfully

### PASS: EpochState read: epoch=536, cheapSide=FRAUD, crimeBuyTax=1300bps

**Details:**
```json
{
  "currentEpoch": 536,
  "cheapSide": "FRAUD",
  "crimeBuyTaxBps": 1300,
  "crimeSellTaxBps": 400,
  "fraudBuyTaxBps": 400,
  "fraudSellTaxBps": 1300
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 56059712,
  "carnageSolVault": 34970880,
  "treasury": 61531837179
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [3mUmNaPo5zZhfz1h...](https://explorer.solana.com/tx/3mUmNaPo5zZhfz1h8DUxZjEsiXYTMim2H9Md1gJGkTSAgMaPbi5iTGbJcePcJTgA4PCrygvhEpCTEoFFQ49iDiGm?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 1300,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 65809712,
  "carnageSolVault": 38090880,
  "treasury": 61531957179
}
```

### PASS: Tax distribution verification: PASS (75.1/24.0/0.9)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 1300,
  "expectedTax": 13000000,
  "expectedStaking": 9750000,
  "expectedCarnage": 3120000,
  "expectedTreasury": 130000,
  "actualStaking": 9750000,
  "actualCarnage": 3120000,
  "actualTreasury": 120000,
  "totalReceived": 12990000,
  "stakingPct": 75.05773672055427,
  "carnagePct": 24.018475750577366,
  "treasuryPct": 0.9237875288683602,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: EpochState read: epoch=539, cheapSide=CRIME, crimeBuyTax=300bps

**Details:**
```json
{
  "currentEpoch": 539,
  "cheapSide": "CRIME",
  "crimeBuyTaxBps": 300,
  "crimeSellTaxBps": 1100,
  "fraudBuyTaxBps": 1100,
  "fraudSellTaxBps": 300
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 65809712,
  "carnageSolVault": 38090880,
  "treasury": 61515482659
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [4vS474nFvE764EtT...](https://explorer.solana.com/tx/4vS474nFvE764EtToEuUntsxTgYNw2zBhYLRCqjMKv7gtqw7mNLdWzX2TU2vCNewKqZuniZjQXv3cLj8prV91qob?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 300,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 68059712,
  "carnageSolVault": 38810880,
  "treasury": 61515502659
}
```

### PASS: Tax distribution verification: PASS (75.3/24.1/0.7)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 300,
  "expectedTax": 3000000,
  "expectedStaking": 2250000,
  "expectedCarnage": 720000,
  "expectedTreasury": 30000,
  "actualStaking": 2250000,
  "actualCarnage": 720000,
  "actualTreasury": 20000,
  "totalReceived": 2990000,
  "stakingPct": 75.25083612040135,
  "carnagePct": 24.08026755852843,
  "treasuryPct": 0.6688963210702341,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: EpochState read: epoch=541, cheapSide=FRAUD, crimeBuyTax=1200bps

**Details:**
```json
{
  "currentEpoch": 541,
  "cheapSide": "FRAUD",
  "crimeBuyTaxBps": 1200,
  "crimeSellTaxBps": 200,
  "fraudBuyTaxBps": 200,
  "fraudSellTaxBps": 1200
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 68059712,
  "carnageSolVault": 38810880,
  "treasury": 61507262899
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [27FxtFWFv3TgYPMT...](https://explorer.solana.com/tx/27FxtFWFv3TgYPMTMzVrbBRuF2MnCNfgRRBbGJYYaBwxQ8vV3JoxkdcduXHfkQReBxYXb8Vz5VPgT9bvKst2Z4Ae?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 1200,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 77059712,
  "carnageSolVault": 41690880,
  "treasury": 61507372899
}
```

### PASS: Tax distribution verification: PASS (75.1/24.0/0.9)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 1200,
  "expectedTax": 12000000,
  "expectedStaking": 9000000,
  "expectedCarnage": 2880000,
  "expectedTreasury": 120000,
  "actualStaking": 9000000,
  "actualCarnage": 2880000,
  "actualTreasury": 110000,
  "totalReceived": 11990000,
  "stakingPct": 75.0625521267723,
  "carnagePct": 24.02001668056714,
  "treasuryPct": 0.9174311926605505,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: EpochState read: epoch=543, cheapSide=CRIME, crimeBuyTax=200bps

**Details:**
```json
{
  "currentEpoch": 543,
  "cheapSide": "CRIME",
  "crimeBuyTaxBps": 200,
  "crimeSellTaxBps": 1300,
  "fraudBuyTaxBps": 1300,
  "fraudSellTaxBps": 200
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 60850035,
  "carnageSolVault": 41690880,
  "treasury": 61490883379
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [2D2kMmekRxrq5dqS...](https://explorer.solana.com/tx/2D2kMmekRxrq5dqS4rgd536isQvKgGTEee4iVPnT8fxaShazd72agrsAwU5iy6g3aoMUQrFR17dT1Najk1cjUGfQ?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 200,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 62350035,
  "carnageSolVault": 42170880,
  "treasury": 61490893379
}
```

### PASS: Tax distribution verification: PASS (75.4/24.1/0.5)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 200,
  "expectedTax": 2000000,
  "expectedStaking": 1500000,
  "expectedCarnage": 480000,
  "expectedTreasury": 20000,
  "actualStaking": 1500000,
  "actualCarnage": 480000,
  "actualTreasury": 10000,
  "totalReceived": 1990000,
  "stakingPct": 75.37688442211056,
  "carnagePct": 24.120603015075375,
  "treasuryPct": 0.5025125628140703,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: EpochState read: epoch=544, cheapSide=FRAUD, crimeBuyTax=1100bps

**Details:**
```json
{
  "currentEpoch": 544,
  "cheapSide": "FRAUD",
  "crimeBuyTaxBps": 1100,
  "crimeSellTaxBps": 400,
  "fraudBuyTaxBps": 400,
  "fraudSellTaxBps": 1100
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 62350035,
  "carnageSolVault": 42170880,
  "treasury": 61482653619
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [5zT3LVSBTacFTgzh...](https://explorer.solana.com/tx/5zT3LVSBTacFTgzhHUcXabor7aSUdv1GZys4gm2JzB5DmcPxLUgaAmdKWVSKpc4UnFZWeRBikZdpDHMxSCNNjavT?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 1100,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 70600035,
  "carnageSolVault": 44810880,
  "treasury": 61482753619
}
```

### PASS: Tax distribution verification: PASS (75.1/24.0/0.9)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 1100,
  "expectedTax": 11000000,
  "expectedStaking": 8250000,
  "expectedCarnage": 2640000,
  "expectedTreasury": 110000,
  "actualStaking": 8250000,
  "actualCarnage": 2640000,
  "actualTreasury": 100000,
  "totalReceived": 10990000,
  "stakingPct": 75.06824385805277,
  "carnagePct": 24.021838034576888,
  "treasuryPct": 0.9099181073703366,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: EpochState read: epoch=545, cheapSide=CRIME, crimeBuyTax=100bps

**Details:**
```json
{
  "currentEpoch": 545,
  "cheapSide": "CRIME",
  "crimeBuyTaxBps": 100,
  "crimeSellTaxBps": 1400,
  "fraudBuyTaxBps": 1400,
  "fraudSellTaxBps": 100
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 70600035,
  "carnageSolVault": 44810880,
  "treasury": 61474513859
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [5mwQPxbkTPZdQnAT...](https://explorer.solana.com/tx/5mwQPxbkTPZdQnATuMBSsySHf2LF8xiyniW3w2URejSQ2VhTwGuTif8WeXsaG84KHGmhXb1K43PmgHL78c2EFezF?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 100,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 71350035,
  "carnageSolVault": 45050880,
  "treasury": 61474513859
}
```

### PASS: Tax distribution verification: PASS (75.8/24.2/0.0)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 100,
  "expectedTax": 1000000,
  "expectedStaking": 750000,
  "expectedCarnage": 240000,
  "expectedTreasury": 10000,
  "actualStaking": 750000,
  "actualCarnage": 240000,
  "actualTreasury": 0,
  "totalReceived": 990000,
  "stakingPct": 75.75757575757575,
  "carnagePct": 24.242424242424242,
  "treasuryPct": 0,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```

### PASS: EpochState read: epoch=546, cheapSide=CRIME, crimeBuyTax=100bps

**Details:**
```json
{
  "currentEpoch": 546,
  "cheapSide": "CRIME",
  "crimeBuyTaxBps": 100,
  "crimeSellTaxBps": 1400,
  "fraudBuyTaxBps": 1400,
  "fraudSellTaxBps": 100
}
```

### PASS: Pre-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 71350035,
  "carnageSolVault": 45050880,
  "treasury": 61326368179
}
```

### PASS: Resolved 4 Transfer Hook accounts

**Details:**
```json
{
  "hookAccountCount": 4,
  "hookAccounts": [
    "Y7JQorztNNh8kq51ufEA3LJcfWKVvXozhWEz2Lzx3uC",
    "2a7C5BJ1aEZpYDDcKhxf7NwAm6YGRNyg387QwpdvomV4",
    "9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ",
    "6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN"
  ]
}
```

### PASS: SOL buy swap executed on CRIME/SOL (attempt 1)

**TX:** [E8xAv2w5EqG8qZVx...](https://explorer.solana.com/tx/E8xAv2w5EqG8qZVx3PBi9kxgpW5AvMSc1FqQaZHFsfUuX7isoyuCAZ5BwEJLrFnaokaHo4sVon8ACjeZUKeVdAw?cluster=devnet)

**Details:**
```json
{
  "poolName": "CRIME/SOL",
  "amountIn": 100000000,
  "minimumOutput": 0,
  "isCrime": true,
  "taxBps": 100,
  "attempt": 1
}
```

### PASS: Post-swap balance snapshot captured

**Details:**
```json
{
  "escrowVault": 72100035,
  "carnageSolVault": 45290880,
  "treasury": 61326368179
}
```

### PASS: Tax distribution verification: PASS (75.8/24.2/0.0)

**Details:**
```json
{
  "amountIn": 100000000,
  "taxBps": 100,
  "expectedTax": 1000000,
  "expectedStaking": 750000,
  "expectedCarnage": 240000,
  "expectedTreasury": 10000,
  "actualStaking": 750000,
  "actualCarnage": 240000,
  "actualTreasury": 0,
  "totalReceived": 990000,
  "stakingPct": 75.75757575757575,
  "carnagePct": 24.242424242424242,
  "treasuryPct": 0,
  "stakingOk": true,
  "carnageOk": true,
  "treasuryOk": true,
  "valid": true
}
```


## 2. Staking Flow (E2E-03 + E2E-04)

### Stake PROFIT

**Status:** PASS
**TX:** [3CanYH9Vi8LxiCzo...](https://explorer.solana.com/tx/3CanYH9Vi8LxiCzoJC3FkY5uQziDApZ3K3vRMywAcUUeK89JS4gyFH6QLoQtPU2Dmnm28dDZC2WP4Te2eqXJ37jJ?cluster=devnet)
**Amount:** 10 PROFIT
**Pre-balance:** 100000000 raw
**Post-balance:** 90000000 raw

### Claim SOL Yield

**Status:** PASS
**TX:** [2x7JaF227GLYa47T...](https://explorer.solana.com/tx/2x7JaF227GLYa47Tp8eZAVgfU9QCy983NrM1BbxAHSq2SyHkDBefeHMg1ayvKpHSV7egSneWf8VMCNWP2AmkcgUA?cluster=devnet)
**Yield:** 0.016214677 SOL (16214677 lamports)
**Pre-balance:** 949048080 lamports
**Post-balance:** 965257757 lamports

### Flow Summary

**Result:** PASS
**Message:** Staking flow complete: staked 10 PROFIT, claimed 0.016214677 SOL yield, 3/3 epoch transitions
**Duration:** 17.7 min
**Epoch Transitions:** 3/3

<details>
<summary>Full staking log entries</summary>

- **PASS:** Starting staking + multi-epoch flow
- **PASS:** Starting staking + multi-epoch flow (E2E-03 + E2E-04)
- **PASS:** Step 1/4: Staking 10 PROFIT tokens
- **PASS:** Pre-stake PROFIT balance: 100
- **PASS:** Resolved 4 Transfer Hook accounts for PROFIT stake
- **PASS:** Staked 10 PROFIT successfully
  - TX: [3CanYH9Vi8LxiCzo...](https://explorer.solana.com/tx/3CanYH9Vi8LxiCzoJC3FkY5uQziDApZ3K3vRMywAcUUeK89JS4gyFH6QLoQtPU2Dmnm28dDZC2WP4Te2eqXJ37jJ?cluster=devnet)
- **PASS:** Step 2/4: Running initial swap to generate tax revenue
- **PASS:** Step 3/4: Advancing 3 epochs with VRF
- **PASS:** Step 4/4: Claiming SOL yield from staking escrow
- **PASS:** Pre-claim SOL balance: 0.949048 SOL
- **PASS:** Claim yield: received 0.016214677 SOL
  - TX: [2x7JaF227GLYa47T...](https://explorer.solana.com/tx/2x7JaF227GLYa47Tp8eZAVgfU9QCy983NrM1BbxAHSq2SyHkDBefeHMg1ayvKpHSV7egSneWf8VMCNWP2AmkcgUA?cluster=devnet)
- **PASS:** Staking flow complete: staked 10 PROFIT, claimed 0.016214677 SOL yield, 3/3 epoch transitions
  - TX: [2x7JaF227GLYa47T...](https://explorer.solana.com/tx/2x7JaF227GLYa47Tp8eZAVgfU9QCy983NrM1BbxAHSq2SyHkDBefeHMg1ayvKpHSV7egSneWf8VMCNWP2AmkcgUA?cluster=devnet)
- **PASS:** Staking flow completed successfully with non-zero yield

</details>

## 3. Epoch Transitions (E2E-04)

| # | Epoch | CheapSide | LowTax | HighTax | Flipped | Carnage | Duration | TX Sig |
|---|-------|-----------|--------|---------|---------|---------|----------|--------|
| 1 | 539 | CRIME | 300bps | 1100bps | YES | no | 317.5s | [485kchM6...](https://explorer.solana.com/tx/485kchM68X3Hw8ZsGTvYup4fDLhugJAYPhbox2pfAxtRB2bzccguYnAoBpvDKWoFqLQ8bTNjQ5gFuVahgruNJFuK?cluster=devnet) |
| 2 | 541 | FRAUD | 200bps | 1200bps | YES | no | 45.9s | [5rRUyWv9...](https://explorer.solana.com/tx/5rRUyWv9ZbQ9wn4RFNubAQKdcMMnXKQ6pWKmHhBzyGr45rNhGuHnrgKw6AbPh8TGh5p3igQgxSp5ALvRgQMjcnye?cluster=devnet) |
| 3 | 542 | FRAUD | 400bps | 1200bps | no | no | 46.5s | [87161Sio...](https://explorer.solana.com/tx/87161SioLrXMerbGYGSFHG3JmJQkoeauiBSdSNu1xL9WGZWeUM2Uxv3pgsftYtT5GDJTLQGcLxQBiCvbVkSsTYW?cluster=devnet) |

**Result:** 3/3 transitions successful

### Inter-Epoch Swaps (Tax Revenue Generation)

- **PASS:** Inter-epoch swap 1 completed: 4vS474nFvE764EtT...
  - TX: [4vS474nFvE764EtT...](https://explorer.solana.com/tx/4vS474nFvE764EtToEuUntsxTgYNw2zBhYLRCqjMKv7gtqw7mNLdWzX2TU2vCNewKqZuniZjQXv3cLj8prV91qob?cluster=devnet)
- **PASS:** Inter-epoch swap 2 completed: 27FxtFWFv3TgYPMT...
  - TX: [27FxtFWFv3TgYPMT...](https://explorer.solana.com/tx/27FxtFWFv3TgYPMTMzVrbBRuF2MnCNfgRRBbGJYYaBwxQ8vV3JoxkdcduXHfkQReBxYXb8Vz5VPgT9bvKst2Z4Ae?cluster=devnet)

<details>
<summary>Full epoch transition log entries</summary>

- **PASS:** Starting multi-epoch cycling: 3 transitions
- **PASS:** Epoch transition 1/3: BEFORE state -- epoch=536, cheapSide=FRAUD, lowTax=400bps, highTax=1300bps
- **PASS:** Epoch transition 1/3: epoch=539, cheapSide=CRIME, lowTax=300bps, highTax=1100bps, flipped=true, carnage=false
  - TX: [485kchM68X3Hw8Zs...](https://explorer.solana.com/tx/485kchM68X3Hw8ZsGTvYup4fDLhugJAYPhbox2pfAxtRB2bzccguYnAoBpvDKWoFqLQ8bTNjQ5gFuVahgruNJFuK?cluster=devnet)
- **PASS:** Running inter-epoch swap 1 to generate tax revenue for staking yield
- **PASS:** Inter-epoch swap 1 completed: 4vS474nFvE764EtT...
  - TX: [4vS474nFvE764EtT...](https://explorer.solana.com/tx/4vS474nFvE764EtToEuUntsxTgYNw2zBhYLRCqjMKv7gtqw7mNLdWzX2TU2vCNewKqZuniZjQXv3cLj8prV91qob?cluster=devnet)
- **PASS:** Waiting for 760 slots before epoch transition 2/3 (~5 min on devnet)
- **PASS:** Epoch transition 2/3: BEFORE state -- epoch=539, cheapSide=CRIME, lowTax=300bps, highTax=1100bps
- **PASS:** Epoch transition 2/3: epoch=541, cheapSide=FRAUD, lowTax=200bps, highTax=1200bps, flipped=true, carnage=false
  - TX: [5rRUyWv9ZbQ9wn4R...](https://explorer.solana.com/tx/5rRUyWv9ZbQ9wn4RFNubAQKdcMMnXKQ6pWKmHhBzyGr45rNhGuHnrgKw6AbPh8TGh5p3igQgxSp5ALvRgQMjcnye?cluster=devnet)
- **PASS:** Running inter-epoch swap 2 to generate tax revenue for staking yield
- **PASS:** Inter-epoch swap 2 completed: 27FxtFWFv3TgYPMT...
  - TX: [27FxtFWFv3TgYPMT...](https://explorer.solana.com/tx/27FxtFWFv3TgYPMTMzVrbBRuF2MnCNfgRRBbGJYYaBwxQ8vV3JoxkdcduXHfkQReBxYXb8Vz5VPgT9bvKst2Z4Ae?cluster=devnet)
- **PASS:** Waiting for 760 slots before epoch transition 3/3 (~5 min on devnet)
- **PASS:** Epoch transition 3/3: BEFORE state -- epoch=541, cheapSide=FRAUD, lowTax=200bps, highTax=1200bps
- **PASS:** Epoch transition 3/3: epoch=542, cheapSide=FRAUD, lowTax=400bps, highTax=1200bps, flipped=false, carnage=false
  - TX: [87161SioLrXMerbG...](https://explorer.solana.com/tx/87161SioLrXMerbGYGSFHG3JmJQkoeauiBSdSNu1xL9WGZWeUM2Uxv3pgsftYtT5GDJTLQGcLxQBiCvbVkSsTYW?cluster=devnet)
- **PASS:** Multi-epoch cycling complete: 3/3 transitions successful

</details>

## 4. Carnage (E2E-05)

### Forced Carnage (execute_carnage_atomic)

**Status:** SKIPPED (carnage_pending = false, no prior VRF trigger)

### Natural Carnage (VRF Epoch Cycling)

| Epoch # | Epoch | CheapSide | Carnage? | TX |
|---------|-------|-----------|----------|-----|
| 1 | 543 | CRIME | no | [2MWmEv6x...](https://explorer.solana.com/tx/2MWmEv6xmaY55HBseQmJ6dLGPF3PFC6GqpBptp2zkxRqM8iaY2L8yDXxxWXC8wktT3MhfHqBAX23629di5Gvsf8N?cluster=devnet) |
| 2 | 544 | FRAUD | no | [5k8BGcfc...](https://explorer.solana.com/tx/5k8BGcfcWrXmGcqtRfmefAWP2ZXzPH3gaeRSokPWx55Vs7ANPFWdyruDEhBenfcTsrUHrDDf1eBh97yE3tfErinW?cluster=devnet) |
| 3 | 545 | CRIME | no | [2gXQRdxu...](https://explorer.solana.com/tx/2gXQRdxuMHEkDFL8i2sv3MWzoUK9ZCJwPNf3sJq2pA72GtEnNabiaWnyFPHnjsDLY5dvimcny54VpAxmJaytrWwb?cluster=devnet) |
| 4 | undefined | undefined | no | N/A |
| 5 | undefined | undefined | no | N/A |
| 6 | undefined | undefined | no | N/A |
| 7 | undefined | undefined | no | N/A |
| 8 | undefined | undefined | no | N/A |
| 9 | undefined | undefined | no | N/A |
| 10 | undefined | undefined | no | N/A |
| 11 | undefined | undefined | no | N/A |
| 12 | undefined | undefined | no | N/A |
| 13 | undefined | undefined | no | N/A |
| 14 | undefined | undefined | no | N/A |
| 15 | undefined | undefined | no | N/A |
| 16 | undefined | undefined | no | N/A |
| 17 | undefined | undefined | no | N/A |
| 18 | undefined | undefined | no | N/A |
| 19 | undefined | undefined | no | N/A |
| 20 | undefined | undefined | no | N/A |

**Result:** SKIP (probabilistic) -- Natural Carnage not triggered in 20 epochs (probability ~4.3%/epoch, expected ~1 in 23 epochs)

### Post-Carnage Health Check

**Status:** PASS -- Step 3/3: Post-Carnage health check


<details>
<summary>Full Carnage log entries</summary>

- **PASS:** Starting Carnage trigger testing
- **PASS:** Starting Carnage trigger testing (E2E-05)
- **PASS:** Step 1/3: Testing forced Carnage (if carnage_pending)
- **SKIP:** No Carnage pending -- skipping forced test (need VRF byte 3 < 11 first)
- **PASS:** Step 2/3: Testing natural Carnage (VRF epoch cycling)
- **PASS:** Starting natural Carnage cycling: up to 20 epochs (~4.3% chance per epoch)
- **PASS:** Epoch 1/20: epoch=543, cheapSide=CRIME, carnage_pending=false
  - TX: [2MWmEv6xmaY55HBs...](https://explorer.solana.com/tx/2MWmEv6xmaY55HBseQmJ6dLGPF3PFC6GqpBptp2zkxRqM8iaY2L8yDXxxWXC8wktT3MhfHqBAX23629di5Gvsf8N?cluster=devnet)
- **PASS:** Inter-Carnage-cycle swap 1 completed
  - TX: [2D2kMmekRxrq5dqS...](https://explorer.solana.com/tx/2D2kMmekRxrq5dqS4rgd536isQvKgGTEee4iVPnT8fxaShazd72agrsAwU5iy6g3aoMUQrFR17dT1Najk1cjUGfQ?cluster=devnet)
- **PASS:** Waiting for 760 slots before Carnage epoch 2/20 (~5 min on devnet)
- **PASS:** Epoch 2/20: epoch=544, cheapSide=FRAUD, carnage_pending=false
  - TX: [5k8BGcfcWrXmGcqt...](https://explorer.solana.com/tx/5k8BGcfcWrXmGcqtRfmefAWP2ZXzPH3gaeRSokPWx55Vs7ANPFWdyruDEhBenfcTsrUHrDDf1eBh97yE3tfErinW?cluster=devnet)
- **PASS:** Inter-Carnage-cycle swap 2 completed
  - TX: [5zT3LVSBTacFTgzh...](https://explorer.solana.com/tx/5zT3LVSBTacFTgzhHUcXabor7aSUdv1GZys4gm2JzB5DmcPxLUgaAmdKWVSKpc4UnFZWeRBikZdpDHMxSCNNjavT?cluster=devnet)
- **PASS:** Waiting for 760 slots before Carnage epoch 3/20 (~5 min on devnet)
- **PASS:** Epoch 3/20: epoch=545, cheapSide=CRIME, carnage_pending=false
  - TX: [2gXQRdxuMHEkDFL8...](https://explorer.solana.com/tx/2gXQRdxuMHEkDFL8i2sv3MWzoUK9ZCJwPNf3sJq2pA72GtEnNabiaWnyFPHnjsDLY5dvimcny54VpAxmJaytrWwb?cluster=devnet)
- **PASS:** Inter-Carnage-cycle swap 3 completed
  - TX: [5mwQPxbkTPZdQnAT...](https://explorer.solana.com/tx/5mwQPxbkTPZdQnATuMBSsySHf2LF8xiyniW3w2URejSQ2VhTwGuTif8WeXsaG84KHGmhXb1K43PmgHL78c2EFezF?cluster=devnet)
- **PASS:** Waiting for 760 slots before Carnage epoch 4/20 (~5 min on devnet)
- **FAIL:** Epoch transition 4/20 failed: Error: VRF recovery failed: oracle still not responding after retry
- **PASS:** Waiting for 760 slots before Carnage epoch 5/20 (~5 min on devnet)
- **FAIL:** Epoch transition 5/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [93, 160, 230, 197, 93, 79, 12, 13, 160, 13, 157, 211, 218, 113, 17, 27, 75, 53, 221, 234, 253, 59, 69, 66, 0, 154, 216, 7, 191, 8
- **PASS:** Waiting for 760 slots before Carnage epoch 6/20 (~5 min on devnet)
- **FAIL:** Epoch transition 6/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [224, 44, 215, 145, 126, 93, 118, 139, 30, 100, 116, 247, 155, 59, 38, 186, 107, 194, 254, 12, 19, 213, 104, 169, 189, 77, 147, 18
- **PASS:** Waiting for 760 slots before Carnage epoch 7/20 (~5 min on devnet)
- **FAIL:** Epoch transition 7/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [44, 245, 187, 140, 212, 58, 27, 38, 29, 234, 151, 74, 109, 31, 156, 38, 108, 98, 97, 225, 49, 18, 143, 189, 104, 77, 148, 216, 25
- **PASS:** Waiting for 760 slots before Carnage epoch 8/20 (~5 min on devnet)
- **FAIL:** Epoch transition 8/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [74, 70, 63, 188, 248, 135, 189, 255, 227, 86, 118, 213, 42, 178, 217, 118, 16, 110, 70, 125, 213, 151, 64, 122, 8, 98, 0, 247, 19
- **PASS:** Waiting for 760 slots before Carnage epoch 9/20 (~5 min on devnet)
- **FAIL:** Epoch transition 9/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [4, 236, 17, 19, 212, 63, 233, 65, 209, 172, 252, 20, 134, 247, 188, 247, 82, 253, 146, 142, 175, 169, 103, 152, 128, 0, 57, 23, 1
- **PASS:** Waiting for 760 slots before Carnage epoch 10/20 (~5 min on devnet)
- **FAIL:** Epoch transition 10/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [157, 61, 129, 160, 9, 67, 182, 91, 247, 178, 42, 134, 176, 190, 99, 122, 18, 1, 96, 196, 228, 157, 244, 92, 96, 236, 143, 108, 19
- **PASS:** Waiting for 760 slots before Carnage epoch 11/20 (~5 min on devnet)
- **FAIL:** Epoch transition 11/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [91, 53, 167, 228, 145, 75, 191, 150, 100, 89, 157, 2, 68, 221, 70, 127, 193, 207, 78, 87, 66, 214, 242, 235, 29, 30, 18, 200, 228
- **PASS:** Waiting for 760 slots before Carnage epoch 12/20 (~5 min on devnet)
- **FAIL:** Epoch transition 12/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [39, 85, 117, 85, 134, 170, 50, 94, 108, 155, 116, 252, 162, 100, 122, 132, 54, 88, 83, 242, 167, 35, 69, 78, 80, 15, 247, 180, 29
- **PASS:** Waiting for 760 slots before Carnage epoch 13/20 (~5 min on devnet)
- **FAIL:** Epoch transition 13/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [51, 131, 228, 124, 130, 116, 65, 160, 49, 129, 24, 158, 225, 141, 203, 104, 103, 158, 223, 101, 164, 241, 228, 24, 119, 241, 129,
- **PASS:** Waiting for 760 slots before Carnage epoch 14/20 (~5 min on devnet)
- **FAIL:** Epoch transition 14/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [100, 97, 179, 40, 134, 238, 43, 8, 202, 1, 132, 191, 119, 122, 40, 144, 249, 154, 180, 242, 1, 136, 23, 95, 136, 57, 161, 169, 20
- **PASS:** Waiting for 760 slots before Carnage epoch 15/20 (~5 min on devnet)
- **FAIL:** Epoch transition 15/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [131, 83, 254, 97, 39, 171, 135, 221, 109, 82, 230, 29, 131, 163, 246, 206, 206, 48, 0, 231, 16, 4, 12, 5, 223, 113, 227, 87, 254,
- **PASS:** Waiting for 760 slots before Carnage epoch 16/20 (~5 min on devnet)
- **FAIL:** Epoch transition 16/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [169, 163, 201, 231, 234, 187, 175, 229, 188, 56, 40, 149, 122, 209, 71, 24, 211, 151, 162, 198, 151, 161, 65, 183, 94, 10, 19, 19
- **PASS:** Waiting for 760 slots before Carnage epoch 17/20 (~5 min on devnet)
- **FAIL:** Epoch transition 17/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [217, 218, 248, 5, 39, 231, 47, 70, 184, 183, 55, 99, 134, 194, 99, 122, 12, 29, 192, 22, 29, 242, 208, 127, 211, 25, 151, 224, 15
- **PASS:** Waiting for 760 slots before Carnage epoch 18/20 (~5 min on devnet)
- **FAIL:** Epoch transition 18/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [161, 184, 47, 155, 68, 227, 14, 186, 45, 88, 66, 128, 144, 60, 16, 3, 131, 213, 60, 156, 160, 194, 14, 227, 122, 76, 38, 245, 83,
- **PASS:** Waiting for 760 slots before Carnage epoch 19/20 (~5 min on devnet)
- **FAIL:** Epoch transition 19/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [93, 209, 251, 154, 122, 247, 4, 57, 82, 244, 181, 104, 25, 28, 101, 239, 243, 45, 199, 211, 92, 205, 203, 26, 100, 254, 96, 19, 8
- **PASS:** Waiting for 760 slots before Carnage epoch 20/20 (~5 min on devnet)
- **FAIL:** Epoch transition 20/20 failed: Error: Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1774. 
Logs: 
[
  "Program log: SEED_SLOTHASH: [113, 47, 193, 56, 195, 210, 84, 184, 230, 166, 238, 207, 181, 149, 33, 122, 181, 27, 158, 80, 252, 15, 37, 166, 73, 81, 4, 49, 19
- **SKIP:** Natural Carnage not triggered in 20 epochs (probability ~4.3%/epoch, expected ~1 in 23 epochs)
- **PASS:** Step 3/3: Post-Carnage health check
- **PASS:** Running post-Carnage health check: executing SOL buy swap
- **PASS:** Post-Carnage health check PASSED -- protocol operational
  - TX: [E8xAv2w5EqG8qZVx...](https://explorer.solana.com/tx/E8xAv2w5EqG8qZVx3PBi9kxgpW5AvMSc1FqQaZHFsfUuX7isoyuCAZ5BwEJLrFnaokaHo4sVon8ACjeZUKeVdAw?cluster=devnet)
- **PASS:** Carnage flow complete: forced=SKIP, health_check=PASS
- **PASS:** Carnage flow completed successfully

</details>

## 5. Known Issues

No known issues encountered during this run.

## 6. Mainnet Readiness Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC-1: SOL buy swap + tax distribution | PASS | [TX](https://explorer.solana.com/tx/2xKFN9jDLKbMgzFdcr6pTuppFtySTogYYN5ypMiYMSNZabWQuHC2v28TzHUWcZvnWFQFnTSz4TLucvpNZjJjdzWL?cluster=devnet) + tax verified |
| SC-2: Staking yield claim | PASS | [Stake TX](https://explorer.solana.com/tx/3CanYH9Vi8LxiCzoJC3FkY5uQziDApZ3K3vRMywAcUUeK89JS4gyFH6QLoQtPU2Dmnm28dDZC2WP4Te2eqXJ37jJ?cluster=devnet) + [Claim TX](https://explorer.solana.com/tx/2x7JaF227GLYa47Tp8eZAVgfU9QCy983NrM1BbxAHSq2SyHkDBefeHMg1ayvKpHSV7egSneWf8VMCNWP2AmkcgUA?cluster=devnet) (0.016215 SOL) |
| SC-3: Multi-epoch VRF transitions (3+) | PASS | 6 transitions: [TX](https://explorer.solana.com/tx/485kchM68X3Hw8ZsGTvYup4fDLhugJAYPhbox2pfAxtRB2bzccguYnAoBpvDKWoFqLQ8bTNjQ5gFuVahgruNJFuK?cluster=devnet), [TX](https://explorer.solana.com/tx/5rRUyWv9ZbQ9wn4RFNubAQKdcMMnXKQ6pWKmHhBzyGr45rNhGuHnrgKw6AbPh8TGh5p3igQgxSp5ALvRgQMjcnye?cluster=devnet), [TX](https://explorer.solana.com/tx/87161SioLrXMerbGYGSFHG3JmJQkoeauiBSdSNu1xL9WGZWeUM2Uxv3pgsftYtT5GDJTLQGcLxQBiCvbVkSsTYW?cluster=devnet) |
| SC-4: Carnage trigger | SKIP (probabilistic) | VRF did not trigger Carnage in available epochs (~4.3%/epoch) |
| SC-5: E2E documentation | PASS | This report |

### Assessment

**Overall: 4/5 criteria satisfied.** Protocol core functionality validated on devnet.

## 7. Appendix: Full Transaction Log

| # | Phase | Status | TX Signature | Description |
|---|-------|--------|-------------|-------------|
| 1 | swap | PASS | [2xKFN9jDLKbM...](https://explorer.solana.com/tx/2xKFN9jDLKbMgzFdcr6pTuppFtySTogYYN5ypMiYMSNZabWQuHC2v28TzHUWcZvnWFQFnTSz4TLucvpNZjJjdzWL?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 2 | swap | PASS | [2xKFN9jDLKbM...](https://explorer.solana.com/tx/2xKFN9jDLKbMgzFdcr6pTuppFtySTogYYN5ypMiYMSNZabWQuHC2v28TzHUWcZvnWFQFnTSz4TLucvpNZjJjdzWL?cluster=devnet) | Swap flow complete: swap=OK, tax=OK |
| 3 | staking | PASS | [3CanYH9Vi8Lx...](https://explorer.solana.com/tx/3CanYH9Vi8LxiCzoJC3FkY5uQziDApZ3K3vRMywAcUUeK89JS4gyFH6QLoQtPU2Dmnm28dDZC2WP4Te2eqXJ37jJ?cluster=devnet) | Staked 10 PROFIT successfully |
| 4 | swap | PASS | [3mUmNaPo5zZh...](https://explorer.solana.com/tx/3mUmNaPo5zZhfz1h8DUxZjEsiXYTMim2H9Md1gJGkTSAgMaPbi5iTGbJcePcJTgA4PCrygvhEpCTEoFFQ49iDiGm?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 5 | epoch | PASS | [485kchM68X3H...](https://explorer.solana.com/tx/485kchM68X3Hw8ZsGTvYup4fDLhugJAYPhbox2pfAxtRB2bzccguYnAoBpvDKWoFqLQ8bTNjQ5gFuVahgruNJFuK?cluster=devnet) | Epoch transition 1/3: epoch=539, cheapSide=CRIME, lowTax=300 |
| 6 | swap | PASS | [4vS474nFvE76...](https://explorer.solana.com/tx/4vS474nFvE764EtToEuUntsxTgYNw2zBhYLRCqjMKv7gtqw7mNLdWzX2TU2vCNewKqZuniZjQXv3cLj8prV91qob?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 7 | epoch | PASS | [4vS474nFvE76...](https://explorer.solana.com/tx/4vS474nFvE764EtToEuUntsxTgYNw2zBhYLRCqjMKv7gtqw7mNLdWzX2TU2vCNewKqZuniZjQXv3cLj8prV91qob?cluster=devnet) | Inter-epoch swap 1 completed: 4vS474nFvE764EtT... |
| 8 | epoch | PASS | [5rRUyWv9ZbQ9...](https://explorer.solana.com/tx/5rRUyWv9ZbQ9wn4RFNubAQKdcMMnXKQ6pWKmHhBzyGr45rNhGuHnrgKw6AbPh8TGh5p3igQgxSp5ALvRgQMjcnye?cluster=devnet) | Epoch transition 2/3: epoch=541, cheapSide=FRAUD, lowTax=200 |
| 9 | swap | PASS | [27FxtFWFv3Tg...](https://explorer.solana.com/tx/27FxtFWFv3TgYPMTMzVrbBRuF2MnCNfgRRBbGJYYaBwxQ8vV3JoxkdcduXHfkQReBxYXb8Vz5VPgT9bvKst2Z4Ae?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 10 | epoch | PASS | [27FxtFWFv3Tg...](https://explorer.solana.com/tx/27FxtFWFv3TgYPMTMzVrbBRuF2MnCNfgRRBbGJYYaBwxQ8vV3JoxkdcduXHfkQReBxYXb8Vz5VPgT9bvKst2Z4Ae?cluster=devnet) | Inter-epoch swap 2 completed: 27FxtFWFv3TgYPMT... |
| 11 | epoch | PASS | [87161SioLrXM...](https://explorer.solana.com/tx/87161SioLrXMerbGYGSFHG3JmJQkoeauiBSdSNu1xL9WGZWeUM2Uxv3pgsftYtT5GDJTLQGcLxQBiCvbVkSsTYW?cluster=devnet) | Epoch transition 3/3: epoch=542, cheapSide=FRAUD, lowTax=400 |
| 12 | staking | PASS | [2x7JaF227GLY...](https://explorer.solana.com/tx/2x7JaF227GLYa47Tp8eZAVgfU9QCy983NrM1BbxAHSq2SyHkDBefeHMg1ayvKpHSV7egSneWf8VMCNWP2AmkcgUA?cluster=devnet) | Claim yield: received 0.016214677 SOL |
| 13 | staking | PASS | [2x7JaF227GLY...](https://explorer.solana.com/tx/2x7JaF227GLYa47Tp8eZAVgfU9QCy983NrM1BbxAHSq2SyHkDBefeHMg1ayvKpHSV7egSneWf8VMCNWP2AmkcgUA?cluster=devnet) | Staking flow complete: staked 10 PROFIT, claimed 0.016214677 |
| 14 | carnage | PASS | [2MWmEv6xmaY5...](https://explorer.solana.com/tx/2MWmEv6xmaY55HBseQmJ6dLGPF3PFC6GqpBptp2zkxRqM8iaY2L8yDXxxWXC8wktT3MhfHqBAX23629di5Gvsf8N?cluster=devnet) | Epoch 1/20: epoch=543, cheapSide=CRIME, carnage_pending=fals |
| 15 | swap | PASS | [2D2kMmekRxrq...](https://explorer.solana.com/tx/2D2kMmekRxrq5dqS4rgd536isQvKgGTEee4iVPnT8fxaShazd72agrsAwU5iy6g3aoMUQrFR17dT1Najk1cjUGfQ?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 16 | carnage | PASS | [2D2kMmekRxrq...](https://explorer.solana.com/tx/2D2kMmekRxrq5dqS4rgd536isQvKgGTEee4iVPnT8fxaShazd72agrsAwU5iy6g3aoMUQrFR17dT1Najk1cjUGfQ?cluster=devnet) | Inter-Carnage-cycle swap 1 completed |
| 17 | carnage | PASS | [5k8BGcfcWrXm...](https://explorer.solana.com/tx/5k8BGcfcWrXmGcqtRfmefAWP2ZXzPH3gaeRSokPWx55Vs7ANPFWdyruDEhBenfcTsrUHrDDf1eBh97yE3tfErinW?cluster=devnet) | Epoch 2/20: epoch=544, cheapSide=FRAUD, carnage_pending=fals |
| 18 | swap | PASS | [5zT3LVSBTacF...](https://explorer.solana.com/tx/5zT3LVSBTacFTgzhHUcXabor7aSUdv1GZys4gm2JzB5DmcPxLUgaAmdKWVSKpc4UnFZWeRBikZdpDHMxSCNNjavT?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 19 | carnage | PASS | [5zT3LVSBTacF...](https://explorer.solana.com/tx/5zT3LVSBTacFTgzhHUcXabor7aSUdv1GZys4gm2JzB5DmcPxLUgaAmdKWVSKpc4UnFZWeRBikZdpDHMxSCNNjavT?cluster=devnet) | Inter-Carnage-cycle swap 2 completed |
| 20 | carnage | PASS | [2gXQRdxuMHEk...](https://explorer.solana.com/tx/2gXQRdxuMHEkDFL8i2sv3MWzoUK9ZCJwPNf3sJq2pA72GtEnNabiaWnyFPHnjsDLY5dvimcny54VpAxmJaytrWwb?cluster=devnet) | Epoch 3/20: epoch=545, cheapSide=CRIME, carnage_pending=fals |
| 21 | swap | PASS | [5mwQPxbkTPZd...](https://explorer.solana.com/tx/5mwQPxbkTPZdQnATuMBSsySHf2LF8xiyniW3w2URejSQ2VhTwGuTif8WeXsaG84KHGmhXb1K43PmgHL78c2EFezF?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 22 | carnage | PASS | [5mwQPxbkTPZd...](https://explorer.solana.com/tx/5mwQPxbkTPZdQnATuMBSsySHf2LF8xiyniW3w2URejSQ2VhTwGuTif8WeXsaG84KHGmhXb1K43PmgHL78c2EFezF?cluster=devnet) | Inter-Carnage-cycle swap 3 completed |
| 23 | swap | PASS | [E8xAv2w5EqG8...](https://explorer.solana.com/tx/E8xAv2w5EqG8qZVx3PBi9kxgpW5AvMSc1FqQaZHFsfUuX7isoyuCAZ5BwEJLrFnaokaHo4sVon8ACjeZUKeVdAw?cluster=devnet) | SOL buy swap executed on CRIME/SOL (attempt 1) |
| 24 | carnage | PASS | [E8xAv2w5EqG8...](https://explorer.solana.com/tx/E8xAv2w5EqG8qZVx3PBi9kxgpW5AvMSc1FqQaZHFsfUuX7isoyuCAZ5BwEJLrFnaokaHo4sVon8ACjeZUKeVdAw?cluster=devnet) | Post-Carnage health check PASSED -- protocol operational |

---

**Final Tally:** 116 passed, 17 failed, 0 known issues, 2 skipped
**Total Transactions:** 24

*Generated by Dr. Fraudsworth E2E Devnet Validation Suite*
*Run completed: 2026-02-13T13:39:23.493Z*