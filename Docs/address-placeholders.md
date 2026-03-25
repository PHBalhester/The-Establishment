# Address Placeholder Tracking Document

> Updated as pages are rewritten. Post-Phase 100 sweep uses this to mechanically replace all placeholders.

## Known Mainnet Addresses (Final -- NOT Placeholders)

These vanity mint addresses are permanent and already used in documentation:

| Token | Address |
|-------|---------|
| CRIME | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` |
| FRAUD | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` |
| PROFIT | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` |

## Program ID Placeholders

These placeholders will be replaced with actual mainnet program IDs after Phase 100 deployment completes. Format: `<MAINNET_*_PROGRAM_ID>`.

| Placeholder | File | Line | Description |
|-------------|------|------|-------------|
| `<MAINNET_AMM_PROGRAM_ID>` | -- | -- | AMM (constant-product swap) program |
| `<MAINNET_HOOK_PROGRAM_ID>` | -- | -- | Transfer Hook (whitelist enforcement) program |
| `<MAINNET_TAX_PROGRAM_ID>` | -- | -- | Tax Program (71/24/5 distribution) |
| `<MAINNET_EPOCH_PROGRAM_ID>` | -- | -- | Epoch/VRF (randomness + Carnage) program |
| `<MAINNET_STAKING_PROGRAM_ID>` | -- | -- | Staking (PROFIT staking for SOL rewards) program |
| `<MAINNET_VAULT_PROGRAM_ID>` | -- | -- | Conversion Vault (100:1 faction-to-PROFIT) program |
| `<MAINNET_BONDING_CURVE_PROGRAM_ID>` | -- | -- | Bonding Curve (fair launch) program |

## Other Address Placeholders

| Placeholder | File | Line | Description |
|-------------|------|------|-------------|
| `<MAINNET_TREASURY_PUBKEY>` | -- | -- | Treasury wallet for 5% tax share |
| `<MAINNET_SQUADS_VAULT_PDA>` | -- | -- | Squads multisig vault PDA (holds all authorities) |
| `<MAINNET_SQUADS_MULTISIG_PDA>` | -- | -- | Squads multisig account PDA |

## Sweep Procedure

After Phase 100 deploys all programs to mainnet:

1. Get all program IDs from `deployments/mainnet.json`
2. Get Squads addresses from `deployments/mainnet.json`
3. Search all MDX files for `<MAINNET_` pattern: `grep -rn "MAINNET_" docs-site/content/`
4. Replace each placeholder with the actual address
5. Update this document to mark all placeholders as resolved
6. Commit and redeploy docs site

---

*Created: Phase 99, Plan 01*
*Last updated: 2026-03-16*
