#!/bin/bash
# =============================================================================
# Dr. Fraudsworth Full Deployment Orchestrator
#
# Runs the complete pre-deploy pipeline (Stages 0-4) in order.
# This is the single command to deploy the entire protocol from scratch.
#
# Stages (pre-deploy):
#   0. Preflight:         Toolchain checks, env validation, keypair safety
#   1. Build:             Compile all 7 programs, hash generation, binary check
#   2. Deploy:            Deploy all 7 programs to the target cluster
#   3. Initialize:        Create mints, PDAs, vault, staking, epoch, BcAdminConfig
#   4. Infrastructure:    ALT creation, constants generation, IDL sync
#
# Post-deploy stages (NOT run by deploy-all.sh -- run independently):
#   5. Launch:            Init bonding curves, open launch page (PUBLIC MOMENT)
#   6. Graduation:        Post-curve-fill: pools, whitelist, crank, burn auth
#   7. Governance:        Squads multisig, authority transfer, monitoring
#
# Why deploy-all.sh only runs stages 0-4?
#   - Stages 0-4 are the pre-deploy steps that can be done days before launch
#   - Stage 5 (launch) is deliberately separate -- it's the public launch moment
#   - Stages 6-7 happen post-launch and depend on external events (curves filling)
#
# Usage:
#   ./scripts/deploy/deploy-all.sh devnet
#   ./scripts/deploy/deploy-all.sh mainnet
#   ./scripts/deploy/deploy-all.sh devnet --partial   (Bonding Curve + Transfer Hook only)
#
# Exit codes:
#   0 = Full pre-deploy cycle completed successfully
#   1 = Any stage failed (set -e stops on first failure)
# =============================================================================
set -e

# Source toolchain environments
# These tools live in non-standard paths on macOS and must be sourced explicitly.
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# cd to project root (two levels up from scripts/deploy/)
cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------
# Cluster Argument (REQUIRED)
#
# Why require an explicit argument? Auto-detection from Solana CLI config is
# dangerous -- a stale `solana config set --url` could deploy to the wrong
# cluster. Requiring the operator to type "devnet" or "mainnet" is a simple
# gate that prevents catastrophic mis-deploys.
# ---------------------------------------------------------------------------
CLUSTER="${1:-}"

if [ -z "$CLUSTER" ] || { [ "$CLUSTER" != "devnet" ] && [ "$CLUSTER" != "mainnet" ]; }; then
  echo ""
  echo "Usage: ./scripts/deploy/deploy-all.sh <devnet|mainnet> [--partial]"
  echo ""
  echo "  devnet   - Deploy to Solana devnet (uses .env.devnet)"
  echo "  mainnet  - Deploy to Solana mainnet-beta (uses .env.mainnet)"
  echo ""
  echo "  --partial  Deploy only Transfer Hook + Bonding Curve (Pathway 1 testing)"
  echo ""
  echo "Runs stages 0-4 (pre-deploy). For launch/post-launch, run stage scripts individually:"
  echo "  Stage 5: ./scripts/deploy/stage-5-launch.sh <cluster>"
  echo "  Stage 6: ./scripts/deploy/stage-6-graduation.sh <cluster>"
  echo "  Stage 7: ./scripts/deploy/stage-7-governance.sh <cluster>"
  echo ""
  echo "No auto-detection. No positional URLs. Explicit cluster name only."
  echo ""
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse --partial flag from remaining arguments
#
# Why? Pathway 1 testing only needs the bonding curve + transfer hook
# programs deployed with CRIME/FRAUD mints. Partial deploy skips AMM, Tax,
# Epoch, Staking, Vault, and PROFIT mint -- saving time and SOL.
# ---------------------------------------------------------------------------
PARTIAL=false
for arg in "$@"; do
  if [ "$arg" = "--partial" ]; then
    PARTIAL=true
  fi
done

# ---------------------------------------------------------------------------
# Cluster-aware .env sourcing
#
# Source here so the environment is available for cluster URL cross-validation
# and mainnet confirmation prompt below. Stage scripts also source .env
# independently (they're designed to be self-contained).
# ---------------------------------------------------------------------------
ENV_FILE=".env.${CLUSTER}"
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo "ERROR: ${ENV_FILE} not found. Create it from .env.example."
  echo ""
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export CLUSTER
export WALLET="${WALLET:-keypairs/devnet-wallet.json}"

# ---------------------------------------------------------------------------
# Cross-validate cluster URL against target cluster
# ---------------------------------------------------------------------------
if [ "$CLUSTER" = "devnet" ]; then
  if echo "$CLUSTER_URL" | grep -qi "mainnet"; then
    echo ""
    echo "!!! CLUSTER MISMATCH !!!"
    echo "  Target: devnet, CLUSTER_URL contains 'mainnet': $CLUSTER_URL"
    exit 1
  fi
elif [ "$CLUSTER" = "mainnet" ]; then
  if echo "$CLUSTER_URL" | grep -qi "devnet"; then
    echo ""
    echo "!!! CLUSTER MISMATCH !!!"
    echo "  Target: mainnet, CLUSTER_URL contains 'devnet': $CLUSTER_URL"
    exit 1
  fi
fi

echo ""
if [ "$PARTIAL" = true ]; then
  echo "========================================="
  echo "  PARTIAL DEPLOY (Bonding Curve Only)"
  echo "  Programs: Transfer Hook, Bonding Curve"
  echo "  Mints: CRIME, FRAUD (no PROFIT)"
  echo "  Skipped: AMM, Tax, Epoch, Staking, Vault"
  echo "========================================="
else
  echo "========================================="
  echo "  Dr. Fraudsworth Full Deployment"
  echo "========================================="
fi
echo ""
echo "Cluster: $CLUSTER"
echo "RPC URL: $CLUSTER_URL"
echo "Wallet:  $WALLET"
echo ""

# ---------------------------------------------------------------------------
# Mainnet Confirmation Prompt
# ---------------------------------------------------------------------------
if [ "$CLUSTER" = "mainnet" ]; then
  echo "========================================="
  echo "  !!! MAINNET DEPLOYMENT !!!"
  echo "========================================="
  echo ""
  DEPLOYER_BALANCE=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null || echo "unknown")
  echo "  Deployer balance: $DEPLOYER_BALANCE"
  echo "  Estimated cost:   ~32 SOL (programs + accounts + rent + ops)"
  echo ""
  echo "  This will deploy ALL programs to Solana mainnet-beta."
  echo "  This action is difficult to reverse."
  echo ""
  read -p "  Type 'DEPLOY MAINNET' to continue: " CONFIRM
  if [ "$CONFIRM" != "DEPLOY MAINNET" ]; then
    echo ""
    echo "Aborted. Confirmation did not match."
    exit 1
  fi
  echo ""
  echo "  Mainnet deployment confirmed. Proceeding..."
  echo ""
fi

# ===========================================================================
# DEPLOY PIPELINE
#
# For full (non-partial) deploys, we call stage scripts sequentially.
# For partial deploys, we use inline logic (stage scripts are full-deploy only).
# ===========================================================================

if [ "$PARTIAL" = true ]; then
  # ---------------------------------------------------------------------------
  # PARTIAL DEPLOY PATH
  #
  # Partial deploy doesn't use stage scripts because it's a special-case
  # pipeline that only builds/deploys 2 programs. The inline logic here
  # handles this efficiently.
  # ---------------------------------------------------------------------------

  # --- Preflight (inline for partial) ---
  echo ""
  echo "========================================="
  echo "  Preflight Safety Checks (Partial)"
  echo "========================================="
  echo ""

  PREFLIGHT_FAILED=0

  # Check 1: No keypairs staged
  STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || true)
  STAGED_KEYPAIRS=""
  if [ -n "$STAGED_FILES" ]; then
    KEYPAIRS_DIR_MATCHES=$(echo "$STAGED_FILES" | grep -E '^keypairs/.*\.json$' || true)
    PATTERN_MATCHES=$(echo "$STAGED_FILES" | grep -iE '(keypair|wallet|mint|deployer|mainnet).*\.json$' || true)
    STAGED_KEYPAIRS=$(printf '%s\n%s' "$KEYPAIRS_DIR_MATCHES" "$PATTERN_MATCHES" | sort -u | grep -v '^$' || true)
  fi
  if [ -n "$STAGED_KEYPAIRS" ]; then
    echo "  PREFLIGHT FAILED: Keypair files staged in git!"
    PREFLIGHT_FAILED=1
  else
    echo "  [x] No keypair files staged"
  fi

  # Check 2: Required env vars
  for VAR in HELIUS_API_KEY CLUSTER_URL COMMITMENT; do
    VAL=$(eval echo "\${${VAR}:-}")
    if [ -z "$VAL" ] || [ "$VAL" = "CHANGE_ME" ] || [ "$VAL" = "CHANGE_ME_MAINNET" ]; then
      echo "  PREFLIGHT FAILED: ${VAR} missing or placeholder"
      PREFLIGHT_FAILED=1
    fi
  done
  if [ "$PREFLIGHT_FAILED" -eq 0 ]; then
    echo "  [x] Required env vars present"
  fi

  if [ "$PREFLIGHT_FAILED" -ne 0 ]; then
    echo ""
    echo "  PREFLIGHT FAILED -- Deploy aborted"
    exit 1
  fi
  echo ""

  # --- Phase 0: Mint Keypairs (partial: CRIME and FRAUD only) ---
  MINT_KEYPAIRS_DIR="scripts/deploy/mint-keypairs"
  MINT_NAMES="crime fraud"
  NEEDS_GENERATION=false
  for MINT_NAME in $MINT_NAMES; do
    if [ ! -f "$MINT_KEYPAIRS_DIR/${MINT_NAME}-mint.json" ]; then
      NEEDS_GENERATION=true
      break
    fi
  done

  if [ "$NEEDS_GENERATION" = true ]; then
    echo "========================================="
    echo "  Phase 0: Generate Mint Keypairs (Partial)"
    echo "========================================="
    mkdir -p "$MINT_KEYPAIRS_DIR"
    for MINT_NAME in $MINT_NAMES; do
      FILE="$MINT_KEYPAIRS_DIR/${MINT_NAME}-mint.json"
      if [ ! -f "$FILE" ]; then
        solana-keygen new --no-bip39-passphrase --silent -o "$FILE"
        ADDR=$(solana-keygen pubkey "$FILE")
        echo "  Generated ${MINT_NAME} mint keypair: $ADDR"
      else
        ADDR=$(solana-keygen pubkey "$FILE")
        echo "  Existing ${MINT_NAME} mint keypair: $ADDR"
      fi
    done
  else
    echo "  Mint keypairs already exist -- skipping generation"
  fi

  # --- Phase 1: Build (partial) ---
  echo ""
  echo "========================================="
  echo "  Phase 1: Build (Partial)"
  echo "========================================="
  BUILD_FLAGS="--partial"
  if [ "$CLUSTER" = "devnet" ]; then
    BUILD_FLAGS="$BUILD_FLAGS --devnet"
  fi
  bash scripts/deploy/build.sh $BUILD_FLAGS

  # --- Phase 2: Deploy (partial) ---
  echo ""
  echo "========================================="
  echo "  Phase 2: Deploy (Partial)"
  echo "========================================="
  for PROG in transfer_hook bonding_curve; do
    KEYPAIR_NAME=$(echo "$PROG" | tr '_' '-')
    KEYPAIR="keypairs/${KEYPAIR_NAME}-keypair.json"
    SO="target/deploy/${PROG}.so"
    echo "  Deploying ${PROG}..."
    solana program deploy "$SO" \
      --program-id "$KEYPAIR" \
      --url "$CLUSTER_URL" \
      --keypair "$WALLET" \
      --with-compute-unit-price 50000
  done
  echo "  Partial deploy complete."

  # --- Phase 3: Initialize (partial) ---
  echo ""
  echo "========================================="
  echo "  Phase 3: Initialize (Partial)"
  echo "========================================="
  PARTIAL_DEPLOY=true npx tsx scripts/deploy/initialize.ts

  # --- Phase 6: Verify (partial) ---
  echo ""
  echo "========================================="
  echo "  Phase 6: Verify (Partial)"
  echo "========================================="
  for PROG in transfer_hook bonding_curve; do
    KEYPAIR_NAME=$(echo "$PROG" | tr '_' '-')
    KEYPAIR="keypairs/${KEYPAIR_NAME}-keypair.json"
    PROG_ADDR=$(solana-keygen pubkey "$KEYPAIR")
    echo "  Checking $PROG ($PROG_ADDR)..."
    solana program show "$PROG_ADDR" --url "$CLUSTER_URL" > /dev/null 2>&1 && echo "    OK: deployed and executable" || echo "    WARNING: not found"
  done

  # --- Partial Completion ---
  echo ""
  echo "========================================="
  echo "  Partial Deployment Complete ($CLUSTER)"
  echo "========================================="
  echo ""
  echo "Deployed programs: Transfer Hook, Bonding Curve"
  echo "Deployed mints:    CRIME, FRAUD"
  echo "Skipped:           AMM, Tax, Epoch, Staking, Vault, PROFIT"

else
  # ---------------------------------------------------------------------------
  # FULL DEPLOY PATH -- Call stage scripts sequentially
  #
  # Each stage script is self-contained: sources env, validates prerequisites,
  # runs actions, verifies results, prints GO/NO-GO gate.
  # ---------------------------------------------------------------------------

  echo ""
  echo "========================================="
  echo "  Running Stage 0: Preflight"
  echo "========================================="
  bash scripts/deploy/stage-0-preflight.sh "$CLUSTER"

  echo ""
  echo "========================================="
  echo "  Running Stage 1: Build"
  echo "========================================="
  bash scripts/deploy/stage-1-build.sh "$CLUSTER"

  echo ""
  echo "========================================="
  echo "  Running Stage 2: Deploy"
  echo "========================================="
  bash scripts/deploy/stage-2-deploy.sh "$CLUSTER"

  echo ""
  echo "========================================="
  echo "  Running Stage 3: Initialize"
  echo "========================================="
  bash scripts/deploy/stage-3-initialize.sh "$CLUSTER"

  echo ""
  echo "========================================="
  echo "  Running Stage 4: Infrastructure"
  echo "========================================="
  bash scripts/deploy/stage-4-infra.sh "$CLUSTER"

  # --- Full Completion ---
  echo ""
  echo "========================================="
  echo "  Pre-Deploy Complete ($CLUSTER)"
  echo "========================================="
fi

echo ""
echo "Artifacts:"
echo "  Deployment:  deployments/${CLUSTER}.json"
echo "  Constants:   shared/constants.ts"
echo "  ALT:         scripts/deploy/alt-address.json"
echo "  Report:      scripts/deploy/deployment-report.md"
echo "  Manifest:    scripts/deploy/pda-manifest.md"
echo "  Tx Logs:     scripts/deploy/deploy-log-*.txt"
echo ""

if [ "$PARTIAL" != true ]; then
  echo "Pre-deploy stages (0-4) complete. Next steps:"
  echo ""
  echo "  When ready to launch:"
  echo "    ./scripts/deploy/stage-5-launch.sh ${CLUSTER}"
  echo ""
  echo "  After both curves fill:"
  echo "    ./scripts/deploy/stage-6-graduation.sh ${CLUSTER}"
  echo ""
  echo "  After trading is stable:"
  echo "    ./scripts/deploy/stage-7-governance.sh ${CLUSTER}"
  echo ""
fi
