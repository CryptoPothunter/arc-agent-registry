/**
 * Redis configuration and cache key definitions.
 * In production, replace the in-memory store with a real Redis client.
 */

const CACHE_KEYS = {
  AGENT_PREFIX: 'agent:',
  AGENT_LIST: 'agents:active',
  CAPABILITY_PREFIX: 'capability:',
  ESCROW_PREFIX: 'escrow:',
  NEGOTIATION_PREFIX: 'negotiation:',
  DISCOVERY_CACHE: 'discovery:cache:',
};

// In-memory cache (swap for ioredis in production)
const cache = new Map();

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlSeconds = 300) {
  cache.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

function delCache(key) {
  cache.delete(key);
}

/**
 * Sync on-chain event data into the cache layer.
 * Called by event listeners when contract events are detected.
 */
async function syncOnChainEvent(eventName, data) {
  switch (eventName) {
    case 'AgentRegistered': {
      const key = `${CACHE_KEYS.AGENT_PREFIX}${data.agentId}`;
      setCache(key, data, 0); // no expiry for agent records
      // Update active agents list
      const list = getCache(CACHE_KEYS.AGENT_LIST) || [];
      list.push(data.agentId.toString());
      setCache(CACHE_KEYS.AGENT_LIST, list, 0);
      break;
    }
    case 'AvailabilityChanged': {
      const key = `${CACHE_KEYS.AGENT_PREFIX}${data.agentId}`;
      const agent = getCache(key);
      if (agent) {
        agent.available = data.available;
        setCache(key, agent, 0);
      }
      break;
    }
    case 'ReputationUpdated': {
      const key = `${CACHE_KEYS.AGENT_PREFIX}${data.agentId}`;
      const agent = getCache(key);
      if (agent) {
        agent.reputationScore = data.newScore;
        setCache(key, agent, 0);
      }
      break;
    }
    case 'Deposited': {
      const key = `${CACHE_KEYS.ESCROW_PREFIX}${data.taskId}`;
      setCache(key, { ...data, status: 'locked' }, 0);
      break;
    }
    case 'Released': {
      const key = `${CACHE_KEYS.ESCROW_PREFIX}${data.taskId}`;
      const escrow = getCache(key);
      if (escrow) {
        escrow.status = 'released';
        setCache(key, escrow, 0);
      }
      break;
    }
    case 'Disputed': {
      const key = `${CACHE_KEYS.ESCROW_PREFIX}${data.taskId}`;
      const escrow = getCache(key);
      if (escrow) {
        escrow.status = 'disputed';
        escrow.reason = data.reason;
        setCache(key, escrow, 0);
      }
      break;
    }
    default:
      console.warn(`[Cache] Unknown event: ${eventName}`);
  }
}

module.exports = {
  CACHE_KEYS,
  getCache,
  setCache,
  delCache,
  syncOnChainEvent,
};
