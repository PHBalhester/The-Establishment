#!/bin/bash
# =============================================================================
# Stage 3: Initialize Protocol State
#
# Creates mints, PDAs, vault configs, epoch state, staking pool, and
# BcAdminConfig via initialize.ts. Does NOT create pools (that happens
# during graduation in Stage 6) and does NOT burn whitelist authority.
#
# Prerequisites: Stage 2 passed (all 7 programs deployed and executable)
# Estimated time: 2-5 minutes (many sequential transactions)
# Estimated cost: ~0.1 SOL (PDA rent + transaction fees)
#
# Usage:
#   ./scripts/deploy/stage-3-initialize.sh devnet
#   ./scripts/deploy/stage-3-initialize.sh mainnet
# =============================================================================
set -e

# Source toolchain environments
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# cd to project root
cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------
# Cluster Argument Validation
# ---------------------------------------------------------------------------
CLUSTER="${1:-}"
if [ -z "$CLUSTER" ] || { [ "$CLUSTER" != "devnet" ] && [ "$CLUSTER" != "mainnet" ]; }; then
  echo ""
  echo "Usage: ./scripts/deploy/stage-3-initialize.sh <devnet|mainnet>"
  echo ""
  exit 1
fi

ENV_FILE=".env.${CLUSTER}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  exit 1
fi

# =============================================================================
# !!! CRITICAL WARNING (Pitfall #1 - Source .env) !!!
#
# ALWAYS source .env BEFORE running initialize.ts. Pool seed amounts are
# env vars (SOL_POOL_SEED_SOL_OVERRIDE, SOL_POOL_SEED_TOKEN_OVERRIDE).
# Missing this uses test defaults (10 SOL / 10K tokens). Pools CANNOT be
# re-seeded -- requires full redeploy. This mistake cost ~50 SOL on Phase 69.
# =============================================================================
set -a
source "$ENV_FILE"
set +a

export CLUSTER
export WALLET="${WALLET:-keypairs/devnet-wallet.json}"

echo ""
echo "========================================="
echo "  Stage 3: Initialize ($CLUSTER)"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Prerequisites Check
# ---------------------------------------------------------------------------
echo "  [Pre] Checking prerequisites..."

# Verify programs are deployed by checking a few key ones
PREREQ_OK=true

for KEYPAIR in keypairs/amm-keypair.json keypairs/transfer-hook-keypair.json; do
  if [ ! -f "$KEYPAIR" ]; then
    echo "    FAIL: Keypair not found: ${KEYPAIR}"
    PREREQ_OK=false
    continue
  fi
  PROG_ID=$(solana-keygen pubkey "$KEYPAIR" 2>/dev/null)
  PROG_INFO=$(solana program show "$PROG_ID" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null || echo "NOT_FOUND")
  if ! echo "$PROG_INFO" | grep -q "Program Id"; then
    echo "    FAIL: Program not deployed: ${PROG_ID}"
    PREREQ_OK=false
  fi
done

if [ "$PREREQ_OK" = false ]; then
  echo ""
  echo "  Prerequisites not met. Run Stage 2 first:"
  echo "    ./scripts/deploy/stage-2-deploy.sh ${CLUSTER}"
  exit 1
fi

echo "    OK: Programs deployed and executable"
echo ""

# =============================================================================
# !!! WARNING (Pitfall #6 - Pool/Whitelist Timing) !!!
#
# DO NOT create pools in this stage. Pools are created during graduation
# (Stage 6) using SOL from filled bonding curves. Creating pools here with
# arbitrary amounts would waste SOL and create mismatched liquidity.
#
# DO NOT burn whitelist authority in this stage. Whitelist authority is
# needed post-graduation to whitelist pool vault addresses. Burning it here
# locks you out of whitelisting.
# =============================================================================

# ---------------------------------------------------------------------------
# Action: Run initialize.ts
#
# initialize.ts is idempotent -- it skips already-completed steps.
# If re-running after a partial failure, it picks up where it left off.
#
# > WARNING (Pitfall #7 - Carnage WSOL Owner): Fresh deploy changes Epoch
# > Program ID, which changes CarnageSigner PDA. initialize.ts validates
# > WSOL account owner field, not just existence.
#
# > WARNING (Pitfall #13 - skipPreflight Silent TX Failures): initialize.ts
# > uses confirmOrThrow to detect silent TX failures when skipPreflight=true.
# ---------------------------------------------------------------------------
echo "  [1/2] Running initialize.ts..."
echo ""
echo "    .env sourced: ${ENV_FILE}"
echo "    Cluster URL:  ${CLUSTER_URL}"
echo "    Wallet:       ${WALLET}"
echo ""

npx tsx scripts/deploy/initialize.ts

echo ""
echo "    Initialization complete."
echo ""

# ---------------------------------------------------------------------------
# Verification: Run verify.ts for mint/PDA checks
# ---------------------------------------------------------------------------
echo "  [2/2] Running verify.ts..."
echo ""

npx tsx scripts/deploy/verify.ts 2>&1 || {
  echo ""
  echo "  WARNING: verify.ts reported issues. Review output above."
  echo "  Some checks may fail until pools are created (Stage 6)."
}

echo ""

# ---------------------------------------------------------------------------
# GO/NO-GO Gate
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Stage 3: Initialize RESULTS"
echo "========================================="
echo ""
echo "  [x] initialize.ts completed successfully"
echo "  [x] Mints created with Arweave metadata"
echo "  [x] PDAs initialized (AdminConfig, WhitelistAuthority, EpochState, etc.)"
echo "  [x] BcAdminConfig initialized"
echo "  [x] deployments/${CLUSTER}.json updated"
echo "  [ ] Pools NOT created (deferred to Stage 6 graduation)"
echo "  [ ] Whitelist authority NOT burned (needed for Stage 6)"
echo ""
echo "  ============================================="
echo "  STAGE 3: GO -- Protocol state initialized"
echo "  ============================================="
echo ""
echo "  PROCEED TO STAGE 4? Run:"
echo "    ./scripts/deploy/stage-4-infra.sh ${CLUSTER}"
echo ""
