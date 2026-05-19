/**
 * NegotiationAgent - handles bilateral agent-to-agent negotiation.
 * Manages proposals, counter-offers, and acceptance/rejection logic.
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
  constructor({ wsNotify } = {}) {
    // wsNotify is a callback function(topic, data) for real-time WebSocket events
    this.wsNotify = wsNotify || (() => {});
    this._store = new Map();
  }

  /**
   * Handle an incoming negotiation proposal.
   * Evaluates the proposal against the agent's preferences and auto-responds.
   *
   * @param {object} proposal
   * @param {string} proposal.negotiationId
   * @param {string} proposal.fromAgentId - Proposing agent/client ID.
   * @param {string} proposal.toAgentId - Target agent ID.
   * @param {string} proposal.taskDescription
   * @param {number} proposal.proposedPrice - Offered price in USDC.
   * @param {number} proposal.deadline - Unix timestamp.
   * @param {object} [proposal.agentConfig] - Target agent's pricing config.
   * @returns {Promise<object>} Response (accept, counter, or reject).
   */
  async handleIncomingProposal(proposal) {
    const {
      negotiationId,
      fromAgentId,
      toAgentId,
      taskDescription,
      proposedPrice,
      deadline,
      agentConfig = {},
    } = proposal;

    const negotiation = {
      negotiationId,
      fromAgentId,
      toAgentId,
      taskDescription,
      proposedPrice,
      deadline,
      status: NegotiationStatus.PROPOSED,
      history: [
        {
          action: 'propose',
          from: fromAgentId,
          price: proposedPrice,
          timestamp: new Date().toISOString(),
        },
      ],
      round: 1,
      maxRounds: agentConfig.maxNegotiationRounds || 3,
      createdAt: new Date().toISOString(),
    };

    this._store.set(negotiationId, negotiation);
    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    // Auto-evaluate based on agent config
    const minAcceptablePrice = agentConfig.minPrice || 0;
    const listPrice = agentConfig.listPrice || proposedPrice;

    if (proposedPrice >= listPrice) {
      // Price meets or exceeds list price: auto-accept
      return this.acceptProposal(negotiationId);
    } else if (proposedPrice >= minAcceptablePrice) {
      // Price is acceptable but below list: counter-offer
      const counterPrice = Math.round((proposedPrice + listPrice) / 2 * 100) / 100;
      return this.sendCounter(negotiationId, toAgentId, counterPrice);
    } else {
      // Price too low
      return this.rejectProposal(negotiationId, 'Price below minimum acceptable threshold');
    }
  }

  /**
   * Handle a counter-offer response.
   * @param {string} negotiationId
   * @param {string} fromAgentId - Agent sending the counter.
   * @param {number} counterPrice - New proposed price.
   * @returns {Promise<object>} Updated negotiation state.
   */
  async handleCounterOffer(negotiationId, fromAgentId, counterPrice) {
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
      // Max rounds exceeded: auto-accept the last counter
      return this.acceptProposal(negotiationId);
    }

    negotiation.status = NegotiationStatus.COUNTER_OFFERED;
    negotiation.currentPrice = counterPrice;
    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    this.wsNotify(`agent:${negotiation.toAgentId}:negotiation`, {
      event: 'counter_offer',
      negotiationId,
      counterPrice,
      round: negotiation.round,
    });

    return negotiation;
  }

  /**
   * Accept a negotiation proposal.
   * @param {string} negotiationId
   * @returns {Promise<object>} Accepted negotiation.
   */
  async acceptProposal(negotiationId) {
    const negotiation = this._store.get(negotiationId);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);

    negotiation.status = NegotiationStatus.ACCEPTED;
    negotiation.agreedPrice = negotiation.currentPrice || negotiation.proposedPrice;
    negotiation.acceptedAt = new Date().toISOString();
    negotiation.history.push({
      action: 'accept',
      price: negotiation.agreedPrice,
      timestamp: negotiation.acceptedAt,
    });

    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    this.wsNotify(`agent:${negotiation.fromAgentId}:negotiation`, {
      event: 'accepted',
      negotiationId,
      agreedPrice: negotiation.agreedPrice,
    });

    return negotiation;
  }

  /**
   * Send a counter-offer.
   * @param {string} negotiationId
   * @param {string} fromAgentId
   * @param {number} counterPrice
   * @returns {Promise<object>} Updated negotiation.
   */
  async sendCounter(negotiationId, fromAgentId, counterPrice) {
    const negotiation = this._store.get(negotiationId);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);

    negotiation.status = NegotiationStatus.COUNTER_OFFERED;
    negotiation.currentPrice = counterPrice;
    negotiation.history.push({
      action: 'counter',
      from: fromAgentId,
      price: counterPrice,
      timestamp: new Date().toISOString(),
    });

    setCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`, negotiation, 3600);

    this.wsNotify(`agent:${negotiation.fromAgentId}:negotiation`, {
      event: 'counter_offer',
      negotiationId,
      counterPrice,
    });

    return negotiation;
  }

  /**
   * Reject a negotiation proposal.
   * @param {string} negotiationId
   * @param {string} reason
   * @returns {Promise<object>} Rejected negotiation.
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

    this.wsNotify(`agent:${negotiation.fromAgentId}:negotiation`, {
      event: 'rejected',
      negotiationId,
      reason,
    });

    return negotiation;
  }

  /**
   * Get negotiation status.
   * @param {string} negotiationId
   * @returns {object}
   */
  getStatus(negotiationId) {
    const negotiation = this._store.get(negotiationId) ||
      getCache(`${CACHE_KEYS.NEGOTIATION_PREFIX}${negotiationId}`);
    if (!negotiation) throw new Error(`Negotiation ${negotiationId} not found`);
    return negotiation;
  }
}

module.exports = { NegotiationAgent, NegotiationStatus };
