#!/bin/bash
# =============================================================================
# Stage 7: Squads Governance Setup
#
# Creates 2-of-3 Squads multisig, transfers all program and admin authorities
# to the Squads vault PDA, and verifies the transfer. This is the LAST
# operational stage -- after this, the deployer wallet can no longer upgrade
# programs directly.
#
# Why AFTER launch (not before)? The deployer keeps control during the
# critical launch/graduation window for hot-fix capability. Authorities
# are transferred once trading is stable and verified.
#
# Prerequisites: Stage 6 passed (trading is live and stable)
# Estimated time: 5-10 minutes
# Estimated cost: ~0.05 SOL (multisig creation + authority transfer TXs)
#
# Usage:
#   ./scripts/deploy/stage-7-governance.sh devnet
#   ./scripts/deploy/stage-7-governance.sh mainnet
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
  echo "Usage: ./scripts/deploy/stage-7-governance.sh <devnet|mainnet>"
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
echo "  Stage 7: Governance ($CLUSTER)"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Mainnet Authority Transfer Warning
#
# Authority transfer is IRREVERSIBLE without multisig approval.
# After this, deployer can no longer upgrade programs unilaterally.
# ---------------------------------------------------------------------------
if [ "$CLUSTER" = "mainnet" ]; then
  echo "  ==========================================================="
  echo "  !!!  AUTHORITY TRANSFER IS IRREVERSIBLE                 !!!"
  echo "  !!!                                                      !!!"
  echo "  !!!  After this, only the 2-of-3 Squads multisig can   !!!"
  echo "  !!!  upgrade programs or change admin configs.           !!!"
  echo "  !!!  The deployer wallet loses all authority.            !!!"
  echo "  ==========================================================="
  echo ""
  read -p "  Type 'TRANSFER' to proceed: " CONFIRM
  if [ "$CONFIRM" != "TRANSFER" ]; then
    echo "  Governance setup aborted."
    exit 1
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Prerequisites Check
# ---------------------------------------------------------------------------
echo "  [Pre] Checking prerequisites..."

DEPLOYMENT_JSON="deployments/${CLUSTER}.json"
if [ ! -f "$DEPLOYMENT_JSON" ]; then
  echo "    FAIL: ${DEPLOYMENT_JSON} not found"
  exit 1
fi

# Check that trading is live (pools should exist in deployment.json)
HAS_POOLS=$(jq -r '.pools // empty' "$DEPLOYMENT_JSON" 2>/dev/null)
if [ -z "$HAS_POOLS" ]; then
  echo "    WARN: No pools found in deployment.json"
  echo "    Ensure Stage 6 (graduation) completed before governance setup."
fi

echo "    OK: deployment.json exists"
echo ""

# ---------------------------------------------------------------------------
# Action 1: Create Squads Multisig
#
# setup-squads.ts creates a 2-of-3 multisig with configurable timelock.
# Idempotent: skips creation if multisig already exists on-chain.
#
# > WARNING (Pitfall #12 - Squads TX Creator Must Be Member):
# > Use signer keypair (not deployer) as creator in vault TX creation.
# > Error 6005 (NotAMember) if deployer is used as creator.
#
# > WARNING (Pitfall #15 - BorshCoder snake_case): Always use snake_case
# > in Anchor instruction argument objects. camelCase silently encodes
# > zero bytes for pubkey fields.
# ---------------------------------------------------------------------------
echo "  [1/3] Creating Squads multisig..."
echo ""

npx tsx scripts/deploy/setup-squads.ts

echo ""
echo "    Multisig created/verified."
echo ""

# ---------------------------------------------------------------------------
# Action 2: Transfer All Authorities
#
# transfer-authority.ts transfers:
#   - 7 program upgrade authorities (BPFLoaderUpgradeable)
#   - 3 admin PDA authorities (AMM AdminConfig, WhitelistAuthority, BcAdminConfig)
#
# Idempotent: checks current authority before transferring, skips if already done.
# ---------------------------------------------------------------------------
echo "  [2/3] Transferring authorities to Squads vault..."
echo ""

npx tsx scripts/deploy/transfer-authority.ts

echo ""
echo "    Authority transfer complete."
echo ""

# ---------------------------------------------------------------------------
# Action 3: Verify Authorities
#
# verify-authority.ts confirms:
#   - 7 program upgrade authorities == Squads vault PDA
#   - 3 admin PDA authorities == Squads vault PDA
#   - Negative check: deployer cannot upgrade (expected failure)
# ---------------------------------------------------------------------------
echo "  [3/3] Verifying authority transfer..."
echo ""

npx tsx scripts/deploy/verify-authority.ts

echo ""
echo "    Authority verification complete."
echo ""

# ---------------------------------------------------------------------------
# GO/NO-GO Gate
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Stage 7: Governance RESULTS"
echo "========================================="
echo ""

# Display vault PDA from deployment.json
VAULT_PDA=$(jq -r '.squadsVault // "not found"' "$DEPLOYMENT_JSON" 2>/dev/null)
echo "  Squads Vault PDA: ${VAULT_PDA}"
echo ""
echo "  [x] 2-of-3 Squads multisig created"
echo "  [x] 7 program upgrade authorities transferred to vault"
echo "  [x] 3 admin PDA authorities transferred to vault"
echo "  [x] Deployer can no longer upgrade programs unilaterally"
echo ""

# ---------------------------------------------------------------------------
# Timelock Progression Schedule
# ---------------------------------------------------------------------------
echo "  TIMELOCK PROGRESSION SCHEDULE:"
echo "  ────────────────────────────────────────"
echo "    Launch:     300s (5 min) -- hot-fix window"
echo "    +1 week:    3600s (1 hr)"
echo "    +1 month:   86400s (24 hr)"
echo "    +3 months:  604800s (7 days)"
echo "    Post-audit: Burn upgrade authorities entirely"
echo "  ────────────────────────────────────────"
echo ""
echo "  For timelocked upgrades through Squads, see:"
echo "    Docs/mainnet-governance.md"
echo ""
echo "  ============================================="
echo "  STAGE 7: COMPLETE -- Governance established"
echo "  ============================================="
echo ""
echo "  All 8 stages complete. The protocol is fully operational"
echo "  with decentralized governance."
echo ""
