#!/bin/bash
# =============================================================================
# Stage 1: Build All Programs
#
# Compiles all 7 programs via build.sh, generates binary hashes, and performs
# binary address cross-validation (mainnet only).
#
# Prerequisites: Stage 0 passed (toolchain verified, env sourced, keypairs ready)
# Estimated time: 3-5 minutes (anchor build is the bottleneck)
# Estimated cost: 0 SOL (local compilation only)
#
# Usage:
#   ./scripts/deploy/stage-1-build.sh devnet
#   ./scripts/deploy/stage-1-build.sh mainnet
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
  echo "Usage: ./scripts/deploy/stage-1-build.sh <devnet|mainnet>"
  echo ""
  exit 1
fi

ENV_FILE=".env.${CLUSTER}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export CLUSTER
export WALLET="${WALLET:-keypairs/devnet-wallet.json}"

echo ""
echo "========================================="
echo "  Stage 1: Build ($CLUSTER)"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Prerequisites Check
#
# > WARNING (Pitfall #3 - Build Without Mint Keypairs): build.sh step [0b/4]
# > patches mint addresses from keypairs. If no keypairs exist, programs compile
# > with stale addresses. Stage 0 should have already created/copied them.
# ---------------------------------------------------------------------------
echo "  [Pre] Checking prerequisites..."

MINT_KEYPAIRS_DIR="scripts/deploy/mint-keypairs"
PREREQ_OK=true

for TOKEN in crime fraud profit; do
  if [ ! -f "$MINT_KEYPAIRS_DIR/${TOKEN}-mint.json" ]; then
    echo "    FAIL: Missing ${TOKEN} mint keypair at ${MINT_KEYPAIRS_DIR}/${TOKEN}-mint.json"
    echo "    Run Stage 0 first: ./scripts/deploy/stage-0-preflight.sh ${CLUSTER}"
    PREREQ_OK=false
  fi
done

if [ "$PREREQ_OK" = false ]; then
  echo ""
  echo "  Prerequisites not met. Run Stage 0 first."
  exit 1
fi

echo "    OK: Mint keypairs present"
echo ""

# ---------------------------------------------------------------------------
# Action 1: Build via build.sh
#
# > WARNING (Pitfall #4 - Feature-Flagged Build Split): 4 programs have
# > devnet/mainnet feature flags (tax, epoch, vault, bonding_curve).
# > build.sh handles this automatically with --devnet flag.
# ---------------------------------------------------------------------------
echo "  [1/3] Building all programs via build.sh..."
echo ""

BUILD_FLAGS=""
if [ "$CLUSTER" = "devnet" ]; then
  BUILD_FLAGS="--devnet"
  echo "    [devnet cluster -- building with --devnet flag]"
fi

bash scripts/deploy/build.sh $BUILD_FLAGS

echo ""
echo "    Build complete."
echo ""

# ---------------------------------------------------------------------------
# Action 2: Generate Binary Hashes
#
# Creates deployments/expected-hashes.{cluster}.json for preflight verification.
# These hashes can be signed off after review and compared before deploy.
# ---------------------------------------------------------------------------
echo "  [2/3] Generating binary hash manifest..."
echo ""

bash scripts/deploy/generate-hashes.sh "$CLUSTER"

echo ""

# ---------------------------------------------------------------------------
# Action 3: Binary Address Cross-Validation (mainnet only)
#
# > WARNING (Pitfall #8 - Devnet Addresses in Mainnet Binaries): Feature-flagged
# > programs compile mint addresses directly into .so binaries. If someone builds
# > for mainnet without mainnet mint keypairs, the binaries contain devnet
# > addresses. Deploying these = permanent wrong addresses in immutable code.
# ---------------------------------------------------------------------------
if [ "$CLUSTER" = "mainnet" ]; then
  echo "  [3/3] Cross-validating binary addresses (mainnet)..."

  DEVNET_CONFIG="deployments/devnet.json"
  if [ ! -f "$DEVNET_CONFIG" ]; then
    echo "    WARN: No devnet.json found, skipping binary address cross-check"
    echo "    (First-ever mainnet deploy? Proceed with caution)"
  else
    # Extract all base58 address strings from devnet.json
    DEVNET_ADDRS=$(jq -r '.. | strings' "$DEVNET_CONFIG" | grep -E '^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{32,44}$' | sort -u)

    # Only check feature-flagged programs that compile-in mint addresses
    FLAGGED_PROGRAMS="conversion_vault tax_program epoch_program bonding_curve"
    SO_DIR="target/deploy"
    FOUND_DEVNET=0

    for PROG in $FLAGGED_PROGRAMS; do
      SO_FILE="$SO_DIR/${PROG}.so"
      if [ ! -f "$SO_FILE" ]; then
        echo "    WARN: ${PROG}.so not found -- skipping"
        continue
      fi

      while IFS= read -r ADDR; do
        if grep -qF "$ADDR" "$SO_FILE"; then
          echo ""
          echo "    !!! ABORT: Devnet address found in mainnet binary !!!"
          echo "      Address: $ADDR"
          echo "      Program: ${PROG}.so"
          echo ""
          FOUND_DEVNET=1
        fi
      done <<< "$DEVNET_ADDRS"
    done

    if [ "$FOUND_DEVNET" -ne 0 ]; then
      echo "    Binary address verification FAILED."
      echo "    Did you rebuild with mainnet mint keypairs?"
      exit 1
    fi

    echo "    OK: No devnet addresses found in mainnet binaries"
  fi
else
  echo "  [3/3] Binary address cross-validation... (skipped on devnet)"
fi

echo ""

# ---------------------------------------------------------------------------
# Verification: Build Artifact Summary
# ---------------------------------------------------------------------------
echo "  Build Artifacts:"
echo "  ────────────────────────────────────────"

PROGRAMS=("amm" "transfer_hook" "tax_program" "epoch_program" "staking" "conversion_vault" "bonding_curve")
ALL_FOUND=true
for PROG in "${PROGRAMS[@]}"; do
  SO_FILE="target/deploy/${PROG}.so"
  if [ -f "$SO_FILE" ]; then
    SIZE=$(wc -c < "$SO_FILE" | tr -d ' ')
    SIZE_KB=$((SIZE / 1024))
    echo "    ${PROG}.so: ${SIZE_KB} KB"
  else
    echo "    ${PROG}.so: MISSING"
    ALL_FOUND=false
  fi
done

echo "  ────────────────────────────────────────"
echo ""

# ---------------------------------------------------------------------------
# GO/NO-GO Gate
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Stage 1: Build RESULTS"
echo "========================================="
echo ""

if [ "$ALL_FOUND" = false ]; then
  echo "  ============================================="
  echo "  STAGE 1: NO-GO -- Missing build artifacts"
  echo "  ============================================="
  exit 1
fi

echo "  [x] All 7 programs compiled successfully"
echo "  [x] Binary hash manifest generated"
if [ "$CLUSTER" = "mainnet" ]; then
  echo "  [x] No devnet addresses in mainnet binaries"
fi
echo ""
echo "  ============================================="
echo "  STAGE 1: GO -- Build complete"
echo "  ============================================="
echo ""
echo "  PROCEED TO STAGE 2? Run:"
echo "    ./scripts/deploy/stage-2-deploy.sh ${CLUSTER}"
echo ""
