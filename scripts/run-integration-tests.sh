#!/bin/bash
# Run integration tests with upgradeable programs.
#
# Multi-phase approach for comprehensive testing:
#
# PHASE 1a: Smoke tests (basic CPI chain validation)
#   - Start fresh validator with all 6 programs
#   - Run protocol init + smoke tests
#   - Dump EpochState for Phase 2 manipulation
#
# PHASE 2: Carnage tests (requires modified EpochState)
#   - Modify EpochState to set carnage_pending = true
#   - Restart validator with --account override for modified state
#   - Run Carnage-specific tests
#
# PHASE 3: CPI Chain Validation tests (all swap types + CU profiling)
#   - Fresh validator, independent of Phase 2
#
# PHASE 4: Access Control tests (negative authorization matrix)
#   - Fresh validator, tests all 6 CPI entry points reject unauthorized callers
#
# Unlike `anchor test` (which deploys programs as non-upgradeable via --bpf-program),
# this script starts a solana-test-validator with --upgradeable-program flags so that
# ProgramData.upgrade_authority_address is set. This is required for AMM's
# InitializeAdmin instruction which verifies the deployer's identity.
#
# Usage: ./scripts/run-integration-tests.sh
# Prerequisites: anchor build (programs must be compiled)

# NOTE: We do NOT use `set -e` because phases are independent.
# Each phase tracks its own exit code and failures are collected at the end.
# Only Phase 1a (smoke) is a hard prerequisite for Phase 2 (Carnage).
FAILURES=0

# Ensure tools are on PATH
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/opt/homebrew/bin:$PATH"

# Node 24+ needs ts-node/esm loader for TypeScript imports without .ts extensions
export NODE_OPTIONS="--loader ts-node/esm --no-warnings"

# Anchor provider env vars (normally set by `anchor test`)
export ANCHOR_PROVIDER_URL="http://localhost:8899"
export ANCHOR_WALLET="keypairs/devnet-wallet.json"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

WALLET="keypairs/devnet-wallet.json"
LEDGER_DIR=".anchor/test-ledger"

# Program IDs (must match Anchor.toml / declare_id! in each program)
AMM_ID="5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj"
HOOK_ID="CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce"
TAX_ID="DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj"
EPOCH_ID="G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz"
STAKING_ID="EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu"
VAULT_ID="6WwVAc12B5x8gukgNyXa4agUyvi9PxdYTdPdnb9qEWFL"

# Build vault with localnet feature (stores mints in state, not hardcoded).
# Integration tests create fresh random mints, so the vault can't use
# hardcoded devnet mint addresses. Localnet stores mints in VaultConfig state.
# NOTE: For devnet/mainnet deploy, rebuild with: anchor build -p conversion_vault -- --features devnet
echo "Building conversion_vault with localnet feature..."
anchor build -p conversion_vault -- --features localnet 2>&1 | grep -E "(Compiling|Finished|error)" || true

# Build tax_program with devnet feature so treasury_pubkey() returns the devnet
# wallet address (8kPzh...) instead of Pubkey::default(). Without this, all
# swap tests fail with InvalidTreasury.
echo "Building tax_program with devnet feature..."
anchor build -p tax_program -- --features devnet 2>&1 | grep -E "(Compiling|Finished|error)" || true

# Gate: required .so files must exist
if [ ! -f target/deploy/conversion_vault.so ]; then
  echo "ERROR: conversion_vault.so not found. Build failed."
  exit 1
fi
if [ ! -f target/deploy/tax_program.so ]; then
  echo "ERROR: tax_program.so not found. Build failed."
  exit 1
fi

# Common validator flags
PROGRAM_FLAGS="\
  --upgradeable-program $AMM_ID target/deploy/amm.so $WALLET \
  --upgradeable-program $HOOK_ID target/deploy/transfer_hook.so $WALLET \
  --upgradeable-program $TAX_ID target/deploy/tax_program.so $WALLET \
  --upgradeable-program $EPOCH_ID target/deploy/epoch_program.so $WALLET \
  --upgradeable-program $STAKING_ID target/deploy/staking.so $WALLET \
  --upgradeable-program $VAULT_ID target/deploy/conversion_vault.so $WALLET"

start_validator() {
  local extra_flags="$1"
  echo "Starting solana-test-validator..."

  # Kill any existing validator by PID and pattern
  if [ -n "$VALIDATOR_PID" ]; then
    kill $VALIDATOR_PID 2>/dev/null || true
    wait $VALIDATOR_PID 2>/dev/null || true
    VALIDATOR_PID=""
  fi
  pkill -f "solana-test-validator" 2>/dev/null || true
  sleep 2

  # Verify port is free
  while lsof -i :8899 >/dev/null 2>&1; do
    echo "Waiting for port 8899 to be free..."
    sleep 1
  done

  # Start validator in background. Use nohup + redirect to prevent shell signal propagation.
  nohup solana-test-validator \
    --reset \
    --ledger "$LEDGER_DIR" \
    --rpc-port 8899 \
    --upgradeable-program $AMM_ID target/deploy/amm.so $WALLET \
    --upgradeable-program $HOOK_ID target/deploy/transfer_hook.so $WALLET \
    --upgradeable-program $TAX_ID target/deploy/tax_program.so $WALLET \
    --upgradeable-program $EPOCH_ID target/deploy/epoch_program.so $WALLET \
    --upgradeable-program $STAKING_ID target/deploy/staking.so $WALLET \
    --upgradeable-program $VAULT_ID target/deploy/conversion_vault.so $WALLET \
    $extra_flags \
    --quiet > /dev/null 2>&1 &

  VALIDATOR_PID=$!
  disown $VALIDATOR_PID 2>/dev/null || true

  # Wait for validator to be ready (also wait for fees to stabilize)
  echo "Waiting for validator to start..."
  MAX_RETRIES=30
  for i in $(seq 1 $MAX_RETRIES); do
    if solana cluster-version --url http://localhost:8899 >/dev/null 2>&1; then
      echo "Waiting for fees to stabilize 1..."
      sleep 2
      echo "Waiting for fees to stabilize 2..."
      sleep 2
      echo "Validator ready (attempt $i)"
      return 0
    fi
    if [ $i -eq $MAX_RETRIES ]; then
      echo "ERROR: Validator failed to start after $MAX_RETRIES attempts"
      kill $VALIDATOR_PID 2>/dev/null
      return 1
    fi
    sleep 1
  done
}

stop_validator() {
  echo "Shutting down validator..."
  if [ -n "$VALIDATOR_PID" ]; then
    kill $VALIDATOR_PID 2>/dev/null || true
    wait $VALIDATOR_PID 2>/dev/null || true
    VALIDATOR_PID=""
  fi
  # Extra sleep to ensure port is released
  sleep 2
}

# ============================================================================
# PHASE 1a: Smoke tests
# ============================================================================

echo ""
echo "============================================"
echo "  PHASE 1a: Smoke Tests"
echo "============================================"
echo ""

# Clean ledger
rm -rf "$LEDGER_DIR"

start_validator ""

echo "Running Phase 1a tests (smoke)..."
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/integration/smoke.test.ts
PHASE1A_RESULT=$?

if [ $PHASE1A_RESULT -ne 0 ]; then
  echo "Phase 1a smoke tests FAILED (exit code: $PHASE1A_RESULT)"
  stop_validator
  exit $PHASE1A_RESULT
fi

echo "Phase 1a smoke tests PASSED"

# ============================================================================
# Prepare Carnage state: dump + modify EpochState
# ============================================================================

echo ""
echo "============================================"
echo "  Preparing Carnage State"
echo "============================================"
echo ""

echo "Dumping and modifying EpochState..."
npx ts-node --esm scripts/prepare-carnage-state.ts
PREPARE_RESULT=$?

if [ $PREPARE_RESULT -ne 0 ]; then
  echo "Carnage state preparation FAILED"
  stop_validator
  exit $PREPARE_RESULT
fi

# Read the EpochState PDA address from the JSON file for --account override
EPOCH_STATE_JSON=".anchor/carnage-epoch-state.json"
if [ ! -f "$EPOCH_STATE_JSON" ]; then
  echo "ERROR: carnage-epoch-state.json not generated"
  stop_validator
  exit 1
fi

# Extract pubkey from JSON (portable jq-free approach)
EPOCH_STATE_PDA=$(node -e "const j=require('./$EPOCH_STATE_JSON'); console.log(j.pubkey)")
echo "EpochState PDA: $EPOCH_STATE_PDA"

stop_validator

# ============================================================================
# PHASE 2: Carnage tests (with modified EpochState)
# Phase 2 runs right after Phase 1a because it depends on the dumped EpochState.
# ============================================================================

echo ""
echo "============================================"
echo "  PHASE 2: Carnage CPI Chain Tests"
echo "============================================"
echo ""

# Clean ledger for fresh start with overridden account
rm -rf "$LEDGER_DIR"

# Start validator with EpochState override
start_validator "--account $EPOCH_STATE_PDA $EPOCH_STATE_JSON"

echo "Running Phase 2 tests (Carnage depth-4 chain)..."
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/integration/carnage.test.ts
PHASE2_RESULT=$?

stop_validator

if [ $PHASE2_RESULT -ne 0 ]; then
  echo "Phase 2 Carnage tests FAILED (exit code: $PHASE2_RESULT)"
  FAILURES=$((FAILURES + 1))
else
  echo "Phase 2 Carnage tests PASSED"
fi

# ============================================================================
# PHASE 3: CPI Chain Validation tests (independent -- fresh validator)
# These tests are from a separate plan and run independently of Phase 2.
# ============================================================================

echo ""
echo "============================================"
echo "  PHASE 3: CPI Chain Validation Tests"
echo "============================================"
echo ""

# Clean ledger for fresh start -- each test file does its own initializeProtocol
rm -rf "$LEDGER_DIR"

start_validator ""

echo "Running Phase 3 tests (cpi-chains)..."
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/integration/cpi-chains.test.ts
PHASE3_RESULT=$?

stop_validator

if [ $PHASE3_RESULT -ne 0 ]; then
  echo "Phase 3 CPI chain tests FAILED (exit code: $PHASE3_RESULT)"
  FAILURES=$((FAILURES + 1))
else
  echo "Phase 3 CPI chain tests PASSED"
fi

# ============================================================================
# PHASE 4: Access Control tests (negative authorization matrix -- fresh validator)
# Tests CPI entry point rejection for all 5 protected instructions.
# ============================================================================

echo ""
echo "============================================"
echo "  PHASE 4: Access Control Tests"
echo "============================================"
echo ""

# Clean ledger for fresh start -- access-control.test.ts does its own initializeProtocol
rm -rf "$LEDGER_DIR"

start_validator ""

echo "Running Phase 4 tests (access-control)..."
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/integration/access-control.test.ts
PHASE4_RESULT=$?

stop_validator

if [ $PHASE4_RESULT -ne 0 ]; then
  echo "Phase 4 Access Control tests FAILED (exit code: $PHASE4_RESULT)"
  FAILURES=$((FAILURES + 1))
else
  echo "Phase 4 Access Control tests PASSED"
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "============================================"
echo "  Test Results Summary"
echo "============================================"
echo ""
echo "  Phase 1a (Smoke):        PASSED"
echo "  Phase 2  (Carnage):      $([ $PHASE2_RESULT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo "  Phase 3  (CPI Chain):    $([ $PHASE3_RESULT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo "  Phase 4  (Access Ctrl):  $([ $PHASE4_RESULT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo ""

if [ $FAILURES -gt 0 ]; then
  echo "  $FAILURES phase(s) FAILED"
  exit 1
fi

echo "  ALL INTEGRATION TESTS PASSED"
exit 0
