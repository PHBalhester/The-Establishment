#!/bin/bash
# =============================================================================
# Dr. Fraudsworth Deploy Script
#
# Deploys 6 core programs to the target Solana cluster using canonical keypairs
# from the keypairs/ directory. Handles both fresh deploys and upgrades
# (solana program deploy does both natively).
#
# Why `solana program deploy` instead of `anchor deploy`?
# - `anchor deploy` generates NEW keypairs each time, deploying to random
#   addresses. Our declare_id! macros won't match.
# - `solana program deploy --program-id <keypair>` deploys to the deterministic
#   address derived from the keypair. Same command handles first deploy AND
#   upgrades (if the wallet is the upgrade authority).
#
# Program-to-keypair mapping (from Anchor.toml and keypairs/ directory):
#   amm            -> keypairs/amm-keypair.json
#   transfer_hook  -> keypairs/transfer-hook-keypair.json
#   tax_program    -> keypairs/tax-program-keypair.json
#   epoch_program  -> keypairs/epoch-program.json
#   staking        -> keypairs/staking-keypair.json
#   bonding_curve  -> keypairs/bonding-curve-keypair.json (deferred to Stage 5)
#
# Usage:
#   ./scripts/deploy/deploy.sh                              # localnet (default)
#   ./scripts/deploy/deploy.sh http://localhost:8899         # explicit localnet
#   ./scripts/deploy/deploy.sh https://api.devnet.solana.com # devnet
#   CLUSTER_URL=https://api.devnet.solana.com ./scripts/deploy/deploy.sh
#   WALLET=path/to/wallet.json ./scripts/deploy/deploy.sh   # custom wallet
#
# Prerequisites:
#   - Programs built (run build.sh first)
#   - Wallet with sufficient SOL (auto-airdrops on localnet/devnet if < 5 SOL)
#   - Target cluster accessible
#
# Exit codes:
#   0 = All programs deployed and verified
#   1 = Deploy or verification failure
# =============================================================================
set -e

# Source toolchain environments
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# cd to project root
cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------
# Configuration
#
# Accept cluster URL as first positional arg, env var, or default to localnet.
# Default to localnet for safety -- you have to explicitly target devnet/mainnet.
# ---------------------------------------------------------------------------
CLUSTER_URL="${1:-${CLUSTER_URL:-http://localhost:8899}}"
WALLET="${WALLET:-keypairs/devnet-wallet.json}"

echo ""
echo "=== Dr. Fraudsworth Deploy Script ==="
echo ""
echo "Cluster: $CLUSTER_URL"
echo "Wallet:  $WALLET"
echo ""

# ---------------------------------------------------------------------------
# Pre-flight: Check wallet exists
# ---------------------------------------------------------------------------
if [ ! -f "$WALLET" ]; then
  echo "ERROR: Wallet keypair not found at: $WALLET"
  echo "Create one with: solana-keygen new -o $WALLET"
  exit 1
fi

# ---------------------------------------------------------------------------
# Pre-flight: Check wallet balance
#
# Why check balance upfront? Deploying programs requires significant SOL
# for rent-exempt accounts (~20 SOL at 1.2x buffer). Better to fail early with
# a clear message than halfway through deployment.
# ---------------------------------------------------------------------------
echo "Checking wallet balance..."
BALANCE=$(solana balance --url "$CLUSTER_URL" --keypair "$WALLET" | awk '{print $1}')
echo "Wallet balance: $BALANCE SOL"
echo ""

# ---------------------------------------------------------------------------
# Auto-airdrop on localnet/devnet
#
# Why auto-airdrop? On localnet, SOL is free and unlimited. On devnet, it's
# rate-limited but harmless. This removes a manual step that trips up every
# first-time deployment. We skip this for mainnet URLs.
#
# Threshold: 5 SOL. Each program deploy costs ~1 SOL rent, plus we need
# SOL for init transactions. 5 SOL gives comfortable headroom.
# ---------------------------------------------------------------------------
if echo "$CLUSTER_URL" | grep -qE "(localhost|127\.0\.0\.1|devnet)"; then
  # Compare balance to threshold (integer comparison, truncate decimals)
  BALANCE_INT=$(echo "$BALANCE" | awk '{print int($1)}')
  if [ "$BALANCE_INT" -lt 5 ]; then
    echo "Balance below 5 SOL -- requesting airdrops..."
    ATTEMPTS=0
    MAX_ATTEMPTS=3
    while [ "$BALANCE_INT" -lt 5 ] && [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
      echo "  Requesting 2 SOL airdrop (attempt $((ATTEMPTS + 1))/$MAX_ATTEMPTS)..."
      if solana airdrop 2 --url "$CLUSTER_URL" --keypair "$WALLET" 2>/dev/null; then
        # Brief pause for airdrop to confirm
        sleep 2
        BALANCE=$(solana balance --url "$CLUSTER_URL" --keypair "$WALLET" | awk '{print $1}')
        BALANCE_INT=$(echo "$BALANCE" | awk '{print int($1)}')
        echo "  Balance now: $BALANCE SOL"
      else
        echo "  Airdrop failed (rate limited or unavailable)"
      fi
      ATTEMPTS=$((ATTEMPTS + 1))
    done

    if [ "$BALANCE_INT" -lt 5 ]; then
      echo "WARNING: Balance still below 5 SOL. Deploy may fail due to insufficient funds."
    fi
    echo ""
  fi
fi

# ---------------------------------------------------------------------------
# Deploy 6 core programs (bonding_curve is deferred to Stage 5: Launch)
#
# Why defer bonding_curve? Anti-sniper measure. If bonding_curve is deployed
# days before launch, attackers can decompile the SBF bytecode, analyze the
# curve parameters, and pre-build sniping bots. By deploying it at launch
# time (Stage 5), the window shrinks from days to minutes.
#
# No other program has a compile-time dependency on bonding_curve (verified
# in Phase 98 cross-reference audit), so this separation is safe.
#
# Program registry: name:keypair pairs.
# The keypair file determines the program's on-chain address. Using
# --program-id ensures deterministic deployment to the address matching
# our declare_id! macros and Anchor.toml entries.
#
# Note: epoch_program uses epoch-program.json (no -keypair suffix).
# This is a historical naming inconsistency that we preserve for compatibility.
# ---------------------------------------------------------------------------
PROGRAMS=(
  "amm:keypairs/amm-keypair.json"
  "transfer_hook:keypairs/transfer-hook-keypair.json"
  "tax_program:keypairs/tax-program-keypair.json"
  "epoch_program:keypairs/epoch-program.json"
  "staking:keypairs/staking-keypair.json"
  "conversion_vault:keypairs/vault-keypair.json"
)
# bonding_curve is deployed separately in stage-5-launch.sh (anti-sniper)

TOTAL=${#PROGRAMS[@]}
STEP=1

echo "Deploying $TOTAL programs..."
echo ""

for entry in "${PROGRAMS[@]}"; do
  IFS=':' read -r name keypair <<< "$entry"

  # Derive program ID from keypair for display
  PROGRAM_ID=$(solana-keygen pubkey "$keypair")

  echo "[$STEP/$TOTAL] Deploying $name ($PROGRAM_ID)..."

  # Check .so file exists before attempting deploy
  if [ ! -f "target/deploy/${name}.so" ]; then
    echo "  ERROR: target/deploy/${name}.so not found. Run build.sh first."
    exit 1
  fi

  # Calculate --max-len at 1.2x binary size (20% headroom for bug fixes/security patches).
  # Without --max-len, Solana CLI defaults to 2x binary size, wasting ~17 SOL on mainnet.
  # 1.2x is sufficient for fixes-only upgrades. If a larger change is ever needed,
  # close the program account (reclaim SOL), and redeploy with a bigger buffer.
  BINARY_SIZE=$(wc -c < "target/deploy/${name}.so" | tr -d ' ')
  MAX_LEN=$(echo "$BINARY_SIZE * 1.2 / 1" | bc)  # integer truncation of 1.2x

  # Deploy (or upgrade if already deployed by this wallet)
  # --with-compute-unit-price 1: Adds a minimal priority fee (1 microlamport per CU)
  # that helps transactions land reliably on rate-limited RPC providers like Helius
  # free tier (which rate-limits sendTransaction to 1/sec). Cost is negligible
  # (~0.0003 SOL per program) but significantly improves transaction landing rate.
  solana program deploy \
    "target/deploy/${name}.so" \
    --program-id "$keypair" \
    --keypair "$WALLET" \
    --url "$CLUSTER_URL" \
    --with-compute-unit-price 1 \
    --max-len "$MAX_LEN"

  echo "  done"
  echo ""
  STEP=$((STEP + 1))
done

# ---------------------------------------------------------------------------
# Post-deploy verification
#
# Why verify after deploy? Catches edge cases:
# - Deploy command succeeded but program isn't actually executable
# - Wrong program deployed to wrong address
# - Network issues caused silent failure
#
# `solana program show` returns non-zero if the program doesn't exist
# or isn't executable. We check each one explicitly.
# ---------------------------------------------------------------------------
echo "Verifying deployments..."

for entry in "${PROGRAMS[@]}"; do
  IFS=':' read -r name keypair <<< "$entry"
  PROGRAM_ID=$(solana-keygen pubkey "$keypair")

  if solana program show "$PROGRAM_ID" --url "$CLUSTER_URL" --keypair "$WALLET" > /dev/null 2>&1; then
    echo "  OK: $name ($PROGRAM_ID)"
  else
    echo "  ERROR: $name ($PROGRAM_ID) not deployed or not executable"
    exit 1
  fi
done

echo ""
echo "=== Deploy Complete ==="
echo ""
