/**
 * SettlementService - handles post-task settlement.
 * Orchestrates fund release, reputation updates, and yield redemption.
 */

const EscrowService = require('./escrow.service');
const RegistryService = require('./registry.service');
const USYCService = require('./usyc.service');
const GatewayService = require('./gateway.service');
const ReputationService = require('./reputation.service');

class SettlementService {
  constructor({ escrowService, registryService, gatewayService, reputationService } = {}) {
    this.escrow = escrowService || new EscrowService();
    this.registry = registryService || new RegistryService();
    this.usyc = new USYCService();
    this.gateway = gatewayService || new GatewayService();
    this.reputation = reputationService || new ReputationService();
  }

  /**
   * Settle a completed task.
   * - Redeems any USYC yield if funds were deployed.
   * - Releases escrowed funds to the provider.
   * - Updates the provider's reputation score.
   *
   * @param {object} params
   * @param {string} params.taskId - Task identifier.
   * @param {string} params.providerAgentId - Provider agent ID for reputation update.
   * @param {number} [params.qualityScore] - Quality score (0-100) from validation.
   * @param {boolean} [params.yieldDeployed] - Whether funds were deployed to USYC.
   * @returns {Promise<object>} Settlement result.
   */
  async settle({ taskId, providerAgentId, qualityScore = 100, yieldDeployed = false }) {
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
          steps.push({ step: 'usyc_redeem', success: true, ...redeemResult });
        } catch (err) {
          steps.push({ step: 'usyc_redeem', success: false, error: err.message });
          // Continue with settlement even if USYC redemption fails
        }
      }

      // Step 2: Check if cross-chain transfer is needed
      try {
        const escrowStatus = yieldDeployed
          ? (steps.find((s) => s.step === 'usyc_redeem') || {})._escrowStatus
            || await this.escrow.getEscrowStatus(taskId)
          : await this.escrow.getEscrowStatus(taskId);

        const providerAgent = await this.registry.getAgentInfo(providerAgentId);
        const providerAddress = providerAgent.walletAddress;

        if (providerAddress) {
          const balances = await this.gateway.getUnifiedBalance(providerAddress);
          // If the provider has balances on multiple chains, a cross-chain
          // consolidation may be required after release. Log this for now.
          const chainCount = Object.keys(balances.balances).length;
          if (chainCount > 1) {
            steps.push({
              step: 'cross_chain_check',
              success: true,
              chainsDetected: chainCount,
              message: 'Provider has multi-chain presence; cross-chain transfer may be needed post-release.',
            });
          } else {
            steps.push({ step: 'cross_chain_check', success: true, chainsDetected: chainCount });
          }
        }
      } catch (err) {
        steps.push({ step: 'cross_chain_check', success: false, error: err.message });
        // Continue with settlement even if cross-chain check fails
      }

      // Step 3: Release escrowed funds to provider
      const releaseResult = await this.escrow.releaseFunds(taskId);
      steps.push({ step: 'escrow_release', success: true, ...releaseResult });

      // Step 4: Update provider reputation via ReputationService
      try {
        const currentRecord = await this.reputation.getAverageScore(providerAgentId);
        const currentScore = currentRecord.averageScore || 0;

        // Convert qualityScore (0-100) to contract rating scale (100-500)
        const contractRating = Math.round(100 + (qualityScore / 100) * 400);
        await this.reputation.submitRating(providerAgentId, contractRating);

        // Weighted moving average: 70% existing score + 30% new quality score
        const newScore = Math.round(currentScore * 0.7 + qualityScore * 0.3);

        steps.push({
          step: 'reputation_update',
          success: true,
          previousScore: currentScore,
          newScore,
          qualityScore,
        });
      } catch (err) {
        steps.push({ step: 'reputation_update', success: false, error: err.message });
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
}

module.exports = SettlementService;
