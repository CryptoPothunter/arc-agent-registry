-- Arc Agent Registry - Database Schema
-- #31: agents.agent_id uses BIGINT UNIQUE NOT NULL, reputation_score uses INTEGER (0-500 scale, matching on-chain)
-- #32: negotiations/tasks use VARCHAR(100) UNIQUE instead of UUID

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
    id                SERIAL PRIMARY KEY,
    agent_id          BIGINT UNIQUE NOT NULL,
    owner_address     VARCHAR(42) NOT NULL,
    wallet_address    VARCHAR(42) NOT NULL UNIQUE,
    name              VARCHAR(255) NOT NULL,
    metadata_cid      VARCHAR(255),
    is_active         BOOLEAN DEFAULT TRUE,
    reputation_score  INTEGER DEFAULT 400,         -- 0-500 scale (1.00-5.00), matches on-chain ReputationOracle
    total_tasks       INTEGER DEFAULT 0,
    registered_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_agent_id ON agents (agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_wallet ON agents (wallet_address);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents (owner_address);
CREATE INDEX IF NOT EXISTS idx_agents_is_active ON agents (is_active);
CREATE INDEX IF NOT EXISTS idx_agents_reputation ON agents (reputation_score DESC);

-- Capabilities table
CREATE TABLE IF NOT EXISTS capabilities (
    id                SERIAL PRIMARY KEY,
    agent_id          BIGINT NOT NULL,
    name              VARCHAR(255) NOT NULL,
    description       TEXT,
    base_price_usdc   NUMERIC(18,6) NOT NULL,
    capability_hash   VARCHAR(66),
    CONSTRAINT fk_capabilities_agent FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_capabilities_agent ON capabilities (agent_id);
CREATE INDEX IF NOT EXISTS idx_capabilities_name ON capabilities (name);
CREATE INDEX IF NOT EXISTS idx_capabilities_hash ON capabilities (capability_hash);

-- Negotiations table
CREATE TABLE IF NOT EXISTS negotiations (
    id                  SERIAL PRIMARY KEY,
    negotiation_id      VARCHAR(100) UNIQUE NOT NULL,
    requester_address   VARCHAR(42) NOT NULL,
    provider_agent_id   BIGINT NOT NULL,
    task_description    TEXT,
    status              VARCHAR(50) DEFAULT 'pending',
    offered_price       NUMERIC(18,6) NOT NULL,
    agreed_price        NUMERIC(18,6),
    agreement_hash      VARCHAR(66),
    rounds              INTEGER DEFAULT 0,
    expires_at          TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_negotiations_agent FOREIGN KEY (provider_agent_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_negotiations_negotiation_id ON negotiations (negotiation_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_requester ON negotiations (requester_address);
CREATE INDEX IF NOT EXISTS idx_negotiations_provider ON negotiations (provider_agent_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_status ON negotiations (status);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id                  SERIAL PRIMARY KEY,
    task_id             VARCHAR(100) UNIQUE NOT NULL,
    negotiation_id      VARCHAR(100) NOT NULL,
    requester_address   VARCHAR(42) NOT NULL,
    provider_agent_id   BIGINT NOT NULL,
    amount_usdc         NUMERIC(18,6) NOT NULL,
    status              VARCHAR(50) DEFAULT 'created',
    escrow_tx_hash      VARCHAR(66),
    release_tx_hash     VARCHAR(66),
    deadline            TIMESTAMP WITH TIME ZONE,
    rating              NUMERIC(3,1),
    feedback            TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_tasks_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations(negotiation_id),
    CONSTRAINT fk_tasks_agent FOREIGN KEY (provider_agent_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_task_id ON tasks (task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_negotiation ON tasks (negotiation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_requester ON tasks (requester_address);
CREATE INDEX IF NOT EXISTS idx_tasks_provider ON tasks (provider_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);

-- Reputation history table
CREATE TABLE IF NOT EXISTS reputation_history (
    id              SERIAL PRIMARY KEY,
    agent_id        BIGINT NOT NULL,
    rating          NUMERIC(3,1) NOT NULL,
    rater_address   VARCHAR(42) NOT NULL,
    task_id         VARCHAR(100) NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_reputation_agent FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE,
    CONSTRAINT fk_reputation_task FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);

CREATE INDEX IF NOT EXISTS idx_reputation_agent ON reputation_history (agent_id);
CREATE INDEX IF NOT EXISTS idx_reputation_task ON reputation_history (task_id);
CREATE INDEX IF NOT EXISTS idx_reputation_created ON reputation_history (created_at DESC);

-- Prediction markets table (AgentReputationMarket)
CREATE TABLE IF NOT EXISTS prediction_markets (
    id                  SERIAL PRIMARY KEY,
    market_id           BIGINT UNIQUE NOT NULL,
    agent_id            BIGINT NOT NULL,
    task_id             VARCHAR(100) NOT NULL,
    threshold           INTEGER NOT NULL,        -- 100-500 (1.00-5.00 scaled)
    total_above         NUMERIC(18,6) DEFAULT 0,
    total_below         NUMERIC(18,6) DEFAULT 0,
    resolved            BOOLEAN DEFAULT FALSE,
    outcome_above       BOOLEAN,
    actual_score        INTEGER,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at         TIMESTAMP WITH TIME ZONE,
    CONSTRAINT fk_market_agent FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_markets_agent ON prediction_markets (agent_id);
CREATE INDEX IF NOT EXISTS idx_markets_resolved ON prediction_markets (resolved);

-- Market bets table
CREATE TABLE IF NOT EXISTS market_bets (
    id                  SERIAL PRIMARY KEY,
    market_id           BIGINT NOT NULL,
    bettor_address      VARCHAR(42) NOT NULL,
    is_above            BOOLEAN NOT NULL,
    amount_usdc         NUMERIC(18,6) NOT NULL,
    claimed             BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_bet_market FOREIGN KEY (market_id) REFERENCES prediction_markets(market_id)
);

CREATE INDEX IF NOT EXISTS idx_bets_market ON market_bets (market_id);
CREATE INDEX IF NOT EXISTS idx_bets_bettor ON market_bets (bettor_address);

-- Agent investment funds table (AgentFund)
CREATE TABLE IF NOT EXISTS agent_funds (
    id                  SERIAL PRIMARY KEY,
    fund_id             BIGINT UNIQUE NOT NULL,
    agent_id            BIGINT NOT NULL,
    target_usdc         NUMERIC(18,6) NOT NULL,
    raised_usdc         NUMERIC(18,6) DEFAULT 0,
    investor_share_bps  INTEGER NOT NULL,         -- 1-5000 (0.01%-50%)
    deadline            TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active           BOOLEAN DEFAULT TRUE,
    is_released         BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_fund_agent FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_funds_agent ON agent_funds (agent_id);
CREATE INDEX IF NOT EXISTS idx_funds_active ON agent_funds (is_active);

-- Fund investments table
CREATE TABLE IF NOT EXISTS fund_investments (
    id                  SERIAL PRIMARY KEY,
    fund_id             BIGINT NOT NULL,
    investor_address    VARCHAR(42) NOT NULL,
    amount_usdc         NUMERIC(18,6) NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_investment_fund FOREIGN KEY (fund_id) REFERENCES agent_funds(fund_id)
);

CREATE INDEX IF NOT EXISTS idx_investments_fund ON fund_investments (fund_id);
CREATE INDEX IF NOT EXISTS idx_investments_investor ON fund_investments (investor_address);

-- Pipelines table (AgentPipeline)
CREATE TABLE IF NOT EXISTS pipelines (
    id                  SERIAL PRIMARY KEY,
    pipeline_id         VARCHAR(100) UNIQUE NOT NULL,
    name                VARCHAR(255) NOT NULL,
    orchestrator        VARCHAR(42) NOT NULL,
    total_budget_usdc   NUMERIC(18,6) NOT NULL,
    status              VARCHAR(50) DEFAULT 'pending',
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipelines_pipeline_id ON pipelines (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines (status);

-- Pipeline nodes table
CREATE TABLE IF NOT EXISTS pipeline_nodes (
    id                  SERIAL PRIMARY KEY,
    pipeline_id         VARCHAR(100) NOT NULL,
    node_id             VARCHAR(100) NOT NULL,
    name                VARCHAR(255) NOT NULL,
    capability          VARCHAR(255),
    agent_id            BIGINT,
    budget_usdc         NUMERIC(18,6) DEFAULT 0,
    status              VARCHAR(50) DEFAULT 'pending',
    depends_on          TEXT[] DEFAULT '{}',
    result              JSONB,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_node_pipeline FOREIGN KEY (pipeline_id) REFERENCES pipelines(pipeline_id) ON DELETE CASCADE,
    UNIQUE (pipeline_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_pipeline ON pipeline_nodes (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON pipeline_nodes (status);

-- Private intents table
CREATE TABLE IF NOT EXISTS private_intents (
    id                  SERIAL PRIMARY KEY,
    intent_id           VARCHAR(100) UNIQUE NOT NULL,
    commitment_hash     VARCHAR(66) NOT NULL,
    submitter_address   VARCHAR(42) NOT NULL,
    capability          VARCHAR(255) NOT NULL,
    max_budget_usdc     NUMERIC(18,6) NOT NULL,
    status              VARCHAR(50) DEFAULT 'pending',
    encrypted_payload   TEXT NOT NULL,
    capability_vector   NUMERIC[] DEFAULT '{}',
    matched_agents      JSONB DEFAULT '[]',
    selected_agent      VARCHAR(100),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at          TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_intents_intent_id ON private_intents (intent_id);
CREATE INDEX IF NOT EXISTS idx_intents_submitter ON private_intents (submitter_address);
CREATE INDEX IF NOT EXISTS idx_intents_status ON private_intents (status);
CREATE INDEX IF NOT EXISTS idx_intents_capability ON private_intents (capability);

-- AI decision log table
CREATE TABLE IF NOT EXISTS ai_decisions (
    id                  SERIAL PRIMARY KEY,
    agent_name          VARCHAR(100) NOT NULL,
    decision_type       VARCHAR(100) NOT NULL,
    input_data          JSONB,
    output_data         JSONB,
    confidence          NUMERIC(5,4),
    execution_time_ms   INTEGER,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_agent ON ai_decisions (agent_name);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_type ON ai_decisions (decision_type);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_created ON ai_decisions (created_at DESC);
