#!/bin/bash
# =============================================================================
# Stage 4: Infrastructure Setup
#
# Creates Address Lookup Table, generates shared/constants.ts, syncs IDLs
# to the frontend directory. After this stage, the frontend can be deployed.
#
# Prerequisites: Stage 3 passed (mints and PDAs exist, deployment.json written)
# Estimated time: 1-2 minutes
# Estimated cost: ~0.01 SOL (ALT creation + extend transactions)
#
# Usage:
#   ./scripts/deploy/stage-4-infra.sh devnet
#   ./scripts/deploy/stage-4-infra.sh mainnet
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
  echo "Usage: ./scripts/deploy/stage-4-infra.sh <devnet|mainnet>"
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
echo "  Stage 4: Infrastructure ($CLUSTER)"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Prerequisites Check
# ---------------------------------------------------------------------------
echo "  [Pre] Checking prerequisites..."

DEPLOYMENT_JSON="deployments/${CLUSTER}.json"
if [ ! -f "$DEPLOYMENT_JSON" ]; then
  echo "    FAIL: ${DEPLOYMENT_JSON} not found"
  echo "    Run Stage 3 first: ./scripts/deploy/stage-3-initialize.sh ${CLUSTER}"
  exit 1
fi

echo "    OK: ${DEPLOYMENT_JSON} exists"
echo ""

# ---------------------------------------------------------------------------
# Action 1: Create/Extend Address Lookup Table
#
# The protocol ALT contains vault PDAs and program addresses needed for
# large transactions (sell path = 23+ accounts). Without ALT, sell
# transactions exceed the 1232-byte TX size limit.
# ---------------------------------------------------------------------------
echo "  [1/3] Creating/extending Address Lookup Table..."
echo ""

npx tsx scripts/deploy/create-alt.ts

echo ""
echo "    ALT created/extended."
echo ""

# ---------------------------------------------------------------------------
# Action 2: Generate Constants
#
# Reads deployments/{cluster}.json and writes shared/constants.ts.
# This file is consumed by the frontend, crank runner, and tests.
# It is the ONLY writer of constants.ts -- no manual edits.
# ---------------------------------------------------------------------------
echo "  [2/3] Generating shared/constants.ts..."
echo ""

npx tsx scripts/deploy/generate-constants.ts "$CLUSTER"

echo ""
echo "    Constants generated."
echo ""

# ---------------------------------------------------------------------------
# Action 3: Sync IDLs to Frontend
#
# > WARNING (Pitfall #5 - IDL Sync After Deploy): anchor build updates
# > target/idl/ but NOT app/idl/. Stale IDLs cause constraint errors
# > and wrong account layouts in frontend transactions.
# ---------------------------------------------------------------------------
echo "  [3/3] Syncing IDLs to frontend..."

# Create target directories if they don't exist
mkdir -p app/idl/types 2>/dev/null || true

# Copy IDL JSON files
if ls target/idl/*.json 1>/dev/null 2>&1; then
  cp target/idl/*.json app/idl/
  IDL_COUNT=$(ls target/idl/*.json | wc -l | tr -d ' ')
  echo "    Copied ${IDL_COUNT} IDL JSON files to app/idl/"
else
  echo "    WARN: No IDL JSON files found in target/idl/"
fi

# Copy TypeScript type files
if ls target/types/*.ts 1>/dev/null 2>&1; then
  cp target/types/*.ts app/idl/types/
  TYPES_COUNT=$(ls target/types/*.ts | wc -l | tr -d ' ')
  echo "    Copied ${TYPES_COUNT} TypeScript type files to app/idl/types/"
else
  echo "    WARN: No TypeScript type files found in target/types/"
fi

echo ""

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
echo "  Verification:"
echo "  ────────────────────────────────────────"

# Check constants.ts exists and has program IDs
VERIFY_PASSED=0
VERIFY_TOTAL=3

if [ -f "shared/constants.ts" ]; then
  if grep -qE "(AMM_PROGRAM_ID|PROGRAM_IDS)" shared/constants.ts; then
    echo "    [x] shared/constants.ts has program IDs"
    VERIFY_PASSED=$((VERIFY_PASSED + 1))
  else
    echo "    [ ] shared/constants.ts missing program IDs"
  fi
else
  echo "    [ ] shared/constants.ts not found"
fi

# Check ALT address in deployment.json or alt-address.json
if [ -f "scripts/deploy/alt-address.json" ]; then
  ALT_ADDR=$(cat scripts/deploy/alt-address.json | tr -d '"' | tr -d ' ')
  echo "    [x] ALT address: ${ALT_ADDR}"
  VERIFY_PASSED=$((VERIFY_PASSED + 1))
else
  echo "    [ ] ALT address file not found"
fi

# Check IDLs were copied
if [ -f "app/idl/amm.json" ]; then
  echo "    [x] IDLs synced to app/idl/"
  VERIFY_PASSED=$((VERIFY_PASSED + 1))
else
  echo "    [ ] IDLs not found in app/idl/"
fi

echo "  ────────────────────────────────────────"
echo ""

# ---------------------------------------------------------------------------
# GO/NO-GO Gate
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Stage 4: Infrastructure RESULTS"
echo "========================================="
echo ""
echo "  Verified: ${VERIFY_PASSED}/${VERIFY_TOTAL}"
echo ""

if [ "$VERIFY_PASSED" -lt "$VERIFY_TOTAL" ]; then
  echo "  ============================================="
  echo "  STAGE 4: NO-GO -- Some infrastructure incomplete"
  echo "  ============================================="
  exit 1
fi

echo "  [x] ALT created and extended"
echo "  [x] shared/constants.ts generated from deployment.json"
echo "  [x] IDLs synced to app/idl/"
echo ""
echo "  NOTE: Frontend deploy (Railway) is a manual step."
echo "  Update Railway env vars and redeploy after infrastructure is ready."
echo "  See Phase 98.1 for production infrastructure staging."
echo ""
echo "  ============================================="
echo "  STAGE 4: GO -- Infrastructure ready"
echo "  ============================================="
echo ""
echo "  Pre-deploy stages (0-4) are COMPLETE."
echo "  Everything above can be done days before launch."
echo ""
echo "  When ready to launch, run:"
echo "    ./scripts/deploy/stage-5-launch.sh ${CLUSTER}"
echo ""
