#!/bin/bash
# =============================================================================
# Dr. Fraudsworth Build Script
#
# Compiles all 7 programs via `anchor build` and verifies the build artifacts
# and program ID consistency. Run this before deploy.sh to ensure everything
# is built correctly.
#
# Flags:
#   --devnet   Rebuild feature-flagged programs with devnet feature
#   --partial  Build only Transfer Hook + Bonding Curve (for Pathway 1 testing)
#
# Why a separate build script?
# - Build and deploy are independent operations (you might build locally
#   but deploy from CI, or rebuild without redeploying)
# - The verify-ids step catches ID mismatches BEFORE deployment, not after
# - Shell is the right tool for wrapping CLI commands (anchor build, npx tsx)
#
# Usage:
#   ./scripts/deploy/build.sh
#   ./scripts/deploy/build.sh --devnet
#   ./scripts/deploy/build.sh --partial --devnet
#
# Prerequisites:
#   - Rust toolchain installed (cargo, rustc)
#   - Anchor CLI installed (via AVM)
#   - Solana CLI installed
#   - Node.js + npm installed (for verify-ids)
#
# Exit codes:
#   0 = All steps passed
#   1 = Build failure, missing artifacts, or ID verification failed
# =============================================================================
set -e

# Source toolchain environments
# Why source each one? These tools live in non-standard paths on macOS.
# Without sourcing, cargo/anchor/solana/npx commands will fail silently.
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# cd to project root (one level up from scripts/deploy/)
# Why cd? anchor build must run from the project root where Anchor.toml lives.
cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------
# Parse flags (--devnet, --partial) from arguments in any order
# ---------------------------------------------------------------------------
DEVNET_FLAG=false
PARTIAL_FLAG=false

for arg in "$@"; do
  case "$arg" in
    --devnet)  DEVNET_FLAG=true ;;
    --partial) PARTIAL_FLAG=true ;;
  esac
done

echo ""
echo "=== Dr. Fraudsworth Build Script ==="
if [ "$PARTIAL_FLAG" = true ]; then
  echo "  [PARTIAL MODE: Transfer Hook + Bonding Curve only]"
fi
echo ""

# ---------------------------------------------------------------------------
# Step [0/4]: Sync program IDs from keypairs/ directory
#
# Reads all program keypairs from keypairs/ and patches:
#   - declare_id!() macros in each program's lib.rs
#   - Anchor.toml [programs.devnet] and [programs.localnet]
#   - Cross-program references (staking→tax, epoch→amm, amm→tax, etc.)
#   - Test assertions that verify program IDs
#   - target/deploy/ keypair copies
#
# Why before mint patching? Program IDs must be consistent before any build
# step. The mint patcher (step 0b) also reads program keypairs for cross-refs,
# so IDs must already be synced.
#
# Why this exists: Phase 95 devnet rehearsal discovered that regenerating
# keypairs required manually updating 20+ locations. Missing any one caused
# silent build/deploy/runtime failures. This script eliminates that risk.
# ---------------------------------------------------------------------------
echo "[0/4] Syncing program IDs from keypairs/..."
npx tsx scripts/deploy/sync-program-ids.ts
echo ""

# ---------------------------------------------------------------------------
# Step [0b/4]: Patch mint addresses in constants.rs files
#
# Reads keypairs from scripts/deploy/mint-keypairs/ and keypairs/ directories,
# patches hardcoded Pubkey::from_str("...") values in Rust constants.rs files.
# Must run BEFORE anchor build so the correct addresses are compiled in.
# ---------------------------------------------------------------------------
echo "[0b/4] Patching mint addresses in constants.rs files..."
if [ "$DEVNET_FLAG" = true ]; then
  # Devnet: read addresses from deployments/devnet.json (keypairs/ has mainnet keys)
  npx tsx scripts/deploy/patch-mint-addresses.ts --devnet
  echo "  done"
elif [ -d "scripts/deploy/mint-keypairs" ]; then
  # Mainnet: derive addresses from keypairs (existing behavior)
  npx tsx scripts/deploy/patch-mint-addresses.ts
  echo "  done"
else
  echo "  SKIP: No mint-keypairs directory (first deploy will create them)"
fi
echo ""

# ---------------------------------------------------------------------------
# Step [1/4]: Compile programs with anchor build
#
# Full mode: anchor build compiles all programs listed in Anchor.toml.
# Partial mode: Only builds transfer_hook and bonding_curve (Pathway 1).
# ---------------------------------------------------------------------------
if [ "$PARTIAL_FLAG" = true ]; then
  echo "[1/4] Building partial programs (transfer_hook + bonding_curve)..."
  if [ "$DEVNET_FLAG" = true ]; then
    # Devnet partial: bonding_curve's mainnet variant has compile_error! macros,
    # so we must build directly with devnet feature (skip the default build).
    echo "  [devnet] Building partial programs with devnet feature..."
    anchor build -p transfer_hook
    anchor build -p bonding_curve -- --features devnet
    echo "  [devnet] done"
  else
    anchor build -p transfer_hook
    anchor build -p bonding_curve
    echo "  done"
  fi
else
  if [ "$DEVNET_FLAG" = true ]; then
    # Devnet: Feature-flagged programs (tax_program, epoch_program, conversion_vault,
    # bonding_curve) have compile_error! guards in their mainnet code paths. Building
    # them without --features devnet fails. So we build non-flagged programs first,
    # then build the 4 flagged programs with devnet feature directly.
    echo "[1/4] Building all programs (devnet mode)..."
    echo "  Building non-feature-flagged programs..."
    anchor build -p amm
    anchor build -p transfer_hook
    anchor build -p staking
    echo "  Building feature-flagged programs with --features devnet..."
    anchor build -p epoch_program -- --features devnet
    anchor build -p tax_program -- --features devnet
    anchor build -p conversion_vault -- --features devnet
    anchor build -p bonding_curve -- --features devnet
    echo "  done"
  else
    # Mainnet: All programs build without feature flags (mainnet is the default path).
    echo "[1/4] Building all programs (anchor build)..."
    anchor build
    echo "  done"
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# Step [2/4]: Verify build artifacts exist
#
# Full mode: Check all 7 .so files.
# Partial mode: Check only transfer_hook.so and bonding_curve.so.
# ---------------------------------------------------------------------------
echo "[2/4] Checking build artifacts..."
if [ "$PARTIAL_FLAG" = true ]; then
  PROGRAMS=("transfer_hook" "bonding_curve")
else
  PROGRAMS=("amm" "transfer_hook" "tax_program" "epoch_program" "staking" "conversion_vault" "bonding_curve")
fi
ALL_FOUND=true

for prog in "${PROGRAMS[@]}"; do
  if [ ! -f "target/deploy/${prog}.so" ]; then
    echo "  ERROR: target/deploy/${prog}.so not found"
    ALL_FOUND=false
  else
    echo "  OK: ${prog}.so"
  fi
done

if [ "$ALL_FOUND" = false ]; then
  echo ""
  echo "ERROR: Missing build artifacts. Check anchor build output above."
  exit 1
fi
echo ""

# ---------------------------------------------------------------------------
# Step [3/4]: Verify program ID consistency
#
# Why verify IDs after build? anchor build generates keypairs in target/deploy/
# and updates IDL files. If someone modified a keypair or declare_id! macro
# without running `anchor keys sync`, the IDs will be inconsistent.
#
# verify-program-ids.ts checks 3 layers:
#   1. Keypair files (keypairs/*.json) -> derived pubkeys (source of truth)
#   2. declare_id! macros in lib.rs files
#   3. Anchor.toml [programs.localnet] and [programs.devnet]
# Plus cross-program references and placeholder detection.
#
# Partial mode: Skip this step -- verify-program-ids checks all 7 programs
# and may fail for unbuilt programs. The 2 partial programs' IDs are already
# verified by anchor build itself.
# ---------------------------------------------------------------------------
if [ "$PARTIAL_FLAG" = true ]; then
  echo "[3/4] Program ID verification... (skipped in partial mode)"
else
  echo "[3/4] Verifying program ID consistency..."
  if npx tsx scripts/verify-program-ids.ts; then
    echo "  All program IDs consistent"
  else
    echo ""
    echo "ERROR: Program ID verification failed."
    echo "Run 'npx tsx scripts/verify-program-ids.ts' for details."
    exit 1
  fi
fi

echo ""
echo "=== Build Complete ==="
echo ""
