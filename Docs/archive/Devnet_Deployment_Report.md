# Devnet Deployment Report

## Deployment Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-02-11 |
| **Cluster** | Solana Devnet |
| **RPC Endpoint** | Helius Free Tier (devnet) |
| **Commitment** | Finalized |
| **Deployer Wallet** | [`8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4`](https://explorer.solana.com/address/8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4?cluster=devnet) |
| **Total SOL Spent** | ~67.9 SOL (147.76 -> 79.85 remaining) |
| **Cost Breakdown** | ~12.8 SOL program rent + ~50 SOL seed liquidity (in pool vaults) + ~0.08 SOL protocol account rents + ~5 SOL deploy tx/priority fees |
| **Pipeline** | `scripts/deploy/deploy-all.sh` (build -> deploy -> initialize -> verify) |
| **Verification Result** | **34/34 checks passed** |

---

## Programs

All 5 programs deployed as BPF Loader Upgradeable. Upgrade authority is the devnet wallet (`8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4`).

| Program | Program ID | .so Size | Rent Cost | Explorer |
|---------|-----------|----------|-----------|----------|
| AMM | `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` | 421,936 bytes | 2.938 SOL | [View](https://explorer.solana.com/address/zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa?cluster=devnet) |
| Transfer Hook | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | 284,816 bytes | 1.984 SOL | [View](https://explorer.solana.com/address/9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ?cluster=devnet) |
| Tax Program | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | 332,344 bytes | 2.314 SOL | [View](https://explorer.solana.com/address/FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu?cluster=devnet) |
| Epoch Program | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | 430,632 bytes | 2.998 SOL | [View](https://explorer.solana.com/address/AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod?cluster=devnet) |
| Staking | `Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi` | 371,488 bytes | 2.587 SOL | [View](https://explorer.solana.com/address/Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi?cluster=devnet) |

**Combined program rent:** ~12.821 SOL

---

## Token Mints

All 3 mints created as Token-2022 (SPL Token Extensions) with Transfer Hook extensions pointing to the Transfer Hook program.

| Token | Mint Address | Decimals | Supply | Transfer Hook Program | Explorer |
|-------|-------------|----------|--------|----------------------|----------|
| CRIME | `6PyHbyUvxo5f6vKHpXWgy5HaFTCfMSDeXo9EQyKQqp7R` | 6 | 1,000,000,000 (1B) | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | [View](https://explorer.solana.com/address/6PyHbyUvxo5f6vKHpXWgy5HaFTCfMSDeXo9EQyKQqp7R?cluster=devnet) |
| FRAUD | `Bo9upPkGSYyAfaUBkxakHzbCxB9vWDKp23zPhzKZfiw2` | 6 | 1,000,000,000 (1B) | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | [View](https://explorer.solana.com/address/Bo9upPkGSYyAfaUBkxakHzbCxB9vWDKp23zPhzKZfiw2?cluster=devnet) |
| PROFIT | `J4CzJ5zgAV1dVLFtR3ZrvAMik6oZYQaTt9fKxeFvNvZP` | 6 | 1,000,000,000 (1B) | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | [View](https://explorer.solana.com/address/J4CzJ5zgAV1dVLFtR3ZrvAMik6oZYQaTt9fKxeFvNvZP?cluster=devnet) |

### ExtraAccountMetaLists

Each mint has an ExtraAccountMetaList that provides the Transfer Hook program with the accounts it needs during token transfers (whitelist authority PDA for checking whitelist status).

| Mint | ExtraAccountMetaList Address | Explorer |
|------|------------------------------|----------|
| CRIME | `6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN` | [View](https://explorer.solana.com/address/6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN?cluster=devnet) |
| FRAUD | `2F2jwmmTauKTFVqavR6wpX4QaprjY1jKqEEYyQnDwbR5` | [View](https://explorer.solana.com/address/2F2jwmmTauKTFVqavR6wpX4QaprjY1jKqEEYyQnDwbR5?cluster=devnet) |
| PROFIT | `HsMaeV3n1DnXRMoE7kXooz9f4Yx4CkdDGUkVPntSsAnq` | [View](https://explorer.solana.com/address/HsMaeV3n1DnXRMoE7kXooz9f4Yx4CkdDGUkVPntSsAnq?cluster=devnet) |

---

## AMM Pools

4 liquidity pools initialized with mainnet-accurate seed liquidity ratios. SOL pools use 25 SOL each (vs 1,000 SOL on mainnet). Token-pair pools maintain the exact mainnet token ratios.

### CRIME/SOL Pool

| Field | Value |
|-------|-------|
| **Pool PDA** | [`2QLDtSMSoEpjZxprGYWZkG35Uqrs4vUucMX2SZLXYUkD`](https://explorer.solana.com/address/2QLDtSMSoEpjZxprGYWZkG35Uqrs4vUucMX2SZLXYUkD?cluster=devnet) |
| **Mint A** | SOL (Native) |
| **Mint B** | CRIME (`6PyHbyUvxo5f6vKHpXWgy5HaFTCfMSDeXo9EQyKQqp7R`) |
| **Vault A (SOL)** | [`HfWKjQFa7KS4nd6hbWPaPuRBXtSBHWFLiGHcNbKyMtNQ`](https://explorer.solana.com/address/HfWKjQFa7KS4nd6hbWPaPuRBXtSBHWFLiGHcNbKyMtNQ?cluster=devnet) |
| **Vault B (CRIME)** | [`FYNMSt518YBcPaMsfukHB1cUbMY7jDhNy1spToGdVLgQ`](https://explorer.solana.com/address/FYNMSt518YBcPaMsfukHB1cUbMY7jDhNy1spToGdVLgQ?cluster=devnet) |
| **Reserve A** | 25,000,000,000 lamports (25 SOL) |
| **Reserve B** | 290,000,000,000,000 (290,000,000 CRIME) |
| **Fee Rate** | 30 bps (0.30%) |

### FRAUD/SOL Pool

| Field | Value |
|-------|-------|
| **Pool PDA** | [`45C8X2umXxRpRZfcecmSbAS4mBPnv9TYH8CkmVFVyd8F`](https://explorer.solana.com/address/45C8X2umXxRpRZfcecmSbAS4mBPnv9TYH8CkmVFVyd8F?cluster=devnet) |
| **Mint A** | SOL (Native) |
| **Mint B** | FRAUD (`Bo9upPkGSYyAfaUBkxakHzbCxB9vWDKp23zPhzKZfiw2`) |
| **Vault A (SOL)** | [`47cJSCbEMXcj93jTA9fgt4EaHraoB2xGoyoR3uUxBRkE`](https://explorer.solana.com/address/47cJSCbEMXcj93jTA9fgt4EaHraoB2xGoyoR3uUxBRkE?cluster=devnet) |
| **Vault B (FRAUD)** | [`3Tizyp2i73cVfX1KxuZdGHhiYT12JAZShMWeTrUNGKJy`](https://explorer.solana.com/address/3Tizyp2i73cVfX1KxuZdGHhiYT12JAZShMWeTrUNGKJy?cluster=devnet) |
| **Reserve A** | 25,000,000,000 lamports (25 SOL) |
| **Reserve B** | 290,000,000,000,000 (290,000,000 FRAUD) |
| **Fee Rate** | 30 bps (0.30%) |

### CRIME/PROFIT Pool

| Field | Value |
|-------|-------|
| **Pool PDA** | [`3SdF7yga5J45xqzAhFS4hUh8XsSPG3t7aB2yGiNCoP7g`](https://explorer.solana.com/address/3SdF7yga5J45xqzAhFS4hUh8XsSPG3t7aB2yGiNCoP7g?cluster=devnet) |
| **Mint A** | CRIME (`6PyHbyUvxo5f6vKHpXWgy5HaFTCfMSDeXo9EQyKQqp7R`) |
| **Mint B** | PROFIT (`J4CzJ5zgAV1dVLFtR3ZrvAMik6oZYQaTt9fKxeFvNvZP`) |
| **Vault A (CRIME)** | [`As31LmE4DvsrrfWVYDECDYywhYSVn9UAdSEY5YQMmeL2`](https://explorer.solana.com/address/As31LmE4DvsrrfWVYDECDYywhYSVn9UAdSEY5YQMmeL2?cluster=devnet) |
| **Vault B (PROFIT)** | [`CwwMTbAqQi5paaGbyoMY1cLfyZ9V9x2KKqhFQam9S9GP`](https://explorer.solana.com/address/CwwMTbAqQi5paaGbyoMY1cLfyZ9V9x2KKqhFQam9S9GP?cluster=devnet) |
| **Reserve A** | 250,000,000,000,000 (250,000,000 CRIME) |
| **Reserve B** | 25,000,000,000,000 (25,000,000 PROFIT) |
| **Fee Rate** | 30 bps (0.30%) |

### FRAUD/PROFIT Pool

| Field | Value |
|-------|-------|
| **Pool PDA** | [`7XifH7J2YWz4VWebwKEF1dT4p6U8tj49ZQm9RnFu5qX2`](https://explorer.solana.com/address/7XifH7J2YWz4VWebwKEF1dT4p6U8tj49ZQm9RnFu5qX2?cluster=devnet) |
| **Mint A** | FRAUD (`Bo9upPkGSYyAfaUBkxakHzbCxB9vWDKp23zPhzKZfiw2`) |
| **Mint B** | PROFIT (`J4CzJ5zgAV1dVLFtR3ZrvAMik6oZYQaTt9fKxeFvNvZP`) |
| **Vault A (FRAUD)** | [`FHY7sexK4FB3o2YGwGKoKQjf5gN8E67EevGpvJQ74e8V`](https://explorer.solana.com/address/FHY7sexK4FB3o2YGwGKoKQjf5gN8E67EevGpvJQ74e8V?cluster=devnet) |
| **Vault B (PROFIT)** | [`9deXCRx9uaCwh72UC2RgQW2HHxbFGABa3gNhQXMuxejm`](https://explorer.solana.com/address/9deXCRx9uaCwh72UC2RgQW2HHxbFGABa3gNhQXMuxejm?cluster=devnet) |
| **Reserve A** | 250,000,000,000,000 (250,000,000 FRAUD) |
| **Reserve B** | 25,000,000,000,000 (25,000,000 PROFIT) |
| **Fee Rate** | 30 bps (0.30%) |

---

## Protocol PDAs

### AMM PDAs

| PDA | Address | Program | Explorer |
|-----|---------|---------|----------|
| AdminConfig | `9ShRRky3q77BuwF8yzmUY2k5dk8WeZXhxMieWyhoy1JK` | AMM | [View](https://explorer.solana.com/address/9ShRRky3q77BuwF8yzmUY2k5dk8WeZXhxMieWyhoy1JK?cluster=devnet) |
| SwapAuthority | `G72jCQXEqxtPwLseNQ1xfwHkK7z7RfkMQRy6e1vXSRQg` | AMM | [View](https://explorer.solana.com/address/G72jCQXEqxtPwLseNQ1xfwHkK7z7RfkMQRy6e1vXSRQg?cluster=devnet) |

### Transfer Hook PDAs

| PDA | Address | Program | Explorer |
|-----|---------|---------|----------|
| WhitelistAuthority | `9htv99xwQeB2ykzqbzdWuJiPAwwDPjQ7gytBGRLbE9gi` | Transfer Hook | [View](https://explorer.solana.com/address/9htv99xwQeB2ykzqbzdWuJiPAwwDPjQ7gytBGRLbE9gi?cluster=devnet) |

### Tax Program PDAs

| PDA | Address | Program | Explorer |
|-----|---------|---------|----------|
| TaxAuthority | `8qAAFxs8kTW4RguCPZvMF5XXmvWXiDZqKDUaj3tihNLy` | Tax Program | [View](https://explorer.solana.com/address/8qAAFxs8kTW4RguCPZvMF5XXmvWXiDZqKDUaj3tihNLy?cluster=devnet) |

### Epoch Program PDAs

| PDA | Address | Program | Explorer |
|-----|---------|---------|----------|
| EpochState | `DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU` | Epoch Program | [View](https://explorer.solana.com/address/DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU?cluster=devnet) |
| CarnageFund | `2WUfRt7x2QKbFBuQoiQQ6Y5dmVJWSw93bobyaEhR1eKK` | Epoch Program | [View](https://explorer.solana.com/address/2WUfRt7x2QKbFBuQoiQQ6Y5dmVJWSw93bobyaEhR1eKK?cluster=devnet) |
| CarnageSolVault | `9q6Xd7VcTHHtN46qsE4hNZstPp1Bb4TDTjjgUgfPhFa1` | Epoch Program | [View](https://explorer.solana.com/address/9q6Xd7VcTHHtN46qsE4hNZstPp1Bb4TDTjjgUgfPhFa1?cluster=devnet) |
| CarnageCrimeVault | `6r5JjZPBQ19GGyCKvRLEsptakKVCFGPUNTcuQBD8kukG` | Epoch Program | [View](https://explorer.solana.com/address/6r5JjZPBQ19GGyCKvRLEsptakKVCFGPUNTcuQBD8kukG?cluster=devnet) |
| CarnageFraudVault | `BVu1bfsNe5Kfqppodu9oSCijGdTYAFsumsF1QJjUwBh3` | Epoch Program | [View](https://explorer.solana.com/address/BVu1bfsNe5Kfqppodu9oSCijGdTYAFsumsF1QJjUwBh3?cluster=devnet) |
| CarnageSigner | `7BZ9GgLoxZcRgeZg9ebunVvb5mdTQJTDViJahbLpYb2L` | Epoch Program | [View](https://explorer.solana.com/address/7BZ9GgLoxZcRgeZg9ebunVvb5mdTQJTDViJahbLpYb2L?cluster=devnet) |
| StakingAuthority | `8DuvdDRQA39vdTTSC6X25d29wX4tuCnihm7D62hr3p8p` | Epoch Program | [View](https://explorer.solana.com/address/8DuvdDRQA39vdTTSC6X25d29wX4tuCnihm7D62hr3p8p?cluster=devnet) |

### Staking PDAs

| PDA | Address | Program | Explorer |
|-----|---------|---------|----------|
| StakePool | `AL42AsVfBmCHsUMDynaR6h2yLktq1jB5FS65mz4H8GCf` | Staking | [View](https://explorer.solana.com/address/AL42AsVfBmCHsUMDynaR6h2yLktq1jB5FS65mz4H8GCf?cluster=devnet) |
| EscrowVault | `GzbZBkszg2rkgDLBCQ17YDT9YQeuF4R72fN7F44qjn8e` | Staking | [View](https://explorer.solana.com/address/GzbZBkszg2rkgDLBCQ17YDT9YQeuF4R72fN7F44qjn8e?cluster=devnet) |
| StakeVault | `P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc` | Staking | [View](https://explorer.solana.com/address/P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc?cluster=devnet) |

---

## Whitelist Entries

11 addresses whitelisted in the Transfer Hook program. The whitelist ensures that at least one party in every token transfer is a known protocol vault, preventing unauthorized transfers of the taxed tokens.

### Pool Vaults (8 entries)

| Pool | Vault | Whitelisted Address |
|------|-------|---------------------|
| CRIME/SOL | Vault A (SOL) | `HfWKjQFa7KS4nd6hbWPaPuRBXtSBHWFLiGHcNbKyMtNQ` |
| CRIME/SOL | Vault B (CRIME) | `FYNMSt518YBcPaMsfukHB1cUbMY7jDhNy1spToGdVLgQ` |
| FRAUD/SOL | Vault A (SOL) | `47cJSCbEMXcj93jTA9fgt4EaHraoB2xGoyoR3uUxBRkE` |
| FRAUD/SOL | Vault B (FRAUD) | `3Tizyp2i73cVfX1KxuZdGHhiYT12JAZShMWeTrUNGKJy` |
| CRIME/PROFIT | Vault A (CRIME) | `As31LmE4DvsrrfWVYDECDYywhYSVn9UAdSEY5YQMmeL2` |
| CRIME/PROFIT | Vault B (PROFIT) | `CwwMTbAqQi5paaGbyoMY1cLfyZ9V9x2KKqhFQam9S9GP` |
| FRAUD/PROFIT | Vault A (FRAUD) | `FHY7sexK4FB3o2YGwGKoKQjf5gN8E67EevGpvJQ74e8V` |
| FRAUD/PROFIT | Vault B (PROFIT) | `9deXCRx9uaCwh72UC2RgQW2HHxbFGABa3gNhQXMuxejm` |

### Protocol Vaults (3 entries)

| Vault | Whitelisted Address |
|-------|---------------------|
| StakeVault (PROFIT) | `P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc` |
| CarnageCrimeVault | `6r5JjZPBQ19GGyCKvRLEsptakKVCFGPUNTcuQBD8kukG` |
| CarnageFraudVault | `BVu1bfsNe5Kfqppodu9oSCijGdTYAFsumsF1QJjUwBh3` |

**Total whitelisted:** 11 addresses

---

## Verification Summary

Automated verification run by `scripts/deploy/verify.ts` on 2026-02-11. All 34 checks passed.

| Category | Checks | Status |
|----------|--------|--------|
| Programs | 5/5 deployed | All executable, BPF Loader Upgradeable |
| Mints | 3/3 created | decimals=6, supply=1B, T22=true, hookExt=true |
| Pools | 4/4 initialized | Correct reserves, canonical mint ordering |
| Protocol PDAs | 11/11 verified | All exist with data |
| Whitelist | 11/11 entries | All vault addresses whitelisted |
| **Total** | **34/34** | **ALL PASSED** |

### Full Verification Results

| Check | Address | Status | Details |
|-------|---------|--------|---------|
| AMM Program | `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` | OK | Deployed, executable, BPF Loader Upgradeable |
| TransferHook Program | `9UyWsQ6vMDXRfwmCm66hWpje8SPWRFDXneYb3EoPapAQ` | OK | Deployed, executable, BPF Loader Upgradeable |
| TaxProgram Program | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | OK | Deployed, executable, BPF Loader Upgradeable |
| EpochProgram Program | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | OK | Deployed, executable, BPF Loader Upgradeable |
| Staking Program | `Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi` | OK | Deployed, executable, BPF Loader Upgradeable |
| CRIME Mint | `6PyHbyUvxo5f6vKHpXWgy5HaFTCfMSDeXo9EQyKQqp7R` | OK | decimals=6, supply=1000000000000000, T22=true, hookExt=true |
| FRAUD Mint | `Bo9upPkGSYyAfaUBkxakHzbCxB9vWDKp23zPhzKZfiw2` | OK | decimals=6, supply=1000000000000000, T22=true, hookExt=true |
| PROFIT Mint | `J4CzJ5zgAV1dVLFtR3ZrvAMik6oZYQaTt9fKxeFvNvZP` | OK | decimals=6, supply=1000000000000000, T22=true, hookExt=true |
| WhitelistAuthority | `9htv99xwQeB2ykzqbzdWuJiPAwwDPjQ7gytBGRLbE9gi` | OK | Exists with data |
| ExtraAccountMetaList (CRIME) | `6bHUbk1XVzhq6udDRfoVnevSmyTjxzC7mSr2wNCXpkBN` | OK | Exists with data |
| ExtraAccountMetaList (FRAUD) | `2F2jwmmTauKTFVqavR6wpX4QaprjY1jKqEEYyQnDwbR5` | OK | Exists with data |
| ExtraAccountMetaList (PROFIT) | `HsMaeV3n1DnXRMoE7kXooz9f4Yx4CkdDGUkVPntSsAnq` | OK | Exists with data |
| AdminConfig | `9ShRRky3q77BuwF8yzmUY2k5dk8WeZXhxMieWyhoy1JK` | OK | Exists with data |
| Pool CRIME/SOL | `2QLDtSMSoEpjZxprGYWZkG35Uqrs4vUucMX2SZLXYUkD` | OK | reserveA=25000000000, reserveB=290000000000000 |
| Pool FRAUD/SOL | `45C8X2umXxRpRZfcecmSbAS4mBPnv9TYH8CkmVFVyd8F` | OK | reserveA=25000000000, reserveB=290000000000000 |
| Pool CRIME/PROFIT | `3SdF7yga5J45xqzAhFS4hUh8XsSPG3t7aB2yGiNCoP7g` | OK | reserveA=250000000000000, reserveB=25000000000000 |
| Pool FRAUD/PROFIT | `7XifH7J2YWz4VWebwKEF1dT4p6U8tj49ZQm9RnFu5qX2` | OK | reserveA=250000000000000, reserveB=25000000000000 |
| EpochState | `DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU` | OK | Exists with data |
| CarnageFund | `2WUfRt7x2QKbFBuQoiQQ6Y5dmVJWSw93bobyaEhR1eKK` | OK | Exists with data |
| CarnageSolVault | `9q6Xd7VcTHHtN46qsE4hNZstPp1Bb4TDTjjgUgfPhFa1` | OK | 890880 lamports |
| StakePool | `AL42AsVfBmCHsUMDynaR6h2yLktq1jB5FS65mz4H8GCf` | OK | Exists with data |
| StakeVault | `P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc` | OK | balance=1000000 |
| EscrowVault | `GzbZBkszg2rkgDLBCQ17YDT9YQeuF4R72fN7F44qjn8e` | OK | Exists, 890880 lamports |
| Whitelist: CRIME/SOL VaultA | OK | Whitelisted |
| Whitelist: CRIME/SOL VaultB | OK | Whitelisted |
| Whitelist: FRAUD/SOL VaultA | OK | Whitelisted |
| Whitelist: FRAUD/SOL VaultB | OK | Whitelisted |
| Whitelist: CRIME/PROFIT VaultA | OK | Whitelisted |
| Whitelist: CRIME/PROFIT VaultB | OK | Whitelisted |
| Whitelist: FRAUD/PROFIT VaultA | OK | Whitelisted |
| Whitelist: FRAUD/PROFIT VaultB | OK | Whitelisted |
| Whitelist: StakeVault | OK | Whitelisted |
| Whitelist: CarnageCrimeVault | OK | Whitelisted |
| Whitelist: CarnageFraudVault | OK | Whitelisted |

---

## Deployment Timeline

| Step | Duration | Details |
|------|----------|---------|
| Build | ~5 min | `anchor build` compiled all 5 programs |
| Deploy | ~25 min | 5 programs deployed with priority fee (1 microlamport/CU) via Helius |
| Initialize | ~5 min | 18 idempotent init steps (mints, hooks, pools, staking, epoch, whitelist) |
| Verify | ~1 min | 34/34 read-only checks against live devnet state |
| **Total** | **~36 min** | End-to-end pipeline execution |

---

## Notes

- **Programs are upgradeable** -- upgrade authority remains with the devnet wallet for iteration during Phases 35-36. Authorities will be burned before Phase 36 E2E testing to mirror production.
- **Mint/hook/whitelist authorities are NOT burned** -- these remain active for Phase 35 VRF integration and Phase 36 E2E testing.
- **Priority fee of 1 microlamport/CU** was added to deploy transactions to improve landing rate on Helius free tier (rate-limited to 1 tx/sec). Total priority fee cost was negligible (~0.001 SOL across all programs).
- **Dead stake of 1 PROFIT** (1,000,000 raw units) is deposited in the StakeVault to prevent the first-depositor attack on the Synthetix reward accumulator.
- **CarnageSolVault** holds rent-exempt minimum (890,880 lamports) -- tax deposits will accumulate here during live trading.

---

*Generated: 2026-02-11*
*Pipeline: scripts/deploy/deploy-all.sh*
*Verification: scripts/deploy/verify.ts*
*PDA Manifest: scripts/deploy/pda-manifest.json*
