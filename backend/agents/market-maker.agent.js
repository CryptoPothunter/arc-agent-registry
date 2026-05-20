/**
 * MarketMakerAgent - provides liquidity to prediction markets for agent performance.
 * Evaluates agent probability of success using AI and places strategic bets.
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_BUDGET = 100;
const REBALANCE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

class MarketMakerAgent extends EventEmitter {
  constructor({ registryService, marketService } = {}) {
    super();
    this.name = 'MarketMakerAgent';
    this.registry = registryService || null;
    this.marketService = marketService || null;
    this.budget = parseFloat(process.env.MARKET_MAKER_BUDGET_USDC) || DEFAULT_BUDGET;
    this.allocatedBudget = 0;

    this._positions = new Map(); // marketId -> { agentId, betAmount, probability, side, timestamp }
    this._rebalanceTimer = null;
  }

  /**
   * Start the market maker: listen for new prediction markets and schedule rebalancing.
   */
  start() {
    console.log(`[${this.name}] Started with budget ${this.budget} USDC`);
    this.emit('started');

    // Listen for new markets if a market service is provided
    if (this.marketService && typeof this.marketService.on === 'function') {
      this.marketService.on('market_created', (market) => {
        this._onNewMarket(market).catch(err => {
          console.error(`[${this.name}] Error handling new market:`, err.message);
        });
      });
    }

    // Schedule hourly rebalancing
    this._rebalanceTimer = setInterval(() => {
      this.rebalancePositions().catch(err => {
        console.error(`[${this.name}] Rebalance error:`, err.message);
      });
    }, REBALANCE_INTERVAL_MS);
  }

  /**
   * Stop the market maker.
   */
  stop() {
    if (this._rebalanceTimer) {
      clearInterval(this._rebalanceTimer);
      this._rebalanceTimer = null;
    }
    console.log(`[${this.name}] Stopped`);
    this.emit('stopped');
  }

  /**
   * Handle a newly created prediction market.
   * @private
   */
  async _onNewMarket(market) {
    const { marketId, agentId } = market;
    if (!marketId || !agentId) return;

    console.log(`[${this.name}] New market detected: ${marketId} for agent ${agentId}`);
    await this.provideInitialLiquidity(marketId, agentId);
  }

  /**
   * Evaluate an agent's performance probability and place an initial bet.
   * @param {string} marketId
   * @param {string} agentId
   */
  async provideInitialLiquidity(marketId, agentId) {
    if (this.allocatedBudget >= this.budget) {
      console.warn(`[${this.name}] Budget exhausted, cannot provide liquidity for market ${marketId}`);
      return null;
    }

    // Gather agent profile for evaluation
    let agentProfile = null;
    if (this.registry && typeof this.registry.getAgent === 'function') {
      try {
        agentProfile = await this.registry.getAgent(agentId);
      } catch (_) { /* agent not found */ }
    }

    const evaluation = await this._evaluateProbability(agentId, agentProfile);
    const probability = evaluation.probability;
    const confidence = evaluation.confidence;

    // Determine bet size: Kelly criterion simplified
    // bet = (p * b - q) / b where b = odds (1:1 for simplicity), p = probability, q = 1-p
    const edge = Math.max(0, probability - 0.5);
    const maxBet = Math.min(this.budget * 0.1, this.budget - this.allocatedBudget);
    const betAmount = Math.round(edge * confidence * maxBet * 100) / 100;

    if (betAmount < 0.01) {
      console.log(`[${this.name}] Edge too small for market ${marketId}, skipping`);
      return null;
    }

    const side = probability >= 0.5 ? 'yes' : 'no';

    const position = {
      marketId,
      agentId,
      betAmount,
      probability,
      confidence,
      side,
      timestamp: new Date().toISOString(),
      status: 'open',
    };

    this._positions.set(marketId, position);
    this.allocatedBudget += betAmount;

    console.log(`[${this.name}] Placed ${side} bet of ${betAmount} USDC on market ${marketId} (p=${probability}, conf=${confidence})`);
    this.emit('bet_placed', position);

    return position;
  }

  /**
   * Use AI to evaluate the probability of an agent completing its task successfully.
   * @private
   */
  async _evaluateProbability(agentId, agentProfile) {
    const systemPrompt = `You are a prediction market analyst for Arc Agent OS.
Evaluate the probability that the given agent will successfully complete its current task.
Consider: reputation score, historical success rate, task count, capabilities, and pricing.
Return JSON: { "probability": number (0-1), "confidence": number (0-1), "reasoning": string }`;

    const profileSummary = agentProfile ? {
      agentId,
      reputation: agentProfile.reputationScore || agentProfile.metadata?.reputationScore || 400,
      totalTasks: agentProfile.totalTasks || agentProfile.metadata?.totalTasks || 0,
      successRate: agentProfile.metadata?.successRate || 0,
      capabilities: agentProfile.capabilities || agentProfile.metadata?.capabilities || [],
    } : { agentId, note: 'No profile data available' };

    const result = await this._callDeepSeek(systemPrompt, JSON.stringify(profileSummary), 300);

    if (result && typeof result.probability === 'number') {
      return {
        probability: Math.max(0, Math.min(1, result.probability)),
        confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
        reasoning: result.reasoning || '',
      };
    }

    // Local fallback based on reputation
    const rep = agentProfile?.reputationScore || agentProfile?.metadata?.reputationScore || 400;
    const successRate = agentProfile?.metadata?.successRate || 0.7;
    const probability = 0.3 + (rep / 1000) * 0.4 + successRate * 0.3;

    return {
      probability: Math.max(0.1, Math.min(0.95, probability)),
      confidence: 0.4,
      reasoning: 'Local heuristic based on reputation and success rate',
    };
  }

  /**
   * Rebalance all open positions based on updated information.
   */
  async rebalancePositions() {
    const openPositions = [...this._positions.entries()].filter(([, p]) => p.status === 'open');
    if (openPositions.length === 0) return;

    console.log(`[${this.name}] Rebalancing ${openPositions.length} open positions`);
    this.emit('rebalancing', { count: openPositions.length });

    for (const [marketId, position] of openPositions) {
      try {
        let agentProfile = null;
        if (this.registry && typeof this.registry.getAgent === 'function') {
          try {
            agentProfile = await this.registry.getAgent(position.agentId);
          } catch (_) { /* not found */ }
        }

        const newEval = await this._evaluateProbability(position.agentId, agentProfile);

        // If probability shifted significantly (> 15%), adjust position
        const shift = Math.abs(newEval.probability - position.probability);
        if (shift > 0.15) {
          const oldSide = position.side;
          position.probability = newEval.probability;
          position.confidence = newEval.confidence;
          position.side = newEval.probability >= 0.5 ? 'yes' : 'no';
          position.lastRebalanced = new Date().toISOString();

          console.log(`[${this.name}] Rebalanced market ${marketId}: p ${position.probability.toFixed(2)} (was ${oldSide}, now ${position.side})`);
          this.emit('position_rebalanced', position);
        }
      } catch (err) {
        console.error(`[${this.name}] Failed to rebalance market ${marketId}:`, err.message);
      }
    }
  }

  /**
   * Get all current positions.
   */
  getPositions() {
    return [...this._positions.values()];
  }

  /**
   * Call DeepSeek AI API.
   * @private
   */
  async _callDeepSeek(systemPrompt, userMessage, maxTokens = 300) {
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
        console.warn(`[${this.name}] DeepSeek API error: ${response.status}`);
        return null;
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      return content ? JSON.parse(content) : null;
    } catch (err) {
      console.warn(`[${this.name}] DeepSeek call failed:`, err.message);
      return null;
    }
  }
}

module.exports = MarketMakerAgent;
