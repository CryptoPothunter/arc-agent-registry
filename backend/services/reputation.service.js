/**
 * ReputationService - wraps the ReputationOracle contract.
 * Manages agent reputation scores, ratings, and history.
 */

const { ethers } = require('ethers');
const ReputationOracleABI = require('../abis/ReputationOracle.json');

const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.org';
const REPUTATION_ADDRESS = process.env.REPUTATION_CONTRACT || '';
const OPERATOR_KEY = process.env.OPERATOR_PRIVATE_KEY || '';

class ReputationService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.signer = OPERATOR_KEY
      ? new ethers.Wallet(OPERATOR_KEY, this.provider)
      : null;
    this.contract = REPUTATION_ADDRESS
      ? new ethers.Contract(REPUTATION_ADDRESS, ReputationOracleABI, this.signer || this.provider)
      : null;
    // Dev fallback: in-memory store
    this._store = new Map();
  }

  /**
   * Submit a rating for an agent.
   * @param {string} agentId - The agent to rate.
   * @param {number} rating - Rating score (100-500, representing 1.00-5.00).
   * @returns {Promise<object>} Submission result.
   */
  async submitRating(agentId, rating) {
    if (typeof rating !== 'number' || rating < 100 || rating > 500) {
      throw new Error('Rating must be a number between 100 and 500 (representing 1.00-5.00)');
    }

    if (this.contract && this.signer) {
      const tx = await this.contract.submitRating(agentId, rating);
      const receipt = await tx.wait();
      return {
        agentId,
        rating,
        txHash: receipt.hash,
        submittedAt: new Date().toISOString(),
      };
    }

    // Dev fallback
    if (!this._store.has(agentId)) {
      this._store.set(agentId, { ratings: [], totalScore: 0 });
    }
    const record = this._store.get(agentId);
    record.ratings.push({ rating, submittedAt: new Date().toISOString() });
    record.totalScore = record.ratings.reduce((sum, r) => sum + r.rating, 0);

    return {
      agentId,
      rating,
      submittedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the average reputation score for an agent.
   * @param {string} agentId
   * @returns {Promise<object>} Average score and rating count.
   */
  async getAverageScore(agentId) {
    if (this.contract) {
      const score = await this.contract.getAverageScore(agentId);
      return {
        agentId,
        averageScore: Number(score),
      };
    }

    // Dev fallback
    const record = this._store.get(agentId);
    if (!record || record.ratings.length === 0) {
      return { agentId, averageScore: 0, ratingCount: 0 };
    }
    const avg = Math.round(record.totalScore / record.ratings.length);
    return { agentId, averageScore: avg, ratingCount: record.ratings.length };
  }

  /**
   * Get the full rating history for an agent.
   * @param {string} agentId
   * @returns {Promise<object>} Rating history array.
   */
  async getRatingHistory(agentId) {
    if (this.contract) {
      const history = await this.contract.getRatingHistory(agentId);
      return {
        agentId,
        history: history.map((rating) => ({
          rating: Number(rating),
        })),
      };
    }

    // Dev fallback
    const record = this._store.get(agentId);
    if (!record) {
      return { agentId, history: [] };
    }
    return { agentId, history: record.ratings };
  }

  /**
   * Get a complete reputation record for an agent (average + history).
   * @param {string} agentId
   * @returns {Promise<object>} Full reputation record.
   */
  async getReputationRecord(agentId) {
    const [average, history] = await Promise.all([
      this.getAverageScore(agentId),
      this.getRatingHistory(agentId),
    ]);

    return {
      agentId,
      averageScore: average.averageScore,
      ratingCount: average.ratingCount || history.history.length,
      history: history.history,
    };
  }
}

module.exports = ReputationService;
