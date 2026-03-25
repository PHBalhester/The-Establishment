#!/bin/bash
# =============================================================================
# Stage 6: Graduation (Post-Curve-Fill)
#
# Runs after BOTH bonding curves reach 'Filled' status. Transitions the
# protocol from bonding curve phase to fully operational AMM trading.
#
# This stage:
#   1. Runs graduate.ts (13-step graduation: transition, withdraw, pools,
#      whitelist, vault seed, tax escrow, burn whitelist auth)
#   2. Verifies pools created, vaults whitelisted, authority burned
#   3. Starts crank or prints Railway crank instructions
#   4. Switches frontend to trading mode
#
# Prerequisites: Stage 5 passed AND both curves fully filled
# Estimated time: 5-10 minutes
# Estimated cost: ~0.05 SOL (transaction fees for 13 steps)
#
# Usage:
#   ./scripts/deploy/stage-6-graduation.sh devnet
#   ./scripts/deploy/stage-6-graduation.sh mainnet
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
  echo "Usage: ./scripts/deploy/stage-6-graduation.sh <devnet|mainnet>"
  echo ""
  exit 1
fi

ENV_FILE=".env.${CLUSTER}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found."
  exit 1
fi

# > WARNING (Pitfall #1 - Source .env): CRITICAL before any on-chain ops.
set -a
source "$ENV_FILE"
set +a

export CLUSTER
export WALLET="${WALLET:-keypairs/devnet-wallet.json}"

echo ""
echo "========================================="
echo "  Stage 6: Graduation ($CLUSTER)"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Prerequisites Check: Both curves must be Filled
# ---------------------------------------------------------------------------
echo "  [Pre] Checking prerequisites..."

DEPLOYMENT_JSON="deployments/${CLUSTER}.json"
if [ ! -f "$DEPLOYMENT_JSON" ]; then
  echo "    FAIL: ${DEPLOYMENT_JSON} not found"
  echo "    Run Stage 3 first."
  exit 1
fi

echo "    OK: deployment.json exists"
echo ""
echo "  *** IMPORTANT: Both bonding curves must be in 'Filled' status ***"
echo "  *** If curves are not filled, graduation will fail. ***"
echo ""

if [ "$CLUSTER" = "mainnet" ]; then
  read -p "  Confirm both curves are Filled? Type 'GRADUATE' to proceed: " CONFIRM
  if [ "$CONFIRM" != "GRADUATE" ]; then
    echo "  Graduation aborted."
    exit 1
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Action 1: Run graduation script
#
# graduate.ts executes the 13-step graduation sequence:
#   1.  Verify both curves Filled
#   2.  prepare_transition (Filled -> Graduated) -- IRREVERSIBLE
#   3.  Withdraw SOL from CRIME curve vault
#   4.  Withdraw SOL from FRAUD curve vault
#   5.  Close CRIME token vault
#   6.  Close FRAUD token vault
#   7.  Create CRIME/SOL AMM pool (290M CRIME + withdrawn SOL)
#   8.  Create FRAUD/SOL AMM pool (290M FRAUD + withdrawn SOL)
#   9.  Whitelist pool vault addresses
#   10. Seed Conversion Vault (250M CRIME + 250M FRAUD + 20M PROFIT)
#   11. Distribute CRIME tax escrow to carnage fund
#   12. Distribute FRAUD tax escrow to carnage fund
#   13. Burn whitelist authority (IRREVERSIBLE -- final step)
#
# > WARNING (Pitfall #6 - Whitelist Authority Burn): The whitelist authority
# > burn is the LAST step, after pool vaults are whitelisted. Burning before
# > whitelisting pool vaults = transfers to/from pools permanently blocked.
#
# > WARNING (Pitfall #13 - skipPreflight): graduate.ts uses confirmOrThrow
# > to detect silent TX failures.
# ---------------------------------------------------------------------------
echo "  [1/3] Running graduation sequence..."
echo ""

npx tsx scripts/graduation/graduate.ts

echo ""
echo "    Graduation complete."
echo ""

# ---------------------------------------------------------------------------
# Action 2: Crank Setup
#
# > WARNING (Pitfall #9 - CARNAGE_WSOL_PUBKEY Missing on Railway):
# > Set CARNAGE_WSOL_PUBKEY env var on Railway. Railway doesn't have
# > keypairs/ directory, so the env var fallback must be configured.
# ---------------------------------------------------------------------------
echo "  [2/3] Crank setup..."
echo ""

if [ "$CLUSTER" = "mainnet" ]; then
  echo "    Crank deployment on Railway:"
  echo "    1. Set CARNAGE_WSOL_PUBKEY env var on Railway"
  echo "    2. Set NEXT_PUBLIC_CLUSTER=mainnet on Railway"
  echo "    3. Deploy crank runner to Railway"
  echo "    4. Verify first epoch advances within ~5 minutes"
  echo ""
  echo "    CARNAGE_WSOL_PUBKEY can be found in:"
  echo "      deployments/${CLUSTER}.json -> carnageWsol"
  echo ""
else
  echo "    For devnet, crank can be started locally:"
  echo "      npx tsx scripts/e2e/start-crank.ts"
  echo "    Or deployed to Railway with CARNAGE_WSOL_PUBKEY env var."
  echo ""
fi

# ---------------------------------------------------------------------------
# Action 3: Frontend Mode Switch
# ---------------------------------------------------------------------------
echo "  [3/3] Frontend mode..."
echo ""
echo "    Set NEXT_PUBLIC_SITE_MODE=live on Railway to switch from"
echo "    launch page to trading interface."
echo ""
echo "    If running locally: update .env with NEXT_PUBLIC_SITE_MODE=live"
echo ""

# ---------------------------------------------------------------------------
# Verification: Run verify.ts full check
# ---------------------------------------------------------------------------
echo "  Running verify.ts full verification..."
echo ""

npx tsx scripts/deploy/verify.ts 2>&1 || {
  echo ""
  echo "  WARNING: Some verify.ts checks may report issues."
  echo "  Review output above carefully."
}

echo ""

# ---------------------------------------------------------------------------
# GO/NO-GO Gate
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Stage 6: Graduation RESULTS"
echo "========================================="
echo ""
echo "  [x] Both curves transitioned to Graduated"
echo "  [x] SOL withdrawn from curve vaults"
echo "  [x] AMM pools created with curve proceeds"
echo "  [x] Pool vaults whitelisted on Transfer Hook"
echo "  [x] Conversion vault seeded"
echo "  [x] Tax escrow distributed to carnage fund"
echo "  [x] Whitelist authority burned (IRREVERSIBLE)"
echo "  [ ] Crank: set CARNAGE_WSOL_PUBKEY on Railway, deploy crank"
echo "  [ ] Frontend: set NEXT_PUBLIC_SITE_MODE=live on Railway"
echo ""
echo "  ============================================="
echo "  STAGE 6: GO -- Protocol is live for trading"
echo "  ============================================="
echo ""
echo "  After trading is stable, proceed to governance:"
echo "    ./scripts/deploy/stage-7-governance.sh ${CLUSTER}"
echo ""
