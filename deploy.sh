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

NETWORK="${1:-arcTestnet}"
echo "[+] Target network: $NETWORK"

# Install dependencies
echo "[+] Installing root dependencies..."
npm install

echo "[+] Installing backend dependencies..."
cd backend && npm install && cd ..

echo "[+] Installing frontend dependencies..."
cd frontend && npm install && cd ..

# Compile contracts
echo "[+] Compiling smart contracts..."
npx hardhat compile

# Run tests (skip on Arc Testnet to save time)
if [ "$NETWORK" = "hardhat" ]; then
  echo "[+] Running tests..."
  npx hardhat test
else
  echo "[+] Skipping tests for $NETWORK (run 'npx hardhat test' manually)"
fi

# Deploy contracts
echo "[+] Deploying contracts to $NETWORK..."
npx hardhat run scripts/deploy.js --network "$NETWORK"

# Update .env with deployed addresses if available
if [ -f deployed-addresses.json ]; then
  echo "[+] Updating .env with deployed contract addresses..."
  REGISTRY_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.AgentRegistry)")
  ESCROW_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.TaskEscrow)")
  REPUTATION_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.ReputationOracle)")

  sed -i "s|^REGISTRY_CONTRACT=.*|REGISTRY_CONTRACT=$REGISTRY_ADDR|" .env
  sed -i "s|^ESCROW_CONTRACT=.*|ESCROW_CONTRACT=$ESCROW_ADDR|" .env
  sed -i "s|^REPUTATION_CONTRACT=.*|REPUTATION_CONTRACT=$REPUTATION_ADDR|" .env

  echo "[+] Contract addresses updated in .env"
fi

echo ""
echo "[+] Deployment complete!"
echo "[+] Check deployed-addresses.json for contract addresses."
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Start backend:  cd backend && npm run dev"
echo "  2. Start frontend: cd frontend && npm start"
echo "========================================="
