/**
 * Agent Intelligence Routes - AI decision transparency and autonomous agent status.
 * Provides a queryable decision log and real-time WebSocket subscriptions
 * for 'ai_thinking' events so frontends can visualize agent reasoning.
 */

const express = require('express');
const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/**
 * Decision log entries.
 * @type {Array<{ decisionId: string, agentId: string, capability: string, action: string, reasoning: string, confidence: number, timestamp: string, metadata: object }>}
 */
const decisionLog = [];

/**
 * Autonomous agent statuses.
 * @type {Map<string, { agentId: string, status: string, currentTask: string|null, lastHeartbeat: string, decisionsCount: number, uptime: number, startedAt: string }>}
 */
const agentStatuses = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Record a decision (can be called internally by other modules).
 */
function recordDecision({ agentId, capability, action, reasoning, confidence, metadata }) {
  const entry = {
    decisionId: generateId('dec'),
    agentId,
    capability: capability || 'general',
    action,
    reasoning,
    confidence: typeof confidence === 'number' ? confidence : 0.5,
    timestamp: new Date().toISOString(),
    metadata: metadata || {},
  };
  decisionLog.push(entry);

  // Keep log bounded (last 10 000 entries)
  if (decisionLog.length > 10_000) {
    decisionLog.splice(0, decisionLog.length - 10_000);
  }

  return entry;
}

// Expose helper so other modules can import it
router._recordDecision = recordDecision;
router._agentStatuses = agentStatuses;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /ai/decisions
 * Returns the AI decision log with optional filters.
 * Query params: ?capability=text-generation&agentId=agent_xyz&limit=100
 */
router.get('/decisions', async (req, res, next) => {
  try {
    const { capability, agentId, limit } = req.query;
    let results = [...decisionLog];

    if (capability) {
      results = results.filter((d) => d.capability === capability);
    }
    if (agentId) {
      results = results.filter((d) => d.agentId === agentId);
    }

    const max = Math.min(parseInt(limit, 10) || 100, 500);
    results = results.slice(-max).reverse();

    res.json({ success: true, count: results.length, decisions: results });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /ai/status
 * Returns the status of all tracked autonomous agents.
 */
router.get('/status', async (req, res, next) => {
  try {
    const agents = [];
    for (const [, status] of agentStatuses) {
      agents.push({
        ...status,
        uptime: Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000),
      });
    }
    res.json({ success: true, count: agents.length, agents });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /ai/decisions (internal / dev convenience)
 * Manually push a decision entry (useful for testing the transparency log).
 * Body: { agentId, capability, action, reasoning, confidence, metadata }
 */
router.post('/decisions', async (req, res, next) => {
  try {
    const { agentId, capability, action, reasoning, confidence, metadata } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    const entry = recordDecision({ agentId, capability, action, reasoning, confidence, metadata });

    // Emit WebSocket ai_thinking event
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('ai:thinking', {
        type: 'ai_thinking',
        event: 'ai_thinking',
        decision: entry,
      });
    }

    res.status(201).json({ success: true, decision: entry });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /ai/status (internal / dev convenience)
 * Register or update an autonomous agent's status.
 * Body: { agentId, status, currentTask }
 */
router.post('/status', async (req, res, next) => {
  try {
    const { agentId, status, currentTask } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    const existing = agentStatuses.get(agentId);
    const entry = {
      agentId,
      status: status || 'idle',
      currentTask: currentTask || null,
      lastHeartbeat: new Date().toISOString(),
      decisionsCount: existing ? existing.decisionsCount + 1 : 0,
      startedAt: existing ? existing.startedAt : new Date().toISOString(),
    };

    agentStatuses.set(agentId, entry);

    res.json({ success: true, agent: { ...entry, uptime: Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
