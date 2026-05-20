/**
 * DiscoveryService - intelligent agent search and filtering.
 * Enables clients to find the best-matching agents by capability, price, and reputation.
 *
 * #20: Added missing filters: minSuccessRate, availableOnly, language, tags.
 * Now supports all 7 filter fields from doc spec §3.2.1.
 */

const RegistryService = require('./registry.service');
const { getCache, setCache, CACHE_KEYS } = require('../config/redis.config');

class DiscoveryService {
  constructor(registryService) {
    this.registry = registryService || new RegistryService();
  }

  /**
   * Smart search for agents matching given criteria.
   * Combines text search, capability matching, and scoring.
   *
   * #20: Supports all DiscoveryFilter fields from doc spec §3.2.1:
   * - capability: exact capability match
   * - maxPrice: maximum USDC budget
   * - minReputationScore (alias: minScore): minimum reputation (0-5)
   * - minSuccessRate: minimum success rate (0-1)
   * - availableOnly: only show online agents
   * - language: agent supported language
   * - tags: tag-based filtering
   * - q: free-text search
   * - limit: max results
   */
  async smartSearch({
    q,
    capability,
    maxPrice,
    minScore,
    minReputationScore,
    minSuccessRate,
    availableOnly,
    language,
    tags,
    limit = 20,
  }) {
    // Check discovery cache
    const filterKey = JSON.stringify({ q, capability, maxPrice, minScore, minReputationScore, minSuccessRate, availableOnly, language, tags, limit });
    const cacheKey = `${CACHE_KEYS.DISCOVERY_CACHE}${filterKey}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const startTime = Date.now();

    // Get all active agents from registry
    const allAgents = await this.registry.getAllActiveAgents();

    // Apply all filters (#20: extended with missing filters)
    let results = this.applyFilters(allAgents, {
      q,
      capability,
      maxPrice,
      minScore: minReputationScore || minScore,
      minSuccessRate,
      availableOnly,
      language,
      tags,
    });

    // Score and sort by relevance
    results = results
      .map((agent) => ({
        ...agent,
        relevanceScore: this._computeRelevance(agent, { q, capability }),
      }))
      .sort((a, b) => {
        const scoreDiff = b.relevanceScore - a.relevanceScore;
        if (scoreDiff !== 0) return scoreDiff;
        return ((b.reputation?.score || 0) - (a.reputation?.score || 0));
      })
      .slice(0, limit);

    const searchTime = Date.now() - startTime;

    // Format response per doc spec
    const formattedResults = results.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name || agent.metadata?.name || `Agent-${agent.agentId}`,
      matchScore: Math.round((agent.relevanceScore / 200) * 100) / 100, // Normalize to 0-1
      matchReason: this._generateMatchReason(agent, { q, capability }),
      estimatedPrice: this._getEstimatedPrice(agent),
      availability: agent.availability?.status || (agent.available ? 'online' : 'offline'),
      // Include full agent data for downstream use
      ...agent,
    }));

    // Cache results for 10 seconds (doc spec)
    setCache(cacheKey, formattedResults, 10);

    return formattedResults;
  }

  /**
   * Apply filter criteria to a list of agents.
   * #20: Extended with minSuccessRate, availableOnly, language, tags filters.
   */
  applyFilters(agents, { q, capability, maxPrice, minScore, minSuccessRate, availableOnly, language, tags }) {
    return agents.filter((agent) => {
      // Capability filter
      if (capability) {
        const caps = this._getCapabilities(agent);
        const hasCapability = caps.some(
          (c) => c.toLowerCase().includes(capability.toLowerCase())
        );
        if (!hasCapability) return false;
      }

      // Price filter
      if (maxPrice !== undefined && maxPrice !== null) {
        const price = this._getMinPrice(agent);
        if (price !== null && price > maxPrice) return false;
      }

      // Minimum reputation score filter (0-5 scale)
      if (minScore !== undefined && minScore !== null) {
        const score = agent.reputation?.score || (agent.reputationScore || 0) / 100;
        if (score < minScore) return false;
      }

      // #20: Minimum success rate filter (0-1)
      if (minSuccessRate !== undefined && minSuccessRate !== null) {
        const successRate = agent.reputation?.successRate || agent.metadata?.successRate || 1.0;
        if (successRate < minSuccessRate) return false;
      }

      // #20: Available only filter
      if (availableOnly) {
        const status = agent.availability?.status || (agent.available ? 'online' : 'offline');
        if (status !== 'online') return false;
      }

      // #20: Language filter
      if (language) {
        const agentLanguages = agent.metadata?.languages || agent.metadata?.language || [];
        const langList = Array.isArray(agentLanguages) ? agentLanguages : [agentLanguages];
        if (langList.length > 0) {
          const hasLanguage = langList.some(
            (l) => l.toLowerCase() === language.toLowerCase()
          );
          if (!hasLanguage) return false;
        }
        // If no language info, don't filter out
      }

      // #20: Tags filter
      if (tags && Array.isArray(tags) && tags.length > 0) {
        const agentTags = agent.metadata?.tags || [];
        if (agentTags.length > 0) {
          const hasAnyTag = tags.some((tag) =>
            agentTags.some((at) => at.toLowerCase() === tag.toLowerCase())
          );
          if (!hasAnyTag) return false;
        }
        // If no tags info, don't filter out
      }

      // Free-text search across name, description, capabilities
      if (q) {
        const queryLower = q.toLowerCase();
        const name = (agent.name || agent.metadata?.name || '').toLowerCase();
        const description = (agent.description || agent.metadata?.description || '').toLowerCase();
        const caps = this._getCapabilities(agent).join(' ').toLowerCase();

        const matches =
          name.includes(queryLower) ||
          description.includes(queryLower) ||
          caps.includes(queryLower);

        if (!matches) return false;
      }

      return true;
    });
  }

  /**
   * Extract capability names from agent data.
   * @private
   */
  _getCapabilities(agent) {
    const caps = agent.capabilities || agent.metadata?.capabilities || [];
    return caps.map((c) => {
      if (typeof c === 'string') return c;
      return c.name || c.id || '';
    });
  }

  /**
   * Get the minimum price from agent capabilities.
   * @private
   */
  _getMinPrice(agent) {
    if (agent.metadata?.pricePerTask !== undefined) return agent.metadata.pricePerTask;
    if (agent.basePriceUsdc !== undefined) return parseFloat(agent.basePriceUsdc);

    const caps = agent.capabilities || agent.metadata?.capabilities || [];
    const prices = caps
      .map((c) => typeof c === 'object' ? parseFloat(c.pricing?.basePrice || 0) : 0)
      .filter((p) => p > 0);

    return prices.length > 0 ? Math.min(...prices) : null;
  }

  /**
   * Get estimated price string for display.
   * @private
   */
  _getEstimatedPrice(agent) {
    const price = this._getMinPrice(agent);
    return price !== null ? price.toFixed(2) : '0.00';
  }

  /**
   * Generate human-readable match reason.
   * @private
   */
  _generateMatchReason(agent, { q, capability }) {
    const parts = [];
    const score = agent.reputation?.score || (agent.reputationScore || 0) / 100;

    if (capability) {
      const caps = this._getCapabilities(agent);
      if (caps.some((c) => c.toLowerCase() === capability.toLowerCase())) {
        parts.push('exact capability match');
      } else {
        parts.push('partial capability match');
      }
    }

    if (score >= 4.5) parts.push('excellent reputation');
    else if (score >= 4.0) parts.push('good reputation');

    const price = this._getMinPrice(agent);
    if (price !== null && price <= 5) parts.push('affordable pricing');

    return parts.length > 0 ? parts.join(', ') : 'general match';
  }

  /**
   * Compute a relevance score for ranking search results.
   * @private
   */
  _computeRelevance(agent, { q, capability }) {
    let score = 0;

    // Reputation contributes to relevance
    const repScore = agent.reputation?.score || (agent.reputationScore || 0) / 100;
    score += repScore * 10;

    // Exact capability match bonus
    if (capability) {
      const caps = this._getCapabilities(agent);
      if (caps.some((c) => c.toLowerCase() === capability.toLowerCase())) {
        score += 50;
      } else if (caps.some((c) => c.toLowerCase().includes(capability.toLowerCase()))) {
        score += 25;
      }
    }

    // Text match quality
    if (q) {
      const queryLower = q.toLowerCase();
      const name = (agent.name || agent.metadata?.name || '').toLowerCase();
      const desc = (agent.description || agent.metadata?.description || '').toLowerCase();

      if (name === queryLower) score += 100;
      else if (name.includes(queryLower)) score += 30;
      if (desc.includes(queryLower)) score += 15;
    }

    // Success rate bonus
    const successRate = agent.reputation?.successRate || 0.95;
    if (successRate >= 0.98) score += 10;

    // Prefer lower-priced agents (slight bonus)
    const price = this._getMinPrice(agent);
    if (price !== null && price > 0) {
      score += Math.max(0, 20 - price * 0.5);
    }

    return score;
  }
}

module.exports = DiscoveryService;
