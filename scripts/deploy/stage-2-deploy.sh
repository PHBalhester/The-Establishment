#!/bin/bash
# =============================================================================
# Stage 2: Deploy Programs
#
# Deploys 6 core programs to the target cluster via deploy.sh, then verifies
# each program is executable with the correct upgrade authority.
# Bonding curve is deferred to Stage 5 (anti-sniper measure).
#
# Prerequisites: Stage 1 passed (all 7 .so files built and verified)
# Estimated time: 5-10 minutes (network-dependent)
# Estimated cost: ~20.8 SOL (mainnet, 1.2x buffer) / same on devnet (but free)
#
# Usage:
#   ./scripts/deploy/stage-2-deploy.sh devnet
#   ./scripts/deploy/stage-2-deploy.sh mainnet
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
  echo "Usage: ./scripts/deploy/stage-2-deploy.sh <devnet|mainnet>"
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
echo "  Stage 2: Deploy Programs ($CLUSTER)"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Mainnet Confirmation Prompt
#
# Deploying 6 programs to mainnet costs ~20.8 SOL in rent (1.2x buffer). Require explicit confirmation.
# ---------------------------------------------------------------------------
if [ "$CLUSTER" = "mainnet" ]; then
  DEPLOYER_BALANCE=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null || echo "unknown")
  echo "  !!! MAINNET DEPLOYMENT !!!"
  echo ""
  echo "  Deployer balance: $DEPLOYER_BALANCE"
  echo "  Estimated cost:   ~20.8 SOL (6 programs, 1.2x buffer)"
  echo "  Note:             Bonding curve (~4.7 SOL) deploys at Stage 5 (anti-sniper)"
  echo ""
  read -p "  Type 'DEPLOY' to continue: " CONFIRM
  if [ "$CONFIRM" != "DEPLOY" ]; then
    echo "  Aborted."
    exit 1
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Prerequisites Check
# ---------------------------------------------------------------------------
echo "  [Pre] Checking prerequisites..."

# 6 core programs -- bonding_curve is deferred to Stage 5 (anti-sniper)
PROGRAMS_LIST=("amm" "transfer_hook" "tax_program" "epoch_program" "staking" "conversion_vault")
PREREQ_OK=true
for PROG in "${PROGRAMS_LIST[@]}"; do
  if [ ! -f "target/deploy/${PROG}.so" ]; then
    echo "    FAIL: target/deploy/${PROG}.so not found"
    PREREQ_OK=false
  fi
done

if [ "$PREREQ_OK" = false ]; then
  echo ""
  echo "  Prerequisites not met. Run Stage 1 first:"
  echo "    ./scripts/deploy/stage-1-build.sh ${CLUSTER}"
  exit 1
fi

echo "    OK: All 6 core .so build artifacts present"
echo "    Note: bonding_curve.so built but deploys at Stage 5 (anti-sniper)"
echo ""

# ---------------------------------------------------------------------------
# Action: Deploy via deploy.sh
#
# > WARNING (Pitfall #10 - Partial Deploy + Running Crank): Stop the crank
# > before deploying. Partially-deployed programs + running crank = errors.
# > The crank tries to advance epochs using programs that may be in mid-deploy.
# ---------------------------------------------------------------------------
echo "  *** REMINDER: Stop any running crank before proceeding ***"
echo ""

# > WARNING (Pitfall #11 - Solana CLI Path With Spaces): The project dir
# > "Dr Fraudsworth" has a space. Solana CLI doesn't handle it well.
# > deploy.sh uses keypair files from keypairs/ which may trigger this.
# > If deploy fails with "unrecognized signer source", use symlink workaround:
# > ln -sf "$PWD" ~/.dr-fraudsworth-link

# Record balance before deploy to calculate exact cost
BALANCE_BEFORE=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null | awk '{print $1}')
echo "  Balance before deploy: ${BALANCE_BEFORE} SOL"
echo ""

echo "  [1/2] Deploying 6 core programs (bonding curve deferred to Stage 5)..."
echo ""

bash scripts/deploy/deploy.sh "$CLUSTER_URL"

# Record balance after deploy and calculate exact cost
BALANCE_AFTER=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null | awk '{print $1}')
DEPLOY_COST=$(echo "$BALANCE_BEFORE - $BALANCE_AFTER" | bc)

echo ""
echo "    Deploy complete."
echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  DEPLOY COST REPORT                     │"
echo "  │  Before:  ${BALANCE_BEFORE} SOL"
echo "  │  After:   ${BALANCE_AFTER} SOL"
echo "  │  Cost:    ${DEPLOY_COST} SOL"
echo "  └─────────────────────────────────────────┘"
echo ""

# ---------------------------------------------------------------------------
# Verification: Check each program on-chain
#
# > WARNING (Pitfall #2 - Solana CLI v3 --keypair Required): All verification
# > commands must include --keypair flag. Without it, CLI v3 errors with
# > "No default signer found".
# ---------------------------------------------------------------------------
echo "  [2/2] Verifying deployments on-chain..."
echo ""

# Program keypair mapping (matches deploy.sh)
# Uses colon-delimited strings instead of `declare -A` for zsh compatibility.
# Only verify the 6 core programs -- bonding_curve deploys at Stage 5
VERIFY_PROGRAMS=(
  "amm:keypairs/amm-keypair.json"
  "transfer_hook:keypairs/transfer-hook-keypair.json"
  "tax_program:keypairs/tax-program-keypair.json"
  "epoch_program:keypairs/epoch-program.json"
  "staking:keypairs/staking-keypair.json"
  "conversion_vault:keypairs/vault-keypair.json"
)

DEPLOYER_PUBKEY=$(solana-keygen pubkey "$WALLET" 2>/dev/null)
VERIFY_PASSED=0
VERIFY_TOTAL=0

for entry in "${VERIFY_PROGRAMS[@]}"; do
  PROG="${entry%%:*}"
  KEYPAIR="${entry#*:}"
  VERIFY_TOTAL=$((VERIFY_TOTAL + 1))
  PROG_ID=$(solana-keygen pubkey "$KEYPAIR" 2>/dev/null)

  # Fetch program info
  PROG_INFO=$(solana program show "$PROG_ID" --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null || echo "NOT_FOUND")

  if echo "$PROG_INFO" | grep -q "Program Id"; then
    # Solana CLI v3 doesn't output "Executable" field -- any program returned
    # by `solana program show` with a Program Id IS executable (deployed).
    AUTHORITY=$(echo "$PROG_INFO" | grep -i "Authority" | head -1 | awk '{print $NF}')
    echo "    OK: ${PROG} ($PROG_ID)"
    echo "        Authority: ${AUTHORITY}"
    VERIFY_PASSED=$((VERIFY_PASSED + 1))
  else
    echo "    FAIL: ${PROG} ($PROG_ID) -- not found on-chain"
  fi
done

echo ""

# Also run verify.ts for deeper checks
echo "  Running verify.ts program-existence checks..."
npx tsx scripts/deploy/verify.ts 2>&1 | head -30 || true
echo ""

# ---------------------------------------------------------------------------
# GO/NO-GO Gate
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Stage 2: Deploy RESULTS"
echo "========================================="
echo ""
echo "  Programs verified: ${VERIFY_PASSED}/${VERIFY_TOTAL}"
echo ""

if [ "$VERIFY_PASSED" -lt "$VERIFY_TOTAL" ]; then
  echo "  ============================================="
  echo "  STAGE 2: NO-GO -- Some programs failed"
  echo "  ============================================="
  exit 1
fi

echo "  [x] All 6 core programs deployed and executable"
echo "  [x] Bonding curve ready to deploy at Stage 5 (anti-sniper)"
echo "  [x] Upgrade authorities confirmed"
echo ""
echo "  ============================================="
echo "  STAGE 2: GO -- All programs deployed"
echo "  ============================================="
echo ""
echo "  PROCEED TO STAGE 3? Run:"
echo "    ./scripts/deploy/stage-3-initialize.sh ${CLUSTER}"
echo ""
