#!/bin/bash
# =============================================================================
# Stage 0: Preflight Safety Checks
#
# Verifies the deployment environment is correctly configured before any
# on-chain operations. This is the "measure twice, cut once" gate.
#
# Checks:
#   - Toolchain versions (solana, anchor, rustc, node)
#   - Cluster .env file exists and has required vars
#   - Wallet balance above minimum threshold
#   - No keypair files staged in git
#   - Mint keypairs exist (mainnet: vanity keypairs, devnet: auto-generate)
#   - Binary hash comparison (if prior hashes exist)
#
# Prerequisites: None (this is the first stage)
# Estimated time: <1 minute
# Estimated cost: 0 SOL (read-only checks)
#
# Usage:
#   ./scripts/deploy/stage-0-preflight.sh devnet
#   ./scripts/deploy/stage-0-preflight.sh mainnet
# =============================================================================
set -e

# Source toolchain environments
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# cd to project root (two levels up from scripts/deploy/)
cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------
# Cluster Argument Validation
# ---------------------------------------------------------------------------
CLUSTER="${1:-}"
if [ -z "$CLUSTER" ] || { [ "$CLUSTER" != "devnet" ] && [ "$CLUSTER" != "mainnet" ]; }; then
  echo ""
  echo "Usage: ./scripts/deploy/stage-0-preflight.sh <devnet|mainnet>"
  echo ""
  exit 1
fi

# Source cluster env
ENV_FILE=".env.${CLUSTER}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found. Create it from .env.example."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export CLUSTER
export WALLET="${WALLET:-keypairs/devnet-wallet.json}"

echo ""
echo "========================================="
echo "  Stage 0: Preflight ($CLUSTER)"
echo "========================================="
echo ""

PREFLIGHT_PASSED=0
PREFLIGHT_TOTAL=0
PREFLIGHT_FAILURES=""

# ---------------------------------------------------------------------------
# Check 1: Toolchain Versions
#
# Why? Deploying with wrong versions causes silent corruption or hard-to-debug
# errors deep in the pipeline. Catch it here, not after burning 5 SOL.
# ---------------------------------------------------------------------------
echo "  [1/6] Checking toolchain versions..."

# Solana CLI: must be 3.x (Agave)
SOLANA_VERSION=$(solana --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
SOLANA_MAJOR=$(echo "$SOLANA_VERSION" | cut -d. -f1)
PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))
if [ -z "$SOLANA_MAJOR" ]; then
  echo "    FAIL: solana CLI not found"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - solana CLI not found\n"
elif [ "$SOLANA_MAJOR" -lt 3 ]; then
  echo "    FAIL: solana v${SOLANA_VERSION} (need v3.x Agave)"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - solana v${SOLANA_VERSION} too old (need v3.x)\n"
else
  echo "    OK: solana v${SOLANA_VERSION}"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# Anchor CLI: must be 0.32.x
ANCHOR_VERSION=$(anchor --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
ANCHOR_MINOR=$(echo "$ANCHOR_VERSION" | cut -d. -f2)
PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))
if [ -z "$ANCHOR_VERSION" ]; then
  echo "    FAIL: anchor CLI not found"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - anchor CLI not found\n"
elif [ "$ANCHOR_MINOR" != "32" ]; then
  echo "    WARN: anchor v${ANCHOR_VERSION} (expected 0.32.x)"
  # Warning only -- may still work
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
else
  echo "    OK: anchor v${ANCHOR_VERSION}"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# Rust: must be 1.79+
RUSTC_VERSION=$(rustc --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
RUSTC_MINOR=$(echo "$RUSTC_VERSION" | cut -d. -f2)
PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))
if [ -z "$RUSTC_VERSION" ]; then
  echo "    FAIL: rustc not found"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - rustc not found\n"
elif [ "$RUSTC_MINOR" -lt 79 ]; then
  echo "    FAIL: rustc v${RUSTC_VERSION} (need 1.79+)"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - rustc v${RUSTC_VERSION} too old (need 1.79+)\n"
else
  echo "    OK: rustc v${RUSTC_VERSION}"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# Node.js: must be 18+
NODE_VERSION=$(node --version 2>/dev/null | grep -oE '[0-9]+' | head -1)
PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))
if [ -z "$NODE_VERSION" ]; then
  echo "    FAIL: node not found"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - node not found\n"
elif [ "$NODE_VERSION" -lt 18 ]; then
  echo "    FAIL: node v${NODE_VERSION} (need v18+)"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - node v${NODE_VERSION} too old (need v18+)\n"
else
  echo "    OK: node v$(node --version 2>/dev/null)"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# ---------------------------------------------------------------------------
# Check 2: Environment Variables
#
# > WARNING (Pitfall #1 - Source .env): Pool seed amounts are env vars.
# > Missing them uses test defaults (10 SOL / 10K tokens). Pools CANNOT be
# > re-seeded -- requires full redeploy. Cost ~50 SOL on Phase 69.
# ---------------------------------------------------------------------------
echo ""
echo "  [2/6] Checking environment variables..."

REQUIRED_VARS="HELIUS_API_KEY CLUSTER_URL COMMITMENT"
MAINNET_EXTRA_VARS="DEPLOYER_KEYPAIR TREASURY_PUBKEY MAINNET_MIN_BALANCE"

MISSING_VARS=""
for VAR in $REQUIRED_VARS; do
  VAL=$(eval echo "\${${VAR}:-}")
  if [ -z "$VAL" ] || [ "$VAL" = "CHANGE_ME" ] || [ "$VAL" = "CHANGE_ME_MAINNET" ]; then
    MISSING_VARS="${MISSING_VARS}    - ${VAR}"
    if [ -z "$VAL" ]; then MISSING_VARS="${MISSING_VARS} (not set)"; else MISSING_VARS="${MISSING_VARS} (placeholder: ${VAL})"; fi
    MISSING_VARS="${MISSING_VARS}\n"
  fi
done

if [ "$CLUSTER" = "mainnet" ]; then
  for VAR in $MAINNET_EXTRA_VARS; do
    VAL=$(eval echo "\${${VAR}:-}")
    if [ -z "$VAL" ] || [ "$VAL" = "CHANGE_ME" ] || [ "$VAL" = "CHANGE_ME_MAINNET" ]; then
      MISSING_VARS="${MISSING_VARS}    - ${VAR}"
      if [ -z "$VAL" ]; then MISSING_VARS="${MISSING_VARS} (not set)"; else MISSING_VARS="${MISSING_VARS} (placeholder: ${VAL})"; fi
      MISSING_VARS="${MISSING_VARS}\n"
    fi
  done
fi

PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))
if [ -n "$MISSING_VARS" ]; then
  echo "    FAIL: Missing or placeholder env vars:"
  printf "$MISSING_VARS"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Missing env vars (see above)\n"
else
  echo "    OK: All required env vars present"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# ---------------------------------------------------------------------------
# Check 3: Wallet Balance
#
# Mainnet: Must have >= MAINNET_MIN_BALANCE (default 10 SOL)
# Devnet: Must have >= 26 SOL for full deploy (7 programs at 1.2x buffer ~25.5 SOL + init fees)
#         Phase 98-03 validation confirmed: deploy costs 25.54 SOL, init costs ~0.1 SOL.
# ---------------------------------------------------------------------------
echo ""
echo "  [3/6] Checking wallet balance..."

PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))
if [ ! -f "$WALLET" ]; then
  echo "    FAIL: Wallet file not found at $WALLET"
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Wallet file not found: $WALLET\n"
else
  WALLET_PUBKEY=$(solana-keygen pubkey "$WALLET" 2>/dev/null || echo "")
  echo "    Wallet: $WALLET_PUBKEY"

  if [ "$CLUSTER" = "mainnet" ]; then
    MIN_BALANCE="${MAINNET_MIN_BALANCE:-10}"

    # > WARNING (Pitfall #3 - Wallet sanity): Never use devnet wallet on mainnet
    if echo "$WALLET" | grep -qi "devnet"; then
      echo "    FAIL: Cannot use devnet wallet for mainnet deploy!"
      PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Devnet wallet used for mainnet\n"
    fi
  else
    MIN_BALANCE="26"
  fi

  BALANCE_OUTPUT=$(solana balance --keypair "$WALLET" --url "$CLUSTER_URL" 2>/dev/null || echo "ERROR")
  if [ "$BALANCE_OUTPUT" = "ERROR" ]; then
    echo "    FAIL: Could not query balance (RPC unreachable?)"
    PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Could not query wallet balance\n"
  else
    BALANCE=$(echo "$BALANCE_OUTPUT" | grep -oE '[0-9]+\.?[0-9]*' | head -1)
    SUFFICIENT=$(awk "BEGIN { print ($BALANCE >= $MIN_BALANCE) ? 1 : 0 }")
    if [ "$SUFFICIENT" -eq 0 ]; then
      echo "    FAIL: Balance ${BALANCE} SOL < minimum ${MIN_BALANCE} SOL"
      PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Insufficient balance: ${BALANCE} SOL (need ${MIN_BALANCE})\n"
    else
      echo "    OK: Balance ${BALANCE} SOL (minimum: ${MIN_BALANCE} SOL)"
      PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Check 4: No Keypair Files in Git Staging
#
# Why? Keypair JSON files contain private keys. If committed, they become
# permanent in git history. This check runs on BOTH clusters.
# ---------------------------------------------------------------------------
echo ""
echo "  [4/6] Checking for keypair files in git staging..."

PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || true)
STAGED_KEYPAIRS=""
if [ -n "$STAGED_FILES" ]; then
  KEYPAIRS_DIR_MATCHES=$(echo "$STAGED_FILES" | grep -E '^keypairs/.*\.json$' || true)
  PATTERN_MATCHES=$(echo "$STAGED_FILES" | grep -iE '(keypair|wallet|mint|deployer|mainnet).*\.json$' || true)
  STAGED_KEYPAIRS=$(printf '%s\n%s' "$KEYPAIRS_DIR_MATCHES" "$PATTERN_MATCHES" | sort -u | grep -v '^$' || true)
fi

if [ -n "$STAGED_KEYPAIRS" ]; then
  echo "    FAIL: Keypair files staged in git!"
  echo "$STAGED_KEYPAIRS" | while read -r F; do echo "      - $F"; done
  PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Keypair files staged in git\n"
else
  echo "    OK: No keypair files staged"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# ---------------------------------------------------------------------------
# Check 5: Mint Keypairs
#
# Mainnet: vanity mint keypairs must exist at keypairs/mainnet-*-mint.json
# Devnet: mint keypairs at scripts/deploy/mint-keypairs/ (auto-generate if missing)
#
# > WARNING (Pitfall #3 - Build Without Mint Keypairs): Programs compile with
# > stale/placeholder mint addresses if keypairs don't exist before build.
# > This causes InvalidMintPair (6002) during vault initialization.
# ---------------------------------------------------------------------------
echo ""
echo "  [5/6] Checking mint keypairs..."

MINT_KEYPAIRS_DIR="scripts/deploy/mint-keypairs"
PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))

if [ "$CLUSTER" = "mainnet" ]; then
  # Mainnet: check vanity mint keypairs exist
  MISSING_MINTS=""
  for TOKEN in crime fraud profit; do
    VANITY_FILE="keypairs/mainnet-${TOKEN}-mint.json"
    if [ ! -f "$VANITY_FILE" ]; then
      MISSING_MINTS="${MISSING_MINTS}    - ${VANITY_FILE}\n"
    else
      ADDR=$(solana-keygen pubkey "$VANITY_FILE" 2>/dev/null || echo "unknown")
      echo "    Mainnet ${TOKEN} mint: $ADDR"
    fi
  done

  if [ -n "$MISSING_MINTS" ]; then
    echo "    FAIL: Missing mainnet vanity mint keypairs:"
    printf "$MISSING_MINTS"
    echo "    Generate vanity keypairs before mainnet deploy."
    PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Missing mainnet vanity mint keypairs\n"
  else
    # Copy vanity keypairs to mint-keypairs/ so build.sh can find them
    mkdir -p "$MINT_KEYPAIRS_DIR"
    for TOKEN in crime fraud profit; do
      cp "keypairs/mainnet-${TOKEN}-mint.json" "$MINT_KEYPAIRS_DIR/${TOKEN}-mint.json"
    done
    echo "    OK: Mainnet vanity keypairs copied to ${MINT_KEYPAIRS_DIR}/"
    PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
  fi
else
  # Devnet: auto-generate if missing
  mkdir -p "$MINT_KEYPAIRS_DIR"
  GENERATED_ANY=false
  for TOKEN in crime fraud profit; do
    FILE="$MINT_KEYPAIRS_DIR/${TOKEN}-mint.json"
    if [ ! -f "$FILE" ]; then
      solana-keygen new --no-bip39-passphrase --silent -o "$FILE"
      ADDR=$(solana-keygen pubkey "$FILE")
      echo "    Generated ${TOKEN} mint keypair: $ADDR"
      GENERATED_ANY=true
    else
      ADDR=$(solana-keygen pubkey "$FILE")
      echo "    Existing ${TOKEN} mint keypair: $ADDR"
    fi
  done
  echo "    OK: Devnet mint keypairs ready"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# ---------------------------------------------------------------------------
# Check 6: Binary Hash Comparison (if prior hashes exist)
#
# > WARNING (Pitfall #8 - Devnet Addresses in Mainnet Binaries): Feature-flagged
# > programs have mint addresses compiled in. Building for mainnet without
# > mainnet mint keypairs bakes in devnet addresses.
# ---------------------------------------------------------------------------
echo ""
echo "  [6/6] Checking binary hashes..."

HASH_MANIFEST="deployments/expected-hashes.${CLUSTER}.json"
PREFLIGHT_TOTAL=$((PREFLIGHT_TOTAL + 1))

if [ ! -f "$HASH_MANIFEST" ]; then
  echo "    SKIP: No hash manifest found at ${HASH_MANIFEST}"
  echo "    (Will be generated during Stage 1 build)"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
elif [ "$CLUSTER" = "mainnet" ]; then
  # Mainnet: hash verification is mandatory
  HASH_MISMATCHES=""
  PROGRAM_NAMES=$(jq -r '.programs | keys[]' "$HASH_MANIFEST" 2>/dev/null || echo "")

  if [ -z "$PROGRAM_NAMES" ]; then
    echo "    FAIL: Could not parse hash manifest"
    PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Hash manifest parse error\n"
  else
    for PROG in $PROGRAM_NAMES; do
      SO_FILE="target/deploy/${PROG}.so"
      EXPECTED_HASH=$(jq -r ".programs[\"${PROG}\"]" "$HASH_MANIFEST")
      if [ ! -f "$SO_FILE" ]; then
        HASH_MISMATCHES="${HASH_MISMATCHES}    - ${PROG}: .so not found\n"
        continue
      fi
      ACTUAL_HASH=$(shasum -a 256 "$SO_FILE" | awk '{print $1}')
      if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
        HASH_MISMATCHES="${HASH_MISMATCHES}    - ${PROG}: hash mismatch\n"
      fi
    done

    if [ -n "$HASH_MISMATCHES" ]; then
      echo "    FAIL: Binary hash mismatches:"
      printf "$HASH_MISMATCHES"
      PREFLIGHT_FAILURES="${PREFLIGHT_FAILURES}    - Binary hash mismatches\n"
    else
      echo "    OK: All binary hashes match manifest"
      PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
    fi
  fi
else
  # Devnet: hash comparison is informational only
  echo "    INFO: Hash manifest exists, comparison is informational on devnet"
  PREFLIGHT_PASSED=$((PREFLIGHT_PASSED + 1))
fi

# ---------------------------------------------------------------------------
# GO/NO-GO Gate
# ---------------------------------------------------------------------------
echo ""
echo "========================================="
echo "  Stage 0: Preflight RESULTS"
echo "========================================="
echo ""
echo "  Checks passed: ${PREFLIGHT_PASSED}/${PREFLIGHT_TOTAL}"
echo ""

if [ "$PREFLIGHT_PASSED" -lt "$PREFLIGHT_TOTAL" ]; then
  echo "  Failures:"
  printf "$PREFLIGHT_FAILURES"
  echo ""
  echo "  ============================================="
  echo "  STAGE 0: NO-GO -- Fix issues above first"
  echo "  ============================================="
  echo ""
  exit 1
fi

echo "  ============================================="
echo "  STAGE 0: GO -- All preflight checks passed"
echo "  ============================================="
echo ""
echo "  PROCEED TO STAGE 1? Run:"
echo "    ./scripts/deploy/stage-1-build.sh ${CLUSTER}"
echo ""
