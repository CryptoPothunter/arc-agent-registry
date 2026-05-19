#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "  Arc Agent Registry - Deployment Script"
echo "========================================="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required but not installed."; exit 1; }
command -v npx  >/dev/null 2>&1 || { echo "Error: npx is required but not installed."; exit 1; }

# Load environment variables
if [ -f .env ]; then
  set -a
  source .env
  set +a
  echo "[+] Loaded .env"
else
  echo "Error: .env file not found. Copy .env.example to .env and fill in values."
  exit 1
fi

NETWORK="${1:-arc-testnet}"
echo "[+] Target network: $NETWORK"

# Install dependencies
echo "[+] Installing dependencies..."
npm install

# Compile contracts
echo "[+] Compiling smart contracts..."
npx hardhat compile

# Run tests
echo "[+] Running tests..."
npx hardhat test

# Deploy contracts
echo "[+] Deploying contracts to $NETWORK..."
npx hardhat run scripts/deploy.js --network "$NETWORK"

echo ""
echo "[+] Deployment complete!"
echo "[+] Check deployed-addresses.json for contract addresses."
echo "========================================="
