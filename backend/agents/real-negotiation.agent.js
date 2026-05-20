/**
 * Real Negotiation Agents - enhanced bilateral negotiation with asymmetric information,
 * Bayesian inference, and strategic multi-round counter-offers.
 *
 * Provides ProviderNegotiationAgent and RequesterNegotiationAgent, each holding
 * private information invisible to the counterparty.
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * Shared DeepSeek API helper.
 * @private
 */
async function callDeepSeek(agentName, systemPrompt, userMessage, maxTokens = 400) {
  if (!DEEPSEEK_API_KEY) return null;
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage) },
        ],
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      console.warn(`[${agentName}] DeepSeek API error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch (err) {
    console.warn(`[${agentName}] DeepSeek call failed:`, err.message);
    return null;
  }
}


// ---------------------------------------------------------------------------
// ProviderNegotiationAgent
// ---------------------------------------------------------------------------

class ProviderNegotiationAgent extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.actualCost - true cost per task (private)
   * @param {number} opts.capacityUtilization - 0-1 current load (private)
   * @param {number} opts.urgency - 0-1 how urgently the provider needs work (private)
   * @param {number} opts.listPrice - public advertised price
   * @param {number} [opts.maxRounds=5]
   */
  constructor({ actualCost, capacityUtilization, urgency, listPrice, maxRounds } = {}) {
    super();
    this.name = 'ProviderNegotiationAgent';

    // Private information (never shared with counterparty)
    this._actualCost = actualCost || 5;
    this._capacityUtilization = capacityUtilization || 0.5;
    this._urgency = urgency || 0.3;

    // Public
    this.listPrice = listPrice || this._actualCost * 2;
    this.maxRounds = maxRounds || 5;

    // Bayesian belief about requester's budget
    this._beliefBudgetMean = this.listPrice * 1.2;
    this._beliefBudgetStd = this.listPrice * 0.5;
    this._roundHistory = [];
  }

  start() {
    console.log(`[${this.name}] Ready (list price: ${this.listPrice} USDC)`);
    this.emit('started');
  }

  /**
   * Respond to an offer from a requester.
   * @param {number} offeredPrice
   * @param {number} round
   * @returns {Promise<object>} { decision, counterPrice, reason }
   */
  async respond(offeredPrice, round) {
    // Update Bayesian belief about requester's true budget
    this._updateBudgetBelief(offeredPrice, round);

    const loadFactor = this._capacityUtilization;
    const urgencyDiscount = this._urgency; // higher urgency = more willing to accept lower
    const inferredBudget = this._beliefBudgetMean;

    // Minimum acceptable: actual cost with margin, adjusted for load and urgency
    const margin = loadFactor > 0.8 ? 1.5 : loadFactor > 0.5 ? 1.3 : 1.15;
    const urgencyAdjust = 1 - urgencyDiscount * 0.3; // urgency lowers threshold
    const minAcceptable = this._actualCost * margin * urgencyAdjust;

    // Try AI-driven decision
    const aiResult = await callDeepSeek(this.name,
      `You are a provider negotiation agent. Your private info: actual cost ${this._actualCost}, capacity utilization ${(loadFactor * 100).toFixed(0)}%, urgency ${(this._urgency * 100).toFixed(0)}%.
Your list price: ${this.listPrice}. Inferred requester budget: ${inferredBudget.toFixed(2)}.
Round ${round}/${this.maxRounds}. Decide: accept, counter, or reject the offer.
Return JSON: { "decision": "accept"|"counter"|"reject", "counterPrice": number|null, "reason": string }`,
      JSON.stringify({
        offeredPrice,
        round,
        maxRounds: this.maxRounds,
        roundHistory: this._roundHistory.slice(-5),
      }),
      300
    );

    if (aiResult && aiResult.decision) {
      this._roundHistory.push({ round, offeredPrice, response: aiResult.decision, counterPrice: aiResult.counterPrice });
      this.emit('responded', aiResult);
      return aiResult;
    }

    // Local strategic logic
    let result;
    if (offeredPrice >= this.listPrice) {
      result = { decision: 'accept', counterPrice: null, reason: 'Offer meets list price' };
    } else if (offeredPrice >= minAcceptable) {
      // Counter strategically: aim between offer and inferred budget
      const target = Math.min(this.listPrice, inferredBudget * 0.95);
      const counterPrice = Math.round((offeredPrice + (target - offeredPrice) * (0.5 + loadFactor * 0.3)) * 100) / 100;

      // Accept on last round if above cost
      if (round >= this.maxRounds && offeredPrice >= this._actualCost * 1.05) {
        result = { decision: 'accept', counterPrice: null, reason: 'Final round, offer above cost' };
      } else {
        result = { decision: 'counter', counterPrice, reason: `Counter based on load (${(loadFactor * 100).toFixed(0)}%) and inferred budget` };
      }
    } else {
      result = { decision: 'reject', counterPrice: null, reason: `Offer ${offeredPrice} below minimum acceptable ${minAcceptable.toFixed(2)}` };
    }

    this._roundHistory.push({ round, offeredPrice, response: result.decision, counterPrice: result.counterPrice });
    this.emit('responded', result);
    return result;
  }

  /**
   * Bayesian update of belief about requester's true budget.
   * @private
   */
  _updateBudgetBelief(offeredPrice, round) {
    // The offer reveals information: rational requester offers below budget.
    // Update mean toward observed offer (with uncertainty shrinking each round).
    const learningRate = 0.3 + (round / this.maxRounds) * 0.4;
    // Infer budget is likely 10-40% above offered price
    const inferredPoint = offeredPrice * (1.1 + (1 - round / this.maxRounds) * 0.3);
    this._beliefBudgetMean = this._beliefBudgetMean * (1 - learningRate) + inferredPoint * learningRate;
    this._beliefBudgetStd = this._beliefBudgetStd * (1 - learningRate * 0.5);
  }
}


// ---------------------------------------------------------------------------
// RequesterNegotiationAgent
// ---------------------------------------------------------------------------

class RequesterNegotiationAgent extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.budgetCeiling - true max willingness to pay (private)
   * @param {number} opts.idealPrice - desired price
   * @param {number} [opts.maxRounds=5]
   */
  constructor({ budgetCeiling, idealPrice, maxRounds } = {}) {
    super();
    this.name = 'RequesterNegotiationAgent';

    // Private
    this._budgetCeiling = budgetCeiling || 50;
    this._idealPrice = idealPrice || this._budgetCeiling * 0.6;

    this.maxRounds = maxRounds || 5;

    // Bayesian belief about provider's true cost
    this._beliefCostMean = this._idealPrice * 0.7;
    this._beliefCostStd = this._idealPrice * 0.4;
    this._roundHistory = [];
  }

  start() {
    console.log(`[${this.name}] Ready (budget ceiling: ${this._budgetCeiling} USDC)`);
    this.emit('started');
  }

  /**
   * Generate an opening offer.
   * @returns {number}
   */
  makeOpeningOffer() {
    // Start low: ideal price minus some margin
    const offer = Math.round(this._idealPrice * 0.8 * 100) / 100;
    this._roundHistory.push({ round: 1, action: 'offer', price: offer });
    this.emit('offer_made', { round: 1, price: offer });
    return offer;
  }

  /**
   * Respond to a counter-offer from provider.
   * @param {number} counterPrice
   * @param {number} round
   * @returns {Promise<object>} { decision, counterPrice, reason }
   */
  async respond(counterPrice, round) {
    this._updateCostBelief(counterPrice, round);
    const inferredCost = this._beliefCostMean;

    // Try AI
    const aiResult = await callDeepSeek(this.name,
      `You are a requester negotiation agent. Your private budget ceiling: ${this._budgetCeiling} USDC, ideal price: ${this._idealPrice} USDC.
Inferred provider cost: ${inferredCost.toFixed(2)}. Round ${round}/${this.maxRounds}.
Decide: accept, counter, or reject.
Return JSON: { "decision": "accept"|"counter"|"reject", "counterPrice": number|null, "reason": string }`,
      JSON.stringify({
        counterPrice,
        round,
        maxRounds: this.maxRounds,
        roundHistory: this._roundHistory.slice(-5),
      }),
      300
    );

    if (aiResult && aiResult.decision) {
      this._roundHistory.push({ round, action: 'response', price: aiResult.counterPrice || counterPrice, decision: aiResult.decision });
      this.emit('responded', aiResult);
      return aiResult;
    }

    // Local logic
    let result;
    if (counterPrice <= this._idealPrice) {
      result = { decision: 'accept', counterPrice: null, reason: 'Counter at or below ideal price' };
    } else if (counterPrice <= this._budgetCeiling) {
      // Counter: move up toward provider but stay under budget
      const step = (this._budgetCeiling - this._idealPrice) * (round / this.maxRounds);
      const newOffer = Math.round(Math.min(this._idealPrice + step, this._budgetCeiling * 0.95) * 100) / 100;

      // Accept on final round if within budget
      if (round >= this.maxRounds) {
        result = { decision: 'accept', counterPrice: null, reason: 'Final round, within budget' };
      } else {
        result = { decision: 'counter', counterPrice: newOffer, reason: `Counter-offer toward inferred cost (${inferredCost.toFixed(2)})` };
      }
    } else {
      result = { decision: 'reject', counterPrice: null, reason: `Counter ${counterPrice} exceeds budget ceiling` };
    }

    this._roundHistory.push({ round, action: 'response', price: result.counterPrice || counterPrice, decision: result.decision });
    this.emit('responded', result);
    return result;
  }

  /**
   * Bayesian update of belief about provider's true cost.
   * @private
   */
  _updateCostBelief(counterPrice, round) {
    const learningRate = 0.3 + (round / this.maxRounds) * 0.4;
    // Provider's counter is above cost; infer cost is 30-60% of counter
    const inferredPoint = counterPrice * (0.4 + (round / this.maxRounds) * 0.2);
    this._beliefCostMean = this._beliefCostMean * (1 - learningRate) + inferredPoint * learningRate;
    this._beliefCostStd = this._beliefCostStd * (1 - learningRate * 0.5);
  }
}

module.exports = { ProviderNegotiationAgent, RequesterNegotiationAgent };
