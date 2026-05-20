#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "  Arc Agent Registry - Deployment Script"
echo "  #37: Full deploy with frontend build,"
echo "       conditional contracts, platform deploy"
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
SKIP_CONTRACTS="${SKIP_CONTRACTS:-false}"
DEPLOY_PLATFORM="${DEPLOY_PLATFORM:-none}"  # none | railway | vercel

echo "[+] Target network: $NETWORK"
echo "[+] Skip contracts: $SKIP_CONTRACTS"
echo "[+] Deploy platform: $DEPLOY_PLATFORM"

# ---- Install dependencies ----
echo ""
echo "[+] Installing root dependencies..."
npm install

echo "[+] Installing backend dependencies..."
cd backend && npm install && cd ..

echo "[+] Installing frontend dependencies..."
cd frontend && npm install && cd ..

# ---- Compile contracts ----
echo ""
echo "[+] Compiling smart contracts..."
npx hardhat compile

# ---- Run tests (local network only) ----
if [ "$NETWORK" = "hardhat" ]; then
  echo "[+] Running tests..."
  npx hardhat test
else
  echo "[+] Skipping tests for $NETWORK (run 'npx hardhat test' manually)"
fi

# ---- Deploy contracts (conditional) ----
if [ "$SKIP_CONTRACTS" = "true" ]; then
  echo "[+] Skipping contract deployment (SKIP_CONTRACTS=true)"
elif [ -z "${DEPLOYER_PRIVATE_KEY:-}" ] || [ "$DEPLOYER_PRIVATE_KEY" = "0x_your_deployer_private_key" ]; then
  echo "[!] DEPLOYER_PRIVATE_KEY not set, skipping contract deployment"
elif [ -n "${REGISTRY_CONTRACT:-}" ] && [ -n "${ESCROW_CONTRACT:-}" ] && [ -n "${REPUTATION_CONTRACT:-}" ]; then
  echo "[+] All contract addresses already set in .env, skipping deployment"
  echo "    REGISTRY_CONTRACT=$REGISTRY_CONTRACT"
  echo "    ESCROW_CONTRACT=$ESCROW_CONTRACT"
  echo "    REPUTATION_CONTRACT=$REPUTATION_CONTRACT"
else
  echo "[+] Deploying contracts to $NETWORK..."
  npx hardhat run scripts/deploy.js --network "$NETWORK"

  # Update .env with deployed addresses if available
  if [ -f deployed-addresses.json ]; then
    echo "[+] Updating .env with deployed contract addresses..."
    REGISTRY_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.AgentRegistry)")
    ESCROW_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.TaskEscrow)")
    REPUTATION_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.ReputationOracle)")
    MARKET_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.AgentReputationMarket)")
    PIPELINE_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.AgentPipeline)")
    FUND_ADDR=$(node -e "console.log(require('./deployed-addresses.json').contracts.AgentFund)")

    sed -i "s|^REGISTRY_CONTRACT=.*|REGISTRY_CONTRACT=$REGISTRY_ADDR|" .env
    sed -i "s|^ESCROW_CONTRACT=.*|ESCROW_CONTRACT=$ESCROW_ADDR|" .env
    sed -i "s|^REPUTATION_CONTRACT=.*|REPUTATION_CONTRACT=$REPUTATION_ADDR|" .env
    sed -i "s|^REPUTATION_MARKET_CONTRACT=.*|REPUTATION_MARKET_CONTRACT=$MARKET_ADDR|" .env
    sed -i "s|^PIPELINE_CONTRACT=.*|PIPELINE_CONTRACT=$PIPELINE_ADDR|" .env
    sed -i "s|^AGENT_FUND_CONTRACT=.*|AGENT_FUND_CONTRACT=$FUND_ADDR|" .env

    echo "[+] All 6 contract addresses updated in .env"
  fi
fi

# ---- Database migration (if DATABASE_URL is set) ----
if [ -n "${DATABASE_URL:-}" ] && [ "$DATABASE_URL" != "postgresql://localhost:5432/arc_registry" ]; then
  echo ""
  echo "[+] Running database migration..."
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -f database/schema.sql
    echo "[+] Database schema applied"
  else
    echo "[!] psql not found, skipping database migration"
  fi
else
  echo "[+] Skipping database migration (default DATABASE_URL)"
fi

# ---- Frontend build ----
echo ""
echo "[+] Building frontend..."
cd frontend
REACT_APP_API_URL="${REACT_APP_API_URL:-http://localhost:3001}" \
REACT_APP_WS_URL="${REACT_APP_WS_URL:-ws://localhost:3001}" \
npm run build
cd ..
echo "[+] Frontend build complete (output: frontend/build/)"

# ---- Platform deployment ----
echo ""
case "$DEPLOY_PLATFORM" in
  railway)
    echo "[+] Deploying to Railway..."
    if command -v railway >/dev/null 2>&1; then
      echo "[+] Deploying backend to Railway..."
      cd backend && railway up && cd ..
      echo "[+] Deploying frontend to Railway..."
      cd frontend && railway up && cd ..
      echo "[+] Railway deployment complete"
    else
      echo "[!] Railway CLI not found. Install with: npm i -g @railway/cli"
      echo "    Then run: railway login && railway up"
    fi
    ;;
  vercel)
    echo "[+] Deploying frontend to Vercel..."
    if command -v vercel >/dev/null 2>&1; then
      cd frontend && vercel --prod && cd ..
      echo "[+] Vercel deployment complete"
    else
      echo "[!] Vercel CLI not found. Install with: npm i -g vercel"
      echo "    Then run: vercel login && vercel --prod"
    fi
    ;;
  *)
    echo "[+] No platform deployment configured (set DEPLOY_PLATFORM=railway|vercel)"
    ;;
esac

echo ""
echo "========================================="
echo "[+] Deployment complete!"
if [ -f deployed-addresses.json ]; then
  echo "[+] Check deployed-addresses.json for contract addresses."
fi
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Start backend:  npm run dev:server"
echo "  2. Start frontend: npm run dev:client"
echo "  3. Start listener: npm run dev:listener"
echo "========================================="
