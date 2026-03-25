# Focus Manifest: Token & Economic

## Core Patterns (always load)

### Token / SPL (EP-051-057)
- EP-051: Token Account Owner Mismatch (HIGH)
- EP-052: Native SOL Wrapping Confusion (MEDIUM)
- EP-053: Orphaned Token Account Rent Lock (LOW)
- EP-054: Token-2022 Transfer Fee Not Accounted (HIGH)
- EP-055: Token-2022 Transfer Hook Reentrancy (HIGH)
- EP-056: Token-2022 Confidential Transfer Bypass (MEDIUM)
- EP-057: Token-2022 Non-Transferable Bypass (MEDIUM)

### Economic / DeFi (EP-058-067)
- EP-058: Flash Loan Price Manipulation (CRITICAL)
- EP-059: Vault Donation / Inflation Attack (CRITICAL)
- EP-060: Missing Slippage Protection (HIGH)
- EP-061: Bonding Curve Instant Arbitrage (CRITICAL)
- EP-062: Reward Calculation Gaming (HIGH)
- EP-063: Interest Rate Manipulation (HIGH)
- EP-064: JIT Liquidity Extraction (MEDIUM)
- EP-065: Liquidation MEV (MEDIUM)
- EP-066: Governance Flash Loan Attack (CRITICAL)
- EP-067: Multi-Hop Price Impact Amplification (MEDIUM)

## Conditional (load if detected)
- Token-2022 extensions attack surface (Token-2022 detected)
- AMM/DEX attacks playbook (AMM detected)
- Staking attacks playbook (staking detected)
