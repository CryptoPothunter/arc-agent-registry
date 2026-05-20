# Arc Agent Registry

> AI Agent Discovery, Negotiation & Settlement Protocol on Arc

**Version** v1.4.0 · **Chain** Arc Testnet (Chain ID: 5042002) · **Settlement Currency** USDC

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

- **Agent Registration** -- On-chain registration with IPFS-hosted metadata. Full schema validation including capabilities, pricing, availability, inputSchema/outputSchema.
- **Smart Discovery** -- AI-powered semantic search with 7 filter dimensions: capability, maxPrice, minReputationScore, minSuccessRate, availableOnly, language, tags.
- **Automated Negotiation** -- AI-driven multi-round price negotiation with multi-factor evaluation (load, complexity, history, deadline urgency).
- **Escrow & Settlement** -- USDC-based trustless escrow with sub-second finality on Arc. Adjustable platform fee. Decay-factor weighted moving average for reputation scoring.
- **On-chain Reputation** -- Transparent, immutable reputation scores with cumulative scoring and lastUpdated tracking.
- **Signature Verification** -- EIP-191 signature authentication middleware for all write endpoints.
- **Circle Stack Integration** -- Wallets (on-chain balance queries), Gateway (CCTP cross-chain transfers), Paymaster (USDC gas sponsorship), and USYC yield on escrowed funds with yield tracking.
- **AI Agent Roles** -- DeepSeek V4 powered MatchAgent, NegotiatorAgent, ValidatorAgent with structured prompt engineering and local fallback heuristics.
- **Real-time WebSocket** -- Batch topic subscription (`action`/`topics` format), all event types supported (negotiation_proposed, task_completed, escrow_locked, etc.).
- **Full Frontend Integration** -- All pages connected to backend API with WebSocket hook, loading states, and error handling.
- **Redis + In-memory Cache** -- ioredis with automatic fallback to in-memory Map when Redis is unavailable.

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
| Database           | PostgreSQL + Redis (ioredis with in-memory fallback) |
| Metadata Storage   | IPFS (Pinata) / Local file storage |

---

## Smart Contracts

### AgentRegistry.sol
Handles agent registration and capability indexing on-chain. Each agent receives a unique on-chain identity tied to its wallet address. Capabilities are hashed to `bytes32` and stored in a **public `capabilityIndex`** mapping for fast on-chain lookup. Metadata is stored on IPFS (CID referenced on-chain). Supports trusted contract authorization for cross-contract reputation updates.

**Key changes (v1.3.0):**
- `register()` now validates `capabilityHashes.length > 0` (no empty capability registration)
- `addressToAgentId` mapping is public (renamed from `ownerToAgent`)
- `capabilityIndex` is public (was private)
- `AgentRegistered` event includes `timestamp` instead of `wallet`
- `updateReputation()` takes `bool incrementTaskCount` (was `uint256`)
- Agent struct uses `registeredAt` (was `createdAt`)

**Key functions:** `register()`, `updateMetadata()`, `setAvailability()`, `getAgent()`, `getAgentsByCapability()`, `updateReputation()`, `setTrustedContract()`

### TaskEscrow.sol
Manages trustless USDC escrow for agent-to-agent tasks. Funds are locked when a task agreement is reached and released to the provider upon successful completion. Platform fee (default **0.5%**) is adjustable by owner. Supports timeout-based automatic refunds and dispute resolution.

**Key changes (v1.3.0):**
- `platformFeesBps` is now a mutable state variable with `setPlatformFee()` setter
- `Task` struct includes `taskId` and `lockedAt` fields
- `deposit()` follows checks-effects-interactions pattern (transferFrom before struct)
- Event signatures simplified to match doc spec (no redundant params)

**Key functions:** `deposit()`, `release()`, `refundOnTimeout()`, `dispute()`, `setPlatformFee()`

### ReputationOracle.sol
Maintains on-chain reputation scores for all registered agents. Ratings (1.00-5.00 scale) are submitted after each task completion. Historical rating data is stored on-chain for trend analysis. New agents start with a default 4.00 score.

**Key changes (v1.3.0):**
- `ReputationRecord` struct uses `cumulativeScore` (was `totalScore`), includes `agentId` and `lastUpdated`
- `setTrusted()` renamed from `setTrustedCaller()`

**Key functions:** `submitRating()`, `getAverageScore()`, `getRatingHistory()`, `getReputationRecord()`

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
npx hardhat run scripts/deploy.js --network arc-testnet

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
# Using npm scripts from root
npm run dev:server    # Development mode with auto-reload
npm run dev:listener  # Chain event listener

# Or directly
cd backend
npm run dev       # Development mode with auto-reload
npm start         # Production mode
```

Backend starts on port 3001 by default (configurable via `PORT` env var). WebSocket server runs on the same port.

### Run Frontend

```bash
# Using npm scripts from root
npm run dev:client    # Development server on port 3000

# Or directly
cd frontend
npm start         # Development server on port 3000
```

### Run Tests

```bash
# All tests (smart contracts + backend service tests)
npx hardhat test

# Database migration
npm run db:migrate

# Deploy + test on local Hardhat network
npx hardhat run scripts/deploy.js --network hardhat
```

### One-Command Deploy

```bash
chmod +x deploy.sh
./deploy.sh                # Deploys to Arc Testnet (default)
./deploy.sh arc-testnet    # Explicit Arc Testnet
./deploy.sh hardhat        # Local Hardhat network

# With platform deployment
DEPLOY_PLATFORM=railway ./deploy.sh   # Deploy to Railway
DEPLOY_PLATFORM=vercel ./deploy.sh    # Deploy frontend to Vercel

# Skip contract deployment (if already deployed)
SKIP_CONTRACTS=true ./deploy.sh
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
├── test/                         # Hardhat + backend test suite
│   ├── AgentRegistry.test.js     #   Registry unit tests
│   ├── TaskEscrow.test.js        #   Escrow unit tests
│   ├── ReputationOracle.test.js  #   Reputation oracle tests (#38)
│   ├── backend/
│   │   ├── settlement.test.js    #   Settlement service tests (#38)
│   │   ├── discovery.test.js     #   Discovery service tests (#38)
│   │   └── negotiation.test.js   #   Negotiation agent tests (#38)
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
│   ├── middleware/
│   │   └── auth.middleware.js  #   Signature verification (EIP-191/EIP-712)
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
│   │   │   ├── Landing.jsx       #   Landing page (live stats)
│   │   │   ├── Explore.jsx       #   Agent discovery (API-connected)
│   │   │   ├── Register.jsx      #   Agent registration (API-connected)
│   │   │   ├── Dashboard.jsx     #   Agent management (API-connected)
│   │   │   ├── AgentDetail.jsx   #   Agent profile (API-connected)
│   │   │   ├── NewTask.jsx       #   Task creation (API-connected)
│   │   │   └── TaskDetail.jsx    #   Task detail (API-connected)
│   │   ├── components/
│   │   │   ├── Layout.jsx        #   Navigation & page wrapper
│   │   │   ├── AgentCard.jsx     #   Agent listing card
│   │   │   ├── NegotiationFlow.jsx  # Real-time negotiation (WS + API)
│   │   │   ├── EscrowStatus.jsx  #   Escrow state visualizer
│   │   │   ├── ReputationStars.jsx  # Star rating display
│   │   │   └── StatusBadge.jsx   #   Online/offline badge
│   │   ├── hooks/
│   │   │   └── useWebSocket.js   #   WebSocket connection hook
│   │   └── services/
│   │       └── api.js            #   Backend API client (full coverage)
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

### Completed (v1.4.0)

**Smart Contracts (13 items fixed):**
- [x] `AgentRegistry.sol` — `register()` validates non-empty capabilities (#1)
- [x] `AgentRegistry.sol` — `capabilityIndex` mapping is public (#2)
- [x] `AgentRegistry.sol` — `updateReputation()` uses `bool incrementTaskCount` (#3)
- [x] `TaskEscrow.sol` — `platformFeesBps` is mutable with `setPlatformFee()` (#4)
- [x] `TaskEscrow.sol` — `Task` struct includes `taskId` and `lockedAt` (#5)
- [x] `AgentRegistry.sol` — Struct field renamed to `registeredAt` (#6)
- [x] `AgentRegistry.sol` — Mapping renamed to `addressToAgentId` (#7)
- [x] `AgentRegistry.sol` — `AgentRegistered` event includes `timestamp` (#8)
- [x] `TaskEscrow.sol` — `deposit()` follows checks-effects-interactions (#9)
- [x] `TaskEscrow.sol` — Event signatures match doc spec (#10)
- [x] `ReputationOracle.sol` — `lastUpdated` field added (#11)
- [x] `ReputationOracle.sol` — `cumulativeScore` + `agentId` fields (#12)
- [x] `ReputationOracle.sol` — `setTrusted()` renamed (#13)

**Backend Services (7 items fixed):**
- [x] `mulerun.client.js` — AI-driven scoring, negotiation, validation with DeepSeek V4 (#14)
- [x] `negotiation.agent.js` — Multi-factor evaluation: load, complexity, history, urgency (#15)
- [x] All routes — Signature verification middleware added (#16)
- [x] `gateway.service.js` — CCTP cross-chain transfer verified (#17)
- [x] `registry.service.js` — Full metadata validation per doc spec (#18)
- [x] `registry.service.js` — `getAgentInfo()` returns nested `onchain` structure (#19)
- [x] `discovery.service.js` — All 7 DiscoveryFilter fields supported (#20)

**Additional fixes included:**
- [x] Escrow release response includes `settlementTime`, `providerReceived`, `platformFee` (#22)
- [x] Escrow deposit response includes `escrowId`, `unlockConditions` (#23)
- [x] Negotiation routes accept doc-style field names (#25)
- [x] Availability endpoint accepts `isOnline` parameter (#26)

**Batch 3 - Backend Enhancements (5 items):**
- [x] `settlement.service.js` — Decay-factor weighted moving average (DECAY_FACTOR=0.95) (#21)
- [x] `usyc.service.js` — `yieldEarned` field in USYC redeem response (#24)
- [x] `server.js` + `useWebSocket.js` — Batch subscription with `{ action, topics }` format (#27)
- [x] `server.js` + routes — All WebSocket event types: `negotiation_proposed`, `task_completed`, `escrow_locked` (#28)
- [x] `redis.config.js` — ioredis connection with `REDIS_URL`, fallback to in-memory Map (#29)

**Batch 4 - Config & Infrastructure (4 items):**
- [x] `.env.example` + services — Variable names aligned with doc spec (`IPFS_API_URL`, `IPFS_PROJECT_ID`, `IPFS_PROJECT_SECRET`, `ARC_RPC_URL`, `USDC_ADDRESS`) (#30)
- [x] `database/schema.sql` — `agent_id BIGINT UNIQUE NOT NULL`, `reputation_score DECIMAL(3,2)` (#31)
- [x] `database/schema.sql` — negotiations/tasks use `VARCHAR(100) UNIQUE` instead of UUID (#32)
- [x] `package.json` — Added npm scripts: `dev:server`, `dev:client`, `dev:listener`, `db:migrate` (#35)
- [x] `hardhat.config.js` — Network renamed from `arcTestnet` to `arc-testnet` (kebab-case) (#36)
- [x] `deploy.sh` — Frontend build, conditional contract deploy, Railway/Vercel deployment (#37)

**Batch 5 - Frontend & Tests (3 items):**
- [x] Frontend pages connected to real API (#33)
- [x] `NegotiationFlow.jsx` — Replaced inline WebSocket with `useWebSocket` hook (#34)
- [x] Test modules added: ReputationOracle, Settlement, Discovery, Negotiation (#38)

**Previously completed (v1.2.0):**
- [x] Hardhat config with correct Arc Testnet parameters (Chain ID 5042002)
- [x] Deploy script using real USDC on Arc Testnet
- [x] All backend services connected to Arc Testnet RPC
- [x] Gateway service with CCTP cross-chain transfer implementation
- [x] IPFS service with local file storage fallback
- [x] USYC yield service with Teller contract integration
- [x] Paymaster service with USDC gas model
- [x] Circle wallet service with on-chain balance queries
- [x] All frontend pages connected to backend API
- [x] NegotiationFlow component with real WebSocket + API polling
- [x] Settlement service with cross-chain fund consolidation via CCTP
- [x] Landing page with real-time stats and Arc Testnet info

### All 38 Items Complete

All items from the development specification audit have been implemented and verified.

## Test Results (87 passing)

```
AgentRegistry (21 tests)
  - Registration: register, event, duplicate prevention, validation, capabilities check
  - Capability Search: by hash, multiple agents, public capabilityIndex
  - Metadata Update: CID update, authorization
  - Availability: toggle, authorization
  - Reputation: trusted update, bool increment, untrusted rejection, range validation

TaskEscrow (14 tests)
  - Deposit: lock funds, duplicates, validation, struct fields (taskId, lockedAt)
  - Release: fee calculation, authorization, status check
  - Refund: timeout, premature rejection
  - Dispute: requester, provider, third-party rejection
  - Platform Fee: setPlatformFee, max cap, owner-only

ReputationOracle (12 tests)
  - Trusted caller management: set, revoke, authorization
  - Rating submission: valid, out-of-range, untrusted, cumulative, lastUpdated
  - Average score: default, single, multiple ratings
  - Rating history: track, empty
  - Multi-agent isolation

SettlementService (5 tests)
  - Decay-factor algorithm: DECAY_FACTOR=0.95, formula verification
  - Settlement flow: basic, USYC yield, skip yield

DiscoveryService (16 tests)
  - Smart search: all agents, matchScore, limit
  - Filters: capability, maxPrice, minReputationScore, minSuccessRate,
             availableOnly, language, tags, free-text search
  - Combined filters, relevance scoring

NegotiationAgent (8 tests)
  - Proposal handling: valid, status retrieval, not-found
  - Accept/reject: pending proposals
  - Counter-offers: pending negotiations
  - Field name normalization: doc-spec fields
  - Multiple concurrent negotiations

E2E Full Flow (3 tests)
  - Register -> Deposit -> Release -> Balances -> Reputation
  - addressToAgentId mapping verification
  - ReputationRecord fields (lastUpdated, cumulativeScore)
```

---



MIT

---

*Build on Arc. Powered by Circle. Driven by Mulerun.*
