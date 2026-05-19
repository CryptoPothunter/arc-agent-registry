-- Arc Agent Registry - Database Schema

CREATE TABLE IF NOT EXISTS agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  VARCHAR(42) NOT NULL UNIQUE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    metadata_cid    VARCHAR(255),
    reputation      NUMERIC(5,2) DEFAULT 0.00,
    availability    BOOLEAN DEFAULT TRUE,
    registered_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agents_wallet ON agents (wallet_address);
CREATE INDEX idx_agents_availability ON agents (availability);
CREATE INDEX idx_agents_reputation ON agents (reputation DESC);

CREATE TABLE IF NOT EXISTS capabilities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    price_min   NUMERIC(18,6),
    price_max   NUMERIC(18,6),
    currency    VARCHAR(10) DEFAULT 'USDC',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_capabilities_agent ON capabilities (agent_id);
CREATE INDEX idx_capabilities_name ON capabilities (name);

CREATE TABLE IF NOT EXISTS negotiations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id    UUID NOT NULL REFERENCES agents(id),
    provider_id     UUID NOT NULL REFERENCES agents(id),
    capability_id   UUID NOT NULL REFERENCES capabilities(id),
    proposed_price  NUMERIC(18,6) NOT NULL,
    counter_price   NUMERIC(18,6),
    final_price     NUMERIC(18,6),
    status          VARCHAR(50) DEFAULT 'pending',
    rounds          INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_negotiations_requester ON negotiations (requester_id);
CREATE INDEX idx_negotiations_provider ON negotiations (provider_id);
CREATE INDEX idx_negotiations_status ON negotiations (status);

CREATE TABLE IF NOT EXISTS tasks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negotiation_id    UUID NOT NULL REFERENCES negotiations(id),
    requester_id      UUID NOT NULL REFERENCES agents(id),
    provider_id       UUID NOT NULL REFERENCES agents(id),
    escrow_tx_hash    VARCHAR(66),
    amount            NUMERIC(18,6) NOT NULL,
    status            VARCHAR(50) DEFAULT 'created',
    result_cid        VARCHAR(255),
    quality_score     NUMERIC(5,2),
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at      TIMESTAMP WITH TIME ZONE,
    settled_at        TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_tasks_requester ON tasks (requester_id);
CREATE INDEX idx_tasks_provider ON tasks (provider_id);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_negotiation ON tasks (negotiation_id);
