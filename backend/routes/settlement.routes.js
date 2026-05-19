/**
 * Settlement Routes - post-task settlement endpoints.
 */

const express = require('express');
const router = express.Router();
const SettlementService = require('../services/settlement.service');

const settlement = new SettlementService();

/**
 * POST /settle
 * Settle a completed task (release funds, update reputation, handle yield).
 */
router.post('/settle', async (req, res, next) => {
  try {
    const { taskId, providerAgentId, qualityScore, yieldDeployed } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }
    if (!providerAgentId) {
      return res.status(400).json({ error: 'providerAgentId is required' });
    }

    const result = await settlement.settle({
      taskId,
      providerAgentId,
      qualityScore: qualityScore !== undefined ? Number(qualityScore) : undefined,
      yieldDeployed: Boolean(yieldDeployed),
    });

    const statusCode = result.settled ? 200 : 500;
    res.status(statusCode).json({ success: result.settled, settlement: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:taskId/status
 * Get settlement status for a task.
 */
router.get('/:taskId/status', async (req, res, next) => {
  try {
    const { taskId } = req.params;

    // Settlement status is derived from the escrow status
    // plus any cached settlement result
    const escrowStatus = await settlement.escrow.getEscrowStatus(taskId);

    const settled = escrowStatus.status === 'released';
    res.json({
      success: true,
      taskId,
      settled,
      escrowStatus: escrowStatus.status,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
