/**
 * Escrow Routes - task escrow management endpoints.
 * #16: Added signature verification middleware.
 * #22: release response includes settlementTime, providerReceived, platformFee.
 * #23: deposit response includes escrowId and unlockConditions.
 */

const express = require('express');
const router = express.Router();
const EscrowService = require('../services/escrow.service');
const { verifySignature } = require('../middleware/auth.middleware');

const escrow = new EscrowService();

/**
 * POST /deposit
 * Lock funds in escrow for a task.
 * #16: Signature verification (optional in dev mode)
 * #23: Response includes escrowId and unlockConditions
 */
router.post('/deposit', verifySignature({ addressField: 'clientAddress', optional: true }), async (req, res, next) => {
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

    // Notify via WebSocket (#28: escrow_locked event)
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify(`agent:${providerAddress}:task`, {
        type: 'escrow_locked',
        event: 'escrow_locked',
        taskId: result.taskId,
        amount: result.amount,
      });
    }

    // #23: Include escrowId and unlockConditions in response
    res.status(201).json({
      success: true,
      escrowId: `escrow_${result.taskId}`,
      taskId: result.taskId,
      amount: result.amount,
      status: result.status,
      txHash: result.txHash || null,
      unlockConditions: 'requester_approval_or_timeout',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:taskId/release
 * Release escrowed funds to the provider.
 * #16: Signature verification (optional in dev mode)
 * #22: Response includes settlementTime, providerReceived, platformFee
 */
router.post('/:taskId/release', verifySignature({ optional: true }), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { rating, feedback, signature } = req.body;

    const startTime = Date.now();
    const result = await escrow.releaseFunds(taskId, { rating, feedback, signature });
    const settlementTime = Date.now() - startTime;

    // #22: Calculate providerReceived and platformFee
    const escrowStatus = await escrow.getEscrowStatus(taskId).catch(() => null);
    const amount = escrowStatus ? parseFloat(escrowStatus.amount) : 0;
    const feeRate = 0.005; // 0.5%
    const platformFee = Math.round(amount * feeRate * 10000) / 10000;
    const providerReceived = Math.round((amount - platformFee) * 10000) / 10000;

    // Notify via WebSocket (#28: task_completed event)
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify(`task:${taskId}`, {
        type: 'task_completed',
        event: 'task_completed',
        taskId,
        status: 'released',
      });
    }

    res.json({
      success: true,
      taskId: result.taskId || taskId,
      status: 'released',
      settlementTime: `${settlementTime}ms`,
      txHash: result.txHash || null,
      providerReceived: providerReceived.toString(),
      platformFee: platformFee.toString(),
    });
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
 * #16: Signature verification (optional in dev mode)
 */
router.post('/:taskId/dispute', verifySignature({ optional: true }), async (req, res, next) => {
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
