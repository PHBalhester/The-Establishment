#!/bin/bash
# =============================================================================
# Binary Hash Manifest Generator
#
# Generates SHA256 hashes of compiled Solana program .so files for preflight
# verification. The output JSON can be compared against expected hashes to
# ensure the deployed binaries match the verified build.
#
# Usage:
#   ./scripts/deploy/generate-hashes.sh <devnet|mainnet>
#
# Output:
#   deployments/expected-hashes.<cluster>.json
#
# Why SHA256 hashes?
#   After `anchor build`, the .so files in target/deploy/ are the exact
#   binaries that get deployed on-chain. Hashing them before deploy and
#   comparing against a known-good hash set catches:
#   - Accidental rebuilds with wrong features (devnet vs mainnet)
#   - Modified source between audit and deploy
#   - Corrupted build artifacts
#
# macOS compatible: uses `shasum -a 256` (not `sha256sum` which is Linux-only)
# =============================================================================
set -e

CLUSTER="${1:-}"

if [ -z "$CLUSTER" ] || { [ "$CLUSTER" != "devnet" ] && [ "$CLUSTER" != "mainnet" ]; }; then
  echo ""
  echo "Usage: ./scripts/deploy/generate-hashes.sh <devnet|mainnet>"
  echo ""
  echo "Generates SHA256 hashes of compiled .so files in target/deploy/."
  echo "Output: deployments/expected-hashes.<cluster>.json"
  echo ""
  exit 1
fi

# cd to project root (two levels up from scripts/deploy/)
cd "$(dirname "$0")/../.."

SO_DIR="target/deploy"
OUT_DIR="deployments"
OUT_FILE="${OUT_DIR}/expected-hashes.${CLUSTER}.json"

# Ensure output directory exists
mkdir -p "$OUT_DIR"

# Check if any .so files exist
SO_FILES=$(find "$SO_DIR" -name "*.so" -type f 2>/dev/null | sort)

if [ -z "$SO_FILES" ]; then
  echo ""
  echo "WARNING: No .so files found in ${SO_DIR}/"
  echo "Run 'anchor build' first to compile programs."
  echo ""
  exit 1
fi

# Generate timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build JSON with hashes
echo "Generating SHA256 hashes for ${CLUSTER}..."
echo ""

# Start JSON output
JSON="{\n  \"generated\": \"${TIMESTAMP}\",\n  \"cluster\": \"${CLUSTER}\",\n  \"programs\": {"

FIRST=true
while IFS= read -r SO_FILE; do
  # Extract program name from filename (e.g., "amm" from "amm.so")
  BASENAME=$(basename "$SO_FILE" .so)

  # Compute SHA256 hash (macOS: shasum -a 256, output format: "hash  filename")
  HASH=$(shasum -a 256 "$SO_FILE" | awk '{print $1}')

  # Get file size for reference
  SIZE=$(wc -c < "$SO_FILE" | tr -d ' ')

  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    JSON="${JSON},"
  fi

  JSON="${JSON}\n    \"${BASENAME}\": \"${HASH}\""

  echo "  ${BASENAME}: ${HASH} (${SIZE} bytes)"
done <<< "$SO_FILES"

JSON="${JSON}\n  }\n}"

# Write JSON file
printf "$JSON\n" > "$OUT_FILE"

echo ""
echo "Hash manifest written to: ${OUT_FILE}"
echo "Generated at: ${TIMESTAMP}"
echo ""
