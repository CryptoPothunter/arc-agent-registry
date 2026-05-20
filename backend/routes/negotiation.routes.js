/**
 * Negotiation Routes - agent-to-agent negotiation endpoints.
 * #16: Added signature verification.
 * #25: Field names aligned with doc spec (requesterId, providerId, offeredPrice, capability, input).
 */

const express = require('express');
const router = express.Router();
const { NegotiationAgent } = require('../agents/negotiation.agent');
const { verifySignature } = require('../middleware/auth.middleware');

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
 * #25: Support both doc-style and legacy field names.
 */
router.post('/propose', verifySignature({ addressField: 'requesterId', optional: true }), async (req, res, next) => {
  try {
    const agent = getAgent(req);
    const {
      // Doc-style field names (#25)
      requesterId,
      providerId,
      capability,
      input,
      offeredPrice,
      // Legacy field names (backward compat)
      fromAgentId,
      toAgentId,
      proposedPrice,
      // Common
      taskDescription,
      deadline,
      agentConfig,
    } = req.body;

    // Normalize field names
    const reqId = requesterId || fromAgentId;
    const provId = providerId || toAgentId;
    const price = offeredPrice || proposedPrice;

    if (!reqId || !provId) {
      return res.status(400).json({ error: 'requesterId and providerId are required' });
    }
    if (!taskDescription) {
      return res.status(400).json({ error: 'taskDescription is required' });
    }
    if (price === undefined || typeof price !== 'number') {
      return res.status(400).json({ error: 'offeredPrice must be a number' });
    }

    const negotiationId = `neg_0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

    const result = await agent.handleIncomingProposal({
      negotiationId,
      requesterId: reqId,
      providerId: provId,
      capability: capability || '',
      taskDescription,
      input: input || {},
      offeredPrice: price,
      deadline: deadline || Math.floor(Date.now() / 1000) + 86400,
      agentConfig: agentConfig || {},
    });

    res.status(201).json({
      success: true,
      negotiationId: result.negotiationId,
      status: result.status,
      expiresAt: result.expiresAt,
    });
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

    res.json({
      success: true,
      negotiationId: negotiation.negotiationId,
      status: negotiation.status,
      agreedPrice: negotiation.agreedPrice || null,
      agreedDeadline: negotiation.deadline ? new Date(negotiation.deadline * 1000).toISOString() : null,
      agreementHash: negotiation.agreementHash || null,
      rounds: negotiation.round,
    });
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
router.post('/:negotiationId/respond', verifySignature({ optional: true }), async (req, res, next) => {
  try {
    const agent = getAgent(req);
    const { negotiationId } = req.params;
    const { action, counterPrice, reason, fromAgentId, requesterId } = req.body;

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
        result = await agent.handleCounterOffer(negotiationId, fromAgentId || requesterId, counterPrice);
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
