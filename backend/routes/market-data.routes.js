/**
 * Market Data Routes - real-time pricing, trades, and prediction markets.
 * Uses DynamicPricingEngine for capability price discovery.
 * In-memory stores for trades and prediction markets.
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid') || { v4: () => `mkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` };

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/** @type {Map<string, { capability: string, basePrice: number, currentPrice: number, volatility: number, lastUpdated: string }>} */
const capabilityPrices = new Map();

/** @type {Array<{ tradeId: string, capability: string, price: number, buyer: string, seller: string, timestamp: string }>} */
const trades = [];

/** @type {Map<string, object>} */
const predictionMarkets = new Map();

// Seed some default capability prices
const DEFAULT_CAPABILITIES = [
  { capability: 'text-generation', basePrice: 0.05, volatility: 0.12 },
  { capability: 'image-generation', basePrice: 0.15, volatility: 0.18 },
  { capability: 'code-review', basePrice: 0.08, volatility: 0.10 },
  { capability: 'data-analysis', basePrice: 0.12, volatility: 0.15 },
  { capability: 'translation', basePrice: 0.04, volatility: 0.08 },
];

DEFAULT_CAPABILITIES.forEach((cap) => {
  capabilityPrices.set(cap.capability, {
    capability: cap.capability,
    basePrice: cap.basePrice,
    currentPrice: cap.basePrice,
    volatility: cap.volatility,
    lastUpdated: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Simple dynamic pricing: applies a random walk based on volatility and
 * demand (number of recent trades for the capability).
 */
function refreshPrice(entry) {
  const recentDemand = trades.filter(
    (t) => t.capability === entry.capability && Date.now() - new Date(t.timestamp).getTime() < 3600_000
  ).length;
  const demandFactor = 1 + recentDemand * 0.01;
  const noise = (Math.random() - 0.5) * 2 * entry.volatility;
  const newPrice = Math.max(0.001, entry.basePrice * demandFactor * (1 + noise));
  entry.currentPrice = Math.round(newPrice * 10000) / 10000;
  entry.lastUpdated = new Date().toISOString();
  return entry;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /market/prices
 * Returns all capability prices with dynamic adjustments.
 */
router.get('/prices', async (req, res, next) => {
  try {
    const prices = [];
    for (const [, entry] of capabilityPrices) {
      prices.push(refreshPrice(entry));
    }
    res.json({ success: true, count: prices.length, prices });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /market/trades
 * Returns recent trades, optionally filtered by capability.
 * Query params: ?capability=text-generation&limit=50
 */
router.get('/trades', async (req, res, next) => {
  try {
    const { capability, limit } = req.query;
    let result = [...trades];

    if (capability) {
      result = result.filter((t) => t.capability === capability);
    }

    const max = Math.min(parseInt(limit, 10) || 50, 200);
    result = result.slice(-max).reverse();

    res.json({ success: true, count: result.length, trades: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /market/prediction-markets
 * Returns all active prediction markets.
 */
router.get('/prediction-markets', async (req, res, next) => {
  try {
    const markets = [];
    for (const [, market] of predictionMarkets) {
      if (market.status === 'active') {
        markets.push(market);
      }
    }
    res.json({ success: true, count: markets.length, markets });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /market/prediction-markets/:marketId
 * Returns details for a specific prediction market.
 */
router.get('/prediction-markets/:marketId', async (req, res, next) => {
  try {
    const { marketId } = req.params;
    const market = predictionMarkets.get(marketId);

    if (!market) {
      return res.status(404).json({ error: `Prediction market ${marketId} not found` });
    }

    res.json({ success: true, market });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /market/prediction-markets/:marketId/bet
 * Place a bet on a prediction market outcome.
 * Body: { walletAddress, outcome ('yes' | 'no'), amount }
 */
router.post('/prediction-markets/:marketId/bet', async (req, res, next) => {
  try {
    const { marketId } = req.params;
    const { walletAddress, outcome, amount } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }
    if (!outcome || !['yes', 'no'].includes(outcome)) {
      return res.status(400).json({ error: "outcome must be 'yes' or 'no'" });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    let market = predictionMarkets.get(marketId);

    // Auto-create market if it doesn't exist (convenience for demos)
    if (!market) {
      market = {
        marketId,
        question: `Will capability demand exceed baseline? (${marketId})`,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
        totalYes: 0,
        totalNo: 0,
        bets: [],
      };
      predictionMarkets.set(marketId, market);
    }

    if (market.status !== 'active') {
      return res.status(409).json({ error: 'Market is no longer active' });
    }

    const bet = {
      betId: generateId('bet'),
      walletAddress,
      outcome,
      amount: Number(amount),
      placedAt: new Date().toISOString(),
    };

    market.bets.push(bet);
    if (outcome === 'yes') market.totalYes += bet.amount;
    else market.totalNo += bet.amount;

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('market:prediction', {
        type: 'bet_placed',
        event: 'bet_placed',
        marketId,
        bet,
      });
    }

    res.status(201).json({
      success: true,
      betId: bet.betId,
      marketId,
      outcome,
      amount: bet.amount,
      totalYes: market.totalYes,
      totalNo: market.totalNo,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
