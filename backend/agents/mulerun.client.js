/**
 * MulerunClient - AI-driven orchestration client for the MuleRun agent framework.
 * Provides high-level methods for agent scoring, negotiation, and delivery validation.
 *
 * #14: Rewritten to use AI-driven evaluation with structured prompts and multi-dimensional scoring.
 * Uses DeepSeek V4 as the AI backend when available, falls back to local heuristics.
 */

const DiscoveryService = require('../services/discovery.service');
const RegistryService = require('../services/registry.service');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

class MulerunClient {
  constructor({ registryService, discoveryService, apiKey, baseUrl } = {}) {
    this.registry = registryService || new RegistryService();
    this.discovery = discoveryService || new DiscoveryService(this.registry);
    this.apiKey = apiKey || DEEPSEEK_API_KEY;
    this.baseUrl = baseUrl || DEEPSEEK_BASE_URL;
  }

  /**
   * Core AI call: structured output agent conversation.
   * Uses DeepSeek V4 API with system prompt and output schema.
   */
  async _aiEvaluate({ systemPrompt, userMessage, temperature = 0.1 }) {
    if (!this.apiKey) {
      return null; // No API key, fall back to local heuristics
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage) },
          ],
          temperature,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        console.warn(`[MulerunClient] AI API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      return JSON.parse(content);
    } catch (err) {
      console.warn('[MulerunClient] AI evaluation failed, using local fallback:', err.message);
      return null;
    }
  }

  /**
   * Run an agent task end-to-end: discover, score, negotiate, execute, validate.
   */
  async run({ taskDescription, capability, budget, preferences = {} }) {
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

    const scored = await this.scoreAgents({ query: taskDescription, candidates });
    const bestAgent = scored[0];

    return {
      status: 'ready',
      taskDescription,
      capability,
      selectedAgent: bestAgent,
      allCandidates: scored,
      nextStep: 'negotiate',
      message: `Found ${scored.length} matching agent(s). Best match: ${bestAgent.name || bestAgent.agentId} (score: ${bestAgent.matchScore})`,
    };
  }

  /**
   * MatchAgent: AI-driven semantic scoring of candidate agents.
   * Uses system prompt for multi-dimensional evaluation.
   *
   * @param {object} params
   * @param {string} params.query - Natural language task description.
   * @param {object[]} params.candidates - List of candidate agents.
   * @returns {Promise<object[]>} Agents sorted by matchScore (0-100).
   */
  async scoreAgents({ query, candidates }) {
    // Prepare candidate summaries for AI evaluation
    const candidateSummaries = candidates.map((agent) => ({
      agentId: agent.agentId,
      name: agent.metadata?.name || agent.name || `Agent-${agent.agentId}`,
      capabilities: agent.capabilities || agent.metadata?.capabilities || [],
      description: agent.metadata?.description || '',
      reputation: {
        score: (agent.reputationScore || 400) / 100,
        totalTasks: agent.totalTasks || agent.metadata?.totalTasks || 0,
        successRate: agent.metadata?.successRate || 0.95,
      },
      pricing: {
        basePrice: agent.metadata?.pricePerTask || agent.basePriceUsdc || 0,
      },
      availability: {
        status: agent.available ? 'online' : 'offline',
        avgResponseTime: agent.metadata?.avgResponseTime || 30,
      },
    }));

    // Try AI-driven scoring first
    const aiResult = await this._aiEvaluate({
      systemPrompt: `你是 Arc Agent Registry 的智能匹配引擎。
根据用户需求，对候选 Agent 进行相关性评分（0-100分）。
考虑因素：能力匹配度（40%权重）、价格合理性（20%权重）、信誉评分（25%权重）、响应速度（15%权重）。
返回 JSON 对象，包含 "results" 数组，每个元素包含 agentId(string)、matchScore(number 0-100)、reason(string 一句话说明)。`,
      userMessage: { query, candidates: candidateSummaries },
    });

    if (aiResult && aiResult.results && Array.isArray(aiResult.results)) {
      // Merge AI scores back into candidate data
      return aiResult.results
        .map((scored) => {
          const original = candidates.find(
            (c) => String(c.agentId) === String(scored.agentId)
          );
          return {
            ...(original || {}),
            agentId: scored.agentId,
            name: original?.metadata?.name || original?.name || `Agent-${scored.agentId}`,
            matchScore: scored.matchScore,
            matchReason: scored.reason,
          };
        })
        .sort((a, b) => b.matchScore - a.matchScore);
    }

    // Local fallback: multi-dimensional scoring
    return this._localScoreAgents(query, candidates, candidateSummaries);
  }

  /**
   * Local fallback scoring with multi-dimensional evaluation.
   * @private
   */
  _localScoreAgents(query, candidates, summaries) {
    const queryLower = (query || '').toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);

    return summaries
      .map((summary, i) => {
        const original = candidates[i];

        // Capability match (40%)
        let capabilityScore = 0;
        const caps = (summary.capabilities || []).map((c) =>
          typeof c === 'string' ? c.toLowerCase() : (c.name || c.id || '').toLowerCase()
        );
        const desc = (summary.description || '').toLowerCase();
        const name = (summary.name || '').toLowerCase();

        for (const term of queryTerms) {
          if (caps.some((c) => c.includes(term))) capabilityScore += 30;
          if (name.includes(term)) capabilityScore += 15;
          if (desc.includes(term)) capabilityScore += 10;
        }
        capabilityScore = Math.min(capabilityScore, 40);

        // Reputation (25%)
        const repScore = Math.min(((summary.reputation.score || 4) / 5) * 25, 25);

        // Price reasonableness (20%)
        const price = summary.pricing.basePrice || 0;
        const priceScore = price > 0 ? Math.min(20, Math.max(0, 20 - price * 0.5)) : 10;

        // Availability/speed (15%)
        const speedScore = summary.availability.status === 'online'
          ? Math.min(15, Math.max(5, 15 - (summary.availability.avgResponseTime / 10)))
          : 0;

        const matchScore = Math.round(capabilityScore + repScore + priceScore + speedScore);

        return {
          ...original,
          agentId: summary.agentId,
          name: summary.name,
          matchScore: Math.min(matchScore, 100),
          matchReason: `Capability: ${Math.round(capabilityScore)}/40, Reputation: ${Math.round(repScore)}/25, Price: ${Math.round(priceScore)}/20, Speed: ${Math.round(speedScore)}/15`,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * NegotiatorAgent: AI-driven negotiation decision.
   * Evaluates proposals considering agent profile, role, and market context.
   *
   * @param {object} params
   * @param {object} params.agentProfile - Agent's capabilities and pricing.
   * @param {object} params.proposal - The negotiation proposal.
   * @param {string} params.role - 'provider' or 'requester'.
   * @returns {Promise<object>} { decision: 'accept'|'counter'|'reject', counterPrice?, reason }
   */
  async negotiate({ agentProfile, proposal, role }) {
    const minPrice = agentProfile.minPrice || 0;
    const budget = agentProfile.budget || Infinity;

    // Try AI-driven negotiation
    const aiResult = await this._aiEvaluate({
      systemPrompt: `你是 ${agentProfile.name || 'Agent'} 的协商代理，角色：${role}。
${role === 'provider'
  ? `你的最低价格：${minPrice} USDC。低于此价格拒绝或反报价。当前负载：${agentProfile.currentLoad || 0}/${agentProfile.maxConcurrentTasks || 10} 个并发任务。`
  : `你的预算上限：${budget} USDC。超出预算则反报价或放弃。`
}
评估协商提案，返回 JSON 对象包含：decision(string: accept/counter/reject)、counterPrice(number 或 null)、reason(string)。
考虑因素：任务复杂度、市场公平价格、双方历史成交记录。`,
      userMessage: proposal,
    });

    if (aiResult && aiResult.decision) {
      return {
        decision: aiResult.decision,
        counterPrice: aiResult.counterPrice || null,
        reason: aiResult.reason || 'AI evaluation complete',
      };
    }

    // Local fallback: multi-factor negotiation logic
    return this._localNegotiate({ agentProfile, proposal, role });
  }

  /**
   * Local fallback negotiation with multi-factor evaluation.
   * @private
   */
  _localNegotiate({ agentProfile, proposal, role }) {
    const proposedPrice = proposal.offeredPrice || proposal.proposedPrice || proposal.counterPrice || 0;

    if (role === 'provider') {
      const listPrice = agentProfile.listPrice || agentProfile.minPrice || 0;
      const minAcceptable = agentProfile.minPrice || listPrice * 0.7;
      const currentLoad = agentProfile.currentLoad || 0;
      const maxLoad = agentProfile.maxConcurrentTasks || 10;
      const loadFactor = currentLoad / maxLoad;

      // High load increases minimum acceptable price
      const adjustedMinPrice = minAcceptable * (1 + loadFactor * 0.3);

      if (proposedPrice >= listPrice) {
        return { decision: 'accept', counterPrice: null, reason: `Price meets list price (${listPrice} USDC)` };
      } else if (proposedPrice >= adjustedMinPrice) {
        // Dynamic counter: weighted by load and distance from list price
        const gap = listPrice - proposedPrice;
        const counterPrice = Math.round((proposedPrice + gap * (0.6 + loadFactor * 0.2)) * 100) / 100;
        return {
          decision: 'counter',
          counterPrice: Math.min(counterPrice, listPrice),
          reason: `Price below list (${listPrice}), counter-offering considering ${Math.round(loadFactor * 100)}% load`,
        };
      } else {
        return {
          decision: 'reject',
          counterPrice: null,
          reason: `Price ${proposedPrice} below minimum threshold ${Math.round(adjustedMinPrice * 100) / 100} USDC`,
        };
      }
    } else {
      // Requester role
      const budget = agentProfile.budget || Infinity;
      if (proposedPrice <= budget) {
        return { decision: 'accept', counterPrice: null, reason: `Price within budget (${budget} USDC)` };
      } else if (proposedPrice <= budget * 1.2) {
        const counterPrice = Math.round(budget * 0.95 * 100) / 100;
        return {
          decision: 'counter',
          counterPrice,
          reason: `Price slightly over budget, counter-offering at ${counterPrice} USDC`,
        };
      } else {
        return { decision: 'reject', counterPrice: null, reason: `Price ${proposedPrice} exceeds budget ${budget} by too much` };
      }
    }
  }

  /**
   * ValidatorAgent: AI-driven delivery validation.
   * Evaluates deliverables against task requirements with quality scoring.
   *
   * @param {object} params
   * @param {object} params.taskDescription - Original task description.
   * @param {object} params.deliverable - The delivered output.
   * @param {object} params.acceptanceCriteria - Criteria for acceptance.
   * @returns {Promise<object>} { result: 'pass'|'fail', qualityScore: 1-5, feedback: string }
   */
  async validateDelivery({ taskDescription, deliverable, acceptanceCriteria }) {
    if (!deliverable) {
      return { result: 'fail', qualityScore: 1, feedback: 'No deliverable provided' };
    }

    // Try AI-driven validation
    const aiResult = await this._aiEvaluate({
      systemPrompt: `你是任务验收代理。根据任务描述和验收标准，评估交付物是否合格。
返回 JSON 对象包含：result(string: pass/fail)、qualityScore(number 1-5)、feedback(string 详细评估理由)。
评估维度：完整性（是否满足所有需求）、质量（输出质量水平）、时效性（是否在期限内）、格式合规性。`,
      userMessage: { taskDescription, deliverable, acceptanceCriteria },
    });

    if (aiResult && aiResult.result) {
      return {
        result: aiResult.result,
        qualityScore: Math.max(1, Math.min(5, aiResult.qualityScore || 3)),
        feedback: aiResult.feedback || 'AI validation complete',
      };
    }

    // Local fallback: structured validation checks
    return this._localValidateDelivery({ taskDescription, deliverable, acceptanceCriteria });
  }

  /**
   * Local fallback delivery validation.
   * @private
   */
  _localValidateDelivery({ taskDescription, deliverable, acceptanceCriteria }) {
    const checks = [];
    let totalScore = 0;
    let maxScore = 0;

    // Check 1: Output exists (weight: 3)
    maxScore += 3;
    if (deliverable.output || deliverable.result || deliverable.data) {
      checks.push({ check: 'has_output', passed: true, weight: 3 });
      totalScore += 3;
    } else {
      checks.push({ check: 'has_output', passed: false, weight: 3 });
    }

    // Check 2: Format match (weight: 2)
    if (acceptanceCriteria?.format) {
      maxScore += 2;
      const outputType = typeof (deliverable.output || deliverable.result);
      const formatMatch = outputType === acceptanceCriteria.format;
      checks.push({ check: 'format_match', passed: formatMatch, weight: 2 });
      if (formatMatch) totalScore += 2;
    }

    // Check 3: Completeness - required fields (weight: 2)
    if (acceptanceCriteria?.requiredFields) {
      maxScore += 2;
      const output = deliverable.output || deliverable.result || deliverable;
      const hasAll = acceptanceCriteria.requiredFields.every(
        (field) => output[field] !== undefined
      );
      checks.push({ check: 'completeness', passed: hasAll, weight: 2 });
      if (hasAll) totalScore += 2;
    }

    // Check 4: Time compliance (weight: 2)
    if (deliverable.completedAt && deliverable.startedAt) {
      maxScore += 2;
      const duration = new Date(deliverable.completedAt) - new Date(deliverable.startedAt);
      const withinDeadline = !acceptanceCriteria?.maxDuration || duration <= acceptanceCriteria.maxDuration;
      checks.push({ check: 'within_deadline', passed: withinDeadline, weight: 2 });
      if (withinDeadline) totalScore += 2;
    }

    // Check 5: Content quality heuristic (weight: 1)
    maxScore += 1;
    const output = deliverable.output || deliverable.result || '';
    const contentLength = typeof output === 'string' ? output.length : JSON.stringify(output).length;
    const hasSubstance = contentLength > 10;
    checks.push({ check: 'content_quality', passed: hasSubstance, weight: 1 });
    if (hasSubstance) totalScore += 1;

    // Calculate quality score (1-5 scale)
    const ratio = maxScore > 0 ? totalScore / maxScore : 0.5;
    const qualityScore = Math.max(1, Math.min(5, Math.round(ratio * 5)));
    const passed = qualityScore >= 3;

    const feedbackParts = checks.map(
      (c) => `${c.check}: ${c.passed ? 'PASS' : 'FAIL'}`
    );

    return {
      result: passed ? 'pass' : 'fail',
      qualityScore,
      feedback: `Validation: ${feedbackParts.join(', ')}. Overall: ${Math.round(ratio * 100)}%`,
      checks,
      validatedAt: new Date().toISOString(),
    };
  }
}

module.exports = MulerunClient;
