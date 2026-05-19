/**
 * Registry Routes - agent registration and management endpoints.
 */

const express = require('express');
const router = express.Router();
const RegistryService = require('../services/registry.service');

const registry = new RegistryService();

/**
 * POST /register
 * Register a new agent in the registry.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { metadata, walletAddress } = req.body;

    if (!metadata) {
      return res.status(400).json({ error: 'metadata is required' });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const agent = await registry.registerAgent({ metadata, walletAddress });

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('registry:new_agents', {
        event: 'agent_registered',
        agent: { agentId: agent.agentId, name: agent.metadata?.name },
      });
    }

    res.status(201).json({ success: true, agent });
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
    res.json({ success: true, agent });
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
 */
router.patch('/agents/:agentId/availability', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const { available } = req.body;

    if (typeof available !== 'boolean') {
      return res.status(400).json({ error: 'available must be a boolean' });
    }

    const result = await registry.updateAvailability(agentId, available);
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
