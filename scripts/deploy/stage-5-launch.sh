#!/bin/bash
# =============================================================================
# Stage 5: PUBLIC LAUNCH
#
# =========================================================
# !!!        THIS IS THE PUBLIC LAUNCH MOMENT          !!!
# !!!  After this, bonding curves are LIVE for buying  !!!
# =========================================================
#
# Deploys bonding curve program, adds whitelist entries, initializes curves,
# and opens the launch page for public token sales.
# Everything before this stage can be done days in advance.
# This stage takes ~5 minutes and is the point of no return.
#
# Anti-sniper strategy: The bonding curve program is deliberately NOT deployed
# in Stage 2 (days before launch). Deploying it here minimizes the window for
# attackers to decompile the SBF bytecode and build sniping bots. No other
# program has a compile-time dependency on bonding_curve (verified in Phase 98).
#
# Prerequisites: Stage 4 passed (ALT, constants, IDLs ready)
# Estimated time: 5 minutes (deploy + init)
# Estimated cost: ~4.7 SOL (bonding curve program rent) + ~0.01 SOL (curve accounts)
#
# Usage:
#   ./scripts/deploy/stage-5-launch.sh devnet
#   ./scripts/deploy/stage-5-launch.sh mainnet
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
  echo "Usage: ./scripts/deploy/stage-5-launch.sh <devnet|mainnet>"
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
echo "========================================="
echo ""
echo "     STAGE 5: PUBLIC LAUNCH ($CLUSTER)"
echo ""
echo "========================================="
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Mainnet Launch Confirmation
#
# This is the most consequential action in the entire deployment pipeline.
# Bonding curves go live for public buying. There is no undo.
# ---------------------------------------------------------------------------
if [ "$CLUSTER" = "mainnet" ]; then
  echo "  ==========================================================="
  echo "  !!!  YOU ARE ABOUT TO OPEN BONDING CURVES ON MAINNET   !!!"
  echo "  !!!                                                     !!!"
  echo "  !!!  After this, anyone can buy tokens.                 !!!"
  echo "  !!!  Both curves will be open for the deadline period.  !!!"
  echo "  !!!  This action cannot be undone.                      !!!"
  echo "  ==========================================================="
  echo ""
  read -p "  Type 'LAUNCH' to proceed: " CONFIRM
  if [ "$CONFIRM" != "LAUNCH" ]; then
    echo ""
    echo "  Launch aborted."
    exit 1
  fi
  echo ""
  echo "  Launch confirmed. Proceeding..."
  echo ""
fi

# ---------------------------------------------------------------------------
# Prerequisites Check
# ---------------------------------------------------------------------------
echo "  [Pre] Checking prerequisites..."

PREREQ_OK=true

# Check deployment.json exists (Stage 3 output)
DEPLOYMENT_JSON="deployments/${CLUSTER}.json"
if [ ! -f "$DEPLOYMENT_JSON" ]; then
  echo "    FAIL: ${DEPLOYMENT_JSON} not found"
  PREREQ_OK=false
fi

# Check constants.ts exists (Stage 4 output)
if [ ! -f "shared/constants.ts" ]; then
  echo "    FAIL: shared/constants.ts not found"
  PREREQ_OK=false
fi

# Check ALT exists (Stage 4 output)
if [ ! -f "scripts/deploy/alt-address.json" ]; then
  echo "    FAIL: ALT address file not found"
  PREREQ_OK=false
fi

if [ "$PREREQ_OK" = false ]; then
  echo ""
  echo "  Prerequisites not met. Run Stage 4 first:"
  echo "    ./scripts/deploy/stage-4-infra.sh ${CLUSTER}"
  exit 1
fi

echo "    OK: All prerequisites met"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Deploy Bonding Curve Program (Anti-Sniper)
#
# The bonding curve is deliberately NOT deployed in Stage 2 (days before launch).
# Deploying it here minimizes the window for attackers to decompile the SBF
# bytecode and pre-build sniping bots. No other program depends on bonding_curve
# at compile time (verified in Phase 98 cross-reference audit).
#
# Cost: ~4.7 SOL (1.2x buffer rent)
# ---------------------------------------------------------------------------
echo "  [1/3] Deploying bonding curve program (anti-sniper: deferred from Stage 2)..."
echo ""

BC_KEYPAIR="keypairs/bonding-curve-keypair.json"
BC_BINARY="target/deploy/bonding_curve.so"

if [ ! -f "$BC_BINARY" ]; then
  echo "    FAIL: ${BC_BINARY} not found. Run Stage 1 first."
  exit 1
fi

if [ ! -f "$BC_KEYPAIR" ]; then
  echo "    FAIL: ${BC_KEYPAIR} not found."
  exit 1
fi

BC_PROG_ID=$(solana-keygen pubkey "$BC_KEYPAIR" 2>/dev/null)
BC_BINARY_SIZE=$(wc -c < "$BC_BINARY" | tr -d ' ')
BC_MAX_LEN=$(echo "$BC_BINARY_SIZE * 1.2 / 1" | bc)

BALANCE_BEFORE_BC=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null | awk '{print $1}')
echo "    Program ID: $BC_PROG_ID"
echo "    Binary size: $BC_BINARY_SIZE bytes (max-len: $BC_MAX_LEN at 1.2x)"
echo "    Balance before: ${BALANCE_BEFORE_BC} SOL"
echo ""

solana program deploy \
  "$BC_BINARY" \
  --program-id "$BC_KEYPAIR" \
  --keypair "$WALLET" \
  --url "$CLUSTER_URL" \
  --with-compute-unit-price 1 \
  --max-len "$BC_MAX_LEN"

BALANCE_AFTER_BC=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null | awk '{print $1}')
BC_COST=$(echo "$BALANCE_BEFORE_BC - $BALANCE_AFTER_BC" | bc)

echo ""
echo "    Bonding curve deployed. Cost: ${BC_COST} SOL"
echo ""

# Verify bonding curve is on-chain
BC_INFO=$(solana program show "$BC_PROG_ID" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null || echo "NOT_FOUND")
if echo "$BC_INFO" | grep -q "Program Id"; then
  BC_AUTHORITY=$(echo "$BC_INFO" | grep -i "Authority" | head -1 | awk '{print $NF}')
  echo "    OK: bonding_curve ($BC_PROG_ID)"
  echo "        Authority: ${BC_AUTHORITY}"
else
  echo "    FAIL: bonding_curve not found on-chain after deploy"
  exit 1
fi
echo ""

# ---------------------------------------------------------------------------
# Step 2: Initialize Bonding Curves (+ whitelist vaults)
#
# initialize.ts is idempotent — skips already-completed steps.
# At this point, steps 1-19 are already done (Stage 3). This picks up from:
#   Step 20: Whitelist CRIME curve token vault (transfer hook)
#   Step 21: Whitelist FRAUD curve token vault (transfer hook)
#   Step 22-23: Fund CRIME/FRAUD curves (BcAdminConfig + initialize_curve)
#
# The whitelist entries MUST happen before funding, because token transfers
# to the vaults go through the Transfer Hook which checks the whitelist.
#
# Curve parameters:
#   - Deadline: 48hr (mainnet) / ~30min (devnet with --features devnet)
#   - Price range: P_START to P_END (set by on-chain constants)
#   - Wallet cap: MAX_WALLET_TOKENS (prevents whale domination)
#   - Target: ~500 SOL total raised per curve
# ---------------------------------------------------------------------------
echo "  [2/3] Whitelisting curve vaults + initializing bonding curves..."
echo ""

npx tsx scripts/deploy/initialize.ts

echo ""
echo "    Bonding curves initialized."
echo ""

# ---------------------------------------------------------------------------
# Step 3: Verify bonding curve deployment and initialization
# ---------------------------------------------------------------------------
echo "  [3/3] Verifying bonding curve launch state..."
echo ""

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
echo "  Verification:"
echo "  ────────────────────────────────────────"

# Check that curve PDAs exist in deployment.json
if [ -f "$DEPLOYMENT_JSON" ]; then
  HAS_CURVES=$(jq -r '.curvePdas // empty' "$DEPLOYMENT_JSON" 2>/dev/null)
  if [ -n "$HAS_CURVES" ]; then
    CRIME_CURVE=$(jq -r '.curvePdas.crimeCurveState // "not found"' "$DEPLOYMENT_JSON" 2>/dev/null)
    FRAUD_CURVE=$(jq -r '.curvePdas.fraudCurveState // "not found"' "$DEPLOYMENT_JSON" 2>/dev/null)
    echo "    [x] CRIME curve: $CRIME_CURVE"
    echo "    [x] FRAUD curve: $FRAUD_CURVE"
  else
    echo "    [ ] Curve PDAs not found in deployment.json"
  fi
fi

echo "  ────────────────────────────────────────"
echo ""

# ---------------------------------------------------------------------------
# Post-Launch Monitoring Checklist
# ---------------------------------------------------------------------------
echo "========================================="
echo "  LAUNCH MONITORING CHECKLIST"
echo "========================================="
echo ""
echo "  The bonding curves are now LIVE. During the fill period:"
echo ""
echo "  [ ] Watch curve fill progress (frontend pressure gauges)"
echo "  [ ] Monitor for transaction errors in Sentry"
echo "  [ ] Check RPC health (Helius dashboard)"
echo "  [ ] Ensure frontend is accessible and responsive"
echo "  [ ] Have graduate.ts ready for when both curves fill"
echo "  [ ] Have rollback plan ready (refund path documented)"
echo ""
echo "  Set NEXT_PUBLIC_SITE_MODE=launch on Railway if not already done."
echo ""
echo "  When BOTH curves reach 'Filled' status, proceed to Stage 6:"
echo "    ./scripts/deploy/stage-6-graduation.sh ${CLUSTER}"
echo ""
echo "  ============================================="
echo "  STAGE 5: LAUNCHED -- Curves are live"
echo "  ============================================="
echo ""
