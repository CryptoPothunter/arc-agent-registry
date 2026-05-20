/**
 * SettlementService - handles post-task settlement.
 * Orchestrates fund release, reputation updates, yield redemption,
 * and cross-chain fund consolidation via Gateway CCTP.
 */

const EscrowService = require('./escrow.service');
const RegistryService = require('./registry.service');
const USYCService = require('./usyc.service');
const GatewayService = require('./gateway.service');
const ReputationService = require('./reputation.service');

/**
 * Decay factor for weighted moving average reputation scoring.
 * #21: Uses DECAY_FACTOR=0.95 per doc spec instead of fixed 70/30 ratio.
 * Formula: newScore = DECAY_FACTOR * currentScore + (1 - DECAY_FACTOR) * qualityScore
 */
const DECAY_FACTOR = 0.95;

class SettlementService {
  constructor({ escrowService, registryService, gatewayService, reputationService } = {}) {
    this.escrow = escrowService || new EscrowService();
    this.registry = registryService || new RegistryService();
    this.usyc = new USYCService();
    this.gateway = gatewayService || new GatewayService();
    this.reputation = reputationService || new ReputationService();
    this.decayFactor = DECAY_FACTOR;
  }

  /**
   * Settle a completed task.
   * - Redeems any USYC yield if funds were deployed.
   * - Releases escrowed funds to the provider.
   * - Updates the provider's reputation score.
   * - Executes cross-chain consolidation if needed.
   *
   * @param {object} params
   * @param {string} params.taskId - Task identifier.
   * @param {string} params.providerAgentId - Provider agent ID for reputation update.
   * @param {number} [params.qualityScore] - Quality score (0-100) from validation.
   * @param {boolean} [params.yieldDeployed] - Whether funds were deployed to USYC.
   * @param {string} [params.consolidateToChain] - Target chain for fund consolidation.
   * @returns {Promise<object>} Settlement result.
   */
  async settle({ taskId, providerAgentId, qualityScore = 100, yieldDeployed = false, consolidateToChain }) {
    const steps = [];

    try {
      // Step 1: Redeem from USYC if funds were deployed
      if (yieldDeployed) {
        try {
          const escrowStatus = await this.escrow.getEscrowStatus(taskId);
          const redeemResult = await this.usyc.redeemFromUSYC({
            shares: escrowStatus.amount,
            signer: this.escrow.signer,
          });
          steps.push({
            step: 'usyc_redeem',
            success: true,
            usycShares: escrowStatus.amount,
            ...redeemResult,
          });
        } catch (err) {
          steps.push({ step: 'usyc_redeem', success: false, error: err.message });
          // Continue with settlement even if USYC redemption fails
        }
      }

      // Step 2: Release escrowed funds to provider
      const releaseResult = await this.escrow.releaseFunds(taskId);
      steps.push({ step: 'escrow_release', success: true, ...releaseResult });

      // Step 3: Update provider reputation via ReputationService
      try {
        const currentRecord = await this.reputation.getAverageScore(providerAgentId);
        const currentScore = currentRecord.averageScore || 0;

        // Convert qualityScore (0-100) to contract rating scale (100-500)
        const contractRating = Math.round(100 + (qualityScore / 100) * 400);
        const ratingResult = await this.reputation.submitRating(providerAgentId, contractRating);

        // #21: Decay-factor weighted moving average (DECAY_FACTOR=0.95)
        // Formula: newScore = DECAY_FACTOR * currentScore + (1 - DECAY_FACTOR) * qualityScore
        const newScore = Math.round(this.decayFactor * currentScore + (1 - this.decayFactor) * qualityScore);

        steps.push({
          step: 'reputation_update',
          success: true,
          previousScore: currentScore,
          newScore,
          qualityScore,
          contractRating,
          txHash: ratingResult.txHash,
        });
      } catch (err) {
        steps.push({ step: 'reputation_update', success: false, error: err.message });
      }

      // Step 4: Cross-chain fund consolidation (if provider is multi-chain)
      try {
        const providerAgent = await this.registry.getAgentInfo(providerAgentId);
        const providerAddress = providerAgent.walletAddress;

        if (providerAddress) {
          const balances = await this.gateway.getUnifiedBalance(providerAddress);
          const chainCount = Object.keys(balances.balances).filter(
            (chain) => parseFloat(balances.balances[chain]) > 0
          ).length;

          if (chainCount > 1 && consolidateToChain) {
            // Execute cross-chain consolidation to target chain
            const consolidationResults = [];

            for (const [chain, balance] of Object.entries(balances.balances)) {
              if (chain === consolidateToChain || parseFloat(balance) === 0) continue;

              try {
                const transferResult = await this.gateway.crossChainTransfer({
                  from: providerAddress,
                  to: providerAddress,
                  amount: balance,
                  sourceChain: chain,
                  destChain: consolidateToChain,
                  signer: this.escrow.signer,
                });
                consolidationResults.push({
                  chain,
                  amount: balance,
                  status: transferResult.status,
                  txHash: transferResult.burnTxHash || transferResult.txHash,
                });
              } catch (err) {
                consolidationResults.push({
                  chain,
                  amount: balance,
                  status: 'failed',
                  error: err.message,
                });
              }
            }

            steps.push({
              step: 'cross_chain_consolidation',
              success: true,
              targetChain: consolidateToChain,
              transfers: consolidationResults,
            });
          } else if (chainCount > 1) {
            steps.push({
              step: 'cross_chain_check',
              success: true,
              chainsDetected: chainCount,
              balances: balances.balances,
              message: 'Provider has multi-chain presence. Set consolidateToChain to auto-consolidate.',
            });
          } else {
            steps.push({
              step: 'cross_chain_check',
              success: true,
              chainsDetected: chainCount,
              message: 'Single-chain provider, no consolidation needed.',
            });
          }
        }
      } catch (err) {
        steps.push({ step: 'cross_chain_check', success: false, error: err.message });
      }

      return {
        taskId,
        providerAgentId,
        settled: true,
        steps,
        settledAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        taskId,
        providerAgentId,
        settled: false,
        error: err.message,
        steps,
      };
    }
  }

  /**
   * Get settlement summary for a task.
   * @param {string} taskId
   * @returns {Promise<object>} Settlement summary.
   */
  async getSettlementSummary(taskId) {
    const escrowStatus = await this.escrow.getEscrowStatus(taskId);
    const settled = escrowStatus.status === 'released';

    return {
      taskId,
      settled,
      escrowStatus: escrowStatus.status,
      amount: escrowStatus.amount,
      provider: escrowStatus.provider,
      client: escrowStatus.client,
    };
  }
}

module.exports = SettlementService;
