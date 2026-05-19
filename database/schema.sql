-- Arc Agent Registry - Database Schema

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
    agent_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_address     VARCHAR(42) NOT NULL,
    wallet_address    VARCHAR(42) NOT NULL UNIQUE,
    name              VARCHAR(255) NOT NULL,
    metadata_cid      VARCHAR(255),
    is_active         BOOLEAN DEFAULT TRUE,
    reputation_score  NUMERIC(5,2) DEFAULT 0.00,
    total_tasks       INTEGER DEFAULT 0,
    registered_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agents_wallet ON agents (wallet_address);
CREATE INDEX idx_agents_owner ON agents (owner_address);
CREATE INDEX idx_agents_is_active ON agents (is_active);
CREATE INDEX idx_agents_reputation ON agents (reputation_score DESC);

-- Capabilities table
CREATE TABLE IF NOT EXISTS capabilities (
    capability_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id          UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    name              VARCHAR(255) NOT NULL,
    description       TEXT,
    base_price_usdc   NUMERIC(18,6) NOT NULL,
    capability_hash   VARCHAR(66)
);

CREATE INDEX idx_capabilities_agent ON capabilities (agent_id);
CREATE INDEX idx_capabilities_name ON capabilities (name);
CREATE INDEX idx_capabilities_hash ON capabilities (capability_hash);

-- Negotiations table
CREATE TABLE IF NOT EXISTS negotiations (
    negotiation_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_address   VARCHAR(42) NOT NULL,
    provider_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
    task_description    TEXT,
    status              VARCHAR(50) DEFAULT 'pending',
    offered_price       NUMERIC(18,6) NOT NULL,
    agreed_price        NUMERIC(18,6),
    agreement_hash      VARCHAR(66),
    rounds              INTEGER DEFAULT 0,
    expires_at          TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_negotiations_requester ON negotiations (requester_address);
CREATE INDEX idx_negotiations_provider ON negotiations (provider_agent_id);
CREATE INDEX idx_negotiations_status ON negotiations (status);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    task_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negotiation_id      UUID NOT NULL REFERENCES negotiations(negotiation_id),
    requester_address   VARCHAR(42) NOT NULL,
    provider_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
    amount_usdc         NUMERIC(18,6) NOT NULL,
    status              VARCHAR(50) DEFAULT 'created',
    escrow_tx_hash      VARCHAR(66),
    release_tx_hash     VARCHAR(66),
    deadline            TIMESTAMP WITH TIME ZONE,
    rating              NUMERIC(3,1),
    feedback            TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tasks_negotiation ON tasks (negotiation_id);
CREATE INDEX idx_tasks_requester ON tasks (requester_address);
CREATE INDEX idx_tasks_provider ON tasks (provider_agent_id);
CREATE INDEX idx_tasks_status ON tasks (status);

-- Reputation history table
CREATE TABLE IF NOT EXISTS reputation_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    rating          NUMERIC(3,1) NOT NULL,
    rater_address   VARCHAR(42) NOT NULL,
    task_id         UUID NOT NULL REFERENCES tasks(task_id),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reputation_agent ON reputation_history (agent_id);
CREATE INDEX idx_reputation_task ON reputation_history (task_id);
CREATE INDEX idx_reputation_created ON reputation_history (created_at DESC);
