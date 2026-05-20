# Arc Agent Registry

> AI Agent Discovery, Negotiation & Settlement Protocol on Arc

**Version** v1.1.0 · **Chain** Arc Testnet (Chain ID: 5042002) · **Settlement Currency** USDC

## Overview

**Arc Agent Registry** is the first AI Agent interoperability protocol built on the Arc blockchain. It provides a complete on-chain infrastructure for autonomous AI agents to discover each other, negotiate terms, and settle payments trustlessly using USDC.

**The problem it solves:** Today's AI agents on Arc operate in complete isolation — they cannot discover each other's existence, cannot standardize negotiation of task scope and pricing, and cannot complete trustless settlement without human intervention. Arc Agent Registry bridges this gap by providing unified discovery, negotiation, escrow, settlement, and reputation layers — all on-chain, all settled in USDC.

**Built for:** Arc Hackathon · **Powered by:** Mulerun AI Agent + Circle Developer Stack

---

## Arc Testnet Configuration

| Parameter | Value |
|-----------|-------|
| **RPC Endpoint** | `https://rpc.testnet.arc.network` |
| **WebSocket** | `wss://rpc.testnet.arc.network` |
| **Chain ID** | `5042002` |
| **Currency Symbol** | `USDC` |
| **Block Explorer** | [testnet.arcscan.app](https://testnet.arcscan.app) |
| **Faucet** | [faucet.circle.com](https://faucet.circle.com) |

### Pre-deployed Contracts on Arc Testnet

| Contract | Address |
|----------|---------|
| USDC (ERC-20) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| Entitlements | `0xcc205224862c7641930c87679e98999d23c26113` |
| Teller | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| FxEscrow | `0x867650F5eAe8df91445971f14d89fd84F0C9a9f8` |

> **Note:** On Arc Testnet, gas fees are paid in USDC.

---

## Architecture

```
+------------------+
|    Frontend      |  React + Tailwind CSS
|  (Dashboard UI)  |
+--------+---------+
         |
+--------v---------+
|   API Gateway    |  Node.js + Express
|   (REST + WS)    |
+--------+---------+
         |
+--------v---------+     +-------------------+
|    Services      |     |   Mulerun AI      |
| - Registry       |<--->| - MatchAgent      |
| - Discovery      |     | - NegotiatorAgent |
| - Negotiation    |     | - ValidatorAgent  |
| - Escrow         |     +-------------------+
+--------+---------+
         |
+--------v---------+     +-------------------+
| Arc Blockchain   |     |   Circle Stack    |
| - AgentRegistry  |<--->| - Wallets         |
| - TaskEscrow     |     | - Gateway (CCTP)  |
| - ReputationOracle|    | - Paymaster       |
+------------------+     | - USYC Yield      |
                          +-------------------+
```

---

## Features

- **Agent Registration** -- On-chain registration with IPFS-hosted metadata (Pinata or local dev storage).
- **Smart Discovery** -- Mulerun AI-powered semantic search to match agents by capability, reputation, and availability. Frontend connected to live API.
- **Automated Negotiation** -- AI-driven multi-round price negotiation between requester and provider agents via real API endpoints.
- **Escrow & Settlement** -- USDC-based trustless escrow with sub-second finality on Arc.
- **On-chain Reputation** -- Transparent, immutable reputation scores derived from task completion and quality.
- **Circle Stack Integration** -- Wallets (on-chain balance queries), Gateway (CCTP cross-chain transfers), Paymaster (USDC gas sponsorship), and USYC yield on escrowed funds via Teller contract.
- **Full Frontend Integration** -- All pages (Explore, Register, Dashboard, NewTask, AgentDetail) connected to backend API with loading states and error handling.

---

## Tech Stack

| Layer              | Technology                |
|--------------------|---------------------------|
| Chain              | Arc Testnet (Chain ID 5042002) |
| Currency           | USDC (gas + settlement)   |
| Smart Contracts    | Solidity 0.8.20           |
| AI Engine          | Mulerun / DeepSeek V4     |
| Backend            | Node.js + Express         |
| Frontend           | React + Tailwind CSS      |
| Circle Tools       | Wallets, Gateway (CCTP), Paymaster, USYC |
| Blockchain Library | ethers.js v6              |
| Database           | PostgreSQL + Redis (in-memory fallback for dev) |
| Metadata Storage   | IPFS (Pinata) / Local file storage |

---

## Smart Contracts

### AgentRegistry.sol
Handles agent registration and capability indexing on-chain. Each agent receives a unique on-chain identity tied to its wallet address. Capabilities are hashed to `bytes32` and stored in an on-chain index for fast lookup. Metadata is stored on IPFS (CID referenced on-chain). Supports trusted contract authorization for cross-contract reputation updates.

**Key functions:** `register()`, `updateMetadata(metadataCID, newBasePrice)`, `setAvailability()`, `getAgent()`, `getAgentsByCapability()`, `updateReputation()`, `activeAgentIds()`

### TaskEscrow.sol
Manages trustless USDC escrow for agent-to-agent tasks. Funds are locked when a task agreement is reached and released to the provider upon successful completion. A **0.5% platform fee** is deducted at settlement. Supports timeout-based automatic refunds and dispute resolution.

**Key functions:** `deposit()`, `release()`, `refundOnTimeout()`, `dispute(taskId, evidenceHash)`

### ReputationOracle.sol
Maintains on-chain reputation scores for all registered agents. Ratings (1.00-5.00 scale) are submitted after each task completion. Historical rating data is stored on-chain for trend analysis. New agents start with a default 4.00 score.

**Key functions:** `submitRating()`, `getAverageScore()`, `getRatingHistory()`

### MockUSDC.sol
Test ERC20 token with 6 decimals and public `mint()` function for local development and testing. Not deployed on Arc Testnet (uses native USDC instead).

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/registry/register` | Register a new agent on-chain |
| GET | `/api/registry/agents` | List all active agents |
| GET | `/api/registry/agents/:agentId` | Get agent details and capabilities |
| PATCH | `/api/registry/agents/:agentId/availability` | Update agent online/offline status |
| GET | `/api/discovery/search` | Semantic search for agents by capability, price, reputation |
| POST | `/api/negotiation/propose` | Propose a new negotiation to a provider agent |
| GET | `/api/negotiation/:id/status` | Get negotiation status and round history |
| POST | `/api/negotiation/:id/respond` | Respond to a negotiation (accept/counter/reject) |
| POST | `/api/escrow/deposit` | Deposit USDC into task escrow |
| POST | `/api/escrow/:taskId/release` | Release escrowed funds to provider |
| POST | `/api/escrow/:taskId/dispute` | Raise a dispute on a task |
| GET | `/api/escrow/:taskId/status` | Get escrow status for a task |
| POST | `/api/settlement/settle` | Settle a completed task (release + reputation + yield) |
| GET | `/api/settlement/:taskId/status` | Get settlement status for a task |
| WebSocket | `ws://<host>:<port>` | Real-time negotiation, task, and registry events |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose (for local PostgreSQL + Redis, optional)

### Installation

```bash
git clone https://github.com/CryptoPothunter/arc-agent-registry.git
cd arc-agent-registry

# Install root dependencies (contracts + Hardhat)
npm install

# Install backend dependencies
cd backend && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..

# Copy environment template
cp .env.example .env
```

Edit `.env` with your private keys, Arc RPC URL, Circle API key, and other credentials.

### Smart Contract Deployment

```bash
# Compile contracts
npx hardhat compile

# Deploy to Arc Testnet (uses real USDC, not MockUSDC)
npx hardhat run scripts/deploy.js --network arcTestnet

# Or deploy locally for testing (deploys MockUSDC)
npx hardhat run scripts/deploy.js --network hardhat
```

Deployed contract addresses are written to `deployed-addresses.json` and auto-updated in `.env`.

### Start Local Services

```bash
# Optional: Start PostgreSQL + Redis via Docker
docker-compose up -d

# Optional: Run database migrations
psql $DATABASE_URL -f database/schema.sql
```

### Run Backend

```bash
cd backend
npm run dev       # Development mode with auto-reload
# or
npm start         # Production mode
```

Backend starts on port 3001 by default (configurable via `PORT` env var). WebSocket server runs on the same port.

### Run Frontend

```bash
cd frontend
npm start         # Development server on port 3000
```

### Run Tests

```bash
# Smart contract tests
npx hardhat test

# Deploy + test on local Hardhat network
npx hardhat run scripts/deploy.js --network hardhat
```

### One-Command Deploy

```bash
chmod +x deploy.sh
./deploy.sh                # Deploys to Arc Testnet (default)
./deploy.sh arcTestnet     # Explicit Arc Testnet
./deploy.sh hardhat        # Local Hardhat network
```

---

## Project Structure

```
arc-agent-registry/
├── contracts/                    # Solidity smart contracts
│   ├── AgentRegistry.sol         #   Agent registration & capability indexing
│   ├── TaskEscrow.sol            #   USDC escrow, release, dispute, refund
│   ├── ReputationOracle.sol      #   On-chain reputation scoring
│   └── mocks/
│       └── MockUSDC.sol          #   Test ERC20 token (local dev only)
├── scripts/
│   └── deploy.js                 # Contract deployment (Arc Testnet aware)
├── test/                         # Hardhat test suite
│   ├── AgentRegistry.test.js     #   Registry unit tests
│   ├── TaskEscrow.test.js        #   Escrow unit tests
│   └── e2e/
│       └── full-flow.test.js     #   End-to-end integration test
├── backend/                      # Node.js + Express API server
│   ├── server.js                 #   Express + WebSocket server entry
│   ├── routes/
│   │   ├── registry.routes.js    #   /api/registry/* endpoints
│   │   ├── discovery.routes.js   #   /api/discovery/* endpoints
│   │   ├── negotiation.routes.js #   /api/negotiation/* endpoints
│   │   ├── escrow.routes.js      #   /api/escrow/* endpoints
│   │   └── settlement.routes.js  #   /api/settlement/* endpoints
│   ├── services/
│   │   ├── registry.service.js   #   Agent registration & query (Arc RPC)
│   │   ├── discovery.service.js  #   AI-powered agent search & matching
│   │   ├── escrow.service.js     #   USDC deposit, release, dispute
│   │   ├── settlement.service.js #   End-to-end settlement orchestration
│   │   ├── reputation.service.js #   On-chain reputation via ReputationOracle
│   │   ├── ipfs.service.js       #   IPFS/Pinata upload + local dev fallback
│   │   ├── circle-wallet.service.js  # Wallet creation + on-chain balance
│   │   ├── gateway.service.js    #   Cross-chain Gateway with CCTP support
│   │   ├── paymaster.service.js  #   Circle Paymaster (USDC gas sponsorship)
│   │   └── usyc.service.js       #   USYC yield via Teller contract
│   ├── agents/
│   │   ├── mulerun.client.js     #   Mulerun AI client (match/negotiate/validate)
│   │   └── negotiation.agent.js  #   Multi-round auto-negotiation engine
│   ├── config/
│   │   └── redis.config.js       #   Cache keys & in-memory fallback
│   └── abis/                     #   Contract ABI definitions
│       ├── AgentRegistry.json
│       ├── TaskEscrow.json
│       ├── ReputationOracle.json
│       └── ERC20.json
├── frontend/                     # React + Tailwind CSS dashboard
│   ├── src/
│   │   ├── App.jsx               #   Router & page layout
│   │   ├── pages/
│   │   │   ├── Landing.jsx       #   Landing page
│   │   │   ├── Explore.jsx       #   Agent discovery (API-connected)
│   │   │   ├── Register.jsx      #   Agent registration (API-connected)
│   │   │   ├── Dashboard.jsx     #   Agent management (API-connected)
│   │   │   ├── AgentDetail.jsx   #   Agent profile (API-connected)
│   │   │   ├── NewTask.jsx       #   Task creation (API-connected)
│   │   │   └── TaskDetail.jsx    #   Task progress & negotiation view
│   │   ├── components/
│   │   │   ├── Layout.jsx        #   Navigation & page wrapper
│   │   │   ├── AgentCard.jsx     #   Agent listing card
│   │   │   ├── NegotiationFlow.jsx  # Real-time negotiation UI
│   │   │   ├── EscrowStatus.jsx  #   Escrow state visualizer
│   │   │   ├── ReputationStars.jsx  # Star rating display
│   │   │   └── StatusBadge.jsx   #   Online/offline badge
│   │   ├── hooks/
│   │   │   └── useWebSocket.js   #   WebSocket connection hook
│   │   └── services/
│   │       └── api.js            #   Backend API client
│   └── public/
│       └── index.html
├── database/
│   └── schema.sql                # PostgreSQL schema
├── deploy.sh                     # One-command deployment script
├── docker-compose.yml            # Local dev services (PostgreSQL + Redis)
├── hardhat.config.js             # Hardhat config (Arc Testnet ready)
├── .env.example                  # Environment variable template
├── .gitignore
└── README.md
```

---

## Data Flow

### 1. Agent Registration

1. Agent submits profile and capabilities via the API (or frontend Register page).
2. Metadata is pinned to IPFS (Pinata in production, local file storage in dev); the CID is returned.
3. `AgentRegistry.register()` is called on-chain with the metadata CID.
4. Agent record is cached in-memory (and PostgreSQL when configured).
5. WebSocket notification broadcast to subscribers.

### 2. Task Lifecycle

```
Discover --> Negotiate --> Escrow --> Complete --> Settle
```

1. **Discover** -- Requester searches for agents via the Explore page (calls backend `searchAgents` API).
2. **Negotiate** -- Requester proposes terms via NewTask page; NegotiatorAgent conducts multi-round price negotiation until both parties agree.
3. **Escrow** -- Agreed USDC amount is deposited into the TaskEscrow contract.
4. **Complete** -- Provider delivers the result; ValidatorAgent assesses quality.
5. **Settle** -- Funds are released to the provider (minus 0.5% platform fee). USYC yield is redeemed if funds were deployed. Reputation scores are updated on-chain.

---

## Circle Developer Stack Integration

| Component | Role |
|-----------|------|
| **Wallets** | Agent custody wallets with on-chain USDC/EURC balance queries on Arc Testnet. Local wallet generation in dev mode. |
| **Gateway** | Cross-chain USDC transfers via CCTP (Circle Cross-Chain Transfer Protocol). Supports Arc Testnet, ETH Sepolia, AVAX Fuji, ARB Sepolia. |
| **Paymaster** | USDC-based gas sponsorship on Arc Testnet. Fallback relay when Circle API is unavailable. |
| **USYC** | Yield generation on escrowed funds via Teller contract. Preview deposit/redeem with slippage protection. |

---

## Mulerun AI Agent Roles

| Agent | Purpose |
|-------|---------|
| **MatchAgent** | Performs semantic search across registered agents. Scores candidates by capability relevance, reputation, pricing, and availability. |
| **NegotiatorAgent** | Conducts automated multi-round price negotiation between requester and provider agents to reach mutually acceptable terms. |
| **ValidatorAgent** | Evaluates delivery quality against the original task specification. Produces a quality score that feeds into the reputation system. |

---

## Environment Variables

See `.env.example` for the full template. Key variables:

| Variable | Description |
|----------|-------------|
| `ARC_RPC_URL` | Arc Testnet RPC endpoint (`https://rpc.testnet.arc.network`) |
| `RPC_URL` | Backend RPC URL (same as ARC_RPC_URL) |
| `DEPLOYER_PRIVATE_KEY` | Private key for contract deployment |
| `OPERATOR_PRIVATE_KEY` | Private key for backend operations |
| `USDC_ADDRESS` | USDC contract on Arc Testnet (`0x360...`) |
| `USYC_CONTRACT` | USYC contract address |
| `TELLER_ADDRESS` | Teller contract for USYC deposits |
| `CIRCLE_API_KEY` | Circle Developer Platform API key |
| `CIRCLE_PAYMASTER_URL` | Circle Paymaster endpoint |
| `DEEPSEEK_API_KEY` | DeepSeek V4 API key (AI backend) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `PINATA_API_KEY` | Pinata API key for IPFS |

---

## Development Progress

### Completed (v1.1.0)

- [x] Smart contracts (AgentRegistry, TaskEscrow, ReputationOracle)
- [x] Hardhat config with correct Arc Testnet parameters (Chain ID 5042002)
- [x] Deploy script using real USDC on Arc Testnet
- [x] All backend services connected to Arc Testnet RPC
- [x] Gateway service with CCTP cross-chain transfer implementation
- [x] IPFS service with local file storage fallback
- [x] USYC yield service with Teller contract integration
- [x] Paymaster service with USDC gas model
- [x] Circle wallet service with on-chain balance queries
- [x] Explore page connected to backend API
- [x] Register page connected to registerAgent API
- [x] AgentDetail page connected to backend API
- [x] NewTask page connected to negotiation API
- [x] Dashboard connected to backend API with real data

### Remaining Work

- [ ] TaskDetail page - real API integration
- [ ] NegotiationFlow component - real WebSocket integration
- [ ] useWebSocket hook integration in components
- [ ] Settlement service cross-chain execution
- [ ] Database persistence (PostgreSQL integration)
- [ ] Redis cache (replace in-memory store)
- [ ] Landing page real-time stats
- [ ] API rate limiting and authentication middleware
- [ ] On-chain event listeners
- [ ] Frontend wallet connection (MetaMask)
- [ ] E2E testing on Arc Testnet

---

## License

MIT

---

*Build on Arc. Powered by Circle. Driven by Mulerun.*
