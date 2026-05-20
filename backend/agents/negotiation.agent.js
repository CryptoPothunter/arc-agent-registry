/**
 * NegotiationAgent - handles bilateral agent-to-agent negotiation.
 * Manages proposals, counter-offers, and acceptance/rejection logic.
 *
 * #15: Enhanced with multi-factor evaluation: load, complexity, history, dynamic counter-offers.
 */

const { getCache, setCache, CACHE_KEYS } = require('../config/redis.config');

// Negotiation states
const NegotiationStatus = {
  PROPOSED: 'proposed',
  COUNTER_OFFERED: 'counter_offered',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

class NegotiationAgent {
  constructor({ wsNotify, mulerunClient } = {}) {
    this.wsNotify = wsNotify || (() => {});
    this.mulerunClient = mulerunClient || null;
    this._store = new Map();
    // Track historical accepted prices per capability for reference
    this._priceHistory = new Map();
  }

  /**
   * Handle an incoming negotiation proposal.
   * Uses multi-factor evaluation: load, complexity, price history, dynamic thresholds.
   *
   * #15: Rewritten from simple 3-branch if/else to multi-factor assessment.
   */
  async handleIncomingProposal(proposal) {
    const {
      negotiationId,
      requesterId,
      fromAgentId,
      providerId,
      toAgentId,
      capability,
      taskDescription,
      input,
      proposedPrice,
      offeredPrice,
      deadline,
      agentConfig = {},
    } = proposal;

    // Normalize field names (support both doc-style and legacy)
    const reqId = requesterId || fromAgentId;
    const provId = providerId || toAgentId;
    const price = offeredPrice || proposedPrice;

    const negotiation = {
      negotiationId,
      requesterId: reqId,
      providerId: provId,
      capability: capability || '',
      taskDescription: taskDescription || '',
      input: input || {},
      offeredPrice: price,
      deadline: deadline || Math.floor(Date.now() / 1000) + 86400,
      status: NegotiationStatus.PROPOSED,
      history: [
        {
          action: 'propose',
          from: reqId,
          price,
          timestamp: new Date().toISOString(),
        },
      ],
      round: 1,
      maxRounds: agentConfig.maxNegotiationRounds || 3,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(), // 10 min default
    };

    this._store.set(negotiationId, negotiation);
    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    // Broadcast negotiation_proposed event (#28 partial)
    this.wsNotify(`agent:${provId}:negotiation`, {
      type: 'negotiation_proposed',
      event: 'negotiation_proposed',
      negotiationId,
      offeredPrice: price,
      requesterId: reqId,
    });

    // Multi-factor evaluation
    const evaluation = this._evaluateProposal(price, agentConfig, negotiation);

    if (evaluation.decision === 'accept') {
      return this.acceptProposal(negotiationId);
    } else if (evaluation.decision === 'counter') {
      return this.sendCounter(negotiationId, provId, evaluation.counterPrice, evaluation.reason);
    } else {
      return this.rejectProposal(negotiationId, evaluation.reason);
    }
  }

  /**
   * Multi-factor proposal evaluation.
   * Considers: base price, load factor, task complexity, historical prices, deadline urgency.
   * @private
   */
  _evaluateProposal(proposedPrice, agentConfig, negotiation) {
    const listPrice = agentConfig.listPrice || agentConfig.basePrice || proposedPrice;
    const minPrice = agentConfig.minPrice || listPrice * 0.5;
    const currentLoad = agentConfig.currentLoad || 0;
    const maxLoad = agentConfig.maxConcurrentTasks || 10;

    // Factor 1: Load-adjusted minimum price
    const loadFactor = currentLoad / maxLoad;
    const loadPremium = 1 + loadFactor * 0.5; // Up to 50% premium at full load
    const adjustedMinPrice = minPrice * loadPremium;

    // Factor 2: Task complexity estimate (based on description length and capability)
    const descLength = (negotiation.taskDescription || '').length;
    const complexityMultiplier = descLength > 200 ? 1.2 : descLength > 100 ? 1.1 : 1.0;

    // Factor 3: Historical price reference
    const histKey = negotiation.capability || 'default';
    const historyPrices = this._priceHistory.get(histKey) || [];
    const avgHistoricalPrice = historyPrices.length > 0
      ? historyPrices.reduce((a, b) => a + b, 0) / historyPrices.length
      : listPrice;

    // Factor 4: Deadline urgency
    const now = Date.now() / 1000;
    const deadlineTs = typeof negotiation.deadline === 'number' ? negotiation.deadline : now + 86400;
    const hoursUntilDeadline = (deadlineTs - now) / 3600;
    const urgencyPremium = hoursUntilDeadline < 2 ? 1.3 : hoursUntilDeadline < 6 ? 1.15 : 1.0;

    // Compute effective minimum price with all factors
    const effectiveMinPrice = adjustedMinPrice * complexityMultiplier * urgencyPremium;
    const effectiveListPrice = Math.max(listPrice * complexityMultiplier * urgencyPremium, avgHistoricalPrice);

    if (proposedPrice >= effectiveListPrice) {
      return {
        decision: 'accept',
        counterPrice: null,
        reason: `Price ${proposedPrice} meets adjusted list price ${Math.round(effectiveListPrice * 100) / 100} USDC`,
      };
    } else if (proposedPrice >= effectiveMinPrice) {
      // Dynamic counter-offer: weighted by multiple factors
      const gap = effectiveListPrice - proposedPrice;
      const counterWeight = 0.5 + loadFactor * 0.2 + (complexityMultiplier - 1) * 0.5;
      const counterPrice = Math.round((proposedPrice + gap * Math.min(counterWeight, 0.9)) * 100) / 100;

      return {
        decision: 'counter',
        counterPrice: Math.min(counterPrice, effectiveListPrice),
        reason: `Below list price. Factors: load ${Math.round(loadFactor * 100)}%, complexity ${complexityMultiplier}x, urgency ${urgencyPremium}x`,
      };
    } else {
      return {
        decision: 'reject',
        counterPrice: null,
        reason: `Price ${proposedPrice} below effective minimum ${Math.round(effectiveMinPrice * 100) / 100} USDC (load: ${Math.round(loadFactor * 100)}%, complexity: ${complexityMultiplier}x)`,
      };
    }
  }

  /**
   * Handle a counter-offer response.
   */
  async handleCounterOffer(negotiationId, fromAgentId, counterPrice, budget) {
    const negotiation = this._store.get(negotiationId);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);

    if (negotiation.status === NegotiationStatus.ACCEPTED ||
        negotiation.status === NegotiationStatus.REJECTED) {
      throw new Error(`Negotiation already ${negotiation.status}`);
    }

    negotiation.round += 1;
    negotiation.history.push({
      action: 'counter',
      from: fromAgentId,
      price: counterPrice,
      timestamp: new Date().toISOString(),
    });

    if (negotiation.round > negotiation.maxRounds) {
      return this.acceptProposal(negotiationId);
    }

    // Requester-side evaluation of counter-offer
    if (budget !== undefined && counterPrice <= budget) {
      return this.acceptProposal(negotiationId);
    }

    negotiation.status = NegotiationStatus.COUNTER_OFFERED;
    negotiation.currentPrice = counterPrice;
    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    this.wsNotify(`agent:${negotiation.requesterId || negotiation.fromAgentId}:negotiation`, {
      type: 'negotiation_round',
      event: 'counter_offer',
      negotiationId,
      counterPrice,
      round: negotiation.round,
    });

    return negotiation;
  }

  /**
   * Accept a negotiation proposal.
   */
  async acceptProposal(negotiationId) {
    const negotiation = this._store.get(negotiationId);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);

    negotiation.status = NegotiationStatus.ACCEPTED;
    negotiation.agreedPrice = negotiation.currentPrice || negotiation.offeredPrice || negotiation.proposedPrice;
    negotiation.acceptedAt = new Date().toISOString();
    negotiation.history.push({
      action: 'accept',
      price: negotiation.agreedPrice,
      timestamp: negotiation.acceptedAt,
    });

    // Record price in history for future reference
    const histKey = negotiation.capability || 'default';
    if (!this._priceHistory.has(histKey)) this._priceHistory.set(histKey, []);
    this._priceHistory.get(histKey).push(negotiation.agreedPrice);

    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    this.wsNotify(`agent:${negotiation.requesterId || negotiation.fromAgentId}:negotiation`, {
      type: 'negotiation_accepted',
      event: 'negotiation_accepted',
      negotiationId,
      agreedPrice: negotiation.agreedPrice,
    });

    return negotiation;
  }

  /**
   * Send a counter-offer.
   */
  async sendCounter(negotiationId, fromAgentId, counterPrice, reason) {
    const negotiation = this._store.get(negotiationId);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);

    negotiation.status = NegotiationStatus.COUNTER_OFFERED;
    negotiation.currentPrice = counterPrice;
    negotiation.history.push({
      action: 'counter',
      from: fromAgentId,
      price: counterPrice,
      reason: reason || '',
      timestamp: new Date().toISOString(),
    });

    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    this.wsNotify(`agent:${negotiation.requesterId || negotiation.fromAgentId}:negotiation`, {
      type: 'negotiation_round',
      event: 'counter_offer',
      negotiationId,
      counterPrice,
      reason,
    });

    return negotiation;
  }

  /**
   * Reject a negotiation proposal.
   */
  async rejectProposal(negotiationId, reason = 'Rejected by agent') {
    const negotiation = this._store.get(negotiationId);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);

    negotiation.status = NegotiationStatus.REJECTED;
    negotiation.rejectionReason = reason;
    negotiation.rejectedAt = new Date().toISOString();
    negotiation.history.push({
      action: 'reject',
      reason,
      timestamp: negotiation.rejectedAt,
    });

    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    this.wsNotify(`agent:${negotiation.requesterId || negotiation.fromAgentId}:negotiation`, {
      type: 'negotiation_round',
      event: 'rejected',
      negotiationId,
      reason,
    });

    return negotiation;
  }

  /**
   * Get negotiation status.
   */
  getStatus(negotiationId) {
    const negotiation = this._store.get(negotiationId) ||
      getCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);
    return negotiation;
  }
}

module.exports = { NegotiationAgent, NegotiationStatus };
