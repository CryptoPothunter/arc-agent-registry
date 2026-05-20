/**
 * Private Intent Routes - encrypted intent submission and AI matching.
 * Allows users to submit encrypted task intents, trigger AI-powered
 * matching with capable agents, and track intent status.
 */

const express = require('express');
const router = express.Router();

// ---------------------------------------------------------------------------
// Optional crypto setup for intent hashing
// ---------------------------------------------------------------------------

let cryptoModule = null;
try {
  cryptoModule = require('crypto');
} catch (err) {
  // crypto not available; fall back to simple hashing
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, {
 *   intentId: string,
 *   encryptedPayload: string,
 *   intentHash: string,
 *   submitter: string,
 *   capability: string,
 *   maxBudget: number,
 *   status: string,
 *   matchedAgents: Array<{ agentId: string, score: number, matchedAt: string }>,
 *   selectedAgent: string|null,
 *   createdAt: string,
 *   updatedAt: string,
 *   expiresAt: string
 * }>}
 */
const intents = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashPayload(payload) {
  if (cryptoModule) {
    return cryptoModule.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
  // Simple fallback hash
  const str = JSON.stringify(payload);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/**
 * Simulated AI matching algorithm.
 * In production this would query the agent registry and use embeddings
 * to match intent requirements with agent capabilities.
 */
function matchAgentsForIntent(intent) {
  const simulatedAgents = [
    { agentId: 'agent_alpha', capabilities: ['text-generation', 'code-review', 'translation'] },
    { agentId: 'agent_beta', capabilities: ['image-generation', 'data-analysis'] },
    { agentId: 'agent_gamma', capabilities: ['data-analysis', 'text-generation', 'code-review'] },
    { agentId: 'agent_delta', capabilities: ['translation', 'text-generation'] },
  ];

  const matches = simulatedAgents
    .map((agent) => {
      const capabilityMatch = agent.capabilities.includes(intent.capability) ? 0.7 : 0.1;
      const randomFactor = Math.random() * 0.3;
      const score = Math.round((capabilityMatch + randomFactor) * 100) / 100;

      return {
        agentId: agent.agentId,
        score,
        matchedAt: new Date().toISOString(),
      };
    })
    .filter((m) => m.score > 0.3)
    .sort((a, b) => b.score - a.score);

  return matches;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /intent/submit
 * Submit an encrypted task intent to the private market.
 * Body: { encryptedPayload, submitter, capability, maxBudget, expiresInMs? }
 */
router.post('/submit', async (req, res, next) => {
  try {
    const { encryptedPayload, submitter, capability, maxBudget, expiresInMs } = req.body;

    if (!encryptedPayload) {
      return res.status(400).json({ error: 'encryptedPayload is required' });
    }
    if (!submitter) {
      return res.status(400).json({ error: 'submitter (wallet address) is required' });
    }
    if (!capability) {
      return res.status(400).json({ error: 'capability is required' });
    }
    if (!maxBudget || isNaN(Number(maxBudget)) || Number(maxBudget) <= 0) {
      return res.status(400).json({ error: 'maxBudget must be a positive number' });
    }

    const intentId = generateId('intent');
    const ttl = expiresInMs || 3600_000; // default 1 hour

    const intent = {
      intentId,
      encryptedPayload,
      intentHash: hashPayload(encryptedPayload),
      submitter,
      capability,
      maxBudget: Number(maxBudget),
      status: 'pending',
      matchedAgents: [],
      selectedAgent: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl).toISOString(),
    };

    intents.set(intentId, intent);

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('intent:submitted', {
        type: 'intent_submitted',
        event: 'intent_submitted',
        intentId,
        capability,
        intentHash: intent.intentHash,
      });
    }

    res.status(201).json({
      success: true,
      intentId,
      intentHash: intent.intentHash,
      status: 'pending',
      expiresAt: intent.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /intent/:intentId/match
 * Trigger AI matching for an intent.
 * Finds the best-fit agents and optionally auto-selects the top match.
 * Body: { autoSelect? }
 */
router.post('/:intentId/match', async (req, res, next) => {
  try {
    const { intentId } = req.params;
    const { autoSelect } = req.body;

    const intent = intents.get(intentId);
    if (!intent) {
      return res.status(404).json({ error: `Intent ${intentId} not found` });
    }

    if (intent.status === 'expired') {
      return res.status(409).json({ error: 'Intent has expired' });
    }

    // Check expiry
    if (new Date(intent.expiresAt) < new Date()) {
      intent.status = 'expired';
      intent.updatedAt = new Date().toISOString();
      return res.status(409).json({ error: 'Intent has expired' });
    }

    const matches = matchAgentsForIntent(intent);
    intent.matchedAgents = matches;
    intent.status = 'matched';
    intent.updatedAt = new Date().toISOString();

    if (autoSelect && matches.length > 0) {
      intent.selectedAgent = matches[0].agentId;
      intent.status = 'assigned';
    }

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('intent:matched', {
        type: 'intent_matched',
        event: 'intent_matched',
        intentId,
        matchCount: matches.length,
        selectedAgent: intent.selectedAgent,
      });
    }

    res.json({
      success: true,
      intentId,
      status: intent.status,
      matchCount: matches.length,
      matches,
      selectedAgent: intent.selectedAgent,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /intent/:intentId
 * Get intent status and match results.
 */
router.get('/:intentId', async (req, res, next) => {
  try {
    const { intentId } = req.params;
    const intent = intents.get(intentId);

    if (!intent) {
      return res.status(404).json({ error: `Intent ${intentId} not found` });
    }

    // Auto-expire check
    if (intent.status !== 'expired' && new Date(intent.expiresAt) < new Date()) {
      intent.status = 'expired';
      intent.updatedAt = new Date().toISOString();
    }

    res.json({
      success: true,
      intent: {
        intentId: intent.intentId,
        intentHash: intent.intentHash,
        submitter: intent.submitter,
        capability: intent.capability,
        maxBudget: intent.maxBudget,
        status: intent.status,
        matchedAgents: intent.matchedAgents,
        selectedAgent: intent.selectedAgent,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt,
        expiresAt: intent.expiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
