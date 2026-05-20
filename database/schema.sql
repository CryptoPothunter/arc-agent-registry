-- Arc Agent Registry - Database Schema
-- #31: agents.agent_id uses BIGINT UNIQUE NOT NULL, reputation_score uses DECIMAL(3,2)
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
    reputation_score  DECIMAL(3,2) DEFAULT 0.00,
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
