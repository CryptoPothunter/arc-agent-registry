/**
 * Negotiation Routes - agent-to-agent negotiation endpoints.
 */

const express = require('express');
const router = express.Router();
const { NegotiationAgent } = require('../agents/negotiation.agent');

// Instantiated with wsNotify in server.js via app.locals
let negotiationAgent = null;

function getAgent(req) {
  if (!negotiationAgent) {
    negotiationAgent = new NegotiationAgent({
      wsNotify: req.app.locals.wsNotify || (() => {}),
    });
  }
  return negotiationAgent;
}

/**
 * POST /propose
 * Submit a negotiation proposal.
 */
router.post('/propose', async (req, res, next) => {
  try {
    const agent = getAgent(req);
    const {
      fromAgentId,
      toAgentId,
      taskDescription,
      proposedPrice,
      deadline,
      agentConfig,
    } = req.body;

    if (!fromAgentId || !toAgentId) {
      return res.status(400).json({ error: 'fromAgentId and toAgentId are required' });
    }
    if (!taskDescription) {
      return res.status(400).json({ error: 'taskDescription is required' });
    }
    if (proposedPrice === undefined || typeof proposedPrice !== 'number') {
      return res.status(400).json({ error: 'proposedPrice must be a number' });
    }

    const negotiationId = `neg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await agent.handleIncomingProposal({
      negotiationId,
      fromAgentId,
      toAgentId,
      taskDescription,
      proposedPrice,
      deadline: deadline || Math.floor(Date.now() / 1000) + 86400,
      agentConfig: agentConfig || {},
    });

    res.status(201).json({ success: true, negotiation: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:negotiationId/status
 * Get the current status of a negotiation.
 */
router.get('/:negotiationId/status', async (req, res, next) => {
  try {
    const agent = getAgent(req);
    const { negotiationId } = req.params;
    const negotiation = agent.getStatus(negotiationId);
    res.json({ success: true, negotiation });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /:negotiationId/respond
 * Respond to a negotiation (accept, counter, reject).
 */
router.post('/:negotiationId/respond', async (req, res, next) => {
  try {
    const agent = getAgent(req);
    const { negotiationId } = req.params;
    const { action, counterPrice, reason, fromAgentId } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'action is required (accept, counter, reject)' });
    }

    let result;

    switch (action) {
      case 'accept':
        result = await agent.acceptProposal(negotiationId);
        break;

      case 'counter':
        if (counterPrice === undefined || typeof counterPrice !== 'number') {
          return res.status(400).json({ error: 'counterPrice is required for counter action' });
        }
        result = await agent.handleCounterOffer(negotiationId, fromAgentId, counterPrice);
        break;

      case 'reject':
        result = await agent.rejectProposal(negotiationId, reason || 'Rejected');
        break;

      default:
        return res.status(400).json({ error: `Unknown action: ${action}. Use accept, counter, or reject.` });
    }

    res.json({ success: true, negotiation: result });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
