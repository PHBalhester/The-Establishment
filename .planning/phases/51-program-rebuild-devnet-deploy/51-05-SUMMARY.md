# Phase 51 Plan 05: Deploy to Devnet & Initialize Protocol Summary

**One-liner:** All 5 programs deployed to devnet with fresh IDs, full protocol initialized (3 mints, 4 pools, staking, epoch, carnage, WSOL intermediary), new ALT generated (47 addresses), verify.ts 34/34 pass

## Deployment

| Program | New ID | Status |
|---------|--------|--------|
| AMM | 5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj | Executable |
| Transfer Hook | CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce | Executable |
| Tax Program | DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj | Executable |
| Epoch Program | G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz | Executable |
| Staking | EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu | Executable |

## Token Mints

| Token | Address |
|-------|---------|
| CRIME | F65o4zL6imL4g1HLuaqPaUg4K2eY8EPtGw4esD99XZhR |
| FRAUD | 83gSRtZCvA1n2h3wEqasadhk53haUFWCrsw6qDRRbuRQ |
| PROFIT | 8y7Mati78NNAn6YfGqiFeSP9mtnThkFL2AGwGpxmtZ11 |

## Protocol State

- 4 AMM pools: CRIME/SOL (~2 SOL LP), FRAUD/SOL (~2 SOL LP), CRIME/PROFIT, FRAUD/PROFIT
- Staking pool with dead stake
- Epoch state machine initialized
- Carnage fund: SOL vault + CRIME vault + FRAUD vault
- WSOL intermediary for sell tax extraction
- ALT: 4rW2yu8sJujQ7JUwUAom2UyYzhwpJQfJj7BLRucHzah6 (47 addresses)

## Cost

- Starting balance: ~52.6 SOL
- Ending balance: ~29.86 SOL
- Deployment cost: ~22.7 SOL

## Commits

- `575e840`: feat(51-05): deploy 5 programs to devnet and initialize protocol
- `22ed3a0`: feat(51-05): generate new ALT and update documentation

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Deploy 5 programs, initialize protocol | Done |
| 2 | Generate new ALT and update documentation | Done |
| 3 | Checkpoint: human verification | Approved |

## Verification

- verify.ts: 34/34 on-chain checks passed
- All 5 programs confirmed executable via `solana program show`
- ALT confirmed on-chain with 47 addresses
- pda-manifest.json regenerated with all new addresses
- shared/constants.ts updated with new MINTS
- Docs/mainnet-checklist.md updated with new devnet program IDs

## Deviations

None -- deployment proceeded as planned.
