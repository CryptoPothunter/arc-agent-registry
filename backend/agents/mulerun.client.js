/**
 * MulerunClient - orchestration client for the MuleRun agent framework.
 * Provides high-level methods for agent scoring, negotiation, and delivery validation.
 */

const DiscoveryService = require('../services/discovery.service');
const RegistryService = require('../services/registry.service');

class MulerunClient {
  constructor({ registryService, discoveryService } = {}) {
    this.registry = registryService || new RegistryService();
    this.discovery = discoveryService || new DiscoveryService(this.registry);
  }

  /**
   * Run an agent task end-to-end: discover, score, negotiate, execute, validate.
   * @param {object} params
   * @param {string} params.taskDescription - Natural language task description.
   * @param {string} params.capability - Required capability.
   * @param {number} [params.budget] - Maximum budget in USDC.
   * @param {object} [params.preferences] - Additional preferences.
   * @returns {Promise<object>} Task execution plan.
   */
  async run({ taskDescription, capability, budget, preferences = {} }) {
    // Step 1: Discover matching agents
    const candidates = await this.discovery.smartSearch({
      q: taskDescription,
      capability,
      maxPrice: budget,
      limit: 10,
    });

    if (candidates.length === 0) {
      return {
        status: 'no_agents_found',
        taskDescription,
        capability,
        message: 'No agents found matching the given criteria.',
      };
    }

    // Step 2: Score and rank agents
    const scored = this.scoreAgents(candidates, { budget, ...preferences });

    // Step 3: Select best agent
    const bestAgent = scored[0];

    return {
      status: 'ready',
      taskDescription,
      capability,
      selectedAgent: bestAgent,
      allCandidates: scored,
      nextStep: 'negotiate',
      message: `Found ${scored.length} matching agent(s). Best match: ${bestAgent.metadata?.name || bestAgent.agentId}`,
    };
  }

  /**
   * Score agents based on multiple criteria.
   * @param {object[]} agents - List of candidate agents.
   * @param {object} criteria - Scoring criteria (budget, speedPreference, qualityWeight).
   * @returns {object[]} Agents sorted by composite score.
   */
  scoreAgents(agents, criteria = {}) {
    const { budget, speedPreference = 0.3, qualityWeight = 0.5 } = criteria;
    const costWeight = 1 - speedPreference - qualityWeight;

    return agents
      .map((agent) => {
        const reputation = (agent.reputationScore || 0) / 100;
        const price = agent.metadata?.pricePerTask || 0;
        const costScore = budget && price > 0 ? Math.max(0, 1 - price / budget) : 0.5;

        const compositeScore =
          reputation * qualityWeight +
          costScore * Math.max(0, costWeight) +
          (agent.relevanceScore || 0) / 200 * speedPreference;

        return {
          ...agent,
          compositeScore: Math.round(compositeScore * 1000) / 1000,
          scoring: {
            reputationNormalized: reputation,
            costScore,
            relevance: (agent.relevanceScore || 0) / 200,
          },
        };
      })
      .sort((a, b) => b.compositeScore - a.compositeScore);
  }

  /**
   * Initiate negotiation with a selected agent.
   * @param {object} params
   * @param {string} params.agentId - Target agent ID.
   * @param {string} params.taskDescription - Task to negotiate for.
   * @param {number} params.proposedPrice - Proposed price in USDC.
   * @param {number} params.deadline - Unix timestamp deadline.
   * @returns {Promise<object>} Negotiation proposal.
   */
  async negotiate({ agentId, taskDescription, proposedPrice, deadline }) {
    const agent = await this.registry.getAgentInfo(agentId);

    return {
      negotiationId: `neg-${Date.now()}-${agentId}`,
      status: 'proposed',
      from: 'client',
      to: agentId,
      taskDescription,
      proposedPrice,
      agentListPrice: agent.metadata?.pricePerTask,
      deadline,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Validate delivery output from an agent.
   * @param {object} params
   * @param {string} params.taskId - Task identifier.
   * @param {object} params.deliverable - The delivered output.
   * @param {object} params.requirements - Original task requirements.
   * @returns {Promise<object>} Validation result with quality score.
   */
  async validateDelivery({ taskId, deliverable, requirements }) {
    // Basic validation checks
    const checks = [];

    if (!deliverable) {
      return { taskId, valid: false, qualityScore: 0, reason: 'No deliverable provided' };
    }

    // Check completeness
    if (deliverable.output) {
      checks.push({ check: 'has_output', passed: true });
    } else {
      checks.push({ check: 'has_output', passed: false });
    }

    // Check format if specified
    if (requirements?.format) {
      const formatMatch = typeof deliverable.output === requirements.format;
      checks.push({ check: 'format_match', passed: formatMatch });
    }

    // Check response time
    if (deliverable.completedAt && deliverable.startedAt) {
      const duration = new Date(deliverable.completedAt) - new Date(deliverable.startedAt);
      const withinDeadline = !requirements?.maxDuration || duration <= requirements.maxDuration;
      checks.push({ check: 'within_deadline', passed: withinDeadline });
    }

    const passedChecks = checks.filter((c) => c.passed).length;
    const qualityScore = checks.length > 0
      ? Math.round((passedChecks / checks.length) * 100)
      : 50; // default to neutral if no checks applicable

    return {
      taskId,
      valid: qualityScore >= 50,
      qualityScore,
      checks,
      validatedAt: new Date().toISOString(),
    };
  }
}

module.exports = MulerunClient;
