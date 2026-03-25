# Mainnet Verified Build & IDL Upload Report

**Date:** 2026-03-25
**Phase:** 101 — Verified Builds, IDL Upload, security.txt
**CI Workflow Run:** 23513375419 (devnet, 43m21s)

---

## Program Upgrades (Wave 4)

All 6 active mainnet programs upgraded with CI-built verified binaries containing security.txt.

| Program | Program ID | Deploy Slot | Authority | Status |
|---------|-----------|-------------|-----------|--------|
| Staking | 12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH | 408743211 | 23g7x... (deployer) | PASS |
| Conversion Vault | 5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ | 408743355 | 23g7x... (deployer) | PASS |
| AMM | 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR | 408743617 | 23g7x... (deployer) | PASS |
| Transfer Hook | CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd | 408743743 | 23g7x... (deployer) | PASS |
| Epoch Program | 4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2 | 408743840 | 23g7x... (deployer) | PASS |
| Tax Program | 43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj | 408743935 | 23g7x... (deployer) | PASS |

**Bonding Curve:** Skipped — program account closed after graduation to reclaim rent.

**Upgrade cost:** ~0.013 SOL

### Verified Binary Hashes (CI Run 23513375419)

```json
{
  "amm": "cd702f2f46df9bde5935c76d66d8f7e48bd9f6fc1785ea0c7a068ff9b01bf942",
  "transfer_hook": "3f7a15965e09740b2abfb3debe944d9583265e6a61c95062ff89eafcbc8b16f0",
  "tax_program": "e391eca28fba744a7cc05838391e82ba88b9bc58afb810a563f3bcad5542ae28",
  "epoch_program": "5bb37c8694097a1b2339d2ed444521b4131cb7e4ac58aab8e7c67f4154ce2d90",
  "staking": "faa42c7b07c332eae3058327f18d444498ad72466ec151c836d6b9fe7587b3cc",
  "conversion_vault": "5c0280ea7ca5063411871072ff1bc1da6e89481b15b9b7016814427e991e7b1d",
  "bonding_curve": "531419465b56457c814ed86012dcee87835415bc905ecc0178639d86642f2aaa"
}
```

---

## IDL Uploads (Wave 5)

All 6 active mainnet programs have on-chain IDLs. Tested on Phase 102 devnet first.

| Program | Program ID | IDL Account | Authority | Status |
|---------|-----------|-------------|-----------|--------|
| Epoch Program | 4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2 | FEjnGmKi2eeSRuYd5RLgybFcx1jo8ciTGmF5KtZkHUie | 23g7x... (deployer) | PASS |
| Staking | 12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH | 5t8QEJf4t76o87WB2yuG4CUGhydJ1eyHd496xgpLf97D | 23g7x... (deployer) | PASS |
| Tax Program | 43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj | E8voK8TtWPTQdkhwy6ptssr635dJBQ2u25eemEpGzuTj | 23g7x... (deployer) | PASS |
| AMM | 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR | 38peLhENAdEwBg8w3cQn3YpM8D5WwVjaANqhioMsALDz | 23g7x... (deployer) | PASS |
| Transfer Hook | CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd | 9ijB6c51QcPTZHepaqB2mB8C9yTaDrdS6b58mJbMYGRT | 23g7x... (deployer) | PASS |
| Conversion Vault | 5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ | 5jM8A4AsYNWtHDm45d2sJkGJ77aFn3bS3uoLTg64y1Px | 23g7x... (deployer) | PASS |

**IDL upload cost:** ~0.38 SOL

---

## OtterSec Verification — DEFERRED

**Status:** Deferred
**Blocker:** Two issues prevent OtterSec verification at this time:

1. **Docker/QEMU failure on Apple Silicon:** `solana-verify verify-from-repo` fails locally with "Failed to get working directory: No such file or directory" when running x86 Docker containers via QEMU emulation on macOS ARM.

2. **Private repo:** OtterSec's remote verification service (`solana-verify remote submit-job`) requires cloning the repo from their servers. A private repo cannot be cloned by OtterSec's infrastructure.

**Attempted:** 2026-03-25 — `solana-verify verify-from-repo` with `--library-name amm` on commit d2d82cb. Repo cloned successfully (gh CLI authenticated) but Docker build failed.

**Future action:** Re-run OtterSec verification after repo goes public (post-external audit). The verified build hashes are recorded above for comparison.

**Note:** On-chain binary hashes are still independently verifiable by anyone via `solana-verify get-program-hash -u mainnet-beta <program_id>`. IDLs and security.txt are visible on explorers regardless of OtterSec status.

---

## Cost Summary

| Operation | Cost |
|-----------|------|
| Program upgrades (6) | ~0.013 SOL |
| IDL uploads (6) | ~0.382 SOL |
| **Total** | **~0.395 SOL** |

Deployer balance before: 7.633 SOL
Deployer balance after: 7.238 SOL
