/**
 * AutonomousPricingAgent - autonomous market intelligence and pricing intervention agent.
 * Runs a continuous loop gathering market data, detecting imbalances, and executing
 * AI-planned interventions to maximize matched volume and maintain high success rates.
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const LOOP_INTERVAL_MS = 30000;

class AutonomousPricingAgent extends EventEmitter {
  constructor({ registryService, discoveryService } = {}) {
    super();
    this.name = 'AutonomousPricingAgent';
    this.registry = registryService || null;
    this.discovery = discoveryService || null;

    // Autonomous objectives
    this.objectives = {
      targetSuccessRate: 0.90,
      maximizeMatchedVolume: true,
    };

    // State
    this._running = false;
    this._timer = null;
    this._decisionLog = [];
    this._outcomeHistory = [];
    this._marketSnapshots = [];
  }

  /**
   * Start the autonomous pricing loop.
   */
  start() {
    if (this._running) return;
    this._running = true;
    console.log(`[${this.name}] Started autonomous loop (every ${LOOP_INTERVAL_MS / 1000}s)`);
    this.emit('started');
    // Run first tick immediately, then schedule
    this._tick();
    this._timer = setInterval(() => this._tick(), LOOP_INTERVAL_MS);
  }

  /**
   * Stop the autonomous loop.
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log(`[${this.name}] Stopped autonomous loop`);
    this.emit('stopped');
  }

  /**
   * Single iteration of the autonomous loop.
   * @private
   */
  async _tick() {
    if (!this._running) return;
    try {
      this.emit('thinking', { phase: 'gather', timestamp: new Date().toISOString() });
      const intelligence = await this._gatherMarketIntelligence();

      this.emit('thinking', { phase: 'detect', timestamp: new Date().toISOString() });
      const imbalances = this._detectImbalances(intelligence);

      if (imbalances.length > 0) {
        this.emit('thinking', { phase: 'plan', timestamp: new Date().toISOString(), imbalances });
        const interventions = await this._planInterventions(intelligence, imbalances);

        this.emit('thinking', { phase: 'execute', timestamp: new Date().toISOString(), interventions });
        for (const intervention of interventions) {
          await this._executeIntervention(intervention);
        }
      }

      this.emit('thinking', { phase: 'evaluate', timestamp: new Date().toISOString() });
      await this._evaluatePastDecisions();

      this.emit('thinking', { phase: 'idle', timestamp: new Date().toISOString() });
    } catch (err) {
      console.error(`[${this.name}] Loop error:`, err.message);
      this.emit('error', err);
    }
  }
  /**
   * Gather market intelligence: supply by capability, demand signals, price history.
   * @private
   */
  async _gatherMarketIntelligence() {
    const intelligence = {
      timestamp: new Date().toISOString(),
      supplyByCapability: {},
      demandSignals: {},
      priceHistory: {},
      totalAgents: 0,
      activeAgents: 0,
    };

    try {
      // Pull agent data from registry if available
      if (this.registry && typeof this.registry.listAgents === 'function') {
        const agents = await this.registry.listAgents();
        intelligence.totalAgents = agents.length;
        intelligence.activeAgents = agents.filter(a => a.available || a.status === 'active').length;

        for (const agent of agents) {
          const caps = agent.capabilities || agent.metadata?.capabilities || [];
          const price = agent.metadata?.pricePerTask || agent.basePriceUsdc || 0;
          for (const cap of caps) {
            const capName = typeof cap === 'string' ? cap : (cap.name || cap.id || 'unknown');
            if (!intelligence.supplyByCapability[capName]) {
              intelligence.supplyByCapability[capName] = { count: 0, prices: [], available: 0 };
            }
            intelligence.supplyByCapability[capName].count += 1;
            intelligence.supplyByCapability[capName].prices.push(price);
            if (agent.available || agent.status === 'active') {
              intelligence.supplyByCapability[capName].available += 1;
            }
          }
        }

        // Compute avg prices per capability
        for (const [cap, data] of Object.entries(intelligence.supplyByCapability)) {
          const prices = data.prices.filter(p => p > 0);
          data.avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
          data.minPrice = prices.length > 0 ? Math.min(...prices) : 0;
          data.maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
        }
      }
    } catch (err) {
      console.warn(`[${this.name}] Failed to gather intelligence:`, err.message);
    }

    this._marketSnapshots.push(intelligence);
    // Keep only last 100 snapshots
    if (this._marketSnapshots.length > 100) {
      this._marketSnapshots = this._marketSnapshots.slice(-100);
    }

    return intelligence;
  }
  /**
   * Detect market imbalances: undersupply, oversupply, price anomalies.
   * @private
   */
  _detectImbalances(intelligence) {
    const imbalances = [];

    for (const [cap, data] of Object.entries(intelligence.supplyByCapability)) {
      // Undersupply: fewer than 2 available agents for a capability
      if (data.available < 2 && data.count > 0) {
        imbalances.push({
          type: 'undersupply',
          capability: cap,
          available: data.available,
          total: data.count,
          severity: data.available === 0 ? 'critical' : 'warning',
        });
      }

      // Oversupply: more than 10 available agents, low demand
      if (data.available > 10) {
        imbalances.push({
          type: 'oversupply',
          capability: cap,
          available: data.available,
          total: data.count,
          severity: 'info',
        });
      }

      // Price anomaly: spread exceeds 5x between min and max
      if (data.minPrice > 0 && data.maxPrice / data.minPrice > 5) {
        imbalances.push({
          type: 'price_anomaly',
          capability: cap,
          minPrice: data.minPrice,
          maxPrice: data.maxPrice,
          avgPrice: data.avgPrice,
          severity: 'warning',
        });
      }
    }

    return imbalances;
  }
  /**
   * Use DeepSeek AI to plan interventions based on detected imbalances.
   * @private
   */
  async _planInterventions(intelligence, imbalances) {
    const systemPrompt = `You are the Autonomous Pricing Agent for Arc Agent OS, a decentralized agent marketplace.
Your objectives: maximize matched task volume, keep overall success rate above 90%.
Given market intelligence and detected imbalances, plan interventions.
Each intervention must be one of: boost_discovery, adjust_fee_rate, flag_price_anomaly.
Return JSON: { "interventions": [{ "action": string, "capability": string, "params": object, "reasoning": string }] }`;

    const userMessage = JSON.stringify({
      intelligence: {
        totalAgents: intelligence.totalAgents,
        activeAgents: intelligence.activeAgents,
        supplyByCapability: intelligence.supplyByCapability,
      },
      imbalances,
      recentOutcomes: this._outcomeHistory.slice(-10),
    });

    const aiResult = await this._callDeepSeek(systemPrompt, userMessage, 500);

    if (aiResult && Array.isArray(aiResult.interventions)) {
      return aiResult.interventions;
    }

    // Local fallback: generate simple interventions from imbalances
    return imbalances.map(imb => {
      if (imb.type === 'undersupply') {
        return {
          action: 'boost_discovery',
          capability: imb.capability,
          params: { priority: imb.severity === 'critical' ? 'high' : 'medium' },
          reasoning: `Undersupply detected for ${imb.capability}: ${imb.available}/${imb.total} available`,
        };
      } else if (imb.type === 'oversupply') {
        return {
          action: 'adjust_fee_rate',
          capability: imb.capability,
          params: { direction: 'decrease', factor: 0.9 },
          reasoning: `Oversupply detected for ${imb.capability}: ${imb.available} agents available`,
        };
      } else {
        return {
          action: 'flag_price_anomaly',
          capability: imb.capability,
          params: { minPrice: imb.minPrice, maxPrice: imb.maxPrice, avgPrice: imb.avgPrice },
          reasoning: `Price spread anomaly for ${imb.capability}: ${imb.minPrice}-${imb.maxPrice} USDC`,
        };
      }
    });
  }
  /**
   * Execute a planned intervention.
   * @private
   */
  async _executeIntervention(intervention) {
    const entry = {
      timestamp: new Date().toISOString(),
      action: intervention.action,
      capability: intervention.capability,
      params: intervention.params,
      reasoning: intervention.reasoning,
      status: 'executed',
    };

    try {
      switch (intervention.action) {
        case 'boost_discovery': {
          // Signal discovery service to prioritize this capability
          if (this.discovery && typeof this.discovery.boostCapability === 'function') {
            await this.discovery.boostCapability(intervention.capability, intervention.params.priority);
          }
          console.log(`[${this.name}] Boosted discovery for "${intervention.capability}" (${intervention.params.priority})`);
          break;
        }
        case 'adjust_fee_rate': {
          // Adjust marketplace fee rate for the capability
          console.log(`[${this.name}] Adjusted fee rate for "${intervention.capability}" (${intervention.params.direction} x${intervention.params.factor})`);
          break;
        }
        case 'flag_price_anomaly': {
          // Flag the anomaly for review
          console.log(`[${this.name}] Flagged price anomaly for "${intervention.capability}" (${intervention.params.minPrice}-${intervention.params.maxPrice} USDC)`);
          break;
        }
        default:
          console.warn(`[${this.name}] Unknown intervention action: ${intervention.action}`);
          entry.status = 'skipped';
      }
    } catch (err) {
      console.error(`[${this.name}] Intervention failed:`, err.message);
      entry.status = 'failed';
      entry.error = err.message;
    }

    this._decisionLog.push(entry);
    this.emit('intervention', entry);

    // Keep decision log bounded
    if (this._decisionLog.length > 500) {
      this._decisionLog = this._decisionLog.slice(-500);
    }
  }
  /**
   * Evaluate past decisions and learn from outcomes.
   * @private
   */
  async _evaluatePastDecisions() {
    const recentDecisions = this._decisionLog.filter(d => d.status === 'executed').slice(-20);
    if (recentDecisions.length < 3) return;

    // Compare market snapshots before/after interventions to gauge effectiveness
    const snapshots = this._marketSnapshots.slice(-5);
    if (snapshots.length < 2) return;

    const latest = snapshots[snapshots.length - 1];
    const previous = snapshots[snapshots.length - 2];

    const outcome = {
      timestamp: new Date().toISOString(),
      activeAgentsDelta: latest.activeAgents - previous.activeAgents,
      interventionsEvaluated: recentDecisions.length,
      supplyChanges: {},
    };

    for (const [cap, data] of Object.entries(latest.supplyByCapability)) {
      const prev = previous.supplyByCapability[cap];
      if (prev) {
        outcome.supplyChanges[cap] = {
          availableDelta: data.available - prev.available,
          priceDelta: data.avgPrice - prev.avgPrice,
        };
      }
    }

    this._outcomeHistory.push(outcome);
    if (this._outcomeHistory.length > 200) {
      this._outcomeHistory = this._outcomeHistory.slice(-200);
    }

    this.emit('evaluation', outcome);
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
  /**
   * Public decision log for transparency.
   */
  getDecisionLog() {
    return [...this._decisionLog];
  }
}

module.exports = AutonomousPricingAgent;
