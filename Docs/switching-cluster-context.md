# Switching Cluster Context: Devnet / Mainnet

## Overview

The codebase shares Rust source, build scripts, and keypairs between devnet and mainnet deployments. Several locations contain cluster-specific values (program IDs, mint addresses, treasury wallet) that MUST match the target cluster. Getting this wrong causes silent PDA mismatches (Anchor error 2006 ConstraintSeeds) at runtime.

This document is the single checklist for switching between clusters.

## Source of Truth

| Cluster | Program IDs | Mint Addresses |
|---------|-------------|----------------|
| Mainnet | `keypairs/*.json` | `scripts/deploy/mint-keypairs/*.json` |
| Devnet  | `deployments/devnet.json` | `deployments/devnet.json` |

## Switching to Devnet

Run in order. Each step depends on the previous.

### 1. Build Pipeline (handles most automatically)

```bash
./scripts/deploy/build.sh --devnet
```

This runs:
- **Step [0/4] `sync-program-ids.ts`** — patches `declare_id!()` macros from `keypairs/`. WARNING: This writes MAINNET IDs. For devnet, you must manually set devnet `declare_id!()` for any program you're deploying (see step 2).
- **Step [0b/4] `patch-mint-addresses.ts --devnet`** — reads from `deployments/devnet.json` instead of keypairs. Patches cross-program IDs and mint addresses correctly for devnet.
- **Step [1/4]** — builds feature-flagged programs with `--features devnet`.

### 2. Manual: `declare_id!()` for Programs Being Deployed

`sync-program-ids.ts` always writes mainnet IDs (reads from `keypairs/`). For any program you're deploying to devnet, manually set its `declare_id!()`:

| Program | File | Devnet ID |
|---------|------|-----------|
| AMM | `programs/amm/src/lib.rs` | `J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5` |
| Transfer Hook | `programs/transfer-hook/src/lib.rs` | `5X5STgDbSd7uTJDBx9BXd2NCED4WXqS5WVznM89YjMqj` |
| Tax Program | `programs/tax-program/src/lib.rs` | `FGgidfhNLwxhGHpyH7SoZdxAkAyQNXjA5o8ndV3LkG4W` |
| Epoch Program | `programs/epoch-program/src/lib.rs` | `E1u6fM9Pr3Pgbcz1NGq9KQzFbwD8F1uFkT3c9x1juA5h` |
| Staking | `programs/staking/src/lib.rs` | `DrFg87bRjNZUmE6FZw5oPL9zGsbpdrVHrxPHSibfZv1H` |
| Conversion Vault | `programs/conversion-vault/src/lib.rs` | `9SGsfhxHM7dA4xqApSHKj6c24Bp2rYyqHsti2bDdh263` |
| Bonding Curve | `programs/bonding_curve/src/lib.rs` | `HT3vw2LccPDEQLGVCoszSkLCSGLnjFLjWuaiAMC3qdzy` |

Then rebuild just that program: `anchor build -p {program_name} -- --features devnet`

### 3. Deploy to Devnet

```bash
solana program deploy target/deploy/{program}.so \
  --program-id {DEVNET_PROGRAM_ID} \
  --keypair keypairs/devnet-wallet.json \
  --url devnet
```

### 4. Frontend (if needed)

- Railway devnet service (`dr-fraudsworth-production.up.railway.app`) has `NEXT_PUBLIC_CLUSTER=devnet`
- `protocol-config.ts` resolves all addresses from `NEXT_PUBLIC_CLUSTER`
- Push to GitHub triggers Railway auto-deploy

## Switching Back to Mainnet

### 1. Restore Mainnet IDs

```bash
./scripts/deploy/build.sh
```

Without `--devnet`, the pipeline:
- `sync-program-ids.ts` writes mainnet IDs from `keypairs/` (including `declare_id!()`)
- `patch-mint-addresses.ts` writes mainnet addresses from keypairs
- `anchor build` compiles without `--features devnet` (mainnet code paths)

### 2. Verify Before Deploying

```bash
# Confirm declare_id matches mainnet
grep 'declare_id!' programs/tax-program/src/lib.rs
# Should show: 43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj

# Confirm cross-program IDs are mainnet
grep 'from_str' programs/tax-program/src/constants.rs
# epoch should be: 4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2
# amm should be:   5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR
# staking should:  12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH
```

### 3. Deploy to Mainnet

Uses Squads multisig (see `Docs/mainnet-governance.md`). NEVER use `--keypair` directly.

## Known Pitfalls

| Pitfall | What Happens | Prevention |
|---------|-------------|------------|
| `declare_id!()` has mainnet ID, deployed to devnet | `crate::ID` PDA derivations fail → ConstraintSeeds 2006 | Check `declare_id!` matches target cluster before deploy |
| `constants.rs` has mainnet cross-program IDs on devnet | External PDA derivations fail → ConstraintSeeds 2006 | Run `patch-mint-addresses.ts --devnet` before devnet builds |
| `keypairs/` contains mainnet keys | `sync-program-ids.ts` always writes mainnet IDs | Manual `declare_id!()` override for devnet programs |
| Forgot `--features devnet` | Feature-flagged programs use mainnet code paths (may `compile_error!()`) | Always use `build.sh --devnet` |
| Committed devnet IDs to source | Next mainnet build from dirty source has wrong IDs | `build.sh` patches fresh every time — but don't deploy from stale builds |

## Future Improvement

Extend `sync-program-ids.ts` to accept `--devnet` and read program IDs from `deployments/devnet.json` instead of `keypairs/`. This would eliminate the manual `declare_id!()` step entirely. Currently tracked as a systemic gap.
