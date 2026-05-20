/**
 * Registry Routes - agent registration and management endpoints.
 * #16: Added signature verification middleware.
 * #26: Renamed 'available' to 'isOnline' in availability endpoint.
 */

const express = require('express');
const router = express.Router();
const RegistryService = require('../services/registry.service');
const { verifySignature } = require('../middleware/auth.middleware');

const registry = new RegistryService();

/**
 * POST /register
 * Register a new agent in the registry.
 * #16: Signature verification (optional in dev mode)
 */
router.post('/register', verifySignature({ addressField: 'walletAddress', optional: true }), async (req, res, next) => {
  try {
    const { metadata, walletAddress, signature } = req.body;

    if (!metadata) {
      return res.status(400).json({ error: 'metadata is required' });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const agent = await registry.registerAgent({ metadata, walletAddress, signature });

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('registry:new_agents', {
        type: 'agent_registered',
        event: 'agent_registered',
        agent: { agentId: agent.agentId, name: agent.metadata?.name },
      });
    }

    res.status(201).json({
      success: true,
      agentId: agent.agentId,
      metadataCID: agent.metadataURI,
      txHash: agent.txHash || null,
      registeredAt: agent.registeredAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /agents/:agentId
 * Get agent details by ID.
 */
router.get('/agents/:agentId', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const agent = await registry.getAgentInfo(agentId);
    res.json({ success: true, ...agent });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * PATCH /agents/:agentId/availability
 * Update an agent's availability status.
 * #16: Signature verification (optional in dev mode)
 * #26: Changed 'available' to 'isOnline'
 */
router.patch('/agents/:agentId/availability', verifySignature({ optional: true }), async (req, res, next) => {
  try {
    const { agentId } = req.params;
    // #26: Support both 'isOnline' (doc spec) and 'available' (legacy)
    const isOnline = req.body.isOnline !== undefined ? req.body.isOnline : req.body.available;

    if (typeof isOnline !== 'boolean') {
      return res.status(400).json({ error: 'isOnline must be a boolean' });
    }

    const result = await registry.updateAvailability(agentId, isOnline);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /agents
 * List all active agents.
 */
router.get('/agents', async (req, res, next) => {
  try {
    const agents = await registry.getAllActiveAgents();
    res.json({ success: true, count: agents.length, agents });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
