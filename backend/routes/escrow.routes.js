/**
 * Escrow Routes - task escrow management endpoints.
 */

const express = require('express');
const router = express.Router();
const EscrowService = require('../services/escrow.service');

const escrow = new EscrowService();

/**
 * POST /deposit
 * Lock funds in escrow for a task.
 */
router.post('/deposit', async (req, res, next) => {
  try {
    const { taskId, negotiationId, amount, deadline, providerAddress, agreementHash, signature } = req.body;

    if (!providerAddress) {
      return res.status(400).json({ error: 'providerAddress is required' });
    }
    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'amount is required and must be a valid number' });
    }
    if (!deadline || typeof deadline !== 'number') {
      return res.status(400).json({ error: 'deadline is required and must be a unix timestamp' });
    }

    const result = await escrow.depositFunds({
      provider: providerAddress,
      amount: String(amount),
      deadline,
      clientAddress: req.body.clientAddress,
      taskId,
      negotiationId,
      agreementHash,
      signature,
    });

    // Notify via WebSocket
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify(`agent:${providerAddress}:negotiation`, {
        event: 'escrow_deposited',
        taskId: result.taskId,
        amount: result.amount,
      });
    }

    res.status(201).json({ success: true, escrow: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:taskId/release
 * Release escrowed funds to the provider.
 */
router.post('/:taskId/release', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { rating, feedback, signature } = req.body;
    const result = await escrow.releaseFunds(taskId, { rating, feedback, signature });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Cannot release')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /:taskId/dispute
 * Raise a dispute on an escrowed task.
 */
router.post('/:taskId/dispute', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { reason, signature } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await escrow.raiseDispute(taskId, reason, signature);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Cannot dispute')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /:taskId/status
 * Get escrow status for a task.
 */
router.get('/:taskId/status', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const status = await escrow.getEscrowStatus(taskId);
    res.json({ success: true, escrow: status });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
