---
status: complete
phase: 94-bonding-curve-deadline-pathway-1
source: [94-01-SUMMARY.md, 94-02-PLAN.md]
started: 2026-03-13T22:10:00Z
updated: 2026-03-13T22:25:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Partial Deploy Pipeline
expected: deploy-all.sh devnet --partial builds only 2 programs, deploys, initializes curves with 30-min deadline, generates constants
result: pass

### 2. Buy Tokens on Both Curves
expected: Buying CRIME and FRAUD via frontend works. TX confirms, token balance updates, SOL deducted.
result: pass

### 3. Sell Tokens with 15% Tax
expected: Selling tokens via frontend works. 15% tax applied, net SOL returned. Sell form shows gross/tax/net breakdown.
result: pass

### 4. Gauges and Stats Update After TX
expected: Pressure gauge needles and Info tab stats (SOL Raised, Progress %) update within seconds after buy/sell without manual refresh.
result: pass

### 5. Net SOL Display (Sells Decrease Progress)
expected: After selling tokens, SOL Raised and progress bar decrease to reflect net SOL in vault (solRaised - solReturned), not gross total.
result: pass

### 6. Deadline Countdown Timer
expected: Countdown timer shows accurate time remaining, counts down in real-time, shows EXPIRED when deadline passes.
result: pass

### 7. Auto-Transition to Refund UI
expected: After mark_failed is called on-chain, frontend automatically transitions from BuySellPanel to RefundPanel within ~5 seconds (no manual refresh needed).
result: pass

### 8. Refund Panel Wallet Connect/Disconnect
expected: RefundPanel shows "Connect Wallet" button when disconnected. After connecting, shows truncated address with green dot and "Disconnect" option.
result: pass

### 9. Claim Refund + Solscan Link
expected: Clicking "Claim Refund" submits TX, shows "Claiming..." state, then "Refund Claimed!" with a clickable "View on Solscan" link that opens the correct TX on solscan.io with devnet cluster param.
result: pass

### 10. Automated Test Script (pathway1-test.ts)
expected: Script runs 5 test wallets through full lifecycle: buy/sell → wait for deadline → mark_failed → consolidate → claim refunds. All phases complete without errors.
result: pass

### 11. Refund Math Verification (verify-refunds.ts)
expected: Verification script confirms all refund amounts are mathematically correct (within 1 lamport tolerance). 6/6 checks pass.
result: pass

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
