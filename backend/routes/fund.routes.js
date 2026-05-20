/**
 * Fund Routes - Agent investment fund management.
 * Allows creation of investment funds, investing in them,
 * and querying fund details by fund ID or agent ID.
 */

const express = require('express');
const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, {
 *   fundId: string,
 *   name: string,
 *   agentId: string,
 *   description: string,
 *   totalDeposited: number,
 *   investors: Array<{ walletAddress: string, amount: number, investedAt: string }>,
 *   performance: number,
 *   status: string,
 *   createdAt: string,
 *   updatedAt: string
 * }>}
 */
const funds = new Map();

/** Index: agentId -> fundId for fast lookup */
const agentFundIndex = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /fund/create
 * Create a new investment fund for an agent.
 * Body: { name, agentId, description?, initialDeposit? }
 */
router.post('/create', async (req, res, next) => {
  try {
    const { name, agentId, description, initialDeposit } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    // One fund per agent
    if (agentFundIndex.has(agentId)) {
      return res.status(409).json({
        error: `Agent ${agentId} already has a fund`,
        existingFundId: agentFundIndex.get(agentId),
      });
    }

    const fundId = generateId('fund');
    const deposit = initialDeposit ? Number(initialDeposit) : 0;

    const fund = {
      fundId,
      name,
      agentId,
      description: description || '',
      totalDeposited: deposit,
      investors: [],
      performance: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    funds.set(fundId, fund);
    agentFundIndex.set(agentId, fundId);

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('fund:created', {
        type: 'fund_created',
        event: 'fund_created',
        fundId,
        agentId,
        name,
      });
    }

    res.status(201).json({
      success: true,
      fundId,
      name,
      agentId,
      totalDeposited: fund.totalDeposited,
      status: fund.status,
      createdAt: fund.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /fund/:fundId/invest
 * Invest in an existing fund.
 * Body: { walletAddress, amount }
 */
router.post('/:fundId/invest', async (req, res, next) => {
  try {
    const { fundId } = req.params;
    const { walletAddress, amount } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const fund = funds.get(fundId);
    if (!fund) {
      return res.status(404).json({ error: `Fund ${fundId} not found` });
    }
    if (fund.status !== 'active') {
      return res.status(409).json({ error: 'Fund is not currently accepting investments' });
    }

    const investmentAmount = Number(amount);
    const investment = {
      walletAddress,
      amount: investmentAmount,
      investedAt: new Date().toISOString(),
    };

    fund.investors.push(investment);
    fund.totalDeposited += investmentAmount;
    fund.updatedAt = new Date().toISOString();

    // Simulate small performance bump from new investment
    fund.performance = Math.round((fund.performance + Math.random() * 0.5) * 100) / 100;

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify(`fund:${fundId}`, {
        type: 'investment_received',
        event: 'investment_received',
        fundId,
        walletAddress,
        amount: investmentAmount,
        totalDeposited: fund.totalDeposited,
      });
    }

    res.status(201).json({
      success: true,
      fundId,
      walletAddress,
      amountInvested: investmentAmount,
      totalDeposited: fund.totalDeposited,
      investorCount: fund.investors.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /fund/:fundId
 * Get fund details by fund ID.
 */
router.get('/:fundId', async (req, res, next) => {
  try {
    const { fundId } = req.params;
    const fund = funds.get(fundId);

    if (!fund) {
      return res.status(404).json({ error: `Fund ${fundId} not found` });
    }

    res.json({
      success: true,
      fund: {
        ...fund,
        investorCount: fund.investors.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /fund/agent/:agentId
 * Get fund details by agent ID.
 */
router.get('/agent/:agentId', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const fundId = agentFundIndex.get(agentId);

    if (!fundId) {
      return res.status(404).json({ error: `No fund found for agent ${agentId}` });
    }

    const fund = funds.get(fundId);
    if (!fund) {
      return res.status(404).json({ error: `Fund ${fundId} not found` });
    }

    res.json({
      success: true,
      fund: {
        ...fund,
        investorCount: fund.investors.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
