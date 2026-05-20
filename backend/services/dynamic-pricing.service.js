/**
 * DynamicPricingService - Dynamic pricing engine for agent capabilities.
 *
 * Provides market-aware pricing recommendations based on supply/demand dynamics,
 * recent transaction history, and sigmoid-based conversion probability modeling.
 * All data is stored in-memory (no database required).
 */

const MARKET_CONDITIONS = {
  BUYERS_MARKET: 'buyers_market',
  SELLERS_MARKET: 'sellers_market',
  BALANCED: 'balanced',
};

// Default price configuration per capability (in USDC)
const DEFAULT_PRICE_RANGES = {
  'text-generation': { min: 0.01, median: 0.05, max: 0.15 },
  'image-generation': { min: 0.05, median: 0.20, max: 0.50 },
  'code-review': { min: 0.10, median: 0.50, max: 1.50 },
  'data-analysis': { min: 0.20, median: 1.00, max: 3.00 },
  'translation': { min: 0.02, median: 0.10, max: 0.30 },
  'summarization': { min: 0.01, median: 0.05, max: 0.12 },
  'search': { min: 0.005, median: 0.02, max: 0.08 },
  'default': { min: 0.01, median: 0.10, max: 0.50 },
};

// Task complexity multipliers
const COMPLEXITY_MULTIPLIERS = {
  low: 0.5,
  medium: 1.0,
  high: 2.0,
  critical: 3.5,
};

class DynamicPricingService {
  constructor() {
    // Recent transactions: Map<capability, Array<{ price, timestamp, accepted }>>
    this._transactions = new Map();
    // Supply/demand counters: Map<capability, { supply, demand }>
    this._supplyDemand = new Map();
    // Maximum transactions to keep per capability
    this._maxTransactionHistory = 1000;
  }

  /**
   * Record a transaction for market analysis.
   * @param {string} capability - The capability type.
   * @param {number} price - Transaction price in USDC.
   * @param {boolean} accepted - Whether the transaction was accepted.
   */
  recordTransaction(capability, price, accepted = true) {
    if (!this._transactions.has(capability)) {
      this._transactions.set(capability, []);
    }

    const txList = this._transactions.get(capability);
    txList.push({
      price,
      accepted,
      timestamp: Date.now(),
    });

    // Trim old transactions
    if (txList.length > this._maxTransactionHistory) {
      txList.splice(0, txList.length - this._maxTransactionHistory);
    }

    console.log(`[DynamicPricing] Recorded transaction: capability=${capability}, price=${price}, accepted=${accepted}`);
  }

  /**
   * Update supply/demand metrics for a capability.
   * @param {string} capability - The capability type.
   * @param {object} params
   * @param {number} [params.supplyDelta] - Change in supply count.
   * @param {number} [params.demandDelta] - Change in demand count.
   */
  updateSupplyDemand(capability, { supplyDelta = 0, demandDelta = 0 } = {}) {
    if (!this._supplyDemand.has(capability)) {
      this._supplyDemand.set(capability, { supply: 10, demand: 10 });
    }

    const sd = this._supplyDemand.get(capability);
    sd.supply = Math.max(1, sd.supply + supplyDelta);
    sd.demand = Math.max(0, sd.demand + demandDelta);

    console.log(`[DynamicPricing] Supply/demand updated: capability=${capability}, supply=${sd.supply}, demand=${sd.demand}`);
  }

  /**
   * Get the current market condition for a capability.
   * @param {string} capability - The capability type.
   * @returns {string} Market condition: buyers_market, sellers_market, or balanced.
   */
  getMarketCondition(capability) {
    const sd = this._supplyDemand.get(capability) || { supply: 10, demand: 10 };
    const ratio = sd.demand / sd.supply;

    if (ratio > 1.5) return MARKET_CONDITIONS.SELLERS_MARKET;
    if (ratio < 0.7) return MARKET_CONDITIONS.BUYERS_MARKET;
    return MARKET_CONDITIONS.BALANCED;
  }

  /**
   * Get price range statistics from recent transactions.
   * Uses p25, p50 (median), p75 percentiles.
   * @param {string} capability - The capability type.
   * @returns {object} Price range { min (p25), median (p50), max (p75) }.
   * @private
   */
  _getPriceRange(capability) {
    const defaults = DEFAULT_PRICE_RANGES[capability] || DEFAULT_PRICE_RANGES['default'];
    const txList = this._transactions.get(capability);

    if (!txList || txList.length < 5) {
      return defaults;
    }

    // Use only recent accepted transactions (last 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentPrices = txList
      .filter((tx) => tx.accepted && tx.timestamp > cutoff)
      .map((tx) => tx.price)
      .sort((a, b) => a - b);

    if (recentPrices.length < 3) {
      return defaults;
    }

    const p25Index = Math.floor(recentPrices.length * 0.25);
    const p50Index = Math.floor(recentPrices.length * 0.50);
    const p75Index = Math.floor(recentPrices.length * 0.75);

    return {
      min: recentPrices[p25Index],
      median: recentPrices[p50Index],
      max: recentPrices[p75Index],
    };
  }

  /**
   * Get recommended market price for a capability and task complexity.
   * @param {string} capability - The capability type (e.g., 'text-generation').
   * @param {string} taskComplexity - Task complexity level: low, medium, high, critical.
   * @returns {object} Pricing recommendation.
   */
  getMarketPrice(capability, taskComplexity = 'medium') {
    try {
      const priceRange = this._getPriceRange(capability);
      const multiplier = COMPLEXITY_MULTIPLIERS[taskComplexity] || COMPLEXITY_MULTIPLIERS['medium'];
      const marketCondition = this.getMarketCondition(capability);

      // Adjust base price based on market conditions
      let marketAdjustment = 1.0;
      if (marketCondition === MARKET_CONDITIONS.SELLERS_MARKET) {
        marketAdjustment = 1.25; // 25% premium in seller's market
      } else if (marketCondition === MARKET_CONDITIONS.BUYERS_MARKET) {
        marketAdjustment = 0.80; // 20% discount in buyer's market
      }

      const recommendedPrice = parseFloat((priceRange.median * multiplier * marketAdjustment).toFixed(6));
      const adjustedMin = parseFloat((priceRange.min * multiplier * marketAdjustment).toFixed(6));
      const adjustedMax = parseFloat((priceRange.max * multiplier * marketAdjustment).toFixed(6));

      const sd = this._supplyDemand.get(capability) || { supply: 10, demand: 10 };

      console.log(`[DynamicPricing] Market price: capability=${capability}, complexity=${taskComplexity}, price=${recommendedPrice} USDC`);

      return {
        capability,
        taskComplexity,
        recommendedPrice,
        currency: 'USDC',
        priceRange: {
          min: adjustedMin,
          median: recommendedPrice,
          max: adjustedMax,
        },
        marketCondition,
        supplyDemand: {
          supply: sd.supply,
          demand: sd.demand,
          ratio: parseFloat((sd.demand / sd.supply).toFixed(2)),
        },
        multiplier,
        marketAdjustment,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      console.error(`[DynamicPricing] getMarketPrice failed:`, err.message);
      const fallback = DEFAULT_PRICE_RANGES[capability] || DEFAULT_PRICE_RANGES['default'];
      return {
        capability,
        taskComplexity,
        recommendedPrice: fallback.median,
        currency: 'USDC',
        priceRange: fallback,
        marketCondition: MARKET_CONDITIONS.BALANCED,
        error: err.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Predict the probability that a given price will be accepted (conversion probability).
   * Uses a sigmoid function: P = 1 / (1 + exp(k * (price - median) / median))
   * @param {string} capability - The capability type.
   * @param {number} offeredPrice - Offered price in USDC.
   * @returns {object} Conversion probability result.
   */
  predictConversionProbability(capability, offeredPrice) {
    try {
      const priceRange = this._getPriceRange(capability);
      const median = priceRange.median;

      // Sigmoid steepness factor (higher = steeper curve around median)
      const k = 5.0;

      // Normalized deviation from median: positive means above median (more likely to be accepted)
      const normalizedDeviation = (offeredPrice - median) / median;

      // Sigmoid: higher price from buyer -> higher probability of seller accepting
      // For a buyer offering price: P(accept) = 1 / (1 + exp(-k * normalizedDeviation))
      const probability = 1.0 / (1.0 + Math.exp(-k * normalizedDeviation));
      const clampedProbability = parseFloat(Math.min(0.99, Math.max(0.01, probability)).toFixed(4));

      // Recommendation
      let recommendation;
      if (clampedProbability > 0.8) {
        recommendation = 'high_confidence';
      } else if (clampedProbability > 0.5) {
        recommendation = 'moderate_confidence';
      } else if (clampedProbability > 0.2) {
        recommendation = 'low_confidence';
      } else {
        recommendation = 'unlikely';
      }

      console.log(`[DynamicPricing] Conversion probability: capability=${capability}, price=${offeredPrice}, probability=${clampedProbability}`);

      return {
        capability,
        offeredPrice,
        medianPrice: median,
        conversionProbability: clampedProbability,
        recommendation,
        priceRange,
        sigmoidParams: { k, normalizedDeviation: parseFloat(normalizedDeviation.toFixed(4)) },
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      console.error(`[DynamicPricing] predictConversionProbability failed:`, err.message);
      return {
        capability,
        offeredPrice,
        conversionProbability: 0.5,
        recommendation: 'unknown',
        error: err.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get a complete market summary for a capability.
   * @param {string} capability - The capability type.
   * @returns {object} Market summary.
   */
  getMarketSummary(capability) {
    const priceRange = this._getPriceRange(capability);
    const marketCondition = this.getMarketCondition(capability);
    const sd = this._supplyDemand.get(capability) || { supply: 10, demand: 10 };
    const txList = this._transactions.get(capability) || [];

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentTx = txList.filter((tx) => tx.timestamp > cutoff);
    const acceptedTx = recentTx.filter((tx) => tx.accepted);

    return {
      capability,
      priceRange,
      marketCondition,
      supplyDemand: {
        supply: sd.supply,
        demand: sd.demand,
        ratio: parseFloat((sd.demand / sd.supply).toFixed(2)),
      },
      volume: {
        total24h: recentTx.length,
        accepted24h: acceptedTx.length,
        acceptanceRate: recentTx.length > 0
          ? parseFloat((acceptedTx.length / recentTx.length).toFixed(4))
          : 0,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = DynamicPricingService;
