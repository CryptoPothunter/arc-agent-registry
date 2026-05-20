/**
 * Redis configuration and cache layer.
 * #29: Uses ioredis when REDIS_URL is set, falls back to in-memory Map.
 * All public API functions (getCache, setCache, delCache, syncOnChainEvent)
 * remain synchronous-compatible for backward compat.
 */

let Redis;
try {
  Redis = require('ioredis');
} catch {
  Redis = null;
}

const CACHE_KEYS = {
  AGENT_PREFIX: 'agent:',
  AGENT_LIST: 'agents:active',
  CAPABILITY_PREFIX: 'capability:',
  ESCROW_PREFIX: 'escrow:',
  NEGOTIATION_PREFIX: 'negotiation:',
  DISCOVERY_CACHE: 'discovery:cache:',
};

// --- In-memory fallback store ---
const memoryCache = new Map();

function memGet(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key, value, ttlSeconds = 300) {
  memoryCache.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

function memDel(key) {
  memoryCache.delete(key);
}

// --- ioredis client (if REDIS_URL is configured) ---
let redisClient = null;
let redisReady = false;

const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL && Redis) {
  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null; // stop retrying after 5 attempts
        return Math.min(times * 200, 2000);
      },
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      redisReady = true;
      console.log('[Redis] Connected to', REDIS_URL.replace(/\/\/.*@/, '//<redacted>@'));
    });

    redisClient.on('error', (err) => {
      console.warn('[Redis] Error:', err.message);
      redisReady = false;
    });

    redisClient.on('close', () => {
      redisReady = false;
    });
  } catch (err) {
    console.warn('[Redis] Failed to initialize ioredis, using in-memory fallback:', err.message);
    redisClient = null;
  }
} else {
  console.log('[Redis] No REDIS_URL configured, using in-memory cache');
}

/**
 * Get a cached value by key.
 * Tries Redis first (async but returns synchronously from memory mirror),
 * falls back to in-memory cache.
 */
function getCache(key) {
  // Always serve from memory for synchronous access
  const memValue = memGet(key);
  if (memValue !== null) return memValue;

  // If Redis is available, queue an async read to warm memory cache
  if (redisReady && redisClient) {
    redisClient.get(key).then((val) => {
      if (val) {
        try {
          const parsed = JSON.parse(val);
          memSet(key, parsed, 0); // mirror in memory
        } catch {
          memSet(key, val, 0);
        }
      }
    }).catch(() => {});
  }

  return null;
}

/**
 * Set a cached value.
 * Writes to both in-memory and Redis (if available).
 */
function setCache(key, value, ttlSeconds = 300) {
  memSet(key, value, ttlSeconds);

  if (redisReady && redisClient) {
    const serialized = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      redisClient.setex(key, ttlSeconds, serialized).catch(() => {});
    } else {
      redisClient.set(key, serialized).catch(() => {});
    }
  }
}

/**
 * Delete a cached value.
 */
function delCache(key) {
  memDel(key);
  if (redisReady && redisClient) {
    redisClient.del(key).catch(() => {});
  }
}

/**
 * Sync on-chain event data into the cache layer.
 * Called by event listeners when contract events are detected.
 */
async function syncOnChainEvent(eventName, data) {
  switch (eventName) {
    case 'AgentRegistered': {
      const key = `${CACHE_KEYS.AGENT_PREFIX}${data.agentId}`;
      setCache(key, data, 0);
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
  redisClient,
};
