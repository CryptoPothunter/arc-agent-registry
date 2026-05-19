/**
 * DiscoveryService - intelligent agent search and filtering.
 * Enables clients to find the best-matching agents by capability, price, and reputation.
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
   * @param {object} params
   * @param {string} [params.q] - Free-text search query.
   * @param {string} [params.capability] - Required capability.
   * @param {number} [params.maxPrice] - Maximum price per task.
   * @param {number} [params.minScore] - Minimum reputation score.
   * @param {number} [params.limit] - Max results to return (default 20).
   * @returns {Promise<object[]>} Sorted list of matching agents.
   */
  async smartSearch({ q, capability, maxPrice, minScore, limit = 20 }) {
    // Check discovery cache
    const cacheKey = `${CACHE_KEYS.DISCOVERY_CACHE}${JSON.stringify({ q, capability, maxPrice, minScore, limit })}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    // Get all active agents from registry
    const allAgents = await this.registry.getAllActiveAgents();

    // Apply filters
    let results = this.applyFilters(allAgents, { q, capability, maxPrice, minScore });

    // Score and sort by relevance
    results = results
      .map((agent) => ({
        ...agent,
        relevanceScore: this._computeRelevance(agent, { q, capability }),
      }))
      .sort((a, b) => {
        // Primary: relevance score, Secondary: reputation
        const scoreDiff = b.relevanceScore - a.relevanceScore;
        if (scoreDiff !== 0) return scoreDiff;
        return (b.reputationScore || 0) - (a.reputationScore || 0);
      })
      .slice(0, limit);

    // Cache results for 30 seconds
    setCache(cacheKey, results, 30);

    return results;
  }

  /**
   * Apply filter criteria to a list of agents.
   * @param {object[]} agents
   * @param {object} filters
   * @returns {object[]} Filtered agents.
   */
  applyFilters(agents, { q, capability, maxPrice, minScore }) {
    return agents.filter((agent) => {
      // Capability filter
      if (capability) {
        const caps = agent.capabilities || agent.metadata?.capabilities || [];
        const hasCapability = caps.some(
          (c) => c.toLowerCase() === capability.toLowerCase()
        );
        if (!hasCapability) return false;
      }

      // Price filter
      if (maxPrice !== undefined && maxPrice !== null) {
        const price = agent.metadata?.pricePerTask ?? agent.pricePerTask;
        if (price !== undefined && price > maxPrice) return false;
      }

      // Minimum reputation score filter
      if (minScore !== undefined && minScore !== null) {
        if ((agent.reputationScore || 0) < minScore) return false;
      }

      // Free-text search across name, description, capabilities
      if (q) {
        const queryLower = q.toLowerCase();
        const name = (agent.metadata?.name || agent.name || '').toLowerCase();
        const description = (agent.metadata?.description || '').toLowerCase();
        const caps = (agent.capabilities || []).join(' ').toLowerCase();

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
   * Compute a relevance score for ranking search results.
   * @private
   */
  _computeRelevance(agent, { q, capability }) {
    let score = 0;

    // Reputation contributes to relevance
    score += (agent.reputationScore || 0) * 0.5;

    // Exact capability match bonus
    if (capability) {
      const caps = agent.capabilities || [];
      if (caps.some((c) => c.toLowerCase() === capability.toLowerCase())) {
        score += 50;
      }
    }

    // Text match quality
    if (q) {
      const queryLower = q.toLowerCase();
      const name = (agent.metadata?.name || '').toLowerCase();
      if (name === queryLower) score += 100; // exact name match
      else if (name.includes(queryLower)) score += 30; // partial name match
    }

    // Prefer lower-priced agents (slight bonus)
    const price = agent.metadata?.pricePerTask;
    if (price !== undefined && price > 0) {
      score += Math.max(0, 20 - price * 0.1);
    }

    return score;
  }
}

module.exports = DiscoveryService;
