# Phase 94 Pathway 1 Test Report

**Date:** 2026-03-13
**Test timestamp:** 2026-03-13T22:09:33.031Z
**Result:** PASS (6/6 wallets passed)

## Deployment Addresses

| Component | Address |
|-----------|---------|
| Transfer Hook | `FnwnSxgieKBYogwD45KbwtpZMWsdzapg3VwkxTqiaihB` |
| Bonding Curve | `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1` |
| CRIME Mint | `4GMPFhVVxUVZPirn5FQ416yKTe2o7hzppyhKVSjBs71h` |
| FRAUD Mint | `EUduidMABqvtQTxHQ3y7uREAsBd9Dgck6SvMUnKKpXp6` |

## Wallet Actions

| Wallet | Curve | Action | SOL Amount | Token Amount | TX |
|--------|-------|--------|-----------|-------------|------|
| W1 | CRIME | buy | 0.003000000 | - | `5c1Vczqd...` |
| W2 | CRIME | buy | 0.050000000 | - | `4dZ4QnsY...` |
| W3 | FRAUD | buy | 0.100000000 | - | `5B9QJSFG...` |
| W4 | CRIME | buy | 0.020000000 | - | `3p4x2LaF...` |
| W4 | FRAUD | buy | 0.020000000 | - | `41gRsMCt...` |
| W5 | FRAUD | buy | 0.050000000 | - | `63CPp1eL...` |
| W5 | FRAUD | sell | - | 4215207391713 | `2CmTsctS...` |

## Curve State (Post-Consolidation)

| Curve | Tokens Sold | SOL Raised | Tax Collected | Refund Pool | Vault Balance |
|-------|------------|-----------|--------------|------------|--------------|
| CRIME | 30838197911409 | 0.273000000 | 0.015960711 | 0.182555975 | 0.183446855 |
| FRAUD | 35684740815060 | 0.320000000 | 0.018745010 | 0.213778287 | 0.214669167 |

## Refund Verification

| Wallet | Curve | Token Balance | Expected Refund (lam) | Actual Refund (lam) | Delta | Result |
|--------|-------|--------------|----------------------|--------------------|---------|----|
| W1 | CRIME | 545043875532 | 3226550 | 3226550 | 0 | **PASS** |
| W2 | CRIME | 8885491047112 | 52600333 | 52600333 | 0 | **PASS** |
| W3 | FRAUD | 18204448784579 | 109058263 | 109058263 | 0 | **PASS** |
| W4 | CRIME | 3455354234960 | 20455007 | 20455007 | 0 | **PASS** |
| W4 | FRAUD | 3462736837673 | 20744383 | 20744383 | 0 | **PASS** |
| W5 | FRAUD | 4215207391713 | 25252244 | 25252245 | 1 | **PASS** |

## Summary

- **Wallets tested:** 5
- **Refund claims verified:** 6
- **Passed:** 6/6
- **Total SOL refunded:** 0.231336781 SOL
- **Tolerance:** 1 lamport per claim (floor rounding)
- **Overall result:** **PASS**
